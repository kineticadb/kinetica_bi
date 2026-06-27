// Phase 7 (UX-08 / D-3): hoisted openid-client mock so OIDC-mode tests can
// drive createApp() through initOidcClient() without hitting a real IdP.
// Mirrors auth.oidc.spec.ts:1-57 verbatim. The mock is harmless in
// password-mode tests because initOidcClient() is skipped when authMode==='password'.
import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const CLOCK_TOLERANCE = Symbol("mock.clock_tolerance");
  const makeTokenSet = (
    claims: Record<string, unknown> = { sub: "u1", preferred_username: "alice" }
  ) => ({
    access_token: "mock.access.token",
    id_token: "mock.id.token",
    token_type: "Bearer",
    expires_in: 3600,
    claims: () => claims,
  });
  const tokenSet = makeTokenSet();
  const client: Record<string | symbol, unknown> = {
    authorizationUrl: vi
      .fn()
      .mockReturnValue("https://idp.example.com/authorize?mock=1&state=stub"),
    callback: vi.fn().mockResolvedValue(tokenSet),
  };
  const issuer = {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    Client: vi.fn().mockImplementation(function (_metadata: unknown) {
      return client;
    }),
    metadata: { issuer: "https://idp.example.com", jwks_uri: "https://idp.example.com/jwks" },
  };
  const Issuer = { discover: vi.fn().mockResolvedValue(issuer) };
  class OPError extends Error {
    error: string;
    error_description?: string;
    constructor(error: string, desc?: string) {
      super(error);
      this.name = "OPError";
      this.error = error;
      this.error_description = desc;
    }
  }
  class RPError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "RPError";
    }
  }
  return { CLOCK_TOLERANCE, makeTokenSet, tokenSet, client, issuer, Issuer, OPError, RPError };
});

vi.mock("openid-client", () => ({
  Issuer: mocks.Issuer,
  custom: { clock_tolerance: mocks.CLOCK_TOLERANCE },
  errors: { OPError: mocks.OPError, RPError: mocks.RPError },
}));

import jwt from "jsonwebtoken";
import { buildTestApp } from "./helpers/app";
import { db } from "../src/db";
import { createSession } from "../src/sessionStore";
import { createAdminSession } from "./helpers/db";
import { resetOidcClientForTests } from "../src/oidc";
import { mockKineticaLoginOK } from "./setup";

// JWT helper for OIDC session seeding (decode-only; sig unused).
const makeJwt = (payload: Record<string, unknown>): string => {
  const header = Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
};

