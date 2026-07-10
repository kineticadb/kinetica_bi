/**
 * Phase 108 (FSCOPE-V120-01, panel display portion): live hook wrapping the Phase-105 pure
 * reverse-map fn `computeReverseFilterMap`.
 *
 * Mirrors `useFilterScopeSummary.ts`'s pattern exactly: SCOPED primitive-stable selectors
 * (filterVersion / spatialFilterVersion / dvFilterScopeDisabled) drive re-computation;
 * the actual filter/shape arrays are read imperatively via `.getState()` inside `useMemo`
 * (PITFALL S-02 — never subscribe to the whole array/object).
 *
 * `enumerateVizDescriptors` builds one `VizDescriptor` per viz (chart/table widgets AND
 * map layers resolved to their OWNING map widget), matching the enumeration in
 * `useCombinationOrchestrator.ts` (trigger-type filtering) and the `mapTableIds` IIFE
 * previously inline in DashboardsPage.tsx (now also mirrored in WidgetCard.tsx).
 */

import { useMemo } from "react";
import type { WidgetDto, DashboardLayerDto, TableDto, DynamicViewRow } from "../api/client";
import { useFilterStore } from "../store/filterStore";
import { useSpatialFilterStore } from "../store/spatialFilterStore";
import { useAuthStore } from "../store/auth";
import {
  computeReverseFilterMap,
  type VizDescriptor,
  type FilterApplyEntry,
  type ShapeApplyEntry,
} from "./computeReverseFilterMap";
import type { FilterSelectionConfig } from "../types/filterSelection";
import { coalesceCalendarFilterSelection } from "./coalesceCalendarFilterSelection";

// Mirrors useCombinationOrchestrator.ts's NON_TRIGGER_TYPES — widget types that never
// produce a materialized combo view (and so are never a chart/table "applies-to" target).
// "table" and "records" are intentionally NOT in this set (both ARE trigger types).
const NON_TRIGGER_TYPES = new Set([
  "map",
  "info-card",
  "legend",
  "datafilter",
  "radiogroup",
  // "timeline" / "numericline" / "calendar" REMOVED (Phase 109.2 — FSCOPE-V120-05): these three
  // widgets are combo-store CONSUMERS and need a scoped vizToHash binding, same as bar/pie/table.
  // Must mirror useCombinationOrchestrator.ts's NON_TRIGGER_TYPES exactly (a mismatch is the
  // exact reported bug). Orthogonal to FILTER_PRODUCING_TYPES (filterSourceTypes.ts).
]);
const isTriggerType = (t: string) => !NON_TRIGGER_TYPES.has(t);

/**
 * layerNameFor recipe — inlined from MapChartRenderer.tsx:768-775 (GAP-54-04: a shared helper
 * de-dup is separate debt, out of scope for Phase 108).
 */
function layerNameFor(layer: DashboardLayerDto, associatedTables: TableDto[]): string {
  const custom = (layer.config as { name?: string } | undefined)?.name;
  if (typeof custom === "string" && custom.trim().length > 0) return custom.trim();
  const t = associatedTables.find((tbl) => tbl.id === layer.table_id);
  const tableName = t ? `${t.schema}.${t.name}` : "(unset table)";
  const renderMode = (layer.config as { renderMode?: string } | undefined)?.renderMode ?? "raster";
  return `${tableName} — ${renderMode}`;
}

/**
 * Enumerates one VizDescriptor per chart/table widget (isTriggerType) and one per
 * (owning map widget, included+visible layer) pair. Exported for direct unit testing.
 */
