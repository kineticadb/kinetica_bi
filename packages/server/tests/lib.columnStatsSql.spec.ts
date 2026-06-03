import { describe, it, expect } from "vitest";
import { buildColumnStatsSql, parseColumnStatsResponse } from "../src/lib/columnStatsSql";

describe("buildColumnStatsSql", () => {
  it("emits MIN/MAX/AVG/STDDEV over non-null values", () => {
    const sql = buildColumnStatsSql({ schema: "demo", table: "nyctaxi", column: "fare_amount" });
    expect(sql).toContain("MIN(fare_amount) AS mn");
    expect(sql).toContain("MAX(fare_amount) AS mx");
    expect(sql).toContain("AVG(fare_amount) AS av");
    expect(sql).toContain("STDDEV(fare_amount) AS sd");
    expect(sql).toContain("FROM demo.nyctaxi");
    expect(sql).toContain("WHERE fare_amount IS NOT NULL");
  });
});

describe("parseColumnStatsResponse", () => {
  it("maps column_1..4 to min/max/mean/stddev", () => {
    const resp = { column_1: [-100], column_2: [999.99], column_3: [11.84], column_4: [9.98] };
    expect(parseColumnStatsResponse(resp)).toEqual({ min: -100, max: 999.99, mean: 11.84, stddev: 9.98 });
  });

  it("throws when input is not an object", () => {
    expect(() => parseColumnStatsResponse(null)).toThrow(/malformed/i);
  });

  it("throws when a stat column is missing", () => {
    expect(() => parseColumnStatsResponse({ column_1: [0], column_2: [1], column_3: [2] })).toThrow(/stddev/i);
  });

  it("throws when a stat is null/non-finite (empty or non-numeric column)", () => {
    expect(() =>
      parseColumnStatsResponse({ column_1: [null], column_2: [1], column_3: [2], column_4: [3] }),
    ).toThrow(/finite|min/i);
  });
});
