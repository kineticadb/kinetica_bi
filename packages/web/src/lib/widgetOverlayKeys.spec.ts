import { describe, it, expect } from "vitest";
import { translateWidgetOverlay, WIDGET_OVERLAY_KEY_MAP, overlayTouchesChartSql } from "./widgetOverlayKeys";
import { paletteColor } from "./aiPalette";

describe("translateWidgetOverlay", () => {
  it("translates map allow-list keys to renderer keys", () => {
    expect(translateWidgetOverlay("map", { show_scale_bar: true, show_fullscreen: false, show_popup: false })).toEqual({
      showScaleBar: true, showFullscreenButton: false, infoEnabled: false,
    });
  });
  it("translates records page_size", () => {
    expect(translateWidgetOverlay("records", { page_size: 50 })).toEqual({ pageSize: 50 });
  });
  it("passes unmapped keys through", () => {
    expect(translateWidgetOverlay("map", { includedLayerIds: [1, -2] })).toEqual({ includedLayerIds: [1, -2] });
  });
  it("unknown type passes through; input not mutated", () => {
    const input = Object.freeze({ show_scale_bar: true });
    expect(translateWidgetOverlay("bar", input)).toEqual({ show_scale_bar: true });
    expect(translateWidgetOverlay("map", input)).not.toBe(input);
    expect(input).toEqual({ show_scale_bar: true });
    expect(WIDGET_OVERLAY_KEY_MAP.map.show_popup).toBe("infoEnabled");
  });
});

describe("SEAM — chart value/key translation (D-19)", () => {
  it("SEAM-1: bar metric/aggregation/color/limit translate to renderer keys and values", () => {
    expect(translateWidgetOverlay("bar", { metric: "fare", aggregation: "count_distinct", color: "teal", limit: 25 })).toEqual({
      metricColumn: "fare", aggregation: "COUNT_DISTINCT", color: paletteColor("teal"), limit: 25, metricId: null,
    });
  });
  it("SEAM-2: colour lands on the type's real colour key", () => {
    expect(translateWidgetOverlay("pie", { color: "amber" })).toEqual({ color1: paletteColor("amber") });
    expect(translateWidgetOverlay("table", { color: "pink" })).toEqual({ barColor: paletteColor("pink") });
    expect(translateWidgetOverlay("bignumber", { color: "lime" })).toEqual({ color: paletteColor("lime") });
    expect(translateWidgetOverlay("line", { color: "sky" })).toEqual({ color: paletteColor("sky") });
  });
  it("SEAM-3: unknown palette names are dropped, never passed through", () => {
    expect(translateWidgetOverlay("bar", { color: "red" })).toEqual({});
    expect(translateWidgetOverlay("bar", { color: "#ff0000" })).toEqual({});
    expect(translateWidgetOverlay("pie", { color: "#ff0000" })).toEqual({});
  });
  it("SEAM-4: map and records translation unchanged; includedLayerIds passes through", () => {
    expect(translateWidgetOverlay("map", { show_popup: true, includedLayerIds: [1] })).toEqual({ infoEnabled: true, includedLayerIds: [1] });
    expect(translateWidgetOverlay("records", { page_size: 10 })).toEqual({ pageSize: 10 });
  });
  it("SEAM-5: overlayTouchesChartSql discriminates data keys from appearance keys", () => {
    for (const k of ["metricColumn", "aggregation", "groupByColumn", "sortDir", "limit", "metricId"]) {
      expect(overlayTouchesChartSql({ [k]: 1 })).toBe(true);
    }
    expect(overlayTouchesChartSql({ color: "x" })).toBe(false);
    expect(overlayTouchesChartSql({ showLegend: true })).toBe(false);
  });
});