export function enumerateVizDescriptors(args: {
  widgets: WidgetDto[];
  layers: DashboardLayerDto[];
  associatedTables: TableDto[];
  targetsByTable: Map<number, unknown>;
}): VizDescriptor[] {
  const { widgets, layers, associatedTables, targetsByTable } = args;
  const vizs: VizDescriptor[] = [];

  // Chart/table widgets.
  for (const w of widgets) {
    if (!isTriggerType(w.type)) continue;
    const cfg = (w.config ?? {}) as Record<string, unknown>;
    const tableId = cfg.tableId as number | undefined;
    const dynamicViewId = cfg.dynamicViewId as number | undefined;
    vizs.push({
      vizKind: "widget",
      widgetId: w.id,
      widgetTitle: w.title,
      cfg: w.type === "calendar" ? coalesceCalendarFilterSelection(cfg) : (cfg.filterSelection as FilterSelectionConfig | undefined),
      tableId,
      dynamicViewId,
      spatialCapable: tableId !== undefined && targetsByTable.has(tableId),
    });
  }

  // Map layers → owning map widget. Mirrors the mapTableIds IIFE (DashboardsPage.tsx,
  // now also WidgetCard.tsx): included layers = config.includedLayerIds empty/undefined
  // (ALL layers) or filtered by id; then drop layers with config.visible === false.
  // One layer under multiple map widgets emits one descriptor per (owning-widget, layer) pair.
  for (const w of widgets) {
    if (w.type !== "map") continue;
    const cfg = (w.config ?? {}) as Record<string, unknown>;
    const includedIds = cfg.includedLayerIds as number[] | undefined;
    const included =
      includedIds === undefined || includedIds.length === 0
        ? layers
        : layers.filter((l) => includedIds.includes(l.id));
    const visible = included.filter((l) => (l.config as { visible?: boolean } | undefined)?.visible !== false);

    for (const layer of visible) {
      // CRITICAL: read the TOP-LEVEL layer.filter_scope field — NEVER the nested
      // config.filter_scope field (memory: track-config-toplevel-field).
      const cfgScope = layer.filter_scope ?? undefined;
      const dynamicViewId = layer.dynamic_view_id ?? undefined;
      vizs.push({
        vizKind: "layer",
        widgetId: w.id,
        layerId: layer.id,
        layerName: layerNameFor(layer, associatedTables),
        widgetTitle: w.title,
        cfg: cfgScope,
        tableId: dynamicViewId === undefined ? layer.table_id : undefined,
        dynamicViewId,
        spatialCapable: dynamicViewId === undefined && targetsByTable.has(layer.table_id),
      });
    }
  }

  return vizs;
}

export function useReverseFilterMap(args: {
  widgets: WidgetDto[];
  layers: DashboardLayerDto[];
  dynamicViews: DynamicViewRow[];
  associatedTables: TableDto[];
  targetsByTable: Map<number, unknown>;
}): { filterEntries: FilterApplyEntry[]; shapeEntries: ShapeApplyEntry[] } {
  const { widgets, layers, dynamicViews, associatedTables, targetsByTable } = args;

  // SCOPED primitive selectors (PITFALL S-02) — drive re-computation without subscribing
  // to the underlying arrays/objects.
  const filterVersion = useFilterStore((s) => s.filterVersion);
  const spatialFilterVersion = useSpatialFilterStore((s) => s.spatialFilterVersion);
  const dvFilterScopeDisabled = useAuthStore((s) => s.dvFilterScopeDisabled);

  return useMemo(() => {
    const { filters, dvFilters } = useFilterStore.getState();
    const { shapes } = useSpatialFilterStore.getState();
    const vizs = enumerateVizDescriptors({ widgets, layers, associatedTables, targetsByTable });
    return computeReverseFilterMap({ filters, dvFilters, shapes, vizs, dvFilterScopeDisabled });
    // dynamicViews is kept in the dep list for future dv-widget title lookups even though the
    // enumeration above doesn't read it directly (widget titles come from WidgetDto.title).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    widgets,
    layers,
    dynamicViews,
    associatedTables,
    targetsByTable,
    filterVersion,
    spatialFilterVersion,
    dvFilterScopeDisabled,
  ]);
}
