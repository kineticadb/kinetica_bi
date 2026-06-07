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
    { key: "compact", label: "Compact Mode", type: "boolean", defaultValue: false, group: "Display" },
    { key: "enableCsvDownload", label: "Enable CSV Download", type: "boolean", defaultValue: true, group: "Display" },
    { key: "csvDownloadRowCap", label: "CSV Download Row Cap", type: "number", defaultValue: 100000, group: "Display", hint: "Maximum rows to export (min 1)" },
  ],
  defaultConfig: {
    columns: "",
    sortField: "",
    sortDirection: "asc",
    pageSize: 25,
    striped: true,
    compact: false,
    enableCsvDownload: true,
    csvDownloadRowCap: 100000,
  },
};

export default function register() {
  registerChartType(records);
}
