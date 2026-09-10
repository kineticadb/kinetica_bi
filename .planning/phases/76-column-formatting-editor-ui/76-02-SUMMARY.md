---
phase: 76-column-formatting-editor-ui
plan: "02"
subsystem: frontend/components
tags: [column-formatting, entry-point, datasets-page, integration-test]
dependency_graph:
  requires:
    - packages/web/src/components/ColumnFormatEditorModal.tsx (Phase 76 Plan 01)
    - packages/web/src/components/DatasetsPage.tsx (existing — modified)
  provides:
    - packages/web/src/components/DatasetsPage.tsx (Format columns button + conditional modal mount on TableDetail)
    - packages/web/src/components/DatasetsPage.spec.tsx (6 integration tests for the entry point)
  affects:
    - Phase 77 (COLAPPLY) — now has a reachable per-table editor from Tables area
tech_stack:
  added: []
  patterns:
    - Conditional modal mount gated by boolean state (mirror DashboardsPage DynamicViewsModal pattern)
    - vi.mock capturing props via globalThis (mirror DashboardsPage.spec.tsx DVM pattern)
key_files:
  created:
    - packages/web/src/components/DatasetsPage.spec.tsx
  modified:
    - packages/web/src/components/DatasetsPage.tsx
decisions:
  - "Additive-only change to TableDetail: ghost-sm button before Back in actions fragment; no structural changes to list/edit/create modes"
  - "Fragment wrapper <> around actions buttons — required when two sibling buttons are passed to ChartCard's actions prop"
  - "Modal placed as sibling of ChartCard inside dashboard-list wrapper — mirrors DashboardsPage conditional DynamicViewsModal placement"
metrics:
  duration: "~10min"
  completed: "2026-06-20"
  tasks: 1
  files_created: 1
  files_modified: 1
  tests_added: 6
  tests_total: 2535
---

# Phase 76 Plan 02: Format Columns Entry Point Summary

**One-liner:** Additive wire-up of ColumnFormatEditorModal into TableDetail (view mode) via a ghost-sm "Format columns" button + boolean state gate, closing COLEDIT-V115-01 (editor reachable from Tables area).

## What Was Built

`DatasetsPage.tsx` — additive changes to `TableDetail` only:

- **Import:** `ColumnFormatEditorModal` imported at top of file
- **State:** `const [showFormatEditor, setShowFormatEditor] = useState(false)` added to `TableDetail`
- **Button:** `ghost-sm` "Format columns" button placed BEFORE Back in the `ChartCard` actions fragment; `onClick={() => setShowFormatEditor(true)}`
- **Modal mount:** `{showFormatEditor && <ColumnFormatEditorModal table={table} onClose={() => setShowFormatEditor(false)} />}` as sibling of ChartCard inside `.dashboard-list`

No other views (list/edit/create) changed. No raw hex added. No server files touched.

`DatasetsPage.spec.tsx` — 6 integration tests:

| Test | Coverage |
|------|----------|
| T1 | "Format columns" button present on TableDetail screen |
| T2 | ColumnFormatEditorModal NOT rendered before button click |
| T3 | Clicking button renders ColumnFormatEditorModal stub |
| T4 | Modal stub receives correct `table` prop (id + name match selected table) |
| T5 | Modal stub receives `onClose` function prop |
| T6 | Calling `onClose` hides the modal (showFormatEditor → false) |

## Verification Gates

- `npx tsc --noEmit`: **clean**
- `npx vitest --run src/components/DatasetsPage.spec.tsx src/styles/theme-guard.spec.ts`: **57/57 passed**
- `npx vitest --run`: **2535/2535 passed** (109 test files)
- `grep -nE '#[0-9a-fA-F]{3,6}\b' src/components/DatasetsPage.tsx`: **no results**
- `git diff --name-only | grep packages/server`: **no server files**
- COLEDIT-V115-01 entry-point requirement: **CLOSED** — editor is reachable from Tables area via "Format columns" on TableDetail

## Deviations from Plan

None — plan executed exactly as written.

## Commits

| Hash | Message |
|------|---------|
| 4048985 | feat(76-02): wire ColumnFormatEditorModal entry point into TableDetail |

## Self-Check: PASSED

- FOUND: packages/web/src/components/DatasetsPage.tsx (modified)
- FOUND: packages/web/src/components/DatasetsPage.spec.tsx (created)
- FOUND commit 4048985
