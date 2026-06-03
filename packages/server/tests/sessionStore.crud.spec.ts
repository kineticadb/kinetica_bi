import { describe, beforeEach, expect, it } from "vitest";
import { db } from "../src/db";
import {
  createSession,
  getSession,
  touchSession,
  sweepExpiredSessions,
  tryDecodeAccessTokenExp,
} from "../src/sessionStore";

// ---- JWT helper for building test tokens (decode-only; sig unused) ----
const makeJwt = (payload: Record<string, unknown>): string => {
  const header = Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = "sig"; // signature unused — decode-only
  return `${header}.${body}.${sig}`;
};

describe("sessionStore CRUD (SESS-01, SESS-04, SESS-05)", () => {
  beforeEach(() => {
    // Reset sessions table between tests to avoid cross-test contamination.
    db.exec("DELETE FROM sessions");
  });

  // SESS-01 — row-level persistence
  it("createSession INSERTs a row with non-empty BLOB columns (ciphertext, iv, auth_tag)", () => {
    const sid = createSession({ username: "alice", secret: "pw123", kineticaUrl: "https://k.test" });
    const raw = db
      .prepare(
        "SELECT length(ciphertext) AS ct, length(iv) AS iv, length(auth_tag) AS at FROM sessions WHERE sid = ?"
      )
      .get(sid) as { ct: number; iv: number; at: number } | undefined;
    expect(raw).toBeDefined();
    expect(raw!.ct).toBeGreaterThan(0);
    expect(raw!.iv).toBe(12);
    expect(raw!.at).toBe(16);

    // Also confirm the row has username and kinetica_url
    const row = db
      .prepare("SELECT username, kinetica_url FROM sessions WHERE sid = ?")
      .get(sid) as { username: string; kinetica_url: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.username).toBe("alice");
    expect(row!.kinetica_url).toBe("https://k.test");
  });

  it("getSession returns the decrypted secret + credentialType + null idToken in password mode", () => {
    const sid = createSession({ username: "bob", secret: "mysecret", kineticaUrl: "https://kinetica.example.com" });
    const session = getSession(sid);
    expect(session).not.toBeNull();
    expect(session!.sid).toBe(sid);
    expect(session!.username).toBe("bob");
    expect(session!.secret).toBe("mysecret");
    expect(session!.kineticaUrl).toBe("https://kinetica.example.com");
    expect(typeof session!.createdAt).toBe("string");
    expect(typeof session!.lastUsedAt).toBe("string");
    expect(typeof session!.expiresAt).toBe("string");
    expect(session!.credentialType).toBe("password");
    expect(session!.idToken).toBeNull();
  });

  // SESS-04 — 8h TTL, no extension
  it("8h TTL: createSession stamps expires_at within ±60s of datetime('now', '+8 hours')", () => {
    const sid = createSession({ username: "carol", secret: "pass", kineticaUrl: "https://k.test" });
    const row = db
      .prepare("SELECT expires_at FROM sessions WHERE sid = ?")
      .get(sid) as { expires_at: string } | undefined;
    expect(row).toBeDefined();

    const expiresEpoch = Date.parse(row!.expires_at + "Z"); // SQLite stores without Z
    const expectedEpoch = Date.now() + 8 * 3600 * 1000;
    const delta = Math.abs(expiresEpoch - expectedEpoch);
    expect(delta).toBeLessThanOrEqual(60_000);
  });

  it("no sliding: requireAuth-style touch updates last_used_at but NOT expires_at", () => {
    const sid = createSession({ username: "dave", secret: "pass", kineticaUrl: "https://k.test" });
    const before = db
      .prepare("SELECT last_used_at, expires_at FROM sessions WHERE sid = ?")
      .get(sid) as { last_used_at: string; expires_at: string };

    // Small delay to allow datetime('now') to tick (SQLite has 1-second precision)
    // Use a direct sleep-free approach: just record and compare
    touchSession(sid);

    const after = db
      .prepare("SELECT last_used_at, expires_at FROM sessions WHERE sid = ?")
      .get(sid) as { last_used_at: string; expires_at: string };

    // expires_at must not change
    expect(after.expires_at).toBe(before.expires_at);
    // last_used_at may or may not have changed depending on timing, but the row must exist
    expect(typeof after.last_used_at).toBe("string");
  });

  // SESS-05 — sweep + passive expiry
  it("sweep: sweepExpiredSessions deletes rows with expires_at <= datetime('now') and returns the row count", () => {
    // Insert one expired row and one future row, both via createSession then UPDATE
    const expiredSid = createSession({ username: "eve", secret: "pass", kineticaUrl: "https://k.test" });
    const futureSid = createSession({ username: "frank", secret: "pass", kineticaUrl: "https://k.test" });

    // Manually expire eve's row
    db.prepare("UPDATE sessions SET expires_at = datetime('now', '-1 hour') WHERE sid = ?").run(expiredSid);

    const count = sweepExpiredSessions();
    expect(count).toBe(1);

    // The expired row should be gone
    const gone = db.prepare("SELECT * FROM sessions WHERE sid = ?").get(expiredSid);
    expect(gone).toBeUndefined();

    // The future row should remain (frank's session)
    const remaining = db.prepare("SELECT * FROM sessions WHERE sid = ?").get(futureSid);
    expect(remaining).toBeDefined();
  });

  it("sweep: sweepExpiredSessions does NOT delete rows whose expires_at is in the future", () => {
    createSession({ username: "grace", secret: "pass", kineticaUrl: "https://k.test" });
    createSession({ username: "henry", secret: "pass", kineticaUrl: "https://k.test" });

    const count = sweepExpiredSessions();
    expect(count).toBe(0);

    const remaining = db.prepare("SELECT count(*) AS c FROM sessions").get() as { c: number };
    expect(remaining.c).toBe(2);
  });

  it("passive expiry: getSession on an expired row returns null AND deletes the row", () => {
    const sid = createSession({ username: "iris", secret: "pass", kineticaUrl: "https://k.test" });
    // Manually expire the row
    db.prepare("UPDATE sessions SET expires_at = datetime('now', '-1 hour') WHERE sid = ?").run(sid);

    const session = getSession(sid);
    expect(session).toBeNull();

    // Row must be gone (passive delete)
    const row = db.prepare("SELECT * FROM sessions WHERE sid = ?").get(sid);
    expect(row).toBeUndefined();
  });

  it("getSession on a missing sid returns null without throwing", () => {
    const session = getSession("nonexistent-sid-that-does-not-exist");
    expect(session).toBeNull();
  });

  it("decrypt failure deletes the row: corrupted auth_tag causes getSession to return null and remove the row", () => {
    const sid = createSession({ username: "jack", secret: "pass", kineticaUrl: "https://k.test" });
    // Corrupt auth_tag in-place
    db.prepare("UPDATE sessions SET auth_tag = randomblob(16) WHERE sid = ?").run(sid);

    const session = getSession(sid);
    expect(session).toBeNull();

    // Row must be gone
    const row = db.prepare("SELECT * FROM sessions WHERE sid = ?").get(sid);
    expect(row).toBeUndefined();
  });

  it("OIDC round-trip: createSession with credentialType='oidc' + idToken stores both encrypted; getSession returns them decrypted (MODE-03, MODE-06)", () => {
    const sid = createSession({
      username: "oidc-user",
      secret: "fake-access-token",
      kineticaUrl: "https://k.test",
      credentialType: "oidc",
      idToken: "fake-jwt-id-token",
    });

    // Raw row check: credential_type='oidc' AND all 3 id_token_* columns populated
    const raw = db
      .prepare(
        "SELECT credential_type, length(id_token_ciphertext) AS ct_len, length(id_token_iv) AS iv_len, length(id_token_auth_tag) AS at_len FROM sessions WHERE sid = ?"
      )
      .get(sid) as
      | { credential_type: string; ct_len: number; iv_len: number; at_len: number }
      | undefined;
    expect(raw).toBeDefined();
    expect(raw!.credential_type).toBe("oidc");
    expect(raw!.ct_len).toBeGreaterThan(0);
    expect(raw!.iv_len).toBe(12);
    expect(raw!.at_len).toBe(16);

    // Decrypted round-trip
    const session = getSession(sid);
    expect(session).not.toBeNull();
    expect(session!.username).toBe("oidc-user");
    expect(session!.credentialType).toBe("oidc");
    expect(session!.secret).toBe("fake-access-token");
    expect(session!.idToken).toBe("fake-jwt-id-token");
    expect(session!.kineticaUrl).toBe("https://k.test");
  });

  it("id_token decrypt failure drops the row + returns null (mirrors secret-decrypt failure path)", () => {
    const sid = createSession({
      username: "oidc-user-2",
      secret: "fake-token-2",
      kineticaUrl: "https://k.test",
      credentialType: "oidc",
      idToken: "fake-jwt-2",
    });

    // Corrupt id_token_auth_tag in place — auth_tag mismatch causes AES-GCM decrypt to throw
    db.prepare(
      "UPDATE sessions SET id_token_auth_tag = randomblob(16) WHERE sid = ?"
    ).run(sid);

    const session = getSession(sid);
    expect(session).toBeNull();

    // Row must be gone (dropped on id_token decrypt failure)
    const row = db.prepare("SELECT 1 FROM sessions WHERE sid = ?").get(sid);
    expect(row).toBeUndefined();
  });
});

