/**
 * Default map-layer config (moved from DashboardsPage.handleLayerCreate; 136-10 swaps the page to
 * import it) and the AI heatmap layer builder.
 */

// Defaults MUST match the field names that `buildWmsParams` and the form
// controls read (camelCase, e.g. `pointOpacity` — NOT `POINTOPACITY`). The
// previous defaults used `POINTOPACITY` (the on-wire WMS param name),
// which buildWmsParams' `config.pointOpacity` check ignored — so a freshly
// created layer's first tile request omitted POINTOPACITY entirely, and
// Kinetica fell back to its own default (visually different from what the
// form showed). Operator workaround: drag the slider once to set
// `pointOpacity` in the correct case, then the tile re-rendered.
//
// Also explicitly seed style fields the form falls back to via `??`/`||`
// (pointShape, shapeFillColor, shapeLineColor, shapeLineWidth,
// antialiasing). Form fallbacks only affect the rendered SELECT/INPUT
// value — they don't write into config, so the WMS URL omits those params
// until the operator touches the control. Seeding here ensures the first
// tile fetch already includes everything the form claims is the default.
export const DEFAULT_LAYER_CONFIG: Record<string, unknown> = {
  renderMode: "raster",
  spatialMode: "latlon",
  colormap: "viridis",
  reverseColormap: false,
  // 8-char AARRGGBB: FF (opaque) + 3B82F6 (blue). Stored without '#' for the WMS URL.
  pointColor: "FF3B82F6",
  pointSize: 5,
  pointOpacity: 100,
  pointShape: "circle",
  shapeFillColor: "FFFF3838",
  shapeLineColor: "FF000000",
  shapeLineWidth: 1,
  antialiasing: false,
  visible: true,
};

export type AiHeatmapLayerInput = {
  spatialMode: "latlon" | "wkt" | "wkb";
  latColumn?: string;
  lonColumn?: string;
  wktColumn?: string;
  wkbColumn?: string;
  name?: string;
  style?: {
    colormap?: string;
    reverseColormap?: boolean;
    blurRadius?: number;
    opacity?: number;
    valueColumn?: string;
  };
};

/**
 * Layer config for an AI-added heatmap: every field the layer editor writes for a heatmap.
 * `POINTOPACITY` (0-100) is the layer opacity; `pointOpacity` is the raster WMS param and is left
 * at its default. The table is a top-level layer DTO field, never part of this config.
 */
export function makeAiHeatmapLayerConfig(input: AiHeatmapLayerInput): Record<string, unknown> {
  const s = input.style ?? {};
  const cfg: Record<string, unknown> = {
    ...DEFAULT_LAYER_CONFIG,
    name: input.name ?? "AI heatmap",
    renderMode: "heatmap",
    spatialMode: input.spatialMode,
    colormap: s.colormap ?? "viridis",
    reverseColormap: s.reverseColormap ?? false,
    blurRadius: s.blurRadius ?? 5,
    POINTOPACITY: Math.round((s.opacity ?? 1) * 100),
    visible: true,
  };
  if (input.spatialMode === "latlon") {
    cfg.latColumn = input.latColumn;
    cfg.lonColumn = input.lonColumn;
  } else if (input.spatialMode === "wkt") {
    cfg.wktColumn = input.wktColumn;
  } else {
    cfg.wkbColumn = input.wkbColumn;
  }
  if (s.valueColumn) cfg.valueColumn = s.valueColumn;
  return cfg;
}
