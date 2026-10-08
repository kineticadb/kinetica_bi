---
phase: 132-line-chart-multi-series-group-by
verified: 2026-10-08T16:35:00Z
status: passed
score: 5/5 must-haves verified
---

# Phase 132: Line Chart Multi-Series Group By Verification Report

**Phase Goal:** Line chart gets the bar chart's multi-column Group By builder (column 1 required = X axis), one line per series value, never silently drops an x-axis label, legend/axis named after the metric, drill-down matches bar.
**Status:** passed. **Re-verification:** No.

## Observable Truths (ROADMAP criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Group By builder, column 1 required = X, ascending X, 2nd column = one line per value (LINE-V126-01) | VERIFIED | `WidgetRenderer.tsx` LineRenderer: `lineGroupByColumns`, `toBarPivotInput`, `selectTopSeries`, `sortLineRowsByX`; `ChartConfigPanel.tsx` `lineMissingXColumn` disables Save ("Group By column 1 is required"). UAT V1-V4 PASS. |
| 2 | Every x label shown, never silently dropped (LINE-V126-02) | VERIFIED | Dropped-categories notice driven by LIMIT+1 probe (WidgetRenderer ~L420); V6 PASS; V7 PASS. |
| 3 | Legend/Y title uses metric name, not "value" (LINE-V126-03) | VERIFIED | `resolveLineMetricTitle` (D-09). V8 PASS. |
| 4 | Multi-series point click drills as bar does (LINE-V126-04) | VERIFIED | `handleChartClick` `multiSeries` branch (D-10): column 1 = clicked raw X, series column never filtered; V5 PASS. |
| 5 | Live checkpoint V1-V9 (132-06-SUMMARY) | VERIFIED | All V1-V9 PASS recorded. |

## UAT fix 79daf34 (verified in code)

- Line with no X column: `WidgetRenderer.tsx` L905-911 returns `widget-placeholder` (`data-testid="line-needs-x"`) with "Choose an X axis column in this chart's settings." OK.
- Y axis: L1505 `estimateValueAxisWidth(yValues, fmt, LINE_Y_AXIS_MAX_PX) + 16`, `LINE_Y_AXIS_MAX_PX = 160` (L1352). OK.
- Bar default unchanged: `estimateAxisWidth.ts` `MAX_WIDTH_PX = 80`; `maxPx` is an optional param defaulting to it. OK.

## Gates (run by verifier)

- `npx tsc --noEmit` (web): clean.
- `npx vitest run` (web): 203 files / 4434 tests passed (jsdom stack trace in output is logged noise, no failures).
- `theme-guard.spec.ts`: 158 passed.
- check-classnames WidgetRenderer.tsx + ColumnFormatTooltip.tsx: OK (23 tokens).
- check-classnames `packages/web/src/components/charts/ChartConfigPanel.tsx`: only the pre-existing `config-hint-warning` MISSING. (The path in the task, `components/ChartConfigPanel.tsx`, does not exist; the file is under `charts/`.)
- `git diff --stat d35081f -- packages/server`: empty; server untouched, server gates not needed.
- `git status`: clean at start of verification (this report is the only new file).

## Requirements Coverage

| Req | Status | Evidence |
|-----|--------|----------|
| LINE-V126-01 | SATISFIED | Truth 1; REQUIREMENTS.md L35 reworded, ticked, table L83 Complete |
| LINE-V126-02 | SATISFIED | Truth 2 |
| LINE-V126-03 | SATISFIED | Truth 3 |
| LINE-V126-04 | SATISFIED | Truth 4 |

No orphaned requirements.

## Anti-Patterns

None blocking found in the inspected line code paths.

## Known accepted items (not gaps)

- V7 light/dark pass and pickup_datetime X-label rendering not explicitly confirmed by the operator.
- Follow-ups in STATE: tooltip float rounding, epoch X labels, Line/Numeric Line merge.
- V3 dev `.env` `MAX_BAR_GROUP_BY_SERIES=2` (local config, cap behaved correctly).

## Gaps Summary

None. Limit of this verification: CONTEXT D-01..D-11/O-1/O-2 were spot-checked against code (D-04, D-05, D-08, D-09, D-10, O-2) rather than line-by-line; the rest relies on the passing spec suite and the operator's live V1-V9 UAT.

_Verifier: Claude (gsd-verifier)_
