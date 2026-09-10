# Research Summary: v1.5 Spatial Filtering on Map

**Project:** Kinetica BI — v1.5 Spatial Filtering on Map
**Domain:** Interactive spatial drawing + server-side spatial WHERE-clause filtering on an existing brownfield React + OpenLayers + Kinetica BI app
**Researched:** 2026-05-11
**Confidence:** HIGH (Stack: confirmed from installed source; Architecture: derived from actual codebase reads; Features: cross-validated against ArcGIS, Foursquare, Mapbox GL Draw official docs; Pitfalls: grounded in OL source + existing codebase effect structure)

---

## Executive Summary

v1.5 adds interactive spatial drawing (bbox, lasso, circle) directly onto the existing OpenLayers map widgets, wiring drawn shapes into the established v1.3 materialize-view filter pipeline. All four researchers converged on the same execution model: zero new npm packages (ol@10.9.0 already contains every required API), a dashboard-scoped session-only Zustand slice (useSpatialFilterStore) as the single source of truth for committed shapes, and the AggregatedWidgetRenderer remaining the sole materialize trigger. The new spatial WHERE predicates compose into the existing pipeline as a parenthesised OR block ANDed with the column-filter AND chain, exactly mirroring the v1.3 architecture composability pattern.

The recommended approach is to front-load a Kinetica predicate availability spike before committing to any SQL builder implementation. All four research files independently converged on this as the P1 blocker: STXY_CONTAINS(ST_GEOMFROMTEXT(POLYGON(...)), lon_col, lat_col) = 1 and ST_INTERSECTS(wkt_col, ST_GEOMFROMTEXT(POLYGON(...))) = 1 are confirmed from Kinetica 7.1 docs but have not been live-probed against the deployed instance. This mirrors the v1.3 S1-S4 spike pattern and the v1.4 Phase 18 spike pattern, both of which were mandatory before those phases SQL builders were written. The spike is a direct prerequisite to Phase 1 coding lock.

The highest-priority execution risk is the OL Draw interaction conflicting with the v1.4 singleclick info-popup handler (V15-P-01). All four researchers identified this as the top pitfall. The mitigation is a mode-aware guard at the top of Effect 6s singleclick handler, not the unreliable stopClick: true OL option. Secondary risks are Mercator distortion for circle radius at high latitudes (use ol/sphere.getDistance, not raw EPSG:3857 radius), OR-clause parenthesis omission with multiple shapes (single-shape works silently, multi-shape breaks column filters), and freehand lasso vertex explosion into the SQL WHERE clause (Douglas-Peucker simplification mandatory at drawend). The committed-shapes-only Zustand design (no in-progress geometry in the store) is the non-negotiable architecture lock that prevents cross-map re-render thrash during live drawing.

---

## Key Findings

### Recommended Stack

No new dependencies are required for v1.5. The installed ol@10.9.0 provides all APIs needed: ol/interaction/Draw with createBox(), createRegularPolygon(64), and freehand: true; ol/format/WKT with writeGeometry projection options; ol/geom/Geometry.simplify(); and ol/sphere getArea/getLength/getDistance for ellipsoidal measurements. The toolbar is a React-rendered div absolutely positioned over the map canvas, NOT an ol/control/Control subclass, to avoid React/OL lifecycle conflicts (the GAP-24-01-A root cause family).

**Core technologies (all pre-existing):**
- ol@10.9.0: Draw interactions, VectorLayer, WKT serialisation, sphere measurements confirmed in installed source
- zustand (existing): useSpatialFilterStore session-only slice, mirrors useInfoSelectionStore shape
- React 18 + TypeScript (existing): toolbar as React component, mode state as local useState in MapChartRenderer
- Express + TypeScript server (existing): spatialWhereClause.ts pure module extending the whereClause.ts pattern
- SQLite (existing): widget.config JSON blob extended with spatialTargets array (no new table needed)

**New code modules (net-new files only):**
- server/src/lib/spatialWhereClause.ts: spatial WHERE predicate builders + composeWhereClause
- src/store/spatialFilterStore.ts: session-only Zustand slice for committed shapes
- src/lib/spatialTargets.ts: SpatialTarget type, getSpatialTargets, isSpatialTargetEligible

