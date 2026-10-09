---
phase: 130-export-ttl-cleanup-boot-reconciliation-admin-caps
verified: 2026-10-07T17:00:00Z
status: passed
score: 4/4 must-haves verified
---

# Phase 130: Export TTL Cleanup, Boot Reconciliation & Admin Caps Verification Report

**Phase Goal:** The whole export subsystem is durable across restarts and over time: nothing stuck "running", nothing orphaned on disk, admin caps via env config alone.
**Status:** passed. **Re-verification:** No.

## Observable Truths (ROADMAP criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Jobs/files deleted after the TTL; restart leaves nothing "running" | VERIFIED | `lib/exportCleanup.ts` has `startExportSweep` and `reconcileExportsOnBoot`. `index.ts` calls the reconcile before `listen` and starts the sweep after. TTL comes from `EXPORT_TTL_HOURS` in `lib/exportCaps.ts`. |
| 2 | No orphaned export file after boot | VERIFIED | `reconcileExportsOnBoot` returns `{failed, orphansRemoved, unrecognised}`. It is covered by specs, and the server gate passes. |
| 3 | A sweep never deletes a file an active download holds open | VERIFIED (operator-approved) | `trackExportDownload` and `isExportDownloading` exist. The operator approved the live held-open smoke at the 130-06 checkpoint on 2026-10-07. |
| 4 | Row/size/concurrency caps stop the export and tell the user | VERIFIED | `lib/exportCaps.ts` holds the cap messages. The runner enforces the caps (slot check at `exportRunner.ts` ~229). `/me` exposes `exportLimits`, and the web store keeps them. |

## Post-checkpoint review fixes (verified in code)
- Cancel frees the concurrency slot: `exportRunner.ts` ~229-230 ignores aborted controllers when counting. This is the accepted trade-off.
- `trackExportDownload` has a `res.destroyed` early return (`exportCleanup.ts:25`).
- The size message reads "passed the N size limit after about N rows" (`exportCaps.ts:53`). This is the operator-approved wording.
- Password login calls `fetchMe` and then does one `set({...meToState(me)})` (`web/src/store/auth.ts` ~92-101).
- `EXPORT_MAX_TTL_HOURS = 87_600` is applied to `EXPORT_TTL_HOURS` (`exportCaps.ts:30-32`).

## Wiring and hygiene
- `reconcileExportsOnBoot` and `startExportSweep` are called only in the `index.ts` bootstrap IIFE (lines 3301 and 3310). A grep of `src` shows no calls in `createApp`.
- `git status` is clean.
- The branch diff against master has no `.env`, `.pem` or secret files.

## Requirements
| ID | Status |
|----|--------|
| EXPRT-V126-14 | SATISFIED. Ticked in REQUIREMENTS.md. |
| EXPRT-V126-15 | SATISFIED. Ticked in REQUIREMENTS.md. |
| EXPRT-V126-05 / 07 | Remain unticked, as intended (Phase 131). |

Every plan frontmatter ID is accounted for, and there are no orphaned requirements.

## Gates (run by verifier)
- Server `tsc --noEmit`: clean.
- Server `npm run test:gate`: 1739/1794 tests pass; 9 files fail. 8 are on the known-failing list. `routes.branding.spec.ts` is not on the list; it passes alone, so it is TD-V16-TEST-ISOLATION contamination. The gate reports PASSED.
- Web `tsc --noEmit`: clean.
- Web vitest on `auth.spec.ts`, `exportLimits.spec.ts` and `theme-guard.spec.ts`: 3 files, 184 tests passed.

## Known accepted items (not gaps)
- Open debt carried to Phase 131: proxy-path resume, widget-action overrides, snapshot isolation under a changing table.
- The cancel-slot trade-off: Cancel frees the slot while the in-flight Kinetica call still finishes.
- The "after about N rows" wording refines the locked "progress at the cut" wording (operator-approved).

## Anti-patterns
None blocking found in the files reviewed.

_Verified: 2026-10-07 — Claude (gsd-verifier)_
