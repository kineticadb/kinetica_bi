---
phase: 29-draw-and-shape
plan: "03"
subsystem: frontend-map
tags: [react, openlayers, zustand, typescript, vitest, tdd, shape-rendering, vector-layer]

# Dependency graph
requires:
  - phase: 29-01
    provides: drawMode useState + drawModeRef + previousModeRef + mode-guard in Effect 6
  - phase: 29-02
    provides: MapDrawToolbar component + .map-draw-toolbar CSS classes
  - phase: 27-spatial-filter-store
    provides: useSpatialFilterStore (shapes, addShape, removeShape, clearAll, reset)
provides:
  - VectorLayer/VectorSource setup in Effect 1 with zIndex=10000
  - Effect 7 (lines 1107-1174): atomic store→OL shape sync with per-shape measurement overlays
  - shapesKey primitive selector (PITFALL S-02 lock)
  - shapeOverlaysRef lifecycle (add on shape commit, remove on shape remove, clear on unmount)
  - MapDrawToolbar JSX mount in MapChartRenderer with working prop wiring
  - .shape-measurement-pill CSS class in global.css
affects:
  - 29-04-draw-interaction-and-pipeline (Effect 8 inserts after Effect 7; drawend commits via addShape)
  - 29-05-selection-and-delete (Plan 05 adds selectedShapeIdRef for Style fn branch in Effect 1)

# Tech tracking
tech-stack:
  added:
    - "ol/layer/Vector — VectorLayer for committed shape rendering"
    - "ol/source/Vector — VectorSource backing the VectorLayer"
    - "ol/style (Style, Fill, Stroke) — per-type SHAPE_COLORS palette"
    - "ol/Feature — OL Feature wrapping each committed WKT shape"
    - "ol/format/WKT — parses EPSG:4326 WKT → EPSG:3857 OL geometry"
    - "ol/geom/Polygon (type-only) — for geom.getInteriorPoint() typing"
  patterns:
    - "shapesKey primitive selector: useSpatialFilterStore((s) => s.shapes.map(sh => sh.id).join('|')) — PITFALL S-02 compliance"
    - "Atomic clear+re-add: source.clear(true) before addFeature loop — avoids duplicate features on Plan 04 drawend"
    - "shapeOverlaysRef: Map<string, Overlay> keyed by shape.id — lifecycle: add in Effect 7, remove in Effect 7 (stale ids) AND Effect 1 cleanup"
    - "VectorLayer zIndex=10000 — above LAYER_Z_BASE=1000 WMS image layers (Pitfall 6 lock)"
    - "Style function: reads feature.get('shapeType') for per-type color from SHAPE_COLORS palette"

key-files:
  created: []
  modified:
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx
    - kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx
    - kinetica_bi/src/styles/global.css

key-decisions:
  - "[29-03 VectorLayer]: Tests V1-V18 landed in the existing MapChartRenderer.spec.tsx (not a new sibling spec file) — lower friction; the existing mock infrastructure (ol/Map, ol/Overlay, etc.) was extended with VectorLayer, VectorSource, WKT, Feature, Style, Fill, Stroke mocks"
  - "[29-03 VectorLayer]: useSpatialFilterStore NOT mocked in spec — uses real Zustand store (backed by __mocks__/zustand.ts reset shim) so shapesKey selector triggers real React re-renders and Effect 7 fires correctly on store mutation"
  - "[29-03 deviation Rule 1]: Tests B/C/D addLayer call counts updated (+1 for VectorLayer). Effect 1 now calls map.addLayer(vectorLayer) in addition to WMS layers, so existing assertions were off-by-one"
  - "[29-03 deviation Rule 1]: ol/Overlay mock extended with getElement() method — Effect 7's measurement text sync calls overlay.getElement() when updating existing overlays; mock lacked this method causing V7 failure"
  - "[29-03 VectorLayer]: MapDrawToolbar mocked in MapChartRenderer.spec.tsx as a minimal accessible div — renders role=toolbar + shapesCount-gated Clear button + onModeChange-wired bbox button for V15-V18 assertions"

# Metrics
duration: "~30min"
completed: 2026-05-12
tasks: 1
files: 3
requirements: [SHAPE-V15-01, SHAPE-V15-02, SHAPE-V15-03]
---

# Phase 29 Plan 03: VectorLayer + Effect 7 Shape Sync + MapDrawToolbar JSX Mount — Summary

