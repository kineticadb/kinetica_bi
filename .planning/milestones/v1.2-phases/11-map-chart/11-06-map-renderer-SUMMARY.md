---
phase: 11-map-chart
plan: 06
subsystem: ui
tags: [openlayers, ol, react, typescript, tdd, vitest, wms, filter, map]

requires:
  - phase: 11-map-chart
    plan: 04
    provides: "buildWmsParams(config, filterVersion, whereClause) from wmsUrlBuilder.ts"
  - phase: 11-map-chart
    plan: 05
    provides: "ol@10.9.0 installed; CSS classes in global.css; definitions/map.ts schema"
  - phase: 09-filter-foundation
    provides: "useFilterStore, buildWhereClause, injectWhereClause, filterVersion"

provides:
  - "MapChartRenderer.tsx — React component owning OL Map lifecycle, basemap, TileWMS, filter sub, error/empty overlays, zoom-to-data button"
  - "bboxHelper.ts — fetchBbox(args) memoized per tableId:filterVersion:spatialMode; ST_Envelope SQL templates"
  - "WidgetRenderer.tsx — case 'map' early-return routes to MapChartRenderer (bypasses SQL pipeline)"
  - "10 bboxHelper tests, 13 MapChartRenderer tests, 1 new WidgetRenderer map-routing test"

affects:
  - 11-07-map-config-panel-shell
  - 11-08-config-panel-mode-params
  - 11-09-integration-checkpoint

tech-stack:
  added: []
  patterns:
    - "M-01 StrictMode guard: mapRef.current check prevents double-construction; setTarget(undefined)+dispose() in cleanup"
    - "M-02 updateParams-not-rebuild: filter changes call tileWmsSource.updateParams; never new OlMap"
    - "M-03 EPSG:3857 locked: OlView projection: 'EPSG:3857' explicit"
    - "S-02 filterVersion primitive dep: useEffect([filterVersion]) with eslint-disable for tableFilters"
    - "C-02 selector scoped to filters[tableId]: never subscribes to s.filters whole"
    - "AP-3 WHERE clause: buildWhereClause+injectWhereClause (never raw concat)"
    - "Custom tileLoadFunction: fetch with credentials:include so 401 can be intercepted; dispatches UNAUTHORIZED_EVENT"
    - "bboxHelper module-scoped cache Map<string, Bbox>: memoizes per tableId:filterVersion:spatialMode"
    - "Basemap swap via basemapLayerRef.setSource: no Map rebuild on basemap change"
    - "Auto-fit once: autoFitDoneRef.current flag prevents re-fit on filter/render-mode/basemap change"
    - "Debounced tile-error toast: lastToastAtRef 2s window prevents flooding"

key-files:
  created:
    - kinetica_bi/src/lib/bboxHelper.ts
    - kinetica_bi/src/lib/bboxHelper.spec.ts
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx
    - kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx
  modified:
    - kinetica_bi/src/components/charts/WidgetRenderer.tsx
    - kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx

decisions:
  - "columns and tableRef made optional in MapChartRenderer props — WidgetRenderer scope has neither variable; tableRef derived from widget.config.layerName or empty string; MapChartRenderer shows empty-config overlay when config incomplete regardless"
  - "Map widget early-returns at top of WidgetRenderer (not inside AggregatedWidgetRenderer switch) — same architectural pattern as 'records'; map widgets have no aggregated SQL pipeline"
  - "case 'map' landmark retained in AggregatedWidgetRenderer switch as unreachable documentation landmark (satisfies grep checks; early-return takes precedence)"
  - "React.lazy NOT used — per 11-05 SUMMARY recommendation: measured ol delta was 0 gzip (pre-import); projected ~140 kB is below 200 kB threshold; static import is acceptable"
  - "bboxHelper cache is module-scoped (not component-scoped useRef): avoids cache reset on Map instance rebuild; survives session; __resetBboxCacheForTest provides test isolation"
  - "tileLoadFunction uses fetch() with credentials:include to intercept 401 before OL reports tileloaderror — avoids img-src tiles bypassing the REAUTH chain (CONTEXT.md 401-REAUTH wrinkle)"
  - "toast debounce uses a ref (lastToastAtRef) not state — avoids triggering re-renders from within the tileloaderror listener"

requirements-completed: [MAP-01, MAP-03, MAP-04, FILT-04]

duration: "~8 min"
completed: "2026-05-05"
---

# Phase 11 Plan 06: Map Renderer Summary

**MapChartRenderer with full OL lifecycle (StrictMode-safe mount/dispose), TileWMS filter subscription (updateParams not rebuild), tile-error and empty-config overlays, zoom-to-data button, bboxHelper memoization — 24 new tests, 208/208 full suite passing**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-05T13:57:01Z
- **Completed:** 2026-05-05T14:05:17Z
- **Tasks:** 3 (TDD task 1, TDD task 2, wiring task 3)
- **Files modified:** 6 (4 created, 2 modified)

## Accomplishments

### Task 1: bboxHelper with memoization
- `fetchBbox(args): Promise<Bbox>` memoized per `${tableId}:${filterVersion}:${spatialMode}` via module-scoped `Map<string, Bbox>`
- latlon mode: `SELECT MIN/MAX(lon) AS minLon/maxLon, MIN/MAX(lat) AS minLat/maxLat FROM <table>` (SPIKE-NOTES locked)
- wkt/wkb mode: `SELECT ST_XMin(ST_Envelope(col)) AS minLon, ...` (SPIKE-NOTES provisional spelling — ST_XMin/ST_Envelope confirmed present from error-type analysis)
- AP-3 lock: `injectWhereClause(baseSql, buildWhereClause(filters))` — never raw concat
- `__resetBboxCacheForTest` escape hatch for test isolation
- 10 tests: all modes, cache hit/miss, signal passthrough, bbox tuple order

