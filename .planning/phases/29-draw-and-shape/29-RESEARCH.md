# Phase 29: draw-and-shape — Research

**Researched:** 2026-05-12
**Domain:** OpenLayers 10 Draw interactions + measurement (`ol/sphere`) + WKT serialization + cross-map vector overlay + per-map React toolbar with Font Awesome icons + Effect 6 mode-guard for v1.4 singleclick coexistence
**Confidence:** HIGH

## Summary

Phase 29 binds a per-map drawing UX onto the existing `MapChartRenderer.tsx` (Effects 1–6, mountedRef + sourceListenerCleanupRef + 4-store reset block). The work decomposes cleanly into three orthogonal sub-domains, each well-precedented:

1. **OL Draw interaction lifecycle** — `new Draw({ type, geometryFunction, freehand })` mounted per active mode in a new Effect 8 keyed on `drawMode`; `drawend` extracts geometry, validates non-degenerate, simplifies if lasso, computes measurement via `ol/sphere`, serializes to EPSG:4326 WKT via `ol/format/WKT`, commits via `useSpatialFilterStore.addShape({ type, wkt, measurement })`.
2. **Cross-map vector sync** — `VectorLayer + VectorSource` mounted in Effect 1; new Effect 7 subscribes to `useSpatialFilterStore` via primitive `shapesKey` selector (PITFALL S-02 lock) and reconciles store shapes → OL features atomically (`source.clear()` + `source.addFeatures(...)`). Per-shape persistent measurement label via `ol/Overlay` (HTML pill DOM, lifecycle-managed in the same Effect).
3. **Mode-guard FIRST-CODE-CHANGE** — Effect 6 (line 829, top of async `handler`) gains `const drawMode = ... ; if (drawMode !== 'pan' && drawMode !== 'info') return;` reading via component-local `useRef<DrawMode>` mirror to avoid stale closure WITHOUT adding `drawMode` to the Effect 6 deps array (which would tear down/recreate the singleclick listener on every mode change).

**Primary recommendation:** Implement in this strict order — (A) Effect 6 mode-guard + cursor effect + mode state machinery FIRST (V15-P-01 mitigation; STATE.md FIRST-CODE-CHANGE lock), (B) `MapDrawToolbar.tsx` + Font Awesome deps + props wiring, (C) Effect 1 VectorLayer/VectorSource setup + Effect 7 shape sync + persistent-label overlays, (D) Effect 8 Draw interaction mount + live tooltip + drawend handler (validate → simplify → measure → WKT → store), (E) selection state + click-shape + Delete keydown, (F) MapChartRenderer.spec.tsx extensions + MapDrawToolbar.spec.tsx.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Toolbar layout & visuals (MapDrawToolbar)**

- **Position:** Top-left, flush against the bottom edge of the existing OL zoom (+/-) control so the operator sees one continuous vertical bar (zoom-in → zoom-out → Pan → Info → Bbox → Lasso → Circle → Trash). The OL zoom control itself is NOT modified — `MapDrawToolbar` is the locked React `<div>` overlay, positioned via CSS to abut the zoom control. Anti-pattern lock from STATE.md ("Toolbar as React overlay, NOT ol/control/Control") is preserved verbatim.
- **Orientation:** Vertical column. 6 buttons stacked top-to-bottom (Pan → Info → Bbox → Lasso → Circle → Trash). The Trash button is hidden when `shapes.length === 0` (locked by DRAW-V15-01).
- **Active-mode styling:** Filled accent background + white icon for the currently-active mode button. Highest contrast / hardest to miss. Inactive buttons use neutral chrome (transparent fill, dark icon) matching the OL zoom control's idle styling.
- **Icon library:** **Font Awesome** via `@fortawesome/react-fontawesome` + `@fortawesome/fontawesome-svg-core` + `@fortawesome/free-solid-svg-icons` (solid variant; matches the filled-accent active state). New dependency added to `kinetica_bi/package.json` — the codebase had no icon library before this phase.
  - Pan: `faHand`
  - Info: `faCircleInfo`
  - Bbox: `faVectorSquare`
  - Lasso: `faDrawPolygon`
  - Circle: `faCircle`
  - Trash (Clear all): `faTrash`
  - Tree-shake friendly per-icon imports (NOT the full `fontawesome-free` bundle).
- **CSS pointer-events lock:** Container `pointer-events: none`, individual buttons `pointer-events: auto`. Prevents accidental OL event swallowing on the gaps between buttons (STATE.md v1.5 architecture lock).

**Shape colors & selection visual**

- **Per-type fixed color palette:** Bbox = blue (e.g., `#2563eb`), Lasso = green (e.g., `#16a34a`), Circle = orange (e.g., `#ea580c`). Same shape type always looks the same across maps and across sessions.
- **Fill / outline:** Fill = ~10% opacity of the per-type color; Outline = 2px solid per-type color. Overlapping shape fills are additive (default OL behavior).
- **Selection visual:** Selected shape outline 2px → 4px AND brightens (thin inner white halo stroke OR lighten by ~30%). Fill opacity unchanged. Selection is single-shape only.
- **Persistent measurement label styling:** Neutral white text on dark semi-transparent rounded pill, consistent across all shape types. Mirrors Google Maps measurement label convention.

**Measurement labels & precision (live tooltip + persistent label)**

- **Decimal precision:** Always 1 decimal. Examples: `2.5 km`, `5.0 km × 3.0 km`, `12.4 km²`.
- **Format:** Tight number formatting, space between number and unit (`2.5 km` not `2.5km`). No thousand separator. Bbox format: `{W} × {H}` (width first, height second).
- **km / m switchover (DRAW-V15-05):** Below 1 km → meters with 0 decimals (e.g., `750 m`); ≥ 1 km → `X.X km`. Same rule applies to area: below 1 km² → `XXX m²` (0 decimals); ≥ 1 km² → `X.X km²`. Meter precision is Claude's discretion (0 or 1 decimal acceptable; recommend 0).
- **Live tooltip during draw:** Identical styling to the persistent post-commit label — same dark pill, same white text, same font. Single CSS class for both.
- **Persistent label anchor (SHAPE-V15-03):** `ol/Overlay` anchored to geometry centroid; OL handles repositioning on pan/zoom automatically. Per-shape `Overlay` instance is cleaned up when the shape is removed from the store.

**Mode & selection behavior**

- **Default starting mode on map mount:** `Info`. `previousMode` initializes to Info.
- **Auto-restore on drawend (DRAW-V15-02):** `drawend` event flips mode back to `previousMode` (typically Info). Same mechanism for committed-draw and ESC-abort.
- **Re-clicking the already-active mode button:** No-op.
- **Trash icon ("Clear all spatial filters"):** Immediate — `clearAll()` fires, `shapeCounter` resets to 0. NO confirmation dialog.
- **Selection rules (single-select model):** Only one shape selected at a time. Selection click is disabled in Info mode AND in Pan mode (SHAPE-V15-04). Selection cleared automatically when switching to Info/Pan mode or hitting ESC. Selection PRESERVED across switches between draw modes. Delete with nothing selected = silent no-op.

### Claude's Discretion

- Exact hex values for the per-type palette — pick hexes that meet WCAG 3:1 contrast against typical Esri / OSM basemap tiles.
- Exact CSS class names + Font Awesome import strategy.
- Meter precision for sub-km measurements — 0 decimals (`750 m`) or 1 decimal (`750.5 m`); both acceptable. Operator's mental model is "round numbers" — 0 decimals is the default recommendation.
- Where the trash button visually appears within the toolbar column — most natural is bottom (after the 5 mode buttons), separated by a slight visual gap.
- Exact selection-clear behavior on store mutation — when `removeShape(id)` fires for the currently-selected shape, selection clears implicitly because the shape no longer exists.
- Keyboard shortcuts for mode-switching (e.g., `P`/`I`/`B`/`L`/`C`) — NOT required.
- aria-pressed / aria-label on toolbar buttons — required for accessibility but exact wording is planner's call.
- Toast wording for "Shape too small" — locked to `"Shape too small — try again"` by DRAW-V15-06; toast `kind` is planner's call.
- Whether `selectedShapeId` lives in `useState` or in a `useRef` — `useState` recommended since it triggers re-render for the selection visual update.

### Deferred Ideas (OUT OF SCOPE)

