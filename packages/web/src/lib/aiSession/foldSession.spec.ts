import { describe, it, expect } from "vitest";
import { evaluateTurn, foldSession, makeSessionWidget } from "./foldSession";
import { applyFilterRaw, clearFilterRaw } from "../../test/aiSessionHarness";
import { addLayerOp, addChartOp, setLayoutOp, changeTypeOp, setTitleOp, baselineFixture, savedLayer } from "../../test/aiSessionHarness";
import { paletteColor } from "../aiPalette";
import { EMPTY_DERIVED } from "./constants";
import { computeChangeCounts } from "./changeCounts";
import { patchLayerOp, removeLayerOp, mapWidget as mapW } from "../../test/aiSessionHarness";
import type { SessionBaseline, TurnEntry } from "./types";
import type { WidgetDto, DashboardLayerDto } from "../../api/client";

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
}
const w = (id: number, type: string, config: Record<string, unknown> = {}): WidgetDto => ({
  id, dashboard_id: 1, title: `w${id}`, type, position: 0, config, created_at: "", updated_at: "",
});
const l = (id: number): DashboardLayerDto => ({
  id, dashboard_id: 1, table_id: 5, layer_type: "KineticaWms", position: 0, config: {},
  info_enabled: 0, info_columns: null, info_template: null, dynamic_view_id: null,
  cb_config: null, track_config: null, created_at: "", updated_at: "",
});
const baseline: SessionBaseline = deepFreeze({
  dashboardId: 1,
  widgets: [w(42, "map"), w(43, "map", { includedLayerIds: [7] }), w(50, "records")],
  layers: [{ ...l(7), config: { renderMode: "heatmap" } }, l(8)],
  dynamicViewIds: [90],
});
const patch = (kind: string, id: number, configPatch: Record<string, unknown>) => ({
  op: "patch", action: { target: { kind, id }, configPatch },
});
const turn = (ops: unknown[], prior: TurnEntry[] = [], opts: { removalApproved?: boolean } = {}) =>
  evaluateTurn(baseline, prior, ops, opts);

describe("evaluateTurn", () => {
  it("EVAL-1: invalid op is skipped with detail, never throws", () => {
    const [e] = turn([{ op: "patch" }]);
    expect(e.op).toBeNull();
    expect(e.result).toMatchObject({ status: "skipped", reason: "invalid_op" });
    expect((e.result as { detail?: string }).detail).toBeTruthy();
  });
  it("EVAL-2: dynamic view ops (139): a valid add applies; removing a saved view needs approval", () => {
    const dvSpec = { baseTableId: 5, groupBy: [{ column: "payment_type" }], aggregates: [{ fn: "count", as: "trips" }] };
    const b = { ...baseline, tables: baselineFixture().tables };
    const es = evaluateTurn(b, [], [{ op: "add_dynamic_view", tempId: -9, name: "Trips", spec: dvSpec }, { op: "remove_dynamic_view", id: 90 }]);
    expect(es[0].result.status).toBe("applied");
    expect(es[1].result).toMatchObject({ status: "skipped", reason: "needs_confirmation" });
  });
  it("EVAL-3: missing targets are target_not_found; prior-turn temp target applies", () => {
    const es = turn([
      patch("widget", 999, { show_popup: true }), { op: "remove_widget", id: 999 }, { op: "remove_layer", id: 999 },
      { op: "remove_widget", id: 50 }, patch("widget", 50, { page_size: 10 }),
    ], [], { removalApproved: true }); // D-06: saved removal approved; this test is about target lookup
    expect(es.slice(0, 3).map((e) => (e.result as { reason?: string }).reason)).toEqual([
      "target_not_found", "target_not_found", "target_not_found",
    ]);
    expect(es[3].result.status).toBe("applied");
    expect(es[4].result).toMatchObject({ status: "skipped", reason: "target_not_found" });
    const t1 = turn([{ op: "add_widget", tempId: -1, type: "records", title: "t", config: {} }]);
    const [p] = turn([patch("widget", -1, { page_size: 25 })], t1);
    expect(p.result.status).toBe("applied");
  });
  it("EVAL-4: reused tempId is duplicate_temp_id even if removed", () => {
    const t1 = turn([
      { op: "add_widget", tempId: -1, type: "records", title: "t", config: {} },
      { op: "remove_widget", id: -1 },
    ]);
    const [e] = turn([{ op: "add_widget", tempId: -1, type: "records", title: "t", config: {} }], t1);
    expect(e.result).toMatchObject({ status: "skipped", reason: "duplicate_temp_id" });
  });
  it("EVAL-5: invalid patches are patch_rejected", () => {
    const [a, b] = turn([patch("widget", 42, { show_popup: "yes" }), patch("layer", 7, { table_id: 3 })]);
    expect(a.result).toMatchObject({ status: "skipped", reason: "patch_rejected" });
    expect(b.result).toMatchObject({ status: "skipped", reason: "patch_rejected" });
  });
  it("EVAL-6: add_layer only on map widgets", () => {
    const [a, b] = turn([addLayerOp(-2, 50), addLayerOp(-3, 42)]);
    expect(a.result).toMatchObject({ status: "skipped", reason: "target_not_found" });
    expect(b.result.status).toBe("applied");
  });
});

