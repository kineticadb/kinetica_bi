import { registerChartType, type ChartTypeDefinition } from "../registry";

/**
 * 137 (AIWID-V20-01): AI Assistant widget; no SQL, no drill, no filters. Rendered by
 * AiWidgetRenderer (137-10). Adding it is gated on ai:use (UI 137-11, server 137-01).
 */
const ai: ChartTypeDefinition = {
  type: "ai",
  label: "AI Assistant",
  icon: "AI",
  fields: [],
  defaultConfig: {},
  usesAggregation: false,
  usesDataSource: false,
  supportsDrillDown: false,
};

export default function register() {
  registerChartType(ai);
}
