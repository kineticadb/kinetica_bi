/**
 * Theme-aware chart grid/axis colors.
 *
 * Recharts renders CartesianGrid/XAxis/YAxis `stroke` (and tick `fill`) as SVG
 * presentation attributes, which do NOT resolve CSS variables — so chart internals
 * can't flip with the app theme via CSS alone. This hook reads the app theme store
 * and returns concrete colors that renderers pass to those props.
 *
 *   grid — subtle gridline stroke
 *   axis — axis line stroke + tick text fill
 */
import { useThemeStore } from "../store/theme";

export type ChartAxisColors = { grid: string; axis: string; emptyCell: string; accent: string };

export function useChartAxisColors(): ChartAxisColors {
  const theme = useThemeStore((s) => s.theme);
  return theme === "light"
    ? { grid: "#e2e8f0", axis: "#64748b", emptyCell: "#e2e8f0", accent: "#0284c7" } // slate-200 gridlines, slate-500 ticks; emptyCell matches light grid; accent = --accent-2 light
    : { grid: "#1f2937", axis: "#94a3b8", emptyCell: "#1f2937", accent: "#38bdf8" }; // original dark values; emptyCell matches dark grid; accent = --accent-2 dark
}
