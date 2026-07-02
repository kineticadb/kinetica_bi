import { describe, it, expect, beforeAll } from "vitest";
import { registerAllChartTypes } from "./definitions";
import { getAllChartTypes, getChartType } from "./registry";

/**
 * Retiring non-functional chart types from the add-visualization picker.
 * `addable: false` hides a type from the picker (no NEW widgets) while keeping it
 * REGISTERED so any pre-existing widget of that type still resolves + renders.
 * Mirrors the picker filter in DashboardsPage.getVisualizationTypes.
 */
describe("chart-type registry — addable flag (add-visualization picker)", () => {
  beforeAll(() => {
    registerAllChartTypes();
  });

  it("scatter and heatmap are marked addable:false (retired, non-functional)", () => {
    expect(getChartType("scatter")?.addable).toBe(false);
    expect(getChartType("heatmap")?.addable).toBe(false);
  });

  it("scatter and heatmap remain REGISTERED so existing widgets still resolve", () => {
    expect(getChartType("scatter")).toBeDefined();
    expect(getChartType("heatmap")).toBeDefined();
  });

  it("the picker filter (addable !== false) excludes exactly scatter + heatmap", () => {
    const pickerTypes = getAllChartTypes()
      .filter((ct) => ct.addable !== false)
      .map((ct) => ct.type);
    expect(pickerTypes).not.toContain("scatter");
    expect(pickerTypes).not.toContain("heatmap");
    // Functional types stay in the picker.
    expect(pickerTypes).toContain("bar");
    expect(pickerTypes).toContain("calendar");
    expect(pickerTypes).toContain("timeline");
  });
});
