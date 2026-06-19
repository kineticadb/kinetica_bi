/**
 * routes.filter-materialize-dv.spec.ts — Plan 62-02 supertest coverage.
 *
 * v1.12 DVDRILL-V112-03 (server). Covers the DV PATH of POST + DELETE
 * /api/filter/materialize in BOTH AUTH_MODE variants (password + oidc):
 *
 *   - dv path materializes FROM the dv's OWN materialized view
 *     (buildDynamicViewName) WHERE <column filters>, returning the distinct
 *     `_kbi_filt_u<u>_d<dash>_dv<dvId>_s<s>` view name (NOT `_t<tableId>`).
 *   - the TABLE PATH stays byte-unchanged when dynamicViewId is absent
 *     (regression lock: FROM <schema.table>, returns `_t<tableId>`).
 *   - dynamicViewId for a missing dv OR a dv on another dashboard → 404.
 *   - dynamicViewId + spatial → 400; dynamicViewId + empty filters → 400.
 *   - DELETE `?dashboardId=&dynamicViewId=` drops the dv-filter view
 *     (DROP TABLE IF EXISTS _kbi_filt_..._dv<dvId>_s...), returns { dropped: true }.
 *
 * OIDC mode mirrors routes.filter-materialize.spec.ts: seed a
 * credentialType:"oidc" session AFTER buildTestApp() boots in oidc mode.
 *
 * Mocks `openid-client` minimally so AUTH_MODE=oidc boot does not hit the
 * network (Issuer.discover) — same pattern as routes.filter-materialize.spec.ts.
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
import { createAdminSession } from "./helpers/db";
import { resetOidcClientForTests } from "../src/oidc";
import {
  db,
  createDashboard,
  createTable,
  createDashboardDynamicView,
} from "../src/db";

const AUTH_SECRET = process.env.AUTH_SECRET!;
const KINETICA_URL = process.env.KINETICA_URL!;
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

const seedDynamicView = (dashId: number, tableId: number, name = "DV1") =>
  createDashboardDynamicView(dashId, {
    source_table_id: tableId,
    name,
    template_sql: "SELECT * FROM {view}",
    max_records: 0,
  });

const makeSessionCookie = () => createAdminSession();

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

const findSqlStatement = (
  fetchMock: ReturnType<typeof vi.fn>,
): string => {
  const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/execute/sql"));
  expect(call).toBeDefined();
  const init = call![1] as RequestInit;
  return JSON.parse(init.body as string).statement as string;
};

describe("POST/DELETE /api/filter/materialize DV PATH — AUTH_MODE=password", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_MODE", "password");
    cleanFixtures();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("dv path: materializes FROM the dv view WHERE filters; returns the distinct _dv<id> filter-view name", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const dv = seedDynamicView(dashId, tableId);
    const { cookie } = makeSessionCookie();
    const before = Date.now();
    const res = await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        dashboardId: dashId,
        dynamicViewId: dv.id,
        filters: [{ column: "zone", value: "East", dataType: "string", addedAt: 0 }],
      });
    expect(res.status).toBe(200);
    // FROM the dv's OWN materialized view (_kbi_dv_u<u>_d<dash>_<dvId>), NOT the source table.
    const stmt = findSqlStatement(fetchMock);
    expect(stmt).toMatch(/CREATE OR REPLACE MATERIALIZED VIEW _kbi_filt_u\w+/);
    expect(stmt).toContain(`SELECT * FROM _kbi_dv_uadmin_d${dashId}_${dv.id} WHERE zone = 'East'`);
    expect(stmt).toContain("USING TABLE PROPERTIES (TTL = 5)");
    // Returns the distinct dv-filter view name: _kbi_filt_u<u>_d<dash>_dv<dvId>_s<s>.
    expect(res.body.viewName).toMatch(new RegExp(`^_kbi_filt_uadmin_d${dashId}_dv${dv.id}_s\\w{8}$`));
    // DISTINCT from both a _t<tableId> filter view AND the dv view name itself.
    expect(res.body.viewName).not.toMatch(/_t\d+_s/);
    expect(res.body.viewName).not.toBe(`_kbi_dv_uadmin_d${dashId}_${dv.id}`);
    expect(typeof res.body.expiresAt).toBe("number");
    expect(res.body.expiresAt).toBeGreaterThan(before);
  });

  it("TABLE PATH regression: no dynamicViewId still emits FROM <schema.table> and returns the _t<tableId> name", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 }),
    );
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
        filters: [{ column: "zone", value: "East Village", dataType: "string", addedAt: 0 }],
      });
    expect(res.status).toBe(200);
    const stmt = findSqlStatement(fetchMock);
    expect(stmt).toContain("(SELECT * FROM ki_home.events WHERE zone = 'East Village')");
    expect(stmt).not.toContain("_kbi_dv_");
    expect(res.body.viewName).toMatch(new RegExp(`^_kbi_filt_uadmin_d${dashId}_t${tableId}_s\\w{8}$`));
  });

  it("missing dv (non-existent dynamicViewId): returns 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(successKineticaBody), { status: 200 })),
    );
    const agent = await buildTestApp();
    const { dashId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        dashboardId: dashId,
        dynamicViewId: 99999,
        filters: [{ column: "zone", value: "East", dataType: "string", addedAt: 0 }],
      });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Dynamic view not found.");
  });

  it("dv belonging to a DIFFERENT dashboard: returns 404 (same-dashboard scoping)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(successKineticaBody), { status: 200 })),
    );
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const otherDash = createDashboard("Other", "");
    const dv = seedDynamicView(otherDash.id, tableId, "OtherDV");
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        dashboardId: dashId, // not the dv's dashboard
        dynamicViewId: dv.id,
        filters: [{ column: "zone", value: "East", dataType: "string", addedAt: 0 }],
      });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Dynamic view not found.");
  });

  it("dynamicViewId + spatialFilters/spatialTarget: returns 400", async () => {
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const dv = seedDynamicView(dashId, tableId);
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        dashboardId: dashId,
        dynamicViewId: dv.id,
        filters: [{ column: "zone", value: "East", dataType: "string", addedAt: 0 }],
        spatialFilters: [{ kind: "bbox", coords: [0, 0, 1, 1] }],
        spatialTarget: { tableId, lonColumn: "lon", latColumn: "lat", spatialMode: "latlon" },
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("not supported");
  });

  it("dynamicViewId + empty filters: returns 400", async () => {
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const dv = seedDynamicView(dashId, tableId);
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({ dashboardId: dashId, dynamicViewId: dv.id, filters: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("non-empty");
  });

  it("DELETE dv path: drops the _dv<id> filter view (NOT _t<tableId>), returns { dropped: true }", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const dv = seedDynamicView(dashId, tableId);
    const { cookie } = makeSessionCookie();
    const res = await agent
      .delete("/api/filter/materialize")
      .query({ dashboardId: dashId, dynamicViewId: dv.id })
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ dropped: true });
    const stmt = findSqlStatement(fetchMock);
    expect(stmt).toMatch(new RegExp(`^DROP TABLE IF EXISTS _kbi_filt_uadmin_d${dashId}_dv${dv.id}_s\\w{8}$`));
    expect(stmt).not.toMatch(/_t\d+_s/);
  });

  it("DEFAULT_VIEW_TTL_MINUTES=10 overrides TTL on dv path: DDL contains TTL = 10 and expiresAt ≈ now + 10 minutes (Phase 74 SETTINGS-V115-02)", async () => {
    vi.stubEnv("DEFAULT_VIEW_TTL_MINUTES", "10");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const dv = seedDynamicView(dashId, tableId);
    const { cookie } = makeSessionCookie();
    const before = Date.now();
    const res = await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        dashboardId: dashId,
        dynamicViewId: dv.id,
        filters: [{ column: "zone", value: "East", dataType: "string", addedAt: 0 }],
      });
    const after = Date.now();
    expect(res.status).toBe(200);
    // DDL must contain the configured TTL
    const stmt = findSqlStatement(fetchMock);
    expect(stmt).toContain("USING TABLE PROPERTIES (TTL = 10)");
    // expiresAt must reflect the configured 10-minute TTL
    expect(res.body.expiresAt).toBeGreaterThanOrEqual(before + 10 * 60 * 1000);
    expect(res.body.expiresAt).toBeLessThanOrEqual(after + 10 * 60 * 1000);
    // env var is restored by the afterEach vi.unstubAllEnvs()
  });
});

describe("POST/DELETE /api/filter/materialize DV PATH — AUTH_MODE=oidc", () => {
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

  it("dv path (oidc session): sanitized username; FROM dv view; distinct _dv<id> filter-view name", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const dv = seedDynamicView(dashId, tableId);
    const { cookie, token } = seedOidcSession("john.doe@kinetica.com");
    const res = await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        dashboardId: dashId,
        dynamicViewId: dv.id,
        filters: [{ column: "zone", value: "East", dataType: "string", addedAt: 0 }],
      });
    expect(res.status).toBe(200);
    const stmt = findSqlStatement(fetchMock);
    // Sanitized OIDC username on BOTH the FROM dv view and the dv-filter target.
    expect(stmt).toContain(
      `SELECT * FROM _kbi_dv_ujohn_doe_kinetica_com_d${dashId}_${dv.id} WHERE zone = 'East'`,
    );
    expect(res.body.viewName).toMatch(
      new RegExp(`^_kbi_filt_ujohn_doe_kinetica_com_d${dashId}_dv${dv.id}_s\\w{8}$`),
    );
    // Bearer (oidc) credential branch exercised.
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/execute/sql"));
    const auth = ((call![1] as RequestInit).headers as Record<string, string>).Authorization;
    expect(auth).toBe(`Bearer ${token}`);
  });

  it("DELETE dv path (oidc session): drops the _dv<id> filter view via Bearer auth", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const dv = seedDynamicView(dashId, tableId);
    const { cookie, token } = seedOidcSession("alice@kinetica.com");
    const res = await agent
      .delete("/api/filter/materialize")
      .query({ dashboardId: dashId, dynamicViewId: dv.id })
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ dropped: true });
    const stmt = findSqlStatement(fetchMock);
    expect(stmt).toMatch(
      new RegExp(`^DROP TABLE IF EXISTS _kbi_filt_ualice_kinetica_com_d${dashId}_dv${dv.id}_s\\w{8}$`),
    );
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/execute/sql"));
    const auth = ((call![1] as RequestInit).headers as Record<string, string>).Authorization;
    expect(auth).toBe(`Bearer ${token}`);
  });
});
