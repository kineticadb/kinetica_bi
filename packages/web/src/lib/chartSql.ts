/**
 * Pure widget-SQL generator. Extracted verbatim from ChartConfigPanel's generatedSql useMemo so
 * the config panel and the AI path (deriveChartConfig) share ONE generator and cannot diverge.
 * No store reads: the series cap and the custom-metric resolver are parameters.
 */
import { whereCustomWhere } from "./customWhere";
import { isMultiColumnBarGroupBy } from "./barGroupedSeries";
import { HEATMAP_CELL_LIMIT } from "./heatmapGrid";
import { buildBucketExpr } from "./heatmapBucket";
import { inferDataTypeFromColumn } from "./columnTypes";
import { isCustomSelection } from "./customMetricSql";
import type { AiWidgetType } from "@kinetica-bi/shared";
import { AI_WIDGET_DEFAULTS } from "./aiWidgetDefaults";

/**
 * Heatmap "Result limit" ladder: a heatmap row is one (x,y) INTERSECTION, so it gets its own
 * ladder defaulting to the cap (live UAT finding preserved from ChartConfigPanel).
 */
export const HEATMAP_LIMITS = [250, 500, 1000, 2500, HEATMAP_CELL_LIMIT];

export type ChartSqlInput = {
  widgetType: string;
  table: string;
  tableId?: number;
  draft: Record<string, unknown>;
  flags: { usesAggregation: boolean; requiresGroupBy: boolean };
  columnTypeMap: Record<string, string>;
  maxBarGroupBySeriesCap: number;
  resolveMetricExpr: (
    metricId: number | undefined,
    fallback: string,
    tableId: number | undefined,
  ) => string | null;
};

