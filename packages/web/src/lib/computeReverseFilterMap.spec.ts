import { describe, it, expect } from "vitest";
import { computeReverseFilterMap } from "./computeReverseFilterMap";
import type { VizDescriptor } from "./computeReverseFilterMap";
import type { ActiveFilter } from "../store/filterStore";
import type { Shape } from "../store/spatialFilterStore";
import type { FilterSelectionConfig } from "../types/filterSelection";
import { SPATIAL_DRAWS_SENTINEL } from "../components/charts/filterSourceTypes";

// ─── Factories (mirrors useFilterScopeSummary.spec.ts conventions) ─────────────

function mkFilter(column: string, sourceWidgetId?: number): ActiveFilter {
  return { column, value: "x", dataType: "string", sourceWidgetId, addedAt: 0 };
}

function mkShape(label: string): Shape {
  return {
    id: label,
    type: "bbox",
    wkt: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
    label,
    measurement: "1km",
    addedAt: 0,
  };
}

function mkWidgetViz(overrides: Partial<VizDescriptor> = {}): VizDescriptor {
  return {
    vizKind: "widget",
    widgetId: 1,
    widgetTitle: "Chart",
    cfg: undefined,
    tableId: 10,
    spatialCapable: false,
    ...overrides,
  };
}

function mkLayerViz(overrides: Partial<VizDescriptor> = {}): VizDescriptor {
  return {
    vizKind: "layer",
    widgetId: 8,
    layerId: 20,
    layerName: "Roads",
    widgetTitle: "Coverage Map",
    cfg: undefined,
    tableId: 10,
    spatialCapable: false,
    ...overrides,
  };
}

