/**
 * Phase 111 (MAPVIEW-V121-01/04): DISPLAY-ONLY formatting for a map's view.
 *
 * OL holds the view centre in EPSG:3857 (metres). 111-CONTEXT.md locks the readout to
 * human-readable degrees with hemisphere letters ("40.71°N, 74.01°W") so a designer can
 * tell at a glance whether they framed New York or the Atlantic — the config modal's
 * opaque overlay hides the map itself.
 *
 * DISPLAY ONLY. The value PERSISTED in config.defaultView stays EPSG:3857 with the exact
 * unrounded fractional zoom (111-CONTEXT.md lock) — never round-trip a stored centre
 * through these functions.
 */

import { transform } from "ol/proj";

/** "40.71°N, 74.01°W" — 2dp, hemisphere letters instead of signs. Input is EPSG:3857 [x, y]. */
export function formatLatLon(centerEpsg3857: [number, number]): string {
  const [lon, lat] = transform(centerEpsg3857, "EPSG:3857", "EPSG:4326") as [number, number];
  const latHemi = lat >= 0 ? "N" : "S";
  const lonHemi = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(2)}°${latHemi}, ${Math.abs(lon).toFixed(2)}°${lonHemi}`;
}

/** "12.4" — 1dp. The STORED zoom stays exact; only this readout is rounded. */
export function formatZoom(zoom: number): string {
  return zoom.toFixed(1);
}
