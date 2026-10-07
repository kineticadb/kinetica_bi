---
phase: 130-export-ttl-cleanup-boot-reconciliation-admin-caps
plan: 04
subsystem: server/export
tags: [export, sweep, reconcile, me, wiring]
requires: [130-02, 130-03]
provides:
  - download route claims open downloads, 410 on expired; DELETE via removeExportFiles
  - bootstrap IIFE runs reconcileExportsOnBoot() before listen and startExportSweep() after startSessionSweep()
  - /api/auth/me exportLimits
key-files:
  modified: [packages/server/src/exportRoutes.ts, packages/server/src/index.ts, packages/server/tests/routes.exports.download.spec.ts, packages/server/tests/bootstrap.spec.ts, packages/server/tests/auth.routes.spec.ts]
  created: [packages/server/tests/boot.exportReconcile.spec.ts, packages/server/tests/auth.me.exportLimits.spec.ts]
metrics:
  tasks: 2
  completed: 2026-10-07
---

# Phase 130 Plan 04: Route/boot//me wiring Summary

Plans 01-03 are now live: open downloads are registered in the route's synchronous gate and survive a sweep byte-identical, expired exports refuse with 410, reconcile and sweep run only in the production bootstrap IIFE, and /me carries `exportLimits`.

## Commits
- b522c9e feat(130-04): download route tracks open downloads, 410 on expired; DELETE via removeExportFiles
- 7bbe03c feat(130-04): bootstrap reconcile + export sweep wiring; /me exportLimits

## Ordering evidence
- exportRoutes.ts: `resolveServableExportFile(job)` line 148 < `trackExportDownload(job.id, res)` line 151 < `res.download(` line 154.
- index.ts IIFE: `await createApp();` 3298 < `reconcileExportsOnBoot();` 3301 < `app.listen(port` 3302; `startSessionSweep();` 3308 < `startExportSweep();` 3310.
- Download handler contains 0 occurrences of `await` (my own comment initially contained the word; reworded).

## Probes (all went red, reverted, green)
- M delete `trackExportDownload` line: EXPSWEEP-held-download red.
- N delete `isExportExpired` gate: EXPSWEEP-expired-410 and EXPSWEEP-held-download red.
- O `reconcileExportsOnBoot();` inside createApp after wipeSessionsOnModeChange: EXPBOOT-not-in-createApp AND EXPBOOT-iife red. (First attempt used BSD `sed 0,/re/`, which silently did not apply, so it looked green; redone with python and confirmed the diff applied.)
- P drop `exportLimits: EXPORT_LIMITS` from /me: all 3 EXPLIM-me tests red.

## Verification
- tsc clean. Task 1 specs (download, exports, caps, cleanup): 58 passed. New specs auth.me.exportLimits + boot.exportReconcile: 4 passed.
- bootstrap.spec.ts `-t "bootstrap gate"`: 2 passed (existing regex test and EXPBOOT-iife).
- auth.routes.spec.ts password `/me` test: RED in this checkout, pre-existing and unrelated: the dev `packages/server/.env` leaks DISABLE_DV_FILTER_SCOPE=true, MAX_COMBINATION_VIEWS_PER_TABLE=2, MAX_BAR_GROUP_BY_SERIES=2 (confirmed identical failure on stashed baseline, same diff on those three fields). With those three env vars blanked, it PASSES with the new exportLimits expectation.
- auth.routes.spec.ts oidc `/me` test: RED with `TypeError: Issuer is not a constructor`; identical failure on stashed baseline: pre-existing TD-V11-04, not caused by this change. Assertion not weakened (exportLimits expectation added; cannot be exercised until the issuer mock is fixed).
- `npm run test:gate`: GATE PASSED (only routes.dynamic-view-crud contamination, passes alone).

## Deviations from Plan
None to code. The `exportRoutes.ts` unused imports `fs`/`path`/`exportFilePaths` were removed (tsc clean).

## Self-Check: PASSED
