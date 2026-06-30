/**
 * customWhere.ts — shared pure helper for splicing a user-supplied raw-SQL
 * WHERE predicate into a query fragment.
 *
 * Rules:
 *   - Parenthesization is MANDATORY: mixed AND/OR predicates must bind correctly.
 *   - NO client-side parsing or escaping — raw SQL is trusted per VIZSQL out-of-scope.
 *   - Empty / absent / whitespace-only predicate → returns "" (byte-identical no-op).
 *
 * These two functions are the SINGLE source of truth for the parenthesization rule
 * used by ALL injection sites across plans 98-01 / 98-02 / 98-03.
 *
 * Zero React / Recharts / Zustand / network imports.
 */

/**
 * Returns ` AND (<predicate>)` (with leading space) for a non-empty trimmed predicate.
 * Returns "" for undefined / "" / whitespace-only input (byte-identical no-op).
 *
 * Used by own-SQL builders that already emit a `WHERE ... IS NOT NULL` clause:
 * buildTimelineSql, buildNumericLineSql, buildCalendarSql.
 */
export function andCustomWhere(customWhere?: string): string {
  const p = (customWhere ?? "").trim();
  return p ? ` AND (${p})` : "";
}

/**
 * Returns ` WHERE (<predicate>)` (with leading space) for a non-empty trimmed predicate.
 * Returns "" for undefined / "" / whitespace-only input (byte-identical no-op).
 *
 * Used by the no-existing-WHERE paths in plan 98-02 (aggregated widgets, records table).
 */
export function whereCustomWhere(customWhere?: string): string {
  const p = (customWhere ?? "").trim();
  return p ? ` WHERE (${p})` : "";
}
