# Phase 11: Map Chart — Context

**Gathered:** 2026-05-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Ship a working `map` chart type powered by OpenLayers v10 + Kinetica WMS tiles, configurable across all four primary render modes (raster, heatmap, classbreak, contour) and three spatial-column modes (lat/lon, WKT, Kinetica WKB). The map subscribes to `useFilterStore` for its `tableId` and invalidates tiles via `TileWMS.updateParams()` on every filter change without rebuilding the OL `Map` instance.

**In scope (MAP-01..MAP-04 + FILT-04):**

- Replace the placeholder `definitions/map.ts` stub (currently `color`/`markerSize`/`centerLat`/`centerLon`/`zoom` — wrong shape for WMS) with the real config schema.
- New `MapChartRenderer` component mounted from `WidgetRenderer.tsx`'s `case "map"` branch using the React 18 Strict-Mode-safe useRef/useEffect pattern (PITFALL M-01).
- New `MapConfigPanel` (CustomConfigPanel registry escape hatch) renders the spatial-mode picker, render-mode picker, per-mode parameter groups, and MAP-04 differentiator controls.
- WMS URL builder branches on `renderMode` and `spatialMode` to construct the `STYLES` + spatial-column + mode-specific params (PITFALL M-04 WKT/WKB branch).
- Filter subscription: read `useFilterStore.filters[tableId]` + `filterVersion`; on change call `tileWmsSource.updateParams({ QUERY: <whereClause>, _v: filterVersion })` (PITFALL M-02).
- `/api/wms` proxy hardening: add `Cache-Control: no-store` header to every response (PITFALL M-08 — covers both filter changes and OIDC token rotation).
- New `/api/wms/capabilities` (or equivalent — planner picks shape) probe endpoint exposing the GetCapabilities-derived list of supported render modes, colormaps, and spatial-mode params; cached server-side at boot, used by config panel to hide unsupported options.
- Bbox SQL helper for the MAP-04 zoom-to-data button (lat/lon mode = `MIN/MAX` aggregates; WKT/WKB mode = `ST_XMin/ST_XMax/ST_YMin/ST_YMax(ST_Envelope(...))`); memoized per `${tableId}:${filterVersion}:${spatialMode}`.
- Lifecycle cleanup: `map.setTarget(undefined); map.dispose()` on unmount (M-01); reuse Phase 9's filter-store reset wiring (logout + dashboard switch) — no map-specific lifecycle additions.

**Out of scope (deferred):**

- Map drill-down click handler — Phase 12 (IDENT-02).
- Identify endpoint (`POST /api/identify`) — Phase 12 (IDENT-01).
- Hover-tooltip on map features — Phase 12 (uses identify endpoint; ROADMAP §12 TS-M14).
- Standalone `heatmap` chart-type renderer (the existing `heatmap` registry stub has no renderer) — MAP-V13-01.
- Multiple map layers per chart, custom WMS style upload, classification breaks UI editor — MAP-V13-02/03.
- Bbox/lasso spatial select — DRILL-V13-02.

</domain>

<decisions>
## Implementation Decisions

### Spatial-column-mode picker (MAP-02)

- **Auto-suggest mode at config-load time** based on the table's column metadata:
  - Kinetica geometry-typed col present → suggest `wkb`
  - Long-string column tagged as geometry (or stringified WKT-shaped values) → suggest `wkt`
  - Two numeric columns whose names match common lat/lon patterns (`lat|latitude|y` + `lon|lng|longitude|x`) → suggest `latlon`
  - Falls through to `latlon` as the last-resort default if no signal detected
  - User can override at any time; the auto-suggest is a one-shot default, not a sticky policy.