describe("foldSession", () => {
  it("FOLD-1: turn 2 keeps turn 1 on the same widget", () => {
    const t1 = turn([patch("widget", 42, { show_popup: true })]);
    const t2 = turn([patch("widget", 42, { show_scale_bar: true })], t1);
    const d = foldSession(baseline, [...t1, ...t2]);
    expect(d.contribution.widget[42]).toEqual({ show_popup: true, show_scale_bar: true });
  });
  it("FOLD-2: layer patches deep-merge, track_config top-level", () => {
    // 136: layer patches are the strict AI list (no track_config / renderMode any more); the
    // deep-merge across turns is what this still proves.
    const t1 = turn([patch("layer", 7, { opacity: 0.5, name: "x" })]);
    const t2 = turn([patch("layer", 7, { colormap: "plasma" })], t1);
    const d = foldSession(baseline, [...t1, ...t2]);
    expect(d.contribution.layer[7]).toEqual({ config: { opacity: 0.5, name: "x", colormap: "plasma" } });
  });
  it("FOLD-3: patch on temp widget merges into the added entity", () => {
    const t = turn([
      { op: "add_widget", tempId: -1, type: "records", title: "t", config: {} },
      patch("widget", -1, { page_size: 25 }),
    ]);
    const d = foldSession(baseline, t);
    expect(d.addedWidgets[0].config.pageSize).toBe(25); // 134-10: translated to the renderer key
    expect(Object.keys(d.contribution.widget)).not.toContain("-1");
  });
  it("OVK-F1: patch on an AI-added map translates show_scale_bar to the renderer key", () => {
    const t = turn([
      { op: "add_widget", tempId: -1, type: "map", title: "m", config: {} },
      patch("widget", -1, { show_scale_bar: true }),
    ]);
    const d = foldSession(baseline, t);
    expect(d.addedWidgets[0].config.showScaleBar).toBe(true);
    expect("show_scale_bar" in d.addedWidgets[0].config).toBe(false);
  });
  it("MAPVIEW-F1 (142 UAT): an AI-added map keeps its server-stamped defaultView", () => {
    const view = { center: [-8226375.5, 4974561.25] as [number, number], zoom: 10.9 };
    const [e] = turn([{ op: "add_widget", tempId: -1, type: "map", title: "m", config: { defaultView: view } }]);
    expect(e.result.status).toBe("applied");
    const d = foldSession(baseline, [e]);
    expect(d.addedWidgets[0].config.defaultView).toEqual(view);
  });
  it("MAPVIEW-F2 (142 UAT): a malformed defaultView is still refused", () => {
    const [e] = turn([{ op: "add_widget", tempId: -1, type: "map", title: "m", config: { defaultView: { center: [1], zoom: 99 } } }]);
    expect(e.result.status).toBe("skipped");
  });
  it("FOLD-4: removals", () => {
    const t = turn([
      patch("widget", 42, { show_popup: true }), { op: "remove_widget", id: 42 },
      { op: "add_widget", tempId: -1, type: "records", title: "t", config: {} }, { op: "remove_widget", id: -1 },
    ], [], { removalApproved: true }); // D-06: saved removal approved; this test is about fold mechanics
    const d = foldSession(baseline, t);
    expect(d.removedWidgetIds.has(42)).toBe(true);
    expect(d.contribution.widget[42]).toBeUndefined();
    expect(d.addedWidgets.find((x) => x.id === -1)).toBeUndefined();
    expect(d.removedWidgetIds.has(-1)).toBe(false);
  });
  it("FOLD-5: add_layer extends explicit includedLayerIds only", () => {
    const t = turn([addLayerOp(-2, 43), addLayerOp(-3, 42)]);
    const d = foldSession(baseline, t);
    expect(d.contribution.widget[43].includedLayerIds).toEqual([7, -2]);
    expect(d.contribution.widget[42]).toBeUndefined();
    expect(d.addedLayers[0]).toMatchObject({ id: -2, table_id: 1, layer_type: "KineticaWms" });
  });
  it("FOLD-6: skipped ignored; appliedOpCount counts applied", () => {
    const t = turn([patch("widget", 42, { show_popup: true }), { op: "remove_widget", id: 999 }]);
    expect(foldSession(baseline, t).appliedOpCount).toBe(1);
  });
  it("FOLD-7: no applied entries returns EMPTY_DERIVED", () => {
    expect(foldSession(baseline, [])).toBe(EMPTY_DERIVED);
    expect(foldSession(baseline, turn([{ op: "remove_widget", id: 999 }]))).toBe(EMPTY_DERIVED);
  });
  it("FOLD-8: prefix fold is deterministic and does not mutate inputs", () => {
    const t1 = deepFreeze(turn([patch("widget", 42, { show_popup: true })]));
    const t2 = deepFreeze(turn([patch("widget", 42, { show_scale_bar: true })], t1));
    const p1 = foldSession(baseline, t1);
    const full = foldSession(baseline, [...t1, ...t2]);
    expect(p1).not.toEqual(full);
    expect(p1).toEqual(foldSession(baseline, turn([patch("widget", 42, { show_popup: true })])));
  });
});

