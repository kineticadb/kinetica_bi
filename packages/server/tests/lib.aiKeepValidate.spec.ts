/**
 * lib.aiKeepValidate.spec.ts - Phase 141 Plan 07 (AISES-V20-05): server-side re-validation of a Keep request.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import type { AiKeepRequest, AiDvSpec } from "@kinetica-bi/shared";
import {
  createDashboard,
  createWidget,
  createTable,
  addDashboardTable,
  createDashboardLayer,
  createDashboardDynamicView,
} from "../src/db";
import { requiredRights, missingRights, checkKeepChange, prepareKeep, type KeepPrepareDeps, type KeepPrepareResult } from "../src/lib/aiKeepValidate";
import { compileAiDvSpec, type AiDvTable } from "../src/lib/aiDvCompile";
import { substituteViewToken } from "../src/lib/dynamicViewSql";

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const CANARY = "CANARY_KVAL_141";

let D = 0, E = 0, T = 0, T2 = 0, X = 0, W1 = 0, WA = 0, W3 = 0, WE = 0, L1 = 0, LE = 0, V1 = 0, VE = 0;

beforeAll(() => {
  D = createDashboard(`kval-d-${uniq()}`).id;
  E = createDashboard(`kval-e-${uniq()}`).id;
  T = createTable({ name: `kv_t_${uniq()}`, schema: "public" }).id;
  T2 = createTable({ name: `kv_t2_${uniq()}`, schema: "public" }).id;
  X = createTable({ name: `kv_x_${uniq()}`, schema: "public" }).id;
  addDashboardTable(D, T);
  addDashboardTable(D, T2);
  addDashboardTable(E, X);
  const w = (dash: number, type: string, config: Record<string, unknown> = {}) =>
    createWidget(dash, { title: "w", type: type as any, position: 0, config: config as any }).id;
  W1 = w(D, "bar", { tableId: T });
  WA = w(D, "ai");
  W3 = w(D, "records", { tableId: T });
  WE = w(E, "bar", { tableId: X });
  L1 = createDashboardLayer(D, { table_id: T }).id;
  LE = createDashboardLayer(E, { table_id: X }).id;
  const dv = (dash: number, t: number) =>
    createDashboardDynamicView(dash, { source_table_id: t, name: `v${uniq()}`, template_sql: "SELECT 1 FROM {view}", max_records: 10, columns_json: [] }).id;
  V1 = dv(D, T);
  VE = dv(E, X);
});

const empty = (): AiKeepRequest => ({
  baselineVersion: 0,
  dynamicViews: { add: [], remove: [] },
  layers: { add: [], edit: [], remove: [] },
  widgets: { add: [], edit: [], remove: [] },
});
const rect = { x: 0, y: 0, w: 4, h: 3 };
const withReq = (p: { dv?: Partial<AiKeepRequest["dynamicViews"]>; l?: Partial<AiKeepRequest["layers"]>; w?: Partial<AiKeepRequest["widgets"]> }): AiKeepRequest => {
  const r = empty();
  return { ...r, dynamicViews: { ...r.dynamicViews, ...p.dv }, layers: { ...r.layers, ...p.l }, widgets: { ...r.widgets, ...p.w } };
};
const wAdd = (tempId: number, config: Record<string, unknown>, type: any = "bar") => ({ tempId, type, title: "t", config, rect });
const reasonsOf = (r: ReturnType<typeof checkKeepChange>) => (r.ok ? [] : r.reasons);
const spec = (baseTableId: number, joins?: number[]) => ({
  baseTableId,
  groupBy: [{ column: "vendor" }],
  aggregates: [{ fn: "count" as const, as: "n" }],
  ...(joins ? { joins: joins.map((tableId) => ({ tableId, type: "inner" as const, on: [{ left: "vendor", right: "id" }] })) } : {}),
});

describe("requiredRights / missingRights", () => {
  it("KVAL-1: rights follow the real change set", () => {
    expect([...requiredRights(empty())].sort()).toEqual(["dashboards:edit"]);
    expect(requiredRights(withReq({ w: { add: [wAdd(-1, {})] } })).has("widgets:configure")).toBe(true);
    expect(requiredRights(withReq({ w: { remove: [W1] } })).has("widgets:configure")).toBe(true);
    const l = requiredRights(withReq({ l: { edit: [{ id: L1 }] } }));
    expect(l.has("layers:manage")).toBe(true);
    expect(l.has("widgets:configure")).toBe(false);
    const d = requiredRights(withReq({ dv: { remove: [V1] } }));
    expect(d.has("dynamic_views:manage")).toBe(true);
    expect(d.has("layers:manage")).toBe(false);
    const all = requiredRights(withReq({ dv: { remove: [V1] }, l: { remove: [L1] }, w: { remove: [W1] } }));
    expect([...all].sort()).toEqual(["dashboards:edit", "dynamic_views:manage", "layers:manage", "widgets:configure"]);
  });

  it("KVAL-2: the first missing right is named in the fixed order; dashboards:edit never listed", () => {
    const req = new Set(["dashboards:edit", "dynamic_views:manage", "layers:manage", "widgets:configure"]);
    expect(missingRights(req, new Set(["dashboards:edit", "widgets:configure"]))).toEqual(["dynamic_views:manage", "layers:manage"]);
    expect(missingRights(req, new Set())).toEqual(["dynamic_views:manage", "layers:manage", "widgets:configure"]);
  });
});

describe("checkKeepChange", () => {
  it("KVAL-3: forged ids on another dashboard or missing are refused", () => {
    const r = reasonsOf(
      checkKeepChange(D, withReq({ w: { edit: [{ id: WE, title: "x" }], remove: [999999] }, l: { edit: [{ id: LE }], remove: [999998] }, dv: { remove: [VE] } })),
    );
    expect(r).toContain(`widget ${WE} is not on this dashboard`);
    expect(r).toContain(`widget 999999 is not on this dashboard`);
    expect(r).toContain(`layer ${LE} is not on this dashboard`);
    expect(r).toContain(`layer 999998 is not on this dashboard`);
    expect(r).toContain(`dynamic view ${VE} is not on this dashboard`);
  });

  it("KVAL-4: the ai widget can't be edited or removed", () => {
    const m = "the AI assistant widget can't be changed by Keep";
    expect(reasonsOf(checkKeepChange(D, withReq({ w: { edit: [{ id: WA, title: "x" }] } })))).toContain(m);
    expect(reasonsOf(checkKeepChange(D, withReq({ w: { remove: [WA] } })))).toContain(m);
  });

  it("KVAL-5: only bar/line/pie may retype", () => {
    expect(reasonsOf(checkKeepChange(D, withReq({ w: { edit: [{ id: W3, type: "bar" }] } })))).toContain("only bar, line and pie charts can change type");
    expect(checkKeepChange(D, withReq({ w: { edit: [{ id: W1, type: "pie" }] } })).ok).toBe(true);
  });

  it("KVAL-6: identity keys, customWhere and prototype keys are blocked", () => {
    const bad = (r: AiKeepRequest) => expect(checkKeepChange(D, r).ok).toBe(false);
    bad(withReq({ w: { add: [wAdd(-1, { customWhere: "1=1" })] } }));
    for (const k of [{ id: 5 }, { position: 2 }, { type: "x" }, { table_id: 5 }]) bad(withReq({ w: { edit: [{ id: W1, configSet: k }] } }));
    bad(withReq({ w: { edit: [{ id: W1, configUnset: ["dashboard_id"] }] } }));
    bad(withReq({ w: { add: [wAdd(-1, JSON.parse('{"a":{"__proto__":{"x":1}}}'))] } }));
    expect(checkKeepChange(D, withReq({ w: { edit: [{ id: W1, configSet: { tableId: T } }] } })).ok).toBe(true);
  });

  it("KVAL-7: tables must be on the dashboard", () => {
    const m = `table ${X} isn't on this dashboard`;
    expect(reasonsOf(checkKeepChange(D, withReq({ w: { add: [wAdd(-1, { tableId: X })] } })))).toContain(m);
    expect(reasonsOf(checkKeepChange(D, withReq({ l: { add: [{ tempId: -1, tableId: X, config: {} }] } })))).toContain(m);
    expect(reasonsOf(checkKeepChange(D, withReq({ dv: { add: [{ tempId: -1, name: "v", spec: spec(X) }] } })))).toContain(m);
    expect(reasonsOf(checkKeepChange(D, withReq({ dv: { add: [{ tempId: -1, name: "v", spec: spec(T, [X]) }] } })))).toContain(m);
  });

  it("KVAL-8: references resolve inside the request or on this dashboard", () => {
    expect(reasonsOf(checkKeepChange(D, withReq({ w: { add: [wAdd(-1, { dynamicViewId: -9 })] } })))).toContain("temporary dynamic view -9 is not part of this change");
    expect(checkKeepChange(D, withReq({ l: { add: [{ tempId: -2, tableId: T, config: {} }] }, w: { add: [wAdd(-1, { includedLayerIds: [-2] })] } })).ok).toBe(true);
    expect(reasonsOf(checkKeepChange(D, withReq({ w: { add: [wAdd(-1, { includedLayerIds: [LE] })] } })))).toContain(`layer ${LE} is not on this dashboard`);
    expect(reasonsOf(checkKeepChange(D, withReq({ w: { add: [wAdd(-1, { dynamicViewId: VE })] } })))).toContain(`dynamic view ${VE} is not on this dashboard`);
    expect(checkKeepChange(D, withReq({ w: { add: [wAdd(-1, {}), wAdd(-2, { sourceMapWidgetId: -1 })] } })).ok).toBe(true);
    expect(checkKeepChange(D, withReq({ w: { add: [wAdd(-1, { filterSelection: { sourceMode: "selected", allowedSourceWidgetIds: [-7] } })] } })).ok).toBe(false);
    expect(
      checkKeepChange(D, withReq({ dv: { add: [{ tempId: -3, name: "v", spec: spec(T) }] }, l: { add: [{ tempId: -1, tableId: T, config: {}, dynamicViewId: -3 }] } })).ok,
    ).toBe(true);
    expect(checkKeepChange(D, withReq({ l: { edit: [{ id: L1, dynamicViewId: V1 }] } })).ok).toBe(true);
    const w = checkKeepChange(D, withReq({ w: { edit: [{ id: W1, configSet: { includedLayerIds: [L1] } }], remove: [W3] }, l: { remove: [L1] } }));
    expect(w.ok).toBe(true);
    if (w.ok) expect(w.warnings).toEqual(["1 saved references point at removed items"]);
  });

  it("KVAL-9: a full valid change set passes", () => {
    const r = withReq({
      dv: { add: [{ tempId: -3, name: "Trips", spec: spec(T) }], remove: [V1] },
      l: { add: [{ tempId: -2, tableId: T, config: { renderMode: "points" }, dynamicViewId: -3 }], edit: [{ id: L1, configSet: { visible: true } }] },
      w: {
        add: [wAdd(-1, { tableId: T, includedLayerIds: [-2] }), wAdd(-4, { dynamicViewId: -3 })],
        edit: [{ id: W1, title: "renamed", type: "line", configSet: { tableId: T2 }, configUnset: ["old"], rect }],
        remove: [W3],
      },
    });
    expect(checkKeepChange(D, r)).toEqual({ ok: true, warnings: [] });
  });

  it("KVAL-10: reasons and warnings never carry config values", () => {
    const bad = checkKeepChange(D, withReq({ w: { add: [wAdd(-1, { customWhere: CANARY, tableId: X, note: CANARY })] } }));
    expect(bad.ok).toBe(false);
    expect(JSON.stringify(bad)).not.toContain(CANARY);
    const ok = checkKeepChange(D, withReq({ w: { add: [wAdd(-1, { note: CANARY })] } }));
    expect(JSON.stringify(ok)).not.toContain(CANARY);
  });
});

// ---------------------------------------------------------------------------------------------
describe("prepareKeep", () => {
  const LIMITS = { maxRecords: 100000, maxJoins: 2 };
  const COLS_T = [
    { name: "vendor", type: "string" },
    { name: "fare", type: "double" },
    { name: "pickup", type: "timestamp" },
  ];
  const COLS_T2 = [
    { name: "id", type: "int" },
    { name: "borough", type: "string" },
  ];
  const mkDeps = (over: Partial<KeepPrepareDeps> = {}) => {
    const describeTable = vi.fn(async (id: number) =>
      id === T
        ? { ok: true as const, table: { schema: "public", name: "tbl_t", columns: COLS_T } }
        : id === T2
          ? { ok: true as const, table: { schema: "public", name: "tbl_t2", columns: COLS_T2 } }
          : { ok: false as const },
    );
    const deps: KeepPrepareDeps = { describe: describeTable, limits: LIMITS, savedDvColumns: () => null, ...over };
    return { deps, describeTable };
  };
  const tableT = (): AiDvTable => ({ tableId: T, ref: "public.tbl_t", columns: COLS_T });
  const tableT2 = (): AiDvTable => ({ tableId: T2, ref: "public.tbl_t2", columns: COLS_T2 });
  const sumSpec = (): AiDvSpec => ({ baseTableId: T, groupBy: [{ column: "vendor" }], aggregates: [{ fn: "sum", column: "fare", as: "total" }] });
  const joinSpec = (): AiDvSpec => ({
    baseTableId: T,
    joins: [{ tableId: T2, type: "inner", on: [{ left: "vendor", right: "borough" }] }],
    groupBy: [{ column: "vendor" }],
    aggregates: [{ fn: "count", as: "n" }],
  });
  const dvReq = (s: AiDvSpec, extra: Parameters<typeof withReq>[0] = {}) =>
    withReq({ ...extra, dv: { add: [{ tempId: -5, name: "Trips", spec: s }] } });
  const reasons = (r: KeepPrepareResult) => (r.ok ? [] : r.reasons);

  it("KVAL-11: a dv add is recompiled server-side from the spec", async () => {
    const { deps } = mkDeps();
    const r = await prepareKeep(dvReq(sumSpec()), deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const compiled = compileAiDvSpec(sumSpec(), [tableT()], LIMITS);
    expect(r.prepared.dynamicViews).toEqual([
      { tempId: -5, name: "Trips", sourceTableId: T, templateSql: compiled.template, maxRecords: 100000, columns: compiled.columns },
    ]);
    expect(r.prepared.dynamicViews[0].templateSql).toContain("{view}");
    expect(() => substituteViewToken(r.prepared.dynamicViews[0].templateSql, "_dummy_validation_view_name_")).not.toThrow();
    expect(r.prepared.warnings).toEqual([]);
  });

  it("KVAL-12: joined views use the raw-join template and warn (139 D-21)", async () => {
    const { deps } = mkDeps();
    const r = await prepareKeep(dvReq(joinSpec()), deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.prepared.dynamicViews[0].templateSql).toBe(compileAiDvSpec(joinSpec(), [tableT(), tableT2()], LIMITS).template);
    expect(r.prepared.dynamicViews[0].templateSql).toContain("public.tbl_t2");
    expect(r.prepared.warnings).toEqual(["Saved views read joined tables without their filters."]);
  });

  it("KVAL-13: dv limits and spec shape errors are refused", async () => {
    const { deps } = mkDeps();
    expect(reasons(await prepareKeep(dvReq({ ...sumSpec(), limit: 200000 }), deps))).toContain("limit 200000 is over the 100000-row ceiling");
    const j = { tableId: T2, type: "inner" as const, on: [{ left: "vendor", right: "borough" }] };
    expect(reasons(await prepareKeep(dvReq({ ...joinSpec(), joins: [j, j, j] }), deps))).toContain("a view can join at most 2 tables");
    const both: AiDvSpec = { ...sumSpec(), columns: [{ column: "vendor" }] };
    expect(reasons(await prepareKeep(dvReq(both), deps))).toContain("use columns for a row view, or groupBy/aggregates for a summary, not both");
  });

  it("KVAL-14: referenced columns must exist (live table, compiled temp dv, saved dv)", async () => {
    const { deps } = mkDeps();
    expect(reasons(await prepareKeep(withReq({ w: { add: [wAdd(-1, { tableId: T, groupByColumn: "fare_x" })] } }), deps))).toContain(`column fare_x is not on table ${T}`);
    expect(reasons(await prepareKeep(withReq({ w: { add: [wAdd(-1, { tableId: T, groupByColumn: "vendor" })] } }), deps))).toEqual([]);

    // edit: only the configSet's own refs are checked
    const odd = createWidget(D, { title: "odd", type: "bar" as any, position: 0, config: { tableId: T, groupByColumn: "odd_legacy" } as any }).id;
    expect((await prepareKeep(withReq({ w: { edit: [{ id: odd, configSet: { note: 1 } }] } }), deps)).ok).toBe(true);
    expect(reasons(await prepareKeep(withReq({ w: { edit: [{ id: W1, configSet: { metric: "nope" } }] } }), deps))).toContain(`column nope is not on table ${T}`);

    expect(reasons(await prepareKeep(withReq({ l: { add: [{ tempId: -1, tableId: T, config: { valueColumn: "nope" } }] } }), deps))).toContain(`column nope is not on table ${T}`);

    // temp dv: compiled output columns (vendor, total)
    const onTemp = (cfg: Record<string, unknown>) => dvReq(sumSpec(), { w: { add: [wAdd(-1, { dynamicViewId: -5, ...cfg })] } });
    expect((await prepareKeep(onTemp({ groupByColumn: "vendor", metric: "total" }), deps)).ok).toBe(true);
    expect(reasons(await prepareKeep(onTemp({ groupByColumn: "fare" }), deps))).toContain("column fare is not on dynamic view -5");

    // saved dv
    const saved = mkDeps({ savedDvColumns: (id) => (id === V1 ? [{ name: "vendor" }] : null) });
    const onSaved = (id: number, col: string) => withReq({ w: { add: [wAdd(-1, { dynamicViewId: id, groupByColumn: col })] } });
    expect(reasons(await prepareKeep(onSaved(V1, "fare"), saved.deps))).toContain(`column fare is not on dynamic view ${V1}`);
    expect((await prepareKeep(onSaved(V1, "vendor"), saved.deps)).ok).toBe(true);
    expect((await prepareKeep(onSaved(VE, "anything"), saved.deps)).ok).toBe(true); // null -> check skipped
  });

  it("KVAL-15: describe failures are named; describe is deduped and skipped for removals", async () => {
    const bad = mkDeps({ describe: vi.fn(async () => ({ ok: false as const })) });
    expect(reasons(await prepareKeep(dvReq(sumSpec()), bad.deps))).toContain(`table ${T} is not available`);

    const { deps, describeTable } = mkDeps();
    const r = await prepareKeep(dvReq(sumSpec(), { w: { add: [wAdd(-1, { tableId: T, groupByColumn: "vendor" }), wAdd(-2, { tableId: T, metric: "fare" })] } }), deps);
    expect(r.ok).toBe(true);
    expect(describeTable).toHaveBeenCalledTimes(1);

    const rem = mkDeps();
    expect((await prepareKeep(withReq({ w: { remove: [W3] }, l: { remove: [L1] }, dv: { remove: [V1] } }), rem.deps)).ok).toBe(true);
    expect(rem.describeTable).not.toHaveBeenCalled();
  });

  it("KVAL-16: only spec, name and tempId of a dv add drive the result", async () => {
    const { deps } = mkDeps();
    const a = await prepareKeep(dvReq(sumSpec()), deps);
    const b = await prepareKeep(dvReq(sumSpec(), { w: { add: [wAdd(-1, { tableId: T, groupByColumn: "vendor", maxRecords: 1, templateSql: "DROP" })] } }), deps);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(b.prepared).toEqual(a.prepared);
  });
});
