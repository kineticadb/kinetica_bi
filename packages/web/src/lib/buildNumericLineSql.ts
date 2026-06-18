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
import { MAX_SERIES } from "./groupedSeries";

export type BuildNumericLineSqlArgs = {
  schema: string; // empty string → unprefixed FROM (filter-view name / DV-bound)
  table: string;
  xField: string; // numeric X-axis column
  binWidth: number; // > 0; from pickNumericBinWidth
  metric: NumericMetric;
  maxBuckets: number; // drives LIMIT
  /**
   * Phase 72: optional group-by column. When a non-empty string, the query splits
   * into one series per distinct value (`<groupByColumn> AS series`). Absent/empty →
   * ungrouped output BYTE-IDENTICAL to before.
   */
  groupByColumn?: string;
  /**
   * Phase 72: optional top-N series allow-list (from the top-N pre-query). When
   * provided alongside groupByColumn, the main query filters
   * `AND <groupByColumn> IN (<values>)` and scales LIMIT by the list length.
   */
  seriesIn?: (string | number)[];
};

/** COUNT_DISTINCT is not a Kinetica function — emit COUNT(DISTINCT col). */
function aggExpr(metric: NumericMetric): string {
  if (metric.aggregation === "COUNT_DISTINCT") {
    return `COUNT(DISTINCT ${metric.column})`;
  }
  return `${metric.aggregation}(${metric.column})`;
}

/** Format a seriesIn value for SQL: numbers verbatim, strings single-quoted with internal quotes doubled. */
function formatSeriesInValue(v: string | number): string {
  if (typeof v === "number") return String(v);
  return `'${v.replace(/'/g, "''")}'`;
}

/**
 * Build the full per-metric numeric-line query.
 *
 * Emitted shape (ungrouped — no groupByColumn):
 *   SELECT FLOOR(<xField> / <binWidth>) * <binWidth> AS bucket, <agg> AS value
 *   FROM <schema.table | table>
 *   WHERE <xField> IS NOT NULL
 *   GROUP BY bucket
 *   ORDER BY bucket ASC
 *   LIMIT <maxBuckets + 1>
 *
 * Emitted shape (grouped — non-empty groupByColumn, Phase 72):
 *   SELECT FLOOR(<xField> / <binWidth>) * <binWidth> AS bucket, <groupByColumn> AS series, <agg> AS value
 *   FROM <schema.table | table>
 *   WHERE <xField> IS NOT NULL AND <groupByColumn> IS NOT NULL
 *         [AND <groupByColumn> IN (<seriesIn>)]
 *   GROUP BY bucket, series
 *   ORDER BY bucket ASC
 *   LIMIT <(maxBuckets + 1) * MAX_SERIES | (maxBuckets + 1) * seriesIn.length>
 *
 * GROUP BY uses the literal alias `bucket` (matches buildTimelineSql). The ungrouped LIMIT is
 * maxBuckets + 1: the bin count is bounded by ceil(range / binWidth) ≤ maxBuckets, but
 * the boundary bucket (containing MAX(xField)) can add one more — +1 avoids clipping
 * the right edge of the chart. The grouped LIMIT scales that bucket bound by the series
 * cap (or the seriesIn count) so no series is clipped mid-range.
 */
export function buildNumericLineSql(args: BuildNumericLineSqlArgs): string {
  const { schema, table, xField, binWidth, metric, maxBuckets, groupByColumn, seriesIn } = args;
  const fromTarget = schema === "" ? table : `${schema}.${table}`;
  const bucket = `FLOOR(${xField} / ${binWidth}) * ${binWidth}`;
  const agg = aggExpr(metric);

  // Ungrouped path — kept literally identical for the byte-for-byte backward-compat lock.
  if (!groupByColumn) {
    return (
      `SELECT ${bucket} AS bucket, ${agg} AS value ` +
      `FROM ${fromTarget} ` +
      `WHERE ${xField} IS NOT NULL ` +
      `GROUP BY bucket ` +
      `ORDER BY bucket ASC ` +
      `LIMIT ${maxBuckets + 1}`
    );
  }

  // Grouped path (Phase 72): one series per distinct groupByColumn value.
  const bucketBound = maxBuckets + 1;
  const hasSeriesIn = Array.isArray(seriesIn) && seriesIn.length > 0;
  const inClause = hasSeriesIn
    ? ` AND ${groupByColumn} IN (${seriesIn!.map(formatSeriesInValue).join(", ")})`
    : "";
  const limit = hasSeriesIn ? bucketBound * seriesIn!.length : bucketBound * MAX_SERIES;
  return (
    `SELECT ${bucket} AS bucket, ${groupByColumn} AS series, ${agg} AS value ` +
    `FROM ${fromTarget} ` +
    `WHERE ${xField} IS NOT NULL AND ${groupByColumn} IS NOT NULL${inClause} ` +
    `GROUP BY bucket, series ` +
    `ORDER BY bucket ASC ` +
    `LIMIT ${limit}`
  );
}
