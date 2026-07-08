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
    { key: "minBarSize", label: "Min Bar Size (px)", type: "number", defaultValue: 0, min: 0, max: 200, step: 1, group: "Appearance", hint: "Minimum thickness per bar (width for vertical, height for horizontal bars). When the bars can't all fit at this size, the chart scrolls. 0 = fit to widget." },
    { key: "stacked", label: "Stacked", type: "boolean", defaultValue: false, group: "Appearance", hint: "With 2+ group-by columns: stack the series instead of clustering them." },

    // Display
    { key: "showLegend", label: "Show Legend", type: "boolean", defaultValue: true, group: "Display" },
    { key: "showGrid", label: "Show Grid Lines", type: "boolean", defaultValue: true, group: "Display" },
    { key: "showTooltip", label: "Show Tooltip", type: "boolean", defaultValue: true, group: "Display" },
    { key: "showValueLabels", label: "Show Value Labels", type: "boolean", defaultValue: false, group: "Display", hint: "Print each bar's value at its end" },
    { key: "yAxisFormat", label: "Value-Axis Number Format", type: "formatSpec", defaultValue: null, group: "Display", hint: "Defaults to the metric column's format; pick Smart abbreviation for compact ticks (1.2M)" },
    { key: "yAxisScale", label: "Y-axis scale", type: "select",
      options: [
        { value: "", label: "Default" },
        { value: "zero", label: "Zero-based" },
        { value: "smart", label: "Smart" },
        { value: "log", label: "Logarithmic" },
      ],
      defaultValue: "", group: "Display",
      hint: "Zero-based forces a 0 baseline; Smart uses the data range; Logarithmic uses a log scale." },

    // Advanced
    { key: "customWhere", label: "Custom filter (SQL)", type: "textarea", defaultValue: "", group: "Advanced", hint: "Raw SQL predicate ANDed with active filters, e.g. region = 'West'. Leave empty for none." },
  ],
  defaultConfig: {
    yFieldLabel: "",
    xAxisLabel: "",
    yAxisLabel: "",
    horizontal: false,
    color: "#22c55e",
    barRadius: 4,
    minBarSize: 0,
    stacked: false,
    showLegend: true,
    showGrid: true,
    showTooltip: true,
    showValueLabels: false,
    yAxisFormat: null,
    yAxisScale: "",
    customWhere: "",
    // Phase 102 (BARGRP): ordered [col1(x-axis), col2..N(series)]; length<=1 → legacy single-groupByColumn path.
    groupByColumns: [] as string[],
  },
};

export default function register() {
  registerChartType(bar);
}
