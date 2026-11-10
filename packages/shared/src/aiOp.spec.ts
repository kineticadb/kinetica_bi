import { describe, it, expect } from "vitest";
import { z } from "zod";
import { AiOpSchema, AI_OP_KINDS, parseAiOp, aiOpDependencies, closeSelection, dependentsOf, isClosedSelection } from "./aiOp";
import { WidgetActionTargetSchema } from "./widgetAction";

const patch = (id: number, extra: Record<string, unknown> = {}) => ({
  op: "patch",
  action: { target: { kind: "widget", id }, configPatch: { title: "x" }, ...extra },
});
const addWidget = (tempId: number, extra: Record<string, unknown> = {}) => ({
  op: "add_widget", tempId, type: "bar", title: "t", config: {}, ...extra,
});

describe("AiOpSchema", () => {
  it("AIOP-1: patch with saved positive id is ok", () => {
    expect(parseAiOp(patch(5)).ok).toBe(true);
  });
  it("AIOP-2: patch with negative temp id is ok", () => {
    expect(parseAiOp(patch(-3)).ok).toBe(true);
  });
  it("AIOP-3: patch with id 0 is rejected", () => {
    expect(parseAiOp(patch(0)).ok).toBe(false);
  });
  it("AIOP-4: unknown op, empty object and null are rejected", () => {
    expect(parseAiOp({ op: "drop_table" }).ok).toBe(false);
    expect(parseAiOp({}).ok).toBe(false);
    expect(parseAiOp(null).ok).toBe(false);
  });
  it("AIOP-5: add_widget requires a negative tempId", () => {
    expect(parseAiOp(addWidget(4)).ok).toBe(false);
    expect(parseAiOp(addWidget(-1)).ok).toBe(true);
  });
  it("AIOP-6: add_widget rejects extra keys (strict)", () => {
    expect(parseAiOp(addWidget(-1, { sql: "DROP TABLE x" })).ok).toBe(false);
  });
  it("AIOP-7: patch rejects extra keys on action and on target", () => {
    expect(parseAiOp(patch(5, { sql: "x" })).ok).toBe(false);
    expect(
      parseAiOp({
        op: "patch",
        action: { target: { kind: "widget", id: 5, sql: "x" }, configPatch: {} },
      }).ok,
    ).toBe(false);
  });
  it("AIOP-8: op literals match AI_OP_KINDS exactly", () => {
    const literals = AiOpSchema.options.map((o) => o.shape.op.value).sort();
    expect(literals).toEqual([...AI_OP_KINDS].sort());
    expect(AI_OP_KINDS.length).toBe(12);
  });
  it("AIOP-9: web engine target schema stays positive-only", () => {
    expect(WidgetActionTargetSchema.safeParse({ kind: "widget", id: -1 }).success).toBe(false);
  });
  it("AIOP-10: parseAiOp reports path-prefixed errors", () => {
    const r = parseAiOp(addWidget(4));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.startsWith("tempId:"))).toBe(true);
  });
});

