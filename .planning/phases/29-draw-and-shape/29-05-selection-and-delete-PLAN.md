---
phase: 29-draw-and-shape
plan: 05
type: execute
wave: 5
depends_on:
  - 29-01
  - 29-02
  - 29-03
  - 29-04
files_modified:
  - kinetica_bi/src/components/charts/MapChartRenderer.tsx
  - kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx
autonomous: true
requirements:
  - SHAPE-V15-04
must_haves:
  truths:
    - "Clicking a committed shape ONLY in bbox/lasso/circle modes selects it; the selected shape renders with a 4px outline (vs 2px default) so the user can see selection state — selection state is component-local useState in MapChartRenderer, NOT in useSpatialFilterStore"
    - "Clicking the empty map area in a draw mode clears the selection"
    - "Selection click is DISABLED in Info mode (would conflict with v1.4 singleclick popup) and DISABLED in Pan mode (no shape-interaction surface) — mode-gated by SHAPE-V15-04"
    - "Switching to Info or Pan mode auto-clears selection; switching between draw modes (bbox ↔ lasso ↔ circle) PRESERVES selection (29-CONTEXT.md lock)"
    - "Delete keydown (or Backspace) with a selected shape removes it via useSpatialFilterStore.removeShape(id); the persistent measurement overlay disappears via Effect 7 reconcile"
    - "Delete with no selection is a silent no-op (no toast); ESC clears selection mid-flight"
    - "If the currently-selected shape is removed by any other path (clearAll, chip ×, dangling id), selectedShapeId is reconciled to null automatically so the style function does not paint a phantom selection"
  artifacts:
    - path: "kinetica_bi/src/components/charts/MapChartRenderer.tsx"
      provides: "selectedShapeId useState + selectedShapeIdRef mirror; selection-click useEffect (mode-gated); Delete keydown useEffect; selection-clear-on-mode-switch useEffect; selection-clear-on-shape-removed useEffect; updated VectorLayer style function reading selectedShapeIdRef for 4px-vs-2px stroke"
      contains: "selectedShapeId"
  key_links:
    - from: "VectorLayer style function (Plan 03)"
      to: "selectedShapeIdRef.current"
      via: "imperative ref read; vectorLayerRef.current?.changed() triggers re-render on selection change"
      pattern: "selectedShapeIdRef\\.current"
    - from: "selection-click useEffect"
      to: "useSpatialFilterStore via map.forEachFeatureAtPixel hit-test on VectorLayer features"
      via: "OL singleclick listener (NEW — coexists with Effect 6's info listener; mode-guards keep them orthogonal)"
      pattern: "forEachFeatureAtPixel"
    - from: "Delete keydown useEffect"
      to: "useSpatialFilterStore.getState().removeShape(selectedShapeId)"
      via: "window keydown listener; gated on selectedShapeId !== null AND drawMode is a draw mode"
      pattern: "removeShape\\(.*selectedShapeId"
---

<objective>
Add shape selection + Delete keydown removal to MapChartRenderer, completing the SHAPE-V15-04 requirement. This plan adds 4 new effects (selection-click, Delete keydown, selection-clear-on-mode-switch, selection-clear-on-shape-removed) and updates the VectorLayer style function (set up in Plan 03) to render the selected shape with a 4px outline.

Purpose: SHAPE-V15-04 lock — operators need a way to remove individual shapes without resorting to clearAll. Click-to-select + Delete-to-remove is the standard GIS UX pattern (Kepler.gl, QGIS, ArcGIS). Mode-gating prevents conflict with the v1.4 Info singleclick popup AND prevents accidental shape removal during Pan map dragging. Selection state is COMPONENT-LOCAL (NOT in Phase 27 store — locked by 29-CONTEXT.md "Selection state is component-local").

