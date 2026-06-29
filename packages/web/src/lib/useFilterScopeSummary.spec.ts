import { describe, it, expect } from "vitest";
import { computeFilterScopeSummary } from "./useFilterScopeSummary";
import type { ActiveFilter } from "../store/filterStore";
import type { Shape } from "../store/spatialFilterStore";
import type { FilterSelectionConfig } from "../types/filterSelection";

// ─── Factories ────────────────────────────────────────────────────────────────

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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("computeFilterScopeSummary", () => {
  // Test 1: accept-all (cfg undefined), 3 column filters, no shapes → all applied, none ignored (SC1 backing case)
  it("accept-all: cfg undefined + 3 column filters → appliedCount===totalCount===3, ignored empty", () => {
    const filters = [mkFilter("col1", 7), mkFilter("col2"), mkFilter("col3", 9)];
    const result = computeFilterScopeSummary({
      cfg: undefined,
      activeFilters: filters,
      activeShapes: [],
      spatialCapable: false,
    });
    expect(result.appliedCount).toBe(3);
    expect(result.totalCount).toBe(3);
    expect(result.applied.filters).toHaveLength(3);
    expect(result.ignored).toHaveLength(0);
  });

  // Test 2: allowlist excluding 1 of 3 column filters → appliedCount 2, totalCount 3, 1 ignored with reason
  it("allowlist excludes 1 of 3 filters → appliedCount 2, totalCount 3, 1 ignored reason 'source excluded'", () => {
    const cfg: FilterSelectionConfig = {
      sourceMode: "allowlist",
      allowedSourceWidgetIds: [7, 9],
    };
    const f7 = mkFilter("col1", 7);
    const f9 = mkFilter("col2", 9);
    const fExcluded = mkFilter("col3", 42); // not in allowlist
    const filters = [f7, f9, fExcluded];
    const result = computeFilterScopeSummary({
      cfg,
      activeFilters: filters,
      activeShapes: [],
      spatialCapable: false,
    });
    expect(result.appliedCount).toBe(2);
    expect(result.totalCount).toBe(3);
    expect(result.ignored).toHaveLength(1);
    expect(result.ignored[0].kind).toBe("filter");
    expect(result.ignored[0].reason).toBe("source excluded");
  });

  // Test 3: each ignored entry's filter is the EXACT ActiveFilter object (identity compare)
  it("ignored entry has exact same object reference as the excluded filter", () => {
    const cfg: FilterSelectionConfig = {
      sourceMode: "allowlist",
      allowedSourceWidgetIds: [7],
    };
    const fIncluded = mkFilter("col1", 7);
    const fExcluded = mkFilter("col2", undefined); // no sourceWidgetId → excluded under allowlist
    const filters = [fIncluded, fExcluded];
    const result = computeFilterScopeSummary({
      cfg,
      activeFilters: filters,
      activeShapes: [],
      spatialCapable: false,
    });
    expect(result.ignored).toHaveLength(1);
    if (result.ignored[0].kind === "filter") {
      expect(result.ignored[0].filter).toBe(fExcluded); // identity
    }
  });

  // Test 4: spatial-capable widget, 1 column applied + 1 accepted shape + 1 column filter excluded
  // → totalCount counts shapes; appliedCount includes the accepted shape
  it("spatial-capable table-bound: accepted shape counts in M and applied; excluded column filter counts in M but not N", () => {
    const cfg: FilterSelectionConfig = {
      sourceMode: "allowlist",
      allowedSourceWidgetIds: [7, "__spatial_draws__"],
    };
    const fApplied = mkFilter("col1", 7);
    const fExcluded = mkFilter("col2", 99); // not in allowlist
    const shape = mkShape("Bbox 1");
    const result = computeFilterScopeSummary({
      cfg,
      activeFilters: [fApplied, fExcluded],
      activeShapes: [shape],
      spatialCapable: true,
    });
    // totalCount = 2 column filters + 1 shape = 3
    expect(result.totalCount).toBe(3);
    // appliedCount = 1 column + 1 shape = 2
    expect(result.appliedCount).toBe(2);
    expect(result.applied.shapes).toHaveLength(1);
    expect(result.applied.shapes[0]).toBe(shape);
    expect(result.ignored).toHaveLength(1);
    expect(result.ignored[0].kind).toBe("filter");
  });

  // Test 5: spatial-capable widget whose cfg excludes spatial (allow-list WITHOUT SPATIAL_DRAWS_SENTINEL)
  // 1 active shape → shape appears in ignored with reason "source excluded", counted in M but NOT in N
  it("spatial-capable widget with cfg that excludes spatial sentinel: shape is ignored, counted in M", () => {
    const cfg: FilterSelectionConfig = {
      sourceMode: "allowlist",
      allowedSourceWidgetIds: [7], // no sentinel → spatial excluded
    };
    const fApplied = mkFilter("col1", 7);
    const shape = mkShape("Bbox 1");
    const result = computeFilterScopeSummary({
      cfg,
      activeFilters: [fApplied],
      activeShapes: [shape],
      spatialCapable: true,
    });
    // totalCount = 1 column + 1 shape = 2
    expect(result.totalCount).toBe(2);
    // appliedCount = 1 column (shape excluded)
    expect(result.appliedCount).toBe(1);
    expect(result.applied.shapes).toHaveLength(0);
    expect(result.ignored).toHaveLength(1);
    expect(result.ignored[0].kind).toBe("shape");
    expect(result.ignored[0].reason).toBe("source excluded");
    if (result.ignored[0].kind === "shape") {
      expect(result.ignored[0].shape).toBe(shape); // identity
    }
  });

  // Test 6: NON-spatial-capable table (spatialTarget undefined) with active shapes
  // → shapes are NOT counted in M; ignored has no shape entry
  it("non-spatial-capable table: shapes are NOT counted in M, no shape in ignored", () => {
    const cfg: FilterSelectionConfig = {
      sourceMode: "allowlist",
      allowedSourceWidgetIds: [7],
    };
    const fApplied = mkFilter("col1", 7);
    const shape = mkShape("Bbox 1");
    const result = computeFilterScopeSummary({
      cfg,
      activeFilters: [fApplied],
      activeShapes: [shape],
      spatialCapable: false, // no spatial target for this table
    });
    // totalCount = 1 column only (shape ignored for non-spatial-capable)
    expect(result.totalCount).toBe(1);
    expect(result.appliedCount).toBe(1);
    expect(result.applied.shapes).toHaveLength(0);
    expect(result.ignored.filter((i) => i.kind === "shape")).toHaveLength(0);
  });

  // Test 7: dv-bound widget → uses dvFilters; NO spatial folded in; accept-all
  it("dv-bound widget accept-all: appliedCount===totalCount, no spatial", () => {
    const dvFilters = [mkFilter("col1", 7), mkFilter("col2")];
    const result = computeFilterScopeSummary({
      cfg: undefined,
      activeFilters: dvFilters,
      activeShapes: [], // dv passes [] for shapes
      spatialCapable: false, // forced false for dv
    });
    expect(result.appliedCount).toBe(2);
    expect(result.totalCount).toBe(2);
    expect(result.ignored).toHaveLength(0);
    expect(result.applied.shapes).toHaveLength(0);
  });

  // Test 8: empty active filters + empty shapes → all zeros, empty arrays
  it("empty active filters + empty shapes → appliedCount 0, totalCount 0, empty arrays", () => {
    const result = computeFilterScopeSummary({
      cfg: undefined,
      activeFilters: [],
      activeShapes: [],
      spatialCapable: false,
    });
    expect(result.appliedCount).toBe(0);
    expect(result.totalCount).toBe(0);
    expect(result.applied.filters).toHaveLength(0);
    expect(result.applied.shapes).toHaveLength(0);
    expect(result.ignored).toHaveLength(0);
  });

  // Test 9: does not mutate inputs
  it("does not mutate input arrays", () => {
    const cfg: FilterSelectionConfig = {
      sourceMode: "allowlist",
      allowedSourceWidgetIds: [7],
    };
    const filters = [mkFilter("col1", 7), mkFilter("col2", 99)];
    const shapes = [mkShape("Bbox 1")];
    const filtersCopy = [...filters];
    const shapesCopy = [...shapes];
    computeFilterScopeSummary({
      cfg,
      activeFilters: filters,
      activeShapes: shapes,
      spatialCapable: true,
    });
    expect(filters).toHaveLength(filtersCopy.length);
    expect(shapes).toHaveLength(shapesCopy.length);
  });
});
