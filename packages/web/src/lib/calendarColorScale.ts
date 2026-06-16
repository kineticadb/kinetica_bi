/**
 * Phase 67 Plan 01 (CAL-V113-04): pure color-scale helpers for the SVG CalendarRenderer.
 *
 * Pure module — zero React/Zustand imports.
 *
 * Exports:
 *   CALENDAR_BUCKET_COUNT   — number of discrete color buckets (5)
 *   computeDomain           — derive [min,max] from a data array (null if no finite values)
 *   quantizeToBucket        — map a value to a bucket index 0..count-1 over a linear domain
 *   calendarBucketColors    — resolve 5 "#rrggbb" CSS colors from a ColorBrewer theme id
 *
 * toCssColor mirrors TimelineRenderer.tsx lines 71-75 (AARRGGBB → #rrggbb).
 */

import { getCbColorTheme, themeColorsFor } from "./cbColorThemes";

/** Default theme used when the requested themeId is not found. */
const DEFAULT_CALENDAR_COLOR_THEME = "Greens";

/** Number of discrete color buckets for the calendar heatmap. */
export const CALENDAR_BUCKET_COUNT = 5;

/**
 * Convert an AARRGGBB string (e.g. "FF66C2A5") to a "#rrggbb" CSS hex color.
 * Mirrors TimelineRenderer.tsx lines 71-75.
 */
function toCssColor(aarrggbb: string): string {
  if (aarrggbb.startsWith("#")) return aarrggbb;
  const hex = aarrggbb.length === 8 ? aarrggbb.slice(2) : aarrggbb;
  return "#" + hex.toLowerCase();
}

/**
 * Derive the [min, max] domain from an array of data rows.
 *
 * - Ignores null, undefined, and non-finite (NaN, ±Infinity) values.
 * - Returns null if no finite numeric values are found (caller shows "no data").
 * - Returns [v, v] for degenerate domains where all values are equal.
 */
export function computeDomain(
  data: { value: number | null | undefined }[],
): [number, number] | null {
  const values: number[] = [];
  for (const row of data) {
    if (row.value != null && Number.isFinite(row.value)) {
      values.push(row.value as number);
    }
  }
  if (values.length === 0) return null;
  return [Math.min(...values), Math.max(...values)];
}

/**
 * Map a numeric value to a bucket index in [0, count-1] over a linear domain.
 *
 * The domain [min, max] is split into `count` equal bands:
 *   band width = (max - min) / count
 *   bucket = floor((value - min) / band)  clamped to [0, count-1]
 *
 * Special case: degenerate domain (max === min) always returns 0.
 * The max value itself clamps to count-1 (floor result equals count).
 */
export function quantizeToBucket(
  value: number,
  domain: [number, number],
  count: number,
): number {
  const [min, max] = domain;
  if (max === min) return 0;
  const band = (max - min) / count;
  const idx = Math.floor((value - min) / band);
  return Math.min(count - 1, Math.max(0, idx));
}

/**
 * Resolve 5 discrete "#rrggbb" CSS color strings from a ColorBrewer theme id.
 *
 * Falls back to DEFAULT_CALENDAR_COLOR_THEME ("Greens") if the requested id
 * is not found. Never throws.
 */
export function calendarBucketColors(themeId: string): string[] {
  const theme =
    getCbColorTheme(themeId) ?? getCbColorTheme(DEFAULT_CALENDAR_COLOR_THEME);
  // theme! is safe: "Greens" is always available in the colorbrewer package
  return themeColorsFor(theme!, CALENDAR_BUCKET_COUNT).map(toCssColor);
}
