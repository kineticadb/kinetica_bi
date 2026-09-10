---
phase: 29-draw-and-shape
plan: "04"
subsystem: frontend-map
tags: [react, openlayers, zustand, typescript, vitest, tdd, draw-interaction, wkt, sphere]

# Dependency graph
requires:
  - phase: 29-01
    provides: DrawMode union + formatDistance + formatArea + drawMode useState + previousModeRef
  - phase: 29-02
    provides: MapDrawToolbar component (mocked in spec for prop wiring)
  - phase: 29-03
    provides: vectorSourceRef + drawRef availability + Effect 7 + shapeOverlaysRef
  - phase: 27-spatial-filter-store
    provides: useSpatialFilterStore.addShape (type, wkt, measurement) → committed shape
provides:
  - buildDrawInteraction factory (bbox/lasso/circle OL Draw configs) in lib/shapeDraw.ts
  - computeMeasurement (bbox W×H, circle radius, lasso area via ol/sphere WGS84) in lib/shapeDraw.ts
  - isDegenerateExtent (width-OR-height < 10×resolution threshold) in lib/shapeDraw.ts
  - Effect 8 (lines 1192–1335 in MapChartRenderer.tsx): Draw interaction mount + drawstart live tooltip + drawend pipeline + ESC abort
  - drawRef useRef<Draw|null> in MapChartRenderer
affects:
  - 29-05-selection-and-delete (Effect 8 is the committed-shape producer; Plan 05 adds selection click)

# Tech tracking
tech-stack:
  added:
    - "ol/interaction/Draw (createBox, createRegularPolygon) — bbox/circle/lasso factory"
    - "ol/Observable.unByKey — listener cleanup for geometry change key"
    - "ol/sphere.getDistance + getArea — WGS84 ellipsoidal measurements (V15-P-04 lock)"
  patterns:
    - "OL Draw factory pattern: separate pure helper buildDrawInteraction returns null for pan/info, Draw instance for draw modes — testable without React"
    - "Live tooltip lifecycle: geomChangeKey + unByKey cleanup inside Effect 8 drawstart; cleanupLiveTooltip() called in both drawend and cleanup return"
    - "drawend pipeline: validate → simplify (lasso only) → measure → WKT(EPSG:4326) → removeFeature(Pitfall 1) → addShape → restoreMode"
    - "ESC keydown: window-level listener registered + removed in Effect 8 cleanup (Pitfall 8); drawRef.current guard prevents double-abort"
    - "Test seam for Draw events: drawEventHandlers Map<instance, {drawstart,drawend}> captures handlers from mock; fireDrawEnd/fireDrawStart helpers invoke them"

key-files:
  created: []
  modified:
    - kinetica_bi/src/lib/shapeDraw.ts
    - kinetica_bi/src/lib/shapeDraw.spec.ts
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx
    - kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx

key-decisions:
  - "[29-04 buildDrawInteraction]: bbox uses type:'Circle'+createBox() — yields 4-corner Polygon at drawend; circle uses type:'Circle'+createRegularPolygon(64) — yields 64-vertex Polygon; lasso uses type:'Polygon'+freehand:true. All three produce Polygon geometries (no additional type check needed in drawend)"
  - "[29-04 isDegenerateExtent]: OR threshold (width < 10×res OR height < 10×res) — rejects thin-sliver shapes in addition to near-zero-area shapes. Follows locked recommendation b from 29-RESEARCH.md Open Question 2"
  - "[29-04 computeMeasurement]: bbox corners extracted as ring[0]=BL, ring[1]=BR, ring[3]=TL (BL→BR→TR→TL→BL winding from createBox); ol/sphere.getDistance with WGS84-transformed corners; circle uses getInteriorPoint+ring[0][0] vertex for radius"
  - "[29-04 lasso mid-draw Pitfall 5]: LineString mid-draw shows endpoint distance rather than area; try/catch defensive wrap prevents crash; Polygon branch shows proper computeMeasurement call"
  - "[29-04 toast kind]: 'Shape too small — try again' fires with kind='info' (ToastKind has no 'warning' — Pitfall 4 in 29-RESEARCH.md)"
  - "[29-04 D7 test approach]: WKT mock's writeGeometry is instance method not prototype method; tested via mockImplementationOnce capturing that calls check opts.dataProjection+'EPSG:4326' + featureProjection='EPSG:3857'"
  - "[29-04 test seam]: K3/E3/E5/D5 mode changes dispatch setdrawmode to .widget-map-canvas (not outer container) — bubbles:false to avoid accidental parent propagation; matches existing setDrawModeViaSeam helper pattern in spec"

