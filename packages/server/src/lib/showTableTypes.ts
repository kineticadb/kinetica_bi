/**
 * showTableTypes.ts — recover per-column TEMPORAL annotations from a Kinetica
 * /show/table response.
 *
 * WHY THIS EXISTS
 * ----------------
 * Kinetica stores TIMESTAMP / DATE / TIME / DATETIME columns with a base storage
 * type of `long` (epoch ms / day / ms-of-day). The column-discovery route reads
 * `INFORMATION_SCHEMA.COLUMNS.DATA_TYPE`, which reports only that base type —
 * e.g. a TIMESTAMP column comes back as `"bigint"`. The temporal sub-type lives
 * in the column's *property* list, which INFORMATION_SCHEMA does not expose.
 *
 * The authoritative source for the sub-type is the native `/show/table`
 * response's per-column `properties` array, which carries the markers
 * "timestamp" / "date" / "time" / "datetime". This was flagged but never wired
 * during v1.2 map work — see:
 *   - .planning/research/_archive_v1.2/PITFALLS.md (~L122): "/show/table returns
 *     a column_type field ... type_spec containing wkb"
 *   - .planning/research/FEATURES.md (~L212): "Kinetica's /show/table response
 *     likely includes this metadata but it's not surfaced in the current
 *     column-discovery route".
 *
 * Without this, the Timeline chart's Time-column picker (which filters to
 * datetime types via inferDataTypeFromColumn) finds NO datetime columns on a
 * table whose TIMESTAMP columns INFORMATION_SCHEMA reports as `bigint`.
 *
 * SCOPE — DELIBERATELY NARROW
 * ----------------------------
 * This parser returns ONLY columns that carry a temporal property, each mapped
 * to its canonical lowercase type string. The columns route uses the result to
 * OVERRIDE the INFORMATION_SCHEMA type for those columns only; every other
 * column's DATA_TYPE is left untouched. Minimal blast radius, zero regression:
 * if /show/table is unavailable or its shape is unexpected, callers fall back to
 * the pure INFORMATION_SCHEMA behavior.
 */

// Kinetica column-property markers that denote a temporal column.
// Order = precedence (most specific first); a column normally carries exactly one.
const TEMPORAL_PROPERTIES = ["timestamp", "datetime", "date", "time"] as const;
export type TemporalType = (typeof TEMPORAL_PROPERTIES)[number];

type ShowTableResponse = {
  // table_names[i] aligns with properties[i] — one entry per returned table.
  table_names?: unknown;
  // properties: array<map<column_name, string[] of property markers>>
  properties?: unknown;
};

/**
 * Extract the temporal columns from a parsed /show/table response body.
 *
 * @param body       The decoded show_table_response object (NOT the REST envelope).
 * @param tableName  Schema-qualified table name ("schema.table") used to pick the
 *                   matching index in table_names/properties; falls back to index 0.
 * @returns Map of column name → canonical temporal type ("timestamp" | "datetime"
 *          | "date" | "time"). Empty when none / on any malformed input.
 */
export function parseTemporalColumns(
  body: unknown,
  tableName: string,
): Record<string, TemporalType> {
  const out: Record<string, TemporalType> = {};
  if (!body || typeof body !== "object") return out;

  const resp = body as ShowTableResponse;
  const props = resp.properties;
  if (!Array.isArray(props) || props.length === 0) return out;

  // /show/table may return multiple tables; pick the index matching tableName.
  let idx = 0;
  if (Array.isArray(resp.table_names)) {
    const found = resp.table_names.findIndex((n) => n === tableName);
    if (found >= 0) idx = found;
  }

  const colProps = props[idx];
  if (!colProps || typeof colProps !== "object") return out;

  for (const [col, list] of Object.entries(colProps as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const lower = list.map((p) => String(p).toLowerCase());
    const match = TEMPORAL_PROPERTIES.find((t) => lower.includes(t));
    if (match) out[col] = match;
  }
  return out;
}
