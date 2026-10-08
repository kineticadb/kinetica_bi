---
phase: 132-line-chart-multi-series-group-by
plan: 05
subsystem: web/charts
tags: [line-chart, truncation-notice]
requires: [132-01, 132-04]
key-files:
  modified:
    - packages/web/src/components/charts/WidgetRenderer.tsx
    - packages/web/src/components/charts/WidgetRenderer.line.spec.tsx
metrics:
  tasks: 2
  completed: 2026-10-08
---

# Phase 132 Plan 05: Dropped-categories notice Summary

Line widgets get a LIMIT+1 probe; only when the limit is hit one `COUNT(DISTINCT col1)` query runs and LineRenderer shows "Showing N of M categories" (or fallback copy).

PLAN_BASE: d5ce498. Commits: Task 1 (probe + count + tests), Task 2 (note row). BarRenderer untouched; shared docs untouched.

## RED list
Before the note row: L132-30, 32, 33 red (note text); L132-31, 34, 35 green.

## Discrimination probes (all reverted)
| Probe | Red tests |
|---|---|
| drop `|| lineCountSql` from bump | L132-30, 31, 32, 33 |
| count query unconditional (`if (true)`) | L132-31 |
| count catch rethrows | L132-32 |
| note only when total != null | L132-32 |
| lineCountSql = `"SELECT 1"` for lines | L132-30, 34 |

## Gates
tsc clean; full web vitest 203 files / 4433 tests pass (includes theme-guard); check-classnames WidgetRenderer.tsx: OK 23 tokens. No hex/rgba added. No fake-timer contamination this run.

## Not provable here
Kinetica acceptance of the derived-table count SQL (orchestrator tested read-only; also V6 in 132-06); visual look of the note.

## Deviations from Plan
None.

## Self-Check: PASSED