Output: MapChartRenderer.tsx gains selectedShapeId useState + selectedShapeIdRef ref + 4 new effects (~60 lines total). The VectorLayer style function (added in Plan 03) is updated to switch between 2px and 4px stroke width based on selection. Spec coverage in MapChartRenderer.spec.tsx. After this plan, Phase 29 is feature-complete and ready for Phase 30 (materialize trigger + chips) and Phase 31 (UAT).
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
@.planning/phases/29-draw-and-shape/29-03-vector-layer-and-shape-sync-PLAN.md
@.planning/phases/29-draw-and-shape/29-04-draw-interaction-and-pipeline-PLAN.md
@kinetica_bi/src/components/charts/MapChartRenderer.tsx
@kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx

<interfaces>
<!-- Key types and contracts. -->

From Plan 01:
```typescript
const [drawMode, setDrawMode] = useState<DrawMode>("info");
const drawModeRef = useRef<DrawMode>("info");
```

From Plan 03 (style function already in VectorLayer setup):
```typescript
const vectorLayer = new VectorLayer({
  source: vectorSource,
  zIndex: 10000,
  style: (feature) => {
    const type = feature.get("shapeType") as "bbox" | "lasso" | "circle";
    const palette = SHAPE_COLORS[type] ?? SHAPE_COLORS.bbox;
    return new Style({
      fill: new Fill({ color: palette.fill }),
      stroke: new Stroke({ color: palette.stroke, width: 2 }),  // ← Plan 05 updates this
    });
  },
});
```

This plan changes the style function to read `selectedShapeIdRef.current` and use width=4 when `feature.getId() === selectedShapeIdRef.current`. Also adds optional inner halo stroke (29-UI-SPEC.md selection visual: "4px outline + 1px solid rgba(255,255,255,0.6) inner halo").

From Plan 04:
```typescript
const drawRef = useRef<Draw | null>(null);
// Effect 8 handles ESC keydown for abort.
```

