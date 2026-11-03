/**
 * routes.column-guard.other-routes.spec.ts — Phase 133 (AISAFE-V20-01, D-03).
 * CG-OR1..7: POST /api/exports and POST /api/info/query reject client column names
 * absent from the registered snapshot (400, no SQL, no export job); dv-backed
 * info popups keep working (Tier B).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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
import { createAdminSession } from "./helpers/db";
import { db, createDashboard, createTable, createWidget } from "../src/db";

const successKineticaBody = {
  status: "OK",
  message: "",
  data_type: "execute_sql_response",
  data_str: JSON.stringify({ json_encoded_response: JSON.stringify({ column_headers: [] }) }),
};

const COLS = { id: "int", zone: "string", fare: "double", lon: "double", lat: "double" };

const sqlCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter((c) => String(c[0]).includes("/execute/sql"));

describe("column guard: exports + info/query (Phase 133)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let dashId: number;
  let tableId: number;
  let widgetId: number;
  beforeEach(() => {
    vi.stubEnv("AUTH_MODE", "password");
    db.exec(
      "DELETE FROM export_jobs; DELETE FROM sessions; DELETE FROM widgets; DELETE FROM dashboard_table_views; DELETE FROM dashboard_tables; DELETE FROM tables; DELETE FROM dashboards;",
    );
    fetchMock = vi.fn().mockImplementation(
      async () => new Response(JSON.stringify(successKineticaBody), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    dashId = createDashboard("CG-OR Dashboard", "").id;
    tableId = createTable({ schema: "fleet", name: "trips", columns: COLS }).id;
    widgetId = createWidget(dashId, {
      title: "w",
      type: "records",
      position: 0,
      config: { tableId, table: "fleet.trips", columns: "id, zone", sortField: "id", sortDirection: "asc" },
    }).id;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const postExport = async (extra: Record<string, unknown>) => {
    const agent = await buildTestApp();
    const { cookie } = createAdminSession();
    return agent.post("/api/exports").set("Cookie", cookie).send({ widgetId, ...extra });
  };
  const postInfo = async (overrides: Record<string, unknown>) => {
    const agent = await buildTestApp();
    const { cookie } = createAdminSession();
    return agent
      .post("/api/info/query")
      .set("Cookie", cookie)
      .send({
        layerId: 1,
        tableId,
        schema: "fleet",
        table: "trips",
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
  };

  it("CG-OR1: exports unknown filter column -> 400 UNKNOWN_COLUMN, no job, no SQL", async () => {
    const res = await postExport({ filters: [{ column: "region", value: "East", dataType: "string", addedAt: 0 }] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("UNKNOWN_COLUMN");
    expect(res.body.error).toBe('Column "region" no longer exists on fleet.trips');
    const agent = await buildTestApp();
    const { cookie } = createAdminSession();
    const list = await agent.get("/api/exports").set("Cookie", cookie);
    expect(list.body.data).toEqual([]);
    expect(sqlCalls(fetchMock).length).toBe(0);
  });

  it("CG-OR2: exports unknown sortField -> 400 UNKNOWN_COLUMN", async () => {
    const res = await postExport({ sortField: "region" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("UNKNOWN_COLUMN");
    expect(sqlCalls(fetchMock).length).toBe(0);
  });

  it("CG-OR3: info/query latlon unknown lonCol -> 400 naming it, no SQL", async () => {
    const res = await postInfo({ spatialColumns: { lonCol: "longitude", latCol: "lat" } });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("UNKNOWN_COLUMN");
    expect(res.body.column).toBe("longitude");
    expect(sqlCalls(fetchMock).length).toBe(0);
  });

  it("CG-OR4: info/query schema/table mismatch vs tableId -> 400, no SQL", async () => {
    const res = await postInfo({ schema: "fleet", table: "other_table" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("schema and table must match the registered table for tableId.");
    expect(sqlCalls(fetchMock).length).toBe(0);
  });

  it("CG-OR5: info/query filtered-view viewName still checks columns", async () => {
    const res = await postInfo({
      viewName: `_kbi_filt_uadmin_d1_t${tableId}_s12345678`,
      spatialColumns: { lonCol: "longitude", latCol: "lat" },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("UNKNOWN_COLUMN");
    expect(sqlCalls(fetchMock).length).toBe(0);
  });

  it("CG-OR6: info/query dv-backed layer with non-snapshot column still serves (non-regression)", async () => {
    const res = await postInfo({
      viewName: "_kbi_dv_uadmin_d1_7",
      spatialMode: "wkt",
      spatialColumns: { wktCol: "WKT" },
    });
    expect(res.status).toBe(200);
  });

  it("CG-OR7: info/query malformed identifiers -> 400 INVALID_IDENTIFIER, no SQL", async () => {
    const a = await postInfo({ viewName: "x; DROP TABLE t" });
    expect(a.status).toBe(400);
    expect(a.body.code).toBe("INVALID_IDENTIFIER");
    const b = await postInfo({
      viewName: "_kbi_dv_uadmin_d1_7",
      spatialMode: "wkt",
      spatialColumns: { wktCol: "a b" },
    });
    expect(b.status).toBe(400);
    expect(b.body.code).toBe("INVALID_IDENTIFIER");
    expect(sqlCalls(fetchMock).length).toBe(0);
  });
});
