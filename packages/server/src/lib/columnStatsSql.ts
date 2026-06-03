/**
 * v1.7 (post-Phase-39 UAT enhancement): pure SQL builder + parser for the
 * /api/column-stats endpoint. Backs the Equal-Interval and Standard-Deviation
 * classification methods in the Class Break form's numeric Auto-suggest (the
 * client computes break boundaries locally from these stats).
 *
 * Trust boundary on schema/table/column: interpolated directly (admin-sourced
 * discovery metadata), same as quantileSql.ts / topValuesSql.ts.
 *
 * Pure module — zero imports beyond Node stdlib.
 */

export type ColumnStatsSqlArgs = {
  schema: string;
  table: string;
  column: string;
};

export type ColumnStats = {
  min: number;
  max: number;
  mean: number;
  stddev: number;
};

/**
 * Build MIN/MAX/AVG/STDDEV over the non-null values of a numeric column.
 *
 * Emitted template:
 *   SELECT MIN(<col>) AS mn, MAX(<col>) AS mx, AVG(<col>) AS av, STDDEV(<col>) AS sd
 *   FROM <schema>.<table>
 *   WHERE <col> IS NOT NULL
 */
export function buildColumnStatsSql(args: ColumnStatsSqlArgs): string {
  const { schema, table, column } = args;
  // Phase 44 follow-up: see topValuesSql.ts — empty schema means the `table`
  // arg is a bare unprefixed identifier (e.g. a dynamic view's materialized
  // view name like `_kbi_dv_uALICE_d5_7`).
  const fromTarget = schema === "" ? table : `${schema}.${table}`;
  return (
    `SELECT MIN(${column}) AS mn, MAX(${column}) AS mx, ` +
    `AVG(${column}) AS av, STDDEV(${column}) AS sd ` +
    `FROM ${fromTarget} ` +
    `WHERE ${column} IS NOT NULL`
  );
}

/**
 * Parse Kinetica's encoded single-row response into ColumnStats.
 *
 * Kinetica response shape:
 *   { column_1:[min], column_2:[max], column_3:[avg], column_4:[stddev], ... }
 *
 * Throws on SHAPE-malformed responses or non-finite stats (e.g. empty table →
 * null aggregates). Kinetica permission/upstream errors are caught by the route
 * handler before this runs.
 */
export function parseColumnStatsResponse(kineticaResponseJson: unknown): ColumnStats {
  if (!kineticaResponseJson || typeof kineticaResponseJson !== "object") {
    throw new Error("malformed column-stats response: not an object");
  }
  const obj = kineticaResponseJson as Record<string, unknown>;
  const pick = (key: string, label: string): number => {
    const arr = obj[key];
    if (!Array.isArray(arr) || arr.length === 0) {
      throw new Error(`malformed column-stats response: ${key} (${label}) missing`);
    }
    const v = arr[0];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error(`column-stats ${label} is not a finite number (empty or non-numeric column?)`);
    }
    return v;
  };
  return {
    min: pick("column_1", "min"),
    max: pick("column_2", "max"),
    mean: pick("column_3", "mean"),
    stddev: pick("column_4", "stddev"),
  };
}
