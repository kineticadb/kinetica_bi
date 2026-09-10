---
phase: 29-draw-and-shape
plan: 03
type: execute
wave: 3
depends_on:
  - 29-01
  - 29-02
files_modified:
  - kinetica_bi/src/components/charts/MapChartRenderer.tsx
  - kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx
  - kinetica_bi/src/styles/global.css
autonomous: true
requirements:
  - SHAPE-V15-01
  - SHAPE-V15-02
  - SHAPE-V15-03
must_haves:
  truths:
    - "A VectorLayer + VectorSource is created during Effect 1 (Map mount) on every map widget and disposed during Effect 1's cleanup return alongside imageLayersRef etc."
    - "The VectorLayer renders at zIndex 10000 so committed shapes paint above all WMS image layers (which top out at zIndex 1000) — invisible-shape pitfall avoided"
    - "Every committed shape from useSpatialFilterStore renders as a Feature on the VectorLayer, with per-type fill (10% opacity) and 2px outline (blue for bbox, green for lasso, orange for circle) — colors locked by 29-UI-SPEC.md"
    - "A new Effect 7 subscribes to useSpatialFilterStore via the primitive shapesKey selector (joined ids string) and atomically reconciles store → VectorSource (source.clear() → addFeature loop) on every shapes mutation (PITFALL S-02 mitigation)"
    - "Each committed shape renders a persistent measurement-pill ol/Overlay anchored to the polygon's interior point; the overlay is removed when its shape is removed from the store; ALL overlays are removed in Effect 1's cleanup return"
    - "MapDrawToolbar is mounted in MapChartRenderer's JSX as a sibling of widget-map-canvas, receiving drawMode + setDrawMode + shapes.length + clearAll callbacks"
    - "Cross-map shape rendering works: a shape committed via useSpatialFilterStore.getState().addShape on map A appears on every other MapChartRenderer instance in the dashboard simultaneously (verified via spec)"
  artifacts:
    - path: "kinetica_bi/src/components/charts/MapChartRenderer.tsx"
      provides: "VectorLayer/VectorSource setup in Effect 1; Effect 7 (shape sync + per-shape overlays); MapDrawToolbar JSX mount; new refs vectorLayerRef, vectorSourceRef, shapeOverlaysRef"
      contains: "vectorSourceRef"
    - path: "kinetica_bi/src/styles/global.css"
      provides: ".shape-measurement-pill CSS class for both live tooltip and persistent label (shared via 29-UI-SPEC.md lock)"
      contains: ".shape-measurement-pill"
  key_links:
    - from: "kinetica_bi/src/components/charts/MapChartRenderer.tsx Effect 7"
      to: "useSpatialFilterStore.shapes"
      via: "primitive shapesKey selector (joined ids string) — PITFALL S-02"
      pattern: "shapesKey\\|shapes\\.map\\(.*\\.id\\)\\.join"
    - from: "kinetica_bi/src/components/charts/MapChartRenderer.tsx Effect 1 cleanup"
      to: "shapeOverlaysRef + vectorLayerRef + vectorSourceRef"
      via: "dispose all overlays + clear refs + null layer references (mirror of imageLayersRef pattern)"
      pattern: "shapeOverlaysRef\\.current\\.clear\\(\\)\\|vectorLayerRef\\.current = null"
    - from: "MapDrawToolbar JSX mount"
      to: "useSpatialFilterStore"
      via: "shapesCount from primitive selector; onClearAll = useSpatialFilterStore.getState().clearAll"
      pattern: "clearAll"
---

<objective>
Mount the VectorLayer / VectorSource pair into MapChartRenderer's Effect 1, add the new Effect 7 that syncs `useSpatialFilterStore.shapes` → OL features (with per-shape persistent measurement overlays), and wire `MapDrawToolbar` into the JSX. After this plan, drawing is NOT yet possible (no Draw interaction — that's Plan 04) but committed shapes ARE rendered across all maps in the dashboard, AND the toolbar visually appears with working Pan/Info mode-switch + clearAll.

Purpose: SHAPE-V15-01/02/03 — display layer for committed shapes, atomic reconcile, persistent measurement labels. Plan 04 will commit shapes via Draw drawend; without this plan, those commits would have no visible effect. The toolbar mount is included here because the only stateful prop it needs (`shapesCount`) becomes meaningful once the VectorLayer renders.

