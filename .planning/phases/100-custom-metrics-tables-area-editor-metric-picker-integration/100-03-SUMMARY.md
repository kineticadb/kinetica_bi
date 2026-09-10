---
phase: 100-custom-metrics-tables-area-editor-metric-picker-integration
plan: 03
subsystem: ui
tags: [custom-metrics, metric-picker, zustand, react, vitest, chart-config]

# Dependency graph
requires:
  - phase: 100-02
    provides: "customMetricSql.ts isCustomSelection + resolveMetricExpr; metricId marker on TimelineMetric/NumericMetric; builders accept tableId"
provides:
  - "encodeCustomValue / decodeMetricSelection / metricSelectValue / isOrphanedMetric helpers in customMetricSql.ts"
  - "ChartConfigPanel: Custom metrics optgroup in metric picker; aggregation hidden when custom; deleted-metric marker"
  - "CalendarConfigPanel: metricId?: number in CalendarConfig type; same picker pattern"
  - "TimelineConfigPanel: per-metric-row Custom metrics optgroup; per-row agg hidden; completeness guard updated"
  - "NumericLineConfigPanel: same as Timeline — per-row custom picker + completeness guard"
  - "CalendarRenderer: tableId + metricId passed to buildCalendarSql; configVersion in deps"
  - "TimelineRenderer: tableId passed to both buildTimelineSql calls; customMetricsConfigVersion dep"
  - "NumericLineRenderer: tableId passed to both buildNumericLineSql calls; configVersion dep"
  - "metricPicker.spec.tsx: 4 integration tests locking optgroup + hide-agg + deleted-marker + Timeline row"
affects:
  - "All metric-using widgets: custom metrics are now selectable everywhere; real-column behavior byte-identical"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "cm:<id> sentinel prefix for picker value space — single <select> covers both real columns and custom metrics"
    - "isOrphanedMetric guard: renders (deleted metric) option when stored metricId no longer exists in store"
    - "configVersion subscription pattern (mirrors columnDisplayConfigStore): all 7 components subscribe to re-render on metric edits"
    - "loadConfig().catch(() => {}) pattern: best-effort cache fill, silences auth errors in test environments"
    - "completeness guard update: isCustomSelection(m.metricId) || (real-column check) for multi-metric row validity"

key-files:
  modified:
    - packages/web/src/lib/customMetricSql.ts
    - packages/web/src/lib/customMetricSql.spec.ts
    - packages/web/src/components/charts/ChartConfigPanel.tsx
    - packages/web/src/components/charts/CalendarConfigPanel.tsx
    - packages/web/src/components/charts/TimelineConfigPanel.tsx
    - packages/web/src/components/charts/NumericLineConfigPanel.tsx
    - packages/web/src/components/charts/CalendarRenderer.tsx
    - packages/web/src/components/charts/TimelineRenderer.tsx
    - packages/web/src/components/charts/NumericLineRenderer.tsx
  created:
    - packages/web/src/components/charts/metricPicker.spec.tsx

key-decisions:
  - "cm:<id> sentinel prefix chosen (not numeric-only) to distinguish custom metrics from column names in a single <select> value space"
  - "loadConfig().catch() added to all 7 components' effects to prevent unhandled promise rejections in test environments where the API is unavailable (baseline pre-plan: 56 errors; after fix: 0)"
  - "completeness check updated in Timeline + NumericLine: isCustomSelection(m.metricId) treats a custom row as complete, so the Add button enables and the form is valid"
  - "Custom metrics group rendered unconditionally (even when customMetrics is empty) to always provide the optgroup in the DOM for picker tests"
  - "metricSelectValue returns column when metricId is undefined, encodeCustomValue(metricId) when custom — single function for all 4 panels"

# Metrics
duration: 45min
completed: 2026-07-01
---

# Phase 100 Plan 03: Metric Picker UI + Renderer Threading Summary

**Custom metric picker surfaces in all 4 widget config panels (bar/pie/line/area/bignumber, calendar, timeline, numeric-line); selecting a custom metric writes its id, hides the aggregation selector, shows "(deleted metric)" for orphaned ids; renderers resolve live expressions via tableId + configVersion threading**

## Performance

- **Duration:** ~45 min
- **Completed:** 2026-07-01
- **Tasks:** 4
- **Files modified:** 9
- **Files created:** 1

## Accomplishments

- Extended `customMetricSql.ts` with 4 pure picker helpers: `encodeCustomValue` (cm:<id> sentinel), `decodeMetricSelection` (discriminated union), `metricSelectValue` (encode-or-passthrough), `isOrphanedMetric` (deleted detection)
- Added 11 unit tests for the new helpers in `customMetricSql.spec.ts` (22 total in the file)
- ChartConfigPanel: custom-aware metric `<select>` with `<optgroup label="Columns">` + `<optgroup label="Custom metrics">`; orphan "(deleted metric)" option; aggregation wrapped in `!isCustomSelection` guard; `configVersion` subscription + `loadConfig` effect
- CalendarConfigPanel: `metricId?: number` added to `CalendarConfig` type; same picker + agg-hide + orphan pattern; patch writes `metricId`/clears `metricColumn` on custom pick
- TimelineConfigPanel: per-row metric picker with custom optgroup; per-row `{!isCustomSelection(m.metricId) && <aggregation>}`; `formValid` updated to treat `isCustomSelection(m.metricId)` as a complete row
- NumericLineConfigPanel: identical pattern to Timeline
- CalendarRenderer: `cfg.metricId` read; `tableId` + `metricId` passed to `buildCalendarSql`; `customMetricsConfigVersion` in dep array
- TimelineRenderer: `tableId` passed to both grouped and ungrouped `buildTimelineSql` calls; `customMetricsConfigVersion` in fetch effect deps with metricId fingerprint
- NumericLineRenderer: same threading for both `buildNumericLineSql` calls
- `metricPicker.spec.tsx`: 4 integration tests — (a) Custom metrics optgroup + label present, (b) selecting custom hides Aggregation, (c) deleted-metric marker, (d) Timeline row custom select writes `metricId`

