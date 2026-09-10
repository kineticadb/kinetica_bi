---
phase: 96-verification-live-uat
plan: "03"
subsystem: filter-scope-legend-badge
tags: [filter-scope, legend, badge, dv-disable, COMM-V118-02, GAP-3, GAP-6, frontend-only]
dependency_graph:
  requires: []
  provides: [per-layer-legend-filter-indicator, dv-disable-badge-accept-all]
  affects: [LayersLegendPanel, MapChartRenderer, useFilterScopeSummary]
tech_stack:
  added: []
  patterns: [PITFALL-S-02-primitive-selector, state-time-getState-reads, widget-filter-badge-reuse, dvFilterScopeDisabled-accept-all]
key_files:
  created:
    - packages/web/src/lib/useFilterScopeSummary.spec.tsx
  modified:
    - packages/web/src/lib/useFilterScopeSummary.ts
    - packages/web/src/lib/resolveLegendLayers.ts
    - packages/web/src/components/LayersLegendPanel.tsx
    - packages/web/src/components/LayersLegendPanel.spec.tsx
    - packages/web/src/components/charts/MapChartRenderer.tsx
key_decisions:
  - "Reused existing widget-filter-badge CSS class for legend indicator — no invented class name, no raw hex"
  - "filterSummary computed by MapChartRenderer (caller) not LayersLegendPanel (stays store-free per PANEL-V17-01)"
  - "dvFilterScopeDisabled forces cfg=undefined (accept-all) for dv-bound sources in both badge hook and legend useMemo"
  - "dvFilters guard (filterState.dvFilters ?? {}) needed because MapChartRenderer.spec mocks filterStore without dvFilters"
  - "filterVersion + shapesKey added to resolvedLegendLayers useMemo deps to recompute on filter/shape changes"
metrics:
  duration: "30 minutes"
  completed_date: "2026-06-29"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 5
  files_created: 1
---

# Phase 96 Plan 03: Legend Filter Indicator + dv-disable Badge/Legend Summary

Per-layer "X of Y filters" legend indicator (COMM-V118-02 / GAP 6) and badge/legend dv-disable accept-all (GAP 3 badge+legend portion) via useFilterScopeSummary dvFilterScopeDisabled wiring.

## What Was Built

### Task 1: useFilterScopeSummary honors dvFilterScopeDisabled

`useFilterScopeSummary.ts` now subscribes to `useAuthStore(s => s.dvFilterScopeDisabled)`. When a source is dv-bound (`dynamicViewId !== undefined`) AND the flag is set, the hook passes `cfg: undefined` to `computeFilterScopeSummary`, producing accept-all (no ignored filters), so `appliedCount === totalCount` and `WidgetFilterBadge` renders null.

Table-bound sources are never affected. The pure `computeFilterScopeSummary` function is unchanged (stays testable without React). `dvFilterScopeDisabled` added to `useMemo` deps.

New spec file `useFilterScopeSummary.spec.tsx` covers three scenarios: flag-on dv-bound (accept-all), flag-off dv-bound (cfg honored), table-bound unaffected.

### Task 2: Per-layer legend indicator + dv-disable suppression

Three coordinated changes:

**resolveLegendLayers.ts:** Added `filterSummary?: { appliedCount: number; totalCount: number }` to `ResolvedLegendLayer`. The field is optional and computed by the caller (not by `resolveLegendLayers` itself — it stays a pure projection).

**LayersLegendPanel.tsx:** Destructures `filterSummary` from each layer entry in the `layers.map()`. Renders `<span className="widget-filter-badge">X of Y filters</span>` with `role="status"` and `aria-label` ONLY when `filterSummary.appliedCount < filterSummary.totalCount`. Reuses the existing `widget-filter-badge` class from `global.css` — no invented class names, no raw hex. Panel remains store-free (PANEL-V17-01 lock).

**MapChartRenderer.tsx:** Enriches each `resolvedLegendLayers` entry with `filterSummary` via `computeFilterScopeSummary` (imperative `getState()` reads — same state-time pattern as the existing dvViews read). Logic:
- dv-bound layer: `dvFilters[dvId]`, `spatialCapable=false`, no shapes; if `dvFilterScopeDisabled` → `cfg=undefined`
- table-bound layer: `filters[tableId]`; `spatialCapable` computed via `getSpatialTargets({config: widget.config}).filter(isSpatialTargetEligible).some(t => t.tableId === entry.layer.table_id)` (existing renderer pattern); shapes when spatialCapable
- Added `filterVersion` and `shapesKey` to `useMemo` deps for reactivity
- Added defensive guard `(filterState.dvFilters ?? {})` for test environments where the store mock omits `dvFilters`

New imports to MapChartRenderer: `computeFilterScopeSummary` from `../../lib/useFilterScopeSummary`, `useAuthStore` from `../../store/auth`.

Five new spec scenarios in `LayersLegendPanel.spec.tsx`: indicator shown, hidden (accept-all), hidden (undefined), aria-label contents, source class check.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] MapChartRenderer spec mock omits dvFilters from filterStore**
- **Found during:** Task 2 GREEN phase
- **Issue:** `MapChartRenderer.spec.tsx` mocks `filterStore` with only `filters` and `filterVersion` (no `dvFilters`). Our new code accessed `filterState.dvFilters[dvId]` causing `TypeError: Cannot read properties of undefined (reading '7')` across 17+ tests
- **Fix:** Wrapped as `(filterState.dvFilters ?? {})[dvId!] ?? []` — safe fallback when mock omits the field
- **Files modified:** `packages/web/src/components/charts/MapChartRenderer.tsx`
- **Commit:** be8d433

**2. [Rule 3 - Blocking] git stash side-effect reverted WIP edits**
- **Found during:** Task 2, when verifying pre-existing tsc errors in WidgetRenderer.tsx
- **Issue:** A diagnostic `git stash` (intended to check if errors pre-existed) reverted in-progress Task 2 edits to 3 files (resolveLegendLayers.ts, LayersLegendPanel.tsx, MapChartRenderer.tsx). The stash pop restored other plan's unstaged changes, not our WIP.
- **Fix:** Re-applied all Task 2 edits without additional stashing. Pre-existing WidgetRenderer.tsx tsc errors confirmed as belonging to plan 96-01 (RecordsTableRenderer migration) — out of scope.
- **Files modified:** Same 3 files re-edited

## Test Results

- `npx tsc --noEmit`: clean (exit 0)
- `npx vitest run`: 130 test files, all passed; 2981 tests passed (exit 0)
- `npx vitest run src/styles/theme-guard.spec.ts`: 132 tests passed
- `npx vitest run src/components/WidgetFilterBadge.spec.tsx`: 6 tests passed
- `npx vitest run src/lib/useFilterScopeSummary.spec.tsx`: 3 tests passed
- `npx vitest run src/components/LayersLegendPanel.spec.tsx`: 34 tests passed
- `npx vitest run src/components/charts/MapChartRenderer.spec.tsx`: 204 tests passed
- No invented CSS class names; no raw hex in component code

## Self-Check: PASSED

- FOUND: packages/web/src/lib/useFilterScopeSummary.spec.tsx
- FOUND: packages/web/src/lib/useFilterScopeSummary.ts (modified)
- FOUND: packages/web/src/lib/resolveLegendLayers.ts (modified)
- FOUND: packages/web/src/components/LayersLegendPanel.tsx (modified)
- FOUND: packages/web/src/components/charts/MapChartRenderer.tsx (modified)
- FOUND: commit 38a0396 (Task 1)
- FOUND: commit be8d433 (Task 2)
