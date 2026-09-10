---
phase: 76-column-formatting-editor-ui
plan: "01"
subsystem: frontend/components
tags: [column-formatting, editor-modal, tdd, theme-tokens]
dependency_graph:
  requires:
    - packages/web/src/lib/columnFormatter.ts (Phase 75 — buildFormatter, defaultFormatKind, FormatSpec)
    - packages/web/src/store/columnDisplayConfigStore.ts (Phase 75 — loadConfig, upsertColumn, removeColumn)
    - packages/web/src/api/client.ts (Phase 75 — upsertColumnDisplayConfig, deleteColumnDisplayConfig)
  provides:
    - packages/web/src/components/ColumnFormatEditorModal.tsx (two-pane editor modal)
    - packages/web/src/components/ColumnFormatEditorModal.spec.tsx (10 component tests)
  affects:
    - DatasetsPage.tsx (Plan 76-02 will mount this component)
tech_stack:
  added: []
  patterns:
    - Two-pane modal (mirror DynamicViewsModal: overlay/content/header/ESC/dirty-guard)
    - Per-column working state map + baseline snapshot for dirty tracking
    - TDD: 10 component tests covering COLEDIT-V115-02/03
    - buildFormatter live preview (fixed samples, no Kinetica fetch)
key_files:
  created:
    - packages/web/src/components/ColumnFormatEditorModal.tsx
    - packages/web/src/components/ColumnFormatEditorModal.spec.tsx
  modified: []
decisions:
  - "Single-file component with sub-components (ColumnEditorForm, NumberControls, DateControls, D3Controls) — avoids prop-drilling complexity for working-state updates while keeping all logic colocated"
  - "defaultSpecForKind builder produces sensible defaults per kind (number: thousandsSep=true/decimals=2; date: preset=iso; d3: specifier='')"
  - "Baseline snapshot approach for dirty tracking (JSON.stringify comparison) — straightforward for flat FormatSpec objects"
  - "Toast store reset omitted in test setup (useToastStore has no reset method) — spy pattern used instead"
metrics:
  duration: "~25min"
  completed: "2026-06-20"
  tasks: 3
  files_created: 2
  files_modified: 0
  tests_added: 10
  tests_total: 2529
---

# Phase 76 Plan 01: Column Format Editor Modal Summary

**One-liner:** Two-pane column formatting editor modal with label input, kind picker (None/Number/Date/d3), conditional controls, live preview via buildFormatter, and Save to Phase 75 global config.

## What Was Built

`ColumnFormatEditorModal.tsx` — a FRONTEND-ONLY two-pane modal component:

- **Left pane:** scrollable list of all `table.columns` entries with column name, Kinetica type, and a dot badge for columns with saved config. Auto-selects the first column on open.
- **Right pane:** per-column editor form with:
  - Display label input (placeholder = raw column name; clearing = no-label)
  - Format kind picker: None / Number / Date / Advanced (d3-format)
  - **Number controls:** thousands separator, decimal places, currency toggle + symbol (default `$`), percent toggle (appends literal `%`, no ×100)
  - **Date controls:** 6-option preset dropdown (iso/us/long/us_time/long_time/custom) + custom pattern input when preset=`custom`
  - **d3 controls:** specifier input + `.config-hint` noting `%` does ×100 here (unlike Number percent)
  - **Live preview:** fixed samples (`1234567.891` / `"2026-06-19T13:45:00Z"`) through `buildFormatter(workingSpec)`, updates on every control change
  - **Save button:** `btn-primary`, disabled when `!isDirty || saving`

- **Modal mechanics** (mirror DynamicViewsModal): `modal-overlay`/`modal-content`/`modal-header`/`modal-title`, ESC handler, click-outside close, dirty-guard `window.confirm("Discard unsaved changes?")`
- **Load on open:** `loadConfig(table.id)` on mount; seeds working state from store + `defaultFormatKind`
- **Save handler:** iterates dirty columns; calls `deleteColumnDisplayConfig` + `removeColumn` for `kind:none + empty label`; calls `upsertColumnDisplayConfig` + `upsertColumn` otherwise. Re-baselines on success; error toast on failure; `isDirty` preserved on error.

## Tests

`ColumnFormatEditorModal.spec.tsx` — 10 tests covering all COLEDIT-V115-02/03 behaviors:

| Test | Coverage |
|------|----------|
| T1 | Label input placeholder = raw column name |
| T2 | Typing a label + clearing leaves empty with raw-name placeholder |
| T3 | Kind → Number shows decimals + percent + thousands controls |
| T4 | Kind → Date shows 6-option preset dropdown |
| T5 | Kind → Advanced shows specifier input + ×100 hint |
| T6 | Live preview changes when control changes (percent toggle appends %) |
| T7 | Save disabled when clean; enabled after edit |
| T8 | Save calls upsertColumnDisplayConfig + upsertColumn with exact args |
| T9 | kind:none + empty label → deleteColumnDisplayConfig + removeColumn |
| T10 | Rejected upsert → error toast; modal stays open; isDirty preserved |

## Verification Gates

- `npx tsc --noEmit`: **clean**
- `npx vitest --run`: **2529/2529 passed** (108 test files)
- `npx vitest --run src/styles/theme-guard.spec.ts`: **51/51 passed** — `ColumnFormatEditorModal.tsx` NOT in allowlist
- `grep -nE '#[0-9a-fA-F]{3,6}\b' src/components/ColumnFormatEditorModal.tsx`: **no results**
- `git diff --name-only | grep packages/server`: **no server files**

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] useToastStore has no `reset()` method**
- **Found during:** Task 2 RED phase (test setup)
- **Issue:** Spec `beforeEach` called `useToastStore.getState().reset()` — the toast store has no reset method (the zustand shim resets all stores via `vi.mock("zustand")` in setup.ts)
- **Fix:** Removed `useToastStore.getState().reset()` from `beforeEach`; spy pattern used for toast assertions
- **Files modified:** `ColumnFormatEditorModal.spec.tsx`

### Notes

- Tasks 2 (right-pane editor form) and 3 (Save handler) were implemented in the same commit as Task 1's component file because the architecture was complete in one pass. The spec was written RED first (10 failures confirmed), then the single fix (toast.reset removal) made all 10 tests GREEN — consistent with TDD intent.

## Commits

| Hash | Message |
|------|---------|
| 9bc92b5 | feat(76-01): modal shell + column list + load-on-open + close guards |
| e41f423 | feat(76-01): right-pane editor + Save handler + component tests (Tasks 2+3) |

## Self-Check: PASSED

- FOUND: packages/web/src/components/ColumnFormatEditorModal.tsx
- FOUND: packages/web/src/components/ColumnFormatEditorModal.spec.tsx
- FOUND: .planning/phases/76-column-formatting-editor-ui/76-01-SUMMARY.md
- FOUND commit 9bc92b5 (Task 1)
- FOUND commit e41f423 (Tasks 2+3)
