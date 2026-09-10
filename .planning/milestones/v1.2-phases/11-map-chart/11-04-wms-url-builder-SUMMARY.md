---
phase: 11-map-chart
plan: 04
subsystem: ui
tags: [kinetica, wms, openlayers, map, typescript, tdd, vitest]

requires:
  - phase: 11-01-wms-spike-and-cache-control
    provides: "11-SPIKE-NOTES.md with locked param names: X_ATTR/Y_ATTR/GEO_ATTR/QUERY/EPSG:3857"
  - phase: 11-02-column-types
    provides: "SpatialMode type (latlon | wkt | wkb) from columnTypes.ts"
  - phase: 09-filter-foundation
    provides: "filterVersion from useFilterStore — cache-buster approach for WMS tile invalidation"

provides:
  - "buildWmsParams(config, filterVersion, whereClause): Record<string, string> — single sanctioned WMS param builder"
  - "MapWidgetConfig type — full config shape for all 4 render modes x 3 spatial modes"
  - "RenderMode and ClassbreakBreak types"
  - "SpatialMode re-export for downstream convenience import in MapChartRenderer"
  - "43-test spec covering all renderMode x spatialMode combos, filter presence/absence, cache-buster"

affects:
  - 11-06-map-chart-renderer
  - 11-07-map-config-panel

tech-stack:
  added: []
  patterns:
    - "Spike-locked constants at top of file: SPIKE-NOTES.md is the source of truth for param names — never guess"
    - "POINTOPACITY as separate param (not RRGGBBAA suffix on POINTCOLOR): cleaner UX, both accepted by Kinetica"
    - "WKT and WKB share GEO_ATTR param: Kinetica detects geometry encoding from column metadata type"
    - "QUERY omitted (not empty-string) when whereClause is blank: AP-3 lock — FILTER_PARAM never emitted with empty value"
    - "_v=String(filterVersion) always emitted unconditionally: M-02 cache-buster lock"
    - "makeConfig() helper in spec: sane base config + targeted overrides — keeps individual tests focused"

key-files:
  created:
    - kinetica_bi/src/lib/wmsUrlBuilder.ts
    - kinetica_bi/src/lib/wmsUrlBuilder.spec.ts

key-decisions:
  - "X_ATTR/Y_ATTR/GEO_ATTR/QUERY/EPSG:3857 constants copied verbatim from 11-SPIKE-NOTES.md — no guessing, no training-data inference"
  - "POINTOPACITY: emitted as separate param string '0'-'100'; POINTCOLOR stays 6-digit RRGGBB (Q6 resolution from spike)"
  - "WKT and WKB both emit GEO_ATTR (PITFALL M-04 lock): Kinetica auto-detects the column encoding; param name is identical for both"
  - "_v always emitted even when filterVersion is 0 (never conditional): M-02 lock"
  - "QUERY omitted entirely (not set to empty string) when whereClause is empty/whitespace: AP-3 lock, FILT-04"
  - "43 tests written (spec requires >=18): full coverage of all 4 renderModes x 3 spatialModes + edge cases (undefined columns, empty classbreaks, opacity boundary values)"
  - "SpatialMode re-exported from wmsUrlBuilder.ts for MapChartRenderer convenience (avoids double import from columnTypes)"

requirements-completed: [MAP-01, MAP-02, FILT-04]

duration: 3min
completed: 2026-05-05
---

# Phase 11 Plan 04: WMS URL Builder Summary

**Pure buildWmsParams function with spike-locked X_ATTR/Y_ATTR/GEO_ATTR/QUERY constants, covering all 4 render modes x 3 spatial modes via 43-test TDD spec**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-05-05T13:47:08Z
- **Completed:** 2026-05-05T13:50:00Z
- **Tasks:** 2 (TDD RED + GREEN)
- **Files modified:** 2 created

