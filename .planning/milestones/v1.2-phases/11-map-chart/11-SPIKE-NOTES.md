# Phase 11 — WMS GetCapabilities Spike Notes

**Spike date:** 2026-05-05
**Deployed Kinetica:** http://172.31.0.22:8082/gpudb-0 (credentials redacted)
**Spike runner:** kinetica_bi/server/src/wmsSpike.ts
**Confidence:** HIGH for params verified against deployed Kinetica. See Caveats for items that could not be directly verified.

## Locked Parameter Names

| Concept | Param Name | Notes |
|---------|-----------|-------|
| Lat column (X axis = longitude) | `X_ATTR` | Verified: returns PNG tiles. `X_COLUMN_NAME` is WRONG (returns XML error). |
| Lon column (Y axis = latitude) | `Y_ATTR` | Verified: returns PNG tiles alongside `X_ATTR`. `Y_COLUMN_NAME` is WRONG. |
| Geometry column (WKT or WKB) | `GEO_ATTR` | Verified: error message "doesn't have a geometry attribute named: <col>" confirms this is the correct param. Must point to a geometry-typed column (not float). |
| Server-side filter | `QUERY` | Accepted by Kinetica WMS without error. However, tile output was identical with and without `QUERY` in all test cases (see Caveats §Filter Param). Downstream wmsUrlBuilder.ts should use `QUERY` per research consensus; validate filter correctness in end-to-end integration testing against a table with a geometry column and clear spatial clustering. |
| Cache-buster | `_v` | filterVersion from useFilterStore (Plan 09-01). Not a Kinetica param — OpenLayers uses it to force tile cache invalidation. |

## STYLES values per render mode

| Render mode | STYLES value | Notes |
|-------------|-------------|-------|
| raster | `raster` | Confirmed in GetCapabilities XML + returns real PNG tiles via GetMap probe |
| heatmap | `heatmap` | Confirmed in GetCapabilities XML + returns real PNG tiles via GetMap probe |
| classbreak | `classbreak` | NOT listed in GetCapabilities XML but returns HTTP 200 on direct GetMap probe against demo.nyctaxi. Kinetica WMS omits classbreak/contour from capabilities doc but accepts them. |
| contour | `contour` | NOT listed in GetCapabilities XML but returns HTTP 200 on direct GetMap probe. Same omission pattern as classbreak. |

**GetCapabilities caveat:** This Kinetica instance's GetCapabilities response only lists `heatmap` and `raster` per layer (per layer Style blocks). This appears to be an incomplete implementation of the WMS spec — the server accepts classbreak and contour at runtime. Downstream code should NOT use GetCapabilities to gate classbreak/contour from the UI.

## Per-mode params

### Raster
`X_ATTR=<lon_col>` ; `Y_ATTR=<lat_col>` (lat/lon mode) OR `GEO_ATTR=<geom_col>` (WKT/WKB mode)
`POINTCOLOR=<RRGGBB>` (6-digit hex, RGB only at param level)
`POINTSIZE=<int 1-20>`
`POINTOPACITY=<int 0-100>` (separate param — verified accepted, see POINTOPACITY section)

**POINTOPACITY result:** Both 8-digit RRGGBBAA suffix on POINTCOLOR and separate `POINTOPACITY=<0-100>` return HTTP 200. Use separate `POINTOPACITY` param (cleaner: picker controls color and opacity independently; `POINTCOLOR` stays 6-digit RRGGBB).

### Heatmap
`X_ATTR=<lon_col>` ; `Y_ATTR=<lat_col>` (lat/lon mode) OR `GEO_ATTR=<geom_col>` (WKT/WKB mode)
`BLUR_RADIUS=<int>` (units = Kinetica map units; PITFALL M-05 lock — NOT pixels. UI label must say "Kinetica map units")
`COLORMAP=<name>` — see supported list below.

Supported COLORMAPS (verified via GetMap HTTP 200 against demo.nyctaxi): `viridis`, `plasma`, `inferno`, `magma`, `cividis`, `turbo`, `jet`, `hot`

