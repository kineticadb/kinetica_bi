# Feature Research — v1.2 Interactive Dashboards

**Domain:** BI dashboard map chart + click-driven drill-down + cross-chart filter coordination
**Researched:** 2026-05-01
**Confidence:** HIGH (codebase directly read; BI map/drill-down/filter UX patterns are well-established across Grafana, Kibana, Superset, Redash, Tableau, Looker, Power BI; web search unavailable this session — confidence notes per section)

---

## Scope Anchor

This file covers only the **delta** for v1.2. The following already exist and are out of scope:

| What already exists | Implication for v1.2 |
|---------------------|----------------------|
| Filter bar rendering active filters per table (`DashboardsPage.tsx` lines 450–471) | v1.2 drill-down adds filters to this bar; the bar is the canonical "show active state" surface — no new widget needed |
| Per-table view placeholder model (filter_clause per view row) | Drill-down writes into `filter_clause`; cross-chart coordination happens because all charts on the same table read the same view |
| `ChartTypeDefinition` registry with `CustomConfigPanel` escape hatch | Map chart gets a `CustomConfigPanel` because lat/lon/WKT/WKB spatial column picking cannot be expressed as flat declarative fields |
| `WidgetRenderer` with loading/error/empty states per chart | Map renderer must fit the same state contract; loading spinner and error message are already standard |
| Bar, line, pie, scatter, table, big-number, records-table renderers (all clickable element candidates) | Drill-down must be grafted onto all these renderers without rewriting them |
| `usesAggregation` boolean on chart definitions | Map sets `usesAggregation: false` or uses a custom data path — no GROUP BY/metric pattern applies |

**Locked v1.2 decisions (not re-researched, treated as constraints):**

