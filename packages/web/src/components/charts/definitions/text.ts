/**
 * kbi-mcp: Text widget — markdown titles, notes and findings on a dashboard (no data, no SQL).
 * Mirrors the legend precedent: usesAggregation false + a CustomConfigPanel.
 */

import { registerChartType, type ChartTypeDefinition } from "../registry";
import TextConfigPanel from "../TextConfigPanel";

const text: ChartTypeDefinition = {
  type: "text",
  label: "Text",
  icon: "TX",
  fields: [],
  defaultConfig: { markdown: "" },
  usesAggregation: false,
  supportsDrillDown: false,
  usesDataSource: false, // no table: the panel is just the markdown box
  CustomConfigPanel: TextConfigPanel,
};

export default function register() {
  registerChartType(text);
}
