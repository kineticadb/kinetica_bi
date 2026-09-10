---
phase: 30-materialize-and-chips
plan: "01"
subsystem: spatial-filter-foundation
tags: [spatial, materialize, context, types, tdd]
dependency_graph:
  requires: [phase-28-spatial-target-config, phase-27-spatial-filter-store]
  provides: [aggregateSpatialTargetsByTable, DashboardContextValue.widgets, MaterializeFilterArgs.spatialFilters, MaterializeFilterArgs.spatialTarget]
  affects: [phase-30-02-materialize-trigger, phase-30-03-filter-bar-chips]
tech_stack:
  added: []
  patterns: [tdd-red-green, type-only-circular-import, export-type-reexport]
key_files:
  created: []
  modified:
    - kinetica_bi/src/lib/spatialTargets.ts
    - kinetica_bi/src/lib/spatialTargets.spec.ts
    - kinetica_bi/src/components/DashboardContext.tsx
    - kinetica_bi/src/components/DashboardContext.spec.tsx
    - kinetica_bi/src/components/DashboardsPage.tsx
    - kinetica_bi/src/api/client.ts
    - kinetica_bi/src/api/client.spec.ts
    - kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx
    - kinetica_bi/src/components/charts/InfoCardRenderer.spec.tsx
decisions:
  - "Used type-only circular import (import type { SpatialTarget }) in client.ts — TypeScript resolves type-only cycles safely; runtime has no circular dependency"
  - "Added local import type alongside export type reexport — export type { X } from does not bring X into local scope in TS"
  - "WidgetRenderer.spec.tsx and InfoCardRenderer.spec.tsx patched with widgets={[]} in-task — tsc-required fix, not deferred to Plan 30-02"
metrics:
  duration: "5 minutes"
  completed: "2026-05-13T02:23:21Z"
  tasks_completed: 3
  files_modified: 9
requirements: [MAT-V15-02]
---

# Phase 30 Plan 01: materialize-and-chips Foundation Summary

Pure-type and pure-logic foundation layer for Phase 30: one new aggregation helper, one context extension, one payload type extension — all dormant until Plans 30-02 and 30-03 consume them.

## What Shipped

### aggregateSpatialTargetsByTable (lib/spatialTargets.ts)

Exact signature shipped:

```typescript
export function aggregateSpatialTargetsByTable(
  widgets: WidgetDto[],
): Map<number, SpatialTarget>
```

**Sort rule:** widgets filtered to `type === "map"`, sorted by `id` ascending (stable across grid reorders).
**Eligibility:** each map widget's targets filtered through `isSpatialTargetEligible` — WKB and incomplete targets are silently dropped.
**Tiebreaker:** first-write-wins per `tableId` key; because widgets are sorted id-ascending, the widget with the lowest id always wins.
**Import added:** `import type { WidgetDto } from "../api/client"` (type-only) at top of spatialTargets.ts alongside existing `MapWidgetConfig` import.

9 new tests in `spatialTargets.spec.ts` covering: empty array, no map widgets, one eligible target, multiple targets different tableIds, id-ascending tiebreaker, input-order independence, WKB skip, incomplete skip, non-map widget ignore.

### DashboardContextValue.widgets (DashboardContext.tsx)

`DashboardContextValue` extended from `{ dashboardId: number }` to `{ dashboardId: number; widgets: WidgetDto[] }`.

`DashboardContextProvider` now requires `widgets: WidgetDto[]` prop. Provider passes the same array reference into context (no defensive copy).

**DashboardsPage.tsx change:** Line 766 changed from:
```tsx
<DashboardContextProvider dashboardId={dashboard.id}>
```
to:
```tsx
<DashboardContextProvider dashboardId={dashboard.id} widgets={widgets}>
```
The `widgets` state variable (`useState<WidgetDto[]>([])` at line 366) was already present — no new state added.

3 new tests in `DashboardContext.spec.tsx`: widgets array exposed in context value, empty array exposed as [], reference equality preserved (no defensive copy).

