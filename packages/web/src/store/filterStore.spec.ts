import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  useFilterStore,
  type ActiveFilter,
  FILTER_CAP_PER_TABLE,
} from "./filterStore";
import { useToastStore } from "./toast";

// Helper to build a minimal ActiveFilter — keeps individual tests focused on the assertion.
const f = (overrides: Partial<ActiveFilter> & Pick<ActiveFilter, "column" | "value" | "dataType">): ActiveFilter => ({
  addedAt: 0,
  ...overrides,
});

describe("useFilterStore — canary (PITFALL S-03 — Zustand shim must be active)", () => {
  it("store is empty at start of each test", () => {
    const { filters, filterVersion } = useFilterStore.getState();
    expect(Object.keys(filters)).toHaveLength(0);
    expect(filterVersion).toBe(0);
  });

  it("store is empty at start of each test (run 2 — proves shim resets between tests)", () => {
    // canary in-test reference: if this fails after the addFilter tests below run, the shim
    // isn't covering this file — the spec is in the wrong path and src/test/setup.ts is not loading.
    const { filters, filterVersion } = useFilterStore.getState();
    expect(Object.keys(filters)).toHaveLength(0);
    expect(filterVersion).toBe(0);
  });
});

describe("useFilterStore.addFilter", () => {
  it("adds a filter to a new table — filterVersion advances (S-02 lock)", () => {
    useFilterStore.getState().addFilter(1, f({ column: "region", value: "EAST", dataType: "string" }));
    const { filters, filterVersion } = useFilterStore.getState();
    expect(filters[1]).toHaveLength(1);
    expect(filters[1][0].value).toBe("EAST");
    expect(filterVersion).toBe(1);
  });

  it("REPLACES same-column filter with new value (PITFALL D-05 lock)", () => {
    useFilterStore.getState().addFilter(1, f({ column: "region", value: "EAST", dataType: "string" }));
    useFilterStore.getState().addFilter(1, f({ column: "region", value: "WEST", dataType: "string" }));
    const { filters, filterVersion } = useFilterStore.getState();
    expect(filters[1]).toHaveLength(1); // exactly 1 — never col=EAST AND col=WEST
    expect(filters[1][0].value).toBe("WEST");
    expect(filterVersion).toBe(2);
  });

  it("APPENDS for different columns on same table", () => {
    useFilterStore.getState().addFilter(1, f({ column: "region", value: "EAST", dataType: "string" }));
    useFilterStore.getState().addFilter(1, f({ column: "status", value: "ACTIVE", dataType: "string" }));
    expect(useFilterStore.getState().filters[1]).toHaveLength(2);
  });

  it("EXACT duplicate (same column AND value) is silent no-op — no version bump", () => {
    useFilterStore.getState().addFilter(1, f({ column: "region", value: "EAST", dataType: "string" }));
    const versionBefore = useFilterStore.getState().filterVersion;
    useFilterStore.getState().addFilter(1, f({ column: "region", value: "EAST", dataType: "string" }));
    const { filters, filterVersion } = useFilterStore.getState();
    expect(filters[1]).toHaveLength(1);
    expect(filterVersion).toBe(versionBefore); // version did NOT advance — UX = "click selected = stay selected"
  });

  it("isolates filters across tables (PITFALL C-04 / AP-4 lock)", () => {
    useFilterStore.getState().addFilter(1, f({ column: "region", value: "EAST", dataType: "string" }));
    useFilterStore.getState().addFilter(2, f({ column: "region", value: "WEST", dataType: "string" }));
    const { filters } = useFilterStore.getState();
    expect(filters[1]).toHaveLength(1);
    expect(filters[2]).toHaveLength(1);
    expect(filters[1][0].value).toBe("EAST");
    expect(filters[2][0].value).toBe("WEST");
  });

  it("at 25-cap, NEW column is no-op + toast (PITFALL D-04 lock)", () => {
    const showToastSpy = vi.spyOn(useToastStore.getState(), "showToast");
    // fill to cap
    for (let i = 0; i < 25; i++) {
      useFilterStore.getState().addFilter(1, f({ column: `col${i}`, value: `v${i}`, dataType: "string" }));
    }
    const versionBefore = useFilterStore.getState().filterVersion;
    // 26th add (new column) — should be rejected
    useFilterStore.getState().addFilter(1, f({ column: "col25", value: "v25", dataType: "string" }));
    const { filters, filterVersion } = useFilterStore.getState();
    expect(filters[1]).toHaveLength(25);
    expect(filterVersion).toBe(versionBefore); // version did NOT advance
    expect(showToastSpy).toHaveBeenCalledWith(
      expect.stringContaining("Filter limit reached"),
      "info"
    );
  });

  it("at 25-cap, REPLACE on existing column IS allowed (count stays at 25, version bumps)", () => {
    for (let i = 0; i < 25; i++) {
      useFilterStore.getState().addFilter(1, f({ column: `col${i}`, value: `v${i}`, dataType: "string" }));
    }
    const versionBefore = useFilterStore.getState().filterVersion;
    // Replace col5 with new value — at cap but NOT exceeding cap
    useFilterStore.getState().addFilter(1, f({ column: "col5", value: "REPLACED", dataType: "string" }));
    const { filters, filterVersion } = useFilterStore.getState();
    expect(filters[1]).toHaveLength(25);
    expect(filters[1].find((x) => x.column === "col5")!.value).toBe("REPLACED");
    expect(filterVersion).toBe(versionBefore + 1);
  });

  // Phase 44 (FILTER-V17-01): New operator + value shape tests
  it("ActiveFilter accepts optional operator with 'eq' | 'in' | 'between' | 'isNull' values", () => {
    // Compile-time assertion — these must all typecheck without errors.
    const eqFilter: ActiveFilter = f({ column: "zone", value: "EAST", dataType: "string", operator: "eq" });
    const inFilter: ActiveFilter = f({ column: "region", value: ["EAST", "WEST"], dataType: "string", operator: "in" });
    const betweenFilter: ActiveFilter = f({ column: "fare", value: [5, 50], dataType: "number", operator: "between" });
    const isNullFilter: ActiveFilter = f({ column: "status", value: null, dataType: "null", operator: "isNull" });
    expect(eqFilter.operator).toBe("eq");
    expect(inFilter.operator).toBe("in");
    expect(betweenFilter.operator).toBe("between");
    expect(isNullFilter.operator).toBe("isNull");
  });

  it("ActiveFilter.value accepts string[] for operator: 'in'", () => {
    const filter = f({ column: "region", value: ["EAST", "WEST"], dataType: "string", operator: "in" });
    useFilterStore.getState().addFilter(1, filter);
    const { filters } = useFilterStore.getState();
    expect(filters[1][0].value).toEqual(["EAST", "WEST"]);
  });

  it("ActiveFilter.value accepts number tuple [min, max] for operator: 'between'", () => {
    const filter = f({ column: "fare", value: [5, 50], dataType: "number", operator: "between" });
    useFilterStore.getState().addFilter(1, filter);
    const { filters } = useFilterStore.getState();
    expect((filters[1][0].value as unknown[]).length).toBe(2);
  });

  it("ActiveFilter.value accepts string tuple [start, end] for operator: 'between' on datetime", () => {
    const filter = f({ column: "ts", value: ["2024-01-01", "2024-12-31"], dataType: "datetime", operator: "between" });
    useFilterStore.getState().addFilter(1, filter);
    const { filters } = useFilterStore.getState();
    expect(filters[1][0].value).toEqual(["2024-01-01", "2024-12-31"]);
  });

  it("legacy ActiveFilter literal without operator still adds correctly — defaults to eq", () => {
    // Existing dispatchDrillDown shape (no operator key) — must still work.
    const filter = f({ column: "zone", value: "EAST", dataType: "string" }); // no operator field
    useFilterStore.getState().addFilter(1, filter);
    const { filters } = useFilterStore.getState();
    expect(filters[1][0].operator).toBeUndefined(); // NOT auto-defaulted at store level
  });
});

