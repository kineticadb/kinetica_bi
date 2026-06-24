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
 *
 * NOTE: Keep using CSS vars here — the Tooltip renders as an HTML <div>, not an SVG
 * element, so var() resolves correctly (RESEARCH Pitfall 4). Do NOT flatten to JS hex.
 */
export const RECHARTS_TOOLTIP_PROPS = {
  contentStyle: {
    // --panel is translucent glass; tooltips need an OPAQUE surface so the chart
    // behind them doesn't bleed through and make the text unreadable. --panel-solid
    // is the same near-opaque surface used by modal content.
    background: "var(--panel-solid)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    color: "var(--text)",
  },
} as const;

/**
 * Aurora brand-led categorical palette — violet-anchored, colorblind-aware, distinct hues.
 *
 * Series hues are the SAME across dark/light modes (hue is the discriminator, not
 * brightness) and must resolve synchronously at render time — hence a TS const rather
 * than getComputedStyle (RESEARCH Pattern 2 Option B).
 *
 * Colorblind-aware design:
 *  - Violet (#7f40ed) + sky blue (#38bdf8): differ in hue AND luminance.
 *  - Teal (#2dd4bf) + amber (#f59e0b): warm/cool contrast pair — safe for deuteranopia/protanopia.
 *  - Pink (#f472b6) + lime (#a3e635): perceptual distance from the violet/blue anchor.
 *  The palette never relies on red-vs-green alone.
 *
 * This is the DEFAULT/fallback when a widget hasn't set its own colors. Existing per-chart
 * color pickers and per-value class-break coloring are UNTOUCHED.
 */
export const AURORA_CHART_PALETTE: string[] = [
  "#7f40ed", // series-1: Kinetica violet (brand anchor)
  "#38bdf8", // series-2: sky blue (matches --accent-2 dark)
  "#2dd4bf", // series-3: teal
  "#f59e0b", // series-4: amber
  "#f472b6", // series-5: pink
  "#a3e635", // series-6: lime
];

/**
 * Categorical palette for pie/multi-series charts (cycled per slice/series).
 * Re-exports AURORA_CHART_PALETTE values for backward compat — consumers already
 * importing DEFAULT_CHART_PALETTE continue to work unchanged.
 */
export const DEFAULT_CHART_PALETTE: string[] = AURORA_CHART_PALETTE;

/** Per-chart single-series fallback colors — index into AURORA_CHART_PALETTE. */
export const DEFAULT_BAR_COLOR = AURORA_CHART_PALETTE[0];       // violet (brand)
export const DEFAULT_LINE_COLOR = AURORA_CHART_PALETTE[1];      // sky blue
export const DEFAULT_AREA_COLOR = AURORA_CHART_PALETTE[1];      // sky blue
export const DEFAULT_SCATTER_COLOR = AURORA_CHART_PALETTE[2];   // teal
/** Data-table value-bar fill. */
export const DEFAULT_TABLE_BAR_COLOR = AURORA_CHART_PALETTE[0]; // violet (brand)
/** Big-number value color fallback. */
export const DEFAULT_BIGNUMBER_COLOR = AURORA_CHART_PALETTE[0]; // violet (brand)
