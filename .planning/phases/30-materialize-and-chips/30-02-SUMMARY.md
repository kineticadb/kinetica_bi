---
phase: 30-materialize-and-chips
plan: "02"
subsystem: spatial-materialize-trigger
tags: [spatial, materialize, widget-renderer, tdd, zustand]
dependency_graph:
  requires: [30-01-foundation, phase-27-spatial-filter-store, phase-28-spatial-target-config]
  provides: [AggregatedWidgetRenderer-spatialFilterVersion-dep, combined-materialize-payload, orphan-shape-fallthrough, DROP-guard-extension]
  affects: [phase-30-03-filter-bar-chips]
tech_stack:
  added: []
  patterns: [useMemo-dep-memo, primitive-dep-selector, imperative-getState-inside-setTimeout, type-import-inline]
key_files:
  created: []
  modified:
    - kinetica_bi/src/components/charts/WidgetRenderer.tsx
    - kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx
decisions:
  - "myTarget is NOT in Effect 1 dep array — it changes only when widgets changes, which triggers a render that re-creates the effect anyway; double-dep would be redundant and confusing"
  - "shapes read imperatively via useSpatialFilterStore.getState().shapes inside setTimeout — avoids re-render on every store mutation; spatialFilterVersion is the dep that drives re-fire"
  - "MapChartRenderer.spec.tsx requires no repair — it mocks all stores directly and never mounts DashboardContextProvider; zero changes needed"
metrics:
  duration: "7 minutes"
  completed: "2026-05-13T02:30:00Z"
  tasks_completed: 2
  files_modified: 2
requirements: [MAT-V15-01, MAT-V15-03]
---

# Phase 30 Plan 02: materialize-trigger Summary

AggregatedWidgetRenderer wired with spatialFilterVersion as the 5th Effect 1 dep, targetsByTable memo, extended DROP guard, and combined-or-column-only materialize payload. Drawing a shape on any map now triggers a server materialize with `{spatialFilters, spatialTarget}` appended to the existing column-filter payload.

## What Shipped

### AggregatedWidgetRenderer (WidgetRenderer.tsx)

**Effect 1 dep array (verbatim, line 376):**
```typescript
}, [sql, filterVersion, dashboardId, tableId, spatialFilterVersion]);
```
Exactly 5 deps in order: sql, filterVersion, dashboardId, tableId, spatialFilterVersion.

**New imports added:**
- `useMemo` added to the React import (line 1)
- `import { useSpatialFilterStore } from "../../store/spatialFilterStore"` (line 32)
- `import { aggregateSpatialTargetsByTable } from "../../lib/spatialTargets"` (line 33)

**Context destructure extended (line 279):**
```typescript
const { dashboardId, widgets } = useDashboardContext();
```

**targetsByTable memo + myTarget (lines 285-293):**
```typescript
const targetsByTable = useMemo(
  () => aggregateSpatialTargetsByTable(widgets),
  [widgets],
);
const myTarget = tableId !== undefined
  ? targetsByTable.get(tableId)
  : undefined;
```

**spatialFilterVersion primitive selector (line 298):**
```typescript
const spatialFilterVersion = useSpatialFilterStore((s) => s.spatialFilterVersion);
```

**Payload-construction ternary (load-bearing — exact code for audit):**
```typescript
const args: import("../../api/client").MaterializeFilterArgs = hasShapesForThisTable
  ? {
      dashboardId,
      tableId,
      filters: tableFilters,
      spatialFilters: shapes.map((s) => ({ id: s.id, wkt: s.wkt })),
      spatialTarget: myTarget,
    }
  : { dashboardId, tableId, filters: tableFilters };
```

`hasShapesForThisTable = myTarget !== undefined && shapes.length > 0`. When false (orphan-shape case), both `spatialFilters` and `spatialTarget` are omitted entirely — server receives v1.3-compatible column-only payload.

**DROP guard extension:**
```typescript
if (tableFilters.length === 0 && !hasShapesForThisTable) {
  dropFilterView({ dashboardId, tableId }).catch(() => {});
  useFilterViewStore.getState().clearView(tableId);
  return;
}
```
Covers: empty column filters + no eligible target for this table OR empty shapes — drop fires. If shapes exist but no eligible target, that's the orphan-shape DROP case (test 5 below).

