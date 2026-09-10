---
phase: 29-draw-and-shape
plan: "05"
subsystem: frontend-map
tags: [react, openlayers, zustand, typescript, vitest, tdd, selection, delete, shape-interaction]

# Dependency graph
requires:
  - phase: 29-01
    provides: DrawMode union + drawMode useState + drawModeRef + mode-guard in Effect 6
  - phase: 29-03
    provides: vectorLayerRef + vectorSourceRef + SHAPE_COLORS + VectorLayer style fn + shapesKey
  - phase: 29-04
    provides: Effect 8 draw pipeline (committed shapes) + drawRef
  - phase: 27-spatial-filter-store
    provides: useSpatialFilterStore (shapes, addShape, removeShape, clearAll, reset)
provides:
  - selectedShapeId useState + selectedShapeIdRef mirror in MapChartRenderer (component-local, NOT in store)
  - VectorLayer style function updated: 4px stroke + rgba(255,255,255,0.6) inner halo for selected feature
  - selection-click useEffect (Effect 9): mode-gated singleclick listener using forEachFeatureAtPixel
  - Delete/Backspace keydown useEffect (Effect 10): removes selected shape via store, silent no-op on null selection
  - selection-clear-on-mode-switch useEffect (Effect 11): clears selection on transition to info/pan
  - selection-clear-on-shape-removed useEffect (Effect 12): reconciles dangling selectedShapeId via shapesKey dep
  - Phase 29 feature-complete: all 5 ROADMAP success criteria for v1.5 spatial-filter draw-and-shape satisfied
affects:
  - 30-materialize-trigger-and-chips (Phase 30 adds materialize trigger + FilterBar chips on top of this working store + draw UX)
  - 31-uat (Phase 31 UAT verifies end-to-end shape draw + selection + delete + filter application)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "selectedShapeIdRef imperative read pattern: style function reads ref (not state) so VectorLayer style fn doesn't require Effect 1 teardown on every selection change"
    - "vectorLayerRef.current?.changed() triggers style re-evaluation on all features when selection changes — imperative OL-layer invalidation"
    - "forEachFeatureAtPixel with layerFilter constraining to vectorLayerRef.current — hits only shape features, not WMS image layers"
    - "Orthogonal singleclick listeners: Effect 6 (info popup) + Effect 9 (selection click) both registered on map.on('singleclick'); mode-guards keep them orthogonal"
    - "shapesKey dep on selection-clear-on-shape-removed: runs on every store mutation without making selectedShapeId itself a dep (avoids loop)"
    - "Selection halo via Style[]: returning Style array from style function layers strokes — OL renders in order; halo is second style with 1px rgba(255,255,255,0.6)"

key-files:
  created: []
  modified:
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx
    - kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx

key-decisions:
  - "[29-05 Selection]: selectedShapeId is component-local useState in MapChartRenderer, NOT in useSpatialFilterStore — locked by 29-CONTEXT.md. Store stays unmodified (Phase 27 contract preserved)"
  - "[29-05 Halo visual]: Selection halo implemented as a second Style in a Style[] return from the style function (not a fill-lighten approach). Style array stacks — OL renders base style first, then halo on top. Chosen because Style[] is the canonical OL multi-stroke pattern; fill-lighten would change fill semantics (overlap-additive multi-shape fill behavior)"
  - "[29-05 Orthogonal listeners]: SECOND singleclick listener on the map coexists with Effect 6's info listener. Both fire on every click; mode-guards keep them orthogonal (draw modes skip Effect 6 via V15-P-01; info mode skips Effect 9 via deps gate). No event.stopPropagation() needed"
  - "[29-05 TDD deviation Rule 1]: V11-V13 style mock features gained getId: () => undefined — the updated style function calls feature.getId() which was missing from those mocks, causing TypeError at the new isSelected check"

requirements-completed:
  - SHAPE-V15-04

# Metrics
duration: "~15min"
completed: 2026-05-12
tasks: 1
files: 2
---

# Phase 29 Plan 05: Selection + Delete (SHAPE-V15-04) Summary

**Click-to-select shape (4px stroke + white halo) + Delete/Backspace removal, mode-gated to bbox/lasso/circle, with auto-clear on info/pan switch and dangling-id reconciliation on every shapesKey mutation**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-12
- **Completed:** 2026-05-12
- **Tasks:** 1 (TDD: 2 commits — test-red then feat-green in single commit due to tight coupling)
- **Files modified:** 2

## Accomplishments

