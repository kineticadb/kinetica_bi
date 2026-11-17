/**
 * v1.7 (post-Phase-39 UAT enhancement): ColorBrewer color themes for the Class
 * Break form. Selecting a theme recolors all break rows using the palette variant
 * tuned for the current break count (ColorBrewer hand-picks distinct colors per
 * class count). If there are more breaks than colors in the theme, colors repeat
 * (modulo).
 *
 * Data sourced from the canonical `colorbrewer` package (MIT, data-only) so the
 * full set of 35 schemes is available and authoritative — 18 sequential (incl.
 * single-hue), 9 diverging, 8 qualitative. We expose them via a normalized shape:
 *  - colors stored as 6-char RRGGBB (package gives "#rrggbb"; we strip "#")
 *  - themeColorsFor() returns 8-char AARRGGBB (FF alpha) to match the form model
 *  - per-class-count arrays (keys 3..N) drive "best palette for N breaks"
 *
 * Pure module — no React/Zustand/network.
 */

// Import the ESM build directly: the package's UMD `main` confuses ESM interop
// (default resolves undefined), but the `index.es.js` build has a clean default export.
import colorbrewer from "colorbrewer/index.es.js";

export type CbThemeGroup = "Sequential" | "Diverging" | "Qualitative";

export type CbColorTheme = {
  id: string;
  label: string;
  group: CbThemeGroup;
  /** Per-class-count color arrays (6-char RRGGBB), keyed by class count. */
  byCount: Record<number, string[]>;
};

type SchemeGroups = {
  sequential: string[];
  singlehue: string[];
  diverging: string[];
  qualitative: string[];
};

// `colorbrewer` default export = { schemeGroups, <SchemeId>: { <count>: ["#rrggbb", ...] } }.
const cb = colorbrewer as unknown as {
  schemeGroups: SchemeGroups;
  [scheme: string]: unknown;
};

function groupOf(): Record<string, CbThemeGroup> {
  const g = cb.schemeGroups;
  const map: Record<string, CbThemeGroup> = {};
  // ColorBrewer splits sequential into multi-hue ("sequential") + "singlehue";
  // both are conceptually sequential for our picker.
  for (const id of [...g.sequential, ...g.singlehue]) map[id] = "Sequential";
  for (const id of g.diverging) map[id] = "Diverging";
  for (const id of g.qualitative) map[id] = "Qualitative";
  return map;
}

function buildThemes(): CbColorTheme[] {
  const groups = groupOf();
  const themes: CbColorTheme[] = [];
  for (const [id, group] of Object.entries(groups)) {
    const scheme = cb[id] as Record<string, string[]> | undefined;
    if (!scheme || typeof scheme !== "object") continue;
    const byCount: Record<number, string[]> = {};
    for (const [k, arr] of Object.entries(scheme)) {
      const n = Number(k);
      if (!Number.isInteger(n) || !Array.isArray(arr)) continue;
      byCount[n] = arr.map((c) => String(c).replace(/^#/, ""));
    }
    if (Object.keys(byCount).length === 0) continue;
    themes.push({ id, label: id, group, byCount });
  }
  const order: CbThemeGroup[] = ["Sequential", "Diverging", "Qualitative"];
  themes.sort(
    (a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.label.localeCompare(b.label),
  );
  return themes;
}

export const CB_COLOR_THEMES: CbColorTheme[] = buildThemes();

export function getCbColorTheme(id: string): CbColorTheme | undefined {
  return CB_COLOR_THEMES.find((t) => t.id === id);
}

/**
 * Return exactly `count` colors as 8-char AARRGGBB (FF alpha) for a theme.
 *
 * Picks the theme's palette variant best suited to `count`:
 *  - count within the theme's defined keys → that exact variant (ColorBrewer-tuned).
 *  - count below the smallest key → the smallest variant, first `count` colors.
 *  - count above the largest key → the largest variant, REPEATED (modulo) to fill.
 */
export function themeColorsFor(theme: CbColorTheme, count: number): string[] {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return [];
  const keys = Object.keys(theme.byCount).map(Number).sort((a, b) => a - b);
  const min = keys[0];
  const max = keys[keys.length - 1];
  let base: string[];
  if (n <= min) base = theme.byCount[min];
  else if (n >= max) base = theme.byCount[max];
  else base = theme.byCount[n] ?? theme.byCount[max];
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push("FF" + base[i % base.length].toUpperCase());
  }
  return out;
}

/** Lighter than this (WCAG relative luminance) a series all but vanishes on a light card. */
const SERIES_MAX_LUMINANCE = 0.8;

function relativeLuminance(argb: string): number {
  const h = argb.slice(-6);
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Quick 261117-wht: `count` AARRGGBB colors for chart SERIES (bar series, pie slices).
 * Qualitative themes: the ColorBrewer colors as-is. Sequential/diverging themes: sampled evenly
 * (in ramp order) from the theme's largest variant minus its near-white steps, which disappear on
 * a light card (PuRd's lightest is #f1eef6); colors repeat past the usable count.
 * Map class breaks and heatmap scales keep the full ramp (themeColorsFor).
 */
export function seriesThemeColors(theme: CbColorTheme, count: number): string[] {
  const n = Math.max(0, Math.floor(count));
  if (n === 0 || theme.group === "Qualitative") return themeColorsFor(theme, n);
  const max = Math.max(...Object.keys(theme.byCount).map(Number));
  const usable = themeColorsFor(theme, max).filter((c) => relativeLuminance(c) <= SERIES_MAX_LUMINANCE);
  if (n >= usable.length) return Array.from({ length: n }, (_, i) => usable[i % usable.length]);
  if (n === 1) return [usable[Math.floor((usable.length - 1) / 2)]];
  return Array.from({ length: n }, (_, i) => usable[Math.round((i * (usable.length - 1)) / (n - 1))]);
}

/**
 * Quick 261116-cpt: `count` series colors as CSS "#rrggbb" (the shape chart `color` fields store),
 * or [] for an unknown theme id.
 */
export function themeHexColors(themeId: string, count: number): string[] {
  const theme = getCbColorTheme(themeId);
  if (!theme) return [];
  return seriesThemeColors(theme, count).map((c) => `#${c.slice(2).toLowerCase()}`);
}

/** The theme's distinct series colors for a preview strip, capped at `max`. */
export function themePreviewHexColors(themeId: string, max = 8): string[] {
  const theme = getCbColorTheme(themeId);
  if (!theme) return [];
  return [...new Set(themeHexColors(themeId, Math.min(max, Math.max(...Object.keys(theme.byCount).map(Number)))))];
}

/**
 * Quick 261117-rev: AARRGGBB colors for `count` chart series (at least 1) from `themeId`
 * (or `fallbackId` when unknown), optionally in reverse order.
 */
export function seriesPaletteColors(themeId: string, count: number, fallbackId: string, reverse = false): string[] {
  const theme = getCbColorTheme(themeId) ?? getCbColorTheme(fallbackId)!;
  const colors = seriesThemeColors(theme, Math.max(1, count));
  return reverse ? colors.reverse() : colors;
}