**One-liner:** VectorLayer/VectorSource at zIndex=10000 in Effect 1; Effect 7 atomically reconciles useSpatialFilterStore.shapes → OL features with per-shape measurement-pill overlays; MapDrawToolbar wired into MapChartRenderer JSX with full prop chain.

## Performance

- **Duration:** ~30 min
- **Started:** 2026-05-12
- **Completed:** 2026-05-12
- **Tasks:** 1 (TDD: 2 commits — test-red, feat-green)
- **Files modified:** 3

## Accomplishments

- Added `VectorLayer` + `VectorSource` in Effect 1 with `zIndex: 10000` (Pitfall 6 lock — above all WMS image layers at max ~1000)
- Added `SHAPE_COLORS` constant at module scope with locked palette: bbox=blue (#2563eb), lasso=green (#16a34a), circle=orange (#ea580c)
- Added 3 new refs: `vectorLayerRef`, `vectorSourceRef`, `shapeOverlaysRef` with documented lifecycle
- Added `shapesKey` + `shapesCount` Zustand primitive selectors (PITFALL S-02 compliance)
- Implemented **Effect 7** (lines 1107–1174): atomic `source.clear(true)` → `addFeature` loop; per-shape `ol/Overlay` with `.shape-measurement-pill` element anchored at `geom.getInteriorPoint()`; overlay removed when shape removed; all overlays cleared in Effect 1 cleanup
- Extended Effect 1 cleanup: removes all `shapeOverlaysRef` overlays before `map.dispose()`; nulls `vectorLayerRef` and `vectorSourceRef`
- Mounted `<MapDrawToolbar>` in JSX as sibling to `.widget-map-canvas` with all 4 props: `drawMode`, `onModeChange={setDrawMode}`, `shapesCount={shapesCount}`, `onClearAll={() => useSpatialFilterStore.getState().clearAll()}`
- Added `.shape-measurement-pill` CSS class to `global.css` (shared by Plan 04 live tooltip)
- 18 new V1–V18 vitest tests all green; 629/629 full suite green; `tsc --noEmit` clean

## Task Commits

1. **Task 1 (TDD RED — tests)**: `test(29-03): add failing V1-V18 tests for VectorLayer + shape sync + toolbar`
2. **Task 1 (TDD GREEN — implementation)**: `feat(29-03): VectorLayer + Effect 7 shape sync + MapDrawToolbar JSX mount (SHAPE-V15-01..03)` — `f5057eb`

## Effect 7 Location (for Plan 04 + Plan 05)

```
kinetica_bi/src/components/charts/MapChartRenderer.tsx
  lines 1107–1174: Effect 7 (shape sync + persistent measurement overlays)
  deps: [shapesKey]
```

Plan 04 (Effect 8 — Draw interaction) should be inserted AFTER Effect 7 at line ~1175, before the JSX block.
Plan 05 (selection click) will add `selectedShapeIdRef` used in the VectorLayer style function (already prepared with comment at Effect 1).

## New Refs in MapChartRenderer

| Ref | Type | Set in | Cleared in |
|-----|------|--------|-----------|
| `vectorLayerRef` | `VectorLayer<VectorSource> \| null` | Effect 1 mount | Effect 1 cleanup |
| `vectorSourceRef` | `VectorSource \| null` | Effect 1 mount | Effect 1 cleanup |
| `shapeOverlaysRef` | `Map<string, Overlay>` | Effect 7 (addOverlay) | Effect 7 (stale ids) + Effect 1 cleanup |

## Cross-Map Rendering

Verified via V14 test: two MapChartRenderer instances rendered simultaneously both receive new features after `useSpatialFilterStore.getState().addShape(...)`. The shared Zustand store causes both instances' `shapesKey` selectors to update → both Effect 7s re-fire → both VectorSources receive the feature.

## Test Decision: MapChartRenderer.spec.tsx vs New Sibling Spec

Tests landed in the **existing `MapChartRenderer.spec.tsx`** (plan authorized either approach). The existing mock infrastructure was extended:
- New OL mocks added: `ol/layer/Vector`, `ol/source/Vector`, `ol/style`, `ol/Feature`, `ol/format/WKT`
- `ol/Overlay` mock extended with `getElement()` method
- `MapDrawToolbar` mocked as accessible toolbar div for V15-V18 assertions
- `useSpatialFilterStore` uses the REAL Zustand store (not mocked) to get proper React re-render subscription

## Files Created/Modified

- `kinetica_bi/src/components/charts/MapChartRenderer.tsx` — +80 lines net:
  - Lines 40–45: New OL imports (VectorLayer, VectorSource, Style/Fill/Stroke, Feature, WKT, Polygon type)
  - Lines 70–71: useSpatialFilterStore + MapDrawToolbar imports
  - Lines 104–112: `SHAPE_COLORS` constant (module scope)
  - Lines 478–484: New refs (vectorLayerRef, vectorSourceRef, shapeOverlaysRef)
  - Lines 405–410: shapesKey + shapesCount selectors
  - Lines 583–605: VectorLayer/VectorSource setup in Effect 1 (after mapRef.current = map)
  - Lines 631–643: Effect 1 cleanup extension (overlay disposal + ref nulling)
  - Lines 1107–1174: Effect 7 (shape sync + measurement overlays)
  - Lines 1190–1201: MapDrawToolbar JSX mount
- `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` — +550 lines:
  - New OL mocks: VectorLayer, VectorSource, Style/Fill/Stroke, Feature, WKT
  - Extended ol/Overlay mock: added getElement()
  - MapDrawToolbar mock
  - 18 V1-V18 tests in new describe block
  - Auto-fix: Tests B/C/D addLayer counts updated
- `kinetica_bi/src/styles/global.css` — +18 lines:
  - `.shape-measurement-pill` CSS class

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Tests B/C/D addLayer call count off-by-one**
- **Found during:** TDD GREEN phase (running existing tests after adding VectorLayer)
- **Issue:** Tests B (2 WMS layers → expect 2 addLayer calls), C (1 WMS layer → expect 1), D (2 → expect 2) were correct before Plan 03, but now Effect 1 also calls `map.addLayer(vectorLayer)`, adding one extra call
- **Fix:** Updated expected counts: B: 2→3, C: 1→2, D: 2→3
- **Files modified:** `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx`
- **Commit:** f5057eb

**2. [Rule 1 - Bug] ol/Overlay mock missing getElement() method**
- **Found during:** TDD GREEN phase (V7 test failure)
- **Issue:** Effect 7 calls `overlay.getElement()` to sync measurement text on existing overlays (second addShape with same id). The Phase 21 ol/Overlay mock had no `getElement` method, causing `TypeError: overlay.getElement is not a function` in V7
- **Fix:** Added `this.getElement = vi.fn(() => opts?.element ?? null)` to the MockOverlay constructor
- **Files modified:** `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx`
- **Commit:** f5057eb

**3. [Rule 1 - Architecture] useSpatialFilterStore not mocked in spec — real store used**
- **Found during:** TDD GREEN phase (V4–V9, V14, V16, V17 all failing despite correct implementation)
- **Issue:** Initial approach mocked `useSpatialFilterStore` with a static snapshot reader. When `_spatialFilterState.addShape()` fired, React had no subscription mechanism to re-render the component, so `shapesKey` never changed and Effect 7 never re-fired
- **Fix:** Removed mock of `../../store/spatialFilterStore`. Used the real Zustand store (with `__mocks__/zustand.ts` reset shim). Tests use `useSpatialFilterStore.getState().addShape/removeShape/clearAll` directly
- **Files modified:** `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx`
- **Commit:** f5057eb

---

**Total deviations:** 3 auto-fixed (Rule 1 — all bugs in test infrastructure exposed by new production code)
**Impact on plan:** Minimal; test mock fixes only. No scope creep. Production code matches plan exactly.

## Self-Check

**Files modified:**
- `kinetica_bi/src/components/charts/MapChartRenderer.tsx` — FOUND (1255 lines)
- `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` — FOUND
- `kinetica_bi/src/styles/global.css` — FOUND (contains `.shape-measurement-pill`)

**Key grep checks:**
- `grep -n 'import VectorLayer from "ol/layer/Vector"'` — line 40: FOUND
- `grep -n 'zIndex: 10000'` — line 587: FOUND
- `grep -n 'source.clear(true)'` — line 1129: FOUND
- `grep -n 'shape-measurement-pill' global.css` — line 1639: FOUND
- `grep -n '<MapDrawToolbar'` — line 1195: FOUND
- `grep -n 'shapesKey'` — lines 405, 407, 1108, 1174: FOUND

**Commit:** f5057eb — FOUND

**Test results:** 18/18 V-tests passing; 629/629 full suite green; tsc clean

## Self-Check: PASSED
