/** Phase 102 (BARGRP): pure helpers mapping multi-column bar GROUP BY rows to the
 *  { bucket, series, value } shape consumed by groupedSeries.ts selectTopSeries/pivotSeriesRows.
 *  bucket = col1 (x-axis category); series = col2..N joined " / " (compound key).
 *
 * PURE module — zero React/Recharts/Zustand imports. Mirrors groupedSeries.ts purity.
 */

export const BAR_SERIES_SEPARATOR = " / ";

/**
 * Backward-compat guard — returns true IFF config.groupByColumns is an array of
 * length >= 2. Plans 02 (config panel) and 03 (renderer) both import this as the
 * single canonical multi-column check; single-column / no group-by falls through
 * to the legacy single-series bar path (BARGRP-V119-04).
 */
export function isMultiColumnBarGroupBy(config: Record<string, unknown>): boolean {
  const cols = config.groupByColumns;
  return Array.isArray(cols) && cols.length >= 2;
}

/**
 * Map flat multi-column SQL rows to the { bucket, series, value }[] shape that
 * selectTopSeries and pivotSeriesRows already consume.
 *
 * - groupByColumns[0] → bucket (x-axis category, String()-coerced)
 * - groupByColumns[1..N] → series joined by BAR_SERIES_SEPARATOR (" / ")
 * - row["value"] must be a finite number; null / undefined / Infinity / NaN → null
 *   (selectTopSeries treats null as 0 for ranking; pivotSeriesRows renders a gap)
 *
 * Collision note (Pitfall 3 — RESEARCH.md): the " / " delimiter can collide when a
 * column value itself contains " / ". This is an accepted known edge-case — do NOT
 * engineer around it (same trade-off as the timeline group-by separator).
 */
export function toBarPivotInput(
  rows: Record<string, unknown>[],
  groupByColumns: string[],
): { bucket: string; series: string; value: number | null }[] {
  const [col1, ...restCols] = groupByColumns;
  return rows.map((r) => {
    const raw = r["value"];
    const value = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    return {
      bucket: String(r[col1]),
      series: restCols.map((c) => String(r[c])).join(BAR_SERIES_SEPARATOR),
      value,
    };
  });
}
