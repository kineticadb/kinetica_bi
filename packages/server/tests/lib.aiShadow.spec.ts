import { describe, it, expect } from "vitest";
import type { AiOp } from "@kinetica-bi/shared";
import { createShadow, applyOpToShadow, describeOp, describeIntent, shadowRects } from "../src/lib/ai/shadow";
import { CANARY_ROW_VALUE_9f3 as C } from "./helpers/aiTestKit";

const snap = {
  widgets: [
    { id: 42, type: "map", title: "Trips", tableId: 7 },
    { id: -3, type: "bar", title: "Temp", tableId: 7 },
  ],
  layers: [{ id: 70, widgetId: 42, tableId: 7 }],
  dynamicViews: [{ id: 90, name: "dv" }],
  filters: [],
};

describe("shadow state", () => {
  it("SHD-1: maps the snapshot and pre-marks negative ids used", () => {
    const s = createShadow(snap);
    expect(s.widgets.get(42)).toMatchObject({ type: "map", title: "Trips", tableId: 7 });
    expect(s.layers.get(70)).toMatchObject({ widgetId: 42, tableId: 7 });
    expect(s.dynamicViews.has(90)).toBe(true);
    expect(s.usedTempIds.has(-3)).toBe(true);
    expect(s.usedTempIds.has(42)).toBe(false);
  });

  it("SHD-2: structural ops mutate; patch does not", () => {
    const s = createShadow(snap);
    applyOpToShadow(s, { op: "add_widget", tempId: -1, type: "bar", title: "New", config: { tableId: 7 } });
    expect(s.widgets.get(-1)).toMatchObject({ type: "bar", title: "New", tableId: 7 });
    expect(s.usedTempIds.has(-1)).toBe(true);
    applyOpToShadow(s, { op: "add_layer", tempId: -2, widgetId: 42, tableId: 1, renderMode: "heatmap", spatialMode: "latlon", latColumn: "lat", lonColumn: "lon" });
    expect(s.layers.has(-2)).toBe(true);
    applyOpToShadow(s, { op: "add_dynamic_view", tempId: -4, name: "V", spec: { baseTableId: 7, columns: [{ column: "a" }] } });
    expect(s.dynamicViews.has(-4)).toBe(true);
    const before = s.widgets.size;
    applyOpToShadow(s, { op: "patch", action: { target: { kind: "widget", id: 42 }, configPatch: { a: 1 } } });
    expect(s.widgets.size).toBe(before);
    applyOpToShadow(s, { op: "remove_widget", id: 42 });
    expect(s.widgets.has(42)).toBe(false);
    applyOpToShadow(s, { op: "remove_layer", id: 70 });
    expect(s.layers.has(70)).toBe(false);
    applyOpToShadow(s, { op: "remove_dynamic_view", id: 90 });
    expect(s.dynamicViews.has(90)).toBe(false);
  });

  it("SHD-3: describeOp uses titles/ids only, never config values", () => {
    const s = createShadow(snap);
    const add: AiOp = { op: "add_widget", tempId: -1, type: "bar", title: "Trips by vendor", config: { x: C } };
    expect(describeOp(add, s)).toBe('Added bar "Trips by vendor"');
    const patch: AiOp = { op: "patch", action: { target: { kind: "widget", id: 42 }, configPatch: { x: C } } };
    expect(describeOp(patch, s)).toBe('Changed widget "Trips"');
    expect(describeOp({ op: "remove_layer", id: 7 }, s)).toBe("Removed layer 7");
    for (const op of [add, patch]) expect(describeOp(op, s)).not.toContain(C);
  });
});