**Existing tests repaired:** all 4 existing `DashboardContext.spec.tsx` tests updated with `widgets={[]}` prop.

### MaterializeFilterArgs extension (client.ts)

Two new types added to client.ts:

```typescript
export type SpatialFilter = {
  id: string;
  wkt: string;
};

export type { SpatialTarget } from "../lib/spatialTargets";
```

`MaterializeFilterArgs` extended with two optional fields:

```typescript
spatialFilters?: SpatialFilter[];
spatialTarget?: SpatialTarget;
```

`materializeFilter` function body unchanged — `JSON.stringify(args)` already serializes all present fields and omits undefined ones (backward compat preserved).

3 new tests in `client.spec.ts`: combined payload (both spatial fields present), v1.3 backward-compat (spatial fields absent from body), spatial-only payload (filters: []).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] export type re-export does not bring type into local scope**
- **Found during:** Task 3
- **Issue:** Plan instructed to use `export type { SpatialTarget } from "../lib/spatialTargets"` and said "the import is implicit — TS resolves the re-export." This is incorrect: re-exports do not make the name locally available. tsc errored: `TS2304: Cannot find name 'SpatialTarget'` at the `spatialTarget?: SpatialTarget` field in `MaterializeFilterArgs`.
- **Fix:** Added `import type { SpatialTarget } from "../lib/spatialTargets"` at the top of client.ts alongside the re-export. TypeScript handles type-only circular imports safely (spatialTargets.ts imports WidgetDto from client.ts; client.ts imports SpatialTarget from spatialTargets.ts — runtime has no cycle since both are type-only).
- **Files modified:** kinetica_bi/src/api/client.ts (1 import line added)
- **Commit:** db09337

**2. [Rule 2 - Missing critical functionality] WidgetRenderer.spec.tsx and InfoCardRenderer.spec.tsx missing required widgets prop**
- **Found during:** Task 2 (tsc check)
- **Issue:** After DashboardContextProvider required `widgets` prop, two spec files broke at compile time. Plan noted these would need updating but scoped the fix to Plan 30-02. However tsc must be clean before commit.
- **Fix:** Added `widgets={[]}` to the `wrap` helper in WidgetRenderer.spec.tsx and to the single provider mount in InfoCardRenderer.spec.tsx.
- **Files modified:** kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx, kinetica_bi/src/components/charts/InfoCardRenderer.spec.tsx
- **Commit:** 24f1b29

## Spec Files That Needed widgets={[]} Repair

| File | Change |
|------|--------|
| kinetica_bi/src/components/DashboardContext.spec.tsx | All 4 existing provider mounts updated |
| kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx | `wrap` helper updated |
| kinetica_bi/src/components/charts/InfoCardRenderer.spec.tsx | Single provider mount updated |

**Files that did NOT need repair (Plan 30-02's remaining delta):**
- Any other spec that mounts AggregatedWidgetRenderer descendants without DashboardContextProvider will surface in Plan 30-02 when it modifies AggregatedWidgetRenderer. At this point no additional failures were found in the full suite (696 tests pass).

## tsc Warnings / Errors Surfaced

- `TS2741: Property 'widgets' is missing` — fixed inline (both spec files)
- `TS2304: Cannot find name 'SpatialTarget'` — fixed inline (client.ts import)
- Final `npx tsc --noEmit` exits 0 with no warnings

## Self-Check: PASSED

Files exist:
- kinetica_bi/src/lib/spatialTargets.ts — FOUND
- kinetica_bi/src/lib/spatialTargets.spec.ts — FOUND
- kinetica_bi/src/components/DashboardContext.tsx — FOUND
- kinetica_bi/src/api/client.ts — FOUND

Commits exist:
- a3b2a82: feat(30-01): add aggregateSpatialTargetsByTable helper
- 24f1b29: feat(30-01): extend DashboardContext with widgets field
- db09337: feat(30-01): extend MaterializeFilterArgs with spatialFilters + spatialTarget
