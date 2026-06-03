import { describe, it, expect, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import { requireAuth, clearSessionCookie } from "../src/auth";
import { createSession } from "../src/sessionStore";
import { db } from "../src/db";

const AUTH_SECRET = process.env.AUTH_SECRET!;
const KINETICA_URL = process.env.KINETICA_URL!;

const REAUTH_BODY = { error: "Authentication required.", code: "REAUTH_REQUIRED" };

// Minimal req/res shims for unit testing requireAuth without a real HTTP server
const buildReq = (cookieValue?: string) =>
  ({
    cookies: cookieValue ? { kbi_session: cookieValue } : {},
  }) as unknown as import("../src/auth").AuthedRequest;

const buildRes = () => {
  const setCookies: string[] = [];
  const r: Record<string, unknown> = {
    _statusCode: 200,
    _body: undefined,
    _setCookies: setCookies,
  };
  r.status = (s: number) => {
    r._statusCode = s;
    return r;
  };
  r.json = (b: unknown) => {
    r._body = b;
    return r;
  };
  r.cookie = (...args: unknown[]) => {
    setCookies.push(String(args[0]) + "=set");
    return r;
  };
  r.clearCookie = (...args: unknown[]) => {
    setCookies.push(String(args[0]) + "=cleared");
    return r;
  };
  return r as unknown as import("express").Response & {
    _statusCode: number;
    _body: unknown;
    _setCookies: string[];
  };
};

// Helper: make a valid JWT for a sid
const makeToken = (payload: Record<string, unknown>, secret = AUTH_SECRET) =>
  jwt.sign(payload, secret, { expiresIn: "8h" });

// Table-driven coverage of the 9-step failure dispatch from RESEARCH §"Code Examples" Example 5.
describe("requireAuth failure-mode dispatch table", () => {
  beforeEach(() => {
    db.exec("DELETE FROM sessions");
    process.env.KINETICA_URL = KINETICA_URL;
  });

  it("Step 1: missing cookie → 401 + REAUTH_REQUIRED", () => {
    const req = buildReq();
    const res = buildRes();
    const next = { called: false };
    requireAuth(req, res, () => {
      next.called = true;
    });
    expect(res._statusCode).toBe(401);
    expect(res._body).toEqual(REAUTH_BODY);
    expect(next.called).toBe(false);
  });

  it("Step 2: invalid JWT signature → 401 + REAUTH_REQUIRED", () => {
    const token = makeToken({ sub: "alice", sid: "a".repeat(64), v: 1 }, "wrong-secret-abcdefgh");
    const req = buildReq(token);
    const res = buildRes();
    const next = { called: false };
    requireAuth(req, res, () => {
      next.called = true;
    });
    expect(res._statusCode).toBe(401);
    expect(res._body).toEqual(REAUTH_BODY);
    expect(next.called).toBe(false);
  });

  it("Step 3: missing v field (old cookie shape) → 401 + REAUTH_REQUIRED", () => {
    const token = makeToken({ sub: "alice" }); // old shape, no v
    const req = buildReq(token);
    const res = buildRes();
    const next = { called: false };
    requireAuth(req, res, () => {
      next.called = true;
    });
    expect(res._statusCode).toBe(401);
    expect(res._body).toEqual(REAUTH_BODY);
    expect(next.called).toBe(false);
  });

  it("Step 4: empty/missing sid → 401 + REAUTH_REQUIRED", () => {
    const token = makeToken({ sub: "alice", v: 1 }); // no sid
    const req = buildReq(token);
    const res = buildRes();
    const next = { called: false };
    requireAuth(req, res, () => {
      next.called = true;
    });
    expect(res._statusCode).toBe(401);
    expect(res._body).toEqual(REAUTH_BODY);
    expect(next.called).toBe(false);
  });

  it("Step 5: empty/missing sub → 401 + REAUTH_REQUIRED", () => {
    const token = makeToken({ sid: "a".repeat(64), v: 1 }); // no sub
    const req = buildReq(token);
    const res = buildRes();
    const next = { called: false };
    requireAuth(req, res, () => {
      next.called = true;
    });
    expect(res._statusCode).toBe(401);
    expect(res._body).toEqual(REAUTH_BODY);
    expect(next.called).toBe(false);
  });

  it("Step 6: row missing in sessions table → 401 + REAUTH_REQUIRED + clears cookie", () => {
    const fakeSid = "b".repeat(64);
    const token = makeToken({ sub: "alice", sid: fakeSid, v: 1 });
    const req = buildReq(token);
    const res = buildRes();
    const next = { called: false };
    // No row inserted — sessions table is empty
    requireAuth(req, res, () => {
      next.called = true;
    });
    expect(res._statusCode).toBe(401);
    expect(res._body).toEqual(REAUTH_BODY);
    expect(next.called).toBe(false);
    // clearCookie must have been called for kbi_session
    expect(res._setCookies.some((c) => c.includes("kbi_session=cleared"))).toBe(true);
  });

  it("Step 7: row expired → 401 + REAUTH_REQUIRED + deletes row + clears cookie", () => {
    const sid = createSession({ username: "alice", secret: "hunter2", kineticaUrl: KINETICA_URL });
    // Manually expire the row
    db.prepare("UPDATE sessions SET expires_at = datetime('now', '-1 hour') WHERE sid = ?").run(sid);
    const token = makeToken({ sub: "alice", sid, v: 1 });
    const req = buildReq(token);
    const res = buildRes();
    const next = { called: false };
    requireAuth(req, res, () => {
      next.called = true;
    });
    expect(res._statusCode).toBe(401);
    expect(res._body).toEqual(REAUTH_BODY);
    expect(next.called).toBe(false);
    // Row should be deleted (getSession handles passive expiry)
    const row = db.prepare("SELECT 1 FROM sessions WHERE sid = ?").get(sid);
    expect(row).toBeUndefined();
    // Cookie should be cleared
    expect(res._setCookies.some((c) => c.includes("kbi_session=cleared"))).toBe(true);
  });

  it("Step 8: kinetica_url mismatch with current env → 401 + REAUTH_REQUIRED + deletes row + clears cookie", () => {
    const sid = createSession({ username: "alice", secret: "hunter2", kineticaUrl: KINETICA_URL });
    const token = makeToken({ sub: "alice", sid, v: 1 });
    // Change the env to a different URL
    process.env.KINETICA_URL = "https://different.kinetica.test";
    const req = buildReq(token);
    const res = buildRes();
    const next = { called: false };
    requireAuth(req, res, () => {
      next.called = true;
    });
    process.env.KINETICA_URL = KINETICA_URL; // restore
    expect(res._statusCode).toBe(401);
    expect(res._body).toEqual(REAUTH_BODY);
    expect(next.called).toBe(false);
    // Row should be deleted
    const row = db.prepare("SELECT 1 FROM sessions WHERE sid = ?").get(sid);
    expect(row).toBeUndefined();
    // Cookie should be cleared
    expect(res._setCookies.some((c) => c.includes("kbi_session=cleared"))).toBe(true);
  });

  it("Step 9: AES-GCM decrypt failure (key rotated / row corrupted) → 401 + REAUTH_REQUIRED + deletes row + clears cookie", () => {
    const sid = createSession({ username: "alice", secret: "hunter2", kineticaUrl: KINETICA_URL });
    // Corrupt the auth_tag to trigger decrypt failure
    db.prepare("UPDATE sessions SET auth_tag = randomblob(16) WHERE sid = ?").run(sid);
    const token = makeToken({ sub: "alice", sid, v: 1 });
    const req = buildReq(token);
    const res = buildRes();
    const next = { called: false };
    requireAuth(req, res, () => {
      next.called = true;
    });
    expect(res._statusCode).toBe(401);
    expect(res._body).toEqual(REAUTH_BODY);
    expect(next.called).toBe(false);
    // Row should be deleted (getSession handles decrypt failure)
    const row = db.prepare("SELECT 1 FROM sessions WHERE sid = ?").get(sid);
    expect(row).toBeUndefined();
    // Cookie should be cleared
    expect(res._setCookies.some((c) => c.includes("kbi_session=cleared"))).toBe(true);
  });

  it("Step 10 (success): all checks pass → req.user populated with { sub, sid, credentialType, creds: { username, password, token } } and last_used_at touched", () => {
    const sid = createSession({ username: "alice", secret: "hunter2", kineticaUrl: KINETICA_URL });
    // Capture last_used_at before requireAuth
    const before = db
      .prepare("SELECT last_used_at FROM sessions WHERE sid = ?")
      .get(sid) as { last_used_at: string };
    const t1 = before.last_used_at;

    const token = makeToken({ sub: "alice", sid, v: 1 });
    const req = buildReq(token);
    const res = buildRes();
    const next = { called: false };
    requireAuth(req, res, () => {
      next.called = true;
    });
    expect(next.called).toBe(true);
    expect(res._statusCode).toBe(200); // untouched (next() was called, no response set)
    expect(req.user).toBeDefined();
    expect(req.user!.sub).toBe("alice");
    expect(req.user!.sid).toBe(sid);
    // NEW (v1.1 Phase 4): credentialType at top level of req.user
    expect(req.user!.credentialType).toBe("password");
    expect(req.user!.creds.username).toBe("alice");
    // password populated in password mode; preserved from v1.0 behavior
    expect(req.user!.creds.password).toBe("hunter2");
    // NEW (v1.1 Phase 4): token always present, empty string in password mode (never undefined)
    expect(req.user!.creds.token).toBe("");
    // last_used_at should be >= t1 after touch
    const after = db
      .prepare("SELECT last_used_at FROM sessions WHERE sid = ?")
      .get(sid) as { last_used_at: string };
    expect(after.last_used_at >= t1).toBe(true);
    // requestId must be a valid UUID (set by requireAuth after this plan)
    expect(req.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it("Step 10 success: two requireAuth invocations produce different requestId values", () => {
    const sid1 = createSession({ username: "alice", secret: "hunter2", kineticaUrl: KINETICA_URL });
    const sid2 = createSession({ username: "bob", secret: "secret99", kineticaUrl: KINETICA_URL });

    const token1 = makeToken({ sub: "alice", sid: sid1, v: 1 });
    const token2 = makeToken({ sub: "bob", sid: sid2, v: 1 });

    const req1 = buildReq(token1);
    const req2 = buildReq(token2);
    const res1 = buildRes();
    const res2 = buildRes();

    requireAuth(req1, res1, () => {});
    requireAuth(req2, res2, () => {});

    expect(req1.requestId).toBeDefined();
    expect(req2.requestId).toBeDefined();
    // requestIds must be unique — not a module-level constant
    expect(req1.requestId).not.toBe(req2.requestId);
  });
});
