import { describe, it, expect } from "vitest";
import { translateWidgetOverlay, WIDGET_OVERLAY_KEY_MAP } from "./widgetOverlayKeys";

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