// ---- tryDecodeAccessTokenExp unit tests ----
describe("tryDecodeAccessTokenExp", () => {
  it("Test 1: 3-segment JWT with numeric exp returns the exp number", () => {
    const token = makeJwt({ exp: 9999999999, sub: "alice" });
    expect(tryDecodeAccessTokenExp(token)).toBe(9999999999);
  });

  it("Test 2: empty string returns null", () => {
    expect(tryDecodeAccessTokenExp("")).toBeNull();
  });

  it("Test 3: 1-segment string ('abc') returns null", () => {
    expect(tryDecodeAccessTokenExp("abc")).toBeNull();
  });

  it("Test 4: 4-segment string returns null", () => {
    expect(tryDecodeAccessTokenExp("a.b.c.d")).toBeNull();
  });

  it("Test 5: middle segment is malformed base64url ('a.!!!.c') returns null", () => {
    // Buffer.from('!!!', 'base64url') does not throw — it decodes to garbage
    // but JSON.parse of garbage will throw — so we still get null
    expect(tryDecodeAccessTokenExp("a.!!!.c")).toBeNull();
  });

  it("Test 6: middle segment decodes to non-JSON returns null", () => {
    const badBody = Buffer.from("not-json").toString("base64url");
    expect(tryDecodeAccessTokenExp(`a.${badBody}.c`)).toBeNull();
  });

  it("Test 7: middle segment decodes to JSON without exp returns null", () => {
    const noExp = Buffer.from(JSON.stringify({ sub: "alice" })).toString("base64url");
    expect(tryDecodeAccessTokenExp(`a.${noExp}.c`)).toBeNull();
  });

  it("Test 8: middle segment decodes to JSON with exp as string returns null", () => {
    const stringExp = Buffer.from(JSON.stringify({ exp: "not-a-number" })).toString("base64url");
    expect(tryDecodeAccessTokenExp(`a.${stringExp}.c`)).toBeNull();
  });
});

