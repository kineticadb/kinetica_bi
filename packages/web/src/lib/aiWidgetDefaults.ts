/**
 * Per-type defaults for AI-added widgets plus the SQL flags the derive step needs.
 * Hand-written on purpose: the fold must not import the React chart registry. Drift against the
 * registry is covered by aiWebCatalog.spec.ts (DRIFT6-2/3/4). Colours come from the palette map,
 * never from literals here.
 */
import type { AiWidgetType } from "@kinetica-bi/shared";
import { AI_PALETTE_COLORS, paletteColor } from "./aiPalette";
import { DEFAULT_BASEMAP_LIGHT, DEFAULT_BASEMAP_DARK } from "./basemaps";
import { DEFAULT_MAX_INTERVALS } from "./timelineBin";

type Flags = { usesAggregation: boolean; requiresGroupBy: boolean };

const AGG_GROUPED: Flags = { usesAggregation: true, requiresGroupBy: true };

export const AI_WIDGET_DEFAULTS: Record<AiWidgetType, { config: Record<string, unknown>; flags: Flags }> = {
  bar: { config: { color: paletteColor("violet"), showLegend: true }, flags: AGG_GROUPED },
  line: { config: { color: paletteColor("violet"), showLegend: true }, flags: AGG_GROUPED },
  pie: {
    config: {
      showLegend: true,
      color1: AI_PALETTE_COLORS.violet,
      color2: AI_PALETTE_COLORS.sky,
      color3: AI_PALETTE_COLORS.teal,
      color4: AI_PALETTE_COLORS.amber,
      color5: AI_PALETTE_COLORS.pink,
      color6: AI_PALETTE_COLORS.lime,
    },
    flags: AGG_GROUPED,
  },
  table: { config: { barColor: paletteColor("violet") }, flags: AGG_GROUPED },
  bignumber: {
    config: { color: paletteColor("violet") },
    flags: { usesAggregation: true, requiresGroupBy: false },
  },
  records: { config: { pageSize: 25 }, flags: { usesAggregation: false, requiresGroupBy: true } },
  map: {
    config: { basemapLight: DEFAULT_BASEMAP_LIGHT, basemapDark: DEFAULT_BASEMAP_DARK },
    flags: { usesAggregation: false, requiresGroupBy: true },
  },
  // 142: TimelineRenderer owns its SQL; timeCol/metrics come from the fold. "Set2" = DEFAULT_COLOR_THEME (drift: DRIFT6-TL).
  timeline: {
    config: { maxIntervals: DEFAULT_MAX_INTERVALS, showLegend: true, showTooltip: true, vertical: false, colorTheme: "Set2", dateFormatOverride: "" },
    flags: { usesAggregation: false, requiresGroupBy: true },
  },
  // kbi-mcp: markdown text; the fold copies `markdown` from the op (definitions/text.ts defaultConfig).
  text: { config: {}, flags: { usesAggregation: false, requiresGroupBy: true } },
};