**MapChartRenderer.tsx — zero changes:**
`grep -n "materializeFilter\|dropFilterView" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns 0 matches. Sole-materialize-trigger invariant preserved.

### WidgetRenderer.spec.tsx

**wrap helper updated to accept optional widgets param (default=[]):**
```typescript
const wrap = (
  ui: React.ReactNode,
  dashboardId = 1,
  widgets: import("../../api/client").WidgetDto[] = []
) => (
  <DashboardContextProvider dashboardId={dashboardId} widgets={widgets}>{ui}</DashboardContextProvider>
);
```
All 34 existing tests continue passing with `widgets=[]` default — no modification to existing test bodies required.

**useSpatialFilterStore** imported at top alongside existing store imports.

**5 new tests in `describe("Phase 30 — spatial materialize trigger (MAT-V15-01/02/03)", ...)`:**

1. **ORPHAN** — shapes exist but no map widget targets this tableId → column-only payload sent; `spatialFilters` and `spatialTarget` keys absent from call args
2. **COMBINED** — eligible target exists and shapes drawn → spatialFilters has length 1, spatialFilters[0].wkt matches shape, spatialTarget matches the target config
3. **spatialFilterVersion dep** — addShape after initial render triggers a second materializeFilter call; AND `useFilterViewStore.getState().views[tableId].materializeVersion` advances after second materialize resolves (proves _mv cache-buster fires for spatial triggers via filterViewStore.ts:67 — Blocker 3 lock)
4. **DROP** — empty column filters + empty shapes → dropFilterView called; materializeFilter NOT called
5. **ORPHAN-DROP** — empty column filters + shapes drawn + no eligible target → dropFilterView called (orphan fallthrough); materializeFilter NOT called

**MapChartRenderer.spec.tsx — zero changes needed:**
All 125 existing tests pass without modification. The spec mocks stores directly via `vi.mock` factory overrides and never mounts `<DashboardContextProvider>`. No provider prop repair required.

**Test counts:**
- WidgetRenderer.spec.tsx: 34 (existing) + 5 (new Phase 30) = **39 tests**
- MapChartRenderer.spec.tsx: **125 tests** (unchanged)
- Full suite: **701 tests** (all green)

### _mv cache-buster confirmation

`materializeVersion` increment is at `kinetica_bi/src/store/filterViewStore.ts:67` inside `setView`. This fires on every successful `setView` call regardless of trigger source — column-only or spatial. Phase 30 spatial materialize calls route through the same `setView` path. The "spatialFilterVersion dep" test (test 3 above) explicitly asserts:
```
expect(useFilterViewStore.getState().views[tableId].materializeVersion).toBeGreaterThan(initialMv);
```
No new _mv wiring needed in this plan.

### WKB gate confirmation

WKB targets cannot reach the wire because `aggregateSpatialTargetsByTable` filters via `isSpatialTargetEligible` — which returns `false` for `spatialMode === "wkb"` by construction. `myTarget` is GUARANTEED eligible or undefined. Plan 30-01 Task 1's "skips WKB-mode targets" spec in `spatialTargets.spec.ts` provides the backing verification at the source.

## Deviations from Plan

None — plan executed exactly as written.

The one noted callout: MapChartRenderer.spec.tsx did NOT need repair (plan's action 2 anticipated it might). The spec mocks all Zustand stores via module-level factory overrides and never mounts `DashboardContextProvider` directly. Plan's instruction covered this correctly ("If the spec defines a wrap helper, update its signature" — it does not).

## Self-Check: PASSED

Files exist:
- kinetica_bi/src/components/charts/WidgetRenderer.tsx — FOUND
- kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx — FOUND

Commits exist:
- 73b0e04: feat(30-02): extend AggregatedWidgetRenderer with spatialFilterVersion dep and combined payload
- 3508d2e: test(30-02): add Phase 30 spatial materialize scenarios + update wrap helper
