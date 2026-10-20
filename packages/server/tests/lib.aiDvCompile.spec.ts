import { describe, it, expect } from "vitest";
import type { AiDvSpec } from "@kinetica-bi/shared";
import { validateAiDvSpec, type AiDvTable, type AiDvLimits } from "../src/lib/aiDvCompile";

const T5: AiDvTable = {
  tableId: 5,
  ref: "demo.trips",
  columns: [
    { name: "vendor", type: "string" },
    { name: "fare", type: "double" },
    { name: "zone_id", type: "int" },
    { name: "pickup_datetime", type: "timestamp" },
    { name: "pickup_date", type: "date" },
    { name: "pickup_time", type: "time" },
    { name: "geom", type: "geometry" },
    { name: "notype" },
  ],
};
const T6: AiDvTable = {
  tableId: 6,
  ref: "demo.zones",
  columns: [
    { name: "id", type: "int" },
    { name: "borough", type: "string" },
    { name: "code", type: "string" },
  ],
};
const LIM: AiDvLimits = { maxRecords: 100000, maxJoins: 2 };
const summary = (over: Partial<AiDvSpec> = {}): AiDvSpec => ({
  baseTableId: 5,
  groupBy: [{ column: "vendor" }],
  aggregates: [{ fn: "count", as: "trips" }],
  ...over,
});
const reasons = (v: ReturnType<typeof validateAiDvSpec>) => (v.ok ? [] : v.reasons);

describe("validateAiDvSpec", () => {
  it("CMP-1: a valid summary passes", () => {
    expect(validateAiDvSpec(summary(), [T5], LIM)).toEqual({ ok: true });
  });

  it("CMP-2: unknown columns are reported per table", () => {
    const a = validateAiDvSpec(summary({ groupBy: [{ column: "fair" }] }), [T5], LIM);
    expect(a.ok).toBe(false);
    if (!a.ok) {
      expect(a.reasons).toContain("column `fair` not found on demo.trips");
      expect(a.missing).toEqual([{ from: 0, tableId: 5, column: "fair" }]);
    }
    const b = validateAiDvSpec(
      { baseTableId: 5, joins: [{ tableId: 6, type: "inner", on: [{ left: "zone_id", right: "id" }] }], columns: [{ from: 1, column: "boro" }] },
      [T5, T6],
      LIM,
    );
    expect(b.ok).toBe(false);
    if (!b.ok) {
      expect(b.reasons).toContain("column `boro` not found on demo.zones");
      expect(b.missing[0]).toEqual({ from: 1, tableId: 6, column: "boro" });
    }
  });

  it("CMP-3: numeric aggregates need numeric columns", () => {
    const avg = validateAiDvSpec({ baseTableId: 5, aggregates: [{ fn: "avg", column: "vendor", as: "a" }] }, [T5], LIM);
    expect(reasons(avg)).toContain("column vendor is not numeric");
    expect(validateAiDvSpec({ baseTableId: 5, aggregates: [{ fn: "min", column: "vendor", as: "a" }] }, [T5], LIM).ok).toBe(true);
    expect(validateAiDvSpec({ baseTableId: 5, aggregates: [{ fn: "count_distinct", column: "vendor", as: "a" }] }, [T5], LIM).ok).toBe(true);
  });

  it("CMP-4: bucket rules", () => {
    const b = (column: string, bucket: "hour" | "day" | "week") =>
      validateAiDvSpec({ baseTableId: 5, groupBy: [{ column, bucket }], aggregates: [{ fn: "count", as: "n" }] }, [T5], LIM);
    expect(b("pickup_datetime", "hour").ok).toBe(true);
    expect(reasons(b("pickup_date", "hour"))).toContain("column pickup_date is a date; use day, week, month or year");
    expect(b("pickup_date", "week").ok).toBe(true);
    expect(reasons(b("pickup_time", "day"))).toContain("column pickup_time is a time of day and can't be bucketed");
    expect(reasons(b("fare", "day"))).toContain("column fare is not a date or time column");
    expect(reasons(b("notype", "day"))).toContain("column notype is not a date or time column");
  });

  it("CMP-5: join rules", () => {
    const j = (left: string, right: string) =>
      validateAiDvSpec(
        { baseTableId: 5, joins: [{ tableId: 6, type: "inner", on: [{ left, right }] }], columns: [{ column: "vendor" }] },
        [T5, T6],
        LIM,
      );
    expect(j("zone_id", "id").ok).toBe(true);
    expect(reasons(j("zone_id", "borough"))).toContain("join 1: zone_id and borough have different types");
    expect(reasons(j("geom", "id"))).toContain("column geom can't be a join key");
    const three: AiDvSpec = {
      baseTableId: 5,
      joins: [1, 2, 3].map(() => ({ tableId: 6, type: "inner" as const, on: [{ left: "zone_id", right: "id" }] })),
      columns: [{ column: "vendor" }],
    };
    expect(reasons(validateAiDvSpec(three, [T5, T6, T6, T6], LIM))).toContain("a view can join at most 2 tables");
  });

  it("CMP-6: filters coerce per column type and never echo values", () => {
    const r = validateAiDvSpec(
      summary({ filters: [{ column: "fare", operator: "eq", value: "abc" }] }),
      [T5],
      LIM,
    );
    expect(reasons(r)).toContain("column fare needs a number");
    const s = validateAiDvSpec(
      summary({ filters: [{ column: "fare", operator: "eq", value: "SECRETVAL_139" }, { column: "nope", operator: "eq", value: "SECRETVAL_139" }] }),
      [T5],
      LIM,
    );
    expect(JSON.stringify(s)).not.toContain("SECRETVAL_139");
  });

  it("CMP-7: limit over the ceiling", () => {
    expect(reasons(validateAiDvSpec({ baseTableId: 5, columns: [{ column: "vendor" }], limit: 200000 }, [T5], LIM))).toContain(
      "limit 200000 is over the 100000-row ceiling",
    );
  });

  it("CMP-8: tables must be [base, ...joins]", () => {
    const spec: AiDvSpec = { baseTableId: 5, joins: [{ tableId: 6, type: "inner", on: [{ left: "zone_id", right: "id" }] }], columns: [{ column: "vendor" }] };
    expect(() => validateAiDvSpec(spec, [T5], LIM)).toThrow("tables must be [base, ...joins]");
  });

  it("CMP-9: spec shape failures are reported", () => {
    const r = validateAiDvSpec({ baseTableId: 5, columns: [{ column: "vendor" }], groupBy: [{ column: "vendor" }] }, [T5], LIM);
    expect(reasons(r)).toContain("use columns for a row view, or groupBy/aggregates for a summary, not both");
  });

  it("CMP-10: all reasons together, capped at 10, shape first", () => {
    const r = validateAiDvSpec(
      {
        baseTableId: 5,
        columns: [{ column: "fair" }],
        groupBy: [{ column: "fare", bucket: "day" }],
        aggregates: [{ fn: "avg", column: "vendor", as: "a" }],
        filters: [{ column: "fare", operator: "eq", value: "abc" }],
        limit: 200000,
      },
      [T5],
      LIM,
    );
    const rs = reasons(r);
    expect(rs.length).toBeGreaterThanOrEqual(4);
    expect(rs.length).toBeLessThanOrEqual(10);
    expect(rs[0]).toContain("not both");
    expect(rs.indexOf("column `fair` not found on demo.trips")).toBeLessThan(rs.indexOf("column vendor is not numeric"));
    expect(rs.indexOf("column vendor is not numeric")).toBeLessThan(rs.indexOf("column fare needs a number"));
  });
});
