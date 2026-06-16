/**
 * Phase 66 Plan 01 (CAL-V113-05 cap portion): pure cell-count estimation library.
 *
 * (a) Pure module — zero React/Recharts/Zustand imports.
 * (b) Consumed by Plan 66-03 CalendarConfigPanel to HARD BLOCK runaway calendar
 *     grids at config-save time (domain=year + subdomain=hour on wide datasets).
 * (c) Mirrors the Phase 65 pattern (buildCalendarSql / calendarBin are pure libs).
 *
 * SUBDOMAIN_GRANULARITY_MS — month is 28 days (2_419_200_000 ms):
 *   Months vary 28–31 days in reality. Using the SMALLEST possible month (28 days)
 *   as the divisor means we compute MORE buckets (ceil(range / 28d) ≥ ceil(range / 30d)),
 *   giving a CONSERVATIVE UPPER BOUND on cell count. The estimator errs toward
 *   blocking, never toward silently allowing an over-limit grid.
 *
 * buildCalendarRangeQuery — fromTarget contract:
 *   The caller pre-resolves (schema, table) → fromTarget BEFORE calling this function.
 *   For table-bound widgets: fromTarget = "schema.table".
 *   For dv-bound widgets:    fromTarget = "_kbi_dv_v1234" (bare, no schema prefix).
 *   This mirrors BuildCalendarSqlArgs.fromTarget (buildCalendarSql.ts) — NO first-FROM
 *   regex or schema-prefixing logic lives inside this module.
 *   EXTRACT(EPOCH FROM ...) → output is in SECONDS; callers multiply × 1000 for ms
 *   (matching TimelineRenderer line 244).
 */

import type { CalendarSubdomain } from "./calendarBin";

/**
 * Millisecond duration of each subdomain granularity.
 *
 * month = 2_419_200_000 ms (28 days) — the SMALLER divisor → MORE estimated cells →
 * conservative UPPER BOUND on cell count (errs toward over-estimating, never under).
 * Spec assertion: SUBDOMAIN_GRANULARITY_MS["month"] < 30 * 86_400_000.
 */
export const SUBDOMAIN_GRANULARITY_MS: Record<CalendarSubdomain, number> = {
  hour:  3_600_000,
  day:   86_400_000,
  week:  604_800_000,
  month: 2_419_200_000, // 28d — conservative UPPER-bound divisor (more cells, not fewer)
};

/**
 * Estimate the worst-case number of calendar cells for a given range + subdomain.
 *
 * The SUBDOMAIN cell count drives the grid size: each distinct subdomain bucket across
 * the full data span = one rendered cell. Domain grouping re-arranges cells into rows
 * but does NOT multiply them. This is a defensible upper bound:
 *   actual cells ≤ subdomain-bucket count.
 *
 * @param rangeMs  - Data range in milliseconds (max_epoch_ms − min_epoch_ms).
 * @param subdomain - The calendar subdomain ("hour" | "day" | "week" | "month").
 * @returns Upper-bound cell count. Returns 0 for degenerate (empty/null) ranges.
 */
export function estimateCalendarCells(args: {
  rangeMs: number;
  subdomain: CalendarSubdomain;
}): number {
  const { rangeMs, subdomain } = args;
  if (rangeMs <= 0) return 0;
  return Math.ceil(rangeMs / SUBDOMAIN_GRANULARITY_MS[subdomain]);
}

/**
 * Build a MIN/MAX epoch probe query over a pre-resolved FROM target.
 *
 * Emitted SQL:
 *   SELECT EXTRACT(EPOCH FROM MIN(<timeCol>)) AS lo,
 *          EXTRACT(EPOCH FROM MAX(<timeCol>)) AS hi
 *   FROM <fromTarget>
 *   WHERE <timeCol> IS NOT NULL
 *
 * EXTRACT(EPOCH FROM ...) returns seconds (float). Callers multiply × 1000 to
 * get milliseconds for use with estimateCalendarCells (matching TimelineRenderer
 * line 244 pattern).
 *
 * @param fromTarget - Pre-resolved FROM target ("schema.table" or bare dv view name).
 *                     NO schema prefixing is applied inside this function — caller owns resolution.
 * @param timeCol    - The timestamp column name.
 */
export function buildCalendarRangeQuery(args: {
  fromTarget: string;
  timeCol: string;
}): string {
  const { fromTarget, timeCol } = args;
  return (
    `SELECT EXTRACT(EPOCH FROM MIN(${timeCol})) AS lo, ` +
    `EXTRACT(EPOCH FROM MAX(${timeCol})) AS hi ` +
    `FROM ${fromTarget} ` +
    `WHERE ${timeCol} IS NOT NULL`
  );
}
