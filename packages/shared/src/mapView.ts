// Phase 142 UAT: a map's opening view computed from a lon/lat data extent. Pure, no I/O.
// Output is the Phase 111 `config.defaultView` shape: EPSG:3857 centre in metres + fractional zoom,
// consumed verbatim by the web's resolveInitialView (finite 2-number centre, zoom within 0..28).
import { z } from "zod";

const R = 6378137; // EPSG:3857 sphere radius (metres)
const TILE = 256;
const WORLD_M = 2 * Math.PI * R;
const MAX_LAT = 85.0511287798; // Web Mercator latitude limit

export const MAP_VIEW_MIN_ZOOM = 2;
export const MAP_VIEW_MAX_ZOOM = 16;
/** Zoom for a one-point (or near-zero) extent. */
export const MAP_VIEW_POINT_ZOOM = 12;
/** Used when the widget's pixel size is unknown. Conservative so the data always fits. */
export const MAP_VIEW_DEFAULT_VIEWPORT = { w: 900, h: 500 } as const;
/** The extent fills at most this fraction of each viewport side (~10% padding per edge). */
const FILL = 0.8;
/** Extents narrower than this (metres) in both directions count as one point. */
const POINT_EPS_M = 1;

export type LonLatBounds = { minLon: number; maxLon: number; minLat: number; maxLat: number };
export type MapDefaultView = { center: [number, number]; zoom: number };

/** Mirrors the web resolveInitialView acceptance rules (finite centre, zoom 0..28). */
export const AiMapDefaultViewSchema = z
  .object({
    center: z.tuple([z.number().finite(), z.number().finite()]),
    zoom: z.number().finite().min(0).max(28),
  })
  .strict();

export function lonLatToMercator(lon: number, lat: number): [number, number] {
  const la = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const x = (R * lon * Math.PI) / 180;
  const y = R * Math.log(Math.tan(Math.PI / 4 + (la * Math.PI) / 360));
  return [x, y];
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/**
 * The largest zoom (clamped to [MAP_VIEW_MIN_ZOOM, MAP_VIEW_MAX_ZOOM]) at which the padded extent fits the viewport,
 * centred on the extent. null when the bounds are unusable (non-finite, inverted, outside lon/lat range).
 */
export function mapViewForBounds(bounds: LonLatBounds, viewportPx?: { w: number; h: number }): MapDefaultView | null {
  const { minLon, maxLon, minLat, maxLat } = bounds;
  if (![minLon, maxLon, minLat, maxLat].every(finite)) return null;
  if (minLon > maxLon || minLat > maxLat) return null;
  if (minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90) return null;
  const vw = viewportPx && finite(viewportPx.w) && viewportPx.w > 0 ? viewportPx.w : MAP_VIEW_DEFAULT_VIEWPORT.w;
  const vh = viewportPx && finite(viewportPx.h) && viewportPx.h > 0 ? viewportPx.h : MAP_VIEW_DEFAULT_VIEWPORT.h;

  const [x0, y0] = lonLatToMercator(minLon, minLat);
  const [x1, y1] = lonLatToMercator(maxLon, maxLat);
  const center: [number, number] = [(x0 + x1) / 2, (y0 + y1) / 2];
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (dx < POINT_EPS_M && dy < POINT_EPS_M) return { center, zoom: MAP_VIEW_POINT_ZOOM };

  // resolution (m/px) at zoom z = WORLD_M / (TILE * 2^z); need extent / res <= FILL * viewport on both axes.
  const zoomFor = (extent: number, px: number): number =>
    extent < POINT_EPS_M ? Infinity : Math.log2((WORLD_M * FILL * px) / (TILE * extent));
  const raw = Math.min(zoomFor(dx, vw), zoomFor(dy, vh));
  const zoom = Math.max(MAP_VIEW_MIN_ZOOM, Math.min(MAP_VIEW_MAX_ZOOM, Math.floor(raw * 100) / 100));
  return { center, zoom };
}