## Accomplishments
- `buildWmsParams(config, filterVersion, whereClause)` ships as the single sanctioned WMS param interpolation path (mirrors Phase 9's buildWhereClause AP-3 lock for WMS)
- All 4 render modes (raster, heatmap, classbreak, contour) produce distinct STYLES values and mode-specific params
- All 3 spatial modes (latlon, wkt, wkb) correctly emit X_ATTR/Y_ATTR for latlon and GEO_ATTR for wkt+wkb (PITFALL M-04: same param name, Kinetica detects type from column metadata)
- POINTOPACITY emitted as separate string param; POINTCOLOR stays 6-digit RRGGBB (Q6 resolution from 11-SPIKE-NOTES.md)
- M-02 cache-buster: `_v: String(filterVersion)` always emitted unconditionally
- AP-3 / FILT-04: QUERY omitted entirely (never set to "") when whereClause is empty or whitespace-only
- 43/43 tests pass; 165/165 full suite passing (no regressions)

## Locked Param-Name Constants

From `.planning/phases/11-map-chart/11-SPIKE-NOTES.md` (HIGH confidence — verified against deployed Kinetica):

| Constant | Value | Notes |
|----------|-------|-------|
| X_COLUMN_PARAM | `X_ATTR` | Lon column (X axis = longitude). X_COLUMN_NAME is WRONG (XML error). |
| Y_COLUMN_PARAM | `Y_ATTR` | Lat column (Y axis = latitude). Y_COLUMN_NAME is WRONG. |
| GEOMETRY_COLUMN_PARAM | `GEO_ATTR` | WKT or WKB column. Same param for both (PITFALL M-04). |
| FILTER_PARAM | `QUERY` | Server-side filter. Accepted without error; tile effectiveness TBD. |
| SRS_VALUE | `EPSG:3857` | Web Mercator. Confirmed accepted (PITFALL M-03 lock). |

STYLES values: `raster`, `heatmap`, `classbreak`, `contour` (classbreak/contour return HTTP 200 despite absence from GetCapabilities XML).

## POINTOPACITY Treatment

Q6 from 11-SPIKE-NOTES.md: both RRGGBBAA suffix on POINTCOLOR and separate `POINTOPACITY=<0-100>` param are accepted by Kinetica WMS.

**Decision:** Use separate `POINTOPACITY` param. POINTCOLOR remains 6-digit RRGGBB. Rationale: cleaner UX — color picker controls POINTCOLOR independently of the opacity slider without hex concatenation logic in UI components.

## Task Commits

1. **Task 1: TDD RED — failing spec for buildWmsParams** - `224ed23` (test)
2. **Task 2: TDD GREEN — implement buildWmsParams** - `28fe4cd` (feat)

## Files Created/Modified
- `kinetica_bi/src/lib/wmsUrlBuilder.ts` — Pure builder function with spike-locked constants, MapWidgetConfig type, RenderMode/ClassbreakBreak types, SpatialMode re-export
- `kinetica_bi/src/lib/wmsUrlBuilder.spec.ts` — 43-test spec covering all renderMode x spatialMode combos, filter presence/absence, cache-buster, POINTOPACITY boundary values

## Decisions Made
- Spike-locked constants copied verbatim from 11-SPIKE-NOTES.md — no guessing from training data
- POINTOPACITY as separate param (not RRGGBBAA suffix) per Q6 resolution in spike
- WKT and WKB both emit GEO_ATTR (PITFALL M-04: Kinetica detects encoding from column metadata)
- _v always emitted even for filterVersion=0 (M-02 lock)
- QUERY omitted entirely when whereClause is empty (AP-3 + FILT-04)
- 43 tests (vs plan's >=18 minimum): full coverage of all combos + undefined-column edge cases + classbreak empty/undefined + opacity 0/50/100 boundary values

## Deviations from Plan

None — plan executed exactly as written. SPIKE-NOTES.md was not BLOCKED; all param names were available. POINTOPACITY treatment confirmed in spec per Q6 resolution.

One note: the plan's `<interfaces>` section described POINTOPACITY via an `opacityToAlphaHex` helper for RRGGBBAA suffix. Since SPIKE-NOTES.md explicitly resolves Q6 in favor of separate POINTOPACITY param, the alpha-suffix approach was NOT implemented. The spec asserts the separate-param behavior and the implementation matches. This is not a deviation — the plan explicitly instructs the executor to follow SPIKE-NOTES.md for Q6.

## Issues Encountered

None.

## User Setup Required

None — pure function module, no external service configuration required.

## Next Phase Readiness

- `buildWmsParams` is ready for Wave 3 consumption by `MapChartRenderer.tsx` (11-06)
- Import pattern: `import { buildWmsParams, type MapWidgetConfig } from "../../lib/wmsUrlBuilder"`
- Call site: inside the filter-subscription `useEffect` to construct `updateParams()` payload for OpenLayers TileWMS source
- `SpatialMode` re-exported: MapChartRenderer can import both from a single import statement
- QUERY filter param effectiveness remains unvalidated end-to-end (tile output identical with/without filter in spike against dense demo.nyctaxi lat/lon data) — validate in 11-06/11-07 integration testing against a table with geographically clustered data

---
*Phase: 11-map-chart*
*Completed: 2026-05-05*
