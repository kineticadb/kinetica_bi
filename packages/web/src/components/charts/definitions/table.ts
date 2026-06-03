import { registerChartType, type ChartTypeDefinition } from "../registry";

const table: ChartTypeDefinition = {
  type: "table",
  label: "Data Table",
  icon: "#",
  supportsDrillDown: true,
  fields: [
    // Data
    { key: "columns", label: "Columns (comma-separated)", type: "text", defaultValue: "", group: "Data", hint: "Leave empty to show all columns" },

    // Display
    { key: "pageSize", label: "Rows Per Page", type: "number", defaultValue: 25, group: "Display" },
    { key: "striped", label: "Striped Rows", type: "boolean", defaultValue: true, group: "Display" },
    { key: "compact", label: "Compact Mode", type: "boolean", defaultValue: false, group: "Display" },
    { key: "showRowNumbers", label: "Show Row Numbers", type: "boolean", defaultValue: false, group: "Display" },
    { key: "sortField", label: "Default Sort Field", type: "text", defaultValue: "", group: "Display" },
    { key: "sortDirection", label: "Sort Direction", type: "select", defaultValue: "asc", group: "Display", options: [
      { value: "asc", label: "Ascending" },
      { value: "desc", label: "Descending" },
    ]},

    // Value-bar overlay — each numeric metric cell gets a translucent gradient
    // bar whose width is normalized to the column's max (per-column scaling).
    // Color is user-configurable; default matches the Reveal Data Table look.
    { key: "showValueBars", label: "Show Value Bars", type: "boolean", defaultValue: true, group: "Display" },
    { key: "barColor", label: "Bar Color", type: "color", defaultValue: "#8b5cf6", group: "Display" },
  ],
  defaultConfig: {
    columns: "",
    pageSize: 25,
    striped: true,
    compact: false,
    showRowNumbers: false,
    sortField: "",
    sortDirection: "asc",
    showValueBars: true,
    barColor: "#8b5cf6",
  },
};

export default function register() {
  registerChartType(table);
}