// Seed an OIDC session row directly + forge a kbi_session cookie for it.
// Mirrors what /oidc/callback does, minus the IdP token exchange.
const seedOidcSession = (accessToken: string, username = "alice") => {
  const AUTH_SECRET = process.env.AUTH_SECRET!;
  const KINETICA_URL = process.env.KINETICA_URL!;
  const sid = createSession({
    username,
    secret: accessToken,
    kineticaUrl: KINETICA_URL,
    credentialType: "oidc",
    idToken: makeJwt({ sub: username, exp: Math.floor(Date.now() / 1000) + 3600 }),
  });
  const token = jwt.sign({ sub: username, sid, v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
  return { sid, cookie: `kbi_session=${token}` };
};

// Phase 7: env stub for OIDC-mode tests. Mirrors auth.oidc.spec.ts:63-69.
const stubOidcEnv = () => {
  vi.stubEnv("AUTH_MODE", "oidc");
  vi.stubEnv("AUTH_OIDC_ISSUER_URL", "https://idp.example.com");
  vi.stubEnv("AUTH_OIDC_CLIENT_ID", "kinetica-bi");
  vi.stubEnv("AUTH_OIDC_CLIENT_SECRET", "secret");
  vi.stubEnv("AUTH_OIDC_REDIRECT_URI", "https://bi.example.com/api/auth/oidc/callback");
};

const ORIGINAL_KINETICA_URL = process.env.KINETICA_URL;

beforeEach(() => {
  db.exec("DELETE FROM sessions");
  process.env.KINETICA_URL = ORIGINAL_KINETICA_URL;
  // Phase 7: reset OIDC singleton so each test re-runs initOidcClient() from scratch.
  resetOidcClientForTests();
  // Reset call counts AND queued onces on mocks (mockClear does not clear queued onces).
  // Then re-establish the default callback resolution so tests that don't queue a Once
  // still get a successful tokenSet. Mirrors auth.oidc.spec.ts:75-92.
  (mocks.client.authorizationUrl as ReturnType<typeof vi.fn>).mockClear();
  (mocks.client.callback as ReturnType<typeof vi.fn>).mockReset();
  (mocks.client.callback as ReturnType<typeof vi.fn>).mockResolvedValue(mocks.tokenSet);
  (mocks.issuer.Client as ReturnType<typeof vi.fn>).mockImplementation(function (
    _metadata: unknown
  ) {
    return mocks.client;
  });
  (mocks.Issuer.discover as ReturnType<typeof vi.fn>).mockResolvedValue(mocks.issuer);
});

afterEach(() => {
  // Phase 7: ensure password-mode tests don't see stubbed AUTH_MODE from a prior OIDC test.
  vi.unstubAllEnvs();
});

afterAll(() => {
  process.env.KINETICA_URL = ORIGINAL_KINETICA_URL;
});

describe("auth routes (SESS-03)", () => {
  it("login writes a sessions row with username and kinetica_url stamped from env", async () => {
    mockKineticaLoginOK();
    const agent = await buildTestApp();
    const res = await agent
      .post("/api/auth/login")
      .send({ username: "alice", password: "hunter2" });
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe("alice");
    const setCookie = res.headers["set-cookie"] as string | string[];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join(";") : setCookie;
    expect(cookieStr).toContain("kbi_session=");
    const rows = db
      .prepare(
        "SELECT username, kinetica_url, length(ciphertext) AS ct, length(iv) AS iv, length(auth_tag) AS at FROM sessions"
      )
      .all() as Array<{ username: string; kinetica_url: string; ct: number; iv: number; at: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].username).toBe("alice");
    expect(rows[0].kinetica_url).toBe(process.env.KINETICA_URL);
    expect(rows[0].ct).toBeGreaterThan(0);
    expect(rows[0].iv).toBe(12);
    expect(rows[0].at).toBe(16);
  });

  it("logout deletes row: POST /api/auth/logout removes the sessions row matching the cookie sid", async () => {
    mockKineticaLoginOK();
    const agent = await buildTestApp();
    const loginRes = await agent
      .post("/api/auth/login")
      .send({ username: "alice", password: "hunter2" });
    expect(loginRes.status).toBe(200);
    const cookieHeader = loginRes.headers["set-cookie"] as string[];
    const cookie = cookieHeader[0].split(";")[0]; // "kbi_session=..."

    const logoutRes = await agent
      .post("/api/auth/logout")
      .set("Cookie", cookie);
    expect(logoutRes.status).toBe(204);

    const remaining = db
      .prepare("SELECT COUNT(*) AS c FROM sessions")
      .get() as { c: number };
    expect(remaining.c).toBe(0);
  });

  it("logout deletes row: replaying the old cookie after logout returns 401 + REAUTH_REQUIRED", async () => {
    mockKineticaLoginOK();
    const agent = await buildTestApp();
    const loginRes = await agent
      .post("/api/auth/login")
      .send({ username: "alice", password: "hunter2" });
    const cookieHeader = loginRes.headers["set-cookie"] as string[];
    const cookie = cookieHeader[0].split(";")[0];

    await agent.post("/api/auth/logout").set("Cookie", cookie);

    const meRes = await agent.get("/api/auth/me").set("Cookie", cookie);
    expect(meRes.status).toBe(401);
    expect(meRes.body).toEqual({
      error: "Not authenticated.",
      code: "REAUTH_REQUIRED",
    });
  });

  it("logout best-effort: malformed cookie still gets cleared and returns 204 (no crash)", async () => {
    const agent = await buildTestApp();
    const res = await agent
      .post("/api/auth/logout")
      .set("Cookie", "kbi_session=garbage.not.a.jwt");
    expect(res.status).toBe(204);
    const setCookie = res.headers["set-cookie"] as string | string[];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join(";") : setCookie ?? "";
    expect(cookieStr).toContain("kbi_session=");
  });

  it("logout best-effort: missing cookie still returns 204 (no crash)", async () => {
    const agent = await buildTestApp();
    const res = await agent.post("/api/auth/logout");
    expect(res.status).toBe(204);
    // clearSessionCookie is always called, even with no cookie
    const setCookie = res.headers["set-cookie"] as string | string[];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join(";") : setCookie ?? "";
    expect(cookieStr).toContain("kbi_session=");
  });

  it("me after delete: GET /api/auth/me returns 401 after sqlite3 DELETE FROM sessions out-of-band", async () => {
    mockKineticaLoginOK();
    const agent = await buildTestApp();
    const loginRes = await agent
      .post("/api/auth/login")
      .send({ username: "alice", password: "hunter2" });
    const cookieHeader = loginRes.headers["set-cookie"] as string[];
    const cookie = cookieHeader[0].split(";")[0];

    // Out-of-band delete (simulates the "migration trap" from RESEARCH Anti-Patterns)
    db.exec("DELETE FROM sessions");

    const meRes = await agent.get("/api/auth/me").set("Cookie", cookie);
    expect(meRes.status).toBe(401);
    expect(meRes.body).toEqual({
      error: "Not authenticated.",
      code: "REAUTH_REQUIRED",
    });
  });

  it("me after kinetica_url change: returns 401 + REAUTH and row is deleted", async () => {
    mockKineticaLoginOK();
    const agent = await buildTestApp();
    const loginRes = await agent
      .post("/api/auth/login")
      .send({ username: "alice", password: "hunter2" });
    const cookieHeader = loginRes.headers["set-cookie"] as string[];
    const cookie = cookieHeader[0].split(";")[0];

    const origUrl = process.env.KINETICA_URL;
    process.env.KINETICA_URL = "https://different.test";
    try {
      const meRes = await agent.get("/api/auth/me").set("Cookie", cookie);
      expect(meRes.status).toBe(401);
      expect(meRes.body).toEqual({
        error: "Not authenticated.",
        code: "REAUTH_REQUIRED",
      });
      const remaining = db
        .prepare("SELECT COUNT(*) AS c FROM sessions")
        .get() as { c: number };
      expect(remaining.c).toBe(0);
    } finally {
      process.env.KINETICA_URL = origUrl;
    }
  });
});

// Plan 06-04 Task 2: Logout symmetry — OIDC mode (SC4, UX-07).
// CONTEXT.md: "POST /api/auth/logout (index.ts:153-161) is already correct... no
// end_session_endpoint call." This describe block is verify-only — no production code change.
describe("logout symmetry — OIDC mode (SC4, UX-07)", () => {
  it("OIDC logout deletes session row + clears kbi_session cookie", async () => {
    const accessToken = makeJwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: "alice",
    });
    const { sid, cookie } = seedOidcSession(accessToken);

    const agent = await buildTestApp();
    const res = await agent.post("/api/auth/logout").set("Cookie", cookie);
    expect(res.status).toBe(204);

    // Row deleted
    const rowCount = (
      db
        .prepare("SELECT COUNT(*) AS c FROM sessions WHERE sid = ?")
        .get(sid) as { c: number }
    ).c;
    expect(rowCount).toBe(0);

    // kbi_session cookie cleared (Express clearCookie emits an empty value with epoch expiry)
    const setCookie = res.headers["set-cookie"] as string | string[];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join(";") : setCookie;
    expect(cookieStr).toContain("kbi_session=");
    expect(cookieStr).toMatch(/Expires=Thu, 01 Jan 1970|kbi_session=;/);
  });

  it("logout response shape is identical in password mode and OIDC mode", async () => {
    // Password mode logout
    mockKineticaLoginOK();
    const agentPw = await buildTestApp();
    const loginRes = await agentPw
      .post("/api/auth/login")
      .send({ username: "alice", password: "hunter2" });
    const pwCookie = (loginRes.headers["set-cookie"] as string[])[0].split(";")[0];
    const pwLogout = await agentPw
      .post("/api/auth/logout")
      .set("Cookie", pwCookie);

    // Reset and seed an OIDC session in the same DB
    db.exec("DELETE FROM sessions");
    const accessToken = makeJwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: "alice",
    });
    const { cookie: oidcCookie } = seedOidcSession(accessToken);
    const agentOidc = await buildTestApp();
    const oidcLogout = await agentOidc
      .post("/api/auth/logout")
      .set("Cookie", oidcCookie);

    // Same status
    expect(pwLogout.status).toBe(204);
    expect(oidcLogout.status).toBe(204);

    // Same body
    expect(pwLogout.body).toEqual(oidcLogout.body);
    expect(pwLogout.text).toBe(oidcLogout.text);

    // Same Set-Cookie clearing form (modulo Expires date string)
    const pwClear = (pwLogout.headers["set-cookie"] as string[])[0];
    const oidcClear = (oidcLogout.headers["set-cookie"] as string[])[0];
    const normalize = (s: string) => s.replace(/Expires=[^;]+/, "Expires=X");
    expect(normalize(pwClear)).toBe(normalize(oidcClear));
  });

  it("logout never calls IdP end_session_endpoint (UX-07: user remains logged in at IdP)", async () => {
    const accessToken = makeJwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: "alice",
    });
    const { cookie } = seedOidcSession(accessToken);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const agent = await buildTestApp();
    const res = await agent.post("/api/auth/logout").set("Cookie", cookie);
    expect(res.status).toBe(204);

    // Logout is purely local — no outbound network call (no end_session_endpoint).
    // Filter out any /version boot probe (Plan 06-03) which fires at createApp time, not on logout.
    const logoutCalls = fetchMock.mock.calls.filter(
      (c) => !String(c[0]).endsWith("/version")
    );
    expect(logoutCalls.length).toBe(0);
  });

  it("OIDC logout is idempotent: second logout with cleared cookie returns 204", async () => {
    const accessToken = makeJwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: "alice",
    });
    const { cookie } = seedOidcSession(accessToken);
    const agent = await buildTestApp();

    const first = await agent.post("/api/auth/logout").set("Cookie", cookie);
    expect(first.status).toBe(204);

    const second = await agent.post("/api/auth/logout").set("Cookie", cookie);
    expect(second.status).toBe(204);
  });
});

