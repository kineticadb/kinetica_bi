/**
 * Server-side conversion of click radius (pixels) to ground distance.
 *
 * Plan 18-03's `POST /api/info/query` endpoint receives the user's
 * `radiusPx` plus the map's current viewport (`mapBbox`, `mapWidthPx`,
 * `mapHeightPx`) and the click latitude (`clickLat`). The server computes
 * the ground-distance threshold here so the SQL WHERE clause can use it
 * directly — avoiding any client-side trigonometry duplication
 * (SPATIAL-V14-05 architecture lock; see PROJECT.md Key Decisions).
 *
 * Two helpers exported:
 *
 *   - `pxToGroundDistance(...)` — returns METERS. Consumed by
 *     `buildLatLonQuery` (GEODIST returns meters).
 *   - `pxToGroundDegrees(...)` — returns DEGREES (longitude-equivalent).
 *     Consumed by `buildWktQuery` (STXY_DISTANCE returns the same SRS
 *     units as the geometry's storage SRS, typically degrees for
 *     EPSG:4326). Provided as a sibling so Plan 18-03 can pick the right
 *     helper per spatialMode without divide-then-multiply round-tripping.
 *
 * Limitation — small-bbox approximation:
 *   The longitude-degree-to-meter ratio is approximated as
 *   `111_320 * cos(clickLat)`. This is accurate for typical dashboard
 *   zoom levels (city / neighborhood / building) but degrades at world
 *   view (where the bbox spans many degrees of latitude and the cos
 *   factor varies meaningfully across it). Acceptable for v1.4 use
 *   cases per CONTEXT.md.
 *
 * Pure module — zero imports beyond the Node stdlib (`Math.cos`, `Math.PI`,
 * `Math.max` are V8 built-ins). Mirrors `whereClause.ts` + `viewNaming.ts`.
 */

/**
 * Bounding box in EPSG:4326-style decimal degrees: `[minLon, minLat, maxLon, maxLat]`.
 * The map widget supplies its current Web Mercator viewport in this shape.
 */
export type MapBbox = readonly [number, number, number, number];

/**
 * Convert a click radius in pixels to a ground-distance threshold in METERS.
 *
 * Used by `buildLatLonQuery` because GEODIST returns meters per Kinetica docs.
 *
 * Math:
 *   1. radiusDeg = (radiusPx / mapWidthPx) * (mapBbox.maxLon - mapBbox.minLon)
 *   2. metersPerDegLon = 111_320 * cos(clickLat * π / 180)
 *   3. radiusMeters = radiusDeg * metersPerDegLon
 *
 * Why `clickLat` is required:
 *   Longitude degrees compress toward the poles by a factor of cos(latitude).
 *   Ignoring this would over-estimate ground distance at high latitudes
 *   (the GEODIST radius would be too generous). 1 degree of latitude is a
 *   constant ~111_320 m; 1 degree of longitude varies from ~111_320 m at
 *   the equator down to 0 at the poles.
 *
 * Why `mapHeightPx` is currently unused:
 *   The longitude-aspect dominates the radius math (we compute the radius
 *   as a fraction of the bbox's longitude span, then convert to meters).
 *   The parameter is accepted for forward-compat with a future "ellipse
 *   radius" mode (v2) that would use vertical pixels for the latitude
 *   component. Listed in the signature now so Plan 18-03's request-payload
 *   contract stays stable across milestones.
 *
 * Degenerate cases:
 *   - radiusPx === 0 → returns 0 (zero pixels = zero ground distance).
 *   - mapWidthPx === 0 would yield Infinity; the route handler validates
 *     `mapWidthPx > 0` upstream so we don't double-handle here.
 *   - Output is floored at 0 via Math.max to defend against tiny negative
 *     floating-point values from edge-case bbox math.
 */
export function pxToGroundDistance(
  radiusPx: number,
  mapBbox: MapBbox,
  mapWidthPx: number,
  // mapHeightPx is currently unused (longitude-aspect dominates radius math).
  // Parameter accepted for forward-compat with future v2 ellipse-radius mode.
  // Underscore prefix signals intentional non-use under TS strict mode.
  _mapHeightPx: number,
  clickLat: number,
): number {
  if (radiusPx === 0) return 0;
  const bboxWidthDeg = mapBbox[2] - mapBbox[0];
  const radiusDeg = (radiusPx / mapWidthPx) * bboxWidthDeg;
  const latRad = (clickLat * Math.PI) / 180;
  const metersPerDegLon = 111_320 * Math.cos(latRad);
  const radiusMeters = radiusDeg * metersPerDegLon;
  return Math.max(0, radiusMeters);
}

/**
 * Convert a click radius in pixels to a ground-distance threshold in DEGREES
 * (longitude-equivalent units of the map's bbox SRS).
 *
 * Used by `buildWktQuery` because STXY_DISTANCE returns the same SRS units
 * as the WKT geometry's storage SRS — typically degrees for EPSG:4326. By
 * staying in degrees we avoid the `divide-by-cos(lat)` round trip that would
 * be required if we passed meters into a degree-comparing distance function.
 *
 * Math:
 *   radiusDeg = (radiusPx / mapWidthPx) * (mapBbox.maxLon - mapBbox.minLon)
 *
 * No latitude correction is applied here because we want the threshold in
 * the same longitude-degree units as the map bbox itself. The geometry
 * column's SRS handles the lon/lat asymmetry inside Kinetica.
 *
 * Degenerate cases:
 *   - radiusPx === 0 → returns 0.
 *   - Output floored at 0.
 */
export function pxToGroundDegrees(
  radiusPx: number,
  mapBbox: MapBbox,
  mapWidthPx: number,
): number {
  if (radiusPx === 0) return 0;
  const bboxWidthDeg = mapBbox[2] - mapBbox[0];
  const radiusDeg = (radiusPx / mapWidthPx) * bboxWidthDeg;
  return Math.max(0, radiusDeg);
}