### Expected Features

**Must have (table stakes, all P1):**
- Per-map toolbar: Pan / Info / Bbox / Lasso / Circle mode buttons with mutual exclusion, active-state highlight, and cursor change
- OL Draw interactions: click-drag-release bbox, freehand lasso, click-drag-release circle (64-sided polygon approximation)
- ESC key cancels in-progress draw; mode-guard gates singleclick info handler
- useSpatialFilterStore Zustand slice: committed shapes array, spatialVersion counter, addShape/removeShape/clearShapes/reset
- Dashboard-scoped VectorLayer on every map widget: all maps show all committed shapes
- Live measurement label during draw (radius / W times H / area) via OL style function
- Persistent measurement label on committed shape via Style.text on the OL feature
- Douglas-Peucker simplification at drawend for lasso (Geometry.simplify(resolution x 2)) + 150-vertex hard cap with toast
- Per-map widget spatial targets config in widget.config.spatialTargets (table / spatial mode / column)
- spatialWhereClause.ts: buildSpatialOrBlock emits (pred1 OR pred2) always wrapped in parens
- whereClause.ts integration: spatial OR block ANDs with column AND chain
- Materialize trigger extension: AggregatedWidgetRenderer Effect 1 gains spatialFilterVersion dep
- FilterBar spatial chip row above per-table chip rows; chip x removes shape; Clear all shapes in FilterBar (not per-map toolbar)
- 5th store in lifecycle reset block: useSpatialFilterStore.getState().reset() in App.tsx UNAUTHORIZED + DashboardsPage.tsx DashboardOpen

**Should have (differentiators, P2):**
- Measurement in FilterBar chip secondary text (Circle 1 (2.5 km))
- Info mode auto-restored after draw commit or ESC cancel
- Shape highlight on FilterBar chip hover (requires hoveredShapeId in store)
- Click-shape + Delete key removal (requires shape-selection state per map)

**Defer to v2+:**
- Vertex editing of committed shapes (OL Modify + selection state machine conflicts with Info mode)
- Per-shape AND/OR/SUBTRACT boolean toggle (implicit OR is correct for v1 BI users)
- Named/saved shapes persisted to SQLite (session-only is correct v1 contract)
- WKB-binary spatial column support (TD-V14-WKB-SPIKE carry-forward; stub as 501 path)
- Import/export GeoJSON/KML shapes
- Shareable spatial filter URLs

### Architecture Approach

v1.5 extends the v1.3 materialize pipeline with a new spatial dimension without changing core invariants. The single-materialize-trigger pattern, debounced abort-ref pattern (300ms, materializeAbortRef), and viewsKey to Effect 3 WMS cache-buster chain are all preserved unchanged. In-progress draw geometry stays entirely inside OLs native VectorSource, never written to Zustand, eliminating per-frame store writes and cross-map re-render thrash during live drawing.

**Major components:**
1. useSpatialFilterStore: session-only flat SpatialFilter[] + spatialVersion counter; single source of truth for all shape consumers
2. MapChartRenderer (Effects 7+8, new): OL Draw interaction lifecycle + VectorLayer shape sync; draw toolbar UI; mode-gated singleclick guard in Effect 6
3. spatialWhereClause.ts (server, new): pure buildSpatialOrBlock + composeWhereClause; mirrors whereClause.ts module shape
4. AggregatedWidgetRenderer Effect 1 (extended): adds spatialFilterVersion dep; resolves spatialTarget from widget.config.spatialTargets; passes spatialFilters + spatialTarget to materializeFilter
5. MapConfigPanel spatial targets editor: per-widget (table, spatialMode, column) config stored in widget.config JSON blob

**Data flow (draw to filtered tiles):**
Draw completes on any map > useSpatialFilterStore.addShape() > spatialVersion++ > all maps sync VectorLayer (Effect 7) + all AggregatedWidgetRenderer instances fire (Effect 1, 300ms debounce) > POST /api/filter/materialize with spatialFilters + spatialTarget > buildSpatialOrBlock + composeWhereClause > DDL with (spatial_preds) AND (col_chain) > setView() > materializeVersion++ > viewsKey changes > Effect 3 fires updateParams > Kinetica renders filtered WMS tiles.

