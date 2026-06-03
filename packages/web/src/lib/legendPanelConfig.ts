import type { MapWidgetConfig } from "./wmsUrlBuilder";

// v1.7 Phase 41 (PANEL-V17-04): Layers Legend Panel defaults + corner enum.
// Mirrors v1.4 Phase 19 mapInfoConfig.ts pattern verbatim.

export const LEGEND_PANEL_CORNERS = ['top-right', 'top-left', 'bottom-right', 'bottom-left'] as const;
export type LegendPanelCorner = typeof LEGEND_PANEL_CORNERS[number];

export const DEFAULT_LEGEND_PANEL_ENABLED: boolean = false;
export const DEFAULT_LEGEND_PANEL_CORNER: LegendPanelCorner = 'top-right';

export function getLegendPanelEnabled(
  config: Pick<MapWidgetConfig, "legendPanelEnabled">,
): boolean {
  return config.legendPanelEnabled ?? DEFAULT_LEGEND_PANEL_ENABLED;
}

export function getLegendPanelCorner(
  config: Pick<MapWidgetConfig, "legendPanelCorner">,
): LegendPanelCorner {
  const v = config.legendPanelCorner;
  return LEGEND_PANEL_CORNERS.includes(v as LegendPanelCorner)
    ? (v as LegendPanelCorner)
    : DEFAULT_LEGEND_PANEL_CORNER;
}
