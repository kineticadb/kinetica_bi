import type { ReactNode } from "react";

/**
 * Quick 261117-wht: recharts draws legend text in the series color, so a pale series (or a pale
 * custom pie color) gets an unreadable label on a light card. Pass this as <Legend formatter> to
 * draw labels in the theme text color; the legend swatch still shows the series color.
 */
export const legendTextFormatter = (value: unknown): ReactNode => (
  <span style={{ color: "var(--text)" }}>{String(value)}</span>
);
