# Phase 12: Dashboard Layers Panel — Context

**Gathered:** 2026-05-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Ship a **Dashboard Layers Panel** — a large modal opened from a new "Layers" top-bar button (sibling to existing Tables / Visualizations buttons) that manages a dashboard-scope collection of `KineticaWms` layers. Each layer carries its own table binding + WMS configuration (spatial mode, columns, render mode, render-mode params). Map widgets on the dashboard render a per-widget-selected subset of those layers via OpenLayers using the existing Phase 11 `ImageWMS` rendering pattern.

The panel introduces:
- A new SQLite-persisted `dashboard_layers` table + `/api/dashboards/:id/layers` CRUD surface
- A new modal UI (two-pane: list left, selected-layer config right) with auto-save on every change
- An extracted `<KineticaWmsLayerForm>` component (lifted out of `MapConfigPanel`) as the single source of truth for layer-config fields
- A `layerType` discriminator column from day one — KineticaWms is the only valid value in v1.2; the schema is extensible

Phase 11 map widgets undergo a **hard cutover** — their layer-related config fields (spatialMode/spatial columns/renderMode/render params) move to the new layer entity; map widgets shrink to title + basemap + a per-widget layer-inclusion picker. v1.2 has not shipped to prod, so reconfiguration cost is acceptable.

**In scope:**
- New `dashboard_layers` SQLite table + Express CRUD routes (`GET/POST/PATCH/DELETE /api/dashboards/:id/layers[/:layerId]`)
- New top-bar "Layers" button + `LayersModal` two-pane component
- Extracted `<KineticaWmsLayerForm>` reused by the layer modal (and any residual MapConfigPanel surface) — Phase 11's table picker, spatial-mode picker, render-mode picker, mode-specific param groups, classbreak builder, capabilities-driven option lists
- Map widget shrink: remove spatialMode/columns/renderMode/render params from `widget.config`; remove the zoom-to-data button entirely; keep title + basemap; add `widget.config.includedLayerIds: number[]` (default = all dashboard layers ON for new widgets)
- `MapChartRenderer` rework: subscribe to dashboard layers + `widget.config.includedLayerIds`; render N stacked OL `ImageWMS` layers (one per included layer, ordered by `dashboard_layers.position`); each layer subscribes to `useFilterStore.filters[layer.tableId]` + `filterVersion` and calls `updateParams` on filter change (M-02 lock applies per layer)
- Per-layer panel controls: visibility toggle (eye icon), drag-to-reorder, delete with confirm, duplicate, opacity slider (0–100%), edit (selects layer in right pane)
- Auto-disabled state when a layer's `table_id` is removed from the dashboard's tables (red "Table removed — reconfigure" badge)
- Hard cutover: any Phase 11 map widgets in existing dashboards are functionally broken until users reconfigure as layers (no migration code)

**Out of scope (deferred):**
- Map drill-down (click → identify endpoint → addFilter) — locked as `IDENT-V13-01..03` in REQUIREMENTS.md v1.3
- Hover-tooltip on map features — depends on identify endpoint, v1.3
- Per-layer saved/filtered view (layer carries a pinned filter set independent of dashboard filters) — deferred (user noted "in the future the table will also store a filtered view")
- Basemap-as-layer (basemaps stay on widget, not in the layer collection)
- SQL/aggregated layer types (`layerType !== 'KineticaWms'`)
- Inline layer rename (no rename in v1.2; layer name is auto-derived)
- Multi-IdP / cross-table layer joins
- Sync zoom/pan across multiple map widgets

</domain>

<decisions>
## Implementation Decisions

### Layer↔Widget architecture + persistence

- **Multiple map widgets per dashboard, each picks layers.** Each map widget renders a chosen subset of dashboard layers via a per-widget layer-inclusion picker (`widget.config.includedLayerIds: number[]`). New map widgets default to **all dashboard layers ON**; users opt out per widget.
- **Lift boundary — what moves vs stays:**
  - **MOVE TO LAYER** (new `dashboard_layers.config` JSON): `tableRef`/`tableId`, `spatialMode`, `latColumn`/`lonColumn`/`wktColumn`/`wkbColumn`, `renderMode`, `colormap`, `BLUR_RADIUS`, `POINTCOLOR`/`POINTSIZE`/`POINTOPACITY`, classbreaks (`cbColumn`, `cbBreakType`, `classbreaks[]`), contour params (`CONTOUR_COLOR`, `CONTOUR_SMOOTH`, `CONTOUR_BANDWIDTH`)
  - **STAYS ON WIDGET** (`widget.config`): `title`, `basemap` (`'osm' | 'voyager' | 'dark'`), `includedLayerIds`
  - **REMOVED ENTIRELY**: zoom-to-data button + auto-fit-on-mount logic + bbox SQL helper. Doesn't make sense in a multi-layer / multi-table world (which dataset's bbox?). Phase 11's `bboxHelper.ts` becomes dead code; planner deletes it as part of the hard cutover.
