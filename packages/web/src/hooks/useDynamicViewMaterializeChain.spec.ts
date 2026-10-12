/**
 * Phase 35 Plan 03 (DV-V16-13) + quick-261009-jg6: chain hook spec (driven by filterVersion +
 * filterCombinationStore readiness; see DVCOMBO-C1..C8 at the bottom).
 *
 * Covers the 17 locked behaviors from 35-03-orchestrator-hook-PLAN.md task 1:
 *   T1  list-fetch on mount
 *   T2  cold-start no-filter fast-path (capped dv)
 *   T3  wait state (combination view not ready) -> pending, no HTTP
 *   T4  cascade fires for all dvs sharing a source table when matVer > 0
 *   T5  cascade does NOT fire for unrelated source table
 *   T6  per-id AbortController: rapid filter changes abort prior in-flight for SAME id
 *   T7  per-id isolation: cross-dv table bumps DO NOT cross-cancel
 *   T8  materialized branch — setView(viewName, materialized, expiresAt), NO toast
 *   T9  over_threshold/no_filter — setView(reason), NO toast
 *   T10 over_threshold/exceeds_max_records — setView(reason), NO toast
 *   T11 error branch — setError + "error" toast (never "warning")
 *   T12 AbortError silent
 *   T13 list refresh on dynamicViewVersion increment
 *   T14 list-fetch AbortController on unmount
 *   T15 Pitfall 2 cleanup — removed-dv controllers pruned + aborted
 *   T16 retry(id) — same cascade path as auto fire
 *   T17 no username → no cascade (defensive)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { Mock } from "vitest";

import { useDynamicViewMaterializeChain } from "./useDynamicViewMaterializeChain";
import { useDynamicViewStore } from "../store/dynamicViewStore";
import { useFilterStore } from "../store/filterStore";
import type { ActiveFilter } from "../store/filterStore";
import { useFilterCombinationStore } from "../store/filterCombinationStore";
import { dvSourceComboHash } from "../lib/dvSourceCombo";
import { useSpatialFilterStore } from "../store/spatialFilterStore";
import { useAuthStore } from "../store/auth";
import { useToastStore } from "../store/toast";
import type { DynamicViewRow, MaterializeDynamicViewResponse, WidgetDto } from "../api/client";

// ---------------------------------------------------------------------------
// Mock the client module — every test sets up listDynamicViews + materializeDynamicView
// per case. Other helpers are passed through unchanged.
// ---------------------------------------------------------------------------
vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    listDynamicViews: vi.fn(),
    materializeDynamicView: vi.fn(),
  };
});

import { listDynamicViews, materializeDynamicView } from "../api/client";

// Factory for canonical DynamicViewRow fixtures.
const makeRow = (overrides: Partial<DynamicViewRow> & { id: number; source_table_id: number; dashboard_id?: number }): DynamicViewRow => ({
  id: overrides.id,
  dashboard_id: overrides.dashboard_id ?? 42,
  source_table_id: overrides.source_table_id,
  name: overrides.name ?? `dv${overrides.id}`,
  template_sql: overrides.template_sql ?? "SELECT * FROM {view}",
  max_records: overrides.max_records ?? 10000,
  columns_json: overrides.columns_json ?? null,
  created_at: overrides.created_at ?? "2026-05-15T00:00:00Z",
  updated_at: overrides.updated_at ?? "2026-05-15T00:00:00Z",
});

// Helpers: drive the REAL filter + combination stores (the chain no longer reads filterViewStore).
const mkFilter = (value: number): ActiveFilter =>
  ({ column: "vendor", value, dataType: "number", addedAt: 1, sourceWidgetId: 1 }) as ActiveFilter;

/** Set filters[tableId] to a single filter (value n) and register its combination view as READY. */
const applyFilter = (tableId: number, n: number) => {
  const filters = [mkFilter(n)];
  const hash = dvSourceComboHash(tableId, filters)!;
  useFilterCombinationStore.getState().setEntry(hash, {
    viewName: `_kbi_filt_${hash}`,
    expiresAt: 9_999_999_999,
    materializing: false,
    materializeVersion: 0,
    refCount: 1,
    dashboardId: 42,
    sourceType: "table",
    sourceId: tableId,
  });
  useFilterStore.setState((s) => ({ filters: { ...s.filters, [tableId]: filters }, filterVersion: s.filterVersion + 1 }));
  return hash;
};

/** Set filters[tableId] but leave its combination view NOT ready (orchestrator still materializing). */
const applyFilterPending = (tableId: number, n: number) => {
  const filters = [mkFilter(n)];
  const hash = dvSourceComboHash(tableId, filters)!;
  useFilterCombinationStore.getState().markMaterializing(hash, 42, "table", tableId);
  useFilterStore.setState((s) => ({ filters: { ...s.filters, [tableId]: filters }, filterVersion: s.filterVersion + 1 }));
  return hash;
};

const clearFilters = (tableId: number) =>
  useFilterStore.setState((s) => ({ filters: { ...s.filters, [tableId]: [] }, filterVersion: s.filterVersion + 1 }));

