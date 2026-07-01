---
phase: 100
plan: "01"
subsystem: custom-metrics-editor
tags: [custom-metrics, modal, CRUD, frontend-only, METRIC-V119-01]
dependency_graph:
  requires: [99-02 (customMetricsStore + api CRUD)]
  provides: [CustomMetricsEditorModal, DatasetsPage Custom metrics button]
  affects: [DatasetsPage.tsx]
tech_stack:
  added: []
  patterns: [two-pane-modal (mirror ColumnFormatEditorModal), zustand configVersion subscription, cancelled-guard useEffect, 409-inline-error]
key_files:
  created:
    - packages/web/src/components/CustomMetricsEditorModal.tsx
    - packages/web/src/components/CustomMetricsEditorModal.css
    - packages/web/src/components/CustomMetricsEditorModal.spec.tsx
  modified:
    - packages/web/src/components/DatasetsPage.tsx
decisions:
  - "Save disabled unless both label.trim() and expression.trim() are non-empty (not just dirty-check)"
  - "409 duplicate-label surfaced as inline .custom-metrics-editor-error — real CSS rule in CustomMetricsEditorModal.css, not phantom config-hint-warning"
  - "Delete handler uses listCustomMetrics mock (not store pre-seed) in spec to avoid loadConfig overwrite race"
  - "Metric rows in left pane use role=button + tabIndex (keyboard accessible); mode=idle shows empty-state placeholder"
metrics:
  duration_seconds: 521
  completed_date: "2026-07-01"
  tasks_completed: 3
  tasks_total: 3
  files_created: 3
  files_modified: 1
---

# Phase 100 Plan 01: CustomMetricsEditorModal + DatasetsPage wiring Summary

**One-liner:** Two-pane CRUD modal for authoring custom metrics per table, reached from the Tables area, using Phase 99 customMetricsStore + api CRUD, with 409 duplicate-label inline error.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Create CustomMetricsEditorModal + CSS | 3d4b936 | CustomMetricsEditorModal.tsx, CustomMetricsEditorModal.css |
| 2 | Wire Custom metrics button into DatasetsPage | 67e5cd6 | DatasetsPage.tsx |
| 3 | Component spec — CRUD lifecycle + 409 inline error | 7feabea | CustomMetricsEditorModal.spec.tsx |

## What Was Built

`CustomMetricsEditorModal` is a two-pane modal mirroring `ColumnFormatEditorModal`:

- **Left pane:** label-sorted list of the table's custom metrics (from `selectMetrics(table.id)` subscribed via `configVersion`) + an "Add metric" ghost button at the bottom.
- **Right pane:** edit/new form with Label (text input), SQL expression (textarea), optional default format (FormatSpecEditor kind picker + NumberControls/DateControls/D3Controls/SIControls), inline error display, and Save + Delete actions.
- **Load:** `useCustomMetricsStore.getState().loadConfig(table.id)` on mount with cancellation guard.
- **Save:** calls `createCustomMetric` or `updateCustomMetric`; updates store via `upsertMetric`; toasts on success; surfaces server 409 message as `formError` rendered in `.custom-metrics-editor-error` (real CSS rule — `color: var(--danger)`).
- **Delete:** `window.confirm` guard → `deleteCustomMetric` → `removeMetric` from store; toasts on success.
- **Close:** dirty-guard (`window.confirm`) + ESC key listener.

`DatasetsPage.tsx` `TableDetail` gains a "Custom metrics" `ghost-sm` button after "Format columns", and conditional `<CustomMetricsEditorModal table={table} onClose={...}/>` render.

## Verification

- `tsc --noEmit`: clean
- `vitest run src/styles/theme-guard.spec.ts`: 136/136 passed
- `vitest run src/components/CustomMetricsEditorModal.spec.tsx`: 4/4 passed
- `vitest run` (full suite): 3119/3119 passed (135 files)
- `git diff --name-only packages/server`: empty (FRONTEND-ONLY)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] T4 spec: loadConfig overwrote pre-seeded store**

- **Found during:** Task 3 (first spec run)
- **Issue:** The spec tried `useCustomMetricsStore.getState().setConfig(10, [row])` before rendering, but `loadConfig` on mount called `listCustomMetrics` (mocked to return `[]`) and overwrote the store — leaving the list empty.
- **Fix:** Changed T4 to stub `listCustomMetrics` to return `[row]` so `loadConfig` populates the store correctly.
- **Files modified:** CustomMetricsEditorModal.spec.tsx
- **Commit:** 7feabea

## Self-Check: PASSED

- `packages/web/src/components/CustomMetricsEditorModal.tsx` — FOUND
- `packages/web/src/components/CustomMetricsEditorModal.css` — FOUND
- `packages/web/src/components/CustomMetricsEditorModal.spec.tsx` — FOUND
- Commit 3d4b936 — FOUND
- Commit 67e5cd6 — FOUND
- Commit 7feabea — FOUND
