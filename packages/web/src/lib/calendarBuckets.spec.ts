/**
 * Phase 68.2-01: calendarBuckets.spec.ts
 *
 * Exhaustive unit tests for enumerateGroupBuckets — per-group date-range
 * subdomain bucket enumerator.
 *
 * All bucket keys must be in "YYYY-MM-DD HH:mm:ss" format (UTC, space separator,
 * no 'T', no 'Z', no milliseconds) — the exact format Kinetica DATE_TRUNC emits.
 */

import { describe, expect, it } from "vitest";
import { enumerateGroupBuckets } from "./calendarBuckets";

// Format regex: "YYYY-MM-DD HH:mm:ss" — space sep, no T, no Z, no ms
const KEY_FORMAT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

describe("enumerateGroupBuckets", () => {
  // ───────────────────────────────────────────────────────────────────────────
  // KEY FORMAT ASSERTIONS — every returned key must match the SQL output format
  // ───────────────────────────────────────────────────────────────────────────
  it("all returned keys match 'YYYY-MM-DD HH:mm:ss' format (week×day)", () => {
    const keys = enumerateGroupBuckets("2024-10-07 00:00:00", "week", "day");
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      expect(k).toMatch(KEY_FORMAT);
    }
  });

  it("all returned keys match 'YYYY-MM-DD HH:mm:ss' format (year×month)", () => {
    const keys = enumerateGroupBuckets("2024-01-01 00:00:00", "year", "month");
    for (const k of keys) {
      expect(k).toMatch(KEY_FORMAT);
    }
  });

  it("all returned keys match 'YYYY-MM-DD HH:mm:ss' format (day×hour)", () => {
    const keys = enumerateGroupBuckets("2024-10-09 00:00:00", "day", "hour");
    for (const k of keys) {
      expect(k).toMatch(KEY_FORMAT);
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // week×day: exactly 7 in-range day buckets, no adjacent-week days
  // ───────────────────────────────────────────────────────────────────────────
  it("week×day: Monday 2024-10-07 → exactly 7 day keys", () => {
    const keys = enumerateGroupBuckets("2024-10-07 00:00:00", "week", "day");
    expect(keys).toHaveLength(7);
  });

  it("week×day: keys are 2024-10-07 through 2024-10-13", () => {
    const keys = enumerateGroupBuckets("2024-10-07 00:00:00", "week", "day");
    expect(keys[0]).toBe("2024-10-07 00:00:00");
    expect(keys[6]).toBe("2024-10-13 00:00:00");
  });

  it("week×day: does NOT include next week's days (exclusion check)", () => {
    const keys = enumerateGroupBuckets("2024-10-07 00:00:00", "week", "day");
    expect(keys).not.toContain("2024-10-14 00:00:00");
    expect(keys).not.toContain("2024-10-15 00:00:00");
  });

  it("week×day: does NOT include previous week's days (exclusion check)", () => {
    const keys = enumerateGroupBuckets("2024-10-07 00:00:00", "week", "day");
    expect(keys).not.toContain("2024-10-06 00:00:00");
    expect(keys).not.toContain("2024-10-05 00:00:00");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // month×day: variable month lengths including leap year
  // ───────────────────────────────────────────────────────────────────────────
  it("month×day Feb 2024 (LEAP): 29 keys", () => {
    const keys = enumerateGroupBuckets("2024-02-01 00:00:00", "month", "day");
    expect(keys).toHaveLength(29);
    expect(keys[0]).toBe("2024-02-01 00:00:00");
    expect(keys[28]).toBe("2024-02-29 00:00:00");
  });

  it("month×day Feb 2023 (non-leap): 28 keys", () => {
    const keys = enumerateGroupBuckets("2023-02-01 00:00:00", "month", "day");
    expect(keys).toHaveLength(28);
    expect(keys[0]).toBe("2023-02-01 00:00:00");
    expect(keys[27]).toBe("2023-02-28 00:00:00");
  });

  it("month×day April (30 days): 30 keys", () => {
    const keys = enumerateGroupBuckets("2024-04-01 00:00:00", "month", "day");
    expect(keys).toHaveLength(30);
    expect(keys[29]).toBe("2024-04-30 00:00:00");
  });

  it("month×day January (31 days): 31 keys", () => {
    const keys = enumerateGroupBuckets("2024-01-01 00:00:00", "month", "day");
    expect(keys).toHaveLength(31);
    expect(keys[30]).toBe("2024-01-31 00:00:00");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // year×month: 12 months
  // ───────────────────────────────────────────────────────────────────────────
  it("year×month 2024: exactly 12 month keys", () => {
    const keys = enumerateGroupBuckets("2024-01-01 00:00:00", "year", "month");
    expect(keys).toHaveLength(12);
  });

  it("year×month 2024: first = Jan, last = Dec", () => {
    const keys = enumerateGroupBuckets("2024-01-01 00:00:00", "year", "month");
    expect(keys[0]).toBe("2024-01-01 00:00:00");
    expect(keys[11]).toBe("2024-12-01 00:00:00");
  });

  it("year×month: no 2025-01-01 leak (Dec boundary)", () => {
    const keys = enumerateGroupBuckets("2024-01-01 00:00:00", "year", "month");
    expect(keys).not.toContain("2025-01-01 00:00:00");
  });

  it("year×month: includes 2024-12-01 00:00:00 (Date.UTC month rollover boundary)", () => {
    const keys = enumerateGroupBuckets("2024-01-01 00:00:00", "year", "month");
    expect(keys).toContain("2024-12-01 00:00:00");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // day×hour: exactly 24 hour buckets
  // ───────────────────────────────────────────────────────────────────────────
  it("day×hour: exactly 24 hour keys", () => {
    const keys = enumerateGroupBuckets("2024-10-09 00:00:00", "day", "hour");
    expect(keys).toHaveLength(24);
  });

  it("day×hour: first = midnight, last = 23:00", () => {
    const keys = enumerateGroupBuckets("2024-10-09 00:00:00", "day", "hour");
    expect(keys[0]).toBe("2024-10-09 00:00:00");
    expect(keys[23]).toBe("2024-10-09 23:00:00");
  });

  it("day×hour: does NOT include next day (exclusion check)", () => {
    const keys = enumerateGroupBuckets("2024-10-09 00:00:00", "day", "hour");
    expect(keys).not.toContain("2024-10-10 00:00:00");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // month×week: only weeks whose Monday start falls within the month
  // ───────────────────────────────────────────────────────────────────────────
  it("month×week March 2024: all emitted week-starts have month 2 (0-based March)", () => {
    const keys = enumerateGroupBuckets("2024-03-01 00:00:00", "month", "week");
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      // Parse month from key "YYYY-MM-DD HH:mm:ss"
      const month = parseInt(k.substring(5, 7), 10) - 1; // 0-based
      expect(month).toBe(2); // March = 2
    }
  });

  it("month×week March 2024: weeks are exactly 7 days apart (Monday spacing)", () => {
    const keys = enumerateGroupBuckets("2024-03-01 00:00:00", "month", "week");
    for (let i = 1; i < keys.length; i++) {
      const prev = new Date(keys[i - 1].replace(" ", "T") + "Z").getTime();
      const curr = new Date(keys[i].replace(" ", "T") + "Z").getTime();
      expect(curr - prev).toBe(7 * 86_400_000);
    }
  });

  it("month×week March 2024: no Feb week-starts included", () => {
    const keys = enumerateGroupBuckets("2024-03-01 00:00:00", "month", "week");
    for (const k of keys) {
      expect(k.substring(5, 7)).not.toBe("02");
    }
  });

  it("month×week March 2024: no April week-starts included", () => {
    const keys = enumerateGroupBuckets("2024-03-01 00:00:00", "month", "week");
    for (const k of keys) {
      expect(k.substring(5, 7)).not.toBe("04");
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // year×week: only weeks whose Monday start falls within the year
  // ───────────────────────────────────────────────────────────────────────────
  it("year×week 2024: ~52-53 week-starts, all in 2024", () => {
    const keys = enumerateGroupBuckets("2024-01-01 00:00:00", "year", "week");
    expect(keys.length).toBeGreaterThanOrEqual(52);
    expect(keys.length).toBeLessThanOrEqual(53);
    for (const k of keys) {
      const year = parseInt(k.substring(0, 4), 10);
      expect(year).toBe(2024);
    }
  });

  it("year×week 2024: weeks are exactly 7 days apart", () => {
    const keys = enumerateGroupBuckets("2024-01-01 00:00:00", "year", "week");
    for (let i = 1; i < keys.length; i++) {
      const prev = new Date(keys[i - 1].replace(" ", "T") + "Z").getTime();
      const curr = new Date(keys[i].replace(" ", "T") + "Z").getTime();
      expect(curr - prev).toBe(7 * 86_400_000);
    }
  });

  it("year×week 2024: no 2023 week-starts, no 2025 week-starts", () => {
    const keys = enumerateGroupBuckets("2024-01-01 00:00:00", "year", "week");
    for (const k of keys) {
      expect(k.substring(0, 4)).not.toBe("2023");
      expect(k.substring(0, 4)).not.toBe("2025");
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // year×day: all days of the year
  // ───────────────────────────────────────────────────────────────────────────
  it("year×day 2024 (leap): 366 keys", () => {
    const keys = enumerateGroupBuckets("2024-01-01 00:00:00", "year", "day");
    expect(keys).toHaveLength(366);
  });

  it("year×day 2023 (non-leap): 365 keys", () => {
    const keys = enumerateGroupBuckets("2023-01-01 00:00:00", "year", "day");
    expect(keys).toHaveLength(365);
  });

  it("year×day 2024: first = Jan 1, last = Dec 31", () => {
    const keys = enumerateGroupBuckets("2024-01-01 00:00:00", "year", "day");
    expect(keys[0]).toBe("2024-01-01 00:00:00");
    expect(keys[365]).toBe("2024-12-31 00:00:00");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // week×hour: week domain, hour subdomain (generalized path)
  // ───────────────────────────────────────────────────────────────────────────
  it("week×hour: Monday 2024-10-07 → 7*24=168 hour keys", () => {
    const keys = enumerateGroupBuckets("2024-10-07 00:00:00", "week", "hour");
    expect(keys).toHaveLength(168);
    expect(keys[0]).toBe("2024-10-07 00:00:00");
    expect(keys[167]).toBe("2024-10-13 23:00:00");
  });
});
