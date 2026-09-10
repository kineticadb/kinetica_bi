# Phase 29: draw-and-shape - Context

**Gathered:** 2026-05-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Per-map drawing toolbar (`MapDrawToolbar.tsx`) + OL Draw interactions for bbox / lasso / circle + cross-map shape rendering on `VectorLayer` + live measurement tooltip during draw + persistent measurement label on every committed shape + click-shape+Delete removal + Effect 6 mode-guard (V15-P-01 mitigation; FIRST code change in this phase).

**This is the most complex v1.5 phase.** Architecture is heavily locked by REQUIREMENTS DRAW-V15-01..06 + SHAPE-V15-01..04 and by STATE.md v1.5 architecture decisions. This CONTEXT captures the visual/UX nuance that downstream agents would otherwise have to guess.

**Out of scope (deferred to Phase 30):** `AggregatedWidgetRenderer` extension to fire materialize on shape change, `materializeFilter` client helper spatial-args, `FilterBar` spatial chips. Phase 29 writes to `useSpatialFilterStore`; Phase 30 wires the materialize trigger.

</domain>

<decisions>
## Implementation Decisions

### Toolbar layout & visuals (MapDrawToolbar)

- **Position:** Top-left, **flush against the bottom edge of the existing OL zoom (+/-) control** so the operator sees one continuous vertical bar (zoom-in → zoom-out → Pan → Info → Bbox → Lasso → Circle → Trash). The OL zoom control itself is NOT modified — `MapDrawToolbar` is the locked React `<div>` overlay, positioned via CSS to abut the zoom control. Anti-pattern lock from STATE.md ("Toolbar as React overlay, NOT ol/control/Control") is preserved verbatim.
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

### Shape colors & selection visual

- **Per-type fixed color palette:**
  - Bbox = **blue** (e.g., `#2563eb` or the existing app accent blue — planner picks a hex that meets WCAG 3:1 contrast against the basemap)
  - Lasso = **green** (e.g., `#16a34a`)
  - Circle = **orange** (e.g., `#ea580c`)
  - Same shape type always looks the same across maps and across sessions. Matches conventions in QGIS / ArcGIS.
- **Fill / outline (locked from SHAPE-V15-01 + tightened here):**
  - Fill: ~10% opacity of the per-type color
  - Outline: 2px solid per-type color
  - Overlapping shape fills are additive (default OL behavior) — overlap darkens visually, which is semantically correct for OR-composed spatial filters. Zero special-case code.
- **Selection visual:** Selected shape outline switches from 2px → **4px** AND brightens (adds a thin inner white halo stroke, OR lightens the per-type color by ~30%). Fill opacity unchanged. Selection is single-shape only (see Mode & selection behavior below).
- **Persistent measurement label styling:** **Neutral white text on a dark semi-transparent rounded pill**, regardless of shape color. Pill style is consistent across all shape types — operators learn one visual language. Reads cleanly over light AND dark basemaps. Mirrors Google Maps measurement label convention.

### Measurement labels & precision (live tooltip + persistent label)

- **Decimal precision:** Always **1 decimal**. Examples: `2.5 km`, `5.0 km × 3.0 km`, `12.4 km²`. Predictable; matches the example strings in ROADMAP success criteria 4 verbatim.
- **Format:**
  - Tight number formatting, **space between number and unit** (SI typography convention): `2.5 km` not `2.5km`.
  - **No thousand separator** (the app is not localized; avoids en-US/en-EU comma/period divergence). Very large lasso areas read as `1234.5 km²`.
  - Bbox format: **`{W} × {H}`** — width always first, height second. Matches screen-pixel convention; predictable regardless of which axis is longer.
