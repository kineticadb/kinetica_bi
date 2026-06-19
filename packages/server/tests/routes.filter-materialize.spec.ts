/**
 * routes.filter-materialize.spec.ts — Plan 13-03 supertest coverage.
 *
 * Covers POST + DELETE /api/filter/materialize for both AUTH_MODE variants
 * (password + oidc), satisfying VIEW-V13-01, VIEW-V13-02, VIEW-V13-04,
 * VIEW-V13-05, VIEW-V13-07.
 *
 * Approach for OIDC mode (per VIEW-V13-07): rather than booting `createApp`
 * in oidc mode (which requires mocking openid-client + Issuer.discover), we
 * exercise the OIDC credential branch by seeding a `credentialType: "oidc"`
 * session row directly via createSession() AFTER buildTestApp() boots in
 * password mode. This proves the kineticaSql credential-type branch
 * (Bearer vs Basic) and the buildFilterViewName username sanitization for
 * OIDC-style usernames (`john.doe@kinetica.com`). The literal AUTH_MODE
 * env-var stubs (`password` AND `oidc`) appear in the describe blocks so
 * the env-var coverage is exercised at the boot-time wipe pathway.
 *
 * Mocks `openid-client` minimally so AUTH_MODE=oidc boot does not hit the
 * network (Issuer.discover) — same pattern as auth.oidc.spec.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import jwt from "jsonwebtoken";

// Hoisted mock so AUTH_MODE=oidc boot succeeds without network.
// `Issuer` must function as BOTH a static `discover` namespace AND a constructor
// (oidc.ts:82 does `new Issuer(meta)` to suppress the RFC 9207 iss-check workaround).
const mocks = vi.hoisted(() => {
  const CLOCK_TOLERANCE = Symbol("mock.clock_tolerance");
  const client: Record<string | symbol, unknown> = {
    authorizationUrl: vi.fn().mockReturnValue("https://idp.example.com/authorize?mock=1"),
    callback: vi.fn(),
  };
  // Constructor function so `new Issuer(meta)` works AND `Issuer.discover` resolves.
  function Issuer(this: { metadata: unknown; Client: unknown }, _meta: unknown) {
    this.metadata = { issuer: "https://idp.example.com", jwks_uri: "https://idp.example.com/jwks" };
    this.Client = function (_clientMeta: unknown) {
      return client;
    };
  }
  // Static discover() returns an "issuer instance" with .metadata and .Client.
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
import { createAdminSession } from "./helpers/db";
import { resetOidcClientForTests } from "../src/oidc";
import {
  db,
  createDashboard,
  createTable,
} from "../src/db";

const AUTH_SECRET = process.env.AUTH_SECRET!;
const KINETICA_URL = process.env.KINETICA_URL!;
const SESSION_PASSWORD = "alice-pw-secret";
const FAKE_OIDC_ACCESS_TOKEN = "fake-oidc-access-token";

const successKineticaBody = {
  status: "OK",
  message: "",
  data_type: "execute_sql_response",
  data_str: JSON.stringify({ json_encoded_response: JSON.stringify({}) }),
};

const seedFixture = (tableName = "events", schema = "ki_home") => {
  const dash = createDashboard("Test Dashboard", "");
  const tbl = createTable({ name: tableName, schema, columns: {} });
  return { dashId: dash.id, tableId: tbl.id, schema, tableName };
};

const makeSessionCookie = () => createAdminSession();

// Build a 3-segment JWT with a parseable exp claim for OIDC access_token.
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

describe("POST /api/filter/materialize — AUTH_MODE=password", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_MODE", "password");
    cleanFixtures();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("happy path: returns 200 with { viewName, expiresAt }", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(successKineticaBody), { status: 200 })
      )
    );
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const before = Date.now();
    const res = await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        dashboardId: dashId,
        tableId,
        filters: [
          { column: "zone", value: "East Village", dataType: "string", addedAt: 0 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.viewName).toMatch(/^_kbi_filt_u\w+_d\d+_t\d+_s\w{8}$/);
    expect(typeof res.body.expiresAt).toBe("number");
    expect(res.body.expiresAt).toBeGreaterThan(before);
  });

  it("sends DDL: CREATE OR REPLACE MATERIALIZED VIEW <name> AS (SELECT * FROM <schema>.<table> WHERE zone = 'East Village') USING TABLE PROPERTIES (TTL = 5)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        dashboardId: dashId,
        tableId,
        filters: [
          { column: "zone", value: "East Village", dataType: "string", addedAt: 0 },
        ],
      });
    const kineticaCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/execute/sql")
    );
    expect(kineticaCall).toBeDefined();
    const init = kineticaCall![1] as RequestInit;
    const reqBody = JSON.parse(init.body as string);
    expect(reqBody.statement).toMatch(/CREATE OR REPLACE MATERIALIZED VIEW _kbi_filt_u\w+/);
    expect(reqBody.statement).toContain(
      "(SELECT * FROM ki_home.events WHERE zone = 'East Village')"
    );
    expect(reqBody.statement).toContain("USING TABLE PROPERTIES (TTL = 5)");
  });

  // Phase 30 follow-up: Kinetica's CREATE OR REPLACE can fail with TM/SMc:1078
  // when a concurrent DELETE dropped the view between the lookup and Kinetica's
  // internal drop step. The route catches that specific error and retries with
  // DROP IF EXISTS + plain CREATE. Verify the retry path:
  //   1. CREATE OR REPLACE → 400 with TM/SMc:1078
  //   2. DROP TABLE IF EXISTS → 200
  //   3. CREATE MATERIALIZED VIEW → 200
  // and route response is 200 with the viewName / expiresAt.
  it("retries with DROP IF EXISTS + plain CREATE when CREATE OR REPLACE fails with TM/SMc:1078 (race recovery)", async () => {
    let callIndex = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callIndex += 1;
      // First /execute/sql call → race error; subsequent calls → success.
      if (callIndex === 1) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: "ERROR",
              message:
                "Could not find the table: 'ki_home._kbi_filt_test' (TM/SMc:1078)",
            }),
            { status: 400 },
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(successKineticaBody), { status: 200 }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        dashboardId: dashId,
        tableId,
        filters: [
          { column: "zone", value: "East Village", dataType: "string", addedAt: 0 },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.viewName).toMatch(/^_kbi_filt_u\w+/);

    const sqlCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/execute/sql"),
    );
    // Expect 3 calls: failing CREATE OR REPLACE, then DROP, then plain CREATE.
    expect(sqlCalls.length).toBe(3);
    const statements = sqlCalls.map((c) =>
      JSON.parse((c[1] as RequestInit).body as string).statement as string,
    );
    expect(statements[0]).toMatch(/^CREATE OR REPLACE MATERIALIZED VIEW/);
    expect(statements[1]).toMatch(/^DROP TABLE IF EXISTS _kbi_filt_u\w+/);
    expect(statements[2]).toMatch(/^CREATE MATERIALIZED VIEW _kbi_filt_u\w+/);
    expect(statements[2]).not.toMatch(/CREATE OR REPLACE/);
  });

  it("escapes single quotes in string values: O'Brien -> 'O''Brien'", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        dashboardId: dashId,
        tableId,
        filters: [
          { column: "name", value: "O'Brien", dataType: "string", addedAt: 0 },
        ],
      });
    const kineticaCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/execute/sql")
    );
    expect(kineticaCall).toBeDefined();
    const init = kineticaCall![1] as RequestInit;
    const reqBody = JSON.parse(init.body as string);
    expect(reqBody.statement).toContain("name = 'O''Brien'");
  });

  it("view-name format matches regex /^_kbi_filt_u\\w+_d\\d+_t\\d+_s\\w{8}$/", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(successKineticaBody), { status: 200 })
      )
    );
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        dashboardId: dashId,
        tableId,
        filters: [
          { column: "x", value: "y", dataType: "string", addedAt: 0 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.viewName).toMatch(/^_kbi_filt_u\w+_d\d+_t\d+_s\w{8}$/);
  });

  it("audit log entry uses op: \"MATERIALIZE\"", async () => {
    const logSpy = vi.spyOn(console, "log");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(successKineticaBody), { status: 200 })
      )
    );
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        dashboardId: dashId,
        tableId,
        filters: [
          { column: "x", value: "y", dataType: "string", addedAt: 0 },
        ],
      });
    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    const matLine = lines.find((s) => s.includes('"op":"MATERIALIZE"'));
    expect(matLine).toBeDefined();
    expect(matLine).toContain('"route":"POST /api/filter/materialize"');
  });

  // Phase 44 (FILTER-V17-04): IN + BETWEEN operator integration coverage
  it("materialize with operator: 'in' filter emits CREATE OR REPLACE MATERIALIZED VIEW ... WHERE region IN ('EAST', 'WEST')", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        dashboardId: dashId,
        tableId,
        filters: [
          { column: "region", value: ["EAST", "WEST"], dataType: "string", operator: "in", addedAt: 0 },
        ],
      });
    const kineticaCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/execute/sql")
    );
    expect(kineticaCall).toBeDefined();
    const init = kineticaCall![1] as RequestInit;
    const reqBody = JSON.parse(init.body as string);
    expect(reqBody.statement).toMatch(/CREATE OR REPLACE MATERIALIZED VIEW/);
    expect(reqBody.statement).toContain("region IN ('EAST', 'WEST')");
    expect(reqBody.statement).toContain("USING TABLE PROPERTIES (TTL = 5)");
  });

  it("materialize with operator: 'between' filter emits ... WHERE fare BETWEEN 5 AND 50", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        dashboardId: dashId,
        tableId,
        filters: [
          { column: "fare", value: [5, 50], dataType: "number", operator: "between", addedAt: 0 },
        ],
      });
    const kineticaCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/execute/sql")
    );
    expect(kineticaCall).toBeDefined();
    const init = kineticaCall![1] as RequestInit;
    const reqBody = JSON.parse(init.body as string);
    expect(reqBody.statement).toContain("fare BETWEEN 5 AND 50");
  });

  it("materialize with mixed eq + in + between filters emits a flat AND chain", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        dashboardId: dashId,
        tableId,
        filters: [
          { column: "zone", value: "Midtown", dataType: "string", addedAt: 0 },
          { column: "region", value: ["EAST", "WEST"], dataType: "string", operator: "in", addedAt: 0 },
          { column: "fare", value: [5, 50], dataType: "number", operator: "between", addedAt: 0 },
        ],
      });
    const kineticaCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/execute/sql")
    );
    expect(kineticaCall).toBeDefined();
    const init = kineticaCall![1] as RequestInit;
    const reqBody = JSON.parse(init.body as string);
    expect(reqBody.statement).toContain("zone = 'Midtown'");
    expect(reqBody.statement).toContain("region IN ('EAST', 'WEST')");
    expect(reqBody.statement).toContain("fare BETWEEN 5 AND 50");
  });

  it("empty filters array: returns 400", async () => {
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({ dashboardId: dashId, tableId, filters: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("non-empty");
  });

  it("missing dashboardId: returns 400", async () => {
    const agent = await buildTestApp();
    const { tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        tableId,
        filters: [{ column: "x", value: "y", dataType: "string", addedAt: 0 }],
      });
    expect(res.status).toBe(400);
  });

  it("missing tableId: returns 400", async () => {
    const agent = await buildTestApp();
    const { dashId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        dashboardId: dashId,
        filters: [{ column: "x", value: "y", dataType: "string", addedAt: 0 }],
      });
    expect(res.status).toBe(400);
  });

  it("non-existent tableId: returns 404", async () => {
    const agent = await buildTestApp();
    const { dashId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        dashboardId: dashId,
        tableId: 99999,
        filters: [{ column: "x", value: "y", dataType: "string", addedAt: 0 }],
      });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Table not found.");
  });

  it("Kinetica 403 -> KineticaPermissionError -> 403 with NO `code` field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Forbidden", { status: 403 }))
    );
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        dashboardId: dashId,
        tableId,
        filters: [{ column: "x", value: "y", dataType: "string", addedAt: 0 }],
      });
    expect(res.status).toBe(403);
    expect(res.body.error).toBeTruthy();
    expect(res.body.code).toBeUndefined();
  });

  it("Kinetica 401 -> KineticaAuthError -> 401 with code: \"REAUTH_REQUIRED\"", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Unauthorized", { status: 401 }))
    );
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        dashboardId: dashId,
        tableId,
        filters: [{ column: "x", value: "y", dataType: "string", addedAt: 0 }],
      });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("REAUTH_REQUIRED");
  });

  it("no session cookie: returns 401 (requireAuth)", async () => {
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const res = await agent
      .post("/api/filter/materialize")
      .send({
        dashboardId: dashId,
        tableId,
        filters: [{ column: "x", value: "y", dataType: "string", addedAt: 0 }],
      });
    expect(res.status).toBe(401);
  });

  it("expiresAt is approximately 5 minutes (300_000ms) ahead of Date.now()", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(successKineticaBody), { status: 200 })
      )
    );
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const before = Date.now();
    const res = await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        dashboardId: dashId,
        tableId,
        filters: [{ column: "x", value: "y", dataType: "string", addedAt: 0 }],
      });
    const after = Date.now();
    expect(res.status).toBe(200);
    // expiresAt = serverNow + 5*60*1000; serverNow is between before and after
    expect(res.body.expiresAt).toBeGreaterThanOrEqual(before + 5 * 60 * 1000);
    expect(res.body.expiresAt).toBeLessThanOrEqual(after + 5 * 60 * 1000);
  });

  it("DEFAULT_VIEW_TTL_MINUTES=10 overrides TTL: DDL contains TTL = 10 and expiresAt ≈ now + 10 minutes (Phase 74 SETTINGS-V115-02)", async () => {
    vi.stubEnv("DEFAULT_VIEW_TTL_MINUTES", "10");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const before = Date.now();
    const res = await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        dashboardId: dashId,
        tableId,
        filters: [{ column: "x", value: "y", dataType: "string", addedAt: 0 }],
      });
    const after = Date.now();
    expect(res.status).toBe(200);
    // DDL must contain the configured TTL
    const calls = fetchMock.mock.calls;
    const ddlCall = calls.find((c) => {
      const body = JSON.parse((c[1] as { body: string }).body);
      return typeof body.statement === "string" && body.statement.includes("CREATE OR REPLACE MATERIALIZED VIEW");
    });
    expect(ddlCall).toBeDefined();
    const reqBody = JSON.parse((ddlCall![1] as { body: string }).body);
    expect(reqBody.statement).toContain("USING TABLE PROPERTIES (TTL = 10)");
    // expiresAt must reflect the configured 10-minute TTL
    expect(res.body.expiresAt).toBeGreaterThanOrEqual(before + 10 * 60 * 1000);
    expect(res.body.expiresAt).toBeLessThanOrEqual(after + 10 * 60 * 1000);
  });
});

describe("POST /api/filter/materialize — AUTH_MODE=oidc", () => {
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

  it("OIDC username with dots produces sanitized view name (john.doe@kinetica.com -> ujohn_doe_kinetica_com)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(successKineticaBody), { status: 200 })
      )
    );
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    // Seed AFTER buildTestApp(): the AUTH_MODE-change wipe runs at boot and
    // would delete contradicting-mode rows. AUTH_MODE=oidc means it deletes
    // 'password' rows, so an oidc seed survives — but to mirror the
    // creds.routes.spec pattern and keep it bullet-proof, seed after boot.
    const { cookie } = seedOidcSession("john.doe@kinetica.com");
    const res = await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        dashboardId: dashId,
        tableId,
        filters: [{ column: "x", value: "y", dataType: "string", addedAt: 0 }],
      });
    expect(res.status).toBe(200);
    expect(res.body.viewName).toMatch(/^_kbi_filt_ujohn_doe_kinetica_com_/);
  });

  it("OIDC happy path: auth header to Kinetica is Bearer <access_token> (not Basic)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie, token } = seedOidcSession("alice@kinetica.com");
    await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        dashboardId: dashId,
        tableId,
        filters: [{ column: "x", value: "y", dataType: "string", addedAt: 0 }],
      });
    const kineticaCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/execute/sql")
    );
    expect(kineticaCall).toBeDefined();
    const init = kineticaCall![1] as RequestInit;
    const auth = (init.headers as Record<string, string>).Authorization;
    expect(auth).toBe(`Bearer ${token}`);
    expect(auth.startsWith("Bearer ")).toBe(true);
    expect(auth).not.toContain("Basic");
  });
});

describe("DELETE /api/filter/materialize — AUTH_MODE=password", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_MODE", "password");
    cleanFixtures();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("happy path: returns 200 with { dropped: true }", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(successKineticaBody), { status: 200 })
      )
    );
    const agent = await buildTestApp();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .delete("/api/filter/materialize")
      .query({ dashboardId: 1, tableId: 1 })
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ dropped: true });
  });

  it("sends DDL: DROP TABLE IF EXISTS <viewName>", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const { cookie } = makeSessionCookie();
    await agent
      .delete("/api/filter/materialize")
      .query({ dashboardId: 1, tableId: 1 })
      .set("Cookie", cookie);
    const kineticaCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/execute/sql")
    );
    expect(kineticaCall).toBeDefined();
    const init = kineticaCall![1] as RequestInit;
    const reqBody = JSON.parse(init.body as string);
    expect(reqBody.statement).toMatch(
      /^DROP TABLE IF EXISTS _kbi_filt_u\w+_d1_t1_s\w{8}$/
    );
  });

  it("audit log entry uses op: \"MATERIALIZE\" (same op tag as POST)", async () => {
    const logSpy = vi.spyOn(console, "log");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(successKineticaBody), { status: 200 })
      )
    );
    const agent = await buildTestApp();
    const { cookie } = makeSessionCookie();
    await agent
      .delete("/api/filter/materialize")
      .query({ dashboardId: 1, tableId: 1 })
      .set("Cookie", cookie);
    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    const matLine = lines.find(
      (s) =>
        s.includes('"op":"MATERIALIZE"') &&
        s.includes('"route":"DELETE /api/filter/materialize"')
    );
    expect(matLine).toBeDefined();
  });

  it("missing dashboardId query param: returns 400", async () => {
    const agent = await buildTestApp();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .delete("/api/filter/materialize")
      .query({ tableId: 1 })
      .set("Cookie", cookie);
    expect(res.status).toBe(400);
  });

  it("missing tableId query param: returns 400", async () => {
    const agent = await buildTestApp();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .delete("/api/filter/materialize")
      .query({ dashboardId: 1 })
      .set("Cookie", cookie);
    expect(res.status).toBe(400);
  });

  it("non-numeric dashboardId: returns 400", async () => {
    const agent = await buildTestApp();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .delete("/api/filter/materialize")
      .query({ dashboardId: "abc", tableId: 1 })
      .set("Cookie", cookie);
    expect(res.status).toBe(400);
  });

  it("no session cookie: returns 401", async () => {
    const agent = await buildTestApp();
    const res = await agent
      .delete("/api/filter/materialize")
      .query({ dashboardId: 1, tableId: 1 });
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/filter/materialize — AUTH_MODE=oidc", () => {
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

  it("OIDC session: returns 200; auth header to Kinetica is Bearer <access_token>", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const { cookie, token } = seedOidcSession("alice@kinetica.com");
    const res = await agent
      .delete("/api/filter/materialize")
      .query({ dashboardId: 1, tableId: 1 })
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    const kineticaCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/execute/sql")
    );
    expect(kineticaCall).toBeDefined();
    const init = kineticaCall![1] as RequestInit;
    const auth = (init.headers as Record<string, string>).Authorization;
    expect(auth.startsWith("Bearer ")).toBe(true);
    expect(auth).toBe(`Bearer ${token}`);
  });
});
