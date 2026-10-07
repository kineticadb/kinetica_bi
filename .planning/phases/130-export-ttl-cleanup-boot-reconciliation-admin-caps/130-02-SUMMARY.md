---
phase: 130-export-ttl-cleanup-boot-reconciliation-admin-caps
plan: 02
subsystem: server/export
tags: [export, caps, concurrency, row-cap, size-cap]
requires: [130-01]
provides:
  - startExport per-user concurrency cap (ExportCapError -> POST /api/exports 429)
  - row cap (RowCapError) right after snapshot COUNT; size cap (byteCap Transform after gzip)
key-files:
  created: [packages/server/tests/lib.exportRunner.caps.spec.ts, packages/server/tests/routes.exports.caps.spec.ts]
  modified: [packages/server/src/lib/exportRunner.ts, packages/server/src/exportRoutes.ts]
metrics:
  tasks: 2
  completed: 2026-10-07
---

# Phase 130 Plan 02: Runner caps Summary

Enforces EXPRT-V126-15 in the runner: concurrency check inside synchronous startExport (429 `concurrency_cap`), row cap thrown right after setExportJobTotalRows (line 317, before `fs.createWriteStream(partPath` at line 338), and a `byteCap` Transform placed after `createGzip()` that fails `size_cap` mid-write with the partial deleted and `rowsWritten = rowsAtCut`.

## Commits
- Single commit containing both tasks' source + both new specs (the specs were authored together, so the per-task split was not practical): see `git log` "feat(130-02): per-user concurrency cap ...".

## Discrimination probes (all fired red, reverted, green)
- A (check moved after insert, into run): 5 EXPCAP-conc tests red incl. route-race and sync-pair.
- B (`>=` -> `>`): 5 conc tests red incl. sync-pair and route-race.
- C (case-sensitive count SQL): EXPCAP-conc-case-insensitive red.
- D (RowCapError check moved after writeCsv): EXPCAP-row-over red.
- E (byteCap before createGzip): EXPCAP-size-gzip-measures-compressed red.
- F (SizeCapError.name = "AbortError"): EXPCAP-size-raw and EXPCAP-size-gzip-over red.

## Existing specs touched
None needed (all existing export specs, 127 tests across 10 files, green with the default cap of 2).

## Verification
- tsc clean; `npm run test:gate` GATE PASSED (routes.management contamination-only, passes alone).
- Note: tests pin `KINETICA_MAX_RECORDS_PER_CALL=20000` for size-cap tests so each batch exceeds 1 MB raw.

## Deviations from Plan
None.

## Self-Check: PASSED
