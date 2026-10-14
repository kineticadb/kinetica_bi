import { useMemo } from "react";
import type { DashboardLayerDto } from "../api/client";
import { useDashboardLayersStore } from "../store/dashboardLayersStore";
import { useAiSessionStore } from "../store/aiSessionStore";
import { applySessionToLayers } from "../lib/aiSession/applySession";

/**
 * Saved layers merged with session add/remove only. Overlay patches still go through
 * applyLayerOverrides afterwards. Read path for MapChartRenderer / LegendRenderer /
 * InfoCardRenderer / DashboardsPage. Do NOT use in LayersModal or config panels (they edit
 * saved layers). Returns the store array by identity when there is no session.
 */
export function useEffectiveLayers(): DashboardLayerDto[] {
  const saved = useDashboardLayersStore((s) => s.layers);
  const derived = useAiSessionStore((s) => s.derived);
  const tempVisibility = useAiSessionStore((s) => s.tempLayerVisibility);
  return useMemo(() => applySessionToLayers(saved, derived, tempVisibility), [saved, derived, tempVisibility]);
}
