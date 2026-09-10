# Stack Research: v1.5 Spatial Drawing + Filtering

**Domain:** Interactive spatial drawing tools on an existing OpenLayers map widget, with server-side spatial WHERE-clause filtering via Kinetica SQL
**Researched:** 2026-05-11
**Confidence:** HIGH (OL APIs confirmed from installed source `ol@10.9.0`; Kinetica spatial predicates confirmed from official 7.1 docs; coordinate-system transform pattern confirmed from OL source + GitHub issue)

---

## What Changes vs What Stays

**Stays unchanged:** Entire existing stack — React 18 + TypeScript + Vite, Express + TypeScript, SQLite, Zustand, `ol@10.9.0`. No framework version bumps needed.

**New npm package:** None required. All OL draw/measure APIs exist in the already-installed `ol@10.9.0`. No external geometry-simplification library is needed (OL's `Geometry.simplify()` handles it). No new npm installs for v1.5.

**New code modules (net-new files):**
- `server/src/lib/spatialWhereClause.ts` — spatial WHERE predicate builders (mirrors `spatialQuery.ts` pattern)
- `src/store/drawnShapesStore.ts` — session-only Zustand slice for drawn shapes
- `src/lib/drawTools.ts` — OL Draw interaction factory (createBox, freehand polygon, circle → polygon)
- `src/lib/spatialWkt.ts` — OL geometry → EPSG:4326 WKT serialiser + simplify wrapper
- `src/components/charts/MapDrawToolbar.tsx` — per-map mode-switch toolbar (Pan / Info / Bbox / Lasso / Circle)

**Modified files:**
- `MapChartRenderer.tsx` — Effect 7 adds Draw interaction + VectorLayer; Effect 6 mode-gate on singleclick; existing Effects untouched
- `server/src/lib/whereClause.ts` — `buildServerWhereClause` extended to accept spatial predicates via composition (not in-place edit of existing logic)
- `server/src/routes/filter.ts` (or `index.ts`) — materialize DDL extended to support OR-composed spatial predicates prepended to column AND-chain

---

## OL Draw Interaction API (ol@10.9.0, HIGH confidence — confirmed from installed source)

### Three draw modes

| Mode | OL type arg | geometryFunction | freehand | Output geometry |
|------|-------------|------------------|----------|-----------------|
| Bbox | `'Circle'` | `createBox()` | false | `Polygon` (axis-aligned rectangle) |
| Lasso | `'Polygon'` | none | `true` | `Polygon` |
| Circle | `'Circle'` | `createRegularPolygon(64)` | false | `Polygon` (64-sided approximation) |

**createBox() details (confirmed from `node_modules/ol/interaction/Draw.js:1602`):**
- Takes two pointer positions (start corner + drag corner), computes bounding extent, returns a 5-point closed `Polygon` wound consistently with the axis-aligned extent corners (bottomLeft→bottomRight→topRight→topLeft→bottomLeft).
- When `userProjection` is set, geometry is re-transformed automatically — do NOT set `userProjection` in this app (projection is managed explicitly).

**freehand:true for lasso:**
- Option is `freehand?: boolean` on the `Draw` `Options` type (confirmed `Draw.d.ts:137`).
- When true, takes precedence over `freehandCondition`; pointer drag continuously adds vertices; releasing the pointer closes and commits the polygon.
- Produces a `Polygon` geometry with potentially hundreds of vertices.

**createRegularPolygon(sides) for circle:**
- `createRegularPolygon(64)` is the recommended approximation for a "circle" that produces a WKT `POLYGON` the server can use with standard spatial predicates.
- The true OL `Circle` geometry type cannot be serialised to WKT directly. Using `createRegularPolygon(64)` as the `geometryFunction` with `type: 'Circle'` produces a Polygon output — confirmed from OL source `Draw.js:1561`.
- 64 sides gives sub-pixel visual error at all practical zoom levels.

### Draw interaction events

```typescript
import Draw, { createBox, createRegularPolygon } from 'ol/interaction/Draw';
import type { DrawEvent } from 'ol/interaction/Draw';

// drawend provides the committed feature:
drawInteraction.on('drawend', (evt: DrawEvent) => {
  const feature = evt.feature; // Feature<Polygon>
  // convert geometry to EPSG:4326 WKT here
});
```

Event types: `drawstart`, `drawend`, `drawabort` (confirmed `Draw.d.ts`).

### Measurement during draw

Use `ol/sphere` module — `getArea(geometry)` and `getLength(geometry)` for ellipsoidal accuracy (not planar `geometry.getArea()` which is meaningless in Web Mercator at high latitudes).

```typescript
import { getArea, getLength, getDistance } from 'ol/sphere';
// Returns meters. geometry must be in EPSG:3857 (default assumption per sphere.d.ts).
// For circle radius: getDistance([cx,cy], [edgePx1, edgePy1]) after transforming center/edge to EPSG:4326.
const areaM2 = getArea(polygonGeom);       // polygon/lasso: sq metres
const perimM  = getLength(polygonGeom);    // bbox perimeter: metres (use for W×H labels separately)
```

Live measurement label during draw: OL's `Draw` interaction `style` option accepts a function `(feature) => StyleLike`. The sketch feature exposes the in-progress geometry — call `getArea(sketchGeom)` inside the style function to update the `Text` style dynamically. This matches the official OL "Measure using vector styles" example pattern.

Persistent label after commit: use a `VectorLayer` style function that reads `feature.get('measurement')` (set on the feature at drawend time).

### VectorLayer + VectorSource for drawn shapes

```typescript
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';

const drawSource = new VectorSource();
const drawLayer = new VectorLayer({
  source: drawSource,
  zIndex: LAYER_Z_BASE + 500, // above all WMS layers
  style: shapeStyleFunction,
});
map.addLayer(drawLayer);
```

Cross-map shape visibility (v1.5 requirement): `drawnShapesStore` holds the canonical WKT/metadata; each map widget independently renders a `VectorLayer` reading from that store. Individual map instances should NOT share a single `VectorSource` — each creates its own source from the store's shape list on mount and subscribes to store changes.

### Toolbar: custom OL Control

**Canonical pattern (HIGH confidence — confirmed from `ol/control/Control.d.ts`):**

```typescript
import Control from 'ol/control/Control';

const element = document.createElement('div');
element.className = 'ol-draw-toolbar ol-unselectable ol-control';
// populate with button elements...
const toolbar = new Control({ element });
map.addControl(toolbar);
```

The `target` option can point to an existing DOM element outside the OL viewport (`target?: string | HTMLElement`). In a React component, the preferred pattern for v1.5 is: render a React `<div ref={toolbarRef}>` inside the `widget-map` div (absolutely positioned via CSS, overlapping OL's control container), and do NOT use `ol/control/Control` — this avoids OL's control lifecycle conflicting with React's reconciliation. The React-rendered toolbar is positioned with CSS (`position: absolute; top: 8px; left: 8px; z-index: 1001`) alongside OL's zoom controls (which are in `.ol-overlaycontainer-stopevent` at top-right by default).

**Why React-rendered overlay, not `ol/control/Control` subclass:**
- React 18 StrictMode's double-invoke pattern has already caused one category of OL lifecycle bugs (PITFALL M-01, GAP-24-01-A, GAP-24-02-A). Mixing React-rendered elements with OL's imperative control DOM is an additional risk surface.
- A React `ref`-attached `<div>` is trivially testable with `@testing-library/react`; an OL Control subclass requires OL map mock setup.
- CSS `pointer-events: none` on the container (with `pointer-events: auto` on buttons) prevents accidentally swallowing OL map events.

---

## Coordinate-System Transform (HIGH confidence — confirmed from OL source)

### The direction

OL map is locked to `EPSG:3857` (Web Mercator) — PITFALL M-03 established in v1.2. All OL geometry coordinates are in EPSG:3857 metres. Kinetica spatial functions (`STXY_CONTAINS`, `ST_INTERSECTS`, `ST_DWITHIN`) expect **EPSG:4326** (longitude, latitude in degrees). Transform direction: EPSG:3857 → EPSG:4326 before serialising to WKT.

### Pattern: OL geometry → EPSG:4326 WKT

```typescript
import WKT from 'ol/format/WKT';
import type { Geometry } from 'ol/geom';

const wktFormat = new WKT();

export function geometryToWkt4326(geom: Geometry): string {
  // clone() to avoid mutating the feature's geometry in-place.
  // transform() modifies the geometry's coordinate array in place.
  return wktFormat.writeGeometry(geom.clone(), {
    featureProjection: 'EPSG:3857',  // source: the map's locked projection
    dataProjection: 'EPSG:4326',     // output: WGS84 for Kinetica
  });
}
```

**`writeGeometry` with `featureProjection`/`dataProjection` options:** Confirmed from OL GitHub issue #12390 — the WKT format's `writeGeometry` accepts these options and applies the projection transform during serialisation. The resulting WKT uses EPSG:4326 lon/lat coordinates in `POLYGON((lon lat, lon lat, ...))` order — which is what Kinetica spatial functions expect (x=longitude, y=latitude).

**Do NOT use `geom.transform()` directly for WKT export** — it mutates the geometry in place and would cause OL to render the shape in the wrong location. Always `clone()` first.

### WKT coordinate order in Kinetica

Kinetica's WKT parsing follows the OGC convention: `POLYGON((x y, x y, ...))` where x=longitude, y=latitude. The OL WKT format outputs `lon lat` when `dataProjection: 'EPSG:4326'` — this matches Kinetica's expected order.

### Winding order

Kinetica's spatial functions do not document a strict winding-order requirement. `createBox()` produces exterior rings wound bottom-left → bottom-right → top-right → top-left → close (clockwise in screen coordinates, counterclockwise in geographic coordinates per OGC). For freehand polygons, OL does not guarantee winding order. **Risk: LOW** — Kinetica's geospatial engine (based on OGC-compliant spec) generally handles both CCW and CW exterior rings. **Mitigation:** if intersection results are wrong in UAT, add a winding-order normalisation step. Do not pre-optimise.

---

## Kinetica Spatial WHERE Predicates (MEDIUM confidence — function signatures from official docs; WKT-literal usage inferred from `ST_GEOMFROMTEXT` constants note; operator must spike)

### Summary of confirmed functions

From `docs.kinetica.com/7.1/location_intelligence/geo_functions/` (fetched 2026-05-11):

| Function | Signature | Returns | Distance units |
|----------|-----------|---------|----------------|
| `STXY_CONTAINS(geom, x, y)` | geom=geometry, x/y=float | 1/0 | n/a (topological) |
| `STXY_WITHIN(x, y, geom)` | x/y=float, geom=geometry | 1/0 | n/a (topological) |
| `STXY_INTERSECTS(x, y, geom)` | x/y=float, geom=geometry | 1/0 | n/a (topological) |
| `STXY_ENVINTERSECTS(x, y, geom)` | x/y=float, geom=geometry | 1/0 | n/a (bbox-based) |
| `STXY_DWITHIN(x, y, geom, dist[, sol])` | dist=numeric, sol=0/1/2 | 1/0 | sol=0: degrees; sol=1: meters (sphere); sol=2: meters (spheroid) |
| `ST_INTERSECTS(geom1, geom2)` | both geometry | 1/0 | n/a (topological) |
| `ST_CONTAINS(geom1, geom2)` | both geometry | 1/0 | n/a (topological) |
| `ST_DWITHIN(geom1, geom2, dist[, sol])` | both geometry, sol=0/1/2 | 1/0 | same as STXY_DWITHIN |
| `GEODIST(lon1, lat1, lon2, lat2)` | four floats | meters | great-circle metres |
| `ST_GEOMFROMTEXT(wkt)` | WKT string constant | geometry | — |

**Critical constraint on `ST_GEOMFROMTEXT`:** The official docs state it is "only compatible with constants" — meaning a string literal, NOT a column reference. A drawn-shape WKT polygon string qualifies as a constant in this context. This is the mechanism for embedding a drawn shape as a geometry argument.

### Predicates for v1.5 draw types

#### spatialMode = 'latlon' (separate x_col / y_col columns)

```sql
-- Circle (point within radius_meters of circle center):
-- STXY_DWITHIN(lon_col, lat_col, ST_GEOMFROMTEXT('POINT(cx cy)'), radius_m, 1) = 1
-- OR: use 64-sided polygon approximation and STXY_CONTAINS below (more consistent)

-- Bbox (point inside drawn bbox — represented as 5-point POLYGON WKT):
STXY_CONTAINS(ST_GEOMFROMTEXT('POLYGON((w s, e s, e n, w n, w s))'), lon_col, lat_col) = 1

-- Lasso / polygon (point inside drawn polygon):
STXY_CONTAINS(ST_GEOMFROMTEXT('POLYGON((lon1 lat1, lon2 lat2, ...))'), lon_col, lat_col) = 1
```

**Recommended function for all three draw types:** `STXY_CONTAINS(ST_GEOMFROMTEXT('<WKT>'), lon_col, lat_col) = 1`

This is the cleanest form — the drawn shape becomes the `geom` arg, the data points are `(x, y)`. Bbox is a special case of polygon so the same function covers all three. The `= 1` makes the WHERE clause unambiguous (STXY_ functions return int 1/0, not boolean).

**Alternative for circle (meter-precise):** `STXY_DWITHIN(lon_col, lat_col, ST_GEOMFROMTEXT('POINT(cx cy)'), radius_m, 1) = 1` — uses the actual circle center and haversine radius, more geometrically correct than a 64-gon. The 64-gon is still preferred for v1.5 because: (a) it unifies all draw types under one predicate builder, (b) the visual shape and the filter shape are identical.

**STXY_ENVINTERSECTS** is bbox-only (envelope test, no polygon interior), useful as a fast pre-filter but not as the primary predicate for polygon-containment.

#### spatialMode = 'wkt' (single WKT geometry column)

WKT columns store geometry objects. The `STXY_` family does NOT apply (they take raw x/y floats). Use the `ST_` family:

```sql
-- Circle / bbox / polygon (WKT geometry column intersects drawn shape):
ST_INTERSECTS(wkt_col, ST_GEOMFROMTEXT('POLYGON((lon1 lat1, ...))')) = 1

-- Point containment (drawn polygon contains geometry):
ST_CONTAINS(ST_GEOMFROMTEXT('POLYGON((lon1 lat1, ...))'), wkt_col) = 1
```

**Recommended:** `ST_INTERSECTS(wkt_col, ST_GEOMFROMTEXT('<WKT>')) = 1` for all three draw types. `ST_INTERSECTS` handles the case where the WKT column might contain polygon/linestring geometries that partially overlap the drawn shape (not just point containment), which is more correct for WKT-mode layers.

**NEEDS OPERATOR SPIKE:** Neither `STXY_CONTAINS(ST_GEOMFROMTEXT('...'), x, y)` nor `ST_INTERSECTS(wkt_col, ST_GEOMFROMTEXT('...'))` are explicitly demonstrated in Kinetica docs with a WKT literal on the geometry argument. The documentation confirms `ST_GEOMFROMTEXT` accepts constants, and the functions accept geometry args — but the combination needs a live probe against the deployed instance before Phase 1 planning is locked.

#### spatialMode = 'wkb' (deferred — TD-V14-WKB-SPIKE)

Skip for v1.5. Same tech-debt scope as in v1.4: the spatial filter should skip WKB-mode layers or return a clear error.

### Multi-shape OR composition

The v1.5 materialize DDL target:

```sql
CREATE OR REPLACE MATERIALIZED VIEW _kbi_filt_u17_d42_t9_s1aef AS (
  SELECT * FROM demo.taxi_trips
  WHERE
    (
      STXY_CONTAINS(ST_GEOMFROMTEXT('POLYGON((a b, c d, ...))'), lon_col, lat_col) = 1
      OR
      STXY_CONTAINS(ST_GEOMFROMTEXT('POLYGON((e f, g h, ...))'), lon_col, lat_col) = 1
    )
    AND
    (pickup_zone = 'East Village')
)
USING TABLE PROPERTIES (TTL = 5)
```

The parenthesised OR block wraps all drawn shapes; the column AND-chain (from `buildServerWhereClause`) follows. If no shapes are drawn, the spatial OR block is omitted entirely (column-only filter falls through to existing behaviour). If no column filters are active, the AND-chain is omitted.

**Builder integration:** `spatialWhereClause.ts` exports `buildSpatialOrBlock(shapes: DrawnShape[]): string` that emits the parenthesised OR expression. `whereClause.ts` stays unchanged. The filter route concatenates: `(spatial_block) AND (column_block)` when both are present.

---

## WKT Escaping + WHERE-Clause Safety

### Single-quote escaping

The WKT string passed to `ST_GEOMFROMTEXT('...')` is embedded as a SQL string literal. The risk of a single quote inside a WKT coordinate string is nil — WKT polygon coordinates are space-separated floats (`POLYGON((lon lat, lon lat))`), which contain no quote characters. No escaping is needed for the coordinate payload.

**However:** The WKT string is a SQL string literal, so the full embedding is:
```sql
ST_GEOMFROMTEXT('POLYGON((...))')
```
The single quotes around the WKT are part of the SQL syntax. Because coordinate values are floats only, there is no injection surface. This is analogous to the `STXY_DISTANCE` pattern already used in `buildWktQuery` — numeric values interpolated directly without quoting.

**Do NOT use template-string concatenation for anything other than trusted numeric/float values.** Column names (WKT column name, lat/lon column names) originate from admin-trusted metadata — same trust boundary as `spatialQuery.ts` line 25-28.

### Scientific notation

OGC WKT spec requires decimal-notation coordinates. Scientific notation (e.g., `1.234e-5`) is NOT valid OGC WKT. OL's `WKT.writeGeometry()` produces standard decimal notation — no risk of scientific notation output from OL. **No mitigation needed for OL-generated WKT.** If a manual WKT string is ever constructed, use `coord.toFixed(8)` to force decimal form.

### Numeric precision

OL outputs coordinates with full JavaScript float64 precision. For lon/lat values, 8 decimal places (≈ 1mm precision) is sufficient. The WKT format does not truncate. No action needed.

### SQL WHERE-clause length limits

No documented maximum SQL statement length found in Kinetica 7.1 or 7.2 docs (`/execute/sql` endpoint, Limitations page). The HTTP body is JSON — practical limit is dictated by the server's HTTP request size config (typically 1-16MB), not a SQL parse limit.

A dense freehand polygon with 500 vertices at 8-decimal-place coordinates produces approximately:
- 500 vertices × `"−123.12345678 45.12345678, "` (≈ 25 chars each) = ~12,500 chars of WKT payload.
- Total SQL ≈ 13,000 chars — well within any realistic HTTP body limit.

**Simplification:** Apply OL's built-in `geometry.simplify(tolerance)` on the cloned geometry **before** WKT serialisation for lasso polygons. A tolerance of `1` (1 metre in EPSG:3857) reduces most freehand traces to under 100 vertices while preserving visible shape at any reasonable zoom level.

```typescript
// In spatialWkt.ts — apply before geometryToWkt4326():
const simplified = geom.clone().simplify(1); // tolerance in source projection units (metres for EPSG:3857)
const wkt = geometryToWkt4326(simplified);
```

`Geometry.simplify(tolerance)` is confirmed in `ol/geom/Geometry.d.ts:147` (installed `ol@10.9.0`).

---

## New Server Module: spatialWhereClause.ts

This module mirrors `spatialQuery.ts` and `whereClause.ts` patterns — pure, no imports, unit-testable.

### Shape types

```typescript
export type DrawMode = 'bbox' | 'lasso' | 'circle';

export type DrawnShape = {
  id: string;           // stable UUID assigned at drawend
  wkt: string;          // EPSG:4326 WKT POLYGON (all three modes unified)
  drawMode: DrawMode;   // for display label only; SQL builder doesn't branch on this
  measurementLabel: string; // e.g. "1.2 km radius" | "4.5 km²" | "3.2 × 1.8 km"
};
```

### Builder signatures

```typescript
// latlon mode: STXY_CONTAINS(ST_GEOMFROMTEXT('...'), lon_col, lat_col) = 1
export function buildLatLonSpatialPredicate(wkt: string, lonCol: string, latCol: string): string;

// wkt mode: ST_INTERSECTS(wkt_col, ST_GEOMFROMTEXT('...')) = 1
export function buildWktSpatialPredicate(wkt: string, wktCol: string): string;

// Compose multiple shapes as (pred1 OR pred2 OR ...)
export function buildSpatialOrBlock(shapes: DrawnShape[], spatialMode: 'latlon' | 'wkt', columns: SpatialColumns): string;
```

### Integration with whereClause.ts

`buildServerWhereClause` in `whereClause.ts` stays unchanged — it receives `ActiveFilter[]` and produces a column AND-chain. The filter materialize route in the server:

```typescript
const spatialBlock = shapes.length > 0
  ? buildSpatialOrBlock(shapes, spatialMode, columns)
  : '';
const columnBlock = filters.length > 0
  ? buildServerWhereClause(filters)
  : '';

const whereClause =
  spatialBlock && columnBlock ? `(${spatialBlock}) AND (${columnBlock})`
  : spatialBlock ? spatialBlock
  : columnBlock ? columnBlock
  : '1=1';
```

---

## New Frontend Module: drawnShapesStore.ts (Zustand)

Session-only slice. Mirrors `useFilterStore` reset lifecycle (reset on logout + dashboard-switch).

```typescript
type DrawnShapesState = {
  shapes: DrawnShape[];                    // ordered by creation time
  addShape: (shape: DrawnShape) => void;
  removeShape: (id: string) => void;
  clearShapes: () => void;
  reset: () => void;                       // alias of clearShapes; follows store reset naming convention
};
```

**No URL/localStorage persistence** — session-only; mirrors `useInfoSelectionStore` and `useFilterStore`.

**Zustand store key:** `drawnShapesStore` — consistent with naming convention (`filterStore`, `filterViewStore`, `infoSelectionStore`).

**FilterBar chip integration:** Each `DrawnShape` in the store maps to one chip in `FilterBar` (alongside column-filter chips). Shape removal clears the shape from the store, which triggers re-materialize via existing `filterVersion` increment-or-spatial-version mechanism.

---

## MapChartRenderer.tsx Integration

### Effect structure after v1.5

| Effect | Trigger | Action |
|--------|---------|--------|
| Effect 1 | mount | Create OL Map, ResizeObserver (unchanged) |
| Effect 2 | includedLayers | Add/remove/update WMS ImageLayer stack (unchanged) |
| Effect 3 | filterVersion, viewsKey | WMS params update (unchanged) |
| Effect 4 | basemap | Basemap swap (unchanged) |
| Effect 5 | mount | ol/Overlay for InfoPopup (unchanged) |
| Effect 6 | infoEnabled, eligibleLayers | singleclick listener — gate on mode: only fires when `drawMode === 'info'` |
| **Effect 7** | **drawMode, drawnShapesVersion** | **Add/remove Draw interaction; add VectorLayer for committed shapes** |

**Mode-gating for singleclick vs draw:** The draw toolbar controls a `drawMode` state variable (`'pan' | 'info' | 'bbox' | 'lasso' | 'circle'`). Effect 6's singleclick listener already has a kill-switch pattern (via `getInfoEnabled`); extend to also gate on `drawMode !== 'info'`. Effect 7 only adds the Draw interaction when `drawMode` is one of `'bbox' | 'lasso' | 'circle'`; it removes it otherwise. This keeps the two interaction systems mutually exclusive.

**mountedRef** applies to Effect 7 draw callbacks identically to Effect 6's existing pattern.

---

## New Server Endpoint Extension

### Extended POST /api/filter/materialize body

```typescript
// New optional field alongside existing filters[]:
{
  tableId: number;
  dashboardId: number;
  filters: ActiveFilter[];
  // v1.5 addition:
  spatialShapes?: {
    wkt: string;
    spatialMode: 'latlon' | 'wkt';
    spatialColumns: { lonCol?: string; latCol?: string; wktCol?: string };
  }[];
}
```

Backward-compatible: `spatialShapes` is optional. Existing callers that send `filters` only still work.

---

## Supporting Libraries

| Library | Version | Purpose | Notes |
|---------|---------|---------|-------|
| `ol` | `10.9.0` (installed) | Draw, Modify, VectorLayer, VectorSource, WKT format, sphere measurements | No upgrade needed; all v1.5 APIs present |
| `zustand` | existing | `drawnShapesStore` session slice | No change |

**No new npm packages required for v1.5.**

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Circle SQL predicate | `STXY_CONTAINS(ST_GEOMFROMTEXT(64-gon WKT), lon, lat) = 1` | `STXY_DWITHIN(lon, lat, ST_GEOMFROMTEXT('POINT(cx cy)'), r, 1) = 1` | 64-gon unifies all three draw types under one builder; visual shape = filter shape; DWITHIN is mathematically superior but adds builder branching |
| Toolbar implementation | React-rendered overlay div | `ol/control/Control` subclass | React lifecycle conflicts with OL control lifecycle; OL control DOM manipulation incompatible with React's reconciler (GAP-24-01-A root cause family) |
| Polygon simplification | `Geometry.simplify(1)` from `ol/geom` | `simplify-js` npm package | OL provides built-in simplify; no new dependency |
| Cross-map shape visibility | Store holds WKT; each map renders its own VectorLayer from store | Single shared VectorSource across all maps | Shared OL objects across React component trees violate the existing per-component OL lifecycle pattern (PITFALL M-01 family) |
| WKT serialisation | `ol/format/WKT` with `featureProjection`/`dataProjection` | `geom.clone().transform().getCoordinates()` + manual WKT string | WKT format handles all geometry types uniformly; manual approach error-prone for polygon rings |

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `turf.js` | Heavy dependency for polygon simplification and area calculation; OL's `ol/sphere` + `Geometry.simplify()` already covers v1.5 needs | `ol/sphere.getArea` + `Geometry.simplify()` |
| `leaflet-draw` | Leaflet-specific; incompatible with OL | `ol/interaction/Draw` (already in installed OL) |
| `ol-ext` | Third-party OL extension library; adds surface area; Draw toolbar not needed when React-rendered toolbar suffices | Plain React `<div>` absolutely positioned over the map |
| WKT winding-order normalisation library | Kinetica docs don't require it; OL geometry winding is consistent; premature optimisation | Add only if operator UAT reveals incorrect spatial results |
| Server-side geometry parsing library | The server only embeds the WKT string into SQL — it never needs to parse or manipulate it | Trust OL's WKT format output; validate format in `spatialWhereClause.ts` with a `wkt.startsWith('POLYGON')` guard |

---

## Spike Requirements Before Phase 1 Lock

These must be validated against the deployed Kinetica instance:

| Spike | Question | Consequence if NO |
|-------|----------|-------------------|
| **S1 (P1 blocker)** | Does `STXY_CONTAINS(ST_GEOMFROMTEXT('POLYGON(...)'), lon_col, lat_col) = 1` work in a WHERE clause on the deployed Kinetica 7.x instance? | Must use STXY_DWITHIN with POINT for circle, and find an alternative for bbox/polygon |
| **S2 (P1 blocker)** | Does `ST_INTERSECTS(wkt_col, ST_GEOMFROMTEXT('POLYGON(...)')) = 1` work for WKT-mode layers? | WKT-mode spatial filtering not supported in v1.5; defer |
| **S3 (informational)** | Does `STXY_DWITHIN(lon, lat, ST_GEOMFROMTEXT('POINT(cx cy)'), radius_m, 1)` work as an alternative circle predicate? | Fallback if 64-gon approach is rejected |
| **S4 (informational)** | Is there an `STXY_ENVINTERSECTS` equivalent that takes a WKT POLYGON literal? (For bbox: `STXY_ENVINTERSECTS(lon, lat, ST_GEOMFROMTEXT('POLYGON(...)'))`) | If yes, prefer for bbox as a cheaper envelope test |

---

## Version Compatibility

| Package | Version | Notes |
|---------|---------|-------|
| `ol` | `10.9.0` | `createBox`, `createRegularPolygon`, `freehand`, `VectorLayer`, `VectorSource`, `WKT.writeGeometry` with projection options, `Geometry.simplify`, `getArea`/`getLength`/`getDistance` from `ol/sphere` — all confirmed in installed package |
| React | 18 | StrictMode double-invoke: Effect 7 must follow PITFALL M-01 pattern (mapRef guard on re-entry) |
| TypeScript | existing | Draw, DrawEvent, VectorLayer, VectorSource types fully available in `ol@10.9.0` |

---

## Sources

- `node_modules/ol/interaction/Draw.d.ts` (installed `ol@10.9.0`) — `freehand`, `createBox()`, `createRegularPolygon()`, event types, Options shape — HIGH confidence
- `node_modules/ol/interaction/Draw.js:1561,1602` — `createRegularPolygon` and `createBox` implementations — HIGH confidence
- `node_modules/ol/sphere.d.ts` — `getArea`, `getLength`, `getDistance`, `SphereMetricOptions` — HIGH confidence
- `node_modules/ol/format/WKT.d.ts` — `WKT` class, `writeGeometry` — HIGH confidence
- `node_modules/ol/geom/Geometry.d.ts:147` — `simplify(tolerance)` method — HIGH confidence
- `node_modules/ol/control/Control.d.ts` — `element`, `target` options — HIGH confidence
- `node_modules/ol/layer/Vector.d.ts`, `node_modules/ol/source/Vector.d.ts` — VectorLayer/VectorSource API — HIGH confidence
- [OL GitHub #12390](https://github.com/openlayers/openlayers/issues/12390) — `writeGeometry` `featureProjection`/`dataProjection` option confirmed — HIGH confidence
- [Kinetica Geospatial/Geometry Functions 7.1](https://docs.kinetica.com/7.1/location_intelligence/geo_functions/) — STXY_CONTAINS, STXY_WITHIN, STXY_DWITHIN, STXY_ENVINTERSECTS, ST_INTERSECTS, ST_CONTAINS, GEODIST signatures + solution parameter values; `ST_GEOMFROMTEXT` constants-only constraint — MEDIUM confidence
- [Kinetica WKT Guide 7.1](https://docs.kinetica.com/7.1/guides/wkt_data_geo_functions/) — STXY_CONTAINS usage pattern from examples — MEDIUM confidence
- [Kinetica /execute/sql REST docs 7.1](https://docs.kinetica.com/7.1/api/rest/execute_sql_rest/index.html) — no documented SQL statement length limit — MEDIUM confidence
- [OL Measure Style Example](https://openlayers.org/en/latest/examples/measure-style.html) — style function pattern for live measurement labels — HIGH confidence
- Codebase: `kinetica_bi/server/src/lib/spatialQuery.ts` — existing spatial builder pattern; `buildLatLonQuery`/`buildWktQuery` trust boundary
- Codebase: `kinetica_bi/server/src/lib/whereClause.ts` — `buildServerWhereClause`, `escapeKineticaStringLiteral` — composition target
- Codebase: `kinetica_bi/src/components/charts/MapChartRenderer.tsx` — Effect lifecycle pattern, mountedRef, PITFALL M-01/M-02/M-03 locks — integration host
- Codebase: `kinetica_bi/src/lib/wmsUrlBuilder.ts` — `MapWidgetConfig` type — config extension reference

---
*Stack research for: Kinetica BI v1.5 Spatial Drawing + Filtering*
*Researched: 2026-05-11*