- **Render-order source of truth: `dashboard_layers.position`.** Drag-reorder in the layers modal updates `position`. Every map widget renders the same z-order (subset filtered by `includedLayerIds`, but order preserved). No per-widget reorder override in v1.2.
- **Persistence model — new SQLite table `dashboard_layers`:**
  - Columns: `id INTEGER PRIMARY KEY`, `dashboard_id INTEGER NOT NULL` (FK → dashboards.id, ON DELETE CASCADE), `table_id INTEGER NOT NULL` (FK → tables.id; NOT cascade — see "Missing table" below), `layer_type TEXT NOT NULL` (CHECK: only `'KineticaWms'` accepted in v1.2), `position INTEGER NOT NULL` (drag-reorder index; integer, gaps allowed during reorder), `config TEXT NOT NULL` (JSON blob), `created_at`, `updated_at`
  - Migration script in `kinetica_bi/server/src/migrations/` (existing pattern); planner picks exact filename
  - Backend route file: planner picks shape — likely `kinetica_bi/server/src/routes/layers.ts` or inline in `index.ts` consistent with existing widget routes
  - Frontend: new `src/api/client.ts` exports (`listDashboardLayers`, `createLayer`, `updateLayer`, `deleteLayer`, `reorderLayers`); new `src/store/dashboardLayersStore.ts` Zustand slice (mirroring widget-state pattern); selector for `useFilterStore`-style consumption
- **Hard cutover for Phase 11 map widgets.** No auto-migration; existing widgets become inert until users reconfigure. Justified because v1.2 has not shipped to production. Planner adds a one-time UI affordance: when a map widget has the *old* config shape, render a placeholder ("This map needs to be reconfigured — open the Layers modal to create layers and select them here") and disable rendering. Old config keys (`spatialMode`, etc.) are simply ignored by the new MapChartRenderer.

### Layers panel UI placement & affordances

- **UI shell: a large modal**, similar to existing `TablePickerModal` / `VisualizationPickerModal` (in `kinetica_bi/src/components/DashboardsPage.tsx:616-643`) but **larger** to accommodate the two-pane layout. Same modal-overlay/portal pattern.
- **Trigger: a new "Layers" button in the dashboard top-bar**, sibling to the existing `Tables` and `Visualizations` buttons (DashboardsPage.tsx:487-491). Same `btn-primary btn-sm` styling. Opens the modal via `setShowLayersModal(true)` state on `DashboardsPage`.
- **Modal layout: two-pane.**
  - Left rail: layer list (rows with eye/drag-handle/name/delete/duplicate/edit) + `+ Add layer` button at top
  - Right pane: config form for the currently-selected layer (`<KineticaWmsLayerForm>`)
  - Empty-list behavior: on first open, **auto-create a blank layer** and select it for editing — user immediately sees a config form ready to fill in (skip the "no layers" empty state). The blank layer persists immediately on creation; if the user closes the modal without configuring, they get an empty/incomplete layer they can later delete (acceptable trade-off for the streamlined add flow).
- **Layer-row anatomy** (left to right): drag handle · eye-icon visibility toggle · type-icon (WMS) · auto-derived name (e.g., `orders — heatmap`; planner picks exact derivation) · per-row trash icon (with confirm) · per-row duplicate icon · per-row edit icon (selects in right pane). No inline rename in v1.2 — name is auto-derived from `${tableName} — ${renderMode}` (planner adjusts for de-duplication).
- **`+ Add layer`** click → creates a new blank layer (sensible defaults pre-filled — see "Per-layer config UX") → server PATCH/POST → appended to list with `position = max(position) + 1` → right pane focuses it for editing. Layer-type discriminator stays implicit in v1.2 (only KineticaWms); future types may surface a chooser between click and create.
- **Auto-save on every change**, debounced (planner picks debounce window — 300–500ms reasonable). Each field edit fires a debounced `PATCH /api/dashboards/:id/layers/:layerId`. Map widgets reflect changes live (subscribed to `dashboardLayersStore`). Mirrors the existing `WidgetConfigModal` pattern noted at DashboardsPage.tsx:441-443 ("Keep the modal's source-of-truth widget in sync with the persisted state").
- **Per-layer secondary controls in v1.2:** opacity slider (0–100%), duplicate, edit (selects in right pane). Ship together — they share the same row UI surface.
- **Toggle / dismiss:** modal opens via top-bar button, closes via standard X button (and ESC / overlay click — match existing modal behavior). No keyboard shortcut in v1.2.