requirements-completed:
  - DRAW-V15-04
  - DRAW-V15-05
  - DRAW-V15-06

# Metrics
duration: "8min"
completed: 2026-05-12
---

# Phase 29 Plan 04: Draw Interaction and Pipeline Summary

**Effect 8 OL Draw interaction with createBox/createRegularPolygon/freehand + drawend pipeline (validate → lasso-simplify → ol/sphere measure → WKT EPSG:4326 → addShape → auto-restore) + ESC abort; 3 pure helpers (buildDrawInteraction, computeMeasurement, isDegenerateExtent) with 15+15=30 new unit+integration tests**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-12T20:23:25Z
- **Completed:** 2026-05-12T20:31:28Z
- **Tasks:** 2 (TDD: 4 commits total — test-red+feat-green per task)
- **Files modified:** 4

## Accomplishments

- Added three pure helpers to `lib/shapeDraw.ts`: `buildDrawInteraction` (OL Draw factory for bbox/lasso/circle; null for pan/info), `computeMeasurement` (WGS84 ol/sphere measurements for all three modes), `isDegenerateExtent` (OR threshold < 10×resolution)
- Implemented Effect 8 (lines 1192–1335) in MapChartRenderer.tsx: mounts Draw interaction per drawMode, drawstart adds live `.shape-measurement-pill` overlay with geometry change listener, drawend pipeline validates+simplifies(lasso)+measures+serializes+commits+removes+restores, ESC keydown aborts
- Full drawend pipeline invariants landed: lasso `geometry.simplify(resolution*2)` (V15-P-03), WKT with `{dataProjection:'EPSG:4326', featureProjection:'EPSG:3857'}` (V15-P-04), `removeFeature(feature)` before addShape (Pitfall 1), `showToast("Shape too small — try again", "info")` for degenerate (Pitfall 4)
- 30 new tests: 15 shapeDraw pure-helper tests (B1-B5, C1-C5, D1-D5) + 15 Effect 8 integration tests (E1-E6, D1-D7, L1+L3, K1-K3); full suite 661/661 green; tsc clean

## Task Commits

1. **Task 1: shapeDraw helpers** — `976f74b` (feat)
2. **Task 2: Effect 8 in MapChartRenderer** — `b40fd3a` (feat)

## Effect 8 Location

```
kinetica_bi/src/components/charts/MapChartRenderer.tsx
  lines 1192–1335: Effect 8 (Draw interaction mount + live tooltip + drawend pipeline + ESC abort)
  deps: [drawMode]
```

## WKT Example (from test fixture)

The WKT mock returns `"POLYGON(())"` (test fixture). In production, `new WKT().writeGeometry(geom, {dataProjection:'EPSG:4326', featureProjection:'EPSG:3857'})` returns `"POLYGON ((<lon1> <lat1>, ...))"` with coordinates in EPSG:4326 geographic degrees.

## Live Tooltip + Persistent Label Styling

Both the live drawstart tooltip and the persistent Effect 7 labels use `className = "shape-measurement-pill"`. No styling drift — both use the same CSS class defined in `global.css` (Plan 03, line 1639). The live tooltip is attached via `new Overlay({element: el, ...})` with `el.className = "shape-measurement-pill"`, matching the Plan 03 persistent labels exactly.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing] VectorSource mock lacked removeFeature method**
- **Found during:** Task 2 (running new drawend tests — D2 assertion failed with `removeFeature is not a function`)
- **Issue:** The Plan 03 VectorSource mock didn't include `removeFeature` because Effect 7 only calls `clear()` and `addFeature()`. Effect 8's drawend pipeline calls `source.removeFeature(feature)` (Pitfall 1 duplicate-feature guard). The mock lacked this method.
- **Fix:** Added `this.removeFeature = vi.fn(...)` to the MockVectorSource implementation
- **Files modified:** `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx`
- **Committed in:** b40fd3a (Task 2 commit)

**2. [Rule 2 - Missing] ol/Map mock lacked addInteraction/removeInteraction methods**
- **Found during:** Task 2 (E2 test — `map.addInteraction is not a function`)
- **Issue:** Effect 8 calls `map.addInteraction(draw)` and cleanup calls `map.removeInteraction(draw)`, but the existing MockMap only had `addLayer/removeLayer`.
- **Fix:** Added `this.addInteraction = vi.fn()` and `this.removeInteraction = vi.fn()` to MockMap
- **Files modified:** `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx`
- **Committed in:** b40fd3a (Task 2 commit)

