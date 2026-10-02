---
phase: 127-row-limit-ceiling-caller-audit-heatmap-truncation-fix
plan: 04
subsystem: web-records-table
tags: [csv-export, has_more_records, truncation-notice]
requires: [127-01, 127-02, 127-03]
provides: [has_more-driven CSV loop, csvInBrowserMaxRows clamp, records-limited-note]
key-files:
  modified:
    - packages/web/src/components/charts/WidgetRenderer.tsx
    - packages/web/src/components/charts/WidgetRenderer.spec.tsx
metrics:
  tasks: 2
  files: 2
completed: 2026-10-02
---

# Phase 127 Plan 04: Records CSV export fix Summary

RecordsTableRenderer CSV download now pages on the server's has_more_records signal, clamps the cap by the admin ceiling, reports "Downloaded the first N of M rows", shows progress, and flags server-cut record pages.

## Commit
- `150216c` feat(127-04): both tasks in one commit (they edit the same two files interleaved, so they were not split).

## Changes
- Loop exit: `hasMore !== true && rows.length < limit` (plus `rows.length === 0` guard). Short page with has_more=true keeps paging; missing field falls back to the old short-page rule.
- `csvDownloadRowCap = min(widget cap, useAuthStore.csvInBrowserMaxRows)`.
- Toast "Downloaded the first N of M rows" (or "... rows (row cap reached)" when total unknown) only when cap reached AND rows left out; "Capped at" removed.
- Button: `Exporting… N rows` via `exportedRows` state.
- Count SQL now `FROM ${fromSource}${cw}` (+ `cw` in deps) so M matches the shown rows.
- `pageLimitedTo` state and `records-limited-note` (`config-hint`, no new class) when page response has has_more_records=true.

## Verification
- RED at HEAD: 6 of 8 RLCSV tests failed (continue-on-has-more, ceiling-clamp, cap-message, no-false-cap, progress, count-cw); stop-when-exhausted and legacy-short-page passed (they pin retained behaviour).
- Mutation probes, all restored via cp: (a) old short-page break -> continue-on-has-more + progress fail; (b) remove Math.min ceiling -> ceiling-clamp fails; (c) leftOut=reachedCap -> no-false-cap fails (and continue-on-has-more); (d) drop ${cw} -> count-cw fails; RLREC probe (setter always null) -> RLREC-limited fails.
- tsc clean; WidgetRenderer.spec + theme-guard green (291). Full web vitest: 4206 pass, 1 fail: `NumericLineRenderer.spec RLD16-nl-own-limit` (plan 127-05's in-progress work, not touched here).
- Acceptance greps: "Capped at" 0 in tsx; RLCSV- = 8, RLREC- = 3 in spec.

## Deviations
None for the code. Note: the old spec test titled "cap behavior + toast ... 'Capped at 2 rows'" was rewritten as RLCSV-cap-message; no test asserts the old text except an absence check.

## Items for the 127-07 human checkpoint (not auto-verifiable)
- Real >1,000-row CSV from a live table returns all rows up to cap.
- `Exporting… N rows` label fits the footer button without layout shift.
- `Limited to N rows` note renders legibly in both themes (inline style margin/nowrap on existing `config-hint`).

## Self-Check: PASSED