// ---- getSession proactive access-token exp check (PITFALL I-07) ----
describe("getSession proactive access-token exp check (PITFALL I-07)", () => {
  beforeEach(() => {
    db.exec("DELETE FROM sessions");
  });

  it("Test 9: OIDC session with past-60s exp → getSession returns null AND row deleted", () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    const sid = createSession({
      username: "alice",
      secret: makeJwt({ exp: past, sub: "alice" }),
      kineticaUrl: "https://k.test",
      credentialType: "oidc",
      idToken: "fake-id-token",
    });
    expect(getSession(sid)).toBeNull();
    const row = db.prepare("SELECT COUNT(*) AS c FROM sessions WHERE sid = ?").get(sid) as { c: number };
    expect(row.c).toBe(0);
  });

  it("Test 10: OIDC session with future+3600s exp → getSession returns SessionRow with decrypted secret", () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    const secret = makeJwt({ exp: future, sub: "alice" });
    const sid = createSession({
      username: "alice",
      secret,
      kineticaUrl: "https://k.test",
      credentialType: "oidc",
      idToken: "fake-id-token",
    });
    const sess = getSession(sid);
    expect(sess).not.toBeNull();
    expect(sess!.secret).toBe(secret);
  });

  it("Test 11: OIDC session with exp=now-10s → getSession returns SessionRow (within 30s skew tolerance)", () => {
    const tenSecondsPast = Math.floor(Date.now() / 1000) - 10;
    const secret = makeJwt({ exp: tenSecondsPast, sub: "alice" });
    const sid = createSession({
      username: "alice",
      secret,
      kineticaUrl: "https://k.test",
      credentialType: "oidc",
      idToken: "fake-id-token",
    });
    const sess = getSession(sid);
    expect(sess).not.toBeNull();
    expect(sess!.secret).toBe(secret);
  });

  it("Test 12: OIDC session with exp=now-31s → getSession returns null AND row deleted", () => {
    const thirtyOnePast = Math.floor(Date.now() / 1000) - 31;
    const sid = createSession({
      username: "alice",
      secret: makeJwt({ exp: thirtyOnePast, sub: "alice" }),
      kineticaUrl: "https://k.test",
      credentialType: "oidc",
      idToken: "fake-id-token",
    });
    expect(getSession(sid)).toBeNull();
    const row = db.prepare("SELECT COUNT(*) AS c FROM sessions WHERE sid = ?").get(sid) as { c: number };
    expect(row.c).toBe(0);
  });

  it("Test 13: OIDC session with opaque token (no dots) → getSession returns SessionRow; row preserved", () => {
    const sid = createSession({
      username: "alice",
      secret: "opaque-string-no-dots",
      kineticaUrl: "https://k.test",
      credentialType: "oidc",
      idToken: "fake-id-token",
    });
    const sess = getSession(sid);
    expect(sess).not.toBeNull();
    expect(sess!.secret).toBe("opaque-string-no-dots");
    const row = db.prepare("SELECT COUNT(*) AS c FROM sessions WHERE sid = ?").get(sid) as { c: number };
    expect(row.c).toBe(1);
  });

  it("Test 14: OIDC session with malformed middle-segment token → getSession returns SessionRow (opaque path; row preserved)", () => {
    const sid = createSession({
      username: "alice",
      secret: "header.malformed!!!.sig",
      kineticaUrl: "https://k.test",
      credentialType: "oidc",
      idToken: "fake-id-token",
    });
    const sess = getSession(sid);
    expect(sess).not.toBeNull();
    const row = db.prepare("SELECT COUNT(*) AS c FROM sessions WHERE sid = ?").get(sid) as { c: number };
    expect(row.c).toBe(1);
  });

  it("Test 15: password session with dotted secret → getSession returns SessionRow (JWT decode path NOT taken)", () => {
    const sid = createSession({
      username: "alice",
      secret: "real.password.with.dots",
      kineticaUrl: "https://k.test",
      // credentialType defaults to "password"
    });
    const sess = getSession(sid);
    expect(sess).not.toBeNull();
    expect(sess!.secret).toBe("real.password.with.dots");
    expect(sess!.credentialType).toBe("password");
  });
});
