---
phase: 122-schema-diff-table-missing-detection
plan: 03
subsystem: server-lib
tags: [schema-sync, kinetica, diff, contract]

# Dependency graph
requires:
  - "packages/server/src/lib/schemaFingerprint.ts (ColumnFingerprint, ColumnFingerprintMap, formatFingerprint) — Plan 122-01"
provides:
  - "packages/server/src/lib/schemaDiff.ts (SchemaDiff, AddedColumn, RemovedColumn, RetypedColumn, SchemaCheckResult, diffColumnFingerprints, diffResult, baselineRequiredResult, tableMissingResult)"
affects:
  - "Phase 122-04 (route) — will call diffResult / baselineRequiredResult / tableMissingResult and map SchemaCheckResult to a response body"
  - "Phase 124 (impact report) — computes severity/breaking classification FROM SchemaCheckResult.retyped[].stored/live; consumes this contract read-only"
  - "Phase 125 (apply + sync history) — persists SchemaCheckResult.added/removed/retyped and writes SchemaCheckResult.live back as the new baseline snapshot"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure lib under packages/server/src/lib/ (zero db, zero network, zero express) — mirrors whereClause.ts's header + named-export style"
    - "Discriminated union on `outcome` for a route-facing response contract, with 'could not reach Kinetica' deliberately excluded from the union (surfaced as a thrown typed error / non-2xx instead)"

key-files:
  created:
    - packages/server/src/lib/schemaDiff.ts
    - packages/server/tests/lib.schemaDiff.spec.ts
  modified: []

key-decisions:
  - "Rename is unconditionally one removal plus one addition — no pairing, similarity, or ordinal heuristic exists anywhere in the module, enforced by a forbidden-token test and mutation probe M6"
  - "fingerprintsEqual compares the structured {base, refinements} value, not the rendered formatFingerprint() string, so Phase 124 keeps the fields it needs to classify severity"
  - "tableMissingResult carries no added/removed/retyped keys, not even empty arrays — a table-missing outcome must be structurally impossible to misread as 'every column removed'"
  - "'Could not reach Kinetica' is absent from the SchemaCheckResult union by design; it is a thrown/non-2xx error, never a 200 payload"

requirements-completed: [SSYNC-V125-02, SSYNC-V125-04]

duration: ~45min
completed: 2026-09-21
---

# Phase 122 Plan 03: Schema Diff Engine + SchemaCheckResult Contract Summary

**Pure `diffColumnFingerprints` comparison plus the three-outcome `SchemaCheckResult` contract (`diff` / `baseline_required` / `table_missing`) that Phases 124 and 125 are planned against — zero DB, zero network, and zero rename-pairing logic anywhere in the module.**

## What Was Built

### Task 1 — `diffColumnFingerprints`

`packages/server/src/lib/schemaDiff.ts` exports `diffColumnFingerprints(stored, live): SchemaDiff`,
comparing two `ColumnFingerprintMap`s key-by-key with `===` (no `toLowerCase`/`trim`/normalization)
and structural `fingerprintsEqual` (both `base` and every `refinements[i]`, no re-sorting, no
set-wise comparison). A key only in `live` → `added` (carries `live` + `liveType`); a key only in
`stored` → `removed` (carries `stored` + `storedType`); a key in both with unequal fingerprints →
`retyped` (carries BOTH `stored`/`storedType` and `live`/`liveType`); a key in both with equal
fingerprints → emitted in no group. All three output arrays are sorted ascending by column name
with a hand-written comparator (no `localeCompare`) for byte-stable ordering across locales, since
Phase 125 persists these arrays.

The module header states explicitly (and the spike backs it): `/show/table`'s `type_ids` is one id
per table TYPE, not per column, so there is no per-column identity to pair a removal with an
addition — a rename is therefore always exactly one removal plus one addition. Kinetica's ordinal
column position is available but is never used for pairing anywhere in this module.

### Task 2 — `SchemaCheckResult` and its three builders

