/**
 * routes.quantile.spec.ts — Plan 38-03 supertest coverage.
 *
 * Covers POST /api/quantile for both AUTH_MODE variants (password + oidc),
 * satisfying SCHEMA-V17-06.
 *
 * AUTH_MODE-agnostic pattern: single spec file; dual describe blocks each
 * stubbing their own AUTH_MODE value. Does NOT add to TD-V16-TEST-ISOLATION.
 *
 * Mocks `openid-client` minimally so AUTH_MODE=oidc boot does not hit the
 * network (Issuer.discover). Mirrors routes.filter-materialize.spec.ts pattern.
 *
 * Kinetica response mocking: vi.stubGlobal("fetch", ...) returns the full
 * Kinetica HTTP envelope:
 *   { status: "OK", data_str: JSON.stringify({ json_encoded_response: JSON.stringify(<ntile-shape>) }) }
 * kineticaSql parses this and returns the NTILE columnar shape
 * { column_1, column_2 } which parseQuantileResponse then processes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import jwt from "jsonwebtoken";

// Hoisted mock so AUTH_MODE=oidc boot succeeds without network.
// Mirrors the verbatim pattern from routes.filter-materialize.spec.ts.
const mocks = vi.hoisted(() => {
  const CLOCK_TOLERANCE = Symbol("mock.clock_tolerance");
  const client: Record<string | symbol, unknown> = {
    authorizationUrl: vi.fn().mockReturnValue("https://idp.example.com/authorize?mock=1"),
    callback: vi.fn(),
  };
  function Issuer(this: { metadata: unknown; Client: unknown }, _meta: unknown) {
    this.metadata = { issuer: "https://idp.example.com", jwks_uri: "https://idp.example.com/jwks" };
    this.Client = function (_clientMeta: unknown) {
      return client;
    };
  }
  (Issuer as unknown as { discover: ReturnType<typeof vi.fn> }).discover = vi
    .fn()
    .mockResolvedValue({
      metadata: { issuer: "https://idp.example.com", jwks_uri: "https://idp.example.com/jwks" },
      Client: function (_clientMeta: unknown) {
        return client;
      },
    });
  class OPError extends Error {
    error: string;
    constructor(error: string) {
      super(error);
      this.name = "OPError";
      this.error = error;
    }
  }
  class RPError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "RPError";
    }
  }
  return { CLOCK_TOLERANCE, client, Issuer, OPError, RPError };
});

vi.mock("openid-client", () => ({
  Issuer: mocks.Issuer,
  custom: { clock_tolerance: mocks.CLOCK_TOLERANCE },
  errors: { OPError: mocks.OPError, RPError: mocks.RPError },
}));

import { buildTestApp } from "./helpers/app";
import { createSession } from "../src/sessionStore";
import { resetOidcClientForTests } from "../src/oidc";
import { db } from "../src/db";

const AUTH_SECRET = process.env.AUTH_SECRET!;
const KINETICA_URL = process.env.KINETICA_URL!;
const SESSION_PASSWORD = "alice-pw-secret";
const FAKE_OIDC_ACCESS_TOKEN = "fake-oidc-access-token";

// Build a synthetic NTILE columnar response that kineticaSql will extract
// and pass to parseQuantileResponse.
const makeNtileBody = (column_2: number[]) =>
  JSON.stringify({
    status: "OK",
    data_str: JSON.stringify({
      json_encoded_response: JSON.stringify({
        column_1: column_2.map((_, i) => i + 1),
        column_2,
        column_headers: ["bucket", "boundary"],
        column_datatypes: ["long", "float"],
      }),
    }),
  });

const makeSessionCookie = (username = "alice") => {
  const sid = createSession({ username, secret: SESSION_PASSWORD, kineticaUrl: KINETICA_URL });
  const token = jwt.sign({ sub: username, sid, v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
  return { sid, cookie: `kbi_session=${token}` };
};

const makeJwt = (payload: Record<string, unknown>): string => {
  const header = Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
};

const seedOidcSession = (username = "john.doe@kinetica.com", accessToken?: string) => {
  const token = accessToken ?? FAKE_OIDC_ACCESS_TOKEN;
  const sid = createSession({
    username,
    secret: token,
    kineticaUrl: KINETICA_URL,
    credentialType: "oidc",
    idToken: makeJwt({ sub: username, exp: Math.floor(Date.now() / 1000) + 3600 }),
  });
  const jwtCookie = jwt.sign({ sub: username, sid, v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
  return { sid, cookie: `kbi_session=${jwtCookie}`, token };
};

const cleanFixtures = () => {
  db.exec("DELETE FROM sessions");
  db.exec("DELETE FROM dashboard_table_views");
  db.exec("DELETE FROM dashboard_tables");
  db.exec("DELETE FROM tables");
  db.exec("DELETE FROM dashboards");
};

// ===========================================================================
// AUTH_MODE=password
// ===========================================================================

describe("POST /api/quantile — AUTH_MODE=password", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_MODE", "password");
    cleanFixtures();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("happy path: returns { breaks: number[] } of length n-1 for valid body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(makeNtileBody([-100, 5.7, 7.7, 10.1, 15.2]), { status: 200 })
      )
    );
    const agent = await buildTestApp();
    const { cookie } = makeSessionCookie();
    const response = await agent
      .post("/api/quantile")
      .set("Cookie", cookie)
      .send({ schema: "demo", table: "nyctaxi", column: "fare_amount", n: 5 });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ breaks: [5.7, 7.7, 10.1, 15.2] });
  });

  it("audit log entry uses op: \"QUANTILE\" and route: \"POST /api/quantile\"", async () => {
    const logSpy = vi.spyOn(console, "log");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(makeNtileBody([0, 10]), { status: 200 })
      )
    );
    const agent = await buildTestApp();
    const { cookie } = makeSessionCookie();
    await agent
      .post("/api/quantile")
      .set("Cookie", cookie)
      .send({ schema: "demo", table: "t", column: "c", n: 2 });
    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    const quantileLine = lines.find((s) => s.includes('"op":"QUANTILE"'));
    expect(quantileLine).toBeDefined();
    expect(quantileLine).toContain('"route":"POST /api/quantile"');
  });

  it("n=1 returns 400 with n-bounds error", async () => {
    const agent = await buildTestApp();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/quantile")
      .set("Cookie", cookie)
      .send({ schema: "demo", table: "t", column: "c", n: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/n must be integer in \[2, 256\]/i);
  });

  it("n=257 returns 400", async () => {
    const agent = await buildTestApp();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/quantile")
      .set("Cookie", cookie)
      .send({ schema: "demo", table: "t", column: "c", n: 257 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/n must be integer in \[2, 256\]/i);
  });

  it("n=1.5 (non-integer) returns 400", async () => {
    const agent = await buildTestApp();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/quantile")
      .set("Cookie", cookie)
      .send({ schema: "demo", table: "t", column: "c", n: 1.5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/n must be integer in \[2, 256\]/i);
  });

  it("n omitted returns 400", async () => {
    const agent = await buildTestApp();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/quantile")
      .set("Cookie", cookie)
      .send({ schema: "demo", table: "t", column: "c" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/n must be integer in \[2, 256\]/i);
  });

  // Phase 44 follow-up: empty schema is now VALID (used by dynamic-view-bound
  // class-break layers to query a bare materialized-view identifier). The SQL
  // builder emits `FROM <table>` directly when schema === "". The validation
  // rejection now only fires for table / column.
  it("empty schema is accepted (request bypasses validation; SQL emits unprefixed FROM)", async () => {
    const agent = await buildTestApp();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/quantile")
      .set("Cookie", cookie)
      .send({ schema: "", table: "t", column: "c", n: 5 });
    // Should NOT be 400 (validation passes); will be 502 / 200 depending on
    // whether the underlying Kinetica fetch is mocked in this suite.
    expect(res.status).not.toBe(400);
  });

  it("empty table returns 400", async () => {
    const agent = await buildTestApp();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/quantile")
      .set("Cookie", cookie)
      .send({ schema: "demo", table: "", column: "c", n: 5 });
    expect(res.status).toBe(400);
  });

  it("empty column returns 400", async () => {
    const agent = await buildTestApp();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/quantile")
      .set("Cookie", cookie)
      .send({ schema: "demo", table: "t", column: "", n: 5 });
    expect(res.status).toBe(400);
  });

  it("Kinetica 403 → KineticaPermissionError → 403", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("denied", { status: 403 })));
    const agent = await buildTestApp();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/quantile")
      .set("Cookie", cookie)
      .send({ schema: "demo", table: "nyctaxi", column: "fare_amount", n: 5 });
    expect(res.status).toBe(403);
    expect(res.body.error).toBeTruthy();
  });

  it("Kinetica 500 → KineticaUpstreamError → 502", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("internal error", { status: 500 })));
    const agent = await buildTestApp();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/quantile")
      .set("Cookie", cookie)
      .send({ schema: "demo", table: "nyctaxi", column: "fare_amount", n: 5 });
    expect(res.status).toBe(502);
    expect(res.body.error).toBeTruthy();
  });

  it("no session cookie returns 401 (requireAuth)", async () => {
    const agent = await buildTestApp();
    const res = await agent
      .post("/api/quantile")
      .send({ schema: "demo", table: "t", column: "c", n: 5 });
    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// AUTH_MODE=oidc
// ===========================================================================

describe("POST /api/quantile — AUTH_MODE=oidc", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_MODE", "oidc");
    vi.stubEnv("AUTH_OIDC_ISSUER_URL", "https://idp.example.com");
    vi.stubEnv("AUTH_OIDC_CLIENT_ID", "kinetica-bi");
    vi.stubEnv("AUTH_OIDC_CLIENT_SECRET", "secret");
    vi.stubEnv("AUTH_OIDC_REDIRECT_URI", "https://bi.example.com/api/auth/oidc/callback");
    cleanFixtures();
    resetOidcClientForTests();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("OIDC happy path: returns { breaks } + auth header sent as Bearer <access_token>", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(makeNtileBody([-100, 5.7, 7.7, 10.1, 15.2]), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const { cookie, token } = seedOidcSession("alice@kinetica.com");
    const response = await agent
      .post("/api/quantile")
      .set("Cookie", cookie)
      .send({ schema: "demo", table: "nyctaxi", column: "fare_amount", n: 5 });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ breaks: [5.7, 7.7, 10.1, 15.2] });

    // Verify kineticaSql used Bearer auth (not Basic)
    const kineticaCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/execute/sql"));
    expect(kineticaCall).toBeDefined();
    const init = kineticaCall![1] as RequestInit;
    const auth = (init.headers as Record<string, string>).Authorization;
    expect(auth).toBe(`Bearer ${token}`);
  });

  it("OIDC: n bounds validation works identically (400 for n=1)", async () => {
    const agent = await buildTestApp();
    const { cookie } = seedOidcSession();
    const res = await agent
      .post("/api/quantile")
      .set("Cookie", cookie)
      .send({ schema: "demo", table: "t", column: "c", n: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/n must be integer in \[2, 256\]/i);
  });

  it("OIDC: n=2 boundary (min valid) returns 200 with 1 break", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(makeNtileBody([0, 10]), { status: 200 })
      )
    );
    const agent = await buildTestApp();
    const { cookie } = seedOidcSession();
    const res = await agent
      .post("/api/quantile")
      .set("Cookie", cookie)
      .send({ schema: "demo", table: "t", column: "c", n: 2 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ breaks: [10] });
  });

  it("OIDC: Kinetica 403 → 403 response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("denied", { status: 403 })));
    const agent = await buildTestApp();
    const { cookie } = seedOidcSession();
    const res = await agent
      .post("/api/quantile")
      .set("Cookie", cookie)
      .send({ schema: "demo", table: "nyctaxi", column: "fare_amount", n: 5 });
    expect(res.status).toBe(403);
  });

  it("OIDC: no session cookie returns 401", async () => {
    const agent = await buildTestApp();
    const res = await agent
      .post("/api/quantile")
      .send({ schema: "demo", table: "t", column: "c", n: 5 });
    expect(res.status).toBe(401);
  });
});
