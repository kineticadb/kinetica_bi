import { describe, it, expect, beforeAll } from "vitest";
import { registerAllChartTypes } from "./definitions";
import { getAllChartTypes, getChartType } from "./registry";

/**
 * Retiring non-functional chart types from the add-visualization picker.
 * `addable: false` hides a type from the picker (no NEW widgets) while keeping it
 * REGISTERED so any pre-existing widget of that type still resolves + renders.
 * Mirrors the picker filter in DashboardsPage.getVisualizationTypes.
 *
 * Heatmap was retired here for having no renderer. HeatmapRenderer now exists, so
 * heatmap is back in the picker and scatter is the only retired type left.
 */
describe("chart-type registry — addable flag (add-visualization picker)", () => {
  beforeAll(() => {
    registerAllChartTypes();
  });

  it("scatter is marked addable:false (retired, non-functional)", () => {
    expect(getChartType("scatter")?.addable).toBe(false);
  });

  it("heatmap is addable again now that it has a renderer", () => {
    // `addable` is left unset (undefined) rather than true — the picker filter is
    // `addable !== false`, so unset IS the default-visible state used by bar/line/pie.
    expect(getChartType("heatmap")?.addable).not.toBe(false);
  });

  it("scatter remains REGISTERED so existing widgets still resolve", () => {
    expect(getChartType("scatter")).toBeDefined();
    expect(getChartType("heatmap")).toBeDefined();
  });

  it("the picker filter (addable !== false) excludes exactly scatter", () => {
    const pickerTypes = getAllChartTypes()
      .filter((ct) => ct.addable !== false)
      .map((ct) => ct.type);
    expect(pickerTypes).not.toContain("scatter");
    // Functional types stay in the picker.
    expect(pickerTypes).toContain("heatmap");
    expect(pickerTypes).toContain("bar");
    expect(pickerTypes).toContain("calendar");
    expect(pickerTypes).toContain("timeline");
  });

  it("heatmap rides the shared aggregated + group-by path, like bar/line/pie", () => {
    // These three flags are what route it through AggregatedWidgetRenderer and give
    // it filters, dv binding and materialize for free. Flipping any of them would
    // silently detach the widget from the filter pipeline.
    const hm = getChartType("heatmap");
    expect(hm?.usesAggregation).toBe(true);
    expect(hm?.requiresGroupBy).toBe(true);
    expect(hm?.usesDataSource).not.toBe(false);
  });
});
