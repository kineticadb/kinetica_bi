---
phase: 132-line-chart-multi-series-group-by
plan: 03
subsystem: web/charts
tags: [line-chart, config-panel, group-by-builder]
requires: [132-01]
provides: [line Group By builder, lineMissingXColumn validation, multi-series LIMIT]
key-files:
  modified:
    - packages/web/src/components/charts/ChartConfigPanel.tsx
    - packages/web/src/components/charts/ChartConfigPanel.spec.tsx
metrics:
  completed: 2026-10-08
---

# Phase 132 Plan 03: ChartConfigPanel line builder Summary

Line Chart now uses the shared Group By Columns builder (X axis / Series dimension N), requires column 1 (alert + disabled Apply), widens LIMIT to limit x cap x 2 for 2+ non-blank columns, and imports AGGREGATIONS from lib/aggregationLabels.

PLAN_BASE: 3e755b56e677c743b2498f878dfa64745213e0ff

## Commits
- test(132-03): failing Phase 132 line builder spec
- feat(132-03): line Group By builder, required X column, multi-series LIMIT

## RED (Task 1)
Failed before the change: P132-1, 3, 4, 5, 7, 8. Passed already: P132-2, P132-6 (legacy single-column path).

## Discrimination probes (all red, reverted)
- a) drop `|| lineMissingXColumn`: P132-3, P132-7 red
- b) limit back to `isBar`: P132-5 red
- c) `(isBar || isLine)` without cols check: P132-6 red
- d) drop `isLine ? [""]` seed: P132-3, P132-4 red
- e) drop aria-label: P132-7, P132-8 red

## Gates
- tsc clean; theme-guard green; check-classnames: only baseline `MISSING config-hint-warning` (unchanged).
- Full web vitest: 202 files pass; 11 failures all in WidgetRenderer.line.spec.tsx (plan 132-04's in-progress file in the shared tree), unrelated.

## Deviations from Plan
None. Shared docs untouched.

## Self-Check: PASSED
