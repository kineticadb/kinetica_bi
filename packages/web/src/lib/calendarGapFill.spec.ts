/**
 * Phase 68.2 Plan 03 (CALUX-V113-03): per-group gap-fill spec.
 *
 * Replaces the Phase-67 global-axis tests with per-domain-group, date-range-aware
 * assertions. Key changes:
 *   - gapFillCalendar now takes (rows, domain, subdomain)
 *   - Each group's cells are ONLY its own expected buckets (no cross-fill)
 *   - In-range missing buckets → value: null (grey tile)
 *   - Out-of-range buckets → no cell at all (blank)
 *   - week×day group → exactly 7 cells, one column (no phantom month-shaped block)
 *   - day×hour group → exactly 24 cells, no cross-day hours
 */
import { describe, it, expect } from "vitest";
import { gapFillCalendar } from "./calendarGapFill";
import type { CalendarCell, CalendarRow } from "./calendarGapFill";

describe("gapFillCalendar — per-group date-range-aware gap-fill", () => {
  // ─────────────────────────────────────────────────────────────────────────
  // Empty input
  // ─────────────────────────────────────────────────────────────────────────
  it("returns empty structure for empty input", () => {
    const result = gapFillCalendar([], "month", "day");
    expect(result.rows).toEqual([]);
    expect(result.domainKeys).toEqual([]);
    expect(result.subdomainKeys).toEqual([]);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Single-cell trivial 1×1
  // ─────────────────────────────────────────────────────────────────────────
  it("handles single domain, single subdomain — trivial 1×1 (month×day)", () => {
    // Jan 2026, only Jan 5 has data
    const input = [
      { domain_bucket: "2026-01-01 00:00:00", subdomain_bucket: "2026-01-05 00:00:00", value: 7 },
    ];
    const result = gapFillCalendar(input, "month", "day");
    expect(result.domainKeys).toEqual(["2026-01-01 00:00:00"]);
    // Jan has 31 days → 31 cells
    const row = result.rows[0];
    expect(row.cells).toHaveLength(31);
    // Jan 5 has value 7
    const jan5 = row.cells.find((c) => c.subdomainKey === "2026-01-05 00:00:00");
    expect(jan5?.value).toBe(7);
    // Jan 10 (missing) → null
    const jan10 = row.cells.find((c) => c.subdomainKey === "2026-01-10 00:00:00");
    expect(jan10?.value).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // value: null passthrough
  // ─────────────────────────────────────────────────────────────────────────
  it("handles value: null in input (explicitly empty bucket from query)", () => {
    const input = [
      { domain_bucket: "2026-01-01 00:00:00", subdomain_bucket: "2026-01-01 00:00:00", value: null },
    ];
    const result = gapFillCalendar(input, "month", "day");
    const jan1 = result.rows[0].cells.find((c) => c.subdomainKey === "2026-01-01 00:00:00");
    expect(jan1?.value).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // cellAt helper
  // ─────────────────────────────────────────────────────────────────────────
  it("cellAt helper returns correct value for a populated cell", () => {
    const input = [
      { domain_bucket: "2026-01-01 00:00:00", subdomain_bucket: "2026-01-03 00:00:00", value: 99 },
    ];
    const result = gapFillCalendar(input, "month", "day");
    expect(result.cellAt("2026-01-01 00:00:00", "2026-01-03 00:00:00")).toBe(99);
  });

  it("cellAt helper returns null for a gap cell (key exists in data but no value)", () => {
    const input = [
      { domain_bucket: "2026-01-01 00:00:00", subdomain_bucket: "2026-01-03 00:00:00", value: 10 },
    ];
    const result = gapFillCalendar(input, "month", "day");
    // Jan 5 is in-range but no data → null
    expect(result.cellAt("2026-01-01 00:00:00", "2026-01-05 00:00:00")).toBeNull();
    // Out-of-range → null
    expect(result.cellAt("2026-01-01 00:00:00", "2026-02-01 00:00:00")).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Domain keys sorting
  // ─────────────────────────────────────────────────────────────────────────
  it("sorts domain keys ascending (matching buildCalendarSql ORDER BY)", () => {
    const input = [
      { domain_bucket: "2026-03-01 00:00:00", subdomain_bucket: "2026-03-05 00:00:00", value: 5 },
      { domain_bucket: "2026-01-01 00:00:00", subdomain_bucket: "2026-01-10 00:00:00", value: 3 },
      { domain_bucket: "2026-02-01 00:00:00", subdomain_bucket: "2026-02-07 00:00:00", value: 8 },
    ];
    const result = gapFillCalendar(input, "month", "day");
    expect(result.domainKeys).toEqual([
      "2026-01-01 00:00:00",
      "2026-02-01 00:00:00",
      "2026-03-01 00:00:00",
    ]);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Each cell carries its source coordinates
  // ─────────────────────────────────────────────────────────────────────────
  it("each cell carries its source coordinates (domainKey, subdomainKey)", () => {
    const input = [
      { domain_bucket: "2026-01-01 00:00:00", subdomain_bucket: "2026-01-03 00:00:00", value: 42 },
    ];
    const result = gapFillCalendar(input, "month", "day");
    const jan3 = result.rows[0].cells.find((c) => c.subdomainKey === "2026-01-03 00:00:00");
    expect(jan3?.domainKey).toBe("2026-01-01 00:00:00");
    expect(jan3?.subdomainKey).toBe("2026-01-03 00:00:00");
    expect(jan3?.value).toBe(42);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // THE CORE BUG FIX: week×day no-cross-fill
  //
  // Old behavior: two week groups both got ALL distinct subdomain days (from
  // both weeks) → phantom month-shaped block.
  // New behavior: each week group gets ONLY its OWN 7 days.
  // ─────────────────────────────────────────────────────────────────────────
  it("week×day no-cross-fill: week A's cells contain ONLY week A's 7 days", () => {
    // Week A starts Mon 2024-10-07; data only on 2024-10-09 (Wed)
    // Week B starts Mon 2024-10-14; data only on 2024-10-16 (Wed)
    const input = [
      { domain_bucket: "2024-10-07 00:00:00", subdomain_bucket: "2024-10-09 00:00:00", value: 5 },
      { domain_bucket: "2024-10-14 00:00:00", subdomain_bucket: "2024-10-16 00:00:00", value: 8 },
    ];
    const result = gapFillCalendar(input, "week", "day");

    const weekA = result.rows.find((r) => r.domainKey === "2024-10-07 00:00:00")!;
    expect(weekA).toBeDefined();

    // Week A gets exactly 7 days (Oct 7..13)
    expect(weekA.cells).toHaveLength(7);

    // Week A's Oct-09 (Wed) has value 5
    const oct9 = weekA.cells.find((c) => c.subdomainKey === "2024-10-09 00:00:00");
    expect(oct9?.value).toBe(5);

    // The other 6 days of week A are in-range but missing → null (grey)
    const weekANullCells = weekA.cells.filter((c) => c.value === null);
    expect(weekANullCells).toHaveLength(6);

    // CRITICAL: none of week B's days appear in week A's cells
    const weekBDayInWeekA = weekA.cells.find((c) => c.subdomainKey === "2024-10-16 00:00:00");
    expect(weekBDayInWeekA).toBeUndefined();

    // Confirm week B also gets only its own 7 days
    const weekB = result.rows.find((r) => r.domainKey === "2024-10-14 00:00:00")!;
    expect(weekB.cells).toHaveLength(7);
    const oct16 = weekB.cells.find((c) => c.subdomainKey === "2024-10-16 00:00:00");
    expect(oct16?.value).toBe(8);

    // Week A's days must NOT appear in week B's cells
    const weekADayInWeekB = weekB.cells.find((c) => c.subdomainKey === "2024-10-09 00:00:00");
    expect(weekADayInWeekB).toBeUndefined();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // in-range grey: 5-of-7 data days → 7 cells, 2 null
  // ─────────────────────────────────────────────────────────────────────────
  it("in-range grey: a week group with data on 5 of 7 days yields 7 cells with exactly 2 null", () => {
    // Week of 2024-10-07 (Mon). Only Mon/Tue/Wed/Thu/Fri have data (5 days). Sat/Sun missing.
    const input = [
      { domain_bucket: "2024-10-07 00:00:00", subdomain_bucket: "2024-10-07 00:00:00", value: 1 }, // Mon
      { domain_bucket: "2024-10-07 00:00:00", subdomain_bucket: "2024-10-08 00:00:00", value: 2 }, // Tue
      { domain_bucket: "2024-10-07 00:00:00", subdomain_bucket: "2024-10-09 00:00:00", value: 3 }, // Wed
      { domain_bucket: "2024-10-07 00:00:00", subdomain_bucket: "2024-10-10 00:00:00", value: 4 }, // Thu
      { domain_bucket: "2024-10-07 00:00:00", subdomain_bucket: "2024-10-11 00:00:00", value: 5 }, // Fri
      // Sat 2024-10-12 and Sun 2024-10-13 are missing
    ];
    const result = gapFillCalendar(input, "week", "day");
    const weekRow = result.rows[0];
    expect(weekRow.cells).toHaveLength(7);
    const nullCells = weekRow.cells.filter((c) => c.value === null);
    expect(nullCells).toHaveLength(2);
    // Sat and Sun are the grey ones
    const sat = weekRow.cells.find((c) => c.subdomainKey === "2024-10-12 00:00:00");
    const sun = weekRow.cells.find((c) => c.subdomainKey === "2024-10-13 00:00:00");
    expect(sat?.value).toBeNull();
    expect(sun?.value).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // month×day: March group → 31 cells, missing days null
  // ─────────────────────────────────────────────────────────────────────────
  it("month×day: March group with sparse data → 31 cells, missing days null", () => {
    const input = [
      { domain_bucket: "2024-03-01 00:00:00", subdomain_bucket: "2024-03-01 00:00:00", value: 10 },
      { domain_bucket: "2024-03-01 00:00:00", subdomain_bucket: "2024-03-15 00:00:00", value: 20 },
    ];
    const result = gapFillCalendar(input, "month", "day");
    const marchRow = result.rows.find((r) => r.domainKey === "2024-03-01 00:00:00")!;
    expect(marchRow).toBeDefined();
    expect(marchRow.cells).toHaveLength(31);
    // Populated cells
    expect(marchRow.cells.find((c) => c.subdomainKey === "2024-03-01 00:00:00")?.value).toBe(10);
    expect(marchRow.cells.find((c) => c.subdomainKey === "2024-03-15 00:00:00")?.value).toBe(20);
    // Missing day (Mar 10) → null
    expect(marchRow.cells.find((c) => c.subdomainKey === "2024-03-10 00:00:00")?.value).toBeNull();
    // Verify no cross-month cells (Apr 1 must not exist)
    const apr1 = marchRow.cells.find((c) => c.subdomainKey === "2024-04-01 00:00:00");
    expect(apr1).toBeUndefined();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // day×hour no-cross-fill: each day gets exactly its own 24 hours
  // ─────────────────────────────────────────────────────────────────────────
  it("day×hour no-cross-fill: two day groups each get exactly 24 hours; no cross-day hours", () => {
    const input = [
      { domain_bucket: "2024-03-01 00:00:00", subdomain_bucket: "2024-03-01 09:00:00", value: 5 },
      { domain_bucket: "2024-03-02 00:00:00", subdomain_bucket: "2024-03-02 14:00:00", value: 8 },
    ];
    const result = gapFillCalendar(input, "day", "hour");

    const day1 = result.rows.find((r) => r.domainKey === "2024-03-01 00:00:00")!;
    const day2 = result.rows.find((r) => r.domainKey === "2024-03-02 00:00:00")!;
    expect(day1).toBeDefined();
    expect(day2).toBeDefined();

    // Each day gets exactly 24 hours
    expect(day1.cells).toHaveLength(24);
    expect(day2.cells).toHaveLength(24);

    // Correct values at expected positions
    expect(day1.cells.find((c) => c.subdomainKey === "2024-03-01 09:00:00")?.value).toBe(5);
    expect(day2.cells.find((c) => c.subdomainKey === "2024-03-02 14:00:00")?.value).toBe(8);

    // CRITICAL: day 1's cells contain NO hours from day 2
    const day2HourInDay1 = day1.cells.find((c) => c.subdomainKey === "2024-03-02 14:00:00");
    expect(day2HourInDay1).toBeUndefined();

    // day 2's cells contain NO hours from day 1
    const day1HourInDay2 = day2.cells.find((c) => c.subdomainKey === "2024-03-01 09:00:00");
    expect(day1HourInDay2).toBeUndefined();

    // All in-range missing hours → null
    const day1NullCells = day1.cells.filter((c) => c.value === null);
    expect(day1NullCells).toHaveLength(23); // only 1 hour populated
  });

  // ─────────────────────────────────────────────────────────────────────────
  // out-of-range: assert NO cell for a subdomain key outside the group range
  // ─────────────────────────────────────────────────────────────────────────
  it("out-of-range: week A has no cell whose subdomainKey is a day from week B", () => {
    const input = [
      { domain_bucket: "2024-10-07 00:00:00", subdomain_bucket: "2024-10-09 00:00:00", value: 3 },
      { domain_bucket: "2024-10-14 00:00:00", subdomain_bucket: "2024-10-16 00:00:00", value: 7 },
    ];
    const result = gapFillCalendar(input, "week", "day");

    const weekACells = result.rows.find((r) => r.domainKey === "2024-10-07 00:00:00")!.cells;

    // Oct 16 is in week B, not week A — must not appear in week A's cells
    expect(weekACells.find((c) => c.subdomainKey === "2024-10-16 00:00:00")).toBeUndefined();
    // Oct 14 (Monday of week B) also must not appear
    expect(weekACells.find((c) => c.subdomainKey === "2024-10-14 00:00:00")).toBeUndefined();
    // Oct 17-20 (rest of week B) also must not appear
    expect(weekACells.find((c) => c.subdomainKey === "2024-10-17 00:00:00")).toBeUndefined();
    expect(weekACells.find((c) => c.subdomainKey === "2024-10-20 00:00:00")).toBeUndefined();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Populated values preserved at correct coordinates
  // ─────────────────────────────────────────────────────────────────────────
  it("preserves populated values at their correct (domain, subdomain) coordinates", () => {
    const input = [
      { domain_bucket: "2026-01-01 00:00:00", subdomain_bucket: "2026-01-03 00:00:00", value: 10 },
      { domain_bucket: "2026-02-01 00:00:00", subdomain_bucket: "2026-02-10 00:00:00", value: 20 },
    ];
    const result = gapFillCalendar(input, "month", "day");

    const jan = result.rows.find((r) => r.domainKey === "2026-01-01 00:00:00")!;
    const feb = result.rows.find((r) => r.domainKey === "2026-02-01 00:00:00")!;

    expect(jan.cells.find((c) => c.subdomainKey === "2026-01-03 00:00:00")?.value).toBe(10);
    expect(feb.cells.find((c) => c.subdomainKey === "2026-02-10 00:00:00")?.value).toBe(20);
  });
});

// Type-level sanity: ensure CalendarCell and CalendarRow are exported
describe("CalendarCell and CalendarRow type exports", () => {
  it("CalendarCell has domainKey, subdomainKey, value", () => {
    const cell: CalendarCell = { domainKey: "D1", subdomainKey: "S1", value: 5 };
    expect(cell.domainKey).toBe("D1");
    expect(cell.subdomainKey).toBe("S1");
    expect(cell.value).toBe(5);
  });

  it("CalendarRow has domainKey and cells array", () => {
    const row: CalendarRow = {
      domainKey: "D1",
      cells: [{ domainKey: "D1", subdomainKey: "S1", value: null }],
    };
    expect(row.domainKey).toBe("D1");
    expect(row.cells).toHaveLength(1);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Bucket-key FORMAT robustness (regression: all-grey grid when Kinetica's
  // DATE_TRUNC string format differs from enumerateGroupBuckets' output).
  // The enumerator emits "YYYY-MM-DD HH:mm:ss"; the value lookup must still
  // match populated rows whose buckets are date-only, millisecond, or ISO 'T'/Z.
  // ─────────────────────────────────────────────────────────────────────────
  describe("bucket-key format robustness (all-grey regression)", () => {
    function valueForJan5(subdomainBucket: string): number | null {
      const result = gapFillCalendar(
        [{ domain_bucket: "2026-01-01 00:00:00", subdomain_bucket: subdomainBucket, value: 42 }],
        "month",
        "day",
      );
      const jan5 = result.rows[0].cells.find((c) => c.subdomainKey === "2026-01-05 00:00:00");
      return jan5 ? jan5.value : (undefined as never);
    }

    it("matches a date-only subdomain bucket (2026-01-05)", () => {
      expect(valueForJan5("2026-01-05")).toBe(42);
    });

    it("matches a millisecond subdomain bucket (2026-01-05 00:00:00.000)", () => {
      expect(valueForJan5("2026-01-05 00:00:00.000")).toBe(42);
    });

    it("matches an ISO T/Z subdomain bucket (2026-01-05T00:00:00Z)", () => {
      expect(valueForJan5("2026-01-05T00:00:00Z")).toBe(42);
    });

    it("still matches the canonical space format (2026-01-05 00:00:00)", () => {
      expect(valueForJan5("2026-01-05 00:00:00")).toBe(42);
    });

    it("cellAt is also format-agnostic", () => {
      const result = gapFillCalendar(
        [{ domain_bucket: "2026-01-01", subdomain_bucket: "2026-01-05", value: 42 }],
        "month",
        "day",
      );
      expect(result.cellAt("2026-01-01 00:00:00", "2026-01-05 00:00:00")).toBe(42);
    });
  });
});
