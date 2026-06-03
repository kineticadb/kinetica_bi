/**
 * v1.7 Phase 38 (SCHEMA-V17-06): pure server-side SQL builder + response parser
 * for the /api/quantile endpoint backing Phase 39 Auto-suggest classbreak
 * boundaries.
 *
 * Trust boundary on `schema`, `table`, `column`: names are interpolated DIRECTLY
 * into the SQL without quoting or escaping. They originate from server-side
 * table metadata (admin-only sources) and Phase 39 form pickers populated from
 * the discovery endpoint — NOT from arbitrary user input. Mirrors the equivalent
 * boundary documented in `lib/spatialQuery.ts`.
 *
 * Numeric `n` is typed and validated by the route handler in `index.ts` BEFORE
 * calling buildQuantileSql (n integer in [2, 256] per 38-CONTEXT.md).
 *
 * NTILE template locked verbatim from
 * .planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md ## Decision lines 287-294
 * (PASS HTTP 200 against deployed Kinetica with `PARTITION BY 0` form).
 *
 * Pure module — zero imports beyond Node stdlib. No Express, db, or kinetica.ts
 * dependencies — keeps the unit-test surface minimal.
 */

export type QuantileSqlArgs = {
  schema: string;
  table: string;
  column: string;
  n: number;
};

/**
 * Build the bucket-MIN wrapper NTILE quantile SQL.
 * Verbatim from 37-SPIKE-NOTES.md ## Decision (Probe NTILE-C PASS).
 *
 * Emitted template (whitespace-normalized):
 *   SELECT bucket, MIN(<column>) AS boundary
 *   FROM (
 *     SELECT NTILE(<n>) OVER (PARTITION BY 0 ORDER BY <column>) AS bucket, <column>
 *     FROM <schema>.<table>
 *   )
 *   GROUP BY bucket
 *   ORDER BY bucket
 */
export function buildQuantileSql(args: QuantileSqlArgs): string {
  const { schema, table, column, n } = args;
  // Phase 44 follow-up: see topValuesSql.ts — empty schema means the `table`
  // arg is a bare unprefixed identifier (e.g. a dynamic view's materialized
  // view name like `_kbi_dv_uALICE_d5_7`).
  const fromTarget = schema === "" ? table : `${schema}.${table}`;
  return (
    `SELECT bucket, MIN(${column}) AS boundary ` +
    `FROM ( ` +
    `SELECT NTILE(${n}) OVER (PARTITION BY 0 ORDER BY ${column}) AS bucket, ${column} ` +
    `FROM ${fromTarget} ` +
    `) ` +
    `GROUP BY bucket ` +
    `ORDER BY bucket`
  );
}

/**
 * Parse Kinetica's encoded NTILE response and return the N-1 upper-boundary
 * values that define N classbreak ranges.
 *
 * Kinetica response shape (37-SPIKE-NOTES.md NTILE-C probe):
 *   { column_1: number[bucket],  column_2: number[boundary],
 *     column_headers: ["bucket","boundary"], column_datatypes: ["long","float"] }
 *
 * For N buckets, column_2 has N entries [bucket1.MIN, bucket2.MIN, ..., bucketN.MIN].
 * bucket1.MIN is the dataset minimum (not a useful upper boundary). We return
 * column_2.slice(1) → [bucket2.MIN, ..., bucketN.MIN] = N-1 values defining N ranges:
 *   (-inf, bucket2.MIN], (bucket2.MIN, bucket3.MIN], ..., (bucketN.MIN, +inf).
 *
 * Throws if the response shape is malformed (column_2 missing or non-array) or
 * insufficient (column_2 empty — cannot drop bucket 1 from nothing). Kinetica
 * permission / upstream errors are caught by the route handler BEFORE calling
 * this — this parser only handles SHAPE-malformed responses on the success path.
 */
export function parseQuantileResponse(kineticaResponseJson: unknown): number[] {
  if (!kineticaResponseJson || typeof kineticaResponseJson !== "object") {
    throw new Error("malformed quantile response: not an object");
  }
  const obj = kineticaResponseJson as { column_2?: unknown };
  if (!Array.isArray(obj.column_2)) {
    throw new Error("malformed quantile response: column_2 not an array");
  }
  const col2 = obj.column_2 as unknown[];
  if (col2.length === 0) {
    throw new Error("malformed quantile response: column_2 is empty (insufficient buckets)");
  }
  // Validate every entry (from index 1) is a finite number — Kinetica may emit nulls
  // for non-numeric edge cases. Index 0 is bucket 1's MIN (dataset minimum) — dropped.
  const breaks: number[] = [];
  for (let i = 1; i < col2.length; i++) {
    const v = col2[i];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error(`malformed quantile response: column_2[${i}] is not a finite number`);
    }
    breaks.push(v);
  }
  return breaks;
}