Output: MapChartRenderer.tsx grows to ~1180 lines with new refs (vectorLayerRef, vectorSourceRef, shapeOverlaysRef), Effect 1 extensions, a new Effect 7, a new shapesKey primitive selector, and the MapDrawToolbar JSX mount. global.css gains the `.shape-measurement-pill` class. Spec file gains tests for the sync, overlay lifecycle, cross-map rendering, and toolbar integration.
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/phases/29-draw-and-shape/29-CONTEXT.md
@.planning/phases/29-draw-and-shape/29-RESEARCH.md
@.planning/phases/29-draw-and-shape/29-UI-SPEC.md
@.planning/phases/29-draw-and-shape/29-01-mode-guard-and-foundation-PLAN.md
@.planning/phases/29-draw-and-shape/29-02-map-draw-toolbar-PLAN.md
@kinetica_bi/src/components/charts/MapChartRenderer.tsx
@kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx
@kinetica_bi/src/components/charts/MapDrawToolbar.tsx
@kinetica_bi/src/store/spatialFilterStore.ts
@kinetica_bi/src/lib/shapeDraw.ts

<interfaces>
<!-- Key types and contracts the executor needs. -->

From kinetica_bi/src/store/spatialFilterStore.ts (already shipped Phase 27):
```typescript
export type Shape = {
  id: string;
  type: "bbox" | "lasso" | "circle";
  wkt: string;       // EPSG:4326
  label: string;
  measurement: string;
  addedAt: number;
};
export const useSpatialFilterStore: UseBoundStore<...>;
// state: { shapes: Shape[], spatialFilterVersion, shapeCounter, addShape, removeShape, clearAll, reset }
```

Shape color palette (29-UI-SPEC.md — locked):
```typescript
const SHAPE_COLORS = {
  bbox:   { fill: "rgba(37, 99, 235, 0.10)",  stroke: "#2563eb" }, // blue
  lasso:  { fill: "rgba(22, 163, 74, 0.10)",  stroke: "#16a34a" }, // green
  circle: { fill: "rgba(234, 88, 12, 0.10)",  stroke: "#ea580c" }, // orange
} as const;
```

OL imports needed (NEW for MapChartRenderer.tsx — current file does NOT import these):
```typescript
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Style, Fill, Stroke } from "ol/style";
import Feature from "ol/Feature";
import WKT from "ol/format/WKT";
import type Polygon from "ol/geom/Polygon";
// Note: Overlay is ALREADY imported (line 39: `import Overlay from "ol/Overlay";`)
```

