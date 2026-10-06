/**
 * lib.exportSql.spec.ts — Phase 128 Plan 04 (EXPRT-V126-05). Pure module, no DB.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildExportPlan,
  buildBatchRequest,
  buildHeaderProbeSql,
  EXPORT_PAGING_MECHANISM,
  ExportSpecError,
  type BuildExportPlanInput,
  type ExportSpec,
} from "../src/lib/exportSql";
import type { Widget } from "../src/types";
import type { ActiveFilter } from "../src/lib/whereClause";

const JOB = "ABCDEF12-3456-7890-abcd-ef1234567890";

function widget(cfg: Record<string, unknown> = {}, over: Partial<Widget> = {}): Widget {
  return {
    id: 7,
    dashboard_id: 3,
    title: "t",
    type: "records",
    position: 0,
    config: { tableId: 1, ...cfg },
    created_at: "",
    updated_at: "",
    ...over,
  };
}
const eqStr = (column: string, value: string): ActiveFilter => ({
  column,
  value,
  dataType: "string",
  addedAt: 0,
});
const eqNum = (column: string, value: number): ActiveFilter => ({
  column,
  value,
  dataType: "number",
  operator: "eq",
  addedAt: 0,
});

function plan(w: Widget | undefined, spec: Partial<ExportSpec> = {}, extra: Partial<BuildExportPlanInput> = {}) {
  return buildExportPlan({
    spec: { widgetId: 7, ...spec },
    widget: w,
    username: "alice",
    jobId: JOB,
    getTable: (id) => (id === 1 ? { name: "t", schema: "s" } : undefined),
    getDashboardDynamicView: (id) => (id === 5 ? { dashboard_id: 3 } : id === 6 ? { dashboard_id: 99 } : undefined),
    ...extra,
  });
}
const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return e instanceof ExportSpecError ? e.code : `other:${String(e)}`;
  }
  return undefined;
};

describe("buildExportPlan", () => {
  it("EXPSQL-table-source: table path FROM is schema.name from the tables row, not cfg.table", () => {
    expect(plan(widget({ table: "evil" })).source).toBe("s.t");
  });
  it("EXPSQL-table-fallback: no tableId falls back to an IDENT_RE-valid cfg.table", () => {
    expect(plan(widget({ tableId: undefined, table: "demo.nyctaxi" })).source).toBe("demo.nyctaxi");
    expect(code(() => plan(widget({ tableId: undefined, table: "a b; drop" })))).toBe("invalid_source");
  });
  it("EXPSQL-dv-source: dv path FROM is buildDynamicViewName(username, widget.dashboard_id, dynamicViewId)", () => {
    expect(plan(widget({ dynamicViewId: 5 })).source).toBe("_kbi_dv_ualice_d3_5");
  });
  it("EXPSQL-dv-wrong-dashboard: a dv from another dashboard throws ExportSpecError invalid_source", () => {
    expect(code(() => plan(widget({ dynamicViewId: 6 })))).toBe("invalid_source");
    expect(code(() => plan(widget({ dynamicViewId: 404 })))).toBe("invalid_source");
  });
  it("EXPSQL-dv-spatial: spatial filters on the dv path throw unsupported_filter", () => {
    expect(
      code(() =>
        plan(widget({ dynamicViewId: 5 }), {
          spatialFilters: [{ id: "a", wkt: "POINT(0 0)" }],
          spatialTarget: { tableId: 1, spatialMode: "wkt", spatialCol: "g" },
        }),
      ),
    ).toBe("unsupported_filter");
  });
  it("EXPSQL-snapshot-select-star: snapshot body is SELECT * (never a column list)", () => {
    const p = plan(widget({ columns: "a,b" }));
    expect(p.snapshotBody).toBe("SELECT * FROM s.t");
  });
  it("EXPSQL-where-filters-and-cw: filters and customWhere are ANDed, each parenthesised", () => {
    const p = plan(widget({ customWhere: "amount > 5" }), { filters: [eqStr("region", "East")] });
    expect(p.snapshotBody).toBe("SELECT * FROM s.t WHERE (region = 'East') AND (amount > 5)");
  });
  it("EXPSQL-no-where: no filters and blank customWhere -> no WHERE", () => {
    expect(plan(widget({ customWhere: "   " })).snapshotBody).not.toContain("WHERE");
  });
  it("EXPSQL-cw-only: whitespace-trimmed customWhere alone -> WHERE (<cw>)", () => {
    expect(plan(widget({ customWhere: "  x = 1  " })).snapshotBody).toBe("SELECT * FROM s.t WHERE (x = 1)");
  });
  it("EXPSQL-literal-escaping: a filter value with a quote is escaped by the builder", () => {
    const p = plan(widget(), { filters: [eqStr("name", "O'Brien")] });
    expect(p.snapshotBody).toContain("'O''Brien'");
  });
  it("EXPSQL-bad-filter-column: a filter column failing IDENT_RE throws invalid_column", () => {
    expect(code(() => plan(widget(), { filters: [eqNum("a; DROP TABLE x", 1)] }))).toBe("invalid_column");
  });
  it("EXPSQL-spatial-pair: spatialFilters without spatialTarget (and vice versa) throw invalid_filter", () => {
    expect(code(() => plan(widget(), { spatialFilters: [{ id: "a", wkt: "POINT(0 0)" }] }))).toBe("invalid_filter");
    expect(
      code(() => plan(widget(), { spatialTarget: { tableId: 1, spatialMode: "wkt", spatialCol: "g" } })),
    ).toBe("invalid_filter");
  });
  it("EXPSQL-spatial-table-mismatch: spatialTarget.tableId !== cfg.tableId throws invalid_filter", () => {
    expect(
      code(() =>
        plan(widget(), {
          spatialFilters: [{ id: "a", wkt: "POINT(0 0)" }],
          spatialTarget: { tableId: 2, spatialMode: "wkt", spatialCol: "g" },
        }),
      ),
    ).toBe("invalid_filter");
  });
  it("EXPSQL-wkb: spatialMode wkb throws unsupported_filter", () => {
    expect(
      code(() =>
        plan(widget(), {
          spatialFilters: [{ id: "a", wkt: "POINT(0 0)" }],
          spatialTarget: { tableId: 1, spatialMode: "wkb", spatialCol: "g" },
        }),
      ),
    ).toBe("unsupported_filter");
  });
  it("EXPSQL-columns: columns are cfg.columns trimmed, IDENT_RE-filtered, in configured order", () => {
    expect(plan(widget({ columns: " b , a,1bad, c.d ,," })).columns).toEqual(["b", "a", "c.d"]);
  });
  it("EXPSQL-columns-empty: no cfg.columns -> plan.columns is []", () => {
    expect(plan(widget()).columns).toEqual([]);
  });
  it("EXPSQL-sort-spec-wins: spec.sortField/sortDir override the persisted sort", () => {
    const p = plan(widget({ sortField: "a", sortDirection: "asc" }), { sortField: "b", sortDir: "desc" });
    expect([p.sortField, p.sortDir]).toEqual(["b", "DESC"]);
  });
  it("EXPSQL-sort-fallback: no spec sort -> cfg.sortField + cfg.sortDirection (asc default)", () => {
    expect(plan(widget({ sortField: "a", sortDirection: "DESC" })).sortDir).toBe("DESC");
    const p = plan(widget({ sortField: "a" }));
    expect([p.sortField, p.sortDir]).toEqual(["a", "ASC"]);
    expect(plan(widget({ sortField: "bad col" })).sortField).toBeNull();
    expect(plan(widget()).sortField).toBeNull();
  });
  it("EXPSQL-sort-invalid: a spec sortField failing IDENT_RE or sortDir not asc/desc throws invalid_sort", () => {
    expect(code(() => plan(widget(), { sortField: "a b" }))).toBe("invalid_sort");
    expect(code(() => plan(widget(), { sortField: "a", sortDir: "up" as never }))).toBe("invalid_sort");
  });
  it("EXPSQL-not-records: a widget whose type is not records throws not_records_table", () => {
    expect(code(() => plan(widget({}, { type: "bar" })))).toBe("not_records_table");
    expect(code(() => plan(undefined))).toBe("widget_not_found");
  });
  it("EXPSQL-names: snapshotView is _kbi_exp_<id8>; countSql counts it", () => {
    const p = plan(widget());
    expect(p.snapshotView).toBe("_kbi_exp_abcdef12");
    expect(p.countSql).toBe("SELECT COUNT(*) AS total FROM _kbi_exp_abcdef12");
  });
});

describe("paging mechanism and batch requests", () => {
  const pg = (cfg: Record<string, unknown> = {}, spec: Partial<ExportSpec> = {}) =>
    plan(widget(cfg), spec, { mechanism: "paging_table" });
  const off = (cfg: Record<string, unknown> = {}, spec: Partial<ExportSpec> = {}) =>
    plan(widget(cfg), spec, { mechanism: "offset" });

  it("EXPSQL-mechanism-matches-spike: EXPORT_PAGING_MECHANISM equals the approved decision", () => {
    const notes = readFileSync(
      resolve(
        __dirname,
        "../../../.planning/phases/128-export-job-core-live-spike-runner-snapshot-cancel/128-SPIKE-NOTES.md",
      ),
      "utf8",
    );
    const m = /\*\*Chosen mechanism:\*\* (paging_table|offset)/.exec(notes);
    expect(m).not.toBeNull();
    expect(EXPORT_PAGING_MECHANISM).toBe(m![1]);
  });
  it("EXPSQL-probe: header probe is SELECT * FROM <snapshotView>", () => {
    expect(buildHeaderProbeSql(off())).toBe("SELECT * FROM _kbi_exp_abcdef12");
  });
  it("EXPSQL-paging-batch: paging_table path uses sort + paging_table options", () => {
    const p = pg({ columns: "a,b", sortField: "a", sortDirection: "desc" });
    const r = buildBatchRequest(p, [], 40000, 20000, 30);
    expect(r.sql).toBe("SELECT a, b FROM _kbi_exp_abcdef12 ORDER BY a DESC");
    expect(r.extra).toEqual({
      offset: 40000,
      limit: 20000,
      options: { paging_table: "_kbi_exp_abcdef12_pg", paging_table_ttl: "30" },
    });
  });
  it("EXPSQL-paging-no-sort: paging_table path with no sort has no ORDER BY", () => {
    expect(buildBatchRequest(pg({ columns: "a" }), [], 0, 10, 30).sql).not.toContain("ORDER BY");
  });
  it("EXPSQL-offset-tiebreak: offset path appends every other exported column", () => {
    const p = off({ columns: "a,f,b" }, { sortField: "f", sortDir: "desc" });
    const r = buildBatchRequest(p, [], 20000, 20000, 30);
    expect(r.sql).toBe("SELECT a, f, b FROM _kbi_exp_abcdef12 ORDER BY f DESC, a, b");
    expect(r.extra).toEqual({ offset: 20000, limit: 20000 });
    expect("options" in r.extra).toBe(false);
  });
  it("EXPSQL-offset-no-sort: offset path with no sort -> ORDER BY every exported column in order", () => {
    const r = buildBatchRequest(off({ columns: "c,a,b" }), [], 0, 5, 30);
    expect(r.sql).toBe("SELECT c, a, b FROM _kbi_exp_abcdef12 ORDER BY c, a, b");
  });
  it("EXPSQL-offset-select-star: empty columns -> SELECT * and tiebreak uses probed IDENT_RE headers", () => {
    const r = buildBatchRequest(off({}, { sortField: "b" }), ["a", "b", "weird col", "c"], 0, 5, 30);
    expect(r.sql).toBe("SELECT * FROM _kbi_exp_abcdef12 ORDER BY b ASC, a, c");
  });
  it("EXPSQL-no-sql-limit: the batch SQL never contains LIMIT or OFFSET", () => {
    for (const p of [pg({ columns: "a" }), off({ columns: "a" }), off()]) {
      const sql = buildBatchRequest(p, ["a"], 100, 50, 30).sql;
      expect(sql).not.toMatch(/\b(LIMIT|OFFSET)\b/i);
    }
  });
});