### Per-layer config UX + layer-type model

- **`<KineticaWmsLayerForm>` extracted from `MapConfigPanel`.** New file: `kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx`. Lifts the table picker, spatial-mode picker, spatial-column dropdowns (`getValidSpatialColumns` consumer), render-mode picker, render-mode-specific param groups, classbreak builder, capabilities-driven option gating. Receives layer config as a prop and an `onChange(patch)` callback (parent owns auto-save debouncing).
- **`MapConfigPanel` shrinks** to: title, basemap selector, layer-inclusion picker (multi-select against `dashboardLayersStore`). Phase 11's existing CustomConfigPanel scaffold (Title + Data Source from `ChartConfigPanel`) needs adjustment — the data-source picker no longer applies (layers carry their own table bindings). Planner reviews `kinetica_bi/src/components/charts/MapConfigPanel.tsx` (~800 LOC) and removes the lifted sections.
- **v1.2 ships `layerType: 'KineticaWms'` only.** The discriminator column exists in the schema (CHECK constraint allows only this value initially); future types add via migration without re-shaping the table. The TypeScript layer-config union (`type LayerConfig = KineticaWmsLayerConfig | ...`) is a single-arm union in v1.2 — purely a future-proofing.
- **Sensible defaults pre-filled for a new blank layer:**
  - `renderMode: 'raster'`
  - `spatialMode: 'latlon'`
  - `colormap: 'viridis'` (heatmap default; surfaces only when render-mode flips to heatmap)
  - `POINTSIZE: 5` (raster default)
  - `POINTCOLOR: '#3b82f6'`, `POINTOPACITY: 100`
  - Classbreak / contour params: empty (user fills when picking those modes)
  - `table_id`, `latColumn`/`lonColumn`/`wktColumn`/`wkbColumn`: unset until user picks them; layer renders nothing on the map until the table + columns are valid (mirrors Phase 11's `isMapConfigValid` gate)
  - On `table_id` selection, **autoSuggestSpatialMode runs** (Phase 11 helper) and picks `spatialMode` + clears stale columns — preserving the lock from PITFALL S-02 / `columnsKey` primitive dep.
- **Missing-table state.** When a layer's `table_id` no longer appears in the dashboard's `dashboard_tables` join (user removed the table via the existing Tables modal):
  - Layer remains in `dashboard_layers`; not auto-deleted
  - Renders in the layers panel with a red error badge: **"Table removed — reconfigure"**
  - Map widgets skip rendering this layer (no WMS request fired)
  - User can either edit the layer (pick another table → autoSuggestSpatialMode reruns → previous columns cleared) or delete it
  - No backend cascade; the FK is enforced soft-style (server returns 200 with no rows when the join is empty; frontend reads via `listDashboardLayers` and validates against `associatedTables`)

### Filter / table binding model

- **Filter-store key = layer's `tableId`.** Layers reuse `useFilterStore.filters[tableId]` exactly like Phase 9's design — no new store shape, no schema changes to `filterStore.ts`. AP-1 lock holds: filter state lives in `useFilterStore` only; layers read via selector.
- **Layers and charts share filters by table.** When the user clicks a bar/pie/line/scatter/table chart on table T (Phase 10 drill-down), every layer bound to table T (across every map widget that includes that layer) gets the new WHERE clause via `tileWmsSource.updateParams({ QUERY: <where>, _v: filterVersion })`. M-02 lock applies per layer instance — `updateParams`, never rebuild.
- **Per-layer filter subscription.** Each layer rendered inside a `MapChartRenderer` mounts its own filter subscription: `const tableFilters = useFilterStore(state => state.filters[layer.tableId] ?? [])` + `filterVersion`. The renderer manages N stacked `ImageWMS` sources, one per included layer; each source's `updateParams` is called when its slice of the filter store changes (NOT when sibling layers' filters change). This keeps M-02 cache-key updates surgical and prevents unnecessary tile refetches.
- **Filter bar (Phase 10 interactive bar) treats layer-bound tables identically to chart-bound tables.** No layer-aware UI in the filter bar — just per-table chip groups for any table that has charts OR layers. The bar already iterates `associatedTables`; planner verifies that's still correct after layers ship (a table referenced ONLY by a layer must still produce a chip group when filtered).
- **Map clicks are no-ops in Phase 12.** No `singleclick` handler on the OL map; no `pointermove` handler. Map drill-down + hover-tooltip stay deferred to v1.3 (`IDENT-V13-01..03`). Phase 11 already left no `pointermove` stub; Phase 12 maintains that.
- **AP-2 lock continues to apply.** Map tiles and SQL chart data have independent lifecycles; layers subscribe ONLY to `filterVersion` for tile invalidation — no SQL refetch path threaded through the map renderer.
- **Filter coordination across multiple map widgets is automatic.** Two map widgets including the same layer both render the same filtered tiles because they each subscribe to the same `useFilterStore.filters[layer.tableId]` slice. No special multi-widget sync logic needed.