Appended to the same file: the `SchemaCheckResult` discriminated union and
`tableMissingResult` / `baselineRequiredResult` / `diffResult`. `tableMissingResult` carries no
`added`/`removed`/`retyped` keys at all (verified structurally, not just by convention — see
acceptance criterion 5 below). `baselineRequiredResult` and `diffResult` both carry `live` so
Phase 125's apply step doesn't need a second Kinetica round-trip. No `severity`/`breaking`/`impact`
*field* exists anywhere in the type — that is explicitly Phase 124's job.

## Shipped `SchemaCheckResult` (verbatim from `packages/server/src/lib/schemaDiff.ts`)

This is EXACTLY what shipped — identical to the plan's sketch, no drift:

```ts
export type SchemaCheckResult =
  | {
      outcome: "diff";
      table: string;
      hasChanges: boolean;
      added: AddedColumn[];
      removed: RemovedColumn[];
      retyped: RetypedColumn[];
      live: ColumnFingerprintMap;
    }
  | { outcome: "baseline_required"; table: string; message: string; live: ColumnFingerprintMap }
  | { outcome: "table_missing"; table: string; message: string };
```

Supporting types, also verbatim:

```ts
export type AddedColumn   = { column: string; live: ColumnFingerprint; liveType: string };
export type RemovedColumn = { column: string; stored: ColumnFingerprint; storedType: string };
export type RetypedColumn = {
  column: string;
  stored: ColumnFingerprint; storedType: string;
  live: ColumnFingerprint;   liveType: string;
};
export type SchemaDiff = {
  added: AddedColumn[];
  removed: RemovedColumn[];
  retyped: RetypedColumn[];
};
```

Builders: `diffColumnFingerprints(stored, live): SchemaDiff`,
`diffResult(table, stored, live): SchemaCheckResult`,
`baselineRequiredResult(table, live): SchemaCheckResult`,
`tableMissingResult(table): SchemaCheckResult`.

## Task Commits

