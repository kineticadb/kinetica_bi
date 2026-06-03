import { describe, it, expect } from "vitest";
import {
  INTERVAL_LADDER,
  pickInterval,
  buildTimelineBucket,
  buildTimelineRangeQuery,
  formatTimelineTick,
  DEFAULT_MAX_INTERVALS,
} from "./timelineBin";

describe("timelineBin", () => {
  // Test 1: INTERVAL_LADDER exports 12 entries in coarsest→finest order
  it("INTERVAL_LADDER exports 12 entries in coarsest→finest order", () => {
    expect(INTERVAL_LADDER).toHaveLength(12);
    const keys = INTERVAL_LADDER.map((i) => i.key);
    expect(keys).toEqual([
      "year",
      "quarter",
      "month",
      "week",
      "day",
      "12h",
      "6h",
      "hour",
      "30min",
      "15min",
      "5min",
      "minute",
    ]);
  });

  // Test 2: pickInterval 5 years / month → "month"
  it("pickInterval: 5-year range with maxIntervals=200 → month", () => {
    const rangeMs = 5 * 365 * 86400 * 1000; // ~5 years
    const result = pickInterval({ rangeMs, maxIntervals: 200 });
    expect(result.key).toBe("month");
  });

  // Test 3: pickInterval 1 day / maxIntervals=200 → "hour"
  it("pickInterval: 1-day range with maxIntervals=200 → hour", () => {
    const rangeMs = 86400 * 1000; // 1 day = 24h
    const result = pickInterval({ rangeMs, maxIntervals: 200 });
    expect(result.key).toBe("hour");
  });

  // Test 4: pickInterval 1 hour / maxIntervals=200 → "minute"
  it("pickInterval: 1-hour range with maxIntervals=200 → minute", () => {
    const rangeMs = 3600 * 1000; // 1 hour = 60 minutes
    const result = pickInterval({ rangeMs, maxIntervals: 200 });
    expect(result.key).toBe("minute");
  });

  // Test 5: pickInterval rangeMs=0 → "minute" (degenerate range — finest fallback)
  it("pickInterval: rangeMs=0 → minute (degenerate range fallback)", () => {
    const result = pickInterval({ rangeMs: 0, maxIntervals: 200 });
    expect(result.key).toBe("minute");
  });

  // Test 6: pickInterval 100 years / maxIntervals=50 → fallback to "minute" (no entry fits → finest)
  it("pickInterval: 100-year range with maxIntervals=50 → minute (fallback-to-finest when nothing fits)", () => {
    // year: ceil(100y/1y) = 100 > 50 → skip; nothing fits → fallback to finest (minute)
    const rangeMs = 100 * 365 * 86400 * 1000;
    const result = pickInterval({ rangeMs, maxIntervals: 50 });
    // Nothing in ladder satisfies ceil(rangeMs/ms) <= 50 except year (100 > 50 fails too)
    // Actually "year" gives 100 buckets > 50. Let's check: 100*365*86400*1000 / 31_536_000_000 ≈ 100 > 50
    // So no entry fits → falls through to "minute"
    expect(result.key).toBe("minute");
  });

  // Test 7: dateTrunc set for native intervals, null+epochFloor for sub-hour/multi-interval
  it("INTERVAL_LADDER: native intervals have dateTrunc set; sub-interval entries have dateTrunc=null + epochFloor", () => {
    const nativeIntervals = ["year", "quarter", "month", "week", "day", "hour", "minute"];
    const floorIntervals = [
      { key: "12h",   epochFloor: 43_200 },
      { key: "6h",    epochFloor: 21_600 },
      { key: "30min", epochFloor: 1_800  },
      { key: "15min", epochFloor: 900    },
      { key: "5min",  epochFloor: 300    },
    ];

    for (const key of nativeIntervals) {
      const entry = INTERVAL_LADDER.find((i) => i.key === key)!;
      expect(entry.dateTrunc).not.toBeNull();
      expect(typeof entry.dateTrunc).toBe("string");
    }

    for (const { key, epochFloor } of floorIntervals) {
      const entry = INTERVAL_LADDER.find((i) => i.key === key)!;
      expect(entry.dateTrunc).toBeNull();
      expect(entry.epochFloor).toBe(epochFloor);
    }
  });

  // Test 8: buildTimelineBucket with DATE_TRUNC interval (year)
  it("buildTimelineBucket: DATE_TRUNC path for year interval", () => {
    const yearEntry = INTERVAL_LADDER.find((i) => i.key === "year")!;
    const result = buildTimelineBucket("pickup_time", yearEntry);
    expect(result).toBe("DATE_TRUNC('year', pickup_time)");
  });

  // Test 9: buildTimelineBucket with FLOOR-epoch path (30min)
  it("buildTimelineBucket: FLOOR-epoch path for 30min interval", () => {
    const thirtyMinEntry = INTERVAL_LADDER.find((i) => i.key === "30min")!;
    const result = buildTimelineBucket("pickup_time", thirtyMinEntry);
    expect(result).toBe("TO_TIMESTAMP(FLOOR(EXTRACT(EPOCH FROM pickup_time) / 1800) * 1800)");
  });

  // Test 10: buildTimelineRangeQuery with schema + table + timeCol
  it("buildTimelineRangeQuery: prefixed FROM for non-empty schema", () => {
    const sql = buildTimelineRangeQuery({ schema: "demo", table: "nyctaxi", timeCol: "pickup_time" });
    expect(sql).toBe(
      "SELECT EXTRACT(EPOCH FROM MIN(pickup_time)) AS lo, EXTRACT(EPOCH FROM MAX(pickup_time)) AS hi FROM demo.nyctaxi WHERE pickup_time IS NOT NULL"
    );
  });

  // Test 11: buildTimelineRangeQuery with empty schema → unprefixed FROM (DV-bound)
  it("buildTimelineRangeQuery: unprefixed FROM when schema is empty string (DV-bound)", () => {
    const sql = buildTimelineRangeQuery({ schema: "", table: "_kbi_dv_v1234", timeCol: "ts" });
    expect(sql).toBe(
      "SELECT EXTRACT(EPOCH FROM MIN(ts)) AS lo, EXTRACT(EPOCH FROM MAX(ts)) AS hi FROM _kbi_dv_v1234 WHERE ts IS NOT NULL"
    );
  });

  // Test 12: DEFAULT_MAX_INTERVALS exported === 500
  it("DEFAULT_MAX_INTERVALS exported === 500", () => {
    expect(DEFAULT_MAX_INTERVALS).toBe(500);
  });
});

