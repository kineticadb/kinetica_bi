---
phase: 141-keep-persist-ai-changes
plan: 03
subsystem: server
tags: [refs, keep, temp-id-remap]
requires: []
provides:
  - allowNegative option on the single ref traversal
  - collectSignedWidgetConfigRefs, remapTempRefs, remapTempFilterSelection, UnmappedTempRefError
affects: [141-06, 141-07]
key-files:
  modified: [packages/server/src/lib/dashboardExportRefs.ts]
  created: [packages/server/tests/lib.dashboardExportRefs.negative.spec.ts]
requirements: [AISES-V20-05]
gaps: []
---

# Phase 141 Plan 03: Negative-aware ref traversal Summary

The one shared ref traversal (REF-1..9 + filterSelection) now accepts `{ allowNegative: true }`, and three Keep helpers sit on top of it. Unmapped temp ids throw `UnmappedTempRefError` instead of being persisted or stripped.

## Task 1 (commit d7dc7ee)
- Added `asRefId` (non-zero integer), `VisitOptions`, and an optional `opts` parameter on `visitFilterSelectionRefs` and `visitWidgetConfigRefs`. `idOf = opts?.allowNegative ? asRefId : asId` replaces each `asId(` call in those two functions. `asId` itself is untouched.
- Keep helpers:
  - `collectSignedWidgetConfigRefs` collects every site, negatives included, and never mutates its input.
  - `remapTempRefs` maps negative ids and passes positive ids through unchanged.
  - `remapTempFilterSelection` does the same for a filterSelection object or JSON string.
  - Negative table or customMetric ids always throw.

## RED (before implementation, stubs in place)
`Test Files 1 failed (1) / Tests 6 failed | 1 passed (7)`. The one pass is NEGREF-1, which asserts that default behaviour is unchanged, so it cannot go red by design. NEGREF-2 to NEGREF-7 failed against the stubs.

## GREEN
The new spec plus the five existing specs (dashboardExportRefs, dashboardImportRefs, dashboardImport.apply, dashboardImport.validate, dashboardExport), none edited: 6 files passed, 139 tests passed. `npx tsc --noEmit` is clean.

Acceptance counts:
- `allowNegative` occurs 8 times in the traversal file (>=3).
- The four exports are present (count 4).
- `NEGREF-` occurs 7 times in the spec.

## Deviations from Plan
None. The plan was executed as written.

## Notes
The acceptance criterion "NEGREF-1 default unchanged" passes before the work. That is intended, as a regression guard, and it is not a discriminating proof. The discriminating proofs are NEGREF-2 to NEGREF-7, which were red first.

## Self-Check: PASSED
