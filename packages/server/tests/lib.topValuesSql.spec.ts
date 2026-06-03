import { describe, it, expect } from "vitest";
import { buildTopValuesSql, parseTopValuesResponse } from "../src/lib/topValuesSql";

describe("buildTopValuesSql — top-N distinct values by frequency", () => {
  it("interpolates schema/table/column/n into a GROUP BY + COUNT(*) ORDER BY DESC LIMIT form", () => {
    const sql = buildTopValuesSql({ schema: "demo", table: "nyctaxi", column: "vendor_id", n: 5 });
    expect(sql).toContain("SELECT vendor_id AS val, COUNT(*) AS cnt");
    expect(sql).toContain("FROM demo.nyctaxi");
    expect(sql).toContain("WHERE vendor_id IS NOT NULL");
    expect(sql).toContain("GROUP BY vendor_id");
    expect(sql).toContain("ORDER BY cnt DESC");
    expect(sql).toContain("LIMIT 5");
  });

  it("emits LIMIT 2 for n=2 and LIMIT 256 for n=256", () => {
    expect(buildTopValuesSql({ schema: "s", table: "t", column: "c", n: 2 })).toContain("LIMIT 2");
    expect(buildTopValuesSql({ schema: "s", table: "t", column: "c", n: 256 })).toContain("LIMIT 256");
  });
});

describe("parseTopValuesResponse — distinct values in descending-frequency order", () => {
  it("returns column_1 coerced to strings", () => {
    const resp = { column_1: ["VTS", "CMT", "DDS"], column_2: [900, 600, 100] };
    expect(parseTopValuesResponse(resp)).toEqual(["VTS", "CMT", "DDS"]);
  });

  it("coerces numeric-coded categorical values to strings", () => {
    const resp = { column_1: [1, 2, 3], column_2: [50, 30, 10] };
    expect(parseTopValuesResponse(resp)).toEqual(["1", "2", "3"]);
  });

  it("drops null/undefined entries defensively", () => {
    const resp = { column_1: ["a", null, "b", undefined], column_2: [9, 8, 7, 6] };
    expect(parseTopValuesResponse(resp)).toEqual(["a", "b"]);
  });

  it("returns empty array when column_1 is empty", () => {
    expect(parseTopValuesResponse({ column_1: [] })).toEqual([]);
  });

  it("throws when input is not an object", () => {
    expect(() => parseTopValuesResponse(null)).toThrow(/malformed/i);
    expect(() => parseTopValuesResponse("nope")).toThrow(/malformed/i);
  });

  it("throws when column_1 missing or not an array", () => {
    expect(() => parseTopValuesResponse({})).toThrow(/malformed.*column_1/i);
    expect(() => parseTopValuesResponse({ column_1: "nope" })).toThrow(/malformed/i);
  });
});
