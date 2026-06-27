import { describe, it, expect } from "vitest";
import { resolveFilterSet } from "./resolveFilterSet";
import type { ActiveFilter } from "../store/filterStore";
import type { FilterSelectionConfig } from "../types/filterSelection";

// Factory: builds a minimal ActiveFilter for testing.
function mk(column: string, sourceWidgetId?: number): ActiveFilter {
  return { column, value: "x", dataType: "string", sourceWidgetId, addedAt: 0 };
}

describe("resolveFilterSet", () => {
  // Test 1: absent config → accept-all
  it("returns ALL filters unchanged when config is undefined (accept-all default)", () => {
    const filters = [mk("col1", 7), mk("col2"), mk("col3", 9)];
    const result = resolveFilterSet(undefined, filters);
    expect(result).toHaveLength(3);
    // Same elements (not necessarily same reference for array, but same object refs)
    expect(result[0]).toBe(filters[0]);
    expect(result[1]).toBe(filters[1]);
    expect(result[2]).toBe(filters[2]);
  });

  // Test 2: explicit "all" mode → accept-all
  it("returns ALL filters unchanged when sourceMode is 'all'", () => {
    const cfg: FilterSelectionConfig = { sourceMode: "all", allowedSourceWidgetIds: [] };
    const filters = [mk("col1", 7), mk("col2", 9)];
    const result = resolveFilterSet(cfg, filters);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(filters[0]);
    expect(result[1]).toBe(filters[1]);
  });

  // Test 3: allowlist include — sourceWidgetId in list IS returned
  it("includes filters whose sourceWidgetId is in the allowedSourceWidgetIds list", () => {
    const cfg: FilterSelectionConfig = {
      sourceMode: "allowlist",
      allowedSourceWidgetIds: [7],
    };
    const filters = [mk("col1", 7), mk("col2", 9)];
    const result = resolveFilterSet(cfg, filters);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(filters[0]);
  });

  // Test 4: allowlist exclude by id — sourceWidgetId not in list is NOT returned
  it("excludes filters whose sourceWidgetId is not in the allowedSourceWidgetIds list", () => {
    const cfg: FilterSelectionConfig = {
      sourceMode: "allowlist",
      allowedSourceWidgetIds: [7],
    };
    const filters = [mk("col1", 9)];
    const result = resolveFilterSet(cfg, filters);
    expect(result).toHaveLength(0);
  });

  // Test 5: allowlist exclude undefined source — filters with no sourceWidgetId are NOT returned
  it("excludes filters with undefined sourceWidgetId under allowlist mode", () => {
    const cfg: FilterSelectionConfig = {
      sourceMode: "allowlist",
      allowedSourceWidgetIds: [7],
    };
    const filters = [mk("col1", undefined)];
    const result = resolveFilterSet(cfg, filters);
    expect(result).toHaveLength(0);
  });

  // Test 6: mixed — returns exactly allow-listed sources, preserving order
  it("returns only filters from allowed sources, preserving relative order", () => {
    const cfg: FilterSelectionConfig = {
      sourceMode: "allowlist",
      allowedSourceWidgetIds: [7, 12],
    };
    const f7 = mk("col_a", 7);
    const f9 = mk("col_b", 9);
    const f12 = mk("col_c", 12);
    const fUndef = mk("col_d", undefined);
    const filters = [f7, f9, f12, fUndef];
    const result = resolveFilterSet(cfg, filters);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(f7);
    expect(result[1]).toBe(f12);
  });

  // Test 7: empty allow-list → returns [] for any non-empty input
  it("returns empty array when allowedSourceWidgetIds is empty in allowlist mode", () => {
    const cfg: FilterSelectionConfig = {
      sourceMode: "allowlist",
      allowedSourceWidgetIds: [],
    };
    const filters = [mk("col1", 7), mk("col2", 9)];
    const result = resolveFilterSet(cfg, filters);
    expect(result).toHaveLength(0);
  });

  // Test 8: no mutation — input array and elements unchanged
  it("does not mutate the input array or its elements", () => {
    const cfg: FilterSelectionConfig = {
      sourceMode: "allowlist",
      allowedSourceWidgetIds: [7],
    };
    const f1 = mk("col1", 7);
    const f2 = mk("col2", 9);
    const filters = [f1, f2];
    const originalLength = filters.length;
    resolveFilterSet(cfg, filters);
    expect(filters).toHaveLength(originalLength);
    expect(filters[0]).toBe(f1);
    expect(filters[1]).toBe(f2);
  });

  // Test 9: empty input → returns [] for both "all" and "allowlist"
  it("returns empty array when allFilters is empty under 'all' mode", () => {
    const cfgAll: FilterSelectionConfig = { sourceMode: "all", allowedSourceWidgetIds: [] };
    expect(resolveFilterSet(cfgAll, [])).toHaveLength(0);
  });

  it("returns empty array when allFilters is empty under 'allowlist' mode", () => {
    const cfgAllowlist: FilterSelectionConfig = {
      sourceMode: "allowlist",
      allowedSourceWidgetIds: [7],
    };
    expect(resolveFilterSet(cfgAllowlist, [])).toHaveLength(0);
  });
});
