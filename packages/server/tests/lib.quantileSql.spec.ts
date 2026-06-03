import { describe, it, expect } from "vitest";
import { buildQuantileSql, parseQuantileResponse } from "../src/lib/quantileSql";

describe("buildQuantileSql — NTILE template (37-SPIKE-NOTES.md ## Decision locked)", () => {
  it("interpolates schema/table/column/n into the locked PARTITION BY 0 form", () => {
    const sql = buildQuantileSql({ schema: "demo", table: "nyctaxi", column: "fare_amount", n: 5 });
    expect(sql).toContain("NTILE(5)");
    expect(sql).toContain("PARTITION BY 0");
    expect(sql).toContain("ORDER BY fare_amount");
    expect(sql).toContain("FROM demo.nyctaxi");
    expect(sql).toContain("MIN(fare_amount) AS boundary");
    expect(sql).toContain("GROUP BY bucket");
    expect(sql).toContain("ORDER BY bucket");
  });

  it("substitutes column verbatim across all 3 occurrences (outer MIN, inner ORDER BY, inner SELECT)", () => {
    const sql = buildQuantileSql({ schema: "s", table: "t", column: "price", n: 5 });
    const matches = sql.match(/price/g) ?? [];
    expect(matches.length).toBe(3);
  });

  it("emits NTILE(2) for n=2", () => {
    expect(buildQuantileSql({ schema: "s", table: "t", column: "c", n: 2 })).toContain("NTILE(2)");
  });

  it("emits NTILE(256) for n=256", () => {
    expect(buildQuantileSql({ schema: "s", table: "t", column: "c", n: 256 })).toContain("NTILE(256)");
  });
});

describe("parseQuantileResponse — drops bucket 1's MIN", () => {
  it("returns N-1 upper boundaries for N=5 (drops bucket 1's MIN which is the dataset minimum)", () => {
    const resp = { column_1: [1, 2, 3, 4, 5], column_2: [-100, 5.7, 7.7, 10.1, 15.2] };
    expect(parseQuantileResponse(resp)).toEqual([5.7, 7.7, 10.1, 15.2]);
  });

  it("returns 1 boundary for N=2", () => {
    const resp = { column_2: [0, 10] };
    expect(parseQuantileResponse(resp)).toEqual([10]);
  });

  it("throws when input is not an object", () => {
    expect(() => parseQuantileResponse(null)).toThrow(/malformed/i);
    expect(() => parseQuantileResponse("string")).toThrow(/malformed/i);
  });

  it("throws when column_2 missing", () => {
    expect(() => parseQuantileResponse({})).toThrow(/malformed.*column_2/i);
  });

  it("throws when column_2 is not an array", () => {
    expect(() => parseQuantileResponse({ column_2: "nope" })).toThrow(/malformed/i);
  });

  it("throws when column_2 is empty (insufficient buckets — cannot drop bucket 1 from nothing)", () => {
    expect(() => parseQuantileResponse({ column_2: [] })).toThrow(/empty|insufficient/i);
  });

  it("throws when any column_2 entry is non-numeric", () => {
    expect(() => parseQuantileResponse({ column_2: [0, "10", 20] })).toThrow(/malformed/i);
  });
});
