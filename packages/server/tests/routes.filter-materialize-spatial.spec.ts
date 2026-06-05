/**
 * routes.filter-materialize-spatial.spec.ts — Plan 26-03 supertest coverage.
 *
 * Covers Phase 26 extensions to POST /api/filter/materialize:
 *   - Combined spatial + column WHERE composition (WHERE-V15-04)
 *   - V15-P-07 paren-correctness for 1 / 2 / 3 shape inputs
 *   - 4-case composition (column-only / spatial-only / combined / 0-shape pass-through)
 *   - Pair-completeness 400s (spatialFilters ↔ spatialTarget)
 *   - TableId mismatch 400
 *   - WKB mode 501 BEFORE builder invocation (zero kinetica fetch calls)
 *   - Audit-log op tag stays "MATERIALIZE"
 *
 * Sibling spec to routes.filter-materialize.spec.ts (which stays at 23/23 for v1.3
 * backward-compat coverage). Auth fixtures copied verbatim — keeps the two specs
 * independent so this one can be re-run in isolation during Phase 26 debugging.
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

// ─── Spatial-test fixtures ────────────────────────────────────────────────────

import type { SpatialFilter, SpatialTarget } from "../src/lib/spatialWhereClause";

const SHAPE_1: SpatialFilter = { id: "shape1", wkt: "POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))" };
const SHAPE_2: SpatialFilter = { id: "shape2", wkt: "POLYGON((2 2, 3 2, 3 3, 2 3, 2 2))" };
const SHAPE_3: SpatialFilter = { id: "shape3", wkt: "POLYGON((4 4, 5 4, 5 5, 4 5, 4 4))" };

const makeLatlonTarget = (tableId: number): SpatialTarget => ({
  tableId,
  spatialMode: "latlon",
  lonCol: "lon",
  latCol: "lat",
});

const makeWktTarget = (tableId: number): SpatialTarget => ({
  tableId,
  spatialMode: "wkt",
  spatialCol: "geom",
});

const makeWkbTarget = (tableId: number): SpatialTarget => ({
  tableId,
  spatialMode: "wkb",
  spatialCol: "geom",
});

// Helper: extract the SQL statement from the fetchMock that hit /execute/sql.
// Returns undefined when no /execute/sql call was made (used for 501 assertions).
const getKineticaStatement = (fetchMock: ReturnType<typeof vi.fn>): string | undefined => {
  const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/execute/sql"));
  if (!call) return undefined;
  const init = call[1] as RequestInit;
  const body = JSON.parse(init.body as string);
  return body.statement as string;
};

// Column filter used across multiple test cases
const colFilter = { column: "zone", value: "East Village", dataType: "string" as const, addedAt: 0 };

// ─── AUTH_MODE=password describe block ───────────────────────────────────────

describe("POST /api/filter/materialize spatial — AUTH_MODE=password", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_MODE", "password");
    cleanFixtures();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("column-only request: v1.3 backward-compat — DDL has column WHERE, no spatial", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({ dashboardId: dashId, tableId, filters: [colFilter] });
    expect(res.status).toBe(200);
    const statement = getKineticaStatement(fetchMock);
    expect(statement).toMatch(/WHERE zone = 'East Village'/);
    expect(statement).not.toContain("STXY_WITHIN");
    expect(statement).not.toContain("ST_INTERSECTS");
  });

  it("spatial-only latlon 1-shape: DDL has wrapped spatial predicate, no AND", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 })
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
        filters: [],
        spatialFilters: [SHAPE_1],
        spatialTarget: makeLatlonTarget(tableId),
      });
    expect(res.status).toBe(200);
    const statement = getKineticaStatement(fetchMock);
    expect(statement).toContain(
      "(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))')) = 1)"
    );
    expect(statement).not.toContain(" AND ");
  });

  it("spatial-only wkt 1-shape: DDL uses ST_INTERSECTS (NOT ST_WITHIN)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 })
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
        filters: [],
        spatialFilters: [SHAPE_1],
        spatialTarget: makeWktTarget(tableId),
      });
    expect(res.status).toBe(200);
    const statement = getKineticaStatement(fetchMock);
    expect(statement).toContain("(ST_INTERSECTS(geom, ST_GEOMFROMTEXT(");
    expect(statement).not.toContain("ST_WITHIN(");
  });

  it("combined 1-shape + 1-col: DDL is (spatial) AND (col) — exact paren structure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 })
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
        filters: [colFilter],
        spatialFilters: [SHAPE_1],
        spatialTarget: makeLatlonTarget(tableId),
      });
    expect(res.status).toBe(200);
    const statement = getKineticaStatement(fetchMock);
    expect(statement).toContain(
      "(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))')) = 1) AND (zone = 'East Village')"
    );
  });

  it("V15-P-07 LOAD-BEARING — combined 2-shape + 1-col: DDL is (s1 OR s2) AND (col) with exact parens", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 })
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
        filters: [colFilter],
        spatialFilters: [SHAPE_1, SHAPE_2],
        spatialTarget: makeLatlonTarget(tableId),
      });
    expect(res.status).toBe(200);
    const statement = getKineticaStatement(fetchMock);
    expect(statement).toContain(
      "(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))')) = 1 OR STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('POLYGON((2 2, 3 2, 3 3, 2 3, 2 2))')) = 1) AND (zone = 'East Village')"
    );
  });

  it("3-shape spatial-only: DDL has (s1 OR s2 OR s3) with two OR separators", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 })
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
        filters: [],
        spatialFilters: [SHAPE_1, SHAPE_2, SHAPE_3],
        spatialTarget: makeLatlonTarget(tableId),
      });
    expect(res.status).toBe(200);
    const statement = getKineticaStatement(fetchMock)!;
    expect(statement).toContain("(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('POLYGON((0 0");
    // Extract only the WHERE clause portion to count OR separators (avoids "CREATE OR REPLACE" match)
    const whereClause = statement.slice(statement.indexOf("WHERE ") + 6);
    expect((whereClause.match(/ OR /g) ?? []).length).toBe(2);
    expect(whereClause).not.toContain(" AND ");
  });

  it("0-shape pass-through (spatialFilters: [], NO spatialTarget) + filters: column-only path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 })
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
        filters: [colFilter],
        spatialFilters: [],
        spatialTarget: undefined,
      });
    expect(res.status).toBe(200);
    const statement = getKineticaStatement(fetchMock);
    expect(statement).toContain("WHERE zone = 'East Village'");
    expect(statement).not.toContain("STXY_WITHIN");
    expect(statement).not.toContain("ST_INTERSECTS");
  });

  it("empty input: filters: [] + spatialFilters: [] + no spatialTarget → 400", async () => {
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

  it("spatialFilters present without spatialTarget → 400", async () => {
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    // Include a column filter so step 2 (empty-input check) passes; step 3 then
    // rejects the missing spatialTarget (pair-completeness check).
    const res = await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        dashboardId: dashId,
        tableId,
        filters: [colFilter],
        spatialFilters: [SHAPE_1],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("spatialTarget is required");
  });

  it("spatialTarget present without spatialFilters → 400", async () => {
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        dashboardId: dashId,
        tableId,
        filters: [colFilter],
        spatialFilters: [],
        spatialTarget: makeLatlonTarget(tableId),
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("spatialFilters are required");
  });

  it("spatialTarget.tableId !== body.tableId → 400", async () => {
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        dashboardId: dashId,
        tableId,
        filters: [colFilter],
        spatialFilters: [SHAPE_1],
        spatialTarget: makeLatlonTarget(tableId + 999),
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("must match body.tableId");
  });

  it("WKB mode → 501 with verbatim body; kineticaSql NOT invoked (zero fetch /execute/sql calls)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 })
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
        filters: [],
        spatialFilters: [SHAPE_1],
        spatialTarget: makeWkbTarget(tableId),
      });
    expect(res.status).toBe(501);
    expect(res.body).toEqual({ error: "WKB mode deferred", td: "TD-V14-WKB-SPIKE" });
    expect(getKineticaStatement(fetchMock)).toBeUndefined();
    expect(fetchMock.mock.calls.find((c) => String(c[0]).includes("/execute/sql"))).toBeUndefined();
  });

  it("audit-log op tag stays \"MATERIALIZE\" for combined input", async () => {
    const logSpy = vi.spyOn(console, "log");
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
        filters: [colFilter],
        spatialFilters: [SHAPE_1],
        spatialTarget: makeLatlonTarget(tableId),
      });
    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    const matLine = lines.find(
      (s) => s.includes('"op":"MATERIALIZE"') && s.includes('"route":"POST /api/filter/materialize"')
    );
    expect(matLine).toBeDefined();
  });
});

// ─── AUTH_MODE=oidc describe block ───────────────────────────────────────────

describe("POST /api/filter/materialize spatial — AUTH_MODE=oidc", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_MODE", "oidc");
    vi.stubEnv("AUTH_OIDC_ISSUER_URL", "https://idp.example.com");
    vi.stubEnv("AUTH_OIDC_CLIENT_ID", "kinetica-bi");
    vi.stubEnv("AUTH_OIDC_CLIENT_SECRET", "secret");
    vi.stubEnv("AUTH_OIDC_REDIRECT_URI", "https://bi.example.com/api/auth/oidc/callback");
    resetOidcClientForTests();
    cleanFixtures();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("column-only request: v1.3 backward-compat — DDL has column WHERE, no spatial", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = seedOidcSession("john.doe@kinetica.com");
    const res = await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({ dashboardId: dashId, tableId, filters: [colFilter] });
    expect(res.status).toBe(200);
    const statement = getKineticaStatement(fetchMock);
    expect(statement).toMatch(/WHERE zone = 'East Village'/);
    expect(statement).not.toContain("STXY_WITHIN");
    expect(statement).not.toContain("ST_INTERSECTS");
  });

  it("spatial-only latlon 1-shape: DDL has wrapped spatial predicate, no AND", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = seedOidcSession("john.doe@kinetica.com");
    const res = await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        dashboardId: dashId,
        tableId,
        filters: [],
        spatialFilters: [SHAPE_1],
        spatialTarget: makeLatlonTarget(tableId),
      });
    expect(res.status).toBe(200);
    const statement = getKineticaStatement(fetchMock);
    expect(statement).toContain(
      "(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))')) = 1)"
    );
    expect(statement).not.toContain(" AND ");
  });

  it("spatial-only wkt 1-shape: DDL uses ST_INTERSECTS (NOT ST_WITHIN)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = seedOidcSession("john.doe@kinetica.com");
    const res = await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        dashboardId: dashId,
        tableId,
        filters: [],
        spatialFilters: [SHAPE_1],
        spatialTarget: makeWktTarget(tableId),
      });
    expect(res.status).toBe(200);
    const statement = getKineticaStatement(fetchMock);
    expect(statement).toContain("(ST_INTERSECTS(geom, ST_GEOMFROMTEXT(");
    expect(statement).not.toContain("ST_WITHIN(");
  });

  it("combined 1-shape + 1-col: DDL is (spatial) AND (col) — exact paren structure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = seedOidcSession("john.doe@kinetica.com");
    const res = await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        dashboardId: dashId,
        tableId,
        filters: [colFilter],
        spatialFilters: [SHAPE_1],
        spatialTarget: makeLatlonTarget(tableId),
      });
    expect(res.status).toBe(200);
    const statement = getKineticaStatement(fetchMock);
    expect(statement).toContain(
      "(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))')) = 1) AND (zone = 'East Village')"
    );
  });

  it("V15-P-07 LOAD-BEARING — combined 2-shape + 1-col: DDL is (s1 OR s2) AND (col) with exact parens", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = seedOidcSession("john.doe@kinetica.com");
    const res = await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        dashboardId: dashId,
        tableId,
        filters: [colFilter],
        spatialFilters: [SHAPE_1, SHAPE_2],
        spatialTarget: makeLatlonTarget(tableId),
      });
    expect(res.status).toBe(200);
    const statement = getKineticaStatement(fetchMock);
    expect(statement).toContain(
      "(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))')) = 1 OR STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('POLYGON((2 2, 3 2, 3 3, 2 3, 2 2))')) = 1) AND (zone = 'East Village')"
    );
  });

  it("3-shape spatial-only: DDL has (s1 OR s2 OR s3) with two OR separators", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = seedOidcSession("john.doe@kinetica.com");
    const res = await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        dashboardId: dashId,
        tableId,
        filters: [],
        spatialFilters: [SHAPE_1, SHAPE_2, SHAPE_3],
        spatialTarget: makeLatlonTarget(tableId),
      });
    expect(res.status).toBe(200);
    const statement = getKineticaStatement(fetchMock)!;
    expect(statement).toContain("(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('POLYGON((0 0");
    // Extract only the WHERE clause portion to count OR separators (avoids "CREATE OR REPLACE" match)
    const whereClause = statement.slice(statement.indexOf("WHERE ") + 6);
    expect((whereClause.match(/ OR /g) ?? []).length).toBe(2);
    expect(whereClause).not.toContain(" AND ");
  });

  it("0-shape pass-through (spatialFilters: [], NO spatialTarget) + filters: column-only path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = seedOidcSession("john.doe@kinetica.com");
    const res = await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        dashboardId: dashId,
        tableId,
        filters: [colFilter],
        spatialFilters: [],
        spatialTarget: undefined,
      });
    expect(res.status).toBe(200);
    const statement = getKineticaStatement(fetchMock);
    expect(statement).toContain("WHERE zone = 'East Village'");
    expect(statement).not.toContain("STXY_WITHIN");
    expect(statement).not.toContain("ST_INTERSECTS");
  });

  it("empty input: filters: [] + spatialFilters: [] + no spatialTarget → 400", async () => {
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = seedOidcSession("john.doe@kinetica.com");
    const res = await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({ dashboardId: dashId, tableId, filters: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("non-empty");
  });

  it("spatialFilters present without spatialTarget → 400", async () => {
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = seedOidcSession("john.doe@kinetica.com");
    // Include a column filter so step 2 (empty-input check) passes; step 3 then
    // rejects the missing spatialTarget (pair-completeness check).
    const res = await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        dashboardId: dashId,
        tableId,
        filters: [colFilter],
        spatialFilters: [SHAPE_1],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("spatialTarget is required");
  });

  it("spatialTarget present without spatialFilters → 400", async () => {
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = seedOidcSession("john.doe@kinetica.com");
    const res = await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        dashboardId: dashId,
        tableId,
        filters: [colFilter],
        spatialFilters: [],
        spatialTarget: makeLatlonTarget(tableId),
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("spatialFilters are required");
  });

  it("spatialTarget.tableId !== body.tableId → 400", async () => {
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = seedOidcSession("john.doe@kinetica.com");
    const res = await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        dashboardId: dashId,
        tableId,
        filters: [colFilter],
        spatialFilters: [SHAPE_1],
        spatialTarget: makeLatlonTarget(tableId + 999),
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("must match body.tableId");
  });

  it("WKB mode → 501 with verbatim body; kineticaSql NOT invoked (zero fetch /execute/sql calls)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = seedOidcSession("john.doe@kinetica.com");
    const res = await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        dashboardId: dashId,
        tableId,
        filters: [],
        spatialFilters: [SHAPE_1],
        spatialTarget: makeWkbTarget(tableId),
      });
    expect(res.status).toBe(501);
    expect(res.body).toEqual({ error: "WKB mode deferred", td: "TD-V14-WKB-SPIKE" });
    expect(getKineticaStatement(fetchMock)).toBeUndefined();
    expect(fetchMock.mock.calls.find((c) => String(c[0]).includes("/execute/sql"))).toBeUndefined();
  });

  it("audit-log op tag stays \"MATERIALIZE\" for combined input", async () => {
    const logSpy = vi.spyOn(console, "log");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const { dashId, tableId } = seedFixture();
    const { cookie } = seedOidcSession("john.doe@kinetica.com");
    await agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({
        dashboardId: dashId,
        tableId,
        filters: [colFilter],
        spatialFilters: [SHAPE_1],
        spatialTarget: makeLatlonTarget(tableId),
      });
    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    const matLine = lines.find(
      (s) => s.includes('"op":"MATERIALIZE"') && s.includes('"route":"POST /api/filter/materialize"')
    );
    expect(matLine).toBeDefined();
  });
});