From .planning/phases/29-draw-and-shape/29-RESEARCH.md Pattern 5 (Effect 7 verbatim — reference implementation):
- Read shapesKey primitive selector via `useSpatialFilterStore((s) => s.shapes.map(sh => sh.id).join("|"))`
- Imperative read of full shapes via `useSpatialFilterStore.getState().shapes`
- `source.clear(true)` (fast: skip removefeature events) then addFeature loop
- shapeOverlaysRef = `useRef<Map<string, Overlay>>(new Map())`
- per-shape overlay element: `<div class="shape-measurement-pill">{measurement}</div>`
- positioning: `center-center`, stopEvent: false
- centroid via `geom.getInteriorPoint().getCoordinates().slice(0, 2)`
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add VectorLayer/VectorSource + new refs + Effect 7 shape-sync + per-shape persistent overlays + MapDrawToolbar JSX mount to MapChartRenderer.tsx</name>
  <files>kinetica_bi/src/components/charts/MapChartRenderer.tsx, kinetica_bi/src/styles/global.css</files>
  <read_first>
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx (lines 28-62 for imports; lines 401-453 for ref block; lines 496-578 for Effect 1; lines 977-1040 for JSX block)
    - .planning/phases/29-draw-and-shape/29-RESEARCH.md (Pattern 5: Effect 7 Shape Sync — verbatim code; Pattern 11: VectorLayer Setup + Style Function; Pitfall 1: Duplicate Features; Pitfall 3: ol/Overlay Ghost; Pitfall 6: ImageWMS + VectorLayer z-index)
    - .planning/phases/29-draw-and-shape/29-UI-SPEC.md (Color section — shape palette hex values + measurement pill styling)
    - .planning/phases/29-draw-and-shape/29-CONTEXT.md (Shape colors & selection visual; Persistent measurement label styling)
    - kinetica_bi/src/store/spatialFilterStore.ts (Shape type + selector patterns)
    - kinetica_bi/src/components/charts/MapDrawToolbar.tsx (Plan 02 — default export contract)
  </read_first>
  <behavior>
    Test list (in MapChartRenderer.spec.tsx, NEW describe block "Phase 29 VectorLayer + Effect 7 shape sync (SHAPE-V15-01..03)"):
    - V1 (VectorLayer mounted): After component mount with empty store, the OL Map mock has received an `addLayer` call for a VectorLayer instance (in addition to the basemap). Verify via the OL mock's `addLayer` spy.
    - V2 (VectorLayer zIndex = 10000): The added VectorLayer has zIndex 10000 (above WMS LAYER_Z_BASE = 1000 — Pitfall 6).
    - V3 (no features on empty store): After mount with empty store, `vectorSource.getFeatures()` (via the mock spy) has length 0.
    - V4 (single shape renders one feature): After `useSpatialFilterStore.getState().addShape({ type: "bbox", wkt: VALID_BBOX_WKT, measurement: "5.0 km × 3.0 km" })`, the VectorSource has exactly 1 feature.
    - V5 (feature carries shapeType property): The added feature's `.get("shapeType") === "bbox"`.
    - V6 (feature id matches store shape id): `feature.getId() === storeShape.id`.
    - V7 (atomic clear+re-add on shapes change): After 2 shapes are added then 1 removed, the sequence is: source.clear() called → source.addFeature called 2× (was 3× before remove). Implementation MUST call source.clear() each sync run.
    - V8 (per-shape overlay added): After `addShape` on a bbox, the map mock has received an `addOverlay` call where the overlay's element has `className === "shape-measurement-pill"` and textContent matching the measurement string.
    - V9 (overlay removed when shape removed): After adding then removing a shape, `removeOverlay` is called for the prior overlay.
    - V10 (Effect 1 cleanup disposes all overlays): On unmount, the cleanup return calls `removeOverlay` for every still-present shape overlay AND clears shapeOverlaysRef.
    - V11 (style function selects per-type color): The VectorLayer's style function, when invoked with a feature where `feature.get("shapeType") === "bbox"`, returns a Style whose Stroke color === "#2563eb" (blue) and width === 2 (selection state is Plan 05; in this plan, all features are unselected).
    - V12 (style function for lasso): style with `shapeType === "lasso"` returns Stroke color "#16a34a", width 2.
    - V13 (style function for circle): style with `shapeType === "circle"` returns Stroke color "#ea580c", width 2.
    - V14 (cross-map rendering): Render TWO MapChartRenderer instances in the same test (different widget ids). After `addShape`, BOTH instances' VectorSources receive the new feature. This is the cross-map visibility test (success criterion 4).
    - V15 (MapDrawToolbar mounted in JSX): After component render, `screen.getByRole("toolbar", { name: /Drawing tools/i })` is in the document.
    - V16 (Trash visibility tied to store): With 0 shapes, `screen.queryByLabelText("Clear all shapes")` is null. After `addShape`, the trash button appears.
    - V17 (onClearAll calls store clearAll): Add 1 shape; click `screen.getByLabelText("Clear all shapes")`; assert store `shapes.length === 0` after.
    - V18 (onModeChange calls setDrawMode): Click `screen.getByLabelText("Draw bounding box")` — this won't change cursor without re-render of cursor effect, but it WILL call setDrawMode which our state-machinery effect (Plan 01) syncs to drawModeRef. Verify via the existing M-test infrastructure that drawModeRef.current became "bbox" (this should already work via Plan 01's state machinery; this test verifies the toolbar's onModeChange wire is correct).

    A valid `VALID_BBOX_WKT` for fixtures: `"POLYGON((-74.0 40.7, -73.9 40.7, -73.9 40.8, -74.0 40.8, -74.0 40.7))"`.

    The OL mocks may need extension: add spies/mocks for `VectorLayer`, `VectorSource`, `WKT.readGeometry`, `Feature`, `Style`, `Fill`, `Stroke`. Mirror the existing pattern (look for the existing `vi.mock("ol/Map")` block).
  </behavior>
  <action>