### Critical Pitfalls

1. **OL Draw + v1.4 singleclick conflict (V15-P-01, CRITICAL):** Add a mode-aware guard at the top of Effect 6s singleclick handler: if (drawMode !== pan and drawMode !== info) return. Use useSpatialFilterStore.getState().drawMode (imperative read via getState()). Do NOT rely on stopClick: true, confirmed broken in OL GitHub issue #12147. This guard must be the first code added when Phase 4 begins.

2. **Kinetica predicate availability spike required (V15-P-14, CRITICAL blocker):** Run live probe before any spatialWhereClause.ts code is written. Confirm STXY_CONTAINS for lat/lon mode and ST_INTERSECTS for WKT mode. Mirror v1.3 S1-S4 and v1.4 Phase 18 spike patterns.

3. **OR-clause parenthesis omission silently breaks column filters (V15-P-07, CRITICAL):** Always wrap the spatial OR group in parens: (pred1 OR pred2) AND col_chain. Without parens, SQL AND binds tighter than OR. Single-shape behavior is correct; bug is invisible until user draws a second shape. Unit test with 2 predicates + 1 column filter must assert exact parenthesisation.

4. **Mercator circle radius distortion at high latitudes (V15-P-04, CRITICAL):** Never use raw olCircle.getRadius() (EPSG:3857 projected meters) in SQL. Transform center + edge point to EPSG:4326 and compute ground radius via ol/sphere.getDistance. For WKT-mode layers, convert meters to degrees as STXY_DWITHIN distance is in geometry column SRS units (degrees for WGS84 WKT columns).

5. **Freehand vertex explosion into WHERE clause (V15-P-03, CRITICAL):** Apply geom.simplify(resolution * 2) at every drawend before storing. Enforce 150-vertex hard cap with toast. Without simplification, a 3-second freehand trace produces 180+ vertices; 5 such shapes produce ~22,000-character WHERE clause strings.

---

## Implications for Roadmap

### Phase 1: Kinetica Predicate Spike + spatialWhereClause.ts

**Rationale:** All 4 researchers independently flagged the Kinetica predicate spike as Phase 1 and P1 blocker. Mirrors v1.3 S1-S4 and v1.4 Phase 18 patterns. No WHERE builder code should be written until predicate names are confirmed.

**Delivers:** Confirmed predicate names (spike); spatialWhereClause.ts with buildSpatialOrBlock and composeWhereClause; server POST body extended; supertest coverage for spatial-only, col+spatial composed, and empty-spatial pass-through cases.

**Addresses:** V15-P-14, V15-P-07, V15-P-05

**Research flag:** Needs spike questions pre-written before phase planning locks. Spike questions: (1) STXY_CONTAINS(ST_GEOMFROMTEXT(POLYGON(...)), lon, lat) = 1; (2) ST_INTERSECTS(wkt_col, ST_GEOMFROMTEXT(POLYGON(...))) = 1; (3) STXY_DWITHIN distance unit against WGS84 WKT column; (4) 150-vertex polygon in WHERE clause. Spike runner pattern from Phase 18 commit d458408.

### Phase 2: useSpatialFilterStore + spatialTargets.ts + Client Helper

**Rationale:** Store is the dependency for all consumers. Pure Zustand slice with no OL dependencies can be written and unit-tested in isolation.

**Delivers:** useSpatialFilterStore (flat SpatialFilter[], spatialVersion, all 4 actions, reset()); 5th-store lifecycle reset in App.tsx + DashboardsPage.tsx; spatialTargets.ts (SpatialTarget type, getSpatialTargets, isSpatialTargetEligible with WKB stub); api/client.ts extended materializeFilter type; full vitest coverage.

**Addresses:** V15-P-16, V15-P-09, V15-P-08

**Research flag:** Standard patterns, no research phase needed. Mirrors useInfoSelectionStore exactly.

### Phase 3: AggregatedWidgetRenderer Extension + MapConfigPanel Spatial Targets

**Rationale:** Wires store into the materialize trigger. MapConfigPanel spatial targets must be buildable before drawn shapes can produce meaningful WHERE clauses for specific tables.

