import { describe, it, expect } from "vitest";
import {
  AI_FILTER_CAP_PER_TABLE,
  AI_FILTER_OPERATORS,
  AiFilterSourceSchema,
  AiFilterItemSchema,
  aiFilterDataTypeOf,
  checkAiFilterItem,
  coerceAiFilterItem,
  aiFilterSourceKey,
  type AiFilterItem,
} from "./aiFilter";

const item = (o: Partial<AiFilterItem> & { operator: AiFilterItem["operator"] }): AiFilterItem =>
  ({ column: "c", ...o }) as AiFilterItem;

describe("AI filter contract", () => {
  it("AF1-1: cap and operators", () => {
    expect(AI_FILTER_CAP_PER_TABLE).toBe(25);
    expect([...AI_FILTER_OPERATORS]).toEqual(["eq", "in", "between", "isNull"]);
  });

  it("AF1-2: source schema", () => {
    const ok = (v: unknown) => AiFilterSourceSchema.safeParse(v).success;
    expect(ok({ kind: "table", id: 5 })).toBe(true);
    expect(ok({ kind: "dynamicView", id: 90 })).toBe(true);
    expect(ok({ kind: "dynamicView", id: -3 })).toBe(true);
    expect(ok({ kind: "table", id: -1 })).toBe(false);
    expect(ok({ kind: "table", id: 0 })).toBe(false);
    expect(ok({ kind: "dynamicView", id: 0 })).toBe(false);
    expect(ok({ kind: "widget", id: 5 })).toBe(false);
    expect(ok({ kind: "table", id: 5, extra: 1 })).toBe(false);
  });

  it("AF1-3: item schema", () => {
    const ok = (v: unknown) => AiFilterItemSchema.safeParse(v).success;
    expect(ok({ column: "payment_type", operator: "eq", value: "Cash" })).toBe(true);
    expect(ok({ column: "a b", operator: "eq", value: "x" })).toBe(false);
    expect(ok({ column: "1x", operator: "eq", value: "x" })).toBe(false);
    expect(ok({ column: "a".repeat(129), operator: "eq", value: "x" })).toBe(false);
    expect(ok({ column: "a", operator: "eq", value: "x", extra: 1 })).toBe(false);
    expect(ok({ column: "a", operator: "in", value: Array.from({ length: 101 }, (_, i) => i) })).toBe(false);
  });

  it("AF1-4: type mapping", () => {
    expect(aiFilterDataTypeOf("DOUBLE")).toBe("number");
    expect(aiFilterDataTypeOf("int(8)")).toBe("number");
    expect(aiFilterDataTypeOf("bool")).toBe("boolean");
    expect(aiFilterDataTypeOf("timestamp")).toBe("datetime");
    expect(aiFilterDataTypeOf("char16")).toBe("string");
    expect(aiFilterDataTypeOf("string")).toBe("string");
    for (const t of ["geometry", "wkt", "text", "bytes"]) expect(aiFilterDataTypeOf(t)).toBe("unfilterable");
    expect(aiFilterDataTypeOf(undefined)).toBe("unknown");
  });

  it("AF1-5: shape errors", () => {
    const bad: AiFilterItem[] = [
      item({ operator: "eq", value: ["a"] }),
      item({ operator: "eq", value: null }),
      item({ operator: "eq" }),
      item({ operator: "in", value: "a" }),
      item({ operator: "in", value: [] }),
      item({ operator: "between", value: [1] }),
      item({ operator: "between", value: [1, 2, 3] }),
      item({ operator: "between", value: [1, "a"] }),
      item({ operator: "isNull", value: "x" }),
    ];
    for (const b of bad) expect(checkAiFilterItem(b).length).toBeGreaterThanOrEqual(1);
    const good: AiFilterItem[] = [
      item({ operator: "eq", value: "a" }),
      item({ operator: "in", value: ["a"] }),
      item({ operator: "between", value: [1, 2] }),
      item({ operator: "isNull" }),
      item({ operator: "isNull", value: null }),
    ];
    for (const g of good) expect(checkAiFilterItem(g)).toEqual([]);
  });

  it("AF1-6: coercion", () => {
    const val = (it: AiFilterItem, t: string | undefined) => {
      const r = coerceAiFilterItem(it, t);
      return r.ok ? r.item.value : "FAIL";
    };
    expect(val(item({ operator: "eq", value: "12.5" }), "double")).toBe(12.5);
    expect(val(item({ operator: "eq", value: "1,234" }), "double")).toBe(1234);
    expect(val(item({ operator: "eq", value: "1,234.5" }), "double")).toBe(1234.5);
    expect(val(item({ operator: "eq", value: "12abc" }), "double")).toBe("FAIL");
    expect(val(item({ operator: "eq", value: "1,23" }), "double")).toBe("FAIL");
    expect(val(item({ operator: "eq", value: "TRUE" }), "boolean")).toBe(true);
    expect(val(item({ operator: "eq", value: "no" }), "boolean")).toBe("FAIL");
    for (const d of ["2024-01-05", "2024-01-05 10:00:00", "2024-01-05T10:00:00.000Z"])
      expect(val(item({ operator: "eq", value: d }), "timestamp")).toBe(d);
    expect(val(item({ operator: "eq", value: "yesterday" }), "timestamp")).toBe("FAIL");
    expect(val(item({ operator: "between", value: ["10", "2"] }), "int")).toBe("FAIL");
    expect(val(item({ operator: "between", value: ["2", "10"] }), "int")).toEqual([2, 10]);
    expect(val(item({ operator: "between", value: ["2024-02-01", "2024-01-01"] }), "date")).toBe("FAIL");
    expect(val(item({ operator: "in", value: ["1", "2"] }), "int")).toEqual([1, 2]);
    const n = coerceAiFilterItem(item({ operator: "isNull" }), "string");
    expect(n).toEqual({ ok: true, item: { column: "c", operator: "isNull", value: null, dataType: "null" } });
    expect(val(item({ operator: "eq", value: "Credit" }), "string")).toBe("Credit");
    expect(val(item({ operator: "eq", value: "x" }), "geometry")).toBe("FAIL");
    expect(val(item({ operator: "eq", value: "x" }), undefined)).toBe("x");
  });

  it("AF1-7: reasons never contain the value", () => {
    const r = coerceAiFilterItem(item({ column: "fare", operator: "eq", value: "SECRETVAL_77" }), "double");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("fare");
      expect(r.reason).not.toContain("SECRETVAL_77");
    }
    const d = coerceAiFilterItem(item({ column: "d", operator: "eq", value: "SECRETVAL_77" }), "date");
    if (!d.ok) expect(d.reason).not.toContain("SECRETVAL_77");
  });

  it("AF1-8: source key", () => {
    expect(aiFilterSourceKey({ kind: "table", id: 5 })).toBe("table:5");
    expect(aiFilterSourceKey({ kind: "dynamicView", id: 90 })).toBe("dynamicView:90");
  });
});
