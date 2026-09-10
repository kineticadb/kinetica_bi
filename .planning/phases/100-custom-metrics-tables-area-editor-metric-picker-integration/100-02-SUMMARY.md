---
phase: 100-custom-metrics-tables-area-editor-metric-picker-integration
plan: 02
subsystem: ui
tags: [custom-metrics, sql-builder, zustand, react, vitest, tdd]

# Dependency graph
requires:
  - phase: 99-custom-metrics-server-store-foundation
    provides: "customMetricsStore + selectMetrics(tableId) + CustomMetricRow type"
provides:
  - "customMetricSql.ts: isCustomSelection + resolveMetricExpr pure helper (real→passthrough, custom→raw expression, orphan→null)"
  - "metricId?: number marker on TimelineMetric (NumericMetric inherits via re-export)"
  - "buildCalendarSql: tableId + metricId args, resolveMetricExpr branch, byte-identical when absent"
  - "buildTimelineSql: tableId arg, metric.metricId branch, byte-identical when absent (ungrouped + grouped)"
  - "buildNumericLineSql: tableId arg, metric.metricId branch, byte-identical when absent (ungrouped + grouped)"
  - "ChartConfigPanel generatedSql: custom path for scalar + grouped, draft.metricId in deps"
  - "All 4 emission sites: byte-identical regression tests + custom-emits-raw-expression tests"
affects:
  - "100-03 (next wave): Plan 03 picker writes metricId to shapes + config; reads these builder arg shapes"
  - "CalendarConfigPanel: passes tableId + metricId to buildCalendarSql"
  - "TimelineRenderer/NumericLineRenderer: pass tableId in builder args"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure SQL fragment helper pattern (mirrors customWhere.ts): store read + SQL fragment return, zero React imports"
    - "resolveMetricExpr branch: real→passthrough (byte-identical invariant), custom→raw expression (no AGG wrapper), orphan→null"
    - "TDD RED-GREEN pattern for all 3 tasks; orphan decision documented in comments at each site"
    - "Byte-identical regression lock: tests assert `toBe` the exact golden string when metricId absent"

key-files:
  created:
    - packages/web/src/lib/customMetricSql.ts
    - packages/web/src/lib/customMetricSql.spec.ts
    - packages/web/src/components/charts/ChartConfigPanel.customMetric.spec.tsx
  modified:
    - packages/web/src/lib/timelineBin.ts
    - packages/web/src/lib/buildCalendarSql.ts
    - packages/web/src/lib/buildTimelineSql.ts
    - packages/web/src/lib/buildNumericLineSql.ts
    - packages/web/src/lib/buildCalendarSql.spec.ts
    - packages/web/src/lib/buildTimelineSql.spec.ts
    - packages/web/src/lib/buildNumericLineSql.spec.ts
    - packages/web/src/components/charts/ChartConfigPanel.tsx

key-decisions:
  - "Orphan handling: agg = resolved ?? realAgg — orphaned custom id falls back to realAgg (col likely '' for custom selection → invalid SQL → existing empty/error state), NOT a new code path"
  - "ChartConfigPanel custom branch: isCustomSelection check gates before metricColumn/aggregation incomplete-guard to avoid false fallback for custom selections with empty metricColumn"
  - "selectedTable dependency added to generatedSql deps array (provides tableId for resolveMetricExpr in custom branch)"
  - "NumericMetric inherits metricId automatically via re-export from timelineBin — no duplication"

patterns-established:
  - "Custom metric id marker: opaque number on the metric shape; absent = real column (byte-identical); present = custom metric (raw expression)"
  - "All SQL emission sites use resolveMetricExpr(metricId, realAgg, tableId) then ?? realAgg for orphan fallback"
  - "Builder Args types gain tableId?: number for metric resolution; the custom metric id lives on the metric object or the args depending on shape"

requirements-completed: [METRIC-V119-04]

# Metrics
duration: 38min
completed: 2026-07-01
---

# Phase 100 Plan 02: Custom Metrics SQL Emission Branch Summary

**Custom-vs-real metric selection contract established: metricId marker on TimelineMetric/NumericMetric, resolveMetricExpr helper (raw expression/passthrough/null), and all 4 SQL emission sites branched with byte-identical regression locks + raw-expression correctness tests**

## Performance

- **Duration:** 38 min
- **Started:** 2026-07-01T13:55:24Z
- **Completed:** 2026-07-01T14:33:00Z
- **Tasks:** 3
- **Files modified:** 11

