/**
 * GAP 3 / Test 7: dvFilterScopeDisabled accept-all for dv-bound badge.
 *
 * Tests the REAL useFilterScopeSummary hook (not mocked). Exercises the
 * dvFilterScopeDisabled path added in 96-03 (Phase 96 Plan 03).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFilterScopeSummary } from "./useFilterScopeSummary";
import { useAuthStore } from "../store/auth";
import { useFilterStore } from "../store/filterStore";

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