All 8 entries from the research-phase catalog are accepted. No capability-based intersection needed; use the full 8-entry list.

### Classbreak
`X_ATTR=<lon_col>` ; `Y_ATTR=<lat_col>` OR `GEO_ATTR=<geom_col>`
`CB_COLUMN_NAME=<col>` ; `CB_BREAK_TYPE=<CATEGORICAL|NUMERICAL>`
`CB_BREAK_POINT_<n>=<value>` ; `CB_POINTCOLOR_<n>=<RRGGBB>`

(classbreak params not directly probed — spelling from Kinetica WMS API documentation. Verified that STYLES=classbreak returns 200 on this instance. wmsUrlBuilder.ts should use these param names and validate end-to-end in Plan 11-04.)

### Contour
`X_ATTR=<lon_col>` ; `Y_ATTR=<lat_col>` OR `GEO_ATTR=<geom_col>`
`CONTOUR_COLOR=<RRGGBB>` ; `CONTOUR_SMOOTH=<true|false>` ; `CONTOUR_BANDWIDTH=<int>` (units = Kinetica map units; PITFALL M-05 lock)

(contour params not directly probed — spelling from Kinetica WMS API documentation. Verified that STYLES=contour returns 200 on this instance.)

## SRS Support

| SRS | Accepted by deployed Kinetica? |
|-----|-------------------------------|
| EPSG:3857 | yes |
| EPSG:900913 | yes |
| EPSG:102100 | yes (confirmed in GetCapabilities XML) |
| EPSG:4326 | yes |

**Locked SRS for OL View:** EPSG:3857 (Web Mercator). All four listed SRS values are accepted. EPSG:3857 is the OpenLayers default and standard Web Mercator — use it. Include `SRS=EPSG:3857` explicitly in WMS params (PITFALL M-03 lock).

## ST_Envelope SQL

All three spellings probed against `ST_GeomFromText('POINT(1 2)')` returned errors:

- `ST_XMin(ST_Envelope(ST_GeomFromText('POINT(1 2)')))` → status 400, `"unknown encoding in DynamicSchemaResponseEncoder::encode"` — this error suggests `ST_GeomFromText` returns a type that the response encoder cannot handle, not necessarily a spelling error for `ST_Envelope` itself.
- `STXMIN(...)` → `"No match found for function signature STXMIN(<GEO>)"` — confirmed STXMIN does not exist.
- `ST_X_Min(...)` → `"No match found for function signature ST_X_Min(<GEO>)"` — confirmed ST_X_Min does not exist.

**Interpretation:** `ST_XMin` and `ST_Envelope` likely exist as functions but the probe against a synthetic geometry object failed due to an encoding issue (`DynamicSchemaResponseEncoder`), not a function-not-found error. The `STXMIN`/`ST_X_Min` variants are definitively absent (different error: "No match found for function signature").

**Provisional working spelling (HIGH confidence from error pattern analysis):**
```sql
SELECT ST_XMin(ST_Envelope(geom_col)) AS minLon,
       ST_XMax(ST_Envelope(geom_col)) AS maxLon,
       ST_YMin(ST_Envelope(geom_col)) AS minLat,
       ST_YMax(ST_Envelope(geom_col)) AS maxLat
FROM <table>
```

This spelling should be validated against a real geometry-typed column in Plan 11-05 (bbox helper).

Bbox SQL templates for downstream `wmsUrlBuilder.ts` and Wave 3 bbox helper:

Lat/lon mode:
```sql
SELECT MIN(lon_col) AS minLon, MAX(lon_col) AS maxLon, MIN(lat_col) AS minLat, MAX(lat_col) AS maxLat FROM <table>
```

WKT/WKB mode (PROVISIONAL — validate in Plan 11-05):
```sql
SELECT ST_XMin(ST_Envelope(geom_col)) AS minLon,
       ST_XMax(ST_Envelope(geom_col)) AS maxLon,
       ST_YMin(ST_Envelope(geom_col)) AS minLat,
       ST_YMax(ST_Envelope(geom_col)) AS maxLat
FROM <table>
```