// ---------------------------------------------------------------------------------------------
// Phase 136 (136-08): structural ops
// ---------------------------------------------------------------------------------------------
describe("Phase 136 fold", () => {
  const b6 = (): SessionBaseline => {
    const f = baselineFixture({
      widgets: [
        { ...w(12, "bar", { tableId: 5, table: "demo.trips", metricColumn: "fare_amount", aggregation: "SUM", groupByColumn: "vendor_id", sql: "S1", layout: { x: 0, y: 0, w: 18, h: 24 } }) },
        { ...w(42, "map", { layout: { x: 18, y: 0, w: 18, h: 24 } }) },
        { ...w(50, "records", { layout: { x: 0, y: 24, w: 18, h: 24 } }) },
        { ...w(60, "bar", { tableId: 5, dynamicViewId: 9, layout: { x: 18, y: 24, w: 18, h: 24 } }) },
      ],
      layers: [savedLayer(7, { config: { renderMode: "heatmap" } }), savedLayer(8, { config: { renderMode: "raster" } })],
    });
    return f;
  };
  const baseline6 = b6();
  const t6 = (ops: unknown[], prior: TurnEntry[] = []) => evaluateTurn(baseline6, prior, ops);
  const barOp = (tempId = -1, extra: Record<string, unknown> = {}) =>
    addChartOp(tempId, "bar", "Fares", { tableId: 5, metric: "fare_amount", aggregation: "avg", groupByColumn: "vendor_id", color: "teal", limit: 10, ...extra }, { x: 0, y: 60, w: 18, h: 30 });
  const reason = (e: TurnEntry) => (e.result as { reason?: string }).reason;

  it("FOLD6-1: add_widget generates sql/table/drill/palette colour; no metric key", () => {
    const d = foldSession(baseline6, t6([barOp()]));
    const c = d.addedWidgets[0].config;
    expect(c).toMatchObject({
      table: "demo.trips", tableId: 5, metricColumn: "fare_amount", aggregation: "AVG",
      sql: "SELECT vendor_id, AVG(fare_amount) AS value FROM demo.trips GROUP BY vendor_id ORDER BY value DESC LIMIT 10",
      drillDownColumn: "vendor_id", color: paletteColor("teal"), layout: { x: 0, y: 60, w: 18, h: 30 },
    });
    expect("metric" in c).toBe(false);
    expect("metricId" in c).toBe(false);
  });

  it("FOLD6-2: hostile config is rejected, and the strip holds independently of evaluate", () => {
    for (const bad of [
      { sql: "DROP TABLE x" }, { customWhere: "1=1" }, { drillDownColumn: "evil" },
      { dynamicViewId: 3 }, { metricId: 4 },
    ]) {
      const [e] = t6([barOp(-1, bad)]);
      expect(reason(e)).toBe("config_rejected");
    }
    // Direct call: skip evaluate entirely (positive control for the strip step).
    const hostile = { op: "add_widget" as const, tempId: -1, type: "bar", title: "t", layout: undefined, config: {
      tableId: 5, metric: "fare_amount", aggregation: "avg", groupByColumn: "vendor_id", limit: 10,
      sql: "DROP TABLE x", customWhere: "1=1", drillDownColumn: "evil", dynamicViewId: 3, metricId: 4, tableRef: "evil.t", table: "evil.t",
    } };
    const c = makeSessionWidget(hostile, baseline6).config;
    expect(c.sql).toBe("SELECT vendor_id, AVG(fare_amount) AS value FROM demo.trips GROUP BY vendor_id ORDER BY value DESC LIMIT 10");
    expect(c.customWhere).toBeUndefined();
    expect(c.drillDownColumn).toBe("vendor_id");
    expect(c.dynamicViewId).toBeUndefined();
    expect(c.metricId).toBeUndefined();
    expect(c.tableRef).toBeUndefined();
    expect(c.table).toBe("demo.trips");
  });

  it("FOLD6-3: tables outside the dashboard are table_not_on_dashboard", () => {
    const [a, b] = t6([barOp(-1, { tableId: 6 }), addLayerOp(-2, 42)].map((o, i) => (i === 1 ? { ...o, tableId: 6 } : o)));
    expect(reason(a)).toBe("table_not_on_dashboard");
    expect(reason(b)).toBe("table_not_on_dashboard");
  });

  it("FOLD6-4: add_layer builds a complete heatmap layer on the dashboard table", () => {
    const op = { ...addLayerOp(-4, 42), tableId: 5, style: { colormap: "plasma", opacity: 0.5 } };
    const d = foldSession(baseline6, t6([op]));
    expect(d.addedLayers[0]).toMatchObject({ id: -4, table_id: 5 });
    expect(d.addedLayers[0].config).toMatchObject({ renderMode: "heatmap", colormap: "plasma", POINTOPACITY: 50, latColumn: "lat" });
    const [bad] = t6([{ ...op, widgetId: 50 }]);
    expect(reason(bad)).toBe("target_not_found");
  });

  it("FOLD6-6: patch on a temp widget re-derives; patch on a saved widget flags it", () => {
    const t1 = t6([barOp()]);
    const t2 = t6([{ op: "patch", action: { target: { kind: "widget", id: -1 }, configPatch: { aggregation: "max" } } }], t1);
    const c = foldSession(baseline6, [...t1, ...t2]).addedWidgets[0].config;
    expect(c.aggregation).toBe("MAX");
    expect(c.sql).toContain("MAX(fare_amount)");
    const d = foldSession(baseline6, t6([patch("widget", 12, { metric: "fare_amount" })]));
    expect(d.contribution.widget[12]).toEqual({ metric: "fare_amount" });
    expect(d.aiEditedWidgetIds.has(12)).toBe(true);
  });

  it("FOLD6-7: layer patches use the strict heatmap list", () => {
    const es = t6([
      patch("layer", 7, { colormap: "viridis" }), patch("layer", 8, { colormap: "viridis" }), patch("layer", 8, { visible: false }),
    ]);
    expect(es[0].result.status).toBe("applied");
    expect(reason(es[1])).toBe("unsupported_target");
    expect(es[2].result.status).toBe("applied");
    const d = foldSession(baseline6, es);
    expect(d.aiEditedLayerIds.has(7)).toBe(true);
    const t1 = t6([{ ...addLayerOp(-4, 42), tableId: 5 }]);
    const t2 = t6([patch("layer", -4, { opacity: 0.25 }), patch("layer", -4, { latColumn: "x" })], t1);
    expect(reason(t2[1])).toBe("patch_rejected");
    expect(foldSession(baseline6, [...t1, ...t2]).addedLayers[0].config.POINTOPACITY).toBe(25);
  });

  it("FOLD6-8: set_layout overrides positions in derived.layout and flags saved ids", () => {
    const es = t6([setLayoutOp([{ id: 42, x: 0, y: 48, w: 18, h: 30 }, { id: 50, x: 18, y: 48, w: 18, h: 30 }])]);
    const d = foldSession(baseline6, es);
    expect(d.layout[42]).toEqual({ x: 0, y: 48, w: 18, h: 30 });
    expect(d.layout[50]).toEqual({ x: 18, y: 48, w: 18, h: 30 });
    expect(d.aiEditedWidgetIds.has(42) && d.aiEditedWidgetIds.has(50)).toBe(true);
    expect(reason(t6([setLayoutOp([{ id: 42, x: 0, y: 0, w: 18, h: 30 }, { id: 50, x: 6, y: 0, w: 18, h: 30 }])])[0])).toBe("layout_rejected");
    expect(reason(t6([setLayoutOp([{ id: 42, x: 0, y: 0, w: 18, h: 30 }])])[0])).toBe("layout_rejected"); // overlaps unmoved 12
    expect(reason(t6([setLayoutOp([{ id: 999, x: 0, y: 0, w: 18, h: 30 }])])[0])).toBe("target_not_found");
  });

  it("FOLD6-9: change_widget_type retypes saved and temp widgets; records is unsupported", () => {
    const t1 = t6([changeTypeOp(12, "line")]);
    expect(foldSession(baseline6, t1).widgetMeta[12].type).toBe("line");
    expect(foldSession(baseline6, t1).widgetMeta[12].config?.sql).toContain("GROUP BY vendor_id");
    const t2 = t6([patch("widget", 12, { xAxisLabel: "x" })], t1);
    expect(reason(t2[0])).toBe("patch_rejected");
    expect(reason(t6([changeTypeOp(50, "bar")])[0])).toBe("unsupported_target");
    const t3 = t6([barOp(), changeTypeOp(-1, "pie")]);
    expect(t3[1].result.status).toBe("applied");
    expect(foldSession(baseline6, t3).addedWidgets[0].type).toBe("pie");
  });

  it("FOLD6-10: set_widget_title", () => {
    expect(foldSession(baseline6, t6([setTitleOp(12, "New")])).widgetMeta[12].title).toBe("New");
    expect(foldSession(baseline6, t6([barOp(), setTitleOp(-1, "T2")])).addedWidgets[0].title).toBe("T2");
  });

  it("FOLD6-11: dynamic-view bound widgets are unsupported_target", () => {
    expect(reason(t6([patch("widget", 60, { limit: 10 })])[0])).toBe("unsupported_target");
  });

  it("FOLD6-12: undo (prefix fold) drops layout, meta and flags of the dropped turn", () => {
    const t1 = t6([patch("widget", 12, { metric: "fare_amount" })]);
    const t2 = t6([setLayoutOp([{ id: 42, x: 0, y: 48, w: 18, h: 30 }]), setTitleOp(12, "New")], t1);
    const prefix = foldSession(baseline6, t1);
    expect(prefix.layout[42]).toBeUndefined();
    expect(prefix.widgetMeta[12]).toBeUndefined();
    expect(prefix.aiEditedWidgetIds.has(42)).toBe(false);
    expect(foldSession(baseline6, [...t1, ...t2]).layout[42]).toBeDefined();
  });

  it("FOLD6-13: a map and its heatmap layer in one turn", () => {
    const es = t6([
      { op: "add_widget", tempId: -1, type: "map", title: "Trips map", config: {} },
      { ...addLayerOp(-2, -1), tableId: 5 },
    ]);
    expect(es.map((e) => e.result.status)).toEqual(["applied", "applied"]);
    const d = foldSession(baseline6, es);
    expect(d.addedWidgets[0].config).toHaveProperty("basemapLight");
    expect(d.addedWidgets[0].config).toHaveProperty("basemapDark");
    expect(d.addedLayers[0].table_id).toBe(5);
  });

  it("FOLD6-5: removing saved content needs approval; temp content and missing ids do not", () => {
    const rm = [{ op: "remove_widget", id: 12 }];
    expect(reason(t6(rm)[0])).toBe("needs_confirmation");
    expect(reason(t6([{ op: "remove_layer", id: 7 }])[0])).toBe("needs_confirmation");
    expect(evaluateTurn(baseline6, [], rm, { removalApproved: true })[0].result.status).toBe("applied");
    expect(evaluateTurn(baseline6, [], [{ op: "remove_layer", id: 7 }], { removalApproved: true })[0].result.status).toBe("applied");
    const es = t6([barOp(), { op: "remove_widget", id: -1 }]);
    expect(es.map((e) => e.result.status)).toEqual(["applied", "applied"]);
    expect(reason(t6([{ op: "remove_widget", id: 999 }])[0])).toBe("target_not_found");
    // approval does not make the gate a no-op for a missing id (removalApproved: true still reports not found)
    expect(reason(evaluateTurn(baseline6, [], [{ op: "remove_widget", id: 999 }], { removalApproved: true })[0])).toBe("target_not_found");
  });
});

