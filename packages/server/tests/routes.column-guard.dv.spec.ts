/**
 * routes.column-guard.dv.spec.ts — Phase 133 (AISAFE-V20-01), plan 133-09.
 * CG-DV1..4: the dynamic-view path of POST /api/filter/materialize checks filter columns
 * against the dv's materialized view columns (Kinetica `SELECT * FROM <view> LIMIT 0`,
 * S1 decision), never the client-asserted columns_json.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildTestApp } from "./helpers/app";
import { createAdminSession } from "./helpers/db";
import { db, createDashboard, createTable, createDashboardDynamicView } from "../src/db";

const kbody = (result: unknown) => ({
  status: "OK",
  message: "",
  data_type: "execute_sql_response",
  data_str: JSON.stringify({ json_encoded_response: JSON.stringify(result) }),
});
const PROBE_RESULT = { column_headers: ["zone", "fare"], column_1: [], column_2: [] };

const stmtOf = (c: unknown[]) => JSON.parse((c[1] as RequestInit).body as string).statement as string;
const sqlStatements = (m: ReturnType<typeof vi.fn>) =>
  m.mock.calls.filter((c) => String(c[0]).includes("/execute/sql")).map((c) => stmtOf(c));
const createStatements = (m: ReturnType<typeof vi.fn>) => sqlStatements(m).filter((s) => s.includes("CREATE"));
const probeStatements = (m: ReturnType<typeof vi.fn>) => sqlStatements(m).filter((s) => /LIMIT 0/.test(s));

describe("POST /api/filter/materialize dv-path column guard (Phase 133)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubEnv("AUTH_MODE", "password");
    for (const t of ["sessions", "dashboard_dynamic_views", "dashboard_table_views", "dashboard_tables", "tables", "dashboards"]) {
      db.exec(`DELETE FROM ${t}`);
    }
    fetchMock = vi.fn().mockImplementation(async (_url: unknown, init?: RequestInit) => {
      const stmt = JSON.parse(String(init?.body ?? "{}")).statement as string | undefined;
      const body = stmt && /LIMIT 0/.test(stmt) ? kbody(PROBE_RESULT) : kbody({});
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const setup = async () => {
    const agent = await buildTestApp();
    const dash = createDashboard("CG DV", "");
    const tbl = createTable({ name: "trips", schema: "fleet", columns: { zone: "string" } });
    const dv = createDashboardDynamicView(dash.id, {
      source_table_id: tbl.id,
      name: "Trips by zone",
      template_sql: "SELECT * FROM {view}",
      max_records: 0,
    });
    const { cookie } = createAdminSession();
    const post = (column: unknown, value = "East Village") =>
      agent
        .post("/api/filter/materialize")
        .set("Cookie", cookie)
        .send({ dashboardId: dash.id, dynamicViewId: dv.id, filters: [{ column, value, dataType: "string", addedAt: 0 }] });
    return { post };
  };

  it("CG-DV1: unknown column -> 400, D-02 message, no CREATE", async () => {
    const { post } = await setup();
    const res = await post("region");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Column "region" no longer exists on dynamic view "Trips by zone"');
    expect(res.body.code).toBe("UNKNOWN_COLUMN");
    expect(createStatements(fetchMock).length).toBe(0);
  });

  it("CG-DV2: valid column still produces the same CREATE", async () => {
    const { post } = await setup();
    const res = await post("zone");
    expect(res.status).toBe(200);
    const creates = createStatements(fetchMock);
    expect(creates.length).toBe(1);
    expect(creates[0]).toContain("SELECT * FROM _kbi_dv_u");
    expect(creates[0]).toContain("WHERE zone = 'East Village'");
  });

  it("CG-DV3: two valid drills on the same dv probe once (cache)", async () => {
    const { post } = await setup();
    expect((await post("zone")).status).toBe(200);
    expect((await post("fare", "3")).status).toBe(200);
    expect(probeStatements(fetchMock).length).toBe(1);
  });

  it("CG-DV4: prototype key 'constructor' -> 400 UNKNOWN_COLUMN, no CREATE", async () => {
    const { post } = await setup();
    const res = await post("constructor");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("UNKNOWN_COLUMN");
    expect(createStatements(fetchMock).length).toBe(0);
  });
});
