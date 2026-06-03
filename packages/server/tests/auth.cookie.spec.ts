import { describe, it, expect, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import { issueSessionCookie, decodeAndVerifyJwt } from "../src/auth";
import { createSession, deleteSession } from "../src/sessionStore";
import { db } from "../src/db";

const AUTH_SECRET = process.env.AUTH_SECRET!;

// Minimal res shim for issueSessionCookie
const buildRes = () => {
  const cookies: Array<{ name: string; value: string; opts: Record<string, unknown> }> = [];
  const r: Record<string, unknown> = {
    _cookies: cookies,
  };
  r.cookie = (name: string, value: string, opts: Record<string, unknown>) => {
    cookies.push({ name, value, opts });
    return r;
  };
  return r as unknown as import("express").Response & {
    _cookies: typeof cookies;
  };
};

// Minimal req shim
const buildReq = (cookieValue?: string) =>
  ({
    cookies: cookieValue ? { kbi_session: cookieValue } : {},
  }) as unknown as import("express").Request;

describe("auth cookie shape (SESS-01, SESS-02)", () => {
  it("issueSessionCookie writes a JWT whose decoded payload is { sub, sid, v: 1, iat, exp }", () => {
    const res = buildRes();
    issueSessionCookie(res, "alice", "a".repeat(64));
    expect(res._cookies).toHaveLength(1);
    const [{ value: token }] = res._cookies;
    const decoded = jwt.verify(token, AUTH_SECRET) as Record<string, unknown>;
    // Exactly these keys: sub, sid, v, iat, exp
    const keys = Object.keys(decoded).sort();
    expect(keys).toEqual(["exp", "iat", "sid", "sub", "v"].sort());
    expect(decoded.sub).toBe("alice");
    expect(decoded.sid).toBe("a".repeat(64));
    expect(decoded.v).toBe(1);
    expect(typeof decoded.iat).toBe("number");
    expect(typeof decoded.exp).toBe("number");
  });

  it("no password in JWT: the decoded JWT payload does not contain the plaintext password substring", () => {
    const res = buildRes();
    issueSessionCookie(res, "alice", "b".repeat(64));
    const [{ value: token }] = res._cookies;
    // Decode without verify to inspect raw payload
    const raw = token.split(".")[1];
    const payload = Buffer.from(raw, "base64").toString("utf8");
    expect(payload).not.toContain("hunter2");
    expect(payload).not.toContain("password");
  });

  it("no password in JWT: the decoded JWT payload has no key named 'password'", () => {
    const res = buildRes();
    issueSessionCookie(res, "alice", "c".repeat(64));
    const [{ value: token }] = res._cookies;
    const decoded = jwt.verify(token, AUTH_SECRET) as Record<string, unknown>;
    expect("password" in decoded).toBe(false);
  });

  it("opaque sid: sid in JWT matches /^[0-9a-f]{64}$/ (256-bit hex)", () => {
    // Create a real sid-like value and verify issueSessionCookie puts it in JWT correctly
    const sid = "0123456789abcdef".repeat(4); // 64 hex chars
    const res = buildRes();
    issueSessionCookie(res, "alice", sid);
    const [{ value: token }] = res._cookies;
    const decoded = jwt.verify(token, AUTH_SECRET) as Record<string, unknown>;
    expect(typeof decoded.sid).toBe("string");
    expect((decoded.sid as string)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("opaque sid: sid is not derived from the username (different usernames produce statistically distinct sids)", () => {
    // This test verifies that sids are random (not username-derived)
    // We generate 10 sids via createSession and confirm uniqueness
    db.exec("DELETE FROM sessions");
    const sids = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const sid = createSession({ username: "alice", secret: "pw", kineticaUrl: "https://kinetica.test:9191" });
      sids.add(sid);
      deleteSession(sid);
    }
    expect(sids.size).toBe(10);
  });

  it("decodeAndVerifyJwt rejects an old-shape cookie (no v field) — returns null", () => {
    // Old shape: { sub: "alice" } — no v, no sid
    const oldToken = jwt.sign({ sub: "alice" }, AUTH_SECRET, { expiresIn: "8h" });
    const req = buildReq(oldToken);
    expect(decodeAndVerifyJwt(req)).toBeNull();
  });

  it("decodeAndVerifyJwt rejects a v !== 1 cookie — returns null", () => {
    const token = jwt.sign({ sub: "alice", sid: "a".repeat(64), v: 2 }, AUTH_SECRET, {
      expiresIn: "8h",
    });
    const req = buildReq(token);
    expect(decodeAndVerifyJwt(req)).toBeNull();
  });

  it("decodeAndVerifyJwt rejects a cookie missing sid — returns null", () => {
    const token = jwt.sign({ sub: "alice", v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
    const req = buildReq(token);
    expect(decodeAndVerifyJwt(req)).toBeNull();
  });

  it("decodeAndVerifyJwt rejects a cookie missing sub — returns null", () => {
    const token = jwt.sign({ sid: "a".repeat(64), v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
    const req = buildReq(token);
    expect(decodeAndVerifyJwt(req)).toBeNull();
  });

  it("decodeAndVerifyJwt rejects a tampered-signature cookie — returns null", () => {
    const token = jwt.sign(
      { sub: "alice", sid: "a".repeat(64), v: 1 },
      AUTH_SECRET,
      { expiresIn: "8h" }
    );
    // Flip one char in the signature portion
    const parts = token.split(".");
    parts[2] = parts[2].slice(0, -1) + (parts[2].endsWith("a") ? "b" : "a");
    const tamperedToken = parts.join(".");
    const req = buildReq(tamperedToken);
    expect(decodeAndVerifyJwt(req)).toBeNull();
  });

  it("decodeAndVerifyJwt returns null when no cookie is present at all", () => {
    const req = buildReq();
    expect(decodeAndVerifyJwt(req)).toBeNull();
  });
});
