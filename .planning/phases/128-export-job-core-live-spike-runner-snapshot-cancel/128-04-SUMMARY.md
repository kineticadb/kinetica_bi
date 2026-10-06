---
phase: 128-export-job-core-live-spike-runner-snapshot-cancel
plan: 04
subsystem: server
tags: [export, sql, kinetica, paging]
requires: ["128-02"]
provides: [buildExportPlan, buildHeaderProbeSql, buildBatchRequest, ExportSpecError, EXPORT_PAGING_MECHANISM]
affects: [128-05, 128-06]
key-files:
  created:
    - packages/server/src/lib/exportSql.ts
    - packages/server/tests/lib.exportSql.spec.ts
decisions:
  - "EXPORT_PAGING_MECHANISM = offset (approved spike); paging_table branch still implemented and tested"
metrics:
  completed: 2026-10-06
---

# Phase 128 Plan 04: Export SQL layer Summary

Pure server-side SQL builder that rebuilds an export from the persisted records widget plus a validated filter snapshot (snapshot MV body, COUNT, header probe, offset-paged batch with composite ORDER BY tiebreak).

## Tasks
1. Plan builder, source resolution, snapshot/count SQL, 21 EXPSQL specs - c8a7a23
2. Header probe, batch request for both mechanisms, 8 more specs (29 total) - bf02faa

## Decisions honoured
- Q-C: columns = cfg.columns in order (IDENT_RE-filtered), `[]` (SELECT *) when empty.
- Q-D: widget-action overrides not applied (documented in module header; Phase 131 follow-up).
- paging_table_ttl emitted as string minutes (spike notes: "not applicable", accepted as string).

## Verification
- `npx tsc --noEmit` clean; `tests/lib.exportSql.spec.ts` 29/29.
- `npm run test:gate`: GATE PASSED (8 failing files, all in the known set).
- Discrimination probe: flipping the constant to paging_table made EXPSQL-mechanism-matches-spike FAIL; reverted, passes.
- Acceptance greps verified against the final files (EXPSQL- count 29, composeWhereClause/buildServerWhereClause present, `_kbi_exp_` present).

## Deviations from Plan
None in behaviour. One execution slip: a BSD `sed -i` probe edit briefly clobbered the `ExportPagingMechanism` union to `"offset" | "offset"`, caught by tsc and restored before commit.

Notes: spatial pair-completeness is `(spatialFilters.length > 0) !== (spatialTarget !== null)` (an empty shapes array with a target is rejected). Multi-filter WHERE is whatever buildServerWhereClause emits (ANDed, not individually parenthesised); the filter group as a whole and customWhere are each parenthesised. Shared docs (STATE/ROADMAP/REQUIREMENTS) untouched per instructions.

## Self-Check: PASSED
