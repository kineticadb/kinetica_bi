# Feature Research: v1.5 Spatial Drawing Filters on Map

**Domain:** Interactive spatial drawing / filtering UX on an existing Kinetica BI dashboard with OpenLayers map widgets
**Researched:** 2026-05-11
**Confidence:** HIGH for UX patterns (well-established cross-tool conventions verified against Tableau, ArcGIS Dashboards, Kepler.gl, Foursquare Studio, Mapbox GL Draw, NNG/NN group UX research); MEDIUM for Kinetica-specific spatial predicate interaction (predicates confirmed from Kinetica 7.1 docs, but spatial-predicate + materialized-view composition path is a v1.5-cycle spike); LOW for chip-label naming conventions (no authoritative cross-tool standard found — synthesised from partial evidence)

---

## Scope Boundary

v1.4 shipped: map click → spatial-nearest info popup; nine chart types; column-filter chip bar; v1.3 server-side materialized-view filter pipeline (LAYERS-swap for WMS, FROM-swap for charts).

v1.5 adds ONLY the spatial drawing + filtering surface. This research covers those new surfaces exclusively. Column-filter chip UX, WMS LAYERS-swap, materialize pipeline, and info popup are carried forward unchanged.

---

## Research Findings by Question Area

The nine questions from the milestone brief are answered below before being synthesised into the Feature Landscape section.

### Q1 — Mode-switching UX across production tools

**Tableau:** Toolbar button group with three selection shapes (Rectangular / Lasso / Radial) accessible via a dropdown arrow off the rectangular-select button, plus a distinct Pan mode. Keyboard shortcuts mirror modes: `a` = rectangular, `d` = lasso, `s` = radial, `f` = pan. Modes are mutually exclusive; the active mode receives a depressed/highlighted appearance. The "info" click for tooltips is always-on in Tableau — it does not require its own mode because tooltips appear on hover, not click. Confidence: MEDIUM (multiple secondary sources, no primary doc screenshot available).

**ArcGIS Dashboards:** Selection drawing tools (Rectangle, Lasso, Circle, Line) are accessed via a selection tool dropdown on the map element. Normal map pan/zoom is the default state; clicking the selection dropdown puts the map into selection mode. No separate "Info" mode — feature popups appear by default on single-click in the normal pan state. Confidence: HIGH (Esri official docs).

**Kepler.gl:** Draw tools (rectangle / polygon via click-click-click / free draw via nebula.gl) are inside a dedicated "Draw" panel accessed from the side toolbar. The map's default state is Pan + Tooltip. Polygon drawing uses click-to-place-vertices with double-click to close (not freehand by default). Confidence: MEDIUM (docs + GitHub issues).

**Foursquare Studio:** Draw polygon tool accessible via a polygon icon in the map toolbar's top-right corner. Normal state = Pan; clicking the icon opens a drawing panel. Shapes become responsive filter boundaries once placed. Confidence: HIGH (official docs).

**Mapbox GL Draw:** Library-level mode switching via `changeMode()`. Modes: `simple_select` (default pan/select), `draw_polygon`, `draw_line_string`, `draw_point`, `direct_select`, `static`. Each mode defines its own click/drag/keypress behaviour. Transition back to `simple_select` is automatic after draw completion. ESC key in draw modes triggers `changeMode('simple_select')` via `onKeyUp` handler. Confidence: HIGH (official MODES.md + API.md).

**NNG/Nielsen Norman Group (UX research):** Active mode must be indicated with at least two simultaneous visual signals (cursor change + toolbar highlight) to prevent mode-slip errors. Modes are appropriate when the action space is genuinely larger than the input device can accommodate without them. Spring-loaded (hold-to-activate) modes reduce accidental mode errors but hurt discoverability. Confidence: HIGH (NNG primary research).

**Synthesis:** The universal pattern is a **toolbar button group** where one button = one mode, the active mode is visually depressed/highlighted, and the cursor changes to match the mode. Info/tooltip is either always-on (Tableau hover) or occupies its own distinct mode button (distinct icon). For this app, the existing v1.4 singleclick info-popup is click-driven, so it must be gated on the Info mode button being active — matching the ArcGIS/Foursquare pattern of explicit mode buttons rather than Tableau's always-on hover.

---

### Q2 — Shape interaction conventions for BI users (non-GIS)

**Starting a draw:**
- Bbox: click toolbar → click-and-drag on map → release to commit. Universal across ArcGIS, Foursquare, Mapbox GL Draw. No intermediate steps.
- Lasso (freehand): click toolbar → click-drag-release. OL `freehand: true` matches this — releasing pointer closes and commits polygon automatically. Simpler than click-click-click-doubleclick polygon.
- Circle: click toolbar → click (centre) → drag outward → release to set radius. ArcGIS Dashboards and Mapbox GL Draw circle modes both use click-drag.
- Polyline polygon (click-click-click-doubleclick) is considered "difficult for non-GIS users" (mapuipatterns.com Feature Selection pattern doc). Do NOT use this for the lasso tool.

**Cancelling mid-draw:**
- ESC key: universal standard across Mapbox GL Draw (documented in MODES.md), ArcGIS Experience Builder (confirmed), general GIS desktop tools. ESC should abort the current in-progress sketch and return to the previous mode (typically Pan).
- Right-click: some tools (QGIS) use right-click to cancel or close polygon. Less universal, not expected by BI users.
- Clicking toolbar's own button again while in draw mode: toggle-off pattern, also acceptable. Mapbox GL Draw handles this via `changeMode('simple_select')`.

**Removing a committed shape:**
- Click shape → Delete key: desktop-app convention (Mapbox GL Draw `simple_select` mode allows Delete key to remove selected feature). Recognized by technically-literate users.
- Hover → × button: web-app-native convention. Requires shape to have a hover state with a dismiss button rendered in an overlay. Used in Foursquare Studio and CARTO.
- FilterBar chip ×: v1.3 pattern already established; spatial filters must participate in this (per milestone spec). This is the most visible and discoverable removal path.
- Right-click → Delete context menu: ArcGIS Desktop and QGIS convention; overkill for BI; skip.
- "Clear all spatial filters" toolbar button: per-map reset; simpler than shape-by-shape deletion when multiple shapes exist.