describe("FOLD7: AI assistant widget is untouchable", () => {
  const b7: SessionBaseline = { ...baseline, widgets: [...baseline.widgets, w(9, "ai")] };
  it("FOLD7-1: ops targeting an ai widget are skipped with unsupported_target", () => {
    const es = evaluateTurn(b7, [], [
      patch("widget", 9, { title: "x" }),
      { op: "remove_widget", id: 9 },
      { op: "change_widget_type", id: 9, type: "bar" },
      { op: "set_widget_title", id: 9, title: "T" },
      { op: "set_layout", items: [{ id: 9, x: 0, y: 0, w: 12, h: 40 }] },
      { op: "set_widget_title", id: 50, title: "ok" },
    ], { removalApproved: true });
    for (const e of es.slice(0, 5)) {
      expect(e.result).toMatchObject({ status: "skipped", reason: "unsupported_target", detail: "AI assistant widget" });
    }
    expect(es[5].result.status).toBe("applied");
    const ok = evaluateTurn(b7, [], [{ op: "set_layout", items: [{ id: 50, x: 24, y: 200, w: 8, h: 8 }] }]);
    expect(ok[0].result.status).toBe("applied");
  });
});

describe("HOST7 / KPI7 (137-07 Task 3, 136-12 UAT findings 2 + 3)", () => {
  const b3: SessionBaseline = {
    dashboardId: 1,
    widgets: [mapW(117, { includedLayerIds: [23] }), mapW(118, { includedLayerIds: [99] }), mapW(119, {}), w(60, "bar", { tableId: 1, metricColumn: "fare_amount", aggregation: "SUM", groupByColumn: "vendor" })],
    layers: [savedLayer(23, { config: { renderMode: "heatmap" }, table_id: 1 }), savedLayer(99, { config: { renderMode: "heatmap" }, table_id: 1 })],
    dynamicViewIds: [],
    tables: [{ id: 1, schema: "demo", name: "trips", columns: { fare_amount: "double", vendor: "string", lat: "double", lon: "double" } }],
    maxBarGroupBySeriesCap: 12,
  };
  const fold3 = (ops: unknown[], approved = false) =>
    foldSession(b3, evaluateTurn(b3, [], ops, { removalApproved: approved }));
  const ids = (s: ReadonlySet<number>) => [...s].sort((a, b) => a - b);
  const kpi = (extra: Record<string, unknown> = {}) => ({
    op: "add_widget", tempId: -1, type: "bignumber", title: "Fares",
    config: { tableId: 1, metric: "fare_amount", aggregation: "sum", ...extra },
  });

  it("HOST7-1: a saved layer patch marks the maps that show it, not aiEditedWidgetIds", () => {
    const d = fold3([patchLayerOp(23, { colormap: "magma" })]);
    expect(ids(d.aiLayerHostWidgetIds)).toEqual([117, 119]);
    expect(d.aiEditedWidgetIds.size).toBe(0);
    expect(ids(d.aiEditedLayerIds)).toEqual([23]);
  });
  it("HOST7-2: add_layer then patch the temp layer keeps the host marked", () => {
    const d = fold3([addLayerOp(-1, 117), patchLayerOp(-1, { colormap: "inferno" })]);
    expect(ids(d.aiLayerHostWidgetIds)).toEqual([117, 119]);
  });
  it("HOST7-3: removing a saved layer marks its hosts", () => {
    expect(ids(fold3([removeLayerOp(23)], true).aiLayerHostWidgetIds)).toEqual([117, 119]);
  });
  it("HOST7-4: removed hosts and temp maps are excluded; empty entries give an empty set", () => {
    const d = fold3([patchLayerOp(23, { colormap: "magma" }), { op: "remove_widget", id: 117 }], true);
    expect(ids(d.aiLayerHostWidgetIds)).toEqual([119]);
    const t = fold3([{ op: "add_widget", tempId: -5, type: "map", title: "M", config: {} }, { ...addLayerOp(-6, -5), tableId: 1 }]);
    expect(t.aiLayerHostWidgetIds.has(-5)).toBe(false);
    expect(foldSession(b3, []).aiLayerHostWidgetIds.size).toBe(0);
  });
  it("HOST7-5: each layer change is counted once in the bar counts", () => {
    const counts = (ops: unknown[], approved = false) => {
      const c = computeChangeCounts(fold3(ops, approved), b3);
      return { added: c.added, edited: c.edited, removed: c.removed };
    };
    expect(counts([patchLayerOp(23, { colormap: "magma" })])).toEqual({ added: 0, edited: 1, removed: 0 });
    expect(counts([addLayerOp(-1, 117)])).toEqual({ added: 1, edited: 0, removed: 0 });
    expect(counts([removeLayerOp(23)], true)).toEqual({ added: 0, edited: 0, removed: 1 });
  });

  it("KPI7-1: an AI-added big number without a label shows '<Aggregation> of <column>'", () => {
    expect(fold3([kpi()]).addedWidgets[0].config.label).toBe("Sum of fare_amount");
  });
  it("KPI7-2: an AI-supplied label is kept", () => {
    expect(fold3([kpi({ label: "Total fares" })]).addedWidgets[0].config.label).toBe("Total fares");
  });
  it("KPI7-3: a metric/aggregation patch re-derives an auto label but keeps an AI one", () => {
    const patchAvg = { op: "patch", action: { target: { kind: "widget", id: -1 }, configPatch: { aggregation: "avg" } } };
    expect(fold3([kpi(), patchAvg]).addedWidgets[0].config.label).toBe("Average of fare_amount");
    expect(fold3([kpi({ label: "Total fares" }), patchAvg]).addedWidgets[0].config.label).toBe("Total fares");
  });
  it("KPI7-4: change_widget_type to bignumber gets the default label", () => {
    // The shared op schema only swaps to bar/line/pie today (AI_CHART_SWAP_TYPES), so evaluateTurn
    // would skip these; feed applied entries straight to the fold to prove the defensive branch.
    const applied = (op: unknown): TurnEntry => ({ raw: op, op: op as TurnEntry["op"], result: { status: "applied" } });
    const bar = { op: "add_widget", tempId: -2, type: "bar", title: "B", config: { tableId: 1, metric: "fare_amount", aggregation: "sum", groupByColumn: "vendor" } };
    const temp = foldSession(b3, [applied(bar), applied(changeTypeOp(-2, "bignumber"))]);
    expect(temp.addedWidgets[0].config.label).toBe("Sum of fare_amount");
    const saved = foldSession(b3, [applied(changeTypeOp(60, "bignumber"))]);
    expect(saved.widgetMeta[60].config?.label).toBe("Sum of fare_amount");
    const other = foldSession(b3, [applied(changeTypeOp(60, "line"))]);
    expect(other.widgetMeta[60].config).not.toHaveProperty("label");
  });
});