- Filter scope: same-table auto-share (no per-chart binding config; all charts on table X see table X's filters)
- Drill-down: click-element ADDS an equality filter on a configured column; filters accumulate (AND); cleared via filter bar
- Map render modes: raster, heatmap, classbreak, contour (all four)
- Map drill-down: works for raster, heatmap, classbreak (NOT contour)
- Spatial column types: lat/lon pair, WKT geometry column, Kinetica native WKB
- Filter persistence: transient (client memory only; refresh resets)

---

## Category Map

Features are organized by the three v1.2 target areas:

1. **Map Chart** — configuration UI, render, interactions
2. **Drill-Down** — click → filter UX, visual feedback, edge cases
3. **Cross-Chart Filter Coordination** — shared filter state, re-render, escape hatches

---

## Table Stakes

Features users assume exist. Missing any = product feels incomplete or broken.

### Category 1: Map Chart — Configuration UI

| # | Feature | Why Expected | Complexity | Depends On | Notes |
|---|---------|--------------|------------|------------|-------|
| TS-M1 | **Spatial column mode picker** (lat/lon pair \| WKT column \| WKB column) | Users cannot configure a map without identifying where geometry lives. Three Kinetica-specific options; picker must match the locked scope. | MEDIUM | `ChartTypeDefinition.CustomConfigPanel` (registry escape hatch already exists); column type metadata from schema discovery | Requires a `CustomConfigPanel` — the generic declarative field system cannot model "pick two columns OR pick one geometry column" as a flat list. The custom panel reads `allColumns` from the selected table exactly like `ChartConfigPanel.tsx` does today. |
| TS-M2 | **Render mode selector** (raster / heatmap / classbreak / contour) | Users need to choose how Kinetica WMS renders the data. This is the primary differentiator between chart types within the map. | SMALL | `FieldType: "select"` already supported in `ConfigField`; no custom panel needed for this field alone | Can be a declarative `select` field inside the `CustomConfigPanel`. Default: raster. |
| TS-M3 | **Single color picker for raster/heatmap** | Every map chart in every BI tool has at minimum one color control. Users expect to set "what color are the points/heat?" | SMALL | Existing `FieldType: "color"` in registry | For raster: point color. For heatmap: max-intensity color (min defaults to transparent). |
| TS-M4 | **Opacity slider (0–100%)** | Transparency is universally expected so the basemap remains visible under data. Missing opacity = map layers look like paint. | SMALL | Existing `FieldType: "range"` | Range 0–100, default 80. Applies to all four render modes. Single slider. |
| TS-M5 | **Zoom level + center lat/lon config** | Users need to set the initial map viewport. Kinetica WMS renders to a tile; without a starting viewport the map shows nothing or the wrong region. | SMALL | These three fields already exist in the current `map.ts` definition (centerLat, centerLon, zoom) | Keep as-is; already implemented as declarative fields. |
| TS-M6 | **Color ramp picker for classbreak mode** (low-color + high-color) | Classbreak mode maps a numeric column to a color gradient; users must configure which gradient. Two-color (min/max) is sufficient — Kinetica interpolates. | SMALL | Existing `FieldType: "color"` (two instances); pattern mirrors existing `heatmap.ts` (colorMin / colorMax) | Model: `colorRampLow` (default #0f172a) and `colorRampHigh` (default #22c55e). Exactly how the non-map heatmap definition does it. |
| TS-M7 | **Classbreak column selector** | For classbreak mode, users pick which numeric column drives the color ramp. Without it, Kinetica cannot build the classbreak WMS layer. | MEDIUM | Requires knowing column type (numeric) — the custom config panel already has this logic via `numericColumns` in `ChartConfigPanel.tsx` | Only visible when render mode = classbreak. |
| TS-M8 | **Drill-down target column selector** | For raster/heatmap/classbreak modes, users configure which column gets added as an equality filter when a map feature is clicked. | MEDIUM | Column list from schema discovery; drill-down feature (Category 2) | Only shown when render mode supports drill-down (not contour). Exposes all columns, not just numeric. |

### Category 1: Map Chart — Render

| # | Feature | Why Expected | Complexity | Depends On | Notes |
|---|---------|--------------|------------|------------|-------|
| TS-M9 | **OpenLayers map widget rendering Kinetica WMS tiles** | Users expect a real interactive map, not a placeholder. This is the core rendering feature. | LARGE | OpenLayers npm package (ol); Kinetica WMS tile endpoint (`kineticaWms` helper already exists); `WidgetRenderer.tsx` dispatch path | OpenLayers is the locked choice per PROJECT.md. Must integrate with the existing `WidgetRenderer` dispatch. Map type falls outside `AggregatedWidgetRenderer` / `RecordsTableRenderer` — needs its own branch, similar to how `RecordsTableRenderer` short-circuits the shared SQL effect. |
| TS-M10 | **Tile reload when active filters change** | When a drill-down or filter-clear changes the view's `filter_clause`, the map must re-render to reflect the filtered data. This is the map's participation in cross-chart coordination (Category 3). | MEDIUM | Cross-chart filter state (Category 3 TS-F1); `kineticaWms` helper; OpenLayers tile source invalidation API | Kinetica WMS tiles are parameterized by query/filter; invalidating the OpenLayers tile source cache forces a fresh tile fetch with the new filter parameters. |
| TS-M11 | **Loading indicator while tiles fetch** | Users see a blank/grey tile area during load. A spinner or "Loading..." overlay prevents confusion. | SMALL | Existing `widget-placeholder` CSS class | Can reuse the same `<div className="widget-placeholder"><span>Loading...</span></div>` pattern used by all other renderers. Map tile loading has an async nature; OpenLayers fires `tileloadstart` / `tileloadend` events. |
| TS-M12 | **Error state when WMS call fails** | Network errors, bad Kinetica auth, or malformed config produce failed tile requests. Must surface an error message, not a silently blank map. | SMALL | Existing `widget-error` CSS class; `kineticaWms` typed-error chain | OpenLayers `tileloaderror` event or a pre-flight WMS probe can detect failures. Display inline error using existing pattern. |

### Category 1: Map Chart — Interactions

| # | Feature | Why Expected | Complexity | Depends On | Notes |
|---|---------|--------------|------------|------------|-------|
| TS-M13 | **Pan and zoom (mouse drag + scroll wheel)** | Universally expected on any map widget. A static map tile is not a map chart. | SMALL | OpenLayers default behavior (no extra code needed once OL is initialized) | OpenLayers provides pan/zoom by default. No feature work beyond initialization. |
| TS-M14 | **Hover tooltip showing column values near cursor (raster/classbreak modes)** | Users need to know what data point they are hovering. In Tableau, Kibana Maps, Grafana Geomap, and Superset: hover shows a popover with relevant column values. | MEDIUM | Kinetica WMS closest-point identify endpoint (server-side probe); `kineticaWms` helper; OpenLayers `pointermove` event | The Kinetica WMS identify endpoint returns the row(s) closest to a map coordinate. Tooltip can show the top-N column values. Tooltip is transient (disappears on mouse-out); it does NOT add a filter. Contour mode: tooltip shows contour value if supported, else suppress. |
| TS-M15 | **Click → drill-down (raster, heatmap, classbreak modes)** | This is the map's contribution to the locked drill-down feature. Clicking a map location finds the nearest feature and adds an equality filter on the configured column. | LARGE | TS-M8 (drill-down target column); Kinetica WMS identify endpoint; Category 2 drill-down filter-add mechanism (TS-D1, TS-D2); OpenLayers `click` event | The click handler calls the Kinetica WMS identify endpoint with the click coordinate + current viewport bbox, gets back the nearest row, extracts the configured column value, and calls the drill-down filter-add function. Contour mode: click is a no-op (out of scope by locked decision). |
| TS-M16 | **"Zoom to data" button** | Users configure a map but the data may be in a completely different region than the default center. A one-click "fit the map to where the data actually is" is expected in every modern BI map tool (Grafana, Superset, Kibana). | SMALL | BBox query against Kinetica (SELECT MIN/MAX of lat and lon columns, or WKT envelope); OpenLayers `view.fit()` | Only meaningful for lat/lon and WKT modes (WKB bounding box is harder to compute without spatial functions). For classbreak/raster: use the lat/lon columns if configured. |

### Category 2: Drill-Down UX

| # | Feature | Why Expected | Complexity | Depends On | Notes |
|---|---------|--------------|------------|------------|-------|
| TS-D1 | **Click on chart element adds equality filter to the filter bar** | This is the milestone's primary interaction. Every BI tool with drill-down (Tableau, Looker, Superset, Redash, Kibana) adds a filter to the active filter set when the user clicks a chart element. | MEDIUM | Filter state management (new Zustand slice or React context per dashboard); existing filter bar in `DashboardsPage.tsx`; chart renderer click handlers in `WidgetRenderer.tsx` | Filter is `column = 'value'` (equality). Stored in client memory only (transient). Filter bar re-renders with the new clause immediately. The filter does NOT trigger a SQL re-fetch for non-map charts in the current architecture (existing charts use `config.sql` which is static). This is the key architectural tension — see TS-D1 note below. |
| TS-D2 | **Filter bar updates immediately to show new filter clause** | Users need instant visual confirmation that the click was registered. Without a filter bar update, click-drill-down has no visible effect. The filter bar already exists and shows `WHERE {filter_clause}`. | SMALL | Existing filter bar (`DashboardsPage.tsx` lines 450–471); filter state from TS-D1 | New filters appear as additional clauses appended to the existing `filter_clause` display. Format: `col = 'val' AND col2 = 'val2'`. |
| TS-D3 | **"Clear all filters" button on the filter bar** | Users expect a way to reset. Tableau has "Revert to default." Kibana has "Clear all filters." Superset has a "Clear all" button. Without this, users are stuck with the accumulated filters until page refresh. | SMALL | Filter state from TS-D1; existing filter bar | Button appears only when at least one filter is active. Clears all equality filters for the given table. Positioned in the filter bar next to the filter clause. |
| TS-D4 | **Per-filter "x" dismiss badge on each active filter** | Users want to remove one filter at a time without clearing all. Every BI tool that shows filter pills (Kibana, Superset, Grafana) provides an individual dismiss control on each active filter. | SMALL | Filter state from TS-D1; filter bar | Each filter renders as a `col = 'val' [x]` badge. Clicking [x] removes that filter only. Remaining filters stay active. |
| TS-D5 | **Drill-down column configured per chart in the config panel** | Users configure which column gets filtered when they click a chart element. Without this, drill-down has no column to add. | MEDIUM | `ChartConfigPanel.tsx` (new "Drill-down column" field in the config panel for each chart type that supports it); column list from schema discovery | Shown for bar, line, pie, scatter (not for big-number or table/records-table which have their own row-click semantics). Map has its own version (TS-M8). Default: the `groupByColumn` (the natural key for most aggregated charts). |
| TS-D6 | **Visual "selected/active" state on the clicked chart element** | Users need to see which element they drilled into. Tableau highlights selected marks. Kibana highlights selected bars. Without this, the user does not know if their click was registered, or which element is currently driving the filter. | MEDIUM | Recharts `Cell` fill override; React state tracking `activeFilter` in WidgetRenderer | For bar: highlight the clicked bar (full opacity) and dim others (50% opacity). For pie: highlight the clicked slice. For scatter: highlight the clicked dot. For line: highlight the clicked point. State lives in the WidgetRenderer for that chart. Cleared when the filter is removed from the filter bar. |
| TS-D7 | **Empty-result handling after drill-down (zero rows match)** | If the user drills into a value that matches zero rows (e.g., filtering to a category that has no records in the current view), all charts on that table must display a "No data" empty state rather than crashing or showing stale data. | SMALL | Existing `widget-placeholder` empty state (already rendered in `WidgetRenderer` when `data.length === 0`); map tile: WMS returns a blank tile | No new code needed for most charts — the existing `No data returned` placeholder fires automatically. Map: an empty WMS tile renders as blank/transparent, which is already correct behavior. Document this as expected, not a bug. |

### Category 3: Cross-Chart Filter Coordination

| # | Feature | Why Expected | Complexity | Depends On | Notes |
|---|---------|--------------|------------|------------|-------|
| TS-F1 | **Shared filter state per table (client-side, transient)** | Cross-chart coordination only works if all charts on the same table read from the same filter state. This is the backbone of the feature. | MEDIUM | New Zustand slice or React context at the `DashboardOpen` level keyed by `tableId`; all widget renderers must subscribe to this state | State shape: `Map<tableId, ActiveFilter[]>` where `ActiveFilter = { column: string; value: string \| number }`. Stored in Zustand (consistent with existing auth store) or lifted into `DashboardOpen`'s local state. |
| TS-F2 | **All charts on the same table re-query when a filter changes** | When chart A adds a filter, chart B (same table) must re-render with the new filtered data. Otherwise cross-chart coordination is non-functional. | LARGE | TS-F1 (shared filter state); chart renderers must re-run their SQL query when filter state changes; existing `useEffect([sql])` patterns in `WidgetRenderer` must respond to filter changes, not just to `config.sql` changes | This is the largest architectural challenge. The current `WidgetRenderer` re-fetches only when `widget.config.sql` changes. With transient filter state, the SQL is not stored in config. Two implementation approaches: (a) inject the active filter clause into the SQL at render time (SQL remains authoritative, filter appended as `WHERE` clause at runtime), or (b) maintain filter state separately and apply client-side. Approach (a) is correct for consistency with Kinetica's columnar model. The WidgetRenderer must become filter-state-aware. |
| TS-F3 | **Loading indicator per chart while re-querying after filter change** | When filter A fires and chart B re-fetches, chart B must show a loading state. Without this, chart B looks frozen or stale. All modern BI tools show a spinner or dim the chart during reloads. | SMALL | Existing `loading` state in each `WidgetRenderer` instance; triggered by the re-query from TS-F2 | The existing `loading` boolean already controls a spinner. The re-query sets `loading: true` at the start and `false` at the end. No new UI needed — just ensure the re-query path sets loading correctly. |
| TS-F4 | **Map tile invalidation after filter change** | The map is not a Recharts chart — it does not re-run a SQL query; it fetches WMS tiles. When the filter changes, the tile URL parameters change and OpenLayers must discard its tile cache and fetch new tiles. | MEDIUM | OpenLayers tile source `refresh()` or `setParams()` (version-dependent API); TS-F1 filter state subscription in the map renderer | The OpenLayers `TileWMS` source can be updated with new `STYLES` or `CQL_FILTER` parameters. Calling `source.updateParams()` triggers a tile cache clear and refetch. This is a standard OpenLayers pattern for WMS filter updates. |

---

## Differentiators

Features that set this BI app apart. Not required, but add real value.

| # | Feature | Value Proposition | Complexity | Depends On | Recommendation |
|---|---------|-------------------|------------|------------|----------------|
| D-1 | **Point-size slider for raster mode** (marker size by pixel radius) | Every point-map BI tool (Grafana Geomap, Kibana Maps, Superset) lets users tune point size. The current `map.ts` definition already has `markerSize` (range 2–20) — it just needs to be wired into the WMS call via `POINT_SIZE` or equivalent Kinetica WMS parameter. | SMALL | Existing `markerSize` field in `map.ts`; Kinetica WMS `STYLES` parameter encoding | The current field exists but the value is not yet used (no WMS renderer). Include it in the WMS call from day one. |
| D-2 | **"Zoom to data" with bbox computed from Kinetica** | Removes the manual center/zoom config burden. The user clicks one button and the map centers on where the data actually lives. | SMALL | `runSql` helper; OpenLayers `view.fit()`; lat/lon columns or WKT envelope function | Already classified as table stakes (TS-M16) — kept here for emphasis because it dramatically improves the cold-start UX. |
| D-3 | **Click-to-drill-down on table/records-table rows** | Clicking a row in the records table or table chart could add an equality filter on the row's column values. Creates a powerful "click a row → filter all charts to that record's attributes" workflow. | MEDIUM | TS-D1 filter-add mechanism; click handler on `<tr>` in `TableRenderer` and `RecordsTableRenderer` | Requires disambiguating which column to filter on (could be a config option: "Drill-down on column X when row is clicked"). Not table stakes because table/records rows have many columns and the "which column" question is unclear without config. |
| D-4 | **Toast notification on successful drill-down** | A brief "Filter added: region = 'West'" toast confirms the click was processed. Useful when the filter bar is off-screen or below the fold. | SMALL | Existing `Toast.tsx` component and `toast` Zustand store | Show for 2–3 seconds. Message: `"Filter added: {column} = '{value}'"`. Dismissed automatically. |
| D-5 | **"Undo last filter" keyboard shortcut (Cmd/Ctrl+Z)** | Power users expect undo. Superset has undo for filter changes. Removes the last-added filter without opening the filter bar. | MEDIUM | Filter state from TS-F1 (maintain filter history stack); keyboard event listener on the dashboard container | History stack: max depth 10. Undo pops the stack, removes the last filter, triggers re-query. This is separate from the per-filter dismiss (TS-D4) — undo is time-ordered, dismiss is identity-based. |
| D-6 | **Classbreak label column** (show a text label on map features) | For classbreak mode, users sometimes want a text annotation (e.g., city name) rendered near each feature. | MEDIUM | Kinetica WMS `LABEL_COLUMN` parameter (if supported); config field in map CustomConfigPanel | Only meaningful for classbreak mode with point data (not polygon). Check Kinetica WMS docs for `LABEL` parameter support — flag as LOW confidence on exact parameter name. |
| D-7 | **Basemap style selector** (light street / dark street / satellite) | Modern BI map tools (Grafana, Superset, Kibana) offer 2–3 basemap presets. Users doing spatial analysis on dark dashboards want a dark basemap. | SMALL | OpenLayers `OSM` tile source or XYZ tile source with a configurable URL; config `select` field | Three options: OpenStreetMap (light), CartoDB Dark Matter (dark), CartoDB Positron (light minimal). All are free/open tile services. Adds one `select` field to the config panel. |

---

## Anti-Features

Features that look natural to add but should be explicitly rejected for v1.2.

| # | Anti-Feature | Why It Looks Attractive | Why It Should Not Be Built | What To Do Instead |
|---|--------------|-------------------------|----------------------------|--------------------|
| AF-1 | **Bounding-box (bbox) select on the map** — drag a rectangle to filter to all features within the bbox | Grafana and Kibana both have bbox-select. Looks like the natural next step after click-drill. | Requires a `geo_intersects` or `st_within` spatial SQL filter, not an equality filter. This breaks the locked drill-down semantics (`click-element ADDS equality filter on configured column`). Bbox-select outputs a geometry filter, not a column value. Implementing it correctly needs spatial SQL support in the filter clause, a new filter type in the state model, and new WMS CQL parameters. Scope blowup for v1.2. | Lock to single-click (TS-M15). Defer bbox-select to v1.3 with a deliberate spatial-filter feature design. |
| AF-2 | **Lasso select on the map** — freehand polygon to filter features within it | Even more expressive than bbox-select; expected by GIS users | Same problem as AF-1 but worse: lasso requires polygon geometry, WKT encoding, and a `st_within(geom, lasso_polygon)` clause. Completely out of scope for v1.2 equality-filter model. Complexity: LARGE. | Never build lasso at the dashboard level. Kinetica's native WMS interface has this capability; link users to the Kinetica admin tools for spatial analytics, keep the BI app simple. |
| AF-3 | **Filter persistence across page refresh** | Users want their drill-down state to survive a reload. Power BI and Tableau have saved filter state in shareable URLs. | Contradicts the locked v1.2 decision: "Filter persistence: transient (client memory only)." Adding persistence requires a new storage layer (URL params, localStorage, or a `filter_state` column in `views`). Changes the architecture of the sessions/views model. This is a v1.3 feature. | Document clearly in UI: "Filters reset on refresh." The filter bar's clear button and per-filter dismiss make managing transient state tolerable. |
| AF-4 | **"Exclude chart from filter sharing" toggle per widget** | Users in other BI tools (Tableau, Grafana) sometimes want one chart to be "locked" and not respond to dashboard filters. | The locked v1.2 decision is same-table auto-share with no per-chart binding config. Adding an exclusion toggle: (a) requires per-widget config schema changes, (b) requires the filter-sharing mechanism to check the exclusion flag per widget, (c) creates a confusing UX where some charts on the same table silently ignore filters. For an internal tool used by a small team, this level of granularity adds confusion, not power. | Auto-share all charts on the same table. If a user needs an "unfiltered" view of a table, they add a second widget configured to a different view (the views model already supports this). |
| AF-5 | **Hover-based filter activation** (hovering over a bar adds a temporary filter) | Feels responsive. Grafana "explore" panels sometimes highlight related panels on hover. | Hover-based filtering fires constantly as the user moves the mouse, triggering a cascade of SQL queries across all charts on that table. For an internal tool running against a Kinetica GPU-DB, this is unnecessary query load. Hover is for tooltips only (TS-M14); click is for filters (TS-D1, TS-M15). | Hover = tooltip only. Click = filter. Enforce this separation strictly. |
| AF-6 | **SQL editor in the filter bar** (let users type WHERE clauses manually) | Power users want full SQL control over filters. Redash and Grafana have this. | The project explicitly locks out a custom SQL editor (PROJECT.md "Out of Scope"). The structured query builder model is the intentional design decision. A raw SQL box in the filter bar bypasses the structured filter model, creates SQL injection surface, and breaks the equality-filter semantics that TS-F2 depends on (how do you parse an arbitrary WHERE clause into `ActiveFilter[]`?). | The existing filter bar shows the generated clause as read-only. Users who need arbitrary SQL should use Kinetica's admin tooling. |
| AF-7 | **Contour mode drill-down** | Contour is a render mode; click should identify the contour value and filter. | Locked out by the v1.2 scope decision: "Map drill-down: works for raster, heatmap, classbreak (NOT contour)." Contour identifies an iso-value (a numeric level), not a row in a table. Mapping a contour click to an equality filter on a table column is conceptually unclear and Kinetica's identify endpoint for contour is not as well-defined. | Suppress click events on the map in contour mode. Document that contour is view-only. |
| AF-8 | **Multi-value drill-down** (shift-click to add multiple OR-joined filter values) | Tableau supports shift-click to select multiple marks and adds a `col IN (v1, v2, v3)` filter. | Adds complexity to the filter state model (equality vs. IN-list), the filter bar rendering (`col IN (v1, v2)` vs `col = v1`), and the SQL injection into the WMS/SQL queries. The locked design is accumulating AND equality filters. A single shift-click feature doubles the filter state complexity. | Ship equality-filter AND-accumulation first. Defer OR/IN-list selection to v1.3 based on user feedback. |
| AF-9 | **Map animation / time slider** | Users exploring temporal spatial data might want to animate through time steps on the map. | Time sliders require a time dimension column, an animation loop, and per-step WMS tile fetching. This is a full feature, not a v1.2 addition. Kinetica's WMS does not have native animation; each frame would be a separate tile request. Scope: LARGE. | Not in v1.2. If temporal analysis is needed, users filter by time range using the existing filter bar manually. |

---

## Feature Dependencies

```
TS-M1 (spatial column mode picker — CustomConfigPanel)
    └──requires──> registry.ts CustomConfigPanel escape hatch (already exists)
    └──enables──> TS-M9 (WMS renderer knows which columns to use)
    └──enables──> TS-M15 (click drill-down knows which coordinate to probe)
    └──enables──> TS-M16 (zoom-to-data knows which columns to bbox-query)

TS-M2 (render mode selector)
    └──enables──> TS-M3 (color — only for raster/heatmap)
    └──enables──> TS-M6 (color ramp — only for classbreak)
    └──enables──> TS-M7 (classbreak column — only for classbreak)
    └──enables──> TS-M8 (drill-down column — only for raster/heatmap/classbreak)
    └──gates──> TS-M15 (contour mode suppresses click)

TS-M9 (OpenLayers WMS render)
    └──requires──> TS-M1 (spatial column mode)
    └──requires──> TS-M2 (render mode)
    └──enables──> TS-M10 (tile reload on filter change)
    └──enables──> TS-M13 (pan/zoom — free once OL is initialized)
    └──enables──> TS-M14 (hover tooltip — requires OL pointermove)
    └──enables──> TS-M15 (click drill-down — requires OL click event)
    └──enables──> TS-M16 (zoom to data — requires OL view.fit())

TS-F1 (shared filter state per table)
    └──required by──> TS-D1 (filter-add writes to this state)
    └──required by──> TS-F2 (all charts subscribe and re-query)
    └──required by──> TS-F4 (map invalidates tiles on state change)
    └──required by──> TS-M10 (map tile reload on filter change)
    └──required by──> TS-D3 (clear all reads from and writes to this state)
    └──required by──> TS-D4 (per-filter dismiss writes to this state)
    └──required by──> TS-D6 (visual active state reads active filters)

TS-D1 (click adds equality filter)
    └──requires──> TS-D5 (drill-down column must be configured)
    └──requires──> TS-F1 (somewhere to write the filter)
    └──enables──> TS-D2 (filter bar updates)
    └──enables──> TS-D6 (visual active state)
    └──enables──> TS-D7 (empty result handling)

TS-F2 (charts re-query on filter change)
    └──requires──> TS-F1 (filter state)
    └──requires──> WidgetRenderer becoming filter-state-aware (runtime SQL injection)
    └──enables──> TS-F3 (loading state per chart during re-query)

TS-M15 (map click drill-down)
    └──requires──> TS-M9 (OL map)
    └──requires──> TS-M8 (drill-down column config)
    └──requires──> TS-D1 (filter-add mechanism)
    └──requires──> Kinetica WMS identify endpoint (server-side probe)
```

**Dependency Notes:**

- **TS-F1 is the foundation of v1.2:** All three feature areas (map, drill-down, cross-chart coordination) write to or read from this shared filter state. Build it first.
- **TS-M9 is the largest single piece:** OpenLayers initialization, tile source wiring, viewport management. All map interactions hang off it.
- **TS-F2 is the largest architectural change:** WidgetRenderer currently re-fetches only when `config.sql` changes. Making it filter-state-aware requires injecting the active filter clause into SQL at render time and subscribing to the filter state. This touches every chart renderer.
- **TS-D5 (drill-down column config) must be in the config panel before TS-D1 can work:** Without knowing which column to filter on, the click handler has nothing to add.

---

## Edge Cases

These are not features — they are behaviors that must be specified and handled correctly. Failure to handle them = bugs, not missing features.

| # | Edge Case | What Happens Without Handling | Correct Behavior | Complexity |
|---|-----------|-------------------------------|-----------------|------------|
| EC-1 | **Zero rows after drill-down** | Charts crash or show stale data | All charts show existing empty state (`No data returned` placeholder). Map shows blank tile. Filter bar still shows the active filter. No crash. | SMALL — existing empty states handle this; just ensure the re-query path is correct |
| EC-2 | **Drill-down on a non-filterable column type (geometry, large text WKT/WKB)** | Filter value is a geometry WKT string or binary blob — equality filter on this column would be nonsensical or exceed SQL limits | Prevent selection of geometry/WKT/WKB columns as the drill-down target. Column picker for TS-D5 and TS-M8 must exclude columns whose type matches Kinetica's geometry type identifiers (`WKT`, `WKB`, `GEOMETRY`, `bytes`). Show a hint: "Geometry columns cannot be used as drill-down targets." | SMALL — column type is available from schema discovery; filter the picker |
| EC-3 | **Drill-down to a value that is already filtered** | User clicks "region = West" when region = West is already in the filter set | Silently deduplicate: if `{column: 'region', value: 'West'}` already exists in `ActiveFilter[]`, do not add a duplicate. No toast, no error — just a no-op. | SMALL — array `findIndex` check before pushing |
| EC-4 | **Map click on empty area (no features near the probe point)** | WMS identify endpoint returns zero rows | Suppress the filter-add. Show a brief "No data at this location" tooltip (not a full toast). Do not add an empty filter. | SMALL — check response length before calling drill-down handler |
| EC-5 | **Filter clause building with string values containing single quotes** | SQL injection / broken clause: `col = 'O'Brien'` | Escape single quotes in filter values: replace `'` with `''` (standard SQL escaping). This is the minimum required — the transient filter state generates read-only clauses sent to Kinetica, not user-facing SQL. | SMALL — one-line sanitization in the filter-clause builder |
| EC-6 | **Numeric vs. string value quoting in the filter clause** | `region = 'West'` (correct) vs `count = 'West'` (wrong) or `count = West` (broken) | Detect column type from schema metadata: string/varchar columns get quoted values; numeric columns get unquoted values. | SMALL — column type available from `selectedTable.columns`; branch on `isNumericType()` (function already exists in `ChartConfigPanel.tsx`) |
| EC-7 | **Drill-down on a chart with no drill-down column configured** | Click fires but there is no column to filter on | If `drill-down column` is not configured, clicking is a no-op. No filter added, no error. Optionally show a one-time hint: "Configure a drill-down column in chart settings." | SMALL — guard in click handler |

---

## MVP Definition

### Must ship in v1.2 (milestone is incomplete without these)

| Priority | Feature | Reason |
|----------|---------|--------|
| P0 | **TS-F1** (shared filter state per table) | Foundation; everything else depends on it |
| P0 | **TS-D1** (click adds equality filter) | Core interaction; the milestone's primary value |
| P0 | **TS-D2** (filter bar updates immediately) | Required visual confirmation |
| P0 | **TS-D3** (clear all filters button) | Required escape hatch; without it users are stuck |
| P0 | **TS-D4** (per-filter dismiss badge) | Fine-grained control; required for usability |
| P0 | **TS-D5** (drill-down column config per chart) | Required for TS-D1 to know what to filter on |
| P0 | **TS-F2** (charts re-query on filter change) | Without re-query, cross-chart coordination is fake |
| P0 | **TS-F3** (loading state per chart during re-query) | Required UX during re-fetch |
| P0 | **TS-M1** (spatial column mode picker) | Required to configure a map chart at all |
| P0 | **TS-M2** (render mode selector) | Required; without it all maps use a single mode |
| P0 | **TS-M9** (OpenLayers WMS render) | Required; this is the map chart |
| P0 | **TS-M10** (tile reload on filter change) | Required for map to participate in coordination |
| P0 | **TS-M13** (pan and zoom) | Required; a static map is not a map |
| P0 | **TS-M15** (click drill-down on map) | Required; map must participate in drill-down |
| P1 | **TS-M3** (single color picker) | Required for legible map styling |
| P1 | **TS-M4** (opacity slider) | Required to see basemap through data |
| P1 | **TS-M5** (zoom + center config) | Already partially built in map.ts; wire up |
| P1 | **TS-M11** (loading indicator) | Required for perceived performance |
| P1 | **TS-M12** (error state) | Required; silent blank map is unacceptable |
| P1 | **TS-M14** (hover tooltip) | High value, required for the map to feel interactive |
| P1 | **TS-D6** (visual active state on clicked element) | Required confirmation that click registered |
| P1 | **TS-D7** (empty result handling) | Required correctness — not a crash |
| P1 | **TS-F4** (map tile invalidation on filter change) | Required for map to participate in cross-chart coordination |
| P1 | **TS-M6** (classbreak color ramp) | Required when render mode = classbreak |
| P1 | **TS-M7** (classbreak column selector) | Required when render mode = classbreak |
| P1 | **TS-M8** (drill-down column selector for map) | Required for TS-M15 |
| P1 | **EC-1 through EC-7** (edge case handling) | Required correctness; not optional polish |

### Include if cheap (P2 — recommend)

| Feature | Why Include |
|---------|-------------|
| **D-1** (point-size slider) | Field already exists in `map.ts`; just wire it to WMS params |
| **D-4** (toast on drill-down) | Existing Toast component; ~10 lines |
| **D-7** (basemap style selector) | One `select` field + OL tile source swap; small effort, high polish |
| **TS-M16** (zoom to data) | One SQL query + `view.fit()` call; prevents common misconfiguration frustration |

### Defer to v1.3+

| Feature | Why Defer |
|---------|-----------|
| **D-3** (click on table/records rows) | Ambiguous "which column" UX; defer until user feedback clarifies demand |
| **D-5** (undo last filter) | Nice-to-have; filter-history stack adds complexity; per-filter dismiss (TS-D4) covers the primary need |
| **D-6** (classbreak label column) | Kinetica WMS `LABEL` parameter needs verification; optional visual polish |
| **AF-1** (bbox select) | Spatial filter semantics; v1.3 feature |
| **AF-3** (filter persistence) | Locked out; v1.3 with deliberate storage design |
| **AF-8** (multi-value OR selection) | Locked out; v1.3 based on user feedback |

---

## Complexity Summary

| Feature | Category | Complexity | Bottleneck |
|---------|----------|------------|------------|
| TS-F1 (shared filter state) | Cross-chart | MEDIUM | Zustand slice design; keyed by tableId |
| TS-F2 (charts re-query on filter) | Cross-chart | LARGE | WidgetRenderer runtime SQL injection; subscribe to filter state |
| TS-F3 (loading state per chart) | Cross-chart | SMALL | Existing loading bool; no new UI |
| TS-F4 (map tile invalidation) | Cross-chart | MEDIUM | OL `source.updateParams()` plumbing |
| TS-D1 (click adds filter) | Drill-down | MEDIUM | Click handlers on Recharts elements; filter state write |
| TS-D2 (filter bar update) | Drill-down | SMALL | Filter bar already reads view state; update path |
| TS-D3 (clear all) | Drill-down | SMALL | One button; clears filter state |
| TS-D4 (per-filter dismiss) | Drill-down | SMALL | Filter pill with [x]; remove from array |
| TS-D5 (drill-down column config) | Drill-down | MEDIUM | Config panel field; column type picker |
| TS-D6 (visual active state) | Drill-down | MEDIUM | Recharts Cell fill override per chart type |
| TS-D7 (empty result) | Drill-down | SMALL | Existing empty state fires automatically |
| TS-M1 (spatial column picker) | Map config | MEDIUM | CustomConfigPanel; 3-way conditional UI |
| TS-M2 (render mode) | Map config | SMALL | select field |
| TS-M3 (single color) | Map config | SMALL | color field |
| TS-M4 (opacity) | Map config | SMALL | range field |
| TS-M5 (zoom/center) | Map config | SMALL | Already in map.ts; wire to OL |
| TS-M6 (classbreak ramp) | Map config | SMALL | Two color fields; mirrors heatmap.ts |
| TS-M7 (classbreak column) | Map config | MEDIUM | Conditional visibility; numeric column picker |
| TS-M8 (drill-down column) | Map config | MEDIUM | Conditional visibility; all-columns picker |
| TS-M9 (OL WMS render) | Map render | LARGE | OpenLayers init; tile source; OL + React lifecycle |
| TS-M10 (tile reload on filter) | Map render | MEDIUM | Filter state subscription + source.updateParams() |
| TS-M11 (loading indicator) | Map render | SMALL | OL tileloadstart/end events; existing CSS |
| TS-M12 (error state) | Map render | SMALL | OL tileloaderror; existing error CSS |
| TS-M13 (pan/zoom) | Map interaction | SMALL | Free with OL defaults |
| TS-M14 (hover tooltip) | Map interaction | MEDIUM | OL pointermove; WMS identify endpoint; tooltip component |
| TS-M15 (click drill-down) | Map interaction | LARGE | OL click; WMS identify; coordinate probe; filter-add |
| TS-M16 (zoom to data) | Map interaction | SMALL | bbox SQL query; OL view.fit() |

**Heaviest items:** TS-F2 (SQL injection architecture), TS-M9 (OL initialization), TS-M15 (WMS identify + click drill-down). These three should drive phase boundary decisions.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Filter bar existing shape | HIGH | DashboardsPage.tsx directly read; lines 450–471 |
| Chart renderer click handler hookpoints | HIGH | WidgetRenderer.tsx directly read; Recharts `onClick` props on Bar, Pie, Line cells exist |
| Registry CustomConfigPanel escape hatch | HIGH | registry.ts directly read; field at line 55 |
| BI tool UX conventions (drill-down, filter bars, cross-chart coordination) | HIGH | Well-established patterns across Tableau, Grafana, Kibana, Superset, Power BI; training data reliable for 2025 patterns |
| OpenLayers WMS integration patterns | HIGH | OL WMS tile source + updateParams() is a standard, well-documented pattern; not version-sensitive |
| Kinetica WMS identify endpoint shape and parameters | MEDIUM | Kinetica-specific; the PROJECT.md says "closest-point WMS probe (server-side identify endpoint)" exists; exact API parameters need verification against Kinetica docs during implementation |
| Kinetica WMS classbreak `LABEL_COLUMN` parameter | LOW | Kinetica WMS styling parameters are proprietary; existence needs verification |
| Web search available | NO | Unavailable this session; all findings from codebase read + training data |

---

## Open Questions for Implementation

1. **Kinetica WMS identify endpoint:** What is the exact URL path and parameter set? Is it the standard WMS `GetFeatureInfo` request, or a Kinetica-specific endpoint? This determines how TS-M14 and TS-M15 are implemented.
2. **Kinetica WMS CQL_FILTER vs. custom parameter:** How does the active filter clause get passed to the WMS tile request? CQL_FILTER (OGC standard)? A custom Kinetica query parameter? This determines TS-M10 and TS-F4 implementation.
3. **Filter state storage:** Zustand store (consistent with `auth.ts` pattern) vs. lifted state in `DashboardOpen`? Zustand is correct for state shared across multiple widget instances rendered in the same page; lifted state avoids an additional store. For v1.2's transient model, lifted state in `DashboardOpen` (similar to how `widgets`, `views`, `associatedTables` are already managed) is simpler and avoids introducing a second Zustand store.
4. **Runtime SQL injection shape:** When TS-F2 injects the filter into a chart's SQL, does it append `WHERE col = 'val'` to the stored `config.sql`, or replace the view name with a sub-query? Appending to `config.sql` at render time (not persisting the modified SQL) is the cleanest approach.

---

*Feature research for: v1.2 Interactive Dashboards (map chart + drill-down + cross-chart filter coordination), Kinetica BI*
*Researched: 2026-05-01*
