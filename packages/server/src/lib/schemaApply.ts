/**
 * schemaApply.ts — the APPLY side of v1.25 Schema Sync.
 *
 * WHY THIS MODULE EXISTS
 * -----------------------
 * Phases 122, 123 and 124 deliberately wrote NOTHING: they detect, diff and report.
 * `tables.columns_fingerprint` gained a read-only accessor in Phase 122 and no setter
 * anywhere in the tree. That ends here. This module owns the two pure decisions the apply
 * depends on, and Plan 125-03's `applySchemaSync` — the transaction that actually writes —
 * lands here beside them.
 *
 * What lives here:
 *   - `isStaleAgainst` / `SCHEMA_APPLY_STALE_MESSAGE` — the optimistic-concurrency refusal.
 *     Apply re-reads Kinetica and REFUSES if reality moved after the operator's report was
 *     built, so the operator never applies something they did not see (125-CONTEXT.md,
 *     locked).
 *   - `renderColumnType` / `renderColumnsMap` / `TYPE_NAMING_REFINEMENTS` — the renderer
 *     that turns a precise fingerprint into the `tables.columns` string every config panel
 *     reads, WITHOUT re-flattening the type information this milestone exists to preserve.
 *   - `applySchemaSync` (Plan 125-03) — the transaction wiring `setTableSchemaSnapshot` and
 *     `insertTableSyncHistoryEntry` together.
 *
 * PURE. No `db`, no `express`, no `fetch`. Routes stay thin; this computes.
 */

import {
  canonicalFingerprintJson,
  formatFingerprint,
  type ColumnFingerprint,
  type ColumnFingerprintMap,
} from "./schemaFingerprint";

/**
 * The operator-facing refusal. Rendered VERBATIM by Phase 126.
 *
 * It does NOT name which column moved, deliberately: the remedy is to re-run the check,
 * which produces the precise, current list with its full impact report -- naming a stale
 * subset here would invite acting on it.
 */
export const SCHEMA_APPLY_STALE_MESSAGE =
  "Kinetica's columns changed again after this report was built, so applying it would store " +
  "a snapshot you have not seen. Nothing was written. Re-run the check to see the current " +
  "state, then apply that.";

/**
 * True when `live` differs from the map the report was built from, in ANY column's base or
 * refinements, or in the set of columns present. Column ORDER is not a difference.
 *
 * This is the whole optimistic-concurrency mechanism, and it is a WHOLE-MAP comparison, not
 * a digest. There is no prior optimistic-concurrency precedent in this codebase, so the
 * choice is recorded here rather than inferred:
 *
 *   - The client ECHOES the map. `SchemaCheckResult` already carries `live:
 *     ColumnFingerprintMap` on BOTH the `diff` and `baseline_required` outcomes, so the
 *     client is handing back something it already holds verbatim. That costs nothing new:
 *     no field added to the check response, no hashing mirrored into `packages/web`, and
 *     nothing for a future reader to keep in sync across the package boundary.
 *   - A DIGEST was the alternative. It is smaller on the wire, but it has to be MINTED
 *     somewhere: either the check route grows a new response field (a change to a contract
 *     two shipped phases and Phase 126 are planned against, for a payload problem that does
 *     not exist -- the widest table in the dev database is 251 columns, roughly 20 KB
 *     against express.json's 1 MB limit) or `packages/web` grows a second implementation of
 *     this canonical form plus a hash, which is a mirror that can drift silently and whose
 *     drift presents as "apply keeps saying my report is stale".
 *   - Comparing canonical JSON strings also has no collision surface at all, which a hash,
 *     however unlikely, does.
 *
 * The cost of echoing is a larger request body and nothing else.
 */
export function isStaleAgainst(
  reportedLive: ColumnFingerprintMap,
  live: ColumnFingerprintMap
): boolean {
  return canonicalFingerprintJson(reportedLive) !== canonicalFingerprintJson(live);
}

/**
 * Property markers that NAME the column's type outright, in precedence order (most
 * specific first). When one is present it is emitted BARE, replacing the base entirely.
 *
 * Everything else -- char/int widths and anything unrecognised -- goes through
 * formatFingerprint, which produces `base(marker,...)`. That is safe because the web's
 * normalizeType strips the parenthetical: `string(char4)` -> `string`, `int(int8)` -> `int`,
 * both of which land in the same class the old INFORMATION_SCHEMA value did, while the
 * width itself is now PRESERVED in the stored map instead of being destroyed the way
 * `character(256)` destroyed it for char1, char4 and char16 alike.
 */
const TYPE_NAMING_REFINEMENTS: readonly string[] = [
  // Temporal, from DATETIME_TYPES. Emitted bare because normalizeType would strip the
  // parenthetical off `long(timestamp)` and leave `long`, which is a member of
  // NUMERIC_TYPES -- so the config panels would classify a TIMESTAMP column as a NUMBER.
  // That is precisely the flattening showTableTypes.ts exists to undo, and precisely the
  // trap classifyFingerprint was written to avoid one layer up (124-01). Reintroducing it
  // here would put it in the WRITE path, where it is durable rather than transient.
  "timestamp",
  "datetime",
  "date",
  "time",
  // Boolean, from BOOLEAN_TYPES.
  "boolean",
  "bool",
  // Spatial. Emitted bare for the OTHER web branch: isColumnDrillDownSafe excludes
  // {wkt, wkb, bytes, blob, text, point, geometry, geography} by normalized name (PITFALL
  // D-01). `string(wkt)` normalizes to `string`, which is NOT excluded -- so rendering a
  // geometry column through formatFingerprint would silently admit it to the drill-down
  // picker, where equality filters on geometry are exactly what D-01 exists to prevent.
  "wkt",
  "wkb",
];

/**
 * KNOWN GAP, carried deliberately rather than papered over.
 *
 * Kinetica's /show/table exposes no marker for an unrestricted-length string column. Such a
 * column fingerprints as {base:"string", refinements:[]} and therefore renders "string",
 * where INFORMATION_SCHEMA reported "text" -- a member of the web's
 * EXCLUDED_DRILLDOWN_TYPES. So after an apply, a column that INFORMATION_SCHEMA called
 * `text` becomes selectable in the drill-down picker, where it was excluded before.
 *
 * This is over-inclusion, which columnTypes.ts's own D-01 comment already names as the
 * acceptable direction ("conservative pass-through for unknown types ... over-exclusion
 * would hide valid columns"). It is stated here, and in this phase's SUMMARY, rather than
 * discovered later. `text` appears in the dev database's current tables.columns vocabulary,
 * so this is a real case, not a hypothetical one.
 */
export const SCHEMA_APPLY_TEXT_WIDTH_GAP =
  "Kinetica's /show/table carries no marker for an unrestricted-length string column, so " +
  "a column INFORMATION_SCHEMA reported as `text` is stored as `string` after an apply and " +
  "becomes selectable in the drill-down picker. This report does NOT detect that case.";

/** Render ONE fingerprint into the tables.columns vocabulary. */
export function renderColumnType(fp: ColumnFingerprint): string {
  const markers = new Set(fp.refinements.map((r) => r.toLowerCase()));
  for (const named of TYPE_NAMING_REFINEMENTS) {
    if (markers.has(named)) return named;
  }
  return formatFingerprint(fp);
}

/**
 * Render a whole live fingerprint map into the Record<string,string> that `tables.columns`
 * stores and every config panel reads. Key order follows the input map (Kinetica's ordinal
 * order), which is what the panels already present.
 */
export function renderColumnsMap(live: ColumnFingerprintMap): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of Object.keys(live)) out[name] = renderColumnType(live[name]);
  return out;
}
