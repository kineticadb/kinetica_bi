/**
 * v1.7 Phase 42 Plan 02 (WIDGET-V17-01..05): Standalone Legend widget renderer.
 *
 * Mirrors the chosen map widget's <LayersLegendPanel> content as a dashboard tile.
 * Reads bound map widget via DashboardContext (LegendRenderer is INSIDE the
 * DashboardContextProvider, unlike LegendConfigPanel which is in WidgetConfigModal).
 *
 * Subscription discipline:
 *   - legendKey primitive selector (PITFALL S-02) — mirrors MapChartRenderer:533-540 verbatim
 *   - useDashboardLayersStore.getState().layers read IMPERATIVELY inside useMemo body
 *   - eslint-disable-next-line react-hooks/exhaustive-deps because legendKey is the reactive trigger
 *
 * Orphan state (single UI for all three triggers):
 *   1. widget.config.sourceMapWidgetId === undefined
 *   2. widgets.find(w => w.id === sourceMapWidgetId) === undefined (bound widget deleted)
 *   3. found widget but type !== "map" (defensive — picker filters but operator overrides possible)
 *
 * Live updates: store.updateLayer mutation → legendKey changes → useMemo recomputes
 * → <LayersLegendPanel> receives new layers prop → re-renders with updated CB swatches.
 */

import { useMemo } from "react";
import { LayersLegendPanel } from "../LayersLegendPanel";
import type { DvLayerStatus, ResolvedLegendLayer } from "../LayersLegendPanel";
import { resolveLegendLayers } from "../../lib/resolveLegendLayers";
import { applyLayerOverrides } from "../../lib/applyLayerOverrides";
import { useDashboardLayersStore } from "../../store/dashboardLayersStore";
import { useWidgetActionStore } from "../../store/widgetActionStore";
import { useDynamicViewStore } from "../../store/dynamicViewStore";
import { useDashboardContext } from "../DashboardContext";
import { useLayerVisibilityToggle } from "../../hooks/useLayerVisibilityToggle";
import type { WidgetDto } from "../../api/client";

type Props = {
  widget: WidgetDto;
  onConfigureWidget?: (widget: WidgetDto) => void;
};

export default function LegendRenderer({
  widget,
  onConfigureWidget,
}: Props): JSX.Element {
  const { widgets } = useDashboardContext();
  const sourceMapWidgetId = widget.config.sourceMapWidgetId as
    | number
    | undefined;

  // v1.14 fix: read OVERLAY-MERGED layers, exactly like MapChartRenderer.effectiveLayers.
  // Previously this read the raw store via a primitive legendKey and IGNORED the v1.11
  // action-engine layerOverrides — so a control/radio overlay that set a layer's
  // renderMode/cb_config rendered on the map + in-map legend but showed "No breaks
  // configured" here (legend out of sync with the map). Both paths now merge via the
  // shared applyLayerOverrides helper so they can't drift.
  const allLayers = useDashboardLayersStore((s) => s.layers);
  const layerOverrides = useWidgetActionStore((s) => s.layerOverrides);
  const effectiveLayers = useMemo(
    () => applyLayerOverrides(allLayers, layerOverrides),
    [allLayers, layerOverrides],
  );

  // Eye-toggle handler — flips config.visible (optimistic store update + PATCH).
  // The store change bumps legendKey above, recomputing resolvedLegendLayers.
  const toggleLayerVisible = useLayerVisibilityToggle();

  // Resolve bound map widget (single lookup; reused for orphan detection AND happy-path config read)
  const boundWidget =
    sourceMapWidgetId !== undefined
      ? widgets.find((w) => w.id === sourceMapWidgetId)
      : undefined;
  const isMapWidget = boundWidget?.type === "map";

  // Orphan state: ANY of the three triggers
  const isOrphan =
    sourceMapWidgetId === undefined || boundWidget === undefined || !isMapWidget;

  // Compute resolvedLegendLayers ONLY when not orphaned. Note: useMemo MUST be called
  // unconditionally (React hooks rule), so we compute it before the orphan branch.
  const includedLayerIds =
    isMapWidget && boundWidget
      ? (boundWidget.config.includedLayerIds as number[] | undefined)
      : undefined;

  // Phase 44 follow-up: dv-status re-render trigger. Mirrors MapChartRenderer's
  // enrichment so the standalone Legend widget shows the same inline status
  // badges ("Over threshold" / "Materializing…" / "Error" / "Not materialized")
  // as the in-map panel for dv-bound layers that aren't currently rendering.
  // dynamicViewVersion ticks on every dv-store mutation — cheap & exhaustive.
  const dynamicViewVersion = useDynamicViewStore((s) => s.dynamicViewVersion);

  const resolvedLegendLayers = useMemo<ResolvedLegendLayer[]>(() => {
    if (isOrphan) return [];
    const base = resolveLegendLayers(effectiveLayers, includedLayerIds);
    // Enrich each entry with dv-materialization status (read imperatively from the store).
    // dynamicViewVersion above is the reactive trigger that fires this useMemo.
    const dvViews = useDynamicViewStore.getState().views;
    return base.map((entry) => {
      const dvId = entry.layer.dynamic_view_id;
      if (dvId === null || dvId === undefined) return entry; // base-table layer — no status
      const dvEntry = dvViews[dvId];
      const dvStatus: DvLayerStatus = dvEntry ? dvEntry.status : "absent";
      return { ...entry, dvStatus };
    });
    // effectiveLayers is the (overlay-merged) read-trigger; includedLayerIds is the filter
    // trigger; dynamicViewVersion is the dv-state re-render trigger; isOrphan gates render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveLayers, includedLayerIds, isOrphan, dynamicViewVersion]);

  if (isOrphan) {
    return (
      <div className="legend-widget-orphan" role="status">
        <div className="legend-widget-orphan-message">
          Source map widget not found. Reconfigure the legend.
        </div>
        {onConfigureWidget && (
          <button
            type="button"
            className="legend-widget-orphan-reconfigure"
            onClick={() => onConfigureWidget(widget)}
          >
            Reconfigure
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="legend-widget-body">
      <LayersLegendPanel
        layers={resolvedLegendLayers}
        corner="top-right"
        collapsed={false}
        onToggleCollapse={() => {}}
        showChevron={false}
        onToggleVisible={toggleLayerVisible}
      />
    </div>
  );
}