describe("formatTimelineTick — granularity-matched X-axis labels", () => {
  const BUCKET = "2009-02-22 14:30:00.000";

  it.each([
    ["year", "2009"],
    ["quarter", "2009 Q1"],
    ["month", "2009-02"],
    ["week", "Feb 22"],
    ["day", "Feb 22"],
    ["12h", "Feb 22 14:00"],
    ["6h", "Feb 22 14:00"],
    ["hour", "Feb 22 14:00"],
    ["30min", "14:30"],
    ["15min", "14:30"],
    ["5min", "14:30"],
    ["minute", "14:30"],
  ] as const)("interval '%s' → '%s'", (key, expected) => {
    expect(formatTimelineTick(BUCKET, key)).toBe(expected);
  });

  it("maps quarter boundaries from month: Apr → Q2, Jul → Q3, Oct → Q4", () => {
    expect(formatTimelineTick("2009-04-01 00:00:00.000", "quarter")).toBe("2009 Q2");
    expect(formatTimelineTick("2009-07-01 00:00:00.000", "quarter")).toBe("2009 Q3");
    expect(formatTimelineTick("2009-10-01 00:00:00.000", "quarter")).toBe("2009 Q4");
  });

  it("parses date-only buckets (no time component) → time parts default to 00:00", () => {
    expect(formatTimelineTick("2015-06-28", "hour")).toBe("Jun 28 00:00");
    expect(formatTimelineTick("2015-06-28", "day")).toBe("Jun 28");
  });

  it("accepts ISO 'T' separator", () => {
    expect(formatTimelineTick("2015-06-28T09:05:00", "minute")).toBe("09:05");
  });

  it("returns the raw string when the bucket doesn't match the expected shape", () => {
    expect(formatTimelineTick("not-a-date", "day")).toBe("not-a-date");
    expect(formatTimelineTick("", "year")).toBe("");
  });
});