**Editing an existing shape (vertex modification):**
- Mapbox GL Draw provides `direct_select` mode for vertex-by-vertex editing; this requires shape-selection state machine.
- Kepler.gl: no vertex editing of drawn polygon filters — the only edit is delete-and-redraw.
- ArcGIS Experience Builder Sketch widget: supports full vertex editing, but requires a separate Modify interaction.
- **V1 recommendation:** Do NOT ship vertex editing. Delete-and-redraw is the correct v1 sweet spot. Rationale: (1) vertex editing requires `ol/interaction/Modify` + selection state orthogonal to draw state; (2) Kepler.gl — the closest peer tool in maturity — ships only delete-and-redraw; (3) BI users draw coarse shapes for region filtering, not precision GIS editing. Dependency: vertex editing would require shape-selection state, which conflicts with the per-map Info mode click-handler already in Effect 6.

---

### Q3 — Measurement display patterns

**OpenLayers official measure example (HIGH confidence — confirmed from OL 10.9.0 source + example page):**
- A live measurement tooltip follows the cursor during drawing. It is positioned below the sketch's interior point (polygons) or last vertex (lines).
- After draw completion, the tooltip becomes a static "ol-tooltip-static" element with a yellow background, pinned to the committed geometry.
- Polygon: shows area in m² (under 10,000 m²) or km².
- LineString: shows length in m (under 100 m) or km.
- Circle: the OL example does not format circle radius separately — radius must be derived from the geometry using `getRadius()` on the `Circle` type before the `createRegularPolygon` conversion.

**ArcGIS Earth / ArcGIS Online:** Shows center coordinates, radius, perimeter, and area of a circle as annotations. Labels are persistent after commit. Confidence: MEDIUM (official Esri docs).

**Kepler.gl / Foursquare Studio:** No specific measurement display documented for drawn filter polygons. The filter panel shows the shape name but not area/perimeter.

**General BI tool pattern (Tableau, Looker, Metabase):** None of these tools show area/perimeter measurements on selection shapes. Selection is for filtering, not measurement. Measurement labels are a GIS-tool convention, not a universal BI convention.

**Synthesis and recommendation:**
- Live cursor-companion tooltip during draw: TABLE STAKES for indicating the shape is "doing something". Show radius (km/m) for circle, W×H dimensions for bbox, area for lasso.
- Persistent label on committed shape: DIFFERENTIATOR — not universal but clearly useful (ArcGIS pattern). Show compact text near centroid: "2.5 km radius" / "5.1 km × 3.2 km" / "12.4 km²".
- Lasso area vs perimeter: show area (km²) only — perimeter of a lasso shape is not actionable for BI users.
- Tooltip-on-hover-only (no persistent label): ANTI-FEATURE — hover tooltips on vector shapes conflict with the info-popup singleclick handler already in Effect 6.

---

### Q4 — Multi-shape boolean composition

**ArcGIS Dashboards (HIGH confidence — official docs):** "Multiple spatial filters work with an 'OR' logic (or union of the polygons) and not an 'AND' logic (or intersection of the polygons)." This is implicit and non-configurable — users draw shapes, all shapes union together automatically.

**Foursquare Studio (HIGH confidence — official docs):** "Multiple geospatial boundaries can be drawn on the same map to filter the map in an AND operation." Note: this contradicts ArcGIS — Foursquare uses AND between shapes, ArcGIS uses OR. The discrepancy is real; tools differ on the default composition.

**Kepler.gl:** Polygon geometry filter is applied as a single filter with all drawn polygons implicitly OR'd within the filter (one geometry filter can hold multiple polygons).

**Map UI Patterns (mapuipatterns.com):** "Filters between attribute categories combined with AND; filters within a category combined with OR." This maps to: multiple drawn shapes (same category = spatial shapes) → OR. Column-filter chips (different category = attribute filters) → AND with spatial shapes. This matches the v1.5 milestone spec exactly.

**The v1.5 locked decision:** Shapes OR with each other; the combined spatial predicate AND's with the column-filter chain. This is the correct industry-standard composition for "draw multiple regions of interest" without a per-shape toggle. Exposing per-shape AND/OR/SUBTRACT toggles is a DIFFERENTIATOR for GIS power users; it is explicitly out of scope for v1.5 and should be treated as an ANTI-FEATURE at v1 (adds mode complexity before users understand the feature).

---

### Q5 — Cross-map shape visibility

**ArcGIS Experience Builder / Dashboards:** The Filter widget "affect[s] data across your app, so other widgets that use the same data source are updated accordingly." Map elements share selection state when configured to act on the same layer. Confidence: HIGH (official docs).

**Foursquare Studio:** Drawing tool creates boundaries on "the map" — single map per view context, so cross-map sharing is not an explicit pattern in their model.

**The v1.5 locked decision (from milestone spec):** Drawn shapes are dashboard-scoped overlays — every map widget in the dashboard renders all current shapes. This is architecturally equivalent to `useFilterStore` being table-keyed but dashboard-scoped (all map widgets see the same filter chips). ArcGIS Dashboards validates this pattern as the right default for a BI context.

**Implementation note:** The `drawnShapesStore` Zustand slice is dashboard-scoped, so all map widgets subscribe to the same shapes array. Each `MapChartRenderer` renders shapes as a VectorLayer. This means visual duplication of shape overlays across map widgets — which is the correct behaviour for indicating "this filter applies everywhere".

---

### Q6 — Spatial-filter chip representation

**No authoritative standard found** for how spatial filter shapes appear in filter bars. Research synthesis from partial evidence:

**Kepler.gl:** Polygon geometry filters appear in the Filters side panel as a filter entry with the dataset name + a polygon icon. No inline mini-map or coordinate summary.