**Delivers:** AggregatedWidgetRenderer Effect 1 gains spatialFilterVersion dep; resolves spatialTarget from widget.config.spatialTargets; eligibility guard; MapConfigPanel spatial targets editor; no new server endpoints needed.

**Addresses:** V15-P-08, V15-P-10

**Research flag:** Standard patterns, no research phase needed.

### Phase 4: MapChartRenderer Draw Tools + VectorLayer

**Rationale:** Core user-facing feature. All upstream dependencies must be stable first. Most complex phase. V15-P-01 mode-guard must be implemented before any draw interaction is wired.

**Delivers:** Effect 7 (VectorLayer setup + shape sync via shapesKey primitive dep, never on pointermove); Effect 8 (Draw interaction lifecycle, drawend to addShape(), ESC abortDrawing(), degenerate shape guard, Mercator-corrected radius); MapDrawToolbar component (5 mode buttons, cursor useEffect with cleanup); Effect 6 mode-guard (first task); live measurement tooltip; persistent Style.text label; simplification + 150-vertex cap; olCoordToWgs84 typed helper.

**Addresses:** V15-P-01, V15-P-02, V15-P-03, V15-P-04, V15-P-06, V15-P-09, V15-P-11, V15-P-13, V15-P-15, V15-P-17

**Research flag:** No research-phase needed. OL Draw API fully confirmed from installed source. Recommend two sub-tasks: (a) mode-guard + toolbar skeleton; (b) draw interactions + VectorLayer.

### Phase 5: FilterBar Spatial Chip Row + End-to-End Verification

**Rationale:** Last integration surface. Chip row reads from store, triggers shape removal back to materialize trigger. Verification covers full draw to WMS tiles loop across all draw types, both spatial modes, multi-shape OR, and chip removal to DROP loop.

**Delivers:** Spatial chip row in DashboardsPage.tsx FilterBar (above per-table column chip rows); chip x calls removeShape; Clear all shapes in FilterBar; P2 differentiators if timeline allows; end-to-end verification document.

**Addresses:** V15-P-07 (OR parens verified live), V15-P-12 (Clear scope confirmed dashboard-wide), V15-P-16 (lifecycle reset verified)

**Research flag:** Standard patterns, no research phase needed.

### Phase Ordering Rationale

- Spike gates all SQL code: v1.3 and v1.4 precedent is unambiguous, spike before builder.
- Store before consumers: Phase 2 store consumed by Phases 3, 4, and 5 independently; stable API before consumers.
- Backend before frontend trigger: Phase 1 server extension must exist before Phase 3 can call materializeFilter with spatialFilters.
- Config before filter eligibility: MapConfigPanel spatial targets (Phase 3) must be buildable before drawn shapes produce valid WHERE clauses. Without a spatialTargets entry, isSpatialTargetEligible returns false and shapes have no effect.
- OL wiring last among foundations: Phase 4 carries the most pitfall risk; pure modules being stable reduces integration debugging surface.
- FilterBar and verification last: Phase 5 is the integration proof; chip row is cheap but needs all upstream pieces stable.

### Research Flags

Needs /gsd:research-phase before planning locks:
- **Phase 1:** Kinetica predicate spike — 4 specific questions must be live-probed before SQL builder is written. Spike runner from Phase 18 commit d458408.

Standard patterns (skip research-phase):
- **Phase 2:** Pure Zustand slice, mirrors useInfoSelectionStore exactly.
- **Phase 3:** AggregatedWidgetRenderer dep-array extension + MapConfigPanel config editor, both established patterns.
- **Phase 4:** OL Draw API fully confirmed from installed source.
- **Phase 5:** FilterBar chip pattern + Phase 17/24 verification template.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All OL APIs confirmed from installed ol@10.9.0 source files. Zero new npm packages. OL GitHub issue #12390 confirms WKT projection options. |
| Features | HIGH | Core UX validated against ArcGIS Dashboards, Foursquare Studio, Mapbox GL Draw, NNG official docs. Chip label naming is LOW confidence (no authoritative cross-tool standard). |
| Architecture | HIGH | All integration points derived from reading actual codebase files at exact line numbers. No training-data assumptions. |
| Pitfalls | HIGH | Each pitfall grounded in OL source, existing codebase effect structure, and documented OL GitHub issues. Kinetica predicate runtime behavior is MEDIUM until Phase 1 spike runs. |

