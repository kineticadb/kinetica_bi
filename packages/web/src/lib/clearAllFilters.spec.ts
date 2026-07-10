// Phase 109 (FCLEAR-V120-01): clearAllFilters — input-store-only global clear helper.
// The zustand reset shim (src/test/setup.ts) isolates store state between tests —
// no fake timers needed here (parallel-run timer-clean).

import { describe, it, expect } from "vitest";
import { clearAllFilters } from "./clearAllFilters";
import { useFilterStore } from "../store/filterStore";
import { useSpatialFilterStore } from "../store/spatialFilterStore";

describe("clearAllFilters", () => {
  it("empties filters, dvFilters, and spatial shapes in one call", () => {
    useFilterStore.getState().addFilter(1, { column: "zone", value: "East", dataType: "string", addedAt: 0 });
    useFilterStore.getState().addDvFilter(5, { column: "region", value: "West", dataType: "string", addedAt: 0 });
    useSpatialFilterStore.getState().addShape({
      type: "bbox",
      wkt: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
      measurement: "5km",
    });

    clearAllFilters();

    expect(useFilterStore.getState().filters).toEqual({});
    expect(useFilterStore.getState().dvFilters).toEqual({});
    expect(useSpatialFilterStore.getState().shapes).toEqual([]);
  });

  it("clears every tableId and dvId — loop covers all keys, not just the first", () => {
    useFilterStore.getState().addFilter(1, { column: "zone", value: "East", dataType: "string", addedAt: 0 });
    useFilterStore.getState().addFilter(2, { column: "region", value: "North", dataType: "string", addedAt: 0 });
    useFilterStore.getState().addDvFilter(5, { column: "category", value: "A", dataType: "string", addedAt: 0 });
    useFilterStore.getState().addDvFilter(6, { column: "category", value: "B", dataType: "string", addedAt: 0 });

    clearAllFilters();

    expect(useFilterStore.getState().filters).toEqual({});
    expect(useFilterStore.getState().dvFilters).toEqual({});
  });

  it("is a harmless no-op when all three stores are already empty", () => {
    expect(() => clearAllFilters()).not.toThrow();

    expect(useFilterStore.getState().filters).toEqual({});
    expect(useFilterStore.getState().dvFilters).toEqual({});
    expect(useSpatialFilterStore.getState().shapes).toEqual([]);
  });
});
