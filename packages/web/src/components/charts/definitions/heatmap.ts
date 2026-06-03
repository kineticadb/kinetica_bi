import { registerChartType, type ChartTypeDefinition } from "../registry";

const heatmap: ChartTypeDefinition = {
  type: "heatmap",
  label: "Heatmap",
  icon: "[]",
  fields: [
    // Data

    // Appearance
    { key: "colorMin", label: "Min Color", type: "color", defaultValue: "#0f172a", group: "Appearance" },
    { key: "colorMax", label: "Max Color", type: "color", defaultValue: "#22c55e", group: "Appearance" },
    { key: "showValues", label: "Show Values in Cells", type: "boolean", defaultValue: true, group: "Appearance" },
    { key: "borderRadius", label: "Cell Radius", type: "range", defaultValue: 2, min: 0, max: 10, step: 1, group: "Appearance" },

    // Display
    { key: "showLegend", label: "Show Legend", type: "boolean", defaultValue: true, group: "Display" },
    { key: "showTooltip", label: "Show Tooltip", type: "boolean", defaultValue: true, group: "Display" },
  ],
  defaultConfig: {
    colorMin: "#0f172a",
    colorMax: "#22c55e",
    showValues: true,
    borderRadius: 2,
    showLegend: true,
    showTooltip: true,
  },
};

export default function register() {
  registerChartType(heatmap);
}
