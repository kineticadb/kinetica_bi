/**
 * schemaFingerprint.ts — turn a Kinetica `/show/table` body into a precise
 * per-column type fingerprint, and classify whether a table is present in
 * Kinetica at all.
 *
 * WHY THIS EXISTS
 * ----------------
 * The v1.25 Schema Sync spike (122-SPIKE-NOTES.md) proved that
 * `INFORMATION_SCHEMA.COLUMNS.DATA_TYPE` — the source the app already reads —
 * reports `character(256)` for a char1, char4 AND char16 column alike. It is
 * not merely lossy about width, it is actively wrong: every char column
 * reports the same value regardless of its real declared width. A
 * `varchar(8) -> varchar(32)` change is therefore completely invisible
 * through `INFORMATION_SCHEMA`, and integer width (`int8`/`int16`) is only
 * partially recoverable (`tinyint`/`smallint`). The only source that carries
 * true precision is `/show/table`'s `type_schemas` (Avro base type) combined
 * with `properties` (the width/temporal refinement markers) — and the spike
 * confirmed BOTH are required: `type_schemas` alone misses char/int width,
 * `properties` alone misses the base type (`int` vs `double`).
 *
 * This module is PURE: no `db`, no network, no side effects. It only parses
 * an already-fetched `/show/table` body (see `kinetica.ts`'s
 * `kineticaShowTable`) into a fingerprint the diff engine (Phase 123/124) and
 * the apply/persist step (Phase 125) can compare and store.
 *
 * Mirrors the defensive style of the sibling parser `lib/showTableTypes.ts`:
 * never throws, returns an empty/neutral result on any malformed input, and
 * picks the `table_names`-matching index with a fallback to 0.
 */

/** Avro base type from type_schemas, with "null" stripped from unions. e.g. "int" | "long" | "float" | "double" | "string" | "bytes" | "boolean" */
export type ColumnFingerprint = {
  base: string;
  /** Type-refining /show/table property markers, lowercased and sorted. e.g. ["char4"], ["int8"], ["timestamp"] */
  refinements: string[];
};
export type ColumnFingerprintMap = Record<string, ColumnFingerprint>;
export type FingerprintSnapshot = { v: 1; columns: ColumnFingerprintMap };
export type TablePresence = "present" | "missing" | "unreadable";

/**
 * EXCLUSION set: /show/table `properties` markers that describe storage or
 * indexing, NOT the column's type. Everything NOT in this set is treated as
 * type-refining — fail toward reporting a change, never toward silence.
 *
 * "nullable" is deliberately excluded: nullability detection is SSYNC-F5,
 * DEFERRED (out of scope for v1.25). Including "nullable" here would make a
 * column's nullability changing silently ship as a "retype" — a feature that
 * was never specified. Confirmed load-bearing (not theoretical) by the
 * pg_catalog.pg_views spike probe, which carries real "nullable" markers.
 */
export const NON_TYPE_PROPERTIES: ReadonlySet<string> = new Set([
  "data",
  "store_only",
  "disk_optimized",
  "text_search",
  "primary_key",
  "shard_key",
  "dict",
  "init_with_now",
  "nullable",
  "unique",
]);

type ShowTableBody = {
  table_names?: unknown;
  type_schemas?: unknown;
  properties?: unknown;
};

/**
 * Classify whether `body` (an already-decoded /show/table response) shows the
 * requested table as present, missing, or unreadable.
 *
 * A malformed body must NEVER read as "your table was deleted" — that is the
 * whole point of the three-state return. Only an explicitly empty
 * `table_names` array (the documented shape a `no_error_if_not_exists: true`
 * call returns for a table Kinetica does not have — 122-SPIKE-NOTES.md Q5)
 * means "missing". Anything structurally unexpected is "unreadable".
 */
export function tablePresence(body: unknown): TablePresence {
  if (!body || typeof body !== "object") return "unreadable";
  const tableNames = (body as ShowTableBody).table_names;
  if (!Array.isArray(tableNames)) return "unreadable";
  if (tableNames.length === 0) return "missing";
  return "present";
}

// Pick the properties/type_schemas index matching tableName; same rule as
// showTableTypes.ts's parseTemporalColumns — fall back to index 0.
function resolveIndex(tableNames: unknown, tableName: string): number {
  if (Array.isArray(tableNames)) {
    const found = tableNames.findIndex((n) => n === tableName);
    if (found >= 0) return found;
  }
  return 0;
}

type AvroField = { name?: unknown; type?: unknown };
type AvroRecord = { fields?: unknown };

function parseTypeSchema(raw: unknown): AvroRecord {
  if (raw && typeof raw === "object") return raw as AvroRecord;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as AvroRecord) : {};
    } catch {
      return {};
    }
  }
  return {};
}

// Normalize a raw Avro `type` value to a lowercase base-type string.
// - plain string -> itself
// - union array (nullable column) -> "null" filtered out, first remaining
//   entry used (Kinetica unions are always exactly [<type>, "null"] or
//   ["null", <type>] — a nullable column has exactly one real type)
// - object with a string `.type` -> that
// - anything else -> "unknown"
function normalizeAvroType(type: unknown): string {
  if (typeof type === "string") return type.toLowerCase();
  if (Array.isArray(type)) {
    const remaining = type.filter((t) => t !== "null");
    const first = remaining[0];
    return typeof first === "string" ? first.toLowerCase() : "unknown";
  }
  if (type && typeof type === "object" && typeof (type as { type?: unknown }).type === "string") {
    return ((type as { type: string }).type).toLowerCase();
  }
  return "unknown";
}

