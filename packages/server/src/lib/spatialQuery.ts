/**
 * Server-side SQL builders for the v1.4 Map Info Popup spatial-proximity query.
 *
 * Three builders, one per spatial mode (mirrors v1.4 Phase 18 architecture):
 *
 *   - buildLatLonQuery (SPATIAL-V14-01): GEODIST(lonCol, latCol, clickLon, clickLat).
 *     Returns ground meters. radiusGroundDistance MUST be in meters.
 *   - buildWktQuery (SPATIAL-V14-02): STXY_DISTANCE(wktCol, clickLon, clickLat).
 *     Returns SRS-units of the WKT geometry's storage SRS (typically degrees for
 *     EPSG:4326). radiusGroundDistance MUST be in those same units.
 *     LOCKED DECISION (CONTEXT.md): NO ST_GEOMFROMTEXT wrap — passes raw click
 *     coordinates directly to skip per-query WKT parsing.
 *   - buildWkbQuery (SPATIAL-V14-03 — DEFERRED): throws WkbDeferredError.
 *     Plan 18-01 spike landed NONE_ESCALATE → TECH_DEBT (TD-V14-WKB-SPIKE) on
 *     2026-05-08. Operator has no WKB-binary column reachable; the spike could
 *     not characterize the WKB code path. Function signature stays exported for
 *     type stability so Plan 18-03 can route by spatialMode without conditional
 *     imports (the route handler returns HTTP 501 BEFORE invoking this stub).
 *     See: .planning/phases/18-spatial-spike-and-endpoint/18-SPIKE-NOTES.md ## Decision.
 *
 * Trust boundary on `schema`, `table`, and column-name fields (`lonCol`, `latCol`,
 * `wktCol`, `wkbCol`): names are interpolated DIRECTLY into the SQL without
 * quoting or escaping. They originate from server-side table metadata
 * (admin-only sources), NOT from arbitrary user input — so injection risk is
 * bounded by admin-only metadata routes. Mirrors the equivalent boundary
 * documented in `whereClause.ts`.
 *
 * Numeric click coordinates and radius are typed as `number` in
 * SpatialQueryArgs; the route handler in Plan 18-03 validates `typeof === "number"`
 * before calling, so no string escaping is required for those values.
 *
 * Pure module — zero imports beyond the Node stdlib (none used here).
 * No Express, db, or kinetica.ts dependencies — keeps the unit-test surface
 * minimal and reusable across phases. Mirrors `whereClause.ts` + `viewNaming.ts`.
 */

/**
 * Spatial mode discriminant for the POST /api/info/query endpoint payload.
 * Each mode selects exactly one of the SQL builders below.
 *
 * `wkb` stays in the union despite the deferred buildWkbQuery — Plan 18-03
 * still validates the request shape and returns HTTP 501 for that mode (with
 * a body referencing TD-V14-WKB-SPIKE) without invoking the throwing stub.
 */
export type SpatialMode = "latlon" | "wkt" | "wkb";

/**
 * Optional spatial-column tuple. Exactly one variant is populated per request,
 * matched to the SpatialMode discriminant by the route handler upstream.
 *
 *   - spatialMode = "latlon" → lonCol + latCol both set
 *   - spatialMode = "wkt"    → wktCol set
 *   - spatialMode = "wkb"    → wkbCol set (validated, but builder throws)
 */
export type SpatialColumns = {
  lonCol?: string;
  latCol?: string;
  wktCol?: string;
  wkbCol?: string;
};

/**
 * Common argument shape for all three builders.
 *
 *   - schema/table: identifier names interpolated directly (admin-trusted boundary).
 *   - spatialColumns: see SpatialColumns above.
 *   - clickLon / clickLat: typed as `number`; route handler validates upstream.
 *   - radiusGroundDistance: pre-converted threshold value matching the distance
 *     expression's unit (meters for GEODIST; degrees-equivalent SRS units for
 *     STXY_DISTANCE). Plan 18-03 calls radiusConversion.pxToGroundDistance
 *     (or a degrees-variant) to produce this value.
 *   - page: 0-indexed; SQL emits OFFSET (page * 50) for SPATIAL-V14-04 pagination.
 */
