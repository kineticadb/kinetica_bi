---
phase: 30-materialize-and-chips
plan: "03"
subsystem: filterbar-chips
tags: [spatial, chips, filterbar, zustand, react, tdd]
dependency_graph:
  requires: [phase-30-01-foundation, phase-27-spatial-filter-store, phase-28-spatial-target-config]
  provides: [spatial-chip-rendering, per-table-clear-all-global-nuke]
  affects: [phase-30-02-materialize-trigger]
tech_stack:
  added: []
  patterns: [zustand-imperative-getState, useMemo-dep-stability, filter-bar-chip-reuse]
key_files:
  created: []
  modified:
    - kinetica_bi/src/components/DashboardsPage.tsx
    - kinetica_bi/src/components/DashboardsPage.spec.tsx
decisions:
  - "ResizeObserver + OL module mocks added to DashboardsPage.spec.tsx to enable full dashboard rendering in JSDOM without MapChartRenderer crashing"
  - "Used exact name 'Clear all' (not /clear all/i) in findByRole to distinguish filter-bar-clear from MapDrawToolbar's 'Clear all shapes' — substring match collides with toolbar button"
  - "Removed listAssociatedTables from api/client import (it is not exported from client.ts — vi.mock factory stubs it without needing the real export)"
metrics:
  duration: "6 minutes"
  completed: "2026-05-13T02:38:30Z"
  tasks_completed: 2
  files_modified: 2
requirements: [CHIP-V15-01, CHIP-V15-02]
---

# Phase 30 Plan 03: filterbar-chips Summary

Spatial chip rendering in FilterBar with per-table Clear all global nuke — closes the user-facing surface of Phase 30.

## What Shipped

### Task 1: DashboardsPage.tsx FilterBar JSX extension

**New import added** (line 46):
```typescript
import { aggregateSpatialTargetsByTable } from "../lib/spatialTargets";
```

**useMemo added** to React imports (line 1).

**Selectors + memos added** after existing `allStoreFilters` line:
```typescript
const shapes = useSpatialFilterStore((s) => s.shapes);
const targetsByTable = useMemo(
  () => aggregateSpatialTargetsByTable(widgets),
  [widgets],
);
const tableIdsWithSpatialChips = useMemo(() => {
  if (shapes.length === 0) return new Set<number>();
  return new Set<number>(Array.from(targetsByTable.keys()));
}, [shapes, targetsByTable]);
```

**FilterBar IIFE — 3 surgical changes:**

1. Extended early-return guard:
```typescript
const hasAnySpatialChips = tableIdsWithSpatialChips.size > 0;
if (!hasAnyStaticClause && !hasAnyStoreFilters && !hasAnySpatialChips) return null;
```

2. Extended `tableIdsWithFilters` set to include spatial chip tableIds:
```typescript
for (const tid of tableIdsWithSpatialChips) {
  tableIdsWithFilters.add(tid);
}
```

3. Extended per-row body with `hasSpatialForThisTable` flag, unified chip container, and extended Clear all:

**Exact chip JSX (spatial section):**
```tsx
{hasSpatialForThisTable && shapes.map((shape) => (
  <span key={`spatial-${shape.id}`} className="filter-bar-chip">
    {`${shape.label} (${shape.measurement})`}
    <button
      type="button"
      className="filter-bar-chip-dismiss"
      aria-label={`Remove spatial filter ${shape.label}`}
      onClick={() => useSpatialFilterStore.getState().removeShape(shape.id)}
    >
      ×
    </button>
  </span>
))}
```

**Exact per-table Clear all handler (extended):**
```typescript
onClick={() => {
  // Column branch (existing behavior)
  if (hasStoreFilters) {
    useFilterStore.getState().clearFilters(tableId);
  }
  // Spatial branch: global nuke — removeShape loop (preserves shapeCounter unlike clearAll())
  if (hasSpatialForThisTable) {
    const idsToRemove = shapes.map((s) => s.id);
    for (const id of idsToRemove) {
      useSpatialFilterStore.getState().removeShape(id);
    }
  }
}}
```

**Aria-label format used:** `Remove spatial filter ${shape.label}` — e.g. "Remove spatial filter Bbox 1". Matches existing column-chip pattern (`Remove filter ${f.column}`) with "spatial filter" qualifier.

**CSS classes reused WITHOUT modification** (CONTEXT.md lock):
- `.filter-bar-chip` — spatial chips use same class as column chips
- `.filter-bar-chip-dismiss` — × button uses same class
- `.filter-bar-clear` — Clear all button unchanged
No new CSS shipped.

### Task 2: DashboardsPage.spec.tsx Phase 30 coverage

**Spec count before:** 5 tests
**Spec count after:** 11 tests (6 new in Phase 30 describe block)

**New describe block:** `"Phase 30 — spatial chips in FilterBar (CHIP-V15-01/02)"`

