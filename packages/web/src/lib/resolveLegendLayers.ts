/**
 * v1.7 Phase 42 (Plan 42-01): Shared layer derivation helper.
 *
 * Phase 41 (MapChartRenderer in-map overlay) was the 1st consumer of this derivation;
 * Phase 42 (standalone LegendRenderer) is the 2nd consumer. Per the Phase 40
 * lib/trackConfig.ts precedent, the derivation is lifted to a shared module on the
 * 2nd-consumer trigger to prevent divergence.
 *
 * Honors Phase 12's empty-array-means-all-on semantic for includedLayerIds:
 *   - undefined  → all store layers visible (legacy widgets pre-Phase-12)
 *   - []         → all store layers visible (lazy/inclusive default; same as undefined)
 *   - [a, b, c]  → only those layer IDs visible
 */

import type { DashboardLayerDto } from "../api/client";
import { isLayerActiveAtZoom } from "./zoomRangeBounds";

/**
 * Phase 44 follow-up: dynamic-view materialization state for layers bound to a dv.
 * The legend panel surfaces non-materialized states inline so operators can see
 * WHY a configured layer isn't currently rendering on the map without diving into
 * the LayersModal. Undefined when the layer is bound directly to a base table.
 *
 *  - materialized   → dv is live; layer renders normally (no badge in panel)
 *  - pending        → materialize call in flight; layer hidden from map (transient)
 *  - over_threshold → dv result exceeds max_records; layer permanently hidden
 *                      until operator drops the threshold or the underlying data shrinks
 *  - error          → materialize failed; layer hidden; user-fixable
 *  - absent         → no entry in dv store yet (mount before first materialize attempt)
 */
export type DvLayerStatus = "materialized" | "pending" | "over_threshold" | "error" | "absent";

export type ResolvedLegendLayer = {
  layer: DashboardLayerDto;
  visible: boolean;
  /** Optional dv-materialization status; only set when layer.dynamic_view_id != null. */
  dvStatus?: DvLayerStatus;
  /**
   * Phase 96 Plan 03 (COMM-V118-02): per-layer filter-scope indicator data.
   * Computed by the caller (MapChartRenderer) via computeFilterScopeSummary.
   * LayersLegendPanel renders "X of Y filters" ONLY when appliedCount < totalCount.
   * undefined = no filter computation performed (e.g. no active filters at all).
   */
  filterSummary?: { appliedCount: number; totalCount: number };
  /**
   * Phase 118 (ZLGND-V123-03): the layer's CONFIGURED wire range, present iff
   * layer.config has minZoom OR maxZoom. Raw inclusive wire values — NOT the
   * translated OL bounds. Consumers render this as-is in the range chip.
   */
  zoomRange?: { minZoom?: number; maxZoom?: number };
  /**
   * Phase 118 (ZLGND-V123-05/06/07): THREE-state, never a boolean-with-a-default.
   *   undefined → unknown: either no range is configured, or the caller had no live
   *               zoom to pass (map not mounted). BOTH mean "render exactly as today".
   *   true/false → known, computed by the one shared predicate in lib/zoomRangeBounds.
   * NEVER coerce unknown to false: that would dim every zoom-limited layer in the
   * standalone Legend widget the moment its source map isn't mounted — the
   * "confidently wrong panel" failure this phase exists to prevent.
   */
  zoomActive?: boolean;
};

/**
 * Filter store layers by widget config's includedLayerIds and project to ResolvedLegendLayer[].
 * Result order preserves storeLayers order (NOT includedLayerIds order).
 *
 * `visible` reflects the operator's per-layer preference (`config.visible`), defaulting
 * to true when unset. ALL included layers are returned regardless of visibility so the
 * legend keeps listing hidden layers (dimmed) and the eye toggle can turn them back on.
 */
export function resolveLegendLayers(
  storeLayers: DashboardLayerDto[],
  includedLayerIds: number[] | undefined,
  /**
   * Phase 118: the bound map's LIVE fractional OL zoom, or undefined when the caller
   * has none (LegendRenderer whose source map isn't mounted). Never round it.
   */
  zoom?: number,
): ResolvedLegendLayer[] {
  const filtered =
    includedLayerIds && includedLayerIds.length > 0
      ? storeLayers.filter((l) => includedLayerIds.includes(l.id))
      : storeLayers;
  return filtered.map((layer) => {
    const cfg = layer.config as { visible?: boolean; minZoom?: number; maxZoom?: number };
    const hasRange = cfg?.minZoom !== undefined || cfg?.maxZoom !== undefined;
    return {
      layer,
      visible: cfg?.visible !== false,
      zoomRange: hasRange ? { minZoom: cfg.minZoom, maxZoom: cfg.maxZoom } : undefined,
      zoomActive:
        hasRange && zoom !== undefined
          ? isLayerActiveAtZoom({ minZoom: cfg.minZoom, maxZoom: cfg.maxZoom }, zoom)
          : undefined,
    };
  });
}
