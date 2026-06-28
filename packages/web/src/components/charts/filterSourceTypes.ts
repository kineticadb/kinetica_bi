/**
 * filterSourceTypes.ts — Phase 93 (FSCOPE-V118-01)
 *
 * Explicit enumeration of widget types that PRODUCE filter events.
 * "records" is intentionally EXCLUDED — it is a filter TARGET (drill-down reads rows),
 * never a filter SOURCE.
 *
 * Excluded non-sources: legend, info-card, map, bignumber, heatmap, radio-group.
 * Included sources: bar, line, pie, scatter, table (supportsDrillDown:true in registry),
 *   plus datafilter (always a source), calendar/timeline/numericline (custom gestures).
 */

/**
 * Set of widget `type` strings that actively emit filter events (drill-down clicks,
 * drag-to-filter gestures, or DataFilter selections). Used by FilterSelectionPanel
 * to build the allow-list checklist.
 */
export const FILTER_PRODUCING_TYPES = new Set([
  "bar",
  "line",
  "pie",
  "scatter",
  "table",
  "datafilter",
  "calendar",
  "timeline",
  "numericline",
]);

/**
 * Returns true when `type` is a filter-producing widget type.
 */
export function isFilterProducingWidget(type: string): boolean {
  return FILTER_PRODUCING_TYPES.has(type);
}

/**
 * Reserved, NON-widget id representing "map spatial draws" in allowedSourceWidgetIds.
 * A dashboard-global / per-table source that is NOT any real widget id.
 *
 * Phase 93 STORES this sentinel in widget.config.filterSelection only.
 * Phase 93.5's resolver branches on this string value vs numeric widget ids to apply
 * spatial shape filtering.
 */
export const SPATIAL_DRAWS_SENTINEL = "__spatial_draws__";
