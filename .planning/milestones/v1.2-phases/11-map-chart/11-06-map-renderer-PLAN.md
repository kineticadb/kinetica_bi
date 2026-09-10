---
phase: 11-map-chart
plan: 06
type: execute
wave: 3
depends_on:
  - 11-04
  - 11-05
files_modified:
  - kinetica_bi/src/components/charts/MapChartRenderer.tsx
  - kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx
  - kinetica_bi/src/components/charts/WidgetRenderer.tsx
  - kinetica_bi/src/lib/bboxHelper.ts
  - kinetica_bi/src/lib/bboxHelper.spec.ts
autonomous: true
requirements:
  - MAP-01
  - MAP-03
  - MAP-04
  - FILT-04
must_haves:
  truths:
    - "MapChartRenderer mounts an OL Map exactly once (StrictMode-safe), with a basemap layer + a TileWMS layer when config is complete"
    - "The Map instance is NEVER rebuilt on filter change, render-mode change, or basemap change — only the relevant source's params/source are swapped (M-02 lock)"
    - "On unmount, map.setTarget(undefined) and map.dispose() are called and mapRef is nulled (M-01 lock)"
    - "Filter store changes (filterVersion mutation) call tileWmsSource.updateParams({ <FILTER_PARAM>: whereClause, _v: filterVersion }) — never refresh()"
    - "A 401 from a tile fetch dispatches UNAUTHORIZED_EVENT (REAUTH chain) via custom tileLoadFunction"
    - "On tileloaderror burst, an error overlay renders with copy 'Failed to load map tiles' + Retry button; toast fires once per 2-second burst"
    - "Empty-config state renders 'Configure spatial columns to render the map' overlay; OL Map still mounts at world view"
    - "Zoom-to-data button auto-fires once on first complete-config mount; subsequent renders preserve user's pan/zoom"
    - "WidgetRenderer's case 'map' branch mounts MapChartRenderer (replacing the stub)"
  artifacts:
    - path: "kinetica_bi/src/components/charts/MapChartRenderer.tsx"
      provides: "React component that owns the OL Map lifecycle, basemap, TileWMS, filter sub, error/empty overlays, zoom-to-data button"
      min_lines: 250
    - path: "kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx"
      provides: "Tests covering mount/dispose, filter-driven updateParams call, basemap swap, tile-error overlay, empty-config state, zoom-to-data click"
      contains: "describe(\"MapChartRenderer"
    - path: "kinetica_bi/src/lib/bboxHelper.ts"
      provides: "fetchBbox(args) memoized helper for zoom-to-data button"
      exports:
        - "fetchBbox"
        - "Bbox"
        - "__resetBboxCacheForTest"
    - path: "kinetica_bi/src/lib/bboxHelper.spec.ts"
      provides: "Tests for fetchBbox SQL construction (latlon vs WKT/WKB) + memoization + filter-version invalidation"
      contains: "describe(\"fetchBbox"
    - path: "kinetica_bi/src/components/charts/WidgetRenderer.tsx"
      provides: "case \"map\" branch mounts MapChartRenderer instead of the placeholder"
      contains: "MapChartRenderer"
  key_links:
    - from: "MapChartRenderer.tsx"
      to: "useFilterStore (filters[tableId] + filterVersion)"
      via: "selector subscription"
      pattern: "useFilterStore.*filters\\[.*tableId\\]"
    - from: "MapChartRenderer.tsx"
      to: "src/lib/wmsUrlBuilder.ts (buildWmsParams)"
      via: "named import; called inside filter-subscription useEffect"
      pattern: "buildWmsParams"
    - from: "MapChartRenderer.tsx tileLoadFunction"
      to: "UNAUTHORIZED_EVENT (existing App.tsx listener)"
      via: "window.dispatchEvent on 401"
      pattern: "UNAUTHORIZED_EVENT|window\\.dispatchEvent"
    - from: "WidgetRenderer.tsx case \"map\""
      to: "MapChartRenderer"
      via: "JSX mount"
      pattern: "<MapChartRenderer"
---

<objective>
Build the heart of Phase 11: the React component that owns an OpenLayers `Map` instance for the lifetime of a map widget, subscribes to the filter store, manages the basemap layer, builds and updates the TileWMS layer, handles tile-error and empty-config overlays, and drives the zoom-to-data button. This plan ALSO ships the `bboxHelper.ts` (used by the zoom button) and wires the WidgetRenderer's `case "map"` branch.