- **km / m switchover (locked by DRAW-V15-05):** Below 1 km display as meters with 0 decimals (e.g., `750 m`); ≥ 1 km display as `X.X km`. Same rule applies to area: below 1 km² display as `XXX m²` (0 decimals); ≥ 1 km² display as `X.X km²`. Planner picks exact m-precision (0 or 1 decimal acceptable).
- **Live tooltip during draw:** **Identical styling to the persistent post-commit label** — same dark pill, same white text, same font. Operator sees the final look in real-time; no cognitive gear-shift on `drawend`. Single CSS class for both (DRY).
- **Persistent label anchor (locked by SHAPE-V15-03):** `ol/Overlay` anchored to geometry centroid; OL handles repositioning on pan/zoom automatically. Per-shape `Overlay` instance is cleaned up when the shape is removed from the store (extends mountedRef + source-listener cleanup pattern from v1.4 Phase 24-04/24-06).

### Mode & selection behavior

- **Default starting mode on map mount:** **Info** — matches v1.4 behavior (singleclick info popup works out-of-the-box). `previousMode` for the auto-restore mechanism initializes to Info, so the typical Info → Bbox → drawend → Info loop feels natural and consistent with the "Info auto-restore" wording in DRAW-V15-02.
- **Auto-restore on drawend (locked by DRAW-V15-02):** `drawend` event flips mode back to `previousMode` (typically Info). Implementation: `previousMode` is captured the moment a draw mode (Bbox/Lasso/Circle) is entered; on `drawend` OR ESC keydown, mode is restored to `previousMode`. This is the same mechanism for both committed-draw and ESC-abort.
- **Re-clicking the already-active mode button:** **No-op.** Already-active button does nothing on click. Simplest mental model — switching out requires clicking a different mode button or hitting ESC mid-draw. No toggle-off behavior on Pan / Info / Bbox / Lasso / Circle.
- **Trash icon ("Clear all spatial filters"):** **Immediate** — click the trash, all shapes gone, `clearAll()` fires on the store, `shapeCounter` resets to 0 (Phase 27 lock), Phase 30 materialize re-fires unfiltered. NO confirmation dialog. Matches Phase 28's "remove target = no confirmation" pattern and the broader Layers panel chip-remove convention.
- **Selection rules (single-select model):**
  - Only one shape selected at a time.
  - Clicking a shape (in any draw mode — NOT Info, NOT Pan) selects it; clicking a different shape transfers selection; clicking the empty map area (in a draw mode) clears selection.
  - Mode-gating (locked by SHAPE-V15-04): selection click is **disabled in Info mode** (would conflict with v1.4 singleclick popup) and **disabled in Pan mode** (Pan is for map dragging, not shape interaction).
  - Selection cleared automatically when:
    - User switches to Info mode (since Info-mode singleclick is for the info popup)
    - User switches to Pan mode (Pan has no shape-interaction surface)
    - User hits ESC mid-selection
  - Selection PRESERVED across switches between draw modes (Bbox ↔ Lasso ↔ Circle).
  - Delete with nothing selected: **silent no-op** (no toast — feels noisy when the user is just trying to delete a shape they may have already removed).
  - No multi-select; no shift-click. Multi-shape removal happens via the trash button OR chip × in the FilterBar (Phase 30).

### Claude's Discretion

The planner / implementer has flexibility here:

- **Exact hex values for the per-type palette** (bbox blue, lasso green, circle orange) — pick hexes that meet WCAG 3:1 contrast against typical Esri / OSM basemap tiles. The "thin inner white halo stroke" on selection is one option; equivalent "lighten by 30%" is also acceptable.
- **Exact CSS class names + Font Awesome import strategy** (per-icon vs library object) — both are tree-shake friendly with `fontawesome-svg-core`.
- **Meter precision for sub-km measurements** — 0 decimals (`750 m`) or 1 decimal (`750.5 m`); both acceptable. Operator's mental model is "round numbers" — 0 decimals is the default recommendation.
- **Where the trash button visually appears within the toolbar column** — most natural is bottom (after the 5 mode buttons), separated by a slight visual gap (e.g., `border-top` divider). Operator's UI intuition; planner decides.
- **Exact selection-clear behavior on store mutation** — when a `removeShape(id)` fires for the currently-selected shape (e.g., via chip × in FilterBar), selection clears implicitly because the shape no longer exists. No special action needed beyond keeping `selectedShapeId` in component state (NOT in the store — out of Phase 27 scope, just local to MapChartRenderer).
- **Keyboard shortcuts for mode-switching** (e.g., `P`/`I`/`B`/`L`/`C` for Pan/Info/Bbox/Lasso/Circle) — NOT required by REQUIREMENTS; planner can defer to a follow-up phase OR include if trivial.
- **aria-pressed / aria-label on toolbar buttons** — required for accessibility but exact wording is planner's call.
- **Toast wording for "Shape too small"** — locked to `"Shape too small — try again"` by DRAW-V15-06; toast `kind` (warning vs info) is planner's call (recommend `warning`).
- **Whether `selectedShapeId` lives in `useState` inside MapChartRenderer OR in a small useRef** — `useState` recommended since it triggers re-render for the selection visual update.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 29 scope + locked architecture
- `.planning/ROADMAP.md` §"Phase 29: draw-and-shape" — Goal, depends-on, requirements list, 5 success criteria
- `.planning/REQUIREMENTS.md` — DRAW-V15-01..06 + SHAPE-V15-01..04 (the 10 requirements with full implementation specs verbatim)
- `.planning/STATE.md` §"Key v1.5 Architecture Decisions" — Phase 29 first-task rule (Effect 6 mode-guard FIRST), Mercator distortion lock (V15-P-04), toolbar-as-React-overlay anti-pattern lock, lasso simplification lock, mountedRef extension lock
- `.planning/PROJECT.md` §"Current Milestone: v1.5 Spatial filtering on map" — milestone intent + v1.5 architectural locks

### v1.5 research artifacts (pitfall coverage — read for every gray-area implementation choice)
- `.planning/research/PITFALLS.md` §"V15-P-01: Draw Interaction and v1.4 Singleclick Handler Fire Simultaneously" — Mode-guard pattern + why `stopClick: true` is unreliable; `useRef`-stale-closure pattern
- `.planning/research/PITFALLS.md` §"V15-P-02: Stale Cursor After Mode Switch Error or Unmount" — `useEffect(() => { ... return cleanup }, [drawMode])` cursor management pattern
- `.planning/research/PITFALLS.md` §"V15-P-03: Freehand Polygon Vertex Explosion → WHERE Clause Size Bomb" — `geometry.simplify(resolution * 2)` + optional 150-vertex hard cap
- `.planning/research/PITFALLS.md` §"V15-P-04: Mercator Distortion for Circle Radius" — `ol/sphere.getDistance` for ground-radius; `transform` + `.clone()` patterns
- `.planning/research/PITFALLS.md` §"V15-P-09: Cross-Map Vector Overlay Re-Render Thrash" — Why in-progress draw geometry MUST stay in OL VectorSource only (never written to Zustand on `pointermove`); commit only at `drawend`
- `.planning/research/PITFALLS.md` §"V15-P-11: Shape Measurement Label Re-Positioning — OL Overlay vs Style.text" — Per-shape `ol/Overlay` cleanup discipline
- `.planning/research/PITFALLS.md` §"V15-P-13: Degenerate Shape at drawend" — Zero-area validation + toast wording
- `.planning/research/PITFALLS.md` §"V15-P-15: OL Draw Interaction Lifecycle — Forgotten Cleanup on Dashboard Switch" — Effect 7/8 cleanup return pattern; `map.removeInteraction(interaction)` before `map.dispose()`
- `.planning/research/PITFALLS.md` §"V15-P-17: Per-Map Toolbar Custom Controls — OL Zoom Control Click Capture" — Pointer-events lock (container `none`, buttons `auto`)

