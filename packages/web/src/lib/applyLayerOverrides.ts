/**
 * v1.14 follow-up: shared layer-overlay merge.
 *
 * The v1.11 action engine (radio controls etc.) writes RENDER-TIME overlays into
 * `useWidgetActionStore.layerOverrides` — DTO-shaped patches keyed by layer id:
 *   { config?: { renderMode?, visible?, opacity? }, track_config?, cb_config? }
 *
 * Both read-paths that surface layer appearance MUST merge these the same way, or
 * they drift (GAP-61-01: the in-map legend was fixed to read overlay-merged layers,
 * but the STANDALONE LegendRenderer was missed — so an overlay-set cb_config rendered
 * on the map + in-map legend yet showed "No breaks configured" in the standalone Legend
 * widget). Lifting the merge to one helper keeps MapChartRenderer's `effectiveLayers`
 * and LegendRenderer's resolved layers byte-identical.
 *
 * Merge semantics (mirrors the original MapChartRenderer.effectiveLayers, Phase 58.1):
 *   - top-level fields (track_config / cb_config) land directly on the merged object
 *     — preserving the [[track-config-toplevel-field]] invariant.
 *   - nested config fields (renderMode / visible / opacity) deep-merge into layer.config.
 *   - no override for a layer → return the SAME reference (referentially stable so
 *     downstream React.memo / array-identity checks don't churn).
 *
 * RENDER-TIME only: the persisted dashboardLayersStore baseline is never mutated.
 */

import type { DashboardLayerDto } from "../api/client";

export function applyLayerOverrides(
  layers: DashboardLayerDto[],
  layerOverrides: Record<number, Record<string, unknown>>,
): DashboardLayerDto[] {
  return layers.map((l) => {
    const ov = layerOverrides[l.id];
    if (!ov) return l; // referentially stable — no override
    // Split the DTO-shaped overlay into nested config patch and top-level fields.
    const { config: cfgPatch, ...topLevel } = ov as {
      config?: Record<string, unknown>;
      [key: string]: unknown;
    };
    return cfgPatch
      ? { ...l, ...topLevel, config: { ...(l.config as Record<string, unknown>), ...cfgPatch } }
      : { ...l, ...topLevel };
  });
}
