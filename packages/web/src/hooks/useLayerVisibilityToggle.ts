/**
 * Shared layer-visibility toggle for the in-map legend overlay (MapChartRenderer)
 * and the standalone Legend widget (LegendRenderer).
 *
 * Flips a layer's operator-preference `config.visible` flag:
 *   1. Optimistic store update (immediate map + legend feedback, no await).
 *   2. Persist via apiUpdateLayer. Unlike LayersModal's slider/text fields — which
 *      debounce because they fire on every keystroke — a visibility toggle is a single
 *      discrete click, so we persist immediately (no debounce).
 *   3. Error toast on failure (mirrors DashboardsPage's handleLayerPatch copy).
 *
 * dashboardId is read from the OPTIONAL DashboardContext: when no provider is mounted
 * (legacy MapChartRenderer.spec fixtures render without one) the optimistic store update
 * still runs but the server PATCH is skipped — there is no dashboard to PATCH against.
 */

import { useCallback } from "react";
import {
  updateLayer as apiUpdateLayer,
  type DashboardLayerDto,
} from "../api/client";
import { useDashboardLayersStore } from "../store/dashboardLayersStore";
import { useDashboardContextOptional } from "../components/DashboardContext";
import { useToastStore } from "../store/toast";

export function useLayerVisibilityToggle(): (
  layerId: number,
  nextVisible: boolean,
) => void {
  const ctx = useDashboardContextOptional();
  const dashboardId = ctx?.dashboardId;

  return useCallback(
    (layerId: number, nextVisible: boolean) => {
      const layer = useDashboardLayersStore
        .getState()
        .layers.find((l) => l.id === layerId);
      if (!layer) return;

      // Merge into a fresh config object — the store does a shallow { ...layer, ...patch }
      // so `config` is replaced wholesale (same contract LayersModal relies on).
      const patch: Partial<DashboardLayerDto> = {
        config: { ...layer.config, visible: nextVisible },
      };

      // 1. Optimistic store update — map + legend react synchronously.
      useDashboardLayersStore.getState().updateLayer(layerId, patch);

      // 2. Persist (only when we know which dashboard owns the layer).
      if (dashboardId === undefined) return;
      void apiUpdateLayer(dashboardId, layerId, patch).catch((err) => {
        useToastStore
          .getState()
          .showToast("Failed to save layer — check your connection", "error");
        console.error("updateLayer (visibility) failed", err);
      });
    },
    [dashboardId],
  );
}