**ArcGIS Dashboards:** Selection-based filters do not produce a filter-bar chip in the traditional sense — they produce a visual selection highlight on the map. Clearing is done via a "Clear selection" tool, not a chip.

**Foursquare Studio:** Geospatial filter "will appear in the filter panel" with the shape's boundary name. No inline coordinates or mini-map.

**General BI tools (Tableau, Looker, Metabase):** Column-filter chips show the column name + value. For spatial shapes (no column name), the label must describe the shape itself.

**Recommendation (synthesised, LOW confidence — no single authoritative source):**
- Text summary chip: "Bbox 1", "Lasso 1", "Circle 1" (auto-numbered per type per session) — matches how column-filter chips use the column name as the primary label, with the value being the filter detail. The shape type + index is the equivalent of "column name".
- Do NOT show coordinates in the chip label — "Circle near 40.7°N, 74.0°W, r=2.5km" is too verbose for the chip bar; coordinates belong in the persistent map label on the shape.
- Do NOT show a mini-map inline in the chip — this is a significantly higher implementation cost with no clear BI-tool precedent.
- Optional: show measurement in parentheses as secondary text: "Circle 1 (2.5 km)" — a differentiator, moderate complexity.

---

### Q7 — Draw mode vs existing chart interactions

**Nielsen Norman Group (HIGH confidence):** "A mode occurs when the same user action can have different results depending on the state of the system." The correct resolution is: the currently active mode OWNS the interaction. If Draw-Bbox mode is active, a mouse click on the map canvas starts the bbox draw, even if that click lands visually over a chart widget. Chart widgets (bar/pie/scatter) are in separate DOM containers — they receive their own click events independently. The map canvas click is consumed by the OL Draw interaction.

**Mapbox GL Draw:** In any `draw_*` mode, the map canvas clicks are consumed by the draw interaction; existing feature-click handlers are suppressed. Confidence: HIGH (MODES.md documented behaviour).

**Practical decision for v1.5:** When any draw mode (Bbox / Lasso / Circle) is active on a map widget:
- Map canvas clicks → consumed by OL Draw interaction (draw commits or adds vertex).
- The Info mode singleclick listener (Effect 6) is suppressed — this is already handled by the mode gate in `MapChartRenderer`.
- Clicks on other chart widgets (bar/line/pie/scatter) outside the map DOM → those chart components receive their events normally and CAN still trigger column-filter drill-downs. This is the correct behaviour: draw mode scopes interaction to the map canvas only.
- This is NOT a conflict — it is a non-issue because chart clicks and map canvas clicks are in separate DOM trees.

**Anti-feature:** Making chart drill-down clicks also active while in draw mode on the same map widget canvas — this would be confusing because the user explicitly picked a draw mode, indicating they intend map interaction. The mode must be respected.

---

### Q8 — Lasso polygon vertex caps

**OL freehand polygon:** With `freehand: true`, OL adds a vertex on every `pointermove` event while the pointer is down. A 5-second lasso at 60 fps could produce 300+ vertices.

**Mapbox GL Draw + nebula.gl:** Documentation for napari's lasso tool implementation states "vertices are added only if the vertex to be added is at least 10 screen pixels away from the previous vertex" — this is a minimum inter-vertex distance threshold, not a cap. This approach is better than a hard vertex cap because it naturally limits vertices proportional to the shape's complexity.

**Douglas-Peucker simplification (HIGH confidence — algorithm well-documented):** Industry-standard algorithm for post-draw simplification. OL provides `Geometry.simplify(tolerance)` which implements the Douglas-Peucker algorithm natively (confirmed from STACK.md). Applied after draw completion before storing the shape.

**Kinetica SQL impact:** A WKT `POLYGON` with 300+ vertices is sent as a string literal in the WHERE clause of the materialized view DDL. No SQL IN-clause limit applies (this is a geometry comparison, not an IN list). However, extremely large WKT strings increase query parse time and may hit Kinetica's SQL statement length limits (undocumented — spike risk).

**Recommendation:** Apply Douglas-Peucker simplification on draw commit with a tolerance of approximately 1 map pixel at the current zoom level (OL `map.getView().getResolution()` gives meters-per-pixel). This automatically adapts simplification to zoom level. No hard vertex cap needed; simplification handles the complexity organically. If the simplified polygon still exceeds a threshold (e.g., 200 vertices), warn the user with a toast ("Shape simplified to 200 points"). Confidence: MEDIUM (pattern from adjacent tools; Kinetica limit is unconfirmed — spike needed).

---

### Q9 — Spatial-filter naming / labeling

**Kepler.gl:** Layers can be renamed by clicking the layer name — but drawn polygon geometry filters are not separately user-nameable in the filter panel (they appear with dataset name, not a custom shape name).

**Foursquare Studio:** No user-naming of drawn shapes documented.

**ArcGIS Web AppBuilder Draw widget:** No user-naming — shapes are added to the map as plain graphic overlays.

**General pattern:** Drawn shapes in BI tools are NOT user-named in v1 implementations. Auto-labeling by type + sequence number is the universal approach for v1 (e.g., "Bbox 1", "Lasso 2", "Circle 3"). User-naming / renaming is a differentiator for v2+ (when users have multiple sessions worth of shapes saved somewhere, naming becomes useful; for session-only shapes it is low-value).

