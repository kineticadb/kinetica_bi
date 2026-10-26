import { describe, it, expect } from "vitest";
import { AI_PALETTE_NAMES, AI_HEATMAP_RAMPS, AI_WIDGET_TYPES } from "@kinetica-bi/shared";
import { AURORA_CHART_PALETTE } from "./chartTheme";
import { paletteColor } from "./aiPalette";
import { AI_WIDGET_DEFAULTS } from "./aiWidgetDefaults";
import { DEFAULT_LAYER_CONFIG, makeAiHeatmapLayerConfig } from "./layerDefaults";
import { COLORMAP_CATALOG } from "../components/charts/KineticaWmsLayerForm";
import { isConfigComplete } from "../components/charts/MapChartRenderer";
import { registerAllChartTypes } from "../components/charts/definitions";
import { getChartType } from "../components/charts/registry";

describe("AI palette", () => {
  it("PAL-1 names map to the chart-theme colours", () => {
    expect(AI_PALETTE_NAMES.length).toBe(AURORA_CHART_PALETTE.length);
    AI_PALETTE_NAMES.forEach((n, i) => expect(paletteColor(n)).toBe(AURORA_CHART_PALETTE[i]));
    expect(paletteColor("nope")).toBeUndefined();
  });
});

describe("AI catalogue drift", () => {
  it("DRIFT6-1 heatmap ramps are a subset of the editor catalogue", () => {
    for (const r of AI_HEATMAP_RAMPS) expect(COLORMAP_CATALOG).toContain(r);
    expect(AI_HEATMAP_RAMPS as readonly string[]).not.toContain("cividis");
    expect(AI_HEATMAP_RAMPS as readonly string[]).not.toContain("turbo");
  });

  registerAllChartTypes();
  for (const type of AI_WIDGET_TYPES) {
    it(`DRIFT6-2 ${type} defaults agree with the registry`, () => {
      const def = getChartType(type);
      expect(def).toBeDefined();
      const d = AI_WIDGET_DEFAULTS[type];
      expect(d.flags.usesAggregation).toBe(def!.usesAggregation !== false);
      expect(d.flags.requiresGroupBy).toBe(def!.requiresGroupBy !== false);
      for (const k of Object.keys(d.config)) expect(def!.defaultConfig).toHaveProperty(k);
    });
    it(`DRIFT6-3 ${type} defaults carry no binding keys`, () => {
      const banned = ["sql", "table", "tableId", "customWhere", "drillDownColumn", "drillDownColumnType", "dynamicViewId", "metricId", "layout"];
      for (const k of banned) expect(AI_WIDGET_DEFAULTS[type].config).not.toHaveProperty(k);
    });
  }

  it("DRIFT6-TL timeline defaults equal the registry's timeline defaults", () => {
    const def = getChartType("timeline")!.defaultConfig;
    const d = AI_WIDGET_DEFAULTS.timeline.config;
    for (const k of ["maxIntervals", "showLegend", "showTooltip", "vertical", "colorTheme", "dateFormatOverride"]) expect(d[k], k).toEqual(def[k]);
  });

  it("DRIFT6-4 map basemaps match the registry default", () => {
    const def = getChartType("map")!.defaultConfig;
    expect(AI_WIDGET_DEFAULTS.map.config.basemapLight).toBeDefined();
    expect(AI_WIDGET_DEFAULTS.map.config.basemapLight).toBe(def.basemapLight);
    expect(AI_WIDGET_DEFAULTS.map.config.basemapDark).toBeDefined();
    expect(AI_WIDGET_DEFAULTS.map.config.basemapDark).toBe(def.basemapDark);
  });
});

describe("makeAiHeatmapLayerConfig", () => {
  it("LDEF-1 defaults", () => {
    const c = makeAiHeatmapLayerConfig({ spatialMode: "latlon", latColumn: "lat", lonColumn: "lon" });
    expect(c).toMatchObject({
      renderMode: "heatmap", colormap: "viridis", reverseColormap: false, blurRadius: 5,
      POINTOPACITY: 100, visible: true, name: "AI heatmap", latColumn: "lat", lonColumn: "lon",
    });
    expect(c).not.toHaveProperty("valueColumn");
    for (const k of Object.keys(DEFAULT_LAYER_CONFIG)) expect(c).toHaveProperty(k);
    expect(isConfigComplete(c)).toBe(true);
  });

  it("LDEF-2 style overrides", () => {
    const c = makeAiHeatmapLayerConfig({
      spatialMode: "latlon", latColumn: "lat", lonColumn: "lon", name: "Fares",
      style: { colormap: "plasma", reverseColormap: true, blurRadius: 9, opacity: 0.4, valueColumn: "fare" },
    });
    expect(c).toMatchObject({ colormap: "plasma", reverseColormap: true, blurRadius: 9, POINTOPACITY: 40, valueColumn: "fare", name: "Fares" });
    expect(c.pointOpacity).toBe(DEFAULT_LAYER_CONFIG.pointOpacity);
  });

  it("LDEF-3 wkt mode, no table id", () => {
    const c = makeAiHeatmapLayerConfig({ spatialMode: "wkt", wktColumn: "geom" });
    expect(c.wktColumn).toBe("geom");
    expect(isConfigComplete(c)).toBe(true);
    expect(c).not.toHaveProperty("table_id");
    expect(c).not.toHaveProperty("tableId");
  });
});
