/**
 * routes.filter-materialize-combo.spec.ts — COMBO-V118-04 supertest coverage.
 *
 * Covers the combination-key extension of POST + DELETE /api/filter/materialize
 * in BOTH AUTH_MODE variants (password + oidc):
 *
 *   - ABSENT combinationKey → POST returns a viewName byte-identical to v1.17
 *     (no _c suffix; shape ^_kbi_filt_uadmin_d<dash>_t<table>_s\w{8}$).
 *   - PRESENT combinationKey (table path) → POST returns
 *     ^_kbi_filt_uadmin_d<dash>_t<table>_s\w{8}_c[0-9a-f]{8}$ and the 8-hex
 *     suffix equals hashKey8(combinationKey) imported from viewNaming — proving
 *     the server recipe matches the client comboShortHash (cross-stack contract).
 *   - PRESENT combinationKey (dv path) → same _c<hash8> shape with _dv<id> segment.
 *   - DELETE ?dashboardId=&viewName=<predicted combo name> → 200 { dropped: true };
 *     captured DROP statement uses the exact viewName provided.
 *
 * Mocks `openid-client` minimally so AUTH_MODE=oidc boot does not hit the
 * network — same pattern as routes.filter-materialize-dv.spec.ts.
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
import { hashKey8 } from "../src/lib/viewNaming";

const AUTH_SECRET = process.env.AUTH_SECRET!;
const KINETICA_URL = process.env.KINETICA_URL!;
const FAKE_OIDC_ACCESS_TOKEN = "fake-oidc-access-token";

// A known combinationKey value (stableComboHash-shaped) used across tests.
const COMBO_KEY = 'table:7:status|eq|"East"';

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

const findSqlStatement = (fetchMock: ReturnType<typeof vi.fn>): string => {
  const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/execute/sql"));
  expect(call).toBeDefined();
  const init = call![1] as RequestInit;
  return JSON.parse(init.body as string).statement as string;
};

// ──────────────────────────────────────────────────────────────────────────────
// AUTH_MODE = password
// ──────────────────────────────────────────────────────────────────────────────
describe("POST/DELETE /api/filter/materialize COMBO — AUTH_MODE=password", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_MODE", "password");
    cleanFixtures();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("ABSENT combinationKey (table path): viewName byte-identical to v1.17 (no _c suffix)", async () => {
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
        filters: [{ column: "zone", value: "East", dataType: "string", addedAt: 0 }],
      });
    expect(res.status).toBe(200);
    // No _c suffix: shape must be the v1.17 form exactly (regex anchors ensure no _c tail).
    expect(res.body.viewName).toMatch(new RegExp(`^_kbi_filt_uadmin_d${dashId}_t${tableId}_s\\w{8}$`));
  });

  it("PRESENT combinationKey (table path): viewName gains _c<hash8> suffix matching hashKey8", async () => {
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
        filters: [{ column: "zone", value: "East", dataType: "string", addedAt: 0 }],
        combinationKey: COMBO_KEY,
      });
    expect(res.status).toBe(200);
    const expectedSuffix = hashKey8(COMBO_KEY);
    // Shape: _kbi_filt_uadmin_d<dash>_t<table>_s\w{8}_c[0-9a-f]{8}
    expect(res.body.viewName).toMatch(
      new RegExp(`^_kbi_filt_uadmin_d${dashId}_t${tableId}_s\\w{8}_c[0-9a-f]{8}$`),
    );
    // Exact suffix equality — cross-stack contract proof.
    // Exact suffix equality — cross-stack contract proof.
    expect((res.body.viewName as string).endsWith(`_c${expectedSuffix}`)).toBe(true);
  });

  it("PRESENT combinationKey (dv path): viewName gains _c<hash8> suffix after _dv<id> segment", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
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
        combinationKey: COMBO_KEY,
      });
    expect(res.status).toBe(200);
    const expectedSuffix = hashKey8(COMBO_KEY);
    expect(res.body.viewName).toMatch(
      new RegExp(`^_kbi_filt_uadmin_d${dashId}_dv${dv.id}_s\\w{8}_c[0-9a-f]{8}$`),
    );
    // Exact suffix equality — cross-stack contract proof.
    expect((res.body.viewName as string).endsWith(`_c${expectedSuffix}`)).toBe(true);
  });

  it("DELETE ?viewName=: drops combination view by direct name, returns { dropped: true }", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const { dashId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const comboViewName = `_kbi_filt_uadmin_d${dashId}_t7_sabcd1234_c${hashKey8(COMBO_KEY)}`;
    const res = await agent
      .delete("/api/filter/materialize")
      .query({ dashboardId: dashId, viewName: comboViewName })
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ dropped: true });
    const stmt = findSqlStatement(fetchMock);
    expect(stmt).toBe(`DROP TABLE IF EXISTS ${comboViewName}`);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// AUTH_MODE = oidc
// ──────────────────────────────────────────────────────────────────────────────
describe("POST/DELETE /api/filter/materialize COMBO — AUTH_MODE=oidc", () => {
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

  it("ABSENT combinationKey (oidc session): viewName byte-identical to v1.17 (no _c suffix)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = seedOidcSession("admin@kinetica.com");
    const res = await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        dashboardId: dashId,
        tableId,
        filters: [{ column: "zone", value: "East", dataType: "string", addedAt: 0 }],
      });
    expect(res.status).toBe(200);
    // Exact v1.17 shape — no _c<hash8> tail.
    expect(res.body.viewName).toMatch(
      new RegExp(`^_kbi_filt_uadmin_kinetica_com_d${dashId}_t${tableId}_s\\w{8}$`),
    );
  });

  it("PRESENT combinationKey (oidc session, table path): viewName gains _c<hash8> suffix", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie, token } = seedOidcSession("john.doe@kinetica.com");
    const res = await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        dashboardId: dashId,
        tableId,
        filters: [{ column: "zone", value: "East", dataType: "string", addedAt: 0 }],
        combinationKey: COMBO_KEY,
      });
    expect(res.status).toBe(200);
    const expectedSuffix = hashKey8(COMBO_KEY);
    expect(res.body.viewName).toMatch(
      new RegExp(`^_kbi_filt_ujohn_doe_kinetica_com_d${dashId}_t${tableId}_s\\w{8}_c[0-9a-f]{8}$`),
    );
    // Exact suffix equality — cross-stack contract proof.
    expect((res.body.viewName as string).endsWith(`_c${expectedSuffix}`)).toBe(true);
    // Bearer (oidc) credential branch exercised.
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/execute/sql"));
    const auth = ((call![1] as RequestInit).headers as Record<string, string>).Authorization;
    expect(auth).toBe(`Bearer ${token}`);
  });

  it("PRESENT combinationKey (oidc session, dv path): viewName gains _c<hash8> suffix after _dv<id> segment", async () => {
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
        combinationKey: COMBO_KEY,
      });
    expect(res.status).toBe(200);
    const expectedSuffix = hashKey8(COMBO_KEY);
    // oidc username prefix is the full email-derived form; dv segment is _dv<id>.
    expect(res.body.viewName).toMatch(
      new RegExp(`^_kbi_filt_ujohn_doe_kinetica_com_d${dashId}_dv${dv.id}_s\\w{8}_c[0-9a-f]{8}$`),
    );
    // Exact suffix equality — cross-stack contract proof.
    expect((res.body.viewName as string).endsWith(`_c${expectedSuffix}`)).toBe(true);
    // Bearer (oidc) credential branch exercised on the dv path too.
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/execute/sql"));
    const auth = ((call![1] as RequestInit).headers as Record<string, string>).Authorization;
    expect(auth).toBe(`Bearer ${token}`);
  });

  it("DELETE ?viewName= (oidc session): drops combination view by name, returns { dropped: true }", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const { dashId } = seedFixture();
    const { cookie, token } = seedOidcSession("alice@kinetica.com");
    const comboViewName = `_kbi_filt_ualice_kinetica_com_d${dashId}_t7_sabcd1234_c${hashKey8(COMBO_KEY)}`;
    const res = await agent
      .delete("/api/filter/materialize")
      .query({ dashboardId: dashId, viewName: comboViewName })
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ dropped: true });
    const stmt = findSqlStatement(fetchMock);
    expect(stmt).toBe(`DROP TABLE IF EXISTS ${comboViewName}`);
    // Bearer auth used.
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/execute/sql"));
    const auth = ((call![1] as RequestInit).headers as Record<string, string>).Authorization;
    expect(auth).toBe(`Bearer ${token}`);
  });
});
