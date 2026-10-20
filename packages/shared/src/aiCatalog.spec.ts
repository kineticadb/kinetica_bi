import { describe, it, expect } from "vitest";
import {
  AI_HEATMAP_RAMPS, isAiNumericColumnType, layersOfMap, resolveHeatmapHost, validateAiLayerPatch, validateAiWidgetConfig,
} from "./aiCatalog";
import { AI_PALETTE_NAMES } from "./actionAllowList";

const BAR = { metric: "fare_amount", aggregation: "sum", groupByColumn: "vendor_id" };

describe("aiCatalog", () => {
  it("CAT-1 positive control", () => {
    expect(validateAiWidgetConfig("bar", {
      ...BAR, sortDir: "DESC", limit: 10, color: "violet", showLegend: true, xAxisLabel: "Vendor", tableId: 3,
    }).valid).toBe(true);
  });
  it.each(["sql", "customWhere", "table", "drillDownColumn", "drillDownColumnType", "dynamicViewId", "metricId", "layout", "metricColumn", "tableRef"])(
    "CAT-2 rejects %s", (k) => {
      const r = validateAiWidgetConfig("bar", { ...BAR, [k]: "x" });
      expect(r.valid).toBe(false);
      if (!r.valid) expect(r.reasons.join()).toContain(k);
    });
  it("CAT-2 rejects __proto__ own key", () => {
    expect(validateAiWidgetConfig("bar", JSON.parse('{"metric":"a","aggregation":"sum","groupByColumn":"g","__proto__":1}')).valid).toBe(false);
  });
  it("CAT-3 required fields", () => {
    const r = validateAiWidgetConfig("bar", { metric: "a", aggregation: "sum" });
    expect(!r.valid && r.reasons).toContain("missing required field groupByColumn");
    expect(validateAiWidgetConfig("bignumber", { metric: "a", aggregation: "sum" }).valid).toBe(true);
    expect(validateAiWidgetConfig("records", {}).valid).toBe(true);
    expect(validateAiWidgetConfig("map", {}).valid).toBe(true);
  });
  it.each(["#ff0000", "ff0000", "FF3B82F6", "red", "rgb(1,2,3)", "var(--accent)", "Violet"])("CAT-4 rejects colour %s", (c) => {
    expect(validateAiWidgetConfig("bar", { ...BAR, color: c }).valid).toBe(false);
  });
  it("CAT-4 accepts violet", () => {
    expect(validateAiWidgetConfig("bar", { ...BAR, color: "violet" }).valid).toBe(true);
  });
  it("CAT-5 identifiers", () => {
    for (const m of ["a b", "x;DROP", "1abc", "a".repeat(129)]) {
      expect(validateAiWidgetConfig("bar", { ...BAR, metric: m }).valid).toBe(false);
    }
    for (const a of ["SUM) FROM x", "median"]) {
      const r = validateAiWidgetConfig("bar", { ...BAR, aggregation: a });
      expect(r.valid).toBe(false);
      if (!r.valid) expect(r.reasons.join()).not.toContain(a);
    }
  });
  it("CAT-6 heatmap patch", () => {
    expect(validateAiLayerPatch({ colormap: "viridis", blurRadius: 12, opacity: 0.5, valueColumn: "fare_amount", name: "Pickups", visible: true, reverseColormap: true }, "heatmap").valid).toBe(true);
    for (const p of [{ colormap: "cividis" }, { colormap: "turbo" }, { colormap: "#fff" }, { blurRadius: 0 }, { blurRadius: 33 }, { opacity: 1.5 },
      { latColumn: "a" }, { spatialMode: "wkt" }, { renderMode: "raster" }, { table_id: 1 }, { POINTOPACITY: 1 }]) {
      expect(validateAiLayerPatch(p, "heatmap").valid).toBe(false);
    }
  });
  it("CAT-7 non-heatmap", () => {
    expect(validateAiLayerPatch({ visible: false }, "raster").valid).toBe(true);
    const r = validateAiLayerPatch({ colormap: "viridis" }, "raster");
    expect(!r.valid && r.reasons).toContain("only heatmap layers can be restyled");
  });
  it("CAT-8 resolveHeatmapHost", () => {
    const m = (id: number) => ({ id, title: `M${id}` });
    expect(resolveHeatmapHost({ maps: [], layers: [], tableId: 1 })).toEqual({ kind: "add_map" });
    expect(resolveHeatmapHost({ maps: [m(5)], layers: [], tableId: 1 })).toEqual({ kind: "use", widgetId: 5 });
    expect(resolveHeatmapHost({ maps: [m(5), m(6)], layers: [{ id: 1, widgetId: 6, tableId: 1 }], tableId: 1 })).toEqual({ kind: "use", widgetId: 6 });
    expect(resolveHeatmapHost({ maps: [m(5), m(6)], layers: [], tableId: 1 })).toEqual({
      kind: "ask", options: [{ widgetId: 5, title: "M5" }, { widgetId: 6, title: "M6" }],
    });
    expect(resolveHeatmapHost({ maps: [m(5), m(6)], layers: [{ id: 1, widgetId: 5, tableId: 1 }, { id: 2, widgetId: 6, tableId: 1 }], tableId: 1 }).kind).toBe("ask");
  });
  it("CAT-9 layersOfMap", () => {
    const ls = [{ id: 1 }, { id: 2 }];
    expect(layersOfMap({}, ls)).toEqual(ls);
    expect(layersOfMap({ config: { includedLayerIds: [] } }, ls)).toEqual(ls);
    expect(layersOfMap({ config: { includedLayerIds: [2] } }, ls)).toEqual([{ id: 2 }]);
  });
  it("CAT-10 numeric types", () => {
    expect(isAiNumericColumnType("DOUBLE")).toBe(true);
    expect(isAiNumericColumnType("decimal(10,2)")).toBe(true);
    expect(isAiNumericColumnType("string")).toBe(false);
    expect(isAiNumericColumnType(undefined)).toBeUndefined();
  });
  it("CAT-11 vocabularies", () => {
    expect(AI_HEATMAP_RAMPS).toHaveLength(13);
    expect(AI_HEATMAP_RAMPS as readonly string[]).not.toContain("cividis");
    expect(AI_HEATMAP_RAMPS as readonly string[]).not.toContain("turbo");
    expect([...AI_PALETTE_NAMES]).toEqual(["violet", "sky", "teal", "amber", "pink", "lime"]);
  });
});

describe("Phase 139 dynamicViewId carve-out", () => {
  it("CATDV-1 tableId unchanged", () => {
    expect(validateAiWidgetConfig("bar", { ...BAR, tableId: 5 }).valid).toBe(true);
  });
  it("CATDV-2 valid dynamicViewId", () => {
    expect(validateAiWidgetConfig("bar", { dynamicViewId: -3, metric: "trips", aggregation: "sum", groupByColumn: "pickup_hour" }).valid).toBe(true);
  });
  it("CATDV-3 invalid dynamicViewId and snake_case still rejected", () => {
    for (const v of [0, "x"]) {
      const r = validateAiWidgetConfig("bar", { ...BAR, dynamicViewId: v });
      expect(r.valid).toBe(false);
      if (!r.valid) expect(r.reasons.join("|")).toContain("invalid value for dynamicViewId");
    }
    const r = validateAiWidgetConfig("bar", { ...BAR, dynamic_view_id: -3 });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reasons).toContain('config key "dynamic_view_id" is not allowed for bar');
  });
});