- Added `selectedShapeId` useState + `selectedShapeIdRef` ref mirror in MapChartRenderer (component-local, NOT in store per 29-CONTEXT.md lock)
- Updated VectorLayer style function (Effect 1, line 601) to branch on `selectedShapeIdRef.current`: selected shape renders with 4px stroke + 1px `rgba(255,255,255,0.6)` inner halo via `Style[]` return; unselected features keep 2px stroke
- Added `selectedShapeIdRef` sync + `vectorLayerRef.current?.changed()` useEffect (line 694): updates ref and forces style re-evaluation across all features on every selection change
- Added selection-click useEffect (line 1360): mode-gated to bbox/lasso/circle; uses `map.forEachFeatureAtPixel` with `layerFilter: (l) => l === vectorLayerRef.current` — hits only VectorLayer features, not WMS; sets selectedShapeId to hit id or null on empty-area click
- Added Delete/Backspace keydown useEffect (line 1395): mode-gated; reads `selectedShapeIdRef.current` imperatively; calls `useSpatialFilterStore.getState().removeShape(id)`; silent no-op when id is null
- Added selection-clear-on-mode-switch useEffect (line 1410): clears selection when transitioning to `info` or `pan` mode; switching between draw modes (bbox↔lasso↔circle) preserves selection
- Added selection-clear-on-shape-removed useEffect (line 1420): deps on `shapesKey`; reconciles dangling selectedShapeId to null when shape is removed externally (clearAll, future Phase 30 chip×, or any other removal path)
- Added `data-testid="selected-shape-id"` test seam span to JSX (line 1449) for spec assertions without importing state
- 20 new tests (S1-S5, V1-V3, C1-C4, D1-D5, X1-X2, E1) all green; 681/681 full suite green; tsc clean

## Phase 29 Complete Effects Index (Plans 01-05)

| Effect | Location | Deps | Purpose |
|--------|----------|------|---------|
| Effect 1 | ~line 570 | `[]` | OL Map init, VectorLayer setup, ResizeObserver |
| Effect 2 | ~line 720 | `[allLayers, ...]` | Layer-stack reconciliation (add/remove/opacity) |
| Effect 3 | ~line 800 | `[viewsKey, ...]` | WMS params update on filter/view change |
| Effect 4 | ~line 900 | `[widgetConfig.basemap]` | Basemap swap |
| Effect 5 | (removed in P12-02) | — | — |
| Effect 6 | ~line 1010 | `[getInfoEnabled(...), eligibleLayers, ...]` | Info popup singleclick fan-out |
| Effect 7 | ~line 1127 | `[shapesKey]` | Store → OL feature sync + measurement overlays |
| Effect 8 | ~line 1196 | `[drawMode]` | Draw interaction lifecycle + ESC abort |
| selectedShapeIdRef sync | ~line 694 | `[selectedShapeId]` | Ref mirror + vectorLayer.changed() |
| drawModeRef sync | ~line 675 | `[drawMode]` | drawModeRef mirror |
| previousModeRef tracker | ~line 695 | `[drawMode]` | previousMode for drawend/ESC auto-restore |
| cursor mgmt | ~line 702 | `[drawMode]` | Viewport cursor per mode |
| test seam | ~line 680 | `[]` | setdrawmode custom event |
| Effect 9 (Plan 05) | ~line 1360 | `[drawMode]` | Selection-click singleclick listener |
| Effect 10 (Plan 05) | ~line 1395 | `[drawMode]` | Delete/Backspace keydown |
| Effect 11 (Plan 05) | ~line 1410 | `[drawMode]` | Selection-clear on mode switch to info/pan |
| Effect 12 (Plan 05) | ~line 1420 | `[shapesKey]` | Dangling-id reconciliation |

## ROADMAP Success Criteria — All 5 Met (Phase 29 Feature-Complete)

| SC | Requirement | Plans | Status |
|----|-------------|-------|--------|
| SC1 | mode-guard FIRST: Effect 6 short-circuits on draw modes | 01 | DONE |
| SC2 | toolbar with 5 mode buttons + trash | 02 + 03 | DONE |
| SC3 | drawing produces store-committed shapes (EPSG:4326 WKT); degenerate rejected; lasso simplified; ESC aborts | 04 | DONE |
| SC4 | committed shapes render across all maps with persistent measurement labels | 03 | DONE |
| SC5 | live tooltip during draw + click-shape+Delete removal mode-gated to draw modes | 04 + 05 | DONE |

## Selection Visual Tradeoff: Halo vs Fill-Lighten

Chosen approach: **halo** — 4px stroke + 1px `rgba(255,255,255,0.6)` inner stroke via `Style[]`.

Not chosen: fill-lighten (increase fill alpha on selection). Rationale:
- 29-UI-SPEC.md calls for "4px outline + 1px solid rgba(255,255,255,0.6) inner halo" explicitly
- Fill-lighten would change the overlap-additive fill behavior (multi-shape OR-composition semantics — darker where shapes overlap) which is intentional per 29-UI-SPEC.md
- `Style[]` is the canonical OL multi-stroke pattern; no special OL API needed

