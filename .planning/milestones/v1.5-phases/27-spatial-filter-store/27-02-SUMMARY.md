---
phase: 27-spatial-filter-store
plan: 02
subsystem: ui
tags: [zustand, vitest, store, spatial-filter, lifecycle-reset, typescript]

# Dependency graph
requires:
  - phase: 27-01
    provides: useSpatialFilterStore Zustand slice with addShape/reset — direct consumer in lifecycle wiring
  - phase: 23-info-card
    provides: 4-store reset block pattern (App.tsx + DashboardsPage.tsx) — extended to 5th store here
provides:
  - useSpatialFilterStore.reset() wired as 5th call in App.tsx UNAUTHORIZED handler
  - useSpatialFilterStore.reset() wired as 5th call in DashboardsPage.tsx DashboardOpen cleanup
  - App.spec.tsx ALL FIVE stores test with spatialFilterStore seed + assertions (STORE-V15-04)
  - DashboardsPage.spec.tsx ALL FIVE stores test with spatialFilterStore seed + assertions (STORE-V15-04)
affects:
  - 29-spatial-draw (first OL consumer — MapDrawToolbar; lifecycle reset already wired)
  - 30-materialize-and-chips (AggregatedWidgetRenderer dep array reads spatialFilterVersion; reset confirmed clean)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "5-store reset block additive pattern: add import + 1 reset call at two production sites (App.tsx + DashboardsPage.tsx); extend 2 spec tests from ALL FOUR to ALL FIVE"
    - "Session-only store reset wiring: no DROP loop, no server resource, mirrors lastInfoClickContextStore pattern"

key-files:
  created: []
  modified:
    - kinetica_bi/src/App.tsx
    - kinetica_bi/src/App.spec.tsx
    - kinetica_bi/src/components/DashboardsPage.tsx
    - kinetica_bi/src/components/DashboardsPage.spec.tsx

key-decisions:
  - "No DROP loop added for spatial shapes at either reset site — shapes are session-only client state with no server-side resource to free; mirrors infoSelectionStore + lastInfoClickContextStore pattern"
  - "Canonical 5-store reset order locked: filterViewStore → filterStore → infoSelectionStore → lastInfoClickContextStore → spatialFilterStore (5th)"

patterns-established:
  - "5-store reset block pattern: the canonical order is now fixed at 5 stores; Phase 29+ must not reorder existing calls when adding future stores"

requirements-completed:
  - STORE-V15-04

# Metrics
duration: 5min
completed: 2026-05-12
---

# Phase 27 Plan 02: lifecycle-reset-wiring Summary

**5th-store lifecycle reset wired at both App.tsx UNAUTHORIZED and DashboardsPage.tsx DashboardOpen cleanup with full spec coverage — STORE-V15-04 closed, Phase 27 complete**

## Performance

- **Duration:** 5 min
- **Started:** 2026-05-12T16:20:00Z
- **Completed:** 2026-05-12T16:25:05Z
- **Tasks:** 3 (Tasks 1+2 committed individually; Task 3 is a verification gate, no file edits)
- **Files modified:** 4

## Accomplishments

- Added `useSpatialFilterStore` import + `useSpatialFilterStore.getState().reset()` as 5th call in App.tsx UNAUTHORIZED handler (after `useLastInfoClickContextStore.getState().reset()`); no DROP loop added (session-only shapes)
- Added `useSpatialFilterStore` import + `useSpatialFilterStore.getState().reset()` as 5th call in DashboardsPage.tsx DashboardOpen cleanup; dashboard-A shapes guaranteed not to leak into dashboard-B
- Extended App.spec.tsx ALL FOUR test → ALL FIVE with spatialFilterStore seed (`addShape`) and 3 assertions (`shapes=[]`, `spatialFilterVersion=0`, `shapeCounter=0`); full vitest suite 538/538 green

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire 5th-store reset into App.tsx + update App.spec.tsx** - `f1092d0` (feat)
2. **Task 2: Wire 5th-store reset into DashboardsPage.tsx + update DashboardsPage.spec.tsx** - `eb7d7b7` (feat)
3. **Task 3: Full frontend regression run** — no commit (verification gate only; 34 test files, 538 tests all green)

**Plan metadata:** (docs commit below)

## Files Created/Modified

- `kinetica_bi/src/App.tsx` — Added `useSpatialFilterStore` import; inserted 5th reset call with STORE-V15-04 comment in UNAUTHORIZED handler; canonical order comment preserved
- `kinetica_bi/src/App.spec.tsx` — Added `useSpatialFilterStore` import; renamed ALL FOUR → ALL FIVE test; seeded store via `addShape`; appended 3 assertions
- `kinetica_bi/src/components/DashboardsPage.tsx` — Added `useSpatialFilterStore` import (relative path `../store/spatialFilterStore`); inserted 5th reset call with STORE-V15-04 comment in DashboardOpen cleanup
- `kinetica_bi/src/components/DashboardsPage.spec.tsx` — Added `useSpatialFilterStore` import; renamed ALL FOUR → ALL FIVE test; seeded store via `addShape`; added reset call in direct-invocation block; appended 3 assertions

## Decisions Made

- No DROP loop for spatial shapes at either wiring site: shapes have no server-side resource (session-only client state). Mirrors `infoSelectionStore` (Phase 20) and `lastInfoClickContextStore` (Phase 23) patterns. The `filterViewStore` DROP loop at these same sites is for Kinetica materialized view cleanup — an entirely different lifecycle concern.
- Canonical 5-store order locked (filterViewStore → filterStore → infoSelectionStore → lastInfoClickContextStore → spatialFilterStore): this is the 5th and final store in the v1.5 milestone reset block.

## Deviations from Plan

None — plan executed exactly as written. Both insertion points were precisely specified by the RESEARCH.md exact line numbers. Test extension pattern was directly modeled on the existing ALL FOUR tests.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Phase 27 complete: STORE-V15-01..04 all closed (Plan 27-01 delivered the store; Plan 27-02 wired lifecycle reset)
- `useSpatialFilterStore` ships dormant with reset wiring — Phase 29 (MapDrawToolbar / VectorLayer OL consumer) can import `useSpatialFilterStore` and call `addShape` at `drawend`
- Exactly 6 files import `useSpatialFilterStore` (source, spec, App.tsx, App.spec.tsx, DashboardsPage.tsx, DashboardsPage.spec.tsx) — no OL consumer, no FilterBar consumer, no AggregatedWidgetRenderer consumer in Phase 27
- Full frontend suite: 34 test files, 538 tests green; tsc --noEmit exit 0

---
*Phase: 27-spatial-filter-store*
*Completed: 2026-05-12*
