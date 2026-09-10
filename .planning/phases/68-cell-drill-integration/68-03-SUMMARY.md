---
phase: 68-cell-drill-integration
plan: 03
subsystem: ui
tags: [react, vitest, zustand, svg, calendar, filter-toggle, respondToFilters, tdd]

# Dependency graph
requires:
  - phase: 68-02
    provides: CalendarRenderer cell-click BETWEEN drill dispatch + appliedCell highlight
  - phase: 66
    provides: CalendarConfigPanel + CalendarConfig type (adds respondToFilters field)
  - phase: 67
    provides: CalendarRenderer FROM resolution logic (gated by respondToFilters)
provides:
  - "CalendarConfig.respondToFilters boolean field (default false)"
  - "DEFAULT_CALENDAR_CONFIG.respondToFilters = false"
  - "'Respond to dashboard filters' checkbox in CalendarConfigPanel (accent-checkbox)"
  - "CalendarRenderer FROM resolution gated on respondToFilters: OFF=base/raw-dv, ON=Phase-67 filter-aware"
  - "respondToFilters in useEffect dep array (toggling re-resolves FROM)"
  - "fvMaterializing suspend skipped when OFF (base table fetch never blocked)"
  - "27-test CalendarRenderer spec + 16-test CalendarConfigPanel spec all green"
affects: [69-verification-live-uat]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "respondToFilters OFF-default pattern: calendar reads unfiltered source by default, making it a stable drill control; filter-awareness is opt-in"
    - "Gated FROM resolution: if (respondToFilters) { ON path } else { OFF path } — clean branch in useEffect before SQL build"
    - "Suspend gate scoping: fvMaterializing early-return wrapped inside the ON branch only — OFF path never blocked by filter-view state"

key-files:
  created: []
  modified:
    - packages/web/src/components/charts/CalendarConfigPanel.tsx
    - packages/web/src/components/charts/CalendarConfigPanel.spec.tsx
    - packages/web/src/components/charts/CalendarRenderer.tsx
    - packages/web/src/components/charts/CalendarRenderer.spec.tsx

key-decisions:
  - "respondToFilters defaults to false (OFF): calendar is primarily a drill CONTROL — stable full-grid by default, filter-awareness is opt-in"
  - "OFF path for dv-bound still requires dvStatus=materialized and dvViewName present — raw dv view must exist before fetching"
  - "Cell clicks (handleCellClick) are NOT gated on respondToFilters: clicks always drive filters into stores regardless of toggle"
  - "fvMaterializing suspend gate is inside the ON branch: OFF never waits on filter view materializing"
  - "respondToFilters added to useEffect dep array: toggling immediately re-resolves the FROM target without config save"

patterns-established:
  - "Toggle-gated FROM resolution: if (respondToFilters) { filter-aware precedence } else { unfiltered source } before buildCalendarSql()"
  - "Opt-in filter consumption: default OFF means widgets can be passive drill controls; widgets that want live-narrowing opt in explicitly"

requirements-completed: [CALDR-V113-01]

# Metrics
duration: 8min
completed: 2026-06-16
---

# Phase 68 Plan 03: Respond-to-Filters Toggle — CalendarConfigPanel + CalendarRenderer Gate Summary

**`respondToFilters` boolean config toggle (default OFF) added to CalendarConfig, checkbox wired in CalendarConfigPanel, and CalendarRenderer FROM resolution branched on the toggle — OFF always reads the unfiltered source (stable drill control), ON restores Phase 67 filter-aware precedence**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-06-16T19:55:00Z
- **Completed:** 2026-06-16T20:03:00Z
- **Tasks:** 2 (Task 1 already committed prior; Task 2 committed this session)
- **Files modified:** 4

