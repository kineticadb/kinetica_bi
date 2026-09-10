---
phase: 68-cell-drill-integration
plan: 02
subsystem: ui
tags: [react, vitest, zustand, svg, calendar, drill-down, filter-store, tdd]

# Dependency graph
requires:
  - phase: 68-01
    provides: buildChipText formatDatetimeRange (human-readable datetime-between chip labels)
  - phase: 67
    provides: CalendarRenderer base implementation (SVG grid, gap-fill, color scale, fetch)
  - phase: 65
    provides: computeCellBounds (cell ISO → [cellStart, cellEnd] BETWEEN bounds)
  - phase: 63
    provides: dv-isolated drill routing pattern (addDvFilter+markDvMaterializing)
provides:
  - "CalendarRenderer cell-click BETWEEN drill dispatch (table-bound: setBulkFilters+markMaterializing; dv-bound: addDvFilter+markDvMaterializing)"
  - "Toggle-off: re-clicking the active cell calls removeFilter/removeDvFilter+markMaterializing to clear the BETWEEN filter"
  - "Reactive selected-cell outline via appliedCell useMemo (mirrors TimelineRenderer appliedBand)"
  - "Toast on new drill via useToastStore"
  - "chartColors.ts accent field for theme-safe SVG stroke color"
  - "23-test spec covering all CALDR-V113-01 and CALDR-V113-02 acceptance criteria"
affects: [68-03, 69-verification-live-uat, timeline-renderer-pattern-consumers]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "handleCellClick closure with tid=tableId as number cast (TypeScript closure narrowing workaround)"
    - "appliedCell useMemo mirrors TimelineRenderer appliedBand — reactive active-filter derivation for highlight"
    - "useChartAxisColors accent field: concrete theme-derived string for SVG stroke (lib/ file, not scanned by theme-guard)"
    - "TDD: RED spec commit → GREEN feat commit pattern (2-commit TDD cycle)"

key-files:
  created: []
  modified:
    - packages/web/src/components/charts/CalendarRenderer.tsx
    - packages/web/src/components/charts/CalendarRenderer.spec.tsx
    - packages/web/src/lib/chartColors.ts

key-decisions:
  - "Toggle-off uses removeFilter(tableId, timeCol) / removeDvFilter(dvId, timeCol) — NOT setBulkFilters([], []) which is a store no-op"
  - "Accent stroke for selected cell derived from useChartAxisColors (chartColors.ts under lib/) — keeps CalendarRenderer.tsx hex-free for theme-guard"
  - "appliedCell memo uses exact ISO string equality (computeCellBounds output) — same source of truth for highlight and toggle-off"
  - "SOLE-TRIGGER INVARIANT preserved: no materializeFilter/dropFilterView/fromSwap imports in CalendarRenderer"

patterns-established:
  - "Calendar drill pattern: computeCellBounds → ActiveFilter{between} → table/dv routing via dynamicViewId guard"
  - "Toggle-off equality: appliedCell[0]===cellStart && appliedCell[1]===cellEnd (computed at click time)"

requirements-completed: [CALDR-V113-01, CALDR-V113-02]

# Metrics
duration: 8min
completed: 2026-06-16
---

# Phase 68 Plan 02: Cell-Drill Integration — Dispatch + Highlight Summary

**CalendarRenderer now dispatches BETWEEN datetime filters on cell click (table/dv-routed, dv-isolated, toggle-off) with reactive selected-cell outline via appliedCell memo and info toast**

## Performance

- **Duration:** 8 min
- **Started:** 2026-06-16T14:09:24Z
- **Completed:** 2026-06-16T14:17:24Z
- **Tasks:** 2 (TDD: RED + GREEN commits each)
- **Files modified:** 3

## Accomplishments
- Cell-click BETWEEN drill dispatch: table-bound routes to `setBulkFilters+markMaterializing`; dv-bound routes to `addDvFilter+markDvMaterializing` (CALDR-V113-02 dv-isolation)
- Toggle-off: re-clicking the active cell calls `removeFilter`/`removeDvFilter` + `markMaterializing` to clear the BETWEEN filter without a toast
- `appliedCell` useMemo mirrors TimelineRenderer's `appliedBand` — derives `[lo, hi]` from the active `between` filter on `timeCol`, drives both outline and toggle-off equality
- Selected-cell outline uses `accent` from extended `useChartAxisColors` (concrete theme-derived color, hex lives in `chartColors.ts` under `lib/` — not scanned by theme-guard)
- 23 spec tests pass: 11 Phase-67 baseline + 12 new Phase-68 assertions (table drill, dv isolation, empty-cell guard, toggle-off, toast, highlight, no-highlight baseline)
- SOLE-TRIGGER INVARIANT preserved: no `materializeFilter`/`dropFilterView`/`fromSwap` imports

## Task Commits

1. **Task 1+2 RED: failing spec** — `5b8cd44` (test)
2. **Task 1+2 GREEN: implementation** — `7ca4c62` (feat)

## Files Created/Modified
- `packages/web/src/components/charts/CalendarRenderer.tsx` — cell-click handler, appliedCell memo, selected-cell stroke, useDashboardContext/computeCellBounds/useToastStore/buildChipText imports
- `packages/web/src/components/charts/CalendarRenderer.spec.tsx` — 12 new tests for drill/highlight behavior + extended filter-store mock with setBulkFilters/addDvFilter/removeDvFilter/removeFilter/markMaterializing/markDvMaterializing/showToast
- `packages/web/src/lib/chartColors.ts` — added `accent` field to `ChartAxisColors` type and `useChartAxisColors` return value

## Decisions Made
- Toggle-off uses `removeFilter`/`removeDvFilter` (targeted column remove) not `setBulkFilters(tableId, [])` (which is a store no-op for empty batch — preserves all existing filters)
- Accent stroke for SVG rect derived via `useChartAxisColors().accent` — avoids raw hex literal in CalendarRenderer.tsx (hex values in `chartColors.ts` under `lib/` are not scanned by theme-guard)
- Combined Tasks 1 and 2 into a single TDD RED+GREEN cycle since the appliedCell memo is shared between the toggle-off handler and the highlight rendering

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Toggle-off implementation corrected to removeFilter (not setBulkFilters)**
- **Found during:** Task 1 implementation
- **Issue:** Plan spec said "setBulkFilters(tableId, [])" for toggle-off, but this is a store no-op (setBulkFilters with empty batch preserves all existing filters since batchColumns is empty — no columns to replace)
- **Fix:** Used `removeFilter(tableId, timeCol)` for table path and `removeDvFilter(dynamicViewId, timeCol)` for dv path — targeted column remove correctly clears the calendar's BETWEEN filter
- **Files modified:** CalendarRenderer.tsx, CalendarRenderer.spec.tsx (test updated to assert removeFilter)
- **Committed in:** 7ca4c62

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Toggle-off now correctly clears the filter; using the wrong action would have silently left the filter active (no UX change, filterVersion bump not fired for no-op).

## Issues Encountered
- TypeScript could not narrow `tableId` (type `number | undefined`) inside the `handleCellClick` closure even though an early-return guard precedes the hooks. Fixed by `const tid = tableId as number` with an explanatory comment.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- CALDR-V113-01 (table-bound drill) and CALDR-V113-02 (dv-isolated drill) are fully implemented and spec-verified
- Phase 68-03 (respondToFilters toggle + WMS propagation) can proceed; CalendarRenderer cell-click drill is complete
- Phase 69 UAT can verify the drill interaction live

## Self-Check: PASSED

---
*Phase: 68-cell-drill-integration*
*Completed: 2026-06-16*
