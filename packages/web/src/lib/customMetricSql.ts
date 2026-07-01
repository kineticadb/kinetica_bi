/**
 * customMetricSql.ts — Phase 100 Plans 02 + 03 (METRIC-V119-04 / METRIC-V119-01/03).
 *
 * Pure helper resolving a metric selection to its SQL aggregate fragment.
 * Mirrors customWhere.ts: a pure lib that reads a store and returns a SQL fragment.
 * Zero React / Recharts imports.
 *
 * Selection contract:
 *   - Real column (metricId undefined/null) → return realAggExpr UNCHANGED (byte-identical).
 *   - Custom (metricId is a number) → return the metric's RAW expression from the store,
 *     resolved via selectMetrics(tableId). NO additional AGG() wrapper.
 *   - Orphaned custom id (metric not found in store, or tableId undefined) → null.
 *     Caller falls through to its existing empty/error state.
 *
 * Plan 03 additions: encode/decode sentinel-prefix helpers for the picker <select> value
 * space so a single controlled <select> can represent BOTH real columns ("colName") and
 * custom metrics ("cm:<id>").
 */

import { selectMetrics } from "../store/customMetricsStore";

/** A selection is custom iff it carries a numeric metricId. */
export const isCustomSelection = (metricId: number | undefined | null): metricId is number =>
  typeof metricId === "number";

// ---------------------------------------------------------------------------
// Plan 03: encode/decode + picker helpers
// ---------------------------------------------------------------------------

/** Sentinel prefix that distinguishes custom-metric option values from real column names. */
const CUSTOM_PREFIX = "cm:";

/** Encode a custom metric id into a <select> option value. */
export const encodeCustomValue = (id: number): string => `${CUSTOM_PREFIX}${id}`;

/**
 * Decode a <select> value into either a real-column or a custom-metric selection.
 * Callers use the returned `kind` discriminator to branch their onChange logic.
 */
export const decodeMetricSelection = (
  value: string,
): { kind: "real"; column: string } | { kind: "custom"; metricId: number } => {
  if (value.startsWith(CUSTOM_PREFIX)) {
    return { kind: "custom", metricId: Number(value.slice(CUSTOM_PREFIX.length)) };
  }
  return { kind: "real", column: value };
};

/**
 * Returns the <select> value to display for a stored metric selection.
 * When a custom metricId is stored, it takes precedence over the column name.
 */
export const metricSelectValue = (
  metricId: number | undefined,
  column: string,
): string => (isCustomSelection(metricId) ? encodeCustomValue(metricId) : column);

/**
 * Returns true when a stored custom metricId is orphaned (the metric was deleted
 * or the store for this table has not yet been loaded with that metric).
 * Used by pickers to render a "(deleted metric)" placeholder option.
 */
export const isOrphanedMetric = (
  metricId: number | undefined,
  tableId: number | undefined,
): boolean =>
  isCustomSelection(metricId) &&
  (tableId === undefined || !selectMetrics(tableId).some((m) => m.id === metricId));

/**
 * Resolve the SELECT aggregate fragment for a metric selection.
 *
 * - real column (metricId undefined/null) → return realAggExpr UNCHANGED (byte-identical).
 * - custom (metricId number) → return the metric's RAW expression with NO AGG wrapper,
 *   resolved live via selectMetrics(tableId) so edits flow through.
 * - orphaned custom id (not found, or tableId undefined) → null; caller falls through
 *   to its existing empty/error state.
 */
export function resolveMetricExpr(
  metricId: number | undefined | null,
  realAggExpr: string,
  tableId: number | undefined,
): string | null {
  if (!isCustomSelection(metricId)) return realAggExpr;
  if (tableId === undefined) return null;
  const found = selectMetrics(tableId).find((m) => m.id === metricId);
  return found ? found.expression : null;
}
