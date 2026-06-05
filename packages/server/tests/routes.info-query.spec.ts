/**
 * routes.info-query.spec.ts — Plan 18-03 supertest coverage.
 *
 * Covers POST /api/info/query for both AUTH_MODE variants (password + oidc),
 * satisfying SPATIAL-V14-04. Mirrors routes.filter-materialize.spec.ts (the
 * v1.3 reference, 23/23 passing) byte-for-byte: same hoisted Issuer mock,
 * same vi.mock("openid-client"), same buildTestApp + createSession + jwt
 * pattern, same describe-per-AUTH_MODE structure.
 *
 * WKB-deferral assertion (per Plan 18-01 NONE_ESCALATE → TECH_DEBT):
 *   spatialMode='wkb' returns HTTP 501 with body
 *   { error: "WKB mode deferred", td: "TD-V14-WKB-SPIKE" }
 *   AND fetchMock.mock.calls.length === 0 — endpoint early-returns BEFORE
 *   any kineticaSql/buildWkbQuery invocation. buildWkbQuery is NOT imported
 *   in index.ts (it would throw WkbDeferredError if invoked).
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

// Shape of a typical /api/info/query request body. Tests override per-case.
type InfoQueryReqBody = {
  layerId: number;
  tableId: number;
  schema: string;
  table: string;
  viewName?: string;
  spatialMode: "latlon" | "wkt" | "wkb";
  spatialColumns: { lonCol?: string; latCol?: string; wktCol?: string; wkbCol?: string };
  clickLon: number;
  clickLat: number;
  radiusPx: number;
  mapBbox: [number, number, number, number];
  mapWidthPx: number;
  mapHeightPx: number;
  page: number;
};

const baseReqBody = (overrides: Partial<InfoQueryReqBody> = {}): InfoQueryReqBody => ({
  layerId: 1,
  tableId: 1, // overwritten with seedFixture's tbl.id per test
  schema: "ki_home",
  table: "events",
  spatialMode: "latlon",
  spatialColumns: { lonCol: "lon", latCol: "lat" },
  clickLon: -73.95,
  clickLat: 40.75,
  radiusPx: 20,
  mapBbox: [-74.05, 40.63, -73.75, 40.85],
  mapWidthPx: 800,
  mapHeightPx: 600,
  page: 0,
  ...overrides,
});

/**
 * Build a Kinetica encoded-response body in column-major shape that matches
 * the parser in the route handler:
 *   - column_headers: string[]
 *   - column_1, column_2, ...: parallel arrays per column
 */
const successKineticaBody = (rowCount = 50, cols = ["id", "name", "lon", "lat"]) => {
  const encoded: Record<string, unknown> = { column_headers: cols };
  cols.forEach((c, idx) => {
    encoded[`column_${idx + 1}`] = Array.from({ length: rowCount }, (_, i) => `${c}_${i}`);
  });
  return {
    status: "OK",
    message: "",
    data_type: "execute_sql_response",
    data_str: JSON.stringify({ json_encoded_response: JSON.stringify(encoded) }),
  };
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

describe("POST /api/info/query — AUTH_MODE=password", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_MODE", "password");
    cleanFixtures();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ── Test 1: latlon happy path ─────────────────────────────────────────
  it("latlon happy path: returns 200 with { rows, columns, hasMore, page }; rows.length=50; hasMore=true", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(successKineticaBody(50)), { status: 200 })
      )
    );
    const agent = await buildTestApp();
    const { tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/info/query")
      .set("Cookie", cookie)
      .send(baseReqBody({ tableId, spatialMode: "latlon", spatialColumns: { lonCol: "lon", latCol: "lat" } }));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.rows)).toBe(true);
    expect(res.body.rows.length).toBe(50);
    expect(Array.isArray(res.body.columns)).toBe(true);
    expect(res.body.columns).toEqual(["id", "name", "lon", "lat"]);
    expect(res.body.hasMore).toBe(true);
    expect(res.body.page).toBe(0);
  });

  // ── Test 2: wkt happy path with raw STXY_DISTANCE (no ST_GEOMFROMTEXT) ─
  it("wkt happy path: SQL contains STXY_DISTANCE(geom_col, -73.95, 40.75); NO ST_GEOMFROMTEXT", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody(10, ["id", "geom"])), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const { tableId } = seedFixture("shapes", "demo");
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/info/query")
      .set("Cookie", cookie)
      .send(
        baseReqBody({
          tableId,
          schema: "demo",
          table: "shapes",
          spatialMode: "wkt",
          spatialColumns: { wktCol: "geom" },
        })
      );
    expect(res.status).toBe(200);
    const kineticaCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/execute/sql")
    );
    expect(kineticaCall).toBeDefined();
    const init = kineticaCall![1] as RequestInit;
    const reqBody = JSON.parse(init.body as string);
    expect(reqBody.statement).toMatch(/STXY_DISTANCE\(geom, -73\.95, 40\.75\)/);
    expect(reqBody.statement).not.toContain("ST_GEOMFROMTEXT");
  });

  // ── Test 3: WKB mode (Kinetica geometry column) — happy path via ST_DISTANCE ────
  // GEOMETRY-typed columns don't accept STXY_DISTANCE (Kinetica rejects with
  // "function: 'stxy_distance' has invalid argument list: geometry,..."). Phase 18
  // SPIKE-NOTES Probe B form is the correct shape: ST_DISTANCE + ST_GEOMFROMTEXT.
  it("wkb mode: SQL contains ST_DISTANCE(wkbCol, ST_GEOMFROMTEXT('POINT(x y)')); 200 with rows", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody(10, ["id", "WKT"])), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const { tableId } = seedFixture("us_states", "ki_home");
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/info/query")
      .set("Cookie", cookie)
      .send(
        baseReqBody({
          tableId,
          schema: "ki_home",
          table: "us_states",
          spatialMode: "wkb",
          spatialColumns: { wkbCol: "WKT" },
        })
      );
    expect(res.status).toBe(200);
    const kineticaCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/execute/sql")
    );
    expect(kineticaCall).toBeDefined();
    const init = kineticaCall![1] as RequestInit;
    const sentBody = JSON.parse(String(init.body));
    expect(sentBody.statement).toContain("ST_DISTANCE(WKT, ST_GEOMFROMTEXT('POINT(-73.95 40.75)'))");
    expect(sentBody.statement).toContain("FROM ki_home.us_states");
    // Regression guard
    expect(sentBody.statement).not.toContain("STXY_DISTANCE");
  });

