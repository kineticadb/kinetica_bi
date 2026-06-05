/**
 * kinetica.creds.routes.spec.ts — End-to-end Bearer-vs-Basic via supertest (Plan 06-04).
 *
 * Verifies Phase 6 success criteria at the route level:
 *   - SC2: OIDC session cookie → outgoing Authorization: Bearer; password cookie → Basic
 *   - SC3: Past-exp OIDC token → 401 REAUTH; Kinetica never called (proactive check from 06-02)
 *   - SC5: auth_mode field appears in every per-call audit log line
 *
 * No production code is exercised that wasn't shipped by Plans 06-01, 06-02, 06-03.
 * Helper layer: kinetica.ts buildAuthHeader (Plan 06-01).
 * Proactive expiry: sessionStore.ts getSession (Plan 06-02).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import jwt from "jsonwebtoken";
import { buildTestApp } from "./helpers/app";
import { createSession } from "../src/sessionStore";
import { createAdminSession } from "./helpers/db";
import { db } from "../src/db";
import { mockKineticaLoginOK } from "./setup";

const AUTH_SECRET = process.env.AUTH_SECRET!;
const KINETICA_URL = process.env.KINETICA_URL!;

// Build a 3-segment JWT with a parseable exp claim (decode-only; sig unused).
const makeJwt = (payload: Record<string, unknown>): string => {
  const header = Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
};

// Seed an OIDC session row directly + forge a kbi_session cookie for it.
// Mirrors what /oidc/callback would do, minus the IdP token exchange.
const seedOidcSession = (accessToken: string, username = "alice") => {
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

const successKineticaBody = {
  status: "OK",
  data_str: JSON.stringify({
    json_encoded_response: JSON.stringify({ column_1: [1, 2] }),
  }),
};

const makeKineticaResponse = () =>
  new Response(JSON.stringify(successKineticaBody), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

// Parse fetchMock calls and find the Kinetica /execute/sql call (filtering out any
// /version probe call that fires at boot).
const findKineticaCall = (fetchMock: ReturnType<typeof vi.fn>) => {
  return fetchMock.mock.calls.find((c) => String(c[0]).includes("/execute/sql"));
};

describe("Helper credential branch end-to-end (Plan 06-04 — SC2, SC3, SC5)", () => {
  beforeEach(() => {
    db.exec("DELETE FROM sessions");
  });

  it("Test 1: OIDC session → Authorization: Bearer <access_token> (SC2)", async () => {
    const accessToken = makeJwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: "alice",
    });

    const fetchMock = vi.fn().mockResolvedValue(makeKineticaResponse());
    vi.stubGlobal("fetch", fetchMock);

    // Seed AFTER buildTestApp() so the Plan 08-01 boot-time AUTH_MODE-change wipe
    // (which runs in createApp() and deletes credential_type='oidc' rows when AUTH_MODE
    // defaults to 'password') doesn't drop our seeded row before the test request.
    const agent = await buildTestApp();
    const { cookie } = seedOidcSession(accessToken);
    const res = await agent
      .post("/api/sql")
      .set("Cookie", cookie)
      .send({ sql: "SELECT 1" });
    expect(res.status).toBe(200);

    const kineticaCall = findKineticaCall(fetchMock);
    expect(kineticaCall).toBeDefined();
    const init = kineticaCall![1] as RequestInit;
    const auth = (init.headers as Record<string, string>).Authorization;
    expect(auth).toBe(`Bearer ${accessToken}`);
    expect(auth.startsWith("Bearer ")).toBe(true);
    expect(auth).not.toContain("Basic");
  });

  it("Test 2: Password session → Authorization: Basic <b64(user:pass)> (SC2)", async () => {
    // Phase 1: login via password flow to get a real password-mode session cookie.
    mockKineticaLoginOK();
    const agent = await buildTestApp();
    const loginRes = await agent
      .post("/api/auth/login")
      .send({ username: "alice", password: "hunter2" });
    expect(loginRes.status).toBe(200);
    const cookie = (loginRes.headers["set-cookie"] as string[])[0].split(";")[0];

    // Phase 2: re-stub fetch to capture the /api/sql Kinetica call.
    const fetchMock = vi.fn().mockResolvedValue(makeKineticaResponse());
    vi.stubGlobal("fetch", fetchMock);

    const sqlRes = await agent
      .post("/api/sql")
      .set("Cookie", cookie)
      .send({ sql: "SELECT 1" });
    expect(sqlRes.status).toBe(200);

    const kineticaCall = findKineticaCall(fetchMock);
    expect(kineticaCall).toBeDefined();
    const init = kineticaCall![1] as RequestInit;
    const auth = (init.headers as Record<string, string>).Authorization;
    const expected = `Basic ${Buffer.from("alice:hunter2").toString("base64")}`;
    expect(auth).toBe(expected);
    expect(auth.startsWith("Basic ")).toBe(true);
    expect(auth).not.toContain("Bearer");
  });

  it("Test 3: OIDC call audit log line contains auth_mode='oidc' (SC5)", async () => {
    const accessToken = makeJwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: "alice",
    });

    const fetchMock = vi.fn().mockResolvedValue(makeKineticaResponse());
    vi.stubGlobal("fetch", fetchMock);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Seed AFTER buildTestApp() (Plan 08-01 boot wipe — see Test 1 for rationale).
    const agent = await buildTestApp();
    const { cookie } = seedOidcSession(accessToken);
    await agent.post("/api/sql").set("Cookie", cookie).send({ sql: "SELECT 1" });

    const auditLine = (logSpy.mock.calls as unknown[][])
      .map((c) => c[0])
      .filter((s): s is string => typeof s === "string")
      .map((s) => {
        try {
          return JSON.parse(s) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .find((o): o is Record<string, unknown> => o?.op === "SQL");
    expect(auditLine).toBeDefined();
    expect(auditLine!.auth_mode).toBe("oidc");
    expect(auditLine!.username).toBe("alice");
    expect(auditLine!.outcome).toBe("success");
  });

  it("Test 4: Password call audit log line contains auth_mode='password' (SC5)", async () => {
    mockKineticaLoginOK();
    const agent = await buildTestApp();
    const loginRes = await agent
      .post("/api/auth/login")
      .send({ username: "alice", password: "hunter2" });
    const cookie = (loginRes.headers["set-cookie"] as string[])[0].split(";")[0];

    const fetchMock = vi.fn().mockResolvedValue(makeKineticaResponse());
    vi.stubGlobal("fetch", fetchMock);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await agent.post("/api/sql").set("Cookie", cookie).send({ sql: "SELECT 1" });

    const auditLine = (logSpy.mock.calls as unknown[][])
      .map((c) => c[0])
      .filter((s): s is string => typeof s === "string")
      .map((s) => {
        try {
          return JSON.parse(s) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .find((o): o is Record<string, unknown> => o?.op === "SQL");
    expect(auditLine).toBeDefined();
    expect(auditLine!.auth_mode).toBe("password");
    expect(auditLine!.username).toBe("alice");
  });

  it("Test 5: OIDC session with past-exp access_token → 401 REAUTH; Kinetica never called (SC3)", async () => {
    const expiredToken = makeJwt({
      exp: Math.floor(Date.now() / 1000) - 60,
      sub: "alice",
    });
    const fetchMock = vi.fn().mockResolvedValue(makeKineticaResponse());
    vi.stubGlobal("fetch", fetchMock);

    // Seed AFTER buildTestApp() (Plan 08-01 boot wipe — see Test 1 for rationale).
    const agent = await buildTestApp();
    const { sid, cookie } = seedOidcSession(expiredToken);
    const res = await agent
      .post("/api/sql")
      .set("Cookie", cookie)
      .send({ sql: "SELECT 1" });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("REAUTH_REQUIRED");

    // The proactive check ran BEFORE the helper, so no Kinetica /execute/sql call happened.
    // (A boot-time /version probe may have fired — filter for /execute/sql specifically.)
    const kineticaCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/execute/sql")
    );
    expect(kineticaCalls.length).toBe(0);

    // The session row was deleted by the proactive check.
    const rowCount = (
      db
        .prepare("SELECT COUNT(*) AS c FROM sessions WHERE sid = ?")
        .get(sid) as { c: number }
    ).c;
    expect(rowCount).toBe(0);
  });

  it("Test 6: audit line never leaks the access token, password, or Authorization header (Phase 02-02 invariant)", async () => {
    const accessToken = makeJwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: "alice",
    });

    const fetchMock = vi.fn().mockResolvedValue(makeKineticaResponse());
    vi.stubGlobal("fetch", fetchMock);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Seed AFTER buildTestApp() (Plan 08-01 boot wipe — see Test 1 for rationale).
    const agent = await buildTestApp();
    const { cookie } = seedOidcSession(accessToken);
    await agent.post("/api/sql").set("Cookie", cookie).send({ sql: "SELECT 1" });

    const auditRaw = logSpy.mock.calls
      .map((c) => c[0])
      .filter((s): s is string => typeof s === "string")
      .find((s) => s.includes('"op":"SQL"'));
    expect(auditRaw).toBeDefined();
    // Negative assertions on the raw JSON line: secrets and Authorization header must
    // never appear (Phase 02-02 explicit-key enumeration discipline).
    expect(auditRaw).not.toContain(accessToken);
    expect(auditRaw).not.toContain("hunter2");
    expect(auditRaw).not.toContain("Authorization");
    expect(auditRaw).not.toContain("Bearer ");
    expect(auditRaw).not.toContain("Basic ");
  });
});
