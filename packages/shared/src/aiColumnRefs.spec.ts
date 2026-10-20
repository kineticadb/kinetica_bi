import { describe, it, expect } from "vitest";
import { AI_COLUMN_BINDING_KEYS, aiWidgetColumnRefs, aiLayerColumnRefs, planDvDependents } from "./aiColumnRefs";

describe("aiColumnRefs (139)", () => {
  it("REFS-1 widget refs dedupe in first-appearance order", () => {
    expect(
      aiWidgetColumnRefs({
        metric: "fare", metricColumn: "fare", groupByColumn: "vendor", groupByColumns: ["vendor", "zone"],
        columns: ["a", "b"], sortField: "a", aggregation: "sum", color: "blue",
      }),
    ).toEqual(["fare", "vendor", "zone", "a", "b"]);
  });
  it("REFS-2 comma-joined columns string", () => {
    expect(aiWidgetColumnRefs({ columns: "a, b ,c,," })).toEqual(["a", "b", "c"]);
  });
  it("REFS-3 layer refs", () => {
    expect(aiLayerColumnRefs({ latColumn: "lat", lonColumn: "lon", valueColumn: "fare", renderMode: "heatmap" })).toEqual(["lat", "lon", "fare"]);
    expect(aiLayerColumnRefs({ wktColumn: "g", wkbColumn: "h" })).toEqual(["g", "h"]);
  });
  it("REFS-4 planner repoints vs drops", () => {
    const plan = planDvDependents({
      baseColumns: ["vendor", "fare", "lat", "lon"],
      widgets: [
        { id: 42, type: "bar", refs: ["vendor", "fare"] },
        { id: 43, type: "bar", refs: ["trips"] },
        { id: 44, type: "calendar", refs: ["vendor"] },
        { id: -7, type: "records", refs: [] },
      ],
      layers: [{ id: 70, refs: ["lat", "lon"] }, { id: -9, refs: ["lat", "pickup_hour"] }],
    });
    expect(plan).toEqual({
      repoint: { widgetIds: [42, -7], layerIds: [70] },
      drop: { widgetIds: [43, 44], layerIds: [-9] },
    });
  });
  it("REFS-5 no dependents", () => {
    expect(planDvDependents({ widgets: [], layers: [], baseColumns: ["a"] })).toEqual({
      repoint: { widgetIds: [], layerIds: [] },
      drop: { widgetIds: [], layerIds: [] },
    });
  });
  it("REFS-6 binding key drift guard", () => {
    expect([...AI_COLUMN_BINDING_KEYS]).toEqual(["metric", "metricColumn", "groupByColumn", "groupByColumns"]);
  });
});
