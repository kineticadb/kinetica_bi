---
phase: 133-ai-contract-shared-package-ssync-f6-fix-spikes
plan: 03
subsystem: api
tags: [security, column-guard, quantile, top-values, column-stats, filter-materialize]
requires: ["133-02"]
provides:
  - "assertSchemaTableColumn in columnGuard.ts"
  - "Tier-B routes (quantile, top-values, column-stats) refuse malformed identifiers / unknown columns on registered tables with 400"
  - "DELETE /api/filter/materialize?viewName= restricted to caller's own filter views (VIEWNAME_NOT_OWNED)"
affects: [133-09]
key-files:
  created:
    - packages/server/tests/routes.column-guard.tier-b.spec.ts
  modified:
    - packages/server/src/lib/columnGuard.ts
    - packages/server/src/index.ts
    - packages/server/tests/lib.columnGuard.spec.ts
    - .planning/phases/133-ai-contract-shared-package-ssync-f6-fix-spikes/133-COLUMN-AUDIT.md
requirements-completed: []
completed: 2026-10-09
---

# Phase 133 Plan 03: Tier-B column guard and DELETE viewName ownership Summary

Quantile, top-values and column-stats now run `assertSchemaTableColumn` (identifier check, plus snapshot membership when the target is a registered table; dv targets with schema "" and unregistered tables still pass), and the DELETE direct-drop branch only accepts the caller's own `_kbi_filt_u<user>_` identifier-shaped names.

AISAFE-V20-01 is NOT marked complete (dv path in 133-09 remains).

## Commits
- 1e38dff test(133-03): failing CG-TB specs
- 72ccfc1 feat(133-03): guards, DELETE ownership check, audit rows flipped

## Red-before evidence
Against unmodified routes: CG-TB1, 2, 4, 5, 7, 8 FAILED; CG-TB3, 6, 9 passed (non-regression).

## Mutation proof
- Quantile `assertSchemaTableColumn` call removed: CG-TB1 and CG-TB2 red (top-values/column-stats cases CG-TB4/5 stayed green since only quantile was mutated).
- DELETE prefix check disabled (`if (false)`): CG-TB7 and CG-TB8 red.
- Both restored; CG-TB 9/9 green.

## Verification
- `tsc --noEmit` clean.
- CG-TB (9), CG-U (incl. new CG-U11..13), CG-OR, routes.quantile, routes.filter-materialize-combo: 54 tests pass across 5 files, no fixture changes needed.
- `node scripts/test-gate.mjs`: GATE PASSED (8 known failing files; 3 others pass alone, contamination).
- Audit rows 6-9 flipped to `guarded (133-03)` (4 occurrences).
- Greps: `assertSchemaTableColumn(` in index.ts = 3, `VIEWNAME_NOT_OWNED` in index.ts = 1.

## Deviations from Plan
None of substance. `authedReq` was already declared before the DELETE direct-drop branch. Added `getTableBySchemaName` to the `./db` import and `SQL_IDENT_RE`/`sanitizeForViewName` imports in index.ts. No grep criterion failed to discriminate; the existing combo DELETE tests used owned names, so no real finding there.

## Notes
- Did not touch STATE/ROADMAP/REQUIREMENTS, 133-SPIKES.md, or 133-08-SUMMARY.md.

## Self-Check: PASSED
Spec file, SUMMARY exist; commits 1e38dff and 72ccfc1 in git log.