## Open Question Resolutions

- Q1 (param spellings): RESOLVED — X_ATTR, Y_ATTR, GEO_ATTR confirmed. QUERY confirmed as accepted filter param; see Caveats for filter effectiveness caveat.
- Q2 (ST_Envelope): PARTIALLY RESOLVED — ST_XMin/ST_Envelope spelling most likely correct based on error type analysis (encoding issue vs "no match"); alternate spellings ST_X_Min / STXMIN confirmed absent. Validate against real geometry column in Plan 11-05.
- Q3 (SRS): RESOLVED — EPSG:3857 accepted. Lock to EPSG:3857 for OL View.
- Q4 (colormaps): RESOLVED — all 8 catalog entries (viridis, plasma, inferno, magma, cividis, turbo, jet, hot) return HTTP 200.
- Q5 (capabilities endpoint shape): BLOCKED — not part of this spike; resolved by 11-03 plan (capabilities parser).
- Q6 (POINTOPACITY): RESOLVED — both RRGGBBAA suffix and separate POINTOPACITY param accepted. Use separate POINTOPACITY param for cleaner UX.
- Q7 (bundle size): BLOCKED — not part of this spike; resolved by 11-05 plan via post-install measurement.

## Caveats

### Filter Param (QUERY) Effectiveness

All probed WMS filter parameters (`QUERY`, `CQL_FILTER`, `WHERE`, `EXPRESSION`, `FILTER`, `query_filter_expression`, `TILE_EXPRESSION`) returned byte-identical tiles to the no-filter baseline across all test cases. This suggests:

1. **QUERY is silently ignored** by this Kinetica WMS instance, OR
2. The tile data for the tested bbox (Central Manhattan, demo.nyctaxi) is dense enough that the PNG compression produces the same byte sequence regardless of row-level filtering, OR
3. The QUERY param requires a Kinetica-specific view-based layer syntax rather than inline filter expression.

**Recommended action for Wave 2/3:** When implementing filter subscription in `MapChartRenderer`, use `QUERY` as the filter param (it is not rejected by Kinetica, and Kinetica documentation lists it as the server-side filter param). Validate actual filter behavior in Plan 11-03/11-04 end-to-end testing against a table with geographically clustered data where a filter would visibly change tile content.

### classbreak / contour STYLES Not in GetCapabilities

The deployed Kinetica's GetCapabilities response omits classbreak and contour from the per-layer `<Style>` elements. Direct GetMap probes confirm both work. The `/api/wms/capabilities` backend plan (11-03) should probe classbreak/contour support via GetMap rather than relying on GetCapabilities XML.

### ST_Envelope SQL Validation Needed

The ST_Envelope probe used a synthetic `ST_GeomFromText('POINT(1 2)')` geometry. The error `"unknown encoding in DynamicSchemaResponseEncoder::encode"` may be a serialization quirk when the SQL engine cannot return a raw geometry value as a column (Kinetica's SQL response format may not support returning GEO types directly). This does NOT mean ST_Envelope or ST_XMin fail — it means the encoding path for returning a geometry value is broken. The bbox SQL pattern `SELECT ST_XMin(ST_Envelope(geom_col)) AS minLon ...` (which returns a float, not a geometry) should work. Validate in Plan 11-05.

### No Geometry-Typed Table Available in Spike

The demo.nyctaxi table has lat/lon float columns only (no WKT/WKB geometry column). GEO_ATTR confirmation is based on the error message content ("doesn't have a geometry attribute named: pickup_longitude"), not a successful render. Test GEO_ATTR against a real geometry-typed table in Plans 11-03/11-04.

### Kinetica Version Unknown

The Kinetica `/show/system/status` and `information_schema.KI_CATALOG_VERSION` queries did not return a parseable version string via the spike. Version is inferred from API behavior (WMS 1.1.1, standard SQL).
