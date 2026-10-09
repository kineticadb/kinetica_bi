---
phase: 128-export-job-core-live-spike-runner-snapshot-cancel
plan: 03
subsystem: server
tags: [sqlite, export-jobs, kinetica]
requires: []
provides:
  - export_jobs table + CRUD with write-once terminal status (db.ts)
  - KineticaPrincipal type accepted by kineticaSql / createOrReplaceMaterialized
affects: [128-05, 128-06]
key-files:
  created: [packages/server/tests/db.exportJobs.spec.ts]
  modified: [packages/server/src/db.ts, packages/server/src/kinetica.ts, packages/server/src/lib/materializedView.ts]
requirements: [EXPRT-V126-07, EXPRT-V126-16]
completed: 2026-10-06
---

# Phase 128 Plan 03: Export job registry + KineticaPrincipal Summary

export_jobs SQLite registry with CHECK-constrained statuses and a single-statement guarded finalizeExportJob (cancel after complete is refused), plus a type-only KineticaPrincipal widening so background jobs can call Kinetica without an Express req.

## Tasks
1. export_jobs DDL + 7 CRUD functions + 10 EXPDB- specs (exact 17-column list guards against credential columns).
2. KineticaPrincipal = Pick<AuthedRequest,"user"|"requestId">; buildAuthHeader, kineticaSql and CreateOrReplaceMaterializedArgs.req use it. Zero runtime change.

## Verification
tsc clean; db.exportJobs, kinetica.rowLimit, db.syncHistory specs pass (51 tests). Task 2 diff-guard printed nothing. Full `npm run test:gate` not run (parallel executors in the same tree).

## Deviations from Plan
None. Shared docs (STATE/ROADMAP/REQUIREMENTS) untouched per instructions; 128-07 owns them.

## Self-Check: PASSED