**V1 recommendation:** Auto-label shapes as "{Type} {N}" where Type = "Bbox" / "Lasso" / "Circle" and N = sequential draw order within the session (not per-type). The sequential number resets on dashboard-switch or logout (mirrors `useFilterStore` lifecycle). User-editable shape names are explicitly deferred.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features that users of a BI spatial-filter tool assume will work. Missing these = product feels broken or incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Per-map toolbar with Pan / Info / Bbox / Lasso / Circle mode buttons** | Every production tool (ArcGIS, Foursquare, Mapbox GL Draw, Tableau) uses a toolbar button group for mode switching. Without a visible toolbar, users cannot discover draw tools exist. | LOW | 5 icons: Pan (hand cursor), Info (existing v1.4 singleclick), Bbox (rectangle), Lasso (freehand pen), Circle. Active button receives visual depression + cursor changes. |
| **Cursor change per mode** | NNG: at least two simultaneous visual signals required for mode visibility. Cursor change is the second signal (toolbar highlight is the first). Without cursor change, users cause accidental mode-slips. | LOW | Pan = grab; Info = crosshair or pointer; Bbox = crosshair; Lasso = pen; Circle = crosshair. Set via `map.getTargetElement().style.cursor`. |
| **Bbox draw: click-drag-release** | Universal across ArcGIS Dashboards, Foursquare, Mapbox GL Draw. Users expect click-and-drag for rectangle. No click-click-click polygon needed. | LOW | OL `createBox()` with `type:'Circle'` — confirmed from STACK.md. `freehand:false`. |
| **Lasso draw: click-drag-release (freehand)** | Non-GIS users cannot learn click-click-click polygon. Freehand is the BI-appropriate lasso: click, drag to draw, release to commit. | LOW | OL `type:'Polygon'` with `freehand:true`. Pointer-down = start, pointer-up = commit. ESC cancels. |
| **Circle draw: click (center) + drag (radius) + release** | Standard circle-draw UX across ArcGIS, Mapbox GL Draw. | LOW | OL `type:'Circle'` with `createRegularPolygon(64)` geometryFunction → produces Polygon WKT. |
| **ESC key cancels mid-draw** | Universal cancel affordance (Mapbox GL Draw, ArcGIS, general OS convention). Users who start an accidental draw need a clear escape. | LOW | OL `Draw` interaction's `abortDrawing()` method + return to previous mode. Wire to `keydown` ESC on the map element. |
| **Committed shape visible on map as semi-transparent overlay** | Every GIS/BI tool shows drawn shapes as persistent vector overlays. Without this, users cannot tell what they drew. | LOW | OL VectorLayer + VectorSource. Default fill: 10% opacity color-coded (e.g. blue). Outline: 2px solid. |
| **Multiple shapes accumulate (no auto-replace)** | ArcGIS Dashboards, Foursquare Studio, Kepler.gl all allow multiple drawn shapes. Single-shape-only (auto-replace) is an anti-feature that prevents multi-region exploration. | LOW | `drawnShapesStore` holds an array; each draw commit appends. |
| **Drawn shapes OR together into spatial predicate** | ArcGIS Dashboards confirmed: "multiple spatial filters work with OR logic." mapuipatterns.com: filters within a category use OR. This is the correct default for multi-region exploration. | MEDIUM | `(STXY_WITHIN(x, y, ST_GEOMFROMTEXT('POLYGON ...')) = 1 OR STXY_WITHIN(x, y, ST_GEOMFROMTEXT('POLYGON ...')) = 1)` — server builds this OR-chain from the shapes array. |
| **Spatial predicate ANDs with column-filter chain** | The v1.3 materialize pipeline already composes column filters as an AND chain. Spatial predicates must be composed as `(spatial_OR_block) AND (col_filter_AND_chain)`. Without this, spatial and column filters conflict instead of composing. | MEDIUM | `whereClause.ts` extended to prepend the spatial OR block. Same materialize endpoint + LAYERS-swap pattern. |
| **FilterBar chip per drawn shape with × removal** | v1.3 established the filter chip as the universal removal affordance for this app. Spatial filter chips must participate in the same bar to feel consistent. | MEDIUM | One chip per shape in `drawnShapesStore`. Chip × removes the shape from the store + triggers re-materialize. Mixed in with column-filter chips (ordered: column chips first, spatial chips after, or interleaved by draw time). |
| **Cross-map shape visibility (all map widgets show all shapes)** | ArcGIS Dashboards confirmed: filter widgets affect all widgets using the same data. For a BI dashboard, a spatial filter must be visible on every map widget to avoid confusion about "which map is filtered". | MEDIUM | `drawnShapesStore` is dashboard-scoped (Zustand, not map-instance-scoped). Each `MapChartRenderer` subscribes and renders a VectorLayer from the shared store. |
| **Shapes clear on dashboard-switch and logout** | v1.3/v1.4 established this as the reset contract for all session state (`useFilterStore`, `useInfoSelectionStore` both reset on these events). Spatial filter state must mirror this contract. | LOW | `drawnShapesStore.reset()` wired into `App.tsx` UNAUTHORIZED + `DashboardsPage.tsx` DashboardOpen cleanup. Fourth store after the existing three. |
| **"Clear all spatial filters" toolbar button** | Foursquare Studio has a clear drawing function; ArcGIS Dashboards has a "Clear selection" tool. Per-map bulk removal is the fastest recovery from an accidental multi-shape draw. | LOW | One extra button in `MapDrawToolbar` (e.g., trash icon). Calls `drawnShapesStore.clearAll()`. Only visible when `shapes.length > 0`. |
| **Shape removal via click-shape + Delete key** | Mapbox GL Draw's `simple_select` mode standard: select feature → Delete key removes it. Recognized by technically-literate BI users (data engineers). | MEDIUM | Requires a "selected shape" state per map. Click on a committed shape highlights it; Delete key removes it from the store. Lower priority than chip × (chip × is more discoverable); but expected by GIS-literate users. |
| **Live measurement label during draw** | OpenLayers official measure example establishes this as the reference implementation. Without any feedback during draw, users cannot tell how large their shape is relative to the data. | LOW | OL `Draw` geometry change listener → update tooltip at cursor position. Circle: radius in km/m. Bbox: W×H in km/m. Lasso: area in km²/m². |
| **Spatial config per map widget: target tables + spatial columns** | The operator needs to specify which tables the spatial filter applies to (not all tables have spatial columns). Without per-widget config, the filter might try to apply to non-spatial tables. | MEDIUM | Per-widget config: list of `{targetTable, spatialColumn, spatialMode}` entries. Stored in SQLite (new column on `widgets` table or separate `widget_spatial_targets` join table). Config UI in MapConfigPanel. |