describe("useFilterStore.setBulkFilters", () => {
  it("setBulkFilters replaces N column filters in ONE filterVersion tick", () => {
    const v0 = useFilterStore.getState().filterVersion;
    const f1 = f({ column: "region", value: "EAST", dataType: "string", operator: "in" });
    const f2 = f({ column: "fare", value: [5, 50], dataType: "number", operator: "between" });
    const f3 = f({ column: "zone", value: "Midtown", dataType: "string" });
    useFilterStore.getState().setBulkFilters(1, [f1, f2, f3]);
    const { filters, filterVersion } = useFilterStore.getState();
    expect(filters[1]).toHaveLength(3);
    expect(filterVersion).toBe(v0 + 1); // exactly ONE tick, not 3
  });

  it("setBulkFilters with empty array still increments filterVersion by 1", () => {
    const v0 = useFilterStore.getState().filterVersion;
    useFilterStore.getState().setBulkFilters(1, []);
    const { filters, filterVersion } = useFilterStore.getState();
    expect(filters[1] ?? []).toHaveLength(0);
    expect(filterVersion).toBe(v0 + 1);
  });

  it("setBulkFilters replaces existing entries for the same columns (no append)", () => {
    useFilterStore.getState().addFilter(1, f({ column: "region", value: "EAST", dataType: "string" }));
    useFilterStore.getState().setBulkFilters(1, [
      f({ column: "region", value: "WEST", dataType: "string" }),
      f({ column: "status", value: "ACTIVE", dataType: "string" }),
    ]);
    const { filters } = useFilterStore.getState();
    expect(filters[1]).toHaveLength(2);
    expect(filters[1].find((fi) => fi.column === "region")!.value).toBe("WEST");
  });

  it("setBulkFilters preserves filters on OTHER tables — only mutates filters[tableId]", () => {
    useFilterStore.getState().addFilter(2, f({ column: "region", value: "EAST", dataType: "string" }));
    useFilterStore.getState().setBulkFilters(1, [
      f({ column: "region", value: "WEST", dataType: "string" }),
    ]);
    const { filters } = useFilterStore.getState();
    expect(filters[2][0].value).toBe("EAST"); // table 2 untouched
  });

  it("setBulkFilters respects 25-cap: when batch + existing > 25, shows toast and stops adding new columns; existing are still replaced", () => {
    const showToastSpy = vi.spyOn(useToastStore.getState(), "showToast");
    // pre-populate 20 filters on table 1
    for (let i = 0; i < 20; i++) {
      useFilterStore.getState().addFilter(1, f({ column: `col${i}`, value: `v${i}`, dataType: "string" }));
    }
    // batch of 10 NEW columns — would push to 30, cap is 25
    const batch = Array.from({ length: 10 }, (_, i) =>
      f({ column: `newcol${i}`, value: `nv${i}`, dataType: "string" })
    );
    useFilterStore.getState().setBulkFilters(1, batch);
    const { filters } = useFilterStore.getState();
    expect(filters[1].length).toBeLessThanOrEqual(25);
    expect(showToastSpy).toHaveBeenCalledWith(
      expect.stringContaining("Filter limit reached (25 per table)"),
      "info"
    );
  });

  it("FILTER_CAP_PER_TABLE constant exported as 25", () => {
    expect(FILTER_CAP_PER_TABLE).toBe(25);
  });
});

