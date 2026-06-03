/**
 * numericBin.ts — pure helpers for the Numeric Line chart's X-axis binning.
 *
 * The numeric analog of timelineBin.ts: instead of binning a datetime column by a
 * time interval (DATE_TRUNC), this bins a NUMERIC column by a "nice" bin width,
 * auto-chosen from the column's value range and a target max bucket count.
 *
 * Bucket expression (see buildNumericLineSql.ts): FLOOR(xField / binWidth) * binWidth
 * → each row maps to the start value of its bin.
 *
 * Zero React/Recharts/Zustand imports. Consumed by NumericLineRenderer.tsx.
 */

// Reuse the metric/aggregation shapes from the Timeline chart — identical concept.
export type { TimelineMetric as NumericMetric, TimelineAggregation as NumericAggregation } from "./timelineBin";

/** Default target maximum number of X-axis buckets (operator-overridable). */
export const DEFAULT_MAX_BUCKETS = 50;

/**
 * Round a positive number to a "nice" 1/2/5 × 10ⁿ value.
 * `ceil` rounds UP (used for bin width so the bucket count stays ≤ target).
 */
function niceNumber(x: number, ceil: boolean): number {
  if (!(x > 0) || !Number.isFinite(x)) return 1;
  const exp = Math.floor(Math.log10(x));
  const frac = x / Math.pow(10, exp); // in [1, 10)
  let niceFrac: number;
  if (ceil) {
    if (frac <= 1) niceFrac = 1;
    else if (frac <= 2) niceFrac = 2;
    else if (frac <= 5) niceFrac = 5;
    else niceFrac = 10;
  } else {
    if (frac < 1.5) niceFrac = 1;
    else if (frac < 3) niceFrac = 2;
    else if (frac < 7) niceFrac = 5;
    else niceFrac = 10;
  }
  return niceFrac * Math.pow(10, exp);
}

/**
 * Choose a bin width for [min, max] so the number of buckets is ≤ maxBuckets.
 *
 * Rounds the raw width (range / maxBuckets) UP to a nice 1/2/5 × 10ⁿ value, so
 * `ceil((max - min) / binWidth) ≤ maxBuckets`. Degenerate ranges (min ≥ max, or a
 * single distinct value) return a safe positive width so callers never divide by 0.
 */
export function pickNumericBinWidth(args: {
  min: number;
  max: number;
  maxBuckets: number;
}): number {
  const { min, max } = args;
  const maxBuckets = Math.max(1, Math.floor(args.maxBuckets));
  const range = max - min;
  if (!Number.isFinite(range) || range <= 0) return 1; // single value / degenerate
  return niceNumber(range / maxBuckets, true);
}

/**
 * Build the one-shot numeric range probe SQL.
 *
 * Numeric MIN/MAX come back as finite numbers (unlike datetime MIN/MAX which are
 * strings), so the renderer can Number() them directly into pickNumericBinWidth.
 *
 * Empty schema → unprefixed FROM target (filter-view name / DV-bound), mirroring
 * buildTimelineRangeQuery.
 */
export function buildNumericRangeQuery(args: {
  schema: string;
  table: string;
  xField: string;
}): string {
  const { schema, table, xField } = args;
  const fromTarget = schema === "" ? table : `${schema}.${table}`;
  return (
    `SELECT MIN(${xField}) AS lo, MAX(${xField}) AS hi ` +
    `FROM ${fromTarget} ` +
    `WHERE ${xField} IS NOT NULL`
  );
}

/** Count of decimal places implied by a bin width (e.g. 0.1 → 1, 5 → 0, 0.25 → 2). */
function decimalsForWidth(binWidth: number): number {
  if (!Number.isFinite(binWidth) || binWidth >= 1) return 0;
  return Math.min(6, Math.max(0, Math.ceil(-Math.log10(binWidth))));
}

/**
 * Format a numeric bucket-start value for the X-axis tick, at a precision matched
 * to the bin width (fractional widths show decimals; integer widths show integers).
 * Non-numeric input falls through to its raw string.
 */
export function formatNumericTick(bucket: string | number, binWidth: number): string {
  const n = Number(bucket);
  if (!Number.isFinite(n)) return String(bucket);
  const decimals = decimalsForWidth(binWidth);
  return decimals > 0 ? n.toFixed(decimals) : String(Math.round(n));
}
