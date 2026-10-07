---
phase: 130-export-ttl-cleanup-boot-reconciliation-admin-caps
plan: 03
subsystem: server/export
tags: [export, ttl, sweep, reconcile]
requires: [130-01]
provides:
  - lib/exportCleanup.ts (tracker, removeExportFiles, sweep, boot reconcile)
affects: [130-04]
key-files:
  created: [packages/server/src/lib/exportCleanup.ts, packages/server/tests/lib.exportCleanup.spec.ts]
metrics:
  tasks: 2
  completed: 2026-10-07
---

# Phase 130 Plan 03: Export cleanup module Summary

Open-download refcount, synchronous TTL sweep with unref'd interval, and never-throwing boot reconciliation (interrupted jobs failed with `server_restarted`, own-name orphan files removed).

## Exported signatures (for 130-04)

```typescript
// packages/server/src/lib/exportCleanup.ts
export const isExportDownloading = (id: string): boolean;
export function trackExportDownload(id: string, res: { once(event: "close", listener: () => void): unknown }): void; // call before res.download, same sync turn as the status/file gate
export function removeExportFiles(job: Pick<ExportJob, "id" | "filePath">): void; // errors propagate; DELETE route should call this
export const EXPORT_SWEEP_INTERVAL_MS = 5 * 60_000;
export function runExportSweepOnce(): { deleted: number; skippedOpen: number }; // sync
export function startExportSweep(): NodeJS.Timeout; // first pass immediately, then interval, handle.unref()
export function reconcileExportsOnBoot(): { failed: number; orphansRemoved: number; unrecognised: number }; // call once in index.ts bootstrap before listen, not createApp
export const __resetExportDownloadsForTest = (): void;
```

## Commits
- 27f6d65 feat(130-03): tracker, sweep, and reconcile module + EXPSWEEP- specs
- 0069fda test(130-03): EXPBOOT specs

## Discrimination probes (all went red, reverted, green)
- G remove open-download skip: EXPSWEEP-open-download red.
- H `close` -> `finish`: EXPSWEEP-tracker-refcount and -open-download red.
- I remove `released` guard: EXPSWEEP-tracker-refcount and -open-download red.
- J job-id-prefix keep rule instead of exact filename: EXPBOOT-orphans red.
- K drop `!d.isFile()`: EXPBOOT-foreign-untouched red.
- L drop `isExportRunLive` filter in step 1: EXPBOOT-skip-live red.

## Honest limit
Unit tests prove the structural precondition (refcount skip, synchronous sweep). The live race against a real held-open HTTP download is ROADMAP criterion 3, covered by Plan 130-04 integration test and the Plan 130-06 human check.

## Verification
tsc clean; 19 spec tests green; `npm run test:gate` GATE PASSED (only 130-02's in-progress caps specs flagged as isolation contamination, pass alone).

## Deviations from Plan
- Task 1 commit already contained the reconcile code (module written in one pass); Task 2 commit adds only its tests. Behavior unchanged.
- During probing, a failed backup left probe mutations stacked in the file once; the module was restored from the original and probes J-L re-run with a git-backed copy. Final file matches commit 27f6d65.
- The acceptance-criterion awk for "no await/async/Promise in runExportSweepOnce" was not an issue; the function body contains none.

## Self-Check: PASSED