describe("shadow state (phase 136)", () => {
  const snap6 = {
    widgets: [
      { id: 5, type: "bar", title: "Revenue", tableId: 7, layout: { x: 0, y: 0, w: 18, h: 30 }, binding: { groupByColumns: ["a", "b"] } },
      { id: 6, type: "line", title: "Second", tableId: 7, dynamicViewId: 90, binding: { groupByColumn: "g" } },
      { id: 8, type: "map", title: "Trips map" },
      { id: -3, type: "bar", title: "Temp", tableId: 7 },
    ],
    layers: [
      { id: 70, widgetId: 8, tableId: 7, renderMode: "heatmap", title: "Pickups" },
      { id: -4, widgetId: 8 },
    ],
    dynamicViews: [{ id: 90, name: "dv" }],
    filters: [],
  };
  it("SHD6-1: rects, saved flags, groupByCount, dv, layers", () => {
    const s = createShadow(snap6);
    expect(s.widgets.get(5)).toMatchObject({ saved: true, rect: { x: 0, y: 0, w: 18, h: 30 }, groupByCount: 2 });
    expect(s.widgets.get(6)).toMatchObject({ saved: true, rect: { x: 18, y: 0, w: 18, h: 24 }, dynamicViewId: 90, groupByCount: 1 });
    expect(s.widgets.get(8)).toMatchObject({ saved: true, groupByCount: 0 });
    expect(s.widgets.get(-3)).toMatchObject({ saved: false });
    expect(s.layers.get(70)).toMatchObject({ saved: true, renderMode: "heatmap", tableId: 7, widgetId: 8, title: "Pickups" });
    expect(s.layers.get(-4)).toMatchObject({ saved: false });
  });
  it("SHD6-2: ops update rects, types, titles, layers", () => {
    const s = createShadow(snap6);
    applyOpToShadow(s, { op: "add_widget", tempId: -1, type: "bar", title: "N", config: { tableId: 7 }, layout: { x: 0, y: 60, w: 18, h: 30 } });
    expect(s.widgets.get(-1)).toMatchObject({ saved: false, rect: { x: 0, y: 60, w: 18, h: 30 } });
    applyOpToShadow(s, { op: "set_layout", items: [{ id: 5, x: 18, y: 0, w: 18, h: 30 }] });
    expect(s.widgets.get(5)!.rect).toEqual({ x: 18, y: 0, w: 18, h: 30 });
    applyOpToShadow(s, { op: "change_widget_type", id: 5, type: "line" });
    expect(s.widgets.get(5)!.type).toBe("line");
    applyOpToShadow(s, { op: "set_widget_title", id: 5, title: "Z" });
    expect(s.widgets.get(5)!.title).toBe("Z");
    applyOpToShadow(s, { op: "add_layer", tempId: -2, widgetId: 8, tableId: 7, renderMode: "heatmap", spatialMode: "latlon", latColumn: "a", lonColumn: "b" });
    expect(s.layers.get(-2)).toMatchObject({ renderMode: "heatmap", tableId: 7, widgetId: 8, saved: false });
    expect(shadowRects(s).find((r) => r.id === 5)).toMatchObject({ x: 18 });
  });
  it("SHD6-3: describeOp placement labels", () => {
    const s = createShadow(snap6);
    const add = (y: number): AiOp => ({ op: "add_widget", tempId: -1, type: "bar", title: "Fares", config: {}, layout: { x: 18, y, w: 18, h: 30 } });
    expect(describeOp(add(2), s)).toBe('Added bar "Fares" at row 2, column 18');
    expect(describeOp(add(60), s)).toBe('Added bar "Fares" below existing content');
    expect(describeOp({ op: "change_widget_type", id: 5, type: "line" }, s)).toBe('Changed "Revenue" to a line chart');
    expect(describeOp({ op: "set_widget_title", id: 5, title: "Revenue by vendor" }, s)).toBe('Renamed "Revenue" to "Revenue by vendor"');
    expect(describeOp({ op: "add_layer", tempId: -9, widgetId: 8, tableId: 7, renderMode: "heatmap", spatialMode: "wkt", wktColumn: "g", name: "Pickups" }, s)).toBe('Added heatmap layer "Pickups" to map "Trips map"');
    expect(describeOp({ op: "set_layout", items: [{ id: 5, x: 0, y: 0, w: 6, h: 6 }, { id: 6, x: 6, y: 0, w: 6, h: 6 }] }, s)).toBe("Rearranged 2 widgets");
  });
  it("SHD6-4: describeIntent titles/ids only", () => {
    const s = createShadow(snap6);
    expect(describeIntent({ op: "add_widget", tempId: -1, type: "bar", title: "Fares", config: { x: C } }, s)).toBe('Add bar "Fares"');
    expect(describeIntent({ op: "patch", action: { target: { kind: "widget", id: 5 }, configPatch: { x: C } } }, s)).toBe('Change widget "Revenue"');
    expect(describeIntent({ op: "remove_widget", id: 5 }, s)).toBe('Remove widget "Revenue"');
    expect(describeIntent({ op: "add_layer", tempId: -9, widgetId: 8, tableId: 7, renderMode: "heatmap", spatialMode: "wkt", wktColumn: "g", name: "Pickups" }, s)).toBe('Add heatmap layer "Pickups"');
    expect(describeIntent({ op: "set_layout", items: [{ id: 5, x: 0, y: 0, w: 6, h: 6 }] }, s)).toBe("Rearrange widgets");
  });
});