---

### Differentiators (Competitive Advantage)

Features that set this tool apart. Not required, but add clear value.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Persistent measurement label on committed shape** | ArcGIS Earth shows radius/area/perimeter after commit. For spatial data exploration, knowing "this region covers 25 km²" contextualises the filter results. Most BI tools omit this. | LOW | Static OL Overlay element pinned to shape centroid. Text: "2.5 km radius" / "5.1 km × 3.2 km" / "12.4 km²". Disappears when shape is removed. |
| **Lasso Douglas-Peucker simplification after commit** | Automatically reduces freehand polygon vertex count before storing/sending to SQL. Results in cleaner shapes and shorter WKT strings without user awareness. | LOW | OL `Geometry.simplify(toleranceMeters)` called on the committed geometry. Tolerance = current map resolution (meters/pixel) × 2. No user interaction needed. |
| **Measurement in chip secondary text** | "Circle 1 (2.5 km)" — contextualises the filter at a glance in the FilterBar without opening the map. | LOW | Compute measurement at commit time, store alongside shape in `drawnShapesStore`. Render as a muted secondary text in the chip. Dependency: measurement label computed during draw (table stakes). |
| **Shape highlight on chip hover** | Hovering a spatial filter chip in the FilterBar highlights the corresponding shape on all maps (e.g., pulsed outline or elevated opacity). Inverse: hovering a shape on the map highlights the chip. Helps users understand shape-chip correspondence when multiple shapes exist. | MEDIUM | Requires a `hoveredShapeId` state in the store + CSS animation on the VectorLayer style. Dependency: shape identity (ID) stored per chip and per VectorLayer feature. |
| **Info mode preserved across draw-mode activation** | If the user was in Info mode (v1.4 popup) before switching to a draw tool, returning to Info mode after draw commit is automatic. Users do not need to re-select Info manually. | LOW | Store `previousMode` before entering draw mode; restore on draw commit or ESC cancel. |
| **WKB-binary spatial column support for spatial filter targets** | TD-V14-WKB-SPIKE — if the WKB spike resolves in v1.5, spatial filter targets can include WKB-binary columns (not just lat/lon + WKT). Unified support across all three spatial modes. | HIGH | Depends on TD-V14-WKB-SPIKE resolution. Treat as blocked until spike runner succeeds. Do not scope into v1.5 requirements unless spike passes. |

---

### Anti-Features (Explicitly Excluded)

Features that seem natural but create confusion, implementation burden, or UX regression.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Per-shape AND/OR/SUBTRACT toggle** | GIS power users want precise boolean algebra (clip one region out of another). | Adds a mode picker per shape that non-GIS BI users do not understand. "What does AND mean between two circles?" requires explanation. Foursquare uses implicit OR; ArcGIS uses implicit OR. Implicit is always safer for v1. | Implicit OR between shapes (locked at v1). Per-shape boolean algebra is a v3+ GIS-power-user feature. |
| **Vertex editing of committed shapes** | Users want to refine a rough lasso after drawing. | Requires OL Modify interaction + shape-selection state machine that conflicts with Info mode singleclick handler. Kepler.gl (closest peer) does not ship vertex editing for filter polygons. | Delete-and-redraw. For lasso shapes, the freehand UX is fast enough that redrawing is acceptable. |
| **Shape persistence across sessions (save to SQLite)** | "I want my region to still be there tomorrow." | Session-only mirrors v1.3/v1.4 filter store contract. Persisting shapes requires a `drawn_shapes` SQLite table + migration + a load-on-dashboard-open flow that must handle stale geometries (data may have moved). | Session-only for v1.5. Named/saved shapes are a v2 feature, analogous to saved filter sets deferred from v1.3. |
| **Shareable spatial filter URLs** | Analysts want to share "the NYC downtown circle filter" with a colleague. | Same problem as shareable column-filter URLs (deferred in v1.3 research). Shapes are session + user-scoped. Sharing requires URL encoding of WKT geometry (large URL), re-materialize on recipient load, and handling of permission mismatches. | Defer to v2. The chip text label ("Circle 1 (2.5 km)") is enough for verbal sharing of what to draw. |
| **Hover-only measurement tooltip (no persistent label)** | Seems lightweight — show measurement only on hover, not always. | Hover state on VectorLayer features conflicts with the existing Info mode singleclick listener (Effect 6). A map hover that shows measurements would need to suppress the info popup trigger, creating mode conflict. | Live tooltip during draw (table stakes) + persistent static label after commit (differentiator). No hover-only mode needed. |
| **Import / export shape as GeoJSON or KML** | Power users want to bring in existing boundaries (city limits, sales territories). | Import requires a file-upload UI, format parsing, projection transforms, and validation of arbitrary geometry complexity. Export is less harmful but adds to scope. Neither is validated as a team need. | Defer to v2. The draw tools cover the core exploration use case. |
| **Snap-to-feature drawing** | Snap drawn shapes to existing data features (e.g., snap a bbox to a point cluster). | Requires feature-proximity calculation during draw — significant complexity. No BI tool at this level ships snapping. | Free-form drawing without snapping. Zoom in to draw precise shapes. |
| **Circle as a true sphere-distance predicate (not polygon approximation)** | A 64-sided polygon approximation of a circle has ~0.5% area error at the equator. Some users want a true `ST_DWITHIN` sphere-distance filter. | `STXY_DWITHIN` is the correct Kinetica predicate for true circle radius, but requires storing the centre point + radius (not a WKT polygon) as a separate shape type. This splits the shape data model: polygon shapes use WKT; circle shapes use (x, y, radius_m). | For v1.5, use `createRegularPolygon(64)` → WKT POLYGON for all three shape types. Uniform data model. The 0.5% approximation error is irrelevant for BI spatial exploration. If a v2 need for precise radius emerges, add `STXY_DWITHIN` as an optional predicate for circle-type shapes. |
| **Per-shape boolean toggle between spatial filter and spatial highlight** | "Show me what's in this region but don't filter everything else out." | Two different data products: filtering (removes non-matching data from all widgets) vs highlighting (marks matching rows). Highlighting requires a different pipeline (not materialized-view-based). | v1.5 is filter-only. Highlight (mark subset without removing others) is a distinct v2+ feature. |

