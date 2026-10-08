// Phase 131 (EXPRT-V126-05): mirrors useCombinationOrchestrator.ts:200-262/280-310 so the export uses the exact filter set the records table's view was built from. Read store state at click time (S-02), never subscribe.
import type { StartExportBody, ExportStartOptions, WidgetDto } from "../api/client";
import type { ActiveFilter } from "../store/filterStore";
import type { Shape } from "../store/spatialFilterStore";
import type { FilterSelectionConfig } from "../types/filterSelection";
import { resolveFilterSet } from "./resolveFilterSet";
import { resolveSpatialShapes } from "./resolveSpatialShapes";
import { aggregateSpatialTargetsByTable } from "./spatialTargets";

export type ExportRequestInput = {
  widgetId: number;
  config: Record<string, unknown>;
  sortField: string;
  sortDir: "asc" | "desc";
  options: ExportStartOptions;
  filters: Record<number, ActiveFilter[]>;
  dvFilters: Record<number, ActiveFilter[]>;
  shapes: Shape[];
  dashboardWidgets: WidgetDto[];
  dvScopeDisabled: boolean;
};

export function buildExportRequest(i: ExportRequestInput): StartExportBody {
  const sel = i.config.filterSelection as FilterSelectionConfig | undefined;
  const dvId = i.config.dynamicViewId;
  const tableId = i.config.tableId;
  let filters: ActiveFilter[] = [];
  let spatial: Pick<StartExportBody, "spatialFilters" | "spatialTarget"> = {};
  if (typeof dvId === "number") {
    // server checks dv FIRST (exportSql.ts:104)
    filters = resolveFilterSet(i.dvScopeDisabled ? undefined : sel, i.dvFilters[dvId] ?? []);
  } else if (typeof tableId === "number") {
    filters = resolveFilterSet(sel, i.filters[tableId] ?? []);
    const shapes = resolveSpatialShapes(sel, i.shapes);
    const target = aggregateSpatialTargetsByTable(i.dashboardWidgets).get(tableId);
    if (shapes.length > 0 && target) {
      spatial = { spatialFilters: shapes.map((s) => ({ id: s.id, wkt: s.wkt })), spatialTarget: target };
    }
  }
  return {
    widgetId: i.widgetId,
    filters,
    ...spatial,
    ...(i.sortField ? { sortField: i.sortField, sortDir: i.sortDir } : {}),
    options: { compress: i.options.compress, format: i.options.format, name: i.options.name.trim() },
  };
}