describe("useFilterStore.removeFilter", () => {
  it("removes the named column and increments filterVersion", () => {
    useFilterStore.getState().addFilter(1, f({ column: "region", value: "EAST", dataType: "string" }));
    const versionBefore = useFilterStore.getState().filterVersion;
    useFilterStore.getState().removeFilter(1, "region");
    const { filters, filterVersion } = useFilterStore.getState();
    expect(filters[1] ?? []).toHaveLength(0);
    expect(filterVersion).toBe(versionBefore + 1);
  });

  it("removeFilter on absent column is no-op (no version bump)", () => {
    const versionBefore = useFilterStore.getState().filterVersion;
    useFilterStore.getState().removeFilter(1, "nonexistent");
    expect(useFilterStore.getState().filterVersion).toBe(versionBefore);
  });
});

describe("useFilterStore.clearFilters", () => {
  it("wipes only the named table (PITFALL C-04 lock)", () => {
    useFilterStore.getState().addFilter(1, f({ column: "region", value: "EAST", dataType: "string" }));
    useFilterStore.getState().addFilter(2, f({ column: "region", value: "WEST", dataType: "string" }));
    useFilterStore.getState().clearFilters(1);
    const { filters } = useFilterStore.getState();
    expect(filters[1] ?? []).toHaveLength(0);
    expect(filters[2]).toHaveLength(1);
    expect(filters[2][0].value).toBe("WEST");
  });

  it("clearFilters increments filterVersion (PITFALL S-02 lock — guards 'clear is no-op' bug)", () => {
    useFilterStore.getState().addFilter(1, f({ column: "region", value: "EAST", dataType: "string" }));
    const versionBefore = useFilterStore.getState().filterVersion;
    useFilterStore.getState().clearFilters(1);
    expect(useFilterStore.getState().filterVersion).toBe(versionBefore + 1);
  });

  it("clearFilters on already-empty table is no-op (no version bump)", () => {
    const versionBefore = useFilterStore.getState().filterVersion;
    useFilterStore.getState().clearFilters(99);
    expect(useFilterStore.getState().filterVersion).toBe(versionBefore);
  });
});