// ── Test 3b: wkt mode + GEOMETRY column → auto-fallback to ST_DISTANCE ─
  // Operator-reported (post-VERIFY): dynamic views that project H3_CELLTOBOUNDARY
  // output produce a column commonly named "WKT" but its actual storage type is
  // Kinetica GEOMETRY. Operator picks "WKT geometry column" spatial mode and
  // info-click fails with "function: 'stxy_distance' has invalid argument list:
  // geometry,decimal8,decimal8,int (U/TRCc:2056)". Server now catches that
  // exact error from the wkt builder and retries with the GEOMETRY-aware wkb
  // builder (ST_DISTANCE + ST_GEOMFROMTEXT). Single round-trip latency penalty
  // only on the fallback path.
  it("wkt mode + GEOMETRY column → catches STXY error, retries with ST_DISTANCE, returns 200", async () => {
    const stxyGeometryErrorBody = {
      status: "ERROR",
      message: "function: 'stxy_distance' has invalid argument list: geometry,decimal8,decimal8,int (U/TRCc:2056)",
    };
    let callIndex = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callIndex += 1;
      if (callIndex === 1) {
        // First call: STXY_DISTANCE rejected by Kinetica for GEOMETRY column.
        return Promise.resolve(
          new Response(JSON.stringify(stxyGeometryErrorBody), { status: 400 }),
        );
      }
      // Retry: ST_DISTANCE succeeds.
      return Promise.resolve(
        new Response(JSON.stringify(successKineticaBody(3, ["id", "WKT"])), {
          status: 200,
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const { tableId } = seedFixture("h3_view", "demo");
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/info/query")
      .set("Cookie", cookie)
      .send(
        baseReqBody({
          tableId,
          schema: "demo",
          table: "h3_view",
          spatialMode: "wkt", // operator picked WKT; column is actually GEOMETRY
          spatialColumns: { wktCol: "WKT" },
        }),
      );
    expect(res.status).toBe(200);

    // Two SQL execute calls — first STXY (failed), second ST_DISTANCE (retried).
    const kineticaCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/execute/sql"),
    );
    expect(kineticaCalls.length).toBe(2);

    // First call: STXY_DISTANCE form.
    const firstBody = JSON.parse(
      String((kineticaCalls[0]![1] as RequestInit).body),
    );
    expect(firstBody.statement).toContain("STXY_DISTANCE(WKT, -73.95, 40.75)");

    // Second call: ST_DISTANCE + ST_GEOMFROMTEXT form — uses the same column
    // name (WKT) verbatim because the operator's wktCol value was mapped onto
    // wkbCol for the retry.
    const secondBody = JSON.parse(
      String((kineticaCalls[1]![1] as RequestInit).body),
    );
    expect(secondBody.statement).toContain(
      "ST_DISTANCE(WKT, ST_GEOMFROMTEXT('POINT(-73.95 40.75)'))",
    );
    expect(secondBody.statement).not.toContain("STXY_DISTANCE");
  });

  it("wkt mode + non-STXY error → does NOT retry; bubbles error to client", async () => {
    // Defensive: the retry triggers ONLY on the specific stxy-on-geometry error.
    // Other Kinetica errors (network, permission, syntax) must bubble through
    // unchanged so the operator sees the actual problem.
    const otherErrorBody = {
      status: "ERROR",
      message: "Some unrelated Kinetica error",
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(otherErrorBody), { status: 400 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const { tableId } = seedFixture("shapes", "demo");
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/info/query")
      .set("Cookie", cookie)
      .send(
        baseReqBody({
          tableId,
          schema: "demo",
          table: "shapes",
          spatialMode: "wkt",
          spatialColumns: { wktCol: "geom" },
        }),
      );
    expect(res.status).toBeGreaterThanOrEqual(400);
    // Exactly ONE SQL execute call — no retry on unrelated errors.
    const kineticaCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/execute/sql"),
    );
    expect(kineticaCalls.length).toBe(1);
  });

  // ── Test 4: latlon SQL shape ──────────────────────────────────────────
  it("latlon SQL shape: GEODIST(lon, lat, -73.95, 40.75) in WHERE+ORDER BY; LIMIT 50 OFFSET 0", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody(5)), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const { tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    await agent
      .post("/api/info/query")
      .set("Cookie", cookie)
      .send(baseReqBody({ tableId, spatialMode: "latlon" }));
    const kineticaCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/execute/sql")
    );
    expect(kineticaCall).toBeDefined();
    const init = kineticaCall![1] as RequestInit;
    const reqBody = JSON.parse(init.body as string);
    expect(reqBody.statement).toContain("GEODIST(lon, lat, -73.95, 40.75)");
    expect(reqBody.statement).toMatch(
      /ORDER BY GEODIST\(lon, lat, -73\.95, 40\.75\) ASC/
    );
    expect(reqBody.statement).toContain("LIMIT 50 OFFSET 0");
    expect(reqBody.statement).toContain("FROM ki_home.events");
  });

  // ── Test 5: pagination — page=2 → OFFSET 100 ──────────────────────────
  it("pagination: page=2 → SQL contains OFFSET 100", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody(50)), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const { tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    await agent
      .post("/api/info/query")
      .set("Cookie", cookie)
      .send(baseReqBody({ tableId, page: 2 }));
    const kineticaCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/execute/sql")
    );
    expect(kineticaCall).toBeDefined();
    const init = kineticaCall![1] as RequestInit;
    const reqBody = JSON.parse(init.body as string);
    expect(reqBody.statement).toContain("OFFSET 100");
  });

  // ── Test 6: pagination edge — empty page beyond data ──────────────────
  it("pagination edge: zero rows from Kinetica → { rows: [], hasMore: false, page: 5 }", async () => {
    const emptyBody = {
      status: "OK",
      message: "",
      data_type: "execute_sql_response",
      data_str: JSON.stringify({
        json_encoded_response: JSON.stringify({
          column_headers: ["id", "name"],
          column_1: [],
          column_2: [],
        }),
      }),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(emptyBody), { status: 200 })
      )
    );
    const agent = await buildTestApp();
    const { tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/info/query")
      .set("Cookie", cookie)
      .send(baseReqBody({ tableId, page: 5 }));
    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([]);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.page).toBe(5);
    expect(res.body.columns).toEqual(["id", "name"]);
  });

  // ── Test 7: audit log emits op="INFO_QUERY" + route ───────────────────
  it("audit log entry uses op: \"INFO_QUERY\" and route: \"POST /api/info/query\"", async () => {
    const logSpy = vi.spyOn(console, "log");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(successKineticaBody(5)), { status: 200 })
      )
    );
    const agent = await buildTestApp();
    const { tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    await agent
      .post("/api/info/query")
      .set("Cookie", cookie)
      .send(baseReqBody({ tableId }));
    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    const auditLine = lines.find((s) => s.includes('"op":"INFO_QUERY"'));
    expect(auditLine).toBeDefined();
    expect(auditLine).toContain('"route":"POST /api/info/query"');
  });

  // ── Test 8: missing layerId → 400 ─────────────────────────────────────
  it("missing layerId: returns 400", async () => {
    const agent = await buildTestApp();
    const { tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const body = baseReqBody({ tableId }) as Partial<InfoQueryReqBody>;
    delete body.layerId;
    const res = await agent
      .post("/api/info/query")
      .set("Cookie", cookie)
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  // ── Test 9: missing schema → 400 ──────────────────────────────────────
  it("missing schema: returns 400", async () => {
    const agent = await buildTestApp();
    const { tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const body = baseReqBody({ tableId }) as Partial<InfoQueryReqBody>;
    delete body.schema;
    const res = await agent
      .post("/api/info/query")
      .set("Cookie", cookie)
      .send(body);
    expect(res.status).toBe(400);
  });

  // ── Test 10: bad spatialMode → 400 ────────────────────────────────────
  it("bad spatialMode 'invalid': returns 400", async () => {
    const agent = await buildTestApp();
    const { tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/info/query")
      .set("Cookie", cookie)
      .send({ ...baseReqBody({ tableId }), spatialMode: "invalid" });
    expect(res.status).toBe(400);
  });

  // ── Test 11: latlon missing latCol → 400 ──────────────────────────────
  it("spatialMode='latlon' but no latCol: returns 400", async () => {
    const agent = await buildTestApp();
    const { tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/info/query")
      .set("Cookie", cookie)
      .send(
        baseReqBody({
          tableId,
          spatialMode: "latlon",
          spatialColumns: { lonCol: "lon" },
        })
      );
    expect(res.status).toBe(400);
  });

  // ── Test 12: radiusPx <= 0 → 400 ──────────────────────────────────────
  it("radiusPx=0: returns 400", async () => {
    const agent = await buildTestApp();
    const { tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/info/query")
      .set("Cookie", cookie)
      .send(baseReqBody({ tableId, radiusPx: 0 }));
    expect(res.status).toBe(400);
  });

  // ── Test 13: page negative or non-integer → 400 ───────────────────────
  it("page=-1: returns 400", async () => {
    const agent = await buildTestApp();
    const { tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/info/query")
      .set("Cookie", cookie)
      .send(baseReqBody({ tableId, page: -1 }));
    expect(res.status).toBe(400);
  });

  // ── Test 14: mapBbox wrong length → 400 ───────────────────────────────
  it("mapBbox=[1,2,3] (wrong length): returns 400", async () => {
    const agent = await buildTestApp();
    const { tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/info/query")
      .set("Cookie", cookie)
      .send({ ...baseReqBody({ tableId }), mapBbox: [1, 2, 3] });
    expect(res.status).toBe(400);
  });

  // ── Test 15: tableId not found → 404 ──────────────────────────────────
  it("non-existent tableId: returns 404 with 'Table not found.'", async () => {
    const agent = await buildTestApp();
    seedFixture();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/info/query")
      .set("Cookie", cookie)
      .send(baseReqBody({ tableId: 99999 }));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Table not found.");
  });

  // ── Test 16: Kinetica 401 → 401 REAUTH_REQUIRED ───────────────────────
  it("Kinetica 401 → KineticaAuthError → 401 with code: \"REAUTH_REQUIRED\"", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Unauthorized", { status: 401 }))
    );
    const agent = await buildTestApp();
    const { tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/info/query")
      .set("Cookie", cookie)
      .send(baseReqBody({ tableId }));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("REAUTH_REQUIRED");
  });

  // ── Test 17: Kinetica 403 → 403 no code field ─────────────────────────
  it("Kinetica 403 → KineticaPermissionError → 403 with NO `code` field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Forbidden", { status: 403 }))
    );
    const agent = await buildTestApp();
    const { tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/info/query")
      .set("Cookie", cookie)
      .send(baseReqBody({ tableId }));
    expect(res.status).toBe(403);
    expect(res.body.error).toBeTruthy();
    expect(res.body.code).toBeUndefined();
  });

  // ── Test 18: Kinetica 5xx → 502 ───────────────────────────────────────
  it("Kinetica 500 → KineticaUpstreamError → 502", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Internal Server Error", { status: 500 }))
    );
    const agent = await buildTestApp();
    const { tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/info/query")
      .set("Cookie", cookie)
      .send(baseReqBody({ tableId }));
    expect(res.status).toBe(502);
  });

  // ── Test 19: no session cookie → 401 ──────────────────────────────────
  it("no session cookie: returns 401 (requireAuth)", async () => {
    const agent = await buildTestApp();
    const { tableId } = seedFixture();
    const res = await agent
      .post("/api/info/query")
      .send(baseReqBody({ tableId }));
    expect(res.status).toBe(401);
  });

  // ── Test 23: hasMore=true when rows.length === 50 ─────────────────────
  it("pagination: 50 rows from Kinetica → hasMore=true", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(successKineticaBody(50)), { status: 200 })
      )
    );
    const agent = await buildTestApp();
    const { tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/info/query")
      .set("Cookie", cookie)
      .send(baseReqBody({ tableId }));
    expect(res.status).toBe(200);
    expect(res.body.rows.length).toBe(50);
    expect(res.body.hasMore).toBe(true);
  });

  // ── Test 24: hasMore=false when rows.length < 50 ──────────────────────
  it("pagination: 23 rows from Kinetica → hasMore=false; rows.length=23", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(successKineticaBody(23)), { status: 200 })
      )
    );
    const agent = await buildTestApp();
    const { tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/info/query")
      .set("Cookie", cookie)
      .send(baseReqBody({ tableId }));
    expect(res.status).toBe(200);
    expect(res.body.rows.length).toBe(23);
    expect(res.body.hasMore).toBe(false);
  });

  // ── viewName override (v1.3 filter-view alignment) ────────────────────
  it("viewName override: SQL emits FROM <viewName> instead of FROM <schema>.<table>", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody(5)), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const { tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/info/query")
      .set("Cookie", cookie)
      .send(
        baseReqBody({
          tableId,
          viewName: "_kbi_filt_ualice_d1_t1_s12345678",
        })
      );
    expect(res.status).toBe(200);
    const kineticaCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/execute/sql")
    );
    expect(kineticaCall).toBeDefined();
    const init = kineticaCall![1] as RequestInit;
    const sentBody = JSON.parse(String(init.body));
    expect(sentBody.statement).toContain("FROM _kbi_filt_ualice_d1_t1_s12345678");
    expect(sentBody.statement).not.toContain("FROM ki_home.events");
  });

  it("empty-string viewName: returns 400 (callers must omit, not pass empty string)", async () => {
    const agent = await buildTestApp();
    const { tableId } = seedFixture();
    const { cookie } = makeSessionCookie();
    const res = await agent
      .post("/api/info/query")
      .set("Cookie", cookie)
      .send(baseReqBody({ tableId, viewName: "" }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/info/query — AUTH_MODE=oidc", () => {
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

  // ── Test 20: OIDC happy path latlon ───────────────────────────────────
  it("oidc happy path latlon: 200 + auth header is Bearer <access_token>", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody(5)), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const { tableId } = seedFixture();
    const { cookie, token } = seedOidcSession("alice@kinetica.com");
    const res = await agent
      .post("/api/info/query")
      .set("Cookie", cookie)
      .send(baseReqBody({ tableId }));
    expect(res.status).toBe(200);
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

  // ── Test 21: OIDC audit auth_mode ─────────────────────────────────────
  it("oidc audit log line contains \"auth_mode\":\"oidc\"", async () => {
    const logSpy = vi.spyOn(console, "log");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(successKineticaBody(5)), { status: 200 })
      )
    );
    const agent = await buildTestApp();
    const { tableId } = seedFixture();
    const { cookie } = seedOidcSession("alice@kinetica.com");
    await agent
      .post("/api/info/query")
      .set("Cookie", cookie)
      .send(baseReqBody({ tableId }));
    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    const auditLine = lines.find(
      (s) => s.includes('"op":"INFO_QUERY"') && s.includes('"auth_mode":"oidc"')
    );
    expect(auditLine).toBeDefined();
  });

  // ── Test 22: SQL shape unchanged across auth modes (regression) ───────
  it("oidc → SQL emitted is identical to password mode (regression: builders don't read req.user)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successKineticaBody(5)), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const agent = await buildTestApp();
    const { tableId } = seedFixture();
    const { cookie } = seedOidcSession("alice@kinetica.com");
    await agent
      .post("/api/info/query")
      .set("Cookie", cookie)
      .send(baseReqBody({ tableId, spatialMode: "latlon" }));
    const kineticaCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/execute/sql")
    );
    expect(kineticaCall).toBeDefined();
    const init = kineticaCall![1] as RequestInit;
    const reqBody = JSON.parse(init.body as string);
    expect(reqBody.statement).toContain("GEODIST(lon, lat, -73.95, 40.75)");
    expect(reqBody.statement).toContain("FROM ki_home.events");
    expect(reqBody.statement).toContain("LIMIT 50 OFFSET 0");
  });
});
