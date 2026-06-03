/**
 * Longitude normalization for OpenLayers multi-world maps.
 *
 * OL renders repeated copies of the world when you pan across the antimeridian
 * (date line); a click in a wrapped copy yields a longitude that grows past ±180
 * (e.g. 200, 540, -260) rather than the true location. Spatial queries against
 * Kinetica (GEODIST / STXY_DISTANCE) expect longitudes in [-180, 180), matching
 * the stored data — so the clicked longitude must be wrapped first or the query
 * finds nothing near the date line.
 *
 * Latitude does NOT wrap (OL clamps vertically), so only longitude needs this.
 */
export function wrapLongitude(lon: number): number {
  if (!Number.isFinite(lon)) return lon;
  // Fast path: already in [-180, 180) — return verbatim to avoid modulo FP drift
  // (e.g. -122.4 must stay -122.4, not -122.39999…). Only wrapped (out-of-range)
  // date-line clicks take the modulo, where sub-degree precision is irrelevant.
  if (lon >= -180 && lon < 180) return lon;
  return (((lon + 180) % 360) + 360) % 360 - 180;
}
