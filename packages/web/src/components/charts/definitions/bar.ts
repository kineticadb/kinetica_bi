import { registerChartType, type ChartTypeDefinition } from "../registry";

const bar: ChartTypeDefinition = {
  type: "bar",
  label: "Bar Chart",
  icon: "|||",
  supportsDrillDown: true,
  fields: [
    // Data
    { key: "yFieldLabel", label: "Series Name", type: "text", defaultValue: "", group: "Data", hint: "Legend/tooltip name for the bars" },
    { key: "xAxisLabel", label: "X-Axis Label", type: "text", defaultValue: "", group: "Data" },
    { key: "yAxisLabel", label: "Y-Axis Label", type: "text", defaultValue: "", group: "Data" },

    // Appearance
    { key: "horizontal", label: "Horizontal Bars", type: "boolean", defaultValue: false, group: "Appearance" },
    { key: "color", label: "Bar Color", type: "color", defaultValue: "#22c55e", group: "Appearance" },
    { key: "barRadius", label: "Corner Radius", type: "range", defaultValue: 4, min: 0, max: 20, step: 1, group: "Appearance" },
    { key: "stacked", label: "Stacked", type: "boolean", defaultValue: false, group: "Appearance" },

    // Display
    { key: "showLegend", label: "Show Legend", type: "boolean", defaultValue: true, group: "Display" },
    { key: "showGrid", label: "Show Grid Lines", type: "boolean", defaultValue: true, group: "Display" },
    { key: "showTooltip", label: "Show Tooltip", type: "boolean", defaultValue: true, group: "Display" },
    { key: "showValueLabels", label: "Show Value Labels", type: "boolean", defaultValue: false, group: "Display", hint: "Print each bar's value at its end" },
    { key: "yAxisFormat", label: "Value-Axis Number Format", type: "formatSpec", defaultValue: null, group: "Display", hint: "Defaults to the metric column's format; pick Smart abbreviation for compact ticks (1.2M)" },
  ],
  defaultConfig: {
    yFieldLabel: "",
    xAxisLabel: "",
    yAxisLabel: "",
    horizontal: false,
    color: "#22c55e",
    barRadius: 4,
    stacked: false,
    showLegend: true,
    showGrid: true,
    showTooltip: true,
    showValueLabels: false,
    yAxisFormat: null,
  },
};

export default function register() {
  registerChartType(bar);
}
