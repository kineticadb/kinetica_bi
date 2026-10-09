---
phase: 127-row-limit-ceiling-caller-audit-heatmap-truncation-fix
plan: 01
subsystem: server/kinetica
tags: [row-limit, kinetica, execute-sql, paging]
requires: []
provides:
  - getRowLimitConfig / DEFAULT_MAX_ROWS_PER_QUERY / DEFAULT_MAX_RECORDS_PER_CALL exports in kinetica.ts
  - kineticaSql envelope limit 20,000 by default, clamped, split into ordered batch calls
  - has_more_records / total_number_of_records on the kineticaSql return value
affects: [127-02, 127-03, phase 128]
key-files:
  modified:
    - packages/server/src/kinetica.ts
    - packages/server/tests/kinetica.sql.spec.ts
    - packages/server/tests/routes.sql.spec.ts
    - packages/server/tests/setup.ts
    - packages/web/src/components/charts/WidgetRenderer.tsx
    - packages/web/src/components/charts/WidgetRenderer.spec.tsx
  created:
    - packages/server/tests/kinetica.rowLimit.spec.ts
decisions:
  - Clamp lives inside kineticaSql (offset/limit spread last) so every caller is bound
  - has_more_records, never a short page, is the only continuation signal (D-11)
metrics:
  tasks: 3
  completed: 2026-10-02
---

# Phase 127 Plan 01: Row-limit ceiling in kineticaSql Summary

kineticaSql now defaults to a 20,000-row envelope limit (KINETICA_MAX_ROWS_PER_QUERY), clamps every caller's limit to it, splits larger limits into ordered calls of at most KINETICA_MAX_RECORDS_PER_CALL rows, and surfaces Kinetica's has_more_records / total_number_of_records, which the web parseKineticaResponse now ignores.

## Commits
- 1b8567f Task 1: response metadata surfacing + METADATA_KEYS
- 4bb3ccd Task 2: ceiling env + clamp + test env neutralisation
- 6486170 Task 3: batch splitting + has_more continuation + warn-once

## Mutation probes (all restored from backups)
- T1 web: RLMETA-1 FAILED (timeout, 0 rows decoded) against the original two-entry METADATA_KEYS before the change; passes after.
- T1 server: removing the has_more_records copy failed ROWLIM-meta-1.
- T2 (a) `limit: 1000` back: ROWLIM-default, -env, -invalid, -clamp, -pin, -nonpositive, options pass-through, ROWLIM-route-clamp failed.
- T2 (b) remove Math.min clamp: did NOT fail (see deviation 1); after adding ROWLIM-clamp-below-batch the probe fails that test.
- T2 (c) spread extra after offset/limit: ROWLIM-clamp, -nonpositive, -offset, ROWLIM-route-clamp failed.
- T3 (a) unconditional break: ROWLIM-split-2, -truncated, -remainder, -baseoffset, -multicol, d11-short-page, d11-once, split-error failed.
- T3 (b) `n < callLimit` break: ROWLIM-d11-short-page and d11-once failed.
- T3 (c) remove once-flag: ROWLIM-d11-short-page and d11-once failed.
- T3 (d) reverse concat: ROWLIM-split-2 and ROWLIM-split-multicol failed.
- T3 (e) drop `n === 0` guard: loop never terminates (microtask-only mock), the run hangs/is killed rather than reporting a clean named failure. Detected as a failure by hang; the 2s test timeout cannot fire because the loop never yields to timers.

## Deviations from Plan

**1. [Rule 2 - Missing coverage] Clamp probe (b) could not discriminate**
- Issue: with batch == max (20000), the per-call `Math.min(..., maxRecordsPerCall)` masks a missing max clamp, so ROWLIM-clamp / ROWLIM-route-clamp passed with the clamp removed.
- Fix: added ROWLIM-clamp-below-batch (max 5000, batch 20000, client limit 9000 -> 5000); probe now fails it.
- Commit: 6486170

**2. [Rule 1 - Test fixture] ROWLIM-meta-1 needed `extra: { limit: 2 }`**
- A single-Response mock with has_more_records true and a short page correctly triggers continuation (D-11) and consumed the body twice. The test now passes limit 2 so the page is full.

## Notes
- Acceptance greps: `KINETICA_MAX_RECORDS_PER_CALL` count in kinetica.ts and others were verified by behaviour tests rather than counts.
- Row-order stability across split calls without a unique ORDER BY is undocumented by Kinetica; left as a code comment for the live checkpoint / Phase 128 spike.

## Verification
- server `tsc --noEmit` clean; `node scripts/test-gate.mjs` PASSED (8 known-failing, 2 contamination-only files pass in isolation).
- web `tsc --noEmit` clean; WidgetRenderer.spec.tsx 127/127.

## Self-Check: PASSED