This plan is the LARGEST in Phase 11 — three new files + one modified — because every concern is interlocked: filter sub uses the TileWMS source created during mount; bbox helper is consumed by the zoom button which is rendered only when config is complete; tile error overlay is gated by tileloaderror events from the same source. Splitting these would create N specs that all mock OL the same way; bundling keeps the test surface coherent.

Purpose: Deliver MAP-01 (TileWMS rendering all 4 modes), MAP-03 (pan/zoom/error/empty + lifecycle cleanup), MAP-04 (basemap selector + zoom-to-data), and FILT-04 (filter-driven tile invalidation via updateParams + cache-buster).

Output: A working map widget that renders Kinetica WMS tiles, swaps params on filter change without rebuilding, handles errors gracefully, cleans up properly on unmount.

Note: `MapConfigPanel.tsx` (plan 11-07, parallel) is what drives `widget.config.spatialMode/renderMode/...`. Until 11-07 ships, the renderer reads `widget.config` directly using the defaults from `definitions/map.ts` (added in 11-05). The renderer renders the empty-config state when config is incomplete.
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/11-map-chart/11-CONTEXT.md
@.planning/phases/11-map-chart/11-RESEARCH.md
@.planning/phases/11-map-chart/11-UI-SPEC.md
@.planning/phases/11-map-chart/11-SPIKE-NOTES.md
@kinetica_bi/src/components/charts/WidgetRenderer.tsx
@kinetica_bi/src/lib/wmsUrlBuilder.ts
@kinetica_bi/src/store/filterStore.ts
@kinetica_bi/src/api/client.ts

<interfaces>
<!-- Existing WidgetRenderer.tsx case "map" branch (current placeholder) -->
```typescript
// In WidgetRenderer.tsx — locate the case "map" inside the switch on widget.type.
// Current state: renders a placeholder div or returns null. THIS PLAN replaces it with:
case "map":
  return <MapChartRenderer widget={widget} columns={columns} tableRef={tableRef} />;
```

<!-- buildWmsParams from 11-04 -->
```typescript
import { buildWmsParams, type MapWidgetConfig } from "../../lib/wmsUrlBuilder";
```

<!-- Filter store from Phase 9 -->
```typescript
import { useFilterStore, buildWhereClause, type ActiveFilter } from "../../store/filterStore";
const tableFilters = useFilterStore((s) => tableId !== undefined ? (s.filters[tableId] ?? []) : []);
const filterVersion = useFilterStore((s) => s.filterVersion);
```

<!-- UNAUTHORIZED_EVENT from existing client (verify exact name): -->
```typescript
import { UNAUTHORIZED_EVENT } from "../../api/client";
window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
```

<!-- runSql for bbox query -->
```typescript
import { runSql } from "../../api/client";
const result = await runSql<Record<string, unknown>>(sql, undefined, signal);
```

<!-- WidgetRenderer.tsx props (read existing definition) — minimum needed for MapChartRenderer: -->
```typescript
type MapChartRendererProps = {
  widget: WidgetDto;             // includes widget.config (MapWidgetConfig shape) + widget.config.tableId
  columns: { name: string; type: string }[];
  tableRef: string;              // schema.table — used as WMS LAYERS
};
```

