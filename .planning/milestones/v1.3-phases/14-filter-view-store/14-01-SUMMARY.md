---
phase: 14-filter-view-store
plan: 01
subsystem: ui
tags: [zustand, typescript, filter-view-store, vitest, tdd]

# Dependency graph
requires:
  - phase: 13-spikes-and-endpoint
    provides: "POST /api/filter/materialize endpoint shape; view-name regex; locked endpoint contract"
provides:
  - "useFilterViewStore Zustand slice with views/setView/clearView/markMaterializing/bumpMaterializeVersion/reset"
  - "FilterViewEntry and FilterViewState exported TypeScript types"
  - "16-test spec verifying canary, all 5 actions, and reference-stability"
affects: [15-filter-consumer, 16-map-filter]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Reference-stable per-tableId updates: mutating views[X] does not change identity of views[Y]"
    - "TDD flow: implementation + spec in same plan; spec covers canary x2, all actions, ref-stability"
    - "Two-store split: chip state in useFilterStore (unchanged); view names in useFilterViewStore (new)"

key-files:
  created:
    - kinetica_bi/src/store/filterViewStore.ts
    - kinetica_bi/src/store/filterViewStore.spec.ts
  modified: []

key-decisions:
  - "Phase 14 ships dormant plumbing only — no AggregatedWidgetRenderer, App.tsx, or DashboardsPage.tsx modifications in this plan"
  - "setView is POST-200 ONLY (V13-P-01 lock): markMaterializing is the pre-call action; no optimistic write"
  - "clearView uses delete-key semantics (key-absence, not empty-array) mirroring filterStore.clearFilters"
  - "materializeVersion increments on same-name CREATE OR REPLACE; resets to 1 on new viewName"
  - "markMaterializing creates placeholder entry if absent; preserves prior fields if entry exists"

patterns-established:
  - "Pattern 1: Reference-stable per-tableId Zustand updates — spread views object with new entry for target id; other ids keep identity"
  - "Pattern 2: Inline pitfall comments with PITFALL IDs (V13-P-01, V13-P-09, V13-P-10) matching filterStore.ts comment style"
  - "Pattern 3: Zustand reset shim auto-coverage — any src/store/*.ts slice is covered by vi.mock('zustand') in setup.ts"

requirements-completed: [VSTORE-V13-01, VSTORE-V13-02]

# Metrics
duration: 2min
completed: 2026-05-06
---

# Phase 14 Plan 01: useFilterViewStore Slice Summary

**Per-tableId Zustand store for server-resolved view names with materializing flag and materializeVersion, shipping as dormant plumbing for Phase 15 trigger wiring**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-05-06T19:55:07Z
- **Completed:** 2026-05-06T19:57:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created `useFilterViewStore` Zustand slice with reference-stable per-tableId `FilterViewEntry` updates
- Implemented all 5 locked actions: `setView` (POST-200 only, version-bump semantics), `clearView` (delete-key), `markMaterializing` (placeholder + preserve), `bumpMaterializeVersion` (increment-or-noop), `reset` (empty)
- Shipped 16-test spec with canary x2 (Zustand shim verification), full action coverage, and reference-stability assertions confirming other tableId entries retain object identity

## Task Commits

Each task was committed atomically:

1. **Task 1: Create useFilterViewStore slice** - `7d5aca4` (feat)
2. **Task 2: Write filterViewStore.spec.ts** - `e4776ec` (test)

**Plan metadata:** (docs commit follows)

_Note: TDD tasks — implementation written first, then spec verified GREEN in a single pass_

## Files Created/Modified
- `kinetica_bi/src/store/filterViewStore.ts` - useFilterViewStore Zustand slice with FilterViewEntry/FilterViewState types and 5 actions (~98 LOC including JSDoc + inline pitfall comments)
- `kinetica_bi/src/store/filterViewStore.spec.ts` - 16 test cases covering canary, all 5 actions, and reference-stability assertions (~138 LOC)

## Decisions Made
- Phase 14 ships dormant plumbing — no production callers wired in this plan; Phase 15 wires the AggregatedWidgetRenderer trigger
- `setView` is POST-200 ONLY (V13-P-01): never writes viewName before server confirms; `markMaterializing` is the pre-call action
- `clearView` uses delete-key semantics (key-absence) mirroring `filterStore.clearFilters`
- `materializeVersion` increments by 1 when same viewName is overwritten (CREATE OR REPLACE content swap); resets to 1 on new viewName
- `markMaterializing` on missing entry creates placeholder with `{ viewName: "", expiresAt: 0, materializing: true, materializeVersion: 0 }`

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - all 16 tests passed on first run; tsc clean throughout.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `useFilterViewStore` is ready for Phase 15 to subscribe to `views[tableId]` via selectors
- `setView`, `markMaterializing`, `clearView` are ready for Phase 15 `AggregatedWidgetRenderer` trigger wiring
- `bumpMaterializeVersion` is ready for Phase 15/16 reactive recovery + WMS cache-bust callers
- `reset()` is ready for Phase 15 to wire into `App.tsx:40-44` (logout) and `DashboardsPage.tsx:379-383` (dashboard-switch)
- Plan 14-02 (API helpers: `materializeFilter` + `dropFilterView` in `src/api/client.ts`) is the next immediate deliverable

---
*Phase: 14-filter-view-store*
*Completed: 2026-05-06*
