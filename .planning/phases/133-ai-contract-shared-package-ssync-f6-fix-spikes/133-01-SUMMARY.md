---
phase: 133-ai-contract-shared-package-ssync-f6-fix-spikes
plan: 01
subsystem: api
tags: [security, column-guard, ssync-f6, filter-materialize]
requires: []
provides:
  - "packages/server/src/lib/columnGuard.ts (assertColumnsExist, assertIdentifier, tableLabel, UnknownColumnError, InvalidIdentifierError, ColumnGuardError, SQL_IDENT_RE)"
  - "133-COLUMN-AUDIT.md caller inventory"
  - "errorMiddleware maps ColumnGuardError -> 400 toBody()"
affects: [133-02, 133-03, 133-09]
key-files:
  created:
    - packages/server/src/lib/columnGuard.ts
    - packages/server/tests/lib.columnGuard.spec.ts
    - packages/server/tests/routes.column-guard.filter-materialize.spec.ts
    - .planning/phases/133-ai-contract-shared-package-ssync-f6-fix-spikes/133-COLUMN-AUDIT.md
  modified:
    - packages/server/src/index.ts
    - packages/server/src/lib/whereClause.ts
    - packages/server/src/lib/spatialWhereClause.ts
    - packages/server/tests/routes.filter-materialize.spec.ts
    - packages/server/tests/routes.filter-materialize-combo.spec.ts
    - packages/server/tests/routes.filter-materialize-spatial.spec.ts
    - packages/server/tests/routes.filter-materialize-dv.spec.ts
decisions:
  - "Exact-case snapshot membership (hasOwnProperty), empty snapshot rejects all"
  - "No identifier quoting (would change SQL bytes and not reject nonexistent columns)"
requirements-completed: []
duration: ~25min
completed: 2026-10-09
---

# Phase 133 Plan 01: Column guard for filter/materialize (SSYNC-F6 core) Summary

Pure `columnGuard` helper plus a snapshot-membership check on the filter/materialize table path and spatial target, returning 400 `Column "x" no longer exists on fleet.trips` with zero SQL sent; 17-site audit written.

AISAFE-V20-01 is NOT complete after this plan (dv path 133-09, exports/info 133-02, quantile/top-values/stats 133-03 remain), so no requirement is marked complete.

## Commits
- 9482625 docs/test: 133-COLUMN-AUDIT.md + failing CG-FM specs
- 1796672 feat: columnGuard helper + CG-U unit spec
- e17a975: guard wiring, errorMiddleware, comments, fixtures

## Red-before evidence (D-04)
On unmodified route code: CG-FM1, 3, 4, 5, 6, 7, 8 FAILED (status 200 instead of 400; SQL was sent). CG-FM2 passed (non-regression).

## Mutation proof
With the `assertColumnsExist(` call neutralised in index.ts: 7 failed / 1 passed (CG-FM1,3,4,5,6,7,8 red). Restored: 8/8 green.

## Verification
- `tsc --noEmit` clean; CG-U (10) + CG-FM (8) green.
- `node scripts/test-gate.mjs`: GATE PASSED (8 known failing files, all documented).
- Ordering: `assertColumnsExist(` at index.ts:1438 precedes `composeWhereClause(` at :1461. No empty-snapshot bypass.

## Deviations from Plan
**1. [Rule 3 - Blocking] routes.filter-materialize-dv.spec.ts fixture re-seeded.** Plan said the dv spec stays green untouched, but its "TABLE PATH regression" test posts column `zone` against a `columns: {}` table and went red. Changed the shared `seedFixture` to `columns: { zone: "string" }` (dv path does not consult the snapshot). Added file to the commit.

## Issues / Notes
- 4 tests (filter-materialize: DDL TTL=5, 'in' operator, expiresAt; dv: dv path) fail locally ONLY because dev `packages/server/.env` has `DEFAULT_VIEW_TTL_MINUTES=3` (known leak). They fail identically at HEAD before my change and all 38 pass with `DEFAULT_VIEW_TTL_MINUTES=5`. Out of scope.
- During diagnosis I briefly ran `git stash`/`pop` in the shared tree (pop restored immediately); parallel executors' files were untouched afterwards.
- No grep acceptance criterion failed to discriminate.

## Self-Check: PASSED
Files exist (columnGuard.ts, both specs, COLUMN-AUDIT.md); commits 9482625, 1796672 and the task-3 commit present in git log.
