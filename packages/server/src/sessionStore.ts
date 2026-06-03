import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { db } from "./db";

// ---- Boot validation ----
const HEX_64 = /^[0-9a-fA-F]{64}$/;

export const getSessionEncryptionKey = (): Buffer => {
  const raw = process.env.SESSION_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "SESSION_ENCRYPTION_KEY must be set. Generate with: openssl rand -hex 32"
    );
  }
  if (!HEX_64.test(raw)) {
    throw new Error(
      "SESSION_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). " +
        "Generate with: openssl rand -hex 32"
    );
  }
  return Buffer.from(raw, "hex");
};

// Module-load fail-fast: throws at import time if env is bad.
// (Test setup.ts pre-sets a valid 64-hex key, so importing in tests never fails here.)
const SESSION_KEY = getSessionEncryptionKey();

// ---- Crypto helpers ----
export type EncryptedBlob = { ciphertext: Buffer; iv: Buffer; authTag: Buffer };

// encryptSecret/decryptSecret are credential-type agnostic — used for both passwords
// and OIDC tokens (access_token AND id_token). Renamed in place from v1.0's
// encryptPassword/decryptPassword; AES-256-GCM behavior is byte-identical.
export const encryptSecret = (secret: string): EncryptedBlob => {
  const iv = randomBytes(12); // 96-bit GCM nonce — fresh per row (Pitfall P2)
  const cipher = createCipheriv("aes-256-gcm", SESSION_KEY, iv);
  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag(); // MUST be after .final() (Pitfall P1)
  return { ciphertext, iv, authTag };
};

export const decryptSecret = (blob: EncryptedBlob): string => {
  const decipher = createDecipheriv("aes-256-gcm", SESSION_KEY, blob.iv);
  decipher.setAuthTag(blob.authTag); // MUST be before reading (Pitfall P1)
  const plaintext = Buffer.concat([
    decipher.update(blob.ciphertext),
    decipher.final(), // throws "unable to authenticate" on tag mismatch
  ]);
  return plaintext.toString("utf8");
};

// ---- sid generator ----
export const generateSid = (): string => randomBytes(32).toString("hex");

// ---- Session row shape (decrypted) ----
export type SessionRow = {
  sid: string;
  username: string;
  secret: string;                          // password OR access token, opaque to consumers
  credentialType: "password" | "oidc";     // string-literal union for downstream exhaustiveness
  idToken: string | null;                  // eagerly decrypted; null in password mode or when absent
  kineticaUrl: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
};

type RawSessionRow = {
  sid: string;
  username: string;
  ciphertext: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
  kinetica_url: string;
  credential_type: string;                 // 'password' | 'oidc' (DB-side TEXT NOT NULL DEFAULT 'password')
  id_token_ciphertext: Buffer | null;      // BLOB nullable
  id_token_iv: Buffer | null;
  id_token_auth_tag: Buffer | null;
  created_at: string;
  last_used_at: string;
  expires_at: string;
};

// ---- Prepared statements ----
const insertStmt = db.prepare(
  `INSERT INTO sessions
    (sid, username, ciphertext, iv, auth_tag, kinetica_url, credential_type,
     id_token_ciphertext, id_token_iv, id_token_auth_tag, expires_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'))`
);
const selectStmt = db.prepare(
  `SELECT sid, username, ciphertext, iv, auth_tag, kinetica_url, credential_type,
          id_token_ciphertext, id_token_iv, id_token_auth_tag,
          created_at, last_used_at, expires_at
   FROM sessions WHERE sid = ?`
);
const isExpiredStmt = db.prepare(
  `SELECT 1 AS expired FROM (SELECT 1) WHERE ? <= datetime('now')`
);
const touchStmt = db.prepare(
  `UPDATE sessions SET last_used_at = datetime('now') WHERE sid = ?`
);
const deleteStmt = db.prepare(`DELETE FROM sessions WHERE sid = ?`);
const deleteByUserStmt = db.prepare(`DELETE FROM sessions WHERE username = ?`);
const sweepStmt = db.prepare(
  `DELETE FROM sessions WHERE expires_at <= datetime('now')`
);

// ---- Public CRUD ----
// createSession accepts plaintext `secret` and (optionally) plaintext `idToken`.
// Encryption happens internally via encryptSecret — callers never touch AES.
// credentialType defaults to 'password'; idToken omitted ⇒ NULL into id_token_* columns.
export type CreateSessionInput = {
  username: string;
  secret: string;
  kineticaUrl: string;
  credentialType?: "password" | "oidc";
  idToken?: string;
};

