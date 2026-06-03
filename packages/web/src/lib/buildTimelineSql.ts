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

export type BuildTimelineSqlArgs = {
  schema: string; // empty string for DV-bound (viewName-as-table); see Phase 44 follow-up
  table: string;
  timeCol: string;
  metric: TimelineMetric;
  interval: TimelineInterval;
  maxIntervals: number; // serves as LIMIT
};

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
 * Emitted shape:
 *   SELECT <bucket> AS bucket, <agg> AS value
 *   FROM <schema.table | table>
 *   WHERE <timeCol> IS NOT NULL
 *   GROUP BY bucket
 *   ORDER BY bucket ASC
 *   LIMIT <maxIntervals>
 *
 * The GROUP BY uses the literal alias `bucket` (not the full expression) so
 * Kinetica's SQL engine references the computed column. This is the standard
 * GROUP-BY-alias pattern and matches the Recharts merge expectation downstream
 * where row data keys are `{ bucket: string; value: number | null }`.
 */
export function buildTimelineSql(args: BuildTimelineSqlArgs): string {
  const { schema, table, timeCol, metric, interval, maxIntervals } = args;
  // Phase 44 follow-up: empty schema means the table arg is a bare unprefixed
  // identifier (e.g. a dynamic view's materialized view name).
  const fromTarget = schema === "" ? table : `${schema}.${table}`;
  const bucket = buildTimelineBucket(timeCol, interval);
  const agg = aggExpr(metric);
  return (
    `SELECT ${bucket} AS bucket, ${agg} AS value ` +
    `FROM ${fromTarget} ` +
    `WHERE ${timeCol} IS NOT NULL ` +
    `GROUP BY bucket ` +
    `ORDER BY bucket ASC ` +
    `LIMIT ${maxIntervals}`
  );
}
