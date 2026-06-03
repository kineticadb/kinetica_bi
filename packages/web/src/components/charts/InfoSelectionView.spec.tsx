/**
 * Phase 23 (CARD-V14-03 / Plan 23-03 Task 1) — InfoSelectionView shared body spec.
 *
 * Reset shim from __mocks__/zustand.ts wipes the store between tests.
 * Migrated from InfoPopup.spec.tsx (Phase 21) — body cases moved here so popup
 * spec stays chrome-only.
 *
 * Plan 23-03 Task 1 changes (vs Plan 23-01 baseline):
 *   - Drop `onLayerSwitch` / `onLoadMore` from props (view owns fetch internally).
 *   - Add `resolveTable: (tableId: number) => { schema; name } | null`.
 *   - Add `emptyStateCopy?: string` (popup passes "No records"; card passes the ROADMAP literal).
 *   - V1 changes semantics: when `activeLayerId === null`, the view now renders the empty-state
 *     placeholder (CARD-V14-04). The popup wrapper still short-circuits BEFORE this view, so
 *     the popup user-visible behavior is unchanged.
 *   - V17-V21 NEW: cover internal handleLayerSwitch + handleLoadMore + Pitfall 2 short-circuit
 *     + AbortController on rapid switches.
 *
 * Cases:
 *   V1   activeLayerId null → renders empty-state placeholder (was "renders nothing"; CARD-V14-04)
 *   V2   dropdown 2 options + active selected
 *   V3   dropdown change to different layer fires fetch path; same-id no-op
 *   V4   template mode renders HTML; 2 rows → 2 instances
 *   V5   loading + 0 rows → "Loading…"; header visible
 *   V6   no rows + no loading + no error → empty-state copy renders
 *   V7   error + 0 rows → error text
 *   V8   kv mode (info_template=null) → table with all columns
 *   V9   info_columns filters kv table
 *   V10  Load more visible + click fires fetch path
 *   V11  Load more absent when hasMore=false
 *   V12  Load more disabled during loading
 *   V13  active layer leaves eligibleLayers → onActiveLayerIneligible
 *   V14  eligibleLayers identity changes but active still in set → no callback
 *   V15  PITFALL S-02 regression — unrelated layer mutation no re-render
 *   V16  cross-phase column sort — unsorted entry.columns → alphabetical <th> order
 *   V17  handleLayerSwitch fetches with replayed coords (context !== null, state[B] undefined)
 *   V18  Pitfall 2 short-circuit — context === null → focus update only, NO fetch
 *   V19  handleLoadMore fetches with replayed coords (page+1)
 *   V20  Load-more Pitfall 2 short-circuit — context === null → no fetch
 *   V21  AbortController on rapid switches — second switch aborts the first's settle
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import type { DashboardLayerDto } from "../../api/client";

// ── Module-level mock state for vi.mock factories ──────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _infoQueryMock: any = vi.fn(() =>
  Promise.resolve({ rows: [] as Record<string, unknown>[], columns: [] as string[], hasMore: false, page: 0 }),
);

const _lastInfoClickContextState: {
  context:
    | null
    | {
        clickLon: number;
        clickLat: number;
        mapBbox: [number, number, number, number];
        mapWidthPx: number;
        mapHeightPx: number;
        radiusPx: number;
        sourceWidgetId: number;
      };
} = { context: null };

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    infoQuery: (req: any, signal?: any) => _infoQueryMock(req, signal),
  };
});

// useLastInfoClickContextStore mock — reactive selector AND imperative getState() reads.
// Mirror-write setContext so tests can assert via current state too (if needed).
vi.mock("../../store/lastInfoClickContextStore", () => {
  const hook = (selector: (s: any) => any) =>
    selector({
      context: _lastInfoClickContextState.context,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setContext: (ctx: any) => {
        _lastInfoClickContextState.context = ctx;
      },
      reset: () => {
        _lastInfoClickContextState.context = null;
      },
    });
  (hook as any).getState = () => ({
    context: _lastInfoClickContextState.context,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setContext: (ctx: any) => {
      _lastInfoClickContextState.context = ctx;
    },
    reset: () => {
      _lastInfoClickContextState.context = null;
    },
  });
  return { useLastInfoClickContextStore: hook };
});

// Imports MUST come after vi.mock factories (hoisting concern).
import InfoSelectionView from "./InfoSelectionView";
import { useInfoSelectionStore } from "../../store/infoSelectionStore";

const FIXTURE_CTX = {
  clickLon: -122.4,
  clickLat: 37.7,
  mapBbox: [0, 0, 100, 100] as [number, number, number, number],
  mapWidthPx: 800,
  mapHeightPx: 600,
  radiusPx: 20,
  sourceWidgetId: 10,
};

function makeLayer(id: number, opts: Partial<DashboardLayerDto> = {}): DashboardLayerDto {
  return {
    id,
    dashboard_id: 1,
    table_id: 100 + id,
    layer_type: "KineticaWms",
    position: id,
    config: { spatialMode: "latlon", lonColumn: "lon", latColumn: "lat" },
    info_enabled: 1,
    info_columns: null,
    info_template: null,
    dynamic_view_id: null,
    cb_config: null,
    track_config: null,
    created_at: "2026-05-08T00:00:00Z",
    updated_at: "2026-05-08T00:00:00Z",
    ...opts,
  };
}

const defaultProps = {
  eligibleLayers: [makeLayer(5), makeLayer(8)],
  layerNameFor: (l: DashboardLayerDto) => `Layer ${l.id}`,
  resolveTable: (tableId: number) => ({ schema: "public", name: `t${tableId}` }),
  onActiveLayerIneligible: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  _infoQueryMock.mockReset();
  _infoQueryMock.mockResolvedValue({ rows: [], columns: [], hasMore: false, page: 0 });
  _lastInfoClickContextState.context = null;
  // Reset onActiveLayerIneligible spy (defaultProps is a shared object).
  defaultProps.onActiveLayerIneligible = vi.fn();
});

describe("InfoSelectionView", () => {
  // V1: activeLayerId=null → empty-state placeholder (CARD-V14-04)
  it("V1: renders empty-state placeholder when activeLayerId is null", () => {
    const { container } = render(<InfoSelectionView {...defaultProps} />);
    // The view returns the placeholder div (empty-state default copy).
    const placeholder = container.querySelector(".info-selection-empty");
    expect(placeholder).not.toBeNull();
    expect(placeholder?.textContent).toBe("Click a point on the map to see details");
  });

  // V2: activeLayerId=5, eligibleLayers=[5,8] → 2 options; "5" selected; option order matches prop order
  it("V2: renders dropdown with 2 options; active layer selected; order matches prop order", () => {
    act(() => {
      useInfoSelectionStore.getState().setSelection(5, {
        rows: [{ a: 1 }],
        columns: ["a"],
        page: 0,
        hasMore: false,
      });
      useInfoSelectionStore.getState().setActiveLayer(5);
    });
    render(<InfoSelectionView {...defaultProps} />);
    const select = screen.getByRole("combobox", { name: /select layer/i });
    expect(select).toBeInTheDocument();
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect((select as HTMLSelectElement).value).toBe("5");
    expect(options[0]).toHaveTextContent("Layer 5");
    expect(options[1]).toHaveTextContent("Layer 8");
  });

  // V3: dropdown change to different id → fetch path is invoked; same-id → no-op (no fetch).
  // With Pitfall 2 (context === null), this verifies the focus-update path: setActiveLayer
  // is called, infoQuery is NOT (covered more precisely by V18, but smoke-tested here).
  it("V3: dropdown change to different layer triggers fetch flow; same-id is a no-op", () => {
    act(() => {
      useInfoSelectionStore.getState().setSelection(5, {
        rows: [{ a: 1 }],
        columns: ["a"],
        page: 0,
        hasMore: false,
      });
      useInfoSelectionStore.getState().setActiveLayer(5);
    });
    render(<InfoSelectionView {...defaultProps} />);
    const select = screen.getByRole("combobox", { name: /select layer/i });
    // Same id → no state change (active stays at 5; no infoQuery).
    fireEvent.change(select, { target: { value: "5" } });
    expect(_infoQueryMock).not.toHaveBeenCalled();
    expect(useInfoSelectionStore.getState().activeLayerId).toBe(5);
    // Different id, context still null (Pitfall 2) → focus update, NO fetch.
    fireEvent.change(select, { target: { value: "8" } });
    expect(_infoQueryMock).not.toHaveBeenCalled();
    expect(useInfoSelectionStore.getState().activeLayerId).toBe(8);
  });

  // V4: template mode → HTML row via dangerouslySetInnerHTML; 2 rows → 2 instances
  it("V4: template mode renders single substituted HTML row at currentIndex; Next reveals the next row", () => {
    act(() => {
      useInfoSelectionStore.getState().setSelection(5, {
        rows: [{ a: 1 }, { a: 2 }],
        columns: ["a"],
        page: 0,
        hasMore: false,
      });
      useInfoSelectionStore.getState().setActiveLayer(5);
    });
    const layers = [makeLayer(5, { info_template: "<b>{a}</b>" }), makeLayer(8)];
    render(<InfoSelectionView {...defaultProps} eligibleLayers={layers} />);
    // currentIndex=0 by default → only first row visible
    expect(screen.getByText("1", { selector: "b" })).toBeInTheDocument();
    expect(screen.queryByText("2", { selector: "b" })).toBeNull();
    // Click Next → second row visible, first gone
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /next record/i }));
    });
    expect(screen.queryByText("1", { selector: "b" })).toBeNull();
    expect(screen.getByText("2", { selector: "b" })).toBeInTheDocument();
  });

  // V5: loading=true, rows.length=0 → Loading indicator; header still visible
  it("V5: loading with no rows renders Loading indicator; header remains visible", () => {
    act(() => {
      useInfoSelectionStore.getState().setLoading(5, true);
      useInfoSelectionStore.getState().setActiveLayer(5);
    });
    render(<InfoSelectionView {...defaultProps} />);
    expect(screen.getByText(/Loading…/)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /select layer/i })).toBeInTheDocument();
  });

  // V6: no rows + no loading + no error → empty-state copy renders.
  // Default copy is the card's ROADMAP literal; popup overrides with "No records".
  it("V6: no rows / no loading / no error renders empty-state copy (default)", () => {
    act(() => {
      useInfoSelectionStore.getState().setSelection(5, {
        rows: [],
        columns: [],
        page: 0,
        hasMore: false,
      });
      useInfoSelectionStore.getState().setActiveLayer(5);
    });
    render(<InfoSelectionView {...defaultProps} />);
    expect(screen.getByText("Click a point on the map to see details")).toBeInTheDocument();
  });

  // V6b: emptyStateCopy override — popup wrapper passes "No records".
  it("V6b: emptyStateCopy overrides default; popup-style 'No records' copy renders", () => {
    act(() => {
      useInfoSelectionStore.getState().setSelection(5, {
        rows: [],
        columns: [],
        page: 0,
        hasMore: false,
      });
      useInfoSelectionStore.getState().setActiveLayer(5);
    });
    render(<InfoSelectionView {...defaultProps} emptyStateCopy="No records" />);
    expect(screen.getByText("No records")).toBeInTheDocument();
  });

  // V7: error set, rows=0 → error text
  it("V7: error with no rows renders error text", () => {
    act(() => {
      useInfoSelectionStore.getState().setError(5, "oops");
      useInfoSelectionStore.getState().setActiveLayer(5);
    });
    render(<InfoSelectionView {...defaultProps} />);
    expect(screen.getByText("oops")).toBeInTheDocument();
  });

  // V8: kv mode (info_template=null) → table with all columns
  it("V8: kv mode (info_template=null) renders table with all columns", () => {
    act(() => {
      useInfoSelectionStore.getState().setSelection(5, {
        rows: [{ a: 1, b: "x" }],
        columns: ["a", "b"],
        page: 0,
        hasMore: false,
      });
      useInfoSelectionStore.getState().setActiveLayer(5);
    });
    render(<InfoSelectionView {...defaultProps} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("b")).toBeInTheDocument();
    expect(screen.getByText("x")).toBeInTheDocument();
  });

  // V9: info_columns='["b"]' → only column "b" rendered
  it("V9: info_columns filters kv table to specified columns only", () => {
    act(() => {
      useInfoSelectionStore.getState().setSelection(5, {
        rows: [{ a: 1, b: "x" }],
        columns: ["a", "b"],
        page: 0,
        hasMore: false,
      });
      useInfoSelectionStore.getState().setActiveLayer(5);
    });
    const layers = [makeLayer(5, { info_columns: '["b"]' }), makeLayer(8)];
    render(<InfoSelectionView {...defaultProps} eligibleLayers={layers} />);
    expect(screen.getByText("b")).toBeInTheDocument();
    expect(screen.getByText("x")).toBeInTheDocument();
    const headers = screen.queryAllByRole("rowheader");
    expect(headers.map((h) => h.textContent)).not.toContain("a");
  });

  // V10: hasMore=true, loading=false → Load more button visible; click goes through
  // V10: at last loaded record with hasMore=true → Next button enabled (will trigger Load-more).
  // Pitfall 2: context === null short-circuits inside the handler (V20 covers the fetch path).
  it("V10: Next enabled at last loaded record when hasMore=true; click runs the Load-more path", () => {
    act(() => {
      useInfoSelectionStore.getState().setSelection(5, {
        rows: [{ a: 1 }],
        columns: ["a"],
        page: 0,
        hasMore: true,
      });
      useInfoSelectionStore.getState().setActiveLayer(5);
    });
    render(<InfoSelectionView {...defaultProps} />);
    const next = screen.getByRole("button", { name: /next record/i });
    expect(next).not.toBeDisabled();
    fireEvent.click(next);
    // context === null in V10 (no setContext call) → handler short-circuits; no infoQuery.
    expect(_infoQueryMock).not.toHaveBeenCalled();
  });

  // V11: hasMore=false AND at last record → Next button disabled (nothing more to fetch).
  it("V11: Next disabled when hasMore=false and at last loaded record", () => {
    act(() => {
      useInfoSelectionStore.getState().setSelection(5, {
        rows: [{ a: 1 }],
        columns: ["a"],
        page: 0,
        hasMore: false,
      });
      useInfoSelectionStore.getState().setActiveLayer(5);
    });
    render(<InfoSelectionView {...defaultProps} />);
    expect(screen.getByRole("button", { name: /next record/i })).toBeDisabled();
  });

  // V12: hasMore=true + loading=true → Next button disabled during fetch.
  it("V12: Next disabled while loading", () => {
    act(() => {
      useInfoSelectionStore.getState().setSelection(5, {
        rows: [{ a: 1 }],
        columns: ["a"],
        page: 0,
        hasMore: true,
      });
      useInfoSelectionStore.getState().setLoading(5, true);
      useInfoSelectionStore.getState().setActiveLayer(5);
    });
    render(<InfoSelectionView {...defaultProps} />);
    expect(screen.getByRole("button", { name: /next record/i })).toBeDisabled();
  });

  // V13: active layer leaves eligibleLayers → onActiveLayerIneligible called once
  it("V13: invokes onActiveLayerIneligible when active layer leaves eligible set", () => {
    act(() => {
      useInfoSelectionStore.getState().setSelection(5, {
        rows: [{ a: 1 }],
        columns: ["a"],
        page: 0,
        hasMore: false,
      });
      useInfoSelectionStore.getState().setActiveLayer(5);
    });
    const onIneligible = vi.fn();
    const { rerender } = render(
      <InfoSelectionView {...defaultProps} onActiveLayerIneligible={onIneligible} />,
    );
    expect(onIneligible).not.toHaveBeenCalled();
    // Rerender with eligibleLayers that no longer includes id=5
    rerender(
      <InfoSelectionView
        {...defaultProps}
        onActiveLayerIneligible={onIneligible}
        eligibleLayers={[makeLayer(8)]}
      />,
    );
    expect(onIneligible).toHaveBeenCalledTimes(1);
  });

  // V14: same eligibleLayers (active still in set) → no callback
  it("V14: does not invoke onActiveLayerIneligible when eligible set unchanged", () => {
    act(() => {
      useInfoSelectionStore.getState().setSelection(5, {
        rows: [{ a: 1 }],
        columns: ["a"],
        page: 0,
        hasMore: false,
      });
      useInfoSelectionStore.getState().setActiveLayer(5);
    });
    const onIneligible = vi.fn();
    const { rerender } = render(
      <InfoSelectionView {...defaultProps} onActiveLayerIneligible={onIneligible} />,
    );
    rerender(<InfoSelectionView {...defaultProps} onActiveLayerIneligible={onIneligible} />);
    expect(onIneligible).not.toHaveBeenCalled();
  });

  // V15: PITFALL S-02 regression — mutating unrelated layer state does not break body
  it("V15: mutating unrelated layer state does not re-render view body (PITFALL S-02)", () => {
    act(() => {
      useInfoSelectionStore.getState().setSelection(5, {
        rows: [{ a: 1 }],
        columns: ["a"],
        page: 0,
        hasMore: false,
      });
      useInfoSelectionStore.getState().setActiveLayer(5);
    });
    render(<InfoSelectionView {...defaultProps} />);
    expect(screen.getByText("a")).toBeInTheDocument();
    act(() => {
      useInfoSelectionStore.getState().setLoading(7, true);
    });
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  // V16: cross-phase column sort — unsorted columns → alphabetical <th> order
  it("V16: kv-mode columns rendered in alphabetical order regardless of entry.columns order", () => {
    act(() => {
      useInfoSelectionStore.getState().setSelection(5, {
        rows: [{ zebra: 1, apple: 2, mango: 3 }],
        columns: ["zebra", "apple", "mango"],
        page: 0,
        hasMore: false,
      });
      useInfoSelectionStore.getState().setActiveLayer(5);
    });
    render(<InfoSelectionView {...defaultProps} />);
    const headers = screen.getAllByRole("rowheader");
    expect(headers.map((h) => h.textContent)).toEqual(["apple", "mango", "zebra"]);
  });

  // ── Plan 23-03 Task 1 NEW tests ────────────────────────────────────────────────

  // V17: handleLayerSwitch fetches with replayed coords when context !== null and state[B] undefined.
  it("V17: dropdown switch with prior context fires infoQuery once with replayed coords (page=0)", async () => {
    _lastInfoClickContextState.context = { ...FIXTURE_CTX };
    act(() => {
      useInfoSelectionStore.getState().setSelection(5, {
        rows: [{ a: 1 }],
        columns: ["a"],
        page: 0,
        hasMore: false,
      });
      useInfoSelectionStore.getState().setActiveLayer(5);
    });
    _infoQueryMock.mockResolvedValueOnce({
      rows: [{ id: 99 }],
      columns: ["id"],
      hasMore: false,
      page: 0,
    });
    render(<InfoSelectionView {...defaultProps} />);
    const select = screen.getByRole("combobox", { name: /select layer/i });
    await act(async () => {
      fireEvent.change(select, { target: { value: "8" } });
    });

    expect(_infoQueryMock).toHaveBeenCalledTimes(1);
    const [args] = _infoQueryMock.mock.calls[0];
    expect(args).toMatchObject({
      layerId: 8,
      tableId: 108, // makeLayer table_id = 100 + id
      schema: "public",
      table: "t108",
      spatialMode: "latlon",
      spatialColumns: { lonCol: "lon", latCol: "lat" },
      clickLon: FIXTURE_CTX.clickLon,
      clickLat: FIXTURE_CTX.clickLat,
      mapBbox: FIXTURE_CTX.mapBbox,
      mapWidthPx: FIXTURE_CTX.mapWidthPx,
      mapHeightPx: FIXTURE_CTX.mapHeightPx,
      radiusPx: FIXTURE_CTX.radiusPx,
      page: 0,
    });

    // Wait for the .then to settle and write into the store
    await waitFor(() => {
      const s = useInfoSelectionStore.getState();
      expect(s.activeLayerId).toBe(8);
      expect(s.state[8]).toBeDefined();
      expect(s.state[8].rows).toEqual([{ id: 99 }]);
    });
  });

  // V18: Pitfall 2 short-circuit — context === null → focus update only, no fetch.
  it("V18: Pitfall 2 — context === null → setActiveLayer fires; infoQuery does NOT", () => {
    _lastInfoClickContextState.context = null;
    act(() => {
      useInfoSelectionStore.getState().setSelection(5, {
        rows: [{ a: 1 }],
        columns: ["a"],
        page: 0,
        hasMore: false,
      });
      useInfoSelectionStore.getState().setActiveLayer(5);
    });
    render(<InfoSelectionView {...defaultProps} />);
    const select = screen.getByRole("combobox", { name: /select layer/i });
    fireEvent.change(select, { target: { value: "8" } });
    expect(_infoQueryMock).not.toHaveBeenCalled();
    expect(useInfoSelectionStore.getState().activeLayerId).toBe(8);
  });

  // V19: handleLoadMore with prior context fires page=cur.page+1 with replayed coords.
  // V19: Next at last loaded record + hasMore=true + prior context → fires infoQuery at next
  // page with replayed coords; appends the new row; advances currentIndex into it.
  it("V19: Next at last loaded record with prior context fires page+1 fetch and advances currentIndex", async () => {
    _lastInfoClickContextState.context = { ...FIXTURE_CTX };
    act(() => {
      useInfoSelectionStore.getState().setSelection(5, {
        rows: [{ id: 1 }],
        columns: ["id"],
        page: 0,
        hasMore: true,
      });
      useInfoSelectionStore.getState().setActiveLayer(5);
    });
    _infoQueryMock.mockResolvedValueOnce({
      rows: [{ id: 2 }],
      columns: ["id"],
      hasMore: false,
      page: 1,
    });
    render(<InfoSelectionView {...defaultProps} />);
    const next = screen.getByRole("button", { name: /next record/i });
    await act(async () => {
      fireEvent.click(next);
    });

    expect(_infoQueryMock).toHaveBeenCalledTimes(1);
    const [args] = _infoQueryMock.mock.calls[0];
    expect(args).toMatchObject({
      layerId: 5,
      page: 1,
      clickLon: FIXTURE_CTX.clickLon,
      clickLat: FIXTURE_CTX.clickLat,
      radiusPx: FIXTURE_CTX.radiusPx,
    });
    await waitFor(() => {
      const entry = useInfoSelectionStore.getState().state[5];
      expect(entry.rows).toEqual([{ id: 1 }, { id: 2 }]);
      expect(entry.page).toBe(1);
      expect(entry.hasMore).toBe(false);
      // currentIndex auto-advanced into the freshly-appended row.
      expect(entry.currentIndex).toBe(1);
    });
  });

  // V20: Next at last loaded record + hasMore=true + context === null → Pitfall 2 short-circuit.
  it("V20: Next at last loaded record with context === null does NOT fire infoQuery", () => {
    _lastInfoClickContextState.context = null;
    act(() => {
      useInfoSelectionStore.getState().setSelection(5, {
        rows: [{ id: 1 }],
        columns: ["id"],
        page: 0,
        hasMore: true,
      });
      useInfoSelectionStore.getState().setActiveLayer(5);
    });
    render(<InfoSelectionView {...defaultProps} />);
    const next = screen.getByRole("button", { name: /next record/i });
    fireEvent.click(next);
    expect(_infoQueryMock).not.toHaveBeenCalled();
    // Entry unchanged: same page, hasMore, rows, currentIndex.
    const entry = useInfoSelectionStore.getState().state[5];
    expect(entry.page).toBe(0);
    expect(entry.hasMore).toBe(true);
    expect(entry.rows).toEqual([{ id: 1 }]);
    expect(entry.currentIndex).toBe(0);
  });

  // V21: AbortController on rapid switches — second switch aborts the first's settle.
  // The first infoQuery resolves AFTER the second switch fires; .then must early-return because
  // the controller was aborted, so setSelection is NOT written for the first layer's response.
  it("V21: rapid dropdown switches abort prior in-flight fetch (no setSelection for aborted layer)", async () => {
    _lastInfoClickContextState.context = { ...FIXTURE_CTX };
    act(() => {
      useInfoSelectionStore.getState().setSelection(5, {
        rows: [{ a: 1 }],
        columns: ["a"],
        page: 0,
        hasMore: false,
      });
      useInfoSelectionStore.getState().setActiveLayer(5);
    });

    // First switch -> layerB (id=8): a deferred promise we control
    let resolveFirst!: (v: unknown) => void;
    _infoQueryMock.mockImplementationOnce(
      (_req: unknown, signal?: AbortSignal) =>
        new Promise((resolve, reject) => {
          resolveFirst = resolve;
          if (signal) {
            signal.addEventListener("abort", () => {
              const err = new Error("abort");
              (err as Error & { name: string }).name = "AbortError";
              reject(err);
            });
          }
        }),
    );
    // Second switch -> layerC (id=12): settles immediately
    _infoQueryMock.mockResolvedValueOnce({
      rows: [{ id: "C" }],
      columns: ["id"],
      hasMore: false,
      page: 0,
    });

    const eligibleLayers = [makeLayer(5), makeLayer(8), makeLayer(12)];
    render(<InfoSelectionView {...defaultProps} eligibleLayers={eligibleLayers} />);
    const select = screen.getByRole("combobox", { name: /select layer/i });

    // Fire first switch (5 -> 8). Promise stays pending.
    fireEvent.change(select, { target: { value: "8" } });
    expect(_infoQueryMock).toHaveBeenCalledTimes(1);

    // Fire second switch (8 -> 12) BEFORE the first resolves. This must abort first.
    fireEvent.change(select, { target: { value: "12" } });
    expect(_infoQueryMock).toHaveBeenCalledTimes(2);

    // Now resolve the first (would-be late) promise. Its .then must early-return because aborted.
    await act(async () => {
      resolveFirst({ rows: [{ id: "B-late" }], columns: ["id"], hasMore: false, page: 0 });
      // give microtask queue a chance
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      const s = useInfoSelectionStore.getState();
      // The second switch's response (layer 12) is the only one that wrote setSelection.
      expect(s.activeLayerId).toBe(12);
      expect(s.state[12]?.rows).toEqual([{ id: "C" }]);
      // Layer 8 was aborted before settle — its entry was wiped on the second setActiveLayer
      // (Phase 20 layer-switch lock fully deletes prior layer's entry).
      expect(s.state[8]).toBeUndefined();
    });
  });

  // V22: switching from a populated latlon layer to a wkb layer must keep activeLayerId set
  // and fire infoQuery with spatialMode='wkb' + wkbCol from the layer config.
  // Regression for "popup disappears when selecting WKT/Kinetica geometry column layer" bug
  // (the wkb layer used to be excluded from eligibleLayers; once eligible, the dropdown
  // switch must produce a normal fetch, not an eligibility-leave reset).
  it("V22: switching to a wkb (Kinetica geometry column) layer fires fetch and keeps activeLayerId", async () => {
    _lastInfoClickContextState.context = { ...FIXTURE_CTX };
    const latlonLayer = makeLayer(5);
    const wkbLayer = makeLayer(7, {
      config: { spatialMode: "wkb", wkbColumn: "WKT" } as Record<string, unknown>,
    });
    const eligibleLayers = [latlonLayer, wkbLayer];

    act(() => {
      useInfoSelectionStore.getState().setSelection(5, {
        rows: [{ a: 1 }],
        columns: ["a"],
        page: 0,
        hasMore: false,
      });
      useInfoSelectionStore.getState().setActiveLayer(5);
    });

    _infoQueryMock.mockResolvedValueOnce({
      rows: [{ state_name: "California" }],
      columns: ["state_name"],
      hasMore: false,
      page: 0,
    });

    render(<InfoSelectionView {...defaultProps} eligibleLayers={eligibleLayers} />);
    const select = screen.getByRole("combobox", { name: /select layer/i });

    await act(async () => {
      fireEvent.change(select, { target: { value: "7" } });
    });

    // infoQuery fired with wkb mode + wkbCol from layer config
    expect(_infoQueryMock).toHaveBeenCalledTimes(1);
    const [args] = _infoQueryMock.mock.calls[0];
    expect(args).toMatchObject({
      layerId: 7,
      spatialMode: "wkb",
      spatialColumns: { wkbCol: "WKT" },
    });

    await waitFor(() => {
      const s = useInfoSelectionStore.getState();
      // activeLayerId must REMAIN 7 — popup must not disappear via activeLayerId=null path.
      expect(s.activeLayerId).toBe(7);
      expect(s.state[7]?.rows).toEqual([{ state_name: "California" }]);
    });
    // onActiveLayerIneligible must NOT have fired — the wkb layer IS in eligibleLayers.
    expect(defaultProps.onActiveLayerIneligible).not.toHaveBeenCalled();
  });

  // V23: Back / Next nav + total-count display contract.
  it("V23: Back/Next navigate currentIndex; total shows 'Record N of M(+)'; Back disabled at first record", () => {
    act(() => {
      useInfoSelectionStore.getState().setSelection(5, {
        rows: [{ id: 1 }, { id: 2 }, { id: 3 }],
        columns: ["id"],
        page: 0,
        hasMore: true,
      });
      useInfoSelectionStore.getState().setActiveLayer(5);
    });
    render(<InfoSelectionView {...defaultProps} />);
    const back = screen.getByRole("button", { name: /previous record/i });
    const next = screen.getByRole("button", { name: /next record/i });

    // Initial state: index=0 → Back disabled, total "Record 1 of 3+"
    expect(back).toBeDisabled();
    expect(screen.getByText("Record 1 of 3+")).toBeInTheDocument();

    // Next → index=1 → Back enabled, total "Record 2 of 3+"
    act(() => fireEvent.click(next));
    expect(useInfoSelectionStore.getState().state[5].currentIndex).toBe(1);
    expect(screen.getByText("Record 2 of 3+")).toBeInTheDocument();
    expect(back).not.toBeDisabled();

    // Next → index=2 (last loaded). Next stays enabled because hasMore=true.
    act(() => fireEvent.click(next));
    expect(useInfoSelectionStore.getState().state[5].currentIndex).toBe(2);
    expect(screen.getByText("Record 3 of 3+")).toBeInTheDocument();
    expect(next).not.toBeDisabled();

    // Back → index=1
    act(() => fireEvent.click(back));
    expect(useInfoSelectionStore.getState().state[5].currentIndex).toBe(1);
    expect(screen.getByText("Record 2 of 3+")).toBeInTheDocument();
  });

  // V24: hasMore=false → total shows no plus sign; Next disabled at last record.
  it("V24: hasMore=false → 'Record N of M' (no plus); Next disabled at last record", () => {
    act(() => {
      useInfoSelectionStore.getState().setSelection(5, {
        rows: [{ id: 1 }, { id: 2 }],
        columns: ["id"],
        page: 0,
        hasMore: false,
      });
      useInfoSelectionStore.getState().setActiveLayer(5);
    });
    render(<InfoSelectionView {...defaultProps} />);
    expect(screen.getByText("Record 1 of 2")).toBeInTheDocument();
    const next = screen.getByRole("button", { name: /next record/i });
    act(() => fireEvent.click(next));
    expect(screen.getByText("Record 2 of 2")).toBeInTheDocument();
    expect(next).toBeDisabled();
  });
});
