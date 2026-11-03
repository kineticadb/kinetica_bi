/**
 * routes.column-guard.tier-b.spec.ts — Phase 133 (AISAFE-V20-01, D-03).
 * CG-TB1..9: POST /api/quantile, /api/top-values, /api/column-stats reject malformed
 * identifiers and (for registered tables) unknown columns with 400 before any SQL;
 * DELETE /api/filter/materialize?viewName= only drops the caller's own filter views.
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
  data_str: JSON.stringify({ json_encoded_response: JSON.stringify({ column_headers: [] }) }),
};

const COLS = { id: "int", zone: "string", fare: "double", lon: "double", lat: "double" };

const sqlCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter((c) => String(c[0]).includes("/execute/sql"));

describe("column guard: tier-B routes + DELETE viewName (Phase 133)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubEnv("AUTH_MODE", "password");
    db.exec(
      "DELETE FROM export_jobs; DELETE FROM sessions; DELETE FROM widgets; DELETE FROM dashboard_table_views; DELETE FROM dashboard_tables; DELETE FROM tables; DELETE FROM dashboards;",
    );
    fetchMock = vi.fn().mockImplementation(
      async () => new Response(JSON.stringify(successKineticaBody), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    createDashboard("CG-TB Dashboard", "");
    createTable({ schema: "fleet", name: "trips", columns: COLS });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const post = async (path: string, body: Record<string, unknown>) => {
    const agent = await buildTestApp();
    const { cookie } = createAdminSession();
    return agent.post(path).set("Cookie", cookie).send(body);
  };
  const del = async (qs: string) => {
    const agent = await buildTestApp();
    const { cookie } = createAdminSession();
    return agent.delete(`/api/filter/materialize?${qs}`).set("Cookie", cookie);
  };
  const base = { schema: "fleet", table: "trips", column: "fare", n: 5 };

  it("CG-TB1: quantile malformed identifiers -> 400 INVALID_IDENTIFIER, no SQL", async () => {
    for (const bad of [
      { column: "x; DROP TABLE t" },
      { table: "t t" },
      { schema: "s;" },
    ]) {
      const res = await post("/api/quantile", { ...base, ...bad });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_IDENTIFIER");
    }
    expect(sqlCalls(fetchMock).length).toBe(0);
  });

  it("CG-TB2: quantile missing column on registered table -> 400 UNKNOWN_COLUMN, no SQL", async () => {
    const res = await post("/api/quantile", { ...base, column: "region" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("UNKNOWN_COLUMN");
    expect(sqlCalls(fetchMock).length).toBe(0);
  });

  it("CG-TB3: quantile on dynamic-view target (schema empty) is not rejected (non-regression)", async () => {
    const res = await post("/api/quantile", {
      schema: "",
      table: "_kbi_dv_uadmin_d1_7",
      column: "fare_amount",
      n: 5,
    });
    expect(res.status).not.toBe(400);
  });

  it("CG-TB4: top-values injected -> INVALID_IDENTIFIER; missing column -> UNKNOWN_COLUMN; no SQL", async () => {
    const a = await post("/api/top-values", { ...base, column: "x; DROP TABLE t" });
    expect(a.status).toBe(400);
    expect(a.body.code).toBe("INVALID_IDENTIFIER");
    const b = await post("/api/top-values", { ...base, column: "region" });
    expect(b.status).toBe(400);
    expect(b.body.code).toBe("UNKNOWN_COLUMN");
    expect(sqlCalls(fetchMock).length).toBe(0);
  });

  it("CG-TB5: column-stats injected -> INVALID_IDENTIFIER; missing column -> UNKNOWN_COLUMN; no SQL", async () => {
    const a = await post("/api/column-stats", { ...base, column: "x; DROP TABLE t" });
    expect(a.status).toBe(400);
    expect(a.body.code).toBe("INVALID_IDENTIFIER");
    const b = await post("/api/column-stats", { ...base, column: "region" });
    expect(b.status).toBe(400);
    expect(b.body.code).toBe("UNKNOWN_COLUMN");
    expect(sqlCalls(fetchMock).length).toBe(0);
  });

  it("CG-TB6: top-values on registered column still serves (non-regression)", async () => {
    const res = await post("/api/top-values", { ...base, column: "zone" });
    expect(res.status).not.toBe(400);
  });

  it("CG-TB7: DELETE viewName that is not a filter view -> 400 VIEWNAME_NOT_OWNED, no SQL", async () => {
    const res = await del("dashboardId=1&viewName=fleet.trips");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VIEWNAME_NOT_OWNED");
    expect(sqlCalls(fetchMock).length).toBe(0);
  });

  it("CG-TB8: DELETE viewName owned by another user -> 400 VIEWNAME_NOT_OWNED, no SQL", async () => {
    const res = await del("dashboardId=1&viewName=_kbi_filt_ubob_d1_t1_s12345678");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VIEWNAME_NOT_OWNED");
    expect(sqlCalls(fetchMock).length).toBe(0);
  });

  it("CG-TB9: DELETE own filter view still drops (non-regression)", async () => {
    const res = await del("dashboardId=1&viewName=_kbi_filt_uadmin_d1_t1_s12345678_cdeadbeef");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ dropped: true });
  });
});
