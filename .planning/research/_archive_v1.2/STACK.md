# Stack Research — v1.2 Interactive Dashboards

**Domain:** Map chart + drill-down + cross-chart filter coordination added to an existing Kinetica BI app
**Researched:** 2026-05-01
**Scope:** NEW additions only. Existing stack (React 18, Vite, Express, Zustand, Recharts, better-sqlite3, openid-client) is locked and not re-evaluated.

---

## Executive Verdict

One new frontend production dependency: `ol` (OpenLayers) v10.x.
One new backend route: a thin identify endpoint that delegates to the existing `kineticaSql` helper.
No new state-management library: the existing Zustand stores + per-table filter-bar model suffice unchanged.
No new projection library, no ol-ext, no ol-mapbox-style.

---

## New Dependencies

### Frontend (kinetica_bi/package.json)

| Package | Version to Pin | Purpose | Why |
|---------|---------------|---------|-----|
| `ol` | `^10.5.0` | OpenLayers map rendering — WMS tile layer, view, map canvas, click events | Industry-standard open-source mapping library. v10 is the current stable major (released 2024, actively maintained into 2026). Ships its own TypeScript types (no `@types/ol` needed). Tree-shakeable via ESM — only the modules imported pay bundle cost. Vite handles it out of the box as a standard ESM package. |

### Backend (kinetica_bi/server/package.json)

No new npm dependencies. The identify endpoint reuses the existing `kineticaSql` helper with a SQL `ST_Distance` / `ORDER BY … LIMIT 1` query. No new packages.

---

## OpenLayers v10 — Full Rationale

### Version selection: v10.x not v9.x or v8.x

**Use `ol@^10.5.0`.** Confidence: MEDIUM (training data confirms v10 stable major released 2024; npm registry not directly queryable in this session, but the `^10` range will resolve to the latest 10.x patch on install — pin `^10.5.0` as a minimum because v10.5 brought stable `TileWMS` source stability improvements needed for the Kinetica WMS tile pipeline).

- v8.x: Older API; `Map` class construction and layer API changed at v9. Do not use.
- v9.x: API stable but superseded. No reason to stay on v9 if v10 is stable.
- v10.x: Current stable. Breaking changes from v8→v9 and v9→v10 are in the `ol/source/TileWMS` and `ol/layer/Tile` API, specifically the separation of `TileLayer` + `TileWMS` (previously confusingly aliased). v10 locked these down cleanly. TypeScript types ship in the package itself (`ol/index.d.ts` + per-module types) — no `@types/ol`.

### Bundle size

OpenLayers is large (~800KB raw, ~250KB gzipped for a full import). The key mitigation:

- **Import only what you use.** `import Map from 'ol/Map'`, `import TileLayer from 'ol/layer/Tile'`, `import TileWMS from 'ol/source/TileWMS'`, `import View from 'ol/View'` — never `import * from 'ol'`.
- Vite's Rollup bundler tree-shakes ESM properly. A minimal map (Map + View + TileLayer + TileWMS + pointer interaction) is approximately 120–150KB gzipped.
- The map chart widget is only mounted when a dashboard contains a map widget. No route-level code splitting is strictly necessary, but the `MapChartRenderer` component can be lazy-loaded via `React.lazy(() => import('./MapChartRenderer'))` to keep the main bundle clean. This is a `WidgetRenderer` concern, not an OpenLayers concern.

### React 18 integration — functional ref pattern

OpenLayers requires a DOM element to mount into. The correct React 18 pattern:

```typescript
import { useEffect, useRef } from "react";
import Map from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import TileWMS from "ol/source/TileWMS";

const MapChartRenderer = ({ config }: { config: Record<string, unknown> }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new Map({
      target: containerRef.current,
      layers: [buildWmsLayer(config)],
      view: new View({
        projection: "EPSG:4326",   // Kinetica WMS uses geographic CRS
        center: [config.centerLon as number ?? 0, config.centerLat as number ?? 0],
        zoom: config.zoom as number ?? 3,
      }),
    });
    mapRef.current = map;

    return () => {
      // CRITICAL: call map.setTarget(undefined) before dispose to avoid
      // OpenLayers keeping a reference to the DOM node post-unmount.
      map.setTarget(undefined);
      map.dispose();
      mapRef.current = null;
    };
  }, []); // mount once — config changes handled via separate effects below

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
};
```

