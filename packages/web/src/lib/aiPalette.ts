/**
 * AI palette name -> colour (D-03). Indexes into the app's own chart palette so this file adds no
 * colour literals; the order of AI_PALETTE_NAMES mirrors AURORA_CHART_PALETTE (drift-tested).
 */
import { AI_PALETTE_NAMES } from "@kinetica-bi/shared";
import { AURORA_CHART_PALETTE } from "./chartTheme";

export type AiPaletteName = (typeof AI_PALETTE_NAMES)[number];

export const AI_PALETTE_COLORS = Object.fromEntries(
  AI_PALETTE_NAMES.map((n, i) => [n, AURORA_CHART_PALETTE[i]]),
) as Record<AiPaletteName, string>;

export function paletteColor(name: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(AI_PALETTE_COLORS, name)
    ? AI_PALETTE_COLORS[name as AiPaletteName]
    : undefined;
}
