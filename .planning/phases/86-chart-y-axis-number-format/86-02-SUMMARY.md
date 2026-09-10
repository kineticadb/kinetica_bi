---
phase: 86-chart-y-axis-number-format
plan: 02
subsystem: charts/renderers
tags: [frontend, chart, formatter, renderer, tickFormatter]
dependency_graph:
  requires: [86-01]
  provides: [TimelineRenderer.yAxisTickFormatter, NumericLineRenderer.yAxisTickFormatter]
  affects: [TimelineRenderer, NumericLineRenderer]
tech_stack:
  added: []
  patterns: [useMemo hybrid-resolution (override-or-column-default), recharts tickFormatter]
key_files:
  created: []
  modified:
    - packages/web/src/components/charts/TimelineRenderer.tsx
    - packages/web/src/components/charts/TimelineRenderer.spec.tsx
    - packages/web/src/components/charts/NumericLineRenderer.tsx
    - packages/web/src/components/charts/NumericLineRenderer.spec.tsx
decisions:
  - Single formatter applied to all value axes (metrics[0].column as the primary Y-axis column) — per research recommendation; per-metric resolution deferred
  - Static source assertions used in specs (not recharts SVG rendering) because recharts SVG layout is fragile in JSDOM; formatter invocation proven via direct ESM import of buildFormatter
key_decisions:
  - Hybrid resolution: cfg.yAxisFormat present → buildFormatter override; absent + tableId/metricColumn → resolveFormatter column-default; else identity String(v ?? "")
  - configVersion included in useMemo deps so column-default refreshes on column display-config edit
  - width={60} bumped to width={64} on all horizontal YAxis value elements to avoid clipping "−1.23G"
  - ColumnFormatTooltip.tsx untouched — tooltip isolation is a hard constraint (AXIS-V117-03)
metrics:
  duration_seconds: 271
  completed_date: "2026-06-26"
  tasks_completed: 2
  tasks_total: 2
  files_created: 0
  files_modified: 4
---

# Phase 86 Plan 02: Renderer Y-axis tickFormatter wiring Summary

**One-liner:** Wired hybrid yAxisTickFormatter useMemo (per-widget override via buildFormatter, else bound-column default via resolveFormatter, else identity) into both TimelineRenderer and NumericLineRenderer, applying it to all 4 type="number" value axes per renderer via recharts tickFormatter, while leaving tooltips and bucket/category axes untouched.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | TimelineRenderer — yAxisTickFormatter resolution + tickFormatter on all 4 value axes | 176ba5c | TimelineRenderer.tsx (modified), TimelineRenderer.spec.tsx (extended) |
| 2 | NumericLineRenderer — yAxisTickFormatter resolution + tickFormatter on all 4 value axes | dde20e7 | NumericLineRenderer.tsx (modified), NumericLineRenderer.spec.tsx (extended) |

## What Was Built

### Task 1: TimelineRenderer

`packages/web/src/components/charts/TimelineRenderer.tsx` additions:
- Imports: `resolveFormatter` from `columnDisplayConfigStore`; `buildFormatter` from `columnFormatter`
- `yAxisTickFormatter` useMemo near `metricColumn`/`configVersion` lines:
  ```typescript
  const yAxisTickFormatter = useMemo(() => {
    if (cfg.yAxisFormat) {
      const fmt = buildFormatter(cfg.yAxisFormat);
      return (v: unknown) => String(fmt(v) ?? v);
    }
    if (tableId !== undefined && metricColumn !== "") {
      const fmt = resolveFormatter(tableId, metricColumn);
      return (v: unknown) => String(fmt(v) ?? v);
    }
    return (v: unknown) => String(v ?? "");
  }, [cfg.yAxisFormat, tableId, metricColumn, configVersion]);
  ```
- `tickFormatter={yAxisTickFormatter}` added to all 4 type="number" value axes:
  - Grouped vertical: `<XAxis type="number" xAxisId={...}>`
  - Grouped horizontal: `<YAxis type="number" yAxisId={...} width={64}>`
  - Ungrouped vertical: `<XAxis type="number" xAxisId={AXIS_IDS[i]}>`
  - Ungrouped horizontal: `<YAxis type="number" yAxisId={AXIS_IDS[i]} width={64}>`
- `width={60}` → `width={64}` on both horizontal YAxis value elements
- Bucket/category axes (`type="category"`) and `ColumnFormatTooltip` untouched

`packages/web/src/components/charts/TimelineRenderer.spec.tsx` additions:
- Y1 (override): 4 tickFormatter sites confirmed; buildFormatter SI output "1.2M" from 1234567
- Y2 (column-default): resolveFormatter fallback wiring confirmed; identity branch produces raw string
- Y3 (tooltip isolation): ColumnFormatTooltip receives no yAxisFormat prop; 3 original props intact

### Task 2: NumericLineRenderer

Identical treatment. Same useMemo shape, same 4 axis sites, same width bump, same 3 spec cases.

## Test Coverage

| Spec file | Tests | New tests added |
|-----------|-------|-----------------|
| TimelineRenderer.spec.tsx | 26 | 3 (Y1/Y2/Y3) |
| NumericLineRenderer.spec.tsx | 21 | 3 (Y1/Y2/Y3) |

**Total: 47 tests across 2 files — all green.**

## Verification Results

- `tsc --noEmit`: CLEAN (0 errors)
- `vitest run` (full suite): 2801/2801 PASS across 121 test files
- `vitest run src/styles/theme-guard.spec.ts`: 128/128 PASS
- `git diff --name-only packages/server`: empty (FRONTEND-ONLY confirmed)
- `grep -c "tickFormatter={yAxisTickFormatter}" TimelineRenderer.tsx` = 4
- `grep -c "tickFormatter={bucketFormatter}" TimelineRenderer.tsx` = 2 (bucket axes unchanged)
- `grep -c "tickFormatter={yAxisTickFormatter}" NumericLineRenderer.tsx` = 4
- `grep -c "tickFormatter={bucketFormatter}" NumericLineRenderer.tsx` = 2 (bucket axes unchanged)
- `grep -c "width={60}" TimelineRenderer.tsx` = 0; `grep -c "width={64}"` = 2
- `grep -c "width={60}" NumericLineRenderer.tsx` = 0; `grep -c "width={64}"` = 3 (includes pre-existing bucket YAxis)
- `git diff -U0 ColumnFormatTooltip.tsx` = empty (tooltip untouched)
- No invented CSS class names; no raw hex introduced

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- TimelineRenderer.tsx: FOUND and modified
- NumericLineRenderer.tsx: FOUND and modified
- TimelineRenderer.spec.tsx: FOUND and extended (26 tests)
- NumericLineRenderer.spec.tsx: FOUND and extended (21 tests)
- 86-02-SUMMARY.md: FOUND
- Commit 176ba5c: FOUND
- Commit dde20e7: FOUND
