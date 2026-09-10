---
phase: 72-group-by-timeline-numericline
plan: 02
subsystem: charts
tags: [timeline, group-by, n-series, config-panel, renderer, drag-to-filter]
requires:
  - "72-01: buildTimelineSql({groupByColumn, seriesIn}) + groupedSeries.ts (MAX_SERIES/selectTopSeries/pivotSeriesRows)"
provides:
  - "TimelineConfig.groupByColumn + Group By picker with single-metric-when-grouped enforcement (non-destructive)"
  - "TimelineRenderer grouped pipeline: range → top-N pre-query → grouped pivot → one Line per series on a shared Y-axis"
  - "Top-12-of-N affordance + drag-to-filter BETWEEN-on-timeCol preserved when grouped"
affects:
  - packages/web/src/components/charts/NumericLineConfigPanel.tsx (72-03 mirrors this pattern)
  - packages/web/src/components/charts/NumericLineRenderer.tsx (72-03)
tech-stack:
  added: []
  patterns:
    - "Non-destructive mutual-exclusion: grouped collapses to metrics[0] in the VIEW; metrics[1..3] stay in config so clearing restores them"
    - "Grouped two-step fetch (top-N pre-query → IN-filtered main query) reusing the Wave-1 builder/helper contract"
    - "Single shared value axis + theme-ramp series colors (themeColorsFor) — no raw hex"
key-files:
  created: []
  modified:
    - packages/web/src/components/charts/TimelineConfigPanel.tsx
    - packages/web/src/components/charts/TimelineConfigPanel.spec.tsx
    - packages/web/src/components/charts/TimelineRenderer.tsx
    - packages/web/src/components/charts/TimelineRenderer.spec.tsx
decisions:
  - "Grouped collapse is VIEW-only + non-destructive — handleGroupByChange never filters/clears the metrics array (only seeds metrics[0] when enabling with zero metrics)"
  - "Renderer top-N pre-query is a small inline SQL string (buildTimelineSql has no bucket-less series-only mode); reuses the same aggExpr/COUNT(DISTINCT) shape + LIMIT MAX_SERIES*4"
  - "Single shared Y-axis when grouped (AXIS_IDS[0]); drag band + commitFilter stay outside the grouped/ungrouped branch so BETWEEN-on-timeCol fires in both"
  - "Legend always shown when grouped (series values matter); ungrouped legend rule (metrics.length > 1) unchanged"
metrics:
  duration_min: 5
  tasks: 2
  files: 4
  completed: "2026-06-18"
---

# Phase 72 Plan 02: Timeline Group By picker + grouped N-series renderer Summary

Added the optional group-by dimension to the Timeline chart end-to-end: a "Group By (optional)" picker in `TimelineConfigPanel` with UI-enforced single-metric-when-grouped (non-destructive), and grouped N-series rendering in `TimelineRenderer` (single grouped query via a top-N pre-query → client pivot → one theme-colored Line per series on a single shared Y-axis, capped at 12 with a "top 12 of N" affordance, drag-to-filter preserved). Built directly on the Wave-1 (72-01) builder/helper contract. Ungrouped multi-metric behavior is regression-locked.

## What Was Built

- **TimelineConfigPanel** — `groupByColumn?: string` on `TimelineConfig`; a "Group By (optional)" single-select (aria-label "Group by", `<option value="">None</option>`) listing drilldown-safe columns excluding the selected `timeCol` (mirrors ChartConfigPanel's `isColumnDrillDownSafe` eligibility). When grouped: metrics render `slice(0,1)`, the "+ Add metric" button and per-row Remove are HIDDEN, and the section header reads `METRIC (grouped by <col>)`. `handleGroupByChange` is non-destructive (never mutates the metrics array except to seed `metrics[0]` when enabling with zero metrics). `handleTableChange` and `handleTimeColChange` clear `groupByColumn` when it becomes invalid (new schema / timeCol === groupByColumn). `formValid` requires only a complete `metrics[0]` when grouped.
- **TimelineRenderer** — grouped pipeline branch: range probe → top-N pre-query (`SELECT <col> AS series, <agg> AS value … ORDER BY value DESC LIMIT MAX_SERIES*4`) → `selectTopSeries` → `buildTimelineSql({ groupByColumn, seriesIn: top.series })` → `pivotSeriesRows` → Recharts rows keyed by series value. Render: a single shared value axis + `top.series.map(... <Line dataKey={sv}>)` with stroke colors from `themeColorsFor(getCbColorTheme(colorTheme))` (no raw hex). "Showing top 12 of N series" note when `truncated`. `groupByColumn`/`grouped` added to the fetch dep key. Drag-to-filter (`commitFilter` BETWEEN on `timeCol`) and the applied/transient `ReferenceArea` bands stay outside the grouped branch (bound to `AXIS_IDS[0]`), so drag works identically grouped or not. Ungrouped path byte-unchanged.

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Group By picker + single-metric-when-grouped in TimelineConfigPanel | 9eca851 | TimelineConfigPanel.tsx, TimelineConfigPanel.spec.tsx |
| 2 | Grouped N-series rendering in TimelineRenderer | f162701 | TimelineRenderer.tsx, TimelineRenderer.spec.tsx |

Both tasks TDD (RED → GREEN): new tests added and confirmed failing before implementation, then green.

## Verification

- TimelineConfigPanel.spec.tsx: 20 passed (9 new grouped tests + 11 ungrouped regression).
- TimelineRenderer.spec.tsx: 19 passed (6 new grouped tests + 13 ungrouped regression).
- Full frontend vitest (from `packages/web`): **2427 passed (105 files)** — up from 2412 (+15 new tests).
- theme-guard.spec.ts: 50 passed (no raw hex introduced; only pre-existing `BAND_COLOR` remains).
- `packages/web` tsc: clean. `packages/server` tsc: clean.
- No server diff (`git status packages/server` empty) — FRONTEND-ONLY honored.
- Acceptance greps: TimelineConfigPanel `groupByColumn`×13, `aria-label="Group by"`×1, `!grouped`×2, no destructive metrics mutation in `handleGroupByChange`. TimelineRenderer `groupByColumn`×6, `selectTopSeries`+`pivotSeriesRows`×3, `themeColorsFor`×3, `top.series.map` present, no new raw-hex series colors, no materialize import.

## Deviations from Plan

None — plan executed as written. (Renderer top-N pre-query implemented as the small inline SQL string the plan's action block explicitly permitted, since buildTimelineSql has no bucket-less series-only mode.)

## Notes for Wave 3 (72-03 NumericLine)

- Mirror this exact pattern: `NumericLineConfig.groupByColumn`, a "Group By (optional)" picker, single-metric-when-grouped (non-destructive), grouped renderer branch.
- NumericLine MUST pass `numericBuckets: true` to `pivotSeriesRows` (per 72-01 SUMMARY).
- GROUP-V114-04 spans this plan + 72-03 — its requirement is marked here (timeline half complete); the verifier confirms final coverage across both renderers.

## Self-Check: PASSED

- TimelineConfigPanel.tsx / .spec.tsx FOUND (modified).
- TimelineRenderer.tsx / .spec.tsx FOUND (modified).
- Commits 9eca851, f162701 present.
