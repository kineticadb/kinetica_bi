import { describe, it, expect } from "vitest";
import {
  LEGEND_PANEL_CORNERS,
  DEFAULT_LEGEND_PANEL_ENABLED,
  DEFAULT_LEGEND_PANEL_CORNER,
  getLegendPanelEnabled,
  getLegendPanelCorner,
} from "./legendPanelConfig";

describe("legendPanelConfig — backward-compatible defaults (PANEL-V17-04)", () => {
  describe("getLegendPanelEnabled", () => {
    it("Test 1: returns false when config has no legendPanelEnabled field (default)", () => {
      expect(getLegendPanelEnabled({})).toBe(false);
    });

    it("Test 2: returns true when config.legendPanelEnabled === true", () => {
      expect(getLegendPanelEnabled({ legendPanelEnabled: true })).toBe(true);
    });

    it("Test 3: returns false when config.legendPanelEnabled === false", () => {
      expect(getLegendPanelEnabled({ legendPanelEnabled: false })).toBe(false);
    });

    it("Test 4: returns false when config.legendPanelEnabled === undefined", () => {
      expect(getLegendPanelEnabled({ legendPanelEnabled: undefined })).toBe(false);
    });
  });

  describe("getLegendPanelCorner", () => {
    it("Test 5: returns 'top-right' when config has no legendPanelCorner field (default)", () => {
      expect(getLegendPanelCorner({})).toBe("top-right");
    });

    it("Test 6: returns 'top-left' when config.legendPanelCorner === 'top-left'", () => {
      expect(getLegendPanelCorner({ legendPanelCorner: "top-left" })).toBe("top-left");
    });

    it("Test 7: returns 'bottom-right' when config.legendPanelCorner === 'bottom-right'", () => {
      expect(getLegendPanelCorner({ legendPanelCorner: "bottom-right" })).toBe("bottom-right");
    });

    it("Test 8: returns 'bottom-left' when config.legendPanelCorner === 'bottom-left'", () => {
      expect(getLegendPanelCorner({ legendPanelCorner: "bottom-left" })).toBe("bottom-left");
    });

    it("Test 9: returns 'top-right' (fallback) when config.legendPanelCorner is an invalid value", () => {
      expect(getLegendPanelCorner({ legendPanelCorner: "invalid-corner" as any })).toBe("top-right");
    });

    it("Test 10: returns 'top-right' when config.legendPanelCorner === undefined", () => {
      expect(getLegendPanelCorner({ legendPanelCorner: undefined })).toBe("top-right");
    });
  });

  describe("LEGEND_PANEL_CORNERS constant", () => {
    it("Test 11: LEGEND_PANEL_CORNERS contains exactly 4 entries in order: 'top-right', 'top-left', 'bottom-right', 'bottom-left'", () => {
      expect(LEGEND_PANEL_CORNERS).toEqual(["top-right", "top-left", "bottom-right", "bottom-left"]);
      expect(LEGEND_PANEL_CORNERS).toHaveLength(4);
    });
  });

  describe("DEFAULT_* constants", () => {
    it("Test 12: DEFAULT_LEGEND_PANEL_ENABLED === false (exact)", () => {
      expect(DEFAULT_LEGEND_PANEL_ENABLED).toBe(false);
    });

    it("Test 13: DEFAULT_LEGEND_PANEL_CORNER === 'top-right' (exact)", () => {
      expect(DEFAULT_LEGEND_PANEL_CORNER).toBe("top-right");
    });
  });
});
