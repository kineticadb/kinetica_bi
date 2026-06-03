/**
 * routes.dynamic-view-drop.spec.ts — Phase 33 Plan 02 supertest coverage.
 *
 * Covers the new POST /api/dynamic-view/:id/drop endpoint — the DROP-only
 * lifecycle-cleanup primitive used by the frontend dynamicViewStore.reset()
 * DROP loop (logout + dashboard switch). Mirrors the dual-auth-mode harness
 * pattern from routes.dynamic-view.spec.ts.
 *
 * CONTRAST with DELETE /api/dynamic-view/:id covered by routes.dynamic-view.spec.ts:
 *   - DELETE drops view AND removes SQLite row.
 *   - POST /api/dynamic-view/:id/drop drops view ONLY; SQLite row stays intact.
 *
 * Test list (locked by 33-CONTEXT.md):
 *   AUTH_MODE=password block:
 *     1. happy path — returns 200 { dropped: true }, fires DROP TABLE IF EXISTS, row UNTOUCHED.
 *     2. 404 when id does not exist — no DROP fired.
 *     3. 400 when id path param is non-numeric — no DROP fired.
 *     4. 401 when no session cookie.
 *     5. idempotent — calling twice both return 200 (DROP IF EXISTS is silent).
 *   AUTH_MODE=oidc smoke block:
 *     6. happy path under OIDC — Bearer <access_token> on Kinetica fetch.
 *     7. 404 under OIDC — no DROP fired.
 *
 * Mock pattern mirrors routes.dynamic-view.spec.ts:
 *   - Hoisted openid-client mock so AUTH_MODE=oidc boot does not hit the network.
 *   - vi.stubGlobal("fetch", ...) returns Kinetica-shaped column-major responses.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import jwt from "jsonwebtoken";

// Hoisted mock so AUTH_MODE=oidc boot succeeds without network.
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
import {
  db,
  createDashboard,
  createTable,
  createDashboardDynamicView,
  getDashboardDynamicView,
} from "../src/db";

const AUTH_SECRET = process.env.AUTH_SECRET!;
const KINETICA_URL = process.env.KINETICA_URL!;
const SESSION_PASSWORD = "alice-pw-secret";
const FAKE_OIDC_ACCESS_TOKEN = "fake-oidc-access-token";

// ── Kinetica response builders ────────────────────────────────────────────

/** Generic success body. Wraps a column-major encoded payload twice (kinetica.ts contract). */
const kineticaOk = (encoded: Record<string, unknown> = {}): { status: number; body: string } => ({
  status: 200,
  body: JSON.stringify({
    status: "OK",
    message: "",
    data_type: "execute_sql_response",
    data_str: JSON.stringify({ json_encoded_response: JSON.stringify(encoded) }),
  }),
});

/** Convenience: convert a {status,body} into a Response. */
const respond = (r: { status: number; body: string }) =>
  Promise.resolve(new Response(r.body, { status: r.status }));

// ── Test fixtures ─────────────────────────────────────────────────────────

const seedFixture = (tableName = "events", schema = "ki_home") => {
  const dash = createDashboard("Test Dashboard", "");
  const tbl = createTable({ name: tableName, schema, columns: {} });
  return { dashId: dash.id, tableId: tbl.id, schema, tableName };
};

const seedDynamicView = (
  dashId: number,
  tableId: number,
  overrides: Partial<{ name: string; template_sql: string; max_records: number }> = {},
) => {
  return createDashboardDynamicView(dashId, {
    source_table_id: tableId,
    name: overrides.name ?? "Top vendors",
    template_sql:
      overrides.template_sql ?? "SELECT vendor, AVG(fare) AS avg_fare FROM {view} GROUP BY vendor",
    max_records: overrides.max_records ?? 1000,
  });
};

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
  db.exec("DELETE FROM dashboard_dynamic_views");
  db.exec("DELETE FROM dashboard_table_views");
  db.exec("DELETE FROM dashboard_tables");
  db.exec("DELETE FROM tables");
  db.exec("DELETE FROM dashboards");
};

/** Extract Kinetica /execute/sql statements in call order. */
const sqlStatements = (fetchMock: ReturnType<typeof vi.fn>): string[] =>
  fetchMock.mock.calls
    .filter((c) => String(c[0]).includes("/execute/sql"))
    .map((c) => JSON.parse((c[1] as RequestInit).body as string).statement as string);