This plan adds a SEPARATE Delete keydown effect (different deps, different lifecycle than Effect 8's ESC handler). They coexist on the same window listener target without conflict because they filter by different keys.

From Plan 03 (Effect 7):
```typescript
// Reads useSpatialFilterStore.getState().shapes; reconciles VectorSource features.
// shapesKey primitive is the dep. We need selectedShapeIdRef to auto-clear when the
// selected shape is removed externally (chip ×, clearAll, etc.).
```

Selection style (from 29-UI-SPEC.md):
- Selected outline: 4px solid per-type color (was 2px)
- Selection halo: 1px solid rgba(255,255,255,0.6) inner
- Fill unchanged
- The halo can be implemented via a SECOND Style returned from the style function (style function can return Style[] for layered rendering)
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add selection state + Delete keydown + selection-click + selection-clear effects + selection-aware style function to MapChartRenderer.tsx</name>
  <files>kinetica_bi/src/components/charts/MapChartRenderer.tsx, kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx</files>
  <read_first>
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx (Plan 01-04 cumulative output — VectorLayer style function in Effect 1, Effect 7, Effect 8, drawMode state, all refs)
    - .planning/phases/29-draw-and-shape/29-RESEARCH.md (Pattern 11: VectorLayer Setup — selectedShapeIdRef mirror; Pattern 12: Selection + Delete; Pitfall 9: Click-shape Selection vs Info-popup; 29-CONTEXT.md Mode & selection behavior — full rule set)
    - .planning/phases/29-draw-and-shape/29-UI-SPEC.md (Color: shape palette + selection halo; Interaction Contract: Selection section)
    - .planning/phases/29-draw-and-shape/29-CONTEXT.md (Specifics: "selectedShapeId lives in useState inside MapChartRenderer NOT in the store")
    - kinetica_bi/src/store/spatialFilterStore.ts (removeShape contract — no-op on non-existent id)
  </read_first>
  <behavior>
    Test list (in MapChartRenderer.spec.tsx, NEW describe "Phase 29 Selection + Delete (SHAPE-V15-04)"):

    Selection click (mode-gated):
    - S1: With drawMode='info' and 1 shape in store, simulated singleclick that hits the shape's feature does NOT change `selectedShapeId` (no setSelectedShapeId call). Selection click is disabled in Info mode (Pitfall 9 — info popup listener handles the click instead).
    - S2: With drawMode='pan', same as S1 — no selection.
    - S3: With drawMode='bbox' and 1 shape, simulated click hitting the feature SETS selectedShapeId to that shape's id.
    - S4: With drawMode='lasso' and 1 shape selected, simulated click on EMPTY area (no feature hit) clears selectedShapeId to null.
    - S5: With drawMode='circle' and 2 shapes, clicking shape B (when shape A is selected) transfers selection: selectedShapeId becomes B's id.

    Selection visual:
    - V1: After selecting a shape (drawMode='bbox', selectedShapeId set), the VectorLayer style function returns a Style with stroke width 4 for the selected feature.
    - V2: Unselected features still use stroke width 2.
    - V3: After selecting a shape, `vectorLayer.changed()` is called (forces re-render). Verify via spy.

    Selection-clear-on-mode-switch:
    - C1: With selectedShapeId set and drawMode='bbox', setting drawMode to 'info' clears selectedShapeId to null.
    - C2: With selectedShapeId set and drawMode='bbox', setting drawMode to 'pan' clears selectedShapeId to null.
    - C3: With selectedShapeId set and drawMode='bbox', setting drawMode to 'lasso' (another draw mode) PRESERVES selection (locked by 29-CONTEXT.md).
    - C4: With selectedShapeId set and drawMode='bbox', setting drawMode to 'circle' PRESERVES selection.

    Delete keydown:
    - D1: With selectedShapeId set and drawMode='bbox', firing window keydown 'Delete' calls `useSpatialFilterStore.getState().removeShape(selectedShapeId)`.
    - D2: With selectedShapeId set and drawMode='bbox', firing 'Backspace' ALSO calls removeShape (29-CONTEXT.md does not lock either way; allow both per UI convention — but if you implement Delete only, the test should match).
    - D3: With selectedShapeId set and drawMode='info', firing 'Delete' is a no-op (mode-gated — Pitfall 9).
    - D4: With selectedShapeId === null and drawMode='bbox', firing 'Delete' is a SILENT no-op (no toast, no error — 29-CONTEXT.md lock).
    - D5: After Delete removes the shape, selectedShapeId is reset to null.

    Selection-clear-on-shape-removed (selectedShapeId becomes dangling when shape removed by external path):
    - X1: Selected shape A (selectedShapeId = "id-a"); clearAll() called via toolbar. After Effect 7 reconciles, selectedShapeId is auto-reset to null because "id-a" is no longer in shapes[]. (Implementation: a useEffect on [shapesKey] that checks if selectedShapeId is still in the shapes list; if not, clears it.)
    - X2: Selected shape A; an external code path (Phase 30 chip × — simulated here as a direct store.removeShape("id-a")). After reconcile, selectedShapeId is null.

    ESC clears selection (cross-effect interaction — Plan 04's ESC also fires this):
    - E1: With selectedShapeId set and drawMode='bbox', firing window 'Escape' calls Plan 04's ESC handler AND clears selectedShapeId (via either an explicit clear in Plan 04's ESC handler OR via the mode-switch effect when the ESC handler restores to 'info' which auto-clears).

    Implementation note for E1: the cleanest implementation is that Plan 04's ESC handler doesn't need modification — when ESC fires `setDrawMode(previousModeRef.current)` and previousMode is Info/Pan, the C1/C2 effect kicks in automatically. The test verifies the end state (selectedShapeId === null AND drawMode === 'info') after a synthetic ESC from drawMode='bbox' with a selected shape.
  </behavior>
  <action>
Step 1 — Add selection state + ref to MapChartRenderer.tsx. Place AFTER `drawRef` from Plan 04:
```typescript
  // ── Phase 29 (SHAPE-V15-04): Selection state ──────────────────────────────
  // Component-local — NOT in useSpatialFilterStore (Plan 27 store stays unmodified).
  // The ref mirror lets the VectorLayer style function read the current selection
  // without re-running the entire Effect 1 setup on every selection change.
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
  const selectedShapeIdRef = useRef<string | null>(null);
```

Step 2 — Update the VectorLayer style function (currently in Effect 1, added by Plan 03). Find the style function and REPLACE the existing implementation with:
```typescript
      style: (feature) => {
        const type = feature.get("shapeType") as "bbox" | "lasso" | "circle";
        const palette = SHAPE_COLORS[type] ?? SHAPE_COLORS.bbox;
        const isSelected = feature.getId() === selectedShapeIdRef.current;
        const baseStyle = new Style({
          fill: new Fill({ color: palette.fill }),
          stroke: new Stroke({ color: palette.stroke, width: isSelected ? 4 : 2 }),
        });
        if (!isSelected) return baseStyle;
        // Selection halo (29-UI-SPEC.md): inner white halo over the per-type stroke.
        // Returning Style[] layers strokes — OL paints in order.
        const haloStyle = new Style({
          stroke: new Stroke({ color: "rgba(255,255,255,0.6)", width: 1 }),
        });
        return [baseStyle, haloStyle];
      },
```

Step 3 — Add the selectedShapeIdRef sync useEffect. Place near the drawModeRef sync effect (from Plan 01):
```typescript
  // ── Phase 29 (SHAPE-V15-04): selectedShapeIdRef mirror + style re-render ─
  // Updates the ref so the VectorLayer style function reads current selection imperatively.
  // Calls vectorLayer.changed() to force a style re-evaluation across all features
  // (the style function is invoked on every layer.changed()).
  useEffect(() => {
    selectedShapeIdRef.current = selectedShapeId;
    vectorLayerRef.current?.changed();
  }, [selectedShapeId]);
```

Step 4 — Add the selection-click useEffect. Place AFTER Effect 8 (Plan 04) and BEFORE the JSX block. This is a NEW useEffect — a SECOND singleclick listener on the map (Pitfall 9 — coexists with Effect 6's info listener; both fire on every click; mode-guards keep them orthogonal):
```typescript
  // ── Phase 29 (SHAPE-V15-04): selection-click listener ────────────────────
  // Mode-gated to bbox/lasso/circle (NOT info — would conflict with v1.4 popup;
  // NOT pan — Pan has no shape-interaction surface).
  // This is a SECOND singleclick listener on the map. Both this and Effect 6's
  // info listener fire on every click. The mode-guards keep them orthogonal:
  // - Info mode: Effect 6 fan-out fires; this listener short-circuits via deps gate.
  // - Bbox/Lasso/Circle: Effect 6 short-circuits via V15-P-01 mode-guard (Plan 01);
  //   this listener handles selection.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (drawMode !== "bbox" && drawMode !== "lasso" && drawMode !== "circle") return;

    const handler = (event: { pixel: [number, number] }) => {
      if (!mountedRef.current) return;
      let hitId: string | null = null;
      map.forEachFeatureAtPixel(
        event.pixel,
        (feature) => {
          const id = feature.getId();
          if (typeof id === "string") { hitId = id; return true; }
          return false;
        },
        { layerFilter: (l) => l === vectorLayerRef.current },
      );
      setSelectedShapeId(hitId); // null clears (empty area click)
    };
    map.on("singleclick", handler as never);
    return () => {
      map.un("singleclick", handler as never);
    };
  }, [drawMode]);
```

Step 5 — Add the Delete keydown useEffect:
```typescript
  // ── Phase 29 (SHAPE-V15-04): Delete keydown — removes selected shape ────
  // Mode-gated to draw modes (NOT info — would interfere with form inputs that
  // bind Backspace; NOT pan). Silent no-op when no selection.
  useEffect(() => {
    if (drawMode !== "bbox" && drawMode !== "lasso" && drawMode !== "circle") return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const id = selectedShapeIdRef.current;
      if (!id) return; // silent no-op (29-CONTEXT.md lock)
      useSpatialFilterStore.getState().removeShape(id);
      setSelectedShapeId(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [drawMode]);
```

Step 6 — Add the selection-clear-on-mode-switch useEffect:
```typescript
  // ── Phase 29 (SHAPE-V15-04): clear selection when switching to non-draw mode ──
  // 29-CONTEXT.md: "Selection cleared automatically when switching to Info/Pan mode."
  // Switching between draw modes (bbox↔lasso↔circle) PRESERVES selection.
  useEffect(() => {
    if (drawMode === "pan" || drawMode === "info") {
      setSelectedShapeId(null);
    }
  }, [drawMode]);
```

Step 7 — Add the selection-clear-on-shape-removed useEffect. Place near the other selection effects:
```typescript
  // ── Phase 29 (SHAPE-V15-04): clear dangling selection ────────────────────
  // If the selected shape is removed by ANY path (Delete, clearAll, future chip×
  // from Phase 30), selectedShapeId would otherwise hold a stale id. Reconcile
  // to null on every shapes-list change.
  useEffect(() => {
    const id = selectedShapeIdRef.current;
    if (id === null) return;
    const shapes = useSpatialFilterStore.getState().shapes;
    if (!shapes.some((s) => s.id === id)) {
      setSelectedShapeId(null);
    }
    // Reads via ref to avoid making selectedShapeId itself a dep (would loop).
    // Dep on shapesKey ensures the check runs on every shape mutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapesKey]);
```

Step 8 — Add the test block to MapChartRenderer.spec.tsx with the S1-S5, V1-V3, C1-C4, D1-D5, X1-X2, E1 tests. Mirror Plan 03/04 mock patterns. Use the existing test seam (data-testid="draw-mode-current" from Plan 01, or similar) to drive drawMode changes; expose selectedShapeId via another test seam if needed (e.g., a `data-testid="selected-shape-id"` element rendering the current selection).

For the singleclick + forEachFeatureAtPixel mock: extend the OL Map mock so `map.forEachFeatureAtPixel(pixel, callback, options)` invokes the callback with a synthetic feature (looking up the test's expected hit). The pattern is similar to Plan 03's V14 cross-map test.

Step 9 — Run `cd kinetica_bi && npx vitest run` → full suite green. Run `npx tsc --noEmit` → 0 errors.

Step 10 — Commit: `feat(29-05): shape selection + Delete keydown + selection visual (SHAPE-V15-04)`.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/charts/MapChartRenderer.spec.tsx 2>&1 | tail -15</automated>
  </verify>
  <acceptance_criteria>
    - `grep -n 'const \[selectedShapeId, setSelectedShapeId\] = useState<string \| null>' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns exactly 1 line
    - `grep -n 'const selectedShapeIdRef = useRef<string \| null>' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns exactly 1 line
    - `grep -n 'selectedShapeIdRef.current = selectedShapeId' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least 1 line
    - `grep -n 'vectorLayerRef.current?.changed()' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least 1 line (forces style re-render on selection change)
    - `grep -n 'width: isSelected ? 4 : 2' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns exactly 1 line (style function updated)
    - `grep -n 'rgba(255,255,255,0.6)' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least 1 line (halo stroke)
    - `grep -n 'forEachFeatureAtPixel' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least 1 line (selection-click hit-test)
    - `grep -n 'layerFilter: (l) => l === vectorLayerRef.current' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns exactly 1 line (only hit shapes, not WMS layers)
    - `grep -n 'e.key !== "Delete" && e.key !== "Backspace"' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least 1 line (Delete/Backspace handler)
    - `grep -n 'removeShape(id)' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least 1 line
    - `grep -nE 'drawMode === "pan" \|\| drawMode === "info"' kinetica_bi/src/components/charts/MapChartRenderer.tsx | wc -l` returns at least 1 (selection-clear-on-mode-switch)
    - `grep -n 'shapes.some((s) => s.id === id)' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least 1 line (dangling selection reconcile)
    - `cd kinetica_bi && npx vitest run` exits 0 (full suite green)
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>
    Selection + Delete works end-to-end: clicking a shape in a draw mode highlights it (4px outline + white halo); Delete/Backspace removes it; switching to Info/Pan auto-clears selection; ESC mid-flight also clears (via mode-switch effect); dangling selection IDs are reconciled on every store mutation. Phase 29 is feature-complete. Plan 30 can now build the materialize trigger + FilterBar chips on top of the working spatial filter store + draw UX.
  </done>
</task>

</tasks>

<verification>
**Manual verification (end-to-end final acceptance):**
1. `cd kinetica_bi && npm run dev` — dashboard with 2 map widgets
2. Click Bbox; draw a rectangle — shape commits, appears on both maps with blue fill + measurement pill
3. Click Lasso; freehand-draw a polygon — green fill + area pill; cross-map visible
4. Click Circle; click-drag — orange circle approximation + radius pill
5. While in Lasso mode (or any draw mode), click on the bbox shape → its outline thickens to 4px + a white halo appears (selection visual)
6. Press Delete → bbox disappears from BOTH maps; selection state clears
7. Click another shape → it gets selected. Switch to Info mode → selection visual disappears (auto-clear). Click on the same shape in Info mode → info popup tries to fan-out (regression check — V15-P-01 mode-guard correctly lets Info through; no shape selection)
8. Switch back to Bbox mode → previously-selected shape no longer highlighted (cleared on Info entry). Click it → selects again
9. Switch from Bbox to Lasso → selection PRESERVED (29-CONTEXT.md lock)
10. Press ESC mid-draw (start drawing a circle, then ESC) → draw aborts, mode auto-restores to Info, any prior selection clears
11. Click Trash icon → all shapes removed; trash hides

**Automated verification:**
- `cd kinetica_bi && npx vitest run` — full suite green; new SHAPE-V15-04 tests all pass
- `cd kinetica_bi && npx tsc --noEmit` — 0 errors

**Goal-backward verification — all 5 ROADMAP success criteria met:**
- SC1 (mode-guard FIRST): Plan 01 ✓
- SC2 (toolbar with 5 mode buttons + trash): Plans 02 + 03 ✓
- SC3 (drawing produces store-committed shapes with EPSG:4326 WKT; degenerate rejected; lasso simplified; ESC aborts): Plan 04 ✓
- SC4 (committed shapes render across all maps with persistent measurement labels): Plan 03 ✓
- SC5 (live tooltip during draw + click-shape+Delete removal mode-gated to draw modes): Plans 04 + 05 ✓
</verification>

<success_criteria>
1. `selectedShapeId` + `selectedShapeIdRef` mirror declared in MapChartRenderer
2. VectorLayer style function reads `selectedShapeIdRef.current` — selected shapes render with 4px stroke + inner white halo (1px rgba(255,255,255,0.6))
3. Singleclick selection mode-gated to bbox/lasso/circle only; uses `forEachFeatureAtPixel` with `layerFilter` constraining to vectorLayer
4. Delete/Backspace keydown removes selected shape via store; silent no-op when no selection
5. Switching to Info or Pan auto-clears selection; switching between draw modes preserves selection
6. Dangling selection ids are auto-reconciled on every `shapesKey` change (handles clearAll, future chip × in Phase 30, any other external removal)
7. Full vitest suite green; tsc clean
8. Manual UAT (all 11 steps in <verification>) passes
9. All 5 ROADMAP success criteria for Phase 29 satisfied
</success_criteria>

<output>
After completion, create `.planning/phases/29-draw-and-shape/29-05-SUMMARY.md` documenting:
- Final list of all effects added in Phase 29 (Plans 01-05) with line numbers in MapChartRenderer.tsx — gives Phase 30 / 31 a quick map
- Confirmation that the goal-backward must_haves at the phase level (all 5 ROADMAP criteria) are met
- Any tradeoffs in the selection visual (halo vs lighten — research suggested either is acceptable; document which was chosen)
- Notes for Phase 30: where to find the spatialFilterVersion read site (for materialize-trigger dep array extension) and where to find the addShape/removeShape call sites (for chip × wire-up parity)
</output>