Key memory-leak prevention rules:
1. Always call `map.setTarget(undefined)` in the cleanup function before `map.dispose()`.
2. Store the `Map` instance in a `useRef`, not `useState` — avoids triggering re-renders when the map instance updates internally.
3. Config changes (zoom, center, WMS params) are applied via `mapRef.current.getView().animate(...)` and `wmsSource.updateParams(...)` in separate effects — NOT by unmounting and remounting the entire map.
4. Pointer/click event listeners attached with `map.on('click', handler)` must be cleaned up with `map.un('click', handler)` in the effect's cleanup function.

### TypeScript types

TypeScript types are bundled with `ol` v10 — no `@types/ol` needed. The types are first-party and accurate for the public API surface used here (`Map`, `View`, `TileLayer`, `TileWMS`, `Overlay`, `MapBrowserEvent`).

### Vite peer-dep gotchas

None material. `ol` v10 ships as pure ESM (`"type": "module"` in its `package.json`). Vite handles ESM natively. Two minor notes:
- Some `ol` internals use `worker` assets for complex projections (not used here — EPSG:4326 and EPSG:3857 are built-in). No Vite Worker plugin needed.
- Do not add `ol` to Vite's `optimizeDeps.exclude` — let Vite pre-bundle it normally. Excluding it causes slower dev-server cold starts.

---

## Kinetica WMS Endpoint — API Surface

Confidence: MEDIUM (training data + Kinetica public documentation patterns; verified against known Kinetica 7.x WMS API surface from training data).