const heat = (extra: Record<string, unknown> = {}) => ({
  op: "add_layer", tempId: -2, widgetId: 7, tableId: 4, renderMode: "heatmap", spatialMode: "latlon",
  latColumn: "pickup_latitude", lonColumn: "pickup_longitude", name: "Pickups",
  style: { colormap: "plasma", blurRadius: 8, opacity: 0.7, valueColumn: "fare_amount" }, ...extra,
});
describe("Phase 136 ops", () => {
  it("AIOP6-1: 12 kinds incl. new ones", () => {
    expect(AI_OP_KINDS.length).toBe(12);
    for (const k of ["set_layout", "change_widget_type", "set_widget_title"]) expect(AI_OP_KINDS as readonly string[]).toContain(k);
  });
  it("AIOP6-2: valid heatmap add_layer", () => {
    expect(parseAiOp(heat()).ok).toBe(true);
  });
  it("AIOP6-3: invalid add_layer", () => {
    expect(parseAiOp(heat({ renderMode: "raster" })).ok).toBe(false);
    const a = parseAiOp(heat({ lonColumn: undefined }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.errors).toContain("lonColumn is required for spatialMode latlon");
    expect(parseAiOp(heat({ spatialMode: "wkt" })).ok).toBe(false);
    expect(parseAiOp(heat({ style: { colormap: "#ff0000" } })).ok).toBe(false);
    expect(parseAiOp(heat({ style: { bogus: 1 } })).ok).toBe(false);
    expect(parseAiOp(heat({ latColumn: "a b" })).ok).toBe(false);
  });
  const rect = { x: 0, y: 0, w: 18, h: 10 };
  it("AIOP6-4: set_layout", () => {
    expect(parseAiOp({ op: "set_layout", items: [{ id: 1, ...rect }, { id: -2, ...rect, x: 18 }] }).ok).toBe(true);
    expect(parseAiOp({ op: "set_layout", items: [] }).ok).toBe(false);
    expect(parseAiOp({ op: "set_layout", items: Array.from({ length: 31 }, (_, i) => ({ id: i + 1, ...rect })) }).ok).toBe(false);
    expect(parseAiOp({ op: "set_layout", items: [{ id: 1, ...rect, w: 5 }] }).ok).toBe(false);
    expect(parseAiOp({ op: "set_layout", items: [{ id: 1, ...rect, extra: 1 }] }).ok).toBe(false);
  });
  it("AIOP6-5: change_widget_type", () => {
    for (const t of ["bar", "line", "pie"]) expect(parseAiOp({ op: "change_widget_type", id: 1, type: t }).ok).toBe(true);
    for (const t of ["table", "records", "map"]) expect(parseAiOp({ op: "change_widget_type", id: 1, type: t }).ok).toBe(false);
  });
  it("AIOP6-6: set_widget_title and add_widget layout", () => {
    expect(parseAiOp({ op: "set_widget_title", id: 1, title: "" }).ok).toBe(false);
    expect(parseAiOp({ op: "set_widget_title", id: 1, title: "x".repeat(201) }).ok).toBe(false);
    expect(parseAiOp({ op: "set_widget_title", id: 1, title: "ok" }).ok).toBe(true);
    expect(parseAiOp(addWidget(-1, { layout: rect })).ok).toBe(true);
    expect(parseAiOp(addWidget(-1, { layout: { ...rect, w: 4 } })).ok).toBe(false);
  });
  it("AIOP6-7: no op schema has a sql property", () => {
    const walk = (shape: Record<string, z.ZodTypeAny>, path: string): string[] => {
      const hits: string[] = [];
      for (const k of Object.keys(shape)) {
        if (k === "sql") hits.push(`${path}.${k}`);
        let t: z.ZodTypeAny = shape[k];
        while (t instanceof z.ZodOptional || t instanceof z.ZodArray) t = t instanceof z.ZodOptional ? t.unwrap() : t.element;
        if (t instanceof z.ZodObject) hits.push(...walk(t.shape, `${path}.${k}`));
      }
      return hits;
    };
    const hits = AiOpSchema.options.flatMap((o) => walk(o.shape as Record<string, z.ZodTypeAny>, o.shape.op.value));
    expect(hits).toEqual([]);
  });
});

describe("Phase 138 filter ops", () => {
  const src = { kind: "table", id: 5 };
  const f = { column: "payment_type", operator: "eq", value: "Credit" };
  it("AF1-9: apply_filter shape", () => {
    expect(parseAiOp({ op: "apply_filter", source: src, filters: [f] }).ok).toBe(true);
    expect(parseAiOp({ op: "apply_filter", widgetId: 42 }).ok).toBe(false);
    expect(parseAiOp({ op: "apply_filter", source: src, filters: [] }).ok).toBe(false);
    const many = Array.from({ length: 11 }, (_, i) => ({ column: `c${i}`, operator: "eq", value: "x" }));
    expect(parseAiOp({ op: "apply_filter", source: src, filters: many }).ok).toBe(false);
    const dup = parseAiOp({ op: "apply_filter", source: src, filters: [f, f] });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.errors.some((e) => e.includes("payment_type"))).toBe(true);
    const bad = parseAiOp({ op: "apply_filter", source: src, filters: [{ column: "a", operator: "in", value: "x" }] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.some((e) => e.startsWith("filters.0"))).toBe(true);
  });
  it("AF1-10: clear_filter shape", () => {
    expect(parseAiOp({ op: "clear_filter" }).ok).toBe(true);
    expect(parseAiOp({ op: "clear_filter", source: { kind: "dynamicView", id: 90 } }).ok).toBe(true);
    expect(parseAiOp({ op: "clear_filter", source: src, column: "vendor_id" }).ok).toBe(true);
    const r = parseAiOp({ op: "clear_filter", column: "vendor_id" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toContain("column needs a source");
    expect(parseAiOp({ op: "clear_filter", widgetId: 42 }).ok).toBe(false);
  });
});

describe("Phase 139 dynamic view ops", () => {
  const spec = {
    baseTableId: 5,
    groupBy: [{ column: "pickup_datetime", bucket: "hour", as: "pickup_hour" }],
    aggregates: [{ fn: "count", as: "trips" }],
  };
  const addDv = (extra: Record<string, unknown> = {}) => ({ op: "add_dynamic_view", tempId: -3, name: "Trips by hour", spec, ...extra });
  it("DVOP-1: name + spec required", () => {
    expect(parseAiOp(addDv()).ok).toBe(true);
    expect(parseAiOp({ op: "add_dynamic_view", tempId: -3 }).ok).toBe(false);
    expect(parseAiOp(addDv({ name: "" })).ok).toBe(false);
    expect(parseAiOp(addDv({ name: "x".repeat(81) })).ok).toBe(false);
  });
  it("DVOP-2: cross-field spec failure is reported with a spec: prefix", () => {
    const r = parseAiOp(addDv({ spec: { ...spec, columns: [{ column: "a" }] } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/^spec: use columns for a row view/);
  });
  it("DVOP-3: gateway-stamped fields", () => {
    expect(parseAiOp(addDv({ columns: [{ name: "trips", type: "long" }], maxRecords: 100000, aggregated: true })).ok).toBe(true);
    expect(parseAiOp(addDv({ columns: [{ name: "x;y", type: "long" }] })).ok).toBe(false);
  });
  it("DVOP-4: remove_dynamic_view dependents", () => {
    expect(parseAiOp({ op: "remove_dynamic_view", id: -3 }).ok).toBe(true);
    const full = {
      op: "remove_dynamic_view", id: -3,
      repoint: { tableId: 5, widgetIds: [42, -7], layerIds: [] },
      drop: { widgetIds: [], layerIds: [-9] },
    };
    expect(parseAiOp(full).ok).toBe(true);
    expect(parseAiOp({ ...full, repoint: { tableId: 0, widgetIds: [], layerIds: [] } }).ok).toBe(false);
    expect(parseAiOp({ op: "remove_dynamic_view", id: -3, sql: "x" }).ok).toBe(false);
  });
  it("DVOP-5: add_layer dynamicViewId", () => {
    const layer = { op: "add_layer", tempId: -4, widgetId: -2, tableId: 5, renderMode: "heatmap", spatialMode: "latlon", latColumn: "lat", lonColumn: "lon" };
    expect(parseAiOp({ ...layer, dynamicViewId: -3 }).ok).toBe(true);
    expect(parseAiOp({ ...layer, dynamicViewId: 0 }).ok).toBe(false);
  });
  it("DVOP-6: no new op kind", () => {
    expect(AI_OP_KINDS.length).toBe(12);
  });
});

describe("Phase 150 op dependencies", () => {
  const rect = { x: 0, y: 0, w: 6, h: 6 };
  const OPS: unknown[] = [
    { op: "add_dynamic_view", tempId: -1, name: "v", spec: { baseTableId: 7, columns: [{ column: "a" }] } },
    { op: "add_widget", tempId: -2, type: "bar", title: "t", config: { dynamicViewId: -1 } },
    { op: "apply_filter", source: { kind: "dynamicView", id: -1 }, filters: [{ column: "c", operator: "eq", value: "x" }] },
    { op: "add_widget", tempId: -3, type: "map", title: "m", config: {} },
    { op: "add_layer", tempId: -4, widgetId: -3, tableId: 7, renderMode: "heatmap", spatialMode: "wkt", wktColumn: "g" },
    { op: "set_layout", items: [{ id: -2, ...rect }, { id: 5, ...rect }] },
    { op: "apply_filter", source: { kind: "table", id: 7 }, filters: [{ column: "vendor", operator: "eq", value: "x" }] },
    { op: "clear_filter", source: { kind: "table", id: 7 }, column: "vendor" },
    { op: "set_widget_title", id: -2, title: "n" },
    { op: "remove_widget", id: 12 },
  ];
  const deps = () => aiOpDependencies(OPS);
  it("APPRDEP-1: per-op prerequisites", () => {
    expect(deps()).toEqual([[], [0], [0], [], [3], [1], [], [6], [1], []]);
  });
  it("APPRDEP-2: patch, change type, remove and rebind references", () => {
    const base = OPS.slice(0, 5);
    const d = (extra: unknown) => aiOpDependencies([...base, extra])[5];
    expect(d({ op: "patch", action: { target: { kind: "widget", id: -2 }, configPatch: { title: "x" } } })).toEqual([1]);
    expect(d({ op: "patch", action: { target: { kind: "widget", id: 9 }, configPatch: { dynamicViewId: -1 } } })).toEqual([0]);
    expect(d({ op: "change_widget_type", id: -2, type: "line" })).toEqual([1]);
    expect(d({ op: "remove_layer", id: -4 })).toEqual([4]);
    expect(d({ op: "remove_dynamic_view", id: -1, drop: { widgetIds: [-2], layerIds: [] } })).toEqual([0, 1]);
    expect(d({ op: "add_layer", tempId: -9, widgetId: 5, tableId: 7, renderMode: "heatmap", spatialMode: "wkt", wktColumn: "g", dynamicViewId: -1 })).toEqual([0]);
  });
  it("APPRDEP-3: clear_filter depends on the filters it undoes", () => {
    const af = (kind: string, id: number, column: string) => ({ op: "apply_filter", source: { kind, id }, filters: [{ column, operator: "eq", value: "x" }] });
    const pre = [af("table", 7, "vendor"), af("table", 8, "zone")];
    const d = (extra: unknown) => aiOpDependencies([...pre, extra])[2];
    expect(d({ op: "clear_filter" })).toEqual([0, 1]);
    expect(d({ op: "clear_filter", source: { kind: "table", id: 7 } })).toEqual([0]);
    expect(d({ op: "clear_filter", source: { kind: "table", id: 9 } })).toEqual([]);
  });
  it("APPRDEP-4: foreign temp ids and unparsable entries add nothing", () => {
    const r = aiOpDependencies([{ op: "bogus" }, { op: "set_widget_title", id: -50, title: "n" }, { op: "remove_widget", id: -1 }]);
    expect(r).toEqual([[], [], []]);
    const r2 = aiOpDependencies([{ op: "bogus" }, OPS[1]]);
    expect(r2).toEqual([[], []]);
  });
  it("APPRDEP-5: closeSelection adds prerequisites", () => {
    expect(closeSelection([5], deps())).toEqual([0, 1, 5]);
    expect(closeSelection([4, 9], deps())).toEqual([3, 4, 9]);
    expect(closeSelection([9, 4, 4], deps())).toEqual([3, 4, 9]);
  });
  it("APPRDEP-6: dependentsOf is transitive", () => {
    expect(dependentsOf(0, deps())).toEqual([1, 2, 5, 8]);
    expect(dependentsOf(3, deps())).toEqual([4]);
    expect(dependentsOf(9, deps())).toEqual([]);
  });
  it("APPRDEP-7: isClosedSelection", () => {
    expect(isClosedSelection([1], deps())).toBe(false);
    expect(isClosedSelection([0, 1], deps())).toBe(true);
    expect(isClosedSelection([], deps())).toBe(true);
    expect(isClosedSelection([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], deps())).toBe(true);
    expect(isClosedSelection([7], deps())).toBe(false);
  });
});
