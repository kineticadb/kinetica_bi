import { describe, it, expect } from "vitest";
import {
  DEFAULT_INFO_ENABLED,
  DEFAULT_INFO_RADIUS_PX,
  DEFAULT_SHOW_SHAPE_MEASUREMENTS,
  DEFAULT_SHOW_SCALE_BAR,
  DEFAULT_SHOW_FULLSCREEN_BUTTON,
  getInfoEnabled,
  getInfoRadiusPx,
  getShowShapeMeasurements,
  getShowScaleBar,
  getShowFullscreenButton,
} from "./mapInfoConfig";
import type { MapWidgetConfig } from "./wmsUrlBuilder";

describe("mapInfoConfig — backward-compatible defaults (CONFIG-V14-02)", () => {
  describe("DEFAULT_* constants", () => {
    it("DEFAULT_INFO_ENABLED is true (locked v1.4 default)", () => {
      expect(DEFAULT_INFO_ENABLED).toBe(true);
    });
    it("DEFAULT_INFO_RADIUS_PX is 3 (tightened from the v1.4 default of 20 per operator request)", () => {
      expect(DEFAULT_INFO_RADIUS_PX).toBe(3);
    });
  });

  describe("getInfoEnabled", () => {
    it("returns true when config has no infoEnabled field (legacy widget — pre-Phase-19 shape)", () => {
      // Use empty object literal cast — represents a stored widget.config from before Phase 19
      const legacy: Pick<MapWidgetConfig, "infoEnabled"> = {};
      expect(getInfoEnabled(legacy)).toBe(true);
    });

    it("returns true when config.infoEnabled === undefined (explicit undefined treated as missing)", () => {
      expect(getInfoEnabled({ infoEnabled: undefined })).toBe(true);
    });

    it("returns true when config.infoEnabled === true", () => {
      expect(getInfoEnabled({ infoEnabled: true })).toBe(true);
    });

    it("returns false when config.infoEnabled === false (kill switch active)", () => {
      // Phase 21 lock: per-widget infoEnabled: false disables the OL click listener entirely.
      expect(getInfoEnabled({ infoEnabled: false })).toBe(false);
    });
  });

  describe("getInfoRadiusPx", () => {
    it("returns 3 when config has no infoRadiusPx field (legacy widget)", () => {
      const legacy: Pick<MapWidgetConfig, "infoRadiusPx"> = {};
      expect(getInfoRadiusPx(legacy)).toBe(3);
    });

    it("returns 3 when config.infoRadiusPx === undefined", () => {
      expect(getInfoRadiusPx({ infoRadiusPx: undefined })).toBe(3);
    });

    it("returns the explicit value when set (typical Phase 22 case)", () => {
      expect(getInfoRadiusPx({ infoRadiusPx: 1 })).toBe(1);
      expect(getInfoRadiusPx({ infoRadiusPx: 50 })).toBe(50);
      expect(getInfoRadiusPx({ infoRadiusPx: 200 })).toBe(200);
    });

    it("returns 0 when explicitly set to 0 (no clamping — Phase 22 UI validates the min)", () => {
      // Document the no-clamp lock: helper is a pure read, not a validator.
      expect(getInfoRadiusPx({ infoRadiusPx: 0 })).toBe(0);
    });

    it("returns negative values unchanged (no clamping — Phase 22 UI validates)", () => {
      expect(getInfoRadiusPx({ infoRadiusPx: -5 })).toBe(-5);
    });
  });

  describe("backward-compat regression: a complete pre-Phase-19 MapWidgetConfig literal", () => {
    it("a legacy MapWidgetConfig (no info fields) reads as { infoEnabled: true, infoRadiusPx: 3 } via the helpers — ROADMAP Phase 19 success criterion 2", () => {
      // This is the SHAPE of a MapWidgetConfig persisted to widget.config in v1.2/v1.3,
      // before Phase 19 added infoEnabled/infoRadiusPx. The helpers must read it cleanly.
      const legacyWidget: MapWidgetConfig = {
        tableId: 1,
        spatialMode: "latlon",
        latColumn: "lat",
        lonColumn: "lon",
        renderMode: "raster",
      };
      expect(getInfoEnabled(legacyWidget)).toBe(true);
      expect(getInfoRadiusPx(legacyWidget)).toBe(3);
    });

    it("a Phase 22-shaped MapWidgetConfig with explicit info fields reads as those values", () => {
      const explicit: MapWidgetConfig = {
        tableId: 1,
        spatialMode: "latlon",
        latColumn: "lat",
        lonColumn: "lon",
        renderMode: "raster",
        infoEnabled: false,
        infoRadiusPx: 35,
      };
      expect(getInfoEnabled(explicit)).toBe(false);
      expect(getInfoRadiusPx(explicit)).toBe(35);
    });
  });

  describe("getShowShapeMeasurements (Phase 29 follow-up — on-map pill toggle)", () => {
    it("DEFAULT_SHOW_SHAPE_MEASUREMENTS is true (legacy widgets keep the pill)", () => {
      expect(DEFAULT_SHOW_SHAPE_MEASUREMENTS).toBe(true);
    });

    it("returns true when config has no showShapeMeasurements field", () => {
      const legacy: Pick<MapWidgetConfig, "showShapeMeasurements"> = {};
      expect(getShowShapeMeasurements(legacy)).toBe(true);
    });

    it("returns true when config.showShapeMeasurements === undefined", () => {
      expect(getShowShapeMeasurements({ showShapeMeasurements: undefined })).toBe(true);
    });

    it("returns true when explicitly set to true", () => {
      expect(getShowShapeMeasurements({ showShapeMeasurements: true })).toBe(true);
    });

    it("returns false when explicitly set to false (pill hidden)", () => {
      expect(getShowShapeMeasurements({ showShapeMeasurements: false })).toBe(false);
    });
  });

  describe("getShowScaleBar (quick-260608-j5k — opt-in scale bar control)", () => {
    it("DEFAULT_SHOW_SCALE_BAR is false (opt-in; legacy widgets show no scale bar)", () => {
      expect(DEFAULT_SHOW_SCALE_BAR).toBe(false);
    });

    it("returns false when config has no showScaleBar field (legacy widget)", () => {
      const legacy: Pick<MapWidgetConfig, "showScaleBar"> = {};
      expect(getShowScaleBar(legacy)).toBe(false);
    });

    it("returns false when config.showScaleBar === undefined", () => {
      expect(getShowScaleBar({ showScaleBar: undefined })).toBe(false);
    });

    it("returns true when config.showScaleBar === true", () => {
      expect(getShowScaleBar({ showScaleBar: true })).toBe(true);
    });

    it("returns false when config.showScaleBar === false (explicit opt-out)", () => {
      expect(getShowScaleBar({ showScaleBar: false })).toBe(false);
    });
  });

  describe("getShowFullscreenButton (quick-260608-j5k — opt-in fullscreen button control)", () => {
    it("DEFAULT_SHOW_FULLSCREEN_BUTTON is false (opt-in; legacy widgets show no fullscreen button)", () => {
      expect(DEFAULT_SHOW_FULLSCREEN_BUTTON).toBe(false);
    });

    it("returns false when config has no showFullscreenButton field (legacy widget)", () => {
      const legacy: Pick<MapWidgetConfig, "showFullscreenButton"> = {};
      expect(getShowFullscreenButton(legacy)).toBe(false);
    });

    it("returns false when config.showFullscreenButton === undefined", () => {
      expect(getShowFullscreenButton({ showFullscreenButton: undefined })).toBe(false);
    });

    it("returns true when config.showFullscreenButton === true", () => {
      expect(getShowFullscreenButton({ showFullscreenButton: true })).toBe(true);
    });

    it("returns false when config.showFullscreenButton === false (explicit opt-out)", () => {
      expect(getShowFullscreenButton({ showFullscreenButton: false })).toBe(false);
    });
  });
});
