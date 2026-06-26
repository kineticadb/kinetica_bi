// estimateAxisWidth — size a recharts value axis to its longest formatted tick label.
//
// recharts 2.x YAxis `width` is a fixed number (no "auto"), so a hardcoded width wastes
// space when labels are short (e.g. SI abbreviations like "18M") and clips when they are
// long (e.g. raw "1,234,567" or "−1.23G"). We estimate the px a value axis needs from the
// formatted labels at the data extremes, clamped so the axis never collapses or dominates.

const FONT_PX_PER_CHAR = 6.6; // ~11px tick font, proportional digits/letters
const TICK_GUTTER_PX = 16; // tick line + label padding
const MIN_WIDTH_PX = 34;
const MAX_WIDTH_PX = 80;

/** Width (px) for a value axis given the formatted labels it must display. */
export function estimateAxisWidth(formattedLabels: string[]): number {
  const longest = formattedLabels.reduce(
    (max, s) => Math.max(max, (s ?? "").length),
    0,
  );
  const raw = Math.round(longest * FONT_PX_PER_CHAR + TICK_GUTTER_PX);
  return Math.min(MAX_WIDTH_PX, Math.max(MIN_WIDTH_PX, raw));
}

/**
 * Convenience: estimate a value-axis width from the numeric values that will be plotted
 * plus the tick formatter that will render them. Formats the extremes (max / min / 0) —
 * the widest tick label is almost always at an extreme — and sizes to the longest.
 * Returns the MIN_WIDTH floor when there are no finite values.
 */
export function estimateValueAxisWidth(
  values: number[],
  format: (v: number) => string,
): number {
  let max = -Infinity;
  let min = Infinity;
  for (const v of values) {
    if (Number.isFinite(v)) {
      if (v > max) max = v;
      if (v < min) min = v;
    }
  }
  if (!Number.isFinite(max)) return MIN_WIDTH_PX;
  return estimateAxisWidth([format(max), format(min), format(0)]);
}
