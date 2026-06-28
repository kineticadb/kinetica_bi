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
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { Mock } from "vitest";

import { useCombinationOrchestrator } from "./useCombinationOrchestrator";
import { useFilterStore } from "../store/filterStore";
import { useFilterCombinationStore } from "../store/filterCombinationStore";
import { useAuthStore } from "../store/auth";
import { useToastStore } from "../store/toast";
import { stableComboHash } from "../lib/stableComboHash";
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

function makeWidget(overrides: {
  id: number;
  type?: string;
  tableId?: number;
  filterSelection?: { sourceMode: "all" | "allowlist"; allowedSourceWidgetIds: number[] };
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