- Keyboard shortcuts for mode switching (`P` / `I` / `B` / `L` / `C` / `T`) — NOT in REQUIREMENTS.
- Undo / redo for shape add/remove — Out of scope; Phase 27's store has no undo stack.
- Multi-select with shift-click + bulk delete — Single-select is the v1.5 lock.
- Persistent shapes across sessions — Phase 27 is session-only by lock.
- Hover-tooltip on toolbar buttons (mouseover labels) — Standard browser `title=` acceptable; richer custom tooltip deferred.
- Phase 30 materialize trigger — Phase 29 only writes to the store; Phase 30 wires the trigger.
- Phase 30 FilterBar spatial chips — Chip × removal path lives in `FilterBar.tsx`, not in MapDrawToolbar.
- Phase 31 UAT — End-to-end operator UAT lives in Phase 31.
- WKB-mode drawing — Drawing UX itself is mode-agnostic. WKB un-greying tied to TD-V14-WKB-SPIKE.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DRAW-V15-01 | `MapDrawToolbar.tsx` — React overlay, 5 mode icons (Pan/Info/Bbox/Lasso/Circle) + Trash visible only when `shapes.length > 0` | §"MapDrawToolbar Component" + Font Awesome integration §"Don't Hand-Roll" |
| DRAW-V15-02 | Mode local state via `useState`; cursor change via `map.getViewport().style.cursor`; `previousMode` for Info auto-restore | §"Cursor + Mode State Machinery" |
| DRAW-V15-03 | Effect 6 mode-guard as FIRST LINE (V15-P-01 mitigation); mode read via component-local ref to avoid stale closure WITHOUT widening Effect 6 deps | §"Effect 6 Mode-Guard" + Pitfall §"Stale-closure when adding to existing useEffect" |
| DRAW-V15-04 | OL Draw mounted per mode: bbox=`{type:'Circle',geometryFunction:createBox()}`; lasso=`{type:'Polygon',freehand:true}`; circle=`{type:'Circle',geometryFunction:createRegularPolygon(64)}`; ESC → `abortDrawing()` + restore previousMode | §"OL Draw Configuration Matrix" + §"ESC Keydown Abort Pattern" |
| DRAW-V15-05 | Live tooltip follows cursor during draw; measurements via `ol/sphere.getDistance` / `getArea` only (NEVER raw EPSG:3857 — V15-P-04 lock) | §"Live Measurement Tooltip" + §"ol/sphere Measurement API" |
| DRAW-V15-06 | `drawend` → WKT EPSG:4326 via `ol/format/WKT.writeGeometry`; reject <10 px² with toast "Shape too small — try again"; Douglas-Peucker on lasso via `geometry.simplify(view.getResolution() * 2)` | §"drawend Pipeline" + §"WKT Serialization Pattern" |
| SHAPE-V15-01 | `VectorLayer` + `VectorSource` in Effect 1; semi-transparent fill, 2px solid outline, color-coded; subscribed via primitive `shapesKey` selector (PITFALL S-02 mitigation) | §"VectorLayer Setup + Style Function" |
| SHAPE-V15-02 | Effect 7 syncs store shapes → OL features; clears stale features atomically before re-adding | §"Effect 7 Shape Sync" |
| SHAPE-V15-03 | Persistent measurement label per shape via `ol/Overlay` anchored to centroid; OL handles pan/zoom repositioning automatically | §"Per-Shape Overlay Lifecycle" |
| SHAPE-V15-04 | Click on shape selects (4px outline); Delete keydown removes; mode-gated to draw modes only; extends mountedRef + source-listener cleanup pattern to new Effects 7/8 + VectorSource listeners | §"Selection + Delete" + §"VectorSource Listener Cleanup" |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ol` (OpenLayers) | 10.9.0 (already installed) | Draw interaction, sphere measurements, WKT, Overlay, VectorLayer/Source | The codebase's existing map stack; no alternative is feasible without rebuilding `MapChartRenderer.tsx` |
| `zustand` | 4.5.2 (already installed) | `useSpatialFilterStore` (Phase 27) + `useToastStore` (existing) | Established pattern; v1.5 already wired |
| `@fortawesome/react-fontawesome` | 3.3.1 (verified `npm view`, 2026-05-12) | `<FontAwesomeIcon icon={...} />` React component | Operator override locks Font Awesome over inline SVG (CONTEXT.md). Per-icon imports are tree-shake friendly. |
| `@fortawesome/fontawesome-svg-core` | 7.2.0 (verified) | Required peer dependency for the React component | Documented as a required core utility package |
| `@fortawesome/free-solid-svg-icons` | 7.2.0 (verified) | Source of `faHand`, `faCircleInfo`, `faVectorSquare`, `faDrawPolygon`, `faCircle`, `faTrash` (solid variant — matches filled-accent active state) | Operator locked solid variant |

**Note:** `@fortawesome/fontawesome-svg-core` and `@fortawesome/free-solid-svg-icons` recently jumped from v6 → v7. v3.3.1 of `react-fontawesome` is compatible with v7 core. Confirm peer-deps during install (`npm install` should resolve cleanly; flag any peer warning). Versions verified via `npm view <pkg> version` on 2026-05-12.

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `ol/interaction/Draw` (named exports: `Draw`, `createBox`, `createRegularPolygon`) | from `ol` | Drawing primitives + helpers | Effect 8 mount per draw mode |
| `ol/sphere` (named exports: `getDistance`, `getArea`) | from `ol` | Ellipsoidal ground measurements | All measurement computations (V15-P-04 lock) |
| `ol/format/WKT` (default export `WKT` class) | from `ol` | `writeGeometry` / `readGeometry` with projection transform | `drawend` (write WGS84 WKT) + Effect 7 (read WKT back to EPSG:3857 features) |
| `ol/Overlay` (default export) | from `ol` | Per-shape persistent measurement labels + live tooltip | Effect 7 (one Overlay per shape) + Effect 8 drawstart (one tooltip overlay during draw) |
| `ol/layer/Vector` (default export `VectorLayer`) | from `ol` | The shape overlay layer | Effect 1 mount; one per map widget instance |
| `ol/source/Vector` (default export `VectorSource`) | from `ol` | Backing store for shape features | Effect 1 paired with VectorLayer |
| `ol/style/{Style,Fill,Stroke,Text,Circle}` | from `ol` | Per-feature shape rendering style | VectorLayer style function |
| `ol/proj` (named export `transform`) | from `ol` | EPSG:3857 ↔ WGS84 (manual transforms for live measurement; WKT writer handles serialization transform internally) | drawstart `change` handler, ESC handler |
| `ol/geom/Polygon` (default export) — type for cast | from `ol` | `getInteriorPoint()` for centroid; `getCoordinates()` for vertex inspection | Per-shape Overlay positioning + lasso vertex-count cap |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `ol/Overlay` for measurement labels | `Style.text` on the feature (PITFALL V15-P-11 Approach A) | Style.text avoids per-shape lifecycle but text rendering is in OL canvas (no CSS for the locked "dark pill" styling). **Reject** — CONTEXT.md locks "dark semi-transparent rounded pill" which requires HTML/CSS → must use `ol/Overlay`. PITFALL accepts this. |
| Per-icon imports `import { faHand } from '@fortawesome/free-solid-svg-icons'` | Subpath imports `import { faHand } from '@fortawesome/free-solid-svg-icons/faHand'` | Per the official Font Awesome React docs, subpath imports are NOT documented/supported. The named import pattern from the package root + a modern bundler (Vite 5 here) already tree-shakes named imports. **Use named import from package root** — matches documented canonical pattern. |
| `feature.set('selected', true)` for selection visual | React-state-only with style function reading via closure | Style function fires on every render frame; reading `selectedShapeId` from React state via closure means Effect 7 must run on every selection change to re-set styles. **Use:** keep `selectedShapeId` in `useState`; the style function is a closure that reads it through a ref mirror (`selectedShapeIdRef`) so Effect 7 does not need a selection dep — but force a `vectorLayer.changed()` call on selection change to trigger re-render. Simplest robust pattern. |

**Installation:**

```bash
cd kinetica_bi && npm install \
  @fortawesome/react-fontawesome@^3.3.1 \
  @fortawesome/fontawesome-svg-core@^7.2.0 \
  @fortawesome/free-solid-svg-icons@^7.2.0
```

Confirm `package-lock.json` and `node_modules` ship in the same commit per `kinetica_bi/CLAUDE.md` convention (if present); otherwise the standard `npm install` workflow applies. Vite will tree-shake unused icons automatically when only `faHand`/`faCircleInfo`/`faVectorSquare`/`faDrawPolygon`/`faCircle`/`faTrash` are named-imported.

## Architecture Patterns

### Recommended Project Structure

```
kinetica_bi/src/
├── components/
│   └── charts/
│       ├── MapChartRenderer.tsx        # MAJOR EDITS — Effects 1/6 modified; new Effects 7/8; new state/refs
│       ├── MapChartRenderer.spec.tsx   # EXTENDED — new tests for mode-guard, Effect 7 sync, Effect 8 lifecycle, click+Delete
│       ├── MapDrawToolbar.tsx          # NEW — React overlay component
│       └── MapDrawToolbar.spec.tsx     # NEW — Vitest spec
└── lib/
    ├── shapeDraw.ts                    # NEW (optional) — pure helpers: buildDrawInteraction(mode, source), computeMeasurement(feature, view), wktFromFeature(feature)
    └── shapeDraw.spec.ts               # NEW (optional) — covers pure helpers
```

The "pure helpers" extraction is optional but **recommended** — keeps `MapChartRenderer.tsx` from growing past ~1300 lines (currently 1040), and the helpers are unit-testable without mocking the full OL Map. The planner can collapse into MapChartRenderer if desired; PITFALLS.md does not lock the split either way.

### Pattern 1: OL Draw Configuration Matrix

**What:** For each shape type, the exact `new Draw({...})` constructor.
**When to use:** Inside Effect 8's mount branch, switching on `drawMode`.

```typescript
// Source: https://openlayers.org/en/latest/examples/draw-shapes.html
//         https://openlayers.org/en/latest/apidoc/module-ol_interaction_Draw-Draw.html
import Draw, { createBox, createRegularPolygon } from 'ol/interaction/Draw.js';
import type { Type as GeometryType } from 'ol/geom/Geometry.js'; // string literal type alias

type DrawMode = 'pan' | 'info' | 'bbox' | 'lasso' | 'circle';