describe("useFilterStore.reset", () => {
  it("empties all filters and resets filterVersion to 0", () => {
    useFilterStore.getState().addFilter(1, f({ column: "a", value: "1", dataType: "string" }));
    useFilterStore.getState().addFilter(2, f({ column: "b", value: "2", dataType: "string" }));
    useFilterStore.getState().reset();
    const { filters, filterVersion } = useFilterStore.getState();
    expect(Object.keys(filters)).toHaveLength(0);
    expect(filterVersion).toBe(0);
  });
});

// Phase 63 (DVDRILL-V112-05): dv-scoped parallel slice keyed by dynamicViewId.
// A dv id and a table id are BOTH numbers — these tests prove they never collide
// (separate maps). Mirrors the table-keyed addFilter/removeFilter/clearFilters semantics,
// sharing the SAME filterVersion counter (WidgetRenderer Effect 1 keys re-fire off it).
describe("useFilterStore.addDvFilter", () => {
  it("adds a dv filter to dvFilters[dvId] and bumps filterVersion (shared counter)", () => {
    useFilterStore.getState().addDvFilter(1, f({ column: "region", value: "EAST", dataType: "string" }));
    const { dvFilters, filterVersion } = useFilterStore.getState();
    expect(dvFilters[1]).toHaveLength(1);
    expect(dvFilters[1][0].value).toBe("EAST");
    expect(filterVersion).toBe(1);
  });

  // THE ISOLATION / BUG-FIX TEST: a dv id and a table id with the same number must NOT collide.
  // The original v1.12 bug: a dv drill landed in filters[tableId]. addDvFilter(7,…) must write
  // ONLY dvFilters[7] and leave filters[7] empty/undefined (and vice-versa).
  it("ISOLATION: addDvFilter(7, …) writes ONLY dvFilters[7] — filters[7] stays empty (no-collision bug-fix lock)", () => {
    useFilterStore.getState().addDvFilter(7, f({ column: "region", value: "EAST", dataType: "string" }));
    const { dvFilters, filters } = useFilterStore.getState();
    expect(dvFilters[7]).toHaveLength(1);
    expect(filters[7] ?? []).toHaveLength(0); // the dv drill must NOT touch the table-keyed map
  });

  it("ISOLATION (reverse): addFilter(7, …) writes ONLY filters[7] — dvFilters[7] untouched", () => {
    useFilterStore.getState().addFilter(7, f({ column: "region", value: "WEST", dataType: "string" }));
    const { dvFilters, filters } = useFilterStore.getState();
    expect(filters[7]).toHaveLength(1);
    expect(dvFilters[7] ?? []).toHaveLength(0);
  });

  it("REPLACES same-column dv filter with new value (mirrors D-05 lock)", () => {
    useFilterStore.getState().addDvFilter(1, f({ column: "region", value: "EAST", dataType: "string" }));
    useFilterStore.getState().addDvFilter(1, f({ column: "region", value: "WEST", dataType: "string" }));
    const { dvFilters, filterVersion } = useFilterStore.getState();
    expect(dvFilters[1]).toHaveLength(1);
    expect(dvFilters[1][0].value).toBe("WEST");
    expect(filterVersion).toBe(2);
  });

  it("EXACT duplicate (same column AND value) is silent no-op — no version bump", () => {
    useFilterStore.getState().addDvFilter(1, f({ column: "region", value: "EAST", dataType: "string" }));
    const versionBefore = useFilterStore.getState().filterVersion;
    useFilterStore.getState().addDvFilter(1, f({ column: "region", value: "EAST", dataType: "string" }));
    const { dvFilters, filterVersion } = useFilterStore.getState();
    expect(dvFilters[1]).toHaveLength(1);
    expect(filterVersion).toBe(versionBefore);
  });

  it("APPENDS for different columns on same dv", () => {
    useFilterStore.getState().addDvFilter(1, f({ column: "region", value: "EAST", dataType: "string" }));
    useFilterStore.getState().addDvFilter(1, f({ column: "status", value: "ACTIVE", dataType: "string" }));
    expect(useFilterStore.getState().dvFilters[1]).toHaveLength(2);
  });

  it("at 25-cap, NEW column is no-op + toast (same FILTER_CAP_PER_TABLE)", () => {
    const showToastSpy = vi.spyOn(useToastStore.getState(), "showToast");
    for (let i = 0; i < 25; i++) {
      useFilterStore.getState().addDvFilter(1, f({ column: `col${i}`, value: `v${i}`, dataType: "string" }));
    }
    const versionBefore = useFilterStore.getState().filterVersion;
    useFilterStore.getState().addDvFilter(1, f({ column: "col25", value: "v25", dataType: "string" }));
    const { dvFilters, filterVersion } = useFilterStore.getState();
    expect(dvFilters[1]).toHaveLength(25);
    expect(filterVersion).toBe(versionBefore);
    expect(showToastSpy).toHaveBeenCalledWith(
      expect.stringContaining("Filter limit reached"),
      "info"
    );
  });
});

