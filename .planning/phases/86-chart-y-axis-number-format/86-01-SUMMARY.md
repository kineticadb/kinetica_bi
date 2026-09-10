---
phase: 86-chart-y-axis-number-format
plan: 01
subsystem: charts/config-panels
tags: [frontend, chart, formatter, config-panel, refactor]
dependency_graph:
  requires: [85-01]
  provides: [FormatSpecEditor, TimelineConfig.yAxisFormat, NumericLineConfig.yAxisFormat]
  affects: [TimelineConfigPanel, NumericLineConfigPanel, ColumnFormatEditorModal]
tech_stack:
  added: []
  patterns: [FormatSpec extraction, optional config field threading (groupByColumn precedent)]
key_files:
  created:
    - packages/web/src/components/charts/FormatSpecEditor.tsx
    - packages/web/src/components/charts/FormatSpecEditor.spec.tsx
  modified:
    - packages/web/src/components/ColumnFormatEditorModal.tsx
    - packages/web/src/components/charts/TimelineConfigPanel.tsx
    - packages/web/src/components/charts/TimelineConfigPanel.spec.tsx
    - packages/web/src/components/charts/NumericLineConfigPanel.tsx
    - packages/web/src/components/charts/NumericLineConfigPanel.spec.tsx
decisions:
  - Extracted all 4 *Controls + defaultSpecForKind into FormatSpecEditor.tsx (full extraction vs partial)
  - FormatSpecEditor.onChange accepts FormatSpec|null; null=clear-to-default; ColumnFormatEditorModal re-imports helpers (pure refactor)
  - yAxisFormat: undefined (field absent) = cleared/no-override; never { kind:"none" } for clear
  - Y-AXIS FORMAT section rendered in OPTIONS block after existing toggles/fields
metrics:
  duration_seconds: 326
  completed_date: "2026-06-26"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 5
---

# Phase 86 Plan 01: FormatSpecEditor extraction + Y-axis format config wiring Summary

**One-liner:** Extracted `FormatSpecEditor` (kind picker + NumberControls/DateControls/D3Controls/SIControls + defaultSpecForKind) from `ColumnFormatEditorModal` into a shared component, then wired it as an optional `yAxisFormat?: FormatSpec` field in both `TimelineConfig` and `NumericLineConfig` with set/clear semantics.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Extract FormatSpecEditor + re-import into ColumnFormatEditorModal | f8d66f0 | FormatSpecEditor.tsx (new), FormatSpecEditor.spec.tsx (new), ColumnFormatEditorModal.tsx (refactored) |
| 2 | Add yAxisFormat field + Y-AXIS FORMAT section to both config panels | 5d871ab | TimelineConfigPanel.tsx, NumericLineConfigPanel.tsx, both .spec.tsx files |

## What Was Built

### Task 1: FormatSpecEditor (shared extracted component)

`packages/web/src/components/charts/FormatSpecEditor.tsx` exports:
- `FormatSpecEditor`: kind `<select>` with a leading "— Use column default —" option (`value=""`), then None/Number/Date/Advanced/Smart abbreviation. `spec=null` → `""` selected, no controls. Selecting `""` → `onChange(null)`. Selecting a kind → `onChange(defaultSpecForKind(kind))`.
- `NumberControls`, `DateControls`, `D3Controls`, `SIControls`: zero-logic-change extractions from `ColumnFormatEditorModal.tsx`
- `defaultSpecForKind`: zero-logic-change extraction from `ColumnFormatEditorModal.tsx`

`ColumnFormatEditorModal.tsx` was refactored to import the above 5 names and remove the local definitions. The modal's own kind picker (which has no "Use column default" option and operates on `FormatSpec` not `FormatSpec|null`) and its live preview / label field are **unchanged**.

### Task 2: Config panel wiring

Both `TimelineConfig` and `NumericLineConfig` gain:
```typescript
yAxisFormat?: FormatSpec;  // Phase 86: per-widget Y-axis tick formatter override. Absent → bound column default.
```

Both config panels render a "Y-AXIS FORMAT" section in OPTIONS using the pattern:
```tsx
<div className="config-group-label" style={{ marginTop: 16 }}>Y-AXIS FORMAT</div>
<FormatSpecEditor spec={yAxisFormat} onChange={(s) => patch({ yAxisFormat: s ?? undefined })} />
<div className="config-hint">Applied to the Y-axis tick labels only...</div>
```

Clear semantics: when `s === null` → `patch({ yAxisFormat: undefined })`. Field absent = no override = renderer falls back to column default (Plan 02).

## Test Coverage

| Spec file | Tests | New tests added |
|-----------|-------|-----------------|
| FormatSpecEditor.spec.tsx | 4 | 4 (all new) |
| ColumnFormatEditorModal.spec.tsx | 11 | 0 (unchanged, all still green) |
| TimelineConfigPanel.spec.tsx | 26 | 3 (Y1/Y2/Y3) |
| NumericLineConfigPanel.spec.tsx | 21 | 3 (Y1/Y2/Y3) |

**Total: 62 tests across 4 files — all green.**

## Verification Results

- `tsc --noEmit`: CLEAN (0 errors)
- `vitest run` (all 4 target spec files): 62/62 PASS
- `vitest run src/styles/theme-guard.spec.ts`: 128/128 PASS
- `git diff --name-only packages/server`: empty (FRONTEND-ONLY confirmed)
- `grep -c "function defaultSpecForKind" ColumnFormatEditorModal.tsx`: 0 (local definition removed)
- No invented CSS class names introduced

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- FormatSpecEditor.tsx: FOUND
- FormatSpecEditor.spec.tsx: FOUND
- 86-01-SUMMARY.md: FOUND
- Commit f8d66f0: FOUND
- Commit 5d871ab: FOUND
