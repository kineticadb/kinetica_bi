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

import { canonicalFingerprintJson, type ColumnFingerprintMap } from "./schemaFingerprint";

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
