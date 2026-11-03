/**
 * Allow-list key -> renderer key translation (GAP-134-01).
 *
 * The widget allow-list (packages/shared/src/actionAllowList.ts) names fields in snake_case
 * (show_popup, show_scale_bar, show_fullscreen, page_size). Those names are the PERSISTED contract
 * of v1.11 radio options and the AI op schema, so they must NOT be renamed. The renderers, however,
 * read different keys (showScaleBar, showFullscreenButton, infoEnabled, pageSize). Without this
 * translation an overlay merged into widget.config under the snake keys is never read.
 *
 * Unmapped keys (e.g. includedLayerIds written by foldSession) pass through unchanged.
 */
import { paletteColor } from "./aiPalette";

/**
 * Phase 136 (D-19, TD-V20-ALLOWLIST-KEYS): chart allow-list names (metric, aggregation lowercase,
 * color palette name) are translated here to what the renderers read (metricColumn, UPPERCASE
 * aggregation, the type's real colour key holding a palette colour). Colours only ever become
 * palette colours: an unknown name is dropped.
 */
export const WIDGET_OVERLAY_KEY_MAP: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  map: {
    show_scale_bar: "showScaleBar",
    show_fullscreen: "showFullscreenButton",
    show_popup: "infoEnabled",
  },
  records: { page_size: "pageSize" },
  bar: { metric: "metricColumn" },
  line: { metric: "metricColumn" },
  bignumber: { metric: "metricColumn" },
  pie: { metric: "metricColumn", color: "color1" },
  table: { metric: "metricColumn", color: "barColor" },
};

const CHART_TYPES = new Set(["bar", "line", "pie", "table", "bignumber"]);

/** Applied by allow-list key BEFORE renaming; returning undefined drops the key. */
export const WIDGET_VALUE_TRANSFORMS: Record<string, (v: unknown) => unknown> = {
  aggregation: (v) => String(v).toUpperCase(),
  color: (v) => paletteColor(String(v)),
};

/** Renderer keys whose change requires regenerated SQL. */
export const CHART_SQL_KEYS = ["metricColumn", "aggregation", "groupByColumn", "sortDir", "limit", "metricId"] as const;

export function overlayTouchesChartSql(translated: Record<string, unknown>): boolean {
  return CHART_SQL_KEYS.some((k) => Object.prototype.hasOwnProperty.call(translated, k));
}

export function translateWidgetOverlay(
  widgetType: string,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const map = WIDGET_OVERLAY_KEY_MAP[widgetType];
  const isChart = CHART_TYPES.has(widgetType);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    let value = patch[key];
    if (isChart && Object.prototype.hasOwnProperty.call(WIDGET_VALUE_TRANSFORMS, key)) {
      value = WIDGET_VALUE_TRANSFORMS[key](value);
      if (value === undefined) continue;
    }
    out[map?.[key] ?? key] = value;
  }
  // Pitfall 2: a numeric metricId keeps the custom expression and would ignore a metric/aggregation edit.
  if (isChart && ("metric" in patch || "aggregation" in patch)) out.metricId = null;
  return out;
}