## Notes for Phase 30

**Materialize trigger dep array extension:**
- `AggregatedWidgetRenderer` currently reads `spatialFilterVersion` from `useSpatialFilterStore` via the store's `shapes.length` or similar primitive
- Phase 30 should add `shapes` or `shapesKey` to the materialize trigger dep array in `AggregatedWidgetRenderer`
- The store selector pattern is the same as `shapesKey` in MapChartRenderer (PITFALL S-02: use primitive join, not array ref)

**addShape/removeShape call sites (chip× wire-up parity):**
- `addShape` is called only in Effect 8 drawend pipeline at `MapChartRenderer.tsx` ~line 1306
- `removeShape` is called at `MapChartRenderer.tsx` ~line 1403 (Delete keydown effect) — Phase 30 chip× will add a second call site in FilterBar/chip onClick
- `clearAll` is called in MapDrawToolbar onClearAll prop at MapChartRenderer JSX ~line 1469
- All three are imperative `useSpatialFilterStore.getState().{method}()` calls (no hook selector needed for write paths per Zustand pattern)

## Task Commits

1. **Task 1 (TDD RED — tests)**: part of feat commit (tests written first, then implementation in same session)
2. **Task 1 (TDD GREEN — implementation + fix)**: `d3b3989` — `feat(29-05): shape selection + Delete keydown + selection visual (SHAPE-V15-04)`

## Files Created/Modified

- `kinetica_bi/src/components/charts/MapChartRenderer.tsx` (+105 lines net):
  - Lines 507-508: `selectedShapeId` useState + `selectedShapeIdRef` useRef
  - Lines 610-627: VectorLayer style function updated (isSelected branch, 4px stroke, halo Style[])
  - Lines 694-701: selectedShapeIdRef sync + `vectorLayerRef.current?.changed()` useEffect
  - Lines 1360-1390: Effect 9 — selection-click singleclick listener (mode-gated)
  - Lines 1395-1408: Effect 10 — Delete/Backspace keydown
  - Lines 1410-1418: Effect 11 — selection-clear on info/pan mode switch
  - Lines 1420-1432: Effect 12 — dangling-id reconciliation via shapesKey
  - Lines 1449-1455: `data-testid="selected-shape-id"` JSX test seam
- `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` (+510 lines net):
  - Extended MockMap: `forEachFeatureAtPixel`, multi-singleclick handler array, improved `un()` with handler index removal
  - Extended MockVectorLayer: `changed()` vi.fn()
  - Updated `capturedSingleclickHandler` type to `any` (accommodates both async info handler and sync selection handler)
  - V11-V13 style mock features: added `getId: () => undefined`
  - 20 new tests in `describe("Phase 29 Selection + Delete (SHAPE-V15-04)")`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] V11-V13 style mock features missing `getId()` method**
- **Found during:** Task 1 GREEN phase (running full suite after implementation)
- **Issue:** The updated VectorLayer style function calls `feature.getId()` to check `isSelected`. The V11-V13 test mock features (`{ get: ... }` objects) did not include a `getId` method, causing `TypeError: feature.getId is not a function`
- **Fix:** Added `getId: () => undefined` to each of the three mock feature objects in V11, V12, V13 tests. `undefined !== selectedShapeIdRef.current` (null initially) → unselected path taken → correct assertions pass
- **Files modified:** `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx`
- **Committed in:** d3b3989

**2. [Rule 1 - Type] `capturedSingleclickHandler` type too narrow after adding selection listener**
- **Found during:** Task 1 (tsc --noEmit)
- **Issue:** `capturedSingleclickHandler` was typed as `((event: { coordinate: [number, number] }) => Promise<void>) | null`. The new selection-click handler returns `void` (sync), not `Promise<void>`. TypeScript rejected the assignment in the updated `map.on` mock
- **Fix:** Widened type to `((event: any) => any) | null` with an eslint-disable comment. The type is used only in test infrastructure where exact typing is less critical
- **Files modified:** `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx`
- **Committed in:** d3b3989

---

**Total deviations:** 2 auto-fixed (both Rule 1 — test infrastructure gaps exposed by new production code)
**Impact on plan:** Minimal; both are test-only fixes. Production code matches plan exactly.

## Issues Encountered

None beyond the auto-fixed deviations above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 29 draw-and-shape is **feature-complete**. All 5 ROADMAP success criteria satisfied.
- Phase 30 (materialize-trigger + FilterBar chips) can now build on the complete store + draw UX.
- Phase 31 (UAT) can run the 11-step manual verification sequence in `<verification>` block.
- The `selectedShapeId` test seam (`data-testid="selected-shape-id"`) is production-safe (aria-hidden, display:none) and can remain for future debugging.

---
*Phase: 29-draw-and-shape*
*Completed: 2026-05-12*
