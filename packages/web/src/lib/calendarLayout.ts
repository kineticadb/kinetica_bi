/**
 * Phase 68.1 Plan 01 (CALUX-V113-01): pure calendar layout helper.
 *
 * Maps gapFillCalendar output (CalendarRow[]) into date-derived 2D blocks per
 * domain group — the "wrapped GitHub week-block" layout.
 *
 * Pure module — ZERO React / Zustand / Recharts imports.
 *
 * Exports:
 *   WEEK_START       — Monday-ISO anchor (1). Phase 69 spike may flip to 0 (Sunday).
 *   PositionedCell   — { cell, col, row }
 *   PositionedBlock  — { domainKey, label, cols, rows, cells }
 *   layoutCalendar   — pure (rows, domain, subdomain) -> PositionedBlock[]
 *
 * Positioning rules (UTC only — PITFALL 2 from calendarBin.ts):
 *   "day":   row = DOW index Mon=0…Sun=6 (UTC); col = week-index snapped to
 *            the earliest cell's week-start; rows = 7 always (GitHub style).
 *   "hour":  index = getUTCHours(); cols = 6 (discrete); row = floor(idx/cols),
 *            col = idx % cols; rows = ceil(24/6) = 4.
 *   "week":  ordinal index of key in sorted block; cols = ceil(sqrt(count)) capped
 *            at 13; row/col from index.
 *   "month": ordinal index of key in sorted block; cols = 4; row/col from index.
 *
 * ⚠ WEEK_START = 1 (Monday-ISO). The Phase 65 spike was NOT-RUN (Kinetica
 * DATE_TRUNC week anchor NOT-YET-VERIFIED). Phase 69 will flip this constant
 * in a single edit if the anchor turns out to be Sunday.
 */

import type { CalendarCell, CalendarRow } from "./calendarGapFill";
import type { CalendarDomain, CalendarSubdomain } from "./calendarBin";

// ---------------------------------------------------------------------------
// Week-start anchor constant
// ---------------------------------------------------------------------------

/**
 * Week-start anchor for the "day" subdomain layout.
 * 1 = Monday (ISO); offset = (getUTCDay() + 7 - WEEK_START) % 7.
 * ⚠ Phase 65 spike NOT-RUN — Phase 69 may flip to 0 (Sunday).
 */
export const WEEK_START = 1; // Monday-ISO

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single calendar cell with its 2D position within its block. */
export type PositionedCell = {
  /** The original CalendarCell — domainKey/subdomainKey/value preserved for drill. */
  cell: CalendarCell;
  /** Zero-based column index within the block. */
  col: number;
  /** Zero-based row index within the block. */
  row: number;
};

/** One domain group rendered as a 2D block. */
export type PositionedBlock = {
  /** The domain_bucket key (e.g. "2026", "2026-01"). Raw — Plan 03 formats for display. */
  domainKey: string;
  /** Display label — same as domainKey (Plan 03 applies formatTimelineTick for display). */
  label: string;
  /** Width of the block in cells. */
  cols: number;
  /** Height of the block in cells. */
  rows: number;
  /** All positioned cells for this domain group. */
  cells: PositionedCell[];
};

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Map a gap-filled calendar grid into date-derived 2D blocks per domain group.
 *
 * @param rows      - CalendarRow[] from gapFillCalendar (one row = one domain group).
 * @param domain    - The outer grouping level ("year" | "month" | "week" | "day").
 * @param subdomain - The cell granularity ("month" | "week" | "day" | "hour").
 * @returns         One PositionedBlock per domainKey, in the same order as `rows`.
 */
export function layoutCalendar(args: {
  rows: CalendarRow[];
  domain: CalendarDomain;
  subdomain: CalendarSubdomain;
  /**
   * Kinetica's week-boundary day-of-week (0=Sun … 6=Sat), from inferWeekAnchorDow.
   * Drives the day-of-week ROW offset for "day" blocks so a week aligns to the data's
   * actual week start (week×day → a clean single column). Defaults to WEEK_START (Monday).
   */
  weekAnchorDow?: number;
}): PositionedBlock[] {
  const { rows, subdomain } = args;
  if (rows.length === 0) return [];

  const anchorDow = args.weekAnchorDow ?? WEEK_START;
  return rows.map((row) => layoutBlock(row, args.domain, subdomain, anchorDow));
}

