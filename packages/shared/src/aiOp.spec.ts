import { describe, it, expect } from "vitest";
import { z } from "zod";
import { AiOpSchema, AI_OP_KINDS, parseAiOp } from "./aiOp";
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
