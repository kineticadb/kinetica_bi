/**
 * schemaDiff.ts — compare two ColumnFingerprintMaps (a stored snapshot and a
 * freshly-read live one) and report exactly what changed.
 *
 * WHY THIS EXISTS
 * ----------------
 * `/show/table` (via schemaFingerprint.ts, Plan 122-01) exposes no per-column
 * identity: `type_ids` is one id PER TABLE TYPE, not per column, and
 * `type_schemas`/`properties` are plain name-keyed maps
 * (122-SPIKE-NOTES.md Q3, verified live, not inferred from documentation).
 * There is therefore nothing to pair a removed column with an added one when
 * a column is renamed in Kinetica — the app NEVER guesses that a removal and
 * an addition are "the same column, renamed". A rename always reports as one
 * removal plus one addition. Matching column names is exact and
 * case-SENSITIVE (`CustomerID` !== `customerid`, locked in 122-CONTEXT.md) —
 * introducing case-folding here would quietly create a second, inconsistent
 * notion of "same column" right next to the rename decision this module
 * exists to enforce.
 *
 * `ORDINAL_POSITION` is available from Kinetica's INFORMATION_SCHEMA but is
 * NEVER used here, or anywhere in this module, to pair columns — it is
 * positional, not identity, and pairing on it is precisely the heuristic the
 * milestone forbids (122-SPIKE-NOTES.md, "Unplanned finding").
 *
 * This module is PURE: no `db`, no network, no Express. It only compares
 * already-parsed ColumnFingerprintMaps and (Task 2) builds the
 * SchemaCheckResult response contract that Phase 124 (impact report)
 * computes from and Phase 125 (apply + sync history) persists.
 *
 * Severity classification — whether a given retype is actually breaking to
 * the app (e.g. `int -> varchar` vs `int -> double`) — is deliberately NOT
 * this module's job (SSYNC-V125-12, Phase 124). This module reports the
 * precise structural change (both the stored and live ColumnFingerprint, not
 * just their rendered strings) so Phase 124 has what it needs to classify;
 * it never discards information toward that end.
 */

import type { ColumnFingerprint, ColumnFingerprintMap } from "./schemaFingerprint";
import { formatFingerprint } from "./schemaFingerprint";

export type AddedColumn = { column: string; live: ColumnFingerprint; liveType: string };
export type RemovedColumn = { column: string; stored: ColumnFingerprint; storedType: string };
export type RetypedColumn = {
  column: string;
  stored: ColumnFingerprint;
  storedType: string;
  live: ColumnFingerprint;
  liveType: string;
};

export type SchemaDiff = {
  added: AddedColumn[];
  removed: RemovedColumn[];
  retyped: RetypedColumn[];
};

// Byte-stable ascending sort by column name. Deliberately NOT localeCompare —
// Phase 125 persists these arrays and a locale-dependent order would produce
// spurious history churn between machines/locales for identical input.
function byColumnAscending<T extends { column: string }>(a: T, b: T): number {
  return a.column < b.column ? -1 : a.column > b.column ? 1 : 0;
}

// Structural equality on ColumnFingerprint. Both operands' `refinements`
// arrays are already lowercased + sorted by schemaFingerprint.ts, so this is
// deliberately index-wise (not set-wise) and does NOT re-sort. Comparing the
// rendered `formatFingerprint` strings instead would also detect a change,
// but would collapse the structured `base`/`refinements` values Phase 124
// needs into a single string — so the comparison stays structured.
function fingerprintsEqual(a: ColumnFingerprint, b: ColumnFingerprint): boolean {
  if (a.base !== b.base) return false;
  if (a.refinements.length !== b.refinements.length) return false;
  for (let i = 0; i < a.refinements.length; i++) {
    if (a.refinements[i] !== b.refinements[i]) return false;
  }
  return true;
}

/**
 * Compare a stored fingerprint map against a live one.
 *
 * - A key present in `live` but not `stored` -> `added`, carrying the live
 *   fingerprint.
 * - A key present in `stored` but not `live` -> `removed`, carrying the
 *   stored fingerprint.
 * - A key present in both, with unequal fingerprints -> `retyped`, carrying
 *   BOTH.
 * - A key present in both, with equal fingerprints -> emitted in NO group.
 *
 * Key comparison is `===` on the raw string: no `toLowerCase`, no `trim`, no
 * normalization. A case-only change is therefore one removal plus one
 * addition, not a no-op and not a retype.
 */
export function diffColumnFingerprints(
  stored: ColumnFingerprintMap,
  live: ColumnFingerprintMap,
): SchemaDiff {
  const added: AddedColumn[] = [];
  const removed: RemovedColumn[] = [];
  const retyped: RetypedColumn[] = [];

  for (const column of Object.keys(live)) {
    const liveFp = live[column];
    if (!Object.prototype.hasOwnProperty.call(stored, column)) {
      added.push({ column, live: liveFp, liveType: formatFingerprint(liveFp) });
      continue;
    }
    const storedFp = stored[column];
    if (!fingerprintsEqual(storedFp, liveFp)) {
      retyped.push({
        column,
        stored: storedFp,
        storedType: formatFingerprint(storedFp),
        live: liveFp,
        liveType: formatFingerprint(liveFp),
      });
    }
  }

  for (const column of Object.keys(stored)) {
    if (!Object.prototype.hasOwnProperty.call(live, column)) {
      const storedFp = stored[column];
      removed.push({ column, stored: storedFp, storedType: formatFingerprint(storedFp) });
    }
  }

  added.sort(byColumnAscending);
  removed.sort(byColumnAscending);
  retyped.sort(byColumnAscending);

  return { added, removed, retyped };
}
