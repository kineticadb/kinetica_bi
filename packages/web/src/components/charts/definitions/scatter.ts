import { registerChartType, type ChartTypeDefinition } from "../registry";

const scatter: ChartTypeDefinition = {
  type: "scatter",
  label: "Scatter Plot",
  icon: ".:.",
  supportsDrillDown: true,
  fields: [
    // Data
    { key: "xLabel", label: "X-Axis Label", type: "text", defaultValue: "", group: "Data" },
    { key: "yLabel", label: "Y-Axis Label", type: "text", defaultValue: "", group: "Data" },

    // Appearance
    { key: "color", label: "Dot Color", type: "color", defaultValue: "#a855f7", group: "Appearance" },
    { key: "dotSize", label: "Dot Size", type: "range", defaultValue: 6, min: 2, max: 20, step: 1, group: "Appearance" },

    // Display
    { key: "showLegend", label: "Show Legend", type: "boolean", defaultValue: false, group: "Display" },
    { key: "showGrid", label: "Show Grid Lines", type: "boolean", defaultValue: true, group: "Display" },
    { key: "showTooltip", label: "Show Tooltip", type: "boolean", defaultValue: true, group: "Display" },
  ],
  defaultConfig: {
    xLabel: "",
    yLabel: "",
    color: "#a855f7",
    dotSize: 6,
    showLegend: false,
    showGrid: true,
    showTooltip: true,
  },
};

export default function register() {
  registerChartType(scatter);
}
