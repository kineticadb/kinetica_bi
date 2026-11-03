import { describe, it, expect } from "vitest";
import {
  buildColumnProfileSql, parseColumnProfileResponse, parseTopValuesWithCounts,
  isProfileMinMaxType, isProfileTopValuesType, PROFILE_TOP_N,
} from "../src/lib/ai/columnProfileSql";

describe("columnProfileSql", () => {
  it("CPS-1 builds exact profile SQL", () => {
    expect(buildColumnProfileSql({ schema: "demo", table: "trips", column: "fare", minMax: true })).toBe(
      "SELECT COUNT(*) AS n, COUNT(fare) AS nn, COUNT(DISTINCT fare) AS nd, MIN(fare) AS mn, MAX(fare) AS mx FROM demo.trips",
    );
    expect(buildColumnProfileSql({ schema: "demo", table: "trips", column: "fare", minMax: false })).toBe(
      "SELECT COUNT(*) AS n, COUNT(fare) AS nn, COUNT(DISTINCT fare) AS nd FROM demo.trips",
    );
    expect(buildColumnProfileSql({ schema: "", table: "trips", column: "fare", minMax: false })).toMatch(/ FROM trips$/);
  });
  it("CPS-2 min/max types", () => {
    for (const t of ["int", "long", "double", "float", "decimal(10,2)", "timestamp", "date", "datetime", "time"]) expect(isProfileMinMaxType(t)).toBe(true);
    for (const t of ["string", "varchar(16)", undefined]) expect(isProfileMinMaxType(t)).toBe(false);
  });
  it("CPS-3 top-values types", () => {
    for (const t of ["string", "varchar(16)", "char4", "text"]) expect(isProfileTopValuesType(t)).toBe(true);
    for (const t of ["double", "timestamp", "wkt", undefined]) expect(isProfileTopValuesType(t)).toBe(false);
  });
  it("CPS-4 parses profile response", () => {
    const enc = { column_1: [10], column_2: [8], column_3: [4], column_4: [1.5], column_5: [9] };
    expect(parseColumnProfileResponse(enc, true)).toEqual({ rowCount: 10, nonNullCount: 8, distinctCount: 4, min: 1.5, max: 9 });
    expect(parseColumnProfileResponse(enc, false)).toEqual({ rowCount: 10, nonNullCount: 8, distinctCount: 4 });
    expect(parseColumnProfileResponse({ ...enc, column_4: ["2020-01-01"], column_5: ["2021-01-01"] }, true)).toMatchObject({ min: "2020-01-01", max: "2021-01-01" });
    expect(() => parseColumnProfileResponse({}, true)).toThrow("malformed column-profile response");
  });
  it("CPS-5 parses top values with counts", () => {
    expect(parseTopValuesWithCounts({ column_1: ["AA", "BB", null], column_2: [42, 7, 3] })).toEqual([
      { value: "AA", count: 42 }, { value: "BB", count: 7 },
    ]);
    expect(parseTopValuesWithCounts({ column_1: [5], column_2: ["3"] })).toEqual([{ value: "5", count: 3 }]);
  });
  it("CPS-6 top-N constant", () => {
    expect(PROFILE_TOP_N).toBe(10);
  });
});
