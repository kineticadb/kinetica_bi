---
phase: 72-group-by-timeline-numericline
plan: 03
subsystem: charts
tags: [numeric-line, group-by, n-series, config-panel, renderer, drag-to-filter]
requires:
  - "72-01: buildNumericLineSql({groupByColumn, seriesIn}) + groupedSeries.ts (MAX_SERIES/selectTopSeries/pivotSeriesRows)"
  - "72-02: TimelineConfigPanel/TimelineRenderer pattern mirrored for symmetry"
provides:
  - "NumericLineConfig.groupByColumn + Group By picker with single-metric-when-grouped enforcement (non-destructive)"
  - "NumericLineRenderer grouped pipeline: range → top-N pre-query → grouped pivot (numericBuckets) → one Line per series on a shared Y-axis"
  - "Top-12-of-N affordance + drag-to-filter BETWEEN-on-xField preserved when grouped"
affects: []
tech-stack:
  added: []
  patterns:
    - "Non-destructive mutual-exclusion: grouped collapses to metrics[0] in the VIEW; metrics[1..3] stay in config so clearing restores them"
    - "Grouped two-step fetch (top-N pre-query → IN-filtered main query) with numericBuckets:true pivot (numeric bucket sort)"
    - "Single shared value axis + theme-ramp series colors (themeColorsFor) — no raw hex"
key-files:
  created: []
  modified:
    - packages/web/src/components/charts/NumericLineConfigPanel.tsx
    - packages/web/src/components/charts/NumericLineConfigPanel.spec.tsx
    - packages/web/src/components/charts/NumericLineRenderer.tsx
    - packages/web/src/components/charts/NumericLineRenderer.spec.tsx
decisions:
  - "NumericLine passes numericBuckets:true to pivotSeriesRows so buckets sort numerically (mirrors the ungrouped Number() sort)"
  - "Grouped collapse is VIEW-only + non-destructive — handleGroupByChange never filters/clears the metrics array (only seeds metrics[0] when enabling with zero metrics)"
  - "Renderer top-N pre-query is a small inline SQL string (buildNumericLineSql has no bucket-less series-only mode); reuses the same aggExpr shape + LIMIT MAX_SERIES*4"
  - "Single shared Y-axis when grouped (AXIS_IDS[0]); drag band + commitFilter stay outside the grouped/ungrouped branch so BETWEEN-on-xField fires in both"
  - "groupByColumn excludes the selected xField (a column can't be both the X axis and the series split); handleXFieldChange clears groupByColumn when they collide"
metrics:
  duration_min: 4
  tasks: 2
  files: 4
  completed: "2026-06-18"
---

# Phase 72 Plan 03: Numeric-Line Group By picker + grouped N-series renderer Summary

Added the optional group-by dimension to the Numeric-Line chart end-to-end, symmetric with the Timeline (Plan 02): a "Group By (optional)" picker in `NumericLineConfigPanel` with UI-enforced single-metric-when-grouped (non-destructive), and grouped N-series rendering in `NumericLineRenderer` (single grouped query via a top-N pre-query → client pivot with NUMERIC bucket sort → one theme-colored Line per series on a single shared Y-axis, capped at 12 with a "top 12 of N" affordance, drag-to-filter preserved). Built directly on the Wave-1 (72-01) builder/helper contract. Ungrouped multi-metric behavior is regression-locked.

## What Was Built

- **NumericLineConfigPanel** — `groupByColumn?: string` on `NumericLineConfig`; a "Group By (optional)" single-select (aria-label "Group by", `<option value="">None</option>`) listing drilldown-safe columns excluding the selected `xField`. When grouped: metrics render `slice(0,1)`, the "+ Add metric" button and per-row Remove are HIDDEN, and the section header reads `METRIC (grouped by <col>)`. `handleGroupByChange` is non-destructive (never mutates the metrics array except to seed `metrics[0]` when enabling with zero metrics). `handleTableChange` clears `groupByColumn`; new `handleXFieldChange` clears `groupByColumn` when the new xField equals it. `formValid` requires only a complete `metrics[0]` when grouped.
- **NumericLineRenderer** — grouped pipeline branch: range probe → `pickNumericBinWidth` → top-N pre-query (`SELECT <col> AS series, <agg> AS value … ORDER BY value DESC LIMIT MAX_SERIES*4`) → `selectTopSeries` → `buildNumericLineSql({ groupByColumn, seriesIn: top.series })` → `pivotSeriesRows(..., { numericBuckets: true })` → Recharts rows keyed by series value. Render: a single shared value axis + `top.series.map(... <Line dataKey={sv}>)` with stroke colors from `themeColorsFor(getCbColorTheme(colorTheme))` (no raw hex). "Showing top 12 of N series" note when `truncated`. `groupByColumn`/`grouped` added to the fetch dep key; `metrics.slice(0,1)` when grouped. Drag-to-filter (`commitFilter` BETWEEN on `xField`, dataType "number", numeric bound ordering) and the applied/transient `ReferenceArea` bands stay outside the grouped branch (bound to `AXIS_IDS[0]`), so drag works identically grouped or not. Ungrouped multi-axis path byte-unchanged.

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Group By picker + single-metric-when-grouped in NumericLineConfigPanel | 20d6b1b | NumericLineConfigPanel.tsx, NumericLineConfigPanel.spec.tsx |
| 2 | Grouped N-series rendering in NumericLineRenderer | 1ff27c4 | NumericLineRenderer.tsx, NumericLineRenderer.spec.tsx |

Both tasks TDD (RED → GREEN): new tests added and confirmed failing before implementation, then green.

## Verification

- NumericLineConfigPanel.spec.tsx: 17 passed (10 new grouped tests + 7 ungrouped regression).
- NumericLineRenderer.spec.tsx: 13 passed (5 new grouped tests + 8 ungrouped regression).
- Full frontend vitest (from `packages/web`): **2442 passed (105 files)** — up from 2427 (+15 new tests).
- theme-guard.spec.ts: 50 passed (no raw hex introduced; only pre-existing `BAND_COLOR` remains).
- `packages/web` tsc: clean. `packages/server` tsc: clean.
- No server diff (`git status packages/server` empty) — FRONTEND-ONLY honored.
- Acceptance greps: NumericLineConfigPanel `groupByColumn`×14, `aria-label="Group by"`×1, `!grouped`×2, None option present, no destructive metrics mutation in `handleGroupByChange`. NumericLineRenderer `groupByColumn`×6, `selectTopSeries`+`pivotSeriesRows`×3, `numericBuckets`×2, `themeColorsFor`×3, `top.series.map` present, no new raw-hex series colors, no materialize import.

## Deviations from Plan

None — plan executed as written. (Renderer top-N pre-query implemented as the small inline SQL string the plan's action block explicitly permitted, since buildNumericLineSql has no bucket-less series-only mode — same approach as Plan 02's TimelineRenderer.)

## Notes

- GROUP-V114-02 (numeric-line picker) and GROUP-V114-03 (single-metric mutual exclusion) complete via this plan. GROUP-V114-04 spans Plans 02+03 — its numeric-line half (grouped SQL + N-series render + top-N cap) is now complete; the phase verifier confirms final coverage across both renderers.

## Self-Check: PASSED

- NumericLineConfigPanel.tsx / .spec.tsx FOUND (modified).
- NumericLineRenderer.tsx / .spec.tsx FOUND (modified).
- Commits 20d6b1b, 1ff27c4 present.
