# Phase 11: Map Chart — Research

**Researched:** 2026-05-04
**Domain:** OpenLayers v10 + Kinetica WMS tiles, React 18 lifecycle, filter-store integration
**Confidence:** HIGH (codebase + canonical refs) / MEDIUM (Kinetica WMS exact param names — gated by Wave 1 spike)

## Summary

Phase 11 is a *consumer* phase: it wires a new `map` chart type by composing already-shipped infrastructure (`useFilterStore`, `runSql`, `kineticaWms` proxy, `ChartTypeDefinition`, `CustomConfigPanel` registry slot). The only new npm dependency is `ol@^10.5.0` (current latest is `10.9.0`, published 2026-04-15). All exact Kinetica WMS parameter names — `X_ATTR/X_COLUMN_NAME`, `Y_ATTR/Y_COLUMN_NAME`, `GEO_ATTR/GEOMETRY_COLUMN_NAME`, the `STYLES` values, the server-side filter param (`QUERY` vs `CQL_FILTER`), the colormap catalog, and `ST_Envelope` signature — are MEDIUM confidence and MUST be locked by a `?REQUEST=GetCapabilities` spike against the deployed Kinetica before any WMS construction code is written. Existing research (`.planning/research/STACK.md` lines 110–183 and `.planning/research/PITFALLS.md` M-01..M-08) already enumerates every pitfall and gives a reference param table; this RESEARCH.md is the planner's consolidated, decision-ready summary.

The lifecycle pattern is well-established: `useRef<HTMLDivElement>` for the container, `useRef<Map | null>(null)` as a guard so React 18 Strict Mode's double-invoke of `useEffect` doesn't construct two `Map` instances, and `map.setTarget(undefined); map.dispose()` in the cleanup function. Filter integration uses `tileWmsSource.updateParams({ QUERY, _v: filterVersion })` — never rebuild the map. The 401-REAUTH wrinkle (img-src tile fetches bypass `apiFetch` and therefore the existing REAUTH dispatch chain) has two clean resolutions: (a) a custom `tileLoadFunction` that uses `fetch()` so it can read `response.status` and `window.dispatchEvent(UNAUTHORIZED_EVENT)` on 401, OR (b) listen to OL `tileloaderror` and probe `/api/wms/capabilities` (or any 200-returning endpoint) to detect session-loss; (a) is the recommended approach because it keeps auth-error semantics colocated with the network call.