---

## Feature Dependencies

```
[Spatial filter targets config (per-map widget)]
    └──required by──> [Spatial predicate WHERE clause builder]
                          └──required by──> [Bbox / Lasso / Circle draw → materialize]

[drawnShapesStore Zustand slice]
    └──required by──> [Bbox commit → store]
    └──required by──> [Lasso commit → store]
    └──required by──> [Circle commit → store]
    └──required by──> [FilterBar spatial chips]
    └──required by──> [Cross-map VectorLayer rendering]
    └──required by──> [Materialize trigger on store change]

[MapDrawToolbar component]
    └──required by──> [Mode switching (Pan/Info/Bbox/Lasso/Circle)]
    └──required by──> [Cursor change per mode]
    └──required by──> [Clear all spatial filters button]
    └──required by──> [ESC cancel wiring]

[OL Draw interaction (Bbox/Lasso/Circle)]
    └──required by──> [Live measurement tooltip]
    └──requires──> [Mode gate in MapChartRenderer Effect 6 (Info singleclick)]
    └──requires──> [VectorLayer + VectorSource on each map]

[FilterBar spatial chips]
    └──requires──> [drawnShapesStore shape array]
    └──requires──> [chip × → removeShape + re-materialize]
    └──enhanced by──> [measurement in chip secondary text] (differentiator)
    └──enhanced by──> [chip hover → shape highlight] (differentiator)

[Persistent measurement label on committed shape]
    └──requires──> [drawnShapesStore shape metadata (measurement string)]
    └──requires──> [OL Overlay per shape]
    └──enhanced by──> [measurement in chip secondary text] (differentiator)

[Click-shape + Delete key removal]
    └──requires──> [selected shape state per map]
    └──requires──> [drawnShapesStore removeShape action]

[WKB spatial column support for filter targets]
    └──blocked by──> [TD-V14-WKB-SPIKE resolution]
```

### Dependency Notes

- **Config before predicates:** The spatial filter targets config (which tables + columns the filter applies to) must be designed and stored before the predicate builder can emit correct WHERE clauses. If config is missing, the filter applies to no tables (safe but silent failure).

- **Mode gate is the critical coordination point:** The `MapChartRenderer` Effect 6 singleclick handler (Info popup) must check the current draw mode before registering. When any draw mode is active, Effect 6 must not add the singleclick listener. This is the primary cross-cutting concern between v1.4 (Info popup) and v1.5 (Draw tools).

- **drawnShapesStore drives everything:** FilterBar chips, VectorLayer rendering, materialize trigger, chip labels — all derive from the shapes array. The store is the single source of truth. Design it carefully before building consumers.

- **Measurement label requires computation at commit time:** The persistent label and chip secondary text both need the measurement value. Compute it at commit time (draw interaction `drawend` event) using the OL geometry's `getArea()` / `getLength()` / custom radius computation, then store as a string in `drawnShapesStore`. Do not recompute on every render.

- **Shape-selection state (click + Delete) conflicts risk:** If a shape-selection state is added to support click + Delete key, it must not interfere with the Info mode singleclick handler. Consider: only enable shape selection when a draw mode is active (not Info or Pan mode).

---

## MVP Definition for v1.5

### Must Ship (Core Spatial Drawing Filter)

- [ ] `MapDrawToolbar.tsx` — Pan / Info / Bbox / Lasso / Circle mode icons, mutual exclusion, cursor change, active state highlight
- [ ] `drawnShapesStore.ts` — Zustand slice: shapes array, addShape / removeShape / clearAll / reset; measurement metadata per shape; dashboard-scoped session-only
- [ ] OL Draw interaction wiring in `MapChartRenderer` — Effect 7 mounts/unmounts Draw interaction per active mode; commits to `drawnShapesStore` on `drawend`
- [ ] ESC cancel mid-draw — `abortDrawing()` on keydown ESC; return to previous mode
- [ ] Live measurement tooltip during draw — OL geometry change listener → overlay at cursor; circle radius / bbox W×H / lasso area
- [ ] Douglas-Peucker simplification on lasso commit — `geometry.simplify(resolution × 2)` before store commit
- [ ] VectorLayer per map widget — renders all shapes from `drawnShapesStore`; semi-transparent fill, solid outline
- [ ] Cross-map shape visibility — all map widgets subscribe to `drawnShapesStore` and render the same shapes
- [ ] Persistent measurement label on committed shape — static OL Overlay at centroid; text: radius/W×H/area
- [ ] Per-map spatial filter targets config — `MapConfigPanel` section; list of `{targetTable, spatialColumn, spatialMode}` entries; stored in SQLite
- [ ] Spatial WHERE predicate builder — `server/src/lib/spatialWhereClause.ts`; builds `STXY_WITHIN(x, y, ST_GEOMFROMTEXT(?)) = 1` per shape per spatial mode; OR-chains multiple shapes
- [ ] `whereClause.ts` extension — prepends spatial OR block before column AND chain
- [ ] Materialize trigger on shape store change — existing `AggregatedWidgetRenderer` debounce pattern extended to watch `drawnShapesStore`; triggers re-materialize for each spatial target table
- [ ] FilterBar spatial chips — one chip per shape, auto-label "{Type} {N}" (Bbox 1, Lasso 2, Circle 3), chip × removes shape
- [ ] `drawnShapesStore.reset()` wired into App.tsx UNAUTHORIZED + DashboardsPage DashboardOpen (4th store)
- [ ] "Clear all spatial filters" toolbar button — trash icon in `MapDrawToolbar`, only visible when `shapes.length > 0`

### Add After Core (Differentiators)