/**
 * Parse a /show/table body into a per-column fingerprint map: Avro base type
 * (from `type_schemas`) merged with type-refining property markers (from
 * `properties`, with `NON_TYPE_PROPERTIES` stripped).
 *
 * Returns `{}` on any malformed input. Never throws.
 *
 * `type_schemas.fields` is the authoritative column list — a key present only
 * in `properties` is ignored (properties has no base type to pair with it).
 */
export function parseColumnFingerprints(
  body: unknown,
  tableName: string,
): ColumnFingerprintMap {
  const out: ColumnFingerprintMap = {};
  if (!body || typeof body !== "object") return out;

  const resp = body as ShowTableBody;
  const typeSchemas = resp.type_schemas;
  if (!Array.isArray(typeSchemas) || typeSchemas.length === 0) return out;

  const idx = resolveIndex(resp.table_names, tableName);
  const record = parseTypeSchema(typeSchemas[idx]);
  const fields = record.fields;
  if (!Array.isArray(fields)) return out;

  const propsArray = resp.properties;
  const colProps: Record<string, unknown> =
    Array.isArray(propsArray) &&
    propsArray[idx] &&
    typeof propsArray[idx] === "object"
      ? (propsArray[idx] as Record<string, unknown>)
      : {};

  for (const field of fields as AvroField[]) {
    if (!field || typeof field.name !== "string") continue;
    const name = field.name;
    const base = normalizeAvroType(field.type);

    const rawMarkers = colProps[name];
    const refinements = Array.isArray(rawMarkers)
      ? Array.from(
          new Set(
            rawMarkers
              .map((m) => String(m).toLowerCase())
              .filter((m) => !NON_TYPE_PROPERTIES.has(m)),
          ),
        ).sort()
      : [];

    out[name] = { base, refinements };
  }

  return out;
}

/**
 * Render a fingerprint as a compact human-readable string, e.g. `string(char4)`,
 * `int(int8)`, `long(timestamp)`, or bare `float` when there are no refinements.
 */
export function formatFingerprint(fp: ColumnFingerprint): string {
  if (fp.refinements.length === 0) return fp.base;
  return `${fp.base}(${fp.refinements.join(",")})`;
}

/**
 * Parse a stored fingerprint snapshot string back into a ColumnFingerprintMap.
 *
 * Returns `null` for: null/undefined/empty-or-whitespace input, malformed
 * JSON, a non-object parse result, an unrecognized version, or a `columns`
 * field that isn't an object.
 *
 * `null` means "no usable precise baseline" — the caller (Phase 125) turns
 * that into `baseline_required`. An old-format row (column stored NULL, never
 * written by this module) and a corrupt snapshot both land here identically,
 * and NEITHER is an error condition — both simply mean "establish a baseline
 * on the next successful check", per the locked "old snapshots" decision in
 * 122-CONTEXT.md.
 */
export function parseFingerprintSnapshot(
  raw: string | null | undefined,
): ColumnFingerprintMap | null {
  if (raw === null || raw === undefined) return null;
  if (raw.trim().length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const snapshot = parsed as Partial<FingerprintSnapshot>;
  if (snapshot.v !== 1) return null;
  if (!snapshot.columns || typeof snapshot.columns !== "object") return null;

  const out: ColumnFingerprintMap = {};
  for (const [name, value] of Object.entries(snapshot.columns as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const v = value as Partial<ColumnFingerprint>;
    if (typeof v.base !== "string") continue;
    out[name] = {
      base: v.base,
      refinements: Array.isArray(v.refinements) ? v.refinements.map((r) => String(r)) : [],
    };
  }
  return out;
}

/**
 * Serialize a ColumnFingerprintMap into the stored snapshot string format.
 *
 * Provided for Phase 125's apply step — Phase 122 never calls this outside
 * tests; this phase writes nothing to the database (locked in 122-CONTEXT.md).
 */
export function serializeFingerprintSnapshot(columns: ColumnFingerprintMap): string {
  const snapshot: FingerprintSnapshot = { v: 1, columns };
  return JSON.stringify(snapshot);
}

/**
 * Canonical, ORDER-INDEPENDENT byte form of a ColumnFingerprintMap.
 *
 * WHY THIS IS NOT serializeFingerprintSnapshot.
 * ---------------------------------------------
 * `serializeFingerprintSnapshot` is the STORAGE form and preserves insertion order, which
 * for a freshly parsed map is Kinetica's own ordinal column order. Phase 125's apply
 * compares the fingerprint the operator's report was built from against a fresh re-read,
 * and refuses the apply if they differ. If that comparison used the storage form, a pure
 * column REORDER in Kinetica -- which changes no column, no type, and produces an empty
 * diff, so the report the operator read is still completely accurate -- would refuse the
 * apply and tell them to re-run a check that will keep saying the same thing.
 *
 * So: keys sorted byte-ascending (`<`/`>` on the raw string, NEVER localeCompare -- a
 * locale-dependent order would make the comparison machine-dependent), and each value
 * emitted with a fixed key order. `refinements` is NOT re-sorted: parseColumnFingerprints
 * already lowercases and sorts it, and re-sorting here would quietly create a second,
 * inconsistent notion of fingerprint identity right next to schemaDiff.ts's deliberately
 * index-wise comparison.
 *
 * Used ONLY for equality. Never stored -- the stored form stays the Phase 122 one.
 */
export function canonicalFingerprintJson(columns: ColumnFingerprintMap): string {
  const names = Object.keys(columns).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const parts = names.map(
    (n) =>
      JSON.stringify(n) +
      ":{\"base\":" +
      JSON.stringify(columns[n].base) +
      ",\"refinements\":" +
      JSON.stringify(columns[n].refinements) +
      "}"
  );
  return "{" + parts.join(",") + "}";
}