function buildDrawInteraction(mode: DrawMode, source: VectorSource): Draw | null {
  switch (mode) {
    case 'bbox':
      // OL convention: type='Circle' + geometryFunction=createBox() yields a 4-corner Polygon
      // produced on the click-drag (NOT a Circle geometry). Verified in draw-shapes example.
      return new Draw({
        source,
        type: 'Circle',                  // <- 'Circle' is required when geometryFunction overrides the geom
        geometryFunction: createBox(),
      });
    case 'circle':
      // createRegularPolygon(64) yields a 64-vertex Polygon (NOT an ol/geom/Circle).
      // This sidesteps the WKT-Circle-unsupported issue — the geometry is already a Polygon at drawend.
      // Operator-locked vertex count: 64 (CONTEXT.md / PITFALLS V15-P-14 / common GIS convention).
      return new Draw({
        source,
        type: 'Circle',
        geometryFunction: createRegularPolygon(64),
      });
    case 'lasso':
      // Freehand polygon — pointermove records every vertex. Simplify at drawend (V15-P-03).
      return new Draw({
        source,
        type: 'Polygon',
        freehand: true,
      });
    case 'pan':
    case 'info':
      return null; // no interaction
  }
}
```

**Critical facts:**
- `createBox` and `createRegularPolygon` are **named exports** from `ol/interaction/Draw.js` (same module as the default `Draw` class). Confirmed via the official OL draw-shapes example.
- For both `createBox()` and `createRegularPolygon(N)`, the `type` option **must be `'Circle'`** — the geometryFunction overrides the produced geometry to a Polygon. This is the canonical OL pattern.
- The resulting geometry at `drawend` is a **Polygon** in all three cases. `feature.getGeometry()` returns a `Polygon` for bbox + lasso + circle (despite the constructor `type: 'Circle'` for bbox/circle — that's only the click-drag mode). This is why WKT serialization works uniformly: no `ol/geom/Circle` to handle.
- `stopClick: true` is intentionally **NOT** set on the Draw constructor — it is unreliable (V15-P-01 PITFALLS evidence). The mode-guard in Effect 6 is the correct mitigation.

### Pattern 2: ESC Keydown Abort Pattern

**What:** Cancel an in-progress draw without committing.
**When to use:** Window-level `keydown` listener registered in the same Effect 8 (or in a sibling Effect keyed on `drawMode`).

```typescript
// Source: https://openlayers.org/en/latest/apidoc/module-ol_interaction_Draw-Draw.html
// abortDrawing() is a PUBLIC method on Draw in OL 10.9.0 (was historically private as
// abortDrawing_; promoted to public per OL changelog). Cancels the in-progress sketch
// feature without firing drawend.

