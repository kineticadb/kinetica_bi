/**
 * chartTheme — single allowlisted home for data-visualization color literals and the
 * shared Recharts tooltip style.
 *
 * The hex values here are legitimately literal: they are the bright series/category
 * colors used to PAINT chart data (not app chrome). Theme tokens (var(--accent), etc.)
 * resolve to readable-on-surface chrome colors and are not appropriate for dense data
 * marks, so the data-viz defaults live here as the one place a reviewer looks for them.
 *
 * Chrome/status colors (text, borders, danger/warning) must use theme tokens, NOT this file.
 */

/**
 * Shared contentStyle for every Recharts <Tooltip>. Spread as
 * `<Tooltip {...RECHARTS_TOOLTIP_PROPS} />`. Uses theme tokens so the tooltip surface
 * tracks light/dark mode. itemStyle/labelStyle are intentionally NOT included — most
 * charts want the bright series color for the item line; the pie chart adds those
 * explicitly after spreading these props.
 */
export const RECHARTS_TOOLTIP_PROPS = {
  contentStyle: {
    background: "var(--panel)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    color: "var(--text)",
  },
} as const;

/** Categorical palette for pie/multi-series charts (cycled per slice/series). */
export const DEFAULT_CHART_PALETTE: string[] = [
  "#22c55e",
  "#38bdf8",
  "#a855f7",
  "#f59e0b",
  "#f97316",
  "#ef4444",
];

/** Per-chart single-series fallback colors (used when no explicit color is configured). */
export const DEFAULT_BAR_COLOR = "#22c55e";
export const DEFAULT_LINE_COLOR = "#38bdf8";
export const DEFAULT_AREA_COLOR = "#38bdf8";
export const DEFAULT_SCATTER_COLOR = "#a855f7";
/** Data-table value-bar fill. */
export const DEFAULT_TABLE_BAR_COLOR = "#8b5cf6";
/** Big-number value color fallback. */
export const DEFAULT_BIGNUMBER_COLOR = "#22c55e";
