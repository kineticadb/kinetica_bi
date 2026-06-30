/**
 * Phase 45 Plan 01 (TIMELINE-V17-05): pure SQL builder for one timeline metric.
 *
 * Plan 45-03 TimelineRenderer issues N parallel runSql() calls (one per metric)
 * and merges the result arrays on the `bucket` column.
 *
 * Empty-schema (schema === "") → unprefixed FROM target. Required for DV-bound
 * widgets (Phase 44 follow-up; mirrors columnStatsSql.ts:39 pattern).
 *
 * Zero React/Recharts/Zustand imports. Consumed by Plan 45-03 TimelineRenderer.tsx.
 */

import type { TimelineInterval, TimelineMetric } from "./timelineBin";
import { buildTimelineBucket } from "./timelineBin";
import { MAX_SERIES } from "./groupedSeries";
import { andCustomWhere } from "./customWhere";

export type BuildTimelineSqlArgs = {
  schema: string; // empty string for DV-bound (viewName-as-table); see Phase 44 follow-up
  table: string;
  timeCol: string;
  metric: TimelineMetric;
  interval: TimelineInterval;
  maxIntervals: number; // serves as LIMIT
  /**
   * Phase 72: optional group-by column. When a non-empty string, the query splits
   * into one series per distinct value (`<groupByColumn> AS series`) instead of the
   * single per-metric line. Absent/empty → ungrouped output BYTE-IDENTICAL to before.
   */
  groupByColumn?: string;
  /**
   * Phase 72: optional top-N series allow-list (from the top-N pre-query). When
   * provided alongside groupByColumn, the main query filters
   * `AND <groupByColumn> IN (<values>)` and scales LIMIT by the list length so no
   * selected series is clipped mid-range.
   */
  seriesIn?: (string | number)[];
  /**
   * Phase 98 (VIZSQL-V119-02): raw-SQL predicate ANDed after the existing IS-NOT-NULL
   * clause; absent/empty → byte-identical output (VIZSQL-V119-03).
   */
  customWhere?: string;
};

/** Format a seriesIn value for SQL: numbers verbatim, strings single-quoted with internal quotes doubled. */
function formatSeriesInValue(v: string | number): string {
  if (typeof v === "number") return String(v);
  return `'${v.replace(/'/g, "''")}'`;
}

/**
 * Build the aggregation expression for a single metric.
 * COUNT_DISTINCT is NOT a Kinetica function — use COUNT(DISTINCT col) instead.
 */
function aggExpr(metric: TimelineMetric): string {
  if (metric.aggregation === "COUNT_DISTINCT") {
    return `COUNT(DISTINCT ${metric.column})`;
  }
  return `${metric.aggregation}(${metric.column})`;
}

/**
 * Build the full per-metric timeline query.
 *
 * Emitted shape (ungrouped — no groupByColumn):
 *   SELECT <bucket> AS bucket, <agg> AS value
 *   FROM <schema.table | table>
 *   WHERE <timeCol> IS NOT NULL
 *   GROUP BY bucket
 *   ORDER BY bucket ASC
 *   LIMIT <maxIntervals>
 *
 * Emitted shape (grouped — non-empty groupByColumn, Phase 72):
 *   SELECT <bucket> AS bucket, <groupByColumn> AS series, <agg> AS value
 *   FROM <schema.table | table>
 *   WHERE <timeCol> IS NOT NULL AND <groupByColumn> IS NOT NULL
 *         [AND <groupByColumn> IN (<seriesIn>)]
 *   GROUP BY bucket, series
 *   ORDER BY bucket ASC
 *   LIMIT <maxIntervals * MAX_SERIES | maxIntervals * seriesIn.length>
 *
 * The GROUP BY uses the literal alias `bucket` (not the full expression) so
 * Kinetica's SQL engine references the computed column. This is the standard
 * GROUP-BY-alias pattern and matches the Recharts merge expectation downstream
 * where row data keys are `{ bucket: string; value: number | null }`.
 */
export function buildTimelineSql(args: BuildTimelineSqlArgs): string {
  const { schema, table, timeCol, metric, interval, maxIntervals, groupByColumn, seriesIn, customWhere } = args;
  // Phase 44 follow-up: empty schema means the table arg is a bare unprefixed
  // identifier (e.g. a dynamic view's materialized view name).
  const fromTarget = schema === "" ? table : `${schema}.${table}`;
  const bucket = buildTimelineBucket(timeCol, interval);
  const agg = aggExpr(metric);
  // Phase 98: compute once; returns "" when absent/empty (byte-identical no-op).
  const cw = andCustomWhere(customWhere);

  // Ungrouped path — kept literally identical for the byte-for-byte backward-compat lock.
  if (!groupByColumn) {
    return (
      `SELECT ${bucket} AS bucket, ${agg} AS value ` +
      `FROM ${fromTarget} ` +
      `WHERE ${timeCol} IS NOT NULL${cw} ` +
      `GROUP BY bucket ` +
      `ORDER BY bucket ASC ` +
      `LIMIT ${maxIntervals}`
    );
  }

  // Grouped path (Phase 72): one series per distinct groupByColumn value.
  const hasSeriesIn = Array.isArray(seriesIn) && seriesIn.length > 0;
  const inClause = hasSeriesIn
    ? ` AND ${groupByColumn} IN (${seriesIn!.map(formatSeriesInValue).join(", ")})`
    : "";
  const limit = hasSeriesIn ? maxIntervals * seriesIn!.length : maxIntervals * MAX_SERIES;
  return (
    `SELECT ${bucket} AS bucket, ${groupByColumn} AS series, ${agg} AS value ` +
    `FROM ${fromTarget} ` +
    `WHERE ${timeCol} IS NOT NULL AND ${groupByColumn} IS NOT NULL${inClause}${cw} ` +
    `GROUP BY bucket, series ` +
    `ORDER BY bucket ASC ` +
    `LIMIT ${limit}`
  );
}