### Claude's Discretion

- Exact SQL migration filename + migration version number
- Exact backend route file location (`routes/layers.ts` vs inline in `index.ts`) — match existing convention
- Debounce window for auto-save (300ms vs 500ms)
- Exact derivation rule for auto-derived layer name (`${tableName} — ${renderMode}` is suggested; planner picks dedup behavior — e.g., suffix `(2)` on duplicates from the duplicate action)
- Whether opacity is implemented as a wrapper `opacity` CSS prop on the OL `Layer` instance vs serialized into WMS params — both work; OL `Layer.setOpacity()` is the cleaner path
- Drag-reorder library — manual mouse-event handling vs `react-grid-layout` reuse (existing dep) vs `dnd-kit` (new dep). Planner weighs bundle cost; avoid new deps if possible.
- Empty-state copy for the missing-table badge (`"Table removed — reconfigure"` is suggested but Claude refines)
- Exact UI for the layer-inclusion picker on `MapConfigPanel` (multi-select dropdown vs checkbox list — planner picks)
- Confirm-dialog implementation for layer delete (reuse existing toast/modal pattern)
- Whether the "all layers ON by default" for new map widgets is computed at widget-create time (snapshot of current dashboard layers) or evaluated lazily at render time (any layer not explicitly in `excludedLayerIds`). The semantics differ when a new layer is added AFTER the widget. Planner picks; default = lazy/inclusive (new layers appear in pre-existing widgets unless explicitly excluded), since "all ON" matches user intent more often
- Cleanup strategy for Phase 11 dead code (`bboxHelper.ts`, `bboxHelper.spec.ts`, zoom-to-data UI, `MapConfigPanel` lifted sections) — delete in the same plan that ships the new flow, not a follow-up
- Whether the `KineticaWmsLayerForm` lives in `src/components/charts/` (alongside MapConfigPanel) or moves to a new `src/components/layers/` directory — planner picks based on perceived future expansion

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project + milestone scope (PRIMARY)

- `.planning/PROJECT.md` — Current State (Phase 11 just completed), v1.2 milestone goal, validated requirements (FILT-* + DRILL-* + MAP-* all done), out-of-scope locks
- `.planning/REQUIREMENTS.md` — v1.2 requirement set (FILT-01..04, DRILL-01..04, MAP-01..04 — all complete); v1.3 deferred items (`IDENT-V13-01..03`, `MAP-V13-01..03`, `DRILL-V13-01..03`); the "Out of Scope" table that locks UX guarantees Phase 12 must honor (no per-chart filter-exclusion toggle, no contour drill-down, etc.)
- `.planning/ROADMAP.md` — Phase 12 stub (goal/requirements TBD before this CONTEXT); STATE.md note added 2026-05-05 sketches "Dashboard Layers Panel — sidebar/toolbar button + dashboard-scope layer registry with `layerType` discriminator (KineticaWms first); per-layer WMS params (render mode, spatial cols, colormap, point size/opacity, classbreaks); render via OL using the existing map-widget pattern"
- `.planning/STATE.md` — recent decisions, Phase 11 verification status (4/5 GREEN, Criterion 3 deferred), Phase 12 scope re-add note (2026-05-05)

### Phase 9, 10, 11 outputs (MANDATORY READS)

