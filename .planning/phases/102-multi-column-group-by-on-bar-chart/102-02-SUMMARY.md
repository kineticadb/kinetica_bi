---
phase: 102-multi-column-group-by-on-bar-chart
plan: "02"
subsystem: bar-chart-group-by
tags: [react, zustand, vitest, tdd, sql-builder, recharts-config, frontend-only]
dependency_graph:
  requires:
    - phase: 102-01
      provides: "isMultiColumnBarGroupBy guard + maxBarGroupBySeriesCap auth-store field"
  provides:
    - groupByColumns field on bar defaultConfig (definitions/bar.ts)
    - bar-only N-column add/remove builder UI in ChartConfigPanel (max 6 columns)
    - multi-column generatedSql branch (isMultiColumnBarGroupBy guard + generous LIMIT)
    - backward-compat: <=1 column falls through byte-identical to legacy single-column SQL
  affects: [102-03-renderer]
tech_stack:
  added: []
  patterns:
    - bar-only conditional UI block via isBar flag (mirrors NumericLineConfigPanel metrics[] builder pattern)
    - multi-column SQL branch guarded by shared pure helper (isMultiColumnBarGroupBy)
    - generous LIMIT = config.limit × useAuthStore.getState().maxBarGroupBySeriesCap × 2
    - aria-label on per-row selects for accessibility + test queryability
key_files:
  created: []
  modified:
    - packages/web/src/components/charts/definitions/bar.ts
    - packages/web/src/components/charts/ChartConfigPanel.tsx
    - packages/web/src/components/charts/ChartConfigPanel.spec.tsx
key_decisions:
  - "EXTEND ChartConfigPanel (not fork a new BarConfigPanel) — bar's Phase 98 customWhere, Phase 100 custom-metric, Phase 101 yAxisScale all stay cohesive in one generatedSql"
  - "isBar flag gates builder UI; isMultiColumnBarGroupBy guard (length >= 2) gates SQL branch — single-column falls through unchanged (BARGRP-V119-04)"
  - "Soft column cap = 6 (MAX_BAR_GROUP_BY_COLUMNS) — separate from maxBarGroupBySeriesCap which caps rendered SERIES, not config columns"
  - "groupByColumns[0] always mirrored into groupByColumn on change — backward-compat for drill-down/tooltip code reading single groupByColumn"
  - "aria-label added to each builder row select (idx === 0: 'Primary group (x-axis)'; rest: 'Series dimension N') — enables test queryability via getByLabelText"
  - "GROUP BY uses real column names via colsClause (NEVER 'value' alias) — RESEARCH Pitfall 1"
requirements-completed: [BARGRP-V119-01, BARGRP-V119-04]
duration: ~18min
completed: "2026-07-01"
---

# Phase 102 Plan 02: Bar Config Panel + Multi-Column SQL Branch Summary

**Bar-only N-column group-by builder UI in ChartConfigPanel + multi-column generatedSql branch (SELECT col1,col2,…,AGG AS value GROUP BY col1,col2 ORDER BY value DESC LIMIT config×cap×2), byte-identical single-column path locked by spec.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-07-01T22:08:00Z
- **Completed:** 2026-07-01T22:20:00Z
- **Tasks:** 3 (Task 1 was pre-committed; resumed at Task 2)
- **Files modified:** 3

## Accomplishments

- Bar widget designer can add/remove an ordered list of group-by columns (max 6), with the first labeled "Primary group (x-axis)" and subsequent rows labeled "Series dimension N"
- Multi-column generatedSql branch fires only when `isMultiColumnBarGroupBy(draft)` (length >= 2); uses a generous LIMIT = `config.limit × maxBarGroupBySeriesCap × 2` read from auth store at save time
- Backward-compat fully locked: <=1 column (or no `groupByColumns`) falls through byte-identical to the legacy single-column SQL path; spec asserts the exact string

## Task Commits

Each task was committed atomically:

1. **Task 1: Add groupByColumns field to bar definition** - `4c58309` (feat) — pre-committed before resume
2. **Task 2: Bar-only N-column builder UI in ChartConfigPanel** - `e2e5f72` (feat)
3. **Task 3: Multi-column generatedSql branch RED** - `a515568` (test)
4. **Task 3: Multi-column generatedSql branch GREEN** - `588901e` (feat)

## Files Created/Modified

