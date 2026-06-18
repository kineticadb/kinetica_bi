/**
 * groupedSeries.ts — shared helpers for the grouped (series-split) Timeline and
 * Numeric-Line charts (Phase 72).
 *
 * When a group-by column is set, the chart renders ONE line per distinct value of
 * that column over a SINGLE metric. The grouped SQL builders (buildTimelineSql /
 * buildNumericLineSql) emit `<groupByCol> AS series` rows; this module provides:
 *   - MAX_SERIES: the readability cap (a line chart with >12 lines is unreadable).
 *   - selectTopSeries: rank series by total metric value DESC, keep the top N, and
 *     report whether the set was truncated (so the renderer can show "top 12 of N").
 *   - pivotSeriesRows: pivot the flat grouped rows into Recharts-ready rows keyed by
 *     series value, with missing (bucket × series) combos → null (gap semantics that
 *     mirror today's per-metric merge in TimelineRenderer/NumericLineRenderer).
 *
 * PURE module — zero React/Recharts/Zustand imports. Consumed by the Wave-2 renderers.
 */

/**
 * Default cap on the number of series rendered. Series beyond this (ranked by total
 * metric value descending) are dropped; the renderer surfaces "top N of M" rather than
 * silently truncating. A constant (not a config control) is acceptable for this milestone.
 */
export const MAX_SERIES = 12;

/** One row of the top-N pre-query: a series value and its aggregate metric total. */
export type SeriesTotalRow = {
  series: string;
  value: number;
};

/** One row of the main grouped query: a bucket, its series value, and the metric value. */
export type GroupedRow = {
  bucket: string;
  series: string;
  value: number | null;
};

export type SelectTopSeriesResult = {
  /** The selected series values, ordered by total metric value DESC (ties → series asc). */
  series: string[];
  /** True when more than `max` distinct series existed (the set was capped). */
  truncated: boolean;
  /** Total count of DISTINCT series in the input (for a "top N of M" affordance). */
  total: number;
};

/**
 * Rank grouped rows by total metric value (descending) and return the top `max` series.
 *
 * - Rows are summed per series (a series may appear once per bucket in the main query,
 *   but the pre-query typically returns one row per series; either is handled).
 * - Null values are treated as 0 for ranking.
 * - Ties on total are broken by series string ascending (stable, deterministic).
 * - `total` is the count of DISTINCT series in the input; `truncated` is `total > max`.
 */
export function selectTopSeries(
  rows: { series: string; value: number | null }[],
  opts: { max?: number } = {},
): SelectTopSeriesResult {
  const max = opts.max ?? MAX_SERIES;

  const totals = new Map<string, number>();
  for (const row of rows) {
    const prev = totals.get(row.series) ?? 0;
    totals.set(row.series, prev + (row.value ?? 0));
  }

  const ranked = Array.from(totals.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1]; // total DESC
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; // series ASC (tie-break)
  });

  const total = ranked.length;
  const series = ranked.slice(0, max).map(([s]) => s);
  return { series, truncated: total > max, total };
}

/**
 * Pivot flat grouped rows into Recharts-ready rows keyed by series value.
 *
 * Input: `{ bucket, series, value }[]` (the main grouped query) and the ordered list
 * of series values to keep (typically the output of selectTopSeries).
 *
 * Output: `{ bucket, [seriesValue]: number | null }[]`, one row per distinct bucket,
 * sorted by bucket. Every kept series value is present on every row; missing
 * (bucket × series) combos are filled with `null` (gap), matching today's metric-merge
 * semantics. Rows whose series is NOT in `seriesValues` are dropped.
 *
 * @param numericBuckets when true, sort buckets numerically (NumericLineRenderer's
 *        `.sort((a, b) => Number(a) - Number(b))`); default lexical (TimelineRenderer's
 *        ISO-bucket `.sort()`).
 */
export function pivotSeriesRows(
  rows: GroupedRow[],
  seriesValues: string[],
  opts: { numericBuckets?: boolean } = {},
): Record<string, number | null | string>[] {
  const keep = new Set(seriesValues);

  // bucket -> (series -> value)
  const byBucket = new Map<string, Map<string, number | null>>();
  for (const row of rows) {
    if (!keep.has(row.series)) continue; // drop out-of-set series
    let seriesMap = byBucket.get(row.bucket);
    if (!seriesMap) {
      seriesMap = new Map<string, number | null>();
      byBucket.set(row.bucket, seriesMap);
    }
    seriesMap.set(row.series, row.value);
  }

  const buckets = Array.from(byBucket.keys());
  if (opts.numericBuckets) {
    buckets.sort((a, b) => Number(a) - Number(b));
  } else {
    buckets.sort();
  }

  return buckets.map((bucket) => {
    const seriesMap = byBucket.get(bucket)!;
    const out: Record<string, number | null | string> = { bucket };
    for (const s of seriesValues) {
      out[s] = seriesMap.has(s) ? seriesMap.get(s)! : null; // missing combo → null (gap)
    }
    return out;
  });
}
