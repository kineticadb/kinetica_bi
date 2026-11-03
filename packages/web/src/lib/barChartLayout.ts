// kbi-mcp UAT: the vertical bar chart's category axis. PURE module, zero React/Recharts/Zustand imports.
// Like the line chart (lineChartLayout), every label shows; when they do not fit side by side they tilt.
// Unlike the line chart the slot grows with the label, because bar labels are words ("No Charge"), not dates.
import { LINE_CATEGORY_SLOT_PX, LINE_DEFAULT_X_AXIS_HEIGHT, LINE_LABEL_PX_PER_CHAR, LINE_TILTED_SLOT_PX, LINE_UNKNOWN_WIDTH_TILT_N } from "./lineChartLayout";

export const BAR_LABEL_MAX_CHARS = 16;
const BAR_LABEL_GAP_PX = 8;

export type BarXAxisLayout = { tilt: boolean; showAll: boolean; xAxisHeight: number };

export function computeBarXAxisLayout(a: { n: number; plotWidthPx: number; maxLabelChars: number }): BarXAxisLayout {
  const chars = Math.min(Math.max(0, a.maxLabelChars), BAR_LABEL_MAX_CHARS);
  const flatSlotPx = Math.max(LINE_CATEGORY_SLOT_PX, chars * LINE_LABEL_PX_PER_CHAR + BAR_LABEL_GAP_PX);
  const known = a.plotWidthPx > 0;
  const tilt = known ? a.n * flatSlotPx > a.plotWidthPx : a.n > LINE_UNKNOWN_WIDTH_TILT_N;
  // Even tilted, a label needs a slot; past that the chart thins them (better than overlapping text).
  const showAll = !known || !tilt || a.n * LINE_TILTED_SLOT_PX <= a.plotWidthPx;
  const diag = Math.ceil(chars * LINE_LABEL_PX_PER_CHAR * Math.SQRT1_2);
  return { tilt, showAll, xAxisHeight: tilt ? Math.max(LINE_DEFAULT_X_AXIS_HEIGHT, diag + 16) : LINE_DEFAULT_X_AXIS_HEIGHT };
}

export function truncateBarLabel(label: string): string {
  return label.length > BAR_LABEL_MAX_CHARS ? `${label.slice(0, BAR_LABEL_MAX_CHARS - 1)}…` : label;
}