export function buildChartSql(i: ChartSqlInput): string {
  const { draft, columnTypeMap, maxBarGroupBySeriesCap, resolveMetricExpr } = i;
  const { usesAggregation, requiresGroupBy } = i.flags;
  const isBar = i.widgetType === "bar";
  const isLine = i.widgetType === "line";
  const isHeatmap = i.widgetType === "heatmap";
  const table = i.table;
  {
    if (!table) return "";

    // Phase 98-02 (VIZSQL-V119-02): compute WHERE clause for non-empty customWhere.
    // whereCustomWhere returns ' WHERE (<predicate>)' or '' for empty/absent — byte-identical.
    const cw = whereCustomWhere(draft.customWhere as string | undefined);

    // Records-table style: SELECT [cols] FROM table ORDER BY sortField DIR
    // (pagination LIMIT/OFFSET applied at render time, not stored in widget config)
    if (!usesAggregation) {
      const colsRaw = ((draft.columns as string) || "").split(",").map((c) => c.trim()).filter(Boolean);
      const safeCols = colsRaw.filter((c) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(c));
      const colsClause = safeCols.length > 0 ? safeCols.join(", ") : "*";
      const sortField = (draft.sortField as string) || "";
      const sortDir = ((draft.sortDirection as string) || "asc").toUpperCase() === "DESC" ? "DESC" : "ASC";
      const orderBy = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(sortField) ? ` ORDER BY ${sortField} ${sortDir}` : "";
      return `SELECT ${colsClause} FROM ${table}${cw}${orderBy}`;
    }

    // Aggregated chart style
    const metricColumn = draft.metricColumn as string;
    const aggregation = draft.aggregation as string;
    const groupByColumn = draft.groupByColumn as string;

    // Phase 100 (METRIC-V119-04): resolve the metric expression for both variants.
    // metricId is set by Plan 03's picker; absent → real-column path (byte-identical).
    const metricId = draft.metricId as number | undefined;
    const tableId = i.tableId;
    const customMode = isCustomSelection(metricId);

    // Scalar variant (bignumber): SELECT AGG(metric) AS value FROM table — no GROUP BY.
    // Requires metricColumn + aggregation only (real); or a resolved custom expression.
    if (!requiresGroupBy) {
      if (customMode) {
        // Custom selection: resolve from store; fall back to placeholder if orphaned.
        const metricExpr = resolveMetricExpr(metricId, "", tableId);
        if (!metricExpr) return `SELECT * FROM ${table} LIMIT 100`;
        return `SELECT ${metricExpr} AS value FROM ${table}${cw}`;
      }
      if (!metricColumn || !aggregation) {
        return `SELECT * FROM ${table} LIMIT 100`;
      }
      const aggExpr = aggregation === "COUNT_DISTINCT"
        ? `COUNT(DISTINCT ${metricColumn})`
        : `${aggregation}(${metricColumn})`;
      return `SELECT ${aggExpr} AS value FROM ${table}${cw}`;
    }

    // Grouped variant (bar / line / pie / scatter / table):
    // SELECT groupBy, AGG(metric) AS value FROM table GROUP BY groupBy ORDER BY value DESC

    // Phase 102 (BARGRP-V119-01): multi-column GROUP BY for bar charts.
    // Guard: isMultiColumnBarGroupBy checks Array.isArray(groupByColumns) && length >= 2.
    // When false, execution falls through to the EXISTING single-column branches unchanged
    // — that is the byte-identical backward-compat path (BARGRP-V119-04).
    if (isMultiColumnBarGroupBy(draft)) {
      const cols = (draft.groupByColumns as string[]).filter(Boolean);
      const colsClause = cols.join(", ");
      // Metric expr: reuse the SAME resolution as the single-column path (custom vs real).
      const multiMetricExpr = customMode
        ? resolveMetricExpr(metricId, "", tableId)
        : (aggregation === "COUNT_DISTINCT" ? `COUNT(DISTINCT ${metricColumn})` : `${aggregation}(${metricColumn})`);
      if (!colsClause || !multiMetricExpr || (!customMode && (!metricColumn || !aggregation))) {
        return `SELECT * FROM ${table} LIMIT 100`;
      }
      const multiSortDir = ((draft.sortDir as string) || "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC";
      const ALLOWED_LIMITS_M = [5, 10, 25, 50, 100, 250, 500];
      const rawLimitM = Number(draft.limit);
      const baseLimit = ALLOWED_LIMITS_M.includes(rawLimitM) ? rawLimitM : 100;
      // Bar expands categories × series so it needs a generous LIMIT (config.limit ×
      // maxBarGroupBySeriesCap × 2, read from auth store at save time). The Data Table renders
      // one row per group tuple, so it just uses the plain "Result limit".
      // A heatmap needs one row per (x,y) INTERSECTION, so it validates the
      // operator's choice against its OWN ladder (which defaults to the cap)
      // rather than the shared group ladder. ORDER BY value DESC is retained so
      // an over-cap grid keeps its hottest cells; AggregatedWidgetRenderer bumps this
      // trailing LIMIT by one at fetch time to detect real truncation (Phase 127),
      // so it must stay the LAST clause.
      const heatmapLimit = HEATMAP_LIMITS.includes(rawLimitM)
        ? rawLimitM
        : HEATMAP_CELL_LIMIT;
      // Phase 132: a multi-series line expands categories x series like bar (else it is starved at
      // LIMIT 100 and shows false gaps). Only with >= 2 NON-BLANK columns: ["region", ""] stays
      // the byte-identical single-column SQL.
      const sqlLimit = (isBar || (isLine && cols.length >= 2))
        ? baseLimit * maxBarGroupBySeriesCap * 2
        : isHeatmap
          ? heatmapLimit
          : baseLimit;
      // Heatmap axis bucketing: a raw timestamp axis makes every instant its own
      // one-cell row. Each axis column may carry a bucket, applied ONLY when the
      // column is actually temporal — a bucket left set after switching to a text
      // column must not emit DATE_TRUNC over a string. The expression is aliased
      // back to the raw column name so the row key still matches
      // config.groupByColumns; GROUP BY repeats the EXPRESSION, never the alias.
      if (isHeatmap) {
        const bucketKeys = [draft.xBucket, draft.yBucket];
        const selectParts: string[] = [];
        const groupParts: string[] = [];
        cols.forEach((col, idx) => {
          const isTemporal =
            inferDataTypeFromColumn(col, columnTypeMap) === "datetime";
          const expr = isTemporal ? buildBucketExpr(col, bucketKeys[idx]) : null;
          selectParts.push(expr ? `${expr} AS ${col}` : col);
          groupParts.push(expr ?? col);
        });
        return (
          `SELECT ${selectParts.join(", ")}, ${multiMetricExpr} AS value ` +
          `FROM ${table}${cw} GROUP BY ${groupParts.join(", ")} ` +
          `ORDER BY value ${multiSortDir} LIMIT ${sqlLimit}`
        );
      }
      // GROUP BY uses real column names — NEVER the "value" alias (RESEARCH Pitfall 1).
      return `SELECT ${colsClause}, ${multiMetricExpr} AS value FROM ${table}${cw} GROUP BY ${colsClause} ORDER BY value ${multiSortDir} LIMIT ${sqlLimit}`;
    }

    if (customMode) {
      // Custom selection: groupByColumn still required; metricExpr from store.
      if (!groupByColumn) return `SELECT * FROM ${table} LIMIT 100`;
      const metricExpr = resolveMetricExpr(metricId, "", tableId);
      if (!metricExpr) return `SELECT * FROM ${table} LIMIT 100`;
      const groupSortDirC = ((draft.sortDir as string) || "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC";
      const ALLOWED_LIMITS_C = [5, 10, 25, 50, 100, 250, 500];
      const rawLimitC = Number(draft.limit);
      const groupLimitC = ALLOWED_LIMITS_C.includes(rawLimitC) ? rawLimitC : 100;
      return `SELECT ${groupByColumn}, ${metricExpr} AS value FROM ${table}${cw} GROUP BY ${groupByColumn} ORDER BY value ${groupSortDirC} LIMIT ${groupLimitC}`;
    }
    if (!metricColumn || !aggregation || !groupByColumn) {
      return `SELECT * FROM ${table} LIMIT 100`;
    }
    const aggExpr = aggregation === "COUNT_DISTINCT"
      ? `COUNT(DISTINCT ${metricColumn})`
      : `${aggregation}(${metricColumn})`;
    // Operator-configurable sort direction + result limit (defaults DESC / 100).
    const groupSortDir = ((draft.sortDir as string) || "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC";
    const ALLOWED_LIMITS = [5, 10, 25, 50, 100, 250, 500];
    const rawLimit = Number(draft.limit);
    const groupLimit = ALLOWED_LIMITS.includes(rawLimit) ? rawLimit : 100;
    return `SELECT ${groupByColumn}, ${aggExpr} AS value FROM ${table}${cw} GROUP BY ${groupByColumn} ORDER BY value ${groupSortDir} LIMIT ${groupLimit}`;
  }
}

// --- AI / radio derive step -------------------------------------------------------------

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;
const DERIVE_AGGREGATIONS = new Set([
  "SUM", "AVG", "MIN", "MAX", "COUNT", "COUNT_DISTINCT", "STDDEV", "VARIANCE",
]);

const DERIVE_TYPES = new Set(["bar", "line", "pie", "table", "bignumber"]);

/**
 * Regenerate sql / drillDownColumn / drillDownColumnType from structured fields, exactly as the
 * config panel's Apply does. Returns null on any unsafe identifier, disallowed aggregation, bad
 * table name, or a type that has no derive step. The AI never supplies SQL (D-01/D-23).
 */
export function deriveChartConfig(
  type: string,
  cfg: Record<string, unknown>,
  ctx: {
    tableName: string;
    tableColumns: Record<string, string>;
    maxBarGroupBySeriesCap: number;
    resolveMetricExpr?: ChartSqlInput["resolveMetricExpr"];
  },
): { sql: string; drillDownColumn: string; drillDownColumnType: string } | null {
  if (!DERIVE_TYPES.has(type)) return null;
  const flags = AI_WIDGET_DEFAULTS[type as AiWidgetType].flags;
  if (typeof ctx.tableName !== "string" || !TABLE_NAME.test(ctx.tableName)) return null;

  const idents: unknown[] = [];
  if (cfg.metricColumn !== undefined && cfg.metricColumn !== "") idents.push(cfg.metricColumn);
  if (cfg.groupByColumn !== undefined && cfg.groupByColumn !== "") idents.push(cfg.groupByColumn);
  if (cfg.groupByColumns !== undefined) {
    if (!Array.isArray(cfg.groupByColumns)) return null;
    for (const c of cfg.groupByColumns) if (c !== "") idents.push(c);
  }
  for (const v of idents) if (typeof v !== "string" || !IDENT.test(v)) return null;
  if (cfg.aggregation !== undefined && cfg.aggregation !== "") {
    if (typeof cfg.aggregation !== "string" || !DERIVE_AGGREGATIONS.has(cfg.aggregation)) return null;
  }

  const sql = buildChartSql({
    widgetType: type,
    table: ctx.tableName,
    draft: cfg,
    flags,
    columnTypeMap: ctx.tableColumns,
    maxBarGroupBySeriesCap: ctx.maxBarGroupBySeriesCap,
    resolveMetricExpr: ctx.resolveMetricExpr ?? ((id, fallback) => (id === undefined ? fallback : null)),
  });

  // Drill follows group-by for aggregated category charts (ChartConfigPanel drillFollowsGroupBy);
  // a scalar type (bignumber) does not support drill-down.
  const groupCols = Array.isArray(cfg.groupByColumns) ? (cfg.groupByColumns as string[]).filter(Boolean) : [];
  const drillDownColumn = flags.requiresGroupBy ? ((cfg.groupByColumn as string) || groupCols[0] || "") : "";
  const drillDownColumnType = drillDownColumn
    ? inferDataTypeFromColumn(drillDownColumn, ctx.tableColumns)
    : "null";
  return { sql, drillDownColumn, drillDownColumnType };
}