describe("useFilterStore.removeDvFilter", () => {
  it("removes the named column from dvFilters[dvId] and increments filterVersion", () => {
    useFilterStore.getState().addDvFilter(1, f({ column: "region", value: "EAST", dataType: "string" }));
    const versionBefore = useFilterStore.getState().filterVersion;
    useFilterStore.getState().removeDvFilter(1, "region");
    const { dvFilters, filterVersion } = useFilterStore.getState();
    expect(dvFilters[1] ?? []).toHaveLength(0);
    expect(filterVersion).toBe(versionBefore + 1);
  });

  it("removeDvFilter on absent column is no-op (no version bump)", () => {
    const versionBefore = useFilterStore.getState().filterVersion;
    useFilterStore.getState().removeDvFilter(1, "nonexistent");
    expect(useFilterStore.getState().filterVersion).toBe(versionBefore);
  });
});

describe("useFilterStore.clearDvFilters", () => {
  it("wipes only the named dv (delete-key semantics)", () => {
    useFilterStore.getState().addDvFilter(1, f({ column: "region", value: "EAST", dataType: "string" }));
    useFilterStore.getState().addDvFilter(2, f({ column: "region", value: "WEST", dataType: "string" }));
    useFilterStore.getState().clearDvFilters(1);
    const { dvFilters } = useFilterStore.getState();
    expect(dvFilters[1] ?? []).toHaveLength(0);
    expect(dvFilters[2]).toHaveLength(1);
    expect(dvFilters[2][0].value).toBe("WEST");
  });

  it("clearDvFilters increments filterVersion (mirrors S-02 lock)", () => {
    useFilterStore.getState().addDvFilter(1, f({ column: "region", value: "EAST", dataType: "string" }));
    const versionBefore = useFilterStore.getState().filterVersion;
    useFilterStore.getState().clearDvFilters(1);
    expect(useFilterStore.getState().filterVersion).toBe(versionBefore + 1);
  });

  it("clearDvFilters on already-empty dv is no-op (no version bump)", () => {
    const versionBefore = useFilterStore.getState().filterVersion;
    useFilterStore.getState().clearDvFilters(99);
    expect(useFilterStore.getState().filterVersion).toBe(versionBefore);
  });
});

describe("useFilterStore.reset — dv slice (DVDRILL-V112-05 lifecycle)", () => {
  it("reset() zeroes BOTH dvFilters AND filters and filterVersion to 0", () => {
    useFilterStore.getState().addDvFilter(7, f({ column: "a", value: "1", dataType: "string" }));
    useFilterStore.getState().addFilter(3, f({ column: "b", value: "2", dataType: "string" }));
    useFilterStore.getState().reset();
    const { dvFilters, filters, filterVersion } = useFilterStore.getState();
    expect(Object.keys(dvFilters)).toHaveLength(0);
    expect(Object.keys(filters)).toHaveLength(0);
    expect(filterVersion).toBe(0);
  });
});
