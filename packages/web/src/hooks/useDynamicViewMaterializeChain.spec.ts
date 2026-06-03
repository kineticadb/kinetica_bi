/**
 * Phase 35 Plan 03 (DV-V16-13): orchestrator hook spec.
 *
 * Covers the 17 locked behaviors from 35-03-orchestrator-hook-PLAN.md task 1:
 *   T1  list-fetch on mount
 *   T2  cold-start gate — matVer undefined → no cascade (Pitfall 1)
 *   T3  cold-start gate — matVer === 0 also skipped (defensive)
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
import { useFilterViewStore } from "../store/filterViewStore";
import { useAuthStore } from "../store/auth";
import { useToastStore } from "../store/toast";
import type { DynamicViewRow, MaterializeDynamicViewResponse } from "../api/client";

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

// Helper: write materializeVersion for tableId via setView (real store).
// setView with the same viewName bumps materializeVersion; a new viewName resets to 1.
const setMatVersion = (tableId: number, version: number) => {
  // Reach desired version by repeated setView; setView with same viewName increments.
  // Start by clearing then materializing N times.
  for (let i = 0; i < version; i++) {
    useFilterViewStore.getState().setView(tableId, { viewName: "_kbi_filt_x", expiresAt: 9_999_999_999 }, 42);
  }
};

describe("useDynamicViewMaterializeChain (Phase 35 DV-V16-13)", () => {
  beforeEach(() => {
    // Authoritative auth — every test needs a username for the cascade unless overridden.
    useAuthStore.setState({ status: "authenticated", user: { username: "u1" }, error: null, reason: null, authMode: "password" });
    // Default mock: listDynamicViews resolves to empty; tests that need rows override.
    (listDynamicViews as Mock).mockReset();
    (listDynamicViews as Mock).mockResolvedValue({ dynamic_views: [] });
    (materializeDynamicView as Mock).mockReset();
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
  it("T3 cold-start gate: matVer === 0 also skipped (markMaterializing placeholder)", async () => {
    const rows: DynamicViewRow[] = [makeRow({ id: 7, source_table_id: 4 })];
    (listDynamicViews as Mock).mockResolvedValue({ dynamic_views: rows });

    renderHook(() => useDynamicViewMaterializeChain(42));

    await waitFor(() => expect((listDynamicViews as Mock)).toHaveBeenCalled());

    // markMaterializing writes materializeVersion: 0 — verify gate also skips this case.
    act(() => {
      useFilterViewStore.getState().markMaterializing(4, 42);
    });
    expect(useFilterViewStore.getState().views[4]?.materializeVersion).toBe(0);

    await new Promise((r) => setTimeout(r, 20));
    expect(materializeDynamicView).not.toHaveBeenCalled();
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
    await waitFor(() => expect(useFilterViewStore.getState().views).toEqual({}));
    await waitFor(() => expect((listDynamicViews as Mock)).toHaveBeenCalled());

    act(() => {
      setMatVersion(4, 1);
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
      setMatVersion(99, 1);
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
      setMatVersion(4, 1);
    });
    await waitFor(() => expect(materializeDynamicView).toHaveBeenCalledTimes(1));
    const firstSignal = (materializeDynamicView as Mock).mock.calls[0][1] as AbortSignal;
    expect(firstSignal.aborted).toBe(false);

    // Second matVersion bump — orchestrator should abort the prior controller.
    act(() => {
      setMatVersion(4, 1); // setView with same viewName bumps materializeVersion
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
    act(() => setMatVersion(4, 1));
    await waitFor(() => expect(materializeDynamicView).toHaveBeenCalledTimes(1));
    const sigA = (materializeDynamicView as Mock).mock.calls[0][1] as AbortSignal;
    expect(sigA.aborted).toBe(false);

    // Fire dv 8 cascade via UNRELATED table 99 bump.
    act(() => setMatVersion(99, 1));
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
    act(() => setMatVersion(4, 1));

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
    act(() => setMatVersion(4, 1));

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
    act(() => setMatVersion(4, 1));

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
    act(() => setMatVersion(4, 1));

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
    act(() => setMatVersion(4, 1));

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
    act(() => setMatVersion(4, 1));
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
    act(() => setMatVersion(4, 1));
    await waitFor(() =>
      expect(materializeDynamicView).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(useDynamicViewStore.getState().views[7]?.status).toBe(
        "materialized",
      ),
    );

    // Step 2: clear the filter — remove the views[4] entry entirely
    // (mirrors dropFilterView + useFilterViewStore.clearView behavior).
    act(() => {
      useFilterViewStore.getState().clearView(4);
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

    act(() => setMatVersion(4, 1));
    await new Promise((r) => setTimeout(r, 20));

    expect(materializeDynamicView).not.toHaveBeenCalled();
    expect(useDynamicViewStore.getState().views[7]).toBeUndefined();
  });
});
