---
phase: 128-export-job-core-live-spike-runner-snapshot-cancel
plan: 07
subsystem: export
tags: [kinetica, export, live-smoke, bookkeeping]
requires: ["128-01..06"]
provides:
  - "Live runner evidence (complete / cancel / session-end) against real Kinetica"
  - "Phase 128 recorded in ROADMAP / REQUIREMENTS / STATE"
affects: [129, 130, 131]
tech-stack:
  added: []
  patterns: ["in-memory SQLite + dynamic import smoke script"]
key-files:
  created: [packages/server/src/spikes/exportRunnerSmoke.ts]
  modified: [packages/server/package.json, .planning/phases/128-export-job-core-live-spike-runner-snapshot-cancel/128-SPIKE-NOTES.md, .planning/ROADMAP.md, .planning/REQUIREMENTS.md, .planning/STATE.md]
key-decisions:
  - "Operator Q-A..Q-D recorded; Q-D (widget-action overrides not in export) is a Phase 131 follow-up"
  - "D-04a/b verified: no Phase 127 follow-up"
metrics:
  completed: 2026-10-06
---

# Phase 128 Plan 07: Live runner smoke and bookkeeping Summary

Live smoke of the export runner against demo.nyctaxi (500k rows) passed complete, cancel and session-end; all gates are green; shared planning docs were edited by hand.

## Task commits
1. Task 1 (smoke script, npm script, notes): 520c03e
2. Task 2 (docs): committed in the final docs commit.

## Live smoke results (admin, demo.nyctaxi, mechanism offset)
- S1 PASS: total_rows = rows_written = independent COUNT(*) = 500000; header equals the 3 configured columns; CSV-aware record count 500001; 16,636,920 bytes in 10.1 s (~49k rows/s); snapshot gone afterwards.
- S2 PASS: cancelled at ~20000 rows, no file.
- S3 PASS: session deleted mid-export, session_expired with the D-16 message at 40000/500000 rows, no file; runner logged cleanup skipped (no further Kinetica call).
- Cleanup: all three `_kbi_exp_*` snapshots (and `_pg` names) dropped and verified gone. The S3 snapshot is intentionally left by the runner (no credentials) and was dropped by the smoke; in production its TTL is the backstop (Phase 130 sweep by `_kbi_exp_` prefix).
- Not tested live: source table changing during the job (read-only, D-02). Structural guarantee: all reads come from the job-private MV (REFRESH OFF). Also not tested: non-admin user without CREATE MATERIALIZED VIEW.

## Gates
- Server: `npx tsc --noEmit` clean; `npm run test:gate` PASSED (1620/1674 tests; 8 known-failing files; tests/routes.dynamic-view.spec.ts failed in full run, passes alone = contamination).
- Web: `npx tsc --noEmit` clean; `npx vitest run` 186 files / 4232 tests passed; theme-guard 154 passed.

## Deviations from Plan
1. **Phase checkbox not ticked (orchestrator instruction overrides plan).** The plan's acceptance criterion `grep -c "\[x\] \*\*Phase 128:" ROADMAP.md = 1` is intentionally NOT met: the orchestrator marks the phase complete after verification. Likewise STATE `completed_phases` stays 1 and status is `phase_128_executed_pending_verification`; the headline says "plans COMPLETE 7/7, pending phase verification". The seven 128-0N plan lines are ticked (7). total_plans/completed_plans 7 -> 14.
2. Requirements EXPRT-V126-04/05/07/16 marked Complete per plan. Note EXPRT-V126-05 and -07 also have user-facing halves in Phase 131 (UI); the runner side is what Phase 128 proves.
3. Smoke script also drops snapshots the runner could not (S3), so the leftover check is meaningful.

## Self-Check: PASSED
- exportRunnerSmoke.ts present; commit 520c03e present; grep counts: `[x] 128-0` = 7, EXPRT checkboxes = 4, "Phase 128 outcome" = 1, "Phase 125 Plan 01 COMPLETE" = 1 (STATE not rewritten wholesale).
