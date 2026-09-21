---
phase: 122-schema-diff-table-missing-detection
plan: 02
subsystem: database
tags: [sqlite, better-sqlite3, migration, schema-sync]

# Dependency graph
requires: []
provides:
  - "tables.columns_fingerprint — nullable TEXT sibling column, PRAGMA-guarded ALTER for pre-v1.25 installs"
  - "getTableColumnsFingerprint(id) — SELECT-only accessor returning raw TEXT or null"
affects: [122-03, 122-04, 125]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "PRAGMA-guarded ALTER on `tables` mirrors the existing `dashboards`/`dashboard_layers`/`brand_config` idempotent-migration pattern"
    - "Sibling column instead of reshaping an existing payload column, to keep an unrelated export/import contract at zero diff"

key-files:
  created:
    - packages/server/tests/db.schemaFingerprintColumn.spec.ts
  modified:
    - packages/server/src/db.ts

key-decisions:
  - "columns_fingerprint is a sibling TEXT column on tables, never a reshape of the existing columns column — keeps Table, mapTable, dashboardExport.ts and dashboardImport.ts at zero diff"
  - "No DEFAULT on the new column — NULL is the meaningful 'no precise baseline yet' state; a DEFAULT '{}' would destroy that distinction and make old vs. new format indistinguishable"
  - "getTableColumnsFingerprint returns the raw TEXT unparsed by design — decoding belongs to lib/schemaFingerprint.ts (122-01), so db.ts stays ignorant of the fingerprint's internal shape"
  - "No writer shipped — Phase 122 is read-only by construction (SSYNC-V125-05); Phase 125's apply step owns writing this column"

patterns-established:
  - "A future sibling-column migration for `tables` can copy this block (DDL comment + PRAGMA guard placed after the `filter_display_mode` block) verbatim"

requirements-completed: [SSYNC-V125-05]

duration: ~20min
completed: 2026-09-21
---

# Phase 122 Plan 02: Schema Fingerprint Column Summary

**`tables.columns_fingerprint` nullable TEXT sibling column (fresh-install DDL + PRAGMA-guarded ALTER for existing installs) plus a read-only `getTableColumnsFingerprint` accessor — zero writer, zero diff to `Table`/`mapTable`/export/import.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 1 (TDD: RED then GREEN)
- **Files modified:** 2 (1 test file created, 1 source file modified)

