/**
 * routes.column-guard.filter-materialize.spec.ts — Phase 133 (AISAFE-V20-01, SSYNC-F6).
 * CG-FM1..8: POST /api/filter/materialize table path rejects columns absent from the
 * registered snapshot with 400 + D-02 message and sends NO SQL to Kinetica.
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
import { db, createDashboard, createTable } from "../src/db";


const successKineticaBody = {
  status: "OK",
  message: "",
  data_type: "execute_sql_response",
  data_str: JSON.stringify({ json_encoded_response: JSON.stringify({}) }),
};

const COLS = { zone: "string", fare: "double", lon: "double", lat: "double", geom: "string" };

const seed = (opts: { schema?: string; columns?: Record<string, string> } = {}) => {
  const dash = createDashboard("CG Dashboard", "");
  const tbl = createTable({
    name: "trips",
    schema: opts.schema ?? "fleet",
    columns: opts.columns ?? COLS,
  });
  return { dashId: dash.id, tableId: tbl.id };
};

const sqlCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter((c) => String(c[0]).includes("/execute/sql"));

const SHAPE = { id: "s1", wkt: "POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))" };

describe("POST /api/filter/materialize column guard (Phase 133)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubEnv("AUTH_MODE", "password");
    db.exec("DELETE FROM sessions");
    db.exec("DELETE FROM dashboard_table_views");
    db.exec("DELETE FROM dashboard_tables");
    db.exec("DELETE FROM tables");
    db.exec("DELETE FROM dashboards");
    fetchMock = vi.fn().mockImplementation(
      async () => new Response(JSON.stringify(successKineticaBody), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const post = async (payload: (ids: { dashId: number; tableId: number }) => Record<string, unknown>, opts?: Parameters<typeof seed>[0]) => {
    const agent = await buildTestApp();
    const ids = seed(opts);
    const { cookie } = createAdminSession();
    return agent
      .post("/api/filter/materialize")
      .set("Cookie", cookie)
      .send({ dashboardId: ids.dashId, tableId: ids.tableId, ...payload(ids) });
  };
  const f = (column: unknown) => [{ column, value: "East", dataType: "string", addedAt: 0 }];

  it("CG-FM1: unknown filter column -> 400 D-02 error, no SQL", async () => {
    const res = await post(() => ({ filters: f("region") }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Column "region" no longer exists on fleet.trips');
    expect(res.body.code).toBe("UNKNOWN_COLUMN");
    expect(res.body.column).toBe("region");
    expect(res.body.table).toBe("fleet.trips");
    expect(sqlCalls(fetchMock).length).toBe(0);
  });

  it("CG-FM2: valid column still produces the identical statement", async () => {
    const res = await post(() => ({
      filters: [{ column: "zone", value: "East Village", dataType: "string", addedAt: 0 }],
    }));
    expect(res.status).toBe(200);
    const calls = sqlCalls(fetchMock);
    expect(calls.length).toBeGreaterThan(0);
    const stmt = JSON.parse((calls[0][1] as RequestInit).body as string).statement as string;
    expect(stmt).toContain("SELECT * FROM fleet.trips WHERE zone = 'East Village'");
  });

  it("CG-FM3: unknown spatial lonCol -> 400 naming it, no SQL", async () => {
    const res = await post(({ tableId }) => ({
      filters: [],
      spatialFilters: [SHAPE],
      spatialTarget: { tableId, spatialMode: "latlon", lonCol: "longitude", latCol: "lat" },
    }));
    expect(res.status).toBe(400);
    expect(res.body.column).toBe("longitude");
    expect(sqlCalls(fetchMock).length).toBe(0);
  });

  it("CG-FM4: unknown spatialCol -> 400 naming it, no SQL", async () => {
    const res = await post(({ tableId }) => ({
      filters: [],
      spatialFilters: [SHAPE],
      spatialTarget: { tableId, spatialMode: "wkt", spatialCol: "the_geom" },
    }));
    expect(res.status).toBe(400);
    expect(res.body.column).toBe("the_geom");
    expect(sqlCalls(fetchMock).length).toBe(0);
  });

  it("CG-FM5: prototype key 'constructor' -> 400 UNKNOWN_COLUMN, no SQL", async () => {
    const res = await post(() => ({ filters: f("constructor") }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("UNKNOWN_COLUMN");
    expect(sqlCalls(fetchMock).length).toBe(0);
  });

  it("CG-FM6: empty snapshot rejects every column", async () => {
    const res = await post(() => ({ filters: f("zone") }), { columns: {} });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("UNKNOWN_COLUMN");
    expect(sqlCalls(fetchMock).length).toBe(0);
  });

  it("CG-FM7: non-string column -> 400 UNKNOWN_COLUMN with column '5', no SQL", async () => {
    const res = await post(() => ({ filters: f(5) }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("UNKNOWN_COLUMN");
    expect(res.body.column).toBe("5");
    expect(sqlCalls(fetchMock).length).toBe(0);
  });

  it("CG-FM8: empty schema labels table as bare name", async () => {
    const res = await post(() => ({ filters: f("region") }), { schema: "" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Column "region" no longer exists on trips');
  });
});