describe("useDynamicViewMaterializeChain (Phase 35 DV-V16-13)", () => {
  beforeEach(() => {
    // Authoritative auth — every test needs a username for the cascade unless overridden.
    useAuthStore.setState({ status: "authenticated", user: { username: "u1", roles: [], permissions: [] }, error: null, reason: null, authMode: "password" });
    // Default mock: listDynamicViews resolves to empty; tests that need rows override.
    (listDynamicViews as Mock).mockReset();
    (listDynamicViews as Mock).mockResolvedValue({ dynamic_views: [] });
    (materializeDynamicView as Mock).mockReset();
    useFilterStore.setState({ filters: {}, dvFilters: {}, filterVersion: 0 });
    useFilterCombinationStore.getState().reset();
    useDynamicViewStore.getState().reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // T1 -----------------------------------------------------------------
  it("T1 mounts and fetches the dynamic-view list for the dashboard", async () => {
    const rows: DynamicViewRow[] = [makeRow({ id: 7, source_table_id: 4 })];
    (listDynamicViews as Mock).mockResolvedValue({ dynamic_views: rows });

    const { result } = renderHook(() => useDynamicViewMaterializeChain(42));

    await waitFor(() => {
      expect(listDynamicViews).toHaveBeenCalledTimes(1);
    });
    expect((listDynamicViews as Mock).mock.calls[0][0]).toBe(42);
    // Second arg is the AbortSignal — at least present.
    expect((listDynamicViews as Mock).mock.calls[0][1]).toBeInstanceOf(AbortSignal);

    await waitFor(() => {
      expect(result.current.dynamicViews).toEqual(rows);
    });
  });

  // T2 -----------------------------------------------------------------
  it("T2 cold-start no-filter fast-path: matVer undefined → store populated client-side with over_threshold/no_filter (no HTTP)", async () => {
    // Post-VERIFY (loading-stuck fix): on dashboard mount with no active filter
    // view, the orchestrator now populates the dv store directly with
    // over_threshold/no_filter — deterministic from client state — instead of
    // leaving entries undefined (which caused widget renderers to show
    // "Loading..." indefinitely and map layers' buildWmsParams to fall through
    // to the wrong WMS LAYERS target). The HTTP cascade is NOT fired in this
    // case (saves N round-trips on dashboards with N dvs and no filter).
    const rows: DynamicViewRow[] = [
      makeRow({ id: 7, source_table_id: 4 }),
      makeRow({ id: 8, source_table_id: 9 }),
    ];
    (listDynamicViews as Mock).mockResolvedValue({ dynamic_views: rows });
    (materializeDynamicView as Mock).mockResolvedValue({
      status: "materialized",
      view_name: "_kbi_dv_uu1_d42_7",
      row_count: 1,
      expires_at: 9_999_999_999,
    } satisfies MaterializeDynamicViewResponse);

    renderHook(() => useDynamicViewMaterializeChain(42));

    // Wait for list to settle; no setMatVersion calls — filter view never materialized.
    await waitFor(() => {
      expect((listDynamicViews as Mock)).toHaveBeenCalled();
    });
    // Give effects an extra tick.
    await new Promise((r) => setTimeout(r, 20));

    // No HTTP cascade fired — no_filter is deterministic, no server call needed.
    expect(materializeDynamicView).not.toHaveBeenCalled();
    // Store IS populated for BOTH dvs with over_threshold/no_filter.
    const views = useDynamicViewStore.getState().views;
    expect(views[7]?.status).toBe("over_threshold");
    expect(views[7]?.reason).toBe("no_filter");
    expect(views[8]?.status).toBe("over_threshold");
    expect(views[8]?.reason).toBe("no_filter");
  });

  // T3 -----------------------------------------------------------------
  it("T3 wait state: filter set but combination view still materializing -> NO HTTP, dv pending", async () => {
    const rows: DynamicViewRow[] = [makeRow({ id: 7, source_table_id: 4 })];
    (listDynamicViews as Mock).mockResolvedValue({ dynamic_views: rows });

    renderHook(() => useDynamicViewMaterializeChain(42));
    await waitFor(() => expect((listDynamicViews as Mock)).toHaveBeenCalled());

    act(() => {
      applyFilterPending(4, 1);
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(materializeDynamicView).not.toHaveBeenCalled();
    expect(useDynamicViewStore.getState().views[7]?.status).toBe("pending");
  });

  // T4 -----------------------------------------------------------------
  it("T4 cascade fires for all dvs sharing the same source-table when matVer > 0", async () => {
    const rows: DynamicViewRow[] = [
      makeRow({ id: 7, source_table_id: 4 }),
      makeRow({ id: 8, source_table_id: 4 }),
    ];
    (listDynamicViews as Mock).mockResolvedValue({ dynamic_views: rows });
    (materializeDynamicView as Mock).mockImplementation(
      async (dvId: number): Promise<MaterializeDynamicViewResponse> => ({
        status: "materialized",
        view_name: `_kbi_dv_uu1_d42_${dvId}`,
        row_count: 100,
        expires_at: 9_999_999_999,
      }),
    );

    renderHook(() => useDynamicViewMaterializeChain(42));
    await waitFor(() => expect((listDynamicViews as Mock)).toHaveBeenCalled());

    act(() => {
      applyFilter(4, 1);
    });

    await waitFor(() => {
      expect(materializeDynamicView).toHaveBeenCalledTimes(2);
    });
    const callIds = (materializeDynamicView as Mock).mock.calls.map((c) => c[0]).sort();
    expect(callIds).toEqual([7, 8]);

    await waitFor(() => {
      const views = useDynamicViewStore.getState().views;
      expect(views[7]?.status).toBe("materialized");
      expect(views[8]?.status).toBe("materialized");
      expect(views[7]?.viewName).toBe("_kbi_dv_uu1_d42_7");
      expect(views[8]?.viewName).toBe("_kbi_dv_uu1_d42_8");
    });
  });

  // T5 -----------------------------------------------------------------
  it("T5 cascade does NOT fire when an unrelated source-table's matVer bumps", async () => {
    const rows: DynamicViewRow[] = [makeRow({ id: 7, source_table_id: 4 })];
    (listDynamicViews as Mock).mockResolvedValue({ dynamic_views: rows });
    (materializeDynamicView as Mock).mockResolvedValue({
      status: "materialized",
      view_name: "_kbi_dv_uu1_d42_7",
      row_count: 1,
      expires_at: 9_999_999_999,
    });

    renderHook(() => useDynamicViewMaterializeChain(42));
    await waitFor(() => expect((listDynamicViews as Mock)).toHaveBeenCalled());

    // Bump an UNRELATED table.
    act(() => {
      applyFilter(99, 1);
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(materializeDynamicView).not.toHaveBeenCalled();
  });

  // T6 -----------------------------------------------------------------
  it("T6 rapid filter changes abort prior in-flight materialize for SAME dv", async () => {
    const rows: DynamicViewRow[] = [makeRow({ id: 7, source_table_id: 4 })];
    (listDynamicViews as Mock).mockResolvedValue({ dynamic_views: rows });

    // Hold the first materialize unresolved.
    let resolveFirst: ((v: MaterializeDynamicViewResponse) => void) | undefined;
    const firstPromise = new Promise<MaterializeDynamicViewResponse>((res) => {
      resolveFirst = res;
    });
    (materializeDynamicView as Mock).mockReturnValueOnce(firstPromise);
    (materializeDynamicView as Mock).mockResolvedValueOnce({
      status: "materialized",
      view_name: "_kbi_dv_uu1_d42_7",
      row_count: 2,
      expires_at: 9_999_999_999,
    });

    renderHook(() => useDynamicViewMaterializeChain(42));
    await waitFor(() => expect((listDynamicViews as Mock)).toHaveBeenCalled());

    act(() => {
      applyFilter(4, 1);
    });
    await waitFor(() => expect(materializeDynamicView).toHaveBeenCalledTimes(1));
    const firstSignal = (materializeDynamicView as Mock).mock.calls[0][1] as AbortSignal;
    expect(firstSignal.aborted).toBe(false);

    // Second matVersion bump — orchestrator should abort the prior controller.
    act(() => {
      applyFilter(4, 2); // new filter value -> new combination hash
    });
    await waitFor(() => expect(materializeDynamicView).toHaveBeenCalledTimes(2));
    const secondSignal = (materializeDynamicView as Mock).mock.calls[1][1] as AbortSignal;

    expect(firstSignal.aborted).toBe(true);
    expect(secondSignal.aborted).toBe(false);
    expect(secondSignal).not.toBe(firstSignal);

    // Resolve the dangling first promise to avoid unhandled.
    resolveFirst?.({ status: "materialized", view_name: "x", row_count: 0, expires_at: 0 });
  });

  // T7 -----------------------------------------------------------------
  it("T7 per-dv isolation: bumping table B does NOT abort dv-A's controller (cross-dv)", async () => {
    const rows: DynamicViewRow[] = [
      makeRow({ id: 7, source_table_id: 4 }),
      makeRow({ id: 8, source_table_id: 99 }),
    ];
    (listDynamicViews as Mock).mockResolvedValue({ dynamic_views: rows });

    // Hold both materializes unresolved.
    let resolveA: ((v: MaterializeDynamicViewResponse) => void) | undefined;
    let resolveB: ((v: MaterializeDynamicViewResponse) => void) | undefined;
    const pendingA = new Promise<MaterializeDynamicViewResponse>((r) => { resolveA = r; });
    const pendingB = new Promise<MaterializeDynamicViewResponse>((r) => { resolveB = r; });
    (materializeDynamicView as Mock).mockImplementation((id: number) => {
      if (id === 7) return pendingA;
      if (id === 8) return pendingB;
      return Promise.reject(new Error("unexpected id"));
    });

    renderHook(() => useDynamicViewMaterializeChain(42));
    await waitFor(() => expect((listDynamicViews as Mock)).toHaveBeenCalled());

    // Fire dv 7 cascade.
    act(() => applyFilter(4, 1));
    await waitFor(() => expect(materializeDynamicView).toHaveBeenCalledTimes(1));
    const sigA = (materializeDynamicView as Mock).mock.calls[0][1] as AbortSignal;
    expect(sigA.aborted).toBe(false);

    // Fire dv 8 cascade via UNRELATED table 99 bump.
    act(() => applyFilter(99, 1));
    await waitFor(() => expect(materializeDynamicView).toHaveBeenCalledTimes(2));
    const sigB = (materializeDynamicView as Mock).mock.calls[1][1] as AbortSignal;

    // dv 7's controller must NOT be aborted by dv 8's cascade — per-id isolation.
    expect(sigA.aborted).toBe(false);
    expect(sigB.aborted).toBe(false);

    // Cleanup pending promises so vitest doesn't whine.
    resolveA?.({ status: "materialized", view_name: "x", row_count: 0, expires_at: 0 });
    resolveB?.({ status: "materialized", view_name: "y", row_count: 0, expires_at: 0 });
  });

  // T8 -----------------------------------------------------------------
  it("T8 materialized response: setView called with viewName/status/expiresAt; NO toast fires", async () => {
    const rows: DynamicViewRow[] = [makeRow({ id: 7, source_table_id: 4 })];
    (listDynamicViews as Mock).mockResolvedValue({ dynamic_views: rows });
    (materializeDynamicView as Mock).mockResolvedValue({
      status: "materialized",
      view_name: "_kbi_dv_uu1_d42_7",
      row_count: 100,
      expires_at: 9999,
    } satisfies MaterializeDynamicViewResponse);

    const toastSpy = vi.spyOn(useToastStore.getState(), "showToast");

    renderHook(() => useDynamicViewMaterializeChain(42));
    await waitFor(() => expect((listDynamicViews as Mock)).toHaveBeenCalled());
    act(() => applyFilter(4, 1));

    await waitFor(() => {
      const entry = useDynamicViewStore.getState().views[7];
      expect(entry?.status).toBe("materialized");
      expect(entry?.viewName).toBe("_kbi_dv_uu1_d42_7");
      expect(entry?.expiresAt).toBe(9999);
    });
    expect(toastSpy).not.toHaveBeenCalled();
  });

  // T9 -----------------------------------------------------------------
  it("T9 over_threshold/no_filter: setView(reason), NO toast", async () => {
    const rows: DynamicViewRow[] = [makeRow({ id: 7, source_table_id: 4 })];
    (listDynamicViews as Mock).mockResolvedValue({ dynamic_views: rows });
    (materializeDynamicView as Mock).mockResolvedValue({
      status: "over_threshold",
      reason: "no_filter",
    } satisfies MaterializeDynamicViewResponse);

    const toastSpy = vi.spyOn(useToastStore.getState(), "showToast");

    renderHook(() => useDynamicViewMaterializeChain(42));
    await waitFor(() => expect((listDynamicViews as Mock)).toHaveBeenCalled());
    act(() => applyFilter(4, 1));

    await waitFor(() => {
      const entry = useDynamicViewStore.getState().views[7];
      expect(entry?.status).toBe("over_threshold");
      expect(entry?.reason).toBe("no_filter");
    });
    expect(toastSpy).not.toHaveBeenCalled();
  });

  // T10 ----------------------------------------------------------------
  it("T10 over_threshold/exceeds_max_records: setView(reason), NO toast", async () => {
    const rows: DynamicViewRow[] = [makeRow({ id: 7, source_table_id: 4 })];
    (listDynamicViews as Mock).mockResolvedValue({ dynamic_views: rows });
    (materializeDynamicView as Mock).mockResolvedValue({
      status: "over_threshold",
      reason: "exceeds_max_records",
      row_count: 50_000,
    } satisfies MaterializeDynamicViewResponse);

    const toastSpy = vi.spyOn(useToastStore.getState(), "showToast");

    renderHook(() => useDynamicViewMaterializeChain(42));
    await waitFor(() => expect((listDynamicViews as Mock)).toHaveBeenCalled());
    act(() => applyFilter(4, 1));

    await waitFor(() => {
      const entry = useDynamicViewStore.getState().views[7];
      expect(entry?.status).toBe("over_threshold");
      expect(entry?.reason).toBe("exceeds_max_records");
    });
    expect(toastSpy).not.toHaveBeenCalled();
  });

  // T11 ----------------------------------------------------------------
  it("T11 error: setError + error toast (NEVER warning kind)", async () => {
    const rows: DynamicViewRow[] = [makeRow({ id: 7, source_table_id: 4 })];
    (listDynamicViews as Mock).mockResolvedValue({ dynamic_views: rows });
    (materializeDynamicView as Mock).mockRejectedValue(new Error("boom"));

    const toastSpy = vi.spyOn(useToastStore.getState(), "showToast");

    renderHook(() => useDynamicViewMaterializeChain(42));
    await waitFor(() => expect((listDynamicViews as Mock)).toHaveBeenCalled());
    act(() => applyFilter(4, 1));

    await waitFor(() => {
      const entry = useDynamicViewStore.getState().views[7];
      expect(entry?.status).toBe("error");
      expect(entry?.error).toBe("boom");
    });
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalled();
    });
    // Locked: kind === "error" (never "warning").
    const [, kind] = toastSpy.mock.calls[0];
    expect(kind).toBe("error");
    expect(toastSpy.mock.calls[0][0]).toMatch(/Materialize failed: boom/);
  });

  // T12 ----------------------------------------------------------------
  it("T12 AbortError is silent — no setError, no toast, no state mutation", async () => {
    const rows: DynamicViewRow[] = [makeRow({ id: 7, source_table_id: 4 })];
    (listDynamicViews as Mock).mockResolvedValue({ dynamic_views: rows });
    // Use a real DOMException to mimic the native fetch AbortError shape so
    // the orchestrator's `name === "AbortError"` check matches reliably.
    const abortErr =
      typeof DOMException !== "undefined"
        ? new DOMException("aborted", "AbortError")
        : Object.assign(new Error("aborted"), { name: "AbortError" });
    (materializeDynamicView as Mock).mockRejectedValue(abortErr);

    // Spy on showToast — wrap with vi.fn so we can assert call count without
    // worrying about cross-test spy leakage (spies created via vi.spyOn on the
    // store state survive store reset because the property is replaced; we want
    // a fully fresh assertion surface here).
    const toastCalls: Array<[string, string]> = [];
    const origToast = useToastStore.getState().showToast;
    useToastStore.setState({
      showToast: (msg: string, kind?: "info" | "error" | "permission") => {
        toastCalls.push([msg, kind ?? "info"]);
        return origToast(msg, kind);
      },
    });

    renderHook(() => useDynamicViewMaterializeChain(42));
    await waitFor(() => expect((listDynamicViews as Mock)).toHaveBeenCalled());
    act(() => applyFilter(4, 1));

    await waitFor(() => expect(materializeDynamicView).toHaveBeenCalled());
    // Flush microtasks to ensure the rejected promise's catch has executed.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    // markPending fires before the rejection — so entry exists with status "pending".
    // The key assertions are: NO setError, NO toast, NO transition to "error".
    expect(toastCalls).toEqual([]);
    const entry = useDynamicViewStore.getState().views[7];
    if (entry) {
      expect(entry.status).not.toBe("error");
    }
  });

  // T13 ----------------------------------------------------------------
  it("T13 list refresh: dynamicViewVersion increment triggers second listDynamicViews call", async () => {
    (listDynamicViews as Mock).mockResolvedValue({ dynamic_views: [] });

    renderHook(() => useDynamicViewMaterializeChain(42));
    await waitFor(() => expect(listDynamicViews).toHaveBeenCalledTimes(1));

    // Any mutation that bumps dynamicViewVersion forces a refetch.
    act(() => {
      useDynamicViewStore.getState().setView(99, { viewName: "x", status: "materialized" });
    });

    await waitFor(() => expect(listDynamicViews).toHaveBeenCalledTimes(2));
  });

  // T14 ----------------------------------------------------------------
  it("T14 unmount aborts the list-fetch AbortController", async () => {
    let observedSignal: AbortSignal | undefined;
    (listDynamicViews as Mock).mockImplementation((_id: number, signal?: AbortSignal) => {
      observedSignal = signal;
      // Never resolve in this test — we just want to observe the signal on unmount.
      return new Promise(() => {});
    });

    const { unmount } = renderHook(() => useDynamicViewMaterializeChain(42));
    await waitFor(() => expect(listDynamicViews).toHaveBeenCalled());
    expect(observedSignal?.aborted).toBe(false);

    unmount();
    expect(observedSignal?.aborted).toBe(true);
  });

  // T15 ----------------------------------------------------------------
  it("T15 Pitfall 2 cleanup: removed-dv controllers are pruned + aborted", async () => {
    const initialRows: DynamicViewRow[] = [makeRow({ id: 7, source_table_id: 4 })];
    const emptyRows: DynamicViewRow[] = [];

    // Default to initialRows; the test will switch the mock BEFORE triggering
    // the dynamicViewVersion bump so the second fetch deterministically returns [].
    (listDynamicViews as Mock).mockResolvedValue({ dynamic_views: initialRows });

    let resolveMat: ((v: MaterializeDynamicViewResponse) => void) | undefined;
    const matPromise = new Promise<MaterializeDynamicViewResponse>((r) => {
      resolveMat = r;
    });
    (materializeDynamicView as Mock).mockReturnValue(matPromise);

    renderHook(() => useDynamicViewMaterializeChain(42));
    await waitFor(() => expect(listDynamicViews).toHaveBeenCalledTimes(1));

    // Bump filter-view matVer to fire cascade for dv 7.
    act(() => applyFilter(4, 1));
    await waitFor(() => expect(materializeDynamicView).toHaveBeenCalledTimes(1));
    const sig = (materializeDynamicView as Mock).mock.calls[0][1] as AbortSignal;

    // markPending (called inside the cascade) bumps dynamicViewVersion → triggers
    // list refetch. We DON'T want that intermediate refetch to drop the dv yet;
    // wait for it to settle with the original list.
    await waitFor(() =>
      expect((listDynamicViews as Mock).mock.calls.length).toBeGreaterThanOrEqual(2),
    );
    // After settled, sig should still be in-flight (cascade just markPending'd).
    expect(sig.aborted).toBe(false);

    // Now flip the mock to return [] and trigger another dynamicViewVersion bump
    // to force a list refetch that DROPS dv 7.
    const callCountBefore = (listDynamicViews as Mock).mock.calls.length;
    (listDynamicViews as Mock).mockResolvedValue({ dynamic_views: emptyRows });
    act(() => {
      useDynamicViewStore.getState().clearView(7);
    });
    await waitFor(() =>
      expect((listDynamicViews as Mock).mock.calls.length).toBeGreaterThan(callCountBefore),
    );

    // After the dynamicViews list updates to [], the prior controller for id=7
    // must be aborted by the Pitfall 2 cleanup loop.
    await waitFor(() => {
      expect(sig.aborted).toBe(true);
    });

    resolveMat?.({ status: "materialized", view_name: "x", row_count: 0, expires_at: 0 });
  });

  // T16 ----------------------------------------------------------------
  it("T16 retry(id) re-fires markPending + materializeDynamicView for that dv", async () => {
    const rows: DynamicViewRow[] = [makeRow({ id: 7, source_table_id: 4 })];
    (listDynamicViews as Mock).mockResolvedValue({ dynamic_views: rows });
    (materializeDynamicView as Mock).mockResolvedValue({
      status: "materialized",
      view_name: "_kbi_dv_uu1_d42_7",
      row_count: 1,
      expires_at: 9_999_999_999,
    });

    const { result } = renderHook(() => useDynamicViewMaterializeChain(42));
    await waitFor(() => expect(result.current.dynamicViews.length).toBe(1));

    // No prior cascade — call retry directly.
    act(() => {
      result.current.retry(7);
    });

    await waitFor(() => expect(materializeDynamicView).toHaveBeenCalledTimes(1));
    expect((materializeDynamicView as Mock).mock.calls[0][0]).toBe(7);
    await waitFor(() => {
      expect(useDynamicViewStore.getState().views[7]?.status).toBe("materialized");
    });
  });

  // T17 ----------------------------------------------------------------
  // T18 (post-VERIFY filter-cleared transition) -------------------------
  // Reported by operator: after clearing a polygon filter, the upstream
  // filter view was DELETED but the bound dynamic view stayed at
  // status:"materialized" in the store. Widgets continued to query the
  // now-dropped dv. Root cause: the cascade gate `matVer === 0 → return`
  // blocked the 5→0 transition. Fix changes the gate to fire on ANY change
  // (currentMatVer !== lastSeen) including decreases to 0. The server then
  // sees no filter view, drops the dv, and returns over_threshold/no_filter
  // → store transitions dv to over_threshold → widgets show empty state.
  it("T18 filter-cleared transition: matVer goes 1→0 (drop) → dv transitions to over_threshold/no_filter via fast-path (NO HTTP)", async () => {
    // Post-VERIFY (loading-stuck fix + filter-cleared transition fix combined):
    // The cleared-filter case is deterministic from client state, so the
    // orchestrator uses the no_filter fast-path (setView directly, no HTTP)
    // instead of round-tripping to the server. The end state is identical to
    // the server-call path: dv.status === "over_threshold", reason === "no_filter".
    const rows: DynamicViewRow[] = [makeRow({ id: 7, source_table_id: 4 })];
    (listDynamicViews as Mock).mockResolvedValue({ dynamic_views: rows });
    (materializeDynamicView as Mock).mockResolvedValue({
      status: "materialized",
      view_name: "_kbi_dv_uu1_d42_7",
      row_count: 100,
      expires_at: 9_999_999_999,
    });

    renderHook(() => useDynamicViewMaterializeChain(42));
    await waitFor(() => expect((listDynamicViews as Mock)).toHaveBeenCalled());

    // On mount with no filter → fast-path fires → over_threshold/no_filter.
    await waitFor(() => {
      const entry = useDynamicViewStore.getState().views[7];
      expect(entry?.status).toBe("over_threshold");
      expect(entry?.reason).toBe("no_filter");
    });
    expect(materializeDynamicView).not.toHaveBeenCalled();

    // Step 1: apply a filter → cascade hits HTTP (matVer goes 0→1) → dv materializes.
    act(() => applyFilter(4, 1));
    await waitFor(() =>
      expect(materializeDynamicView).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(useDynamicViewStore.getState().views[7]?.status).toBe(
        "materialized",
      ),
    );

    // Step 2: clear the filter
    // (filters cleared -> NOFILTER token).
    act(() => {
      clearFilters(4);
    });

    // Step 3: cleared transition → fast-path fires → dv flips back to
    // over_threshold/no_filter. NO additional HTTP call (server would
    // return the same answer; fast-path is deterministic).
    await waitFor(() => {
      const entry = useDynamicViewStore.getState().views[7];
      expect(entry?.status).toBe("over_threshold");
      expect(entry?.reason).toBe("no_filter");
    });
    // Still only the ONE HTTP call from step 1.
    expect(materializeDynamicView).toHaveBeenCalledTimes(1);
  });

  it("T17 no username (auth not yet hydrated) → NO cascade fires (defensive)", async () => {
    // Override the beforeEach: clear user.
    useAuthStore.setState({ status: "unauthenticated", user: null, error: null, reason: null, authMode: null });

    const rows: DynamicViewRow[] = [makeRow({ id: 7, source_table_id: 4 })];
    (listDynamicViews as Mock).mockResolvedValue({ dynamic_views: rows });

    renderHook(() => useDynamicViewMaterializeChain(42));
    await waitFor(() => expect((listDynamicViews as Mock)).toHaveBeenCalled());

    act(() => applyFilter(4, 1));
    await new Promise((r) => setTimeout(r, 20));

    expect(materializeDynamicView).not.toHaveBeenCalled();
    expect(useDynamicViewStore.getState().views[7]).toBeUndefined();
  });

  // ---- quick-261009-jg6 DVCOMBO-C ----------------------------------------
  const okMat = {
    status: "materialized",
    view_name: "_kbi_dv_uu1_d42_7",
    row_count: 1,
    expires_at: 9_999_999_999,
  } satisfies MaterializeDynamicViewResponse;

  it("DVCOMBO-C1: filter set + combination view ready -> materializeDynamicView(id, signal, hash)", async () => {
    (listDynamicViews as Mock).mockResolvedValue({ dynamic_views: [makeRow({ id: 5, source_table_id: 7 })] });
    (materializeDynamicView as Mock).mockResolvedValue(okMat);
    renderHook(() => useDynamicViewMaterializeChain(42));
    await waitFor(() => expect(listDynamicViews).toHaveBeenCalled());
    let hash = "";
    act(() => {
      hash = applyFilter(7, 1);
    });
    await waitFor(() => expect(materializeDynamicView).toHaveBeenCalledTimes(1));
    expect(materializeDynamicView).toHaveBeenCalledWith(5, expect.any(AbortSignal), hash);
  });

  it("DVCOMBO-C2: entry missing/materializing -> not called, dv pending; flips ready -> called once with hash", async () => {
    (listDynamicViews as Mock).mockResolvedValue({ dynamic_views: [makeRow({ id: 5, source_table_id: 7 })] });
    (materializeDynamicView as Mock).mockResolvedValue(okMat);
    renderHook(() => useDynamicViewMaterializeChain(42));
    await waitFor(() => expect(listDynamicViews).toHaveBeenCalled());
    let hash = "";
    act(() => {
      hash = applyFilterPending(7, 1);
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(materializeDynamicView).not.toHaveBeenCalled();
    expect(useDynamicViewStore.getState().views[5]?.status).toBe("pending");
    act(() => {
      useFilterCombinationStore.getState().setEntry(hash, {
        viewName: "_kbi_filt_v",
        expiresAt: 9_999_999_999,
        materializing: false,
        materializeVersion: 0,
        refCount: 1,
        dashboardId: 42,
        sourceType: "table",
        sourceId: 7,
      });
    });
    await waitFor(() => expect(materializeDynamicView).toHaveBeenCalledTimes(1));
    expect(materializeDynamicView).toHaveBeenCalledWith(5, expect.any(AbortSignal), hash);
  });

  it("DVCOMBO-C3: Unlimited (max_records 0) + no filters -> server called with no key", async () => {
    (listDynamicViews as Mock).mockResolvedValue({ dynamic_views: [makeRow({ id: 5, source_table_id: 7, max_records: 0 })] });
    (materializeDynamicView as Mock).mockResolvedValue(okMat);
    renderHook(() => useDynamicViewMaterializeChain(42));
    await waitFor(() => expect(materializeDynamicView).toHaveBeenCalledTimes(1));
    expect(materializeDynamicView).toHaveBeenCalledWith(5, expect.any(AbortSignal), undefined);
  });

  it("DVCOMBO-C4: capped + no filters -> no HTTP, local over_threshold/no_filter", async () => {
    (listDynamicViews as Mock).mockResolvedValue({ dynamic_views: [makeRow({ id: 5, source_table_id: 7, max_records: 100000 })] });
    renderHook(() => useDynamicViewMaterializeChain(42));
    await waitFor(() => expect(useDynamicViewStore.getState().views[5]?.reason).toBe("no_filter"));
    expect(materializeDynamicView).not.toHaveBeenCalled();
  });

  it("DVCOMBO-C5: filter changes to a new hash -> re-fires with the NEW hash and aborts the prior in-flight", async () => {
    (listDynamicViews as Mock).mockResolvedValue({ dynamic_views: [makeRow({ id: 5, source_table_id: 7 })] });
    (materializeDynamicView as Mock).mockReturnValueOnce(new Promise(() => {}));
    (materializeDynamicView as Mock).mockResolvedValue(okMat);
    renderHook(() => useDynamicViewMaterializeChain(42));
    await waitFor(() => expect(listDynamicViews).toHaveBeenCalled());
    let h1 = "";
    let h2 = "";
    act(() => {
      h1 = applyFilter(7, 1);
    });
    await waitFor(() => expect(materializeDynamicView).toHaveBeenCalledTimes(1));
    const sig1 = (materializeDynamicView as Mock).mock.calls[0][1] as AbortSignal;
    act(() => {
      h2 = applyFilter(7, 2);
    });
    await waitFor(() => expect(materializeDynamicView).toHaveBeenCalledTimes(2));
    expect(h1).not.toBe(h2);
    expect((materializeDynamicView as Mock).mock.calls[1][2]).toBe(h2);
    expect(sig1.aborted).toBe(true);
  });

  it("DVCOMBO-C6: an unrelated combinationVersion bump does not re-fire", async () => {
    (listDynamicViews as Mock).mockResolvedValue({ dynamic_views: [makeRow({ id: 5, source_table_id: 7 })] });
    (materializeDynamicView as Mock).mockResolvedValue(okMat);
    renderHook(() => useDynamicViewMaterializeChain(42));
    await waitFor(() => expect(listDynamicViews).toHaveBeenCalled());
    act(() => {
      applyFilter(7, 1);
    });
    await waitFor(() => expect(materializeDynamicView).toHaveBeenCalledTimes(1));
    act(() => {
      useFilterCombinationStore.getState().setEntry("table:99:other", {
        viewName: "_kbi_filt_other",
        expiresAt: 9_999_999_999,
        materializing: false,
        materializeVersion: 0,
        refCount: 1,
        dashboardId: 42,
        sourceType: "table",
        sourceId: 99,
      });
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(materializeDynamicView).toHaveBeenCalledTimes(1);
  });

  it("DVCOMBO-C7: retry(id) with no filter + capped still reaches the server with no key ('Load full table' CTA)", async () => {
    (listDynamicViews as Mock).mockResolvedValue({ dynamic_views: [makeRow({ id: 5, source_table_id: 7, max_records: 100000 })] });
    (materializeDynamicView as Mock).mockResolvedValue(okMat);
    const { result } = renderHook(() => useDynamicViewMaterializeChain(42));
    await waitFor(() => expect(result.current.dynamicViews.length).toBe(1));
    act(() => {
      result.current.retry(5);
    });
    await waitFor(() => expect(materializeDynamicView).toHaveBeenCalledTimes(1));
    expect(materializeDynamicView).toHaveBeenCalledWith(5, expect.any(AbortSignal), undefined);
  });

  it("DVCOMBO-C8: while the orchestrator's combination materialize fails (entry cleared, dv error set), the chain does not overwrite the error or hang pending", async () => {
    (listDynamicViews as Mock).mockResolvedValue({ dynamic_views: [makeRow({ id: 5, source_table_id: 7 })] });
    renderHook(() => useDynamicViewMaterializeChain(42));
    await waitFor(() => expect(listDynamicViews).toHaveBeenCalled());
    let hash = "";
    act(() => {
      hash = applyFilterPending(7, 1);
    });
    await waitFor(() => expect(useDynamicViewStore.getState().views[5]?.status).toBe("pending"));
    // Orchestrator failure path: clearEntry + setError
    act(() => {
      useFilterCombinationStore.getState().clearEntry(hash);
      useDynamicViewStore.getState().setError(5, "kinetica boom");
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(useDynamicViewStore.getState().views[5]?.status).toBe("error");
    expect(useDynamicViewStore.getState().views[5]?.error).toBe("kinetica boom");
    expect(materializeDynamicView).not.toHaveBeenCalled();
  });
});


describe("DVCOMBO-SPC chain — spatial draws on the source table", () => {
  const CIRCLE = { id: "c1", type: "circle" as const, wkt: "POLYGON((0 0,1 0,1 1,0 0))", label: "Circle 1", measurement: "1.9 km", addedAt: 1 };
  const MAPW = {
    id: 1, dashboard_id: 42, title: "Map", type: "map", position: 0,
    config: { spatialTargets: [{ tableId: 7, spatialMode: "latlon", lonCol: "lon", latCol: "lat" }] },
    created_at: "", updated_at: "",
  } as WidgetDto;
  const okMat = { status: "materialized", view_name: "_kbi_dv_uu1_d42_7", row_count: 1, expires_at: 9_999_999_999 } satisfies MaterializeDynamicViewResponse;
  const MAPWS = [MAPW]; // stable reference (a fresh array each render would re-run the effect and mask a missing spatialFilterVersion dep)
  const drawCircle = () =>
    act(() => {
      useSpatialFilterStore.setState({ shapes: [CIRCLE], spatialFilterVersion: 1 });
    });

  beforeEach(() => {
    useAuthStore.setState({ status: "authenticated", user: { username: "u1", roles: [], permissions: [] }, error: null, reason: null, authMode: "password" });
    (listDynamicViews as Mock).mockReset();
    (materializeDynamicView as Mock).mockReset();
    useFilterStore.setState({ filters: {}, dvFilters: {}, filterVersion: 0 });
    useFilterCombinationStore.getState().reset();
    useDynamicViewStore.getState().reset();
    useSpatialFilterStore.getState().reset();
  });

  it("DVCOMBO-SP-C1: spatial-only draw -> pending (no no_filter fast-path); combo ready -> POST with the spatial hash as combination_key", async () => {
    (listDynamicViews as Mock).mockResolvedValue({ dynamic_views: [makeRow({ id: 5, source_table_id: 7, max_records: 100000 })] });
    (materializeDynamicView as Mock).mockResolvedValue(okMat);
    renderHook(() => useDynamicViewMaterializeChain(42, MAPWS));
    await waitFor(() => expect(listDynamicViews).toHaveBeenCalled());
    await waitFor(() => expect(useDynamicViewStore.getState().views[5]?.reason).toBe("no_filter"));
    const hash = dvSourceComboHash(7, [], [CIRCLE])!;
    drawCircle();
    await waitFor(() => expect(useDynamicViewStore.getState().views[5]?.status).toBe("pending"));
    expect(materializeDynamicView).not.toHaveBeenCalled();
    act(() => {
      useFilterCombinationStore.getState().setEntry(hash, {
        viewName: "_kbi_filt_sp", expiresAt: 9_999_999_999, materializing: false, materializeVersion: 0,
        refCount: 1, dashboardId: 42, sourceType: "table", sourceId: 7,
      });
    });
    await waitFor(() => expect(materializeDynamicView).toHaveBeenCalledTimes(1));
    expect(materializeDynamicView).toHaveBeenCalledWith(5, expect.any(AbortSignal), hash);
  });

  it("DVCOMBO-SP-C3: clearing the draw returns a capped dv to local no_filter", async () => {
    (listDynamicViews as Mock).mockResolvedValue({ dynamic_views: [makeRow({ id: 5, source_table_id: 7, max_records: 100000 })] });
    renderHook(() => useDynamicViewMaterializeChain(42, MAPWS));
    await waitFor(() => expect(listDynamicViews).toHaveBeenCalled());
    drawCircle();
    await waitFor(() => expect(useDynamicViewStore.getState().views[5]?.status).toBe("pending"));
    act(() => {
      useSpatialFilterStore.setState({ shapes: [], spatialFilterVersion: 2 });
    });
    await waitFor(() => expect(useDynamicViewStore.getState().views[5]?.reason).toBe("no_filter"));
    expect(materializeDynamicView).not.toHaveBeenCalled();
  });

  it("DVCOMBO-SP-C4: a draw on a table with no eligible spatial target is ignored (still no_filter)", async () => {
    (listDynamicViews as Mock).mockResolvedValue({ dynamic_views: [makeRow({ id: 5, source_table_id: 8, max_records: 100000 })] });
    renderHook(() => useDynamicViewMaterializeChain(42, MAPWS));
    await waitFor(() => expect(listDynamicViews).toHaveBeenCalled());
    drawCircle();
    await new Promise((r) => setTimeout(r, 30));
    expect(useDynamicViewStore.getState().views[5]?.reason).toBe("no_filter");
    expect(materializeDynamicView).not.toHaveBeenCalled();
  });
});