### Prior phase contexts (read for upstream contract clarity)
- `.planning/phases/27-spatial-filter-store/27-CONTEXT.md` — `useSpatialFilterStore` shape, N counter semantics (Bbox 1, Circle 2, Lasso 3, Bbox 4 — session-wide global, monotonic), `clearAll()` resets counter to 0, `addShape` synthesizes id/label/addedAt
- `.planning/phases/28-spatial-target-config/28-CONTEXT.md` — `SpatialTarget` type + `isSpatialTargetEligible` predicate (consumed by Phase 30, not Phase 29 — but informs the cross-phase mental model)
- `.planning/phases/25-spatial-predicate-spike/25-CONTEXT.md` + `25-SPIKE-NOTES.md` — Predicate names (`STXY_WITHIN` for latlon, `ST_INTERSECTS` for WKT) — Phase 29 doesn't write SQL but the WKT EPSG:4326 invariant is critical (Phase 26 server consumes these strings)

### v1.4 Phase 24 retroactive locks (mountedRef + source-listener cleanup pattern — MUST extend)
- `.planning/phases/24-verification/24-CONTEXT.md` — mountedRef cleanup-gate pattern (GAP-24-06-A); source-listener cleanup pattern (GAP-24-04); Effect re-fire safety. Phase 29 extends both to new Effects 7 (shape sync) + 8 (Draw interaction mount) + VectorSource listeners.

### Production code to read before writing Phase 29 plans
- `kinetica_bi/src/components/charts/MapChartRenderer.tsx` lines 820–975 — Effect 6 (v1.4 singleclick handler). The mode-guard goes at the TOP of this handler as the FIRST code change in Phase 29.
- `kinetica_bi/src/components/charts/MapChartRenderer.tsx` lines 496–578 — Effect 1 (Map mount). VectorLayer + VectorSource setup added here in Phase 29.
- `kinetica_bi/src/store/spatialFilterStore.ts` — Existing Phase 27 store; Phase 29 wires `addShape` / `removeShape` / `clearAll` callers.
- `kinetica_bi/src/components/Toast.tsx` + `kinetica_bi/src/store/toast.ts` — Existing toast system; Phase 29 uses `useToastStore.getState().showToast(msg, kind)` for the "Shape too small — try again" toast (DRAW-V15-06 locked wording).

### Established OL Draw + ol/sphere patterns
- `kinetica_bi/server/src/lib/radiusConversion.ts` — v1.4 Phase 18 ground-distance pattern reference. Phase 29 uses `ol/sphere.getDistance` / `getArea` (ellipsoidal) — more accurate than the flat-earth approximation in v1.4 — for all measurements.
- OpenLayers official docs (read via `mcp__plugin_context7_context7__*` if needed):
  - `ol/interaction/Draw` — `type`, `geometryFunction` (`createBox`, `createRegularPolygon(64)`), `freehand: true`, `drawend`, `abortDrawing()`
  - `ol/sphere` — `getDistance` (ellipsoidal meters between two WGS84 lon/lat pairs), `getArea` (ellipsoidal m² of a WGS84 polygon)
  - `ol/format/WKT` — `writeGeometry(geom, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' })`
  - `ol/Overlay` — Positioning, offset, autoPan; per-shape overlay lifecycle

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`kinetica_bi/src/store/spatialFilterStore.ts` (Phase 27)** — Existing Zustand slice; `addShape({ type, wkt, measurement })`, `removeShape(id)`, `clearAll()`, `reset()`. Phase 29 calls these from `drawend` handler + selection-Delete handler + trash button.
- **`kinetica_bi/src/components/Toast.tsx` + `kinetica_bi/src/store/toast.ts`** — `useToastStore.getState().showToast(message, kind)` is the established toast API. Phase 29 uses it for the locked-wording "Shape too small — try again" toast (DRAW-V15-06).
- **`kinetica_bi/src/components/charts/MapChartRenderer.tsx` Effect 6 (lines 820–975)** — v1.4 singleclick info-popup handler. The mode-guard `if (drawMode !== 'pan' && drawMode !== 'info') return` is added as the **FIRST line** of the async `handler` function (V15-P-01 mitigation, locked by STATE.md). Mode is read via `useSpatialFilterStore.getState()` (imperative, never stale-closure).
- **`kinetica_bi/src/components/charts/MapChartRenderer.tsx` Effect 1 (lines 496–578)** — Map mount Effect. Phase 29 adds `VectorLayer` + `VectorSource` here for the shape overlay; cleanup return extended to dispose the new layer/source listeners.
- **Existing mountedRef + source-listener cleanup pattern (Phase 24-04, 24-06)** — Extended in Phase 29 to cover Effects 7 (shape sync) + 8 (Draw interaction) + VectorSource listeners.
- **`useFilterViewStore` / `useFilterStore` / etc. selector patterns** — Established `useStore((s) => s.primitive)` pattern + `useStore.getState()` for imperative reads. Phase 29 uses `useSpatialFilterStore((s) => shapesKey(s.shapes))` (primitive joined-IDs string — PITFALL S-02 mitigation).