- `.planning/phases/09-filter-foundation/09-CONTEXT.md` — `useFilterStore` contract (`Record<tableId, ActiveFilter[]>`, `addFilter`/`removeFilter`/`clearFilters`, `filterVersion` primitive dep), SQL builders (`escapeKineticaStringLiteral`, `buildEqualityFilter`, `buildWhereClause`, `injectWhereClause`)
- `.planning/phases/09-filter-foundation/09-VERIFICATION.md` — passed; LOW-confidence note on TIMESTAMP literal still relevant for any new SQL paths
- `.planning/phases/10-existing-chart-drill-down/10-CONTEXT.md` — drill-down pattern, `isColumnDrillDownSafe`, the locked decision NOT to render per-chart borders/badges (Phase 12 honors — no per-layer border on map widgets)
- `.planning/phases/11-map-chart/11-CONTEXT.md` — full Phase 11 decisions (spatial-mode auto-suggest, render-mode UX, classbreak N-row builder, basemap options, M-01..M-08 pitfall locks). Phase 12 inherits all OL/WMS pitfall locks per layer
- `.planning/phases/11-map-chart/11-VERIFICATION.md` — Phase 11 verification (4/5 GREEN); Criterion 3 (filter-driven tile invalidation) deferred but the code path is unchanged — Phase 12 must preserve M-02 behavior per layer

### Research artifacts

- `.planning/research/STACK.md` — OpenLayers v10 rationale, `ol@^10.5.0` pin, React 18 mount/dispose pattern, WMS API surface
- `.planning/research/ARCHITECTURE.md` — filter store integration, AP-1/AP-2/AP-4 anti-pattern locks
- `.planning/research/PITFALLS.md` — M-01..M-08 (OpenLayers Strict-Mode mount/dispose, updateParams not rebuild, EPSG:3857, WKT/WKB branch, BLUR_RADIUS units, classbreak cardinality cap, WMS URL length, Cache-Control: no-store)
- `.planning/research/SUMMARY.md` — synthesized v1.2 architecture + pitfall map
- `.planning/research/FEATURES.md` — feature edge cases (EC-3 dedupe, etc.)

### Codebase maps (READ BEFORE WRITING CODE)

- `.planning/codebase/CONVENTIONS.md` — TypeScript strict, camelCase, 2-space indent, NO path aliases (relative imports only), no formatter config
- `.planning/codebase/STRUCTURE.md` — repo layout for new file placement (`src/components/charts/KineticaWmsLayerForm.tsx`, `src/components/charts/LayersModal.tsx`, `src/store/dashboardLayersStore.ts`)
- `.planning/codebase/STACK.md` — existing dependency baseline; no new frontend deps anticipated unless drag library needs one
- `.planning/codebase/INTEGRATIONS.md` — frontend↔backend CRUD patterns, useApiQuery / apiFetch usage
- `.planning/codebase/TESTING.md` — vitest + RTL conventions; OL canvas rendering is jsdom-stubbed

### Existing code (mandatory read before writing)

- `kinetica_bi/src/components/DashboardsPage.tsx:487-491, :616-643` — top-bar button pattern + Tables / Visualizations modal scaffolding (Layers modal mirrors this)
- `kinetica_bi/src/components/DashboardsPage.tsx:341-401` — dashboard-table CRUD wiring (templates the layer CRUD wiring)
- `kinetica_bi/src/components/DashboardsPage.tsx:441-443` — auto-save-on-change comment for the existing WidgetConfigModal pattern
- `kinetica_bi/src/components/charts/MapConfigPanel.tsx` (~800 LOC) — source for the lift; planner extracts `KineticaWmsLayerForm` from this and shrinks the remainder to title + basemap + layer-inclusion picker
- `kinetica_bi/src/components/charts/MapChartRenderer.tsx` (~553 LOC) — current single-WMS-source renderer; planner reworks to render N stacked `ImageWMS` sources, one per included layer
- `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` — existing tests; rewrite for N-layer stack (mount/unmount, per-layer filter sub, basemap swap, opacity)
- `kinetica_bi/src/components/charts/definitions/map.ts` — chart-type registry entry; `usesAggregation: false`, `supportsDrillDown: false` stays
- `kinetica_bi/src/components/charts/registry.ts` — `ChartTypeDefinition` interface + CustomConfigPanel slot routing
- `kinetica_bi/src/components/charts/WidgetRenderer.tsx` — `case "map"` branch (mounts MapChartRenderer)
- `kinetica_bi/src/store/filterStore.ts` (~195 LOC) — Phase 9 store; layers consume via selector (`state.filters[layer.tableId] ?? []`); no store changes needed
- `kinetica_bi/src/store/wmsCapabilities.ts` — Phase 11 capabilities store; layer config form gates render-mode + colormap options against this
- `kinetica_bi/src/lib/columnTypes.ts` — `getValidSpatialColumns`, `autoSuggestSpatialMode`, `inferDataTypeFromColumn`, `isColumnDrillDownSafe` — all reused by `KineticaWmsLayerForm`
- `kinetica_bi/src/lib/wmsUrlBuilder.ts` — Phase 11 URL builder; reused per layer (planner verifies it accepts a single-layer config object cleanly — likely zero changes)
- `kinetica_bi/src/lib/cardinalityProbe.ts` — classbreak cardinality probe; reused by `KineticaWmsLayerForm` classbreak builder
- `kinetica_bi/src/lib/bboxHelper.ts` + `bboxHelper.spec.ts` — **DELETE** as part of zoom-to-data removal
- `kinetica_bi/src/api/client.ts` — frontend API surface; new exports for layer CRUD
- `kinetica_bi/server/src/index.ts` — backend route mounting; new layer routes added here or in a new `routes/layers.ts`
- `kinetica_bi/server/src/db.ts` (or equivalent — planner confirms file path) — DB initialization; migration registration for new `dashboard_layers` table
- `kinetica_bi/server/src/migrations/` — existing migration pattern (planner inspects to copy convention)