export const createSession = (input: CreateSessionInput): string => {
  const sid = generateSid();
  const credentialType: "password" | "oidc" = input.credentialType ?? "password";

  const secretBlob = encryptSecret(input.secret);

  // id_token: if provided, encrypt + bind; if absent, bind NULL into the 3 columns.
  let idTokenCt: Buffer | null = null;
  let idTokenIv: Buffer | null = null;
  let idTokenTag: Buffer | null = null;
  if (input.idToken !== undefined && input.idToken !== null) {
    const tokenBlob = encryptSecret(input.idToken);
    idTokenCt = tokenBlob.ciphertext;
    idTokenIv = tokenBlob.iv;
    idTokenTag = tokenBlob.authTag;
  }

  insertStmt.run(
    sid,
    input.username,
    secretBlob.ciphertext,
    secretBlob.iv,
    secretBlob.authTag,
    input.kineticaUrl,
    credentialType,
    idTokenCt,
    idTokenIv,
    idTokenTag
  );
  return sid;
};

const isExpired = (expiresAt: string): boolean =>
  Boolean(
    (isExpiredStmt.get(expiresAt) as { expired?: number } | undefined)?.expired
  );

/**
 * Decode-only JWT exp extraction. Single failure mode: returns null on ANY parse problem
 * (≠3 segments, malformed b64, malformed JSON, missing/non-numeric exp). Caller treats
 * null as "opaque or unparseable — skip proactive check, defer to reactive 401 from Kinetica."
 *
 * NOT signature-verified — id_token was signature-verified at OIDC callback time
 * (PITFALL I-07; AES-256-GCM auth tag protects integrity at rest).
 */
export const tryDecodeAccessTokenExp = (token: string): number | null => {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let payload: unknown;
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    payload = JSON.parse(json);
  } catch {
    return null;
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    !("exp" in payload) ||
    typeof (payload as { exp: unknown }).exp !== "number"
  ) {
    return null;
  }
  return (payload as { exp: number }).exp;
};

// Clock-skew tolerance: 30 seconds — matches Phase 5 openid-client clockTolerance: 30 (PITFALL T-06).
// Single window across callback verify and request-time exp re-check.
const ACCESS_TOKEN_CLOCK_SKEW_SECONDS = 30;

export const getSession = (sid: string): SessionRow | null => {
  const row = selectStmt.get(sid) as RawSessionRow | undefined;
  if (!row) return null;
  if (isExpired(row.expires_at)) {
    deleteStmt.run(sid); // passive expiry-on-access
    return null;
  }
  let secret: string;
  try {
    secret = decryptSecret({
      ciphertext: row.ciphertext,
      iv: row.iv,
      authTag: row.auth_tag,
    });
  } catch {
    deleteStmt.run(sid); // unrecoverable row — drop it
    return null;
  }

  // id_token: eager decrypt when all 3 raw columns are present; null otherwise.
  // On decrypt failure, drop the row + return null — symmetric with the secret path.
  let idToken: string | null = null;
  if (
    row.id_token_ciphertext !== null &&
    row.id_token_iv !== null &&
    row.id_token_auth_tag !== null
  ) {
    try {
      idToken = decryptSecret({
        ciphertext: row.id_token_ciphertext,
        iv: row.id_token_iv,
        authTag: row.id_token_auth_tag,
      });
    } catch {
      deleteStmt.run(sid);
      return null;
    }
  }

  // Proactive access-token expiry check (PITFALL I-07, Phase 6 SC3).
  // OIDC sessions only — password mode has no token to decode.
  // Symmetric with the secret/id_token decrypt-failure pattern: drop row + return null.
  // Opaque or unparseable tokens (helper returns null) skip the check — Kinetica's
  // reactive 401 still fires the existing REAUTH chain.
  if (row.credential_type === "oidc") {
    const exp = tryDecodeAccessTokenExp(secret);
    if (exp !== null) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (exp + ACCESS_TOKEN_CLOCK_SKEW_SECONDS < nowSeconds) {
        deleteStmt.run(sid);
        return null;
      }
    }
  }

  return {
    sid: row.sid,
    username: row.username,
    secret,
    credentialType: row.credential_type as "password" | "oidc",
    idToken,
    kineticaUrl: row.kinetica_url,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
  };
};

export const touchSession = (sid: string): void => {
  touchStmt.run(sid); // last_used_at ONLY; never expires_at (Pitfall P5)
};

export const deleteSession = (sid: string): void => {
  deleteStmt.run(sid);
};

export const deleteSessionsForUser = (username: string): number => {
  const result = deleteByUserStmt.run(username);
  return result.changes;
};

export const sweepExpiredSessions = (): number => {
  const result = sweepStmt.run();
  return result.changes;
};

// ---- Periodic GC ----
export const startSessionSweep = (): NodeJS.Timeout => {
  const handle = setInterval(() => {
    try {
      const deleted = sweepExpiredSessions();
      console.log(`[sessions] swept ${deleted} expired rows`);
    } catch (err) {
      console.error("[sessions] sweep failed", err);
      // next tick retries; do NOT clearInterval (Pitfall P6)
    }
  }, 60 * 60 * 1000);
  handle.unref(); // lets test runners exit cleanly
  return handle;
};
