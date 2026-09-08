/**
 * Heatmap axis bucketing.
 *
 * A raw timestamp is a poor heatmap axis: every distinct instant becomes its own
 * one-cell row, so 250 pickup times are 250 rows that all format to a handful of
 * repeated dates. Bucketing groups the axis into meaningful bands instead.
 *
 * PURE module — zero React/Zustand imports.
 *
 * Two families, which behave differently and must not be conflated:
 *
 *   "trunc"  DATE_TRUNC('<unit>', col) — collapses an instant to the START of
 *            its period. Values stay TIMESTAMPS, so they keep the column's date
 *            format and sort chronologically. 250 instants over a month become
 *            ~30 day rows.
 *
 *   "cycle"  EXTRACT(<unit> FROM col) — collapses an instant to its position
 *            WITHIN a repeating cycle, folding every date together. Values are
 *            small INTEGERS (hour 0-23, month 1-12), NOT timestamps, so the
 *            column's date format must NOT be applied to them — formatting 14
 *            as a date yields 1970. This is what makes the classic
 *            day-of-week x hour-of-day heatmap possible.
 *
 * SQL provenance: the DATE_TRUNC units below are exactly those proven against
 * Kinetica by lib/timelineBin.ts's INTERVAL_LADDER (locked in CONTEXT.md
 * §Post-research decisions 2026-05-29). The EXTRACT form is the same construct
 * timelineBin uses for EPOCH; only these unit keywords are unverified against a
 * live instance.
 */

import { MONTH_ABBR } from "./timelineBin";

export type HeatmapBucketKind = "none" | "trunc" | "cycle";

export type HeatmapBucketKey =
  | "none"
  | "minute"
  | "hour"
  | "day"
  | "week"
  | "month"
  | "quarter"
  | "year"
  | "hour_of_day"
  | "day_of_week"
  | "month_of_year";

export type HeatmapBucket = {
  key: HeatmapBucketKey;
  label: string;
  kind: HeatmapBucketKind;
  /** DATE_TRUNC unit — kind "trunc" only. Mirrors timelineBin's proven units. */
  truncUnit?: string;
  /** EXTRACT unit — kind "cycle" only. */
  extractUnit?: string;
};

/** Offered in the per-axis Bucket picker, coarse cycles last. */
export const HEATMAP_BUCKETS: readonly HeatmapBucket[] = [
  { key: "none", label: "None (raw value)", kind: "none" },
  { key: "minute", label: "Truncate to minute", kind: "trunc", truncUnit: "minute" },
  { key: "hour", label: "Truncate to hour", kind: "trunc", truncUnit: "hour" },
  { key: "day", label: "Truncate to day", kind: "trunc", truncUnit: "day" },
  { key: "week", label: "Truncate to week", kind: "trunc", truncUnit: "week" },
  { key: "month", label: "Truncate to month", kind: "trunc", truncUnit: "month" },
  { key: "quarter", label: "Truncate to quarter", kind: "trunc", truncUnit: "quarter" },
  { key: "year", label: "Truncate to year", kind: "trunc", truncUnit: "year" },
  { key: "hour_of_day", label: "Hour of day (0–23)", kind: "cycle", extractUnit: "HOUR" },
  { key: "day_of_week", label: "Day of week (Sun–Sat)", kind: "cycle", extractUnit: "DOW" },
  { key: "month_of_year", label: "Month of year (Jan–Dec)", kind: "cycle", extractUnit: "MONTH" },
] as const;

const BY_KEY = new Map<string, HeatmapBucket>(HEATMAP_BUCKETS.map((b) => [b.key, b]));

/** Look up a bucket; unknown or absent keys resolve to "none". */
export function getHeatmapBucket(key: unknown): HeatmapBucket {
  return BY_KEY.get(String(key ?? "none")) ?? BY_HEATMAP_NONE;
}
const BY_HEATMAP_NONE = HEATMAP_BUCKETS[0];

/** True when the bucket yields cycle positions (integers), not timestamps. */
export function isCyclicalBucket(key: unknown): boolean {
  return getHeatmapBucket(key).kind === "cycle";
}

/**
 * SQL expression for a bucketed axis column, or null when unbucketed.
 *
 * The caller aliases the result back to the raw column name
 * (`<expr> AS <col>`) so the returned row key still matches
 * config.groupByColumns and resolveHeatmapColumns keeps working unchanged.
 * GROUP BY must repeat the EXPRESSION, never the alias.
 */
export function buildBucketExpr(col: string, key: unknown): string | null {
  const bucket = getHeatmapBucket(key);
  if (bucket.kind === "trunc") return `DATE_TRUNC('${bucket.truncUnit}', ${col})`;
  if (bucket.kind === "cycle") return `EXTRACT(${bucket.extractUnit} FROM ${col})`;
  return null;
}

const DOW_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Label a cyclical bucket value.
 *
 * Only meaningful for kind "cycle" — a trunc bucket keeps the column's own date
 * format. Returns the raw string for anything unrecognised rather than
 * inventing a label, so a backend numbering us we did not expect stays visible
 * instead of being silently mislabelled.
 *
 * DOW is read as 0=Sunday (Postgres semantics). A backend returning 1-7 would
 * shift the names, so a 7 is passed through rather than wrapped to "Sun".
 */
export function formatBucketTick(value: unknown, key: unknown): string {
  const bucket = getHeatmapBucket(key);
  const raw = String(value);
  if (bucket.kind !== "cycle") return raw;
  const n = Number(value);
  if (!Number.isFinite(n)) return raw;
  switch (bucket.key) {
    case "hour_of_day":
      return n >= 0 && n <= 23 ? `${String(n).padStart(2, "0")}:00` : raw;
    case "day_of_week":
      return n >= 0 && n <= 6 ? DOW_ABBR[n] : raw;
    case "month_of_year":
      return n >= 1 && n <= 12 ? MONTH_ABBR[n - 1] : raw;
    default:
      return raw;
  }
}
