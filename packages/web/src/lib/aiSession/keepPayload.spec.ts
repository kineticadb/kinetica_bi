import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AiKeepRequestSchema, type AiKeepRequest } from "@kinetica-bi/shared";
import { buildKeepPayload, countViewToggles } from "./keepPayload";
import { evaluateTurn, foldSession } from "./foldSession";
import { applySessionToWidgets, applySessionToLayers } from "./applySession";
import { mergeWidgetOverlay } from "../widgetOverlay";
import { applyLayerOverrides } from "../applyLayerOverrides";
import {
  baselineFixture, savedLayer, mapWidget, recordsWidget, addChartOp, addWidgetOp, addLayerOp, patchWidgetOp, patchLayerOp,
  removeWidgetOp, removeLayerOp, setLayoutOp, changeTypeOp, setTitleOp,
} from "../../test/aiSessionHarness";
import type { SessionBaseline, SessionDerived, SessionRect, TurnEntry } from "./types";
import type { WidgetDto, TableDto } from "../../api/client";

const bar = (id: number, config: Record<string, unknown> = {}): WidgetDto => ({
  id, dashboard_id: 1, title: `bar ${id}`, type: "bar", position: 0, config, created_at: "", updated_at: "",
});
const barCfg = (extra: Record<string, unknown> = {}) => ({
  tableId: 5, table: "demo.trips", metricColumn: "fare_amount", aggregation: "SUM", groupByColumn: "vendor_id", sortDir: "DESC", limit: 10,
  sql: "SELECT 1", drillDownColumn: "vendor_id", drillDownColumnType: "string", ...extra,
});
const L = (x: number, y: number) => ({ x, y, w: 10, h: 6 });

function baseline(): SessionBaseline {
  const b = baselineFixture({
    widgets: [
      mapWidget(42, { layout: L(0, 0) }), mapWidget(43, { includedLayerIds: [7], layout: L(10, 0) }),
      recordsWidget(50, { layout: L(0, 6) }), bar(60, barCfg({ layout: L(10, 6) })),
      bar(61, barCfg({ dynamicViewId: 90, layout: L(0, 12) })), bar(62, barCfg()),
    ],
    layers: [savedLayer(7, { config: { renderMode: "heatmap" } }), savedLayer(8)],
    dynamicViewIds: [90],
  });
  return { ...b, dynamicViewSources: { 90: 5 }, dynamicViewColumns: { 90: [{ name: "trips", type: "long" }] }, dynamicViewNames: { 90: "Saved view" } };
}
function fold(b: SessionBaseline, turns: unknown[][], opts: { removalApproved?: boolean } = {}): SessionDerived {
  let all: TurnEntry[] = [];
  for (const ops of turns) all = [...all, ...evaluateTurn(b, all, ops, opts)];
  const bad = all.filter((e) => e.result.status !== "applied");
  if (bad.length) throw new Error("scripted op skipped: " + JSON.stringify(bad.map((e) => e.result)));
  return foldSession(b, all);
}
const deps = (b: SessionBaseline) => ({ tables: (b.tables ?? []) as unknown as TableDto[], maxBarGroupBySeriesCap: 12 });
function build(b: SessionBaseline, d: SessionDerived, rects: Record<number, SessionRect> = {}, vis: Record<number, boolean> = {}): AiKeepRequest {
  const r: Record<number, SessionRect> = {};
  for (const w of b.widgets) { const l = w.config.layout as SessionRect | undefined; if (l) r[w.id] = l; }
  return buildKeepPayload({
    baselineVersion: 7, derived: d, savedWidgets: b.widgets, savedLayers: b.layers, tempLayerVisibility: vis,
    rects: { ...r, ...rects }, overlay: deps(b),
  });
}
const spec = { baseTableId: 5, groupBy: [{ column: "payment_type" }], aggregates: [{ fn: "count", as: "trips" }] };
const stamped = [{ name: "payment_type", type: "string" }, { name: "trips", type: "long" }];
const addDv = (tempId = -3) => ({ op: "add_dynamic_view", tempId, name: "Trips by type", spec, columns: stamped, maxRecords: 1000, aggregated: true });
const rebind = (kind: "widget" | "layer", id: number, dv: number) => ({ op: "patch", action: { target: { kind, id }, configPatch: { dynamicViewId: dv } } });
const stripU = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const parse = (p: AiKeepRequest) => AiKeepRequestSchema.safeParse(p);

