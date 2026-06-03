/**
 * Phase 23 (CARD-V14-01..04): Info Card renderer — wraps <InfoSelectionView /> with widget chrome.
 *
 * Card is dashboard-scoped: dropdown lists ALL dashboard layers where info_enabled === 1
 * — independent of which map widget owns the layer or whether any map currently has the
 * layer visible (locked at 23-CONTEXT.md § "Layer subscription contract & dropdown source").
 * All three spatial modes (latlon/wkt/wkb) are supported by /api/info/query.
 *
 * NO popup chrome (no anchored container, no close X, no ESC handler, no ol/Overlay).
 * Standard widget shell (drag handle, delete button) is provided by the dashboard widget grid
 * outside this component — InfoCardRenderer renders only the card body and outer wrapper class.
 *
 * Empty state copy: "Click a point on the map to see details" (ROADMAP.md verbatim — Success
 * Criterion 4). Single neutral copy across all empty/missing/error variants.
 *
 * The card does NOT initiate a fetch on mount. <InfoSelectionView /> waits for activeLayerId
 * to become non-null AND useLastInfoClickContextStore.context to become non-null before any
 * dropdown-switch can fire fetch (Pitfall 2 lock). Fresh fetches are triggered exclusively by
 * map clicks (in MapChartRenderer.tsx click-fan-out, Plan 21-03) which write activeLayerId
 * + setSelection AND lastClickContext atomically — both popup and card observe the same store.
 */
import { useMemo } from "react";
import { useDashboardLayersStore } from "../../store/dashboardLayersStore";
import { useInfoSelectionStore } from "../../store/infoSelectionStore";
import InfoSelectionView from "./InfoSelectionView";
import type { DashboardLayerDto, WidgetDto, TableDto } from "../../api/client";

type Props = {
  /** Widget DTO — widget.id is informational; widget.config === {} per defaultConfig. */
  widget: WidgetDto;
  /** Dashboard tables, threaded through from WidgetRenderer. Used for table_id → schema/name resolution. */
  tables: TableDto[];
};

export default function InfoCardRenderer({ widget, tables }: Props) {
  // Dashboard-scoped eligibility — info_enabled === 1. All three spatial modes supported.
  // Sorted by position for stable dropdown order (matches popup's includedLayers order).
  // PITFALL S-01 lock: layer list lives ONLY in useDashboardLayersStore — no local copy.
  const allLayers = useDashboardLayersStore((s) => s.layers);
  const eligibleLayers = useMemo<DashboardLayerDto[]>(() => {
    return allLayers
      .filter((layer) => layer.info_enabled !== 0)
      .slice()
      .sort((a, b) => a.position - b.position);
  }, [allLayers]);

  // Display-name resolver — matches popup's pattern at MapChartRenderer.tsx:218-224.
  const layerNameFor = (layer: DashboardLayerDto): string => {
    const t = tables.find((tbl) => tbl.id === layer.table_id);
    const tableName = t ? `${t.schema}.${t.name}` : "(unset table)";
    const renderMode = (layer.config as { renderMode?: string }).renderMode ?? "raster";
    return `${tableName} — ${renderMode}`;
  };

  // Table resolver for InfoSelectionView's on-demand fetch payload.
  const resolveTable = (tableId: number): { schema: string; name: string } | null => {
    const t = tables.find((tbl) => tbl.id === tableId);
    return t ? { schema: t.schema, name: t.name } : null;
  };

  // When active layer leaves eligibility: reset the store; the empty state renders naturally.
  // Single behavior, two surfaces — popup wraps with chrome dismiss; card just produces the empty state.
  const onActiveLayerIneligible = () => {
    useInfoSelectionStore.getState().reset();
  };

  return (
    <div className="widget-info-card" data-widget-id={widget.id}>
      <InfoSelectionView
        eligibleLayers={eligibleLayers}
        layerNameFor={layerNameFor}
        resolveTable={resolveTable}
        emptyStateCopy="Click a point on the map to see details"
        onActiveLayerIneligible={onActiveLayerIneligible}
      />
    </div>
  );
}