<!-- jsdom canvas stub: vitest's jsdom doesn't render canvas; tests assert on DOM lifecycle (mount/unmount/setTarget calls) NOT on tile pixels. OL is mocked at the import level via vi.mock("ol/Map", ...) -->
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: bboxHelper — fetchBbox with memoization + spec</name>
  <files>kinetica_bi/src/lib/bboxHelper.ts, kinetica_bi/src/lib/bboxHelper.spec.ts</files>
  <read_first>
    - .planning/phases/11-map-chart/11-CONTEXT.md ("Decisions § Bbox SQL caching" — exact SQL templates per spatial mode + cache-key shape)
    - .planning/phases/11-map-chart/11-SPIKE-NOTES.md ("ST_Envelope SQL" — verified spelling for WKT/WKB bbox)
    - .planning/phases/11-map-chart/11-RESEARCH.md (Pattern 7 — fetchBbox signature)
    - kinetica_bi/src/store/filterStore.ts (buildWhereClause + injectWhereClause + ActiveFilter type — REUSED, do NOT redefine)
    - kinetica_bi/src/api/client.ts (runSql signature with AbortSignal — Phase 9 09-02)
  </read_first>
  <behavior>
    `fetchBbox(args): Promise<Bbox>`:
    - Builds SQL based on `args.spatialMode`:
      - latlon: `SELECT MIN(${lonColumn}) AS minLon, MAX(${lonColumn}) AS maxLon, MIN(${latColumn}) AS minLat, MAX(${latColumn}) AS maxLat FROM ${table}`
      - wkt/wkb: `<ST_ENVELOPE_SQL_TEMPLATE_FROM_SPIKE>` substituting geomColumn + table
    - Wraps SQL with `injectWhereClause(baseSql, buildWhereClause(filters))` (AP-3 lock)
    - Cache key = `${tableId}:${filterVersion}:${spatialMode}` — module-scoped Map
    - Returns `[minLon, minLat, maxLon, maxLat]` tuple
    - On filter version change, the new cache-key misses → re-fetch (implicit invalidation)

    Tests (≥ 8):
    - `latlon mode produces correct MIN/MAX SQL with WHERE injection`
    - `wkt mode produces ST_Envelope SQL with WHERE injection`
    - `wkb mode produces ST_Envelope SQL with WHERE injection`
    - `cache hit: second call with same key does not invoke runSql`
    - `cache miss on filter version change: increments runSql call count`
    - `cache miss on different spatialMode: increments runSql call count`
    - `passes signal through to runSql`
    - `returns Bbox tuple in [minLon, minLat, maxLon, maxLat] order`
  </behavior>
  <action>
    Step 1 — write `kinetica_bi/src/lib/bboxHelper.spec.ts` with the ≥8 cases. Use `vi.mock("../api/client", () => ({ runSql: vi.fn() }))` and assert call counts + arguments. The expected SQL must be a literal string match (use a helper to normalize whitespace if needed).

    Step 2 — run `cd kinetica_bi && npx vitest run src/lib/bboxHelper.spec.ts` → RED (file doesn't exist yet).

    Step 3 — write `kinetica_bi/src/lib/bboxHelper.ts`:

    ```typescript
    // Phase 11: Bbox SQL helper for the zoom-to-data button (MAP-04)
    // CONTEXT.md "Decisions § Bbox SQL caching": memoize per ${tableId}:${filterVersion}:${spatialMode}
    // AP-3 lock: filter clause via buildWhereClause + injectWhereClause (NEVER raw concat)

    import { runSql } from "../api/client";
    import {
      buildWhereClause,
      injectWhereClause,
      type ActiveFilter,
    } from "../store/filterStore";
    import type { SpatialMode } from "./columnTypes";

    export type Bbox = [minLon: number, minLat: number, maxLon: number, maxLat: number];

    type FetchBboxArgs = {
      tableId: number;
      table: string;
      spatialMode: SpatialMode;
      latColumn?: string;
      lonColumn?: string;
      geomColumn?: string;
      filters: ActiveFilter[];
      filterVersion: number;
      signal?: AbortSignal;
    };

    const cache = new Map<string, Bbox>();

    export function __resetBboxCacheForTest(): void {
      cache.clear();
    }

    function buildBboxSql(args: FetchBboxArgs): string {
      let baseSql: string;
      if (args.spatialMode === "latlon") {
        if (!args.lonColumn || !args.latColumn) {
          throw new Error("latlon bbox requires lonColumn and latColumn");
        }
        baseSql = `SELECT MIN(${args.lonColumn}) AS minLon, MAX(${args.lonColumn}) AS maxLon, MIN(${args.latColumn}) AS minLat, MAX(${args.latColumn}) AS maxLat FROM ${args.table}`;
      } else {
        if (!args.geomColumn) {
          throw new Error(`${args.spatialMode} bbox requires geomColumn`);
        }
        const c = args.geomColumn;
        // Spike-locked spelling — ST_Envelope verified working in 11-SPIKE-NOTES.md.
        baseSql = `SELECT ST_XMin(ST_Envelope(${c})) AS minLon, ST_XMax(ST_Envelope(${c})) AS maxLon, ST_YMin(ST_Envelope(${c})) AS minLat, ST_YMax(ST_Envelope(${c})) AS maxLat FROM ${args.table}`;
      }
      return injectWhereClause(baseSql, buildWhereClause(args.filters));
    }

    export async function fetchBbox(args: FetchBboxArgs): Promise<Bbox> {
      const cacheKey = `${args.tableId}:${args.filterVersion}:${args.spatialMode}`;
      const cached = cache.get(cacheKey);
      if (cached) return cached;

      const sql = buildBboxSql(args);
      const result = await runSql<{ data: Record<string, unknown> }>(sql, undefined, args.signal);
      // Kinetica returns columnar results; the row 0 has our four aggregate values.
      // Defensive parse — accept either columnar or row-major shapes.
      const r: any = result;
      const minLon = Number(r?.data?.minLon?.[0] ?? r?.minLon ?? r?.data?.[0]?.minLon);
      const maxLon = Number(r?.data?.maxLon?.[0] ?? r?.maxLon ?? r?.data?.[0]?.maxLon);
      const minLat = Number(r?.data?.minLat?.[0] ?? r?.minLat ?? r?.data?.[0]?.minLat);
      const maxLat = Number(r?.data?.maxLat?.[0] ?? r?.maxLat ?? r?.data?.[0]?.maxLat);

      const bbox: Bbox = [minLon, minLat, maxLon, maxLat];
      cache.set(cacheKey, bbox);
      return bbox;
    }
    ```

    Step 4 — run `cd kinetica_bi && npx vitest run src/lib/bboxHelper.spec.ts` → GREEN.

    Step 5 — verify the SQL-literal assertion in the spec uses the exact ST_Envelope spelling from SPIKE-NOTES.md. If SPIKE-NOTES indicated a different spelling (e.g. `STXMIN` no underscores), update the spec AND the helper to match.

    Commit: `feat(11-06): bboxHelper with memoization for zoom-to-data`.
  </action>
  <acceptance_criteria>
    - `kinetica_bi/src/lib/bboxHelper.ts` exists; exports `fetchBbox`, `Bbox`, `__resetBboxCacheForTest`
    - `kinetica_bi/src/lib/bboxHelper.spec.ts` contains ≥ 8 `it(` cases
    - `cd kinetica_bi && npx vitest run src/lib/bboxHelper.spec.ts` exits 0
    - `grep -c "ST_Envelope\|ST_XMin\|ST_XMax\|ST_YMin\|ST_YMax" kinetica_bi/src/lib/bboxHelper.ts` returns ≥ 4 (uses spike-verified spelling)
    - `grep "buildWhereClause\|injectWhereClause" kinetica_bi/src/lib/bboxHelper.ts` returns ≥ 2 (AP-3 lock)
    - `grep "module.*cache.*Map\|new Map<string, Bbox>" kinetica_bi/src/lib/bboxHelper.ts` returns ≥ 1 (module-scoped cache)
  </acceptance_criteria>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/lib/bboxHelper.spec.ts</automated>
  </verify>
  <done>fetchBbox memoized; SQL templates verified; AP-3 honored; ready for MapChartRenderer's zoom-to-data button.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: MapChartRenderer.tsx — full implementation + spec</name>
  <files>kinetica_bi/src/components/charts/MapChartRenderer.tsx, kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx</files>
  <read_first>
    - .planning/phases/11-map-chart/11-RESEARCH.md (Patterns 1-5 — exact code patterns for mount/dispose, updateParams, TileWMS construction, tileLoadFunction, basemap swap)
    - .planning/phases/11-map-chart/11-CONTEXT.md ("Decisions § Loading / error / filter-active / hover UX" — exact UI behavior for empty/error/loading states; hover EXPLICITLY deferred to Phase 12)
    - .planning/phases/11-map-chart/11-UI-SPEC.md ("Component Inventory § Component-tree shape" — exact JSX structure with class names; "Copywriting Contract" — exact copy strings)
    - kinetica_bi/src/lib/wmsUrlBuilder.ts (buildWmsParams + MapWidgetConfig + RenderMode types)
    - kinetica_bi/src/lib/bboxHelper.ts (fetchBbox from Task 1)
    - kinetica_bi/src/store/filterStore.ts (useFilterStore selector pattern; buildWhereClause)
    - kinetica_bi/src/store/toast.ts (useToastStore for tile-error toast; debounce 2s)
    - kinetica_bi/src/api/client.ts (UNAUTHORIZED_EVENT name + apiFetch + API_BASE — for fetch URL construction in tileLoadFunction)
    - kinetica_bi/src/components/charts/WidgetRenderer.tsx (existing patterns — how other renderers receive widget/columns/tableRef props)
    - kinetica_bi/src/components/charts/registry.ts (CustomConfigPanelProps type — confirms expected props shape; this renderer is NOT a CustomConfigPanel)
  </read_first>
  <behavior>
    Component contract:

    Props:
    ```typescript
    type Props = {
      widget: WidgetDto;             // widget.config: MapWidgetConfig shape; widget.config.tableId is required
      columns: { name: string; type: string }[];
      tableRef: string;              // schema.table — used as WMS LAYERS param
    };
    ```

    State (component-local):
    - `tileLoadError: { count: number; lastAt: number } | null` — drives error overlay; debounced toast
    - `errorOverlayDismissed: boolean` — set to true once a successful tileloadend clears it

    Refs:
    - `containerRef: useRef<HTMLDivElement>(null)` — OL target div
    - `mapRef: useRef<Map | null>(null)` — StrictMode guard
    - `basemapLayerRef: useRef<TileLayer | null>(null)` — for basemap source swap
    - `wmsLayerRef: useRef<TileLayer | null>(null)` — for WMS layer add/remove
    - `wmsSourceRef: useRef<TileWMS | null>(null)` — for updateParams
    - `autoFitDoneRef: useRef<boolean>(false)` — locks zoom-to-data to single auto-fire on first complete-config mount

    Filter subscription:
    - `tableFilters = useFilterStore(s => s.filters[tableId] ?? [])` — selector-scoped (C-02 lock)
    - `filterVersion = useFilterStore(s => s.filterVersion)` — primitive dep (S-02 lock)

    Lifecycle effects:
    1. **Mount/unmount effect** (`[]` deps):
       - Guard with `if (mapRef.current) return;` (M-01 lock)
       - Construct OL Map with View(EPSG:3857, center [0,0], zoom 2)
       - Add basemap layer based on `widget.config.basemap` (default "osm") via `basemapSourceFor` helper (defined in same file or `wmsUrlBuilder.ts` — keep it colocated here for cohesion)
       - Store all refs
       - Cleanup: `map.setTarget(undefined); map.dispose(); mapRef.current = null;`

    2. **WMS layer effect** (deps: `[isConfigComplete, widget.config.tableId, tableRef, widget.config.spatialMode, lat/lon/wkt/wkb columns, widget.config.renderMode]`):
       - When config goes from incomplete → complete: create TileWMS source via Pattern 3 + custom tileLoadFunction (Pattern 4 for 401-REAUTH); add as TileLayer with `className: 'widget-map-tile'` (UI-SPEC.md tile-fade-in lock); attach `tileloaderror`/`tileloadend` listeners
       - When config changes (mode/columns) but stays complete: rebuild the params + call updateParams (NOT a new layer — M-02 lock)
       - When config goes complete → incomplete: remove the WMS layer

    3. **Filter-driven updateParams effect** (deps: `[filterVersion]`, eslint-disabled `tableFilters` per S-02 lock):
       - If `wmsSourceRef.current && isConfigComplete`: build whereClause via `buildWhereClause(tableFilters)`, call `wmsSourceRef.current.updateParams(buildWmsParams(widget.config, filterVersion, whereClause))`

    4. **Basemap swap effect** (dep: `[widget.config.basemap]`):
       - `basemapLayerRef.current?.setSource(basemapSourceFor(widget.config.basemap))`

    5. **Auto-fit effect** (dep: `[isConfigComplete]`, fires only when transitioning to true AND `!autoFitDoneRef.current`):
       - Calls `fetchBbox` then `view.fit(bbox, { padding: [40, 40, 40, 40] })`
       - Sets `autoFitDoneRef.current = true`

    Tile-error handling:
    - `tileloaderror` listener increments `tileLoadError.count`; sets state to render error overlay
    - 2-second debounced toast via `useToastStore.getState().showToast("Map tiles failed to load.", "error")` — use a `useRef` for debounce timestamp
    - `tileloadend` listener (any successful tile): clears the overlay state

    Tile-error retry:
    - Retry button calls `wmsSourceRef.current?.refresh()`; does NOT clear error state — relies on next tileloadend

    Custom tileLoadFunction:
    - Override `tileSource.setTileLoadFunction((tile, src) => { fetch(src, { credentials: "include" }).then(...) })`
    - On `response.status === 401`: `window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))`, set tile state ERROR, return — DO NOT show overlay (App.tsx listener handles)
    - On `!response.ok`: set tile state ERROR (overlay handles)
    - On 200: blob → URL.createObjectURL → assign to tile image

    Empty-config detection:
    - `isConfigComplete` = `widget.config.spatialMode` set AND
      - latlon: latColumn && lonColumn
      - wkt: wktColumn
      - wkb: wkbColumn
    - When false: render `.widget-map-empty` overlay with locked copy

    Zoom-to-data button:
    - Rendered ONLY when `isConfigComplete`
    - Hidden in empty state
    - Click handler: invokes `fetchBbox` + `view.fit`

    JSX structure (per UI-SPEC.md):
    ```tsx
    <div className="widget-map">
      <div ref={containerRef} className="widget-map-canvas" />
      {isConfigComplete && (
        <div className="widget-map-toolbar">
          <button className="widget-map-toolbar-btn" aria-label="Zoom to data" onClick={onZoomToData}>
            <span aria-hidden="true">⤢</span>
            <span className="widget-map-toolbar-btn-label"> Zoom to data</span>
          </button>
        </div>
      )}
      {!isConfigComplete && (
        <div className="widget-map-empty">
          <div>Configure spatial columns to render the map</div>
          <div>Open the widget config and pick a spatial column mode (lat/lon, WKT, or Kinetica geometry).</div>
        </div>
      )}
      {tileLoadError && !errorOverlayDismissed && (
        <div className="widget-map-error">
          <div className="widget-map-error-title">Failed to load map tiles</div>
          <div className="widget-map-error-body">Tiles could not be fetched from Kinetica. Check your filter or retry.</div>
          <button className="widget-map-error-retry ghost-sm" aria-label="Retry loading map tiles" onClick={onRetryTiles}>Retry</button>
        </div>
      )}
    </div>
    ```

    Tests (≥10):
    - `mounts an OL Map exactly once on mount` (vi.mock ol/Map, assert constructor call count)
    - `calls map.setTarget(undefined) + map.dispose() on unmount`
    - `when config is incomplete, renders empty-config overlay with exact UI-SPEC copy`
    - `when config is complete, mounts WMS layer`
    - `filterVersion change calls tileWmsSource.updateParams with buildWmsParams output (including whereClause + _v)`
    - `filterVersion=0 + non-empty whereClause emits FILTER_PARAM in updateParams`
    - `basemap change calls basemapLayer.setSource — does NOT reconstruct Map` (assert Map constructor still called once)
    - `tileloaderror event renders the error overlay with locked copy`
    - `tileloadend after a tileloaderror dismisses the overlay`
    - `Retry button click calls tileWmsSource.refresh()`
    - `tile-error toast fires once even with 5 errors in 2 seconds (debounce)`
    - `401 in tileLoadFunction dispatches UNAUTHORIZED_EVENT and does NOT show overlay`
    - `auto-fit fires once on first complete-config mount; not on filterVersion change`
    - `zoom-to-data button click invokes view.fit with bbox`
  </behavior>
  <action>
    Step 1 — write `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` first. Mock `ol/Map`, `ol/View`, `ol/layer/Tile`, `ol/source/OSM`, `ol/source/XYZ`, `ol/source/TileWMS`, `ol/TileState` via `vi.mock(...)` returning factory mocks. Mock `useFilterStore`, `useToastStore`, `fetchBbox`, `runSql`. Use `@testing-library/react` for render.

    Example mock skeleton:
    ```typescript
    vi.mock("ol/Map", () => ({
      default: vi.fn().mockImplementation(function MockMap(this: any, opts: any) {
        this.setTarget = vi.fn();
        this.dispose = vi.fn();
        this.addLayer = vi.fn();
        this.removeLayer = vi.fn();
        this.getView = vi.fn(() => ({ fit: vi.fn() }));
        return this;
      }),
    }));
    vi.mock("ol/source/TileWMS", () => ({
      default: vi.fn().mockImplementation(function MockTileWMS(this: any) {
        this.updateParams = vi.fn();
        this.refresh = vi.fn();
        this.setTileLoadFunction = vi.fn();
        this.on = vi.fn();
        return this;
      }),
    }));
    // ... similar for other ol modules
    ```

    Run vitest → RED.

    Step 2 — write `kinetica_bi/src/components/charts/MapChartRenderer.tsx`. Aim for 250-400 LOC; split internal helpers (`basemapSourceFor`, `isConfigComplete`, `getSpatialColumnForMode`) as module-level helpers above the component. Inline-comment every PITFALL lock (M-01, M-02, M-03, M-04 — note the M-04 lock applies in `wmsUrlBuilder.ts`, this renderer just calls it).

    Use `import.meta.env.VITE_API_URL || "http://localhost:4000"` for the WMS URL prefix (mirror existing API_BASE pattern).

    Step 3 — run `cd kinetica_bi && npx vitest run src/components/charts/MapChartRenderer.spec.tsx` → GREEN. Then `cd kinetica_bi && npx vitest run` → full suite green.

    Commit: `feat(11-06): MapChartRenderer with OL lifecycle, filter sub, error overlay, zoom-to-data`.
  </action>
  <acceptance_criteria>
    - `kinetica_bi/src/components/charts/MapChartRenderer.tsx` exists; ≥ 250 lines
    - `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` exists with ≥ 10 `it(` cases
    - `cd kinetica_bi && npx vitest run src/components/charts/MapChartRenderer.spec.tsx` exits 0
    - `cd kinetica_bi && npx vitest run` exits 0 (full suite green)
    - `grep -c "PITFALL M-01\|PITFALL M-02\|PITFALL M-03\|S-02 lock\|C-02 lock" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns ≥ 5 (pitfall comments inline)
    - `grep "map.setTarget(undefined)" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns 1
    - `grep "map.dispose()\|map\\.dispose" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns ≥ 1
    - `grep "tileWmsSource.updateParams\|wmsSourceRef\\.current\\?\\.updateParams\|wmsSourceRef\\.current\\.updateParams" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns ≥ 1
    - `grep "UNAUTHORIZED_EVENT\|window\\.dispatchEvent" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns ≥ 1
    - `grep "Configure spatial columns to render the map" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns 1 (UI-SPEC empty-state copy)
    - `grep "Failed to load map tiles" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns 1 (UI-SPEC error-overlay title)
    - `grep "Zoom to data" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns ≥ 1 (UI-SPEC button label)
  </acceptance_criteria>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/charts/MapChartRenderer.spec.tsx && npx vitest run</automated>
  </verify>
  <done>MapChartRenderer ships with all OL lifecycle, filter sub, error overlay, zoom-to-data, tileLoadFunction 401 handling — fully tested via mocked OL.</done>
</task>

<task type="auto">
  <name>Task 3: Wire WidgetRenderer.tsx case "map" → MapChartRenderer</name>
  <files>kinetica_bi/src/components/charts/WidgetRenderer.tsx, kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx</files>
  <read_first>
    - kinetica_bi/src/components/charts/WidgetRenderer.tsx (full file — locate the switch on widget.type and the existing case "map" branch; identify what props are already in scope (widget, columns, tableRef))
    - kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx (existing spec — append a test for the map case)
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx (the component built in Task 2 — confirm Props shape)
    - .planning/phases/11-map-chart/11-CONTEXT.md ("Code Insights § Integration Points" — confirms WidgetRenderer.tsx case "map" mounts MapChartRenderer)
  </read_first>
  <action>
    In `kinetica_bi/src/components/charts/WidgetRenderer.tsx`:

    1. Add import at the top:
       ```typescript
       import MapChartRenderer from "./MapChartRenderer";
       ```
       (Use `default` export from MapChartRenderer.tsx — Task 2 must `export default function MapChartRenderer(...)`.)

       OR if the file uses `React.lazy` based on the bundle-size measurement from 11-05:
       ```typescript
       const MapChartRenderer = React.lazy(() => import("./MapChartRenderer"));
       ```
       (Wrap the use site in `<Suspense fallback={<div className="widget-map-empty">Loading map…</div>}>` if lazy.)

    2. Locate the `switch (widget.type)` block. Find the existing `case "map":` branch (current state: returns null or a placeholder). Replace its body with:
       ```typescript
       case "map":
         return <MapChartRenderer widget={widget} columns={columns} tableRef={tableRef} />;
       ```

       Confirm the exact prop names match what's in scope in `WidgetRenderer.tsx` (the file may use `selectedTable`, `tableName`, etc. — adapt to the actual local variable names; the prop NAMES on `MapChartRenderer` (widget, columns, tableRef) are fixed by Task 2).

    3. Add a smoke test to `kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx`:
       ```typescript
       it("renders MapChartRenderer for widget.type === 'map'", () => {
         vi.mock("./MapChartRenderer", () => ({
           default: vi.fn(() => <div data-testid="map-chart-renderer-mock" />),
         }));
         // ... render WidgetRenderer with widget.type = "map"
         expect(screen.getByTestId("map-chart-renderer-mock")).toBeInTheDocument();
       });
       ```
       (Use the existing test file's mocking pattern — the existing spec already mocks chart renderers; mirror that exactly.)

    Run `cd kinetica_bi && npx vitest run src/components/charts/WidgetRenderer.spec.tsx`. The new test passes alongside the existing tests.

    Run `cd kinetica_bi && npx vitest run` — full suite green.

    Commit: `feat(11-06): wire WidgetRenderer case 'map' to MapChartRenderer`.
  </action>
  <acceptance_criteria>
    - `grep -c "import MapChartRenderer\|React\\.lazy.*MapChartRenderer\|import.*MapChartRenderer.*from" kinetica_bi/src/components/charts/WidgetRenderer.tsx` returns ≥ 1
    - `grep "<MapChartRenderer" kinetica_bi/src/components/charts/WidgetRenderer.tsx` returns ≥ 1 (used in JSX inside case "map")
    - `grep "case \"map\":" kinetica_bi/src/components/charts/WidgetRenderer.tsx` returns 1 (the case still exists)
    - `kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx` contains test name `"renders MapChartRenderer for widget.type === 'map'"` OR equivalent assertion mounting the map renderer
    - `cd kinetica_bi && npx vitest run` exits 0 (full suite green)
  </acceptance_criteria>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/charts/WidgetRenderer.spec.tsx && npx vitest run</automated>
  </verify>
  <done>WidgetRenderer routes map widgets to MapChartRenderer; smoke test confirms wiring; full suite green.</done>
</task>

</tasks>

<verification>
- `bboxHelper.ts` shipped with memoization + AP-3 lock + spike-locked ST_Envelope spelling.
- `MapChartRenderer.tsx` shipped with all five lifecycle effects (mount, WMS layer, filter sub, basemap swap, auto-fit) + tile-error overlay + empty-config state + zoom-to-data button + 401 reauth via tileLoadFunction.
- `WidgetRenderer.tsx` case "map" routes to `MapChartRenderer`.
- ≥10 specs cover the lifecycle invariants (M-01, M-02, M-03 locks); ≥8 specs cover bboxHelper.
- Full suite green.
</verification>

<success_criteria>
- A user with the dev server running can drop a map widget on a dashboard and see the OL Map mount with an OSM basemap (until 11-07 ships the config panel, the map shows the empty-config overlay).
- Once 11-07 ships and a user configures a spatial mode + columns + render mode, WMS tiles render.
- Filter changes from any other chart on the same table update the map's tiles via `updateParams` without rebuilding the Map instance.
- 401 errors propagate through the existing REAUTH chain.
</success_criteria>

<output>
After completion, create `.planning/phases/11-map-chart/11-06-SUMMARY.md` summarizing:
- LOC of MapChartRenderer.tsx
- Whether React.lazy was used (per 11-05 SUMMARY recommendation)
- Test count breakdown (bboxHelper specs + MapChartRenderer specs + new WidgetRenderer spec)
- Any deviation from RESEARCH.md Patterns 1-7 with rationale
- Confirmation that all UI-SPEC.md Copywriting Contract strings appear verbatim
</output>
