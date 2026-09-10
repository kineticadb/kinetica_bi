---
phase: 63-client-dv-drill-down
plan: 04
subsystem: ui
tags: [drill-down, dynamic-view, filter-chips, zustand, react]

# Dependency graph
requires:
  - phase: 63-client-dv-drill-down
    provides: "63-01 dvFilters slice + removeDvFilter/clearDvFilters + reset() extension"
  - phase: 63-client-dv-drill-down
    provides: "63-03 dv-bound widget Effect 1 dv-filter materialize/clear branch"
provides:
  - "dv-filter chip group in the dashboard FilterBar, keyed by dynamicViewId, labeled by dv name"
  - "removable dv chips (removeDvFilter) + per-dv Clear all (clearDvFilters)"
  - "dv-filter lifecycle reset verified (clears on dashboard-switch + logout via 63-01 reset chain)"
affects: [phase-64-verification, dv-drill-down]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Parallel dv-keyed chip group as a SIBLING block to the table-keyed FilterBar items (dvId/tableId number-collision avoidance)"
    - "Reuse existing chip CSS classes (filter-bar-item/-table/-chips/-chip/-chip-dismiss/-clear) for theme-token parity"

key-files:
  created: []
  modified:
    - packages/web/src/components/DashboardsPage.tsx
    - packages/web/src/components/DashboardsPage.spec.tsx

key-decisions:
  - "dv chips render as a separate sibling block (not merged into the table-keyed map) because a dvId and a tableId are both numbers and would collide"
  - "No new reset call site — the existing reset() chain (App.tsx logout + DashboardsPage dashboard-switch), extended in 63-01 to zero dvFilters, clears dv chips for free"

patterns-established:
  - "dv-name lookup via dynamicViews.find((dv) => dv.id === dvId)?.name with `dynamic view ${dvId}` fallback"

requirements-completed: [DVDRILL-V112-05]

# Metrics
duration: 7 min
completed: 2026-06-15
---

# Phase 63 Plan 04: dv-Filter Chips in the Dashboard FilterBar Summary

**Removable dv-drill chips in the shared FilterBar — labeled by the dynamic-view name + clicked value, dismiss calls removeDvFilter so the dv-bound widget reverts; table-filter + spatial chips byte-unchanged.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-06-15T22:37:00Z
- **Completed:** 2026-06-15T22:44:22Z
- **Tasks:** 1 (TDD: 2 commits — RED + GREEN)
- **Files modified:** 2

## Accomplishments

- dv-filter chip group rendered INSIDE the existing `.filter-bar`, keyed by `dynamicViewId`, as a sibling block to the table-keyed items (avoids the dvId/tableId number collision).
- Chip label resolves the dynamic-view NAME from the in-scope `dynamicViews` list (`dynamicViews.find((dv) => dv.id === dvId)?.name`), with a `dynamic view ${dvId}` fallback for orphan ids.
- Dismiss (×) calls `removeDvFilter(dvId, column)`; per-dv "Clear all" calls `clearDvFilters(dvId)` → empties `dvFilters[dvId]` → 63-03 Effect 1 drops the dv-filter view + reverts to the raw dv view.
- FilterBar visibility gate extended with `hasAnyDvFilters` so the bar shows for a dv-only filter.
- Reused the existing chip CSS classes (theme-token parity; theme-guard spec green — no raw hex).
- Lifecycle (DVDRILL-V112-05): dv chips clear on dashboard-switch + logout via the 63-01 `reset()` extension — regression-locked by `filterStore.spec.ts:379` ("reset() zeroes BOTH dvFilters AND filters"). NO new reset call site added.

## Task Commits

1. **Task 1 (RED): failing dv-filter chip tests** - `c85b1da` (test)
2. **Task 1 (GREEN): render removable dv-filter chips** - `bd966df` (feat)

_TDD: RED → GREEN; no REFACTOR needed._

## Files Created/Modified

- `packages/web/src/components/DashboardsPage.tsx` - added `allDvFilters` subscription, extended the FilterBar gate with `hasAnyDvFilters`, rendered the dv-filter chip group (dv-name label, removeDvFilter/clearDvFilters wiring) as a sibling block to the table-keyed items.
- `packages/web/src/components/DashboardsPage.spec.tsx` - 5 new tests: dv chip renders (name + value), dismiss → removeDvFilter empties `dvFilters[dvId]`, Clear all → clearDvFilters, generic fallback label for orphan dv id, and a table-filter chip regression (still renders + dismisses). Fixed the test's table mock to the real `TableDto` shape (`schema`/`name`).

## Decisions Made

- dv chips render as a SEPARATE sibling block, not merged into the table-keyed `.filter-bar-item` map, because a dvId and a tableId are both numbers and would collide on a shared key/iteration.
- No new reset call site: the existing `reset()` chain (extended in 63-01 to zero `dvFilters`) already clears dv chips on dashboard-switch + logout.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Initial regression test asserted the source-table name `demo.trips` but the test's table mock used `schema_name`/`table_name` while the production `srcName` lookup reads `TableDto.schema`/`.name`. Fixed the mock to the real `TableDto` shape — the regression assertion now exercises the true production name-resolution path. (Test-authoring fix, not a production change.)

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 63 (Client — DV Drill-Down) is COMPLETE: all 4 plans shipped (keying 63-01, dispatch 63-02, read-path 63-03, chips/lifecycle 63-04). DVDRILL-V112-01/02/04/05 + client side of -03 delivered.
- Verification gates: frontend vitest 2133/2133 green (from `packages/web`); web tsc clean; theme-guard green; `git diff --name-only -- packages/server` EMPTY.
- Ready for Phase 64 (Verification + Live UAT).

## Self-Check: PASSED

- FOUND: packages/web/src/components/DashboardsPage.tsx
- FOUND: packages/web/src/components/DashboardsPage.spec.tsx
- FOUND: .planning/phases/63-client-dv-drill-down/63-04-SUMMARY.md
- FOUND commit: c85b1da (test RED)
- FOUND commit: bd966df (feat GREEN)

---
*Phase: 63-client-dv-drill-down*
*Completed: 2026-06-15*
