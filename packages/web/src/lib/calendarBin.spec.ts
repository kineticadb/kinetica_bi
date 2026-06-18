/**
 * Tests for calendarBin.ts — calendar heatmap bucketing + allow-list helpers.
 *
 * PITFALL 1 (half-open vs inclusive BETWEEN): DATE_TRUNC returns half-open buckets
 * [start, nextStart). The server BETWEEN path uses inclusive semantics:
 *   col BETWEEN 'lo' AND 'hi'
 * cellEnd = nextBucketStart − 1ms reconciles these: the last ms of the bucket is
 * included in the BETWEEN range, and the first ms of the next bucket is excluded.
 *
 * PITFALL 2 (UTC/DST): computeCellBounds is UTC-only. All Date.UTC / getUTC* calls
 * are offset-independent — a wall-clock DST transition at 2:00 AM US/Eastern has zero
 * effect because we never use local-time constructors or local getters.
 *
 * Output format: Date.prototype.toISOString() → "YYYY-MM-DDTHH:mm:ss.SSSZ"
 * Compatible with the whereClause.ts datetime BETWEEN path (line 124) which emits:
 *   `${col} BETWEEN '${escape(lo)}' AND '${escape(hi)}'`
 * The 'Z' suffix contains no embedded single quotes — safe as a literal.
 */
import { describe, it, expect } from "vitest";
import {
  KINETICA_DATE_TRUNC_UNITS,
  VALID_DOMAIN_SUBDOMAIN,
  isValidCombo,
  CELL_LIMIT,
  computeCellBounds,
} from "./calendarBin";
import type { CalendarDomain, CalendarSubdomain } from "./calendarBin";

describe("calendarBin — constants", () => {
  it("KINETICA_DATE_TRUNC_UNITS contains exactly ['year','month','week','day','hour']", () => {
    expect(KINETICA_DATE_TRUNC_UNITS).toEqual(["year", "month", "week", "day", "hour"]);
    expect(KINETICA_DATE_TRUNC_UNITS).toHaveLength(5);
  });

  it("CELL_LIMIT === 10000", () => {
    expect(CELL_LIMIT).toBe(10000);
  });
});

describe("calendarBin — VALID_DOMAIN_SUBDOMAIN + isValidCombo", () => {
  it("year has exactly [month, week, day] as valid subdomains", () => {
    expect(VALID_DOMAIN_SUBDOMAIN.year).toEqual(["month", "week", "day"]);
  });

  it("month has exactly [week, day] as valid subdomains", () => {
    expect(VALID_DOMAIN_SUBDOMAIN.month).toEqual(["week", "day"]);
  });

  it("week has exactly [day, hour] as valid subdomains", () => {
    expect(VALID_DOMAIN_SUBDOMAIN.week).toEqual(["day", "hour"]);
  });

  it("day has exactly [hour] as valid subdomain", () => {
    expect(VALID_DOMAIN_SUBDOMAIN.day).toEqual(["hour"]);
  });

  describe("isValidCombo — all 8 valid combos return true", () => {
    it.each([
      ["year", "month"],
      ["year", "week"],
      ["year", "day"],
      ["month", "week"],
      ["month", "day"],
      ["week", "day"],
      ["week", "hour"],
      ["day", "hour"],
    ] as [CalendarDomain, CalendarSubdomain][])("isValidCombo('%s', '%s') === true", (domain, subdomain) => {
      expect(isValidCombo(domain, subdomain)).toBe(true);
    });
  });

  describe("isValidCombo — invalid / reverse combos return false", () => {
    it.each([
      ["day", "year"],
      ["hour", "day"],
      ["week", "month"],
      ["year", "year"],
      ["day", "day"],
      ["month", "hour"],
      ["month", "month"],
    ] as unknown as [CalendarDomain, CalendarSubdomain][])("isValidCombo('%s', '%s') === false", (domain, subdomain) => {
      expect(isValidCombo(domain as CalendarDomain, subdomain as CalendarSubdomain)).toBe(false);
    });
  });
});

