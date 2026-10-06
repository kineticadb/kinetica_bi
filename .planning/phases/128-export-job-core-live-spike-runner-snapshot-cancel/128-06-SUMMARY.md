---
phase: 128-export-job-core-live-spike-runner-snapshot-cancel
plan: 06
subsystem: server
tags: [export, cancel, session, tests]
requires: ["128-05"]
provides: [EXPCANCEL specs, EXPSESS specs]
affects: [128-07]
key-files:
  created: [packages/server/tests/lib.exportRunner.cancel.spec.ts, packages/server/tests/lib.exportRunner.session.spec.ts]
  modified: []
requirements: [EXPRT-V126-07, EXPRT-V126-16]
completed: 2026-10-06
---

# Phase 128 Plan 06: Cancel and session fail-closed specs Summary

Six EXPCANCEL- and eight EXPSESS- specs pin runner cancel (abort stops the loop, partial file removed, cancel after complete refused) and session-bound credentials (logout/expiry between batches, Kinetica 401, URL mismatch, fresh principal per call, no secret in the row, no expiry touch). The specs passed against the existing runner on first run; no defects found and exportRunner.ts is unchanged.

## Tasks
1. EXPCANCEL- specs (6) - de2fca6
2. EXPSESS- specs (8) - 9813aaf

## Discrimination probes (all reverted)
- Commenting out `ac.abort()` in cancelExport: EXPCANCEL-mid-run and EXPCANCEL-before-start FAIL. (The plan's wording was "no-op returning true"; this is the same effect.)
- Per-job cached principal: EXPSESS-logout-between-batches and EXPSESS-expires-mid-run FAIL.
- KineticaAuthError no longer mapped to session_expired: EXPSESS-kinetica-401 FAILS.

## Deviations
- None to code. EXPCANCEL-race-finalize is deliberately tolerant (complete+file OR cancelled+no file) per the plan; the discrimination is the never-inconsistent invariant, not a specific winner.
- EXPCANCEL-mid-run asserts the `.part` file exists (polled) before cancelling.

## Verification
tsc clean; four lib.exportRunner* spec files 40/40; `npm run test:gate`: GATE PASSED (8 known failing files, none new). Shared docs untouched.

## Self-Check: PASSED
