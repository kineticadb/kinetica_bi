---
phase: 260607-fk4-add-configurable-csv-download-to-records
plan: 01
subsystem: frontend/records-table
tags: [csv-export, records-table, widget-renderer, config-fields]
dependency_graph:
  requires: []
  provides: [FK4-CSV-01]
  affects: [packages/web/src/components/charts/WidgetRenderer.tsx, packages/web/src/components/charts/definitions/records.ts]
tech_stack:
  added: []
  patterns: [TDD-red-green, pure-helper-module, paged-fetch-with-abort, blob-anchor-download]
key_files:
  created:
    - packages/web/src/lib/csvExport.ts
    - packages/web/src/lib/csvExport.spec.ts
  modified:
    - packages/web/src/components/charts/definitions/records.ts
    - packages/web/src/components/charts/WidgetRenderer.tsx
    - packages/web/src/components/charts/WidgetRenderer.spec.tsx
    - packages/web/src/styles/global.css
decisions:
  - enableCsvDownload defaults true (opt-out); only cfg.enableCsvDownload === false hides the button
  - csvDownloadRowCap clamped defensively at export time (Math.max(1, Math.floor(...))); no panel-layer clamp
  - columnOrder drives export column list when populated (on-screen order with real names); falls back to effectiveColumns
  - capped flag set only when all.length === cap AND last page was full (rows.length === limit); prevents false cap toast on exactly-N-row datasets
  - Abort signal threaded into runSql for paged export; unmount cleanup effect aborts via ref; second click aborts prior controller before starting fresh
  - typeof document guard around Blob/anchor download for jsdom test safety
metrics:
  duration: 4 minutes
  completed: "2026-06-07T15:21:59Z"
  tasks: 3
  files: 6
---

# Phase 260607-fk4 Plan 01: Add Configurable CSV Download to Records Table Summary

Configurable "Download CSV" button added to the Records Table renderer: paged export via `/api/sql` with AbortController, RFC-4180 CSV assembly client-side, timestamped sanitized filename, cap-with-toast, and full TDD coverage.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Pure CSV helper + spec (TDD RED→GREEN) | 94d31c4 | csvExport.ts, csvExport.spec.ts |
| 2 | Add enableCsvDownload + csvDownloadRowCap config fields to records.ts | 2746a2f | definitions/records.ts |
| 3 | Wire Download CSV button + paged export into RecordsTableRenderer | 6bc394c | WidgetRenderer.tsx, WidgetRenderer.spec.tsx, global.css |

## Key Decisions

1. **enableCsvDownload defaults true (opt-out):** `cfg.enableCsvDownload !== false` — the button appears unless explicitly disabled, consistent with the plan's "no permission gate" requirement.
2. **Cap detection:** `capped = true` only when `all.length === csvDownloadRowCap && rows.length === limit`. A dataset with exactly N rows returns a non-full last page (rows.length < limit), so no false cap toast fires.
3. **columnOrder for export columns:** When `columnOrder` is populated (set by the page-fetch effect from either `effectiveColumns` or response keys), it drives the export column list and order. Falls back to `effectiveColumns` on edge case.
4. **AbortController ref pattern:** `exportAbortRef` holds the current controller. Unmount cleanup effect calls `.abort()`. A second click while exporting aborts the prior controller before creating a new one.

## Verification

- `cd packages/web && npx tsc --noEmit` — clean (no type errors)
- `cd packages/web && npx vitest run src/lib/csvExport.spec.ts` — 20/20 tests pass
- `cd packages/web && npx vitest run src/components/charts/WidgetRenderer.spec.tsx` — 69/69 tests pass
- `cd packages/web && npx vitest run` — 1593/1593 tests pass (79 files), all green

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- packages/web/src/lib/csvExport.ts: FOUND
- packages/web/src/lib/csvExport.spec.ts: FOUND
- packages/web/src/components/charts/definitions/records.ts: contains enableCsvDownload — FOUND
- packages/web/src/components/charts/WidgetRenderer.tsx: contains "Download CSV" — FOUND
- Commits 94d31c4, 2746a2f, 6bc394c: FOUND in git log
