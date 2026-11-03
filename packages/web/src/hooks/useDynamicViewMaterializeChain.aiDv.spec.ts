/**
 * Phase 139 plan 11: chain merge + AI-view materialize branch (CHAINDV-1..10).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { Mock } from "vitest";

import { useDynamicViewMaterializeChain } from "./useDynamicViewMaterializeChain";
import { useDynamicViewStore } from "../store/dynamicViewStore";
import { useFilterStore } from "../store/filterStore";
import type { ActiveFilter } from "../store/filterStore";
import { useFilterCombinationStore } from "../store/filterCombinationStore";
import { useAiSessionStore } from "../store/aiSessionStore";
import { dvSourceComboHash } from "../lib/dvSourceCombo";
import { useAuthStore } from "../store/auth";
import { useToastStore } from "../store/toast";
import type { DynamicViewRow } from "../api/client";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, listDynamicViews: vi.fn(), materializeDynamicView: vi.fn(), materializeAiDynamicView: vi.fn() };
});
vi.mock("../lib/aiDv/aiDvLifecycle", () => ({ trackAiDv: vi.fn(), pendingAiDvDrop: vi.fn() }));
vi.mock("../lib/aiDv/aiDvNotes", () => ({ notifyAiDvStatus: vi.fn() }));

import { listDynamicViews, materializeDynamicView, materializeAiDynamicView } from "../api/client";
import { trackAiDv, pendingAiDvDrop } from "../lib/aiDv/aiDvLifecycle";
import { notifyAiDvStatus } from "../lib/aiDv/aiDvNotes";

const saved = (id: number): DynamicViewRow => ({
  id, dashboard_id: 12, source_table_id: 5, name: `dv${id}`, template_sql: "SELECT * FROM {view}", max_records: 10000,
  columns_json: null, created_at: "", updated_at: "",
});
const spec = { baseTableId: 5, groupBy: [{ column: "vendor" }], aggregates: [{ fn: "count", as: "trips" }] } as never;
const aiRow = (over: Partial<DynamicViewRow> = {}, ai: Record<string, unknown> = {}): DynamicViewRow => ({
  id: -3, dashboard_id: 12, source_table_id: 5, name: "Trips", template_sql: "", max_records: 100000, columns_json: null,
  created_at: "", updated_at: "", aggregated: true,
  ai: { nonce: "0a1b2c3d", gen: 0, spec, baseLabel: "demo.trips", ...ai },
  ...over,
} as DynamicViewRow);
const joinSpec = { baseTableId: 5, joins: [{ tableId: 6, type: "inner", on: [{ left: "a", right: "b" }] }] } as never;

const mkFilter = (value: number): ActiveFilter => ({ column: "vendor", value, dataType: "number", addedAt: 1, sourceWidgetId: 1 }) as ActiveFilter;
const applyFilter = (tableId: number, n: number) => {
  const filters = [mkFilter(n)];
  const hash = dvSourceComboHash(tableId, filters)!;
  useFilterCombinationStore.getState().setEntry(hash, {
    viewName: `_kbi_filt_${hash}`, expiresAt: 9_999_999_999, materializing: false, materializeVersion: 0, refCount: 1,
    dashboardId: 12, sourceType: "table", sourceId: tableId,
  });
  act(() => useFilterStore.setState((s) => ({ filters: { ...s.filters, [tableId]: filters }, filterVersion: s.filterVersion + 1 })));
  return hash;
};
const MAT = { status: "materialized", view_name: "ai_view_x", row_count: 3, expires_at: 9_999_999_999, columns: [{ name: "trips", type: "long" }], aggregated: true };
const NO_REMOVED = new Set<number>();
const settle = () => new Promise((r) => setTimeout(r, 20));

function mount(rows: DynamicViewRow[], removed: ReadonlySet<number> = NO_REMOVED) {
  return renderHook((p: { rows: DynamicViewRow[]; removed: ReadonlySet<number> }) =>
    useDynamicViewMaterializeChain(12, undefined, p.rows, p.removed), { initialProps: { rows, removed } });
}

beforeEach(() => {
  useAuthStore.setState({ status: "authenticated", user: { username: "u1", roles: [], permissions: [] }, error: null, reason: null, authMode: "password" });
  for (const m of [listDynamicViews, materializeDynamicView, materializeAiDynamicView, trackAiDv, pendingAiDvDrop, notifyAiDvStatus]) (m as Mock).mockReset();
  (listDynamicViews as Mock).mockResolvedValue({ dynamic_views: [] });
  (materializeAiDynamicView as Mock).mockResolvedValue(MAT);
  useFilterStore.setState({ filters: {}, dvFilters: {}, filterVersion: 0 });
  useFilterCombinationStore.getState().reset();
  useDynamicViewStore.getState().reset();
  useToastStore.setState({ toasts: [] } as never);
});

describe("useDynamicViewMaterializeChain AI views (139-11)", () => {
  it("CHAINDV-1: merges saved minus removed plus session rows; savedDynamicViews stays the fetched list", async () => {
    (listDynamicViews as Mock).mockResolvedValue({ dynamic_views: [saved(90), saved(91)] });
    const rows = [aiRow()];
    const { result } = mount(rows, new Set([91]));
    await waitFor(() => expect(result.current.savedDynamicViews.map((d) => d.id)).toEqual([90, 91]));
    expect(result.current.dynamicViews.map((d) => d.id)).toEqual([90, -3]);
  });

  it("CHAINDV-2: session row goes through the AI route only, stores columns", async () => {
    mount([aiRow()]);
    await waitFor(() => expect(materializeAiDynamicView).toHaveBeenCalledTimes(1));
    const [body] = (materializeAiDynamicView as Mock).mock.calls[0];
    expect(body).toEqual({ dashboardId: 12, nonce: "0a1b2c3d", tempId: -3, gen: 0, spec });
    expect(materializeDynamicView).not.toHaveBeenCalled();
    await waitFor(() => expect(useDynamicViewStore.getState().views[-3]?.status).toBe("materialized"));
    expect(useDynamicViewStore.getState().views[-3]?.viewName).toBe("ai_view_x");
    expect(useAiSessionStore.getState().dvColumns[-3]).toEqual(MAT.columns);
  });

  it("CHAINDV-3: non-aggregated capped session row with no filter takes the fast-path and notifies", async () => {
    const r = aiRow({ aggregated: false });
    mount([r]);
    await waitFor(() => expect(useDynamicViewStore.getState().views[-3]?.reason).toBe("no_filter"));
    expect(materializeAiDynamicView).not.toHaveBeenCalled();
    expect(notifyAiDvStatus).toHaveBeenCalledWith(r, { status: "over_threshold", reason: "no_filter" });
  });

  it("CHAINDV-4: sends the base combination key and ready joined-table keys only", async () => {
    const h5 = applyFilter(5, 1);
    const r = aiRow({}, { spec: joinSpec });
    const { unmount } = mount([r]);
    await waitFor(() => expect(materializeAiDynamicView).toHaveBeenCalledTimes(1));
    let body = (materializeAiDynamicView as Mock).mock.calls[0][0];
    expect(body.combination_key).toBe(h5);
    expect(body.joinFilterKeys).toBeUndefined();
    unmount();
    (materializeAiDynamicView as Mock).mockClear();
    const h6 = applyFilter(6, 2);
    mount([aiRow({}, { spec: joinSpec })]);
    await waitFor(() => expect(materializeAiDynamicView).toHaveBeenCalledTimes(1));
    body = (materializeAiDynamicView as Mock).mock.calls[0][0];
    expect(body.joinFilterKeys).toEqual({ "6": h6 });
  });

  it("CHAINDV-5: joined-table filter change re-fires; unrelated table does not", async () => {
    mount([aiRow({}, { spec: joinSpec })]);
    await waitFor(() => expect(materializeAiDynamicView).toHaveBeenCalledTimes(1));
    applyFilter(99, 1);
    await settle();
    expect(materializeAiDynamicView).toHaveBeenCalledTimes(1);
    applyFilter(6, 1);
    await waitFor(() => expect(materializeAiDynamicView).toHaveBeenCalledTimes(2));
  });

  it("CHAINDV-6: a new generation re-fires even when the filter token is unchanged", async () => {
    const { rerender } = mount([aiRow()]);
    await waitFor(() => expect(materializeAiDynamicView).toHaveBeenCalledTimes(1));
    rerender({ rows: [aiRow({}, { gen: 1 })], removed: NO_REMOVED });
    await waitFor(() => expect(materializeAiDynamicView).toHaveBeenCalledTimes(2));
    expect((materializeAiDynamicView as Mock).mock.calls[1][0].gen).toBe(1);
  });

  it("CHAINDV-7: waits for the pending drop of the same temp id", async () => {
    let release!: () => void;
    (pendingAiDvDrop as Mock).mockReturnValue(new Promise<void>((r) => { release = r; }));
    mount([aiRow()]);
    await settle();
    expect(materializeAiDynamicView).not.toHaveBeenCalled();
    release();
    await waitFor(() => expect(materializeAiDynamicView).toHaveBeenCalledTimes(1));
  });

  it("CHAINDV-8: tracks the view before the request is sent", async () => {
    mount([aiRow()]);
    await waitFor(() => expect(materializeAiDynamicView).toHaveBeenCalled());
    expect(trackAiDv).toHaveBeenCalledWith({ dashboardId: 12, nonce: "0a1b2c3d", tempId: -3, gen: 0 });
    expect((trackAiDv as Mock).mock.invocationCallOrder[0]).toBeLessThan((materializeAiDynamicView as Mock).mock.invocationCallOrder[0]);
  });

  it("CHAINDV-9: over_threshold notifies, dropped is silent, 409 cap error toasts", async () => {
    const r = aiRow();
    (materializeAiDynamicView as Mock).mockResolvedValueOnce({ status: "over_threshold", reason: "exceeds_max_records", row_count: 250000 });
    const a = mount([r]);
    await waitFor(() => expect(useDynamicViewStore.getState().views[-3]?.reason).toBe("exceeds_max_records"));
    expect(notifyAiDvStatus).toHaveBeenCalledWith(r, { status: "over_threshold", reason: "exceeds_max_records", row_count: 250000 });
    a.unmount();

    useDynamicViewStore.getState().reset();
    (materializeAiDynamicView as Mock).mockResolvedValueOnce({ status: "dropped" });
    const b = mount([aiRow()]);
    await waitFor(() => expect(materializeAiDynamicView).toHaveBeenCalledTimes(2));
    await settle();
    expect(useDynamicViewStore.getState().views[-3]?.status).toBe("pending");
    b.unmount();

    const msg = "you already have 5 session views (limit 5); remove one first";
    (materializeAiDynamicView as Mock).mockRejectedValueOnce(new Error(msg));
    mount([aiRow()]);
    await waitFor(() => expect(useDynamicViewStore.getState().views[-3]?.status).toBe("error"));
    expect(useToastStore.getState().toasts.some((t) => t.message === `Materialize failed: ${msg}`)).toBe(true);
  });

  it("CHAINDV-10: removing the row aborts the in-flight request and drops the late response", async () => {
    let resolve!: (v: unknown) => void;
    let signal!: AbortSignal;
    (materializeAiDynamicView as Mock).mockImplementation((_b: unknown, s: AbortSignal) => { signal = s; return new Promise((r) => { resolve = r; }); });
    const { rerender } = mount([aiRow()]);
    await waitFor(() => expect(materializeAiDynamicView).toHaveBeenCalledTimes(1));
    rerender({ rows: [], removed: NO_REMOVED });
    await waitFor(() => expect(signal.aborted).toBe(true));
    resolve(MAT);
    await settle();
    expect(useDynamicViewStore.getState().views[-3]?.status).not.toBe("materialized");
  });
});
