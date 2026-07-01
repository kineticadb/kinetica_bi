/**
 * customMetricSql.ts — Phase 100 Plan 02 (METRIC-V119-04).
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
 */

import { selectMetrics } from "../store/customMetricsStore";

/** A selection is custom iff it carries a numeric metricId. */
export const isCustomSelection = (metricId: number | undefined | null): metricId is number =>
  typeof metricId === "number";

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
