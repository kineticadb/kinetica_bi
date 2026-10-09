---
phase: 131-client-export-ui-trigger-dialog-progress-history
plan: 07
subsystem: web-ui
tags: [exports, records-widget, trigger]
requires: [131-02, 131-05]
key-files:
  modified:
    - packages/web/src/components/charts/WidgetRenderer.tsx
    - packages/web/src/components/charts/WidgetRenderer.spec.tsx
requirements: [EXPRT-V126-05, EXPRT-V126-06]
completed: 2026-10-07
---

# Phase 131 Plan 07: WidgetRenderer trigger + dialog mount Summary

Records footer Download now branches: count known and at or below the cap keeps the one-click in-browser download; count above the cap or unknown (null) opens ExportDialog, whose request builder reads filters/dvFilters/shapes via getState() at click time and passes the table's sort.

## Commits
- 09ccee5 Task 1: handleDownloadClick, buildExportBody, ExportDialog mount, imports (RecordsTableRenderer only)
- 01b13fa Task 2: spec adjustments + 6 EXPTRIG tests

## Task 1 observed failures (before Task 2)
Only 2 of the 10 candidate tests went red: RLCSV-ceiling-clamp and RLCSV-cap-message (count 10 > cap). The other eight passed by timing but were racy; Task 2 added a count-resolved wait to all of them anyway.

## Task 2
- Mock factory gained startExport/cancelExportJob/getExportJob; exportDownload.startExportDownload mocked; afterEach(stopAllExportTracking).
- rlcsvSetup: count wait before click, `opts.viaDialog` (asserts dialog, clicks "Download first N rows now") else asserts no dialog. Ceiling-clamp and cap-message use `{ viaDialog: true }`; their original assertions are unchanged.
- "export issues SELECT", RLCSV-progress, abort-on-unmount: count wait only.
- New: EXPTRIG-under-cap, -over-cap, -unknown-count, -request, -override-note, -close.
- No `expect(` removed (git diff: 0 removed expect lines); all six preserved literal strings still present.

## Probes (red, reverted, green)
- P1 `totalCount === null ||` removed: EXPTRIG-unknown-count red
- P2 config lacking filterSelection/sort in buildExportRequest: EXPTRIG-request red
- P3 branch always opens dialog: EXPTRIG-under-cap plus 8 CSV tests red

## Gates
- web tsc clean; full vitest 198 files / 4356 tests pass; theme-guard 158 pass; WidgetRenderer.spec 153 pass.
- className check on WidgetRenderer.tsx: `OK 23 tokens` before and after (missing set empty, unchanged).
- `recordsTableFilters` count 2 before and after.
- No fake-timer leak observed in the full run.

## Notes
- Overlay-merged config is what RecordsTableRenderer sees, so the builder's `cfg` includes overlay keys; D-04 saved-settings semantics are enforced server-side and surfaced via the dialog note.
- Visual/layout verification of the dialog stays with Plan 131-10's checkpoint.

## Deviations from Plan
None. Shared docs untouched; no gsd-tools mutation run.

## Self-Check: PASSED