describe("filter ops (138)", () => {
  const bl = baselineFixture();
  const T5 = { kind: "table" as const, id: 5 };
  const fturn = (ops: unknown[], currentFilters?: Record<string, string[]>, prior: TurnEntry[] = []) =>
    evaluateTurn(bl, prior, ops, { currentFilters });
  const reason = (e: TurnEntry) => (e.result as { reason?: string }).reason;
  const names = (n: number) => Array.from({ length: n }, (_, i) => `c${i + 1}`);

  it("FOLDF-1: applied filter is never counted or derived", () => {
    const es = fturn([applyFilterRaw(T5, "payment_type")]);
    expect(es[0].result.status).toBe("applied");
    const d = foldSession(bl, es);
    expect(d.appliedOpCount).toBe(0);
    expect(d.addedWidgets).toEqual(EMPTY_DERIVED.addedWidgets);
    expect(d.removedWidgetIds).toEqual(EMPTY_DERIVED.removedWidgetIds);
    expect(d.contribution).toEqual(EMPTY_DERIVED.contribution);
    expect(d.aiEditedWidgetIds).toEqual(EMPTY_DERIVED.aiEditedWidgetIds);
  });
  it("FOLDF-2: table not on dashboard", () => {
    expect(reason(fturn([applyFilterRaw({ kind: "table", id: 77 }, "payment_type")])[0])).toBe("table_not_on_dashboard");
  });
  it("FOLDF-3: unknown column", () => {
    const [e] = fturn([applyFilterRaw(T5, "nope")]);
    expect(e.result).toEqual({ status: "skipped", reason: "column_not_found", detail: "nope" });
  });
  it("FOLDF-4: cap refuses a new column, replace is fine", () => {
    const cur = { "table:5": [...names(24), "payment_type"] };
    const es = fturn([applyFilterRaw(T5, "vendor_id"), applyFilterRaw(T5, "payment_type")], cur);
    expect(reason(es[0])).toBe("filter_cap");
    expect(es[1].result.status).toBe("applied");
  });
  it("FOLDF-5: cap counts earlier ops in the same turn", () => {
    const es = fturn([applyFilterRaw(T5, "vendor_id"), applyFilterRaw(T5, "fare_amount")], { "table:5": names(24) });
    expect(es[0].result.status).toBe("applied");
    expect(reason(es[1])).toBe("filter_cap");
  });
  it("FOLDF-6: dynamic view sources", () => {
    expect(fturn([applyFilterRaw({ kind: "dynamicView", id: 90 }, "zone")])[0].result.status).toBe("applied");
    // 139 D-23: an AI view id is filterable once it exists in the session (see foldSession.dv.spec FOLDDV-6); unknown -> not found
    expect(reason(fturn([applyFilterRaw({ kind: "dynamicView", id: -3 }, "zone")])[0])).toBe("target_not_found");
    expect(reason(fturn([applyFilterRaw({ kind: "dynamicView", id: 91 }, "zone")])[0])).toBe("target_not_found");
  });
  it("FOLDF-7: clear_filter checks", () => {
    const cur = { "table:5": ["payment_type"] };
    expect(reason(fturn([clearFilterRaw(T5, "vendor_id")], cur)[0])).toBe("target_not_found");
    expect(fturn([clearFilterRaw()], cur)[0].result.status).toBe("applied");
    expect(reason(fturn([clearFilterRaw({ kind: "table", id: 77 })], cur)[0])).toBe("table_not_on_dashboard");
    expect(fturn([clearFilterRaw(T5, "payment_type")], cur)[0].result.status).toBe("applied");
  });
  it("FOLDF-8: prior applied filter entries do not seed the cap; currentFilters is authoritative", () => {
    const prior = fturn([applyFilterRaw(T5, "payment_type")]);
    expect(prior[0].result.status).toBe("applied");
    const es = fturn([applyFilterRaw(T5, "vendor_id")], { "table:5": names(24) }, prior);
    expect(es[0].result.status).toBe("applied");
  });
});
