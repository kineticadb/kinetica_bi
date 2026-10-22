/**
 * lib.aiKeepValidate.spec.ts - Phase 141 Plan 07 (AISES-V20-05): server-side re-validation of a Keep request.
 */
import { describe, it, expect, beforeAll } from "vitest";
import type { AiKeepRequest } from "@kinetica-bi/shared";
import {
  createDashboard,
  createWidget,
  createTable,
  addDashboardTable,
  createDashboardLayer,
  createDashboardDynamicView,
} from "../src/db";
import { requiredRights, missingRights, checkKeepChange } from "../src/lib/aiKeepValidate";

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
