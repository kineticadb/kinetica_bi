import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateTurn, foldSession, makeSessionWidget, makeSessionLayer } from "./foldSession";
import { applySessionToWidgets, applySessionToLayers, applySessionToDynamicViews } from "./applySession";
import { baselineFixture, savedLayer, mapWidget, recordsWidget, applyFilterRaw, clearFilterRaw } from "../../test/aiSessionHarness";
import { planDvDependents, aiWidgetColumnRefs, aiLayerColumnRefs } from "@kinetica-bi/shared";
import type { SessionBaseline, TurnEntry } from "./types";
import type { WidgetDto } from "../../api/client";

const barWidget = (id: number, config: Record<string, unknown> = {}): WidgetDto => ({
  id, dashboard_id: 1, title: `bar ${id}`, type: "bar", position: 0, config, created_at: "", updated_at: "",
});
const spec = { baseTableId: 5, groupBy: [{ column: "payment_type" }], aggregates: [{ fn: "count", as: "trips" }] };
const stamped = [{ name: "payment_type", type: "string" }, { name: "trips", type: "long" }];
const addDv = (tempId = -3, over: Record<string, unknown> = {}) => ({
  op: "add_dynamic_view", tempId, name: "Trips by type", spec, columns: stamped, maxRecords: 1000, aggregated: true, ...over,
});
const rebind = (kind: "widget" | "layer", id: number, dv: number) => ({
  op: "patch", action: { target: { kind, id }, configPatch: { dynamicViewId: dv } },
});
const addBoundWidget = (tempId: number, dv: number) => ({
  op: "add_widget", tempId, type: "bar", title: "dv bar",
  config: { dynamicViewId: dv, metric: "trips", aggregation: "sum", groupByColumn: "payment_type" },
});
const addMapLayer = (tempId: number, widgetId: number, dv?: number) => ({
  op: "add_layer", tempId, widgetId, tableId: 5, renderMode: "heatmap", spatialMode: "latlon", latColumn: "lat", lonColumn: "lon",
  ...(dv === undefined ? {} : { dynamicViewId: dv }),
});

function baseline(): SessionBaseline {
  const b = baselineFixture({
    widgets: [barWidget(42), barWidget(43), mapWidget(44, { includedLayerIds: [70] }), recordsWidget(50)],
    layers: [savedLayer(70)],
    dynamicViewIds: [90],
  });
  return { ...b, dynamicViewSources: { 90: 5 }, dynamicViewColumns: { 90: [{ name: "trips", type: "long" }] }, dynamicViewNames: { 90: "Saved view" } };
}
/** Evaluate several turns in order; returns the flat entries. */
function run(b: SessionBaseline, turns: unknown[][], opts: { removalApproved?: boolean } = {}): TurnEntry[] {
  let all: TurnEntry[] = [];
  for (const ops of turns) all = [...all, ...evaluateTurn(b, all, ops, opts)];
  return all;
}
const last = (es: TurnEntry[]) => es[es.length - 1].result;

