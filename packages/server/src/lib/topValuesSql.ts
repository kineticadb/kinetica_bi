/**
 * v1.7 (post-Phase-39 UAT enhancement): pure server-side SQL builder + response
 * parser for the /api/top-values endpoint backing categorical Auto-suggest in the
 * Class Break form. Mirrors lib/quantileSql.ts (the numeric counterpart).
 *
 * Returns the top-N most-frequent distinct values of a categorical column via
 * GROUP BY + COUNT(*) ORDER BY count DESC. NULLs are excluded so the returned
 * values are clean distinct strings; the <other> sink bucket (Phase 37 OQ-5)
 * captures NULL + long-tail values at render time.
 *
 * Trust boundary on `schema`, `table`, `column`: names are interpolated DIRECTLY
 * into the SQL without quoting/escaping — same boundary as quantileSql.ts. They
 * originate from server-side discovery metadata + Phase 39 form pickers, NOT from
 * arbitrary user input.
 *
 * Numeric `n` is validated by the route handler (integer in [2, 256]) BEFORE
 * calling buildTopValuesSql.
 *
 * Pure module — zero imports beyond Node stdlib.
 */

export type TopValuesSqlArgs = {
  schema: string;
  table: string;
  column: string;
  n: number;
};

/**
 * Build the top-N-distinct-values-by-frequency SQL.
 *
 * Emitted template (whitespace-normalized):
 *   SELECT <column> AS val, COUNT(*) AS cnt
 *   FROM <schema>.<table>
 *   WHERE <column> IS NOT NULL
 *   GROUP BY <column>
 *   ORDER BY cnt DESC
 *   LIMIT <n>
 */
export function buildTopValuesSql(args: TopValuesSqlArgs): string {
  const { schema, table, column, n } = args;
  // Phase 44 follow-up: dynamic-view-backed class-break layers pass a bare
  // materialized-view identifier (e.g. `_kbi_dv_uALICE_d5_7`) with an EMPTY
  // schema. Emit unprefixed FROM in that case so the query resolves against
  // the user's session schema (where Kinetica creates the materialized view).
  const fromTarget = schema === "" ? table : `${schema}.${table}`;
  return (
    `SELECT ${column} AS val, COUNT(*) AS cnt ` +
    `FROM ${fromTarget} ` +
    `WHERE ${column} IS NOT NULL ` +
    `GROUP BY ${column} ` +
    `ORDER BY cnt DESC ` +
    `LIMIT ${n}`
  );
}

/**
 * Parse Kinetica's encoded GROUP BY response and return the top distinct values
 * (column_1) as strings, in descending-frequency order.
 *
 * Kinetica encoded response shape:
 *   { column_1: (string|number)[val], column_2: number[cnt],
 *     column_headers: ["val","cnt"], column_datatypes: [...] }
 *
 * Values are coerced to strings (a categorical column may be char or numeric-coded).
 * NULL entries (shouldn't appear given the WHERE filter) are dropped defensively.
 *
 * Throws only on SHAPE-malformed responses (column_1 missing/non-array). Kinetica
 * permission/upstream errors are caught by the route handler BEFORE this runs.
 */
export function parseTopValuesResponse(kineticaResponseJson: unknown): string[] {
  if (!kineticaResponseJson || typeof kineticaResponseJson !== "object") {
    throw new Error("malformed top-values response: not an object");
  }
  const obj = kineticaResponseJson as { column_1?: unknown };
  if (!Array.isArray(obj.column_1)) {
    throw new Error("malformed top-values response: column_1 not an array");
  }
  const values: string[] = [];
  for (const v of obj.column_1 as unknown[]) {
    if (v === null || v === undefined) continue;
    values.push(String(v));
  }
  return values;
}