**Primary recommendation:** Three waves. **Wave 1** = WMS spike + `Cache-Control: no-store` proxy header + `getValidSpatialColumns` helper (parallel; no shared files). **Wave 2** = `MapChartRenderer` skeleton (mount/dispose/basemap/empty-config state) + `MapConfigPanel` shell (spatial-mode picker + render-mode picker only) + `wmsUrlBuilder.ts` skeleton (parallel; depend on Wave 1's spike notes for param names). **Wave 3** = render-mode-specific config groups (heatmap/classbreak/contour/raster) + filter subscription + bbox helper + zoom-to-data + tile-error overlay + 401-REAUTH plumbing (sequential after Wave 2; one or two plans).

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Spatial-column-mode picker (MAP-02):**
- Auto-suggest mode at config-load time:
  - Kinetica geometry-typed col present → suggest `wkb`
  - Long-string column tagged as geometry (or stringified WKT-shaped values) → suggest `wkt`
  - Two numeric columns matching `lat|latitude|y` + `lon|lng|longitude|x` → suggest `latlon`
  - Falls through to `latlon` if no signal detected
  - One-shot default; user override allowed at any time
- Column dropdowns filter to type-compatible columns only:
  - `latlon` → numeric only (`int`, `long`, `float`, `double`, `decimal`)
  - `wkt` → string/geometry-string columns only
  - `wkb` → Kinetica geometry-typed columns only
  - Helper `getValidSpatialColumns(columns, mode): Column[]` colocated with `src/lib/columnTypes.ts`
- Per-mode field preservation in `widget.config`: `latColumn`, `lonColumn`, `wktColumn`, `wkbColumn` are all separate slots so toggling modes preserves prior values
- Hide unsupported modes from picker (driven by `/api/wms/capabilities` probe). Fallback: assume all four modes work if probe fails

**Render-mode config UX (MAP-01):**
- **CustomConfigPanel for map** — drop into the registry's existing escape hatch
- Existing `definitions/map.ts` stub fields (`color`, `markerSize`, `centerLat`, `centerLon`, `zoom`) are removed entirely; CustomConfigPanel owns the new schema
- `definitions/map.ts` retains: `type: "map"`, `label`, `icon`, `usesAggregation: false`, `supportsDrillDown` left UNSET (Phase 12 may flip)

**Classbreak (per M-06):**
- Full N-row builder
- User picks `cbColumn` (filtered to numeric or low-cardinality string columns)
- User picks `cbBreakType ∈ categorical | numerical` (default `numerical` for numeric cols, `categorical` for strings — auto-suggest, override allowed)
- **Cardinality probe at column-pick time** via `runSql` with AbortSignal: `SELECT COUNT(DISTINCT cbColumn) FROM table`
  - Hard cap 256 (Kinetica's classbreak limit)
  - Warning toast at >100 ("That's a lot of breakpoints — consider a heatmap or numerical range instead")
  - Cardinality probe routes through `useApiQuery` for typed-error / REAUTH chain
- Each break row = `value` input + color picker (RGB only, no alpha at row level — opacity is global across breaks)
- Min 2 break rows enforced before save
- Stored as `widget.config.classbreaks: Array<{ value: string | number; color: string }>` plus `widget.config.cbColumn` and `widget.config.cbBreakType`
- Cardinality probe result session-cached per `${tableId}:${cbColumn}` (planner's discretion on storage)

**Heatmap COLORMAP options** (8-entry catalog; intersect with GetCapabilities-derived list):
- Perceptually-uniform: `viridis` (default), `plasma`, `inferno`, `magma`, `cividis`, `turbo`
- Classic: `jet`, `hot`
- Stored as `widget.config.colormap: string`

**Heatmap params:** `BLUR_RADIUS` (range slider; **units = Kinetica map units, NOT pixels** per M-05; UI label: "Blur radius (Kinetica map units)"). Optional `MIN_LEVEL` / `MAX_LEVEL` clamps.

**Raster mode params:**
- `POINTCOLOR`: hex picker (RGB only at picker level; alpha layered separately)
- `POINTSIZE`: range slider 2–20px (THIS is the MAP-04 differentiator point-size slider)
- `POINTOPACITY`: range slider 0–100% — serializes as `RRGGBBAA` suffix on `POINTCOLOR` at WMS-build time. Default 100%.

**Contour mode params:** `CONTOUR_COLOR` (color picker), `CONTOUR_SMOOTH` (boolean toggle), `CONTOUR_BANDWIDTH` (range slider; **units = Kinetica map units per M-05**). Contour stays read-only by design (Phase 12 IDENT-02 locks contour-click out of drill-down).

**MAP-04 differentiators:**
- **Basemap selector — 3 options** (all EPSG:3857, no API key):
  - OSM (default) — `https://{a-c}.tile.openstreetmap.org/{z}/{x}/{y}.png`
  - CartoDB Voyager (light/clean) — `https://{a-c}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png`
  - CartoDB Dark Matter (dark) — `https://{a-c}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png`
  - Stored as `widget.config.basemap: 'osm' | 'voyager' | 'dark'`
  - Switching basemap **swaps the basemap layer's source** (`basemapLayer.setSource(newSource)`) — does NOT rebuild the OL Map instance
  - Each basemap's attribution string is set via OL's `Attribution` control automatically
  - Esri satellite REJECTED for v1.2 (ToS friction); revisit for v1.3
- **Zoom-to-data button:**
  - Toolbar overlay in map's top-right corner — absolute-positioned React button (or OL `Control` — planner's discretion)
  - **Auto-fires once on initial mount** when `spatialMode + columns` are configured. Prevents the "world view" first-impression problem
  - Subsequent renders preserve user's pan/zoom — NO auto-fit on filter change, render-mode change, or basemap change. User must click manually
  - Click handler: invokes bbox SQL helper, then `view.fit(bbox, { padding: [40, 40, 40, 40] })`
- **Bbox SQL caching** — memoize per `${tableId}:${filterVersion}:${spatialMode}`:
  - Lat/lon mode: `SELECT MIN(lon_col) AS minLon, MAX(lon_col) AS maxLon, MIN(lat_col) AS minLat, MAX(lat_col) AS maxLat FROM <table> [WHERE <activeFilters>]`
  - WKT/WKB mode: `SELECT ST_XMin(ST_Envelope(<geom_col>)) AS minLon, ST_XMax(ST_Envelope(<geom_col>)) AS maxLon, ST_YMin(ST_Envelope(<geom_col>)) AS minLat, ST_YMax(ST_Envelope(<geom_col>)) AS maxLat FROM <table> [WHERE <activeFilters>]` — **planner spike confirms ST_Envelope + ST_X{Min,Max} signatures on deployed Kinetica before writing the route. Roll into the existing M-spike**
  - Filter clause built via Phase 9's `buildWhereClause` + `injectWhereClause` (NOT raw concatenation; AP-3 lock)
  - Cache invalidates implicitly when `filterVersion` increments
  - Memo dropped on dashboard switch (existing Phase 9 lifecycle reset is sufficient)
- **Default initial view:** world view at `center: [0, 0], zoom: 2` (EPSG:3857)
- **Empty-config state:** OL Map mounts with world-view default + placeholder text overlay ("Configure spatial columns to render the map" — Claude's discretion on copy). No `TileWMS` layer until config is complete

**Loading / error / filter-active / hover UX (MAP-03):**
- **Per-tile fade-in loading UX (no global spinner)** — CSS opacity transition on each tile element (~200ms ease-out from 0 → 1). OL emits `tileloadstart`/`tileloadend` per tile; CSS handles fade automatically
- **Tile-fetch error UX:**
  - Listen to OL `tileloaderror` events
  - Render error card overlay (centered): "Failed to load map tiles" + "Retry" button → `tileWmsSource.refresh()`. Card dismisses on next successful tile load
  - Toast fires once per error burst (debounce 2s); routed through existing `useToastStore`
  - **401-REAUTH handling:** tile fetches via `<img src="/api/wms?...">` bypass `apiFetch` and won't auto-trigger the existing REAUTH chain. Map must listen for `tileloaderror` with HTTP status 401 (or use a custom `tileLoadFunction` with `fetch()` to read status) and dispatch `window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))` — the existing `App.tsx` listener handles the rest
- **Filter-active visual cue: rely on existing top-of-page filter bar only.** Map widget shows NO per-chart border, badge, or chip overlay. Consistent with Phase 10's locked decision (rejected per-chart borders as visual noise). Tile refetch IS the in-map feedback
- **Hover-tooltip: deferred entirely to Phase 12.** Phase 11 ships NO `pointermove` handler stub

### Claude's Discretion

- Exact removal/replacement strategy for `definitions/map.ts` stub (delete vs preserve as legacy migration values — default deletion; no production widgets exist with old config)
- WMS URL builder file location: `src/lib/wmsUrlBuilder.ts` (suggested) vs colocated in `MapChartRenderer.tsx`
- React-mount component decomposition: single `MapChartRenderer.tsx` (~250–400 LOC) or split into `useMapInstance.ts` + `useTileWmsLayer.ts` hooks + rendering shell
- Capabilities probe endpoint shape: `/api/wms/capabilities` returning `{ renderModes, colormaps, spatialModes }` is suggested; planner may roll into `/api/auth/me` if cleaner. Cache result server-side at boot
- Lazy-loading via `React.lazy(() => import('./MapChartRenderer'))` — planner decides based on bundle-size measurement after `ol@^10.5.0` is added (~120–150 KB gzipped delta expected)
- Classbreak builder UX detail: button + array inputs (default; JSON-edit overkill for v1.2)
- Tile fade-in CSS timing curve, opacity threshold, whether fade applies on `updateParams`-driven refetches
- Whether bbox memo lives in `MapChartRenderer` component scope (`useRef`) or as module-level helper
- Error overlay copy and retry button text
- Bbox memo invalidation on `cbColumn` change (likely a non-issue but worth noting)
- `/api/wms/capabilities` probe `Cache-Control` policy — short-lived browser cache (~5 min) is reasonable

### Deferred Ideas (OUT OF SCOPE)

- Map drill-down (click → identify → addFilter) — Phase 12 (IDENT-01..IDENT-03)
- Hover-tooltip on map features — Phase 12 (uses identify endpoint; ROADMAP §12 TS-M14, 150ms `pointermove` debounce)
- Standalone `heatmap` chart-type renderer (NOT the map's heatmap render mode) — MAP-V13-01
- Multiple map layers per chart — MAP-V13-02
- Custom WMS layer style upload / classification breaks UI editor — MAP-V13-03
- Bbox/lasso spatial select on map — DRILL-V13-02
- Esri satellite basemap — rejected for v1.2 (ToS friction)
- Top-bar progress indicator (alternative to per-tile fade-in) — note for post-launch evaluation
- Vector tile rendering (MapboxGL/MapLibre) — Kinetica is raster WMS only
- JSON-edit fallback for power-user classbreak configuration — overkill for v1.2
- Per-classbreak-row alpha picker — opacity is a global slider for raster mode; classbreak rows use solid colors
- Custom CRS support beyond EPSG:3857 / EPSG:4326 — `proj4` not needed; Kinetica deployments stick to standard CRSs
- `React.lazy` decision for `MapChartRenderer` — Claude's discretion at planning time
- Map widget visual cue when filter is active for its tableId — rejected as inconsistent with Phase 10
- `pointermove` handler stub in Phase 11 — purely Phase 12 territory
- Capabilities probe via `/api/auth/me` extension — Claude's discretion at planning time

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| **MAP-01** | A new `map` chart type renders Kinetica WMS tiles in any of four render modes (raster/heatmap/classbreak/contour) selectable at chart-config time. Exact `STYLES` values confirmed by `?REQUEST=GetCapabilities` spike at start of phase | Standard Stack (`ol@^10.5.0`, `TileWMS`, `TileLayer`); Architecture Patterns (`wmsUrlBuilder.ts` branch on `renderMode`); Code Examples (TileWMS construction + `STYLES`/`COLORMAP`/`CB_*`/`CONTOUR_*` param tables); GetCapabilities spike note (Wave 1) |
| **MAP-02** | Chart-config UI in `CustomConfigPanel` (registry's existing escape hatch). Spatial-column-mode picker: lat/lon (X_ATTR/Y_ATTR), single WKT (GEO_ATTR), Kinetica native WKB (GEO_ATTR with type-spec validation). Reads existing column-type metadata; auto-suggests mode | Standard Stack (CustomConfigPanel registry slot already wired in `ChartConfigPanel.tsx:159-180`); Architecture Patterns (mode-conditional field groups; `getValidSpatialColumns(columns, mode)` helper colocated with `src/lib/columnTypes.ts`); Don't Hand-Roll (use existing `inferDataTypeFromColumn`) |
| **MAP-03** | Standard interactions — pan, zoom, hover-tooltip (Phase 12), loading spinner during initial fetch, error toast on tile-fetch failure. OL `View` locked to `EPSG:3857`; WMS request includes `SRS=EPSG:3857`. Cleanup via `map.setTarget(undefined); map.dispose()` (M-01) | Architecture Patterns (StrictMode-safe useRef guard); Code Examples (mount/cleanup pattern); Common Pitfalls (M-01, M-03); 401-REAUTH plumbing via `tileLoadFunction` |
| **MAP-04** | Three differentiators: point-size slider (raster mode), basemap style selector (OSM default + CartoDB Voyager + CartoDB Dark Matter), "zoom to data" button (one bbox SQL query + `view.fit()`) | Standard Stack (OSM/CartoDB sources via OL XYZ); Architecture Patterns (basemap-source swap, not Map rebuild); bbox SQL helper memoized per `${tableId}:${filterVersion}:${spatialMode}` |
| **FILT-04** | Filter change on map's table → WMS tiles invalidate + refetch via `TileWMS.updateParams()` with new server-side filter param (`QUERY` or equivalent — confirmed via spike). `/api/wms` proxy sets `Cache-Control: no-store` so neither browser nor intermediate cache serves stale tiles after filter change OR per-user OIDC token rotation | Architecture Patterns (filter-store selector subscription pattern AP-1/AP-2); Code Examples (`updateParams({ QUERY, _v: filterVersion })`); Common Pitfalls (M-02 cache-buster, M-08 Cache-Control); Don't Hand-Roll (use `injectWhereClause` from Phase 9 — never raw string concat) |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ol` | `^10.5.0` (current `10.9.0`, published 2026-04-15) | OpenLayers map/view/source library; `Map`, `View`, `TileLayer`, `TileWMS`, `OSM`, `XYZ` | First-class `TileWMS` source built for raster WMS — exactly the Kinetica use case. ESM-native, types ship with the package. Locked by `.planning/research/STACK.md` lines 65–106. **NEW dependency** — not yet in `kinetica_bi/package.json` (verified 2026-05-04) |

### Supporting (already installed)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `react` | `^18.3.1` | Component model, hooks (`useRef`, `useEffect`, `useState`) | All UI — already pinned |
| `zustand` | `^4.5.2` | `useFilterStore` consumer + `useToastStore` consumer | All filter-state reads + toast dispatches — already in use across Phase 9/10 |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `ol` (OpenLayers) | `maplibre-gl` (MapLibre GL JS) | MapLibre is optimized for vector tile WebGL rendering; Kinetica produces raster tiles. MapLibre's raster path works but adds a `react-map-gl` dep on top. OL's `TileWMS` is purpose-built for this case. Locked rejection in `STACK.md` line 369 |
| `ol` (OpenLayers) | `leaflet` | Leaflet is older and has less first-party WMS tile support; OL is the modern standard. Rejected per STACK.md |
| `react-openlayers-fiber` (or any React-OL wrapper) | `ol` directly with refs/effects | Wrapper adds dep with its own update lag relative to OL releases. The `useRef`+`useEffect` pattern is standard practice. Rejected per STACK.md line 258 |

**Installation:**

```bash
npm install ol@^10.5.0
```

**Version verification (2026-05-04, npm registry):**
- `ol@10.9.0` is the current published version (released 2026-04-15)
- `ol@^10.5.0` resolves to `10.9.0` — well within the caret range
- Types ship with the package; **no `@types/ol`** needed (locked, STACK.md line 100)
- ~120–150 KB gzipped delta (per RESEARCH guidance in STACK.md / SUMMARY.md); confirms by measurement after install
- ESM-native (`"type": "module"`); Vite handles natively. Do NOT add to `optimizeDeps.exclude`

### What Is NOT Needed (HIGH confidence — locked in `STACK.md`)

| Capability | Why Not |
|------------|---------|
| `proj4` | OL has EPSG:4326 + EPSG:3857 built-in; Kinetica WMS serves both; not needed unless using exotic CRS |
| `ol-mapbox-style` | Vector tile style consumption only — Kinetica is raster |
| `ol-ext` | Community plugin; none of its features needed for v1.2 scope |
| `react-openlayers-fiber` / `@react-openlayers/fiber` | Standard useRef+useEffect pattern needs no wrapper |
| `@types/ol` | Types ship with `ol` v10 itself |

## Architecture Patterns

### Recommended Project Structure (delta vs current `src/`)

```
src/
├── components/
│   └── charts/
│       ├── MapChartRenderer.tsx       # NEW — OL Map mount, TileWMS, basemap, filter sub
│       ├── MapConfigPanel.tsx          # NEW — CustomConfigPanel for map
│       ├── MapChartRenderer.spec.tsx   # NEW — mount/unmount/cleanup, updateParams call, basemap swap
│       ├── definitions/
│       │   └── map.ts                  # MODIFIED — replace stub fields with WMS schema
│       ├── WidgetRenderer.tsx          # MODIFIED — case "map" branch mounts MapChartRenderer
│       ├── ChartConfigPanel.tsx        # UNCHANGED — CustomConfigPanel branch already routes map
│       └── registry.ts                 # UNCHANGED — interface already supports CustomConfigPanel
├── lib/
│   ├── wmsUrlBuilder.ts                # NEW — pure fn buildWmsParams(config, filterVersion, whereClause)
│   ├── columnTypes.ts                  # MODIFIED — add getValidSpatialColumns(columns, mode)
│   └── ...
└── store/
    ├── filterStore.ts                  # UNCHANGED — pure consumer
    └── toast.ts                        # UNCHANGED — pure consumer

kinetica_bi/server/
└── src/
    └── index.ts                        # MODIFIED — add Cache-Control: no-store to /api/wms;
                                        #            add new /api/wms/capabilities route
```

### Pattern 1: React 18 StrictMode-Safe OpenLayers Mount/Dispose (PITFALL M-01)

**What:** OpenLayers is an imperative library. React 18 Strict Mode invokes `useEffect` twice in development to surface bugs. Without a guard, two `Map` instances are created and only the second is cleaned up.
**When to use:** Every OpenLayers component.
**Example:**

```typescript
// Source: synthesized from OpenLayers docs + taylor.callsen.me + .planning/research/PITFALLS.md M-01
// PITFALL M-01 lock: useRef guard + setTarget(undefined) + dispose() in cleanup.
import { useEffect, useRef } from "react";
import Map from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import OSM from "ol/source/OSM";

const MapChartRenderer = ({ /* widget, columns, ... */ }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);

  useEffect(() => {
    if (mapRef.current) return; // PITFALL M-01: guard against StrictMode double-invoke
    if (!containerRef.current) return;

    const map = new Map({
      target: containerRef.current,
      layers: [
        new TileLayer({ source: new OSM() }),
        // TileWMS layer added later when config is complete
      ],
      view: new View({
        projection: "EPSG:3857",        // PITFALL M-03 lock: lock to Web Mercator
        center: [0, 0],
        zoom: 2,
      }),
    });

    mapRef.current = map;

    return () => {
      // PITFALL M-01 cleanup: detach from DOM AND dispose internal resources.
      map.setTarget(undefined);
      map.dispose();
      mapRef.current = null;
    };
  }, []); // empty deps — mount/unmount only

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
};
```

### Pattern 2: TileWMS Filter Invalidation via `updateParams()` (PITFALL M-02)

**What:** Filter changes call `tileWmsSource.updateParams({ QUERY, _v: filterVersion })` — never rebuild the `Map` instance. The `_v` param is a cache-buster that forces OL's tile cache key to change so previously-loaded tiles aren't reused.
**When to use:** Every filter-store mutation that affects the map's `tableId`.
**Example:**

```typescript
// Source: .planning/research/PITFALLS.md M-02 + OpenLayers GitHub issue #5307 workaround pattern
// PITFALL M-02 lock: updateParams (NOT rebuild) + _v cache-buster.
import { useEffect, useRef } from "react";
import TileWMS from "ol/source/TileWMS";
import { useFilterStore, buildWhereClause } from "../../store/filterStore";

const MapChartRenderer = ({ widget }) => {
  const tileSourceRef = useRef<TileWMS | null>(null);
  const tableId = widget.config.tableId as number;

  // PITFALL C-02 lock: scope selector to filters[tableId]
  // PITFALL S-02 lock: filterVersion is the primitive useEffect dep
  const tableFilters = useFilterStore((s) =>
    tableId !== undefined ? s.filters[tableId] ?? [] : []
  );
  const filterVersion = useFilterStore((s) => s.filterVersion);

  useEffect(() => {
    if (!tileSourceRef.current) return;
    const whereClause = buildWhereClause(tableFilters);
    tileSourceRef.current.updateParams({
      QUERY: whereClause || undefined,  // server-side filter param (verify name in spike)
      _v: filterVersion,                 // PITFALL M-02: cache-buster
    });
    // No source.refresh() call — updateParams already triggers redraw for matched-projection layers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterVersion]);

  // ... rest of renderer
};
```

### Pattern 3: TileWMS Source Construction (Wave 2)

**What:** Build the WMS source with constant base params; all renderMode/spatialMode-specific params come from `wmsUrlBuilder.ts`.
**When to use:** Once, when the user has finished configuring spatial columns.
**Example:**

```typescript
// Source: synthesized from openlayers.org tiled-WMS example + Kinetica WMS API surface
import TileWMS from "ol/source/TileWMS";
import TileLayer from "ol/layer/Tile";

const tileSource = new TileWMS({
  url: `${API_BASE}/api/wms`,        // proxied through Express; per-user-credentialed
  params: {
    SERVICE: "WMS",
    VERSION: "1.1.1",
    REQUEST: "GetMap",
    FORMAT: "image/png",
    TRANSPARENT: true,
    SRS: "EPSG:3857",                 // PITFALL M-03 lock; verify Kinetica accepts in spike
    LAYERS: `${schema}.${table}`,
    ...buildWmsParams(widget.config, filterVersion, whereClause),
  },
  serverType: undefined,              // Kinetica is not GeoServer/MapServer
  transition: 0,                      // disable cross-fade for transparency
  // tileLoadFunction: customLoadFn   // Wave 3 — for 401-REAUTH detection
});

const wmsLayer = new TileLayer({ source: tileSource });
map.addLayer(wmsLayer);
```

### Pattern 4: 401-REAUTH via Custom `tileLoadFunction` (Wave 3)

**What:** OL `tileloaderror` events from native `<img>` element loads do NOT expose the HTTP status code (verified GitHub issue #8445). To detect a 401 from a tile fetch, override the source's `tileLoadFunction` to use `fetch()` so the response object — and therefore the status code — is accessible. On 401, dispatch the existing `UNAUTHORIZED_EVENT` so `App.tsx`'s listener handles the rest (Phase 7 OIDC reauth chain).
**When to use:** Every `TileWMS` instance the map mounts.
**Example:**

```typescript
// Source: openlayers.org TileWMS docs + GitHub issue #8445 + UNAUTHORIZED_EVENT in src/api/client.ts:3
import TileWMS from "ol/source/TileWMS";
import TileState from "ol/TileState";
import { UNAUTHORIZED_EVENT } from "../../api/client";

const tileSource = new TileWMS({ /* ... */ });

tileSource.setTileLoadFunction((tile, src) => {
  fetch(src, { credentials: "include" })
    .then((response) => {
      if (response.status === 401) {
        // Match apiFetch's REAUTH_REQUIRED dispatch — App.tsx already listens for this.
        // No body-peek needed; tile path returns image bytes, not JSON.
        window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
        (tile as any).setState(TileState.ERROR);
        return;
      }
      if (!response.ok) {
        (tile as any).setState(TileState.ERROR);
        return;
      }
      return response.blob();
    })
    .then((blob) => {
      if (!blob) return;
      const img = (tile as any).getImage() as HTMLImageElement;
      img.src = URL.createObjectURL(blob);
    })
    .catch(() => {
      (tile as any).setState(TileState.ERROR);
    });
});
```

**Note:** This pattern requires `import TileState from "ol/TileState"`. The `getImage()` cast is necessary because OL's TileImage interface treats this as protected; the cast is well-established in the OL community for custom load functions.

### Pattern 5: Basemap Swap Without Map Rebuild

**What:** When user picks a different basemap, swap the basemap layer's *source*, not the layer or the map.
**When to use:** Basemap selector `onChange`.
**Example:**

```typescript
// Source: openlayers.org Layer.setSource API + .planning/phases/11-map-chart/11-CONTEXT.md
import OSM from "ol/source/OSM";
import XYZ from "ol/source/XYZ";

const basemapSourceFor = (basemap: "osm" | "voyager" | "dark") => {
  if (basemap === "osm") return new OSM();
  if (basemap === "voyager") {
    return new XYZ({
      url: "https://{a-c}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
      attributions: "© CartoDB © OpenStreetMap contributors",
    });
  }
  return new XYZ({
    url: "https://{a-c}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    attributions: "© CartoDB © OpenStreetMap contributors",
  });
};

useEffect(() => {
  if (!basemapLayerRef.current) return;
  basemapLayerRef.current.setSource(basemapSourceFor(widget.config.basemap));
}, [widget.config.basemap]);
```

### Pattern 6: Spatial Column Validation Helper (collocate with `src/lib/columnTypes.ts`)

```typescript
// Source: synthesized from Phase 10 isColumnDrillDownSafe philosophy + CONTEXT.md spatial-mode picker locks
export type SpatialMode = "latlon" | "wkt" | "wkb";

const NUMERIC_TYPES: ReadonlySet<string> = new Set([
  "int", "integer", "int8", "int16", "int32", "int64",
  "long", "float", "double", "decimal", "numeric",
  "smallint", "bigint", "real", "number", "tinyint",
]);
const STRING_TYPES: ReadonlySet<string> = new Set(["string", "varchar", "text", "char"]);
const KINETICA_GEOMETRY_TYPES: ReadonlySet<string> = new Set([
  "geometry", "geography", "wkb", "point",
]);
const WKT_HOSTING_TYPES: ReadonlySet<string> = new Set([
  ...STRING_TYPES, "wkt",
]);

export type Column = { name: string; type: string };

export function getValidSpatialColumns(columns: Column[], mode: SpatialMode): Column[] {
  return columns.filter((c) => {
    const t = c.type.toLowerCase().replace(/\(.*\)/, "").trim();
    if (mode === "latlon") return NUMERIC_TYPES.has(t);
    if (mode === "wkt") return WKT_HOSTING_TYPES.has(t);
    return KINETICA_GEOMETRY_TYPES.has(t); // wkb mode
  });
}

export function autoSuggestSpatialMode(columns: Column[]): SpatialMode {
  const lower = columns.map((c) => ({ name: c.name.toLowerCase(), type: c.type.toLowerCase() }));
  const hasGeometry = lower.some((c) => KINETICA_GEOMETRY_TYPES.has(c.type.replace(/\(.*\)/, "").trim()));
  if (hasGeometry) return "wkb";
  const hasWktHint = lower.some((c) => c.type.includes("wkt"));
  if (hasWktHint) return "wkt";
  const hasLat = lower.some((c) => /^(lat|latitude|y)$/.test(c.name));
  const hasLon = lower.some((c) => /^(lon|lng|longitude|x)$/.test(c.name));
  if (hasLat && hasLon) return "latlon";
  return "latlon"; // fallback
}
```

### Pattern 7: Bbox SQL Helper (Memoized)

```typescript
// Source: .planning/phases/11-map-chart/11-CONTEXT.md "Bbox SQL caching" lock
// PITFALL spike: ST_Envelope + ST_X{Min,Max} signatures verified by Wave 1 spike against deployed Kinetica
// AP-3 lock: filter clause via Phase 9 buildWhereClause + injectWhereClause (NEVER raw concat)
import { runSql } from "../api/client";
import { buildWhereClause, injectWhereClause, type ActiveFilter } from "../store/filterStore";

export type Bbox = [minLon: number, minLat: number, maxLon: number, maxLat: number];

const bboxCache = new Map<string, Bbox>();

export async function fetchBbox(args: {
  table: string;
  spatialMode: SpatialMode;
  latColumn?: string; lonColumn?: string;
  geomColumn?: string;
  filters: ActiveFilter[];
  filterVersion: number;
  signal?: AbortSignal;
}): Promise<Bbox> {
  const cacheKey = `${args.table}:${args.filterVersion}:${args.spatialMode}`;
  const cached = bboxCache.get(cacheKey);
  if (cached) return cached;

  let baseSql: string;
  if (args.spatialMode === "latlon") {
    baseSql = `SELECT MIN(${args.lonColumn}) AS minLon, MAX(${args.lonColumn}) AS maxLon, MIN(${args.latColumn}) AS minLat, MAX(${args.latColumn}) AS maxLat FROM ${args.table}`;
  } else {
    // WKT or WKB — uses Kinetica's ST_Envelope (verify signature in Wave 1 spike)
    const c = args.geomColumn!;
    baseSql = `SELECT ST_XMin(ST_Envelope(${c})) AS minLon, ST_XMax(ST_Envelope(${c})) AS maxLon, ST_YMin(ST_Envelope(${c})) AS minLat, ST_YMax(ST_Envelope(${c})) AS maxLat FROM ${args.table}`;
  }
  const finalSql = injectWhereClause(baseSql, buildWhereClause(args.filters));
  const result = await runSql<Record<string, unknown>>(finalSql, undefined, args.signal);
  // parseKineticaResponse columnar → bbox tuple ...
  const bbox: Bbox = [/* parsed from result */] as Bbox;
  bboxCache.set(cacheKey, bbox);
  return bbox;
}
```

### Anti-Patterns to Avoid

- **Rebuilding the OL `Map` instance on filter change** (M-02 violation): destroys pan/zoom state, causes tile thrash. Use `tileSource.updateParams(...)` only.
- **Subscribing to whole `useFilterStore.filters` map** (C-02 violation): the map widget would re-render on any other table's filter mutation. Always selector-scoped: `useFilterStore((s) => s.filters[tableId] ?? [])`.
- **Storing filter state in component-local `useState`** (AP-1 / S-01 violation): the source of truth is `useFilterStore`. The map is a pure consumer.
- **Refetching SQL on tile invalidation** (AP-2 violation): map tiles and SQL chart data have INDEPENDENT lifecycles. The map subscribes only to `filterVersion` for tile invalidation, not to the bar/line/pie SQL refetch path.
- **Raw string concatenation of filter values into the WMS `QUERY` param** (AP-3 violation): always go through Phase 9's `buildWhereClause`/`injectWhereClause`/`escapeKineticaStringLiteral`.
- **Reading `tableId` at render time via table-name lookup** (AP-4 violation): `widget.config.tableId` is persisted at config-save time (Phase 9 09-02). Read it directly.
- **Using OpenLayers' client-side `Heatmap` layer instead of WMS heatmap** (locked rejection in PITFALLS.md M-05): client-side heatmap requires pulling all data to the client, defeating Kinetica's GPU rendering.
- **Caching tiles in the browser without `Cache-Control: no-store`** (M-08 violation): browser HTTP cache is not auth-aware; cached tiles bypass the per-user-credentialed proxy.
- **Concatenating filter values raw into a WMS `CQL_FILTER`** (M-07 + AP-3 violation): WMS URL length limit is ~8 KB; the 10-filter cap from Phase 9 is the primary defense, but the URL builder MUST also stay under the cap.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Filter state | A new map-local `useState<ActiveFilter[]>` | `useFilterStore(state => state.filters[tableId] ?? [])` selector | AP-1 lock — single source of truth across charts |
| SQL WHERE-clause assembly | String concat of `col = 'value'` | `buildWhereClause(filters)` from Phase 9 | AP-3 lock; handles NULL, datetime, escape edge cases |
| WHERE clause injection into SQL | Regex / sed / search-replace | `injectWhereClause(baseSql, whereClause)` from Phase 9 | Already battle-tested for `GROUP BY` / `ORDER BY` / `LIMIT` patterns |
| Single-quote escaping | `value.replace("'", "''")` | `escapeKineticaStringLiteral(value)` from Phase 9 | AP-3 lock — single sanctioned interpolation path |
| Column-type compatibility | New `isMapSafe(type)` next to drill-down's | `getValidSpatialColumns(columns, mode)` colocated with existing `columnTypes.ts` | Mirrors Phase 10's `isColumnDrillDownSafe` philosophy; one file, one mental model |
| Map cleanup boilerplate | `useEffect` returning a closure that nulls all refs | `map.setTarget(undefined); map.dispose()` (M-01 lock) | OpenLayers' canonical pattern; one line each |
| Tile cache invalidation on filter change | Manual `source.refresh()` on every mutation | `tileSource.updateParams({ ..., _v: filterVersion })` (M-02 lock) | `_v` cache-buster + `updateParams` triggers redraw without flicker |
| WMS basemap implementation | Custom canvas tile loader | OL's `OSM()` and `XYZ` sources | First-party, attribution-aware, EPSG:3857-native |
| Cardinality counting | Client-side `Set` over fetched rows | `SELECT COUNT(DISTINCT col)` via `runSql` | M-06 lock; pushes to Kinetica's GPU; bounded round-trip |
| 401 detection on tile load | Polling `/api/auth/me` | Custom `tileLoadFunction` reading `response.status` → `dispatchEvent(UNAUTHORIZED_EVENT)` | Reuses existing Phase 7 REAUTH chain in `App.tsx` |
| Bbox calculation | Client-side `Math.min/max` over data points | `SELECT MIN/MAX/ST_Envelope(...)` via `runSql` | Server-side; works for arbitrarily-large tables; honors active filters |
| Toast for tile errors | Custom React state | `useToastStore.getState().showToast(...)` (debounced 2s burst) | Existing toast infrastructure; shipped Phase 9/10 |
| WMS proxy | Direct `fetch(KINETICA_URL/wms)` from browser | Existing `/api/wms` server route (per-user-credentialed) | I-01 lock — credentials live server-side only |

**Key insight:** Phase 11 is a *consumer* phase. Almost every cross-cutting concern (filters, SQL safety, AbortController, REAUTH, toasts, store-reset shim, drill-down infrastructure) was already shipped in Phases 9 and 10. The only genuinely new code is OpenLayers wiring + WMS URL building + the `Cache-Control: no-store` header + the capabilities probe endpoint.

## Common Pitfalls

### Pitfall M-01: OpenLayers React 18 Strict Mode Double Mount
**What goes wrong:** Strict Mode invokes `useEffect` twice in development. Without a guard, two `Map` instances are created on the same `containerRef`. Only the second is cleaned up; the first leaks DOM nodes, event listeners, and tile fetches in flight.
**Why it happens:** OpenLayers is imperative; React 18's `useEffect` semantic is "may run multiple times for the same logical mount."
**How to avoid:** `useRef<Map | null>(null)` guard at the top of the effect (`if (mapRef.current) return;`). Cleanup function calls `map.setTarget(undefined); map.dispose(); mapRef.current = null;`.
**Warning signs:** Tile-fetch network calls firing twice on mount in dev mode; map container has duplicate `<canvas>` children.

### Pitfall M-02: Filter Change Rebuilds the Map Instead of Updating Source Params
**What goes wrong:** Developer calls `setMap(new Map(...))` or recreates the `TileLayer` on filter change. User loses pan/zoom state; tiles thrash; basemap remounts unnecessarily.
**Why it happens:** Misreading `tileSource.params` as immutable. OL's official pattern is `tileSource.updateParams({...})` for any in-place WMS param change.
**How to avoid:** Filter-subscription `useEffect` calls `tileSourceRef.current.updateParams({ QUERY: whereClause, _v: filterVersion })`. Map is constructed once and lives for the entire dashboard session.
**Warning signs:** Map flickers / re-centers on filter change; unit test asserting "Map constructor called once" fails.

### Pitfall M-03: Projection Mismatch Between OL View and WMS Request
**What goes wrong:** OL `View` is in EPSG:3857 (Web Mercator, the default for OSM-style basemaps). WMS request says `SRS=EPSG:4326` (geographic lat/lon). Tiles render at the wrong place — the bug passes visual inspection at low zoom but is increasingly off at high zoom.
**Why it happens:** Two CRSs both seem reasonable; defaults differ across libraries.
**How to avoid:** Lock OL `View` to `projection: "EPSG:3857"`. Add `SRS=EPSG:3857` to WMS request explicitly. Confirm Kinetica accepts `EPSG:3857` (alias `EPSG:900913`) in Wave 1 spike. Fallback if Kinetica only accepts EPSG:4326: configure a dedicated OL Projection object (still not the path of least resistance — push back on Kinetica config first).
**Warning signs:** Tiles offset from basemap; offset grows with zoom level.

### Pitfall M-04: WKT vs Kinetica WKB Branch
**What goes wrong:** User picks a Kinetica geometry-typed column, code passes it as `GEO_ATTR=col_name`. If Kinetica encodes the column as native WKB but the WMS request treats it as WKT, response is empty tiles or a 400.
**Why it happens:** Both column types appear as a single column in the schema; the difference is only visible in the column's `DATA_TYPE` (string vs `geometry` / `wkb`).
**How to avoid:** Detect column type from schema metadata at config time (read `selectedTable.columns[colName]`). Surface detected type in `MapConfigPanel`. Branch `wmsUrlBuilder.ts` on `spatialMode`: `latlon → X_COLUMN_NAME + Y_COLUMN_NAME`; `wkt → GEOMETRY_COLUMN_NAME` (text-typed col); `wkb → GEOMETRY_COLUMN_NAME` (geometry-typed col). Verify exact param spelling in Wave 1 spike.
**Warning signs:** Tiles appear empty or all-white when geometry column is configured; Kinetica WMS log shows column-type-mismatch error.

### Pitfall M-05: Heatmap BLUR_RADIUS / Contour CONTOUR_BANDWIDTH Units
**What goes wrong:** Developer assumes `BLUR_RADIUS` is in pixels (matching OL's client-side `Heatmap.blur`). Kinetica WMS treats it as map units (degrees if EPSG:4326, meters if EPSG:3857). A pixel-scale value (e.g., `5`) is interpreted as 5 degrees of blur — entire heatmap blurs into a single solid color.
**Why it happens:** Two render paths (OL client-side `Heatmap` layer vs Kinetica server-side WMS heatmap) use the same English term "blur radius" with different units.
**How to avoid:** UI label clarifies units: `"Blur radius (Kinetica map units)"`. Default values tested at representative zoom levels (e.g., zoom 5 → `BLUR_RADIUS=5`, zoom 10 → `BLUR_RADIUS=0.5`). Same treatment for `CONTOUR_BANDWIDTH`.
**Warning signs:** Heatmap renders as a solid color across the entire visible extent OR as near-invisible dots at the user's working zoom level.

### Pitfall M-06: Classbreak Cardinality
**What goes wrong:** User selects an `id`-like column for classbreak. Kinetica must generate a 10,000-entry color scheme; tile request takes >10s; tile is unrenderable; legend is unusable.
**Why it happens:** No cardinality check before classbreak request.
**How to avoid:** At column-pick time, fire `SELECT COUNT(DISTINCT col) FROM table` via `runSql` (with AbortSignal — Phase 9 09-02). Hard cap 256 (Kinetica's documented limit). Warn at >100 with toast: "That's a lot of breakpoints — consider a heatmap or numerical range instead." Hard-block request when `cardinality > 256`. Cardinality probe routes through `useApiQuery` for typed-error / REAUTH chain.
**Warning signs:** Map widget loading state lasts >10s when classbreak is selected; Kinetica returns a 400 with a body resembling "too many classbreak values."

### Pitfall M-07: WMS URL Length
**What goes wrong:** Each active filter adds parameters to the WMS URL. With 10 filters chained as `CQL_FILTER`, URL exceeds ~8 KB browser/proxy limit; request 414s.
**Why it happens:** GET URL length limits are sneaky — browsers vary; Express defaults to ~8 KB.
**How to avoid:** Phase 9's 10-filter cap (D-04 lock) is the primary defense. Secondary: monitor URL length in `wmsUrlBuilder.ts`. Tertiary: if length exceeds threshold, log a console warning and fall back to a `kineticaWmsPost` variant (server-side helper variant — not in v1.2 scope unless field-tested URL length issues surface).
**Warning signs:** Filter chains of ~9–10 long-string values produce 414 Request-URI Too Large.

### Pitfall M-08: `Cache-Control: no-store` on `/api/wms`
**What goes wrong:** Browser caches a tile from before a filter change. Browser serves the stale tile (auth-bypassed) on next request — user sees pre-filter data, OR a tile from an expired OIDC session.
**Why it happens:** Browser HTTP cache is NOT auth-aware. Without explicit `Cache-Control: no-store`, the browser inherits whatever Kinetica's WMS returns (which may include `Expires` or `Cache-Control: max-age`).
**How to avoid:** Add `res.setHeader("Cache-Control", "no-store")` in `kinetica_bi/server/src/index.ts:659-668` `/api/wms` route handler. Apply to `/api/wms/capabilities` too (or use a short max-age — e.g., 5 min — since capabilities rarely change). One fix covers M-02 (filter change cache) + M-08 (OIDC token rotation cache).
**Warning signs:** Network tab shows `(from cache)` for tiles after filter change; tiles persist after logout in same browser session.

### Pitfall M-spike (NEW): GetCapabilities Param Confirmation
**What goes wrong:** Implementing WMS construction with the param names from research training data; Kinetica's deployed WMS uses slightly different names (`X_ATTR` vs `X_COLUMN_NAME`, `BLUR` vs `BLUR_RADIUS`, `QUERY` vs `CQL_FILTER`); request returns empty tiles or a 400.
**Why it happens:** Kinetica WMS API surface is MEDIUM confidence in research; exact spellings vary across Kinetica 7.x point releases.
**How to avoid:** **Wave 1 spike — required first**. Call `${KINETICA_URL}/wms?SERVICE=WMS&REQUEST=GetCapabilities` (via the existing `kineticaWms` helper, `route: "GET /api/wms"`, with a one-shot dev script or temporary `/api/wms/capabilities` route). Parse the XML and write findings to `.planning/phases/11-map-chart/11-SPIKE-NOTES.md` (planner names this) BEFORE writing `wmsUrlBuilder.ts`. Confirm:
  1. Spatial column param names: `X_ATTR` / `Y_ATTR` / `GEO_ATTR` vs `X_COLUMN_NAME` / `Y_COLUMN_NAME` / `GEOMETRY_COLUMN_NAME`
  2. `STYLES` values for each render mode: raster (`point` / `raster`?), heatmap (`heatmap`), classbreak (`classbreak`), contour (`contour`)
  3. Server-side filter param: `QUERY` vs `CQL_FILTER` vs `WHERE` vs `FILTER`
  4. Projection support: `SRS=EPSG:3857` vs `EPSG:900913` vs only `EPSG:4326`
  5. Per-render-mode params: `POINTCOLOR` / `POINTSIZE` / `POINTOPACITY` (or `POINT_COLOR` etc.); `BLUR_RADIUS` / `COLORMAP` / `MIN_LEVEL` / `MAX_LEVEL`; `CB_COLUMN_NAME` / `CB_BREAK_TYPE` / `CB_BREAK_POINT_*` / `CB_POINTCOLOR_*`; `CONTOUR_COLOR` / `CONTOUR_SMOOTH` / `CONTOUR_BANDWIDTH`
  6. Available colormaps (intersect with the 8-entry catalog)
  7. `ST_Envelope` + `ST_XMin/ST_XMax/ST_YMin/ST_YMax` SQL signatures (test query against bbox SQL)
**Warning signs:** N/A — by definition this gates everything else.

### Pitfall: 401-REAUTH on Tile Fetches Bypasses `apiFetch`
**What goes wrong:** OIDC session expires while user is on the dashboard. SQL chart fetches go through `apiFetch` and dispatch `UNAUTHORIZED_EVENT`. WMS tile fetches go via `<img src="/api/wms?...">` — they DON'T go through `apiFetch`, so they don't dispatch the event. User stares at a broken map until they navigate away.
**Why it happens:** OL's default `tileLoadFunction` uses native `<img>` element loading, not `fetch`. Native `<img>` loads don't expose HTTP status to JavaScript (the image just fails silently or shows alt text).
**How to avoid:** Override `tileLoadFunction` to use `fetch()` so `response.status` is readable. On 401, dispatch `window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))` and call `tile.setState(TileState.ERROR)`. The existing `App.tsx` listener picks up the event and runs the OIDC reauth chain. (Pattern verified against OpenLayers GitHub issue #8445 + Phase 7 OIDC reauth wiring.)
**Warning signs:** Map remains stale + showing failed tiles after OIDC session expires; SQL charts on the same dashboard correctly trigger reauth.

## Code Examples

(Code examples are inline in the Architecture Patterns section above — Pattern 1 through Pattern 7. They are repeated here as a quick lookup index.)

| Pattern | Section | Source |
|---------|---------|--------|
| Mount/dispose lifecycle (M-01) | Pattern 1 | OpenLayers + taylor.callsen.me; PITFALLS.md M-01 |
| `updateParams()` filter invalidation (M-02) | Pattern 2 | OpenLayers GitHub #5307 + PITFALLS.md M-02 |
| TileWMS source construction | Pattern 3 | openlayers.org tiled-WMS example + STACK.md WMS API table |
| 401-REAUTH via `tileLoadFunction` | Pattern 4 | OpenLayers GitHub #8445 + `src/api/client.ts:3` (`UNAUTHORIZED_EVENT`) |
| Basemap source swap | Pattern 5 | OpenLayers Layer.setSource API + CONTEXT.md basemap selector |
| `getValidSpatialColumns` helper | Pattern 6 | Phase 10 `isColumnDrillDownSafe` philosophy + CONTEXT.md spatial-mode locks |
| Bbox SQL helper (memoized) | Pattern 7 | CONTEXT.md "Bbox SQL caching" lock + Phase 9 SQL builders |

### Reference: Kinetica WMS Param Tables (MEDIUM CONFIDENCE — confirm in Wave 1 spike)

```text
# Standard base params (all modes) — from STACK.md
SERVICE=WMS
VERSION=1.1.1
REQUEST=GetMap
FORMAT=image/png
TRANSPARENT=true
WIDTH=256
HEIGHT=256
SRS=EPSG:3857          # PITFALL M-03; verify in spike
LAYERS=schema.tablename
BBOX=...               # injected by OL TileWMS source automatically

# Spatial column selection
Lat/lon pair:   X_COLUMN_NAME=lon_col & Y_COLUMN_NAME=lat_col
WKT geometry:   GEOMETRY_COLUMN_NAME=wkt_col
Kinetica WKB:   GEOMETRY_COLUMN_NAME=geom_col       # Kinetica detects WKB vs WKT by column type

# Render mode — STYLES param

STYLES=point                         # raster
POINTCOLOR=FF3838FF                  # RRGGBBAA (alpha layered from POINTOPACITY at build time)
POINTSIZE=4                          # px

STYLES=heatmap                       # heatmap
BLUR_RADIUS=5                        # PITFALL M-05: Kinetica map units, NOT pixels
COLORMAP=viridis                     # 8-entry catalog (viridis, plasma, inferno, magma, cividis, turbo, jet, hot)
MIN_LEVEL=0                          # optional
MAX_LEVEL=1                          # optional

STYLES=classbreak                    # classbreak
CB_COLUMN_NAME=status_col
CB_BREAK_TYPE=CATEGORICAL            # or NUMERICAL
CB_BREAK_POINT_1=value1
CB_POINTCOLOR_1=FF0000FF
CB_BREAK_POINT_2=value2
CB_POINTCOLOR_2=00FF00FF
# ... up to N (cardinality cap 256, M-06)
POINTSIZE=5

STYLES=contour                       # contour
CONTOUR_COLOR=FF0000FF
CONTOUR_SMOOTH=true
CONTOUR_BANDWIDTH=10                 # PITFALL M-05: Kinetica map units, NOT pixels

# Server-side filter (FILT-04)
QUERY=<URL-encoded WHERE clause from buildWhereClause>     # OR CQL_FILTER — confirm in spike
_v=<filterVersion>                                          # PITFALL M-02 cache-buster
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `react-openlayers` / wrapper libs | Direct `useRef`+`useEffect` with OL imperative API | Standardized in OL v6+; reaffirmed in OL v10 | No wrapper lag; first-class TypeScript; smaller bundle |
| `setTarget(null)` (legacy/community advice) | `setTarget(undefined); dispose()` | OL v6+ | `dispose()` releases internal resources beyond just DOM detach |
| `source.refresh()` after `updateParams` | `updateParams({ ..., _v: cacheBuster })` then nothing | Established in OL v6+ | `refresh()` causes flicker; cache-buster + native re-tiling is smoother |
| Native `<img>`-based tile load | Custom `tileLoadFunction` with `fetch()` for auth detection | Common pattern by OL v6+ | Required for 401 detection; native `<img>` doesn't expose status |
| EPSG:4326 default | EPSG:3857 default for any OSM-aligned basemap | OL v3+ | Tile alignment with OSM-style basemaps requires EPSG:3857 |
| `@types/ol` | First-party types in `ol` package | OL v6+ | One fewer dep; types track API exactly |

**Deprecated/outdated:**

- `ol-mapbox-style` for raster WMS — only relevant for vector tile styling; Kinetica is raster
- Direct `<img>` element manipulation for auth-protected tiles — superseded by `tileLoadFunction` + `fetch`
- Single-image WMS (`ImageWMS`) for full-resolution rendering — `TileWMS` is faster and more cache-friendly; relevant only for very small viewports

## Open Questions

1. **Exact Kinetica WMS parameter spellings for the deployed instance**
   - **What we know:** Research training data + Kinetica 7.x public docs strongly suggest `X_COLUMN_NAME`/`Y_COLUMN_NAME`/`GEOMETRY_COLUMN_NAME`, `STYLES=point/heatmap/classbreak/contour`, `QUERY` for server-side filters, `BLUR_RADIUS` (not `BLUR`), `COLORMAP` for heatmap, `CB_*` prefix for classbreak (STACK.md lines 134–183).
   - **What's unclear:** Some Kinetica 7.x docs reference `X_ATTR`/`Y_ATTR`/`GEO_ATTR` shorthand. Newer/older deployments may differ. Filter param could be `QUERY`, `CQL_FILTER`, `WHERE`, or `FILTER`.
   - **Recommendation:** **Wave 1 spike — required**. Call `${KINETICA_URL}/wms?SERVICE=WMS&REQUEST=GetCapabilities`. Parse XML and write findings to a spike note before writing `wmsUrlBuilder.ts`. ROADMAP §11 already calls this out; CONTEXT.md "canonical_refs" already lists the spike as gating all WMS code.

2. **`ST_Envelope` + `ST_X{Min,Max}` / `ST_Y{Min,Max}` signatures on the deployed Kinetica**
   - **What we know:** Kinetica's spatial SQL function set generally aligns with OGC SFS; signatures are conventional.
   - **What's unclear:** Some Kinetica versions use slightly different function names (e.g., `STXMIN` vs `ST_XMin`; case-sensitivity).
   - **Recommendation:** Roll into the same Wave 1 spike — confirm both `GetCapabilities` AND `SELECT ST_XMin(ST_Envelope(geom_col)) FROM <table>` against deployed Kinetica.

3. **`SRS=EPSG:3857` vs `SRS=EPSG:900913` (Web Mercator alias)**
   - **What we know:** EPSG:3857 is the modern standard; EPSG:900913 is the legacy alias used by some servers.
   - **What's unclear:** Deployed Kinetica may accept one but not the other.
   - **Recommendation:** Wave 1 spike — try both. Lock to whichever the server accepts. If only EPSG:4326, configure a dedicated OL Projection object (not the easy path; push back on Kinetica config first).

4. **Available `COLORMAP` options on the deployed Kinetica**
   - **What we know:** 8-entry catalog (`viridis`, `plasma`, `inferno`, `magma`, `cividis`, `turbo`, `jet`, `hot`) is the user-facing target.
   - **What's unclear:** Some older Kinetica releases may not include `cividis` or `turbo`.
   - **Recommendation:** GetCapabilities response lists supported colormaps. Intersect with the 8-entry catalog and surface the intersection in the picker. Honest UX, no broken paths.

5. **`/api/wms/capabilities` endpoint shape**
   - **What we know:** Server-side cached at boot; frontend reads once and uses to gate picker options. CONTEXT.md suggests `{ renderModes, colormaps, spatialModes }`.
   - **What's unclear:** Whether to build a standalone endpoint or extend `/api/auth/me`. Standalone is the suggested default.
   - **Recommendation:** Standalone `/api/wms/capabilities`. Cache result in-process at boot. Short browser cache (5 min). Fall back to assuming all four modes work if probe fails (graceful degradation).

6. **`POINTOPACITY` as a separate slider serializing to `RRGGBBAA`**
   - **What we know:** CONTEXT.md locks: `POINTCOLOR` is hex picker (RGB only); `POINTOPACITY` is a separate slider 0–100%; serialized as alpha suffix at WMS build time.
   - **What's unclear:** Whether Kinetica's `POINTCOLOR` accepts 8-digit RRGGBBAA, OR whether opacity is a separate `POINTOPACITY` param.
   - **Recommendation:** Wave 1 spike confirms. If only `POINTCOLOR=RRGGBBAA`, the build step concatenates color + opacity. If a separate param exists (`POINTOPACITY`, `POINT_ALPHA`, etc.), use that.

7. **Bundle-size impact of `ol@^10.5.0`**
   - **What we know:** STACK.md / SUMMARY.md estimate ~120–150 KB gzipped delta.
   - **What's unclear:** Actual measured impact post-install.
   - **Recommendation:** Measure after install. If >200 KB gzipped, consider `React.lazy(() => import('./MapChartRenderer'))` so the OL bundle is only loaded when a map widget is on the dashboard. Dashboard-without-map performance unchanged.

## Sources

### Primary (HIGH confidence)

- `.planning/research/STACK.md` (lines 65–183, 251–305) — `ol@^10.5.0`, WMS API table, what NOT to use, registry integration pattern
- `.planning/research/PITFALLS.md` (M-01..M-08, lines 117–230, 595–672) — every pitfall with mitigation; URL-length, cache-control, blur-radius units, classbreak cardinality, projection mismatch
- `.planning/research/SUMMARY.md` — synthesized v1.2 architecture; pitfall map; spike requirement
- `.planning/research/ARCHITECTURE.md` — filter-store integration, cross-chart coordination, AP-1/AP-2/AP-4
- `.planning/REQUIREMENTS.md` (MAP-01..MAP-04 + FILT-04, lines 30–37, 18) — verbatim phase requirements
- `.planning/ROADMAP.md` (Phase 11 section, lines 114–145) — five success criteria, M-01..M-08 locks, AP-1/AP-2/AP-4 locks
- `.planning/phases/11-map-chart/11-CONTEXT.md` — user decisions, locked + discretion + deferred (this RESEARCH.md mirrors them in `<user_constraints>`)
- `.planning/phases/09-filter-foundation/09-CONTEXT.md` — filter store contract, AbortSignal pattern, SQL builders
- `.planning/phases/10-existing-chart-drill-down/10-CONTEXT.md` — column-type philosophy, CustomConfigPanel pattern reference
- `kinetica_bi/server/src/index.ts:657-668` — existing `/api/wms` proxy route (Cache-Control header location)
- `kinetica_bi/server/src/kinetica.ts:239-312` — `kineticaWms` helper (no helper changes needed)
- `kinetica_bi/src/components/charts/registry.ts` — `ChartTypeDefinition` interface, CustomConfigPanel slot
- `kinetica_bi/src/components/charts/definitions/map.ts` — current stub fields to be replaced
- `kinetica_bi/src/components/charts/WidgetRenderer.tsx` — `case "map"` branch; widget renderer entry
- `kinetica_bi/src/components/charts/ChartConfigPanel.tsx:159-180` — CustomConfigPanel branch routing
- `kinetica_bi/src/store/filterStore.ts` — `useFilterStore`, `buildWhereClause`, `injectWhereClause`, `escapeKineticaStringLiteral`
- `kinetica_bi/src/store/toast.ts` — `useToastStore.getState().showToast()`
- `kinetica_bi/src/api/client.ts:3, 36-57` — `UNAUTHORIZED_EVENT` constant + `apiFetch` REAUTH dispatch path; `runSql` with AbortSignal
- `kinetica_bi/src/lib/columnTypes.ts` — drill-down utilities + new `getValidSpatialColumns` placement
- `kinetica_bi/src/test/setup.ts` + `kinetica_bi/__mocks__/zustand.ts` — Zustand store-reset shim (S-03 lock)
- `kinetica_bi/vitest.config.ts` — `src/**/*.spec.{ts,tsx}` glob, jsdom env (OL canvas is jsdom-stubbed)
- `kinetica_bi/package.json` — confirms `ol` is NOT yet installed; React 18.3.1, Zustand 4.5.2, Vitest 4.1.5
- npm registry verification (2026-05-04) — `ol@10.9.0` current; `^10.5.0` resolves correctly; published 2026-04-15

### Secondary (MEDIUM confidence — verified web sources)

- OpenLayers v10.9.0 API docs — TileWMS class, Map class, tiled-WMS example
- OpenLayers GitHub Issue #8445 — `tileloaderror` does not expose status code; recommended workaround is custom `tileLoadFunction` with `fetch()`
- OpenLayers GitHub Issue #5307 — `updateParams` cache-key behavior; `_v` cache-buster pattern
- OpenLayers GitHub Issue #5841 — `updateParams` reprojection edge case (not relevant here since EPSG:3857 is locked end-to-end)
- taylor.callsen.me "Using OpenLayers with React Functional Components" — useRef-guarded mount/dispose pattern (corroborates M-01 mitigation)
- React 18 useEffect double-invoke discussions (reactjs/react.dev #6123, facebook/react #24670, #25614) — confirms StrictMode semantics

### Tertiary (LOW confidence — gated by spike)

- Kinetica 7.x WMS public documentation (training data) — exact param names for `STYLES`, `X_ATTR/X_COLUMN_NAME`, `QUERY/CQL_FILTER`, `COLORMAP` catalog
- Kinetica `ST_Envelope` / `ST_XMin` / `ST_XMax` SQL function signatures (training data) — Wave 1 spike resolves
- Kinetica `POINTCOLOR` accepting 8-digit RRGGBBAA vs separate `POINTOPACITY` param (training data) — Wave 1 spike resolves

## Metadata

**Confidence breakdown:**
- Standard stack (`ol@^10.5.0`): HIGH — locked in STACK.md; npm registry verified 2026-05-04
- Architecture patterns (mount/dispose, updateParams, basemap swap, filter selector): HIGH — corroborated by OpenLayers official docs + Phase 9/10 wiring
- Codebase integration points (registry, CustomConfigPanel, WidgetRenderer, /api/wms): HIGH — direct codebase inspection
- Pitfalls M-01 through M-08: HIGH — fully enumerated in `.planning/research/PITFALLS.md`; every M-pitfall has a documented mitigation
- Exact Kinetica WMS parameter names + STYLES values: MEDIUM — gated by Wave 1 GetCapabilities spike (called out in ROADMAP §11 and CONTEXT.md canonical_refs)
- 401-REAUTH on tile fetches via `tileLoadFunction`: MEDIUM-HIGH — pattern verified against OpenLayers GitHub issue #8445 + Phase 7 OIDC reauth chain in `App.tsx`
- `ST_Envelope` SQL signature: MEDIUM — gated by Wave 1 spike (rolled into the M-spike)
- Bundle-size delta (~120–150 KB gzipped): MEDIUM — research estimate; confirmed only by post-install measurement

**Research date:** 2026-05-04
**Valid until:** ~2026-08-04 (90 days for OL stack; ol v10 series is stable). Re-validate Kinetica WMS findings if Kinetica server is upgraded to a major version after Wave 1 spike.

---

*Phase: 11-map-chart*
*Research date: 2026-05-04*