describe("computeReverseFilterMap", () => {
  // Test 1: Filter operator parity — eq/scalar, in (array), between (tuple) with the SAME
  // sourceWidgetId + cfg produce IDENTICAL applies-to results (Pitfall 5 — no operator branching).
  it("operator parity: eq/scalar, in, and between filters with same sourceWidgetId+cfg all resolve identically", () => {
    const fEq: ActiveFilter = { column: "region", value: "west", dataType: "string", sourceWidgetId: 5, addedAt: 0, operator: "eq" };
    const fIn: ActiveFilter = { column: "region", value: ["west", "east"], dataType: "string", sourceWidgetId: 5, addedAt: 0, operator: "in" };
    const fBetween: ActiveFilter = { column: "date", value: ["2020-01-01", "2020-12-31"], dataType: "datetime", sourceWidgetId: 5, addedAt: 0, operator: "between" };
    const viz = mkWidgetViz({ widgetId: 5, cfg: undefined });
    const { filterEntries } = computeReverseFilterMap({
      filters: { 10: [fEq, fIn, fBetween] },
      dvFilters: {},
      shapes: [],
      vizs: [viz],
      dvFilterScopeDisabled: false,
    });
    expect(filterEntries).toHaveLength(3);
    for (const entry of filterEntries) {
      expect(entry.widgets).toEqual([{ widgetId: 5, widgetTitle: "Chart", layerNames: undefined }]);
    }
  });

  // Test 2: Chart widget, accept-all cfg (undefined): filter resolves to that widget with
  // layerNames undefined.
  it("chart widget with accept-all cfg: filter resolves to the widget, layerNames undefined", () => {
    const f = mkFilter("region", 5);
    const viz = mkWidgetViz({ widgetId: 1, widgetTitle: "Sales by Region", cfg: undefined, tableId: 10 });
    const { filterEntries } = computeReverseFilterMap({
      filters: { 10: [f] },
      dvFilters: {},
      shapes: [],
      vizs: [viz],
      dvFilterScopeDisabled: false,
    });
    expect(filterEntries).toHaveLength(1);
    expect(filterEntries[0].widgets).toEqual([{ widgetId: 1, widgetTitle: "Sales by Region", layerNames: undefined }]);
  });

  // Test 3: Single map layer: filter resolves to the OWNING widgetId with layerNames: ["<name>"]
  // (not the layerId).
  it("single map layer: filter resolves to the owning widgetId with layerNames set (not the layerId)", () => {
    const f = mkFilter("region", 5);
    const viz = mkLayerViz({ widgetId: 8, layerId: 20, layerName: "Roads", widgetTitle: "Coverage Map", cfg: undefined, tableId: 10 });
    const { filterEntries } = computeReverseFilterMap({
      filters: { 10: [f] },
      dvFilters: {},
      shapes: [],
      vizs: [viz],
      dvFilterScopeDisabled: false,
    });
    expect(filterEntries).toHaveLength(1);
    expect(filterEntries[0].widgets).toEqual([{ widgetId: 8, widgetTitle: "Coverage Map", layerNames: ["Roads"] }]);
  });

  // Test 4: Multiple layers of the SAME map widget both match → ONE widget entry, layerNames
  // aggregated. Worked example from RESEARCH.md Pattern 4: Rivers excluded by allowlist while
  // Roads included → verify one entry with only ["Roads"].
  it("multiple layers of the same map widget: one widget entry, layerNames aggregated (Pattern 4 worked example)", () => {
    const f1 = mkFilter("region", 5);
    const roads = mkLayerViz({ widgetId: 8, layerId: 20, layerName: "Roads", widgetTitle: "Coverage Map", cfg: undefined, tableId: 10 });
    const rivers = mkLayerViz({
      widgetId: 8,
      layerId: 21,
      layerName: "Rivers",
      widgetTitle: "Coverage Map",
      cfg: { sourceMode: "allowlist", allowedSourceWidgetIds: [99] },
      tableId: 10,
    });
    const chart = mkWidgetViz({ widgetId: 5, widgetTitle: "Sales by Region", cfg: undefined, tableId: 10 });
    const { filterEntries } = computeReverseFilterMap({
      filters: { 10: [f1] },
      dvFilters: {},
      shapes: [],
      vizs: [chart, roads, rivers],
      dvFilterScopeDisabled: false,
    });
    expect(filterEntries).toHaveLength(1);
    expect(filterEntries[0].widgets).toEqual([
      { widgetId: 5, widgetTitle: "Sales by Region", layerNames: undefined },
      { widgetId: 8, widgetTitle: "Coverage Map", layerNames: ["Roads"] },
    ]);
  });

  // Test 5: Same layer owned by TWO different map widgets (two descriptors, same
  // layerId/layerName, different widgetId) → TWO separate widget entries.
  it("same layer owned by two different map widgets: two separate widget entries", () => {
    const f = mkFilter("region", 5);
    const vizA = mkLayerViz({ widgetId: 8, layerId: 20, layerName: "Roads", widgetTitle: "Map A", cfg: undefined, tableId: 10 });
    const vizB = mkLayerViz({ widgetId: 9, layerId: 20, layerName: "Roads", widgetTitle: "Map B", cfg: undefined, tableId: 10 });
    const { filterEntries } = computeReverseFilterMap({
      filters: { 10: [f] },
      dvFilters: {},
      shapes: [],
      vizs: [vizA, vizB],
      dvFilterScopeDisabled: false,
    });
    expect(filterEntries).toHaveLength(1);
    expect(filterEntries[0].widgets).toEqual([
      { widgetId: 8, widgetTitle: "Map A", layerNames: ["Roads"] },
      { widgetId: 9, widgetTitle: "Map B", layerNames: ["Roads"] },
    ]);
  });

  // Test 6: Table-bound vs dv-bound source binding — a dv-bound viz resolves against
  // dvFilters[dvId], NOT filters[tableId]; a table filter does not leak into a dv viz and
  // vice-versa (Pitfall 1 — per-source scoping; two-table fixture proving no cross-table leak).
  it("per-source scoping: dv-bound viz reads dvFilters[dvId] only; table filters never leak across tables or into dv", () => {
    const fTable10 = mkFilter("col_a", undefined);
    const fTable20 = mkFilter("col_b", undefined);
    const fDv7 = mkFilter("col_c", undefined);
    const widgetTable10 = mkWidgetViz({ widgetId: 1, widgetTitle: "Table10 Widget", cfg: undefined, tableId: 10 });
    const widgetTable20 = mkWidgetViz({ widgetId: 2, widgetTitle: "Table20 Widget", cfg: undefined, tableId: 20 });
    const dvWidget = mkWidgetViz({ widgetId: 3, widgetTitle: "Dv Widget", cfg: undefined, tableId: undefined, dynamicViewId: 7 });
    const { filterEntries } = computeReverseFilterMap({
      filters: { 10: [fTable10], 20: [fTable20] },
      dvFilters: { 7: [fDv7] },
      shapes: [],
      vizs: [widgetTable10, widgetTable20, dvWidget],
      dvFilterScopeDisabled: false,
    });
    expect(filterEntries).toHaveLength(3);
    const byFilter = new Map(filterEntries.map((e) => [e.filter, e.widgets]));
    expect(byFilter.get(fTable10)).toEqual([{ widgetId: 1, widgetTitle: "Table10 Widget", layerNames: undefined }]);
    expect(byFilter.get(fTable20)).toEqual([{ widgetId: 2, widgetTitle: "Table20 Widget", layerNames: undefined }]);
    expect(byFilter.get(fDv7)).toEqual([{ widgetId: 3, widgetTitle: "Dv Widget", layerNames: undefined }]);
  });

  // Test 7: Cfg modes — undefined (accept-all), sourceMode:"all", sourceMode:"allowlist" WITH
  // matching sourceWidgetId, sourceMode:"allowlist" with NO match.
  it("cfg modes: undefined, 'all', allowlist-match, and allowlist-no-match all resolve correctly", () => {
    const f = mkFilter("region", 5);
    const vizUndefined = mkWidgetViz({ widgetId: 1, widgetTitle: "Undefined", cfg: undefined, tableId: 10 });
    const vizAll: FilterSelectionConfig = { sourceMode: "all", allowedSourceWidgetIds: [] };
    const vizAllViz = mkWidgetViz({ widgetId: 2, widgetTitle: "All", cfg: vizAll, tableId: 10 });
    const vizAllowlistMatch = mkWidgetViz({
      widgetId: 3,
      widgetTitle: "AllowlistMatch",
      cfg: { sourceMode: "allowlist", allowedSourceWidgetIds: [5] },
      tableId: 10,
    });
    const vizAllowlistNoMatch = mkWidgetViz({
      widgetId: 4,
      widgetTitle: "AllowlistNoMatch",
      cfg: { sourceMode: "allowlist", allowedSourceWidgetIds: [999] },
      tableId: 10,
    });
    const { filterEntries } = computeReverseFilterMap({
      filters: { 10: [f] },
      dvFilters: {},
      shapes: [],
      vizs: [vizUndefined, vizAllViz, vizAllowlistMatch, vizAllowlistNoMatch],
      dvFilterScopeDisabled: false,
    });
    expect(filterEntries).toHaveLength(1);
    expect(filterEntries[0].widgets).toEqual([
      { widgetId: 1, widgetTitle: "Undefined", layerNames: undefined },
      { widgetId: 2, widgetTitle: "All", layerNames: undefined },
      { widgetId: 3, widgetTitle: "AllowlistMatch", layerNames: undefined },
    ]);
  });

  // Test 8: dvFilterScopeDisabled false vs true — with a dv viz whose cfg is a restrictive
  // allowlist, false respects the allowlist (filter excluded), true forces accept-all (included).
  it("dvFilterScopeDisabled: false respects the dv cfg allowlist; true forces accept-all", () => {
    const fDv = mkFilter("col", undefined);
    const dvViz = mkWidgetViz({
      widgetId: 1,
      widgetTitle: "Dv Widget",
      cfg: { sourceMode: "allowlist", allowedSourceWidgetIds: [999] },
      tableId: undefined,
      dynamicViewId: 7,
    });
    const disabledFalse = computeReverseFilterMap({
      filters: {},
      dvFilters: { 7: [fDv] },
      shapes: [],
      vizs: [dvViz],
      dvFilterScopeDisabled: false,
    });
    expect(disabledFalse.filterEntries[0].widgets).toEqual([]);

    const disabledTrue = computeReverseFilterMap({
      filters: {},
      dvFilters: { 7: [fDv] },
      shapes: [],
      vizs: [dvViz],
      dvFilterScopeDisabled: true,
    });
    expect(disabledTrue.filterEntries[0].widgets).toEqual([{ widgetId: 1, widgetTitle: "Dv Widget", layerNames: undefined }]);
  });

  // Test 9: dv double-override — a dv-bound viz with spatialCapable:true passed in the
  // descriptor + an active shape → the shape is NOT applied (dv forces spatialCapable false)
  // (Pitfall 2).
  it("dv double-override: dv-bound viz with spatialCapable:true still never applies a shape", () => {
    const shape = mkShape("Bbox 1");
    const dvViz = mkWidgetViz({
      widgetId: 1,
      widgetTitle: "Dv Widget",
      cfg: undefined,
      tableId: undefined,
      dynamicViewId: 7,
      spatialCapable: true, // caller passes true — lib must force false internally
    });
    const { shapeEntries } = computeReverseFilterMap({
      filters: {},
      dvFilters: {},
      shapes: [shape],
      vizs: [dvViz],
      dvFilterScopeDisabled: false,
    });
    expect(shapeEntries).toHaveLength(1);
    expect(shapeEntries[0].widgets).toEqual([]);
  });

  // Test 10: spatialCapable — table-bound viz with spatialCapable:true + cfg accepting the
  // sentinel → shape applies; table-bound viz spatialCapable:false → shape ignored even if cfg
  // would accept it.
  it("spatialCapable true + accepting cfg applies the shape; spatialCapable false ignores it even with accepting cfg", () => {
    const shape = mkShape("Bbox 1");
    const capableViz = mkWidgetViz({
      widgetId: 1,
      widgetTitle: "Capable",
      cfg: undefined,
      tableId: 10,
      spatialCapable: true,
    });
    const notCapableViz = mkWidgetViz({
      widgetId: 2,
      widgetTitle: "NotCapable",
      cfg: undefined,
      tableId: 10,
      spatialCapable: false,
    });
    const { shapeEntries } = computeReverseFilterMap({
      filters: {},
      dvFilters: {},
      shapes: [shape],
      vizs: [capableViz, notCapableViz],
      dvFilterScopeDisabled: false,
    });
    expect(shapeEntries).toHaveLength(1);
    expect(shapeEntries[0].widgets).toEqual([{ widgetId: 1, widgetTitle: "Capable", layerNames: undefined }]);
  });

  // Test 11: Spatial allowlist WITHOUT the sentinel → shape excluded from that widget.
  it("spatial allowlist without SPATIAL_DRAWS_SENTINEL excludes the shape", () => {
    const shape = mkShape("Bbox 1");
    const viz = mkWidgetViz({
      widgetId: 1,
      widgetTitle: "NoSentinel",
      cfg: { sourceMode: "allowlist", allowedSourceWidgetIds: [5] }, // no sentinel
      tableId: 10,
      spatialCapable: true,
    });
    const vizWithSentinel = mkWidgetViz({
      widgetId: 2,
      widgetTitle: "WithSentinel",
      cfg: { sourceMode: "allowlist", allowedSourceWidgetIds: [SPATIAL_DRAWS_SENTINEL] },
      tableId: 10,
      spatialCapable: true,
    });
    const { shapeEntries } = computeReverseFilterMap({
      filters: {},
      dvFilters: {},
      shapes: [shape],
      vizs: [viz, vizWithSentinel],
      dvFilterScopeDisabled: false,
    });
    expect(shapeEntries).toHaveLength(1);
    expect(shapeEntries[0].widgets).toEqual([{ widgetId: 2, widgetTitle: "WithSentinel", layerNames: undefined }]);
  });

  // Test 12: Zero-match — a filter present in filters but excluded by every viz's cfg → entry
  // present with widgets: [] (empty array, never a missing/undefined entry).
  it("zero-match filter: seeded entry present with widgets: [] (never a missing key)", () => {
    const f = mkFilter("region", 5);
    const viz = mkWidgetViz({
      widgetId: 1,
      cfg: { sourceMode: "allowlist", allowedSourceWidgetIds: [999] },
      tableId: 10,
    });
    const { filterEntries } = computeReverseFilterMap({
      filters: { 10: [f] },
      dvFilters: {},
      shapes: [],
      vizs: [viz],
      dvFilterScopeDisabled: false,
    });
    expect(filterEntries).toHaveLength(1);
    expect(filterEntries[0].widgets).toEqual([]);
  });

  // Test 13: Ordering determinism — vizs supplied out of widgetId order → widgets[] comes back
  // sorted widgetId ascending; identical across two calls with the same input.
  it("widget entries within a filter's widgets[] are sorted widgetId ascending, deterministic across calls", () => {
    const f = mkFilter("region", undefined);
    const vizC = mkWidgetViz({ widgetId: 30, widgetTitle: "C", cfg: undefined, tableId: 10 });
    const vizA = mkWidgetViz({ widgetId: 10, widgetTitle: "A", cfg: undefined, tableId: 10 });
    const vizB = mkWidgetViz({ widgetId: 20, widgetTitle: "B", cfg: undefined, tableId: 10 });
    const input = {
      filters: { 10: [f] },
      dvFilters: {},
      shapes: [],
      vizs: [vizC, vizA, vizB], // out of order
      dvFilterScopeDisabled: false,
    };
    const result1 = computeReverseFilterMap(input);
    const result2 = computeReverseFilterMap(input);
    const expected = [
      { widgetId: 10, widgetTitle: "A", layerNames: undefined },
      { widgetId: 20, widgetTitle: "B", layerNames: undefined },
      { widgetId: 30, widgetTitle: "C", layerNames: undefined },
    ];
    expect(result1.filterEntries[0].widgets).toEqual(expected);
    expect(result2.filterEntries[0].widgets).toEqual(expected);
  });

  // Test 14: Reference-identity join — filterEntries[i].filter === the exact input ActiveFilter
  // object and shapeEntries[i].shape === the exact input Shape object (Pitfall 4).
  it("reference-identity join: returned filter/shape entries carry the exact input object references", () => {
    const f = mkFilter("region", 5);
    const shape = mkShape("Bbox 1");
    const { filterEntries, shapeEntries } = computeReverseFilterMap({
      filters: { 10: [f] },
      dvFilters: {},
      shapes: [shape],
      vizs: [],
      dvFilterScopeDisabled: false,
    });
    expect(filterEntries[0].filter).toBe(f);
    expect(shapeEntries[0].shape).toBe(shape);
  });

  // Test 15: No mutation — after a call, the input filters/dvFilters/shapes/vizs arrays have
  // unchanged length and element order/references (mirror resolveFilterSet.spec.ts).
  it("does not mutate filters, dvFilters, shapes, or vizs inputs", () => {
    const f10 = mkFilter("a", 5);
    const fDv = mkFilter("b", undefined);
    const shape = mkShape("Bbox 1");
    const vizB = mkWidgetViz({ widgetId: 2, cfg: undefined, tableId: 10 });
    const vizA = mkWidgetViz({ widgetId: 1, cfg: undefined, tableId: 10 });
    const filters = { 10: [f10] };
    const dvFilters = { 7: [fDv] };
    const shapes = [shape];
    const vizs = [vizB, vizA]; // deliberately out of order to prove sort doesn't mutate original

    computeReverseFilterMap({ filters, dvFilters, shapes, vizs, dvFilterScopeDisabled: false });

    expect(filters[10]).toHaveLength(1);
    expect(filters[10][0]).toBe(f10);
    expect(dvFilters[7]).toHaveLength(1);
    expect(dvFilters[7][0]).toBe(fDv);
    expect(shapes).toHaveLength(1);
    expect(shapes[0]).toBe(shape);
    expect(vizs).toHaveLength(2);
    expect(vizs[0]).toBe(vizB);
    expect(vizs[1]).toBe(vizA);
  });

  // Test 16a: Totality/defensive — a VizDescriptor with BOTH tableId and dynamicViewId undefined
  // does not throw and contributes no matches.
  it("malformed descriptor (both tableId and dynamicViewId undefined) does not throw and contributes no matches", () => {
    const f = mkFilter("region", undefined);
    const malformed = mkWidgetViz({ widgetId: 1, cfg: undefined, tableId: undefined, dynamicViewId: undefined });
    expect(() =>
      computeReverseFilterMap({
        filters: { 10: [f] },
        dvFilters: {},
        shapes: [],
        vizs: [malformed],
        dvFilterScopeDisabled: false,
      }),
    ).not.toThrow();
    const { filterEntries } = computeReverseFilterMap({
      filters: { 10: [f] },
      dvFilters: {},
      shapes: [],
      vizs: [malformed],
      dvFilterScopeDisabled: false,
    });
    expect(filterEntries[0].widgets).toEqual([]);
  });

  // Test 16b: empty vizs → every active filter/shape gets a seeded entry with widgets: [].
  it("empty vizs array: every active filter/shape gets a seeded entry with widgets: []", () => {
    const f = mkFilter("region", 5);
    const shape = mkShape("Bbox 1");
    const { filterEntries, shapeEntries } = computeReverseFilterMap({
      filters: { 10: [f] },
      dvFilters: {},
      shapes: [shape],
      vizs: [],
      dvFilterScopeDisabled: false,
    });
    expect(filterEntries).toHaveLength(1);
    expect(filterEntries[0].widgets).toEqual([]);
    expect(shapeEntries).toHaveLength(1);
    expect(shapeEntries[0].widgets).toEqual([]);
  });

  // Test 16c: empty filters/dvFilters/shapes → empty filterEntries/shapeEntries arrays.
  it("empty filters/dvFilters/shapes: returns empty filterEntries and shapeEntries arrays", () => {
    const viz = mkWidgetViz();
    const { filterEntries, shapeEntries } = computeReverseFilterMap({
      filters: {},
      dvFilters: {},
      shapes: [],
      vizs: [viz],
      dvFilterScopeDisabled: false,
    });
    expect(filterEntries).toEqual([]);
    expect(shapeEntries).toEqual([]);
  });
});