- [ ] Measurement in FilterBar chip secondary text — "Circle 1 (2.5 km)"; requires measurement stored in drawnShapesStore (already in must-ship)
- [ ] Info mode auto-restored after draw commit — store `previousMode` before switching to draw; restore after commit or ESC
- [ ] Shape highlight on chip hover — `hoveredShapeId` in store + VectorLayer style function; MEDIUM complexity, skip if timeline is tight

### Defer to v2+

- [ ] Vertex editing of committed shapes — requires OL Modify interaction + shape-selection state; Kepler.gl peer skips this
- [ ] Per-shape AND/OR boolean toggle — power-user GIS; implicit OR is correct for v1 BI users
- [ ] Named/saved shapes (persisted to SQLite) — session-only is correct for v1; same rationale as column filters
- [ ] WKB-binary spatial column support for filter targets — blocked by TD-V14-WKB-SPIKE
- [ ] Import / export GeoJSON / KML shapes
- [ ] Shareable spatial filter URLs

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| MapDrawToolbar mode buttons + cursor | HIGH | LOW | P1 |
| drawnShapesStore Zustand slice | HIGH | LOW | P1 |
| Bbox / Lasso / Circle OL draw wiring | HIGH | LOW | P1 |
| ESC cancel mid-draw | HIGH | LOW | P1 |
| VectorLayer + cross-map shape visibility | HIGH | LOW | P1 |
| Live measurement tooltip during draw | HIGH | LOW | P1 |
| Spatial targets config (per-map SQLite) | HIGH | MEDIUM | P1 |
| Spatial WHERE predicate builder | HIGH | MEDIUM | P1 |
| whereClause.ts extension (spatial + col AND) | HIGH | MEDIUM | P1 |
| Materialize trigger extension | HIGH | MEDIUM | P1 |
| FilterBar spatial chips | HIGH | MEDIUM | P1 |
| Session lifecycle reset (4th store) | HIGH | LOW | P1 |
| Clear-all spatial filters button | HIGH | LOW | P1 |
| Douglas-Peucker simplification on lasso | MEDIUM | LOW | P1 |
| Persistent measurement label on shape | MEDIUM | LOW | P1 |
| Measurement in chip secondary text | MEDIUM | LOW | P2 |
| Info mode auto-restored after draw | LOW | LOW | P2 |
| Shape highlight on chip hover | MEDIUM | MEDIUM | P2 |
| Click-shape + Delete key removal | MEDIUM | MEDIUM | P2 |
| Vertex editing of committed shapes | LOW | HIGH | P3 |
| WKB-binary filter target support | MEDIUM | HIGH | P3 (blocked) |
| Named/saved shapes | LOW | HIGH | P3 |
| Import / export GeoJSON / KML | LOW | HIGH | P3 |

---

## Kinetica Spatial Predicate Summary (for WHERE clause builder)

Verified from Kinetica 7.1 official docs. Confidence: HIGH.

| Spatial Mode | Shape Type | Recommended Predicate | Notes |
|---|---|---|---|
| lat/lon columns | All (Bbox/Lasso/Circle as WKT POLYGON) | `STXY_WITHIN(lon_col, lat_col, ST_GEOMFROMTEXT('POLYGON ((...))')  ) = 1` | Fastest for point data; STXY_* variants preferred over ST_* per Kinetica idioms established in v1.4 |
| WKT column | All (Bbox/Lasso/Circle as WKT POLYGON) | `ST_WITHIN(wkt_col, ST_GEOMFROMTEXT('POLYGON ((...))')  ) = 1` | Geometry-to-geometry comparison |
| WKB column | All | Deferred — TD-V14-WKB-SPIKE | Do not implement until spike resolves |

**Multiple shapes:** OR-chain each shape's predicate: `(pred_shape1 OR pred_shape2 OR ...)`.
**Combined with column filters:** `(spatial_OR_block) AND col_filter_1 AND col_filter_2 ...`.

**Coordinate system:** OL geometries are in EPSG:3857 (Web Mercator). Must transform to EPSG:4326 (WGS84 lon/lat) before WKT serialisation. OL `transform(geom, 'EPSG:3857', 'EPSG:4326')` or `writeGeometry` with projection options — confirmed pattern from STACK.md.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Spatial targets config SQLite schema | Choosing wrong granularity (per-widget vs per-dashboard) creates migration pain later | Per-widget is correct — different map widgets in the same dashboard may have different spatial columns. JSON blob column or dedicated join table. |
| Spatial predicate + materialized view DDL | Kinetica SQL statement length limits for large WKT polygons are undocumented | Spike: test with a 200-vertex WKT POLYGON in `CREATE OR REPLACE MATERIALIZED VIEW ... AS SELECT ... WHERE STXY_WITHIN(...)`. |
| Mode gate in MapChartRenderer Effect 6 | Adding a mode check to an existing complex Effect creates ordering/stale-closure bugs | Pattern: store active mode in a `useRef` (not state) that Effect 6 reads synchronously inside the singleclick callback. Mode ref is set by `MapDrawToolbar`'s mode prop. |
| Cross-map VectorLayer rendering | Each `MapChartRenderer` mounts its own VectorLayer from the shared store — if the store update fires during OL render, effects may see stale geometry | Use `useEffect` dependency on store `shapeVersion` counter (same pattern as `materializeVersion` in useFilterViewStore) to ensure OL VectorSource is rebuilt only after store settles. |
| Lasso freehand vertex accumulation | Very fast freehand lasso strokes can produce 500+ vertices before simplification | Apply simplification immediately in `drawend` handler before calling `addShape`. Log vertex count pre/post simplification during development. |
| FilterBar chip ordering | Mixing column-filter chips (from v1.3) and spatial-filter chips (new) in one bar may produce confusing ordering | Group by type: column chips first (existing), spatial chips after; or interleave by timestamp. Decide before Phase 1 of v1.5. |
| WKB spatial column support | TD-V14-WKB-SPIKE is carry-over from v1.4. If the spike is run during v1.5, it may need to be integrated into the spatial predicate builder | Include a stub `'wkb' → throw SpatialFilterWkbDeferredError` path in `spatialWhereClause.ts`, mirroring the v1.4 info-query pattern. |