export type SpatialQueryArgs = {
  schema: string;
  table: string;
  /**
   * Optional v1.3 filter view name (unqualified, per buildFilterViewName).
   * When provided and non-empty, builders emit `FROM <viewName>` so the
   * info-query is constrained to the same record set the WMS layer is
   * already showing. When undefined or empty, builders fall through to
   * `FROM <schema>.<table>` (Phase 18 default).
   */
  viewName?: string;
  spatialColumns: SpatialColumns;
  clickLon: number;
  clickLat: number;
  radiusGroundDistance: number;
  page: number;
};

/**
 * SPATIAL-V14-01 — Lat/Lon GEODIST builder.
 *
 * GEODIST returns ground distance in meters per Kinetica docs.
 * radiusGroundDistance MUST be in meters.
 */
export function buildLatLonQuery(args: SpatialQueryArgs): string {
  const fromTarget = args.viewName ? args.viewName : `${args.schema}.${args.table}`;
  const distExpr = `GEODIST(${args.spatialColumns.lonCol}, ${args.spatialColumns.latCol}, ${args.clickLon}, ${args.clickLat})`;
  return `SELECT * FROM ${fromTarget} WHERE ${distExpr} <= ${args.radiusGroundDistance} ORDER BY ${distExpr} ASC LIMIT 50 OFFSET ${args.page * 50}`;
}

/**
 * SPATIAL-V14-02 — WKT STXY_DISTANCE builder.
 *
 * LOCKED DECISION (CONTEXT.md): the click point is passed directly as raw
 * (x, y) coordinates — NO ST_GEOMFROMTEXT('POINT(...)') wrap. This avoids
 * per-query WKT parsing on every row. STXY_DISTANCE returns the same SRS
 * units as the WKT geometry's storage SRS (typically degrees for EPSG:4326),
 * so radiusGroundDistance MUST be in those same units (Plan 18-03 will
 * either expose a sibling `pxToGroundDegrees` helper in radiusConversion.ts
 * or convert the meters output back to degrees before calling this builder).
 */
export function buildWktQuery(args: SpatialQueryArgs): string {
  const fromTarget = args.viewName ? args.viewName : `${args.schema}.${args.table}`;
  const distExpr = `STXY_DISTANCE(${args.spatialColumns.wktCol}, ${args.clickLon}, ${args.clickLat})`;
  return `SELECT * FROM ${fromTarget} WHERE ${distExpr} <= ${args.radiusGroundDistance} ORDER BY ${distExpr} ASC LIMIT 50 OFFSET ${args.page * 50}`;
}

/**
 * SPATIAL-V14-03 — "WKB" mode (UI: "Kinetica geometry column") builder.
 *
 * Naming note (carried tech debt): this mode is internally labeled `wkb` for
 * historical reasons. The UI radio is "Kinetica geometry column" — Kinetica's
 * native GEOMETRY type, distinct from both a WKT-text column (`wkt` mode) and
 * a lat/lon-pair column (`latlon` mode). `wkbCol` is therefore the field that
 * carries the geometry column's name in this mode (not necessarily a column
 * that holds WKB-encoded bytes — confusingly, the column may even be named
 * "WKT" by the schema author). Rename to `geomCol` / `'geometry'` is a future
 * refactor (touches stored layer-config JSON; needs a migration).
 *
 * SQL template — **distinct** from buildWktQuery. STXY_DISTANCE accepts only
 * WKT-text columns; Kinetica returns
 *   "function: 'stxy_distance' has invalid argument list: geometry,decimal8,decimal8,..."
 * when invoked on a GEOMETRY column. Phase 18 SPIKE-NOTES Probe B confirmed
 * the correct form for GEOMETRY: `ST_DISTANCE(geom_col, ST_GEOMFROMTEXT('POINT(x y)'))`.
 * The ST_GEOMFROMTEXT call is a query-constant (parsed once, not per row).
 *
 * radiusGroundDistance MUST be in the same SRS units the geometry column
 * stores (typically degrees for EPSG:4326) — Plan 18-03 callers use
 * pxToGroundDegrees, same as the WKT path.
 */
export function buildWkbQuery(args: SpatialQueryArgs): string {
  const fromTarget = args.viewName ? args.viewName : `${args.schema}.${args.table}`;
  const clickPoint = `ST_GEOMFROMTEXT('POINT(${args.clickLon} ${args.clickLat})')`;
  const distExpr = `ST_DISTANCE(${args.spatialColumns.wkbCol}, ${clickPoint})`;
  return `SELECT * FROM ${fromTarget} WHERE ${distExpr} <= ${args.radiusGroundDistance} ORDER BY ${distExpr} ASC LIMIT 50 OFFSET ${args.page * 50}`;
}
