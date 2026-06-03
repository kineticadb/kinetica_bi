import { registerChartType, type ChartTypeDefinition } from "../registry";

const bignumber: ChartTypeDefinition = {
  type: "bignumber",
  label: "Big Number",
  icon: "1",
  // Scalar — single AGG(metric) value. No Group By dimension; ChartConfigPanel
  // hides the picker and emits SQL of the form `SELECT AGG(metric) AS value FROM table`.
  requiresGroupBy: false,
  fields: [
    // Data
    { key: "label", label: "Label", type: "text", defaultValue: "", group: "Data" },
    { key: "subLabel", label: "Sub-label", type: "text", defaultValue: "", group: "Data" },

    // Formatting
    { key: "format", label: "Number Format", type: "select", defaultValue: "number", group: "Formatting", options: [
      { value: "number", label: "Plain Number" },
      { value: "percent", label: "Percentage" },
      { value: "currency", label: "Currency ($)" },
      { value: "compact", label: "Compact (1.2K)" },
      { value: "date", label: "Date" },
    ]},
    { key: "decimals", label: "Decimal Places", type: "number", defaultValue: 0, group: "Formatting" },
    { key: "prefix", label: "Prefix", type: "text", defaultValue: "", group: "Formatting" },
    { key: "suffix", label: "Suffix", type: "text", defaultValue: "", group: "Formatting" },

    // Appearance
    { key: "color", label: "Value Color", type: "color", defaultValue: "#22c55e", group: "Appearance" },
    { key: "colorRules", label: "Color by value range", type: "colorRules", defaultValue: [], group: "Appearance",
      hint: "Override the value color when it falls in a range. First matching rule wins; leave Min or Max blank for an open end." },
    { key: "showDelta", label: "Show Delta", type: "boolean", defaultValue: false, group: "Appearance" },
    { key: "deltaField", label: "Delta Field", type: "text", defaultValue: "", group: "Appearance", hint: "Column for the comparison value" },
  ],
  defaultConfig: {
    label: "",
    subLabel: "",
    format: "number",
    decimals: 0,
    prefix: "",
    suffix: "",
    color: "#22c55e",
    colorRules: [],
    showDelta: false,
    deltaField: "",
  },
};

export default function register() {
  registerChartType(bignumber);
}
