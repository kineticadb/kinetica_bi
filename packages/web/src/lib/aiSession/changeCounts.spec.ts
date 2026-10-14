import { describe, it, expect } from "vitest";
import { computeChangeCounts, changedWidgetIds } from "./changeCounts";
import { EMPTY_DERIVED, AI_ASSISTANT_DEFAULT_SIZE, isSmallAiTile } from "./constants";
import type { SessionDerived, TurnEntry } from "./types";
import type { WidgetDto, DashboardLayerDto } from "../../api/client";

const w = (id: number, title: string, type = "bar", config: Record<string, unknown> = {}) =>
  ({ id, title, type, config, dashboard_id: 1, position: 0, created_at: "", updated_at: "" }) as WidgetDto;
const l = (id: number, config: Record<string, unknown> = {}) => ({ id, config }) as unknown as DashboardLayerDto;
const applied = (op: unknown): TurnEntry => ({ raw: op, op: op as TurnEntry["op"], result: { status: "applied" } });

describe("computeChangeCounts", () => {
  const derived: SessionDerived = {
    ...EMPTY_DERIVED,
    addedWidgets: [w(-1, "a"), w(-2, "b")],
    addedLayers: [l(-3)],
    aiEditedWidgetIds: new Set([3, 4]),
    aiEditedLayerIds: new Set([9]),
    removedWidgetIds: new Set([5]),
    removedLayerIds: new Set([8]),
  };
  it("CC-1: sums widgets and layers", () => {
    const r = computeChangeCounts(derived, { widgets: [], layers: [] });
    expect([r.added, r.edited, r.removed]).toEqual([3, 3, 2]);
  });
  it("CC-2: removed names with fallbacks", () => {
    const r = computeChangeCounts(derived, { widgets: [w(5, "Revenue")], layers: [l(8, { name: "Pickups heat" })] });
    expect(r.removedNames).toEqual(["Revenue", "Pickups heat"]);
    const r2 = computeChangeCounts(derived, { widgets: [w(5, "Revenue")], layers: [l(8, { title: "T" })] });
    expect(r2.removedNames[1]).toBe("T");
    const r3 = computeChangeCounts(derived, { widgets: [w(5, "Revenue")], layers: [l(8)] });
    expect(r3.removedNames[1]).toBe("Layer 8");
  });
});

describe("changedWidgetIds", () => {
  const map2 = w(2, "Map", "map");
  const ctx = { widgets: [w(4, "x"), map2], layers: [{ id: 9 }] };
  it("CC-3: collects ids from applied ops only", () => {
    const entries: TurnEntry[] = [
      applied({ op: "add_widget", tempId: -3, type: "bar", title: "t", config: {} }),
      applied({ op: "patch", action: { target: { kind: "widget", id: 4 }, configPatch: {} } }),
      applied({ op: "patch", action: { target: { kind: "layer", id: 9 }, configPatch: {} } }),
      applied({ op: "add_layer", tempId: -4, widgetId: 2 }),
      applied({ op: "set_layout", items: [{ id: 4 }, { id: 6 }] }),
      applied({ op: "set_widget_title", id: 7, title: "x" }),
      applied({ op: "remove_widget", id: 5 }),
      { raw: null, op: { op: "set_widget_title", id: 99, title: "x" }, result: { status: "skipped", reason: "invalid_op" } },
    ];
    expect(changedWidgetIds(entries, ctx).sort((a, b) => a - b)).toEqual([-3, 2, 4, 6, 7]);
  });
  it("CC-3b: layer-only edits mark the host map", () => {
    expect(changedWidgetIds([applied({ op: "remove_layer", id: 9 })], ctx)).toEqual([2]);
    const eff = { widgets: [w(2, "Map", "map", { includedLayerIds: [23, -1] })], layers: [{ id: 23 }, { id: -1 }] };
    expect(changedWidgetIds([applied({ op: "patch", action: { target: { kind: "layer", id: -1 }, configPatch: {} } })], eff)).toEqual([2]);
    const other = { widgets: [w(2, "Map", "map", { includedLayerIds: [23] })], layers: [{ id: 23 }, { id: 9 }] };
    expect(changedWidgetIds([applied({ op: "remove_layer", id: 9 })], other)).toEqual([]);
    const open = { widgets: [w(2, "Map", "map", { includedLayerIds: [] })], layers: [{ id: 9 }] };
    expect(changedWidgetIds([applied({ op: "remove_layer", id: 9 })], open)).toEqual([2]);
  });
});

describe("size constants", () => {
  it("CC-4: small tile rule and default size", () => {
    expect(isSmallAiTile({ w: 11, h: 40 })).toBe(true);
    expect(isSmallAiTile({ w: 12, h: 23 })).toBe(true);
    expect(isSmallAiTile({ w: 12, h: 24 })).toBe(false);
    expect(AI_ASSISTANT_DEFAULT_SIZE).toEqual({ w: 12, h: 40 });
    expect(isSmallAiTile(AI_ASSISTANT_DEFAULT_SIZE)).toBe(false);
  });
});
