import type { ActiveFilter } from "../store/filterStore";
import type { FilterSelectionConfig } from "../types/filterSelection";
import { DEFAULT_FILTER_SELECTION } from "../types/filterSelection";

// Pure: resolved filter set = source-allow-list ∩ active filters.
// Absent/default ("all") config → returns ALL active filters unchanged (accept-all, v1.17-identical).
// Never mutates its inputs. Preserves the relative order of allFilters.
export function resolveFilterSet(
  cfg: FilterSelectionConfig | undefined,
  allFilters: ActiveFilter[],
): ActiveFilter[] {
  const sel = cfg ?? DEFAULT_FILTER_SELECTION;
  if (sel.sourceMode === "all") return allFilters.slice();
  const allowed = new Set(sel.allowedSourceWidgetIds);
  return allFilters.filter(
    (f) => f.sourceWidgetId !== undefined && allowed.has(f.sourceWidgetId),
  );
}
