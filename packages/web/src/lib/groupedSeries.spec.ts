import { describe, it, expect } from "vitest";
import {
  MAX_SERIES,
  selectTopSeries,
  pivotSeriesRows,
  type GroupedRow,
} from "./groupedSeries";

describe("groupedSeries — MAX_SERIES", () => {
  it("caps series at 12", () => {
    expect(MAX_SERIES).toBe(12);
  });
});

describe("groupedSeries — selectTopSeries", () => {
  it("ranks by total metric value DESC and reports total", () => {
    const result = selectTopSeries([
      { series: "a", value: 10 },
      { series: "b", value: 30 },
      { series: "c", value: 20 },
    ]);
    expect(result.series).toEqual(["b", "c", "a"]);
    expect(result.total).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it("sums duplicate series before ranking", () => {
    const result = selectTopSeries([
      { series: "a", value: 5 },
      { series: "a", value: 9 }, // a total = 14
      { series: "b", value: 12 },
    ]);
    expect(result.series).toEqual(["a", "b"]);
  });

  it("treats null values as 0 for ranking", () => {
    const result = selectTopSeries([
      { series: "a", value: null },
      { series: "b", value: 1 },
    ]);
    expect(result.series).toEqual(["b", "a"]);
  });

  it("caps at max and sets truncated + total", () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({
      series: `s${String(i).padStart(2, "0")}`,
      value: 100 - i, // s00 highest
    }));
    const result = selectTopSeries(rows, { max: MAX_SERIES });
    expect(result.series.length).toBe(MAX_SERIES);
    expect(result.truncated).toBe(true);
    expect(result.total).toBe(15);
    expect(result.series[0]).toBe("s00");
  });

  it("breaks ties by series string ascending", () => {
    const result = selectTopSeries([
      { series: "z", value: 5 },
      { series: "a", value: 5 },
      { series: "m", value: 5 },
    ]);
    expect(result.series).toEqual(["a", "m", "z"]);
  });

  it("defaults max to MAX_SERIES when omitted", () => {
    const rows = Array.from({ length: 13 }, (_, i) => ({
      series: `s${i}`,
      value: i,
    }));
    const result = selectTopSeries(rows);
    expect(result.series.length).toBe(MAX_SERIES);
    expect(result.truncated).toBe(true);
  });
});

describe("groupedSeries — pivotSeriesRows", () => {
  const rows: GroupedRow[] = [
    { bucket: "2026-01-01", series: "a", value: 1 },
    { bucket: "2026-01-01", series: "b", value: 2 },
    { bucket: "2026-01-02", series: "a", value: 3 },
    // 2026-01-02 / b is MISSING → should pivot to null
    { bucket: "2026-01-02", series: "c", value: 9 }, // c is out-of-set → dropped
  ];

  it("produces bucket-keyed rows with null gaps for missing combos", () => {
    const out = pivotSeriesRows(rows, ["a", "b"]);
    expect(out).toEqual([
      { bucket: "2026-01-01", a: 1, b: 2 },
      { bucket: "2026-01-02", a: 3, b: null },
    ]);
  });

  it("drops series not in the kept set", () => {
    const out = pivotSeriesRows(rows, ["a", "b"]);
    for (const row of out) {
      expect(row).not.toHaveProperty("c");
    }
  });

  it("sorts buckets lexically by default (ISO timeline buckets)", () => {
    const unordered: GroupedRow[] = [
      { bucket: "2026-01-03", series: "a", value: 1 },
      { bucket: "2026-01-01", series: "a", value: 2 },
      { bucket: "2026-01-02", series: "a", value: 3 },
    ];
    const out = pivotSeriesRows(unordered, ["a"]);
    expect(out.map((r) => r.bucket)).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
    ]);
  });

  it("sorts buckets numerically when numericBuckets flag is set", () => {
    const numeric: GroupedRow[] = [
      { bucket: "10", series: "a", value: 1 },
      { bucket: "2", series: "a", value: 2 },
      { bucket: "1", series: "a", value: 3 },
    ];
    const out = pivotSeriesRows(numeric, ["a"], { numericBuckets: true });
    expect(out.map((r) => r.bucket)).toEqual(["1", "2", "10"]);
  });
});
