/**
 * Phase 112 (MAPVIEW-V121-02/-03): resolve the view a map widget OPENS at.
 *
 * Phase 111 persists a designer-captured default view field in EPSG:3857 with the
 * EXACT unrounded fractional zoom. This module turns that optional, possibly-garbage
 * field into a total value that `new ol/View({...})` can be constructed with directly:
 *   - saved and usable  -> the saved centre + zoom, verbatim (no rounding, no reprojection)
 *   - absent            -> the world view [0, 0] / zoom 2 (MAPVIEW-V121-03: byte-identical
 *                          to the pre-Phase-112 hardcoded values at MapChartRenderer.tsx)
 *   - saved but unusable -> the world view (defence in depth; a broken map is worse than
 *                          the default one, and throwing here would blank the widget)
 *
 * CONSUMED AT RENDER TIME, NEVER IN AN EFFECT. The result is a CONSTRUCTOR ARGUMENT for
 * the OL View. Applying it after construction (setCenter/setZoom/animate/fit) would paint
 * the world view first — the "visible world-view flash" MAPVIEW-V121-02 forbids.
 *
 * DO NOT reproject the centre here: it is already EPSG:3857, which is exactly why
 * Phase 111 chose that projection (111-CONTEXT.md lock). Reprojecting would corrupt it.
 * DO NOT round the zoom here: mapViewFormat.ts is DISPLAY-ONLY and lives on the other side
 * of this boundary.
 */

import { getDefaultView } from "./mapInfoConfig";
import type { MapWidgetConfig } from "./wmsUrlBuilder";

/** The pre-Phase-112 hardcoded initial view. MAPVIEW-V121-03's byte-identical baseline. */
export const WORLD_VIEW_CENTER: readonly [number, number] = [0, 0];
export const WORLD_VIEW_ZOOM = 2;

/**
 * OL's own View defaults when neither minZoom nor maxZoom is passed (ol/View
 * DEFAULT_MAX_ZOOM = 28, minZoom = 0). MapChartRenderer constructs its View without
 * either constraint, so this IS "OL's sane range" for this app. A stored zoom outside
 * it could not have come from a real OL view.
 */
const MIN_SANE_ZOOM = 0;
const MAX_SANE_ZOOM = 28;

/** A fresh world-view object per call — never a shared singleton (OL receives this array). */
function worldView(): { center: [number, number]; zoom: number } {
  return { center: [WORLD_VIEW_CENTER[0], WORLD_VIEW_CENTER[1]], zoom: WORLD_VIEW_ZOOM };
}

/**
 * Total function: always returns a usable { center, zoom }. Never throws, never undefined.
 */
export function resolveInitialView(
  config: Pick<MapWidgetConfig, "defaultView">,
): { center: [number, number]; zoom: number } {
  const saved = getDefaultView(config);
  if (!saved) return worldView();

  const { center, zoom } = saved;

  // Centre must be a 2-number array of finite numbers (no coercion: Number.isFinite("5") is false).
  if (!Array.isArray(center) || center.length !== 2) return worldView();
  if (!Number.isFinite(center[0]) || !Number.isFinite(center[1])) return worldView();

  // Zoom must be a finite number inside OL's sane range. zoom 0 is VALID (whole world).
  if (typeof zoom !== "number" || !Number.isFinite(zoom)) return worldView();
  if (zoom < MIN_SANE_ZOOM || zoom > MAX_SANE_ZOOM) return worldView();

  // Fresh array — never hand OL a reference into the persisted widget config blob.
  return { center: [center[0], center[1]], zoom };
}