**Overall confidence:** HIGH for implementation decisions. MEDIUM for Kinetica spatial predicate behavior until Phase 1 spike completes.

### Gaps to Address

- **Kinetica STXY_CONTAINS + ST_INTERSECTS live availability (Phase 1 spike):** Critical gap. Docs confirm function signatures; deployed-instance behavior unconfirmed. Do not code spatialWhereClause.ts until resolved.

- **Kinetica SQL WHERE clause character limit for large WKT polygons (V15-P-03):** No documented limit found. Include a 150-vertex WKT POLYGON in the Phase 1 spike payload to validate no parse-time rejection or performance cliff.

- **STXY_DWITHIN distance unit against WGS84 WKT columns (V15-P-05):** Docs state distance is in geometry column SRS units (degrees for WGS84, not meters). Phase 1 spike must confirm this, as v1.4 buildWktQuery already assumes degrees.

- **FilterBar chip ordering (Phase 5):** Research recommends spatial chips as a separate row above per-table column chip rows. Confirm with operator during requirements before Phase 5 implementation.

- **WKB-binary spatial mode (TD-V14-WKB-SPIKE carry-forward):** Not a gap for v1.5 scope. isSpatialTargetEligible returns false for wkb mode; server returns 501. Spike re-run path at commit d458408.

---

## Sources

### Primary (HIGH confidence)
- node_modules/ol/interaction/Draw.d.ts + Draw.js:1561,1602: freehand, createBox(), createRegularPolygon(), DrawEvent, Options shape
- node_modules/ol/sphere.d.ts: getArea, getLength, getDistance
- node_modules/ol/format/WKT.d.ts: writeGeometry with featureProjection/dataProjection options
- node_modules/ol/geom/Geometry.d.ts:147: simplify(tolerance) method
- node_modules/ol/layer/Vector.d.ts, ol/source/Vector.d.ts: VectorLayer/VectorSource API
- OL GitHub issue #12390: writeGeometry projection option confirmed
- OL GitHub issue #12147: stopClick: true confirmed unreliable for singleclick suppression
- ArcGIS Dashboards official docs (doc.arcgis.com): OR boolean composition, cross-widget filter propagation
- Foursquare Studio official docs (docs.foursquare.com): geospatial filter UX, filter panel chip entry
- Mapbox GL Draw official MODES.md + API.md: ESC cancel, mode-exclusive click handling, simple_select Delete key
- Nielsen Norman Group Modes article (nngroup.com): two-simultaneous-visual-signals requirement
- Kinetica Geospatial Functions 7.1 (docs.kinetica.com/7.1): STXY_CONTAINS, STXY_WITHIN, ST_INTERSECTS, ST_CONTAINS, STXY_DWITHIN, ST_GEOMFROMTEXT constants-only constraint
- Codebase: kinetica_bi/server/src/lib/whereClause.ts: composition target, pure-module pattern
- Codebase: kinetica_bi/server/src/lib/spatialQuery.ts: SQL builder pattern, trust boundary
- Codebase: kinetica_bi/src/components/charts/MapChartRenderer.tsx: Effect structure, mountedRef, Effect 6 singleclick handler line 829+
- Codebase: kinetica_bi/src/components/charts/WidgetRenderer.tsx lines 281-325: Effect 1 materialize trigger pattern
- Codebase: kinetica_bi/src/components/DashboardsPage.tsx lines 388-407: 4-store reset block (extension target)

### Secondary (MEDIUM confidence)
- Kinetica WKT Guide 7.1 (docs.kinetica.com): STXY_CONTAINS usage examples in spatial queries
- Kinetica /execute/sql REST docs: no documented SQL statement length limit found
- Map UI Patterns (mapuipatterns.com): OR within category / AND between categories spatial filter composition
- Kepler.gl user guide + GitHub issue #389: filter panel entry UX, implicit OR composition
- OL Measure Style example (openlayers.org): live measurement label style function pattern

### Tertiary (LOW confidence)
- FilterBar chip label naming (Bbox 1, Lasso 2, Circle 3): synthesised from partial evidence; no authoritative cross-tool standard

---
*Research completed: 2026-05-11*
*Ready for roadmap: yes*