---

## Competitor Feature Analysis

| Feature | Tableau | ArcGIS Dashboards | Kepler.gl | Foursquare Studio | Mapbox GL Draw | Our v1.5 Approach |
|---------|---------|-------------------|-----------|-------------------|----------------|-------------------|
| Mode switching | Toolbar dropdown (select tools) + keyboard shortcuts | Selection tool dropdown on map element | Side panel draw button | Polygon icon in map toolbar | `changeMode()` API | Explicit 5-button toolbar row |
| Draw tools | Rectangular / Lasso / Radial | Rectangle / Lasso / Circle / Line | Rectangle / Polygon (click-click) / Freehand | Polygon / Rectangle | Polygon / Line / Point (+ custom modes) | Bbox / Lasso (freehand) / Circle |
| Cancel mid-draw | Not documented | ESC (implied by OS convention) | ESC or double-click | Not documented | ESC via `onKeyUp` handler | ESC → `abortDrawing()` |
| Shape removal | Click mark + Delete | Clear selection tool | Delete from filter panel | Select + Delete tooltip | Select + Delete key | Chip × + Click+Delete + Clear-all toolbar |
| Measurement during draw | None (no measurement on selection shapes) | Circle radius shown (limited) | None | None | None | Live tooltip: radius/W×H/area |
| Measurement after commit | None | Center coords + radius + area | None | None | None (area calculation demo only) | Persistent centroid label |
| Multi-shape boolean | OR (implicit) | OR (confirmed "union of polygons") | OR (implicit in geometry filter) | AND (confirmed) | Custom (user builds) | OR (implicit, locked) |
| Cross-widget update | Yes (all charts on same data source) | Yes (via layer actions) | Yes (all layers affected) | Yes (filter affects all layers) | App-level (library provides geometry, app decides) | Yes (dashboard-scoped drawnShapesStore) |
| Filter chip / label | Selection count shown, not chip | No chip in traditional filter bar sense | Filter panel entry (dataset name) | Filter panel entry (boundary name) | No built-in chip (library only) | FilterBar chip: "Bbox 1", "Lasso 2", "Circle 3" |
| User-named shapes | No | No | No (layer names only) | No | No | No (auto-label only in v1.5) |
| Session-only | Yes | Yes | Yes (unless saved project) | Yes (unless saved) | Yes | Yes (session-only) |

---

## Sources

- Foursquare Studio Geospatial Filters docs: https://docs.foursquare.com/analytics-products/docs/filters-geospatial — HIGH confidence (official, current)
- Mapbox GL Draw MODES.md: https://github.com/mapbox/mapbox-gl-draw/blob/main/docs/MODES.md — HIGH confidence (official, current)
- Mapbox GL Draw API.md: https://github.com/mapbox/mapbox-gl-draw/blob/main/docs/API.md — HIGH confidence (official, current)
- ArcGIS Dashboards Map Element docs: https://doc.arcgis.com/en/dashboards/latest/get-started/map-element-and-tools.htm — HIGH confidence (official, current)
- ArcGIS Dashboards Filter docs: https://doc.arcgis.com/en/dashboards/latest/get-started/filter-data.htm — HIGH confidence (official)
- ArcGIS Experience Builder Filter Widget: https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/filter-widget.htm — HIGH confidence (official)
- Kinetica Geospatial Functions: https://docs.kinetica.com/7.1/location_intelligence/geo_functions/ — HIGH confidence (official, v7.1)
- OpenLayers Measure example: https://openlayers.org/en/latest/examples/measure.html — HIGH confidence (official, v10.9.0 confirmed installed)
- OpenLayers Draw Shapes example: https://openlayers.org/en/latest/examples/draw-shapes.html — HIGH confidence (official)
- Nielsen Norman Group — Modes in User Interfaces: https://www.nngroup.com/articles/modes/ — HIGH confidence (primary UX research)
- Map UI Patterns — Feature Selection: https://mapuipatterns.com/feature-selection/ — MEDIUM confidence (curated pattern library, not an academic primary source)
- Map UI Patterns — Spatial Filter: https://mapuipatterns.com/spatial-filter/ — MEDIUM confidence (same)
- Kepler.gl Filters user guide: https://docs.kepler.gl/docs/user-guides/e-filters — MEDIUM confidence (official but spatial drawing details sparse)
- Kepler.gl GitHub issue #389 (draw polygon): https://github.com/keplergl/kepler.gl/issues/389 — MEDIUM confidence (GitHub issue, not docs)
- ArcGIS community thread on spatial filter OR logic: https://community.esri.com/t5/arcgis-dashboards-questions/problems-while-adding-spatial-filters-to-multiple/td-p/1369390 — MEDIUM confidence (community confirmation of OR behaviour)
- Tableau selection methods: https://www.pluralsight.com/resources/blog/guides/selection-methods-in-tableau-maps — MEDIUM confidence (secondary)
- Tableau map toolbar guide: https://www.maine.gov/doe/sites/maine.gov.doe/files/bulk/tableau/How_to_use_the_Tableau_Map_Toolbar.pdf — MEDIUM confidence (secondary, older)
- Walker Data lasso selection + R/shiny: https://walker-data.com/posts/lasso-selection/ — LOW confidence (implementation example, not UX authority)
- CARTO spatial filters reference: https://docs.carto.com/carto-for-developers/reference/filters/spatial-filters — LOW confidence (dev-facing, not UX doc)
- STACK.md (v1.5 already-written): /Users/rydelpereira/Documents/projects/codex_kinetica_bi/.planning/research/STACK.md — HIGH confidence (confirmed from installed OL source)
- PROJECT.md (v1.5 milestone spec): /Users/rydelpereira/Documents/projects/codex_kinetica_bi/.planning/PROJECT.md — HIGH confidence (operator-locked decisions)

---
*Feature research for: Kinetica BI v1.5 Spatial Filtering on Map — Interactive spatial drawing UX*
*Researched: 2026-05-11*