**3. [Rule 2 - Missing] ol/Map mock view lacked getResolution method**
- **Found during:** Task 2 (drawend pipeline needs `view.getResolution()` for degenerate check and lasso simplify tolerance)
- **Fix:** Added `getResolution: vi.fn(() => 100)` to the view returned by `this.getView`
- **Files modified:** `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx`
- **Committed in:** b40fd3a (Task 2 commit)

**4. [Plan adaptation] D7 test approach changed from prototype spy to mock instance capture**
- **Found during:** Task 2 (D7 test — `vi.spyOn(WKTMod.default.prototype, "writeGeometry")` failed because `vi.mock("ol/format/WKT")` replaces the module with a factory that defines `writeGeometry` on instances, not the constructor's prototype)
- **Fix:** Changed D7 to use `MockWKTCtor.mockImplementationOnce` to capture WKT instances and assert `writeGeometry.mock.calls` with the expected options object
- **Files modified:** `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx`
- **Committed in:** b40fd3a (Task 2 commit)

**5. [Plan adaptation] Test setdrawmode dispatch target fixed (K3, E3, E5, D5)**
- **Found during:** Task 2 (K3/E3/E5/D5 failing because `container.dispatchEvent` with `bubbles:true` dispatches on the outer wrapper div, but the `setdrawmode` listener is on `.widget-map-canvas` which is a child — events bubble UP, not down)
- **Fix:** Changed to `container.querySelector(".widget-map-canvas").dispatchEvent(...)` with `bubbles: false` — matches the existing `setDrawModeViaSeam` helper pattern in the spec file
- **Files modified:** `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx`
- **Committed in:** b40fd3a (Task 2 commit)

---

**Total deviations:** 5 auto-fixed (Rules 2+plan adaptation — all test infrastructure gaps exposed by new production code)
**Impact on plan:** Minimal. All fixes are test mock extensions required by the new Effect 8 behavior. No production code scope creep.

## Files Created/Modified

- `kinetica_bi/src/lib/shapeDraw.ts` — Added `buildDrawInteraction`, `computeMeasurement`, `isDegenerateExtent` exports with OL imports (Draw, createBox, createRegularPolygon, getDistance, getArea, transform, Polygon type)
- `kinetica_bi/src/lib/shapeDraw.spec.ts` — 15 new tests (B1-B5: buildDrawInteraction, C1-C5: computeMeasurement, D1-D5: isDegenerateExtent)
- `kinetica_bi/src/components/charts/MapChartRenderer.tsx` — Key additions:
  - Lines 49-52: New OL imports (Draw, unByKey, EventsKey type, LineString type, getDistance)
  - Lines 73-79: Extended shapeDraw import (buildDrawInteraction, computeMeasurement, isDegenerateExtent, formatDistance)
  - Lines 498-501: `drawRef` useRef<Draw | null>
  - Lines 1192-1335: Effect 8 (Draw interaction lifecycle keyed on [drawMode])
- `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` — +280 lines:
  - New OL mocks: ol/interaction/Draw (with drawEventHandlers capture), ol/Observable (unByKey), ol/sphere (getDistance/getArea)
  - MockVectorSource extended with removeFeature
  - MockMap extended with addInteraction, removeInteraction; view extended with getResolution
  - 15 Effect 8 tests in new describe block "Phase 29 Effect 8 Draw interaction (DRAW-V15-04..06)"
  - Helper functions: makeMockDrawnFeature, fireDrawEnd, fireDrawStart

## Issues Encountered

None beyond the auto-fixed deviations above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 05 (selection + delete) can read `drawMode` to mode-gate selection clicks; Effect 8 is the sole producer of committed shapes via `addShape`
- The `drawRef` is available for Plan 05 if selection-click needs to be disabled during active drawing
- Full draw+commit pipeline verified: Bbox/Lasso/Circle → drawend → addShape → Effect 7 re-fires via shapesKey → features rendered on all maps
- V15-P-01 mode-guard (Plan 01) + Effect 8 (Plan 04) are now both closed: singleclick popup disabled during draw; Draw interaction mounted/cleaned per mode

---
*Phase: 29-draw-and-shape*
*Completed: 2026-05-12*
