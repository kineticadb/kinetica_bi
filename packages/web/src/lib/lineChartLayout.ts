// Phase 132 (LINE-V126-02): PURE module, zero React/Recharts/Zustand imports.
// Constants per UI-SPEC "X axis". Do NOT measure text: layout is arithmetic on
// n, measured wrapper width and label length.

export const LINE_CATEGORY_SLOT_PX = 48;
export const LINE_TILTED_SLOT_PX = LINE_CATEGORY_SLOT_PX / 2; // 24, derived: ONE slot constant
export const LINE_MIN_PLOT_PX = 160;
export const LINE_DOT_DENSITY_MAX = 24;
export const LINE_LABEL_PX_PER_CHAR = 7;
export const LINE_UNKNOWN_WIDTH_TILT_N = 8;
export const LINE_DEFAULT_X_AXIS_HEIGHT = 30;

export type LineXAxisLayout = {
  tilt: boolean;
  scroll: boolean;
  xAxisHeight: number;
  minInnerWidth: number;
  minInnerHeight: number;
};

export function computeLineXAxisLayout(a: { n: number; plotWidthPx: number; maxLabelChars: number }): LineXAxisLayout {
  const known = a.plotWidthPx > 0;
  const tilt = known ? a.n * LINE_CATEGORY_SLOT_PX > a.plotWidthPx : a.n > LINE_UNKNOWN_WIDTH_TILT_N;
  const scroll = known && tilt && a.n * LINE_TILTED_SLOT_PX > a.plotWidthPx;
  const maxLabelPx = Math.max(0, a.maxLabelChars) * LINE_LABEL_PX_PER_CHAR; // 7px/char at 11px: wide-glyph safety margin
  const diag = Math.ceil(maxLabelPx * Math.SQRT1_2); // sin45 == cos45
  const xAxisHeight = tilt ? Math.max(LINE_DEFAULT_X_AXIS_HEIGHT, diag + 16) : LINE_DEFAULT_X_AXIS_HEIGHT;
  const minInnerWidth = scroll ? a.n * LINE_TILTED_SLOT_PX + diag : 0; // + left overhang of the longest tilted label
  return { tilt, scroll, xAxisHeight, minInnerWidth, minInnerHeight: xAxisHeight + LINE_MIN_PLOT_PX };
}

type PointLike = { y?: number | null } | null | undefined;

/** A present point whose neighbours are both missing: drawn as a dot. */
export function isIsolatedLinePoint(points: ReadonlyArray<PointLike>, index: number): boolean {
  const isMissing = (p: PointLike) => p == null || p.y == null;
  return (
    !isMissing(points[index]) &&
    (index === 0 || isMissing(points[index - 1])) &&
    (index === points.length - 1 || isMissing(points[index + 1]))
  );
}

/**
 * Group By columns with blank builder rows dropped. `+ Add column` appends ""
 * and isMultiColumnBarGroupBy counts it, which would draw a phantom "undefined" series.
 */
export function lineGroupByColumns(config: Record<string, unknown>): string[] {
  return Array.isArray(config.groupByColumns)
    ? config.groupByColumns.filter((c): c is string => typeof c === "string" && c.trim() !== "")
    : [];
}

export function lineXColumn(config: Record<string, unknown>): string {
  return lineGroupByColumns(config)[0] ?? (typeof config.groupByColumn === "string" ? config.groupByColumn : "");
}
