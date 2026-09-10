---
phase: 77-apply-labels-formatting-at-render-surfaces
plan: 02
subsystem: ui
tags: [react, recharts, zustand, column-display-config, chart-tooltip, axis-labels, series-names, formatting]

# Dependency graph
requires:
  - phase: 75-column-display-config-foundation
    provides: resolveLabel, resolveFormatter, useColumnDisplayConfigStore, loadConfig, configVersion
  - phase: 77-01
    provides: useColumnDisplayConfigStore/resolveLabel/resolveFormatter already imported in WidgetRenderer

provides:
  - ColumnFormatTooltip shared Recharts Tooltip content component (theme-token styled, no raw hex)
  - Bar/Line/Area/Pie/Scatter chart renderers use ColumnFormatTooltip for tooltip value formatting
  - Series legend name fallback chain: config.yFieldLabel > resolveLabel(tableId, metricColumn) > raw y
  - BarRenderer axis title fallback: config.xAxisLabel/yAxisLabel > resolveLabel(tableId, groupByColumn/metricColumn)
  - TimelineRenderer + NumericLineRenderer tooltip wired to ColumnFormatTooltip
  - configVersion primitive-selector subscription in all 5 chart renderers
  - loadConfig(tableId) on mount in all 5 chart renderers

affects:
  - 77-03-PLAN (map info popups — next surface to wire)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ColumnFormatTooltip: content={<ColumnFormatTooltip tableId={...} groupByColumn={...} metricColumn={...} />}"
    - "series name fallback: (config.yFieldLabel as string) || (tableId !== undefined && metricColumn ? resolveLabel(tableId, metricColumn) : '') || y"
    - "axis title fallback: (config.xAxisLabel as string) || (tableId !== undefined && groupByColumn ? resolveLabel(tableId, groupByColumn) : '')"
    - "recharts mock pattern for WidgetRenderer chart tests: require('react') in vi.mock factory for createElement/cloneElement"

key-files:
  created:
    - packages/web/src/components/charts/ColumnFormatTooltip.tsx
    - packages/web/src/components/charts/ColumnFormatTooltip.spec.tsx
  modified:
    - packages/web/src/components/charts/WidgetRenderer.tsx
    - packages/web/src/components/charts/WidgetRenderer.spec.tsx
    - packages/web/src/components/charts/TimelineRenderer.tsx
    - packages/web/src/components/charts/TimelineRenderer.spec.tsx
    - packages/web/src/components/charts/NumericLineRenderer.tsx
    - packages/web/src/components/charts/NumericLineRenderer.spec.tsx

key-decisions:
  - "ColumnFormatTooltip uses RECHARTS_TOOLTIP_PROPS.contentStyle spread for theme tokens — passes theme-guard without allowlisting"
  - "entry.color (recharts series color string) used for value line color — not a hex literal in this file, OK"
  - "hooks (configVersion, loadConfig useEffect) placed BEFORE early-return gates in TimelineRenderer/NumericLineRenderer to satisfy React hooks-count invariant"
  - "recharts vi.mock factory uses require('react') (not import) because vi.mock is hoisted — React namespace not available via import at hoist time"
  - "resolveLabel always returns at minimum the raw column name (never empty), so the || y fallback in the series name chain is only reached for undefined tableId or empty metricColumn"
  - "Test seeding for chart renderer tests uses listColumnDisplayConfig spy (not upsertColumn-before-render) because loadConfig fires on mount and REPLACE-semantics setConfig wipes pre-render upserts"

requirements-completed: [COLAPPLY-V115-02]

# Metrics
duration: 49min
completed: 2026-06-20
---

# Phase 77 Plan 02: Chart Tooltip Value Format + Series/Axis Labels Summary

**Shared ColumnFormatTooltip Recharts content component wired across all chart renderers (Bar/Line/Pie/Scatter/Timeline/NumericLine); series names and Bar axis titles use resolveLabel fallback chains; configVersion subscription drives live re-render on Phase 76 editor changes; theme-guard passes without allowlisting**

## Performance

- **Duration:** 49 min
- **Started:** 2026-06-20T23:46:54Z
- **Completed:** 2026-06-20T00:35:00Z
- **Tasks:** 4
- **Files modified:** 8 (2 new, 6 edited)

## Accomplishments

- Created `ColumnFormatTooltip.tsx`: shared Recharts Tooltip content component, formats value via `resolveFormatter(tableId, metricColumn)`, labels category via `resolveLabel(tableId, groupByColumn)`, falls back gracefully for undefined tableId/empty columns, uses `RECHARTS_TOOLTIP_PROPS.contentStyle` for theme tokens only
- Wired `ColumnFormatTooltip` into all chart renderers (5 Tooltip sites: Bar, Area, Line, Pie, Scatter)
- Series name fallback chain in Bar/Area/Line: `yFieldLabel || resolveLabel(tableId, metricColumn) || y`
- BarRenderer axis title fallback: xTitle/yTitle from user config or resolveLabel (no format applied to titles)
- TimelineRenderer + NumericLineRenderer: ColumnFormatTooltip wired at their single Tooltip site each
- `configVersion` primitive-selector subscription + `loadConfig` useEffect in all 5 chart renderers
- 148 chart-surface spec tests covering: category label, formatted value, fallback chains, configVersion live re-render, theme tokens
- Full suite: 2568/2568 tests pass; tsc clean; theme-guard green; no new materialize imports

