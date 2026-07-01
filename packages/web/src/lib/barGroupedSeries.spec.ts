import { describe, it, expect } from "vitest";
import { isMultiColumnBarGroupBy, toBarPivotInput, BAR_SERIES_SEPARATOR } from "./barGroupedSeries";
import { selectTopSeries, pivotSeriesRows } from "./groupedSeries";

describe("barGroupedSeries — isMultiColumnBarGroupBy", () => {
  it("returns true for arrays with 2+ columns", () => {
    expect(isMultiColumnBarGroupBy({ groupByColumns: ["region", "cat"] })).toBe(true);
    expect(isMultiColumnBarGroupBy({ groupByColumns: ["a", "b", "c"] })).toBe(true);
  });

  it("returns false for single-column array", () => {
    expect(isMultiColumnBarGroupBy({ groupByColumns: ["a"] })).toBe(false);
  });

  it("returns false for empty array", () => {
    expect(isMultiColumnBarGroupBy({ groupByColumns: [] })).toBe(false);
  });

  it("returns false for undefined / missing", () => {
    expect(isMultiColumnBarGroupBy({})).toBe(false);
    expect(isMultiColumnBarGroupBy({ groupByColumns: undefined })).toBe(false);
  });

  it("returns false for non-array values", () => {
    expect(isMultiColumnBarGroupBy({ groupByColumns: "region" })).toBe(false);
    expect(isMultiColumnBarGroupBy({ groupByColumns: 2 })).toBe(false);
  });
});

describe("barGroupedSeries — toBarPivotInput", () => {
  // Test 1: 2-column mapping — col1 → bucket, col2 → series
  it("maps flat rows to { bucket, series, value } with col1 as bucket and col2 as series", () => {
    const rows = [{ region: "East", cat: "A", value: 10 }];
    const result = toBarPivotInput(rows, ["region", "cat"]);
    expect(result).toEqual([{ bucket: "East", series: "A", value: 10 }]);
  });

  // Test 2: 3-column compound key — restCols joined with " / "
  it("joins 3-column restCols with ' / ' as compound series key", () => {
    const rows = [{ region: "East", cat: "A", q: "X", value: 5 }];
    const result = toBarPivotInput(rows, ["region", "cat", "q"]);
    expect(result).toEqual([{ bucket: "East", series: "A / X", value: 5 }]);
    expect(result[0].series).toBe("A / X");
  });

  // Test 3: null / non-finite value → value: null
  it("maps null and non-finite values to null", () => {
    const rows = [
      { region: "East", cat: "A", value: null },
      { region: "East", cat: "B", value: undefined },
      { region: "East", cat: "C", value: Infinity },
      { region: "East", cat: "D", value: NaN },
    ];
    const result = toBarPivotInput(rows as Record<string, unknown>[], ["region", "cat"]);
    for (const r of result) {
      expect(r.value).toBe(null);
    }
  });

  // Test 4: numeric col1 and col values are String()-coerced
  it("coerces numeric bucket and series values to strings via String()", () => {
    const rows = [{ region: 1, cat: 2, value: 42 }];
    const result = toBarPivotInput(rows as Record<string, unknown>[], ["region", "cat"]);
    expect(result[0].bucket).toBe("1");
    expect(result[0].series).toBe("2");
  });

  // Test 5: integration — output composes with real groupedSeries helpers
  it("output is directly consumable by selectTopSeries + pivotSeriesRows (integration)", () => {
    const rows = [
      { region: "East", cat: "A", q: "X", value: 10 },
      { region: "West", cat: "A", q: "X", value: 20 },
      { region: "East", cat: "B", q: "Y", value: 5 },
    ];
    const pivotInput = toBarPivotInput(rows, ["region", "cat", "q"]);
    const { series } = selectTopSeries(pivotInput);
    const pivoted = pivotSeriesRows(pivotInput, series);

    // The compound key "A / X" must appear as a series column
    expect(series).toContain("A / X");
    expect(series).toContain("B / Y");

    // Each pivoted row must have a bucket and the series keys
    for (const row of pivoted) {
      expect(typeof row.bucket).toBe("string");
      expect(Object.prototype.hasOwnProperty.call(row, "A / X") || Object.prototype.hasOwnProperty.call(row, "B / Y")).toBe(true);
    }
  });
});

describe("barGroupedSeries — BAR_SERIES_SEPARATOR", () => {
  it("is ' / ' (space-slash-space)", () => {
    expect(BAR_SERIES_SEPARATOR).toBe(" / ");
  });
});