1. `92b71c1` — `test(122-03): add failing tests for diffColumnFingerprints + SchemaCheckResult` (RED, both tasks' 19 tests in one spec file)
2. `c8a233b` — `feat(122-03): implement diffColumnFingerprints pure comparison` (GREEN, Task 1; 12/12 passing, other 7 still pending Task 2 symbols)
3. `53ecc6e` — `feat(122-03): add SchemaCheckResult contract and its three builders` (GREEN, Task 2; 19/19 passing)

## Mutation Probe Results

All 9 probes fired against their named test on the first attempt; each mutation applied, verified, and reverted (final file byte-identical to the pre-mutation commit, confirmed via `git status`/diff after restoring).

| # | Mutation | Named test | Result |
|---|----------|-----------|--------|
| M1 | Lowercase both key sets before comparing | "a case change is one removal plus one addition (CustomerID vs customerid)" | **Fired.** Clean, no collateral. |
| M2 | `fingerprintsEqual` compares only `base`, ignores `refinements` | "char8 -> char32 with identical base 'string' is a retype" | **Fired.** Also reddened "int8 -> int16 on the same base 'int' is a retype" and "a retyped entry carries BOTH the stored type and the live type" (2 collateral — both also depend on refinements being compared). |
| M3 | `fingerprintsEqual` compares only `refinements`, ignores `base` | "int -> double with identical empty refinements is a retype" | **Fired.** Also reddened "every group is sorted by column name ascending..." (1 collateral — that test's retyped-group fixture is also base-only, empty-refinements). |
| M4 | Omit `stored`/`storedType` from `RetypedColumn` entries | "a retyped entry carries BOTH the stored type and the live type" | **Fired.** Clean, no collateral. |
| M5 | Emit every shared column into `retyped` regardless of equality | "unchanged columns appear in no group" | **Fired.** Also reddened "an identical stored and live map yields three empty arrays" and "diffResult: hasChanges is false when the three groups are empty" (2 collateral — both also assert on all-unchanged input). |
| M6 | Pairing heuristic: exactly one removal + one addition → `{ possibleRename: true }` | "the serialized result of a rename contains no rename / similar / score / ordinal token" | **Fired.** Clean, no collateral. |
| M7 | Drop `.sort()` on all three output arrays | "every group is sorted by column name ascending, regardless of key insertion order" | **Fired.** Clean, no collateral. |
| M8 | `tableMissingResult` also returns `added`/`removed`/`retyped` keys | "tableMissingResult: outcome is 'table_missing' and the payload has no added/removed/retyped keys" | **Fired.** Clean, no collateral. |
| M9 | `diffResult` hardcodes `hasChanges: true` | "diffResult: hasChanges is false when the three groups are empty" | **Fired.** Clean, no collateral. |

No probe needed strengthening; no test needed strengthening.

## Acceptance Criteria — grep results (all run from `packages/server`)

Task 1:
1. `grep -c "diffColumnFingerprints" src/lib/schemaDiff.ts` = 2 (≥1 required). BEFORE: 0 tree-wide.
2. `grep -c "from \"./schemaFingerprint\"" src/lib/schemaDiff.ts` = 2 (≥1 required).
3. `grep -cE "toLowerCase|toUpperCase|localeCompare" src/lib/schemaDiff.ts` = 0.
4. `grep -ciE "similarity|levenshtein|ordinal_position|pairRename" src/lib/schemaDiff.ts` = 0.
5. `npx vitest run tests/lib.schemaDiff.spec.ts` → 19/19 passing (≥12 required).
6. `grep -c "not.toContain" tests/lib.schemaDiff.spec.ts` = 1; `grep -c '"renam"' tests/lib.schemaDiff.spec.ts` = 1; `grep -c '"ordinal"' tests/lib.schemaDiff.spec.ts` = 1 — forbidden-token array present and asserted.
7. `npx tsc --noEmit` → clean.

Task 2:
1. `grep -c "baseline_required" src/lib/schemaDiff.ts` = 3 (≥2 required).
2. `grep -c "table_missing" src/lib/schemaDiff.ts` = 3 (≥2 required).
3. `grep -c "indistinguishable" src/lib/schemaDiff.ts` = 1 (≥1 required).
4. `grep -ciE "severity|breaking|impact" src/lib/schemaDiff.ts` = 1 — see "Non-discriminating criterion" below.
5. `node -e "...table_missing...retyped..."` guard script → exit 0 (no `retyped` key inside the table-missing builder).
6. `npx vitest run tests/lib.schemaDiff.spec.ts` → 19/19 passing (≥19 required).
7. `npx tsc --noEmit` → clean.

### Non-discriminating criterion found and handled per CLAUDE.md

**Task 2 acceptance criterion 4** (`grep -ciE "severity|breaking|impact" src/lib/schemaDiff.ts` = 0)
cannot pass while also satisfying the *same task's own mandatory verbatim doc-comment template*,
which reads `Consumed by Phase 124 (impact report) and persisted by Phase 125 (sync history).` — the
word "impact" is baked into the plan's own required text for the `SchemaCheckResult` doc comment.
I reworded my own explanatory prose elsewhere in the file (the module header, previously containing
"Severity classification... actually breaking..." and "Phase 124 (impact report)") to remove the
avoidable occurrences, bringing the count down from 3 to the 1 that is structurally unavoidable
given the plan's own mandated text. I did not touch the mandated comment. Per CLAUDE.md, I verified
the REAL requirement directly instead of editing around the broken check further: `SchemaCheckResult`
was inspected field-by-field (`outcome`, `table`, `hasChanges`, `added`, `removed`, `retyped`, `live`,
`message` across all three union members) and contains no field literally named `severity`,
`breaking`, `impact`, or similar — confirmed via a standalone regex extraction of the type block, not
by re-reading the grep count. The real requirement (no such field exists) holds.

Two similar BEFORE-value staleness notes (not criteria failures, just plan-authoring drift from
running the greps 122-01/122-02's own comments introduced after this plan was authored): the plan's
"BEFORE: 0 tree-wide" for `baseline_required` and `table_missing`, and "BEFORE: exactly ONE line, in
dashboardExportRefs.ts:241" for `indistinguishable`, are both now stale — 122-01/122-02 already added
comment-only mentions of these words in `db.ts`, `schemaFingerprint.ts`, and `kinetica.ts` while this
plan was executing in the wave-2 slot. This did not affect discrimination: the actual criteria are
scoped to `src/lib/schemaDiff.ts` specifically, which did not exist before this plan, so each
criterion's real BEFORE (on the file this plan creates) was still 0/absent as required.

## Test Gates

- `cd packages/server && npx tsc --noEmit` → **clean**.
- `cd packages/server && node scripts/test-gate.mjs` → **GATE PASSED**. 1226/1279 tests passed; exactly
  the 8 documented `KNOWN_FAILING` files (`auth.oidc`, `auth.routes`, `boot.hardening`, `boot.wipe`,
  `bootstrap`, `db.smoke`, `oidc.module`, `routes.wms`) — same set as the 122-01/122-02 baseline, not
  grown. Never asserted a fixed pass-count.
- `cd packages/web && npx tsc --noEmit` → clean (untouched, as expected).
- `git diff --name-only 7975240 HEAD` → `packages/server/src/lib/schemaDiff.ts`,
  `packages/server/tests/lib.schemaDiff.spec.ts` only.
- `git diff --name-only 7975240 HEAD | grep -c '^packages/web/'` → **0**.
- `git diff --name-only 7975240 HEAD | grep -E 'src/lib/schemaFingerprint\.ts|src/db\.ts'` → empty
  (neither file touched).

## Deviations from Plan

### Auto-fixed Issues

None — no bugs, missing functionality, or blockers were found in the plan's own design.

### Comment wording adjusted to avoid non-discriminating grep hits (Rule 3 — blocking issue for the acceptance gate, not a design change)

Reworded three of my own explanatory comments (not the plan's mandated verbatim template text) to
remove literal `toLowerCase`/`localeCompare`/`ORDINAL_POSITION`/`severity`/`breaking` tokens that
were tripping Task 1 criteria 3–4 and contributing extra (avoidable) hits to Task 2 criterion 4. No
behavior changed; the underlying constraints these comments document (case-sensitive matching,
byte-stable non-locale sort, no ordinal-position pairing, no severity field) are unchanged and are
independently verified by the mutation probes and the type-shape check above, not by the wording of
a comment.

## Self-Check

```
FOUND: packages/server/src/lib/schemaDiff.ts
FOUND: packages/server/tests/lib.schemaDiff.spec.ts
FOUND commit: 92b71c1
FOUND commit: c8a233b
FOUND commit: 53ecc6e
```

## Self-Check: PASSED

## Contract for Downstream Plans

Plan 122-04 (the route) and Phases 124/125 should import from
`packages/server/src/lib/schemaDiff.ts`:

```ts
import {
  diffColumnFingerprints, diffResult, baselineRequiredResult, tableMissingResult,
  type SchemaDiff, type AddedColumn, type RemovedColumn, type RetypedColumn,
  type SchemaCheckResult,
} from "./lib/schemaDiff";
```

`tableMissingResult(table)` and `baselineRequiredResult(table, live)` and
`diffResult(table, stored, live)` are the only three ways to construct a `SchemaCheckResult`. The
fourth locked outcome ("could not reach Kinetica") is intentionally NOT a value of this type — Plan
122-04's route must let `kineticaShowTable`'s typed errors (`KineticaAuthError` /
`KineticaPermissionError` / `KineticaUpstreamError`) propagate to the existing `errorMiddleware`
rather than catching them into a `SchemaCheckResult`.

Phase 122 writes nothing to the database anywhere in this plan — `diffColumnFingerprints` and all
three builders are pure functions with no `db`/`express`/`fetch` imports.
