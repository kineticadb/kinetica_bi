/**
 * Phase 90 Plan 03 (COMBO-V118-01 / COMBO-V118-03): useCombinationOrchestrator spec.
 *
 * 11 scenarios covering:
 *   1  No trigger widgets → zero POSTs
 *   2  Single widget, no active filters (NOFILTER) → zero POSTs; vizToHash undefined
 *   3  Single widget, one active filter → ONE POST with correct combinationKey; registry entry
 *   4  Two widgets, same hash → ONE POST; both vizToHash point to same hash; refCount 2
 *   5  Two widgets, different hashes → TWO POSTs; two distinct registry entries
 *   6  Hash gone on tick 2 → release; dropCombinationView called when refCount reaches 0
 *   7  markMaterializing race guard → second tick skips POST when materializing:true
 *   8  Ceiling exceeded → at most N unique hashes; over-ceiling widgets fallback; toast once
 *   9  NOFILTER sentinel guard → no markMaterializing, no POST, setVizHash undefined
 *  10  filterVersion dep isolation → combinationVersion bump does NOT re-fire orchestrator
 *  11  Unmount abort → AbortController aborted; no setEntry after unmount
 *
 * Phase 93.5 spatial scenarios (SC1-SC6) + sole-trigger grep gate.
 */

import * as fs from "fs";
import * as path from "path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { Mock } from "vitest";

import { useCombinationOrchestrator } from "./useCombinationOrchestrator";
import { useFilterStore } from "../store/filterStore";
import { useFilterCombinationStore } from "../store/filterCombinationStore";
import { useAuthStore } from "../store/auth";
import { useToastStore } from "../store/toast";
import { useSpatialFilterStore } from "../store/spatialFilterStore";
import { stableComboHash } from "../lib/stableComboHash";
import { SPATIAL_DRAWS_SENTINEL } from "../components/charts/filterSourceTypes";
import type { WidgetDto, DashboardLayerDto } from "../api/client";
import type { ActiveFilter } from "../store/filterStore";

// ---------------------------------------------------------------------------
// Mock the client module
// ---------------------------------------------------------------------------
vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    materializeFilter: vi.fn(),
    dropCombinationView: vi.fn(),
  };
});

import { materializeFilter, dropCombinationView } from "../api/client";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------
const DASH_ID = 42;
const TABLE_A = 100;
const TABLE_B = 200;

/** Build a map widget with an eligible latlon spatial target for the given tableId. */
function makeMapWidgetWithTarget(id: number, tableId: number): WidgetDto {
  return {
    id,
    dashboard_id: DASH_ID,
    title: `Map ${id}`,
    type: "map",
    position: id,
    config: {
      spatialTargets: [
        { tableId, spatialMode: "latlon", lonCol: "lon", latCol: "lat" },
      ],
    },
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
  };
}

function makeWidget(overrides: {
  id: number;
  type?: string;
  tableId?: number;
  filterSelection?: { sourceMode: "all" | "allowlist"; allowedSourceWidgetIds: (number | string)[] };
}): WidgetDto {
  return {
    id: overrides.id,
    dashboard_id: DASH_ID,
    title: `Widget ${overrides.id}`,
    type: overrides.type ?? "bar",
    position: 0,
    config: {
      ...(overrides.tableId !== undefined ? { tableId: overrides.tableId } : {}),
      ...(overrides.filterSelection ? { filterSelection: overrides.filterSelection } : {}),
    },
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
  };
}

function makeLayer(overrides: {
  id: number;
  tableId?: number;
  dynamic_view_id?: number | null;
  filter_scope?: { sourceMode: "all" | "allowlist"; allowedSourceWidgetIds: number[] };
}): DashboardLayerDto {
  return {
    id: overrides.id,
    dashboard_id: DASH_ID,
    table_id: overrides.tableId ?? TABLE_A,
    layer_type: "KineticaWms",
    position: 0,
    config: {},
    info_enabled: 0,
    info_columns: null,
    info_template: null,
    dynamic_view_id: overrides.dynamic_view_id ?? null,
    cb_config: null,
    track_config: null,
    ...(overrides.filter_scope ? { filter_scope: overrides.filter_scope } : {}),
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
  };
}

const FILTER_A: ActiveFilter = {
  column: "status",
  value: "active",
  dataType: "string",
  addedAt: 1000,
};

const FILTER_B: ActiveFilter = {
  column: "region",
  value: "west",
  dataType: "string",
  addedAt: 2000,
};

// Bump spatialFilterVersion to trigger the orchestrator (mirrors bumpFilterVersion)
function bumpSpatialFilterVersion() {
  act(() => {
    useSpatialFilterStore.setState((s) => ({ spatialFilterVersion: s.spatialFilterVersion + 1 }));
  });
}

// Set shapes + bump spatialFilterVersion atomically
function setShapes(shapes: { id: string; type: "bbox" | "lasso" | "circle"; wkt: string; label: string; measurement: string; addedAt: number }[]) {
  act(() => {
    useSpatialFilterStore.setState({ shapes, spatialFilterVersion: shapes.length > 0 ? 1 : 0 });
  });
}

// Advance the 300ms debounce using fake timers
function advanceDebounce() {
  act(() => {
    vi.advanceTimersByTime(310);
  });
}

