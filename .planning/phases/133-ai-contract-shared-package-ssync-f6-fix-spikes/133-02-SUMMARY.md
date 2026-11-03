---
phase: 133-ai-contract-shared-package-ssync-f6-fix-spikes
plan: 02
subsystem: api
tags: [security, column-guard, exports, info-query]
requires: ["133-01"]
provides:
  - "Exports (table path) and info/query refuse unknown/malformed client columns with 400 before any SQL"
affects: [133-03, 133-09]
key-files:
  created:
    - packages/server/tests/routes.column-guard.other-routes.spec.ts
  modified:
    - packages/server/src/lib/exportSql.ts
    - packages/server/src/exportRoutes.ts
    - packages/server/src/index.ts
    - packages/server/src/lib/spatialQuery.ts
    - packages/server/tests/lib.exportSql.spec.ts
    - packages/server/tests/routes.info-query.spec.ts
    - packages/server/tests/routes.exports.spec.ts
    - .planning/phases/133-ai-contract-shared-package-ssync-f6-fix-spikes/133-COLUMN-AUDIT.md
requirements-completed: []
completed: 2026-10-09
---

# Phase 133 Plan 02: Column guard for exports and info/query Summary

buildExportPlan and POST /api/info/query now check client-supplied columns against the registered table snapshot (400 UNKNOWN_COLUMN / INVALID_IDENTIFIER, no SQL, no export job); dv-backed info popups keep working via identifier-only checks.

AISAFE-V20-01 is NOT complete (133-03 and 133-09 remain), so no requirement is marked.

## Commits
- Task 1 (red specs): `test(133-02): add failing column-guard specs for exports and info/query`
- Task 2: 8dd48a3 `feat(133-02): guard exports and info/query ...`

## Red-before evidence
Against unmodified routes: CG-OR1, 2, 3, 4, 5, 7 FAILED (202/200 instead of 400); CG-OR6 passed (non-regression).

## Mutation proof
- Exports assertion neutralised: CG-OR1 and CG-OR2 red (5 pass). First attempt produced a syntax error ("no tests") and was discarded; redone with a valid no-op call.
- info/query `assertColumnsExist` neutralised: CG-OR3 and CG-OR5 red.
- Both restored; 7/7 green.

## Verification
tsc clean; CG-OR 7/7; info-query, exportSql, routes.exports*, lib.exportRunner* all green (178 tests across 12 files); `node scripts/test-gate.mjs` GATE PASSED (8 known failing files; lib.exportRunner.memory.spec.ts passes alone, contamination).

## Deviations from Plan
**1. [Rule 1 - Bug] Sort-field ordering.** My first guard checked `spec.sortField` before the later `invalid_sort` regex check, so `sortField: "a;b"` returned UNKNOWN_COLUMN instead of `invalid_sort` (caught by EXPRT129-validate and EXPSQL-sort-invalid). Fix: only well-formed (EXPORT_IDENT_RE) sort fields enter the snapshot check; malformed ones still yield `invalid_sort`. Plan text said `spec.sortField !== ""`; this is a narrowing, not a loosening of the guard.
**2. Fixtures re-seeded** (as planned): info-query seedFixture columns, routes.exports.spec table columns, lib.exportSql getTable stub. Export-runner and caps/download specs needed no change.
**3. Cosmetic:** reformatted the assert call so acceptance grep `assertColumnsExist(row.columns` matches (it was multi-line first).

## Notes
- Audit rows 4 and 5 flipped to `guarded (133-02)`; residuals unchanged.
- No grep criterion failed to discriminate.

## Self-Check: PASSED
Spec file, SUMMARY, and commit 8dd48a3 exist; Task 1 commit present in git log.