// Phase 7 UX-08 / D-3: /api/auth/me must include authMode top-level field.
describe("GET /api/auth/me — authMode field (UX-08)", () => {
  it("returns authMode='password' in password mode for an authenticated session", async () => {
    mockKineticaLoginOK();
    const agent = await buildTestApp();
    const loginRes = await agent
      .post("/api/auth/login")
      .send({ username: "alice", password: "hunter2" });
    expect(loginRes.status).toBe(200);
    const cookieHeader = loginRes.headers["set-cookie"] as string[];
    const cookie = cookieHeader[0].split(";")[0];

    const meRes = await agent.get("/api/auth/me").set("Cookie", cookie);
    expect(meRes.status).toBe(200);
    expect(meRes.body).toEqual({ user: { username: "alice" }, authMode: "password", ttlKeepaliveLeadMinutes: 1, maxCombinationViewsPerTable: 10 });
  });

  it("returns authMode='oidc' in oidc mode for an authenticated session", async () => {
    stubOidcEnv();
    const accessToken = makeJwt({ sub: "alice", exp: Math.floor(Date.now() / 1000) + 3600 });
    const { cookie } = seedOidcSession(accessToken);

    const agent = await buildTestApp();
    const meRes = await agent.get("/api/auth/me").set("Cookie", cookie);
    expect(meRes.status).toBe(200);
    expect(meRes.body).toEqual({ user: { username: "alice" }, authMode: "oidc", ttlKeepaliveLeadMinutes: 1, maxCombinationViewsPerTable: 10 });
  });

  it("returns 401 + REAUTH_REQUIRED with no authMode field in password mode (no session)", async () => {
    const agent = await buildTestApp();
    const meRes = await agent.get("/api/auth/me");
    expect(meRes.status).toBe(401);
    expect(meRes.body).toEqual({ error: "Not authenticated.", code: "REAUTH_REQUIRED" });
    expect(meRes.body.authMode).toBeUndefined();
  });

  it("returns 401 + REAUTH_REQUIRED with no authMode field in oidc mode (no session)", async () => {
    stubOidcEnv();
    const agent = await buildTestApp();
    const meRes = await agent.get("/api/auth/me");
    expect(meRes.status).toBe(401);
    expect(meRes.body).toEqual({ error: "Not authenticated.", code: "REAUTH_REQUIRED" });
    expect(meRes.body.authMode).toBeUndefined();
  });

  it("TTL_KEEPALIVE_LEAD_MINUTES=3 surfaces as ttlKeepaliveLeadMinutes: 3 on /api/me (Phase 74 SETTINGS-V115-03)", async () => {
    vi.stubEnv("TTL_KEEPALIVE_LEAD_MINUTES", "3");
    mockKineticaLoginOK();
    const agent = await buildTestApp();
    const loginRes = await agent
      .post("/api/auth/login")
      .send({ username: "alice", password: "hunter2" });
    expect(loginRes.status).toBe(200);
    const cookieHeader = loginRes.headers["set-cookie"] as string[];
    const cookie = cookieHeader[0].split(";")[0];

    const meRes = await agent.get("/api/auth/me").set("Cookie", cookie);
    expect(meRes.status).toBe(200);
    expect(meRes.body.ttlKeepaliveLeadMinutes).toBe(3);
    // env var is restored by the global afterEach vi.unstubAllEnvs()
  });

  it("MAX_COMBINATION_VIEWS_PER_TABLE=4 surfaces as maxCombinationViewsPerTable: 4 on /api/me (Phase 90 COMBO-V118-03)", async () => {
    vi.stubEnv("MAX_COMBINATION_VIEWS_PER_TABLE", "4");
    mockKineticaLoginOK();
    const agent = await buildTestApp();
    const loginRes = await agent
      .post("/api/auth/login")
      .send({ username: "alice", password: "hunter2" });
    expect(loginRes.status).toBe(200);
    const cookieHeader = loginRes.headers["set-cookie"] as string[];
    const cookie = cookieHeader[0].split(";")[0];

    const meRes = await agent.get("/api/auth/me").set("Cookie", cookie);
    expect(meRes.status).toBe(200);
    expect(meRes.body.maxCombinationViewsPerTable).toBe(4);
    // env var is restored by the global afterEach vi.unstubAllEnvs()
  });

  it("MAX_COMBINATION_VIEWS_PER_TABLE=4 surfaces as maxCombinationViewsPerTable: 4 on /api/me in oidc mode (Phase 90 COMBO-V118-03)", async () => {
    vi.stubEnv("MAX_COMBINATION_VIEWS_PER_TABLE", "4");
    stubOidcEnv();
    const accessToken = makeJwt({ sub: "alice", exp: Math.floor(Date.now() / 1000) + 3600 });
    const { cookie } = seedOidcSession(accessToken);

    const agent = await buildTestApp();
    const meRes = await agent.get("/api/auth/me").set("Cookie", cookie);
    expect(meRes.status).toBe(200);
    expect(meRes.body.maxCombinationViewsPerTable).toBe(4);
    // env var is restored by the global afterEach vi.unstubAllEnvs()
  });
});
