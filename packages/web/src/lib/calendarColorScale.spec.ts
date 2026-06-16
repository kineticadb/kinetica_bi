/**
 * Phase 67 Plan 01 (CAL-V113-04): vitest coverage for calendarColorScale —
 * reactive linear domain + 5-bucket quantize + palette resolver.
 *
 * RED phase: all tests written before implementation exists.
 */
import { describe, it, expect } from "vitest";
import {
  computeDomain,
  quantizeToBucket,
  calendarBucketColors,
  CALENDAR_BUCKET_COUNT,
} from "./calendarColorScale";

describe("CALENDAR_BUCKET_COUNT", () => {
  it("is exactly 5", () => {
    expect(CALENDAR_BUCKET_COUNT).toBe(5);
  });
});

describe("computeDomain", () => {
  it("returns null for empty input", () => {
    expect(computeDomain([])).toBeNull();
  });

  it("returns [min, max] for normal data", () => {
    const result = computeDomain([{ value: 1 }, { value: 9 }, { value: 5 }]);
    expect(result).toEqual([1, 9]);
  });

  it("ignores null values", () => {
    const result = computeDomain([{ value: null }, { value: 4 }, { value: 8 }]);
    expect(result).toEqual([4, 8]);
  });

  it("ignores undefined values", () => {
    const result = computeDomain([
      { value: undefined as unknown as number },
      { value: 3 },
      { value: 7 },
    ]);
    expect(result).toEqual([3, 7]);
  });

  it("ignores non-finite values (Infinity, NaN)", () => {
    const result = computeDomain([
      { value: Infinity },
      { value: NaN },
      { value: 2 },
      { value: 6 },
    ]);
    expect(result).toEqual([2, 6]);
  });

  it("returns null when all values are null/non-finite", () => {
    expect(computeDomain([{ value: null }, { value: null }])).toBeNull();
    expect(computeDomain([{ value: NaN }, { value: Infinity }])).toBeNull();
  });

  it("handles degenerate domain (all values equal)", () => {
    const result = computeDomain([{ value: 5 }, { value: 5 }]);
    expect(result).toEqual([5, 5]);
  });
});

describe("quantizeToBucket", () => {
  it("splits [0,10] into 5 equal bands — value 0 → bucket 0", () => {
    expect(quantizeToBucket(0, [0, 10], 5)).toBe(0);
  });

  it("splits [0,10] into 5 equal bands — value 1 (within band 0) → bucket 0", () => {
    expect(quantizeToBucket(1, [0, 10], 5)).toBe(0);
  });

  it("splits [0,10] into 5 equal bands — value 2 (upper of band 0) → bucket 0", () => {
    // band = 2; floor((2-0)/2) = floor(1) = 1... band is [0,2), [2,4), [4,6), [6,8), [8,10]
    // value 2 → floor((2-0)/2) = 1 → bucket 1
    expect(quantizeToBucket(2, [0, 10], 5)).toBe(1);
  });

  it("splits [0,10] into 5 equal bands — value 5 (middle) → bucket 2", () => {
    // band = 2; floor((5-0)/2) = floor(2.5) = 2
    expect(quantizeToBucket(5, [0, 10], 5)).toBe(2);
  });

  it("splits [0,10] into 5 equal bands — value 10 (max) → bucket 4 (clamped)", () => {
    // floor((10-0)/2) = 5 → clamped to 4 (count-1)
    expect(quantizeToBucket(10, [0, 10], 5)).toBe(4);
  });

  it("clamps values below min to bucket 0", () => {
    expect(quantizeToBucket(-5, [0, 10], 5)).toBe(0);
  });

  it("clamps values above max to bucket count-1", () => {
    expect(quantizeToBucket(100, [0, 10], 5)).toBe(4);
  });

  it("handles degenerate domain [5,5] — returns 0, no NaN/Infinity", () => {
    const result = quantizeToBucket(5, [5, 5], 5);
    expect(result).toBe(0);
    expect(Number.isNaN(result)).toBe(false);
    expect(Number.isFinite(result)).toBe(true);
  });

  it("handles degenerate domain [5,5] with any value — returns 0", () => {
    expect(quantizeToBucket(0, [5, 5], 5)).toBe(0);
    expect(quantizeToBucket(100, [5, 5], 5)).toBe(0);
  });
});

describe("calendarBucketColors", () => {
  it("returns exactly 5 colors for a known theme", () => {
    const colors = calendarBucketColors("Greens");
    expect(colors).toHaveLength(5);
  });

  it("returns '#rrggbb' format (lowercase, leading #, no alpha)", () => {
    const colors = calendarBucketColors("Greens");
    for (const c of colors) {
      expect(c).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("falls back to default theme for unknown themeId — still returns 5 colors", () => {
    const colors = calendarBucketColors("__nonexistent__");
    expect(colors).toHaveLength(5);
    for (const c of colors) {
      expect(c).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("does not throw for unknown themeId", () => {
    expect(() => calendarBucketColors("__nonexistent__")).not.toThrow();
  });
});