describe("add/remove dynamic view evaluation (139)", () => {
  it("FOLDDV-1: add validates temp id, tables and base columns", () => {
    const b = baseline();
    const es = run(b, [[addDv(-3)], [addDv(-3)]]);
    expect(es[0].result.status).toBe("applied");
    expect(es[1].result).toMatchObject({ status: "skipped", reason: "duplicate_temp_id" });
    expect(last(run(b, [[addDv(-4, { spec: { ...spec, baseTableId: 99 } })]]))).toMatchObject({ reason: "table_not_on_dashboard" });
    const joined = { ...spec, joins: [{ tableId: 77, type: "inner", on: [{ left: "vendor_id", right: "vendor_id" }] }] };
    expect(last(run(b, [[addDv(-4, { spec: joined })]]))).toMatchObject({ reason: "table_not_on_dashboard" });
    const bad = { ...spec, groupBy: [{ column: "fair" }] };
    expect(last(run(b, [[addDv(-4, { spec: bad })]]))).toMatchObject({ reason: "column_not_found", detail: "fair" });
  });

  it("FOLDDV-2: remove AI view free, saved view needs approval, unknown not found", () => {
    const b = baseline();
    expect(last(run(b, [[addDv(-3)], [{ op: "remove_dynamic_view", id: -3 }]])).status).toBe("applied");
    expect(last(run(b, [[{ op: "remove_dynamic_view", id: 90 }]]))).toMatchObject({ reason: "needs_confirmation" });
    expect(last(run(b, [[{ op: "remove_dynamic_view", id: 90 }]], { removalApproved: true })).status).toBe("applied");
    expect(last(run(b, [[{ op: "remove_dynamic_view", id: -8 }]]))).toMatchObject({ reason: "target_not_found" });
  });

  it("FOLDDV-3: add_widget bound to a view", () => {
    const b = baseline();
    expect(last(run(b, [[addDv(-3)], [addBoundWidget(-1, -3)]])).status).toBe("applied");
    expect(last(run(b, [[addDv(-3)], [addBoundWidget(-1, -8)]]))).toMatchObject({ reason: "target_not_found" });
    const both = { op: "add_widget", tempId: -1, type: "bar", title: "x", config: { dynamicViewId: -3, tableId: 5, metric: "trips", aggregation: "sum", groupByColumn: "payment_type" } };
    expect(last(run(b, [[addDv(-3)], [both]]))).toMatchObject({ reason: "config_rejected", detail: "pass tableId or dynamicViewId, not both" });
  });

  it("FOLDDV-4: add_layer bound to a view", () => {
    const b = baseline();
    expect(last(run(b, [[addDv(-3)], [addMapLayer(-9, 44, -3)]])).status).toBe("applied");
    expect(last(run(b, [[addMapLayer(-9, 44, -8)]]))).toMatchObject({ reason: "target_not_found" });
  });

  it("FOLDDV-5: rebind patch (D-24)", () => {
    const savedBound = baseline();
    savedBound.widgets = [barWidget(42, { dynamicViewId: 90, tableId: 5 }), ...savedBound.widgets.slice(1)];
    const pre = [[addDv(-3)]];
    expect(last(run(savedBound, [...pre, [rebind("widget", 42, -3)]])).status).toBe("applied");
    expect(last(run(savedBound, [...pre, [{ op: "patch", action: { target: { kind: "widget", id: 42 }, configPatch: { dynamicViewId: -3, color: "blue" } } }]])))
      .toMatchObject({ reason: "patch_rejected", detail: "change the view binding on its own" });
    expect(last(run(savedBound, [...pre, [rebind("widget", 42, -8)]]))).toMatchObject({ reason: "target_not_found" });
    expect(last(run(savedBound, [...pre, [rebind("layer", 70, -3)]])).status).toBe("applied");
    expect(last(run(savedBound, [...pre, [rebind("layer", 70, -8)]]))).toMatchObject({ reason: "target_not_found" });
    expect(last(run(savedBound, [[rebind("widget", 999, 90)]]))).toMatchObject({ reason: "target_not_found" });
  });

  it("FOLDDV-6: AI views can be filtered (D-23)", () => {
    const b = baseline();
    const dvSrc = (id: number) => ({ kind: "dynamicView" as const, id });
    expect(last(run(b, [[addDv(-3)], [applyFilterRaw(dvSrc(-3), "payment_type")]])).status).toBe("applied");
    expect(last(run(b, [[addDv(-3)], [applyFilterRaw(dvSrc(-8), "payment_type")]]))).toMatchObject({ reason: "target_not_found" });
    const added = run(b, [[addDv(-3)]]);
    const cleared = evaluateTurn(b, added, [clearFilterRaw(dvSrc(-3), "payment_type")], { currentFilters: { "dynamicView:-3": ["payment_type"] } });
    expect(cleared[0].result.status).toBe("applied");
    const src = readFileSync(resolve(process.cwd(), "src/lib/aiSession/foldSession.ts"), "utf8");
    expect(src.includes("can't be filtered yet")).toBe(false);
  });

  it("FOLDDV-7: widget bound to a removed view is target_not_found", () => {
    const b = baseline();
    expect(last(run(b, [[addDv(-3)], [{ op: "remove_dynamic_view", id: -3 }], [addBoundWidget(-1, -3)]]))).toMatchObject({ reason: "target_not_found" });
  });

  it("FOLDDV-8: no client-side session cap", () => {
    const b = baseline();
    const ops = [-1, -2, -3, -4, -5, -6].map((t) => addDv(t));
    const es = run(b, [ops]);
    expect(es.every((e) => e.result.status === "applied")).toBe(true);
  });

  it("FOLDDV-9: an add with a sql key is invalid_op", () => {
    expect(last(run(baseline(), [[{ ...addDv(-3), sql: "SELECT 1" }]]))).toMatchObject({ reason: "invalid_op" });
  });
});

