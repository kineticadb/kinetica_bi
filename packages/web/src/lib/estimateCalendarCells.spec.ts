/**
 * Phase 66 Plan 01 (CAL-V113-05): vitest coverage for estimateCalendarCells +
 * buildCalendarRangeQuery.
 *
 * RED phase: all tests written before implementation exists.
 */
import { describe, it, expect } from "vitest";
import {
  estimateCalendarCells,
  buildCalendarRangeQuery,
  SUBDOMAIN_GRANULARITY_MS,
} from "./estimateCalendarCells";
import { CELL_LIMIT } from "./calendarBin";

describe("estimateCalendarCells", () => {
  // Test 1: hour subdomain over a 24h range → 24 cells
  it("hour subdomain over 24h range → 24 cells", () => {
    const rangeMs = 86_400_000; // 1 day = 24 hours
    const result = estimateCalendarCells({ rangeMs, subdomain: "hour" });
    // ceil(86_400_000 / 3_600_000) = ceil(24) = 24
    expect(result).toBe(24);
  });

  // Test 2: day subdomain over a 365-day range → ~365 cells
  it("day subdomain over 365-day range → 365 cells", () => {
    const rangeMs = 365 * 86_400_000; // 365 days
    const result = estimateCalendarCells({ rangeMs, subdomain: "day" });
    // ceil(365 * 86_400_000 / 86_400_000) = ceil(365) = 365
    expect(result).toBe(365);
  });

  // Test 3: year/hour over 3-year range → > CELL_LIMIT (10000)
  it("year/hour over 3-year range exceeds CELL_LIMIT", () => {
    const rangeMs = 3 * 365 * 86_400_000; // 3 years in ms
    const result = estimateCalendarCells({ rangeMs, subdomain: "hour" });
    // ceil(3 * 365 * 86_400_000 / 3_600_000) = ceil(26280) = 26280 > 10000
    expect(result).toBeGreaterThan(CELL_LIMIT);
  });

  // Test 4: month/day over 90-day range → < CELL_LIMIT (safe default)
  it("month/day over 90-day range is under CELL_LIMIT (safe default)", () => {
    const rangeMs = 90 * 86_400_000; // 90 days
    const result = estimateCalendarCells({ rangeMs, subdomain: "day" });
    // ceil(90 * 86_400_000 / 86_400_000) = 90 < 10000
    expect(result).toBeLessThan(CELL_LIMIT);
  });

  // Test 5: rangeMs <= 0 → 0 (never blocks on degenerate range)
  it("rangeMs <= 0 → 0 (degenerate range guard)", () => {
    expect(estimateCalendarCells({ rangeMs: 0, subdomain: "hour" })).toBe(0);
    expect(estimateCalendarCells({ rangeMs: -1, subdomain: "day" })).toBe(0);
  });

  // Additional: verify month granularity uses 28d divisor (conservative upper bound)
  it("SUBDOMAIN_GRANULARITY_MS[month] < 30-day ms (conservative upper-bound divisor)", () => {
    const thirtyDayMs = 30 * 86_400_000;
    expect(SUBDOMAIN_GRANULARITY_MS["month"]).toBeLessThan(thirtyDayMs);
    // Should be 28 days = 2_419_200_000
    expect(SUBDOMAIN_GRANULARITY_MS["month"]).toBe(2_419_200_000);
  });
});

describe("buildCalendarRangeQuery", () => {
  // Test 6: exact SQL shape for demo.events / ts
  it("emits exact MIN/MAX epoch probe for demo.events, timeCol=ts", () => {
    const sql = buildCalendarRangeQuery({ fromTarget: "demo.events", timeCol: "ts" });
    expect(sql).toBe(
      "SELECT EXTRACT(EPOCH FROM MIN(ts)) AS lo, " +
      "EXTRACT(EPOCH FROM MAX(ts)) AS hi " +
      "FROM demo.events " +
      "WHERE ts IS NOT NULL"
    );
  });

  // Test 7: bare dv view name as fromTarget — no schema prefixing inside
  it("uses verbatim bare dv view name as FROM clause (caller pre-resolves)", () => {
    const sql = buildCalendarRangeQuery({
      fromTarget: "_kbi_dv_v1234",
      timeCol: "event_time",
    });
    expect(sql).toContain("FROM _kbi_dv_v1234 ");
    expect(sql).not.toContain("._kbi_dv_v1234");
    expect(sql).toContain("EXTRACT(EPOCH FROM MIN(event_time)) AS lo");
    expect(sql).toContain("EXTRACT(EPOCH FROM MAX(event_time)) AS hi");
  });
});
