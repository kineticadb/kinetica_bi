import { describe, it, expect } from "vitest";
import {
  pickNumericBinWidth,
  buildNumericRangeQuery,
  formatNumericTick,
  DEFAULT_MAX_BUCKETS,
} from "./numericBin";

describe("numericBin", () => {
  it("DEFAULT_MAX_BUCKETS is a sensible positive integer", () => {
    expect(DEFAULT_MAX_BUCKETS).toBe(50);
  });

  describe("pickNumericBinWidth — nice 1/2/5×10ⁿ width with bucket count ≤ maxBuckets", () => {
    it.each([
      // [min, max, maxBuckets, expectedWidth]
      [0, 100, 50, 2],
      [0, 100, 10, 10],
      [0, 100, 30, 5],
      [0, 1, 10, 0.1],
      [0, 3, 50, 0.1],
      [0, 1000, 20, 50],
    ])("range [%d, %d], maxBuckets=%d → width %d", (min, max, maxBuckets, expected) => {
      expect(pickNumericBinWidth({ min, max, maxBuckets })).toBeCloseTo(expected, 10);
    });

    it("guarantees ceil(range / width) ≤ maxBuckets across varied ranges", () => {
      const cases = [
        { min: 0, max: 97, maxBuckets: 40 },
        { min: -50, max: 50, maxBuckets: 25 },
        { min: 3.2, max: 88.8, maxBuckets: 12 },
        { min: 0, max: 1, maxBuckets: 7 },
      ];
      for (const { min, max, maxBuckets } of cases) {
        const w = pickNumericBinWidth({ min, max, maxBuckets });
        expect(w).toBeGreaterThan(0);
        expect(Math.ceil((max - min) / w)).toBeLessThanOrEqual(maxBuckets);
      }
    });

    it("returns 1 for degenerate ranges (single value / inverted)", () => {
      expect(pickNumericBinWidth({ min: 5, max: 5, maxBuckets: 50 })).toBe(1);
      expect(pickNumericBinWidth({ min: 10, max: 2, maxBuckets: 50 })).toBe(1);
    });
  });

  describe("buildNumericRangeQuery", () => {
    it("emits MIN/MAX probe with schema-qualified FROM and NOT NULL guard", () => {
      const sql = buildNumericRangeQuery({ schema: "demo", table: "nyctaxi", xField: "fare_amount" });
      expect(sql).toBe(
        "SELECT MIN(fare_amount) AS lo, MAX(fare_amount) AS hi FROM demo.nyctaxi WHERE fare_amount IS NOT NULL",
      );
    });

    it("empty schema → unprefixed FROM (filter-view / DV-bound)", () => {
      const sql = buildNumericRangeQuery({ schema: "", table: "_kbi_filt_x", xField: "trip_distance" });
      expect(sql).toContain("FROM _kbi_filt_x ");
      expect(sql).not.toContain("FROM .");
    });
  });

  describe("formatNumericTick — precision matched to bin width", () => {
    it.each([
      [10, 5, "10"],
      ["25", 5, "25"],
      [0.3, 0.1, "0.3"],
      [0.25, 0.05, "0.25"],
      [1234, 100, "1234"],
    ])("format(%s, width=%s) → '%s'", (bucket, width, expected) => {
      expect(formatNumericTick(bucket, width)).toBe(expected);
    });

    it("returns raw string for non-numeric input", () => {
      expect(formatNumericTick("abc", 5)).toBe("abc");
    });
  });
});