- **Column dropdowns filter to type-compatible columns only** for the active spatial mode (mirrors Phase 10's `isColumnDrillDownSafe` exclusion philosophy):
  - `latlon` → numeric columns only (`int`, `long`, `float`, `double`, `decimal`)
  - `wkt` → string/geometry-string columns only
  - `wkb` → Kinetica geometry-typed columns only
  - Implementation note: a small helper `getValidSpatialColumns(columns, mode): Column[]` colocated with column-type utilities.

- **Per-mode field preservation** in `widget.config`. Separate slots:
  - `widget.config.latColumn`, `widget.config.lonColumn`
  - `widget.config.wktColumn`
  - `widget.config.wkbColumn`
  - Switching modes preserves prior values for each mode. User can toggle `latlon → wkt → latlon` and the lat/lon picks survive.

- **Hide unsupported modes from the picker** when the GetCapabilities spike (or the new `/api/wms/capabilities` probe) reveals the deployed Kinetica doesn't support a mode. Spike-derived list cached server-side at boot; frontend reads it once and uses it to gate picker options. Honest UX, no broken paths. If capabilities probe fails, fall back to assuming all four modes work (graceful degradation — better than blocking config UI on a transient probe failure).

### Render-mode config UX (MAP-01)

- **CustomConfigPanel for map.** Drop into the registry's existing escape hatch (already used today for the `map` stub). Rationale: the classbreak N-row builder, mode-conditional field groups, and capabilities-driven option lists are awkward in the declarative `fields` array — a custom React component keeps the panel cohesive and gives planning room to evolve.
  - Existing `definitions/map.ts` stub fields (`color`, `markerSize`, `centerLat`, `centerLon`, `zoom`) are removed entirely; the CustomConfigPanel owns the new schema.
  - `definitions/map.ts` retains: `type: "map"`, `label`, `icon`, `usesAggregation: false` (no aggregated SQL — WMS is the data path), `supportsDrillDown: false` (Phase 12 may flip later — leave unset for now per Phase 10's lock).

- **Classbreak full N-row builder** (per M-06):
  - User picks `cbColumn` (filtered to numeric or low-cardinality string columns)
  - User picks `cbBreakType` ∈ `categorical | numerical` (default `numerical` for numeric cols, `categorical` for strings — auto-suggest, user override allowed)
  - **Cardinality probe at column-pick time:** `SELECT COUNT(DISTINCT cbColumn) FROM table` via `runSql` (reuses Phase 9 AbortSignal pattern). Hard cap 256; warning toast at >100 ('That's a lot of breakpoints — consider a heatmap or numerical range instead'). Cardinality probe uses `useApiQuery` for typed-error/REAUTH chain.
  - Each break row = `value` input + color picker (RGB, no alpha at the row level — opacity is global across breaks)
  - Min 2 break rows enforced before save; user can add/remove rows; UI affordance is the standard pattern: `+ Add break` button + per-row trash icon.
  - Stored in `widget.config.classbreaks: Array<{ value: string | number; color: string }>` plus `widget.config.cbColumn` and `widget.config.cbBreakType`.
  - Implementation note: cardinality probe result can be stale-cached (table schema rarely changes) per `${tableId}:${cbColumn}` for the session — planner's discretion.

- **Heatmap COLORMAP options** (8 entries; spike confirms exact spelling against deployed Kinetica's GetCapabilities response):
  - Perceptually-uniform: `viridis` (default), `plasma`, `inferno`, `magma`, `cividis`, `turbo`
  - Classic: `jet`, `hot`
  - Stored as `widget.config.colormap: string`.
  - If GetCapabilities returns a smaller list, intersect with this 8-entry catalog and surface the intersection only (don't expose colormaps the deployed Kinetica won't accept).

- **Heatmap params:** `BLUR_RADIUS` (range slider; **units = Kinetica map units, NOT pixels** per PITFALL M-05; UI label clarifies units explicitly: 'Blur radius (Kinetica map units)'). Optional `MIN_LEVEL`/`MAX_LEVEL` clamps (number inputs; planner picks UX shape).

- **Raster mode params:**
  - `POINTCOLOR`: hex color picker (RGB only at the picker level; alpha layered separately)
  - `POINTSIZE`: range slider 2–20 px (this IS the MAP-04 differentiator point-size slider)
  - `POINTOPACITY`: separate range slider 0–100% (alpha; serializes as `RRGGBBAA` suffix on `POINTCOLOR` at WMS-build time — splits color/opacity into independently-tweakable controls). Default 100%.

- **Contour mode params:** `CONTOUR_COLOR` (color picker), `CONTOUR_SMOOTH` (boolean toggle), `CONTOUR_BANDWIDTH` (range slider; **units = Kinetica map units per M-05** — same UI label clarification as BLUR_RADIUS). Contour stays read-only by design (Phase 12 IDENT-02 locks contour-click out of drill-down).

### MAP-04 differentiators (basemap + zoom-to-data + initial view)

- **Basemap selector — 3 options:**
  - OSM (default — `https://{a-c}.tile.openstreetmap.org/{z}/{x}/{y}.png`)
  - CartoDB Voyager (light/clean cartography — `https://{a-c}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png`)
  - CartoDB Dark Matter (dark — `https://{a-c}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png`)
  - All three are EPSG:3857 (Web Mercator), no API key, free, OL-compatible. Stored as `widget.config.basemap: 'osm' | 'voyager' | 'dark'`.
  - Switching basemap **swaps the basemap layer's source** without rebuilding the OL `Map` instance — preserves view + WMS overlay + filter state. Implementation: `basemapLayer.setSource(newSource)`.
  - Each basemap's attribution string is set via OL's `Attribution` control automatically.
  - Esri satellite imagery rejected for v1.2 (ToS friction). Track in deferred for v1.3 if requested.

- **Zoom-to-data button:**
  - Toolbar overlay in the map's top-right corner. Renders as an absolute-positioned React button (or OL `Control` — planner's discretion; absolute-positioned React button is simpler and keeps styling in CSS).
  - **Auto-fires once on initial mount** when `spatialMode + columns` are configured. Prevents the 'world view' first-impression problem.
  - Subsequent renders preserve user's pan/zoom — no auto-fit on filter change, render-mode change, or basemap change. User clicks the button manually if they want to refit.
  - Click handler: invokes the bbox SQL helper, then `view.fit(bbox, { padding: [40, 40, 40, 40] })`.

- **Bbox SQL caching** — memoize per `${tableId}:${filterVersion}:${spatialMode}`:
  - Lat/lon mode SQL: `SELECT MIN(lon_col) AS minLon, MAX(lon_col) AS maxLon, MIN(lat_col) AS minLat, MAX(lat_col) AS maxLat FROM <table> [WHERE <activeFilters>]`
  - WKT/WKB mode SQL: `SELECT ST_XMin(ST_Envelope(<geom_col>)) AS minLon, ST_XMax(ST_Envelope(<geom_col>)) AS maxLon, ST_YMin(ST_Envelope(<geom_col>)) AS minLat, ST_YMax(ST_Envelope(<geom_col>)) AS maxLat FROM <table> [WHERE <activeFilters>]` — **planner spike confirms the `ST_Envelope` + `ST_X{Min,Max}` signatures on the deployed Kinetica before writing the route. Roll into the existing M-spike (GetCapabilities) — both queries can verify against the same Kinetica instance.**
  - Filter clause built via Phase 9's `buildWhereClause` + `injectWhereClause` (NOT raw concatenation; AP-3 lock).
  - Cache invalidates implicitly when `filterVersion` increments. Memo dropped on dashboard switch (existing Phase 9 lifecycle reset is sufficient — no map-specific cleanup needed).
  - Cache lives in component-local `useRef<Map<string, Bbox>>(new Map())` or a small module-level helper — planner picks; both work since the cache is short-lived.

- **Default initial view: world view at `center: [0, 0], zoom: 2`** (EPSG:3857). Visible in the brief window between OL mount and first auto-fit, or whenever columns aren't fully configured. Combined with the auto-fit-on-mount, end users see this for ~1 frame in the happy path.

- **Empty-config state** (no spatialMode chosen, or no columns picked): the map widget mounts the OL `Map` with the world-view default and renders a placeholder text overlay ('Configure spatial columns to render the map' — Claude's discretion on exact copy + styling). The OL `Map` instance still mounts to keep mount/unmount lifecycle predictable; just no `TileWMS` layer until config is complete.

### Loading / error / filter-active / hover UX (MAP-03)

- **Per-tile fade-in loading UX (no global spinner).**
  - CSS opacity transition on each tile element (~200ms ease-out from 0 → 1). OL emits `tileloadstart`/`tileloadend` per tile; CSS handles the fade automatically.
  - Trade-off: less explicit 'we're working' affordance during slow Kinetica responses than a spinner overlay.
  - Revisit post-launch: if user testing surfaces confusion during slow filter-driven refetches, add a subtle top-bar progress strip (or the global spinner option) without breaking the locked decision. Planner notes this as a future-proofing concern in plan summaries.

- **Tile-fetch error UX:**
  - Listen to OL `tileloaderror` events on the `TileWMS` source.
  - Render an error card overlay (centered on the map) with copy 'Failed to load map tiles' + a 'Retry' button → invokes `tileWmsSource.refresh()`. Card dismisses on next successful tile load.
  - Toast fires once per error burst (debounce 2s) so a thousand failed tiles don't flood the toast queue. Toast routed through existing `useToastStore`.
  - **401-REAUTH handling:** tile fetches via `<img src="/api/wms?...">` don't go through `useApiQuery` and won't auto-trigger the existing REAUTH chain. The map component MUST listen for `tileloaderror` with HTTP status 401 (read from the underlying response if accessible, or from the `/api/wms` proxy returning a sentinel response shape) and dispatch the same auth-store reset that `apiFetch` does on `code: "REAUTH_REQUIRED"`. Researcher and planner: confirm OL exposes the error status code on `tileloaderror`; if not, the `/api/wms` proxy may need to translate 401 into a known sentinel image (e.g., a 1×1 transparent PNG with a custom header) AND the frontend listens for that sentinel header. **This is a non-trivial integration point — flag for the researcher.**

- **Filter-active visual cue: rely on the existing top-of-page filter bar only.**
  - Phase 10's interactive filter bar already shows chips per active filter for every table on the dashboard, including the map's `tableId`.
  - Map widget shows no per-chart border, badge, or chip overlay. Consistent with Phase 10's locked decision (rejected per-chart borders as visual noise).
  - The visible-data change (tile refetch from M-02 `updateParams`) IS the in-map feedback.

- **Hover-tooltip: deferred entirely to Phase 12.**
  - MAP-03 success criterion mentions hover-tooltip, but it requires the identify endpoint that lands in Phase 12.
  - Phase 11 ships **no `pointermove` handler stub** in `MapChartRenderer`. Phase 12 adds the handler from scratch.
  - Cleaner phase boundaries; ROADMAP §12 already lists hover-tooltip as Phase 12 territory (TS-M14, 150ms debounce).
  - Tracked in Deferred Ideas to ensure it isn't dropped.

### Claude's Discretion

- Exact removal/replacement strategy for the `definitions/map.ts` stub (delete the existing fields outright vs preserve them as legacy migration values — planner picks; default deletion is cleaner since no production widgets exist with the old config).
- WMS URL builder file location: `src/lib/wmsUrlBuilder.ts` (suggested) vs colocated in `MapChartRenderer.tsx`. Builder must branch on `renderMode` and `spatialMode`; ~80–120 LOC.
- React-mount component decomposition: single `MapChartRenderer.tsx` (~250–400 LOC) or split into a `useMapInstance.ts` hook + `useTileWmsLayer.ts` hook + the rendering shell. Either works.
- Capabilities probe endpoint shape: `/api/wms/capabilities` returning `{ renderModes: [...], colormaps: [...], spatialModes: [...] }` is the suggested shape; planner may roll it into `/api/auth/me` if that's cleaner. Cache result server-side at boot.
- Lazy-loading via `React.lazy(() => import('./MapChartRenderer'))` — planner decides based on bundle-size measurements after `ol@^10.5.0` is added. Research guidance: ~120–150 KB gzipped delta.
- Classbreak builder UX detail: how the user adds/removes rows (button + array inputs vs JSON-edit fallback for power users). Default = button + array inputs; JSON-edit is overkill for v1.2.
- Tile fade-in CSS exact timing curve, opacity threshold for 'loaded' classification, and whether the fade applies on `updateParams`-driven refetches as well as initial loads.
- Whether the bbox memo lives in `MapChartRenderer` component scope (`useRef`) or as a module-level helper. Both work; component-scoped is simpler.
- Error overlay copy and retry button text.
- Bbox memo invalidation on `cbColumn` change (only relevant when classbreak mode + bbox-influencing column overlap; likely a non-issue but worth noting in plan).
- The `/api/wms/capabilities` probe's `Cache-Control` policy — a reasonable default is short-lived browser cache (~5 min) since deployed Kinetica capabilities rarely change at runtime. Planner picks.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 11 requirements + research (PRIMARY)

- `.planning/REQUIREMENTS.md` — MAP-01, MAP-02, MAP-03, MAP-04, FILT-04 full text + traceability
- `.planning/REQUIREMENTS.md` § Map v1.3 — MAP-V13-01, MAP-V13-02, MAP-V13-03 (deferred capabilities; Phase 11 must NOT pull these forward)
- `.planning/ROADMAP.md` § Phase 11 — five success criteria, canonical-refs list, M-01..M-08 pitfall locks, AP-1/AP-2/AP-4 anti-pattern locks
- `.planning/research/STACK.md` — OpenLayers v10 rationale, version pin (`ol@^10.5.0`), React 18 mount/dispose pattern, WMS API surface, Kinetica WMS STYLES values, identify pattern (Phase 12 territory), what NOT to use
- `.planning/research/ARCHITECTURE.md` — sections relevant to map (filter store integration, cross-chart coordination, anti-patterns AP-1/AP-2/AP-4)
- `.planning/research/PITFALLS.md` — M-01..M-08 (OpenLayers Strict-Mode mount/dispose, updateParams not rebuild, EPSG:3857, WKT/WKB branch, BLUR_RADIUS units, classbreak cardinality cap, WMS URL length, Cache-Control: no-store)
- `.planning/research/SUMMARY.md` — synthesized v1.2 architecture + pitfall map

### Phase 9 + Phase 10 outputs (MANDATORY READS — Phase 11 builds directly on these)

- `.planning/phases/09-filter-foundation/09-CONTEXT.md` — filter store contract (`useFilterStore`, ActiveFilter shape, `addFilter`/`removeFilter`/`clearFilters`, `filterVersion` primitive dep, `escapeKineticaStringLiteral`, `buildEqualityFilter`, `buildWhereClause`, `injectWhereClause`)
- `.planning/phases/09-filter-foundation/09-VERIFICATION.md` — passed; documents the LOW-confidence TIMESTAMP literal note (also relevant for Phase 11's bbox SQL when filter values are datetimes)
- `.planning/phases/10-existing-chart-drill-down/10-CONTEXT.md` — drill-down pattern, `isColumnDrillDownSafe`, the locked decision NOT to render per-chart borders/badges (Phase 11 honors this)
- `.planning/phases/10-existing-chart-drill-down/10-VERIFICATION.md` — DRILL-01..DRILL-04 GREEN evidence, useful as a verification template for MAP-* requirements

### Project-level context

- `.planning/PROJECT.md` § Current State (Phase 10 just completed), § Validated Requirements (FILT-01/02/03 + DRILL-01/02/03/04 done), § Out of Scope (locks v1.2 equality-only mental model, locks 'no persistence layer changes')
- `.planning/STATE.md` — current position; Phase 11 unblocked, ready to plan; blockers list calls out the GetCapabilities spike as MEDIUM-confidence pending resolution

### Codebase maps (READ THESE BEFORE WRITING CODE)

- `.planning/codebase/CONVENTIONS.md` — TypeScript strict, camelCase, 2-space indent, NO path aliases (relative imports only), no formatter config
- `.planning/codebase/STRUCTURE.md` — repo layout for new file placement (`src/components/charts/MapChartRenderer.tsx`, `src/components/charts/MapConfigPanel.tsx`, `src/lib/wmsUrlBuilder.ts`)
- `.planning/codebase/STACK.md` — existing dependency baseline; `ol@^10.5.0` is the new addition
- `.planning/codebase/TESTING.md` — testing conventions, vitest config, RTL patterns; OL canvas rendering is jsdom-stubbed so tests cover lifecycle (mount, cleanup, config updates) not tile rendering

### Existing code (mandatory read before writing)

- `kinetica_bi/src/components/charts/registry.ts` — `ChartTypeDefinition` interface; CustomConfigPanel hook (Phase 11 uses this for map config); existing `usesAggregation` flag
- `kinetica_bi/src/components/charts/definitions/map.ts` — current stub (color/markerSize/centerLat/centerLon/zoom — to be replaced)
- `kinetica_bi/src/components/charts/definitions/index.ts` — chart registry initialization; `registerMap()` already wired
- `kinetica_bi/src/components/charts/WidgetRenderer.tsx` — `case "map"` branch (currently no renderer); Phase 11 mounts `MapChartRenderer` here
- `kinetica_bi/src/components/charts/ChartConfigPanel.tsx` — CustomConfigPanel branch already routes `map` chart type to a custom component slot; Phase 11 fills this slot with `MapConfigPanel`
- `kinetica_bi/src/store/filterStore.ts` — Phase 9 store (selector pattern: `useFilterStore(state => state.filters[tableId] ?? [])`, `filterVersion` primitive dep, `buildWhereClause`, `injectWhereClause`)
- `kinetica_bi/src/store/toast.ts` — `useToastStore.getState().showToast()` for tile-error toast and classbreak-cardinality warning
- `kinetica_bi/src/api/client.ts` — `runSql` (with AbortSignal from 09-02) for cardinality + bbox queries; typed errors (`PermissionError`, `ReauthRequiredError`, `UpstreamError`)
- `kinetica_bi/src/hooks/useApiQuery.ts` — REAUTH chain integration for cardinality + bbox queries; **NOT** for tile fetches (img src fetches bypass this hook — see Decisions § 401-REAUTH handling)
- `kinetica_bi/src/lib/columnTypes.ts` — `isColumnDrillDownSafe`, `inferDataTypeFromColumn` (Phase 10 utilities; Phase 11 adds `getValidSpatialColumns(columns, mode): Column[]` here for the spatial-column dropdown filter)
- `kinetica_bi/server/src/index.ts:657-665` — existing `/api/wms` proxy route; **Phase 11 adds `Cache-Control: no-store` header (M-08 lock)** + a new sibling `/api/wms/capabilities` route
- `kinetica_bi/server/src/kinetica.ts:239-310` — `kineticaWms` helper; no helper changes needed in Phase 11, only the route handler in `index.ts`
- `kinetica_bi/__mocks__/zustand.ts` + `kinetica_bi/src/test/setup.ts` — store-reset shim (PITFALL S-03 lock from Phase 9); Phase 11 specs inherit via `setupFiles`

### Anti-pattern locks (carry forward, must appear in plans)

- **AP-1**: Filter state lives in `useFilterStore` only — `MapChartRenderer` reads via selector (`filters[tableId]`, `filterVersion`), never via prop-drilling or component-local copies
- **AP-2**: Do NOT refetch SQL on WMS tile requests — map tiles and SQL chart data have independent lifecycles; the map subscribes only to `filterVersion` for tile invalidation, NOT to the bar/line/pie SQL refetch path
- **AP-4**: Map uses `widget.config.tableId` (number, persisted at config-save time by Phase 9 09-02) for the filter-store key — no runtime table-name lookup

### Pitfall locks (carry forward, must appear in plans as pitfall-locking comments and tests)

- **M-01**: `map.setTarget(undefined); map.dispose()` in `useEffect` cleanup; `mapRef` guard prevents Strict Mode double-mount
- **M-02**: Filter changes call `tileWmsSource.updateParams()` — do NOT rebuild the full map; include `_v=filterVersion` to force cache key change
- **M-03**: OpenLayers `View` locked to `EPSG:3857`; WMS request includes `SRS=EPSG:3857` explicitly (spike confirms Kinetica accepts; fallback to EPSG:4326 with explicit projection if not)
- **M-04**: WKT vs Kinetica WKB branch in WMS parameter construction — detect column type from schema metadata at config time; surface detected type in MapConfigPanel
- **M-05**: Heatmap `BLUR_RADIUS` and contour `CONTOUR_BANDWIDTH` are in Kinetica map units (NOT pixels) — UI labels clarify units
- **M-06**: Classbreak cardinality probe at column-pick time (`SELECT COUNT(DISTINCT col)`); hard cap 256; warn at >100
- **M-07**: WMS URL length — primary defense is the 10-filter cap from Phase 9 (already locked); secondary: monitor URL length in WMS URL builder; tertiary: `Cache-Control: no-store`
- **M-08**: `Cache-Control: no-store` on ALL `/api/wms` (and `/api/wms/capabilities` if applicable) proxy responses

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`useFilterStore`** (`src/store/filterStore.ts`, ~195 LOC, Phase 9) — `MapChartRenderer` is a pure consumer; subscribes via selector for `filters[tableId]` + `filterVersion`. No store modifications.
- **`useToastStore`** (`src/store/toast.ts`, ~34 LOC) — tile-error toast (debounced 2s burst) and classbreak-cardinality warning (>100) route through `useToastStore.getState().showToast(message, kind)`.
- **`/api/wms` proxy route** (`server/src/index.ts:657-665`) — already exists; Phase 11 adds `Cache-Control: no-store` header (M-08).
- **`kineticaWms` helper** (`server/src/kinetica.ts:239-310`) — already streams Kinetica WMS responses with per-user credentials; no helper changes.
- **CustomConfigPanel registry hook** (`src/components/charts/registry.ts` + `ChartConfigPanel.tsx`) — registry already routes map to a custom panel slot; Phase 11 fills the slot with `MapConfigPanel`.
- **Phase 10 column-type utilities** (`src/lib/columnTypes.ts`) — `inferDataTypeFromColumn`, `isColumnDrillDownSafe`. Phase 11 adds a sibling `getValidSpatialColumns(columns, mode)` here.
- **`runSql` + AbortSignal** (`src/api/client.ts`, Phase 9 09-02) — cardinality probe + bbox SQL queries thread through the existing AbortController pattern.
- **Phase 9 SQL builders** — `escapeKineticaStringLiteral`, `buildEqualityFilter`, `buildWhereClause`, `injectWhereClause` — used unchanged for bbox SQL filter injection.

### Established Patterns

- TypeScript strict; relative imports only (no path aliases per CONVENTIONS.md)
- 2-space indent; no formatter — match existing style
- Inline pitfall-comment style: `// PITFALL M-01 lock`, `// PITFALL M-02 lock`, etc. — every WMS-related code site references the pitfall ID it's defending
- Zustand consumers read via selector: `const filters = useFilterStore(state => state.filters[tableId] ?? [])` — never via prop-drilling
- `useApiQuery` for any new SQL queries (cardinality probe, bbox query) — gives REAUTH chain + typed errors free
- Test specs colocated as `*.spec.{ts,tsx}`; vitest auto-discovers via `src/**/*.spec.{ts,tsx}` glob; OL `Map` lifecycle tested via mount/unmount RTL assertions, NOT tile rendering

### Integration Points

- `WidgetRenderer.tsx` `case "map"` — replaces stub branch; mounts `MapChartRenderer` with `widget.config + tableId + columns` props
- `ChartConfigPanel.tsx` CustomConfigPanel branch — routes `type === "map"` to `MapConfigPanel` (new component); existing CustomConfigPanel plumbing already exists
- `definitions/map.ts` — schema replaced; `usesAggregation: false` set; `supportsDrillDown` left unset (Phase 12 decides)
- `server/src/index.ts:659` `/api/wms` route — adds `Cache-Control: no-store` response header (M-08); no other changes
- `server/src/index.ts` — adds new `/api/wms/capabilities` route (or equivalent — planner picks shape) returning probed render-modes/colormaps/spatial-modes
- `package.json` (frontend) — adds `"ol": "^10.5.0"` to `dependencies`; no new server dep
- `src/lib/columnTypes.ts` — adds `getValidSpatialColumns(columns, mode)` helper

### New files

- `src/components/charts/MapChartRenderer.tsx` — OL Map mount, TileWMS layer, basemap layer, filter subscription, tile-error overlay, zoom-to-data toolbar button (~250–400 LOC)
- `src/components/charts/MapConfigPanel.tsx` — CustomConfigPanel for map: spatial-mode picker, render-mode picker, mode-specific param groups, classbreak builder, basemap selector
- `src/lib/wmsUrlBuilder.ts` — pure function: `buildWmsParams(config, filterVersion, whereClause): Record<string, string>`. Branches on `renderMode` + `spatialMode`. Tested in isolation. (Planner discretion on file location.)
- `src/components/charts/MapChartRenderer.spec.tsx` (and/or split spec files) — mount/unmount/cleanup, filter-subscription updateParams call, basemap swap, error overlay, zoom-to-data click

### Why no `runSql` or filter-store changes in Phase 11

- Phase 9 already shipped the SQL+store contract. Phase 11 is a CONSUMER of `useFilterStore` + `runSql`; no contract changes.
- The 401-REAUTH handling for tile fetches IS the one wrinkle (img-src fetches bypass useApiQuery) — handled at the map-component layer, not by modifying the auth-store contract.

</code_context>

<specifics>
## Specific Ideas

- **'Auto-suggest the right mode based on detected types'** — direct quote from MAP-02; auto-detection at config-load time is the spec, not optional polish.
- **'Don't rebuild the map on filter change — `updateParams` only'** — PITFALL M-02 lock. The OL `Map` instance survives the entire dashboard session; only the WMS source's params change.
- **'GetCapabilities tells us what's actually supported, not what we hope is'** — drives the hide-unsupported-modes choice and the colormap intersection logic.
- **'Filter bar IS the per-table filter feedback; map's tile refetch is the data feedback'** — consistent with Phase 10's locked rejection of per-chart borders/badges. No per-chart-type visual special-casing.
- **'Phase 11 ships rendering + filter sub + cleanup; Phase 12 owns clicks and tooltips'** — keeps phase boundaries clean; Phase 11 adds zero `pointermove`/`singleclick` handlers.
- **Per-tile fade-in over global spinner** — chosen for less obtrusive feedback; revisit if user testing surfaces friction during slow filter-driven refetches.
- **Three basemaps (OSM + CartoDB Voyager + CartoDB Dark Matter)** — visual contrast (light/dark/clean) covers most analyst needs; no API key, no ToS friction.
- **Auto-fit-on-mount-once, never again** — prevents losing user pan/zoom on filter or render-mode change while solving the 'world view first impression' problem.
- **Pattern reference: Phase 10's CustomConfigPanel branch** is the integration template for `MapConfigPanel`; the existing escape hatch is already wired through.

</specifics>

<deferred>
## Deferred Ideas

These came up during discussion but belong outside Phase 11:

- **Map drill-down (click → identify → addFilter)** — Phase 12 (IDENT-01..IDENT-03)
- **Hover-tooltip on map features** — Phase 12 (uses identify endpoint; ROADMAP §12 TS-M14, 150ms `pointermove` debounce)
- **Standalone `heatmap` chart-type renderer** (the existing `heatmap` registry stub has no renderer; NOT the map's heatmap render mode) — locked as MAP-V13-01 in REQUIREMENTS.md v1.3 backlog
- **Multiple map layers per chart** (overlay multiple tables on one map) — locked as MAP-V13-02 in v1.3 backlog
- **Custom WMS layer style upload / classification breaks UI editor** — locked as MAP-V13-03 in v1.3 backlog
- **Bbox/lasso spatial select on map** — locked as DRILL-V13-02 in v1.3 backlog (depends on range-filter primitive)
- **Esri satellite basemap** — discussed and rejected for v1.2 due to ToS friction; revisit if requested
- **Top-bar progress indicator (alternative or supplement to per-tile fade-in)** — note for post-launch evaluation; can be added without breaking the locked decision if user testing surfaces friction
- **Vector tile rendering (MapboxGL/MapLibre)** — out of scope; Kinetica is raster WMS only; not in the v1.3 backlog either
- **JSON-edit fallback for power-user classbreak configuration** — discussed and rejected as overkill for v1.2; button-driven row builder is sufficient
- **Per-classbreak-row alpha picker** — discussed and rejected; opacity is a global slider for raster mode, classbreak rows use solid colors
- **Custom CRS support beyond EPSG:3857 / EPSG:4326** — out of scope per research (`proj4` not needed); Kinetica deployments stick to standard CRSs
- **`React.lazy` decision for `MapChartRenderer`** — Claude's discretion at planning time based on bundle-size measurement after `ol@^10.5.0` adds ~120–150 KB gzipped
- **Map widget visual cue when a filter is active for its tableId** — discussed and rejected as inconsistent with Phase 10's per-chart-border decision; rely on filter bar
- **`pointermove` handler stub in Phase 11** — discussed and rejected; hover-tooltip is purely Phase 12 territory, no scaffolding pulled forward
- **Capabilities probe via `/api/auth/me` extension** — Claude's discretion at planning time; standalone `/api/wms/capabilities` endpoint is the suggested default

</deferred>

---

*Phase: 11-map-chart*
*Context gathered: 2026-05-04*
