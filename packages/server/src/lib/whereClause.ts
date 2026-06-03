/**
 * Server-side WHERE clause builder for transient materialized views.
 *
 * Ported from v1.2 client-side filterStore.ts (escapeKineticaStringLiteral,
 * buildEqualityFilter). The client-side functions are slated for DELETION in
 * Phase 15 (FILT-V13-05); this server module is the replacement that lives
 * BEFORE the deletion happens — both can coexist briefly during the v1.3
 * transition.
 *
 * Equality semantics only — `=` and `IS NULL`. v1.2 was equality-only and
 * Phase 13 ports that contract verbatim. Inequality / range / IN / LIKE
 * operators are deferred to v2.
 *
 * Trust boundary on the `column` field: column names are interpolated
 * DIRECTLY into the SQL without quoting or escaping. They originate from
 * server-side table metadata (`getTable(tableId).columns`), NOT from arbitrary
 * user input — so injection risk is bounded by the admin-only table-creation
 * routes. String / datetime VALUES, by contrast, ARE always escaped via
 * escapeKineticaStringLiteral (single-quote doubling, SQL standard).
 *
 * Pure module — zero imports beyond the Node stdlib (none used here).
 * No Express, db, or kinetica.ts dependencies — keeps the unit-test
 * surface minimal and reusable across phases.
 */

/**
 * Server-side ActiveFilter type. Field-for-field parity with the Phase 44
 * client-side type at `packages/web/src/store/filterStore.ts`.
 *
 * Server type lives separately from the client type to keep the server
 * module dependency-free of any frontend imports. Shape parity is
 * intentional and contractual — the POST /api/filter/materialize endpoint
 * accepts this exact shape in the request body's `filters[]` field.
 *
 * Phase 44 (FILTER-V17-01): value union widened to carry IN arrays and
 * BETWEEN tuples; operator discriminator added. Back-compat callers omit
 * operator and pass a scalar (treated as "eq" by buildServerWhereClause).
 */
export type ActiveFilter = {
  column: string;
  value:
    | string
    | number
    | boolean
    | Date
    | null
    | (string | number)[]
    | [number, number]
    | [string, string];
  dataType: "string" | "number" | "boolean" | "datetime" | "null";
  operator?: "eq" | "in" | "between" | "isNull";
  sourceWidgetId?: number;
  addedAt: number;
};

/**
 * SQL standard string-literal escape: doubles every single quote.
 *
 * Matches v1.2 client-side `escapeKineticaStringLiteral` byte-for-byte
 * (filterStore.ts:112-114) so v1.2 chip selections produce identical SQL
 * once the FROM-swap lands in Phase 15.
 */
export function escapeKineticaStringLiteral(val: string): string {
  return val.replace(/'/g, "''");
}

/**
 * Compose a SQL WHERE-clause body from an array of filters.
 *
 * - Empty filter list returns the literal `"1=1"` fallback. Phase 15
 *   chart code should not call this with an empty array (it bypasses
 *   the materialize endpoint entirely when filters are absent), so the
 *   fallback is documented as a safe-default invariant rather than a
 *   primary code path.
 * - Each filter contributes one predicate; predicates are joined with
 *   ` AND ` (single-space-padded).
 * - Phase 44 (FILTER-V17-04): operator discriminator routes to IN / BETWEEN
 *   paths first; legacy eq-path (operator absent or "eq") preserved verbatim.
 * - dataType determines literal formatting in the eq path:
 *     string   → column = 'escaped-value'
 *     number   → column = Number(value)
 *     null     → column IS NULL
 *     boolean  → column = true | false (lowercase, Boolean(value))
 *     datetime → column = 'escaped-value' (treated as string literal)
 */
export function buildServerWhereClause(filters: ActiveFilter[]): string {
  if (filters.length === 0) return "1=1";
  return filters
    .map((f) => {
      const op = f.operator ?? "eq"; // default — legacy drill-down callers omit operator

      // ----- IN (Phase 44 FILTER-V17-04) -----
      if (op === "in") {
        // Defensive: empty array must NEVER produce `col IN ()` (invalid Kinetica SQL).
        // Widget layer is expected to skip empty IN filters before dispatch, but the
        // WHERE builder is the last line of defense — emit `1=0` (matches no rows) to keep
        // SQL valid while flagging "filter was set but empty".
        const arr = Array.isArray(f.value) ? f.value : [];
        if (arr.length === 0) return "1=0";

        // Element formatting routes by dataType:
        //   string / datetime → single-quoted, escape per element via escapeKineticaStringLiteral
        //   number            → bare Number(v)
        //   boolean / null    → not a valid IN target shape; fall back to string handling
        const elements = arr.map((v) => {
          if (f.dataType === "number") return String(Number(v));
          // string or datetime — single-quote + escape
          return `'${escapeKineticaStringLiteral(String(v))}'`;
        });
        return `${f.column} IN (${elements.join(", ")})`;
      }

      // ----- BETWEEN (Phase 44 FILTER-V17-04) -----
      if (op === "between") {
        // Expect a 2-element tuple. Defensive: anything else falls through to eq path
        // with the raw value (will produce a TS-noisy but Kinetica-valid scalar predicate).
        if (Array.isArray(f.value) && f.value.length === 2) {
          const [lo, hi] = f.value as [unknown, unknown];
          if (f.dataType === "number") {
            return `${f.column} BETWEEN ${Number(lo)} AND ${Number(hi)}`;
          }
          // datetime + string — single-quoted ISO/string literals, per-element escape.
          // (RESEARCH §B confirms Kinetica accepts single-quoted ISO strings on DATETIME cols.)
          return `${f.column} BETWEEN '${escapeKineticaStringLiteral(String(lo))}' AND '${escapeKineticaStringLiteral(String(hi))}'`;
        }
        // Fall through to eq path for malformed BETWEEN inputs (defensive — keep SQL valid).
      }

      // ----- eq / isNull / fall-through (PRESERVED VERBATIM from pre-Phase-44 path) -----
      if (f.dataType === "string") {
        return `${f.column} = '${escapeKineticaStringLiteral(String(f.value))}'`;
      }
      if (f.dataType === "number") {
        return `${f.column} = ${Number(f.value)}`;
      }
      if (f.dataType === "null") {
        return `${f.column} IS NULL`;
      }
      if (f.dataType === "boolean") {
        return `${f.column} = ${Boolean(f.value)}`;
      }
      // datetime — treat as string literal (matches v1.2 escape semantics
      // for any clickable datetime values originating from chart drill-downs)
      return `${f.column} = '${escapeKineticaStringLiteral(String(f.value))}'`;
    })
    .join(" AND ");
}
