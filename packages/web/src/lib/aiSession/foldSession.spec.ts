import { describe, it, expect } from "vitest";
import { evaluateTurn, foldSession, makeSessionWidget } from "./foldSession";
import { addLayerOp, addChartOp, setLayoutOp, changeTypeOp, setTitleOp, baselineFixture, savedLayer } from "../../test/aiSessionHarness";
import { paletteColor } from "../aiPalette";
import { EMPTY_DERIVED } from "./constants";
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
  it("EVAL-2: later-phase kinds are unsupported_in_134", () => {
    const es = turn([
      { op: "apply_filter", widgetId: 42 }, { op: "clear_filter" },
      { op: "add_dynamic_view", tempId: -9 }, { op: "remove_dynamic_view", id: 90 },
    ]);
    for (const e of es) expect(e.result).toMatchObject({ status: "skipped", reason: "unsupported_in_134" });
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
