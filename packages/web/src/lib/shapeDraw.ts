/**
 * Phase 29 (DRAW-V15-02..06): Pure helpers + types for the draw-and-shape phase.
 *
 * Why this module exists:
 *   - DrawMode is consumed by MapDrawToolbar (Plan 02), MapChartRenderer state machinery
 *     (Plan 01-05), and pure helper functions. Putting it in lib/shapeDraw.ts (not
 *     MapChartRenderer.tsx) keeps the toolbar component free of a circular import.
 *   - formatDistance / formatArea encode the km / m switchover locked by 29-UI-SPEC.md:
 *     <1 km: meters with 0 decimals; ≥1 km: kilometers with 1 decimal. Same rule for area.
 *   - Pure helpers (no OL imports) so they are unit-testable without mocking the OL Map.
 *     Effect 8's drawend pipeline (Plan 04) imports formatDistance/formatArea to build the
 *     measurement string passed to addShape.
 */

/** Locked tuple ordering — matches MapDrawToolbar render order (Pan / Info / Bbox / Lasso / Circle). */
export const DRAW_MODES = ["pan", "info", "bbox", "lasso", "circle"] as const;

/** Union of all five interaction modes for a map widget. Shape["type"] is the bbox/lasso/circle subset. */
export type DrawMode = (typeof DRAW_MODES)[number];

/**
 * Format a ground distance in meters per 29-UI-SPEC.md:
 *   - <1000 m → "{N} m" (0 decimals, Math.round)
 *   - ≥1000 m → "{N.N} km" (1 decimal via toFixed(1))
 * No thousand separator (SI typography lock).
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * Format an area in square meters per 29-UI-SPEC.md:
 *   - <1_000_000 m² → "{N} m²" (0 decimals)
 *   - ≥1_000_000 m² → "{N.N} km²" (1 decimal)
 * Uses U+00B2 (²) literal.
 */
export function formatArea(sqMeters: number): string {
  if (sqMeters < 1_000_000) return `${Math.round(sqMeters)} m²`;
  return `${(sqMeters / 1_000_000).toFixed(1)} km²`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 29 (DRAW-V15-04..06): OL Draw interaction helpers
// These import OL modules — kept below the pure formatDistance/formatArea helpers
// so the top of the file remains unit-testable without heavy OL mocking.
// ─────────────────────────────────────────────────────────────────────────────

import Draw, { createBox, createRegularPolygon } from "ol/interaction/Draw";
import type VectorSource from "ol/source/Vector";
import type Polygon from "ol/geom/Polygon";
import type { Extent } from "ol/extent";
import { getDistance, getArea } from "ol/sphere";
import { transform } from "ol/proj";

/**
 * Phase 29 (DRAW-V15-04): OL Draw interaction factory.
 *   - bbox   → type:'Circle' + geometryFunction:createBox()              → Polygon at drawend
 *   - lasso  → type:'Polygon' + freehand:true                            → Polygon at drawend
 *   - circle → type:'Circle' + geometryFunction:createRegularPolygon(64) → Polygon at drawend
 *   - pan/info → null (no Draw interaction; caller must handle)
 *
 * Note: stopClick is intentionally NOT set — unreliable across OL versions (V15-P-01 PITFALLS).
 * Mode-guard in Effect 6 (Plan 01) is the correct singleclick mitigation.
 */
export function buildDrawInteraction(mode: DrawMode, source: VectorSource): Draw | null {
  switch (mode) {
    case "bbox":
      return new Draw({ source, type: "Circle", geometryFunction: createBox() });
    case "lasso":
      return new Draw({ source, type: "Polygon", freehand: true });
    case "circle":
      return new Draw({ source, type: "Circle", geometryFunction: createRegularPolygon(64) });
    case "pan":
    case "info":
      return null;
  }
}

/**
 * Phase 29 (DRAW-V15-06): degenerate-shape rejection guard.
 *   Returns true when EITHER extent dimension is less than 10 × map resolution. This
 *   is the locked interpretation from 29-RESEARCH.md Open Question 2 (recommendation b:
 *   width-OR-height threshold — most user-friendly; avoids accepting thin-sliver shapes).
 *
 * @param extent OL extent in map projection (EPSG:3857 meters at the current zoom)
 * @param resolution view.getResolution() — meters per pixel at the current zoom level
 */
export function isDegenerateExtent(extent: Extent, resolution: number): boolean {
  const [minX, minY, maxX, maxY] = extent;
  const width = maxX - minX;
  const height = maxY - minY;
  const threshold = 10 * resolution;
  return width < threshold || height < threshold;
}

/**
 * Phase 29 (DRAW-V15-05): compute the user-facing measurement string for a committed shape.
 *
 * Strict invariant (V15-P-04 lock): NEVER raw EPSG:3857 distances. Always use ol/sphere
 * with explicit projection options OR pre-transform to WGS84.
 *
 *   - bbox:   width = getDistance(BL, BR) WGS84, height = getDistance(BL, TL) WGS84
 *             returns "{W} × {H}" via formatDistance.
 *   - circle: radius = getDistance(centerCoord, firstVertex) WGS84 — yields ~5% precision
 *             due to 64-gon approximation (locked tradeoff per 29-CONTEXT.md).
 *   - lasso:  area = getArea(polygon, { projection: 'EPSG:3857' }) — ol/sphere does the
 *             ellipsoidal correction internally; returns "{A} km²" / "{A} m²" via formatArea.
 *
 * The polygon argument MUST be in EPSG:3857 (the OL Map's projection lock — PITFALL M-03).
 * For bbox/circle, we transform corners/center to WGS84 for getDistance; for lasso we pass
 * the polygon directly to getArea with the projection option.
 *
 * Note on bbox corner winding: createBox()'s output ring is BL → BR → TR → TL → BL
 * (verified in 29-RESEARCH.md Pattern 10). If the winding differs, swap the index pairs.
 */
export function computeMeasurement(
  type: "bbox" | "lasso" | "circle",
  geom: Polygon,
): string {
  if (type === "bbox") {
    const ring = geom.getCoordinates()[0]; // outer ring [BL, BR, TR, TL, BL]
    const blMerc = ring[0] as [number, number];
    const brMerc = ring[1] as [number, number];
    const tlMerc = ring[3] as [number, number];
    const bl = transform(blMerc, "EPSG:3857", "EPSG:4326") as [number, number];
    const br = transform(brMerc, "EPSG:3857", "EPSG:4326") as [number, number];
    const tl = transform(tlMerc, "EPSG:3857", "EPSG:4326") as [number, number];
    const widthMeters = getDistance(bl, br);
    const heightMeters = getDistance(bl, tl);
    return `${formatDistance(widthMeters)} × ${formatDistance(heightMeters)}`;
  }
  if (type === "circle") {
    const centerXY = geom.getInteriorPoint().getCoordinates();
    const centerMerc: [number, number] = [centerXY[0], centerXY[1]];
    const vertexMerc = geom.getCoordinates()[0][0] as [number, number];
    const center = transform(centerMerc, "EPSG:3857", "EPSG:4326") as [number, number];
    const vertex = transform(vertexMerc, "EPSG:3857", "EPSG:4326") as [number, number];
    const radiusMeters = getDistance(center, vertex);
    return formatDistance(radiusMeters);
  }
  // lasso → area
  const areaSqMeters = getArea(geom, { projection: "EPSG:3857" });
  return formatArea(areaSqMeters);
}