// Bump filterVersion to trigger the orchestrator
function bumpFilterVersion() {
  act(() => {
    useFilterStore.setState((s) => ({ filterVersion: s.filterVersion + 1 }));
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
describe("useCombinationOrchestrator (Phase 90 COMBO-V118-01/03)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Reset stores to clean baseline
    useFilterCombinationStore.getState().reset();
    useFilterStore.setState({ filters: {}, dvFilters: {}, filterVersion: 0 });
    useAuthStore.setState({ maxCombinationViewsPerTable: 10 } as Parameters<typeof useAuthStore.setState>[0]);
    // Default: materializeFilter resolves to a view; dropCombinationView resolves OK
    (materializeFilter as Mock).mockReset();
    (materializeFilter as Mock).mockResolvedValue({ viewName: "_kbi_combo_v", expiresAt: 9_999_999_999 });
    (dropCombinationView as Mock).mockReset();
    (dropCombinationView as Mock).mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Scenario 1: No trigger widgets → zero POSTs
  // -------------------------------------------------------------------------
  it("1: empty widgets array → zero POSTs fired", async () => {
    renderHook(() => useCombinationOrchestrator(DASH_ID, [], []));
    bumpFilterVersion();
    advanceDebounce();
    // Let all microtasks settle
    await act(async () => {
      await Promise.resolve();
    });
    expect(materializeFilter).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Scenario 2: Single widget, no active filters → NOFILTER → zero POSTs
  // -------------------------------------------------------------------------
  it("2: single widget with no active filters → NOFILTER → zero POSTs; vizToHash undefined", async () => {
    const w = makeWidget({ id: 1, tableId: TABLE_A });
    // No filters in store for TABLE_A → resolveFilterSet returns [] → NOFILTER hash
    renderHook(() => useCombinationOrchestrator(DASH_ID, [w], []));
    bumpFilterVersion();
    advanceDebounce();
    await act(async () => {
      await Promise.resolve();
    });

    expect(materializeFilter).not.toHaveBeenCalled();
    // vizToHash for this widget should be undefined (deleted or never set)
    const state = useFilterCombinationStore.getState();
    const vizVal = state.vizToHash["w:1"];
    expect(vizVal === undefined || !("w:1" in state.vizToHash)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Scenario 3: Single widget, one active filter → ONE POST with correct combinationKey
  // -------------------------------------------------------------------------
  it("3: single widget with one active filter → ONE POST with correct combinationKey; registry entry present", async () => {
    const w = makeWidget({ id: 1, tableId: TABLE_A });
    useFilterStore.setState({ filters: { [TABLE_A]: [FILTER_A] } } as Parameters<typeof useFilterStore.setState>[0]);

    renderHook(() => useCombinationOrchestrator(DASH_ID, [w], []));
    bumpFilterVersion();
    advanceDebounce();

    await waitFor(() => {
      expect(materializeFilter).toHaveBeenCalledTimes(1);
    });

    const expectedHash = stableComboHash("table", TABLE_A, [FILTER_A]);
    const call = (materializeFilter as Mock).mock.calls[0][0];
    expect(call.combinationKey).toBe(expectedHash);
    expect(call.tableId).toBe(TABLE_A);
    expect(call.dashboardId).toBe(DASH_ID);

    // Wait for setEntry (async .then resolves)
    await waitFor(() => {
      const registry = useFilterCombinationStore.getState().registry;
      expect(registry[expectedHash]).toBeDefined();
      expect(registry[expectedHash]!.viewName).toBe("_kbi_combo_v");
      expect(registry[expectedHash]!.materializing).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 4: Two widgets, same hash → ONE POST; both vizToHash same hash; refCount 2
  // -------------------------------------------------------------------------
  it("4: two widgets on same table with accept-all (same resolved set) → ONE POST; refCount 2", async () => {
    const w1 = makeWidget({ id: 1, tableId: TABLE_A });
    const w2 = makeWidget({ id: 2, tableId: TABLE_A });
    useFilterStore.setState({ filters: { [TABLE_A]: [FILTER_A] } } as Parameters<typeof useFilterStore.setState>[0]);

    renderHook(() => useCombinationOrchestrator(DASH_ID, [w1, w2], []));
    bumpFilterVersion();
    advanceDebounce();

    await waitFor(() => {
      expect(materializeFilter).toHaveBeenCalledTimes(1);
    });

    const expectedHash = stableComboHash("table", TABLE_A, [FILTER_A]);

    // Wait for both vizToHash entries to resolve
    await waitFor(() => {
      const state = useFilterCombinationStore.getState();
      expect(state.vizToHash["w:1"]).toBe(expectedHash);
      expect(state.vizToHash["w:2"]).toBe(expectedHash);
    });

    // refCount should be 2 (both widgets acquired)
    await waitFor(() => {
      const entry = useFilterCombinationStore.getState().registry[expectedHash];
      expect(entry).toBeDefined();
      expect(entry!.refCount).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 5: Two widgets, different hashes → TWO POSTs
  // -------------------------------------------------------------------------
  it("5: two widgets with different hashes → TWO POSTs; two distinct registry entries", async () => {
    // w1 accepts all filters (FILTER_A + filterWithSource),
    // w2's allowlist only matches filterWithSource (sourceWidgetId=99)
    const w1 = makeWidget({ id: 1, tableId: TABLE_A });
    const w2 = makeWidget({
      id: 2,
      tableId: TABLE_A,
      filterSelection: { sourceMode: "allowlist", allowedSourceWidgetIds: [99] },
    });
    const filterWithSource: ActiveFilter = { ...FILTER_B, sourceWidgetId: 99 };
    useFilterStore.setState({
      filters: { [TABLE_A]: [FILTER_A, filterWithSource] },
    } as Parameters<typeof useFilterStore.setState>[0]);

    (materializeFilter as Mock)
      .mockResolvedValueOnce({ viewName: "_kbi_combo_v1", expiresAt: 9_999_999_999 })
      .mockResolvedValueOnce({ viewName: "_kbi_combo_v2", expiresAt: 9_999_999_999 });

    renderHook(() => useCombinationOrchestrator(DASH_ID, [w1, w2], []));
    bumpFilterVersion();
    advanceDebounce();

    await waitFor(() => {
      expect(materializeFilter).toHaveBeenCalledTimes(2);
    });

    // Each call has a distinct combinationKey
    const keys = (materializeFilter as Mock).mock.calls.map((c: unknown[]) => (c[0] as { combinationKey: string }).combinationKey);
    expect(keys[0]).not.toBe(keys[1]);

    await waitFor(() => {
      const reg = useFilterCombinationStore.getState().registry;
      const allKeys = Object.keys(reg);
      expect(allKeys.length).toBeGreaterThanOrEqual(2);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 6: Hash gone on tick 2 → release; dropCombinationView called
  // -------------------------------------------------------------------------
  it("6: widget removed on tick 2 → release; dropCombinationView fired when refCount hits 0", async () => {
    const w1 = makeWidget({ id: 1, tableId: TABLE_A });
    useFilterStore.setState({ filters: { [TABLE_A]: [FILTER_A] } } as Parameters<typeof useFilterStore.setState>[0]);

    const { rerender } = renderHook(
      ({ widgets }: { widgets: WidgetDto[] }) =>
        useCombinationOrchestrator(DASH_ID, widgets, []),
      { initialProps: { widgets: [w1] } },
    );

    // Tick 1: establish the combo
    bumpFilterVersion();
    advanceDebounce();
    await waitFor(() => expect(materializeFilter).toHaveBeenCalledTimes(1));

    const expectedHash = stableComboHash("table", TABLE_A, [FILTER_A]);
    await waitFor(() => {
      expect(useFilterCombinationStore.getState().registry[expectedHash]).toBeDefined();
    });

    // Record view name before removal
    const viewName = useFilterCombinationStore.getState().registry[expectedHash]?.viewName;
    expect(viewName).toBeTruthy();

    // Tick 2: remove w1 from widgets list
    act(() => {
      rerender({ widgets: [] });
    });
    bumpFilterVersion();
    advanceDebounce();

    await waitFor(() => {
      expect(dropCombinationView).toHaveBeenCalledWith(
        expect.objectContaining({ viewName }),
      );
    });

    // Registry entry should be gone
    expect(useFilterCombinationStore.getState().registry[expectedHash]).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Scenario 7: markMaterializing race guard → second tick skips POST
  // -------------------------------------------------------------------------
  it("7: second tick while first POST in-flight → markMaterializing guard skips duplicate POST", async () => {
    const w = makeWidget({ id: 1, tableId: TABLE_A });
    useFilterStore.setState({ filters: { [TABLE_A]: [FILTER_A] } } as Parameters<typeof useFilterStore.setState>[0]);

    const expectedHash = stableComboHash("table", TABLE_A, [FILTER_A]);

    // Pre-seed registry with materializing:true (simulates in-flight POST from prior tick)
    act(() => {
      useFilterCombinationStore.getState().markMaterializing(
        expectedHash,
        DASH_ID,
        "table",
        TABLE_A,
      );
    });

    // Make materializeFilter never resolve (simulates in-flight)
    (materializeFilter as Mock).mockReturnValue(new Promise(() => {}));

    renderHook(() => useCombinationOrchestrator(DASH_ID, [w], []));
    bumpFilterVersion();
    advanceDebounce();
    await act(async () => {
      await Promise.resolve();
    });

    // materializeFilter should NOT be called (markMaterializing guard active)
    expect(materializeFilter).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Scenario 8: Ceiling exceeded → fallback + toast once per table
  // -------------------------------------------------------------------------
  it("8: N+1 unique hashes → ceil(N) unique POSTs; over-ceiling widgets get fallback; toast shown once with 'info'", async () => {
    const CEILING = 2;
    act(() => {
      useAuthStore.setState({ maxCombinationViewsPerTable: CEILING } as Parameters<typeof useAuthStore.setState>[0]);
    });

    // 3 widgets with 3 distinct filter combinations (CEILING+1 = 3)
    const filterC: ActiveFilter = { column: "col1", value: "A", dataType: "string", sourceWidgetId: 10, addedAt: 3000 };
    const filterD: ActiveFilter = { column: "col2", value: "B", dataType: "string", sourceWidgetId: 20, addedAt: 4000 };
    const filterE: ActiveFilter = { column: "col3", value: "C", dataType: "string", sourceWidgetId: 30, addedAt: 5000 };

    const w1 = makeWidget({
      id: 1,
      tableId: TABLE_A,
      filterSelection: { sourceMode: "allowlist", allowedSourceWidgetIds: [10] },
    });
    const w2 = makeWidget({
      id: 2,
      tableId: TABLE_A,
      filterSelection: { sourceMode: "allowlist", allowedSourceWidgetIds: [20] },
    });
    const w3 = makeWidget({
      id: 3,
      tableId: TABLE_A,
      filterSelection: { sourceMode: "allowlist", allowedSourceWidgetIds: [30] },
    });

    useFilterStore.setState({
      filters: { [TABLE_A]: [filterC, filterD, filterE] },
    } as Parameters<typeof useFilterStore.setState>[0]);

    // Spy on toastStore's showToast
    const origShowToast = useToastStore.getState().showToast;
    const toastSpy = vi.fn();
    useToastStore.setState({ showToast: toastSpy } as Parameters<typeof useToastStore.setState>[0]);

    (materializeFilter as Mock)
      .mockResolvedValueOnce({ viewName: "_kbi_combo_v1", expiresAt: 9_999_999_999 })
      .mockResolvedValueOnce({ viewName: "_kbi_combo_v2", expiresAt: 9_999_999_999 });

    renderHook(() => useCombinationOrchestrator(DASH_ID, [w1, w2, w3], []));
    bumpFilterVersion();
    advanceDebounce();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // At most CEILING POSTs fired (ceiling=2 → at most 2 unique hashes)
    expect((materializeFilter as Mock).mock.calls.length).toBeLessThanOrEqual(CEILING);

    // Toast fired exactly ONCE for this table
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveBeenCalledWith(
      expect.stringContaining("exceed the limit"),
      "info",
    );

    // Restore
    useToastStore.setState({ showToast: origShowToast } as Parameters<typeof useToastStore.setState>[0]);
  });

  // -------------------------------------------------------------------------
  // Scenario 9: NOFILTER sentinel guard (explicit markMaterializing not called)
  // -------------------------------------------------------------------------
  it("9: NOFILTER sentinel guard → no markMaterializing, no POST, setVizHash undefined", async () => {
    const w = makeWidget({ id: 1, tableId: TABLE_A });
    // No filters → resolveFilterSet returns [] → NOFILTER hash
    useFilterStore.setState({ filters: {} } as Parameters<typeof useFilterStore.setState>[0]);

    // Track markMaterializing calls via counting
    let markMaterializingCallCount = 0;
    const origMark = useFilterCombinationStore.getState().markMaterializing;
    const markSpy = vi.fn((...args: Parameters<typeof origMark>) => {
      markMaterializingCallCount++;
      origMark(...args);
    });
    useFilterCombinationStore.setState({ markMaterializing: markSpy } as Parameters<typeof useFilterCombinationStore.setState>[0]);

    renderHook(() => useCombinationOrchestrator(DASH_ID, [w], []));
    bumpFilterVersion();
    advanceDebounce();
    await act(async () => {
      await Promise.resolve();
    });

    expect(materializeFilter).not.toHaveBeenCalled();
    expect(markMaterializingCallCount).toBe(0);

    // vizToHash for this widget should be undefined (deleted or never set)
    const state = useFilterCombinationStore.getState();
    const vizVal = state.vizToHash["w:1"];
    expect(vizVal === undefined || !("w:1" in state.vizToHash)).toBe(true);

    // Restore
    useFilterCombinationStore.setState({ markMaterializing: origMark } as Parameters<typeof useFilterCombinationStore.setState>[0]);
  });

  // -------------------------------------------------------------------------
  // Scenario 10: filterVersion dep isolation — combinationVersion bump does NOT re-fire
  // -------------------------------------------------------------------------
  it("10: combinationVersion-not-in-deps — bumping combinationVersion does NOT re-fire orchestrator", async () => {
    const w = makeWidget({ id: 1, tableId: TABLE_A });
    useFilterStore.setState({ filters: { [TABLE_A]: [FILTER_A] } } as Parameters<typeof useFilterStore.setState>[0]);

    renderHook(() => useCombinationOrchestrator(DASH_ID, [w], []));

    // Tick 1: establish the combo
    bumpFilterVersion();
    advanceDebounce();

    await waitFor(() => expect(materializeFilter).toHaveBeenCalledTimes(1));

    const expectedHash = stableComboHash("table", TABLE_A, [FILTER_A]);
    await waitFor(() => {
      expect(useFilterCombinationStore.getState().registry[expectedHash]).toBeDefined();
    });

    // Clear the mock after the initial successful tick
    (materializeFilter as Mock).mockClear();

    // Now bump combinationVersion by calling setEntry on the existing hash.
    // This mimics what happens after a successful materialize (setEntry bumps combinationVersion).
    // If combinationVersion were in deps, the orchestrator would re-fire.
    act(() => {
      const existing = useFilterCombinationStore.getState().registry[expectedHash];
      if (existing) {
        useFilterCombinationStore.getState().setEntry(expectedHash, {
          ...existing,
          materializeVersion: existing.materializeVersion + 1,
        });
      }
    });

    // Advance timers — if combinationVersion were in deps, the orchestrator would re-fire
    advanceDebounce();
    await act(async () => {
      await Promise.resolve();
    });

    // materializeFilter must NOT have been called again (no re-fire loop)
    expect(materializeFilter).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Scenario 11: Unmount abort
  // -------------------------------------------------------------------------
  it("11: unmount during in-flight POST → AbortController aborted; no setEntry called after unmount", async () => {
    const w = makeWidget({ id: 1, tableId: TABLE_A });
    useFilterStore.setState({ filters: { [TABLE_A]: [FILTER_A] } } as Parameters<typeof useFilterStore.setState>[0]);

    let capturedSignal: AbortSignal | undefined;
    let resolvePromise!: (val: { viewName: string; expiresAt: number }) => void;
    const neverResolvingPromise = new Promise<{ viewName: string; expiresAt: number }>((resolve) => {
      resolvePromise = resolve;
    });

    (materializeFilter as Mock).mockImplementation(
      (_args: unknown, signal: AbortSignal) => {
        capturedSignal = signal;
        return neverResolvingPromise;
      },
    );

    // Spy on setEntry to detect post-unmount calls
    const origSetEntry = useFilterCombinationStore.getState().setEntry;
    const setEntrySpy = vi.fn((...args: Parameters<typeof origSetEntry>) => origSetEntry(...args));
    useFilterCombinationStore.setState({ setEntry: setEntrySpy } as Parameters<typeof useFilterCombinationStore.setState>[0]);

    const expectedHash = stableComboHash("table", TABLE_A, [FILTER_A]);

    const { unmount } = renderHook(() =>
      useCombinationOrchestrator(DASH_ID, [w], []),
    );

    bumpFilterVersion();
    advanceDebounce();

    await waitFor(() => {
      expect(materializeFilter).toHaveBeenCalledTimes(1);
      expect(capturedSignal).toBeDefined();
    });

    // Signal should NOT be aborted yet
    expect(capturedSignal!.aborted).toBe(false);

    // Clear setEntry calls before unmount
    setEntrySpy.mockClear();

    // Unmount the hook
    act(() => {
      unmount();
    });

    // Signal should now be aborted (unmount cleanup fires AbortController)
    expect(capturedSignal!.aborted).toBe(true);

    // Now resolve the promise (simulates late server response after unmount)
    act(() => {
      resolvePromise({ viewName: "_late_response", expiresAt: 9_999_999_999 });
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // setEntry should NOT have been called with new data after unmount
    // (the .then handler guards on ctrl.signal.aborted)
    const setCalls = setEntrySpy.mock.calls.filter(
      (call: Parameters<typeof origSetEntry>) => call[0] === expectedHash,
    );
    expect(setCalls.length).toBe(0);

    // Restore
    useFilterCombinationStore.setState({ setEntry: origSetEntry } as Parameters<typeof useFilterCombinationStore.setState>[0]);
  });
});

// ---------------------------------------------------------------------------
// Phase 92 — layer enumeration (READ-V118-02 / COMBO-V118-04)
// ---------------------------------------------------------------------------
describe("Phase 92 — layer enumeration (READ-V118-02 / COMBO-V118-04)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    useFilterCombinationStore.getState().reset();
    useFilterStore.setState({ filters: {}, dvFilters: {}, filterVersion: 0 });
    useAuthStore.setState({ maxCombinationViewsPerTable: 10 } as Parameters<typeof useAuthStore.setState>[0]);
    (materializeFilter as Mock).mockReset();
    (materializeFilter as Mock).mockResolvedValue({ viewName: "_kbi_combo_v", expiresAt: 9_999_999_999 });
    (dropCombinationView as Mock).mockReset();
    (dropCombinationView as Mock).mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // L1: single table-bound layer with one active filter → ONE POST; vizToHash["l:<id>"] set
  // -------------------------------------------------------------------------
  it("L1: single table-bound layer with one active filter → ONE POST; vizToHash['l:1'] set", async () => {
    useFilterStore.setState({ filters: { [TABLE_A]: [FILTER_A] } } as Parameters<typeof useFilterStore.setState>[0]);
    const layer = makeLayer({ id: 1, tableId: TABLE_A });

    renderHook(() => useCombinationOrchestrator(DASH_ID, [], [layer]));
    bumpFilterVersion();
    advanceDebounce();

    await waitFor(() => {
      expect(materializeFilter).toHaveBeenCalledTimes(1);
    });

    const expectedHash = stableComboHash("table", TABLE_A, [FILTER_A]);
    const call = (materializeFilter as Mock).mock.calls[0][0];
    expect(call.combinationKey).toBe(expectedHash);
    expect(call.tableId).toBe(TABLE_A);

    await waitFor(() => {
      const state = useFilterCombinationStore.getState();
      expect(state.vizToHash["l:1"]).toBe(expectedHash);
    });
  });

  // -------------------------------------------------------------------------
  // L2: dv-bound layer (dynamic_view_id !== null) → NO POST; vizToHash["l:<id>"] absent
  // -------------------------------------------------------------------------
  it("L2: dv-bound layer (dynamic_view_id !== null) is SKIPPED → no POST, vizToHash['l:1'] absent", async () => {
    useFilterStore.setState({ filters: { [TABLE_A]: [FILTER_A] } } as Parameters<typeof useFilterStore.setState>[0]);
    const dvLayer = makeLayer({ id: 1, tableId: TABLE_A, dynamic_view_id: 7 });

    renderHook(() => useCombinationOrchestrator(DASH_ID, [], [dvLayer]));
    bumpFilterVersion();
    advanceDebounce();

    await act(async () => {
      await Promise.resolve();
    });

    expect(materializeFilter).not.toHaveBeenCalled();
    const state = useFilterCombinationStore.getState();
    expect(state.vizToHash["l:1"]).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // L3: layer + widget on same table, default accept-all → ONE POST (shared); refCount 2
  // -------------------------------------------------------------------------
  it("L3: layer + widget on same table, default accept-all → ONE POST (shared); refCount 2", async () => {
    useFilterStore.setState({ filters: { [TABLE_A]: [FILTER_A] } } as Parameters<typeof useFilterStore.setState>[0]);
    const widget = makeWidget({ id: 1, tableId: TABLE_A });
    const layer = makeLayer({ id: 2, tableId: TABLE_A });

    renderHook(() => useCombinationOrchestrator(DASH_ID, [widget], [layer]));
    bumpFilterVersion();
    advanceDebounce();

    await waitFor(() => {
      expect(materializeFilter).toHaveBeenCalledTimes(1);
    });

    const expectedHash = stableComboHash("table", TABLE_A, [FILTER_A]);

    await waitFor(() => {
      const state = useFilterCombinationStore.getState();
      expect(state.vizToHash["w:1"]).toBe(expectedHash);
      expect(state.vizToHash["l:2"]).toBe(expectedHash);
    });

    await waitFor(() => {
      const entry = useFilterCombinationStore.getState().registry[expectedHash];
      expect(entry).toBeDefined();
      expect(entry!.refCount).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // L4: layer NOFILTER (no active filters on its table) → no POST; vizToHash["l:<id>"] undefined
  // -------------------------------------------------------------------------
  it("L4: layer NOFILTER (no active filters on table) → no POST; vizToHash['l:1'] undefined", async () => {
    useFilterStore.setState({ filters: {} } as Parameters<typeof useFilterStore.setState>[0]);
    const layer = makeLayer({ id: 1, tableId: TABLE_A });

    renderHook(() => useCombinationOrchestrator(DASH_ID, [], [layer]));
    bumpFilterVersion();
    advanceDebounce();

    await act(async () => {
      await Promise.resolve();
    });

    expect(materializeFilter).not.toHaveBeenCalled();
    const state = useFilterCombinationStore.getState();
    const vizVal = state.vizToHash["l:1"];
    expect(vizVal === undefined || !("l:1" in state.vizToHash)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // L5: layer removed on tick 2 → release + dropCombinationView when refCount hits 0
  // -------------------------------------------------------------------------
  it("L5: layer removed on tick 2 → release + dropCombinationView when refCount hits 0", async () => {
    useFilterStore.setState({ filters: { [TABLE_A]: [FILTER_A] } } as Parameters<typeof useFilterStore.setState>[0]);
    const layer = makeLayer({ id: 1, tableId: TABLE_A });

    const { rerender } = renderHook(
      ({ layers }: { layers: ReturnType<typeof makeLayer>[] }) =>
        useCombinationOrchestrator(DASH_ID, [], layers),
      { initialProps: { layers: [layer] } },
    );

    // Tick 1: establish the combo
    bumpFilterVersion();
    advanceDebounce();
    await waitFor(() => expect(materializeFilter).toHaveBeenCalledTimes(1));

    const expectedHash = stableComboHash("table", TABLE_A, [FILTER_A]);
    await waitFor(() => {
      expect(useFilterCombinationStore.getState().registry[expectedHash]).toBeDefined();
    });

    const viewName = useFilterCombinationStore.getState().registry[expectedHash]?.viewName;
    expect(viewName).toBeTruthy();

    // Tick 2: remove the layer
    act(() => {
      rerender({ layers: [] });
    });
    bumpFilterVersion();
    advanceDebounce();

    await waitFor(() => {
      expect(dropCombinationView).toHaveBeenCalledWith(
        expect.objectContaining({ viewName }),
      );
    });

    expect(useFilterCombinationStore.getState().registry[expectedHash]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Phase 93.5 — spatial in combination model (SPATIAL-V118-01)
// ---------------------------------------------------------------------------

// Shared shape fixture
const SHAPE_1 = {
  id: "shape-1",
  type: "bbox" as const,
  wkt: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
  label: "Bbox 1",
  measurement: "1km × 1km",
  addedAt: 5000,
};

const SHAPE_2 = {
  id: "shape-2",
  type: "bbox" as const,
  wkt: "POLYGON((2 2,3 2,3 3,2 3,2 2))",
  label: "Bbox 2",
  measurement: "1km × 1km",
  addedAt: 6000,
};

describe("Phase 93.5 — spatial in combination model (SPATIAL-V118-01)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    useFilterCombinationStore.getState().reset();
    useFilterStore.setState({ filters: {}, dvFilters: {}, filterVersion: 0 });
    useSpatialFilterStore.getState().reset();
    useAuthStore.setState({ maxCombinationViewsPerTable: 10 } as Parameters<typeof useAuthStore.setState>[0]);
    (materializeFilter as Mock).mockReset();
    (materializeFilter as Mock).mockResolvedValue({ viewName: "_kbi_combo_spatial_v", expiresAt: 9_999_999_999 });
    (dropCombinationView as Mock).mockReset();
    (dropCombinationView as Mock).mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // SC1: Accept-all shared view — SPATIAL-V118-01 SC1
  // Chart widget (accept-all) + map widget (with spatialTarget) + layer on TABLE_A.
  // One column filter + one shape → ONE POST carrying spatial + column, both vizKeys share hash.
  // -------------------------------------------------------------------------
  it("SC1: accept-all — chart + map layer share ONE spatial combo view", async () => {
    // Map widget provides the spatial target for TABLE_A
    const mapWidget = makeMapWidgetWithTarget(10, TABLE_A);
    // Chart widget (accept-all, default cfg)
    const chartWidget = makeWidget({ id: 11, type: "bar", tableId: TABLE_A });
    // Layer on TABLE_A (accept-all by default)
    const layer = makeLayer({ id: 20, tableId: TABLE_A });

    useFilterStore.setState({ filters: { [TABLE_A]: [FILTER_A] } } as Parameters<typeof useFilterStore.setState>[0]);
    setShapes([SHAPE_1]);

    renderHook(() => useCombinationOrchestrator(DASH_ID, [mapWidget, chartWidget], [layer]));
    bumpFilterVersion();
    advanceDebounce();

    await waitFor(() => {
      // Should be ONE POST total (chart + layer share the same hash)
      expect(materializeFilter).toHaveBeenCalledTimes(1);
    });

    const call = (materializeFilter as Mock).mock.calls[0][0];
    // Must carry spatialFilters
    expect(call.spatialFilters).toBeDefined();
    expect(call.spatialFilters).toHaveLength(1);
    expect(call.spatialFilters[0].wkt).toBe(SHAPE_1.wkt);
    expect(call.spatialFilters[0].id).toBe(SHAPE_1.id);
    // Must carry spatialTarget
    expect(call.spatialTarget).toBeDefined();
    expect(call.spatialTarget.tableId).toBe(TABLE_A);
    expect(call.spatialTarget.spatialMode).toBe("latlon");
    // combinationKey must be the spatial-extended hash
    const expectedHash = stableComboHash("table", TABLE_A, [FILTER_A], [SHAPE_1]);
    expect(call.combinationKey).toBe(expectedHash);

    // Both chart vizKey and layer vizKey point to the SAME hash
    await waitFor(() => {
      const state = useFilterCombinationStore.getState();
      expect(state.vizToHash["w:11"]).toBe(expectedHash);
      expect(state.vizToHash["l:20"]).toBe(expectedHash);
    });
  });

  // -------------------------------------------------------------------------
  // SC2: One POST per table, carries spatial — SPATIAL-V118-01 SC2
  // Default accept-all + single shape + NO column filter → spatial-only hash, NOT NOFILTER.
  // -------------------------------------------------------------------------
  it("SC2: spatial-only (no column filter) → ONE POST with spatialFilters present", async () => {
    const mapWidget = makeMapWidgetWithTarget(10, TABLE_A);
    const chartWidget = makeWidget({ id: 11, type: "bar", tableId: TABLE_A });

    // No column filters for TABLE_A
    useFilterStore.setState({ filters: {} } as Parameters<typeof useFilterStore.setState>[0]);
    setShapes([SHAPE_1]);

    renderHook(() => useCombinationOrchestrator(DASH_ID, [mapWidget, chartWidget], []));
    bumpFilterVersion();
    advanceDebounce();

    await waitFor(() => {
      expect(materializeFilter).toHaveBeenCalledTimes(1);
    });

    const call = (materializeFilter as Mock).mock.calls[0][0];
    expect(call.spatialFilters).toBeDefined();
    expect(call.spatialFilters).toHaveLength(1);
    expect(call.spatialTarget).toBeDefined();

    // Hash is NOT NOFILTER (spatial-only hash is a real hash)
    const expectedHash = stableComboHash("table", TABLE_A, [], [SHAPE_1]);
    expect(call.combinationKey).toBe(expectedHash);
    expect(expectedHash).not.toContain("NOFILTER");
  });

  // -------------------------------------------------------------------------
  // SC3: Exclude vs accept → distinct hashes — SPATIAL-V118-01 SC3
  // Widget A: accept-all (accepts spatial via sentinel).
  // Widget B: allowlist with NO sentinel (excludes spatial).
  // No column filter → B resolves to NOFILTER (undefined in vizToHash), A has spatial hash.
  // -------------------------------------------------------------------------
  it("SC3: exclude vs accept — excluding viz gets no spatial in hash, accepting viz does", async () => {
    const mapWidget = makeMapWidgetWithTarget(10, TABLE_A);
    // Widget A: accept-all (accepts spatial)
    const widgetA = makeWidget({ id: 11, type: "bar", tableId: TABLE_A });
    // Widget B: allowlist with empty list (excludes ALL, including spatial sentinel)
    const widgetB = makeWidget({
      id: 12,
      type: "bar",
      tableId: TABLE_A,
      filterSelection: { sourceMode: "allowlist", allowedSourceWidgetIds: [] },
    });

    // No column filters
    useFilterStore.setState({ filters: {} } as Parameters<typeof useFilterStore.setState>[0]);
    setShapes([SHAPE_1]);

    renderHook(() => useCombinationOrchestrator(DASH_ID, [mapWidget, widgetA, widgetB], []));
    bumpFilterVersion();
    advanceDebounce();

    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    // Widget A accepts spatial → has a hash (spatial-only hash)
    // Widget B excludes all → NOFILTER → vizToHash["w:12"] is undefined
    const state = useFilterCombinationStore.getState();
    const hashA = state.vizToHash["w:11"];
    const hashB = state.vizToHash["w:12"];

    expect(hashA).toBeDefined();
    expect(hashA).not.toContain("NOFILTER");

    // B has no spatial and no column filters → NOFILTER → undefined in vizToHash
    expect(hashB === undefined || !("w:12" in state.vizToHash)).toBe(true);

    // A and B hash must differ (A has spatial, B does not)
    if (hashA && hashB) {
      expect(hashA).not.toBe(hashB);
    }
  });

  // -------------------------------------------------------------------------
  // SC4: Dedup across spatial + DROP on shape removal — SPATIAL-V118-01 SC4
  // Two widgets both accept-all on TABLE_A, one shape → ONE POST (shared hash, refCount 2).
  // Remove shape → orchestrator re-fires → old spatial hash released → dropCombinationView.
  // -------------------------------------------------------------------------
  it("SC4: dedup across spatial (ONE POST); removing shape drops old spatial hash", async () => {
    const mapWidget = makeMapWidgetWithTarget(10, TABLE_A);
    const w1 = makeWidget({ id: 11, type: "bar", tableId: TABLE_A });
    const w2 = makeWidget({ id: 12, type: "bar", tableId: TABLE_A });

    useFilterStore.setState({ filters: { [TABLE_A]: [FILTER_A] } } as Parameters<typeof useFilterStore.setState>[0]);
    setShapes([SHAPE_1]);

    const { rerender } = renderHook(
      ({ widgets }: { widgets: WidgetDto[] }) =>
        useCombinationOrchestrator(DASH_ID, widgets, []),
      { initialProps: { widgets: [mapWidget, w1, w2] } },
    );
    bumpFilterVersion();
    advanceDebounce();

    await waitFor(() => {
      // Only ONE POST (shared hash)
      expect(materializeFilter).toHaveBeenCalledTimes(1);
    });

    const spatialHash = stableComboHash("table", TABLE_A, [FILTER_A], [SHAPE_1]);
    await waitFor(() => {
      const entry = useFilterCombinationStore.getState().registry[spatialHash];
      expect(entry).toBeDefined();
      expect(entry!.refCount).toBe(2);
    });

    // Record view name for DROP assertion
    const spatialViewName = useFilterCombinationStore.getState().registry[spatialHash]?.viewName;
    expect(spatialViewName).toBeTruthy();

    // Remove the shape — bump spatialFilterVersion
    (materializeFilter as Mock).mockResolvedValue({ viewName: "_kbi_combo_column_only_v", expiresAt: 9_999_999_999 });
    act(() => {
      useSpatialFilterStore.setState({ shapes: [], spatialFilterVersion: 2 });
    });
    advanceDebounce();

    await waitFor(() => {
      // Drop must have been called for the old spatial hash view
      expect(dropCombinationView).toHaveBeenCalledWith(
        expect.objectContaining({ viewName: spatialViewName }),
      );
    });

    // Old spatial hash entry should be gone from registry
    await waitFor(() => {
      expect(useFilterCombinationStore.getState().registry[spatialHash]).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // SC5: No eligible target → spatial NOT folded — Pitfall 1
  // Table B has no map widget (no spatial target) → hash stays column-only.
  // -------------------------------------------------------------------------
  it("SC5: no eligible target for TABLE_B → column-only hash, no spatialFilters in args", async () => {
    // No map widget for TABLE_B → aggregateSpatialTargetsByTable returns nothing for TABLE_B
    const chartWidget = makeWidget({ id: 20, type: "bar", tableId: TABLE_B });
    const chartWidget2 = makeWidget({ id: 21, type: "bar", tableId: TABLE_B });

    useFilterStore.setState({ filters: { [TABLE_B]: [FILTER_A] } } as Parameters<typeof useFilterStore.setState>[0]);
    // Shape drawn, but no eligible target → must NOT be folded
    setShapes([SHAPE_1]);

    renderHook(() => useCombinationOrchestrator(DASH_ID, [chartWidget, chartWidget2], []));
    bumpFilterVersion();
    advanceDebounce();

    await waitFor(() => {
      expect(materializeFilter).toHaveBeenCalledTimes(1);
    });

    const call = (materializeFilter as Mock).mock.calls[0][0];
    // No spatialFilters in args (no eligible target)
    expect(call.spatialFilters).toBeUndefined();
    expect(call.spatialTarget).toBeUndefined();
    // combinationKey is column-only (no spatial segment)
    const expectedColumnOnlyHash = stableComboHash("table", TABLE_B, [FILTER_A]);
    expect(call.combinationKey).toBe(expectedColumnOnlyHash);

    // Both widgets share the same column-only hash
    await waitFor(() => {
      const state = useFilterCombinationStore.getState();
      expect(state.vizToHash["w:20"]).toBe(expectedColumnOnlyHash);
      expect(state.vizToHash["w:21"]).toBe(expectedColumnOnlyHash);
    });
  });

  // -------------------------------------------------------------------------
  // SC6: Records excluded from orchestrator enumeration
  // A "records" widget on TABLE_A → orchestrator must NOT mint a combo entry for it.
  // -------------------------------------------------------------------------
  it("SC6: records widget → no combo entry / no materializeFilter call for it", async () => {
    const recordsWidget = makeWidget({ id: 30, type: "records", tableId: TABLE_A });

    useFilterStore.setState({ filters: { [TABLE_A]: [FILTER_A] } } as Parameters<typeof useFilterStore.setState>[0]);

    renderHook(() => useCombinationOrchestrator(DASH_ID, [recordsWidget], []));
    bumpFilterVersion();
    advanceDebounce();

    await act(async () => { await Promise.resolve(); });

    // No POST for records widget
    expect(materializeFilter).not.toHaveBeenCalled();

    // vizToHash has no entry for the records widget
    const state = useFilterCombinationStore.getState();
    const vizVal = state.vizToHash["w:30"];
    expect(vizVal === undefined || !("w:30" in state.vizToHash)).toBe(true);
  });

  // SC6b: sibling "bar" widget on same table still materializes normally
  it("SC6b: sibling bar + records on TABLE_A — bar materializes, records does not", async () => {
    const recordsWidget = makeWidget({ id: 30, type: "records", tableId: TABLE_A });
    const barWidget = makeWidget({ id: 31, type: "bar", tableId: TABLE_A });

    useFilterStore.setState({ filters: { [TABLE_A]: [FILTER_A] } } as Parameters<typeof useFilterStore.setState>[0]);

    renderHook(() => useCombinationOrchestrator(DASH_ID, [recordsWidget, barWidget], []));
    bumpFilterVersion();
    advanceDebounce();

    await waitFor(() => {
      expect(materializeFilter).toHaveBeenCalledTimes(1);
    });

    // Only w:31 (bar) has a vizToHash entry
    await waitFor(() => {
      const state = useFilterCombinationStore.getState();
      expect(state.vizToHash["w:31"]).toBeDefined();
      const recordsVal = state.vizToHash["w:30"];
      expect(recordsVal === undefined || !("w:30" in state.vizToHash)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // SOLE-TRIGGER GREP GATE
  // After Phase 93.5:
  //   (a) The map-only hook file no longer exists.
  //   (b) The orchestrator is the ONLY hook that calls materializeFilter with BOTH
  //       spatialFilters AND combinationKey (grep the orchestrator source).
  //   The gate: "after Phase 93.5, ONLY useCombinationOrchestrator materializes
  //   the table+spatial path for chart+layer vizs; records remains a self-contained
  //   legacy island."
  // -------------------------------------------------------------------------
  it("SOLE-TRIGGER GATE: map-only hook file deleted; orchestrator is sole spatial+combinationKey caller", () => {
    const hooksDir = path.resolve(__dirname);

    // (a) The deleted hook file must not exist
    const deletedHookPath = path.join(hooksDir, "useMapOnlySpatialMaterialize.ts");
    expect(fs.existsSync(deletedHookPath)).toBe(false);

    // (b) The orchestrator file must contain both "spatialFilters" and "combinationKey"
    //     in the same materializeFilter call (confirming it is the sole spatial+combo caller)
    const orchestratorPath = path.join(hooksDir, "useCombinationOrchestrator.ts");
    const orchestratorSrc = fs.readFileSync(orchestratorPath, "utf-8");

    expect(orchestratorSrc).toContain("spatialFilters");
    expect(orchestratorSrc).toContain("combinationKey: hash");

    // (c) No OTHER hook file in this directory calls materializeFilter with spatialFilters
    //     (records' legacy path is in components/charts/WidgetRenderer.tsx, not hooks/)
    const hookFiles = fs.readdirSync(hooksDir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".spec.ts") && f !== "useCombinationOrchestrator.ts");

    for (const file of hookFiles) {
      const src = fs.readFileSync(path.join(hooksDir, file), "utf-8");
      // No hook file other than the orchestrator should call materializeFilter with spatialFilters
      if (src.includes("materializeFilter") && src.includes("spatialFilters")) {
        throw new Error(
          `Sole-trigger gate FAILED: ${file} calls materializeFilter with spatialFilters. ` +
          "Only useCombinationOrchestrator should own the spatial+combination path."
        );
      }
    }
  });
});
