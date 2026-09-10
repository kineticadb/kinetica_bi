---
phase: 12-dashboard-layers-panel
plan: "03"
subsystem: api
tags: [zustand, typescript, vitest, tdd, client, store, layers]

# Dependency graph
requires:
  - phase: 12-01
    provides: 5 Express routes under /api/dashboards/:id/layers, DashboardLayer + LayerType types
  - phase: 09-filter-foundation
    provides: useFilterStore pattern (Zustand slice shape, reset shim, test setup)
provides:
  - DashboardLayerDto TypeScript type + LayerType union in src/api/client.ts
  - 5 CRUD functions in client.ts: listDashboardLayers, createLayer, updateLayer, deleteLayer, reorderLayers
  - useDashboardLayersStore Zustand slice with setLayers, addLayer, updateLayer, removeLayer, reorderLayers
  - Reference-stable updateLayer (unmodified layers keep object reference for React.memo / selector hooks)
  - 9-test Vitest spec validating all mutations including reference-stability and no-op behaviour
affects: [12-04, 12-05, 12-06, LayersModal, MapChartRenderer]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "apiFetch + throwForStatus error wrapping — matches widget CRUD pattern in client.ts"
    - "Zustand create<State> slice — mirrors useFilterStore shape (PITFALL S-01 lock)"
    - "Reference-stable updateLayer: slice()+spread only on matching index; unknown id returns state unchanged"
    - "TDD red→green: spec created and confirmed failing before store implementation"

key-files:
  created:
    - kinetica_bi/src/store/dashboardLayersStore.ts
    - kinetica_bi/src/store/dashboardLayersStore.spec.ts
  modified:
    - kinetica_bi/src/api/client.ts

key-decisions:
  - "updateLayer is reference-stable: only the matching layer object is recreated via slice()+spread; layers at other indices keep their original reference — required for React.memo and per-layer selector hooks in Plans 12-04/12-05"
  - "updateLayer with unknown id returns state unchanged (no-op, no push, no throw) — defensive but not silent; caller is responsible for passing valid ids"
  - "config patch in updateLayer deep-replaces the config field entirely (not nested merge) — LayersModal owns config shape and always sends the complete new config; nested merge would require LayersModal to read-before-write"
  - "Store auto-covered by Zustand reset shim (src/test/setup.ts vi.mock('zustand') + src/store/*.ts glob) — no per-store setup needed"

patterns-established:
  - "Dashboard-scope Zustand slice: setLayers([]) for dashboard switch reset (caller-driven, not store-internal)"
  - "Client CRUD shape: createLayer / updateLayer / deleteLayer / reorderLayers match POST/PATCH/DELETE/PATCH-reorder backend routes exactly; reorderLayers uses separate /reorder endpoint (Express route-precedence lock from Plan 12-01)"

requirements-completed:
  - LAYER-05-frontend-client
  - LAYER-06-frontend-store

# Metrics
duration: 2min
completed: "2026-05-06"
---

# Phase 12 Plan 03: Frontend API Client + Zustand Store Summary

**DashboardLayerDto + 5 CRUD functions in client.ts and reference-stable useDashboardLayersStore Zustand slice, TDD-verified with 9 passing tests**

## Performance

- **Duration:** 2 min
- **Started:** 2026-05-06T00:27:36Z
- **Completed:** 2026-05-06T00:29:45Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Added `LayerType` and `DashboardLayerDto` types to `src/api/client.ts` — mirrors `WidgetDto` shape exactly, backed by Plan 12-01 routes
- Added 5 CRUD functions: `listDashboardLayers`, `createLayer`, `updateLayer`, `deleteLayer`, `reorderLayers` — each uses `apiFetch + throwForStatus` consistent with existing widget/dashboard CRUD pattern
- Created `useDashboardLayersStore` Zustand slice with reference-stable `updateLayer` — unmodified layers keep their object reference, satisfying React.memo / selector requirements for Plans 12-04 and 12-05
- 9-test Vitest spec (TDD) passes: canary (reset shim), setLayers, addLayer, updateLayer (merge + reference-stability), unknown-id no-op, removeLayer, reorderLayers, config deep-replace; full suite 265/265

## Task Commits

Each task was committed atomically:

1. **Task 1: Add DashboardLayerDto + 5 CRUD functions to client.ts** - `78b257d` (feat)
2. **Task 2 RED: Add failing spec for useDashboardLayersStore** - `a92f388` (test)
3. **Task 2 GREEN: Implement useDashboardLayersStore Zustand slice** - `0b94086` (feat)

## Files Created/Modified
- `kinetica_bi/src/api/client.ts` - Appended LayerType, DashboardLayerDto, listDashboardLayers, createLayer, updateLayer, deleteLayer, reorderLayers (75 lines, append-only)
- `kinetica_bi/src/store/dashboardLayersStore.ts` - New Zustand slice (54 lines)
- `kinetica_bi/src/store/dashboardLayersStore.spec.ts` - New 9-test spec (77 lines)

## Decisions Made
- **Reference-stable updateLayer**: Uses `state.layers.slice()` + targeted index replacement so only the mutated layer gets a new object reference. Required for React.memo and per-layer selectors downstream (Plans 12-04/12-05).
- **config deep-replaces, never nested-merges**: The `patch` spread overwrites `config` entirely. LayersModal always sends the complete new config; nested merge would require read-before-write and create merge-conflict bugs.
- **Unknown id is a no-op returning state**: Returns the existing state object unchanged so Zustand does not trigger a re-render cycle and React.memo comparisons remain stable.
- **Caller-driven reset**: `setLayers([])` is the reset mechanism — store does not auto-reset on any lifecycle event; DashboardOpen is responsible for calling it on mount/unmount.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Pre-existing TypeScript errors in `MapChartRenderer.spec.tsx` and `MapConfigPanel.spec.tsx` (global-name + mock-type errors from Phase 11). Confirmed pre-existing via git stash check — not caused by Plan 12-03 changes. Out of scope per deviation scope boundary.

## Next Phase Readiness
- `DashboardLayerDto` type is now importable from `src/api/client` for Plans 12-04 (LayersModal) and 12-05 (MapChartRenderer N-layer stack)
- `useDashboardLayersStore` is ready for Plan 12-04 (LayersModal mutations) and Plan 12-05 (MapChartRenderer layer list reads)
- Reference-stability contract validated in spec — Plan 12-05 MapChartRenderer can safely use `layers[n]` as a stable dep for per-layer render effects

---
*Phase: 12-dashboard-layers-panel*
*Completed: 2026-05-06*