## Accomplishments
- Created `customMetricSql.ts`: pure `isCustomSelection` + `resolveMetricExpr` helper (mirrors `customWhere.ts` shape); resolves store metrics live via `selectMetrics(tableId)`
- Added `metricId?: number` to `TimelineMetric` (NumericMetric inherits automatically); branched all 3 own-SQL builders (calendar, timeline, numeric-line) through `resolveMetricExpr`
- Branched `ChartConfigPanel.generatedSql` (scalar + grouped) through `resolveMetricExpr`; `draft.metricId` added to deps array
- Locked all 4 emission sites with byte-identical regression tests (no-metricId → exact golden string) AND custom-emits-raw-expression tests (no AGG wrapper)

## Task Commits

Each task was committed atomically:

1. **Task 1: Shared customMetricSql helper + marker field + spec** - `5afae5b` (feat)
2. **Task 2: Branch the 3 own-SQL builders + byte-identical + custom tests** - `b4ea1bb` (feat)
3. **Task 3: Branch ChartConfigPanel generatedSql (scalar + grouped) + marker on draft** - `ddd5803` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `packages/web/src/lib/customMetricSql.ts` - Pure resolver: isCustomSelection + resolveMetricExpr (real→passthrough, custom→raw, orphan→null)
- `packages/web/src/lib/customMetricSql.spec.ts` - 11 tests covering all 4 resolution behaviors
- `packages/web/src/lib/timelineBin.ts` - Added `metricId?: number` to TimelineMetric type
- `packages/web/src/lib/buildCalendarSql.ts` - tableId + metricId args; resolveMetricExpr branch
- `packages/web/src/lib/buildTimelineSql.ts` - tableId arg; metric.metricId branch (ungrouped + grouped)
- `packages/web/src/lib/buildNumericLineSql.ts` - tableId arg; metric.metricId branch (ungrouped + grouped)
- `packages/web/src/lib/buildCalendarSql.spec.ts` - 3 new tests (byte-identical lock + custom raw + orphan fallback)
- `packages/web/src/lib/buildTimelineSql.spec.ts` - 3 new tests (byte-identical lock + custom raw ungrouped + custom raw grouped)
- `packages/web/src/lib/buildNumericLineSql.spec.ts` - 3 new tests (byte-identical lock + custom raw ungrouped + custom raw grouped)
- `packages/web/src/components/charts/ChartConfigPanel.tsx` - resolveMetricExpr import; scalar + grouped custom branches; draft.metricId in deps
- `packages/web/src/components/charts/ChartConfigPanel.customMetric.spec.tsx` - 4 tests (byte-identical scalar+grouped, custom scalar+grouped)

## Decisions Made
- Orphan handling: `agg = resolved ?? realAgg` — falls back to realAgg (col likely `""` for custom → invalid SQL → existing empty/error state); no new code path required
- ChartConfigPanel: `isCustomSelection(metricId)` gates before the `!metricColumn || !aggregation` incomplete-guard to avoid false fallback when metricColumn is `""` for a custom selection
- `selectedTable` added to `generatedSql` deps (provides `tableId` for `resolveMetricExpr`); this is a memo dep, not a new render — no perf concern
- NumericMetric inherits `metricId` via `export type { TimelineMetric as NumericMetric }` — no duplication needed

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None.

## Next Phase Readiness
- Plan 02's `resolveMetricExpr` + marker shapes are exactly what Plan 03's pickers write to the config: `metricId` on calendar args, `metric.metricId` on timeline/numeric-line metric objects, `draft.metricId` on ChartConfigPanel draft
- Plan 03 (metric picker UI) is the next wave; it extends `ChartConfigPanel.tsx` and `customMetricSql.ts` per the plan — no changes needed here
- AggregatedWidgetRenderer stays the sole materialize trigger (static grep clean)
- FRONTEND-ONLY confirmed: `git diff --name-only packages/server` is empty

## Self-Check
- [x] `packages/web/src/lib/customMetricSql.ts` — created
- [x] `packages/web/src/lib/customMetricSql.spec.ts` — created
- [x] `packages/web/src/lib/timelineBin.ts` — metricId marker added
- [x] `packages/web/src/lib/buildCalendarSql.ts` — resolveMetricExpr branch
- [x] `packages/web/src/lib/buildTimelineSql.ts` — resolveMetricExpr branch
- [x] `packages/web/src/lib/buildNumericLineSql.ts` — resolveMetricExpr branch
- [x] `packages/web/src/components/charts/ChartConfigPanel.tsx` — both branches + deps
- [x] `packages/web/src/components/charts/ChartConfigPanel.customMetric.spec.tsx` — created
- [x] All 135 test files pass (3119 tests); tsc clean; theme-guard green
- [x] Commits: 5afae5b, b4ea1bb, ddd5803

---
*Phase: 100-custom-metrics-tables-area-editor-metric-picker-integration*
*Completed: 2026-07-01*
