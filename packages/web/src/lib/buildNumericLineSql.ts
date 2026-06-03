/**
 * buildNumericLineSql.ts — pure SQL builder for one Numeric Line metric.
 *
 * Numeric analog of buildTimelineSql.ts. NumericLineRenderer issues N parallel
 * runSql() calls (one per metric) and merges the result arrays on the `bucket` column.
 *
 * Bucket expression: FLOOR(<xField> / <binWidth>) * <binWidth> — maps each row to the
 * start value of its bin. binWidth comes from pickNumericBinWidth (a nice 1/2/5×10ⁿ).
 *
 * Empty-schema (schema === "") → unprefixed FROM target (filter-view name / DV-bound),
 * mirroring buildTimelineSql.
 *
 * Zero React/Recharts/Zustand imports.
 */

import type { NumericMetric } from "./numericBin";

export type BuildNumericLineSqlArgs = {
  schema: string; // empty string → unprefixed FROM (filter-view name / DV-bound)
  table: string;
  xField: string; // numeric X-axis column
  binWidth: number; // > 0; from pickNumericBinWidth
  metric: NumericMetric;
  maxBuckets: number; // drives LIMIT
};

/** COUNT_DISTINCT is not a Kinetica function — emit COUNT(DISTINCT col). */
function aggExpr(metric: NumericMetric): string {
  if (metric.aggregation === "COUNT_DISTINCT") {
    return `COUNT(DISTINCT ${metric.column})`;
  }
  return `${metric.aggregation}(${metric.column})`;
}

/**
 * Build the full per-metric numeric-line query.
 *
 * Emitted shape:
 *   SELECT FLOOR(<xField> / <binWidth>) * <binWidth> AS bucket, <agg> AS value
 *   FROM <schema.table | table>
 *   WHERE <xField> IS NOT NULL
 *   GROUP BY bucket
 *   ORDER BY bucket ASC
 *   LIMIT <maxBuckets + 1>
 *
 * GROUP BY uses the literal alias `bucket` (matches buildTimelineSql). The LIMIT is
 * maxBuckets + 1: the bin count is bounded by ceil(range / binWidth) ≤ maxBuckets, but
 * the boundary bucket (containing MAX(xField)) can add one more — +1 avoids clipping
 * the right edge of the chart.
 */
export function buildNumericLineSql(args: BuildNumericLineSqlArgs): string {
  const { schema, table, xField, binWidth, metric, maxBuckets } = args;
  const fromTarget = schema === "" ? table : `${schema}.${table}`;
  const bucket = `FLOOR(${xField} / ${binWidth}) * ${binWidth}`;
  const agg = aggExpr(metric);
  return (
    `SELECT ${bucket} AS bucket, ${agg} AS value ` +
    `FROM ${fromTarget} ` +
    `WHERE ${xField} IS NOT NULL ` +
    `GROUP BY bucket ` +
    `ORDER BY bucket ASC ` +
    `LIMIT ${maxBuckets + 1}`
  );
}