// ---------------------------------------------------------------------------
// Per-block layout dispatch
// ---------------------------------------------------------------------------

function layoutBlock(
  row: CalendarRow,
  domain: CalendarDomain,
  subdomain: CalendarSubdomain,
  anchorDow: number,
): PositionedBlock {
  switch (subdomain) {
    case "day":   return layoutDayBlock(row, anchorDow);
    case "hour":  return layoutHourBlock(row, domain);
    case "week":  return layoutWeekBlock(row);
    case "month": return layoutMonthBlock(row);
  }
}

// ---------------------------------------------------------------------------
// "day" subdomain — GitHub-style 7-row DOW × week-column layout
//
// row  = ISO day-of-week index Mon=0 … Sun=6 (UTC)
// col  = week-index within the domain group, computed relative to the
//        Monday-snapped start of the earliest subdomainKey in the block.
// rows = 7 always (a full DOW slot per row, regardless of actual cells).
// cols = max col + 1.
// ---------------------------------------------------------------------------

function layoutDayBlock(row: CalendarRow, anchorDow: number): PositionedBlock {
  const { domainKey, cells } = row;

  if (cells.length === 0) {
    return { domainKey, label: domainKey, cols: 0, rows: 7, cells: [] };
  }

  // Find the earliest subdomainKey to compute week-column anchor.
  // subdomainKeys are date strings — lexicographic sort works for ISO/date-trunc format.
  const sorted = [...cells].sort((a, b) =>
    a.subdomainKey < b.subdomainKey ? -1 : a.subdomainKey > b.subdomainKey ? 1 : 0,
  );
  const firstMs = parseUTCMs(sorted[0].subdomainKey);

  // Snap the anchor to the week start for Kinetica's ACTUAL week anchor (anchorDow),
  // not a hardcoded Monday. offset = (getUTCDay() + 7 - anchorDow) % 7  →  anchorDay=row 0.
  const firstDay = new Date(firstMs);
  const firstDow = firstDay.getUTCDay(); // 0=Sun,1=Mon,…,6=Sat
  const offsetToAnchor = (firstDow + 7 - anchorDow) % 7;
  const anchorMs = firstMs - offsetToAnchor * 86_400_000; // week-start of first cell's week

  const positioned: PositionedCell[] = cells.map((cell) => {
    const cellMs = parseUTCMs(cell.subdomainKey);
    const dow = new Date(cellMs).getUTCDay(); // 0=Sun,1=Mon,…,6=Sat

    // DOW row index: anchorDay = row 0 … +6
    const rowIdx = (dow + 7 - anchorDow) % 7;

    // Week-column: how many full 7-day periods from the anchor Monday
    const daysSinceAnchor = Math.round((cellMs - anchorMs) / 86_400_000);
    const colIdx = Math.floor(daysSinceAnchor / 7);

    return { cell, col: colIdx, row: rowIdx };
  });

  const maxCol = positioned.reduce((m, p) => Math.max(m, p.col), 0);

  return {
    domainKey,
    label: domainKey,
    cols: maxCol + 1,
    rows: 7,
    cells: positioned,
  };
}

// ---------------------------------------------------------------------------
// "hour" subdomain
//
//   day×hour  → compact 6-col × 4-row grid of the day's 24 hours
//               (col = hour % 6, row = floor(hour / 6))
//   week×hour → "punchcard": 7 day-rows × 24 hour-cols (168 cells)
//               (row = day offset from the week start, col = hour of day)
//               A single 6×4 grid would collapse all 7 days onto 24 positions.
// ---------------------------------------------------------------------------

const HOUR_COLS = 6;

