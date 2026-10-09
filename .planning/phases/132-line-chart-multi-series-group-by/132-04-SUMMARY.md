---
phase: 132-line-chart-multi-series-group-by
plan: 04
subsystem: web/charts
tags: [line-chart, multi-series, recharts, drill]
requires: [132-01, 132-02]
provides: [LineRenderer multi-series, makeLineDot, WidgetRenderer.line.spec.tsx]
affects: [132-05, 132-06]
key-files:
  modified:
    - packages/web/src/components/charts/WidgetRenderer.tsx
  created:
    - packages/web/src/components/charts/WidgetRenderer.line.spec.tsx
metrics:
  tasks: 2
  completed: 2026-10-08
---

# Phase 132 Plan 04: LineRenderer multi-series Summary

LineRenderer now pivots a second Group By column into N gap-preserving Set2 lines, sorts X ascending, labels every X category (tilt then scroll), names legend/Y axis after the metric, and drills on Group By column 1.

PLAN_BASE: 3e755b5 (HEAD before first edit). Commits: 1b0b08a (Task 1), Task 2 commit follows it in `git log`.

## What 132-05 needs (LineRenderer structure)

- Signature unchanged: `LineRenderer({ data, config, widgetId, tableId, dynamicViewId, dashboardId, drillDownColumn, drillDownColumnType })`; called from `AggregatedWidgetRenderer` `case "line"` as `<LineRenderer data={data} config={cfg} {...drillProps} />`. `data` = `parseKineticaResponse` rows (positional keys remapped to real column headers; value column is `value`). 132-05 must add the `categoryTruncation` prop here and thread it from AggregatedWidgetRenderer.
- Derivations in order: `groupByColumns = lineGroupByColumns(config)`, `multiSeries = length >= 2`, `pivotInput/top` (selectTopSeries, cap `maxBarGroupBySeriesCap`), `chartData` (multi: `sortLineRowsByX(pivotSeriesRows(...), r => r.bucket)`; single with a configured X: sorted by `r[x]`; else raw `data`), `xKey` ("bucket" multi, else `x`), `rawXByBucket`, `seriesColors` (Set2 via DEFAULT_COLOR_THEME), `yTitle` (resolveLineMetricTitle), `chartMargin {top10,right10,left0,bottom0}`, `layout = computeLineXAxisLayout(...)`.
- Shared elements built once: `yAxisEl` (width 72 = `Y_AXIS_WIDTH`, rotated title), `xAxisEl` (interval 0, tick 11, height/tilt from layout), `tooltipEl`, `legendEl`, `gridEl`. Three chart branches: multi LineChart, single AreaChart (fillArea), single LineChart.
- Wrapper markup (return): `div[data-testid=line-chart][ref=wrapRef]` (flex column) containing, in order: optional `div.config-hint[data-testid=line-truncated-note]` (multi && top.truncated, "Showing top N of M series", inline style, flexShrink 0), then EITHER `div[data-testid=line-scroll-region]` (overflowX auto) > inner div (minWidth/minHeight) OR `div[data-testid=line-plot-region]` > absolute inner div (minHeight). 132-05's category note should be a sibling row next to `line-truncated-note` (above the plot region, `flexShrink: 0`).
- `makeLineDot(showDots, dense)` is a module function placed after LineRenderer, before `PieRenderer`.
- Tests: `WidgetRenderer.line.spec.tsx` uses a prop-capturing recharts mock; helpers `renderLine(config, rows)` (SQL ends in LIMIT 500 single / LIMIT 12000 multi), `chartKids()`, `lines()`, `xAxis()`, `yAxis()`, `chartData()`, `withMeasuredBoxAsync`. Test ids L132-1..12, 20..28 (L132-13..19 and 21 range unused by design). New 132-05 tests can reuse these by adding to this file.

## RED list (before implementation)

Task 1: L132-1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12 red. L132-3 (blank builder row) was ALREADY green on the old code (legacy single-series path ignores groupByColumns); it still guards the new code (probe b below makes it red). Task 2: L132-20, 21, 22, 23, 24, 26 red; L132-25 (YAxis width/margin), 27 (drill disabled) and 28 (single drill) green pre-change as regression locks (25 passes because width 72/left 0 were introduced in Task 1).

## Discrimination probes (all reverted; all went red)

| Probe | Red tests |
|---|---|
| connectNulls true | L132-1 |
| groupByColumns raw (no blank filter) | L132-3 |
| drop X sort for multi | L132-4 |
| single `name` = yFieldLabel or y | L132-6, 7, 8 |
| multi tooltip `multiSeries={false}` | L132-9 |
| makeLineDot ignores isolation | L132-10 |
| remove `interval={0}` | L132-20 |
| plotWidthPx = wrapW (no subtraction) | L132-22 |
| plotWidthPx = 0 | L132-21, 23 |
| drop `minWidth` | L132-23 |
| drill with stringified bucket | L132-26 |
| extra drill on series column | L132-26 |

## Gates

- `tsc --noEmit` clean; full web vitest 203 files / 4427 tests pass (no fake-timer contamination this run); theme-guard 158 pass.
- `check-classnames.mjs WidgetRenderer.tsx`: OK 23 tokens, no MISSING (unchanged). No hex/rgba, no `fontSize: 12`, exactly one `<XAxis` in the LineRenderer slice.
- BarRenderer slice byte-identical to PLAN_BASE (diff empty).
- Shared docs (STATE/ROADMAP/REQUIREMENTS) untouched; no gsd-tools mutation commands run.

## Not provable here (for the 132-06 human checkpoint)

Gap-vs-zero look, lone dot visibility, Set2 contrast in light/dark, tilted-label/rotated-title clipping, scroll feel, legacy dashboard look. jsdom has no layout, so measured-width behaviour is proven only through stubbed clientWidth.

## Deviations from Plan

None. The spec's Task 2 block was appended after the Task 1 commit so each commit is green.

## Self-Check: PASSED
