import { registerChartType, type ChartTypeDefinition } from "../registry";

const pie: ChartTypeDefinition = {
  type: "pie",
  label: "Pie Chart",
  icon: "O",
  supportsDrillDown: true,
  fields: [
    // Data (these are auto-mapped from groupByColumn and metricColumn)

    // Appearance
    { key: "innerRadius", label: "Inner Radius (Donut)", type: "range", defaultValue: 0, min: 0, max: 80, step: 5, group: "Appearance", hint: "Set > 0 for a donut chart" },
    { key: "padAngle", label: "Pad Angle", type: "range", defaultValue: 2, min: 0, max: 10, step: 1, group: "Appearance" },
    { key: "showLabels", label: "Show Labels", type: "boolean", defaultValue: true, group: "Appearance" },

    // Colors
    { key: "color1", label: "Color 1", type: "color", defaultValue: "#22c55e", group: "Color Palette" },
    { key: "color2", label: "Color 2", type: "color", defaultValue: "#38bdf8", group: "Color Palette" },
    { key: "color3", label: "Color 3", type: "color", defaultValue: "#a855f7", group: "Color Palette" },
    { key: "color4", label: "Color 4", type: "color", defaultValue: "#f59e0b", group: "Color Palette" },
    { key: "color5", label: "Color 5", type: "color", defaultValue: "#f97316", group: "Color Palette" },
    { key: "color6", label: "Color 6", type: "color", defaultValue: "#ef4444", group: "Color Palette" },

    // Display
    { key: "showLegend", label: "Show Legend", type: "boolean", defaultValue: true, group: "Display" },
    { key: "showTooltip", label: "Show Tooltip", type: "boolean", defaultValue: true, group: "Display" },

    // Advanced
    { key: "customWhere", label: "Custom filter (SQL)", type: "textarea", defaultValue: "", group: "Advanced", hint: "Raw SQL predicate ANDed with active filters, e.g. region = 'West'. Leave empty for none." },
  ],
  defaultConfig: {
    innerRadius: 0,
    padAngle: 2,
    showLabels: true,
    color1: "#22c55e",
    color2: "#38bdf8",
    color3: "#a855f7",
    color4: "#f59e0b",
    color5: "#f97316",
    color6: "#ef4444",
    showLegend: true,
    showTooltip: true,
    customWhere: "",
  },
};

export default function register() {
  registerChartType(pie);
}
