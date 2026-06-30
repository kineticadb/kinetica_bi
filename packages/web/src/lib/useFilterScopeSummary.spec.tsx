/**
 * GAP 3 / Test 7: dvFilterScopeDisabled accept-all for dv-bound badge.
 *
 * Tests the REAL useFilterScopeSummary hook (not mocked). Exercises the
 * dvFilterScopeDisabled path added in 96-03 (Phase 96 Plan 03).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFilterScopeSummary } from "./useFilterScopeSummary";
import { resolveFilterSet } from "./resolveFilterSet";
import { stableComboHash } from "./stableComboHash";
import { useAuthStore } from "../store/auth";
import { useFilterStore } from "../store/filterStore";
import { useFilterCombinationStore } from "../store/filterCombinationStore";

describe("useFilterScopeSummary — GAP 3 / Test 7: dvFilterScopeDisabled", () => {
  const dvId = 99;
  const tableId = 5;
  const excludingCfg = { sourceMode: "allowlist" as const, allowedSourceWidgetIds: [] };

  beforeEach(() => {
    // Reset relevant store slices to known defaults
    act(() => {
      useAuthStore.setState({ dvFilterScopeDisabled: false });
      useFilterStore.setState((s) => ({
        ...s,
        dvFilters: {
          [dvId]: [{ column: "status", value: "active", dataType: "string", sourceWidgetId: 7, addedAt: 1 }],
        },
        filters: {
          [tableId]: [{ column: "region", value: "east", dataType: "string", sourceWidgetId: 3, addedAt: 1 }],
        },
        filterVersion: (s.filterVersion ?? 0) + 1,
      }));
    });
  });

  it("dv-bound + dvFilterScopeDisabled=true + excluding cfg → appliedCount===totalCount (accept-all, badge hidden)", () => {
    // Flag OFF: excluding cfg is respected → ignored filter → badge would show
    const { result: r1 } = renderHook(() =>
      useFilterScopeSummary({
        cfg: excludingCfg,
        tableId: undefined,
        dynamicViewId: dvId,
        spatialCapable: false,
      }),
    );
    expect(r1.current.totalCount).toBe(1);
    expect(r1.current.appliedCount).toBe(0); // excluded by cfg

    // Flag ON: dvFilterScopeDisabled forces accept-all (cfg = undefined internally)
    act(() => {
      useAuthStore.setState({ dvFilterScopeDisabled: true });
    });
    const { result: r2 } = renderHook(() =>
      useFilterScopeSummary({
        cfg: excludingCfg,
        tableId: undefined,
        dynamicViewId: dvId,
        spatialCapable: false,
      }),
    );
    expect(r2.current.totalCount).toBe(1);
    expect(r2.current.appliedCount).toBe(1); // accept-all: none ignored → badge hidden

    act(() => {
      useAuthStore.setState({ dvFilterScopeDisabled: false });
    });
  });

  it("table-bound source is unaffected by dvFilterScopeDisabled=true", () => {
    act(() => {
      useAuthStore.setState({ dvFilterScopeDisabled: true });
    });
    const { result } = renderHook(() =>
      useFilterScopeSummary({
        cfg: excludingCfg,
        tableId,
        dynamicViewId: undefined,
        spatialCapable: false,
      }),
    );
    // table-bound: flag must NOT override cfg — filter still excluded
    expect(result.current.totalCount).toBe(1);
    expect(result.current.appliedCount).toBe(0);

    act(() => {
      useAuthStore.setState({ dvFilterScopeDisabled: false });
    });
  });

  it("dv-bound + dvFilterScopeDisabled=false + excluding cfg → still ignores filter (existing behavior unchanged)", () => {
    const { result } = renderHook(() =>
      useFilterScopeSummary({
        cfg: excludingCfg,
        tableId: undefined,
        dynamicViewId: dvId,
        spatialCapable: false,
      }),
    );
    expect(result.current.totalCount).toBe(1);
    expect(result.current.appliedCount).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Phase 96 UAT (ceiling fallback): fellBack detection via vizToHash comparison
// ──────────────────────────────────────────────────────────────────────────────

describe("useFilterScopeSummary — fellBack (ceiling fallback) detection", () => {
  const tableId = 5;
  // Two active filters on the table; widget cfg applies ONLY source 3 (region).
  const region = { column: "region", value: "east", dataType: "string" as const, sourceWidgetId: 3, addedAt: 1 };
  const status = { column: "status", value: "open", dataType: "string" as const, sourceWidgetId: 8, addedAt: 2 };
  const cfg = { sourceMode: "allowlist" as const, allowedSourceWidgetIds: [3] };
  const vizKey = "w:1";

  // Configured combo = {region}; fallback combo = {region,status} (all-filters).
  const configuredHash = stableComboHash("table", tableId, resolveFilterSet(cfg, [region, status]), []);
  const fallbackHash = stableComboHash("table", tableId, [region, status], []);

  beforeEach(() => {
    act(() => {
      useAuthStore.setState({ dvFilterScopeDisabled: false });
      useFilterStore.setState((s) => ({ ...s, filters: { [tableId]: [region, status] }, filterVersion: (s.filterVersion ?? 0) + 1 }));
      useFilterCombinationStore.getState().reset();
    });
  });

  it("fellBack=true when the viz's bound hash differs from its configured hash (remapped to fallback)", () => {
    act(() => {
      useFilterCombinationStore.getState().setVizHash(vizKey, fallbackHash);
    });
    const { result } = renderHook(() =>
      useFilterScopeSummary({ cfg, tableId, dynamicViewId: undefined, spatialCapable: false, vizKey }),
    );
    expect(result.current.fellBack).toBe(true);
    // Configured scope still computed (1 of 2) — the badge uses fellBack to override the label.
    expect(result.current.appliedCount).toBe(1);
    expect(result.current.totalCount).toBe(2);
  });

  it("fellBack=false when the viz is bound to its own configured hash (no fallback)", () => {
    act(() => {
      useFilterCombinationStore.getState().setVizHash(vizKey, configuredHash);
    });
    const { result } = renderHook(() =>
      useFilterScopeSummary({ cfg, tableId, dynamicViewId: undefined, spatialCapable: false, vizKey }),
    );
    expect(result.current.fellBack).toBe(false);
  });

  it("fellBack=false when no vizKey is provided (detection disabled)", () => {
    act(() => {
      useFilterCombinationStore.getState().setVizHash(vizKey, fallbackHash);
    });
    const { result } = renderHook(() =>
      useFilterScopeSummary({ cfg, tableId, dynamicViewId: undefined, spatialCapable: false }),
    );
    expect(result.current.fellBack).toBe(false);
  });
});
