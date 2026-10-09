---
phase: 128-export-job-core-live-spike-runner-snapshot-cancel
plan: 05
subsystem: server
tags: [export, runner, csv, kinetica, cancel]
requires: ["128-01", "128-03", "128-04"]
provides: [startExport, cancelExport, writeCsv, principalForSession, EXPORT_SESSION_ENDED_MESSAGE]
affects: [128-06, 128-07]
key-files:
  created: [packages/server/src/lib/exportRunner.ts, packages/server/tests/lib.exportRunner.spec.ts, packages/server/tests/lib.exportRunner.memory.spec.ts]
  modified: [packages/server/tests/setup.ts]
requirements: [EXPRT-V126-05, EXPRT-V126-07, EXPRT-V126-16]
completed: 2026-10-06
---

# Phase 128 Plan 05: Export runner Summary

In-process export runner: job-private snapshot MV, COUNT as total_rows, offset-paged batches (advance by rows received, stop only on has_more_records != true), streamed formula-safe CSV to `<jobId>.csv.part`, count self-check, rename, guarded terminal write, best-effort DROP cleanup, cancel registry, per-call session-derived credentials.

## Tasks
1. writeCsv (stream pipeline backpressure) + EXPMEM- specs - 93534ab (together with Task 2, see deviations)
2. Config getters, principalForSession, SessionEndedError, env pins + EXPRUN-principal/env specs - 93534ab
3. Run loop, classification, cancel, 16 EXPRUN- run specs - see git log (feat(128-05) run loop)

## Operator risk: snapshot permission failure
CREATE MATERIALIZED VIEW is wrapped: KineticaPermissionError/KineticaUpstreamError become SnapshotError -> `failed`, `kinetica_error`, message "Could not create the export snapshot: <cause>. Your Kinetica account may not be allowed to create materialized views." A 401 stays `session_expired`. Covered by EXPRUN-snapshot-denied (403) and EXPRUN-snapshot-denied-200 (status ERROR body). Not tested against a real non-admin Kinetica user.

## Discrimination probes (all reverted)
- EXPMEM-lazy-1m and EXPMEM-abort FAIL when the writer buffers everything into one chunk.
- Cached module-level principal: 3 EXPRUN-principal specs FAIL (incl. principal-fresh).
- Stop condition `rows.length < limit`: EXPRUN-short-page-not-end + advance-by-received FAIL.
- Offset advanced by limit: same two FAIL.
- Count check skipped: EXPRUN-row-mismatch FAILS.

## Deviations
- Tasks 1 and 2 share one commit: I wrote the Task 2 getters into exportRunner.ts before committing Task 1.
- Test-design note: kineticaSql itself loops on has_more_records until the batch is full, so a short page reaches the runner only when the server returns an empty page flagged has_more true. EXPRUN-advance-by-received / short-page-not-end use a stateful stub (capped pages, one empty has_more page at offset 17) to make the runner-level behaviour observable; a plain short-page stub would not discriminate.
- Plan's anchor `principalForSession(` >= 3 holds (sql helper, materialize call, cleanup).
- Task 2 spec file has an extra deleteSession dynamic import; harmless.

## Verification
tsc clean; exportRunner specs 21/21 + memory 5/5; `npm run test:gate`: GATE PASSED (8 known failing, 1 isolation-only). Shared docs untouched.

## Self-Check: PASSED