### Established Patterns
- **Toolbar-as-React-overlay (anti-pattern lock):** NEVER subclass `ol/control/Control`. Root-cause of v1.4 GAP-24-01-A / GAP-24-02-A. `MapDrawToolbar` is an absolutely-positioned React `<div>` with `pointer-events: none` on container, `pointer-events: auto` on buttons.
- **Cursor management imperatively in a `useEffect`:** Single `useEffect` deps on `drawMode`; reset cursor in cleanup return (covers both mode change AND unmount paths — V15-P-02).
- **WKT serialization with mandatory `.clone()`:** `geom.clone()` THEN `writeGeometry({ dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' })`. `transform` mutates in place; cloning is the only safe path. Locked in STATE.md.
- **Measurements via `ol/sphere` (ellipsoidal), NEVER raw EPSG:3857:** All radii, distances, areas computed via `ol/sphere.getDistance` / `getArea` after coords are transformed to WGS84. Locked by V15-P-04.
- **In-progress draw stays in OL VectorSource only:** During `pointermove`, the geometry is held in OL's native VectorSource. Zustand store writes happen ONLY at `drawend` (V15-P-09 lock). Prevents N-map re-render thrash on freehand drags.
- **Toast for "Shape too small" only — no other surface for degenerate shapes:** Locked by DRAW-V15-06. Server never receives the rejected shape.
- **No auth-mode branching in this phase:** Drawing is pure frontend; password vs OIDC auth is transparent. Phase 31 UAT exercises both modes.

### Integration Points
- **`MapChartRenderer.tsx`** — Major surgery:
  - Effect 1 gains VectorLayer + VectorSource setup; cleanup return disposes them.
  - Effect 6 gains the mode-guard as its FIRST line (V15-P-01).
  - **New** Effect 7: store-shapes → OL-features sync on `shapesKey` change. Clears stale features atomically before re-adding (SHAPE-V15-02).
  - **New** Effect 8: OL Draw interaction mount per active draw mode (bbox / lasso / circle). Cleanup return calls `map.removeInteraction(draw)`.
  - **New** `useState<DrawMode>` for current mode + `useRef<DrawMode>` for `previousMode` + `useState<string | null>` for `selectedShapeId`.
  - **New** keyboard listener for ESC (aborts mid-draw + clears selection) and Delete (removes selected shape).
  - **New** cursor-management Effect (deps on `drawMode`).
- **New file:** `kinetica_bi/src/components/charts/MapDrawToolbar.tsx` — React `<div>` overlay with 6 Font Awesome buttons. Receives `{ drawMode, onModeChange, shapesCount, onClearAll }` props.
- **New file:** `kinetica_bi/src/components/charts/MapDrawToolbar.spec.tsx` — Vitest spec covering render, button-click events, active-state class application, trash-visibility gating.
- **Existing spec:** `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` — Extended with Effect 6 mode-guard test, Effect 7 sync test, Effect 8 Draw mount/unmount test, click-shape+Delete test.
- **`kinetica_bi/package.json`** — Add `@fortawesome/react-fontawesome`, `@fortawesome/fontawesome-svg-core`, `@fortawesome/free-solid-svg-icons` as dependencies.

</code_context>

<specifics>
## Specific Ideas

