/**
 * v1.7 Phase 42 Plan 02 (WIDGET-V17-01): Legend chart type registry entry.
 *
 * Mirrors v1.4 Phase 23 info-card precedent:
 *   - icon: "LG" (2-char text, matches info-card's "IC")
 *   - usesAggregation: false (no SQL)
 *   - supportsDrillDown: false (no row context)
 *   - defaultConfig: {} (sourceMapWidgetId set via LegendConfigPanel auto-pick)
 *
 * Key difference: includes CustomConfigPanel for the source-map-widget dropdown.
 */

import { registerChartType, type ChartTypeDefinition } from "../registry";
import LegendConfigPanel from "../LegendConfigPanel";

const legend: ChartTypeDefinition = {
  type: "legend",
  label: "Legend",
  icon: "LG",
  fields: [],
  defaultConfig: {},
  usesAggregation: false,
  supportsDrillDown: false,
  CustomConfigPanel: LegendConfigPanel,
};

export default function register() {
  registerChartType(legend);
}