### Anti-pattern locks (carry forward, must appear in plans)

- **AP-1**: Filter state lives in `useFilterStore` only — layers read via selector (`filters[layer.tableId]`, `filterVersion`), never via prop-drilling or component-local copies
- **AP-2**: Do NOT refetch SQL on WMS tile requests — map tiles and SQL chart data have independent lifecycles; layers subscribe only to `filterVersion` for tile invalidation
- **AP-3**: `escapeKineticaStringLiteral` called on every value that flows from chart click into SQL — applies to layer's WHERE-clause construction (reuses existing `buildWhereClause`)
- **AP-4**: Layer uses `dashboard_layers.table_id` (number, persisted at layer-create time) for the filter-store key — no runtime table-name lookup

### Pitfall locks (carry forward, must appear in plans as pitfall-locking comments and tests)

- **M-01**: `map.setTarget(undefined); map.dispose()` in `useEffect` cleanup; `mapRef` guard prevents Strict Mode double-mount — applies to the Map instance, regardless of layer count
- **M-02**: Filter changes call `tileWmsSource.updateParams()` per layer — do NOT rebuild the full map; include `_v=filterVersion` to force cache-key change. Critical for the N-layer stack — each layer's source manages its own cache-bust independently
- **M-03**: OpenLayers `View` locked to `EPSG:3857`; WMS request includes `SRS=EPSG:3857` explicitly per layer
- **M-04**: WKT vs Kinetica WKB branch in WMS parameter construction — applies per layer; layer config carries spatialMode + columns
- **M-05**: Heatmap `BLUR_RADIUS` and contour `CONTOUR_BANDWIDTH` are in Kinetica map units (NOT pixels) — UI labels in `KineticaWmsLayerForm` clarify units
- **M-06**: Classbreak cardinality probe at column-pick time per layer; hard cap 256; warn at >100
- **M-07**: WMS URL length per layer — primary defense is the 10-filter cap from Phase 9 (already locked)
- **M-08**: `Cache-Control: no-store` on `/api/wms` proxy responses — already in place from Phase 11; no changes needed
- **C-04**: Filter store shape `Record<number, ActiveFilter[]>` keyed by `tableId` — reused unchanged for layer subscriptions
- **S-01**: Filter state lives in `useFilterStore` ONLY — no `useState` shadow copies in `MapChartRenderer` per-layer subscriptions
- **S-02**: Use `filterVersion: number` counter as primitive dep for layer's `useEffect` — prevents the "clear is a no-op" bug per layer

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`useFilterStore`** (`src/store/filterStore.ts`, ~195 LOC, Phase 9) — layer is a pure consumer; subscribes via selector for `filters[layer.tableId]` + `filterVersion`. **Zero store modifications.**
- **`useToastStore`** (`src/store/toast.ts`, ~34 LOC) — layer-config errors, missing-table badges, classbreak-cardinality warnings route through here
- **`useApiQuery`** (`src/hooks/useApiQuery.ts`) — typed-error/REAUTH chain for cardinality probe + layer CRUD on the frontend
- **`runSql` + AbortSignal** (`src/api/client.ts`) — cardinality probe queries thread through existing AbortController pattern (no SQL needed for layers themselves; WMS handles the data path)
- **`/api/wms` proxy** (`server/src/index.ts:657-665`) — already cache-control-no-store from Phase 11; layers reuse unchanged
- **`/api/wms/capabilities`** (Phase 11) — capabilities probe; `wmsCapabilitiesStore` (`src/store/wmsCapabilities.ts`) gates layer-config render-mode + colormap options
- **OpenLayers `ImageWMS` + `Map` lifecycle** (Phase 11 `MapChartRenderer`) — N-layer stack reuses the same lifecycle pattern, just one source/layer per included layer
- **Phase 11 column-type utilities** (`src/lib/columnTypes.ts`) — `getValidSpatialColumns`, `autoSuggestSpatialMode`, `inferDataTypeFromColumn` — reused by `KineticaWmsLayerForm` for spatial-mode picker + dropdown filtering + auto-suggest
- **Phase 11 WMS URL builder** (`src/lib/wmsUrlBuilder.ts`) — `buildWmsParams(config, filterVersion, whereClause)` reused per layer; planner verifies the input shape matches `dashboard_layers.config` cleanly (likely zero changes — config has the same field names)
- **Phase 11 cardinality probe** (`src/lib/cardinalityProbe.ts`) — classbreak builder reuses unchanged
- **Phase 9 SQL builders** — `escapeKineticaStringLiteral`, `buildEqualityFilter`, `buildWhereClause`, `injectWhereClause` — used unchanged for per-layer WHERE-clause construction
- **Modal pattern** (`DashboardsPage.tsx:616-643`) — `TablePickerModal` / `VisualizationPickerModal` template the new `LayersModal`