## Accomplishments
- `CalendarConfig.respondToFilters?: boolean` field added; `DEFAULT_CALENDAR_CONFIG.respondToFilters = false` (verified)
- "Respond to dashboard filters" checkbox renders in CalendarConfigPanel when source is configured; uses `accent-checkbox` class; `htmlFor` + `aria-label` wired; `patch({ respondToFilters: e.target.checked })` on toggle
- CalendarRenderer FROM resolution branched: OFF branch → table-bound reads `schema.table` (ignores `fvViewName`); dv-bound reads raw `dvViewName` (ignores `dvFilterViewName`); ON branch → Phase 67 full precedence unchanged
- `fvMaterializing` suspend gate scoped inside the ON branch — OFF mode never blocked by a filter view materializing
- dv-bound OFF path still requires `dvStatus === "materialized"` and `dvViewName` present (raw dv must exist)
- `respondToFilters` added to useEffect dep array — toggling immediately re-resolves the FROM target
- Cell click handler (`handleCellClick`) NOT gated on the toggle — clicks always drive filters into stores
- 43 total tests green: 16 CalendarConfigPanel + 27 CalendarRenderer (Tests 3/3a, 4a/4a-on, 9, 19b, 19c all covering respondToFilters semantics)
- theme-guard: 50/50 passing; tsc --noEmit: clean; banned-import grep: no `materializeFilter`/`dropFilterView`/`fromSwap` in CalendarRenderer

## Task Commits

1. **Task 1: respondToFilters field + 'Respond to dashboard filters' checkbox** — `84b740a` (feat)
2. **Task 2: Gate CalendarRenderer FROM resolution on respondToFilters** — `cf1591e` (feat)

## Files Created/Modified
- `packages/web/src/components/charts/CalendarConfigPanel.tsx` — `respondToFilters?: boolean` in `CalendarConfig` type; `respondToFilters: false` in `DEFAULT_CALENDAR_CONFIG`; `respondToFilters` read from cfg; checkbox field with `accent-checkbox` class + `htmlFor` + `aria-label`
- `packages/web/src/components/charts/CalendarConfigPanel.spec.tsx` — Tests 12–16: checkbox renders, default unchecked, toggle-ON calls onChange with true, toggle-OFF calls onChange with false, DEFAULT_CALENDAR_CONFIG has respondToFilters:false
- `packages/web/src/components/charts/CalendarRenderer.tsx` — `respondToFilters` read from cfg; useEffect FROM resolution gated: `if (respondToFilters) { ON path } else { OFF path }`; `respondToFilters` in dep array
- `packages/web/src/components/charts/CalendarRenderer.spec.tsx` — Tests 3/3a (table OFF/ON), 4a/4a-on (dv OFF/ON), 9 updated (suspend only when ON), 19b (clicks still dispatch when OFF), 19c (dep array source assertion)

## Decisions Made
- respondToFilters defaults to false (OFF): the calendar is a drill CONTROL — the stable full-grid is its natural state; operators opt in to filter-awareness via the checkbox
- Cell clicks are never gated on the toggle: the calendar's job as a control is to SET filters for other widgets; that path is unconditional
- dv-bound OFF still requires `dvStatus=materialized` + `dvViewName` — the raw DV view must exist before a query is possible (not a filter-awareness concern)
- fvMaterializing suspend moved inside the ON branch — prevents the base-table fetch from being inadvertently blocked when the toggle is OFF

## Deviations from Plan

None - plan executed exactly as written. Implementation was partially pre-applied (Task 1 committed at `84b740a` before this session started); Task 2 committed in this session at `cf1591e`.

## Issues Encountered
None — both files already had the correct structure from Phase 66/67/68-02. Spec updates for the default-behavior change (OFF vs the prior always-filter-aware) were straightforward branching additions.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- CALDR-V113-01 respondToFilters toggle fully implemented and spec-verified (43/43 green)
- Phase 69 UAT can verify: default-OFF calendar shows full grid; toggle ON shows filter-narrowed grid; cell clicks on OFF calendar still filter other widgets
- CAL-V113-05 re-fetch demonstration: Phase 69 must toggle ON to show filter-awareness in live UAT
- SOLE-TRIGGER INVARIANT intact: no `materializeFilter`/`dropFilterView`/`fromSwap` in CalendarRenderer

## Self-Check: PASSED

---
*Phase: 68-cell-drill-integration*
*Completed: 2026-06-16*