describe("buildKeepPayload", () => {
  it("KPAY-1: empty session -> empty arrays, version passed through, schema valid", () => {
    const b = baseline();
    const p = build(b, foldSession(b, []));
    expect(p).toEqual({ baselineVersion: 7, dynamicViews: { add: [], remove: [] }, layers: { add: [], edit: [], remove: [] }, widgets: { add: [], edit: [], remove: [] } });
    expect(parse(p).success).toBe(true);
  });

  it("KPAY-2: adds carry tempId, type, title, merged config and the displayed rect", () => {
    const b = baseline();
    const d = fold(b, [[addChartOp(-1, "bar", "Fares", { tableId: 5, metric: "fare_amount", aggregation: "avg", groupByColumn: "vendor_id" }), addWidgetOp(-2, "records", "Rows", { tableId: 5 })]]);
    const rects = { [-1]: L(0, 20), [-2]: L(10, 20) };
    const p = build(b, d, rects);
    expect(p.widgets.add.map((a) => a.tempId)).toEqual([-1, -2]);
    const a0 = p.widgets.add[0];
    expect(a0).toMatchObject({ type: "bar", title: "Fares", rect: rects[-1] });
    const expectCfg = stripU({ ...mergeWidgetOverlay(d.addedWidgets[0], null, deps(b)).config });
    delete expectCfg.layout;
    expect(a0.config).toEqual(expectCfg);
    expect(p.widgets.add[1].rect).toEqual(rects[-2]);
    expect(parse(p).success).toBe(true);
  });

  it("KPAY-3: saved edits equal what the renderer resolves (title, retype, SQL patch, move, rebind, unbind)", () => {
    const b = baseline();
    const sessions: { name: string; turns: unknown[][]; id: number; opts?: { removalApproved?: boolean } }[] = [
      { name: "title", turns: [[setTitleOp(60, "Renamed")]], id: 60 },
      { name: "retype", turns: [[changeTypeOp(60, "line")]], id: 60 },
      { name: "sql patch", turns: [[patchWidgetOp(60, { aggregation: "max" })]], id: 60 },
      { name: "move", turns: [[setLayoutOp([{ id: 60, x: 2, y: 30, w: 8, h: 6 }])]], id: 60 },
      { name: "rebind", turns: [[addDv(-3)], [rebind("widget", 60, -3)]], id: 60 },
      { name: "unbind", turns: [[{ op: "remove_dynamic_view", id: 90, repoint: { tableId: 5, widgetIds: [61], layerIds: [] } }]], id: 61, opts: { removalApproved: true } },
    ];
    for (const s of sessions) {
      const d = fold(b, s.turns, s.opts);
      const rects = d.layout[s.id] ? { [s.id]: d.layout[s.id] } : {};
      const p = build(b, d, rects);
      const saved = b.widgets.find((w) => w.id === s.id)!;
      const edit = p.widgets.edit.find((e) => e.id === s.id);
      expect(edit, s.name).toBeDefined();
      const applied = applySessionToWidgets([...b.widgets], d).find((w) => w.id === s.id)!;
      const eff = mergeWidgetOverlay(applied, d.contribution.widget[s.id] ?? null, deps(b));
      const got: Record<string, unknown> = { ...saved.config, ...(edit!.configSet ?? {}) };
      for (const k of edit!.configUnset ?? []) delete got[k];
      const want = stripU({ ...eff.config });
      delete got.layout; delete want.layout;
      expect(got, s.name).toEqual(want);
      expect(edit!.title ?? saved.title, s.name).toBe(eff.title);
      expect(edit!.type ?? saved.type, s.name).toBe(eff.type);
      if (s.name === "move") expect(edit!.rect).toEqual(rects[s.id]);
      expect(parse(p).success, s.name).toBe(true);
    }
  });

  it("KPAY-4: unbind is expressed as configUnset, never a lost undefined", () => {
    const b = baseline();
    const d = fold(b, [[{ op: "remove_dynamic_view", id: 90, repoint: { tableId: 5, widgetIds: [61], layerIds: [] } }]], { removalApproved: true });
    const p = build(b, d);
    const edit = p.widgets.edit.find((e) => e.id === 61)!;
    expect(edit.configUnset).toContain("dynamicViewId");
    for (const v of Object.values(edit.configSet ?? {})) expect(v).not.toBeUndefined();
    expect(JSON.parse(JSON.stringify(p))).toEqual(p);
    expect(p.dynamicViews.remove).toEqual([90]);
  });

  it("KPAY-5: radio contribution on the same widget is not in configSet", async () => {
    const { useWidgetActionStore } = await import("../../store/widgetActionStore");
    const b = baseline();
    useWidgetActionStore.getState().setControlContribution(1000, { widget: { 60: { aggregation: "min" } } });
    try {
      const d = fold(b, [[setTitleOp(60, "Only title")]]);
      const p = build(b, d);
      const edit = p.widgets.edit.find((e) => e.id === 60)!;
      expect(edit.configSet ?? {}).toEqual({});
      expect(edit.title).toBe("Only title");
    } finally {
      useWidgetActionStore.getState().clearControl(1000);
    }
  });

  it("KPAY-6: layers add (with AI visibility), edit via applyLayerOverrides, rebind", () => {
    const b = baseline();
    const d = fold(b, [[addLayerOp(-2, 42)], [patchLayerOp(7, { opacity: 0.4 })], [addDv(-3)], [rebind("layer", 8, -3)]]);
    const p = build(b, d, {}, { [-2]: false });
    expect(p.layers.add).toHaveLength(1);
    expect(p.layers.add[0]).toMatchObject({ tempId: -2, tableId: 1, dynamicViewId: null });
    expect(p.layers.add[0].config.visible).toBe(false);
    const e7 = p.layers.edit.find((e) => e.id === 7)!;
    expect(e7.configSet).toMatchObject({ POINTOPACITY: 40 });
    const resolved = applyLayerOverrides([b.layers[0]], { 7: d.contribution.layer[7] })[0];
    expect(resolved.config.POINTOPACITY).toBe(40);
    const e8 = p.layers.edit.find((e) => e.id === 8)!;
    expect(e8.dynamicViewId).toBe(-3);
    expect(parse(p).success).toBe(true);
    expect(applySessionToLayers([...b.layers], d, { [-2]: false }).find((l) => l.id === -2)!.config.visible).toBe(false);
  });

  it("KPAY-7: dynamic views carry only the structured spec; removals by saved id", () => {
    const b = baseline();
    const d = fold(b, [[addDv(-3)], [{ op: "remove_dynamic_view", id: 90 }]], { removalApproved: true });
    const p = build(b, d);
    expect(p.dynamicViews.add).toEqual([{ tempId: -3, name: "Trips by type", spec }]);
    expect(Object.keys(p.dynamicViews.add[0]).sort()).toEqual(["name", "spec", "tempId"]);
    expect(p.dynamicViews.remove).toEqual([90]);
    expect(parse(p).success).toBe(true);
  });

  it("KPAY-8: removals list positive ids only", () => {
    const b = baseline();
    const d = fold(b, [[addChartOp(-1, "bar", "tmp", { tableId: 5, metric: "fare_amount", aggregation: "avg", groupByColumn: "vendor_id" })], [removeWidgetOp(-1)], [removeWidgetOp(50)], [removeLayerOp(8)]], { removalApproved: true });
    const p = build(b, d);
    expect(p.widgets.remove).toEqual([50]);
    expect(p.layers.remove).toEqual([8]);
    expect(p.widgets.add).toEqual([]);
    expect(parse(p).success).toBe(true);
  });

  it("KPAY-9: geometry baking on saved removal; set_layout move carries rect", () => {
    const b0 = baseline();
    const b: SessionBaseline = { ...b0, widgets: b0.widgets.map((w) => (w.id === 62 ? { ...w, config: { ...w.config } } : w)) };
    const rect62 = L(20, 20);
    const d = fold(b, [[removeWidgetOp(50)]], { removalApproved: true });
    const p = build(b, d, { 62: rect62 });
    const e62 = p.widgets.edit.find((e) => e.id === 62)!;
    expect(e62).toEqual({ id: 62, rect: rect62 });
    expect(p.widgets.edit.find((e) => e.id === 60)).toBeUndefined();
    const none = build(b, fold(b, [[setTitleOp(60, "x")]]), { 62: rect62 });
    expect(none.widgets.edit.find((e) => e.id === 62)).toBeUndefined();
    const moved = fold(b, [[setLayoutOp([{ id: 60, x: 3, y: 40, w: 6, h: 6 }])]]);
    const pm = build(b, moved, { 60: { x: 3, y: 40, w: 6, h: 6 } });
    expect(pm.widgets.edit.find((e) => e.id === 60)!.rect).toEqual({ x: 3, y: 40, w: 6, h: 6 });
    expect(parse(p).success && parse(pm).success).toBe(true);
  });

  it("KPAY-10: schema validity of a mixed session", () => {
    const b = baseline();
    const d = fold(b, [[addChartOp(-1, "bar", "A", { tableId: 5, metric: "fare_amount", aggregation: "avg", groupByColumn: "vendor_id" }), addDv(-3), setTitleOp(60, "T")], [removeWidgetOp(50)]], { removalApproved: true });
    expect(parse(build(b, d, { [-1]: L(0, 40), 62: L(0, 50) })).success).toBe(true);
  });

  it("KPAY-11: committed fixture equals the fold-generated payload", () => {
    const table = { id: 9001, schema: "fleet", name: "trips", columns: { vendor: "string", fare: "double", pickup_datetime: "timestamp" }, created_at: "", updated_at: "" };
    const cfg = (extra: Record<string, unknown>) => ({
      tableId: 9001, table: "fleet.trips", metricColumn: "fare", aggregation: "SUM", groupByColumn: "vendor", sortDir: "DESC", limit: 10,
      sql: "SELECT vendor, SUM(fare) AS fare FROM fleet.trips GROUP BY vendor", drillDownColumn: "vendor", drillDownColumnType: "string", ...extra,
    });
    const widgets: WidgetDto[] = [
      bar(9101, cfg({ layout: L(0, 0) })),
      { ...mapWidget(9102, { includedLayerIds: [9201] }), id: 9102 },
      recordsWidget(9103, { tableId: 9001, table: "fleet.trips", layout: L(0, 12) }),
      bar(9104, cfg({ dynamicViewId: 9301, layout: L(10, 0) })),
    ];
    const layers = [savedLayer(9201, { table_id: 9001, config: { renderMode: "heatmap" } })];
    const dvSpec = { baseTableId: 9001, groupBy: [{ column: "vendor" }], aggregates: [{ fn: "count", as: "trips" }] };
    const dynamicViews = [{ id: 9301, name: "Saved fleet view", source_table_id: 9001, spec: dvSpec }];
    const b: SessionBaseline = {
      dashboardId: 1, widgets, layers, dynamicViewIds: [9301], tables: [table], maxBarGroupBySeriesCap: 12,
      dynamicViewSources: { 9301: 9001 }, dynamicViewColumns: { 9301: [{ name: "trips", type: "long" }] }, dynamicViewNames: { 9301: "Saved fleet view" },
    };
    const newSpec = { baseTableId: 9001, groupBy: [{ column: "vendor" }], aggregates: [{ fn: "sum", column: "fare", as: "total_fare" }] };
    const turns: unknown[][] = [
      [{ op: "add_dynamic_view", tempId: -1, name: "Fare by vendor", spec: newSpec, columns: [{ name: "vendor", type: "string" }, { name: "total_fare", type: "double" }], maxRecords: 1000, aggregated: true }],
      [addChartOp(-2, "bar", "Fare by vendor", { tableId: 9001, metric: "fare", aggregation: "avg", groupByColumn: "vendor" })],
      [addWidgetOp(-3, "records", "Trip rows", { tableId: 9001 })],
      [{ op: "add_layer", tempId: -4, widgetId: 9102, tableId: 9001, renderMode: "heatmap", spatialMode: "latlon", latColumn: "fare", lonColumn: "fare" }],
      [rebind("widget", 9101, -1)],
      [{ op: "remove_dynamic_view", id: 9301, repoint: { tableId: 9001, widgetIds: [9104], layerIds: [] } }],
      [removeWidgetOp(9103)],
    ];
    const d = fold(b, turns, { removalApproved: true });
    const request = build(b, d, { [-2]: L(0, 20), [-3]: L(10, 20), 9102: L(0, 6) }, { [-4]: true });
    expect(parse(request).success).toBe(true);
    expect(request.dynamicViews.add.length).toBeGreaterThan(0);
    expect(request.layers.add.length).toBeGreaterThan(0);
    expect(request.widgets.add.length).toBeGreaterThan(0);
    expect(request.widgets.remove.length).toBeGreaterThan(0);
    expect(request.widgets.edit.some((e) => e.configUnset && e.configUnset.length > 0)).toBe(true);
    const generated = JSON.parse(JSON.stringify({
      about: "Generated by packages/web/src/lib/aiSession/keepPayload.spec.ts KPAY-11 (UPDATE_KEEP_FIXTURE=1 regenerates). baseline = saved rows the request refers to; request = exactly what the client sends.",
      baseline: { tables: [table], widgets, layers, dynamicViews },
      request,
    }));
    const url = resolve(process.cwd(), "../shared/src/fixtures/aiKeepPayload.fixture.json");
    if (process.env.UPDATE_KEEP_FIXTURE === "1") writeFileSync(url, JSON.stringify(generated, null, 2) + "\n");
    expect(JSON.parse(readFileSync(url, "utf8"))).toEqual(generated);
  });

  it("KPAY-12: view toggles are counted, never saved", () => {
    const b = baseline();
    const d = fold(b, [[{ op: "patch", action: { target: { kind: "dynamicView", id: 90 }, configPatch: { enabled: false } } }]]);
    expect(countViewToggles(d)).toBe(1);
    expect(JSON.stringify(build(b, d))).not.toContain("enabled");
    expect(countViewToggles(foldSession(b, []))).toBe(0);
  });
});

describe("MAPVIEW-K (142 UAT)", () => {
  it("MAPVIEW-K1 an AI-added map's server-stamped defaultView rides the Keep payload", () => {
    const b = baseline();
    const view = { center: [-8226375.5, 4974561.25], zoom: 10.9 };
    const d = fold(b, [[{ op: "add_widget", tempId: -1, type: "map", title: "Pickups", config: { defaultView: view }, layout: { x: 0, y: 30, w: 24, h: 40 } }]]);
    const p = build(b, d);
    expect(parse(p).success).toBe(true);
    expect(p.widgets.add[0].config.defaultView).toEqual(view);
  });
});