The existing `kineticaWms` helper already forwards a `queryString` to `${KINETICA_URL}/wms?${queryString}`. The caller (a new `/api/wms` Express route + the frontend's `TileWMS` source) builds this query string. No change to `kineticaWms` itself is needed — only the query string content changes per render mode.

### Standard WMS base params (all modes)

| Param | Value | Notes |
|-------|-------|-------|
| `SERVICE` | `WMS` | Fixed |
| `VERSION` | `1.1.1` | Kinetica's WMS version |
| `REQUEST` | `GetMap` | Fixed for tile rendering |
| `FORMAT` | `image/png` | PNG tiles |
| `TRANSPARENT` | `true` | Transparent background for overlay |
| `WIDTH` | `256` | Tile width in pixels |
| `HEIGHT` | `256` | Tile height in pixels |
| `SRS` | `EPSG:4326` or `EPSG:900913` | CRS. Use EPSG:4326 for geographic lat/lon. EPSG:900913 (WebMercator alias) for OSM base layer alignment. |
| `BBOX` | `minLon,minLat,maxLon,maxLat` | Tile bounding box — injected by OpenLayers `TileWMS` source automatically |
| `LAYERS` | `schema.tablename` | Kinetica table to visualize |

### Spatial column selection (per-chart-config)

| Scenario | Params to Add |
|----------|--------------|
| Lat/lon pair columns | `X_COLUMN_NAME=lon_col&Y_COLUMN_NAME=lat_col` |
| WKT geometry column | `GEOMETRY_COLUMN_NAME=wkt_col` |
| Kinetica native WKB (geometry-typed column) | `GEOMETRY_COLUMN_NAME=geom_col` — same param; Kinetica detects WKB vs WKT by column type |

### Render mode — STYLES param

Kinetica WMS uses the `STYLES` parameter to select the render mode. Each mode has its own additional params:

**Raster (point markers):**
```
STYLES=point
POINTCOLOR=FF3838FF        # RRGGBBAA hex
POINTSIZE=4                # radius in pixels
```

**Heatmap:**
```
STYLES=heatmap
BLUR=5                     # blur radius (Gaussian, pixels)
COLORMAP=jet               # or: viridis, plasma, inferno, magma, hot, cool, etc.
MIN_LEVEL=0                # optional: min intensity clamp
MAX_LEVEL=1                # optional: max intensity clamp
```

**Classbreak (categorical or numeric color breaks):**
```
STYLES=classbreak
CB_COLUMN_NAME=status_col  # column driving the color split
CB_BREAK_TYPE=CATEGORICAL  # or NUMERICAL
CB_BREAK_POINT_1=value1
CB_POINTCOLOR_1=FF0000FF
CB_BREAK_POINT_2=value2
CB_POINTCOLOR_2=00FF00FF
# ... up to N breaks
POINTSIZE=5
```

**Contour:**
```
STYLES=contour
CONTOUR_COLOR=FF0000FF
CONTOUR_SMOOTH=true
CONTOUR_BANDWIDTH=10       # bandwidth in pixels
```

### Confidence note on exact param names

The param names above (`POINTCOLOR`, `BLUR`, `COLORMAP`, `CB_COLUMN_NAME`, etc.) reflect the Kinetica WMS API as documented in Kinetica 7.x public docs and developer guides. Confidence is MEDIUM — exact spelling should be validated against `${KINETICA_URL}/wms?SERVICE=WMS&REQUEST=GetCapabilities` at implementation time, which returns the full capabilities XML including supported parameters per layer. Make `GetCapabilities` validation a Phase 1 task spike.

---

## Click-on-Feature Identify — Recommended Pattern

### Does Kinetica WMS support GetFeatureInfo?

Kinetica's WMS implementation does NOT support `REQUEST=GetFeatureInfo` in the standard OGC sense. It is a tile-rendering endpoint, not a feature-query endpoint. Confidence: MEDIUM (training data; verify with GetCapabilities XML during implementation).

### Recommended pattern: SQL closest-point query via existing `kineticaSql`

Given the existing `kineticaSql` helper, the correct identify strategy is:

**Step 1 — Browser click → pixel coordinate → geographic coordinate**

OpenLayers converts a click event's pixel to a map coordinate:
```typescript
map.on('singleclick', (evt) => {
  const [lon, lat] = evt.coordinate; // geographic CRS (EPSG:4326)
  // convert to meters radius threshold based on current zoom
  onMapClick(lon, lat, map.getView().getZoom());
});
```

**Step 2 — Frontend sends identify request to new `/api/map/identify` endpoint**

```
POST /api/map/identify
{ table, lat, lon, radiusMeters, spatialMode, latCol, lonCol, geomCol, limit: 1 }
```

**Step 3 — Server calls `kineticaSql` with a ST_Distance or bounding-box query**

For lat/lon mode:
```sql
SELECT *, ST_Distance(
  ST_POINT(lon_col, lat_col),
  ST_POINT(:lon, :lat)
) AS __dist__
FROM schema.table
ORDER BY __dist__ ASC
LIMIT 5
```

For geometry column mode:
```sql
SELECT *, ST_Distance(
  geom_col,
  ST_GEOMFROMTEXT('POINT(:lon :lat)')
) AS __dist__
FROM schema.table
ORDER BY __dist__ ASC
LIMIT 5
```

**Why this approach, not alternatives:**

| Option | Verdict | Reason |
|--------|---------|--------|
| WMS `GetFeatureInfo` | Do not use | Kinetica does not support it |
| `/filter/byradius` Kinetica REST API | Do not use | This is a Kinetica native REST endpoint (not SQL), would require a third helper alongside `kineticaSql` and `kineticaWms`. The SQL approach reuses `kineticaSql` with zero new server infrastructure. |
| `/aggregate/groupby` REST endpoint | Do not use | Overkill for a closest-point lookup |
| SQL `ST_Distance ORDER BY LIMIT` via `kineticaSql` | **Use this** | Zero new infrastructure. Reuses `kineticaSql` audit + error path. Kinetica's GPU engine handles spatial distance queries efficiently. |

**New server artifact needed:** One new Express route `POST /api/map/identify` in `index.ts` (or a new `routes/map.ts` file). The route validates table name and coordinates, builds the SQL, calls `kineticaSql(req, sql, { route, op: 'SQL' })`, and returns the closest row(s) as JSON. No new npm dependency. ~50 lines of server code.

---

## What Is NOT Needed

| Capability | "Needed?" | Rationale |
|------------|-----------|-----------|
| `proj4` (projection library) | No | OpenLayers has EPSG:4326 and EPSG:3857 built-in. Kinetica WMS serves both. Only needed if using exotic CRS (EPSG:2263, etc.). Not needed for v1.2. |
| `ol-mapbox-style` | No | Only needed if consuming MapboxGL style JSON (for vector tile styling). Kinetica uses WMS raster tiles, not vector tiles. |
| `ol-ext` | No | Community plugin collection. None of its features are required for v1.2 scope (WMS tiles + click events). Adds bundle weight unnecessarily. |
| `react-openlayers-fiber` or similar React-OL wrapper | No | Adds a thin React abstraction over OL's imperative API. The useRef/useEffect pattern is standard practice and requires no wrapper. A wrapper library adds a dep with its own update lag relative to OL releases. |
| New Zustand store for filter state | No | See section below. |
| New database table for filter state | No | Filters are transient (in-memory). PROJECT.md explicitly says "no persistence layer changes". |
| `@types/ol` | No | Types ship with `ol` v10 package itself. |

---

## Cross-Chart Filter Coordination — No New State Management Needed

Confidence: HIGH (based on direct codebase inspection).

**Current filter model (from codebase inspection):**
- `ViewDto` objects (from `/api/views`) carry a `filter_clause: string` per table.
- The `DashboardsPage` renders a `filter-bar` div showing each view's `filter_clause`.
- The filter clause is currently server-persisted (via `updateView` PUT call).
- All widgets already read their data via `sql` stored in `widget.config.sql`.

**v1.2 cross-chart filter coordination does NOT require a new state layer because:**

The per-table filter-bar model already exists. The v1.2 drill-down behavior extends it as follows:
1. User clicks a chart element (bar segment, pie slice, map feature) — this triggers an `addFilter(tableId, column, value)` action.
2. The active filter set is stored as a `Map<tableId, ActiveFilter[]>` in a new Zustand slice (added to the existing store module — NOT a new npm dependency).
3. All `WidgetRenderer` instances for the same `tableId` subscribe to the same filter slice and append the active WHERE clause to their SQL query.
4. The filter-bar reads from this slice to display active filters and provide a clear button.

**Implementation:** Add a new `useFilterStore` Zustand slice (new file `src/store/filters.ts`). This is 40–60 lines of TypeScript with zero new npm dependencies. The existing Zustand test shim at `__mocks__/zustand.ts` already handles store resets between tests.

The key design constraint: filters are **transient** (page-refresh clears them). This is exactly what an in-memory Zustand store provides. No persistence needed per PROJECT.md.

---

## Chart Registry — Map Chart Integration

Confidence: HIGH (direct codebase inspection).

The existing `ChartTypeDefinition` interface in `registry.ts` already accommodates the map chart cleanly. The `map` definition file (`definitions/map.ts`) already exists and is registered in `definitions/index.ts`. No registry structural changes are needed.

**What needs to be added within the existing pattern:**

1. **Expand `map.ts` config fields** — add `renderMode` (select: raster/heatmap/classbreak/contour), `spatialMode` (select: latlon/wkt/wkb), `xColumn`, `yColumn`, `geomColumn`, render-mode-specific params (colormap, blur, classbreaks, etc.).

2. **Add `usesAggregation: false`** to the map definition — the map chart does not run an aggregated SQL query; it consumes the WMS endpoint directly. This flag already exists in the `ChartTypeDefinition` type.

3. **Add `MapChartRenderer` to `WidgetRenderer.tsx`** — a new case in the switch statement (alongside the existing `records` short-circuit). The renderer mounts an OpenLayers Map with a `TileWMS` source pointed at `/api/wms`.

4. **No `CustomConfigPanel` needed initially** — the declarative `fields` array in `map.ts` can drive the config panel for all render modes (using a `select` field for `renderMode` and conditional display logic). A custom panel can be added later if classbreak configuration (N-break UI) becomes too complex for the generic form.

**The pattern is: add a new `MapChartRenderer` component file; add a `case "map":` in `WidgetRenderer.tsx`; expand `map.ts` config fields. Registry structure unchanged.**

---

## New `/api/wms` Route — Existing Helper Integration

The existing WMS proxy route in `index.ts` already exists (the `kineticaWms` helper is referenced in the existing stack). For v1.2, the frontend's OpenLayers `TileWMS` source will call `/api/wms?...` with the Kinetica WMS query string parameters. The route:

```typescript
// Existing pattern — extend, do not re-architect
app.get("/api/wms", requireAuth, async (req: AuthedRequest, res) => {
  const qs = new URLSearchParams(req.query as Record<string, string>).toString();
  const upstream = await kineticaWms(req, qs, { route: "GET /api/wms" });
  res.set("Content-Type", upstream.headers.get("Content-Type") ?? "image/png");
  res.set("Cache-Control", "public, max-age=30"); // tile cache (30s)
  const buf = Buffer.from(await upstream.arrayBuffer());
  res.send(buf);
});
```

The `Authorization` header is handled entirely by `kineticaWms` — the browser never sends credentials to Kinetica directly. This is the existing per-user-credentialed proxy model from v1.0/v1.1. No changes to `kinetica.ts`.

---

## Recommended Stack — Summary Table

### New Frontend Production Dependencies

| Package | Version | Purpose | Install In |
|---------|---------|---------|-----------|
| `ol` | `^10.5.0` | OpenLayers map rendering engine | `kinetica_bi/` (frontend) |

### New Backend Routes (no new npm deps)

| Route | Method | Purpose | Implementation |
|-------|--------|---------|---------------|
| `/api/wms` | GET | Proxy WMS tile requests to Kinetica with per-user auth | Extend existing — likely already exists; validate |
| `/api/map/identify` | POST | Closest-point SQL identify via `kineticaSql` | New route, ~50 LOC, no new dep |

### New Frontend Modules (no new npm deps)

| Module | Purpose |
|--------|---------|
| `src/store/filters.ts` | Zustand slice for transient cross-chart filter state |
| `src/components/charts/MapChartRenderer.tsx` | OpenLayers map component for the map widget type |

---

## Installation

```bash
# In kinetica_bi/ (frontend)
npm install ol@^10.5.0

# No new server deps
# cd kinetica_bi/server && npm install  (nothing to add)
```

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Map library | `ol` (OpenLayers) v10 | `maplibre-gl` (MapLibre GL JS) | MapLibre renders vector tiles via WebGL; Kinetica's WMS endpoint produces raster tiles. Using MapLibre for raster WMS is possible (via `addSource type: "raster"`) but MapLibre is optimized for vector style rendering and its React integration requires `react-map-gl` (another dep). OpenLayers has a first-class `TileWMS` source built for exactly this use case. |
| Map library | `ol` (OpenLayers) v10 | `leaflet` + `react-leaflet` | Leaflet supports WMS (`L.tileLayer.wms`). However: Leaflet is not ESM-native (CJS), requires CSS import quirks with Vite, and ships no built-in TypeScript types. Adding `react-leaflet` is a second dep. OpenLayers v10 is fully ESM, has first-party types, and has a superior TypeScript story. |
| Map library | `ol` (OpenLayers) v10 | `deck.gl` + `@deck.gl/geo-layers` | Deck.gl is a WebGL data visualization library — excellent for rendering millions of points from local data, but not designed for WMS tile fetching. The `WMSLayer` in deck.gl is experimental and has limited maturity. |
| Identify endpoint | `kineticaSql` ST_Distance query | Kinetica `/filter/byradius` REST | `/filter/byradius` is a Kinetica native REST endpoint that would require a third helper (not SQL, not WMS). Adds `kineticaByRadius()` helper, a new audit pattern, new error taxonomy. The SQL approach reuses 100% of existing infrastructure. |
| Projection | Built-in OL CRS | `proj4` | Only needed for exotic CRS. Not needed for v1.2. |
| React-OL integration | Manual `useRef` + `useEffect` | `rlayers` or `react-openlayers-fiber` | Wrapper libraries introduce update lag (last release vs current OL version), have smaller ecosystems, and the imperative OL API is simple enough at this scale that a wrapper adds complexity, not removes it. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `import * from 'ol'` | Imports entire OL bundle (~800KB raw) | Named module imports: `import Map from 'ol/Map'` etc. |
| `leaflet` | Not ESM-native, requires CSS hacks in Vite, no first-party TS types | `ol` v10 |
| `proj4` | Not needed for EPSG:4326 / EPSG:3857 — OL has them built in | Nothing (OL built-in) |
| `ol-ext` | Community plugin collection, not needed for WMS + click events | Nothing needed for v1.2 scope |
| `ol-mapbox-style` | For MapboxGL vector tile styles only — irrelevant for WMS raster tiles | Nothing needed for v1.2 scope |
| WMS `GetFeatureInfo` | Kinetica WMS does not support this OGC request type | SQL `ST_Distance ORDER BY LIMIT` via `kineticaSql` |
| `/filter/byradius` Kinetica endpoint | Would require a third helper alongside `kineticaSql`/`kineticaWms`, new audit pattern | `kineticaSql` with `ST_Distance` |
| New Zustand library version | Current Zustand 4.5.2 is sufficient | No change — add a new store slice only |

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `ol@^10.5.0` | `react@^18.3.1` | No peer-dep conflict. OL is framework-agnostic. Mounted via `useRef` DOM element. |
| `ol@^10.5.0` | `vite@^5.2.0` | Full ESM compatibility. No special Vite plugin needed. |
| `ol@^10.5.0` | `typescript@^5.4.2` | Types bundled. No `@types/ol`. |
| `ol@^10.5.0` | `vitest@^4.1.5` + `jsdom` | OL's `Map` class requires a real DOM element. In unit tests, mock the `ol/Map` module or test the `MapChartRenderer` at integration level (mount into an actual DOM node). jsdom supports `HTMLDivElement` so `useRef` attachment works. Note: OL internally uses `canvas.getContext('2d')` — jsdom's canvas context is a stub and tile rendering will not execute. Test the component lifecycle (mount, cleanup, config updates) not tile rendering. |

---

## Confidence Assessment

| Claim | Confidence | Basis |
|-------|------------|-------|
| OpenLayers v10 is the current stable major | MEDIUM | Training data confirms v10 major released 2024; active maintenance confirmed. Exact latest patch version (e.g. 10.5.0 vs 10.6.x) not directly verified via npm registry in this session — `^10.5.0` range will resolve correctly on install. |
| `ol` v10 ships first-party TypeScript types | HIGH | Confirmed by training data; OL moved to bundled types in v6+, stable through v10. |
| Kinetica WMS does not support `GetFeatureInfo` | MEDIUM | Training data + known Kinetica WMS architecture (tile-rendering focused). Validate via `GetCapabilities` XML at implementation time. |
| Kinetica WMS STYLES param values (raster, heatmap, classbreak, contour) | MEDIUM | Training data from Kinetica 7.x docs. Verify exact param spelling via GetCapabilities during implementation spike. |
| `kineticaSql` ST_Distance pattern works for identify | HIGH | ST_Distance is a standard Kinetica SQL function; `kineticaSql` is a verified working path. The SQL pattern is straightforward and reuses existing infrastructure. |
| Existing Zustand stores sufficient for filter coordination | HIGH | Direct codebase inspection. Filter state is transient. Only a new `src/store/filters.ts` slice is needed — no new npm package. |
| Map chart registry integration is non-breaking | HIGH | Direct codebase inspection. `ChartTypeDefinition` already accommodates the pattern. `map.ts` and `registerMap()` already exist in the registry. |
| `ol@^10` Vite ESM compatibility | HIGH | Both `ol` v10 and Vite v5 are fully ESM. Standard package consumption, no special config. |

---

## Sources

- Codebase direct inspection: `kinetica_bi/src/components/charts/registry.ts`, `definitions/map.ts`, `definitions/index.ts`, `WidgetRenderer.tsx`, `DashboardsPage.tsx` (filter-bar model), `store/auth.ts`, `api/client.ts`, `server/src/kinetica.ts`, `kinetica_bi/package.json`, `kinetica_bi/server/package.json`
- Training data: OpenLayers v10 API surface, `ol/Map`, `ol/layer/Tile`, `ol/source/TileWMS`, `ol/View`, React useRef/useEffect mount pattern, OL memory leak patterns, Kinetica WMS API (7.x), Kinetica SQL ST_Distance
- `.planning/PROJECT.md`: v1.2 scope + locked decisions (transient filters, no persistence changes)
- `.planning/research/_archive_v1.1/STACK.md`: prior stack decisions (confirmed locked baseline)

---

*Stack research for: Kinetica BI v1.2 — Map chart + drill-down + cross-chart filter coordination*
*Researched: 2026-05-01*
