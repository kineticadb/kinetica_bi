/**
 * Phase 45 Plan 01 (TIMELINE-V17-04, TIMELINE-V17-10): pure auto-bin helpers.
 *
 * Zero React/Recharts/Zustand imports. Consumed by:
 *   - Plan 45-02 TimelineConfigPanel.tsx (TimelineMetric/TimelineAggregation types + DEFAULT_MAX_INTERVALS)
 *   - Plan 45-03 TimelineRenderer.tsx (pickInterval + buildTimelineBucket + buildTimelineRangeQuery)
 *
 * CRITICAL GOTCHA (RESEARCH.md §C-01): columnStatsFn cannot be used for datetime
 * time-range fetch — its parser asserts Number.isFinite(v) but Kinetica returns
 * MIN/MAX as date strings for datetime columns. Use buildTimelineRangeQuery's
 * EXTRACT(EPOCH FROM ...) SQL via runSql instead.
 */

export type TimelineAggregation =
  | "SUM"
  | "AVG"
  | "MIN"
  | "MAX"
  | "COUNT"
  | "COUNT_DISTINCT"
  | "STDDEV"
  | "VARIANCE";

export type TimelineMetric = {
  column: string;
  aggregation: TimelineAggregation;
  color: string; // 8-char AARRGGBB (e.g. "FF66C2A5")
  label?: string;
  /**
   * Phase 100 (METRIC-V119-04): opaque custom-metric id marker.
   * Absent (undefined) = real column — byte-identical SQL emission.
   * Present (number) = custom metric — raw expression emitted with NO AGG wrapper.
   * NumericMetric inherits this field automatically (re-export as NumericMetric).
   */
  metricId?: number;
};

export type TimelineInterval = {
  key:
    | "year"
    | "quarter"
    | "month"
    | "week"
    | "day"
    | "12h"
    | "6h"
    | "hour"
    | "30min"
    | "15min"
    | "5min"
    | "minute";
  ms: number;
  dateTrunc: string | null;
  epochFloor?: number;
};

export const DEFAULT_MAX_INTERVALS = 500;

// Coarsest → finest. Walk in array order; return first interval where
// ceil(rangeMs / intervalMs) ≤ maxIntervals.
//
// dateTrunc is non-null for Kinetica-native DATE_TRUNC intervals.
// dateTrunc is null for sub-hour multi-unit intervals that require the
// FLOOR-epoch fallback: TO_TIMESTAMP(FLOOR(EXTRACT(EPOCH FROM col) / N) * N).
// Per CONTEXT.md §Post-research decisions 2026-05-29.
export const INTERVAL_LADDER: readonly TimelineInterval[] = [
  { key: "year",    ms: 31_536_000_000, dateTrunc: "year"    },
  { key: "quarter", ms:  7_889_400_000, dateTrunc: "quarter" },
  { key: "month",   ms:  2_628_000_000, dateTrunc: "month"   },
  { key: "week",    ms:    604_800_000, dateTrunc: "week"    },
  { key: "day",     ms:     86_400_000, dateTrunc: "day"     },
  { key: "12h",     ms:     43_200_000, dateTrunc: null, epochFloor: 43_200 },
  { key: "6h",      ms:     21_600_000, dateTrunc: null, epochFloor: 21_600 },
  { key: "hour",    ms:      3_600_000, dateTrunc: "hour"    },
  { key: "30min",   ms:      1_800_000, dateTrunc: null, epochFloor: 1_800  },
  { key: "15min",   ms:        900_000, dateTrunc: null, epochFloor:   900  },
  { key: "5min",    ms:        300_000, dateTrunc: null, epochFloor:   300  },
  { key: "minute",  ms:         60_000, dateTrunc: "minute"  },
] as const;

/**
 * Auto-bin: scan DATE_TRUNC-native intervals (dateTrunc !== null) coarsest → finest.
 * Track the last entry where ceil(rangeMs / I.ms) ≤ maxIntervals. Return that entry.
 *
 * Sub-hour FLOOR-epoch intervals (12h, 6h, 30min, 15min, 5min) are included in
 * INTERVAL_LADDER for use by buildTimelineBucket / buildTimelineSql but are NOT
 * auto-selected by pickInterval — they require explicit operator override or a
 * future per-widget precision setting.
 *
 * Fallback: if no DATE_TRUNC entry satisfies the constraint, return the finest
 * interval (minute). This guarantees the function always returns a valid interval.
 *
 * Example results with maxIntervals=200:
 *   5-year range  → "month"  (60 buckets — finest DATE_TRUNC entry ≤ 200)
 *   1-day range   → "hour"   (24 buckets)
 *   1-hour range  → "minute" (60 buckets)
 *   0-ms range    → "minute" (finest fallback for degenerate ranges)
 */
