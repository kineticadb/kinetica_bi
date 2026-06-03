/**
 * Phase 15 (FILT-V13-01 / FILT-V13-03): FROM-swap regex helper.
 *
 * Replaces the FIRST `FROM <identifier>` in a SQL string with `FROM <viewName>`
 * when viewName is truthy. Falsy viewName → returns sql unchanged (zero-overhead
 * cold-load path; no materialize round-trip happens upstream when filters are empty).
 *
 * Strategy: regex/string-scan — mirrors Phase 9's deleted `injectWhereClause` strategy
 * (predictable two-pattern SQL shapes from ChartConfigPanel — full SQL parser is overkill).
 *
 * Identifier pattern `[\w.]+` matches schema-qualified names (`ki_home.taxi`) and
 * bare table names (`mytable`) and view names (`_kbi_filt_u1_d2_t3_sabc12345`).
 *
 * Replaces ONLY the FIRST FROM keyword (defensive — Phase 9-12 SQL has no subqueries,
 * but if Phase 16+ introduces subqueries, the first-FROM convention prevents accidental
 * inner-table replacement). Use String#replace (not String#replaceAll) for first-only.
 */

const FROM_RE = /\bFROM\s+([\w.]+)/i;

export const fromSwap = (sql: string, viewName: string | undefined | null): string => {
  if (!viewName) return sql; // FILT-V13-03: zero overhead when no view
  return sql.replace(FROM_RE, `FROM ${viewName}`);
};