- **Single visual bar = zoom + draw:** Operator requested the OL zoom control (`+` / `−`) and the new `MapDrawToolbar` to read as ONE continuous vertical bar at the top-left of every map widget. The OL zoom control is NOT subclassed — it stays as the OL-managed `ol/control/Zoom`. The `MapDrawToolbar` React overlay is positioned via CSS to abut the bottom edge of the zoom control with matching width, border-radius (bottom-rounded only), and background color so the seam is invisible. The locked "React overlay, not ol/control/Control" anti-pattern is preserved at the architecture level; the visual unification is purely CSS.
- **Font Awesome is a new dependency** — the codebase had no icon library before this phase. Per-icon imports from `@fortawesome/free-solid-svg-icons` (e.g., `import { faHand } from '@fortawesome/free-solid-svg-icons/faHand'`) keep the bundle lean. Confirm with package-lock.json before planner finalizes the import paths.
- **The user accepted Claude's recommendation on every default question across all four areas** (16 questions total). The two operator overrides were: (1) Toolbar position must visually unify with the OL zoom control (single bar, top-left), and (2) Icons come from Font Awesome rather than inline SVG. Everything else is the conservative-default lock; the planner should not second-guess them.
- **Effect 6 mode-guard is the first code change in this phase (STATE.md lock).** Plan ordering: P29-01 mode-guard + cursor effect + previousMode state, BEFORE any Draw interaction or VectorLayer code. P29-02+ add the rest. This sequencing matches v1.4 Phase 24-04 / 24-06 fix ordering.
- **Selection state is component-local (NOT in the store).** `selectedShapeId` lives in `MapChartRenderer` `useState` — out of Phase 27 store scope. When a shape is removed by any path (Delete key, chip ×, trash, clearAll), the selectedShapeId is implicitly invalidated because the shape no longer exists in the store; the selection visual disappears naturally on the next `shapesKey` render.

</specifics>

<deferred>
## Deferred Ideas

- **Keyboard shortcuts for mode switching** (`P` / `I` / `B` / `L` / `C` / `T`) — NOT in REQUIREMENTS; not required for v1.5 close. Could land in a v1.6 power-user phase OR be folded in by the planner if trivial. Default: NOT included.
- **Undo / redo for shape add/remove** — Out of scope; Phase 27's store has no undo stack. Operator can re-draw if needed.
- **Multi-select with shift-click + bulk delete** — Single-select is the v1.5 lock. Bulk delete happens via the trash button.
- **Persistent shapes across sessions** — Phase 27 is session-only by lock (no localStorage / SQLite / URL). Shapes clear on logout AND dashboard-switch.
- **Hover-tooltip on toolbar buttons (mouseover labels like "Draw bounding box")** — Standard browser `title=` attribute is acceptable; richer custom tooltip is deferred (planner can include `aria-label` for accessibility — recommended but not required wording).
- **Phase 30 materialize trigger** — `AggregatedWidgetRenderer` Effect 1 dep array gains `spatialFilterVersion`; `materializeFilter` client body extends with spatial args. Phase 29 only writes to the store; Phase 30 wires the trigger. Without Phase 30, drawing produces shapes but tiles do NOT re-filter — by design for the Phase 29 ship boundary.
- **Phase 30 FilterBar spatial chips** — Chip × removal path lives in `FilterBar.tsx`, not in MapDrawToolbar. Phase 29 supplies the data (shapes in the store with labels + measurements); Phase 30 renders the chips.
- **Phase 31 UAT** — End-to-end operator UAT (5 draw flows × 2 spatial modes × 2 auth modes) lives in Phase 31. Phase 29's vitest + tsc-clean is the unit-level success gate.
- **WKB-mode drawing** — Eligibility predicate rejects WKB at config / materialize / server gates (Phase 28 / 30 / 26 respectively). Drawing UX itself is mode-agnostic — the same shape is drawn regardless of which target's mode is in play. WKB un-greying tied to TD-V14-WKB-SPIKE.

</deferred>

---

*Phase: 29-draw-and-shape*
*Context gathered: 2026-05-12*