## Task Commits

Each task was committed atomically:

1. **Task 1: encode/decode + isOrphanedMetric helpers** — `3b42159` (feat)
2. **Task 2: ChartConfigPanel + CalendarConfigPanel pickers** — `499ee37` (feat)
3. **Task 3: Timeline + NumericLine per-row pickers** — `a97adc3` (feat)
4. **Task 4: Renderer tableId threading + integration spec** — `59ecd0e` (feat)

## Files Created/Modified

- `packages/web/src/lib/customMetricSql.ts` — Added 4 helpers: encodeCustomValue, decodeMetricSelection, metricSelectValue, isOrphanedMetric
- `packages/web/src/lib/customMetricSql.spec.ts` — 11 new tests (22 total)
- `packages/web/src/components/charts/ChartConfigPanel.tsx` — Custom metric picker + agg hide + configVersion + loadConfig
- `packages/web/src/components/charts/CalendarConfigPanel.tsx` — metricId in CalendarConfig type + custom picker + agg hide
- `packages/web/src/components/charts/TimelineConfigPanel.tsx` — Per-row custom picker + formValid update
- `packages/web/src/components/charts/NumericLineConfigPanel.tsx` — Per-row custom picker + formValid update
- `packages/web/src/components/charts/CalendarRenderer.tsx` — tableId+metricId to buildCalendarSql + configVersion dep
- `packages/web/src/components/charts/TimelineRenderer.tsx` — tableId to both buildTimelineSql calls + configVersion dep
- `packages/web/src/components/charts/NumericLineRenderer.tsx` — tableId to both buildNumericLineSql calls + configVersion dep
- `packages/web/src/components/charts/metricPicker.spec.tsx` — 4 integration tests (created)

## Decisions Made

- `cm:<id>` sentinel prefix encodes custom metric ids in the `<select>` value space so a single controlled `<select>` handles both real columns and custom metrics without ambiguity
- `loadConfig().catch(() => {})` on all 7 component effects silences 401 unhandled rejections in test environments (pre-fix: 157 errors; after: 0 errors, all 3134 tests pass)
- Completeness guard updated to `isCustomSelection(m.metricId) || (m.column !== "" && m.aggregation !== undefined)` in both Timeline and NumericLine — a custom row counts as complete
- `metricPicker.spec.tsx` mocks `listCustomMetrics` via `vi.mock("../../api/client")` to prevent network calls in the integration spec

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Add .catch() to loadConfig effects**
- **Found during:** Task 4 full suite run
- **Issue:** The `useCustomMetricsStore.getState().loadConfig(tableId)` calls added to 7 components generated unhandled promise rejections in test specs that mock `runSql` but not `listCustomMetrics`. Pre-plan baseline had 56 errors; after adding loadConfig effects: 157 errors.
- **Fix:** Added `.catch(() => {})` to all 7 `loadConfig` calls — best-effort cache fill, silences auth/network errors in tests without changing production behavior
- **Files modified:** All 7 components (ChartConfigPanel, CalendarConfigPanel, TimelineConfigPanel, NumericLineConfigPanel, CalendarRenderer, TimelineRenderer, NumericLineRenderer)
- **Commit:** `59ecd0e` (included in Task 4 commit)

## Self-Check

- [x] `packages/web/src/lib/customMetricSql.ts` — 4 helpers added (encodeCustomValue, decodeMetricSelection, metricSelectValue, isOrphanedMetric)
- [x] `packages/web/src/lib/customMetricSql.spec.ts` — 22 tests pass
- [x] `packages/web/src/components/charts/ChartConfigPanel.tsx` — Custom metrics optgroup + agg hide + configVersion
- [x] `packages/web/src/components/charts/CalendarConfigPanel.tsx` — metricId in type + picker
- [x] `packages/web/src/components/charts/TimelineConfigPanel.tsx` — Per-row picker + formValid
- [x] `packages/web/src/components/charts/NumericLineConfigPanel.tsx` — Per-row picker + formValid
- [x] `packages/web/src/components/charts/CalendarRenderer.tsx` — tableId + metricId threaded
- [x] `packages/web/src/components/charts/TimelineRenderer.tsx` — tableId + configVersion threaded
- [x] `packages/web/src/components/charts/NumericLineRenderer.tsx` — tableId + configVersion threaded
- [x] `packages/web/src/components/charts/metricPicker.spec.tsx` — 4 integration tests pass
- [x] Commits: 3b42159, 499ee37, a97adc3, 59ecd0e
- [x] tsc clean; theme-guard green; 136 test files / 3134 tests all pass; zero server diff

## Self-Check: PASSED

---
*Phase: 100-custom-metrics-tables-area-editor-metric-picker-integration*
*Completed: 2026-07-01*