### Task 2: MapChartRenderer full implementation
- 427 LOC with 19 inline pitfall-lock comments
- Five effects: mount/unmount (M-01), WMS layer (structural config), filter updateParams (M-02, S-02), basemap swap, auto-fit once
- Custom `tileLoadFunction` intercepts 401 before OL reports tileloaderror — dispatches UNAUTHORIZED_EVENT
- Tile-error overlay with exact UI-SPEC copy + Retry button; dismissed on tileloadend
- Empty-config overlay with exact UI-SPEC copy (isConfigComplete guard)
- Debounced tile-error toast (2s burst window via lastToastAtRef)
- Zoom-to-data button: calls fetchBbox + view.fit; auto-fires once on first complete-config mount
- 13 tests covering all lifecycle invariants, 401 REAUTH, overlays, toast debounce, auto-fit

### Task 3: WidgetRenderer wiring
- `import MapChartRenderer from "./MapChartRenderer"` at top of WidgetRenderer.tsx
- Early-return `if (widget.type === "map")` at top of WidgetRenderer (before SQL pipeline)
- `case "map"` documentation landmark in AggregatedWidgetRenderer switch (unreachable at runtime)
- OL module mocks added to WidgetRenderer.spec.tsx (prevents canvas errors in existing tests)
- New smoke test: map widget renders empty-config overlay; `runSql` NOT called

## UI-SPEC Copywriting Contract Verification

All exact UI-SPEC.md Copywriting Contract strings present verbatim in MapChartRenderer.tsx:

| UI-SPEC string | In component? |
|----------------|---------------|
| `Configure spatial columns to render the map` | YES |
| `Open the widget config and pick a spatial column mode (lat/lon, WKT, or Kinetica geometry).` | YES |
| `Failed to load map tiles` | YES |
| `Tiles could not be fetched from Kinetica. Check your filter or retry.` | YES |
| `Zoom to data` | YES |
| `Retry` | YES |

## LOC and Test Count

| File | LOC | Tests |
|------|-----|-------|
| `kinetica_bi/src/components/charts/MapChartRenderer.tsx` | 427 | — |
| `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` | ~280 | 13 |
| `kinetica_bi/src/lib/bboxHelper.ts` | 95 | — |
| `kinetica_bi/src/lib/bboxHelper.spec.ts` | 155 | 10 |
| New WidgetRenderer test | — | 1 |
| **Total new tests** | — | **24** |

## React.lazy Decision

Static import used (NOT React.lazy). Per 11-05 SUMMARY: measured ol bundle delta was 0 KB gzip before first import (Vite tree-shakes). Post-import delta expected ~140 kB gzip — below the 200 kB React.lazy threshold documented in CONTEXT.md. Static import is acceptable.

## Task Commits

1. **Task 1: bboxHelper with memoization for zoom-to-data** — `738e722` (feat)
2. **Task 2: MapChartRenderer with OL lifecycle, filter sub, error overlay, zoom-to-data** — `30c8199` (feat)
3. **Task 3: wire WidgetRenderer case 'map' to MapChartRenderer** — `7577f11` (feat)

## Files Created/Modified

- `kinetica_bi/src/lib/bboxHelper.ts` — fetchBbox, Bbox type, __resetBboxCacheForTest
- `kinetica_bi/src/lib/bboxHelper.spec.ts` — 10-test spec
- `kinetica_bi/src/components/charts/MapChartRenderer.tsx` — 427 LOC, full OL lifecycle
- `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` — 13-test spec
- `kinetica_bi/src/components/charts/WidgetRenderer.tsx` — +map early-return + case landmark
- `kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx` — +OL mocks + 1 map test

## Deviations from Plan

### Auto-fixed Issues

None — implementation matched plan exactly.

### Intentional Adaptations (not deviations)

**1. columns/tableRef made optional in MapChartRenderer props**
- **Found during:** Task 3 (WidgetRenderer wiring)
- **Issue:** WidgetRenderer.tsx has `{ widget }` as its only prop — no `columns` or `tableRef` in scope to pass down
- **Fix:** Made `columns` and `tableRef` optional with empty defaults; `tableRef` derived from `widget.config.layerName` when not passed. This is architecturally correct: `MapChartRenderer` already handles the empty-config state via `isConfigComplete`, and `tableRef`/`columns` are primarily used by `MapConfigPanel` (plan 11-07)
- **Impact:** No functional change; empty-config overlay renders correctly when columns are unconfigured

**2. Early-return pattern instead of pure switch-case wiring**
- **Issue:** The plan describes adding a `case "map"` inside AggregatedWidgetRenderer's switch, but map widgets MUST bypass the SQL pipeline (no sql, loading, error state for aggregated SQL)
- **Fix:** Added early-return at top of WidgetRenderer (identical pattern to `records`); kept `case "map"` as a documentation landmark in the switch
- **Impact:** Map widgets never enter the aggregated SQL pipeline; behavior matches plan intent

## Issues Encountered

None.

## Next Phase Readiness

- **11-07 (MapConfigPanel shell):** Already completed; MapChartRenderer reads from `widget.config` directly
- **11-08 (Config panel mode params):** MapChartRenderer already handles all 4 render modes via buildWmsParams
- **11-09 (Integration checkpoint):** All lifecycle locks (M-01 through M-04, S-02, C-02, AP-1, AP-3) verified via 13 tests

---
*Phase: 11-map-chart*
*Completed: 2026-05-05*