export function pickInterval(args: {
  rangeMs: number;
  maxIntervals: number;
}): TimelineInterval {
  const { rangeMs, maxIntervals } = args;
  let best: TimelineInterval | undefined;
  for (const interval of INTERVAL_LADDER) {
    // Only consider DATE_TRUNC-native intervals for auto-selection.
    if (interval.dateTrunc === null) continue;
    if (Math.ceil(rangeMs / interval.ms) <= maxIntervals) {
      best = interval; // walk coarsest→finest; last match = finest that fits
    }
  }
  if (best !== undefined) return best;
  // No DATE_TRUNC entry satisfies — fall through to finest (minute).
  return INTERVAL_LADDER[INTERVAL_LADDER.length - 1];
}

/**
 * Build the GROUP BY bucket expression for a given interval.
 *
 * - dateTrunc non-null → DATE_TRUNC('<dateTrunc>', <timeCol>)
 * - dateTrunc null     → TO_TIMESTAMP(FLOOR(EXTRACT(EPOCH FROM <timeCol>) / N) * N)
 *   where N = epochFloor (seconds).
 *
 * The FLOOR-epoch fallback handles sub-hour multi-unit intervals (12h, 6h, 30min,
 * 15min, 5min) that Kinetica's DATE_TRUNC does not natively support as multiplied
 * units. Locked in CONTEXT.md §Post-research decisions 2026-05-29.
 */
export function buildTimelineBucket(
  timeCol: string,
  interval: TimelineInterval,
): string {
  if (interval.dateTrunc) {
    return `DATE_TRUNC('${interval.dateTrunc}', ${timeCol})`;
  }
  // FLOOR-epoch fallback for sub-hour multi-unit intervals.
  const epochSec = interval.epochFloor!;
  return `TO_TIMESTAMP(FLOOR(EXTRACT(EPOCH FROM ${timeCol}) / ${epochSec}) * ${epochSec})`;
}

/**
 * Build the one-shot time-range probe SQL.
 *
 * Returns epoch seconds as AS lo / AS hi so the renderer can feed the numeric
 * values directly into pickInterval(rangeMs = (hi - lo) * 1000, maxIntervals).
 *
 * CRITICAL: columnStatsFn CANNOT be used for datetime columns — its parser
 * asserts Number.isFinite(v) but Kinetica returns datetime MIN/MAX as date
 * strings. This dedicated query is the solution (RESEARCH.md §D + CONTEXT.md
 * §Post-research decisions 2026-05-29).
 *
 * Empty-schema (DV-bound) → unprefixed FROM. Mirrors Phase 44 follow-up pattern
 * in columnStatsSql.ts:39.
 */
export function buildTimelineRangeQuery(args: {
  schema: string;
  table: string;
  timeCol: string;
}): string {
  const { schema, table, timeCol } = args;
  // Phase 44 follow-up: empty schema means the table arg is a bare unprefixed
  // identifier (e.g. a dynamic view's materialized view name like `_kbi_dv_...`).
  const fromTarget = schema === "" ? table : `${schema}.${table}`;
  return (
    `SELECT EXTRACT(EPOCH FROM MIN(${timeCol})) AS lo, ` +
    `EXTRACT(EPOCH FROM MAX(${timeCol})) AS hi ` +
    `FROM ${fromTarget} ` +
    `WHERE ${timeCol} IS NOT NULL`
  );
}

export type TimelineIntervalKey = TimelineInterval["key"];

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * Format a bucket label for the X-axis at a granularity matched to the chosen
 * interval, so a multi-year view shows "2009" while a minute view shows "14:30"
 * instead of every tick reading the full "2009-02-22 00:00:00.000".
 *
 * Bucket strings come from Kinetica DATE_TRUNC / TO_TIMESTAMP as wall-clock
 * timestamps ("YYYY-MM-DD HH:MM:SS.sss", date/time parts optional). Parsed by
 * regex — NOT `new Date(str)` — to avoid timezone shifts on the wall-clock value.
 * Falls back to the raw string when it doesn't match the expected shape.
 */
export function formatTimelineTick(bucket: string, intervalKey: TimelineIntervalKey): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(bucket);
  if (!m) return bucket;
  const year = m[1];
  const monthIdx = Number(m[2]) - 1; // 0-based
  const day = Number(m[3]);
  const hh = m[4] ?? "00";
  const mm = m[5] ?? "00";
  const mon = MONTH_ABBR[monthIdx] ?? m[2];

  switch (intervalKey) {
    case "year":
      return year;
    case "quarter":
      return `${year} Q${Math.floor(monthIdx / 3) + 1}`;
    case "month":
      return `${year}-${m[2]}`;
    case "week":
    case "day":
      return `${mon} ${day}`;
    case "12h":
    case "6h":
    case "hour":
      return `${mon} ${day} ${hh}:00`;
    case "30min":
    case "15min":
    case "5min":
    case "minute":
      return `${hh}:${mm}`;
    default:
      return bucket;
  }
}