useEffect(() => {
  // Only relevant during a draw mode
  if (drawMode === 'pan' || drawMode === 'info') return;
  const handler = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    drawRef.current?.abortDrawing();         // public OL method; clears the sketch
    setDrawMode(previousModeRef.current);    // restore Info (DRAW-V15-02 auto-restore)
    setSelectedShapeId(null);                // CONTEXT.md: ESC also clears selection
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, [drawMode]);
```

**Listener placement:** Window-level (NOT map-element-level). The map element only receives keydown when focused; the toolbar buttons typically capture focus, so window-level is more reliable. Standard pattern in OL community examples.

**Cleanup:** Window listener removed on mode-change AND unmount (the Effect deps + cleanup return handles both). Per V15-P-15 lock, the Draw interaction itself is removed in the SAME Effect's cleanup or a sibling — see Pattern 4.

### Pattern 3: drawend Pipeline

**What:** The exact sequence from `drawend` event → committed shape in the Zustand store.

```typescript
// Inside Effect 8 mount branch, after creating `draw` interaction:
draw.on('drawend', (event) => {
  // The feature is added to the VectorSource automatically by Draw BEFORE drawend fires.
  // We must either commit it via setStyle/store-sync or removeFeature on rejection.
  if (!mountedRef.current) return;          // GAP-24-06-A pattern — guard async path

  const feature = event.feature;
  const geom = feature.getGeometry() as Polygon; // bbox/lasso/circle all yield Polygon

  // (1) Reject degenerate (V15-P-13). Extent in EPSG:3857 — area threshold is screen-px-equivalent.
  //     "<10 screen px²" interpreted as: extent width OR height < 10 × view.getResolution()
  //     (resolution = meters/px in 3857). Conservative: reject if extent area < (10 * res)^2.
  const view = mapRef.current!.getView();
  const resolution = view.getResolution() ?? 1;
  const extent = geom.getExtent();
  const w3857 = extent[2] - extent[0];
  const h3857 = extent[3] - extent[1];
  const minPx = 10;
  if (w3857 < minPx * resolution || h3857 < minPx * resolution) {
    source.removeFeature(feature);                       // remove the auto-added feature
    useToastStore.getState().showToast('Shape too small — try again', 'info');
    // ^ Toast kind: 'info'. NOTE: toastStore exports `permission | info | error` ONLY (no
    // 'warning' kind exists today). CONTEXT.md recommended 'warning'; planner must either
    // use 'info' (acceptable per locked store) OR extend ToastKind union. Recommend 'info'
    // — no scope-creep into toast.ts; the message text "Shape too small — try again" is
    // the locked wording per DRAW-V15-06.
    setDrawMode(previousModeRef.current);                // auto-restore Info
    return;
  }

  // (2) Lasso simplification (V15-P-03). Bbox/circle are already vertex-bounded (4 / 64).
  //     `geometry.simplify(tolerance)` returns a NEW geometry (does NOT mutate). Tolerance
  //     is in map units (EPSG:3857 meters at this zoom). Use resolution * 2 (PITFALLS lock).
  //     For Polygons, OL uses topology-preserving quantization; for LineStrings, Douglas-Peucker.
  let finalGeom: Polygon = geom;
  if (drawMode === 'lasso') {
    finalGeom = geom.simplify(resolution * 2) as Polygon;
    // Optional 150-vertex hard cap (V15-P-03 stretch); CONTEXT.md does NOT require this — recommend SKIP for v1.5.
  }

  // (3) Compute measurement (DRAW-V15-05) — always via ol/sphere; NEVER raw EPSG:3857.
  const measurement = computeMeasurement(drawMode, finalGeom, view);

  // (4) Serialize to WKT in EPSG:4326. The WKT writer handles the projection transform
  //     internally when both dataProjection + featureProjection are provided — NO manual
  //     clone+transform needed. Cleaner than the v1.4 transformExtent pattern.
  //     Source: https://openlayers.org/en/latest/apidoc/module-ol_format_WKT-WKT.html
  const wktFormat = new WKT();
  const wkt = wktFormat.writeGeometry(finalGeom, {
    dataProjection: 'EPSG:4326',           // output projection (WGS84 — Kinetica expects this)
    featureProjection: 'EPSG:3857',        // current geom projection (Web Mercator)
  });

  // (5) Apply simplified geometry back to feature (so the VectorSource holds the simplified version).
  feature.setGeometry(finalGeom);

  // (6) Commit to Zustand store. addShape synthesizes id/label/addedAt internally.
  //     Phase 27 contract: pass { type, wkt, measurement } only.
  useSpatialFilterStore.getState().addShape({
    type: drawMode,   // 'bbox' | 'lasso' | 'circle'
    wkt,
    measurement,
  });

  // (7) Auto-restore previous mode (DRAW-V15-02).
  setDrawMode(previousModeRef.current);

  // NOTE: do NOT manually add to vectorSource here — Effect 7 will reconcile from the store
  // on the next render (shapesKey change). HOWEVER the OL-added feature from Draw is already
  // in the source, which would cause a duplicate when Effect 7 adds the store-derived feature.
  // FIX: source.removeFeature(feature) right before addShape, so Effect 7's reconcile is the
  // only writer. Cleaner invariant: VectorSource state is a pure derivation of store state.
  source.removeFeature(feature);
});
```

**Critical detail (the duplicate-feature trap):** OL's `Draw` interaction adds the sketch feature to the configured `source` AT drawend, before the listener runs. If Effect 7 then re-adds a feature derived from the store, the source has TWO features for the same shape. The fix is to either (a) `removeFeature(feature)` at the end of the drawend handler so Effect 7 is the sole writer (recommended — preserves the "source is a pure derivation" invariant), or (b) tag the OL-added feature with the new shape's ID and skip it in Effect 7's reconcile. Recommend (a).

### Pattern 4: Effect 8 Draw Interaction Lifecycle (extends mountedRef pattern)

**What:** Mount/unmount the Draw interaction tied to `drawMode`.

```typescript
// New Effect 8 in MapChartRenderer.tsx — placed after Effect 7 (shape sync).
useEffect(() => {
  const map = mapRef.current;
  if (!map) return;
  if (drawMode === 'pan' || drawMode === 'info') return;

  const source = vectorSourceRef.current;
  if (!source) return;

  const draw = buildDrawInteraction(drawMode, source);
  if (!draw) return;
  drawRef.current = draw;

  // drawstart: create live measurement tooltip overlay + geometry change listener
  let tipOverlay: Overlay | null = null;
  let geomChangeKey: EventsKey | null = null;
  draw.on('drawstart', (event) => {
    if (!mountedRef.current) return;
    tipOverlay = createTipOverlay();           // local helper; returns an ol/Overlay
    map.addOverlay(tipOverlay);
    const sketchGeom = event.feature.getGeometry();
    // PITFALL V15-P-09: in-progress geometry stays in OL only — NO Zustand writes during pointermove.
    geomChangeKey = sketchGeom.on('change', () => {
      if (!mountedRef.current || !tipOverlay) return;
      const text = computeLiveMeasurement(drawMode, sketchGeom as Polygon, map.getView());
      (tipOverlay.getElement() as HTMLElement).textContent = text;
      // Position the tooltip at the geometry's last point (LineString) or interior point (Polygon).
      // For bbox/circle/lasso (all yield Polygon at drawend, but during draw the sketch may be
      // a LineString for lasso freehand pre-close — we position to the last coordinate.
      const tipCoord = pickTipCoord(sketchGeom);
      tipOverlay.setPosition(tipCoord);
    });
  });

  // drawend: clean up live tooltip, run the pipeline above
  draw.on('drawend', (event) => {
    if (geomChangeKey) { unByKey(geomChangeKey); geomChangeKey = null; }
    if (tipOverlay) { map.removeOverlay(tipOverlay); tipOverlay = null; }
    // ... drawend pipeline (Pattern 3) ...
  });

  map.addInteraction(draw);

  // Cleanup: fires on mode change AND unmount
  return () => {
    if (geomChangeKey) unByKey(geomChangeKey);
    if (tipOverlay) map.removeOverlay(tipOverlay);
    map.removeInteraction(draw);    // V15-P-15 lock
    drawRef.current = null;
  };
}, [drawMode]);
```

**Listener cleanup discipline (extends Phase 24-04 sourceListenerCleanupRef + Phase 24-06 mountedRef):**
- `draw.on('drawend', handler)` registered → Effect cleanup calls `map.removeInteraction(draw)`. Per OL docs, removing the interaction unsubscribes its internal event dispatch automatically. No need for `draw.un(...)` explicitly.
- The `sketchGeom.on('change', ...)` listener returns an `EventsKey` (OL type); unsubscribe via `unByKey(key)` from `ol/Observable` — pattern from the canonical measure example.
- The tip Overlay is removed via `map.removeOverlay(overlay)` in the same cleanup.
- The new VectorSource (Effect 1) has NO listeners attached in v1.5 by default — the planner does NOT need to extend `sourceListenerCleanupRef` for the new VectorSource UNLESS adding `source.on('addfeature', ...)` listeners (not needed; Effect 7 reconciles imperatively). If future work adds VectorSource listeners, mirror the Phase 24-04 per-source cleanup pattern.

### Pattern 5: Effect 7 Shape Sync (cross-map cross-render)

**What:** Reconcile `useSpatialFilterStore.shapes` → OL VectorSource features atomically. Also manages per-shape persistent measurement label Overlays.

```typescript
// New Effect 7 in MapChartRenderer.tsx — placed after Effect 6.
// PITFALL S-02 lock: primitive selector — joined IDs string. shapesKey() helper.
const shapesKey = useSpatialFilterStore((s) => s.shapes.map((sh) => sh.id).join('|'));

useEffect(() => {
  const map = mapRef.current;
  const source = vectorSourceRef.current;
  if (!map || !source) return;
  if (!mountedRef.current) return;

  // Atomic clear + re-add (SHAPE-V15-02 lock — avoids feature-id collision on edit).
  source.clear(true /* fast: skip removefeature events */);

  const shapes = useSpatialFilterStore.getState().shapes; // imperative read for non-primitive

  // Tear down stale per-shape overlays.
  for (const [id, overlay] of shapeOverlaysRef.current) {
    if (!shapes.some((s) => s.id === id)) {
      map.removeOverlay(overlay);
      shapeOverlaysRef.current.delete(id);
    }
  }

  const wktFormat = new WKT();
  for (const shape of shapes) {
    // Read WGS84 WKT back into an EPSG:3857 feature for rendering on the map.
    const geom = wktFormat.readGeometry(shape.wkt, {
      dataProjection: 'EPSG:4326',
      featureProjection: 'EPSG:3857',
    }) as Polygon;
    const feature = new Feature({ geometry: geom });
    feature.setId(shape.id);
    feature.set('shapeType', shape.type);    // read by style function for color palette
    source.addFeature(feature);

    // Per-shape persistent measurement label (SHAPE-V15-03).
    if (!shapeOverlaysRef.current.has(shape.id)) {
      const el = document.createElement('div');
      el.className = 'shape-measurement-label';  // dark pill style — locked CSS
      el.textContent = shape.measurement;
      const overlay = new Overlay({
        element: el,
        positioning: 'center-center',
        stopEvent: false,           // allow clicks to pass through to the canvas
      });
      map.addOverlay(overlay);
      shapeOverlaysRef.current.set(shape.id, overlay);
    } else {
      // Existing overlay — update text in case the measurement changed (won't in v1.5; defensive).
      const overlay = shapeOverlaysRef.current.get(shape.id)!;
      (overlay.getElement() as HTMLElement).textContent = shape.measurement;
    }
    // Position to polygon centroid.
    const centroid = geom.getInteriorPoint().getCoordinates() as [number, number, number];
    shapeOverlaysRef.current.get(shape.id)!.setPosition([centroid[0], centroid[1]]);
  }

  // No explicit return cleanup beyond Effect 1's per-map dispose (overlays cleared there).
}, [shapesKey]);
```

**`getInteriorPoint()` returns a `Point` geometry whose `getCoordinates()` is `[x, y, m]`** (XYM — the M is the length of the horizontal intersection). Truncate to `[x, y]` for `setPosition`.

**Effect 7 also handles the v1.4-style cleanup discipline:** the planner MUST add a `shapeOverlaysRef.current.clear()` + `for (const o of shapeOverlaysRef.current.values()) map.removeOverlay(o)` block to Effect 1's cleanup return alongside `imageLayersRef.current.clear()` etc. (mountedRef + sourceListenerCleanupRef pattern extension).

### Pattern 6: Effect 6 Mode-Guard (V15-P-01; FIRST-CODE-CHANGE lock)

**What:** Stop the singleclick info-popup from firing during draw modes.
**When to use:** As the very first line of the existing async `handler` function inside Effect 6 of `MapChartRenderer.tsx` (currently line 829).

```typescript
// Before (current Effect 6 lines 824-829):
useEffect(() => {
  const map = mapRef.current;
  if (!map) return;
  if (!getInfoEnabled(widgetConfig as MapWidgetConfig)) return;

  const handler = async (event: { coordinate: [number, number] }) => {
    if (eligibleLayers.length === 0) return;
    if (!mountedRef.current) return;                       // existing GAP-24-06-A guard
    // ... rest of handler ...
```

```typescript
// After (Phase 29 FIRST-CODE-CHANGE):
useEffect(() => {
  const map = mapRef.current;
  if (!map) return;
  if (!getInfoEnabled(widgetConfig as MapWidgetConfig)) return;

  const handler = async (event: { coordinate: [number, number] }) => {
    // PHASE 29 V15-P-01 MODE-GUARD — FIRST LINE. Reads via imperative store/ref to avoid
    // stale closure WITHOUT adding drawMode to deps (which would tear down/recreate the
    // singleclick listener on every mode change, racing the cleanup gate).
    const mode = drawModeRef.current;
    if (mode !== 'pan' && mode !== 'info') return;

    if (eligibleLayers.length === 0) return;
    if (!mountedRef.current) return;
    // ... rest of handler unchanged ...
```

**The stale-closure / imperative-read trick (critical):**

`drawMode` is **component-local `useState`** (CONTEXT.md lock), NOT in `useSpatialFilterStore`. The simplest read would be a closed-over `drawMode` value, but Effect 6's deps array is `[getInfoEnabled(widgetConfig), eligibleLayers, tables, widgetConfig]` (current line 975); adding `drawMode` would tear down/recreate the singleclick listener on every mode change. This causes two problems:
1. Wastes the cleanup gate (Effect 6 currently uses no mountedRef-style cleanup for the listener — `map.un('singleclick', handler)` is the cleanup).
2. The newly-mounted listener on the next render captures the new closure — but during the cleanup → re-mount gap, in-flight OL singleclick dispatches see no listener at all.

**The solution: a `drawModeRef` mirror.** Maintain `const drawModeRef = useRef<DrawMode>('info');` and a sibling effect that updates it on every `drawMode` state change:

```typescript
const [drawMode, setDrawMode] = useState<DrawMode>('info');
const drawModeRef = useRef<DrawMode>('info');
useEffect(() => { drawModeRef.current = drawMode; }, [drawMode]);
```

Effect 6 reads `drawModeRef.current` imperatively. The deps array does NOT widen. The listener registration is stable. No stale closure (the ref always reflects current state). This is the canonical Phase 24-06 mountedRef-style mirror pattern.

**Alternative considered:** Adding `drawMode` to `useSpatialFilterStore` and reading via `useSpatialFilterStore.getState().drawMode`. **Rejected per CONTEXT.md** — selection state is component-local. Mode is also a UI concern, not a domain/persistence concern. Component-local + ref mirror is the cleaner separation.

### Pattern 7: Cursor + Mode State Machinery (V15-P-02)

```typescript
// One useEffect, dep on drawMode. Mirrors PITFALLS V15-P-02 lock.
useEffect(() => {
  const viewport = mapRef.current?.getViewport();
  if (!viewport) return;
  const cursorMap: Record<DrawMode, string> = {
    pan: 'grab',
    info: '',           // default
    bbox: 'crosshair',
    lasso: 'crosshair',
    circle: 'crosshair',
  };
  viewport.style.cursor = cursorMap[drawMode] ?? '';
  return () => { viewport.style.cursor = ''; };  // covers mode-change + unmount
}, [drawMode]);
```

**previousMode tracking:**
```typescript
const previousModeRef = useRef<DrawMode>('info');
useEffect(() => {
  // Track only when entering a draw mode; on drawend/ESC the handler reads previousModeRef.current.
  if (drawMode === 'bbox' || drawMode === 'lasso' || drawMode === 'circle') return;
  previousModeRef.current = drawMode;  // captures the last non-draw mode (Pan/Info)
}, [drawMode]);
```

### Pattern 8: MapDrawToolbar Component

```typescript
// kinetica_bi/src/components/charts/MapDrawToolbar.tsx
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faHand,
  faCircleInfo,
  faVectorSquare,
  faDrawPolygon,
  faCircle,
  faTrash,
} from '@fortawesome/free-solid-svg-icons';

export type DrawMode = 'pan' | 'info' | 'bbox' | 'lasso' | 'circle';

type Props = {
  drawMode: DrawMode;
  onModeChange: (mode: DrawMode) => void;
  shapesCount: number;
  onClearAll: () => void;
};

const MODE_BUTTONS: Array<{ mode: DrawMode; icon: typeof faHand; label: string }> = [
  { mode: 'pan', icon: faHand, label: 'Pan map' },
  { mode: 'info', icon: faCircleInfo, label: 'Info popup' },
  { mode: 'bbox', icon: faVectorSquare, label: 'Draw bounding box' },
  { mode: 'lasso', icon: faDrawPolygon, label: 'Draw lasso' },
  { mode: 'circle', icon: faCircle, label: 'Draw circle' },
];

export default function MapDrawToolbar({ drawMode, onModeChange, shapesCount, onClearAll }: Props) {
  return (
    <div className="map-draw-toolbar" role="toolbar" aria-label="Drawing tools">
      {MODE_BUTTONS.map(({ mode, icon, label }) => (
        <button
          key={mode}
          type="button"
          className={`map-draw-toolbar-button ${drawMode === mode ? 'is-active' : ''}`}
          aria-label={label}
          aria-pressed={drawMode === mode}
          onClick={() => {
            if (drawMode === mode) return; // re-click active = no-op (CONTEXT.md lock)
            onModeChange(mode);
          }}
        >
          <FontAwesomeIcon icon={icon} />
        </button>
      ))}
      {shapesCount > 0 && (
        <button
          type="button"
          className="map-draw-toolbar-button map-draw-toolbar-trash"
          aria-label="Clear all spatial filters"
          onClick={onClearAll}
        >
          <FontAwesomeIcon icon={faTrash} />
        </button>
      )}
    </div>
  );
}
```

**Positioning (CSS, must abut OL zoom control bottom):**
```css
.map-draw-toolbar {
  position: absolute;
  top: calc(0.5em + 2 * (1.375em + 1px) + 4px); /* below the OL zoom control's two buttons */
  left: 0.5em;
  display: flex;
  flex-direction: column;
  pointer-events: none;          /* V15-P-17 lock — container does not swallow OL events */
  z-index: 1001;                 /* above the OL canvas + the OL zoom control's z=1 */
}
.map-draw-toolbar-button {
  pointer-events: auto;          /* buttons are interactive */
  /* dimensions/colors matching .ol-zoom .ol-zoom-in for visual continuity */
}
.map-draw-toolbar-button.is-active {
  background: var(--accent-fill);
  color: white;
}
```

The exact top offset to match the OL zoom control bottom edge is a function of OL's CSS — the planner should test in the browser, but the formula `top = OL-zoom-top + 2 * button-height + gap` is the right shape. CONTEXT.md does NOT mandate pixel-perfect alignment but visual continuity is the operator goal.

**Mount site in MapChartRenderer JSX (sibling to `widget-map-canvas`, NOT a child of the OL viewport per V15-P-17):**
```jsx
<div className="widget-map">
  <div ref={containerRef} className="widget-map-canvas" />
  <MapDrawToolbar
    drawMode={drawMode}
    onModeChange={setDrawMode}
    shapesCount={shapesCount}      // useSpatialFilterStore((s) => s.shapes.length)
    onClearAll={() => useSpatialFilterStore.getState().clearAll()}
  />
  {/* ... existing reconfigure / empty / error overlays ... */}
</div>
```

### Pattern 9: Live Measurement Tooltip Update

The canonical OL pattern (verified via OL measure example) is `feature.getGeometry().on('change', ...)` inside `drawstart`, NOT `map.on('pointermove', ...)`. The geometry's `change` event fires on every coordinate update:

```typescript
// Inside Pattern 4's drawstart handler:
const sketchGeom = event.feature.getGeometry();
geomChangeKey = sketchGeom.on('change', () => {
  // For Polygon (bbox/circle from createBox/createRegularPolygon, OR lasso once first segment closes)
  // OR LineString (lasso freehand during the trail-out phase before the polygon closes):
  let measurementText = '';
  let tipCoord: [number, number] | null = null;
  if (sketchGeom.getType() === 'Polygon') {
    const poly = sketchGeom as Polygon;
    measurementText = computeMeasurementForMode(drawMode, poly, map.getView());
    tipCoord = poly.getInteriorPoint().getCoordinates().slice(0, 2) as [number, number];
  } else if (sketchGeom.getType() === 'LineString') {
    // freehand lasso pre-close — geom is a LineString
    const line = sketchGeom as LineString;
    measurementText = '...';                       // partial area undefined; show nothing OR vertex count
    tipCoord = line.getLastCoordinate() as [number, number];
  }
  (tipOverlay.getElement() as HTMLElement).textContent = measurementText;
  if (tipCoord) tipOverlay.setPosition(tipCoord);
});
```

This pattern is **more reliable than `pointermove`** for all three draw types because (a) bbox/circle `geometryFunction` mutate the geometry on click+drag (pointermove fires before the geometry function updates, causing a 1-frame lag), and (b) lasso freehand records vertices on pointermove anyway, so the geom change is effectively the pointermove.

**Reference:** OL measure.html canonical example — `listener = sketch.getGeometry().on('change', evt => ...)` inside `drawstart`; `unByKey(listener)` inside `drawend`.

### Pattern 10: Live + Persistent Measurement Computation

```typescript
import { getDistance, getArea } from 'ol/sphere.js';
import { transform } from 'ol/proj.js';

// Pure helper — extract to lib/shapeDraw.ts.
export function computeMeasurement(
  type: 'bbox' | 'lasso' | 'circle',
  geom: Polygon,
  view: View,
): string {
  if (type === 'bbox') {
    // bbox = createBox() output, a 4-corner rectangle in EPSG:3857.
    // Width = horizontal distance between two adjacent corners; Height = vertical distance.
    // Transform corners to WGS84 then use getDistance.
    const coords = geom.getCoordinates()[0]; // outer ring [c0, c1, c2, c3, c0]
    // createBox() winding: bottom-left, bottom-right, top-right, top-left, bottom-left
    // (verified empirically; the planner should also sanity-check this in implementation).
    const blMerc = coords[0];
    const brMerc = coords[1];
    const tlMerc = coords[3];
    const bl = transform(blMerc, 'EPSG:3857', 'EPSG:4326') as [number, number];
    const br = transform(brMerc, 'EPSG:3857', 'EPSG:4326') as [number, number];
    const tl = transform(tlMerc, 'EPSG:3857', 'EPSG:4326') as [number, number];
    const widthMeters = getDistance(bl, br);
    const heightMeters = getDistance(bl, tl);
    return `${formatDistance(widthMeters)} × ${formatDistance(heightMeters)}`;
  }
  if (type === 'circle') {
    // 64-gon Polygon — radius = distance from centroid to any vertex.
    const centerCoords = geom.getInteriorPoint().getCoordinates().slice(0, 2) as [number, number];
    const vertexMerc = geom.getCoordinates()[0][0]; // first ring vertex
    const center = transform(centerCoords, 'EPSG:3857', 'EPSG:4326') as [number, number];
    const vertex = transform(vertexMerc, 'EPSG:3857', 'EPSG:4326') as [number, number];
    const radiusMeters = getDistance(center, vertex);
    return formatDistance(radiusMeters);
  }
  // lasso → area
  // ol/sphere.getArea handles projection internally via options.projection.
  // Pass the EPSG:3857 polygon directly with projection option.
  const areaSqMeters = getArea(geom, { projection: 'EPSG:3857' });
  return formatArea(areaSqMeters);
}

function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;                  // 0-decimal recommendation
  return `${(m / 1000).toFixed(1)} km`;
}
function formatArea(sqm: number): string {
  if (sqm < 1_000_000) return `${Math.round(sqm)} m²`;
  return `${(sqm / 1_000_000).toFixed(1)} km²`;
}
```

**Confirmed via Context7/official docs (HIGH confidence):**
- `getDistance(c1, c2)` returns **meters** between two WGS84 coordinates (defaults to Earth's mean radius on the WGS84 ellipsoid). Does NOT accept a projection option — coordinates must be transformed to WGS84 first.
- `getArea(geometry, { projection })` accepts an OL Polygon **in any projection** and handles the conversion internally via the `projection` option. Default `projection: 'EPSG:3857'` — so the call could omit the option, but explicit is clearer.

### Pattern 11: VectorLayer Setup + Style Function

```typescript
// In Effect 1, after the basemap layer is created and added:
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import { Style, Fill, Stroke } from 'ol/style.js';

const COLORS: Record<'bbox' | 'lasso' | 'circle', { fill: string; stroke: string }> = {
  bbox:   { fill: 'rgba(37, 99, 235, 0.10)',  stroke: '#2563eb' }, // blue
  lasso:  { fill: 'rgba(22, 163, 74, 0.10)',  stroke: '#16a34a' }, // green
  circle: { fill: 'rgba(234, 88, 12, 0.10)',  stroke: '#ea580c' }, // orange
};

const vectorSource = new VectorSource();
vectorSourceRef.current = vectorSource;

const vectorLayer = new VectorLayer({
  source: vectorSource,
  zIndex: 10000,    // above all WMS image layers
  style: (feature) => {
    const type = feature.get('shapeType') as 'bbox' | 'lasso' | 'circle';
    const { fill, stroke } = COLORS[type] ?? COLORS.bbox;
    const isSelected = feature.getId() === selectedShapeIdRef.current;
    return new Style({
      fill: new Fill({ color: fill }),
      stroke: new Stroke({
        color: stroke,
        width: isSelected ? 4 : 2,            // SHAPE-V15-04 selection visual
      }),
    });
  },
});
vectorLayerRef.current = vectorLayer;
map.addLayer(vectorLayer);
```

**`selectedShapeIdRef` mirror (same pattern as drawModeRef):**
```typescript
const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
const selectedShapeIdRef = useRef<string | null>(null);
useEffect(() => {
  selectedShapeIdRef.current = selectedShapeId;
  vectorLayerRef.current?.changed();  // force re-render with new selection style
}, [selectedShapeId]);
```

### Pattern 12: Selection + Delete

```typescript
// Click-to-select handler — registered in a new Effect dep on [drawMode]:
useEffect(() => {
  const map = mapRef.current;
  if (!map) return;
  // SHAPE-V15-04: mode-gated to draw modes only.
  if (drawMode !== 'bbox' && drawMode !== 'lasso' && drawMode !== 'circle') return;

  const handler = (event: { coordinate: [number, number]; pixel: [number, number] }) => {
    if (!mountedRef.current) return;
    let hitId: string | null = null;
    map.forEachFeatureAtPixel(
      event.pixel,
      (feature) => {
        const id = feature.getId();
        if (typeof id === 'string') { hitId = id; return true; }
        return false;
      },
      { layerFilter: (l) => l === vectorLayerRef.current },
    );
    setSelectedShapeId(hitId);  // null clears selection (clicked empty area)
  };
  map.on('singleclick', handler as never);
  return () => map.un('singleclick', handler as never);
}, [drawMode]);
```

**Note:** this is a SECOND singleclick listener on the same map, coexisting with Effect 6's info-popup listener. **Both fire on every click — Effect 6 short-circuits via the mode-guard during draw modes, this new selection listener short-circuits in Pan/Info via the deps gate.** They are orthogonal.

**Delete key handler — sibling Effect dep on `[selectedShapeId, drawMode]`:**
```typescript
useEffect(() => {
  if (selectedShapeId === null) return;
  if (drawMode !== 'bbox' && drawMode !== 'lasso' && drawMode !== 'circle') return;
  const handler = (e: KeyboardEvent) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    useSpatialFilterStore.getState().removeShape(selectedShapeId);
    setSelectedShapeId(null);
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, [selectedShapeId, drawMode]);
```

Selection auto-clears when mode switches to Pan/Info — handled by the SECOND selection-click-handler Effect's `return` (which does not actively clear selection on cleanup, BUT the click handler is gone, so the `setSelectedShapeId(hitId)` no longer runs). The CONTEXT.md decision "Selection cleared automatically when switching to Info/Pan mode" requires an explicit clear:

```typescript
useEffect(() => {
  if (drawMode === 'pan' || drawMode === 'info') {
    setSelectedShapeId(null);
  }
}, [drawMode]);
```

### Anti-Patterns to Avoid

- **Don't subclass `ol/control/Control` for the toolbar.** Locked anti-pattern (STATE.md, V15-P-17, GAP-24-01-A root cause). Use React overlay div.
- **Don't rely on `stopClick: true`.** Unreliable across OL versions (PITFALLS V15-P-01 with linked GitHub issues). Use the mode-guard.
- **Don't write in-progress geometry to Zustand on every pointermove.** PITFALLS V15-P-09. Keep sketch in VectorSource only; commit at drawend.
- **Don't use raw EPSG:3857 distances for measurements.** PITFALLS V15-P-04. Always `ol/sphere`.
- **Don't add `drawMode` to Effect 6's deps array.** Forces listener re-registration on every mode change; use the `drawModeRef` mirror instead.
- **Don't compute live measurement on `map.on('pointermove', ...)`.** Less reliable than `geom.on('change', ...)` inside `drawstart` per the canonical OL measure example.
- **Don't write the sketch geometry to the store before validation.** The order in the drawend pipeline is strict: validate → simplify → measure → WKT → store.add. Reversing creates degenerate shapes in the store.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| 4-corner bbox from click-drag | Custom `pointerdown`/`pointermove`/`pointerup` listeners | `new Draw({ type: 'Circle', geometryFunction: createBox() })` | OL handles drag state machine, ESC abort, projection-aware coordinates |
| Regular polygon (n-gon) from click-drag | Hand-rolled trig + `pointermove` accumulator | `new Draw({ type: 'Circle', geometryFunction: createRegularPolygon(64) })` | Same OL drag machinery + correct math for n vertices |
| Freehand polygon vertex capture | Hand-rolled `pointermove` listener with `geom.appendCoordinate(...)` | `new Draw({ type: 'Polygon', freehand: true })` | OL handles closing on `pointerup`, sketch feature display, partial polygon during draw |
| Ellipsoidal great-circle distance | Vincenty / Haversine implementation | `ol/sphere.getDistance(c1, c2)` | OL uses WGS84 ellipsoid mean radius; well-tested; no need to reinvent |
| Polygon area on a sphere | Spherical trigonometry | `ol/sphere.getArea(geom, { projection })` | Same — well-tested, accepts the EPSG:3857 polygon directly |
| WKT serialization with projection transform | Manual coordinate iteration + string-building + clone+transform | `new WKT().writeGeometry(geom, { dataProjection, featureProjection })` | OL's WKT writer transforms internally when both projections are provided — no manual clone needed (a deviation from CONTEXT.md's mentioned "always clone before transform"; clone is still useful elsewhere but redundant here) |
| Polygon centroid (interior point) | Convex hull / centroid math | `geom.getInteriorPoint()` (returns Point — `.getCoordinates().slice(0,2)`) | OL handles non-convex polygons correctly (lasso can be non-convex) |
| DOM-positioned label following geographic point | Manual screen-pixel updates on `view.on('change', ...)` | `new Overlay({ element, position, positioning })` + `overlay.setPosition(coord)` | OL handles pan/zoom repositioning automatically, no React involvement |
| Douglas-Peucker / topology-preserving polygon simplification | Hand-rolled DP | `geom.simplify(tolerance)` | OL uses DP for LineString, topology-preserving quantization for Polygon — both correct for v1.5 |
| ESC key abort during draw | Manual sketch-feature removal | `draw.abortDrawing()` (public in OL 10.9.0) | OL clears sketch + emits internal state correctly without firing drawend |
| Icon library | Hand-rolled SVG paths | Font Awesome `@fortawesome/react-fontawesome` with per-icon imports | Operator override locks Font Awesome; per-icon tree-shakes; semantic icon names |

**Key insight:** OL 10.9.0 provides every primitive Phase 29 needs out of the box. The ONLY hand-rolled logic should be the integration glue: mode state machine, mountedRef-style guards, drawend pipeline orchestration, measurement formatting, and the React toolbar JSX. NO custom drag handlers, NO custom geometry math, NO custom WKT serializer.

## Common Pitfalls

### Pitfall 1: Duplicate Features at drawend (the "Effect 7 + drawend race")

**What goes wrong:** OL's `Draw` interaction adds the sketch feature to the configured source AT drawend (before the event listener runs). If Effect 7 then reconciles the store → source and adds a feature derived from the new shape, the source contains TWO features for one shape. Render glitches; the dimming-on-overlap visual is wrong (3-shape stacking when only 2 shapes were drawn).
**Why it happens:** Two competing writers on the VectorSource: the Draw interaction's auto-add + Effect 7's imperative `addFeature`.
**How to avoid:** At the END of the drawend handler, call `source.removeFeature(event.feature)` before/after `addShape` to the store. Effect 7's reconcile becomes the sole writer. Source state stays a pure derivation of store state (cleanest invariant).
**Warning signs:** Visual fill darker than expected after a single draw; `source.getFeatures().length` is `shapes.length + 1` immediately post-drawend.

### Pitfall 2: Stale-Closure When Adding to Existing useEffect

**What goes wrong:** Adding `drawMode` to Effect 6's deps array causes the singleclick listener to tear down and re-mount on every mode change. During the gap, in-flight OL events have no handler. Worse, on rapid mode changes, the cleanup → re-mount cycle races React's commit phase.
**Why it happens:** Effect 6 is currently keyed on `[getInfoEnabled(...), eligibleLayers, tables, widgetConfig]` (line 975) — none of these change with mode. Widening the deps fundamentally changes the lifecycle of Effect 6.
**How to avoid:** Maintain a `drawModeRef = useRef<DrawMode>('info')` updated in a sibling effect on every `drawMode` state change. Effect 6 reads `drawModeRef.current` imperatively. The deps array stays narrow. Same pattern as mountedRef and selectedShapeIdRef.
**Warning signs:** Info popup fires when in draw mode (the dep-wider listener was being torn down mid-click); test flakes on rapid mode toggles.

### Pitfall 3: ol/Overlay Ghost on Shape Removal

**What goes wrong:** A shape is removed from the store but its persistent measurement overlay stays on the map. Visually orphaned label.
**Why it happens:** Effect 7's reconcile clears VectorSource features but a per-shape Overlay is a separate object in `map.getOverlays()`. Forgetting to call `map.removeOverlay(overlay)` for each removed shape leaks overlays.
**How to avoid:** Maintain `shapeOverlaysRef = useRef<Map<string, Overlay>>(new Map())`. In Effect 7: for any ID in the ref that is NOT in the current shapes list, call `map.removeOverlay(overlay)` and `shapeOverlaysRef.delete(id)`. Also clear ALL overlays + the ref in Effect 1's cleanup return (mirror of `imageLayersRef.clear()` pattern).
**Warning signs:** Multiple measurement labels visible at the same coordinates after rapid add/remove cycles.

### Pitfall 4: ToastKind Mismatch ("warning" doesn't exist)

**What goes wrong:** CONTEXT.md "Claude's Discretion" mentions `kind: 'warning'` as a recommendation. The existing `useToastStore` exports only `kind: 'permission' | 'info' | 'error'`. Calling `showToast(msg, 'warning')` is a TypeScript error.
**Why it happens:** CONTEXT.md was authored ahead of code-survey; the toast surface is narrower than assumed.
**How to avoid:** Use `kind: 'info'` for "Shape too small — try again" — semantically correct (not an error, just feedback). Do NOT extend `ToastKind` for v1.5 (scope creep into the toast module).
**Warning signs:** `tsc --noEmit` fails on the kind argument.

### Pitfall 5: Lasso geom is LineString DURING Draw

**What goes wrong:** During the freehand lasso draw (after drawstart, before drawend), the sketch geometry can be a `LineString` (OL's intermediate representation for an open polygon). Casting to `Polygon` in the `change` handler throws or returns garbage.
**Why it happens:** OL only finalizes the Polygon at drawend (closing ring inserted automatically). Mid-draw, the geometry can be a LineString.
**How to avoid:** Check `sketchGeom.getType()` inside the change handler. Branch on `'Polygon'` vs `'LineString'`. For LineString, show vertex count or partial-length instead of area, OR show no live measurement and only the persistent label post-commit. Recommend: show partial length using `getLength(line)` for LineString mid-draw, switch to `getArea(poly)` once geometry becomes Polygon.
**Warning signs:** Console errors "getInteriorPoint is not a function" or NaN measurements during mid-lasso draw.

### Pitfall 6: ImageWMS basemap + VectorLayer z-index conflict

**What goes wrong:** The new VectorLayer at zIndex=10000 should paint above the WMS image layers (LAYER_Z_BASE=1000, line 87). If the planner omits the explicit zIndex, the VectorLayer gets the default and may render below the WMS image layers — invisible shapes.
**Why it happens:** OL paints layers in map.getLayers() insertion order by default; explicit zIndex overrides. The codebase's existing WMS layers use zIndex=`LAYER_Z_BASE - position` (line 87 comment); the highest occupied zIndex is `1000 - 0 = 1000`. So `10000` keeps shapes always on top.
**How to avoid:** Always set `zIndex: 10000` (or any number > 1000) on the new VectorLayer.
**Warning signs:** Drawn shapes are invisible until you toggle a WMS layer off.

### Pitfall 7: createBox() vs createRegularPolygon() Output Geometry Confusion

**What goes wrong:** Developers expect `new Draw({ type: 'Circle', geometryFunction: createBox() })` to produce a Box geometry, but OL has no Box type — it produces a `Polygon` with 4 corners. Code that later tries `feature.getGeometry() as Circle` crashes.
**Why it happens:** The `type: 'Circle'` in the constructor refers to the **input mode** (click → drag → release), not the output type. The geometryFunction transforms the click+drag motion into the actual output geometry.
**How to avoid:** Cast all drawend outputs as `Polygon` (verified — bbox / lasso / circle all yield Polygon when using the configurations above). Never use `as Circle`.
**Warning signs:** `feature.getGeometry().getRadius is not a function` at drawend.

### Pitfall 8: ESC Listener Memory Leak Across Mode Changes

**What goes wrong:** ESC listener is registered in Effect 8's mount branch but the cleanup return only handles mode change — if the listener is re-registered on every render (not just mode change), N copies stack up.
**Why it happens:** Effect 8 deps are `[drawMode]` — so the Effect fires on every mode change. Each mount adds a listener; each cleanup must remove it. If the deps widen (e.g., to include other state), N listeners accumulate.
**How to avoid:** Keep Effect 8 deps narrow (`[drawMode]` only). The cleanup return MUST call `window.removeEventListener('keydown', handler)`. Same instance reference must be passed to both add and remove (use a stable handler — avoid `() => ...` inline; use `function handler(e) {...}` declared once in the Effect body).
**Warning signs:** ESC press fires the abort logic multiple times after several mode changes.

### Pitfall 9: Click-shape Selection Conflicts with Info-popup Singleclick

**What goes wrong:** Both Effect 6 (info popup) and the new selection-click Effect register `singleclick` listeners. Both fire on every click. In Info mode, the selection listener short-circuits because of its deps gate (`drawMode === 'pan' || 'info' → return`). In draw modes, the info listener short-circuits via the mode-guard. So no real conflict — BUT a click on a shape in draw mode fires `setSelectedShapeId(hitId)` AFTER the info handler returns (Effect 6 listener still runs, returns at the top, no setState). This is fine but the planner should NOT try to use `event.preventDefault()` — OL's singleclick event does not support it.
**Why it happens:** OL dispatches singleclick once but to ALL registered listeners.
**How to avoid:** Accept the multi-listener pattern. The mode-guard cleanly separates concerns. Do NOT try to consolidate into a single listener.
**Warning signs:** Test expectations that assume mutual exclusivity of the two listeners will fail.

## Code Examples

Verified patterns from official sources.

### Example 1: Draw constructors for all three modes

```typescript
// Source: https://openlayers.org/en/latest/examples/draw-shapes.html (verified 2026-05-12)
import Draw, { createBox, createRegularPolygon } from 'ol/interaction/Draw.js';

// bbox
const bboxDraw = new Draw({ source: vectorSource, type: 'Circle', geometryFunction: createBox() });
// circle (64-vertex polygon, NOT a true Circle)
const circleDraw = new Draw({ source: vectorSource, type: 'Circle', geometryFunction: createRegularPolygon(64) });
// lasso
const lassoDraw = new Draw({ source: vectorSource, type: 'Polygon', freehand: true });
```

### Example 2: Live measurement tooltip (canonical OL measure pattern)

```typescript
// Source: https://openlayers.org/en/latest/examples/measure.html (verified 2026-05-12)
import { unByKey } from 'ol/Observable.js';
import Overlay from 'ol/Overlay.js';

let sketch: Feature | null = null;
let measureTooltipElement: HTMLElement | null = null;
let measureTooltip: Overlay | null = null;
let listener: EventsKey | null = null;

draw.on('drawstart', (evt) => {
  sketch = evt.feature;
  createMeasureTooltip();
  listener = sketch.getGeometry()!.on('change', (e) => {
    const geom = e.target;
    let output: string;
    let tooltipCoord: Coordinate;
    if (geom instanceof Polygon) {
      output = formatArea(geom);
      tooltipCoord = geom.getInteriorPoint().getCoordinates();
    } else if (geom instanceof LineString) {
      output = formatLength(geom);
      tooltipCoord = geom.getLastCoordinate();
    }
    measureTooltipElement!.innerHTML = output!;
    measureTooltip!.setPosition(tooltipCoord!);
  });
});

draw.on('drawend', () => {
  measureTooltipElement!.className = 'ol-tooltip ol-tooltip-static';
  measureTooltip!.setOffset([0, -7]);
  sketch = null;
  measureTooltipElement = null;
  unByKey(listener!);
});
```

### Example 3: WKT serialization with projection transform

```typescript
// Source: https://openlayers.org/en/latest/apidoc/module-ol_format_WKT-WKT.html (verified 2026-05-12)
import WKT from 'ol/format/WKT.js';

const wktFormat = new WKT();
// Write: geometry is in featureProjection (EPSG:3857), output WKT is in dataProjection (EPSG:4326)
const wktString = wktFormat.writeGeometry(polygonGeom, {
  dataProjection: 'EPSG:4326',
  featureProjection: 'EPSG:3857',
});
// Output: "POLYGON((-74.0 40.7,-73.9 40.7,-73.9 40.8,-74.0 40.8,-74.0 40.7))"

// Read: input WKT is in dataProjection (EPSG:4326), output geometry is in featureProjection (EPSG:3857)
const geom = wktFormat.readGeometry(wktString, {
  dataProjection: 'EPSG:4326',
  featureProjection: 'EPSG:3857',
});
```

### Example 4: ol/sphere measurements

```typescript
// Source: https://openlayers.org/en/latest/apidoc/module-ol_sphere.html (verified 2026-05-12)
import { getDistance, getArea } from 'ol/sphere.js';
import { transform } from 'ol/proj.js';

// getDistance requires WGS84 (no projection option — input must be pre-transformed).
const merc1: [number, number] = [-8236000, 4971000];
const merc2: [number, number] = [-8235000, 4971000];
const wgs1 = transform(merc1, 'EPSG:3857', 'EPSG:4326') as [number, number];
const wgs2 = transform(merc2, 'EPSG:3857', 'EPSG:4326') as [number, number];
const distMeters = getDistance(wgs1, wgs2); // ~756 m at NYC latitude

// getArea accepts a geometry in any projection via options.projection.
const areaSqMeters = getArea(polygonGeom, { projection: 'EPSG:3857' });
// If polygon is already in EPSG:4326, omit projection (default is EPSG:3857 BUT planner should
// always pass explicitly to avoid mistakes).
```

### Example 5: Font Awesome React usage

```typescript
// Source: https://docs.fontawesome.com/web/use-with/react/add-icons (verified 2026-05-12)
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faHand } from '@fortawesome/free-solid-svg-icons';

// Direct icon prop — no library.add() needed
<FontAwesomeIcon icon={faHand} />
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `abortDrawing_()` (private) | `abortDrawing()` (public) on Draw | OL 6.x → 7.x roughly | Use the public method; no underscore hack needed |
| Tile + TileWMS for raster maps | Image + ImageWMS (single image per viewport) | Kinetica BI Phase 11-10 (2026-05) | Already adopted; vector layer for shapes coexists at higher zIndex |
| Manual sketch-feature management on `pointermove` | OL Draw interaction with `freehand: true` | Pre-OL 4 → OL 4+ | Used here; do not roll your own |
| Style.text for measurement labels | `ol/Overlay` with HTML/CSS pill | OL has always supported both | Use Overlay — CONTEXT.md locks HTML/CSS pill styling |
| `library.add()` icon registration | Per-icon imports + direct `icon` prop | Font Awesome 5 onwards | Use direct prop; tree-shakes better with Vite |
| `geometry.simplify()` returns mutated geom | `geometry.simplify()` returns NEW geom | OL has been this way; CONTEXT.md "transform mutates" applies only to `transform()` not `simplify()` | Use the return value, not the original |

**Deprecated/outdated:**
- `Map#getCoordinateFromPixel(pixel)` and `Map#getPixelFromCoordinate(coord)` are still current and used by the existing codebase (line 932 — `map.getPixelFromCoordinate`). No change.

## Open Questions

1. **Toolbar CSS calc() for OL zoom control bottom offset.**
   - What we know: The OL zoom control's CSS is `.ol-zoom { top: 0.5em; left: 0.5em; }`; each `.ol-zoom-in` / `.ol-zoom-out` button has a fixed height (typical 1.375em + 1px border). Two buttons stacked = ~2 * (1.375em + 1px) ≈ 2.75em + 2px.
   - What's unclear: Whether `.ol-zoom button` height varies with the user's font-size theme; whether the codebase has any custom OL CSS overrides (would need to grep `ol.css` overrides in `kinetica_bi/src/styles/`).
   - Recommendation: Planner sets the toolbar `top` via a hard-coded value (e.g., `top: 3.25em`) and visually verifies; can be refined in a follow-up CSS pass. Not blocking implementation.

2. **Exact "10 screen px²" interpretation for the small-shape rejection threshold.**
   - What we know: PITFALLS V15-P-13 says "100 sq-meters in 3857" as a sample threshold; ROADMAP says "<10 px² area" generically. The two are different scales.
   - What's unclear: Whether the threshold is (a) literal screen pixels squared (so threshold = `10 * resolution^2` in EPSG:3857 meters²), or (b) a width-OR-height minimum (10 px in each dimension), or (c) absolute meters² (e.g., 100 sq-m).
   - Recommendation: Planner uses **(b) width-OR-height < 10 × resolution** — most user-friendly because a thin sliver still rejects. This is what Pattern 3 above codes. The exact math is the planner's call; the toast wording "Shape too small — try again" is locked.

3. **Whether `selectedShapeId` should be cleared when a shape is removed by clearAll() or chip × (Phase 30).**
   - What we know: CONTEXT.md says "When a `removeShape(id)` fires for the currently-selected shape... selection clears implicitly because the shape no longer exists." This is true visually (style function reads selectedShapeId from ref; the feature is gone so no shape is rendered with selected style). But `selectedShapeId` state still holds the dangling ID.
   - What's unclear: Whether the dangling ID causes downstream bugs (e.g., a re-add of a shape with the same ID — won't happen, ids are UUIDs).
   - Recommendation: Add a sibling Effect that listens to shapesKey and clears selectedShapeId if the selected ID is no longer in the shapes list. Defensive; 3 lines.

## Sources

### Primary (HIGH confidence)

- [OpenLayers 10.9.0 Draw API](https://openlayers.org/en/latest/apidoc/module-ol_interaction_Draw-Draw.html) — Draw class constructor, abortDrawing(), drawstart/drawend events, stopClick option, freehand option
- [OpenLayers 10.9.0 ol/sphere API](https://openlayers.org/en/latest/apidoc/module-ol_sphere.html) — getDistance (meters, WGS84 only), getArea (accepts projection option)
- [OpenLayers 10.9.0 WKT format API](https://openlayers.org/en/latest/apidoc/module-ol_format_WKT-WKT.html) — writeGeometry / readGeometry with dataProjection + featureProjection
- [OpenLayers 10.9.0 Overlay API](https://openlayers.org/en/latest/apidoc/module-ol_Overlay-Overlay.html) — constructor options, setPosition, addOverlay/removeOverlay, persists through pan/zoom automatically
- [OpenLayers 10.9.0 Map API](https://openlayers.org/en/latest/apidoc/module-ol_Map-Map.html) — addInteraction / removeInteraction / addOverlay / removeOverlay decoupled from layers
- [OpenLayers 10.9.0 SimpleGeometry simplify](https://openlayers.org/en/latest/apidoc/module-ol_geom_SimpleGeometry-SimpleGeometry.html) — simplify(tolerance) returns NEW geometry; DP for LineString, topology-preserving for Polygon
- [OpenLayers 10.9.0 Polygon API](https://openlayers.org/en/latest/apidoc/module-ol_geom_Polygon-Polygon.html) — getInteriorPoint() returns Point (XYM); getCoordinates() returns [[outerRing], [holes...]]
- [OpenLayers Draw Shapes example](https://openlayers.org/en/latest/examples/draw-shapes.html) — canonical createBox / createRegularPolygon usage with type:'Circle'
- [OpenLayers Measure example](https://openlayers.org/en/latest/examples/measure.html) — canonical drawstart/geom-change/drawend live-tooltip pattern
- [OpenLayers VectorSource API](https://openlayers.org/en/latest/apidoc/module-ol_source_Vector-VectorSource.html) — addFeature/addFeatures/removeFeature/clear; events addfeature/removefeature/changefeature; on/un listener registration
- [OpenLayers VectorLayer API](https://openlayers.org/en/latest/apidoc/module-ol_layer_Vector-VectorLayer.html) — source/style/zIndex options; StyleFunction(feature, resolution) for dynamic per-feature styling; setStyle supported
- [Font Awesome React docs — Add Icons](https://docs.fontawesome.com/web/use-with/react/add-icons) — direct icon prop pattern; tree-shaking via per-icon imports; no library.add() required
- [Font Awesome React docs — Use with React](https://docs.fontawesome.com/web/use-with/react) — required packages and installation
- Codebase analysis: `kinetica_bi/src/components/charts/MapChartRenderer.tsx` lines 256-330 (mountedRef + sourceListenerCleanupRef + GAP-24-02-A/06-A documentation); lines 496-578 (Effect 1 Map mount); lines 820-975 (Effect 6 singleclick handler — TARGET for mode-guard insertion)
- Codebase analysis: `kinetica_bi/src/store/spatialFilterStore.ts` — addShape signature confirmed `(shape: Omit<Shape, 'id'|'label'|'addedAt'>) => void`; reset/clearAll/removeShape behaviors locked
- Codebase analysis: `kinetica_bi/src/store/toast.ts` — ToastKind locked to `'permission' | 'info' | 'error'` (NO 'warning')
- Codebase analysis: `kinetica_bi/package.json` — OL 10.9.0 installed; Font Awesome NOT yet installed
- `npm view ol@10.9.0` / `npm view @fortawesome/react-fontawesome` / `npm view @fortawesome/free-solid-svg-icons` / `npm view @fortawesome/fontawesome-svg-core` — version pinning verified 2026-05-12
- `.planning/research/PITFALLS.md` — V15-P-01..V15-P-17 all reviewed; V15-P-01/02/03/04/09/11/13/15/17 directly govern this phase
- `.planning/STATE.md` — FIRST-CODE-CHANGE lock for Effect 6 mode-guard; React-overlay-not-ol-Control anti-pattern lock; Mercator distortion lock

### Secondary (MEDIUM confidence)

- [OL GitHub Issue #12147 — stopClick reliability](https://github.com/openlayers/openlayers/issues/12147) — confirmed via PITFALLS.md citation; OL 6.5.0 era; behavior may have improved but mode-guard remains the safer mitigation
- [OL GitHub Issue #7525 — singleclick during Draw](https://github.com/openlayers/openlayers/issues/7525) — same theme; community workaround = check a flag (we use drawModeRef)
- WebSearch result: "OpenLayers Draw interaction drawstart drawend geometry change listener live measurement tooltip" — confirmed the `geom.on('change', ...)` inside drawstart pattern is canonical; alternative `pointermove` listener is also used but less reliable

### Tertiary (LOW confidence)

- The exact behavioral nuance of `createBox()`'s output ring winding order (BL → BR → TR → TL → BL) — assumed but not officially documented; planner should sanity-check at implementation by logging the first feature's coordinates. If different, the bbox width/height calculation in Pattern 10 needs to pick different indices.
- Whether OL 10.9.0 `abortDrawing()` reliably clears the tip Overlay's geom-change listener internally — the canonical example explicitly unsubscribes via `unByKey`, so the planner should do the same defensively rather than relying on internal cleanup.

## Metadata

**Confidence breakdown:**
- Standard Stack: **HIGH** — Versions verified via `npm view` 2026-05-12; OL 10.9.0 already installed; Font Awesome v3.3.1/v7.2.0/v7.2.0 confirmed on registry
- Architecture (Effects 1/6/7/8 + state machinery): **HIGH** — Patterns directly grounded in existing MapChartRenderer.tsx code + canonical OL examples
- Pitfalls (V15-P-01..17): **HIGH** — All sourced from .planning/research/PITFALLS.md (HIGH confidence research already locked); cross-verified against current OL 10.9.0 docs
- ol/sphere semantics: **HIGH** — Confirmed via OL API docs that getDistance is WGS84-only and getArea accepts projection
- WKT writer behavior: **HIGH** — Confirmed dataProjection + featureProjection options handle the transform internally (CONTEXT.md's "always clone before transform" lock applies to `transform()`, NOT to WKT writer; minor wording drift but not load-bearing)
- Font Awesome integration: **HIGH** — Confirmed per-icon imports + direct icon prop is the canonical pattern; subpath imports `/faHand` are NOT documented (use root package named import)
- Toast kind mismatch: **HIGH** — Direct code read of `toast.ts`

**Research date:** 2026-05-12
**Valid until:** 2026-06-11 (30 days — OL and Font Awesome are stable; major version bumps unlikely in window)