describe("shadow state (phase 139 dynamic views)", () => {
  const spec = { baseTableId: 7, columns: [{ column: "a" }] };
  const snap139 = {
    widgets: [
      { id: 42, type: "bar", title: "Fares", tableId: 7, binding: { metric: "fare", groupByColumn: "vendor", columns: ["a"] } },
      { id: -1, type: "bar", title: "Tmp", tableId: 7, dynamicViewId: -3 },
    ],
    layers: [{ id: 70, widgetId: 42, tableId: 7, dynamicViewId: -3, columns: ["lat", "lon"] }],
    dynamicViews: [
      { id: -3, name: "Trips by hour", baseTableId: 5, aggregated: true, columns: [{ name: "trips", type: "long" }] },
      { id: 90, name: "Late" },
    ],
    filters: [],
  };
  const addV = (cols?: { name: string; type: string }[]): AiOp => ({ op: "add_dynamic_view", tempId: -4, name: "V", spec, ...(cols ? { columns: cols, aggregated: false } : {}) });

  it("SHDV-1: seeds dvInfo, refCols and layer dv binding", () => {
    const s = createShadow(snap139);
    expect(s.dvInfo.get(-3)).toEqual({ name: "Trips by hour", baseTableId: 5, aggregated: true, columns: [{ name: "trips", type: "long" }] });
    expect(s.dvInfo.get(90)).toEqual({ name: "Late" });
    expect(s.widgets.get(42)?.refCols).toEqual(["fare", "vendor", "a"]);
    expect(s.layers.get(70)).toMatchObject({ dynamicViewId: -3, refCols: ["lat", "lon"] });
  });

  it("SHDV-2: add_dynamic_view records dvInfo and the temp id", () => {
    const s = createShadow(snap139);
    applyOpToShadow(s, addV([{ name: "a", type: "string" }]));
    expect(s.dynamicViews.has(-4)).toBe(true);
    expect(s.dvInfo.get(-4)).toEqual({ name: "V", baseTableId: 7, columns: [{ name: "a", type: "string" }], aggregated: false });
    expect(s.usedTempIds.has(-4)).toBe(true);
  });

  it("SHDV-3: add_widget / add_layer bound to a view", () => {
    const s = createShadow(snap139);
    applyOpToShadow(s, addV());
    applyOpToShadow(s, { op: "add_widget", tempId: -5, type: "bar", title: "B", config: { dynamicViewId: -4, metric: "trips", groupByColumn: "pickup_hour" } });
    expect(s.widgets.get(-5)).toMatchObject({ dynamicViewId: -4, refCols: ["trips", "pickup_hour"], tableId: 7 });
    applyOpToShadow(s, { op: "add_layer", tempId: -6, widgetId: 42, tableId: 7, renderMode: "heatmap", spatialMode: "latlon", latColumn: "lat", lonColumn: "lon", style: { valueColumn: "v" }, dynamicViewId: -4 } as AiOp);
    expect(s.layers.get(-6)).toMatchObject({ dynamicViewId: -4, refCols: ["lat", "lon", "v"] });
  });

  it("SHDV-4: remove_dynamic_view applies repoint and drop", () => {
    const s = createShadow(snap139);
    s.widgets.get(42)!.dynamicViewId = -3;
    applyOpToShadow(s, { op: "remove_dynamic_view", id: -3, repoint: { tableId: 7, widgetIds: [42], layerIds: [70] }, drop: { widgetIds: [-1], layerIds: [] } });
    expect(s.dynamicViews.has(-3)).toBe(false);
    expect(s.dvInfo.has(-3)).toBe(false);
    expect(s.widgets.get(42)?.dynamicViewId).toBeUndefined();
    expect(s.widgets.get(42)?.tableId).toBe(7);
    expect(s.layers.get(70)?.dynamicViewId).toBeUndefined();
    expect(s.layers.get(70)?.tableId).toBe(7);
    expect(s.widgets.has(-1)).toBe(false);
  });

  it("SHDV-5: patch rebinding to a view", () => {
    const s = createShadow(snap139);
    applyOpToShadow(s, { op: "patch", action: { target: { kind: "widget", id: 42 }, configPatch: { dynamicViewId: -3 } } });
    expect(s.widgets.get(42)).toMatchObject({ dynamicViewId: -3, tableId: 5 });
    applyOpToShadow(s, { op: "patch", action: { target: { kind: "layer", id: 70 }, configPatch: { dynamicViewId: -3 } } });
    expect(s.layers.get(70)).toMatchObject({ dynamicViewId: -3, tableId: 5 });
  });

  it("SHDV-6: labels", () => {
    const s = createShadow(snap139);
    expect(describeOp(addV(), s)).toBe('Added dynamic view "V"');
    const rm: AiOp = { op: "remove_dynamic_view", id: -3, repoint: { tableId: 5, widgetIds: [42], layerIds: [70] }, drop: { widgetIds: [-1], layerIds: [] } };
    expect(describeOp(rm, s)).toBe('Removed dynamic view "Trips by hour"; repointed "Fares" and layer 70 to its table; removed "Tmp"');
    s.layers.get(70)!.title = "Heat";
    expect(describeOp(rm, s)).toBe('Removed dynamic view "Trips by hour"; repointed "Fares" and layer "Heat" to its table; removed "Tmp"');
    expect(describeOp({ op: "remove_dynamic_view", id: -3 }, s)).toBe('Removed dynamic view "Trips by hour"');
    expect(describeIntent(addV(), s)).toBe('Add dynamic view "V"');
    expect(describeIntent({ op: "remove_dynamic_view", id: 90 }, s)).toBe('Remove dynamic view "Late"');
  });

  it("SHDV-7: labels never carry spec filter values", () => {
    const s = createShadow(snap139);
    const op: AiOp = { op: "add_dynamic_view", tempId: -4, name: "V", spec: { ...spec, filters: [{ column: "a", operator: "eq", value: "SECRETVAL_139" }] } } as AiOp;
    expect(describeOp(op, s)).not.toContain("SECRETVAL_139");
    expect(describeIntent(op, s)).not.toContain("SECRETVAL_139");
  });
});