**6 new tests:**
1. Chip renders with format `Bbox 1 (5km × 3km)` — chip text, `.filter-bar-chip` closest, aria-label present
2. Orphan shape (no eligible target) produces no chip — shape persists in store, DOM has no chip
3. Chip × click removes shape from store (`shapes.length` 1 → 0, chip disappears from DOM)
4. Per-table Clear all removes ALL 3 shapes (global nuke)
5. Per-table Clear all clears BOTH column filters AND shapes simultaneously
6. FilterBar row appears for tableId with ONLY spatial chips (no column filters, no static clause)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `listAssociatedTables` does not exist in `../api/client` exports**
- **Found during:** Task 2 (tsc check after initial import)
- **Issue:** Plan's `<action>` instructed importing `listAssociatedTables` from `"../api/client"` alongside other list functions. The actual `client.ts` exports only `listDashboardTables` — `listAssociatedTables` is stubs-only inside the `vi.mock` factory (it calls a non-exported function that the existing mock intercepted). `tsc --noEmit` failed with `TS2305: Module '"../api/client"' has no exported member 'listAssociatedTables'`.
- **Fix:** Removed `listAssociatedTables` from the named import. Also removed `(listAssociatedTables as ReturnType<typeof vi.fn>).mockResolvedValue([associatedTable])` from `beforeEach` — the mock factory in `vi.mock("../api/client", ...)` already stubs it at the file level.
- **Files modified:** kinetica_bi/src/components/DashboardsPage.spec.tsx
- **Commit:** a765607

**2. [Rule 3 - Blocking] Missing `ResizeObserver` + OL module mocks in test environment**
- **Found during:** Task 2 (test run after clicking "Open" to enter dashboard)
- **Issue:** When the `DashboardOpen` component renders with a `map` widget, `MapChartRenderer` attempts to construct an OL `Map` object which calls `new ResizeObserver()` internally. JSDOM does not provide `ResizeObserver`. Additionally, `vectorLayerRef.current.changed()` fails because the `ol/layer/Vector` mock lacked a `changed()` method, and `basemapLayerRef.current.setSource()` fails because `ol/layer/Tile` mock lacked `setSource()`.
- **Fix:** Added `vi.stubGlobal("ResizeObserver", ...)` and comprehensive `vi.mock()` blocks for all OL modules used by `MapChartRenderer` (ol/Map, ol/layer/Tile, ol/source/OSM, ol/source/XYZ, ol/layer/Image, ol/source/ImageWMS, ol/Overlay, ol/proj, ol/layer/Vector, ol/source/Vector, ol/interaction/Draw, ol/geom/Point, ol/Feature, ol/format/WKT, ol/sphere). Each mock provides the methods called during MapChartRenderer's useEffect lifecycle.
- **Files modified:** kinetica_bi/src/components/DashboardsPage.spec.tsx
- **Commit:** a765607

**3. [Rule 1 - Bug] `findByRole("button", { name: /clear all/i })` ambiguous — matches both filter-bar-clear and MapDrawToolbar "Clear all shapes"**
- **Found during:** Task 2 (test run — tests 4 and 5 failing with "Found multiple elements")
- **Issue:** The regex `/clear all/i` is a substring match that matches both the filter-bar `Clear all` button AND the MapDrawToolbar's `aria-label="Clear all shapes"` button. Both are rendered in the DOM simultaneously.
- **Fix:** Changed to exact accessible name `"Clear all"` — JSDOM accessible name computation uses inner text for the filter-bar button ("Clear all") and the aria-label for the toolbar button ("Clear all shapes"). These are distinct exact strings.
- **Files modified:** kinetica_bi/src/components/DashboardsPage.spec.tsx
- **Commit:** a765607

**4. [Rule 3 - Blocking] `screen.findByText(dashboard.name)` click does not navigate into dashboard**
- **Found during:** Task 2 (first test run — `waitFor(() => expect(listWidgets).toHaveBeenCalled())` timeout)
- **Issue:** Plan's `openDashboard` helper clicked the dashboard name text. The actual DOM renders the dashboard name as a `<span class="ds-name">` (not a link/button), and navigation requires clicking the `<button class="btn-primary btn-sm">Open</button>` (DashboardsPage.tsx line 182).
- **Fix:** Changed `openDashboard` to use `screen.findByRole("button", { name: /^open$/i })` after confirming the dashboard name is visible, then click that button.
- **Files modified:** kinetica_bi/src/components/DashboardsPage.spec.tsx
- **Commit:** a765607

## Closed Loop Confirmation

The chip → materialize closed loop composes correctly across plans:
1. User draws a shape → `useSpatialFilterStore.addShape()` → `spatialFilterVersion` increments
2. Plan 30-02's `AggregatedWidgetRenderer` Effect 1 fires (5th dep: `spatialFilterVersion`) → `materializeFilter` called with `spatialFilters + spatialTarget`
3. Plan 30-03's `FilterBar` JSX re-renders (subscribes to `shapes` array) → chip appears
4. User clicks chip × → `useSpatialFilterStore.getState().removeShape(shape.id)` → `spatialFilterVersion` increments
5. Effect 1 re-fires → `materializeFilter` called without spatial args → view updates
6. FilterBar re-renders → chip disappears

Both 30-02 and 30-03 subscribe to their respective primitives (`spatialFilterVersion` for trigger, `shapes` for display) and compose cleanly without coupling.

## Self-Check: PASSED

Files exist:
- kinetica_bi/src/components/DashboardsPage.tsx — FOUND
- kinetica_bi/src/components/DashboardsPage.spec.tsx — FOUND

Commits exist:
- 947288d: feat(30-03): extend FilterBar JSX with spatial chips and per-table Clear all
- a765607: test(30-03): add Phase 30 spatial chip coverage to DashboardsPage.spec.tsx
