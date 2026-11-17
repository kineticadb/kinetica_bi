/**
 * Data Table additional metrics (`config.extraMetrics`).
 *
 * The Data Table's primary metric stays `metricColumn` / `aggregation` / `metricId` and keeps the
 * `AS value` alias, so sorting, drill-down, the AI derive step and radio overlays are unchanged.
 * Each extra metric is aliased by its POSITION in the stored array — `value_2` for index 0,
 * `value_3` for index 1, … — never by its position among the entries that happened to resolve.
 * An entry that cannot be emitted (incomplete, unsafe identifier, unknown aggregation, deleted
 * custom metric) is skipped without shifting the others, so the SQL builder, the live
 * custom-metric swap and the renderer agree on which alias belongs to which entry.
 *
 * Extra items are emitted BEFORE the primary `AS value` item: liveMetricSql anchors the primary
 * custom-metric swap on the LAST select item.
 */
import { isCustomSelection } from "./customMetricSql";
import { AGGREGATIONS } from "./aggregationLabels";
import { aggregateExpr as sharedAggregateExpr, isCountAll } from "./aggregationLabels";

export type TableExtraMetric = { column?: string; aggregation?: string; metricId?: number };

/** 1 primary + 5 extras = 6 metrics, matching the 6-column group-by ceiling. */
export const MAX_TABLE_EXTRA_METRICS = 5;

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const AGG_VALUES = new Set(AGGREGATIONS.map((a) => a.value));

export const extraMetricAlias = (index: number): string => `value_${index + 2}`;

export const isAllowedAggregation = (agg: unknown): agg is string =>
  typeof agg === "string" && AGG_VALUES.has(agg);

export const aggregateExpr = (column: string, aggregation: string): string =>
  sharedAggregateExpr(aggregation, column);

/** Normalise `config.extraMetrics` to a list of entries (non-objects become empty entries). */
export function readTableExtraMetrics(cfg: Record<string, unknown>): TableExtraMetric[] {
  if (!Array.isArray(cfg.extraMetrics)) return [];
  return (cfg.extraMetrics as unknown[]).map((el) => {
    if (el === null || typeof el !== "object" || Array.isArray(el)) return {};
    const r = el as Record<string, unknown>;
    const out: TableExtraMetric = {};
    if (typeof r.column === "string") out.column = r.column;
    if (typeof r.aggregation === "string") out.aggregation = r.aggregation;
    if (typeof r.metricId === "number") out.metricId = r.metricId;
    return out;
  });
}

/**
 * The SQL expression for one entry, or null when it cannot be emitted. Real columns are
 * re-validated here (identifier + aggregation allow-list) so a config that did not come from the
 * panel's dropdowns can never inject SQL.
 */
export function extraMetricExpr(
  m: TableExtraMetric,
  resolveCustom: (metricId: number) => string | null,
): string | null {
  if (isCustomSelection(m.metricId)) {
    const expr = resolveCustom(m.metricId);
    return expr && expr.trim() !== "" ? expr : null;
  }
  if (isCountAll(m.aggregation)) return "COUNT(*)"; // counts rows; any column is ignored
  if (!m.column || !IDENT.test(m.column) || !isAllowedAggregation(m.aggregation)) return null;
  return aggregateExpr(m.column, m.aggregation);
}

/** `"<expr> AS value_2, <expr> AS value_3, "` (trailing comma-space) or `""` when none emit. */
export function buildExtraMetricSelect(
  cfg: Record<string, unknown>,
  resolveCustom: (metricId: number) => string | null,
): string {
  return readTableExtraMetrics(cfg)
    .map((m, i) => {
      const expr = extraMetricExpr(m, resolveCustom);
      return expr ? `${expr} AS ${extraMetricAlias(i)}, ` : "";
    })
    .join("");
}

/** Column header for an entry: `AGG(col)`, the custom metric's label, or the alias as a fallback. */
export function extraMetricHeader(m: TableExtraMetric, index: number, customLabel?: string): string {
  if (isCustomSelection(m.metricId)) return customLabel || extraMetricAlias(index);
  if (isCountAll(m.aggregation)) return "COUNT(*)";
  if (m.column && m.aggregation) return aggregateExpr(m.column, m.aggregation);
  return extraMetricAlias(index);
}
