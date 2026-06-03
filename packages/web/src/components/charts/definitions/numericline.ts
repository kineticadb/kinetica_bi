/**
 * Numeric Line chart type registry entry.
 *
 * The numeric analog of the Timeline chart: a numeric X-axis column auto-binned into a
 * target bucket count, with 1-4 metrics plotted as separate lines on alternating Y-axes.
 *
 * Mirrors the Timeline definition: CustomConfigPanel + usesDataSource:false + the registry
 * runs NO SQL (NumericLineRenderer owns its full SQL lifecycle).
 *
 * Short-circuit renderer wired in WidgetRenderer.tsx:
 *   else if (widget.type === "numericline") body = <NumericLineRenderer widget={widget} tables={tables} />
 */

import { registerChartType, type ChartTypeDefinition } from "../registry";
import NumericLineConfigPanel from "../NumericLineConfigPanel";
import { DEFAULT_COLOR_THEME } from "../TimelineConfigPanel";
import { DEFAULT_MAX_BUCKETS } from "../../../lib/numericBin";

const numericline: ChartTypeDefinition = {
  type: "numericline",
  label: "Numeric Line Chart",
  icon: "NL",
  fields: [],
  defaultConfig: {
    xField: "",
    metrics: [],
    maxBuckets: DEFAULT_MAX_BUCKETS,
    showLegend: true,
    showTooltip: true,
    vertical: false,
    colorTheme: DEFAULT_COLOR_THEME,
  },
  usesAggregation: false,
  usesDataSource: false, // NumericLineConfigPanel renders its own table picker
  supportsDrillDown: false,
  CustomConfigPanel: NumericLineConfigPanel,
};

export default function registerNumericLine() {
  registerChartType(numericline);
}
