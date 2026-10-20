import { describe, it, expect } from "vitest";
import {
  AiDvSpecSchema,
  checkAiDvSpec,
  aiDvOutputNames,
  aiDvIsAggregated,
  AiDvMaterializeRequestSchema,
  AiDvDropRequestSchema,
} from "./aiDynamicView";

const summary = {
  baseTableId: 5,
  groupBy: [{ column: "pickup_datetime", bucket: "hour", as: "pickup_hour" }],
  aggregates: [
    { fn: "count", as: "trips" },
    { fn: "percentile", column: "fare", p: 90, as: "fare_p90" },
  ],
  sort: [{ by: "trips", dir: "desc" }],
};
const rowView = { baseTableId: 5, columns: [{ column: "vendor" }, { column: "fare", as: "fare_amount" }], limit: 500 };
const parse = (v: unknown) => AiDvSpecSchema.safeParse(v);
const reasons = (v: unknown) => {
  const r = AiDvSpecSchema.parse(v);
  return checkAiDvSpec(r);
};

describe("AI dynamic view spec (139)", () => {
  it("DVSPEC-1 summary spec", () => {
    const s = AiDvSpecSchema.parse(summary);
    expect(checkAiDvSpec(s)).toEqual([]);
    expect(aiDvIsAggregated(s)).toBe(true);
    expect(aiDvOutputNames(s)).toEqual(["pickup_hour", "trips", "fare_p90"]);
  });
  it("DVSPEC-2 row view", () => {
    const s = AiDvSpecSchema.parse(rowView);
    expect(checkAiDvSpec(s)).toEqual([]);
    expect(aiDvIsAggregated(s)).toBe(false);
    expect(aiDvOutputNames(s)).toEqual(["vendor", "fare_amount"]);
  });
  it("DVSPEC-3 no SQL anywhere", () => {
    for (const k of ["sql", "where", "template_sql", "expression"]) {
      expect(parse({ ...rowView, [k]: "x=1" }).success).toBe(false);
      expect(parse({ ...rowView, columns: [{ column: "a", [k]: "x" }] }).success).toBe(false);
      expect(parse({ ...summary, aggregates: [{ fn: "count", as: "n", [k]: "x" }] }).success).toBe(false);
      expect(
        parse({ ...rowView, joins: [{ tableId: 6, type: "inner", on: [{ left: "a", right: "b" }], [k]: "x" }] }).success,
      ).toBe(false);
    }
    expect(parse({ ...rowView, columns: [{ column: "fare; DROP TABLE x" }] }).success).toBe(false);
    expect(parse({ ...rowView, columns: [{ column: 'a"b' }] }).success).toBe(false);
  });
  it("DVSPEC-4 columns xor groupBy", () => {
    expect(reasons({ ...rowView, groupBy: [{ column: "a" }] })).toContain(
      "use columns for a row view, or groupBy/aggregates for a summary, not both",
    );
    expect(reasons({ baseTableId: 5 })).toContain("a view needs columns, or groupBy and aggregates");
  });
  it("DVSPEC-5 joins", () => {
    const j = { tableId: 6, type: "inner", on: [{ left: "zone_id", right: "id" }] };
    expect(reasons({ baseTableId: 5, joins: [j], columns: [{ from: 1, column: "borough" }] })).toEqual([]);
    expect(parse({ baseTableId: 5, joins: [{ ...j, type: "cross" }], columns: [{ column: "a" }] }).success).toBe(false);
    expect(parse({ baseTableId: 5, joins: [{ ...j, type: "full" }], columns: [{ column: "a" }] }).success).toBe(false);
    expect(parse({ baseTableId: 5, joins: [{ ...j, on: [] }], columns: [{ column: "a" }] }).success).toBe(false);
    expect(reasons({ baseTableId: 5, joins: [j], columns: [{ from: 2, column: "a" }] })).toContain(
      "from 2 does not match a join (there are 1)",
    );
    expect(
      reasons({
        baseTableId: 5,
        joins: [j, { tableId: 7, type: "left", on: [{ leftFrom: 2, left: "a", right: "b" }] }],
        columns: [{ column: "a" }],
      }),
    ).toContain("joins.1.on: leftFrom must be the base (0) or an earlier join");
    expect(parse({ baseTableId: 5, joins: [j, j, j, j, j], columns: [{ column: "a" }] }).success).toBe(false);
  });
  it("DVSPEC-6 aggregates", () => {
    const g = { baseTableId: 5, groupBy: [{ column: "v" }] };
    expect(reasons({ ...g, aggregates: [{ fn: "sum", as: "s" }] })).toContain("aggregates.0: sum needs a column");
    expect(reasons({ ...g, aggregates: [{ fn: "count", as: "n" }] })).toEqual([]);
    for (const p of [undefined, 0, 100, 101]) {
      expect(reasons({ ...g, aggregates: [{ fn: "percentile", column: "fare", p, as: "p" }] })).toContain(
        "aggregates.0: percentile needs p between 0 and 100 (exclusive)",
      );
    }
    expect(reasons({ ...g, aggregates: [{ fn: "avg", column: "fare", p: 50, as: "a" }] })).toContain(
      "aggregates.0: p is only for percentile",
    );
    expect(parse({ ...g, aggregates: [{ fn: "stddev", column: "x", as: "a" }] }).success).toBe(false);
  });
  it("DVSPEC-7 buckets", () => {
    expect(parse({ baseTableId: 5, groupBy: [{ column: "t", bucket: "quarter" }], aggregates: [{ fn: "count", as: "n" }] }).success).toBe(false);
    const s = AiDvSpecSchema.parse({ baseTableId: 5, groupBy: [{ column: "pickup_datetime", bucket: "day" }], aggregates: [{ fn: "count", as: "n" }] });
    expect(aiDvOutputNames(s)).toEqual(["pickup_datetime_day", "n"]);
  });
  it("DVSPEC-8 names", () => {
    expect(reasons({ baseTableId: 5, columns: [{ column: "a", as: "Trips" }, { column: "b", as: "trips" }] })).toContain(
      "output name trips is used twice",
    );
    expect(reasons({ ...summary, sort: [{ by: "nope", dir: "asc" }] })).toContain("sort: nope is not an output column");
  });
  it("DVSPEC-9 filters", () => {
    expect(reasons({ ...rowView, filters: [{ column: "vendor", operator: "eq", value: "CMT" }] })).toEqual([]);
    expect(parse({ ...rowView, filters: [{ column: "vendor", operator: "like", value: "%" }] }).success).toBe(false);
    expect(reasons({ ...rowView, filters: [{ from: 3, column: "vendor", operator: "eq", value: "CMT" }] })).toContain(
      "from 3 does not match a join (there are 0)",
    );
  });
  it("DVSPEC-10 privacy", () => {
    const rs = reasons({
      baseTableId: 5,
      columns: [{ column: "a" }],
      groupBy: [{ column: "b" }],
      filters: [{ from: 4, column: "vendor", operator: "eq", value: "SECRETVAL_139" }],
    });
    expect(rs.length).toBeGreaterThan(0);
    expect(rs.join("|")).not.toContain("SECRETVAL_139");
  });
  it("DVSPEC-11 materialize request", () => {
    const ok = { dashboardId: 12, nonce: "0a1b2c3d", tempId: -3, gen: 0, spec: summary };
    expect(AiDvMaterializeRequestSchema.safeParse(ok).success).toBe(true);
    expect(AiDvMaterializeRequestSchema.safeParse({ ...ok, nonce: "ZZZZZZZZ" }).success).toBe(false);
    expect(AiDvMaterializeRequestSchema.safeParse({ ...ok, nonce: "0a1b2c3d4" }).success).toBe(false);
    expect(AiDvMaterializeRequestSchema.safeParse({ ...ok, tempId: 0 }).success).toBe(false);
    expect(AiDvMaterializeRequestSchema.safeParse({ ...ok, tempId: 4 }).success).toBe(false);
    expect(AiDvMaterializeRequestSchema.safeParse({ ...ok, gen: 1000 }).success).toBe(false);
    for (const k of ["name", "sql", "view_name"]) {
      expect(AiDvMaterializeRequestSchema.safeParse({ ...ok, [k]: "x" }).success).toBe(false);
    }
    expect(AiDvMaterializeRequestSchema.safeParse({ ...ok, joinFilterKeys: { abc: "k" } }).success).toBe(false);
    expect(AiDvMaterializeRequestSchema.safeParse({ ...ok, joinFilterKeys: { "6": "k" } }).success).toBe(true);
  });
  it("DVSPEC-12 drop request", () => {
    const ok = { dashboardId: 12, nonce: "0a1b2c3d", tempId: -3, gen: 2 };
    expect(AiDvDropRequestSchema.safeParse(ok).success).toBe(true);
    expect(AiDvDropRequestSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });
});
