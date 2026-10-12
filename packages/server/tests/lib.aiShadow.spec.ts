import { describe, it, expect } from "vitest";
import type { AiOp } from "@kinetica-bi/shared";
import { createShadow, applyOpToShadow, describeOp } from "../src/lib/ai/shadow";
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
    expect(s.widgets.get(42)).toEqual({ type: "map", title: "Trips", tableId: 7 });
    expect(s.layers.get(70)).toEqual({ widgetId: 42, tableId: 7 });
    expect(s.dynamicViews.has(90)).toBe(true);
    expect(s.usedTempIds.has(-3)).toBe(true);
    expect(s.usedTempIds.has(42)).toBe(false);
  });

  it("SHD-2: structural ops mutate; patch does not", () => {
    const s = createShadow(snap);
    applyOpToShadow(s, { op: "add_widget", tempId: -1, type: "bar", title: "New", config: { tableId: 7 } });
    expect(s.widgets.get(-1)).toEqual({ type: "bar", title: "New", tableId: 7 });
    expect(s.usedTempIds.has(-1)).toBe(true);
    applyOpToShadow(s, { op: "add_layer", tempId: -2, widgetId: 42 });
    expect(s.layers.has(-2)).toBe(true);
    applyOpToShadow(s, { op: "add_dynamic_view", tempId: -4 });
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
