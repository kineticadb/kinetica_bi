/**
 * Pure continuous color-ramp helpers for HeatmapRenderer.
 *
 * PURE module — zero React/Zustand imports. Mirrors calendarColorScale.ts, but
 * CONTINUOUS rather than 5-bucket: a dense value-per-cell grid reads as a smooth
 * gradient (see the reference design), which discrete buckets cannot express.
 *
 * Why not reuse themeColorsFor() directly: when the requested count exceeds the
 * theme's largest ColorBrewer variant it REPEATS colors modulo, which would make
 * a ramp cycle back to its start mid-scale. Here the theme's largest variant is
 * used as interpolation STOPS instead, so any resolution stays monotonic.
 */

import { getCbColorTheme, CB_COLOR_THEMES } from "./cbColorThemes";

/** ColorBrewer diverging scheme used by the reference design. */
export const DEFAULT_HEATMAP_COLOR_THEME = "RdYlBu";

/** Legend swatch count — display only; cell fills use the continuous ramp. */
export const HEATMAP_LEGEND_STEPS = 9;

/** Themes offered in the Color Theme picker: ordered scales only. */
export const HEATMAP_COLOR_THEMES = CB_COLOR_THEMES.filter(
  (t) => t.group === "Sequential" || t.group === "Diverging",
);

type Rgb = { r: number; g: number; b: number };

const parseRgb = (rrggbb: string): Rgb => {
  const h = rrggbb.replace(/^#/, "").replace(/^FF(?=[0-9a-fA-F]{6}$)/, "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
};

const toHex = ({ r, g, b }: Rgb): string =>
  "#" + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");

/**
 * Resolve a theme's interpolation stops as "#rrggbb", low→high.
 *
 * `reverse` flips them, which matters for diverging schemes: RdYlBu runs
 * red→blue, but the reference design paints HIGH values red, so the default
 * heatmap config reverses it.
 */
export function heatmapStops(themeId: string, reverse = false): string[] {
  const theme = getCbColorTheme(themeId) ?? getCbColorTheme(DEFAULT_HEATMAP_COLOR_THEME);
  if (!theme) return ["#2166ac", "#f7f7f7", "#b2182b"];
  const counts = Object.keys(theme.byCount).map(Number).sort((a, b) => a - b);
  const stops = theme.byCount[counts[counts.length - 1]].map((c) => toHex(parseRgb(c)));
  return reverse ? [...stops].reverse() : stops;
}

/**
 * Sample a ramp at t, linearly interpolating between adjacent stops.
 * t is clamped to [0,1]; a non-finite t returns the first stop.
 */
export function sampleRamp(stops: string[], t: number): string {
  if (stops.length === 0) return "#000000";
  if (stops.length === 1) return stops[0];
  if (!Number.isFinite(t)) return stops[0];
  const clamped = Math.min(1, Math.max(0, t));
  const scaled = clamped * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(scaled));
  const frac = scaled - i;
  const a = parseRgb(stops[i]);
  const b = parseRgb(stops[i + 1]);
  return toHex({
    r: a.r + (b.r - a.r) * frac,
    g: a.g + (b.g - a.g) * frac,
    b: a.b + (b.b - a.b) * frac,
  });
}

/**
 * Normalize `value` into [0,1] over [min,max].
 * A degenerate domain (max === min) maps to 0.5 — the ramp's midpoint — so a
 * single-valued grid renders one flat mid color instead of an arbitrary extreme.
 */
export function normalizeValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) return 0;
  if (max === min) return 0.5;
  return (value - min) / (max - min);
}

/** Evenly-spaced swatches for the legend strip, low→high. */
export function legendSwatches(stops: string[], steps = HEATMAP_LEGEND_STEPS): string[] {
  return Array.from({ length: steps }, (_, i) => sampleRamp(stops, i / (steps - 1)));
}