## Accomplishments
- `tables` gains a nullable `columns_fingerprint TEXT` column on both fresh installs (`SCHEMA_DDL`) and pre-v1.25 databases (new PRAGMA-guarded `ALTER TABLE tables ADD COLUMN`, placed immediately after the existing `filter_display_mode` block, copying its exact shape)
- `getTableColumnsFingerprint(id): string | null` — a SELECT-only accessor, deliberately unparsed
- Confirmed NO writer exists anywhere in `db.ts` for this column (Phase 125 owns it)
- Confirmed zero diff to `Table` (`src/types.ts`), `mapTable`, `dashboardExport.ts`, `dashboardImport.ts`
- All 6 named mutation probes fired against their intended tests on the first attempt — no probe or test needed strengthening

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): add failing tests for columns_fingerprint column + accessor** — swept into `ed4fc16` (see "Deviations from Plan" — a concurrent plan's commit unintentionally absorbed this file via a shared-working-tree race; content and RED status were independently confirmed before and after)
2. **Task 1 (GREEN): implement columns_fingerprint column + accessor** - `4c4e59b` (feat)

_No plan-metadata commit yet — this SUMMARY plus STATE/ROADMAP updates are the orchestrator's responsibility per this plan's ownership rule._

## Files Created/Modified
- `packages/server/tests/db.schemaFingerprintColumn.spec.ts` - 6 tests: fresh install, pre-v1.25 migration (byte-identical `columns`), idempotency, and 3 accessor cases (never-fingerprinted, raw-verbatim, unknown-id)
- `packages/server/src/db.ts` - `columns_fingerprint TEXT` added to the `tables` DDL with an inline rationale comment; a PRAGMA-guarded `ALTER TABLE tables ADD COLUMN columns_fingerprint TEXT` block for existing installs; `getTableColumnsFingerprint` accessor added directly after `getTableBySchemaName`

## Decisions Made
- Followed the plan's action steps verbatim (DDL comment text, ALTER-block comment text, accessor JSDoc) — no discretion exercised beyond what "Claude's Discretion" in 122-CONTEXT.md already delegated to the plan author.

## Deviations from Plan

### Environmental — not a code deviation

**Shared-working-tree commit race with the concurrent 122-01 executor.** Plans 122-01 and 122-02 ran in parallel in the *same* checkout (not separate worktrees). After I staged only `packages/server/tests/db.schemaFingerprintColumn.spec.ts` and ran `git commit`, the commit reported "nothing to commit" — the file had already been swept into 122-01's own `git add`/commit cycle (`ed4fc16 feat(122-01): implement pure schemaFingerprint parser`) between my `add` and my `commit`. The file's content is exactly what this plan's RED step wrote (verified via `git diff ed4fc16 -- <path>` = empty after the fact), and RED status (6/6 failing before `db.ts` was touched) was independently confirmed via `npx vitest run` output captured before any implementation edit. No fix was needed — this is a bookkeeping/attribution artifact of the shared tree, not a functional issue. Recording it here so the missing standalone `test(122-02): ...` commit doesn't look like a skipped step. The GREEN implementation commit (`4c4e59b`) is my task's own, isolated to `packages/server/src/db.ts`.

**Two transient, non-reproducing `test-gate.mjs` failures caused by the concurrent executor's in-progress edits**, both self-resolved and confirmed unrelated to this plan's code:
- First gate run: `tests/kinetica.showTable.options.spec.ts` reported "STILL FAILS alone." Re-run immediately afterward in isolation: 3/3 passed. A second full gate run passed with only TD-V16-class contamination. Root cause: 122-01 had an uncommitted, in-progress edit to `src/kinetica.ts` at that instant (confirmed via `git status`/`git diff --stat` showing `kinetica.ts` dirty).
- Later gate run: `tests/lib.schemaFingerprint.spec.ts` reported "STILL FAILS alone" while `src/lib/schemaFingerprint.ts` and its own spec were simultaneously dirty (122-01 mid-edit). To rule out my own change as the cause, I `git stash`ed only `packages/server/src/db.ts`, re-ran the gate (a *different* file — my own, now-uncolumned test — was the sole real failure, as expected without the column), then restored the stash and re-ran once more: **GATE PASSED**, only TD-V16-class contamination remained. This isolates the failure to the concurrent, uncommitted edit and rules out `db.ts` as the cause.

No `KNOWN_FAILING` entry was added — per the plan's explicit instruction, and correctly, since these were momentary states of a file this plan never touches, not a new permanent failure mode.

## Issues Encountered

None beyond the environmental race documented above. All 6 mutation probes fired against their named tests on the first attempt (see table below) — no fixture or probe strengthening was required.

## Mutation Probe Results

| # | Mutation | Target test | Result |
|---|----------|--------------|--------|
| M1 | `columns_fingerprint TEXT NOT NULL DEFAULT '{}'` in the DDL | "fresh install: tables has a columns_fingerprint column, nullable, defaulting to NULL" | **Reddened as expected.** Also reddened the "never-fingerprinted returns null" accessor test as collateral (a freshly-inserted row now gets `'{}'` instead of `NULL`) — expected given the invariant both tests protect. |
| M2 | Delete the PRAGMA-guarded ALTER block (DDL change kept) | "pre-v1.25 database: createDb adds columns_fingerprint without touching existing rows" | **Reddened exactly this test**, no collateral — `PRAGMA table_info(tables)` on the upgraded pre-v1.25 file no longer lists `columns_fingerprint`. |
| M3 | Drop the `if (!tableColNames.has(...))` guard; run the ALTER unconditionally | "idempotent: calling createDb twice on the same file does not throw" | **Reddened catastrophically** — since fresh installs already create the column via `CREATE TABLE`, the unconditional `ALTER TABLE tables ADD COLUMN` throws `SqliteError: duplicate column name` at module-import time (`db = createDb(defaultDbPath)` runs at import), failing the entire test file's suite load, the idempotency test included. |
| M4 | Accessor `JSON.parse`s the value before returning | "getTableColumnsFingerprint returns the raw TEXT verbatim, unparsed" | **Reddened exactly this test**, no collateral — `{ vendor_id: 'char(4)' }` (object) !== `'{"vendor_id":"char(4)"}'` (string). |
| M5 | Accessor returns `""` instead of `null` when the row has no fingerprint | "getTableColumnsFingerprint returns null for a row that has never been fingerprinted" | **Reddened exactly this test**, plus expected collateral on "returns null for an unknown table id" (`??` also coalesces the `undefined` unknown-id case to `""`). |
| M6 | Migration also runs `UPDATE tables SET columns='{}'` | "pre-v1.25 database: createDb adds columns_fingerprint without touching existing rows" | **Reddened exactly this test**, no collateral — `row.columns` no longer matches the byte-identical lossy fixture value. |

All 6/6 probes fired against their intended named test(s) on the first attempt. No probe was weakened; no test needed strengthening.

## Acceptance Criteria Verified

All greps re-run from `packages/server` immediately before implementation (confirming stated BEFORE values), then after:

1. `grep -c "columns_fingerprint" src/db.ts` = 8 (>= 4 required). BEFORE (tree-wide `src/ tests/`): 0.
2. `grep -c "SELECT columns_fingerprint FROM tables" src/db.ts` = 1. BEFORE: 0.
3. `grep -c "PRAGMA table_info(tables)" src/db.ts` = 1. BEFORE: 0.
4. `grep -c "columns_fingerprint" src/types.ts` = 0.
5. `git diff --name-only` (post-implementation) = `packages/server/src/db.ts` only — no `types.ts`, no `dashboardExport.ts`, no `dashboardImport.ts`.
6. `grep -cE "UPDATE tables SET columns_fingerprint|setTableColumnsFingerprint" src/db.ts` = 0.
7. `npx vitest run tests/lib.dashboardExport.spec.ts tests/lib.dashboardImport.apply.spec.ts` — 44/44 passed.
8. `npx vitest run tests/db.schemaFingerprintColumn.spec.ts` — 6/6 passed.
9. `npx tsc --noEmit` — clean.

## Server Gate (SET-BASED)

Final clean run: `node scripts/test-gate.mjs` → **GATE PASSED**. Same 8 documented `KNOWN_FAILING` entries as before this plan (`auth.oidc`, `auth.routes`, `boot.hardening`, `boot.wipe`, `bootstrap`, `db.smoke`, `oidc.module`, `routes.wms`) — the failing set did not grow. Two additional files surfaced as TD-V16-TEST-ISOLATION contamination on that run (`routes.dashboard-import.spec.ts`, `routes.dynamic-view-crud.spec.ts`), both confirmed passing in isolation, consistent with the existing documented contamination class. `packages/web` untouched (`git diff --name-only | grep -c '^packages/web/'` = 0).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

`tables.columns_fingerprint` and `getTableColumnsFingerprint` are ready for 122-03/122-04 (the diff engine) to consume as the "does this table have a precise baseline" check, and for Phase 125 to eventually write to via its apply step. No blockers.

## Self-Check: PASSED

- FOUND: `packages/server/tests/db.schemaFingerprintColumn.spec.ts`
- FOUND: `packages/server/src/db.ts`
- FOUND commit: `ed4fc16` (absorbed the RED test file per the documented race)
- FOUND commit: `4c4e59b` (GREEN implementation, isolated to `db.ts`)
- `grep -c "columns_fingerprint" packages/server/src/db.ts` = 8
- `getTableColumnsFingerprint` present in `db.ts`

---
*Phase: 122-schema-diff-table-missing-detection*
*Completed: 2026-09-21*
