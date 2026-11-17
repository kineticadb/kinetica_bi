/**
 * Quick 261116-bti — bar chart time bucketing (pure helpers). Ids prefixed BTI-.
 */
import { describe, it, expect } from "vitest";
import {
  pickBarTimeUnit,
  buildBarTimeRangeSql,
  readBarTimeUnit,
  swapBarTimeUnit,
  barTimeBucketRange,
  barTimeSettings,
} from "./barTimeBucket";
import { buildChipText } from "./columnTypes";

const DAY = 86_400_000;

describe("pickBarTimeUnit (BTI-1)", () => {
  it("BTI-1 finest unit within the target, never finer than the floor, year when nothing fits", () => {
    expect(pickBarTimeUnit({ rangeMs: 5 * 365 * DAY, target: 50 })).toBe("quarter"); // month = 60 > 50
    expect(pickBarTimeUnit({ rangeMs: 5 * 365 * DAY, target: 100 })).toBe("month");
    expect(pickBarTimeUnit({ rangeMs: DAY, target: 50 })).toBe("hour"); // 24
    expect(pickBarTimeUnit({ rangeMs: 3 * DAY, target: 50 })).toBe("day"); // 72 hours > 50
    expect(pickBarTimeUnit({ rangeMs: 3 * DAY, target: 100 })).toBe("hour");
    expect(pickBarTimeUnit({ rangeMs: 3 * DAY, target: 100, floor: "day" })).toBe("day");
    expect(pickBarTimeUnit({ rangeMs: 30 * 365 * DAY, target: 50 })).toBe("year");
    expect(pickBarTimeUnit({ rangeMs: 300 * 365 * DAY, target: 50 })).toBe("year"); // coarsest even if > target
    expect(pickBarTimeUnit({ rangeMs: 0, target: 50 })).toBe("minute");
    expect(pickBarTimeUnit({ rangeMs: 0, target: 50, floor: "month" })).toBe("month");
    expect(pickBarTimeUnit({ rangeMs: NaN, target: 50, floor: "week" })).toBe("week");
  });
});

describe("barTimeSettings (BTI-2)", () => {
  it("BTI-2 reads mode / floor / target with safe defaults", () => {
    expect(barTimeSettings({})).toEqual({ mode: "none", floor: undefined, target: 50 });
    expect(barTimeSettings({ timeInterval: "auto" })).toEqual({ mode: "auto", floor: undefined, target: 50 });
    expect(barTimeSettings({ timeInterval: "auto", timeIntervalMin: "day", timeTargetBars: 20 })).toEqual({
      mode: "auto", floor: "day", target: 20,
    });
    expect(barTimeSettings({ timeInterval: "month" }).mode).toBe("month");
    expect(barTimeSettings({ timeInterval: "bogus" }).mode).toBe("none");
    expect(barTimeSettings({ timeInterval: "auto", timeIntervalMin: "x", timeTargetBars: -3 })).toEqual({
      mode: "auto", floor: undefined, target: 50,
    });
    expect(barTimeSettings({ timeInterval: "auto", timeTargetBars: 9999 }).target).toBe(500);
  });
});

describe("range probe + unit swap (BTI-3)", () => {
  const sql =
    "SELECT DATE_TRUNC('month', ts) AS ts, SUM(fare) AS value FROM _kbi_filt_x WHERE (fare > 1) " +
    "GROUP BY DATE_TRUNC('month', ts) ORDER BY DATE_TRUNC('month', ts) DESC LIMIT 100";

  it("BTI-3 the probe reads the RAW rows of the same FROM/WHERE; the swap rewrites every bucket expression", () => {
    expect(buildBarTimeRangeSql(sql, "ts")).toBe(
      "SELECT EXTRACT(EPOCH FROM MIN(ts)) AS lo, EXTRACT(EPOCH FROM MAX(ts)) AS hi FROM _kbi_filt_x WHERE (fare > 1)",
    );
    expect(readBarTimeUnit(sql, "ts")).toBe("month");
    expect(swapBarTimeUnit(sql, "ts", "day")).toBe(sql.replaceAll("DATE_TRUNC('month', ts)", "DATE_TRUNC('day', ts)"));
    expect(swapBarTimeUnit(sql, "ts", "month")).toBe(sql);
    // fail closed
    expect(readBarTimeUnit("SELECT ts, SUM(x) AS value FROM t GROUP BY ts", "ts")).toBeNull();
    expect(swapBarTimeUnit("SELECT ts, SUM(x) AS value FROM t GROUP BY ts", "ts", "day")).toBeNull();
    expect(buildBarTimeRangeSql("SELECT * FROM t LIMIT 100", "ts")).toBeNull();
    expect(swapBarTimeUnit(sql, "ts", "fortnight" as never)).toBeNull();
  });
});

describe("barTimeBucketRange (BTI-4)", () => {
  it("BTI-4 inclusive [start, end] of a bucket, calendar-aware, ISO with Z like the calendar drill (the chip formatter + server read it as UTC wall-clock)", () => {
    expect(barTimeBucketRange("2015-02-01 00:00:00.000", "month")).toEqual(["2015-02-01T00:00:00.000Z", "2015-02-28T23:59:59.999Z"]);
    expect(barTimeBucketRange("2016-02-01 00:00:00", "month")).toEqual(["2016-02-01T00:00:00.000Z", "2016-02-29T23:59:59.999Z"]);
    expect(barTimeBucketRange("2015-10-01", "quarter")).toEqual(["2015-10-01T00:00:00.000Z", "2015-12-31T23:59:59.999Z"]);
    expect(barTimeBucketRange("2015-01-01 00:00:00.000", "year")).toEqual(["2015-01-01T00:00:00.000Z", "2015-12-31T23:59:59.999Z"]);
    expect(barTimeBucketRange("2015-12-28 00:00:00.000", "week")).toEqual(["2015-12-28T00:00:00.000Z", "2016-01-03T23:59:59.999Z"]);
    expect(barTimeBucketRange("2015-03-05 00:00:00.000", "day")).toEqual(["2015-03-05T00:00:00.000Z", "2015-03-05T23:59:59.999Z"]);
    expect(barTimeBucketRange("2015-03-05 14:00:00.000", "hour")).toEqual(["2015-03-05T14:00:00.000Z", "2015-03-05T14:59:59.999Z"]);
    expect(barTimeBucketRange("2015-03-05 14:07:00.000", "minute")).toEqual(["2015-03-05T14:07:00.000Z", "2015-03-05T14:07:59.999Z"]);
    expect(barTimeBucketRange("not a date", "day")).toBeNull();
    // The drill chip for the 2015 Q2 bar (live UAT: an un-zoned "… 23:59:59.999" end parsed as
    // LOCAL time read as "Jul 1"; ISO-Z ends cannot shift).
    expect(buildChipText("ts", barTimeBucketRange("2015-04-01 00:00:00.000", "quarter"), "datetime", "between")).toBe(
      "ts between Apr 1 – Jun 30, 2015",
    );
  });
});
