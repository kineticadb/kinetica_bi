import { registerChartType, type ChartTypeDefinition } from "../registry";

const records: ChartTypeDefinition = {
  type: "records",
  label: "Records Table",
  icon: "[R]",
  supportsDrillDown: true,
  usesAggregation: false,
  fields: [
    { key: "columns", label: "Columns (comma-separated)", type: "text", defaultValue: "", group: "Data", hint: "Leave empty to show all columns" },
    { key: "sortField", label: "Default Sort Field", type: "text", defaultValue: "", group: "Display", hint: "Column name to sort by on initial load" },
    { key: "sortDirection", label: "Sort Direction", type: "select", defaultValue: "asc", group: "Display", options: [
      { value: "asc", label: "Ascending" },
      { value: "desc", label: "Descending" },
    ]},
    { key: "pageSize", label: "Records Per Page", type: "number", defaultValue: 25, group: "Display" },
    { key: "striped", label: "Striped Rows", type: "boolean", defaultValue: true, group: "Display" },
    { key: "compact", label: "Compact Mode", type: "boolean", defaultValue: true, group: "Display" },
    { key: "enableCsvDownload", label: "Enable CSV Download", type: "boolean", defaultValue: true, group: "Display" },
    { key: "csvDownloadRowCap", label: "CSV Download Row Cap", type: "number", defaultValue: 100000, group: "Display", hint: "Maximum rows to export (min 1)" },

    // Advanced
    { key: "customWhere", label: "Custom filter (SQL)", type: "textarea", defaultValue: "", group: "Advanced", hint: "Raw SQL predicate ANDed with active filters, e.g. region = 'West'. Leave empty for none." },
  ],
  defaultConfig: {
    columns: "",
    sortField: "",
    sortDirection: "asc",
    pageSize: 25,
    striped: true,
    compact: true,
    enableCsvDownload: true,
    csvDownloadRowCap: 100000,
    customWhere: "",
  },
};

export default function register() {
  registerChartType(records);
}
