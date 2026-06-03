import { registerChartType, type ChartTypeDefinition } from "../registry";

const line: ChartTypeDefinition = {
  type: "line",
  label: "Line Chart",
  icon: "~",
  supportsDrillDown: true,
  fields: [
    // Data
    { key: "yFieldLabel", label: "Y-Axis Label", type: "text", defaultValue: "", group: "Data" },

    // Appearance
    { key: "color", label: "Line Color", type: "color", defaultValue: "#38bdf8", group: "Appearance" },
    { key: "strokeWidth", label: "Line Width", type: "range", defaultValue: 2, min: 1, max: 6, step: 0.5, group: "Appearance" },
    { key: "curved", label: "Smooth Curve", type: "boolean", defaultValue: true, group: "Appearance" },
    { key: "showDots", label: "Show Data Points", type: "boolean", defaultValue: true, group: "Appearance" },
    { key: "fillArea", label: "Fill Area Under Line", type: "boolean", defaultValue: false, group: "Appearance" },

    // Display
    { key: "showLegend", label: "Show Legend", type: "boolean", defaultValue: true, group: "Display" },
    { key: "showGrid", label: "Show Grid Lines", type: "boolean", defaultValue: true, group: "Display" },
    { key: "showTooltip", label: "Show Tooltip", type: "boolean", defaultValue: true, group: "Display" },
  ],
  defaultConfig: {
    yFieldLabel: "",
    color: "#38bdf8",
    strokeWidth: 2,
    curved: true,
    showDots: true,
    fillArea: false,
    showLegend: true,
    showGrid: true,
    showTooltip: true,
  },
};

export default function register() {
  registerChartType(line);
}
