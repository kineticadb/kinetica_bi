---
phase: 54-verification-live-walk-through
plan: 10
subsystem: frontend/hooks
tags: [spatial-filter, materialize, map-only, gap-closure, sole-trigger]
requirements: [TRACKFIX-V19-09]

dependency_graph:
  requires:
    - aggregateSpatialTargetsByTable (spatialTargets.ts)
    - materializeFilter / dropFilterView (api/client.ts)
    - useSpatialFilterStore (spatialFilterVersion dep)
    - useFilterStore (column filter composition)
    - useFilterViewStore (markMaterializing / setView / clearView / clearMaterializing)
    - useToastStore (error surface)
  provides:
    - useMapOnlySpatialMaterialize — dashboard-scope map-only spatial materialize hook
  affects:
    - DashboardsPage.tsx DashboardOpen — mounts the hook once per dashboard

tech_stack:
  added: []
  patterns:
    - Dashboard-scope orchestrator hook (mirrors useDynamicViewMaterializeChain)
    - Per-table AbortController Map with 300ms debounce
    - NON_TRIGGER_TYPES allow-list (future chart types auto-covered by default trigger treatment)
    - materializeFilter in-flight dedup cache as double-DDL backstop

key_files:
  created:
    - packages/web/src/hooks/useMapOnlySpatialMaterialize.ts
    - packages/web/src/hooks/useMapOnlySpatialMaterialize.spec.ts
  modified:
    - packages/web/src/components/DashboardsPage.tsx

decisions:
  - "NON_TRIGGER_TYPES allow-list approach: consumers listed explicitly; anything else (including unknown future chart types) treated as trigger — mirrors WidgetRenderer's else → AggregatedWidgetRenderer default branch"
  - "Real timers in specs (not fake): mirrors useDynamicViewMaterializeChain.spec.ts pattern; 350ms waitForDebounce helper lets the 300ms debounce fire naturally"
  - "ActiveFilter imported from store/filterStore in spec (not from client.ts — it is not re-exported from client)"
  - "position field required on WidgetDto fixtures (discovered via tsc --noEmit)"

metrics:
  duration_minutes: 5
  completed_date: "2026-06-08"
  tasks_completed: 2
  tasks_total: 3
  files_created: 2
  files_modified: 1
---

# Phase 54 Plan 10: useMapOnlySpatialMaterialize Hook Summary

**One-liner:** Dashboard-scope hook that fires `POST /api/filter/materialize` exclusively for map-only tables (no chart/records trigger widget), closing TRACKFIX-V19-09 without breaking the Phase 30 sole-trigger invariant.

## What Was Built

### `useMapOnlySpatialMaterialize(dashboardId, widgets): void`

A hook mirroring `useDynamicViewMaterializeChain` in structure, mounted once in `DashboardOpen`. It:

1. Aggregates eligible spatial targets per table via `aggregateSpatialTargetsByTable`.
2. Computes `triggeredTableIds` — any table that has a widget whose type is NOT in `NON_TRIGGER_TYPES` (i.e., has a chart/records widget that already fires Effect 1 in WidgetRenderer).
3. Derives `mapOnlyTargets` — the exclusive set of tables the hook owns (eligible target + no trigger widget).
4. Subscribes to `spatialFilterVersion` as a primitive dep (PITFALL S-02).
5. Fires a 300ms-debounced effect that: reads shapes imperatively, runs the DROP guard, aborts prior in-flight per table, calls `materializeFilter`, and updates `filterViewStore`.
6. Unmount effect aborts all in-flight materializes.

### Invariant preservation

- `NON_TRIGGER_TYPES = {"map","info-card","legend","datafilter","timeline","numericline"}` — allow-list of pure consumers.
- Any widget type NOT in the set is a trigger. This covers `records`, `bar/line/pie/scatter`, and any future chart that lands in WidgetRenderer's `else → AggregatedWidgetRenderer` branch.
- `materializeFilter`'s in-flight dedup cache (keyed `${dashboardId}:${tableId}`) is the final double-DDL backstop even in a race.

### Mount site

`DashboardsPage.tsx` `DashboardOpen`, immediately after `useDynamicViewMaterializeChain(dashboard.id)`, using the existing `widgets` state.

## Specs (9 tests, all passing)

| Test | Invariant |
|------|-----------|
| T1 | Map-only table fires materializeFilter exactly once on draw |
| T2 | Sole-trigger: map + bar on T → hook does NOT fire (WidgetRenderer owns T) |
| T3 | Records as trigger: map + records on T → hook does NOT fire for T |
| T4 | No shapes → no fire; stale view is dropped |
| T5 | Ineligible target (WKB) → no fire |
| T6 | Column filters composed into args.filters alongside spatialFilters |
| T7 | Rapid spatialFilterVersion bumps abort prior in-flight for same table |
| T8 | Clear all shapes → dropFilterView + clearView |
| T9 | Multi map-only tables → both fire exactly once |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Spec import: ActiveFilter not exported from client.ts**
- **Found during:** Task 2 tsc --noEmit gate
- **Issue:** Spec imported `ActiveFilter` from `"../api/client"` but that module only re-exports a subset — `ActiveFilter` is from `store/filterStore`
- **Fix:** Changed spec import to `import type { ActiveFilter } from "../store/filterStore"`
- **Files modified:** `packages/web/src/hooks/useMapOnlySpatialMaterialize.spec.ts`
- **Commit:** 5b7a8d6

**2. [Rule 1 - Bug] WidgetDto requires position field in fixtures**
- **Found during:** Task 2 tsc --noEmit gate
- **Issue:** `WidgetDto.position: number` is required; spec fixtures omitted it
- **Fix:** Added `position: id` to all three widget factory functions in the spec
- **Files modified:** `packages/web/src/hooks/useMapOnlySpatialMaterialize.spec.ts`
- **Commit:** 5b7a8d6

**3. [Rule 1 - Bug] Spec timer strategy: fake timers caused 5s timeouts**
- **Found during:** Initial GREEN run
- **Issue:** `waitFor` with `vi.useFakeTimers()` → `vi.advanceTimersByTime` blocked — async `await materializeFilter(...)` inside the debounce callback needs microtask flushing that fake timers don't provide automatically in this setup
- **Fix:** Switched to real timers + `waitForDebounce = () => new Promise(r => setTimeout(r, 350))` pattern, mirroring the existing `useDynamicViewMaterializeChain.spec.ts` approach
- **Files modified:** `packages/web/src/hooks/useMapOnlySpatialMaterialize.spec.ts`
- **Commit:** 071acb8

## Gates Passed

- `tsc --noEmit`: CLEAN
- Full vitest suite: 1665/1665 PASS (baseline 1656 + 9 new)
- `git diff --name-only packages/server`: SERVER-CLEAN (no server files modified)

## Remaining Task (Checkpoint)

**Task 3: Operator live re-walk** — human-verify checkpoint. Operator confirms:
1. Drawing a shape on a map-only table fires exactly ONE `POST /api/filter/materialize` (DevTools Network tab)
2. Track tiles re-render narrowed to the drawn shape
3. Clearing the shape fires the drop call and tiles return to full extent
4. Regression: table with a chart/records widget still fires only ONE materialize POST (no double-DDL)

## Self-Check: PASSED

- FOUND: packages/web/src/hooks/useMapOnlySpatialMaterialize.ts
- FOUND: packages/web/src/hooks/useMapOnlySpatialMaterialize.spec.ts
- FOUND: useMapOnlySpatialMaterialize mount in DashboardsPage.tsx
- FOUND commits: fff2859 (RED), 071acb8 (GREEN), 5b7a8d6 (mount+fixes)
