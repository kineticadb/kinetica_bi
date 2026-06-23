/**
 * Theme-aware chart grid/axis colors.
 *
 * Recharts renders CartesianGrid/XAxis/YAxis `stroke` (and tick `fill`) as SVG
 * presentation attributes, which do NOT resolve CSS variables — so chart internals
 * can't flip with the app theme via CSS alone. This hook reads the theme store to
 * re-run on theme toggle, then resolves actual color values from :root CSS custom
 * properties via getComputedStyle so axis/grid/accent automatically follow both
 * theme flips AND future brand overrides (Phase 82) with no code change.
 *
 *   grid — subtle gridline stroke (--color-chart-grid)
 *   axis — axis line stroke + tick text fill (--color-chart-axis)
 *   emptyCell — empty-cell fill in calendar renderer (same as grid)
 *   accent — chart accent color, e.g. selected-cell ring (--accent-2)
 *
 * IMPORTANT: only call getComputedStyle inside the hook (render time) — calling it
 * at module level returns "" because CSS hasn't parsed yet (RESEARCH Pitfall 2).
 */
import { useThemeStore } from "../store/theme";

export type ChartAxisColors = { grid: string; axis: string; emptyCell: string; accent: string };

export function useChartAxisColors(): ChartAxisColors {
  // Subscribe to theme store so this hook re-runs whenever the theme toggles.
  // The theme value itself is not used — the CSS custom properties on :root are
  // the single source of truth; getComputedStyle reads whatever :root is currently
  // resolving (dark or light), so colours always match the active mode.
  useThemeStore((s) => s.theme);

  const get = (v: string) =>
    getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  const grid = get("--color-chart-grid");
  const axis = get("--color-chart-axis");
  return { grid, axis, emptyCell: grid, accent: get("--accent-2") };
}
