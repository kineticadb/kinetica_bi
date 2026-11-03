import { describe, it, expect } from "vitest";
import { toSessionDvRows, type SessionDvRowCtx } from "./sessionDvRows";
import type { SessionDv } from "../aiSession/types";

const spec = { baseTableId: 5, groupBy: [{ column: "pickup_datetime", bucket: "hour" as const }], aggregates: [{ fn: "count" as const, as: "trips" }] };
const trips = [{ name: "trips", type: "long" }];
const view = (over: Partial<SessionDv> = {}): SessionDv => ({
  id: -3, name: "Trips by hour", spec, baseTableId: 5, columns: trips, maxRecords: 100000, aggregated: true, ...over,
});
const tables = [{ id: 5, schema: "demo", name: "trips", columns: { pickup_datetime: "timestamp", vendor: "string" } }];
const ctx = (over: Partial<SessionDvRowCtx> = {}): SessionDvRowCtx => ({
  dashboardId: 12, nonce: "0a1b2c3d", gen: { [-3]: 2 }, columns: {}, tables, ...over,
});

describe("toSessionDvRows (139-11)", () => {
  it("ROWDV-1: maps a session view to a DynamicViewRow with ai metadata", () => {
    expect(toSessionDvRows([view()], ctx())).toEqual([
      {
        id: -3, dashboard_id: 12, source_table_id: 5, name: "Trips by hour", template_sql: "", max_records: 100000,
        columns_json: trips, aggregated: true, created_at: "", updated_at: "",
        ai: { nonce: "0a1b2c3d", gen: 2, spec, baseLabel: "demo.trips", suggestColumn: { name: "pickup_datetime", kind: "date" } },
      },
    ]);
  });

  it("ROWDV-2: falls back to server columns, default cap, gen 0", () => {
    const srv = [{ name: "from_server", type: "long" }];
    const [r] = toSessionDvRows([view({ columns: [], maxRecords: undefined })], ctx({ columns: { [-3]: srv }, gen: {} }));
    expect(r.columns_json).toEqual(srv);
    expect(r.max_records).toBe(100000);
    expect(r.ai?.gen).toBe(0);
    const [n] = toSessionDvRows([view({ columns: [] })], ctx({ columns: {} }));
    expect(n.columns_json).toBeNull();
  });

  it("ROWDV-3: suggestColumn prefers date, then string, else undefined", () => {
    const t2 = [{ id: 5, schema: "demo", name: "trips", columns: { vendor: "string", n: "int" } }];
    expect(toSessionDvRows([view()], ctx({ tables: t2 }))[0].ai?.suggestColumn).toEqual({ name: "vendor", kind: "string" });
    const t3 = [{ id: 5, schema: "demo", name: "trips", columns: { n: "int" } }];
    expect(toSessionDvRows([view()], ctx({ tables: t3 }))[0].ai?.suggestColumn).toBeUndefined();
  });

  it("ROWDV-4: same input identities give the same array identity", () => {
    const views = [view()];
    const c = ctx();
    expect(toSessionDvRows(views, c)).toBe(toSessionDvRows(views, { ...c }));
    expect(toSessionDvRows(views, c)).not.toBe(toSessionDvRows([view()], c));
  });
});
