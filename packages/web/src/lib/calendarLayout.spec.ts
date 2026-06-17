/**
 * Phase 68.1 Plan 01 (CALUX-V113-01): TDD specs for calendarLayout —
 * pure (cells, domain, subdomain, weekStart) -> positioned blocks helper.
 *
 * RED phase: all tests written before implementation exists.
 *
 * Fixtures are hand-crafted CalendarRow[] literals — NOT routed through
 * gapFillCalendar, so this spec tests only the layout logic.
 */
import { describe, it, expect } from "vitest";
import { layoutCalendar, WEEK_START } from "./calendarLayout";
import type { CalendarRow } from "./calendarGapFill";

// ---------------------------------------------------------------------------
// WEEK_START constant
// ---------------------------------------------------------------------------

describe("WEEK_START", () => {
  it("is 1 (Monday-ISO) — Phase 69 spike may flip to 0 (Sunday)", () => {
    // ⚠ Phase 65 spike NOT-RUN — Kinetica DATE_TRUNC week anchor NOT-YET-VERIFIED.
    // Keep WEEK_START as the SOLE place the anchor is defined so Phase 69 flips it
    // in a single edit.
    expect(WEEK_START).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Empty input
// ---------------------------------------------------------------------------

describe("layoutCalendar — empty input", () => {
  it("returns [] for empty rows", () => {
    const result = layoutCalendar({ rows: [], domain: "year", subdomain: "day" });
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Helper to build CalendarRow fixtures
// ---------------------------------------------------------------------------

function makeRow(domainKey: string, subdomainKeys: string[]): CalendarRow {
  return {
    domainKey,
    cells: subdomainKeys.map((subdomainKey) => ({
      domainKey,
      subdomainKey,
      value: 1,
    })),
  };
}

// ---------------------------------------------------------------------------
// day subdomain — GitHub week-block layout
//
// Monday 2026-01-05 through Sunday 2026-01-11 = 7 days, one week column.
// Adding Mon 2026-01-12 puts it in week-column 1.
// ---------------------------------------------------------------------------

describe("layoutCalendar — day subdomain", () => {
  // 8 days: Mon 2026-01-05 .. Mon 2026-01-12 (spans 2 week-columns, 7 distinct DOW rows)
  const DAYS_8 = [
    "2026-01-05 00:00:00", // Mon → DOW row 0, week col 0
    "2026-01-06 00:00:00", // Tue → DOW row 1, week col 0
    "2026-01-07 00:00:00", // Wed → DOW row 2, week col 0
    "2026-01-08 00:00:00", // Thu → DOW row 3, week col 0
    "2026-01-09 00:00:00", // Fri → DOW row 4, week col 0
    "2026-01-10 00:00:00", // Sat → DOW row 5, week col 0
    "2026-01-11 00:00:00", // Sun → DOW row 6, week col 0
    "2026-01-12 00:00:00", // Mon → DOW row 0, week col 1
  ];

  const rows: CalendarRow[] = [makeRow("2026", DAYS_8)];

  it("produces exactly one block per domainKey", () => {
    const blocks = layoutCalendar({ rows, domain: "year", subdomain: "day" });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].domainKey).toBe("2026");
  });

  it("block has rows === 7 (GitHub style — always 7 day-of-week slots)", () => {
    const blocks = layoutCalendar({ rows, domain: "year", subdomain: "day" });
    expect(blocks[0].rows).toBe(7);
  });

  it("each cell's row === ISO day-of-week index (Mon=0 … Sun=6, UTC)", () => {
    const blocks = layoutCalendar({ rows, domain: "year", subdomain: "day" });
    const positioned = blocks[0].cells;

    // 2026-01-05 = Monday UTC → row 0
    const mon = positioned.find((p) => p.cell.subdomainKey === "2026-01-05 00:00:00");
    expect(mon?.row).toBe(0);

    // 2026-01-11 = Sunday UTC → row 6
    const sun = positioned.find((p) => p.cell.subdomainKey === "2026-01-11 00:00:00");
    expect(sun?.row).toBe(6);
  });

  it("col is the week-index within the domain group (0-based)", () => {
    const blocks = layoutCalendar({ rows, domain: "year", subdomain: "day" });
    const positioned = blocks[0].cells;

    // All 7 days of the first week → col 0
    for (const key of DAYS_8.slice(0, 7)) {
      const p = positioned.find((c) => c.cell.subdomainKey === key);
      expect(p?.col).toBe(0);
    }

    // 2026-01-12 is Monday of week 1 → col 1
    const mon2 = positioned.find((p) => p.cell.subdomainKey === "2026-01-12 00:00:00");
    expect(mon2?.col).toBe(1);
  });

  it("block.cols === max col + 1", () => {
    const blocks = layoutCalendar({ rows, domain: "year", subdomain: "day" });
    expect(blocks[0].cols).toBe(2);
  });

  it("block label equals domainKey (raw — Plan 03 formats for display)", () => {
    const blocks = layoutCalendar({ rows, domain: "year", subdomain: "day" });
    expect(blocks[0].label).toBe("2026");
  });
});

// ---------------------------------------------------------------------------
// hour subdomain — compact grid (24 hours, 6 cols × 4 rows)
// ---------------------------------------------------------------------------

describe("layoutCalendar — hour subdomain", () => {
  // Build 24 hour cells for 2026-01-05
  const HOURS_24 = Array.from({ length: 24 }, (_, h) => {
    const hh = String(h).padStart(2, "0");
    return `2026-01-05 ${hh}:00:00`;
  });

  const rows: CalendarRow[] = [makeRow("2026-01-05", HOURS_24)];

  it("produces one block with 24 positioned cells", () => {
    const blocks = layoutCalendar({ rows, domain: "day", subdomain: "hour" });
    expect(blocks[0].cells).toHaveLength(24);
  });

  it("compact grid: cols === 6 and rows === 4", () => {
    const blocks = layoutCalendar({ rows, domain: "day", subdomain: "hour" });
    expect(blocks[0].cols).toBe(6);
    expect(blocks[0].rows).toBe(4);
  });

  it("row = floor(hourIndex / cols), col = hourIndex % cols", () => {
    const blocks = layoutCalendar({ rows, domain: "day", subdomain: "hour" });
    const positioned = blocks[0].cells;
    const COLS = 6;

    for (let h = 0; h < 24; h++) {
      const key = `2026-01-05 ${String(h).padStart(2, "0")}:00:00`;
      const p = positioned.find((c) => c.cell.subdomainKey === key);
      expect(p?.row).toBe(Math.floor(h / COLS));
      expect(p?.col).toBe(h % COLS);
    }
  });

  it("no two cells share the same (col, row)", () => {
    const blocks = layoutCalendar({ rows, domain: "day", subdomain: "hour" });
    const seen = new Set<string>();
    for (const p of blocks[0].cells) {
      const key = `${p.col},${p.row}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});

// ---------------------------------------------------------------------------
// week subdomain — compact grid (N weeks)
// ---------------------------------------------------------------------------

describe("layoutCalendar — week subdomain", () => {
  // 10 weeks — should produce multiple rows (e.g. 4 cols → 3 rows: 4+4+2)
  const WEEKS_10 = Array.from({ length: 10 }, (_, i) => {
    // Start from 2026-01-05, add 7*i days
    const ms = Date.UTC(2026, 0, 5) + i * 7 * 86_400_000;
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")} 00:00:00`;
  });

  const rows: CalendarRow[] = [makeRow("2026", WEEKS_10)];

  it("all 10 cells are positioned", () => {
    const blocks = layoutCalendar({ rows, domain: "year", subdomain: "week" });
    expect(blocks[0].cells).toHaveLength(10);
  });

  it("has more than 1 row (compact grid is 2D)", () => {
    const blocks = layoutCalendar({ rows, domain: "year", subdomain: "week" });
    expect(blocks[0].rows).toBeGreaterThan(1);
  });

  it("all 10 cells have unique (col, row) positions", () => {
    const blocks = layoutCalendar({ rows, domain: "year", subdomain: "week" });
    const seen = new Set<string>();
    for (const p of blocks[0].cells) {
      const key = `${p.col},${p.row}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});

// ---------------------------------------------------------------------------
// month subdomain — compact grid (12 months → e.g. 4 cols × 3 rows)
// ---------------------------------------------------------------------------

describe("layoutCalendar — month subdomain", () => {
  const MONTHS_12 = Array.from({ length: 12 }, (_, i) => {
    const mm = String(i + 1).padStart(2, "0");
    return `2026-${mm}-01 00:00:00`;
  });

  const rows: CalendarRow[] = [makeRow("2026", MONTHS_12)];

  it("all 12 cells are positioned", () => {
    const blocks = layoutCalendar({ rows, domain: "year", subdomain: "month" });
    expect(blocks[0].cells).toHaveLength(12);
  });

  it("compact grid: cols === 4 and rows === 3 (4×3 = 12)", () => {
    const blocks = layoutCalendar({ rows, domain: "year", subdomain: "month" });
    expect(blocks[0].cols).toBe(4);
    expect(blocks[0].rows).toBe(3);
  });

  it("all 12 cells have unique (col, row) positions", () => {
    const blocks = layoutCalendar({ rows, domain: "year", subdomain: "month" });
    const seen = new Set<string>();
    for (const p of blocks[0].cells) {
      const key = `${p.col},${p.row}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});

// ---------------------------------------------------------------------------
// Identity preservation — cell references survive layout unchanged
// ---------------------------------------------------------------------------

describe("layoutCalendar — cell identity preservation", () => {
  const rows: CalendarRow[] = [
    makeRow("2026-01", [
      "2026-01-05 00:00:00",
      "2026-01-06 00:00:00",
    ]),
  ];

  it("each PositionedCell.cell carries the original domainKey/subdomainKey/value", () => {
    const blocks = layoutCalendar({ rows, domain: "month", subdomain: "day" });
    for (const p of blocks[0].cells) {
      // Must match the original CalendarCell fields exactly
      expect(p.cell.domainKey).toBe("2026-01");
      expect(typeof p.cell.subdomainKey).toBe("string");
      expect(p.cell.value).toBe(1);
    }
  });

  it("PositionedCell.cell is the same object reference as the input cell", () => {
    const inputRow = makeRow("2026-01", ["2026-01-05 00:00:00", "2026-01-06 00:00:00"]);
    const blocks = layoutCalendar({
      rows: [inputRow],
      domain: "month",
      subdomain: "day",
    });
    for (const p of blocks[0].cells) {
      // Find corresponding input cell by subdomainKey
      const orig = inputRow.cells.find((c) => c.subdomainKey === p.cell.subdomainKey);
      expect(p.cell).toBe(orig); // same reference
    }
  });
});

// ---------------------------------------------------------------------------
// Multiple domain groups — one block per domainKey in input order
// ---------------------------------------------------------------------------

describe("layoutCalendar — multiple domain groups", () => {
  const rows: CalendarRow[] = [
    makeRow("2025", ["2025-01-01 00:00:00", "2025-01-02 00:00:00"]),
    makeRow("2026", ["2026-01-01 00:00:00", "2026-01-02 00:00:00"]),
  ];

  it("returns one block per domainKey preserving input order", () => {
    const blocks = layoutCalendar({ rows, domain: "year", subdomain: "day" });
    expect(blocks).toHaveLength(2);
    expect(blocks[0].domainKey).toBe("2025");
    expect(blocks[1].domainKey).toBe("2026");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Anchor-agnostic DOW rows (regression: week×day straddled 2 columns when the
  // week wasn't Monday-anchored). weekAnchorDow threads the data-derived anchor.
  // ───────────────────────────────────────────────────────────────────────────
  describe("weekAnchorDow aligns the day-of-week rows", () => {
    it("week×day with a Sunday anchor renders a single clean column", () => {
      // A Sunday-anchored week: Sun 2022-10-09 .. Sat 2022-10-15
      const rows: CalendarRow[] = [
        {
          domainKey: "2022-10-09 00:00:00",
          cells: Array.from({ length: 7 }, (_, i) => ({
            domainKey: "2022-10-09 00:00:00",
            subdomainKey: `2022-10-${String(9 + i).padStart(2, "0")} 00:00:00`,
            value: i,
          })),
        },
      ];
      const blocks = layoutCalendar({
        rows,
        domain: "week",
        subdomain: "day",
        weekAnchorDow: 0, // Sunday
      });
      // All 7 days in ONE column (cols === 1), rows 0..6 in week order
      expect(blocks[0].cols).toBe(1);
      expect(blocks[0].rows).toBe(7);
      const rowsByDay = blocks[0].cells.map((c) => c.row).sort((a, b) => a - b);
      expect(rowsByDay).toEqual([0, 1, 2, 3, 4, 5, 6]);
      expect(blocks[0].cells.every((c) => c.col === 0)).toBe(true);
    });

    it("week×hour renders a 7-day × 24-hour punchcard (not a collapsed 6×4 grid)", () => {
      // One week (Sun 2022-10-09) × 168 hours
      const cells = [];
      for (let dayOff = 0; dayOff < 7; dayOff++) {
        for (let h = 0; h < 24; h++) {
          const key = `2022-10-${String(9 + dayOff).padStart(2, "0")} ${String(h).padStart(2, "0")}:00:00`;
          cells.push({ domainKey: "2022-10-09 00:00:00", subdomainKey: key, value: 1 });
        }
      }
      const rows: CalendarRow[] = [{ domainKey: "2022-10-09 00:00:00", cells }];
      const blocks = layoutCalendar({ rows, domain: "week", subdomain: "hour" });
      expect(blocks[0].cols).toBe(24); // 24 hours across
      expect(blocks[0].rows).toBe(7); // 7 days down
      // first cell (Sun 00:00) at row 0, col 0; last (Sat 23:00) at row 6, col 23
      const first = blocks[0].cells.find((c) => c.cell.subdomainKey === "2022-10-09 00:00:00");
      const last = blocks[0].cells.find((c) => c.cell.subdomainKey === "2022-10-15 23:00:00");
      expect(first).toMatchObject({ row: 0, col: 0 });
      expect(last).toMatchObject({ row: 6, col: 23 });
      // no two cells share a position (no collapse)
      const positions = new Set(blocks[0].cells.map((c) => `${c.row},${c.col}`));
      expect(positions.size).toBe(168);
    });

    it("defaults to Monday (WEEK_START) when no anchor passed", () => {
      const rows: CalendarRow[] = [
        {
          domainKey: "2024-10-07 00:00:00", // Monday
          cells: [
            { domainKey: "2024-10-07 00:00:00", subdomainKey: "2024-10-07 00:00:00", value: 1 },
          ],
        },
      ];
      const blocks = layoutCalendar({ rows, domain: "week", subdomain: "day" });
      expect(WEEK_START).toBe(1);
      // Monday at the Monday anchor → row 0
      expect(blocks[0].cells[0].row).toBe(0);
    });
  });
});