Step 1 — Add imports to `kinetica_bi/src/components/charts/MapChartRenderer.tsx`. Find the OL imports block (lines 30-41) and APPEND these imports immediately after the existing `import Overlay from "ol/Overlay";` line:
```typescript
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Style, Fill, Stroke } from "ol/style";
import Feature from "ol/Feature";
import WKT from "ol/format/WKT";
import type Polygon from "ol/geom/Polygon";
```

Add the store + toolbar imports below the existing store imports block (after `import { useLastInfoClickContextStore } from "../../store/lastInfoClickContextStore";` around line 55):
```typescript
import { useSpatialFilterStore } from "../../store/spatialFilterStore";
import MapDrawToolbar from "./MapDrawToolbar";
```

Step 2 — Add the SHAPE_COLORS constant at module scope (near `LAYER_Z_BASE` around line 87). Use this exact block:
```typescript
/**
 * Phase 29 (SHAPE-V15-01): Per-type fixed color palette — locked by 29-UI-SPEC.md.
 * Bbox = blue, Lasso = green, Circle = orange. Fill = 10% opacity of the stroke color.
 * Overlap-additive fills produce darker areas on multi-shape overlap (semantically correct
 * for OR-composed spatial filters).
 */
const SHAPE_COLORS: Record<"bbox" | "lasso" | "circle", { fill: string; stroke: string }> = {
  bbox:   { fill: "rgba(37, 99, 235, 0.10)",  stroke: "#2563eb" },
  lasso:  { fill: "rgba(22, 163, 74, 0.10)",  stroke: "#16a34a" },
  circle: { fill: "rgba(234, 88, 12, 0.10)",  stroke: "#ea580c" },
};
```

Step 3 — Add the new refs in the ref block (after the Plan 01 mode-state declarations from 29-01). Place these AFTER `previousModeRef` and BEFORE the `popupContainerRef` block:
```typescript
  // ── Phase 29 (SHAPE-V15-01..03): Vector overlay refs ─────────────────────
  // vectorLayerRef + vectorSourceRef are set in Effect 1 and disposed in Effect 1's cleanup.
  // shapeOverlaysRef tracks per-shape persistent measurement-pill Overlays (one per committed
  // shape). Cleared atomically in Effect 7 on shape removal AND in Effect 1's cleanup.
  const vectorLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const vectorSourceRef = useRef<VectorSource | null>(null);
  const shapeOverlaysRef = useRef<Map<string, Overlay>>(new Map());
```

Step 4 — Add the primitive shapesKey selector with the other store selectors. Find the existing store selector calls (look for `useFilterStore` etc.) and add:
```typescript
  // PITFALL S-02 lock: primitive shapesKey selector (joined ids) — Effect 7's dep array key.
  // Reads as string — never the array reference, never the whole store state.
  const shapesKey = useSpatialFilterStore((s) => s.shapes.map((sh) => sh.id).join("|"));
  // Primitive shapes-count for MapDrawToolbar prop (trash visibility gate).
  const shapesCount = useSpatialFilterStore((s) => s.shapes.length);
```

Step 5 — Extend Effect 1 to create the VectorLayer + VectorSource and add it to the map AFTER the basemap is added. Find Effect 1 mount (line ~517 — `const map = new OlMap(...)`); after `mapRef.current = map;` (line 531) and BEFORE the ResizeObserver setup (line 534), INSERT this block:
```typescript
    // ── Phase 29 (SHAPE-V15-01): VectorLayer + VectorSource for committed shapes ─
    // Pitfall 6 lock: zIndex 10000 puts shapes above all WMS image layers (max ~1000).
    // The style function reads feature.get("shapeType") for per-type color (29-UI-SPEC.md).
    // selectedShapeIdRef is added by Plan 05; in this plan all features render unselected (width 2).
    const vectorSource = new VectorSource();
    vectorSourceRef.current = vectorSource;
    const vectorLayer = new VectorLayer({
      source: vectorSource,
      zIndex: 10000,
      style: (feature) => {
        const type = feature.get("shapeType") as "bbox" | "lasso" | "circle";
        const palette = SHAPE_COLORS[type] ?? SHAPE_COLORS.bbox;
        return new Style({
          fill: new Fill({ color: palette.fill }),
          stroke: new Stroke({ color: palette.stroke, width: 2 }),
        });
      },
    });
    vectorLayerRef.current = vectorLayer;
    map.addLayer(vectorLayer);
```

