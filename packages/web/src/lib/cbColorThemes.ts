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