describe("dynamic view fold (139)", () => {
  it("FOLDDV-10: add folds to addedDynamicViews", () => {
    const b = baseline();
    const d = foldSession(b, run(b, [[addDv(-3)]]));
    expect(d.addedDynamicViews).toEqual([
      { id: -3, name: "Trips by type", spec, baseTableId: 5, columns: stamped, maxRecords: 1000, aggregated: true },
    ]);
    expect(d.appliedOpCount).toBe(1);
    const d2 = foldSession(b, run(b, [[addDv(-4, { columns: undefined, aggregated: undefined, maxRecords: undefined })]]));
    expect(d2.addedDynamicViews[0]).toMatchObject({ id: -4, columns: [], aggregated: true });
  });

  it("FOLDDV-11: remove of AI view / saved view; cursor restores", () => {
    const b = baseline();
    const es = run(b, [[addDv(-3)], [{ op: "remove_dynamic_view", id: -3 }, { op: "remove_dynamic_view", id: 90 }]], { removalApproved: true });
    const d = foldSession(b, es);
    expect(d.addedDynamicViews).toEqual([]);
    expect(d.removedDynamicViewIds.has(90)).toBe(true);
    const before = foldSession(b, es.slice(0, 1));
    expect(before.addedDynamicViews.map((v) => v.id)).toEqual([-3]);
    expect(before.removedDynamicViewIds.size).toBe(0);
  });

  const stampedRemove = (over: Record<string, unknown> = {}) => ({
    op: "remove_dynamic_view", id: -3,
    repoint: { tableId: 5, widgetIds: [42], layerIds: [70] },
    drop: { widgetIds: [-1, 43], layerIds: [-9] },
    ...over,
  });
  const setup = (): unknown[][] => [
    [addDv(-3)],
    [rebind("widget", 42, -3), rebind("layer", 70, -3), rebind("widget", 43, -3), addBoundWidget(-1, -3), addMapLayer(-9, 44, -3)],
  ];

  it("FOLDDV-12: remove repoints widgets and layers to the base table", () => {
    const b = baseline();
    const es = run(b, [...setup(), [stampedRemove()]]);
    expect(es.every((e) => e.result.status === "applied")).toBe(true);
    const d = foldSession(b, es);
    const cfg = d.widgetMeta[42].config!;
    expect("dynamicViewId" in cfg).toBe(true);
    expect(cfg.dynamicViewId).toBeUndefined();
    expect(cfg.tableId).toBe(5);
    expect(cfg.table).toBe("demo.trips");
    expect(d.layerBinding[70]).toEqual({ table_id: 5, dynamic_view_id: null });
    expect(d.aiEditedWidgetIds.has(42)).toBe(true);
    expect(d.aiEditedLayerIds.has(70)).toBe(true);
  });

  it("FOLDDV-13: remove drops the stamped dependents", () => {
    const b = baseline();
    const d = foldSession(b, run(b, [...setup(), [stampedRemove()]]));
    expect(d.addedWidgets.map((x) => x.id)).not.toContain(-1);
    expect(d.removedWidgetIds.has(43)).toBe(true);
    expect(d.addedLayers.map((x) => x.id)).not.toContain(-9);
  });

  it("FOLDDV-14: one undo restores the view and every dependent", () => {
    const b = baseline();
    const es = run(b, [...setup(), [stampedRemove()]]);
    const d = foldSession(b, es.slice(0, es.length - 1));
    expect(d.addedDynamicViews.map((v) => v.id)).toEqual([-3]);
    expect(d.widgetMeta[42].config!.dynamicViewId).toBe(-3);
    expect(d.layerBinding[70]).toEqual({ table_id: 5, dynamic_view_id: -3 });
    expect(d.addedWidgets.map((x) => x.id)).toContain(-1);
    expect(d.addedLayers.map((x) => x.id)).toContain(-9);
    expect(d.removedWidgetIds.has(43)).toBe(false);
  });

  it("FOLDDV-15: widget bound to a view reads the base table and derives from base+view columns", () => {
    const b = baseline();
    const op = addBoundWidget(-1, -3) as never;
    const w = makeSessionWidget(op, b, { baseTableId: 5, columns: stamped });
    expect(w.config.dynamicViewId).toBe(-3);
    expect(w.config.tableId).toBe(5);
    expect(w.config.table).toBe("demo.trips");
    expect(String(w.config.sql)).toContain("demo.trips");
    expect(String(w.config.sql)).toContain("trips");
    // via fold: saved view uses dynamicViewSources / dynamicViewColumns
    const es = run(b, [[addBoundWidget(-2, 90)]]);
    const d = foldSession(b, es);
    expect(d.addedWidgets[0].config).toMatchObject({ dynamicViewId: 90, tableId: 5, table: "demo.trips" });
    expect(String(d.addedWidgets[0].config.sql)).toContain("trips");
  });

  it("FOLDDV-16: layer bound to a view", () => {
    const b = baseline();
    const l = makeSessionLayer(addMapLayer(-9, 44, -3) as never, b, 1);
    expect(l.dynamic_view_id).toBe(-3);
    expect(l.table_id).toBe(5);
    expect(makeSessionLayer(addMapLayer(-10, 44) as never, b, 1).dynamic_view_id).toBeNull();
  });

  it("FOLDDV-17: rebind folds to widgetMeta / addedWidgets / layerBinding", () => {
    const b = baseline();
    const d = foldSession(b, run(b, [[addDv(-3)], [rebind("widget", 42, -3), rebind("layer", 70, -3)]]));
    expect(d.widgetMeta[42].config).toMatchObject({ dynamicViewId: -3, tableId: 5, table: "demo.trips" });
    expect(d.layerBinding[70]).toEqual({ table_id: 5, dynamic_view_id: -3 });
    const t = foldSession(b, run(b, [[addDv(-3)], [{ op: "add_widget", tempId: -1, type: "bar", title: "t", config: { metric: "fare_amount", aggregation: "sum", groupByColumn: "payment_type", tableId: 5 } }], [rebind("widget", -1, -3)]]));
    expect(t.addedWidgets[0].config).toMatchObject({ dynamicViewId: -3, tableId: 5, table: "demo.trips" });
  });

  it("FOLDDV-18: PROPERTY no dangling view references (seed 139018)", () => {
    let s = 139018;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
    const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
    for (let n = 0; n < 200; n++) {
      const b = baseline();
      const entries: TurnEntry[] = [];
      const liveDv = new Set<number>([90]);
      let nextDv = -1, nextW = -100, nextL = -200;
      const tempWidgets = new Map<number, number | undefined>(); // id -> bound dv
      const tempLayers = new Map<number, number | undefined>();
      const savedWBound = new Map<number, number | undefined>([[42, undefined], [43, undefined]]);
      const savedLBound = new Map<number, number | undefined>([[70, undefined]]);
      const steps = 4 + Math.floor(rnd() * 10);
      for (let i = 0; i < steps; i++) {
        const kind = pick(["add_dv", "add_dv", "add_w", "add_l", "rebind", "remove_dv", "remove_w"]);
        let op: unknown = null;
        const dvIds = [...liveDv];
        if (kind === "add_dv") {
          op = addDv(nextDv);
          liveDv.add(nextDv--);
        } else if (kind === "add_w") {
          const dv = dvIds.length && rnd() < 0.7 ? pick(dvIds) : undefined;
          const id = nextW--;
          op = dv === undefined
            ? { op: "add_widget", tempId: id, type: "bar", title: "u", config: { tableId: 5, metric: "fare_amount", aggregation: "sum", groupByColumn: "payment_type" } }
            : addBoundWidget(id, dv);
          tempWidgets.set(id, dv);
        } else if (kind === "add_l") {
          const dv = dvIds.length && rnd() < 0.7 ? pick(dvIds) : undefined;
          const id = nextL--;
          op = addMapLayer(id, 44, dv);
          tempLayers.set(id, dv);
        } else if (kind === "rebind" && dvIds.length) {
          const dv = pick(dvIds);
          const pool: [string, number, Map<number, number | undefined>][] = [
            ...[...savedWBound.keys()].map((id) => ["widget", id, savedWBound] as [string, number, Map<number, number | undefined>]),
            ...[...tempWidgets.keys()].map((id) => ["widget", id, tempWidgets] as [string, number, Map<number, number | undefined>]),
            ...[...savedLBound.keys()].map((id) => ["layer", id, savedLBound] as [string, number, Map<number, number | undefined>]),
            ...[...tempLayers.keys()].map((id) => ["layer", id, tempLayers] as [string, number, Map<number, number | undefined>]),
          ];
          if (pool.length) {
            const [k, id, m] = pick(pool);
            op = rebind(k as "widget" | "layer", id, dv);
            m.set(id, dv);
          }
        } else if (kind === "remove_dv" && dvIds.length) {
          const id = pick(dvIds);
          const wIds = [...savedWBound, ...tempWidgets].filter(([, dv]) => dv === id).map(([w]) => w);
          const lIds = [...savedLBound, ...tempLayers].filter(([, dv]) => dv === id).map(([l]) => l);
          const plan = planDvDependents({
            widgets: wIds.map((w) => ({ id: w, type: "bar", refs: aiWidgetColumnRefs(rnd() < 0.5 ? { metric: "trips" } : { metric: "fare_amount" }) })),
            layers: lIds.map((l) => ({ id: l, refs: aiLayerColumnRefs(rnd() < 0.5 ? { latColumn: "lat" } : { latColumn: "nope" }) })),
            baseColumns: ["fare_amount", "payment_type", "lat", "lon"],
          });
          op = { op: "remove_dynamic_view", id, repoint: { tableId: 5, ...plan.repoint }, drop: plan.drop };
          liveDv.delete(id);
          for (const w of plan.repoint.widgetIds) (savedWBound.has(w) ? savedWBound : tempWidgets).set(w, undefined);
          for (const l of plan.repoint.layerIds) (savedLBound.has(l) ? savedLBound : tempLayers).set(l, undefined);
          for (const w of plan.drop.widgetIds) { savedWBound.delete(w); tempWidgets.delete(w); }
          for (const l of plan.drop.layerIds) { savedLBound.delete(l); tempLayers.delete(l); }
        } else if (kind === "remove_w") {
          const ids = [...tempWidgets.keys()];
          if (ids.length) { const id = pick(ids); op = { op: "remove_widget", id }; tempWidgets.delete(id); }
        }
        if (op) entries.push(...evaluateTurn(b, entries, [op], { removalApproved: true }));
      }
      const cut = Math.floor(rnd() * (entries.length + 1));
      const prefix = entries.slice(0, cut);
      const d = foldSession(b, prefix);
      const effViews = new Set<number>([...applySessionToDynamicViews([{ id: 90 }], d).map((v) => v.id), ...d.addedDynamicViews.map((v) => v.id)]);
      for (const wd of applySessionToWidgets(b.widgets as WidgetDto[], d)) {
        const v = wd.config.dynamicViewId;
        if (v !== undefined && v !== null) expect(effViews.has(v as number), `widget ${wd.id} -> ${String(v)} (run ${n})`).toBe(true);
      }
      for (const ly of applySessionToLayers([...b.layers], d)) {
        if (ly.dynamic_view_id !== null && ly.dynamic_view_id !== undefined) {
          expect(effViews.has(ly.dynamic_view_id), `layer ${ly.id} -> ${ly.dynamic_view_id} (run ${n})`).toBe(true);
        }
      }
    }
  });
});
