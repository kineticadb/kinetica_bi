import { registerChartType, type ChartTypeDefinition } from "../registry";

const table: ChartTypeDefinition = {
  type: "table",
  label: "Data Table",
  icon: "#",
  supportsDrillDown: true,
  fields: [
    // Display — the Data Table is an aggregated (group-by + value) view, so record-oriented
    // options (columns list, row numbers, default sort field/direction) don't apply here;
    // rows are ordered by value from the aggregation SQL and capped by the shared "Result
    // limit" (LIMIT) — there's no pagination, so no separate "Rows Per Page". See RecordsTable.
    { key: "compact", label: "Compact Mode", type: "boolean", defaultValue: true, group: "Display" },

    // Value-bar overlay — each numeric metric cell gets a translucent gradient
    // bar whose width is normalized to the column's max (per-column scaling).
    // Color is user-configurable; default matches the Reveal Data Table look.
    { key: "showValueBars", label: "Show Value Bars", type: "boolean", defaultValue: true, group: "Display" },
    { key: "barColor", label: "Bar Color", type: "color", defaultValue: "#8b5cf6", group: "Display" },

    // Advanced
    { key: "customWhere", label: "Custom filter (SQL)", type: "textarea", defaultValue: "", group: "Advanced", hint: "Raw SQL predicate ANDed with active filters, e.g. region = 'West'. Leave empty for none." },
  ],
  defaultConfig: {
    compact: true,
    showValueBars: true,
    barColor: "#8b5cf6",
    customWhere: "",
    // Multi-column GROUP BY (mirrors bar): ordered list of columns; each becomes a table
    // column. length<=1 falls through to the legacy single-`groupByColumn` path.
    groupByColumns: [] as string[],
  },
};

export default function register() {
  registerChartType(table);
}