- `packages/web/src/components/charts/definitions/bar.ts` — added `groupByColumns: [] as string[]` to `defaultConfig`; updated `stacked` hint to document grouped/stacked dual meaning
- `packages/web/src/components/charts/ChartConfigPanel.tsx` — `isBar` flag; N-column ordered builder (IIFE pattern, `MAX_BAR_GROUP_BY_COLUMNS = 6`); mirroring `groupByColumns[0]` → `groupByColumn`; `aria-label` on row selects; `isMultiColumnBarGroupBy` guarded SQL branch with generous LIMIT; `draft.groupByColumns` in dep array
- `packages/web/src/components/charts/ChartConfigPanel.spec.tsx` — 5 new BARGRP specs (1 RED→GREEN cycle), 2 pre-existing dv-picker tests updated (Rule 1 auto-fix)

## Decisions Made

- EXTEND `ChartConfigPanel` not fork a new `BarConfigPanel` — Phase 98/100/101 wiring stays cohesive
- `groupByColumns[0]` always mirrored into `groupByColumn` so drill-down/tooltip code reading the single-column field continues to work
- `GROUP BY ${colsClause}` uses real column names, never the `value` alias (RESEARCH Pitfall 1)
- Soft column cap (6) is a UI-readability ceiling, intentionally NOT the env-driven `maxBarGroupBySeriesCap` which caps rendered series

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed 2 dv-picker spec assertions broken by bar builder UI change**
- **Found during:** Task 2 (bar-only N-column builder UI)
- **Issue:** Two pre-existing tests in ChartConfigPanel.spec.tsx used `getByLabelText("Group By")` on `widgetType="bar"` — the single Group By select is now replaced by the N-column builder for bar charts, so the label no longer exists for that type
- **Fix:** (1) For the "column pickers source from columns_json" test: added `groupByColumns: [""]` to initial config to seed one builder row, then changed assertion to use `getByLabelText("Primary group (x-axis)")`. (2) For the "columns_json is null, pickers disabled" test: replaced `getByLabelText("Group By")` with `getByRole("button", { name: /\+ Add column/i })` disabled assertion. Also added `aria-label` to each builder row select so `getByLabelText` works.
- **Files modified:** `packages/web/src/components/charts/ChartConfigPanel.tsx`, `packages/web/src/components/charts/ChartConfigPanel.spec.tsx`
- **Verification:** 29 pre-existing tests pass; 5 new BARGRP tests pass; `tsc --noEmit` clean
- **Committed in:** `e2e5f72` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - backward-compat spec update required by Task 2 UI change)  
**Impact on plan:** Required for test correctness — the new bar builder changed the DOM structure for bar charts, making the old label queries invalid.

## Issues Encountered

- Theme-guard failure observed during full-suite run — caused by uncommitted `WidgetRenderer.tsx` hex comment from parallel Plan 03 work (a code comment showing AARRGGBB→#hex conversion). Confirmed pre-existing (not caused by Plan 02 changes): theme-guard passes 136/136 when WidgetRenderer's uncommitted changes are stashed. Logged as deferred for Plan 03 to resolve.
- One DatasetsPage.spec.tsx test fails intermittently in full-suite run but passes in isolation — confirmed pre-existing TD-V16-TEST-ISOLATION cross-test contamination pattern, not introduced by Plan 02.

## Next Phase Readiness

- `groupByColumns` is now persisted to bar widget config on Apply — Plan 03 (BarRenderer) can read it via `widget.config.groupByColumns` and call `toBarPivotInput()` from `barGroupedSeries.ts` for pivot rendering
- The single-column `groupByColumn` is always kept in sync (mirrored from `groupByColumns[0]`) — Plan 03 renderer doesn't need to change its single-series read path

## Self-Check: PASSED

- [x] `packages/web/src/components/charts/definitions/bar.ts` — EXISTS
- [x] `packages/web/src/components/charts/ChartConfigPanel.tsx` — EXISTS
- [x] `packages/web/src/components/charts/ChartConfigPanel.spec.tsx` — EXISTS
- [x] Commit `4c58309` — EXISTS (Task 1: bar definition groupByColumns)
- [x] Commit `e2e5f72` — EXISTS (Task 2: builder UI + Rule 1 spec fixes)
- [x] Commit `a515568` — EXISTS (Task 3 RED: failing specs)
- [x] Commit `588901e` — EXISTS (Task 3 GREEN: multi-column SQL branch)

---
*Phase: 102-multi-column-group-by-on-bar-chart*
*Completed: 2026-07-01*