// ============================================================================
//  POST /api/dynamic-view/:id/drop — AUTH_MODE=password
// ============================================================================
describe("POST /api/dynamic-view/:id/drop — AUTH_MODE=password", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_MODE", "password");
    cleanFixtures();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("happy path — returns 200 { dropped: true }, fires DROP TABLE IF EXISTS, row UNTOUCHED", async () => {
    const fetchMock = vi.fn().mockImplementation(() => respond(kineticaOk({ column_headers: [] })));
    vi.stubGlobal("fetch", fetchMock);

    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const dv = seedDynamicView(dashId, tableId);
    const { cookie } = makeSessionCookie("alice");

    const res = await agent
      .post(`/api/dynamic-view/${dv.id}/drop`)
      .set("Cookie", cookie)
      .send();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ dropped: true });

    // Assert exactly one Kinetica fetch fired — the DROP statement.
    const statements = sqlStatements(fetchMock);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^DROP TABLE IF EXISTS _kbi_dv_u\w+_d\d+_\d+$/);

    // CRITICAL row-untouched assertion: SQLite row still exists after drop.
    expect(getDashboardDynamicView(dv.id)).toBeDefined();
    expect(getDashboardDynamicView(dv.id)?.name).toBe(dv.name);
  });

  it("returns 404 when id does not exist — no DROP fired", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const agent = await buildTestApp();
    const { cookie } = makeSessionCookie("alice");

    const res = await agent
      .post(`/api/dynamic-view/99999/drop`)
      .set("Cookie", cookie)
      .send();

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
    expect(sqlStatements(fetchMock)).toHaveLength(0); // no Kinetica round-trip
  });

  it("returns 400 when :id path param is non-numeric", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const agent = await buildTestApp();
    const { cookie } = makeSessionCookie("alice");

    const res = await agent
      .post(`/api/dynamic-view/abc/drop`)
      .set("Cookie", cookie)
      .send();

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/numeric/i);
    expect(sqlStatements(fetchMock)).toHaveLength(0);
  });

  it("returns 401 when no session cookie", async () => {
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const dv = seedDynamicView(dashId, tableId);

    const res = await agent
      .post(`/api/dynamic-view/${dv.id}/drop`)
      .send();

    expect(res.status).toBe(401);
  });

  it("idempotent — calling drop twice both return 200 (DROP IF EXISTS is silent)", async () => {
    const fetchMock = vi.fn().mockImplementation(() => respond(kineticaOk({ column_headers: [] })));
    vi.stubGlobal("fetch", fetchMock);

    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const dv = seedDynamicView(dashId, tableId);
    const { cookie } = makeSessionCookie("alice");

    const res1 = await agent.post(`/api/dynamic-view/${dv.id}/drop`).set("Cookie", cookie).send();
    const res2 = await agent.post(`/api/dynamic-view/${dv.id}/drop`).set("Cookie", cookie).send();

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res1.body).toEqual({ dropped: true });
    expect(res2.body).toEqual({ dropped: true });

    const statements = sqlStatements(fetchMock);
    expect(statements).toHaveLength(2); // two DROP statements
    expect(statements[0]).toMatch(/^DROP TABLE IF EXISTS _kbi_dv_u\w+_d\d+_\d+$/);
    expect(statements[1]).toMatch(/^DROP TABLE IF EXISTS _kbi_dv_u\w+_d\d+_\d+$/);

    // SQLite row still intact after both calls.
    expect(getDashboardDynamicView(dv.id)).toBeDefined();
  });
});

// ============================================================================
//  POST /api/dynamic-view/:id/drop — AUTH_MODE=oidc smoke
// ============================================================================
describe("POST /api/dynamic-view/:id/drop — AUTH_MODE=oidc smoke", () => {
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

  it("happy path under OIDC — Bearer <access_token> on Kinetica fetch", async () => {
    const fetchMock = vi.fn().mockImplementation(() => respond(kineticaOk({ column_headers: [] })));
    vi.stubGlobal("fetch", fetchMock);

    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const dv = seedDynamicView(dashId, tableId);
    const { cookie, token } = seedOidcSession("john.doe@kinetica.com");

    const res = await agent
      .post(`/api/dynamic-view/${dv.id}/drop`)
      .set("Cookie", cookie)
      .send();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ dropped: true });

    // Assert the Kinetica fetch was called with Bearer <token>.
    const kineticaCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/execute/sql"));
    expect(kineticaCalls).toHaveLength(1);
    const init = kineticaCalls[0][1] as RequestInit;
    const authHeader = (init.headers as Record<string, string>).Authorization ?? "";
    expect(authHeader).toBe(`Bearer ${token}`);

    // Statement uses OIDC-sanitized username.
    const statements = sqlStatements(fetchMock);
    expect(statements[0]).toMatch(/^DROP TABLE IF EXISTS _kbi_dv_ujohn_doe_kinetica_com_d\d+_\d+$/);

    // Row UNTOUCHED under OIDC as well.
    expect(getDashboardDynamicView(dv.id)).toBeDefined();
  });

  it("returns 404 under OIDC when id does not exist — no DROP fired", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const agent = await buildTestApp();
    const { cookie } = seedOidcSession("john.doe@kinetica.com");

    const res = await agent
      .post(`/api/dynamic-view/99999/drop`)
      .set("Cookie", cookie)
      .send();

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
    expect(sqlStatements(fetchMock)).toHaveLength(0);
  });
});
