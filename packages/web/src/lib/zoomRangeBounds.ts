/**
 * Phase 118 (ZLGND-V123-05): THE single source of truth for the zoom-range
 * inclusive→OpenLayers translation.
 *
 * Wire format (layer.config) is INCLUSIVE on both bounds: `[3, 10]` reads as
 * "show at zoom 3, 4, ..., 10". OpenLayers' BaseLayer convention is
 * asymmetric:
 *   - minZoom is EXCLUSIVE (visible when view.zoom >  minZoom)
 *   - maxZoom is INCLUSIVE (visible when view.zoom <= maxZoom)
 * Translation: internalMin = userMin - 1, internalMax = userMax.
 * `undefined` on the wire means "no constraint" → OL's -Infinity / Infinity
 * defaults.
 *
 * WHY THIS MODULE EXISTS: before Phase 118 this translation was written in
 * TWO places (applyZoomRangeToLayer, which was right; and the info-click
 * gate's isLayerVisibleAtCurrentZoom, which used the raw inclusive bounds
 * and was wrong). They disagreed at fractional zoom — with minZoom 3, OL
 * drew the layer at zoom 2.9 while the info-click gate suppressed clicks on
 * it. Every consumer now derives from here. Do NOT re-implement this
 * comparison anywhere else, not even "just to be safe".
 *
 * Lives in lib/ (not MapChartRenderer.tsx) so lib/resolveLegendLayers.ts can
 * import it without reversing the established one-way import direction.
 */
export type ZoomRangeConfig = { minZoom?: number; maxZoom?: number };

/** Translate the INCLUSIVE wire range into the OL (exclusive-min, inclusive-max) bounds. */
export function toOlZoomBounds(config: ZoomRangeConfig): {
  minZoom: number;
  maxZoom: number;
} {
  return {
    // INCLUSIVE userMin → EXCLUSIVE internal: subtract 1. When undefined → -Infinity.
    minZoom: config.minZoom === undefined ? -Infinity : config.minZoom - 1,
    // INCLUSIVE userMax → INCLUSIVE internal: pass through. When undefined → Infinity.
    maxZoom: config.maxZoom === undefined ? Infinity : config.maxZoom,
  };
}

/**
 * Is a layer with this configured range actually drawing at `zoom`?
 * Reproduces OL's own visibility test against the translated bounds, so this
 * answer and what OL renders cannot drift.
 *
 * `zoom` is the RAW FRACTIONAL OL zoom — never round it before calling.
 */
export function isLayerActiveAtZoom(
  config: ZoomRangeConfig,
  zoom: number,
): boolean {
  const { minZoom, maxZoom } = toOlZoomBounds(config);
  return zoom > minZoom && zoom <= maxZoom;
}