function layoutHourBlock(row: CalendarRow, domain: CalendarDomain): PositionedBlock {
  const { domainKey, cells } = row;

  if (domain === "week") {
    // Punchcard: row = day offset from the week start (0..6), col = hour-of-day (0..23).
    const weekStartMs = parseUTCMs(domainKey);
    const positioned: PositionedCell[] = cells.map((cell) => {
      const cellMs = parseUTCMs(cell.subdomainKey);
      const dayOffset = Math.floor((cellMs - weekStartMs) / 86_400_000);
      const hourOfDay = new Date(cellMs).getUTCHours();
      return { cell, col: hourOfDay, row: dayOffset };
    });
    return { domainKey, label: domainKey, cols: 24, rows: 7, cells: positioned };
  }

  // day×hour — compact 6×4 grid of the day's 24 hours.
  const positioned: PositionedCell[] = cells.map((cell) => {
    const h = new Date(parseUTCMs(cell.subdomainKey)).getUTCHours();
    return { cell, col: h % HOUR_COLS, row: Math.floor(h / HOUR_COLS) };
  });

  const rowCount = Math.ceil(cells.length / HOUR_COLS);

  return {
    domainKey,
    label: domainKey,
    cols: HOUR_COLS,
    rows: rowCount,
    cells: positioned,
  };
}

// ---------------------------------------------------------------------------
// "week" subdomain — compact grid, ordinal index
//
// Cells are sorted by subdomainKey (ascending).
// cols = ceil(sqrt(count)) capped at 13 (prevents ultra-wide blocks for dense ranges).
// row  = floor(index / cols)
// col  = index % cols
// rows = ceil(count / cols)
// ---------------------------------------------------------------------------

function layoutWeekBlock(row: CalendarRow): PositionedBlock {
  const { domainKey, cells } = row;
  if (cells.length === 0) {
    return { domainKey, label: domainKey, cols: 0, rows: 0, cells: [] };
  }

  const sorted = [...cells].sort((a, b) =>
    a.subdomainKey < b.subdomainKey ? -1 : a.subdomainKey > b.subdomainKey ? 1 : 0,
  );

  const count = sorted.length;
  const cols = Math.min(13, Math.ceil(Math.sqrt(count)));

  const positioned: PositionedCell[] = sorted.map((cell, idx) => ({
    cell,
    col: idx % cols,
    row: Math.floor(idx / cols),
  }));

  return {
    domainKey,
    label: domainKey,
    cols,
    rows: Math.ceil(count / cols),
    cells: positioned,
  };
}

// ---------------------------------------------------------------------------
// "month" subdomain — compact 4-col grid (12 months → 4×3)
//
// Cells are sorted by subdomainKey (ascending).
// cols = 4 (constant — 12 months / 4 cols = 3 rows, a clean 4×3 grid).
// row  = floor(index / 4)
// col  = index % 4
// rows = ceil(count / 4)
// ---------------------------------------------------------------------------

const MONTH_COLS = 4;

function layoutMonthBlock(row: CalendarRow): PositionedBlock {
  const { domainKey, cells } = row;
  if (cells.length === 0) {
    return { domainKey, label: domainKey, cols: 0, rows: 0, cells: [] };
  }

  const sorted = [...cells].sort((a, b) =>
    a.subdomainKey < b.subdomainKey ? -1 : a.subdomainKey > b.subdomainKey ? 1 : 0,
  );

  const positioned: PositionedCell[] = sorted.map((cell, idx) => ({
    cell,
    col: idx % MONTH_COLS,
    row: Math.floor(idx / MONTH_COLS),
  }));

  return {
    domainKey,
    label: domainKey,
    cols: MONTH_COLS,
    rows: Math.ceil(sorted.length / MONTH_COLS),
    cells: positioned,
  };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Parse a subdomainKey string to a UTC epoch (ms).
 *
 * Kinetica DATE_TRUNC output format: "YYYY-MM-DD HH:mm:ss" (space separator, no Z).
 * new Date("YYYY-MM-DD HH:mm:ss") is implementation-defined (local vs UTC varies).
 * Canonicalize by replacing the space with 'T' and appending 'Z' → always UTC.
 *
 * Also handles ISO strings with 'T' and trailing 'Z' unchanged.
 */
function parseUTCMs(subdomainKey: string): number {
  // Convert "YYYY-MM-DD HH:mm:ss" → "YYYY-MM-DDTHH:mm:ssZ" for unambiguous UTC parse.
  // Strings already containing 'T' (e.g. ISO "2026-01-05T00:00:00.000Z") are left intact.
  const iso = subdomainKey.includes("T")
    ? subdomainKey
    : subdomainKey.replace(" ", "T") + "Z";
  return new Date(iso).getTime();
}
