/**
 * v1.7 Phase 44 Plan 02 (FILTER-V17-07): Data Filter chart type registry entry.
 *
 * Mirrors v1.7 Phase 42 legend precedent — CustomConfigPanel + no SQL + no drill-down:
 *   - icon: "DF" (2-char text, matches legend's "LG", info-card's "IC")
 *   - usesAggregation: false (widget runs no SQL — it dispatches into useFilterStore on Apply)
 *   - usesDataSource: false (DataFilterConfigPanel renders its OWN base-table picker; suppresses
 *     ChartConfigPanel's generic Data Source section to avoid a duplicate picker)
 *   - supportsDrillDown: false (widget is the filter source, not a drill-down target)
 *   - defaultConfig: { filterFields: [] } — empty rows on creation; operator adds fields manually
 *
 * Short-circuit renderer wired in Plan 44-03 via:
 *   else if (widget.type === "datafilter") body = <DataFilterRenderer widget={widget} />
 */

import { registerChartType, type ChartTypeDefinition } from "../registry";
import DataFilterConfigPanel from "../DataFilterConfigPanel";

const dataFilter: ChartTypeDefinition = {
  type: "datafilter",
  label: "Data Filter",
  icon: "DF",
  fields: [],
  defaultConfig: {
    filterFields: [], // start with no rows; operator clicks "Add filter field" to add rows
  },
  usesAggregation: false,
  usesDataSource: false, // DataFilterConfigPanel renders its own table picker
  supportsDrillDown: false,
  CustomConfigPanel: DataFilterConfigPanel,
};

export default function registerDataFilter() {
  registerChartType(dataFilter);
}