## Task Commits

1. **Task 1: Create ColumnFormatTooltip + unit tests** - `5f42254` (test/feat — TDD RED+GREEN combined)
2. **Task 2: Wire ColumnFormatTooltip + series/axis chains + configVersion into WidgetRenderer** - `e9d27b2` (feat)
3. **Task 3: Wire ColumnFormatTooltip + configVersion into TimelineRenderer + NumericLineRenderer** - `d193c01` (feat)
4. **Task 4: Tests — chart tooltip value format, series/axis label fallback chains, configVersion re-render** - `90acb87` (test)

## Files Created/Modified

- `packages/web/src/components/charts/ColumnFormatTooltip.tsx` — New shared Recharts Tooltip content component; no raw hex; RECHARTS_TOOLTIP_PROPS spread for container style
- `packages/web/src/components/charts/ColumnFormatTooltip.spec.tsx` — 10 unit tests covering all 4 behaviors + multi-entry + no-hex guard
- `packages/web/src/components/charts/WidgetRenderer.tsx` — ColumnFormatTooltip import; BarRenderer/LineRenderer/PieRenderer/ScatterRenderer each get configVersion subscription, loadConfig effect, groupByColumn/metricColumn derivation, ColumnFormatTooltip at Tooltip site; series name fallback chain; BarRenderer axis title fallback
- `packages/web/src/components/charts/WidgetRenderer.spec.tsx` — recharts mock exposing name/label props as DOM text; 8 new tests for chart renderer fallback chains + configVersion re-render
- `packages/web/src/components/charts/TimelineRenderer.tsx` — ColumnFormatTooltip import + configVersion subscription + loadConfig effect + metricColumn derivation + Tooltip wired
- `packages/web/src/components/charts/TimelineRenderer.spec.tsx` — listColumnDisplayConfig no-op mock added; 4 new static/behavioral tests
- `packages/web/src/components/charts/NumericLineRenderer.tsx` — same as TimelineRenderer pattern
- `packages/web/src/components/charts/NumericLineRenderer.spec.tsx` — same mock fix + 5 new tests

## Decisions Made

- **ColumnFormatTooltip uses RECHARTS_TOOLTIP_PROPS spread**: container div gets `...RECHARTS_TOOLTIP_PROPS.contentStyle` directly so theme-guard passes without allowlisting (no raw hex added).
- **entry.color used for per-item text color**: recharts passes series colors as strings (e.g. CSS variable or chart palette hex) into payload entries — referencing `entry.color` in the component file is not a hex literal, it's a runtime string. Theme-guard scans source text, not runtime values.
- **Hooks before early-returns**: in TimelineRenderer/NumericLineRenderer, `useEffect` and `useColumnDisplayConfigStore` subscription are placed before the empty-state early returns to satisfy React's hooks-count invariant.
- **vi.mock factory uses require('react')**: JSX/React is not available via ES module imports in the hoisted vi.mock factory context. Using `require('react').createElement` and `cloneElement` avoids "React is not defined" errors.
- **Test strategy for series name fallback**: resolveLabel ALWAYS returns at minimum the raw column name, so the `|| y` final fallback in the chain is only exercisable when tableId is undefined or metricColumn is empty string. Tests reflect this correct behavior.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Added listColumnDisplayConfig no-op mock to TimelineRenderer/NumericLineRenderer spec files**
- **Found during:** Task 4 (running pre-existing tests after Task 3 wired loadConfig)
- **Issue:** TimelineRenderer.spec.tsx and NumericLineRenderer.spec.tsx mocked `runSql` but not `listColumnDisplayConfig`. The new `loadConfig(tableId)` useEffect called `listColumnDisplayConfig` on every test mount, producing 401 unhandled promise rejections (13 errors in Timeline, 9 in NumericLine).
- **Fix:** Added `listColumnDisplayConfig: vi.fn().mockResolvedValue([])` to the `../../api/client` mock in both spec files.
- **Files modified:** TimelineRenderer.spec.tsx, NumericLineRenderer.spec.tsx
- **Commit:** 90acb87 (Task 4)

**2. [Rule 1 - Bug] Test expectation corrected for series name fallback**
- **Found during:** Task 4 (test execution)
- **Issue:** Test initially expected series name `"value"` (raw recharts y key) when no label stored. But `resolveLabel(tableId, "fare_amount")` returns `"fare_amount"` (raw column name, not empty string), so the `|| y` fallback is never reached.
- **Fix:** Corrected test to expect `CHART_METRIC_COL` ("fare_amount") and updated documentation comment to explain why `|| y` is only reached for undefined tableId / empty metricColumn.
- **Files modified:** WidgetRenderer.spec.tsx
- **Commit:** 90acb87 (Task 4)

---

**Total deviations:** 2 auto-fixed (Rule 2 mock completeness; Rule 1 test correctness)
**Impact on plan:** Minor — no scope changes.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- All chart surfaces wired; 77-03 can proceed with map info popups (InfoSelectionView.tsx)
- configVersion subscription pattern fully established; series/axis fallback chains documented and tested