Step 6 — Extend Effect 1's cleanup return to dispose Vector resources + all shape overlays. Find the cleanup return (line ~544) and add these lines BEFORE `map.setTarget(undefined);`:
```typescript
      // Phase 29 (Pitfall 3 ghost-overlay): remove every per-shape persistent overlay BEFORE
      // map disposal. Without this, leftover Overlay elements survive map.dispose() and any
      // future re-mount inherits stale DOM nodes (and the map.removeOverlay calls in Effect 7
      // never fire for the previous instance's overlays).
      for (const overlay of shapeOverlaysRef.current.values()) {
        try { map.removeOverlay(overlay); } catch { /* already detached; ignore */ }
      }
      shapeOverlaysRef.current.clear();
```
And add this AFTER `mapRef.current = null;`:
```typescript
      vectorLayerRef.current = null;
      vectorSourceRef.current = null;
```

Step 7 — Insert the new Effect 7 (shape sync) AFTER Effect 6 (line ~975, after the closing `}, [getInfoEnabled(widgetConfig as MapWidgetConfig), eligibleLayers, tables, widgetConfig]);`) and BEFORE the JSX block (line ~977 `// ── JSX ──`). Use this EXACT block:
```typescript
  // ── Effect 7 (Phase 29 SHAPE-V15-02 / V15-03): shape sync — store → OL features + overlays ─
  // Subscribed to shapesKey primitive (PITFALL S-02). Atomic clear+re-add (Pitfall 1: avoid
  // duplicate features with Plan 04's drawend). Per-shape persistent measurement-pill Overlay
  // anchored to polygon interior point (Pitfall 3: clean up overlays on removal).
  useEffect(() => {
    const map = mapRef.current;
    const source = vectorSourceRef.current;
    if (!map || !source) return;
    if (!mountedRef.current) return;

    const shapes = useSpatialFilterStore.getState().shapes;
    const currentIds = new Set(shapes.map((sh) => sh.id));

    // Tear down stale per-shape overlays first.
    for (const [id, overlay] of shapeOverlaysRef.current) {
      if (!currentIds.has(id)) {
        try { map.removeOverlay(overlay); } catch { /* already detached; ignore */ }
        shapeOverlaysRef.current.delete(id);
      }
    }

    // Atomic clear + re-add (avoids feature-id collision; mirrors Phase 16 patterns).
    source.clear(true);

    const wktFormat = new WKT();
    for (const shape of shapes) {
      let geom: Polygon;
      try {
        geom = wktFormat.readGeometry(shape.wkt, {
          dataProjection: "EPSG:4326",
          featureProjection: "EPSG:3857",
        }) as Polygon;
      } catch {
        // Defensive: corrupt WKT in the store would otherwise crash the sync. Skip it.
        continue;
      }

      const feature = new Feature({ geometry: geom });
      feature.setId(shape.id);
      feature.set("shapeType", shape.type);
      source.addFeature(feature);

      // Persistent measurement label (SHAPE-V15-03).
      let overlay = shapeOverlaysRef.current.get(shape.id);
      if (!overlay) {
        const el = document.createElement("div");
        el.className = "shape-measurement-pill";
        el.textContent = shape.measurement;
        el.setAttribute("aria-hidden", "true");
        overlay = new Overlay({
          element: el,
          positioning: "center-center",
          stopEvent: false,
        });
        map.addOverlay(overlay);
        shapeOverlaysRef.current.set(shape.id, overlay);
      } else {
        // Same id, same measurement — defensive sync of text content.
        const el = overlay.getElement() as HTMLElement | null;
        if (el) el.textContent = shape.measurement;
      }
      // Position overlay at polygon interior point (works for non-convex lassos).
      const interior = geom.getInteriorPoint().getCoordinates();
      overlay.setPosition([interior[0], interior[1]]);
    }
    // No explicit cleanup beyond Effect 1's overlay-clear — overlay set/delete is managed in-effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapesKey]);
```

Step 8 — Mount `<MapDrawToolbar />` in the JSX. Find the JSX return (line ~982, `<div className="widget-map">`) and INSERT the toolbar IMMEDIATELY AFTER the `<div ref={containerRef} className="widget-map-canvas" />` line (line ~985):
```jsx
      {/* Phase 29 (DRAW-V15-01): drawing toolbar overlay. Sibling to the OL canvas
          (NOT a child) per V15-P-17 lock — React component, NOT ol/control/Control. */}
      <MapDrawToolbar
        drawMode={drawMode}
        onModeChange={setDrawMode}
        shapesCount={shapesCount}
        onClearAll={() => useSpatialFilterStore.getState().clearAll()}
      />
```

