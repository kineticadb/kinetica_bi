import { describe, it, expect } from "vitest";
import {
  buildBucketExpr,
  formatBucketTick,
  getHeatmapBucket,
  HEATMAP_BUCKETS,
  isCyclicalBucket,
} from "./heatmapBucket";
import { INTERVAL_LADDER } from "./timelineBin";

describe("heatmapBucket — SQL expressions", () => {
  it("emits no expression for an unbucketed axis", () => {
    expect(buildBucketExpr("ts", "none")).toBeNull();
    expect(buildBucketExpr("ts", undefined)).toBeNull();
    expect(buildBucketExpr("ts", "not-a-bucket")).toBeNull();
  });

  it("truncates with DATE_TRUNC", () => {
    expect(buildBucketExpr("pickup_datetime", "day")).toBe(
      "DATE_TRUNC('day', pickup_datetime)",
    );
    expect(buildBucketExpr("ts", "month")).toBe("DATE_TRUNC('month', ts)");
  });

  it("only uses DATE_TRUNC units already proven against Kinetica by timelineBin", () => {
    // Guards against someone adding a unit the backend rejects: every trunc unit
    // must appear in INTERVAL_LADDER, which CONTEXT.md locked after research.
    const proven = new Set(
      INTERVAL_LADDER.map((i) => i.dateTrunc).filter((u): u is string => u !== null),
    );
    const used = HEATMAP_BUCKETS.filter((b) => b.kind === "trunc").map((b) => b.truncUnit!);
    expect(used.length).toBeGreaterThan(0);
    for (const unit of used) expect(proven.has(unit)).toBe(true);
  });

  it("extracts a cycle position with EXTRACT", () => {
    expect(buildBucketExpr("ts", "hour_of_day")).toBe("EXTRACT(HOUR FROM ts)");
    expect(buildBucketExpr("ts", "day_of_week")).toBe("EXTRACT(DOW FROM ts)");
    expect(buildBucketExpr("ts", "month_of_year")).toBe("EXTRACT(MONTH FROM ts)");
  });

  it("classifies the two families, which must not be conflated", () => {
    expect(isCyclicalBucket("hour_of_day")).toBe(true);
    expect(isCyclicalBucket("day")).toBe(false); // trunc keeps timestamps
    expect(isCyclicalBucket("none")).toBe(false);
    expect(getHeatmapBucket("garbage").key).toBe("none");
  });
});

describe("heatmapBucket — cycle tick labels", () => {
  it("labels hour of day as a clock hour", () => {
    expect(formatBucketTick(0, "hour_of_day")).toBe("00:00");
    expect(formatBucketTick(14, "hour_of_day")).toBe("14:00");
    expect(formatBucketTick("23", "hour_of_day")).toBe("23:00");
  });

  it("labels day of week from 0=Sunday", () => {
    expect(formatBucketTick(0, "day_of_week")).toBe("Sun");
    expect(formatBucketTick(6, "day_of_week")).toBe("Sat");
  });

  it("labels month of year from 1=January", () => {
    expect(formatBucketTick(1, "month_of_year")).toBe("Jan");
    expect(formatBucketTick(12, "month_of_year")).toBe("Dec");
  });

  it("passes an out-of-range value through rather than mislabelling it", () => {
    // If the backend numbers DOW 1-7 instead of 0-6, a 7 must stay visible as
    // "7" rather than silently wrapping to "Sun" and shifting every label.
    expect(formatBucketTick(7, "day_of_week")).toBe("7");
    expect(formatBucketTick(24, "hour_of_day")).toBe("24");
    expect(formatBucketTick(0, "month_of_year")).toBe("0");
    expect(formatBucketTick("abc", "hour_of_day")).toBe("abc");
  });

  it("leaves a trunc bucket's value alone — it keeps the column's date format", () => {
    expect(formatBucketTick("2026-01-02", "day")).toBe("2026-01-02");
    expect(formatBucketTick("2026-01-02", "none")).toBe("2026-01-02");
  });
});