describe("calendarBin — computeCellBounds", () => {
  // Output format contract: Date.prototype.toISOString() → "YYYY-MM-DDTHH:mm:ss.SSSZ"
  // This is the exact format the whereClause BETWEEN datetime branch accepts verbatim.

  it("hour: truncates to the hour and ends at HH:59:59.999Z", () => {
    const [start, end] = computeCellBounds("2024-03-15T08:00:00.000Z", "hour");
    expect(start).toBe("2024-03-15T08:00:00.000Z");
    expect(end).toBe("2024-03-15T08:59:59.999Z");
  });

  it("hour: truncates mid-hour input to start of that hour", () => {
    const [start, end] = computeCellBounds("2024-03-15T08:37:22.500Z", "hour");
    expect(start).toBe("2024-03-15T08:00:00.000Z");
    expect(end).toBe("2024-03-15T08:59:59.999Z");
  });

  it("day: truncates to UTC midnight and ends at 23:59:59.999Z", () => {
    const [start, end] = computeCellBounds("2024-03-15T13:45:00.000Z", "day");
    expect(start).toBe("2024-03-15T00:00:00.000Z");
    expect(end).toBe("2024-03-15T23:59:59.999Z");
  });

  it("month (Feb leap 2024): end = 2024-02-29T23:59:59.999Z (NOT Feb 28)", () => {
    // 2024 is a leap year — February has 29 days
    const [start, end] = computeCellBounds("2024-02-15T10:00:00.000Z", "month");
    expect(start).toBe("2024-02-01T00:00:00.000Z");
    expect(end).toBe("2024-02-29T23:59:59.999Z");
  });

  it("month (Feb non-leap 2023): end = 2023-02-28T23:59:59.999Z", () => {
    // 2023 is NOT a leap year — February has 28 days
    const [start, end] = computeCellBounds("2023-02-10T06:00:00.000Z", "month");
    expect(start).toBe("2023-02-01T00:00:00.000Z");
    expect(end).toBe("2023-02-28T23:59:59.999Z");
  });

  it("year-end Dec→Jan rollover (day subdomain): 2024-12-31 end = 2024-12-31T23:59:59.999Z", () => {
    // Day cell on Dec 31 — next bucket is Jan 1 2025 00:00:00Z → minus 1ms
    const [start, end] = computeCellBounds("2024-12-31T12:00:00.000Z", "day");
    expect(start).toBe("2024-12-31T00:00:00.000Z");
    expect(end).toBe("2024-12-31T23:59:59.999Z");
  });

  it("year-end Dec→Jan rollover (month subdomain): 2024-12 end = 2024-12-31T23:59:59.999Z", () => {
    // Month cell for Dec 2024 — next bucket = Date.UTC(2025, 0, 1) → 2025-01-01T00:00:00.000Z minus 1ms
    const [start, end] = computeCellBounds("2024-12-15T00:00:00.000Z", "month");
    expect(start).toBe("2024-12-01T00:00:00.000Z");
    expect(end).toBe("2024-12-31T23:59:59.999Z");
  });

  it("week: trusts the bucket-start input verbatim (Monday-anchored bucket → [Mon, Sun])", () => {
    // The drill input is Kinetica's DATE_TRUNC('week') bucket START. For a Monday-anchored
    // deployment the bucket start is a Monday (2024-01-01 is a Monday):
    //   start = 2024-01-01T00:00:00.000Z, end = 2024-01-07T23:59:59.999Z
    const [start, end] = computeCellBounds("2024-01-01T00:00:00.000Z", "week");
    expect(start).toBe("2024-01-01T00:00:00.000Z");
    expect(end).toBe("2024-01-07T23:59:59.999Z");
  });

  it("week: ANCHOR-AGNOSTIC — a Sunday-anchored bucket start is NOT re-anchored to Monday (v1.13 CALUX bug fix)", () => {
    // 2022-10-23 is a SUNDAY. Under a Sunday-anchored Kinetica deployment, DATE_TRUNC('week')
    // returns this date as the bucket start, and the cell COUNT covers [Oct 23 .. Oct 29].
    // The drill window MUST match that same week — the old code shifted back to Monday Oct 17
    // (a DIFFERENT week), which is exactly why the filtered record count diverged from the cell.
    const [start, end] = computeCellBounds("2022-10-23T00:00:00.000Z", "week");
    expect(start).toBe("2022-10-23T00:00:00.000Z"); // NOT 2022-10-17 (would be the Monday re-anchor)
    expect(end).toBe("2022-10-29T23:59:59.999Z");
  });

  it("week: verify 7-day span (end - start + 1ms === 7 days)", () => {
    const [start, end] = computeCellBounds("2024-01-01T00:00:00.000Z", "week");
    const spanMs = new Date(end).getTime() - new Date(start).getTime() + 1;
    expect(spanMs).toBe(7 * 24 * 60 * 60 * 1000); // exactly 7 days
  });

  it("DST-immunity: US/Eastern DST-night (2024-03-10) day cell is UTC-correct", () => {
    // 2024-03-10 is the US/Eastern DST spring-forward night (clocks skip 2:00→3:00 AM).
    // UTC arithmetic is inherently TZ-immune — the UTC day always has exactly 86_400_000ms.
    // NOTE: process.env.TZ is set after module load; this test asserts the correct UTC result.
    // The same assertion holds regardless of TZ offset because Date.UTC / getUTC* never
    // read the local timezone.
    const [start, end] = computeCellBounds("2024-03-10T05:00:00.000Z", "day");
    expect(start).toBe("2024-03-10T00:00:00.000Z");
    expect(end).toBe("2024-03-10T23:59:59.999Z");
  });

  it("DST-immunity: hour cell on DST-spring-forward night is exactly 3600000ms wide", () => {
    // Even on a DST night the UTC hour is always exactly 3_600_000ms — no 23h or 25h days
    // in UTC arithmetic.
    const [start, end] = computeCellBounds("2024-03-10T02:30:00.000Z", "hour");
    expect(start).toBe("2024-03-10T02:00:00.000Z");
    expect(end).toBe("2024-03-10T02:59:59.999Z");
    const spanMs = new Date(end).getTime() - new Date(start).getTime() + 1;
    expect(spanMs).toBe(3_600_000);
  });
});
