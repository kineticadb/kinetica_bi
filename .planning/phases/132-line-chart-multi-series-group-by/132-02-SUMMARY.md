---
phase: 132-line-chart-multi-series-group-by
plan: 02
subsystem: web/charts
tags: [tooltip, line-chart, defaults]
requires: []
provides: [ColumnFormatTooltip multiSeries/metricTitle props, line defaultConfig groupByColumns]
affects: [132-04]
key-files:
  modified:
    - packages/web/src/components/charts/ColumnFormatTooltip.tsx
    - packages/web/src/components/charts/ColumnFormatTooltip.spec.tsx
    - packages/web/src/components/charts/definitions/line.ts
decisions:
  - "Explicit multiSeries prop overrides payload.length guess; metricTitle only applies to single-series"
metrics:
  tasks: 2
  completed: 2026-10-08
---

# Phase 132 Plan 02: Tooltip props + line groupByColumns default Summary

ColumnFormatTooltip gains optional `multiSeries`/`metricTitle` props (fully backward compatible) and Line Chart defaultConfig gains `groupByColumns: []`.

PLAN_BASE: d35081ffde662788ccd961213d487b671af2f0a5

## Pinned contracts (verbatim, for later plans)

ColumnFormatTooltip props added:
```ts
  /** Phase 132: when defined, decides single vs multi series instead of guessing from payload.length. */
  multiSeries?: boolean;
  /** Phase 132: when non-empty, the single-series value line uses this (the legend title) instead of the Format-columns label. */
  metricTitle?: string;
```
Logic:
```ts
const singleSeries = multiSeries === undefined ? payload.length === 1 : !multiSeries;
const singleLabel = metricTitle ? metricTitle : metricLabel;
const valueName = singleSeries && singleLabel != null ? singleLabel : entry.name;
```
line.ts defaultConfig addition (after `customWhere: "",`):
```ts
groupByColumns: [] as string[],
```

## Commits
- 7990c3c feat(132-02): ColumnFormatTooltip multiSeries + metricTitle props
- c855a0e feat(132-02): line defaultConfig groupByColumns

## Verification
- Discrimination probe: reverting singleSeries to `payload.length === 1` turned CFT132-1 and CFT132-4 red (15 pass, 2 fail); restored.
- tsc clean; ColumnFormatTooltip spec 17/17; check-classnames OK; theme-guard green.
- Full web vitest: 4365 tests passed; 4 files failed to load/run, all from plan 132-01's in-progress untracked src/lib files (lineChartData, lineChartLayout specs, etc.) in the shared working tree, not related to this plan.

## Deviations from Plan
None. Shared docs untouched.

## Self-Check: PASSED