Step 9 — Append the `.shape-measurement-pill` CSS class to `kinetica_bi/src/styles/global.css`. Append AFTER the `.map-draw-toolbar-divider` block from Plan 02 (or AFTER `.widget-map-toolbar` block if Plan 02 didn't land first — but it did per depends_on). Use this exact block:
```css
/* ============================================================
   Phase 29 (SHAPE-V15-03): Shape measurement pill.
   - Shared CSS class for the persistent measurement label (Plan 03) and the live tooltip
     during draw (Plan 04). Same dark pill, same white text, same font — single class for
     visual continuity (29-CONTEXT.md locked).
   - position is set by ol/Overlay (no positioning here); pointer-events: none so clicks
     pass through to the map canvas (selection / draw interactions).
   ============================================================ */
.shape-measurement-pill {
  background: rgba(15, 23, 42, 0.82);
  color: #ffffff;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.4;
  padding: 4px 8px;
  border-radius: 12px;
  white-space: nowrap;
  pointer-events: none;
  user-select: none;
  font-family: Manrope, "Segoe UI", system-ui, -apple-system, sans-serif;
}
```

Step 10 — Extend `MapChartRenderer.spec.tsx` with the V1-V18 tests in a new `describe("Phase 29 VectorLayer + Effect 7 shape sync (SHAPE-V15-01..03)", ...)` block. The OL mocks likely need extension; mirror existing `vi.mock("ol/...")` patterns. Key extension: the `ol/Map` mock's `addLayer` must record calls so V1-V2 can assert; the `ol/source/Vector` mock must expose `clear`, `addFeature`, `getFeatures`; the `ol/format/WKT` mock's `readGeometry` returns a stub Polygon with `getInteriorPoint().getCoordinates() === [0, 0, 0]`.

For V14 (cross-map): render two `<MapChartRenderer widget={w1} ... />` and `<MapChartRenderer widget={w2} ... />` instances in the same render tree, then `act(() => useSpatialFilterStore.getState().addShape({type:'bbox', wkt: VALID_BBOX_WKT, measurement:'5.0 km × 3.0 km'}))`. Verify BOTH map instances received an `addFeature` call.

NOTE: existing mock patterns in this spec are extensive; the task is large. If the OL mocks are too brittle to extend cleanly, the implementer may move Effect 7 + VectorLayer setup tests to a NEW spec file `MapChartRenderer.shape-sync.spec.tsx` that uses the existing mock setup helper but with a tighter focus. Either approach satisfies the spec contract — both are testable. Choose the lower-friction path; document the choice in the SUMMARY.

Step 11 — Run `cd kinetica_bi && npx vitest run` — full suite green. Run `npx tsc --noEmit` — 0 errors.

Step 12 — Commit: `feat(29-03): VectorLayer + Effect 7 shape sync + MapDrawToolbar JSX mount (SHAPE-V15-01..03)`.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/charts/MapChartRenderer.spec.tsx 2>&1 | tail -10</automated>
  </verify>
  <acceptance_criteria>
    - `grep -n 'import VectorLayer from "ol/layer/Vector"' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least 1 line
    - `grep -n 'import VectorSource from "ol/source/Vector"' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least 1 line
    - `grep -n 'import WKT from "ol/format/WKT"' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least 1 line
    - `grep -n 'import MapDrawToolbar' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns exactly 1 line
    - `grep -n 'import { useSpatialFilterStore }' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns exactly 1 line
    - `grep -n 'const SHAPE_COLORS' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns exactly 1 line; the block contains `#2563eb`, `#16a34a`, `#ea580c`
    - `grep -nE 'vectorLayerRef|vectorSourceRef|shapeOverlaysRef' kinetica_bi/src/components/charts/MapChartRenderer.tsx | wc -l` returns at least 6 (3 declarations + at least 3 uses)
    - `grep -n 'zIndex: 10000' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least 1 (Pitfall 6 lock)
    - `grep -n 'shapesKey' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least 2 (selector + Effect 7 dep)
    - `grep -nE 'shapesCount|s\.shapes\.length' kinetica_bi/src/components/charts/MapChartRenderer.tsx | wc -l` returns at least 2 (selector + JSX prop)
    - `grep -nB1 'Effect 7' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least 1 line (presence of Effect 7 comment block)
    - `grep -n 'source.clear(true)' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns exactly 1 line (atomic-clear lock)
    - `grep -n 'shape-measurement-pill' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least 1 line (overlay element className)
    - `grep -n 'shape-measurement-pill' kinetica_bi/src/styles/global.css` returns at least 1 line (CSS class definition)
    - `grep -n 'positioning: "center-center"' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least 1 line
    - `grep -n '<MapDrawToolbar' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least 1 line in JSX
    - `grep -nA3 '<MapDrawToolbar' kinetica_bi/src/components/charts/MapChartRenderer.tsx | grep -c "onModeChange={setDrawMode}\\|shapesCount={shapesCount}\\|onClearAll=.*clearAll"` returns at least 3
    - `cd kinetica_bi && npx vitest run` exits 0 (full suite — no regressions)
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
    - `cd kinetica_bi && npx vitest run src/components/charts/MapChartRenderer.spec.tsx --reporter=verbose 2>&1 | grep -cE "(V[0-9]+:|V1[0-8]:)"` returns at least 18 (V1-V18 test names visible)
  </acceptance_criteria>
  <done>
    MapChartRenderer mounts a VectorLayer/Source on map init; Effect 7 reconciles store → features atomically with per-shape persistent measurement overlays; MapDrawToolbar appears in the dashboard top-left of every map. Cross-map rendering works (drawing on map A is visible on map B). Toolbar Pan/Info mode-switch and clearAll work end-to-end. Drawing itself NOT yet possible — Plan 04 adds the Draw interaction.
  </done>
</task>

</tasks>

<verification>
**Manual verification:**
1. `cd kinetica_bi && npm run dev` — open a dashboard with a map widget
2. Confirm the new draw toolbar appears below the OL zoom (+/-) control on the top-left of each map widget
3. Confirm clicking Pan changes cursor to grab; clicking Info restores default; clicking Bbox/Lasso/Circle changes cursor to crosshair
4. Open DevTools console; run:
   ```
   const {useSpatialFilterStore} = await import('/src/store/spatialFilterStore.ts');
   useSpatialFilterStore.getState().addShape({
     type: 'bbox',
     wkt: 'POLYGON((-74.0 40.7, -73.9 40.7, -73.9 40.8, -74.0 40.8, -74.0 40.7))',
     measurement: '5.0 km × 3.0 km'
   });
   ```
   Expected: blue-tinted rectangle appears on EVERY map widget in the dashboard simultaneously; a dark "5.0 km × 3.0 km" pill appears at the rectangle's center. Trash icon appears in the toolbar.
5. Click the Trash icon → rectangle disappears from every map; pill disappears; Trash icon hidden.

**Automated verification:**
- `cd kinetica_bi && npx vitest run` — full suite green
- `cd kinetica_bi && npx tsc --noEmit` — 0 errors
</verification>

<success_criteria>
1. VectorLayer + VectorSource created in Effect 1 with zIndex 10000 (Pitfall 6 closed)
2. Effect 7 atomically syncs store.shapes → OL features on every shapesKey change (V15-P-09 + S-02 + Pitfall 1 respected)
3. Per-shape persistent measurement-pill overlay rendered via ol/Overlay at polygon interior point; removed when shape removed; cleared on map dispose
4. MapDrawToolbar mounted in MapChartRenderer JSX with working onModeChange + shapesCount + onClearAll wires
5. Cross-map shape visibility verified: a shape committed via store appears on every map widget in the dashboard simultaneously
6. Full vitest suite green; tsc clean
7. CSS class `.shape-measurement-pill` exists in global.css matching UI-SPEC styling
</success_criteria>

<output>
After completion, create `.planning/phases/29-draw-and-shape/29-03-SUMMARY.md` documenting:
- Final shape of new refs (vectorLayerRef, vectorSourceRef, shapeOverlaysRef) and their lifecycle
- Effect 7 location (exact line range in MapChartRenderer.tsx) so Plan 04 (Effect 8) and Plan 05 (selection click) can be inserted adjacent
- Confirmation that cross-map rendering works (manual test from <verification>)
- Any OL mock extensions added to the spec file (Plan 04 will reuse them)
- Decision: whether tests landed in MapChartRenderer.spec.tsx or a new sibling shape-sync.spec.tsx file
</output>