### Established Patterns

- TypeScript strict; relative imports only (no path aliases per CONVENTIONS.md)
- 2-space indent; no formatter — match existing style
- Inline pitfall-comment style: `// PITFALL M-01 lock`, etc. — every layer-related code site references the pitfall ID it's defending
- Zustand consumers read via selector; never via prop-drilling
- `useApiQuery` for new SQL queries; raw `apiFetch` for CRUD that doesn't need a query lifecycle
- Test specs colocated as `*.spec.{ts,tsx}`; vitest auto-discovers via `src/**/*.spec.{ts,tsx}` glob
- Server tests under `kinetica_bi/server/tests/` using vitest + supertest
- SQLite migrations follow the existing pattern in `kinetica_bi/server/src/migrations/`
- Modal opening/closing via parent component's `useState` (`showLayersModal`, etc.); modal renders inline conditionally
- Auto-save pattern: parent component owns the live state, modal calls back on every change with debouncing handled either at the form-component level or in the parent's PATCH dispatcher

### Integration Points

- **`DashboardsPage.tsx`** — new `Layers` button next to Tables / Visualizations; new `showLayersModal` state; new `LayersModal` mounted inline; new `useDashboardLayers(dashboardId)` hook (or equivalent) populating the `dashboardLayersStore`
- **`MapChartRenderer.tsx`** — major rework: subscribe to `dashboardLayersStore` + `widget.config.includedLayerIds`; render N stacked `ImageWMS` layers in `dashboard_layers.position` order; per-layer filter subscription + `updateParams` on filter change; per-layer opacity via `Layer.setOpacity()`; cleanup `forEach` over all layer instances on unmount
- **`MapConfigPanel.tsx`** — shrink to title + basemap + layer-inclusion picker; remove all spatial-mode / render-mode / render-param sections (extracted to `KineticaWmsLayerForm`)
- **`server/src/index.ts`** — mount new layer CRUD routes (or import from `routes/layers.ts`)
- **`server/src/migrations/`** — new migration adding `dashboard_layers` table
- **`src/api/client.ts`** — new exports: `listDashboardLayers`, `createLayer`, `updateLayer`, `deleteLayer`, `reorderLayers`
- **`src/store/`** — new `dashboardLayersStore.ts` Zustand slice
- **Hard cutover sites** — `MapChartRenderer` placeholder for old-config map widgets; `bboxHelper.ts` deletion; zoom-to-data UI removal

### New files

- `kinetica_bi/server/src/migrations/<NN>-add-dashboard-layers.sql` (or .ts — match existing pattern)
- `kinetica_bi/server/src/routes/layers.ts` (or inline in `index.ts`)
- `kinetica_bi/server/tests/layers.test.ts` — supertest coverage of CRUD + reorder
- `kinetica_bi/src/api/client.ts` — additions only, no new file
- `kinetica_bi/src/store/dashboardLayersStore.ts` + `.spec.ts`
- `kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx` + `.spec.tsx`
- `kinetica_bi/src/components/LayersModal.tsx` + `.spec.tsx` (location: planner picks — `components/` or `components/charts/`)
- Test additions to `MapChartRenderer.spec.tsx` for N-layer stack

### Why no `useFilterStore` changes in Phase 12

- Phase 9 already shipped the table-keyed contract. Layer subscriptions reuse `filters[tableId]` exactly — multiple layers on the same table simply select the same slice. The existing M-02 cache-key bust (`_v=filterVersion`) works per layer because each layer manages its own `ImageWMS` source instance.

