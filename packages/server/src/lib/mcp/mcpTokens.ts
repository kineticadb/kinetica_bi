/**
 * Phase 143 (AIMCP-V20-04): personal access tokens for the Claude Desktop connector (packages/mcp).
 *
 * Kinetica BI runs every Kinetica query as the signed-in user with their own Kinetica password, so a token has to
 * lead back to that password. The token is `kbi_<publicId>_<secret>`: the row stores a SHA-256 of the whole token
 * and the user's password encrypted (AES-256-GCM) with a key derived from <secret> (HKDF). The secret is never
 * stored, so the row alone (even with the server's session key) cannot recover the password. Redeeming a token
 * gives back the credential; the route then checks it with Kinetica and opens a normal session.
 */
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "../../db";
import { deleteSession } from "../../sessionStore";

export const MCP_TOKEN_RE = /^kbi_([0-9a-f]{16})_([A-Za-z0-9_-]{43})$/;
const HKDF_INFO = "kinetica-bi mcp token v1";

export type McpTokenSummary = { id: number; name: string; createdAt: string; lastUsedAt: string | null; expiresAt: string };
export type RedeemedMcpToken = { tokenId: number; username: string; secret: string; kineticaUrl: string };

type Row = {
  id: number;
  username: string;
  token_hash: Buffer;
  salt: Buffer;
  ciphertext: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
  kinetica_url: string;
  expired: number;
};

const hashToken = (token: string): Buffer => createHash("sha256").update(token, "utf8").digest();
const deriveKey = (secret: string, salt: Buffer): Buffer => Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), salt, HKDF_INFO, 32));

export function createMcpToken(input: { username: string; secret: string; kineticaUrl: string; name: string; ttlDays: number }): { id: number; token: string } {
  const publicId = randomBytes(8).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  const token = `kbi_${publicId}_${secret}`;
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret, salt), iv);
  const ciphertext = Buffer.concat([cipher.update(input.secret, "utf8"), cipher.final()]);
  const r = db
    .prepare(
      `INSERT INTO mcp_tokens (public_id, username, name, token_hash, salt, ciphertext, iv, auth_tag, kinetica_url, expires_at)
       VALUES (?, lower(?), ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))`,
    )
    .run(publicId, input.username, input.name, hashToken(token), salt, ciphertext, iv, cipher.getAuthTag(), input.kineticaUrl, `+${input.ttlDays} days`);
  return { id: Number(r.lastInsertRowid), token };
}

/** The token's credential, or null when it is malformed, unknown, wrong, expired or revoked. */
export function redeemMcpToken(token: string): RedeemedMcpToken | null {
  const m = MCP_TOKEN_RE.exec(token);
  if (!m) return null;
  const row = db
    .prepare(
      `SELECT id, username, token_hash, salt, ciphertext, iv, auth_tag, kinetica_url, expires_at <= datetime('now') AS expired
       FROM mcp_tokens WHERE public_id = ?`,
    )
    .get(m[1]) as Row | undefined;
  if (!row || row.expired) return null;
  if (!timingSafeEqual(hashToken(token), row.token_hash)) return null;
  let secret: string;
  try {
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(m[2], row.salt), row.iv);
    decipher.setAuthTag(row.auth_tag);
    secret = Buffer.concat([decipher.update(row.ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
  db.prepare("UPDATE mcp_tokens SET last_used_at = datetime('now') WHERE id = ?").run(row.id);
  return { tokenId: row.id, username: row.username, secret, kineticaUrl: row.kinetica_url };
}

export function listMcpTokens(username: string): McpTokenSummary[] {
  return db
    .prepare(
      `SELECT id, name, created_at AS createdAt, last_used_at AS lastUsedAt, expires_at AS expiresAt
       FROM mcp_tokens WHERE username = lower(?) ORDER BY id DESC`,
    )
    .all(username) as McpTokenSummary[];
}

export function recordMcpTokenSession(sid: string, tokenId: number): void {
  db.prepare("INSERT OR REPLACE INTO mcp_token_sessions (sid, token_id) VALUES (?, ?)").run(sid, tokenId);
}

/** Deletes the user's token and ends the sessions it opened. False when the token is not theirs. */
export function revokeMcpToken(username: string, id: number): boolean {
  return db.transaction(() => {
    const r = db.prepare("DELETE FROM mcp_tokens WHERE id = ? AND username = lower(?)").run(id, username);
    if (r.changes === 0) return false;
    const sids = db.prepare("SELECT sid FROM mcp_token_sessions WHERE token_id = ?").all(id) as { sid: string }[];
    for (const { sid } of sids) deleteSession(sid);
    db.prepare("DELETE FROM mcp_token_sessions WHERE token_id = ?").run(id);
    return true;
  })();
}
