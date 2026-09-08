/**
 * Heatmap chart-type registry entry.
 *
 * Was `addable: false` ("retired from the add-visualization picker (no
 * renderer)") — HeatmapRenderer now exists, so the type is addable again and its
 * old Min/Max-color fields are replaced by a ColorBrewer theme picker.
 *
 * Deliberately rides the STANDARD aggregated path rather than owning its data
 * lifecycle the way calendar/timeline do:
 *   - usesAggregation: true  -> ChartConfigPanel shows Metric + Aggregation and
 *     emits the shared `SELECT x, y, AGG(m) AS value ... GROUP BY x, y` SQL
 *   - requiresGroupBy: true  -> the multi-column Group By builder supplies the
 *     two dimensions; column 1 = X axis, column 2 = Y axis (ChartConfigPanel's
 *     `isHeatmap` branch caps the builder at 2 and labels them accordingly)
 * so filters, dynamic-view binding, FROM-swap and materialize all come for free
 * and behave exactly as they do for bar/line/pie.
 *
 * supportsDrillDown stays false: the generic drill dispatches ONE column, but a
 * heatmap cell is a 2-dimension intersection, so a click would silently filter
 * on X only and misrepresent what the operator clicked.
 */

import { registerChartType, type ChartTypeDefinition } from "../registry";
import {
  DEFAULT_HEATMAP_COLOR_THEME,
  HEATMAP_COLOR_THEMES,
} from "../../../lib/heatmapColorScale";

/** Label every Nth tick — a 24-value axis crowds its labels otherwise. */
const INTERVAL_OPTIONS = [1, 2, 3, 4, 6, 12].map((n) => ({
  value: String(n),
  label: String(n),
}));

const heatmap: ChartTypeDefinition = {
  type: "heatmap",
  label: "Heatmap",
  icon: "HM",
  usesAggregation: true,
  requiresGroupBy: true,
  supportsDrillDown: false,
  fields: [
    // Data
    { key: "xAxisLabel", label: "X Axis Label", type: "text", defaultValue: "", group: "Data" },
    { key: "yAxisLabel", label: "Y Axis Label", type: "text", defaultValue: "", group: "Data" },

    // Appearance
    {
      key: "colorTheme",
      label: "Color Theme",
      type: "select",
      options: HEATMAP_COLOR_THEMES.map((t) => ({
        value: t.id,
        label: `${t.label} (${t.group})`,
      })),
      defaultValue: DEFAULT_HEATMAP_COLOR_THEME,
      group: "Appearance",
      hint: "ColorBrewer sequential + diverging scales. Qualitative palettes are excluded — they cannot encode magnitude.",
    },
    {
      key: "reverseColors",
      label: "Reverse Color Scale",
      type: "boolean",
      defaultValue: true,
      group: "Appearance",
      hint: "RdYlBu runs red→blue; reversed (the default) paints HIGH values red.",
    },
    {
      key: "rendering",
      label: "Rendering",
      type: "select",
      options: [
        { value: "pixelated", label: "pixelated (Sharp)" },
        { value: "smooth", label: "smooth" },
      ],
      defaultValue: "pixelated",
      group: "Appearance",
      hint: "Sharp gives hard cell edges; smooth lets the renderer antialias cell boundaries.",
    },
    {
      key: "normalizeAcross",
      label: "Normalize Across",
      type: "select",
      options: [
        { value: "heatmap", label: "heatmap" },
        { value: "x", label: "x (per column)" },
        { value: "y", label: "y (per row)" },
      ],
      defaultValue: "heatmap",
      group: "Appearance",
      hint: "Which cells share a color scale. Per-column/per-row reveals contrast when one band dwarfs the rest.",
    },

    // Display
    {
      key: "xScaleInterval",
      label: "XScale Interval",
      type: "select",
      options: INTERVAL_OPTIONS,
      defaultValue: "1",
      group: "Display",
      hint: "Draw every Nth X tick label.",
    },
    {
      key: "yScaleInterval",
      label: "YScale Interval",
      type: "select",
      options: INTERVAL_OPTIONS,
      defaultValue: "1",
      group: "Display",
      hint: "Draw every Nth Y tick label.",
    },
    { key: "showLegend", label: "Show Legend", type: "boolean", defaultValue: true, group: "Display" },
    { key: "showTooltip", label: "Show Tooltip", type: "boolean", defaultValue: true, group: "Display" },
    {
      key: "showValues",
      label: "Show Values in Cells",
      type: "boolean",
      defaultValue: false,
      group: "Display",
      hint: "Only drawn where cells are wide enough to stay legible.",
    },
    {
      key: "valueFormat",
      label: "Value Number Format",
      type: "formatSpec",
      defaultValue: null,
      group: "Display",
      hint: "Defaults to the metric column's format; Smart abbreviation keeps tooltips compact (1.2M).",
    },

    // Advanced
    {
      key: "customWhere",
      label: "Where Expression",
      type: "textarea",
      defaultValue: "",
      group: "Advanced",
      hint: "Raw SQL predicate ANDed with active filters, e.g. region = 'West'. Leave empty for none.",
    },
  ],
  defaultConfig: {
    xAxisLabel: "",
    yAxisLabel: "",
    colorTheme: DEFAULT_HEATMAP_COLOR_THEME,
    reverseColors: true,
    rendering: "pixelated",
    normalizeAcross: "heatmap",
    xScaleInterval: "1",
    yScaleInterval: "1",
    showLegend: true,
    showTooltip: true,
    showValues: false,
    valueFormat: null,
    customWhere: "",
    // Ordered [xColumn, yColumn] — same field the multi-column bar/table path uses.
    groupByColumns: [] as string[],
  },
};

export default function register() {
  registerChartType(heatmap);
}