</code_context>

<specifics>
## Specific Ideas

- **"The layers panel should be a large modal that appears, similar to the tables and visualizations modal but larger. It should also have a button at the top next to the tables and visualizations button"** — direct user direction; locks the modal pattern + top-bar button placement. Not a sidebar, not a drawer, not a left-rail section.
- **"Multiple maps allowed, but each map has an option to include or exclude the layers in the layers panel"** — drives the `widget.config.includedLayerIds` design; per-widget opt-in/out against the dashboard layer collection.
- **"Only the layers-specific options in the map config get lifted [to the layers] as it's not needed in the map config. The map config still keeps relevant map config options like the basemap"** — locks the lift boundary; basemap is widget-scoped (each map can have its own basemap), spatial/render config is layer-scoped.
- **"Remove the zoom-to-data button it does not make sense for this case"** — explicit removal of the Phase 11 MAP-04 differentiator + auto-fit-on-mount-once + bbox SQL helper. `bboxHelper.ts` becomes dead code.
- **"You also need a column to link to the selected table"** — explicit reminder that `dashboard_layers.table_id` is a first-class column, not just a JSON field in `config`. Enables FK + queryability.
- **"In the future, the table will also store a filtered view"** — captured as a v1.3+ deferred idea; suggests a per-layer or per-table saved-filter-set concept beyond the transient `useFilterStore`. Not in v1.2 scope.
- **Dashboard-scope `position` only** — single source of truth for layer render-order; rejected per-map-override and per-layer absolute z-index. Drag-reorder in the layers modal updates this.
- **Two-pane modal (list left, config right) with auto-save on every change** — matches the existing `WidgetConfigModal` pattern referenced at `DashboardsPage.tsx:441-443`; no Apply/Cancel button.
- **Pre-fill a blank layer on first open of an empty dashboard's layers modal** — skip the empty-state hint screen; user lands directly in a config form ready to fill.

</specifics>

<deferred>
## Deferred Ideas

These came up during discussion but belong outside Phase 12:

- **Map drill-down (click → identify endpoint → addFilter)** — locked as `IDENT-V13-01..03` in REQUIREMENTS.md v1.3
- **Hover-tooltip on map features** — Phase 12 maintains Phase 11's no-`pointermove` stance; depends on identify endpoint, v1.3
- **Per-layer saved-filter / saved-view concept** — user noted "in the future, the table will also store a filtered view"; suggests layers may carry a pinned filter set independent of transient dashboard filters. Track for v1.3 — likely a `filtered_view` table or `dashboard_layers.config.filterDefinition` extension
- **Basemap-as-layer architecture** — discussed and rejected; basemaps stay on widget config (each map can have its own basemap), not in the dashboard layer collection
- **SQL/aggregated layer types** (overlay aggregated query results on the map, not via WMS) — out of scope for v1.2; would expand the `layerType` discriminator past `'KineticaWms'`
- **Inline rename of layers** — out of scope for v1.2; layer name auto-derived from `${table} — ${renderMode}`. Add as a v1.3 polish if requested
- **Dashboard-scope keyboard shortcut for opening the Layers modal** — out of scope for v1.2; toggle button is the only entry point
- **Sync zoom/pan across multiple map widgets** — out of scope for v1.2; each map widget has independent viewport
- **Per-map `position` override** (allow layer order to differ per map widget) — out of scope; v1.2 uses dashboard-scope `position` only
- **Per-classbreak-row alpha picker** — already deferred from Phase 11; classbreak rows use solid colors with a global opacity slider
- **Layer-level rename in v1.2** — discussed and rejected; auto-derived name only
- **Standalone `heatmap` chart-type renderer** (`MAP-V13-01`) — distinct from layer's heatmap render mode; remains v1.3 backlog
- **Custom WMS layer style upload / classification breaks UI editor** (`MAP-V13-03`) — remains v1.3 backlog
- **Bbox/lasso spatial select on map** (`DRILL-V13-02`) — remains v1.3 backlog
- **Multiple layer types beyond KineticaWms** (e.g., raster file upload, vector tile, GeoJSON overlay) — not in v1.2 backlog; revisit when concrete need arises
- **Auto-migration of Phase 11 map widgets** — discussed and rejected in favor of hard cutover; v1.2 has not shipped to prod
- **Drag-reorder library** (e.g., `dnd-kit`) — Claude's discretion at planning time; default = manual drag-event handling or `react-grid-layout` (existing dep) reuse if practical

</deferred>

---

*Phase: 12-dashboard-layers-panel*
*Context gathered: 2026-05-05*
