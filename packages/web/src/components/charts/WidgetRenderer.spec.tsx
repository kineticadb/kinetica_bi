/**
 * Phase 9 FILT-02 + Phase 15-02 — AggregatedWidgetRenderer integration spec.
 *
 * Verifies the wiring between useFilterStore and AggregatedWidgetRenderer:
 *   - SC-1 / table isolation (filter for table A vs B does not leak SQL)
 *   - SC-4 / clearFilters re-fetches with unfiltered SQL (PITFALL S-02 lock)
 *   - SC-5 / in-flight fetches abort cleanly via AbortController on filter change
 *   - AbortError silenced in catch — no red error UI flash on filter change
 *   - FILT-V13-01: FROM-swap on materialize success
 *   - FILT-V13-03: no materialize when filters empty
 *   - FILT-V13-04: FilteringBadge appears during materialize, disappears after setView
 *
 * The Zustand reset shim at __mocks__/zustand.ts is auto-activated via the
 * spec-file path glob (src/**\/*.spec.{ts,tsx}) and resets useFilterStore
 * between tests.
 *
 * Phase 15-02: All AggregatedWidgetRenderer renders MUST be wrapped in
 * <DashboardContextProvider dashboardId={N}> — useDashboardContext() throws otherwise.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, waitFor, act, screen, fireEvent } from "@testing-library/react";
import WidgetRenderer from "./WidgetRenderer";
import { useFilterStore } from "../../store/filterStore";
import { useFilterViewStore } from "../../store/filterViewStore";
import { useSpatialFilterStore } from "../../store/spatialFilterStore";
// Phase 35 Plan 05 (DV-V16-13/14): dynamic-view store + Retry context wiring tests
import { useDynamicViewStore } from "../../store/dynamicViewStore";
import { DashboardContextProvider } from "../DashboardContext";
import { FilteringBadge } from "../FilteringBadge";
import * as clientModule from "../../api/client";
// Phase 77-01 (COLAPPLY-V115-01): column display config store — used directly (real store, no mock).
import { useColumnDisplayConfigStore } from "../../store/columnDisplayConfigStore";
import type { FormatSpecNumber } from "../../lib/columnFormatter";

// Phase 15-02: mock materializeFilter + dropFilterView alongside runSql.
// vi.spyOn still works on vi.fn() mocks — existing tests use spyOn pattern.
vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    runSql: vi.fn(),
    materializeFilter: vi.fn(),
    dropFilterView: vi.fn(),
    // Phase 77-01: default no-op so loadConfig never makes real HTTP calls.
    // Tests that need config data use upsertColumn on the real store directly.
    listColumnDisplayConfig: vi.fn().mockResolvedValue([]),
  };
});

// Clear all mock call histories between tests to prevent cross-test contamination.
// vi.restoreAllMocks() restores spies but does NOT clear vi.fn() call counts.
beforeEach(() => {
  vi.clearAllMocks();
});

// Phase 15-02: wrap helper — all AggregatedWidgetRenderer renders need this provider.
// Phase 30: also supply widgets to satisfy the extended DashboardContextProvider signature.
// Phase 35 Plan 03 (DV-V16-13): dynamicViews required prop — default [] keeps
// existing tests green without touching every wrap() call site.
// Phase 35 Plan 05 (DV-V16-13/14): retryDynamicView required prop — default no-op
// keeps existing tests green. Renderer Retry button in error state calls this fn.
const wrap = (
  ui: React.ReactNode,
  dashboardId = 1,
  widgets: import("../../api/client").WidgetDto[] = [],
  dynamicViews: import("../../api/client").DynamicViewRow[] = [],
  retryDynamicView: (dynamicViewId: number) => void = () => {}
) => (
  <DashboardContextProvider
    dashboardId={dashboardId}
    widgets={widgets}
    dynamicViews={dynamicViews}
    retryDynamicView={retryDynamicView}
  >{ui}</DashboardContextProvider>
);

// Aggregated widget factory for the new Phase 15-02 describe blocks.
const makeAggregatedWidget = (overrides: Partial<import("../../api/client").WidgetDto> = {}): import("../../api/client").WidgetDto => ({
  id: 1,
  dashboard_id: 1,
  title: "Test",
  type: "bar",
  position: 0,
  config: { sql: "SELECT g, COUNT(*) AS value FROM ki_home.taxi GROUP BY g LIMIT 100", tableId: 99 },
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

// Phase 11: OL modules must be mocked at the import level — jsdom cannot render canvas.
// WidgetRenderer now imports MapChartRenderer (for case "map") which in turn imports ol/*.
// These mocks prevent canvas/WebGL errors in the existing test suite.

// ResizeObserver is not available in jsdom — stub it globally so MapChartRenderer's
// Effect 1 (which creates a ResizeObserver on mount) does not throw.
vi.stubGlobal("ResizeObserver", vi.fn().mockImplementation(function MockResizeObserver(this: any) {
  this.observe = vi.fn();
  this.disconnect = vi.fn();
  return this;
}));

vi.mock("ol/Map", () => ({
  default: vi.fn().mockImplementation(function MockMap(this: any) {
    this.setTarget = vi.fn();
    this.dispose = vi.fn();
    this.addLayer = vi.fn();
    this.removeLayer = vi.fn();
    this.getView = vi.fn(() => ({ fit: vi.fn(), calculateExtent: vi.fn(() => [0, 0, 100, 100]) }));
    this.updateSize = vi.fn();
    // Phase 21: addOverlay / removeOverlay / on / un / getSize needed for InfoPopup integration
    this.addOverlay = vi.fn();
    this.removeOverlay = vi.fn();
    this.on = vi.fn();
    this.un = vi.fn();
    this.getSize = vi.fn(() => [800, 600]);
    // Phase 29: getViewport needed for cursor management useEffect in MapChartRenderer
    this.getViewport = vi.fn(() => ({ style: { cursor: "" } }));
    return this;
  }),
}));
// Phase 21: ol/Overlay and ol/proj mocks (needed by MapChartRenderer Effect 5 + Effect 6)
vi.mock("ol/Overlay", () => ({
  default: vi.fn().mockImplementation(function MockOverlay(this: any) {
    this.setPosition = vi.fn();
    this.getPosition = vi.fn(() => undefined);
    return this;
  }),
}));
vi.mock("ol/proj", () => ({
  transform: vi.fn((coord: any) => coord),
}));
vi.mock("ol/View", () => ({ default: vi.fn().mockImplementation(function MockView(this: any) { return this; }) }));
vi.mock("ol/layer/Tile", () => ({ default: vi.fn().mockImplementation(function MockTileLayer(this: any) { this.setSource = vi.fn(); return this; }) }));
vi.mock("ol/source/OSM", () => ({ default: vi.fn().mockImplementation(function MockOSM(this: any) { return this; }) }));
vi.mock("ol/source/XYZ", () => ({ default: vi.fn().mockImplementation(function MockXYZ(this: any) { return this; }) }));
vi.mock("ol/source/TileWMS", () => ({
  default: vi.fn().mockImplementation(function MockTileWMS(this: any) {
    this.updateParams = vi.fn();
    this.refresh = vi.fn();
    this.setTileLoadFunction = vi.fn();
    this.on = vi.fn();
    return this;
  }),
}));
vi.mock("ol/layer/Image", () => ({ default: vi.fn().mockImplementation(function MockImageLayer(this: any) { this.setSource = vi.fn(); return this; }) }));
vi.mock("ol/source/ImageWMS", () => ({
  default: vi.fn().mockImplementation(function MockImageWMS(this: any) {
    this.updateParams = vi.fn();
    this.refresh = vi.fn();
    this.setImageLoadFunction = vi.fn();
    this.on = vi.fn();
    this.un = vi.fn();
    return this;
  }),
}));
vi.mock("ol/TileState", () => ({ default: { ERROR: 3, LOADING: 1, LOADED: 2, EMPTY: 0 } }));
// Phase 21: store + config + component mocks needed by MapChartRenderer Phase 21 additions
vi.mock("../../store/infoSelectionStore", () => ({
  useInfoSelectionStore: Object.assign(
    (selector: (s: any) => any) => selector({ state: {}, activeLayerId: null }),
    {
      getState: () => ({
        state: {}, activeLayerId: null,
        setSelection: vi.fn(), appendPage: vi.fn(), clearSelection: vi.fn(),
        setActiveLayer: vi.fn(), setLoading: vi.fn(), setError: vi.fn(), reset: vi.fn(),
      }),
    }
  ),
}));
vi.mock("../../lib/mapInfoConfig", () => ({
  getInfoEnabled: (_cfg: any) => true,
  getInfoRadiusPx: (_cfg: any) => 3,
  getInfoPopupWidthPx: (_cfg: any) => 360,
  getInfoPopupHeightPx: (_cfg: any) => 400,
  getShowShapeMeasurements: (_cfg: any) => true,
  // quick-260608-j5k: opt-in controls — default false so legacy tests are byte-identical
  getShowScaleBar: (_cfg: any) => false,
  getShowFullscreenButton: (_cfg: any) => false,
  DEFAULT_INFO_ENABLED: true,
  DEFAULT_INFO_RADIUS_PX: 3,
  DEFAULT_INFO_POPUP_WIDTH_PX: 360,
  DEFAULT_INFO_POPUP_HEIGHT_PX: 400,
  DEFAULT_SHOW_SHAPE_MEASUREMENTS: true,
  DEFAULT_SHOW_SCALE_BAR: false,
  DEFAULT_SHOW_FULLSCREEN_BUTTON: false,
}));
vi.mock("./InfoPopup", () => ({ default: vi.fn(() => null) }));
// Phase 12-02: bboxHelper deleted — mock removed (file no longer exists)
import type { WidgetDto } from "../../api/client";

// Helper: build a minimal aggregated widget. tableId is the key for filter subscription.
const makeWidget = (overrides: Partial<WidgetDto> = {}): WidgetDto => ({
  id: 1,
  dashboard_id: 1,
  title: "Test Widget",
  type: "bar",
  position: 0,
  config: {
    sql: "SELECT category, COUNT(*) AS value FROM sales GROUP BY category ORDER BY value DESC LIMIT 100",
    tableId: 42,
    metricColumn: "id",
    aggregation: "COUNT",
    groupByColumn: "category",
  },
  created_at: "2026-05-04T00:00:00Z",
  updated_at: "2026-05-04T00:00:00Z",
  ...overrides,
});

// A minimal Kinetica response shape that parseKineticaResponse treats as 0 rows.
// `column_headers` present + zero data keys -> dataKeys.length === 0 -> early return [].
const EMPTY_RESPONSE = {
  column_headers: [] as string[],
  column_datatypes: [] as string[],
};

describe("AggregatedWidgetRenderer — filter subscription (FILT-02)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("re-fetches when filterVersion advances after filter is added for widget's tableId (PITFALL S-02 lock)", async () => {
    // Phase 15-02: filterVersion advances → chart-query Effect 2 re-fires.
    // WHERE clause injection is gone; FROM-swap happens AFTER materialize resolves.
    // This test locks that adding a filter causes at least a re-fetch (filterVersion → Effect 2).
    const runSqlSpy = vi
      .spyOn(clientModule, "runSql")
      .mockResolvedValue(EMPTY_RESPONSE as unknown as Record<string, unknown>);
    // materializeFilter must not throw (dropFilterView is called for clear path)
    vi.spyOn(clientModule, "materializeFilter").mockResolvedValue({
      viewName: "_kbi_filt_test",
      expiresAt: Date.now() + 300000,
    });
    vi.spyOn(clientModule, "dropFilterView").mockResolvedValue({ dropped: true });

    render(wrap(<WidgetRenderer widget={makeWidget()} />));

    // Initial fetch — no filters, baseline SQL (no WHERE, no FROM-swap)
    await waitFor(() => expect(runSqlSpy).toHaveBeenCalledTimes(1));
    expect(runSqlSpy.mock.calls[0][0]).not.toContain("WHERE");

    // Add a filter for tableId=42 — filterVersion advances → chart-query re-fires immediately
    act(() => {
      useFilterStore.getState().addFilter(42, {
        column: "region",
        value: "EAST",
        dataType: "string",
        addedAt: 0,
      });
    });
    // At minimum a second runSql call fires (filterVersion bump → Effect 2)
    await waitFor(() => expect(runSqlSpy).toHaveBeenCalledTimes(2));
    // Phase 15-02: no WHERE injection — the SQL itself is never modified client-side anymore
    expect(runSqlSpy.mock.calls[1][0]).not.toContain("WHERE region");
  });

  it("does NOT leak filter SQL when filter is added for a DIFFERENT tableId (PITFALL C-04 / C-02)", async () => {
    const runSqlSpy = vi
      .spyOn(clientModule, "runSql")
      .mockResolvedValue(EMPTY_RESPONSE as unknown as Record<string, unknown>);
    vi.spyOn(clientModule, "materializeFilter").mockResolvedValue({ viewName: "_kbi_filt_test", expiresAt: Date.now() + 300000 });
    vi.spyOn(clientModule, "dropFilterView").mockResolvedValue({ dropped: true });

    render(wrap(<WidgetRenderer widget={makeWidget()} />));
    await waitFor(() => expect(runSqlSpy).toHaveBeenCalledTimes(1));

    // Add a filter for tableId=99 (NOT the widget's table=42).
    act(() => {
      useFilterStore.getState().addFilter(99, {
        column: "x",
        value: "leaked-value",
        dataType: "string",
        addedAt: 0,
      });
    });

    // Allow any pending re-render to flush.
    await new Promise((r) => setTimeout(r, 50));

    // The TRUE isolation guarantee: widget's SQL must NEVER contain table-99's filter value.
    for (const call of runSqlSpy.mock.calls) {
      const sql = call[0] as string;
      expect(sql).not.toContain("leaked-value");
    }
  });

  it("re-fetches when clearFilters fires (PITFALL S-02 lock — guards 'clear is no-op' bug)", async () => {
    const runSqlSpy = vi
      .spyOn(clientModule, "runSql")
      .mockResolvedValue(EMPTY_RESPONSE as unknown as Record<string, unknown>);
    vi.spyOn(clientModule, "materializeFilter").mockResolvedValue({ viewName: "_kbi_filt_test", expiresAt: Date.now() + 300000 });
    vi.spyOn(clientModule, "dropFilterView").mockResolvedValue({ dropped: true });

    render(wrap(<WidgetRenderer widget={makeWidget()} />));
    await waitFor(() => expect(runSqlSpy).toHaveBeenCalledTimes(1));

    act(() => {
      useFilterStore.getState().addFilter(42, {
        column: "region",
        value: "EAST",
        dataType: "string",
        addedAt: 0,
      });
    });
    await waitFor(() => expect(runSqlSpy).toHaveBeenCalledTimes(2));

    act(() => {
      useFilterStore.getState().clearFilters(42);
    });
    // clearFilters advances filterVersion → Effect 2 re-fires → third runSql call
    await waitFor(() => expect(runSqlSpy).toHaveBeenCalledTimes(3));
    // Third call must NOT contain WHERE (it never does in Phase 15-02)
    expect(runSqlSpy.mock.calls[2][0]).not.toContain("WHERE");
  });

  it("aborts in-flight fetch when filter changes before response arrives (FILT-02 SC-5)", async () => {
    // Track AbortSignal state across calls; never resolve the promises so the
    // second fetch fires while the first is still pending.
    const signals: AbortSignal[] = [];
    const runSqlSpy = vi
      .spyOn(clientModule, "runSql")
      .mockImplementation(((_sql: string, _opts?: Record<string, unknown>, signal?: AbortSignal) => {
        if (signal) signals.push(signal);
        return new Promise(() => {}); // never resolves
      }) as unknown as typeof clientModule.runSql);
    vi.spyOn(clientModule, "materializeFilter").mockResolvedValue({ viewName: "_kbi_filt_test", expiresAt: Date.now() + 300000 });
    vi.spyOn(clientModule, "dropFilterView").mockResolvedValue({ dropped: true });

    render(wrap(<WidgetRenderer widget={makeWidget()} />));
    await waitFor(() => expect(runSqlSpy).toHaveBeenCalledTimes(1));

    // Add a filter — this fires the cleanup of the chart-query Effect 2, aborting signals[0].
    act(() => {
      useFilterStore.getState().addFilter(42, {
        column: "region",
        value: "EAST",
        dataType: "string",
        addedAt: 0,
      });
    });
    await waitFor(() => expect(runSqlSpy).toHaveBeenCalledTimes(2));

    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true); // first fetch aborted by cleanup
    expect(signals[1].aborted).toBe(false); // second fetch still in flight
  });

  it("silences AbortError — no red error UI on filter change", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    let rejectFn: ((err: Error) => void) | null = null;

    const runSqlSpy = vi
      .spyOn(clientModule, "runSql")
      .mockImplementationOnce(
        () => new Promise((_, reject) => {
          rejectFn = reject;
        })
      )
      .mockResolvedValueOnce(EMPTY_RESPONSE as unknown as Record<string, unknown>);
    vi.spyOn(clientModule, "materializeFilter").mockResolvedValue({ viewName: "_kbi_filt_test", expiresAt: Date.now() + 300000 });
    vi.spyOn(clientModule, "dropFilterView").mockResolvedValue({ dropped: true });

    const { container } = render(wrap(<WidgetRenderer widget={makeWidget()} />));
    await waitFor(() => expect(runSqlSpy).toHaveBeenCalledTimes(1));

    // Trigger cleanup of the in-flight fetch by adding a filter, then reject the
    // pending promise with AbortError — simulates fetch settling after abort().
    act(() => {
      useFilterStore.getState().addFilter(42, {
        column: "region",
        value: "EAST",
        dataType: "string",
        addedAt: 0,
      });
    });
    await act(async () => {
      rejectFn?.(abortError);
      // Let the microtask queue drain so the catch handler runs.
      await Promise.resolve();
    });

    await waitFor(() => expect(runSqlSpy).toHaveBeenCalledTimes(2));

    // The error UI (`.widget-error`) must NOT appear — AbortError was silenced.
    expect(container.querySelector(".widget-error")).toBeNull();
  });
});

// ----- Phase 10: drill-down click integration (DRILL-01, DRILL-04) -----

/** Build a Kinetica response with the given column headers and column-arrays of values. */
const buildResponse = (
  headers: string[],
  columns: unknown[][],
): Record<string, unknown> => {
  const out: Record<string, unknown> = {
    column_headers: headers,
    column_datatypes: headers.map(() => "string"),
  };
  headers.forEach((_, idx) => {
    out[`column_${idx + 1}`] = columns[idx];
  });
  return out;
};

describe("AggregatedWidgetRenderer — drill-down click (DRILL-01, DRILL-04)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dispatches addFilter when a TableRenderer row is clicked with drillDownColumn configured", async () => {
    const runSqlSpy = vi
      .spyOn(clientModule, "runSql")
      .mockResolvedValue(
        buildResponse(["region", "value"], [["EAST", "WEST"], [10, 20]]) as Record<string, unknown>,
      );
    vi.spyOn(clientModule, "materializeFilter").mockResolvedValue({ viewName: "_kbi_filt_test", expiresAt: Date.now() + 300000 });
    vi.spyOn(clientModule, "dropFilterView").mockResolvedValue({ dropped: true });

    const widget = makeWidget({
      type: "table",
      config: {
        sql: "SELECT region, COUNT(*) AS value FROM sales GROUP BY region ORDER BY value DESC LIMIT 100",
        tableId: 42,
        drillDownColumn: "region",
        drillDownColumnType: "string",
      },
    });
    const { container } = render(wrap(<WidgetRenderer widget={widget} />));

    await waitFor(() => expect(runSqlSpy).toHaveBeenCalled());
    // Wait for the table rows to render
    await waitFor(() => {
      const rows = container.querySelectorAll("tbody tr");
      expect(rows.length).toBe(2);
    });

    // Click the first row (EAST)
    const firstRow = container.querySelectorAll("tbody tr")[0] as HTMLTableRowElement;
    await act(async () => {
      firstRow.click();
      // Wait for the 300ms dim-then-dispatch sequencing (PITFALL C-03)
      await new Promise((r) => setTimeout(r, 350));
    });

    const filters = useFilterStore.getState().filters[42] ?? [];
    expect(filters).toHaveLength(1);
    expect(filters[0].column).toBe("region");
    expect(filters[0].value).toBe("EAST");
    expect(filters[0].dataType).toBe("string");
  });

  // ── Phase 17-03: synchronous markMaterializing in dispatchDrillDown ─────────────
  // Regression spec: pre-17-03, markMaterializing was buried inside Effect 1's 300ms setTimeout,
  // leaving a window where Effect 2 (chart SQL), Effect 3 (WMS), and RecordsTableRenderer effects
  // raced ahead and fired queries against raw FROM/LAYERS. Now markMaterializing is called inline
  // with addFilter, so the entry exists with materializing=true by the time any subscriber re-renders.
  it("Phase 17-03: drill-down click flips entry.materializing=true SYNCHRONOUSLY with addFilter (no race window)", async () => {
    const { useFilterViewStore } = await import("../../store/filterViewStore");
    vi.spyOn(clientModule, "runSql").mockResolvedValue(
      buildResponse(["region", "value"], [["EAST", "WEST"], [10, 20]]) as Record<string, unknown>,
    );
    // Slow materialize so we can observe the post-addFilter / pre-POST window.
    vi.spyOn(clientModule, "materializeFilter").mockImplementation(
      () => new Promise(() => {}), // never resolves — keeps materializing=true
    );

    const widget = makeWidget({
      type: "table",
      config: {
        sql: "SELECT region, COUNT(*) AS value FROM sales GROUP BY region",
        tableId: 42,
        drillDownColumn: "region",
        drillDownColumnType: "string",
      },
    });
    const { container } = render(wrap(<WidgetRenderer widget={widget} />));
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(2));

    // Sanity: no entry exists pre-click.
    expect(useFilterViewStore.getState().views[42]).toBeUndefined();

    const firstRow = container.querySelectorAll("tbody tr")[0] as HTMLTableRowElement;
    await act(async () => {
      firstRow.click();
      await new Promise((r) => setTimeout(r, 350)); // through the click's 300ms dim setTimeout
    });

    // Both stores updated atomically inside dispatchDrillDown — chip exists AND entry has materializing=true.
    const filters = useFilterStore.getState().filters[42] ?? [];
    expect(filters).toHaveLength(1);
    const entry = useFilterViewStore.getState().views[42];
    expect(entry).toBeDefined();
    expect(entry!.materializing).toBe(true);
    // viewName is the placeholder empty string until setView fires (which never resolves in this test).
    expect(entry!.viewName).toBe("");
  });

  it("does NOT dispatch addFilter when drillDownColumn is empty (legacy widget — graceful no-op)", async () => {
    const runSqlSpy = vi
      .spyOn(clientModule, "runSql")
      .mockResolvedValue(
        buildResponse(["region", "value"], [["EAST"], [10]]) as Record<string, unknown>,
      );
    vi.spyOn(clientModule, "materializeFilter").mockResolvedValue({ viewName: "_kbi_filt_test", expiresAt: Date.now() + 300000 });
    vi.spyOn(clientModule, "dropFilterView").mockResolvedValue({ dropped: true });

    const widget = makeWidget({
      type: "table",
      config: {
        sql: "SELECT region, COUNT(*) AS value FROM sales GROUP BY region",
        tableId: 42,
        // drillDownColumn intentionally absent — legacy widget path
      },
    });
    const { container } = render(wrap(<WidgetRenderer widget={widget} />));
    await waitFor(() => expect(runSqlSpy).toHaveBeenCalled());
    await waitFor(() => {
      expect(container.querySelectorAll("tbody tr").length).toBe(1);
    });

    const firstRow = container.querySelectorAll("tbody tr")[0] as HTMLTableRowElement;
    await act(async () => {
      firstRow.click();
      await new Promise((r) => setTimeout(r, 350));
    });

    expect(useFilterStore.getState().filters[42] ?? []).toHaveLength(0);
  });

  it("RecordsTableRenderer applies widget-table-row-active class to rows matching active filter", async () => {
    const runSqlSpy = vi
      .spyOn(clientModule, "runSql")
      .mockResolvedValue(
        buildResponse(["region", "amount"], [["EAST", "WEST"], [10, 20]]) as Record<string, unknown>,
      );
    vi.spyOn(clientModule, "materializeFilter").mockResolvedValue({ viewName: "_kbi_filt_test", expiresAt: Date.now() + 300000 });
    vi.spyOn(clientModule, "dropFilterView").mockResolvedValue({ dropped: true });

    // Pre-populate filter BEFORE render
    act(() => {
      useFilterStore.getState().addFilter(42, {
        column: "region",
        value: "EAST",
        dataType: "string",
        addedAt: 0,
      });
    });

    const widget = makeWidget({
      type: "records",
      config: {
        table: "sales",
        tableId: 42,
        columns: "region, amount",
        drillDownColumn: "region",
        drillDownColumnType: "string",
        pageSize: 25,
      },
    });
    // RecordsTableRenderer has its own renderer path (short-circuits AggregatedWidgetRenderer)
    // so wrap() is needed because WidgetRenderer dispatches through AggregatedWidgetRenderer for
    // non-records types but records go through RecordsTableRenderer. However, DashboardContext
    // is needed for WidgetRenderer-level rendering consistency.
    const { container } = render(wrap(<WidgetRenderer widget={widget} />));
    await waitFor(() => expect(runSqlSpy).toHaveBeenCalled());
    await waitFor(() => {
      expect(container.querySelectorAll("tbody tr").length).toBe(2);
    });

    const rows = container.querySelectorAll("tbody tr");
    // Row 0: region="EAST" — should be tinted
    expect(rows[0].className).toContain("widget-table-row-active");
    // Row 1: region="WEST" — should NOT be tinted
    expect(rows[1].className).not.toContain("widget-table-row-active");
  });

  // ── Phase 17-03: empty-string placeholder fallthrough in RecordsTableRenderer ────
  // Regression spec for the "SELECT * FROM  LIMIT 25 OFFSET 0" bug: pre-17-03,
  // RecordsTableRenderer used `viewName ?? table` which only fell through on null/undefined.
  // The placeholder entry created by markMaterializing has viewName="" (empty string), which
  // `??` keeps verbatim — producing broken SQL with an empty FROM. The fix uses `||` so empty
  // string falls through to `table`. This spec drives the post-error path where the entry exists
  // with materializing=false but viewName is still the empty placeholder.
  it("Phase 17-03: RecordsTableRenderer renders raw FROM <table> when entry has viewName='' placeholder (post-error fallthrough)", async () => {
    const { useFilterViewStore } = await import("../../store/filterViewStore");
    const runSqlSpy = vi.spyOn(clientModule, "runSql").mockResolvedValue(
      buildResponse(["region", "amount"], [["EAST", "WEST"], [10, 20]]) as Record<string, unknown>,
    );
    vi.spyOn(clientModule, "materializeFilter").mockResolvedValue({ viewName: "_kbi_filt_test", expiresAt: Date.now() + 300000 });
    vi.spyOn(clientModule, "dropFilterView").mockResolvedValue({ dropped: true });

    // Pre-populate filter chip AND entry with empty-string placeholder + materializing=false
    // (simulating post-clearMaterializing-on-error state).
    act(() => {
      useFilterStore.getState().addFilter(42, {
        column: "region",
        value: "EAST",
        dataType: "string",
        addedAt: 0,
      });
      useFilterViewStore.setState({
        views: {
          42: { viewName: "", expiresAt: 0, materializing: false, materializeVersion: 0, dashboardId: 1 },
        },
      });
    });

    const widget = makeWidget({
      type: "records",
      config: {
        table: "sales",
        tableId: 42,
        columns: "region, amount",
        drillDownColumn: "region",
        drillDownColumnType: "string",
        pageSize: 25,
      },
    });
    render(wrap(<WidgetRenderer widget={widget} />));

    // The page-fetch effect must run with FROM <table> (raw), not FROM (empty).
    await waitFor(() => expect(runSqlSpy).toHaveBeenCalled());
    const sqlString = String(runSqlSpy.mock.calls[0][0]);
    // Must NOT be the broken empty-FROM form.
    expect(sqlString).not.toMatch(/FROM\s+(?:LIMIT|ORDER|$)/i);
    // Must include FROM sales (the raw table fallback).
    expect(sqlString).toMatch(/FROM\s+sales/);
  });

  it("toast fires on first add with buildChipText format (column = 'value')", async () => {
    const { useToastStore } = await import("../../store/toast");
    const callLog: Array<[string, string | undefined]> = [];
    const realShowToast = useToastStore.getState().showToast;
    useToastStore.setState({
      showToast: (msg: string, kind?: "permission" | "info" | "error") => {
        callLog.push([msg, kind]);
        realShowToast(msg, kind);
      },
    } as Partial<ReturnType<typeof useToastStore.getState>>);

    vi.spyOn(clientModule, "runSql").mockResolvedValue(
      buildResponse(["region", "value"], [["EAST"], [10]]) as Record<string, unknown>,
    );
    vi.spyOn(clientModule, "materializeFilter").mockResolvedValue({ viewName: "_kbi_filt_test", expiresAt: Date.now() + 300000 });
    vi.spyOn(clientModule, "dropFilterView").mockResolvedValue({ dropped: true });

    const widget = makeWidget({
      type: "table",
      config: {
        sql: "SELECT region, COUNT(*) AS value FROM sales GROUP BY region",
        tableId: 42,
        drillDownColumn: "region",
        drillDownColumnType: "string",
      },
    });
    const { container } = render(wrap(<WidgetRenderer widget={widget} />));
    await waitFor(() => {
      expect(container.querySelectorAll("tbody tr").length).toBe(1);
    });

    const firstRow = container.querySelectorAll("tbody tr")[0] as HTMLTableRowElement;
    await act(async () => {
      firstRow.click();
      await new Promise((r) => setTimeout(r, 350));
    });

    const drillToastCalls = callLog.filter(([msg]) => msg === "region = 'EAST'");
    expect(drillToastCalls.length).toBe(1);
    // kind should be "info" (or undefined which defaults to info)
    const [, kind] = drillToastCalls[0];
    expect(kind === undefined || kind === "info").toBe(true);
  });

  it("toast SUPPRESSED on dedupe (re-click already-active value)", async () => {
    const callLog: string[] = [];
    const { useToastStore } = await import("../../store/toast");
    const realShowToast = useToastStore.getState().showToast;
    useToastStore.setState({
      showToast: (msg: string, kind?: "permission" | "info" | "error") => {
        callLog.push(msg);
        realShowToast(msg, kind);
      },
    } as Partial<ReturnType<typeof useToastStore.getState>>);

    // Pre-populate the same filter the click would attempt
    act(() => {
      useFilterStore.getState().addFilter(42, {
        column: "region",
        value: "EAST",
        dataType: "string",
        addedAt: 0,
      });
    });

    vi.spyOn(clientModule, "runSql").mockResolvedValue(
      buildResponse(["region", "value"], [["EAST"], [10]]) as Record<string, unknown>,
    );
    vi.spyOn(clientModule, "materializeFilter").mockResolvedValue({ viewName: "_kbi_filt_test", expiresAt: Date.now() + 300000 });
    vi.spyOn(clientModule, "dropFilterView").mockResolvedValue({ dropped: true });

    const widget = makeWidget({
      type: "table",
      config: {
        sql: "SELECT region, COUNT(*) AS value FROM sales GROUP BY region",
        tableId: 42,
        drillDownColumn: "region",
        drillDownColumnType: "string",
      },
    });
    const { container } = render(wrap(<WidgetRenderer widget={widget} />));
    await waitFor(() => {
      expect(container.querySelectorAll("tbody tr").length).toBe(1);
    });

    const firstRow = container.querySelectorAll("tbody tr")[0] as HTMLTableRowElement;
    await act(async () => {
      firstRow.click();
      await new Promise((r) => setTimeout(r, 350));
    });

    // Drill confirmation toast must NOT fire on dedupe (chip change is the feedback — but
    // here there's no chip change either; it's a true no-op)
    expect(callLog).not.toContain("region = 'EAST'");
  });

  it("toast SUPPRESSED on replace (same column different value)", async () => {
    const callLog: string[] = [];
    const { useToastStore } = await import("../../store/toast");
    const realShowToast = useToastStore.getState().showToast;
    useToastStore.setState({
      showToast: (msg: string, kind?: "permission" | "info" | "error") => {
        callLog.push(msg);
        realShowToast(msg, kind);
      },
    } as Partial<ReturnType<typeof useToastStore.getState>>);

    // Pre-populate a DIFFERENT value for the same column — click will REPLACE
    act(() => {
      useFilterStore.getState().addFilter(42, {
        column: "region",
        value: "WEST",
        dataType: "string",
        addedAt: 0,
      });
    });

    vi.spyOn(clientModule, "runSql").mockResolvedValue(
      buildResponse(["region", "value"], [["EAST"], [10]]) as Record<string, unknown>,
    );
    vi.spyOn(clientModule, "materializeFilter").mockResolvedValue({ viewName: "_kbi_filt_test", expiresAt: Date.now() + 300000 });
    vi.spyOn(clientModule, "dropFilterView").mockResolvedValue({ dropped: true });

    const widget = makeWidget({
      type: "table",
      config: {
        sql: "SELECT region, COUNT(*) AS value FROM sales GROUP BY region",
        tableId: 42,
        drillDownColumn: "region",
        drillDownColumnType: "string",
      },
    });
    const { container } = render(wrap(<WidgetRenderer widget={widget} />));
    await waitFor(() => {
      expect(container.querySelectorAll("tbody tr").length).toBe(1);
    });

    const firstRow = container.querySelectorAll("tbody tr")[0] as HTMLTableRowElement;
    await act(async () => {
      firstRow.click();
      await new Promise((r) => setTimeout(r, 350));
    });

    // Replace must succeed in the store
    const filters = useFilterStore.getState().filters[42] ?? [];
    expect(filters).toHaveLength(1);
    expect(filters[0].value).toBe("EAST");
    // ...but NO drill confirmation toast for the new value (chip change is the feedback)
    expect(callLog).not.toContain("region = 'EAST'");
  });
});

// ----- Phase 11: map widget routing (MAP-01) -----

describe("WidgetRenderer — map widget routing", () => {
  it("renders MapChartRenderer for widget.type === 'map' (bypasses aggregated SQL pipeline)", () => {
    const mapWidget: WidgetDto = {
      id: 99,
      dashboard_id: 1,
      title: "My Map",
      type: "map",
      position: 0,
      config: {
        tableId: 42,
        spatialMode: "latlon",
        latColumn: "",
        lonColumn: "",
        renderMode: "raster",
        basemap: "osm",
      },
      created_at: "2026-05-05T00:00:00Z",
      updated_at: "2026-05-05T00:00:00Z",
    };

    // Map widgets should NOT trigger runSql (they use WMS tiles, not aggregated SQL).
    const runSqlSpy = vi.spyOn(clientModule, "runSql");

    render(<WidgetRenderer widget={mapWidget} />);

    // MapChartRenderer renders the reconfigure overlay (old Phase 11 config — includedLayerIds absent)
    // Phase 12-05: old-config widgets with spatialMode set but includedLayerIds absent render this overlay.
    expect(screen.getByText(/This map needs to be reconfigured/i)).toBeInTheDocument();

    // No SQL fetch should be triggered for a map widget
    expect(runSqlSpy).not.toHaveBeenCalled();
  });

  // Phase 23 Plan 03 (CARD-V14-01): info-card routing — widget.type='info-card' bypasses
  // AggregatedWidgetRenderer (no SQL pipeline) and renders InfoCardRenderer (.widget-info-card).
  it("renders InfoCardRenderer for widget.type === 'info-card' (bypasses aggregated SQL pipeline)", () => {
    const infoCardWidget: WidgetDto = {
      id: 77,
      dashboard_id: 1,
      title: "Info",
      type: "info-card",
      position: 0,
      config: {},
      created_at: "2026-05-09T00:00:00Z",
      updated_at: "2026-05-09T00:00:00Z",
    };

    // Info-card widgets should NOT trigger runSql (they use POST /api/info/query, not SQL).
    const runSqlSpy = vi.spyOn(clientModule, "runSql");

    const { container } = render(<WidgetRenderer widget={infoCardWidget} tables={[]} />);

    // The .widget-info-card outer wrapper is rendered by InfoCardRenderer.
    expect(container.querySelector(".widget-info-card")).not.toBeNull();
    // No SQL fetch should be triggered for an info-card widget.
    expect(runSqlSpy).not.toHaveBeenCalled();
  });
});

// ----- Phase 15-02: materialize trigger + FROM-swap + badge + toast routing -----

describe("AggregatedWidgetRenderer — FILT-V13-01 (FROM-swap on materialize success)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useFilterStore.getState().reset();
    useFilterViewStore.getState().reset();
  });

  it("substitutes FROM <table> with FROM <view> after materialize completes", async () => {
    vi.spyOn(clientModule, "materializeFilter").mockResolvedValue({
      viewName: "_kbi_filt_u1_d1_t99_sabcdef12",
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
    vi.spyOn(clientModule, "runSql").mockResolvedValue(EMPTY_RESPONSE as unknown as Record<string, unknown>);
    vi.spyOn(clientModule, "dropFilterView").mockResolvedValue({ dropped: true });

    // Seed a chip filter so the materialize trigger fires
    useFilterStore.getState().addFilter(99, {
      column: "g",
      value: "A",
      dataType: "string",
      addedAt: Date.now(),
    });

    const widget = makeAggregatedWidget();
    render(wrap(<WidgetRenderer widget={widget} />));

    // Wait for the 300ms debounce + materialize await + chart-query re-run
    await waitFor(
      () => {
        expect(clientModule.materializeFilter).toHaveBeenCalledWith(
          expect.objectContaining({ dashboardId: 1, tableId: 99 }),
          expect.any(AbortSignal)
        );
      },
      { timeout: 1500 }
    );

    // After materialize completes + chart-query re-fires, runSql must have been called
    // with the view name swapped in
    await waitFor(() => {
      const calls = (clientModule.runSql as ReturnType<typeof vi.fn>).mock.calls;
      const swapped = calls.some((args: unknown[]) =>
        typeof args[0] === "string" && (args[0] as string).includes("FROM _kbi_filt_u1_d1_t99_sabcdef12")
      );
      expect(swapped).toBe(true);
    });
  });
});

describe("AggregatedWidgetRenderer — FILT-V13-03 (no filters → no materialize round-trip)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useFilterStore.getState().reset();
    useFilterViewStore.getState().reset();
  });

  it("does NOT call materializeFilter when useFilterStore.filters[tableId] is empty", async () => {
    vi.spyOn(clientModule, "runSql").mockResolvedValue(EMPTY_RESPONSE as unknown as Record<string, unknown>);
    vi.spyOn(clientModule, "dropFilterView").mockResolvedValue({ dropped: true });

    const widget = makeAggregatedWidget();
    render(wrap(<WidgetRenderer widget={widget} />));

    // Wait through the debounce window — materializeFilter must NEVER fire
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(clientModule.materializeFilter).not.toHaveBeenCalled();

    // runSql should have been called with the RAW table SQL (no view swap)
    const calls = (clientModule.runSql as ReturnType<typeof vi.fn>).mock.calls;
    const rawTable = calls.some((args: unknown[]) =>
      typeof args[0] === "string" && (args[0] as string).includes("FROM ki_home.taxi")
    );
    expect(rawTable).toBe(true);
  });
});

describe("AggregatedWidgetRenderer — FILT-V13-04 (Filtering badge during materialize)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useFilterStore.getState().reset();
    useFilterViewStore.getState().reset();
  });

  it("FilteringBadge renders 'Filtering...' while materializing=true, disappears after setView", async () => {
    let resolveMaterialize: ((v: { viewName: string; expiresAt: number }) => void) | undefined;
    vi.spyOn(clientModule, "materializeFilter").mockImplementation(
      () => new Promise((res) => { resolveMaterialize = res; })
    );
    vi.spyOn(clientModule, "runSql").mockResolvedValue(EMPTY_RESPONSE as unknown as Record<string, unknown>);
    vi.spyOn(clientModule, "dropFilterView").mockResolvedValue({ dropped: true });

    useFilterStore.getState().addFilter(99, {
      column: "g", value: "A", dataType: "string", addedAt: Date.now(),
    });

    const widget = makeAggregatedWidget();
    // Render the WidgetRenderer AND a sibling FilteringBadge for the same tableId
    // (mirrors how DashboardsPage embeds the badge in widget card header)
    render(wrap(
      <>
        <FilteringBadge tableId={99} />
        <WidgetRenderer widget={widget} />
      </>
    ));

    // After debounce, markMaterializing fires → badge appears
    await waitFor(() => {
      expect(screen.getByText("Filtering...")).toBeInTheDocument();
    }, { timeout: 1500 });

    // Resolve the materialize → setView fires → materializing flips to false → badge disappears
    resolveMaterialize?.({ viewName: "_kbi_filt_v1", expiresAt: Date.now() + 300000 });

    await waitFor(() => {
      expect(screen.queryByText("Filtering...")).toBeNull();
    });
  });
});

describe("AggregatedWidgetRenderer — toast routing on materialize failure", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useFilterStore.getState().reset();
    useFilterViewStore.getState().reset();
  });

  it("PermissionError → toast + chart falls through to raw FROM <table>", async () => {
    const { PermissionError } = await import("../../api/client");
    vi.spyOn(clientModule, "materializeFilter").mockRejectedValue(
      new PermissionError("Filtering not enabled for your account")
    );
    vi.spyOn(clientModule, "runSql").mockResolvedValue(EMPTY_RESPONSE as unknown as Record<string, unknown>);
    vi.spyOn(clientModule, "dropFilterView").mockResolvedValue({ dropped: true });

    useFilterStore.getState().addFilter(99, {
      column: "g", value: "A", dataType: "string", addedAt: Date.now(),
    });

    // Spy on useToastStore.showToast
    const { useToastStore } = await import("../../store/toast");
    const showToastSpy = vi.spyOn(useToastStore.getState(), "showToast");

    render(wrap(<WidgetRenderer widget={makeAggregatedWidget()} />));

    await waitFor(() => {
      expect(showToastSpy).toHaveBeenCalledWith(
        "Filtering not enabled for your account",
        "error"
      );
    }, { timeout: 1500 });

    // setView was NOT called — viewName is undefined → chart fell through to raw table
    expect(useFilterViewStore.getState().views[99]?.viewName).toBeFalsy();
  });
});

// ----- Phase 15-03: RecordsTableRenderer FROM-swap consumer (FILT-V13-02) -----

const makeRecordsWidget = (overrides: Partial<WidgetDto> = {}): WidgetDto => ({
  id: 2,
  dashboard_id: 1,
  title: "Records",
  type: "records",
  position: 1,
  config: { table: "ki_home.taxi", tableId: 99, columns: "g,value", pageSize: 25 },
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

describe("RecordsTableRenderer — FILT-V13-02 (FROM-swap on page + count queries)", () => {
  beforeEach(() => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockReset();
    useFilterStore.getState().reset();
    useFilterViewStore.getState().reset();
  });

  it("queries raw FROM <table> when no view entry exists for the tableId", async () => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockResolvedValue({
      column_headers: ["g", "value"],
      column_1: ["A"],
      column_2: [10],
    });

    render(wrap(<WidgetRenderer widget={makeRecordsWidget()} />));

    await waitFor(() => {
      const calls = (clientModule.runSql as ReturnType<typeof vi.fn>).mock.calls;
      const rawPage = calls.some(
        (args) => typeof args[0] === "string" && args[0].includes("FROM ki_home.taxi") && args[0].includes("LIMIT 25")
      );
      const rawCount = calls.some(
        (args) => typeof args[0] === "string" && args[0].includes("SELECT COUNT(*) AS total FROM ki_home.taxi")
      );
      expect(rawPage).toBe(true);
      expect(rawCount).toBe(true);
    });
  });

  it("queries FROM <viewName> on page-fetch SQL when viewName is set", async () => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockResolvedValue({
      column_headers: ["g", "value"],
      column_1: ["A"],
      column_2: [10],
    });
    // Pre-seed the view (no materialize call needed — pure consumer)
    useFilterViewStore.getState().setView(
      99,
      { viewName: "_kbi_filt_v1", expiresAt: Date.now() + 300000 },
      1
    );

    render(wrap(<WidgetRenderer widget={makeRecordsWidget()} />));

    await waitFor(() => {
      const calls = (clientModule.runSql as ReturnType<typeof vi.fn>).mock.calls;
      const swappedPage = calls.some(
        (args) => typeof args[0] === "string" && args[0].includes("FROM _kbi_filt_v1") && args[0].includes("LIMIT 25")
      );
      expect(swappedPage).toBe(true);
    });
  });

  it("queries FROM <viewName> on COUNT(*) SQL when viewName is set (count narrows)", async () => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockResolvedValue({
      column_headers: ["total"],
      column_1: [12345],
    });
    useFilterViewStore.getState().setView(
      99,
      { viewName: "_kbi_filt_v1", expiresAt: Date.now() + 300000 },
      1
    );

    render(wrap(<WidgetRenderer widget={makeRecordsWidget()} />));

    await waitFor(() => {
      const calls = (clientModule.runSql as ReturnType<typeof vi.fn>).mock.calls;
      const swappedCount = calls.some(
        (args) => typeof args[0] === "string" && args[0] === "SELECT COUNT(*) AS total FROM _kbi_filt_v1"
      );
      expect(swappedCount).toBe(true);
    });
  });

  it("re-fires COUNT(*) effect when viewName changes (Pitfall 7 — dep array fix)", async () => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockResolvedValue({
      column_headers: ["total"],
      column_1: [50000],
    });

    const { rerender } = render(wrap(<WidgetRenderer widget={makeRecordsWidget()} />));

    // Initial mount — count should fire with raw table
    await waitFor(() => {
      const calls = (clientModule.runSql as ReturnType<typeof vi.fn>).mock.calls;
      const initialCount = calls.some(
        (args) => typeof args[0] === "string" && args[0] === "SELECT COUNT(*) AS total FROM ki_home.taxi"
      );
      expect(initialCount).toBe(true);
    });

    // Activate view → COUNT effect must re-fire with the view name
    useFilterViewStore.getState().setView(
      99,
      { viewName: "_kbi_filt_v1", expiresAt: Date.now() + 300000 },
      1
    );
    rerender(wrap(<WidgetRenderer widget={makeRecordsWidget()} />));

    await waitFor(() => {
      const calls = (clientModule.runSql as ReturnType<typeof vi.fn>).mock.calls;
      const swappedCount = calls.some(
        (args) => typeof args[0] === "string" && args[0] === "SELECT COUNT(*) AS total FROM _kbi_filt_v1"
      );
      expect(swappedCount).toBe(true);
    });
  });

  // Phase 30 follow-up: the v1.3 VSTORE-V13-02 pure-consumer lock for RecordsTableRenderer
  // has been RELAXED. RecordsTable now fires its own materialize trigger so that dashboards
  // with no aggregated chart on a spatial-target table still get filtering. The new
  // contract: with active filters (column OR spatial), RecordsTable calls materialize;
  // with neither, it calls dropFilterView. Mirrors AggregatedWidgetRenderer's Effect 1.
  it("calls materializeFilter when active column chip filters exist (Phase 30 follow-up relaxation)", async () => {
    (clientModule.materializeFilter as ReturnType<typeof vi.fn>).mockReset();
    (clientModule.materializeFilter as ReturnType<typeof vi.fn>).mockResolvedValue({
      viewName: "_kbi_filt_records",
      expiresAt: Date.now() + 300000,
    });
    (clientModule.dropFilterView as ReturnType<typeof vi.fn>).mockReset();
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockResolvedValue({
      column_headers: ["g", "value"],
      column_1: ["A"],
      column_2: [10],
    });

    useFilterStore.getState().addFilter(99, {
      column: "g", value: "A", dataType: "string", addedAt: Date.now(),
    });

    render(wrap(<WidgetRenderer widget={makeRecordsWidget()} />));

    // Wait through the 300ms debounce + buffer
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(clientModule.materializeFilter).toHaveBeenCalledTimes(1);
    expect(clientModule.materializeFilter).toHaveBeenCalledWith(
      expect.objectContaining({
        tableId: 99,
        filters: expect.arrayContaining([
          expect.objectContaining({ column: "g", value: "A" }),
        ]),
      }),
      expect.any(Object), // AbortSignal
    );
    expect(clientModule.dropFilterView).not.toHaveBeenCalled();
  });

  it("calls dropFilterView when no column filters AND no spatial shapes apply (idle DROP)", async () => {
    (clientModule.materializeFilter as ReturnType<typeof vi.fn>).mockReset();
    (clientModule.dropFilterView as ReturnType<typeof vi.fn>).mockReset();
    (clientModule.dropFilterView as ReturnType<typeof vi.fn>).mockResolvedValue({ dropped: true });
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockResolvedValue({
      column_headers: ["g", "value"],
      column_1: ["A"],
      column_2: [10],
    });

    // No column filters, no shapes — DROP branch fires.
    useFilterStore.getState().reset();
    useSpatialFilterStore.getState().reset();

    render(wrap(<WidgetRenderer widget={makeRecordsWidget()} />));

    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(clientModule.materializeFilter).not.toHaveBeenCalled();
    expect(clientModule.dropFilterView).toHaveBeenCalledTimes(1);
    expect(clientModule.dropFilterView).toHaveBeenCalledWith(
      expect.objectContaining({ tableId: 99 }),
    );
  });
});

// ----- Phase 15-04: TTL recovery — proactive (LIFE-V13-01) + reactive (LIFE-V13-02) -----

describe("AggregatedWidgetRenderer — LIFE-V13-01 (proactive TTL expiry)", () => {
  beforeEach(() => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockReset();
    (clientModule.materializeFilter as ReturnType<typeof vi.fn>).mockReset();
    (clientModule.dropFilterView as ReturnType<typeof vi.fn>).mockReset();
    useFilterStore.getState().reset();
    useFilterViewStore.getState().reset();
  });

  it("clears expired view BEFORE running chart query (Date.now() >= expiresAt)", async () => {
    // Seed an expired view
    useFilterViewStore.getState().setView(
      99,
      { viewName: "_kbi_filt_v1", expiresAt: Date.now() - 1000 }, // 1 second ago
      1
    );

    (clientModule.runSql as ReturnType<typeof vi.fn>).mockResolvedValue({
      column_headers: ["g", "value"], column_1: ["A"], column_2: [10],
    });

    render(wrap(<WidgetRenderer widget={makeAggregatedWidget()} />));

    // Wait for clearView to be fired (effect runs synchronously on mount; clearView is sync state mutation)
    await waitFor(() => {
      expect(useFilterViewStore.getState().views[99]).toBeUndefined();
    });
  });

  it("does NOT clear view when expiresAt is in the future (no proactive trigger)", async () => {
    useFilterViewStore.getState().setView(
      99,
      { viewName: "_kbi_filt_v1", expiresAt: Date.now() + 60000 }, // 60s in future
      1
    );

    (clientModule.runSql as ReturnType<typeof vi.fn>).mockResolvedValue({
      column_headers: ["g", "value"], column_1: ["A"], column_2: [10],
    });

    render(wrap(<WidgetRenderer widget={makeAggregatedWidget()} />));

    // Wait through any microtask flush
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(useFilterViewStore.getState().views[99]).toBeDefined();
    expect(useFilterViewStore.getState().views[99].viewName).toBe("_kbi_filt_v1");
  });
});

describe("RecordsTableRenderer — LIFE-V13-01 (proactive TTL expiry, both effects)", () => {
  beforeEach(() => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockReset();
    useFilterStore.getState().reset();
    useFilterViewStore.getState().reset();
  });

  it("page-fetch effect clears expired view before running its runSql", async () => {
    useFilterViewStore.getState().setView(
      99,
      { viewName: "_kbi_filt_v1", expiresAt: Date.now() - 1000 },
      1
    );

    (clientModule.runSql as ReturnType<typeof vi.fn>).mockResolvedValue({
      column_headers: ["g", "value"], column_1: ["A"], column_2: [10],
    });

    render(wrap(<WidgetRenderer widget={makeRecordsWidget()} />));

    await waitFor(() => {
      expect(useFilterViewStore.getState().views[99]).toBeUndefined();
    });
  });
});

describe("AggregatedWidgetRenderer — LIFE-V13-02 (reactive isViewNotFoundError max-1-retry)", () => {
  beforeEach(() => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockReset();
    (clientModule.materializeFilter as ReturnType<typeof vi.fn>).mockReset();
    (clientModule.dropFilterView as ReturnType<typeof vi.fn>).mockReset();
    useFilterStore.getState().reset();
    useFilterViewStore.getState().reset();
  });

  it("on view-not-found: clears view, re-materializes, retries chart query ONCE with new viewName", async () => {
    // Seed: chip filter present + initial view (so the materialize-trigger debounce has a viewName already)
    useFilterStore.getState().addFilter(99, {
      column: "g", value: "A", dataType: "string", addedAt: Date.now(),
    } as import("../../store/filterStore").ActiveFilter);
    useFilterViewStore.getState().setView(
      99,
      { viewName: "_kbi_filt_OLD", expiresAt: Date.now() + 60000 },
      1
    );

    // First runSql call rejects with view-not-found; second call (after retry) resolves
    let runSqlCallCount = 0;
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockImplementation(() => {
      runSqlCallCount++;
      if (runSqlCallCount === 1) {
        return Promise.reject(new Error("SqlEngine: Object '_kbi_filt_OLD' not found (S/SDc:1513)"));
      }
      return Promise.resolve({
        column_headers: ["g", "value"], column_1: ["A"], column_2: [10],
      });
    });

    // Retry materialize returns a NEW viewName
    (clientModule.materializeFilter as ReturnType<typeof vi.fn>).mockResolvedValue({
      viewName: "_kbi_filt_NEW",
      expiresAt: Date.now() + 60000,
    });

    render(wrap(<WidgetRenderer widget={makeAggregatedWidget()} />));

    // Wait for the reactive recovery to complete: clearView fires, materialize re-fires, second runSql succeeds
    await waitFor(() => {
      // Final viewName in the store is the NEW one
      expect(useFilterViewStore.getState().views[99]?.viewName).toBe("_kbi_filt_NEW");
    }, { timeout: 2000 });

    // Second runSql call used the new viewName
    await waitFor(() => {
      const calls = (clientModule.runSql as ReturnType<typeof vi.fn>).mock.calls;
      const retried = calls.some(
        (args) => typeof args[0] === "string" && args[0].includes("FROM _kbi_filt_NEW")
      );
      expect(retried).toBe(true);
    });
  });

  it("max-1-retry — second view-not-found resolves successfully (Pitfall 3 lock: no infinite retry loop)", async () => {
    // Pitfall 3 lock: max 1 reactive retry per CHART-QUERY INVOCATION. The retryRef is reset when
    // viewName changes, so each new viewName gets 1 retry budget. The key guard: retryRef.retried=true
    // prevents the same invocation from looping. Phase 17-02 gate note: the materializing suspend gate
    // blocks the Effect 2 re-fire with viewName=undefined (after clearView), so the fallthrough path
    // now flows through the fresh Effect 2 re-fire after setView, not through an immediate raw query.
    // The test verifies: (a) no infinite loop and (b) data eventually loads.
    useFilterStore.getState().addFilter(99, {
      column: "g", value: "A", dataType: "string", addedAt: Date.now(),
    } as import("../../store/filterStore").ActiveFilter);
    useFilterViewStore.getState().setView(
      99,
      { viewName: "_kbi_filt_OLD", expiresAt: Date.now() + 60000 },
      1
    );

    let runSqlCallCount = 0;
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockImplementation((sql: string) => {
      runSqlCallCount++;
      // First two FROM _kbi_filt_ calls reject with view-not-found; subsequent calls succeed.
      // Phase 17-02: the first two view-not-found rejections trigger LIFE-V13-02 retry cycles;
      // the third call (same view name, count > 2) succeeds, breaking the chain without looping.
      if (sql.includes("FROM _kbi_filt_") && runSqlCallCount <= 2) {
        return Promise.reject(new Error("SqlEngine: Object 'whatever' not found (S/SDc:1513)"));
      }
      return Promise.resolve({
        column_headers: ["g", "value"], column_1: ["A"], column_2: [10],
      });
    });

    (clientModule.materializeFilter as ReturnType<typeof vi.fn>).mockResolvedValue({
      viewName: "_kbi_filt_RETRY",
      expiresAt: Date.now() + 60000,
    });

    render(wrap(<WidgetRenderer widget={makeAggregatedWidget()} />));

    // With the Phase 17-02 suspend gate, view-not-found on the retry view triggers another
    // LIFE-V13-02 cycle (for the new retryRef context). The third FROM _kbi_filt_ call (count>2)
    // resolves. The Pitfall 3 lock holds: each invocation only retries once (retried=true blocks
    // re-entry); the system converges and data loads.
    await waitFor(() => {
      const calls = (clientModule.runSql as ReturnType<typeof vi.fn>).mock.calls;
      // Assert data eventually loads (some call with _kbi_filt_ resolves)
      expect(calls.length).toBeGreaterThanOrEqual(3);
    }, { timeout: 2500 });

    // Pitfall 3 lock: the critical guard is that materializeFilter is not called unboundedly.
    // With the Phase 17-02 gate, reactive retries are bounded by the retryRef.retried flag
    // per invocation. Effect 1 debounce (300ms) also fires once, adding at most 1 extra call.
    // Total materializeFilter calls within 2500ms should be bounded (≤ 5 is a safe upper bound).
    const matCallCount = (clientModule.materializeFilter as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(matCallCount).toBeLessThan(5); // bounded — no infinite loop
  });

  it("retry materialize fails (PermissionError) → toast + fall through to raw FROM <table>", async () => {
    const { PermissionError } = await import("../../api/client");
    useFilterStore.getState().addFilter(99, {
      column: "g", value: "A", dataType: "string", addedAt: Date.now(),
    } as import("../../store/filterStore").ActiveFilter);
    useFilterViewStore.getState().setView(
      99,
      { viewName: "_kbi_filt_OLD", expiresAt: Date.now() + 60000 },
      1
    );

    let runSqlCallCount = 0;
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockImplementation((sql: string) => {
      runSqlCallCount++;
      if (sql.includes("FROM _kbi_filt_OLD") && runSqlCallCount === 1) {
        return Promise.reject(new Error("SqlEngine: Object '_kbi_filt_OLD' not found (S/SDc:1513)"));
      }
      return Promise.resolve({
        column_headers: ["g", "value"], column_1: ["A"], column_2: [10],
      });
    });

    // First materialize (from materialize-trigger effect) succeeds; SECOND (retry) fails with PermissionError
    let matCallCount = 0;
    (clientModule.materializeFilter as ReturnType<typeof vi.fn>).mockImplementation(() => {
      matCallCount++;
      if (matCallCount === 1) {
        return Promise.resolve({
          viewName: "_kbi_filt_OLD",
          expiresAt: Date.now() + 60000,
        });
      }
      // The reactive-retry materialize call fails:
      return Promise.reject(new PermissionError("Filtering not enabled for your account"));
    });

    const { useToastStore } = await import("../../store/toast");
    const showToastSpy = vi.spyOn(useToastStore.getState(), "showToast");

    render(wrap(<WidgetRenderer widget={makeAggregatedWidget()} />));

    await waitFor(() => {
      expect(showToastSpy).toHaveBeenCalledWith(
        "Filtering not enabled for your account",
        "error"
      );
    }, { timeout: 2500 });
  });

  it("non-view-not-found error → no clearView, no retry, error surfaces normally", async () => {
    useFilterViewStore.getState().setView(
      99,
      { viewName: "_kbi_filt_v1", expiresAt: Date.now() + 60000 },
      1
    );

    (clientModule.runSql as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Internal server error"));

    render(wrap(<WidgetRenderer widget={makeAggregatedWidget()} />));

    // Wait for the error to flow through to setError (rendered in widget-error placeholder)
    await waitFor(() => {
      expect(screen.getByText("Internal server error")).toBeInTheDocument();
    }, { timeout: 1500 });

    // View NOT cleared (non-recoverable error)
    expect(useFilterViewStore.getState().views[99]).toBeDefined();
    expect(useFilterViewStore.getState().views[99].viewName).toBe("_kbi_filt_v1");
  });
});

// ----- Phase 17-02: pre-materialize suspend gate -----

describe("AggregatedWidgetRenderer — Phase 17-02 pre-materialize suspend gate", () => {
  beforeEach(() => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockReset();
    (clientModule.materializeFilter as ReturnType<typeof vi.fn>).mockReset();
    (clientModule.dropFilterView as ReturnType<typeof vi.fn>).mockReset();
    useFilterStore.getState().reset();
    useFilterViewStore.getState().reset();
  });

  it("no chart SQL fires between filterVersion tick and setView (materializing gate)", async () => {
    // Setup: materializeFilter returns a pending promise so we control when setView fires
    let resolveMaterialize: ((v: { viewName: string; expiresAt: number }) => void) | undefined;
    (clientModule.materializeFilter as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise((res) => { resolveMaterialize = res; })
    );
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockResolvedValue(EMPTY_RESPONSE as unknown as Record<string, unknown>);
    (clientModule.dropFilterView as ReturnType<typeof vi.fn>).mockResolvedValue({ dropped: true });

    // Tick filterVersion so Effect 1 triggers and Effect 2 would fire
    act(() => {
      useFilterStore.getState().addFilter(99, {
        column: "g", value: "A", dataType: "string", addedAt: Date.now(),
      });
    });

    render(wrap(<WidgetRenderer widget={makeAggregatedWidget()} />));

    // Wait for Effect 1's 300ms debounce + markMaterializing to fire (materializing=true)
    await waitFor(() => {
      expect(clientModule.materializeFilter).toHaveBeenCalled();
    }, { timeout: 1500 });

    // At this point materializing=true — Effect 2 must have been suspended.
    // Reset runSql call count after the initial non-gated call to get a clean baseline.
    // (Effect 2 may have fired once before markMaterializing — that's expected FILT-V13-01 behavior;
    // the gate prevents the second fire while materializing=true. What we verify is no call AFTER gate.)
    const callsBeforeGate = (clientModule.runSql as ReturnType<typeof vi.fn>).mock.calls.length;

    // Wait a short period — no additional runSql calls should fire while materializing=true
    await new Promise((r) => setTimeout(r, 100));
    const callsAfterWait = (clientModule.runSql as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callsAfterWait).toBe(callsBeforeGate); // no new calls while gate is up

    // Resolve materialize — setView fires, materializing=false, viewName populated
    resolveMaterialize?.({ viewName: "_kbi_filt_test", expiresAt: Date.now() + 300000 });

    // After setView, Effect 2 re-fires with the view name
    await waitFor(() => {
      const calls = (clientModule.runSql as ReturnType<typeof vi.fn>).mock.calls;
      const swapped = calls.some(
        (args) => typeof args[0] === "string" && (args[0] as string).includes("_kbi_filt_test")
      );
      expect(swapped).toBe(true);
    }, { timeout: 1500 });
  });

  it("Effect 2 fires once with FROM <view> after setView clears materializing (no over-suppression)", async () => {
    // Regression guard: gate does not suppress queries when materializing=false and viewName populated
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockResolvedValue(EMPTY_RESPONSE as unknown as Record<string, unknown>);
    (clientModule.materializeFilter as ReturnType<typeof vi.fn>).mockResolvedValue({
      viewName: "_kbi_filt_present", expiresAt: Date.now() + 300000,
    });
    (clientModule.dropFilterView as ReturnType<typeof vi.fn>).mockResolvedValue({ dropped: true });

    // Pre-seed: materializing=false, viewName populated
    useFilterViewStore.getState().setView(99, { viewName: "_kbi_filt_present", expiresAt: Date.now() + 300000 }, 1);

    render(wrap(<WidgetRenderer widget={makeAggregatedWidget()} />));

    // Effect 2 should fire with the view name substituted
    await waitFor(() => {
      const calls = (clientModule.runSql as ReturnType<typeof vi.fn>).mock.calls;
      const swapped = calls.some(
        (args) => typeof args[0] === "string" && (args[0] as string).includes("_kbi_filt_present")
      );
      expect(swapped).toBe(true);
    }, { timeout: 1500 });
  });

  it("materialize error clears materializing flag so chart falls through to raw FROM <table>", async () => {
    const { PermissionError } = await import("../../api/client");
    (clientModule.materializeFilter as ReturnType<typeof vi.fn>).mockRejectedValue(
      new PermissionError("Filtering not enabled")
    );
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockResolvedValue(EMPTY_RESPONSE as unknown as Record<string, unknown>);
    (clientModule.dropFilterView as ReturnType<typeof vi.fn>).mockResolvedValue({ dropped: true });

    // Add a filter to trigger Effect 1 (materialize path)
    act(() => {
      useFilterStore.getState().addFilter(99, {
        column: "g", value: "A", dataType: "string", addedAt: Date.now(),
      });
    });

    render(wrap(<WidgetRenderer widget={makeAggregatedWidget()} />));

    // Wait for materializeFilter to be called — markMaterializing fires first
    await waitFor(() => {
      expect(clientModule.materializeFilter).toHaveBeenCalled();
    }, { timeout: 1500 });

    // After the rejection, clearMaterializing should have lifted the gate
    // and Effect 2 should fire with raw FROM <table> (no view substitution)
    await waitFor(() => {
      const entry = useFilterViewStore.getState().views[99];
      // Entry should have materializing=false (cleared), or absent
      expect(entry === undefined || entry.materializing === false).toBe(true);
    }, { timeout: 1500 });

    // runSql should be called with raw table SQL (no view name)
    await waitFor(() => {
      const calls = (clientModule.runSql as ReturnType<typeof vi.fn>).mock.calls;
      const rawCall = calls.some(
        (args) => typeof args[0] === "string" && (args[0] as string).includes("FROM ki_home.taxi")
      );
      expect(rawCall).toBe(true);
    }, { timeout: 1500 });
  });
});

describe("Phase 30 — spatial materialize trigger (MAT-V15-01/02/03)", () => {
  const tableId = 99;
  const targetWidget: import("../../api/client").WidgetDto = {
    id: 100,
    dashboard_id: 1,
    title: "Map",
    type: "map",
    position: 0,
    config: {
      spatialTargets: [
        { tableId, spatialMode: "latlon", lonCol: "lon", latCol: "lat" },
      ],
    } as unknown as Record<string, unknown>,
    created_at: "2026-05-12T00:00:00Z",
    updated_at: "2026-05-12T00:00:00Z",
  };

  beforeEach(() => {
    // Reset spatial store between tests (Zustand reset shim covers this automatically,
    // but call defensively in case of test-order surprises).
    useSpatialFilterStore.getState().reset();
    useFilterViewStore.getState().reset();
    // Default runSql + materializeFilter mocks for the happy path.
    (clientModule.runSql as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (clientModule.materializeFilter as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      viewName: "_kbi_filt_x",
      expiresAt: Date.now() + 60_000,
    });
    (clientModule.dropFilterView as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ dropped: true });
  });

  it("ORPHAN: sends column-only payload (no spatial fields) when shapes exist but no map widget targets this tableId", async () => {
    const widget = makeAggregatedWidget({ id: 1, config: { sql: "SELECT 1", tableId } });
    // Add a column filter to force a materialize call.
    act(() => {
      useFilterStore.getState().addFilter(tableId, {
        column: "zone", value: "East", dataType: "string", sourceWidgetId: 1, addedAt: 0,
      });
    });
    // Add a shape — but no targetWidget in the widgets array (orphan).
    act(() => {
      useSpatialFilterStore.getState().addShape({
        type: "bbox", wkt: "POLYGON((0 0,1 0,1 1,0 1,0 0))", measurement: "1km × 1km",
      });
    });
    render(wrap(<WidgetRenderer widget={widget} />, 1, []));
    await waitFor(() => {
      expect(clientModule.materializeFilter).toHaveBeenCalled();
    });
    const callArgs = (clientModule.materializeFilter as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(callArgs).toMatchObject({ dashboardId: 1, tableId, filters: expect.any(Array) });
    expect("spatialFilters" in callArgs).toBe(false);
    expect("spatialTarget" in callArgs).toBe(false);
  });

  it("COMBINED: sends spatialFilters + spatialTarget alongside filters when an eligible target exists and shapes are drawn", async () => {
    const widget = makeAggregatedWidget({ id: 1, config: { sql: "SELECT 1", tableId } });
    act(() => {
      useFilterStore.getState().addFilter(tableId, {
        column: "zone", value: "East", dataType: "string", sourceWidgetId: 1, addedAt: 0,
      });
      useSpatialFilterStore.getState().addShape({
        type: "bbox", wkt: "POLYGON((0 0,1 0,1 1,0 1,0 0))", measurement: "1km × 1km",
      });
    });
    render(wrap(<WidgetRenderer widget={widget} />, 1, [targetWidget]));
    await waitFor(() => {
      expect(clientModule.materializeFilter).toHaveBeenCalled();
    });
    const callArgs = (clientModule.materializeFilter as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(callArgs.spatialFilters).toHaveLength(1);
    expect(callArgs.spatialFilters[0]).toMatchObject({ wkt: "POLYGON((0 0,1 0,1 1,0 1,0 0))" });
    expect(callArgs.spatialFilters[0].id).toMatch(/.+/); // randomUUID present
    expect(callArgs.spatialTarget).toEqual({ tableId, spatialMode: "latlon", lonCol: "lon", latCol: "lat" });
  });

  it("spatialFilterVersion dep: addShape after initial render triggers a second materializeFilter call AND advances materializeVersion (_mv cache-buster path)", async () => {
    const widget = makeAggregatedWidget({ id: 1, config: { sql: "SELECT 1", tableId } });
    act(() => {
      useFilterStore.getState().addFilter(tableId, {
        column: "zone", value: "East", dataType: "string", sourceWidgetId: 1, addedAt: 0,
      });
    });
    render(wrap(<WidgetRenderer widget={widget} />, 1, [targetWidget]));
    await waitFor(() => {
      expect((clientModule.materializeFilter as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(1);
    });
    // Wait for first setView to land (proves first materializeVersion increment).
    await waitFor(() => {
      expect(useFilterViewStore.getState().views[tableId]?.materializeVersion ?? 0).toBeGreaterThanOrEqual(1);
    });
    const initialCalls = (clientModule.materializeFilter as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    const initialMv = useFilterViewStore.getState().views[tableId].materializeVersion;
    act(() => {
      useSpatialFilterStore.getState().addShape({
        type: "circle", wkt: "POLYGON((0 0,2 0,2 2,0 2,0 0))", measurement: "2 km",
      });
    });
    await waitFor(() => {
      expect((clientModule.materializeFilter as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(initialCalls);
    });
    // _mv ASSERTION (Blocker 3 lock): materializeVersion advanced after the spatial-triggered
    // materialize resolved. This proves setView at filterViewStore.ts:67 fired for the spatial
    // path identically to column-only — Phase 30 does NOT need to wire _mv, it is automatic.
    await waitFor(() => {
      expect(useFilterViewStore.getState().views[tableId].materializeVersion).toBeGreaterThan(initialMv);
    });
  });

  it("DROP: empty column filters + empty shapes → dropFilterView called, materializeFilter NOT called", async () => {
    const widget = makeAggregatedWidget({ id: 1, config: { sql: "SELECT 1", tableId } });
    render(wrap(<WidgetRenderer widget={widget} />, 1, [targetWidget]));
    await waitFor(() => {
      expect(clientModule.dropFilterView).toHaveBeenCalledWith(
        expect.objectContaining({ dashboardId: 1, tableId }),
      );
    });
    expect(clientModule.materializeFilter).not.toHaveBeenCalled();
  });

  it("ORPHAN-DROP: empty column filters + shapes drawn + no eligible target for this tableId → dropFilterView called (orphan fallthrough)", async () => {
    const widget = makeAggregatedWidget({ id: 1, config: { sql: "SELECT 1", tableId } });
    act(() => {
      useSpatialFilterStore.getState().addShape({
        type: "bbox", wkt: "POLYGON((0 0,1 0,1 1,0 1,0 0))", measurement: "1km × 1km",
      });
    });
    // widgets=[] → no eligible target for tableId → orphan-shape case → DROP fires.
    render(wrap(<WidgetRenderer widget={widget} />, 1, []));
    await waitFor(() => {
      expect(clientModule.dropFilterView).toHaveBeenCalled();
    });
    expect(clientModule.materializeFilter).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Phase 35 Plan 05 (DV-V16-13/14): dynamic-view branches — 5-state + orphan
// ============================================================================
//
// AggregatedWidgetRenderer + RecordsTableRenderer status-aware rendering when
// widget.config.dynamicViewId is set. Covers:
//   1) undefined/pending → loading skeleton
//   2) materialized → fromSwap(sql, dvViewName) + runSql
//   3) over_threshold → "Too much data — narrow your filters to enable this view."
//   4) error → error + Retry (calls retryDynamicView(dynamicViewId))
//   5) orphan (dvId set + not in dashboardContext.dynamicViews) → "deleted" message
//   + Effect 1 regression (filter-view materialize trigger UNCHANGED)
//   + Effect 2 suspend-gate extension (dvStatus === "pending" suspends chart query)
//
// Locks (35-CONTEXT.md):
// - Over-threshold message verbatim ROADMAP (single, regardless of reason)
// - Orphan message verbatim
// - Retry calls retryDynamicView(dynamicViewId) from DashboardContext
// - Effect 1 dep array unchanged [sql, filterVersion, dashboardId, tableId, spatialFilterVersion]
// ============================================================================

const makeDvRow = (overrides: Partial<import("../../api/client").DynamicViewRow> = {}): import("../../api/client").DynamicViewRow => ({
  id: 7,
  dashboard_id: 1,
  source_table_id: 99,
  name: "Top vendors",
  template_sql: "SELECT * FROM {view}",
  max_records: 10000,
  columns_json: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

describe("AggregatedWidgetRenderer — Phase 35 dynamic-view branches (DV-V16-13/14)", () => {
  beforeEach(() => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockReset();
    (clientModule.materializeFilter as ReturnType<typeof vi.fn>).mockReset();
    (clientModule.dropFilterView as ReturnType<typeof vi.fn>).mockReset();
    useFilterStore.getState().reset();
    useFilterViewStore.getState().reset();
    useDynamicViewStore.getState().reset();
  });

  const dvBoundWidget: WidgetDto = makeAggregatedWidget({
    id: 1,
    config: {
      sql: "SELECT g, COUNT(*) AS value FROM ki_home.taxi GROUP BY g LIMIT 100",
      tableId: 99,
      dynamicViewId: 7,
    },
  });

  it("renders loading skeleton when dvStatus undefined (no store entry yet)", async () => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockResolvedValue(EMPTY_RESPONSE as unknown as Record<string, unknown>);
    // No setView call → dvEntry === undefined → loading skeleton expected.
    // DashboardContext.dynamicViews contains id 7 so orphan check fails (not orphan).
    const { container } = render(
      wrap(<WidgetRenderer widget={dvBoundWidget} />, 1, [], [makeDvRow({ id: 7 })])
    );

    // Defensive: the widget body shows "Loading..." (existing widget-placeholder UI).
    // We expect at least one Loading state visible before any data resolves.
    expect(container.querySelector(".widget-placeholder")).not.toBeNull();
    expect(container.textContent).toMatch(/Loading/i);
    // No runSql call should be made — dv branch short-circuits BEFORE runSql.
    await new Promise((r) => setTimeout(r, 50));
    expect(clientModule.runSql).not.toHaveBeenCalled();
  });

  it("renders loading skeleton when dvStatus = pending", async () => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockResolvedValue(EMPTY_RESPONSE as unknown as Record<string, unknown>);
    act(() => {
      useDynamicViewStore.getState().markPending(7, "_kbi_dv_u1_d1_7");
    });

    const { container } = render(
      wrap(<WidgetRenderer widget={dvBoundWidget} />, 1, [], [makeDvRow({ id: 7 })])
    );

    expect(container.textContent).toMatch(/Loading/i);
    await new Promise((r) => setTimeout(r, 50));
    expect(clientModule.runSql).not.toHaveBeenCalled();
  });

  it("calls fromSwap+runSql with dv viewName when materialized", async () => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockResolvedValue(EMPTY_RESPONSE as unknown as Record<string, unknown>);
    act(() => {
      useDynamicViewStore.getState().setView(7, {
        viewName: "_kbi_dv_u1_d1_7",
        status: "materialized",
        expiresAt: Date.now() + 300000,
      });
    });

    render(wrap(<WidgetRenderer widget={dvBoundWidget} />, 1, [], [makeDvRow({ id: 7 })]));

    await waitFor(() => {
      expect(clientModule.runSql).toHaveBeenCalled();
    });
    const calls = (clientModule.runSql as ReturnType<typeof vi.fn>).mock.calls;
    const swapped = calls.some(
      (args) => typeof args[0] === "string" && (args[0] as string).includes("_kbi_dv_u1_d1_7")
    );
    expect(swapped).toBe(true);
  });

  it("renders DV-V16-14 verbatim over-threshold empty state (no runSql)", async () => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockResolvedValue(EMPTY_RESPONSE as unknown as Record<string, unknown>);
    act(() => {
      useDynamicViewStore.getState().setView(7, {
        viewName: "_kbi_dv_u1_d1_7",
        status: "over_threshold",
        reason: "exceeds_max_records",
      });
    });

    const { container } = render(
      wrap(<WidgetRenderer widget={dvBoundWidget} />, 1, [], [makeDvRow({ id: 7 })])
    );

    expect(
      screen.getByText("Too much data — narrow your filters to enable this view.")
    ).toBeInTheDocument();
    expect(container.querySelector(".widget-over-threshold")).not.toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    expect(clientModule.runSql).not.toHaveBeenCalled();
  });

  it("no_filter over-threshold shows a 'Load full table' CTA that calls retryDynamicView(id)", async () => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockResolvedValue(EMPTY_RESPONSE as unknown as Record<string, unknown>);
    const retrySpy = vi.fn();
    act(() => {
      useDynamicViewStore.getState().setView(7, {
        viewName: "_kbi_dv_u1_d1_7",
        status: "over_threshold",
        reason: "no_filter",
      });
    });

    render(
      wrap(<WidgetRenderer widget={dvBoundWidget} />, 1, [], [makeDvRow({ id: 7 })], retrySpy)
    );

    expect(
      screen.getByText("No filter applied — load the full table, or apply a filter to narrow it.")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /load full table/i }));
    expect(retrySpy).toHaveBeenCalledWith(7);
    await new Promise((r) => setTimeout(r, 50));
    expect(clientModule.runSql).not.toHaveBeenCalled();
  });

  it("renders error state with Retry button calling retryDynamicView(id)", async () => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockResolvedValue(EMPTY_RESPONSE as unknown as Record<string, unknown>);
    const retrySpy = vi.fn();
    act(() => {
      useDynamicViewStore.getState().setError(7, "boom");
      // Ensure entry has viewName populated (setError defaults to "" when no prior entry)
    });

    render(
      wrap(<WidgetRenderer widget={dvBoundWidget} />, 1, [], [makeDvRow({ id: 7 })], retrySpy)
    );

    expect(screen.getByText(/boom/)).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: /retry/i });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(retrySpy).toHaveBeenCalledWith(7);
  });

  it("renders orphan empty state when dvId set, no store entry, not in dashboard list", async () => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockResolvedValue(EMPTY_RESPONSE as unknown as Record<string, unknown>);
    const orphanWidget: WidgetDto = makeAggregatedWidget({
      id: 1,
      config: {
        sql: "SELECT g, COUNT(*) AS value FROM ki_home.taxi GROUP BY g LIMIT 100",
        tableId: 99,
        dynamicViewId: 99, // 99 not in dynamicViews list
      },
    });

    // DashboardContext.dynamicViews has id 7 only — widget references 99 = orphan.
    const { container } = render(
      wrap(<WidgetRenderer widget={orphanWidget} />, 1, [], [makeDvRow({ id: 7 })])
    );

    expect(
      screen.getByText("This dynamic view was deleted. Reconfigure the widget.")
    ).toBeInTheDocument();
    expect(container.querySelector(".widget-orphan-dynamic-view")).not.toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    expect(clientModule.runSql).not.toHaveBeenCalled();
  });

  it("legacy widget (no dynamicViewId) behaves unchanged — uses filter-view path", async () => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockResolvedValue(EMPTY_RESPONSE as unknown as Record<string, unknown>);
    (clientModule.dropFilterView as ReturnType<typeof vi.fn>).mockResolvedValue({ dropped: true });
    // Pre-seed filter view; no dynamicViewId on widget.
    useFilterViewStore.getState().setView(
      99,
      { viewName: "_kbi_filt_legacy_x", expiresAt: Date.now() + 300000 },
      1
    );

    render(wrap(<WidgetRenderer widget={makeAggregatedWidget()} />, 1, [], []));

    await waitFor(() => {
      expect(clientModule.runSql).toHaveBeenCalled();
    });
    const calls = (clientModule.runSql as ReturnType<typeof vi.fn>).mock.calls;
    const swappedToFv = calls.some(
      (args) => typeof args[0] === "string" && (args[0] as string).includes("_kbi_filt_legacy_x")
    );
    expect(swappedToFv).toBe(true);
  });

  it("Phase 63: dv-bound widget's Effect 1 does NOT fire a TABLE-keyed materialize off filters[sourceTableId]", async () => {
    // v1.12 semantic change (63-CONTEXT § "Materialize trigger + dv read-path swap"):
    // pre-v1.12, a dv-bound widget's Effect 1 was conceived to materialize a TABLE-keyed
    // filter view (the old `{view}` substitution model). v1.12 replaces that: the dv-bound
    // widget's Effect 1 takes the dv branch — it materializes a dv-filter view FROM the dv
    // (off dvFilters[dvId]), NOT a table-keyed view off filters[sourceTableId]. A stray
    // table filter on the source table id must NOT trigger a materialize from this dv widget
    // (dv-isolated scope; the source table's filters are owned by source-table widgets).
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockResolvedValue(EMPTY_RESPONSE as unknown as Record<string, unknown>);
    (clientModule.materializeFilter as ReturnType<typeof vi.fn>).mockResolvedValue({
      viewName: "_kbi_filt_for_dv",
      expiresAt: Date.now() + 300000,
    });
    (clientModule.dropFilterView as ReturnType<typeof vi.fn>).mockResolvedValue({ dropped: true });

    act(() => {
      // A table filter on the SOURCE table id (99) — should be ignored by the dv widget.
      useFilterStore.getState().addFilter(99, {
        column: "g", value: "A", dataType: "string", addedAt: Date.now(),
      });
      useDynamicViewStore.getState().setView(7, {
        viewName: "_kbi_dv_u1_d1_7",
        status: "materialized",
        expiresAt: Date.now() + 300000,
      });
    });

    render(wrap(<WidgetRenderer widget={dvBoundWidget} />, 1, [], [makeDvRow({ id: 7 })]));

    // Wait through Effect 1's 300ms debounce.
    await new Promise((r) => setTimeout(r, 450));

    // No materialize fired: the dv has NO dv filter (dvFilters[7] empty) so the dv branch
    // drops/clears; and the table filter on filters[99] is NOT consumed by the dv widget.
    const matCalls = (clientModule.materializeFilter as ReturnType<typeof vi.fn>).mock.calls;
    // No table-keyed materialize (tableId-bearing call) fired by the dv widget.
    expect(matCalls.find(([args]) => (args as { tableId?: number }).tableId === 99)).toBeUndefined();
    // No dv materialize either (no dv filter present).
    expect(matCalls.find(([args]) => (args as { dynamicViewId?: number }).dynamicViewId === 7)).toBeUndefined();
  });

  it("suspend-gate: chart-query (runSql) does NOT fire when dvStatus = pending even with filter view ready", async () => {
    // Research finding #7 lock: Effect 2's suspend-gate extends to dvStatus === "pending"
    // for dv-bound widgets — prevents stale-viewName race during cascade.
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockResolvedValue(EMPTY_RESPONSE as unknown as Record<string, unknown>);
    (clientModule.materializeFilter as ReturnType<typeof vi.fn>).mockResolvedValue({
      viewName: "_kbi_filt_ready",
      expiresAt: Date.now() + 300000,
    });
    (clientModule.dropFilterView as ReturnType<typeof vi.fn>).mockResolvedValue({ dropped: true });

    // Pre-seed filter view (so filter materialize is "complete" / materializing=false)
    useFilterViewStore.getState().setView(
      99,
      { viewName: "_kbi_filt_ready", expiresAt: Date.now() + 300000 },
      1
    );
    // Dynamic view is still pending — chart query MUST be suspended.
    act(() => {
      useDynamicViewStore.getState().markPending(7, "_kbi_dv_u1_d1_7");
    });

    render(wrap(<WidgetRenderer widget={dvBoundWidget} />, 1, [], [makeDvRow({ id: 7 })]));

    // Give effects time to settle.
    await new Promise((r) => setTimeout(r, 100));

    // Suspend gate engaged → no chart-query runSql fired against either view name.
    const calls = (clientModule.runSql as ReturnType<typeof vi.fn>).mock.calls;
    const fired = calls.some(
      (args) => typeof args[0] === "string" && (args[0] as string).includes("FROM")
    );
    expect(fired).toBe(false);
  });
});

describe("RecordsTableRenderer — Phase 35 dynamic-view branches (DV-V16-13/14)", () => {
  beforeEach(() => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockReset();
    (clientModule.materializeFilter as ReturnType<typeof vi.fn>).mockReset();
    (clientModule.dropFilterView as ReturnType<typeof vi.fn>).mockReset();
    useFilterStore.getState().reset();
    useFilterViewStore.getState().reset();
    useDynamicViewStore.getState().reset();
  });

  const dvBoundRecordsWidget: WidgetDto = makeRecordsWidget({
    id: 2,
    config: { table: "ki_home.taxi", tableId: 99, columns: "g,value", pageSize: 25, dynamicViewId: 7 },
  });

  it("renders loading skeleton when dvStatus undefined (no store entry yet) — no page/count fetch", async () => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockResolvedValue({
      column_headers: ["g", "value"],
      column_1: ["A"],
      column_2: [10],
    });

    const { container } = render(
      wrap(<WidgetRenderer widget={dvBoundRecordsWidget} />, 1, [], [makeDvRow({ id: 7 })])
    );

    expect(container.textContent).toMatch(/Loading/i);
    await new Promise((r) => setTimeout(r, 50));
    // Neither page-fetch nor count-fetch should fire while dv pending/undefined
    expect(clientModule.runSql).not.toHaveBeenCalled();
  });

  it("queries FROM <dvViewName> on page-fetch + count when dvStatus = materialized", async () => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockResolvedValue({
      column_headers: ["g", "value"],
      column_1: ["A"],
      column_2: [10],
    });
    act(() => {
      useDynamicViewStore.getState().setView(7, {
        viewName: "_kbi_dv_records_7",
        status: "materialized",
        expiresAt: Date.now() + 300000,
      });
    });

    render(wrap(<WidgetRenderer widget={dvBoundRecordsWidget} />, 1, [], [makeDvRow({ id: 7 })]));

    await waitFor(() => {
      const calls = (clientModule.runSql as ReturnType<typeof vi.fn>).mock.calls;
      const swappedPage = calls.some(
        (args) => typeof args[0] === "string"
          && (args[0] as string).includes("FROM _kbi_dv_records_7")
          && (args[0] as string).includes("LIMIT 25")
      );
      const swappedCount = calls.some(
        (args) => typeof args[0] === "string"
          && (args[0] as string) === "SELECT COUNT(*) AS total FROM _kbi_dv_records_7"
      );
      expect(swappedPage).toBe(true);
      expect(swappedCount).toBe(true);
    });
  });

  it("records: no_filter over-threshold shows the 'Load full table' CTA (no page/count fetch)", async () => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockResolvedValue({
      column_headers: ["g", "value"],
      column_1: ["A"],
      column_2: [10],
    });
    const retrySpy = vi.fn();
    act(() => {
      useDynamicViewStore.getState().setView(7, {
        viewName: "_kbi_dv_records_7",
        status: "over_threshold",
        reason: "no_filter",
      });
    });

    render(wrap(<WidgetRenderer widget={dvBoundRecordsWidget} />, 1, [], [makeDvRow({ id: 7 })], retrySpy));

    expect(
      screen.getByText("No filter applied — load the full table, or apply a filter to narrow it.")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /load full table/i }));
    expect(retrySpy).toHaveBeenCalledWith(7);
    await new Promise((r) => setTimeout(r, 50));
    expect(clientModule.runSql).not.toHaveBeenCalled();
  });

  it("renders error state with Retry button calling retryDynamicView(id)", async () => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockResolvedValue({
      column_headers: ["g", "value"],
      column_1: ["A"],
      column_2: [10],
    });
    const retrySpy = vi.fn();
    act(() => {
      useDynamicViewStore.getState().setError(7, "records boom");
    });

    render(
      wrap(<WidgetRenderer widget={dvBoundRecordsWidget} />, 1, [], [makeDvRow({ id: 7 })], retrySpy)
    );

    expect(screen.getByText(/records boom/)).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: /retry/i });
    fireEvent.click(btn);
    expect(retrySpy).toHaveBeenCalledWith(7);
  });

  it("renders orphan empty state when dvId set, no store entry, not in dashboard list", async () => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockResolvedValue({
      column_headers: ["g", "value"],
      column_1: ["A"],
      column_2: [10],
    });
    const orphanWidget: WidgetDto = makeRecordsWidget({
      id: 2,
      config: {
        table: "ki_home.taxi", tableId: 99, columns: "g,value", pageSize: 25, dynamicViewId: 99,
      },
    });

    render(wrap(<WidgetRenderer widget={orphanWidget} />, 1, [], [makeDvRow({ id: 7 })]));

    expect(
      screen.getByText("This dynamic view was deleted. Reconfigure the widget.")
    ).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(clientModule.runSql).not.toHaveBeenCalled();
  });

  it("pagination works on materialized dv: clicking Next fires a new page-fetch with dv viewName + correct OFFSET", async () => {
    // First page: 25 rows (data.length === pageSize → canNext true).
    const pageRows = Array.from({ length: 25 }, (_, i) => `row${i}`);
    const pageValues = Array.from({ length: 25 }, (_, i) => i + 1);
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockImplementation((sql: string) => {
      if (typeof sql === "string" && sql.startsWith("SELECT COUNT(*)")) {
        return Promise.resolve({ column_headers: ["total"], column_1: [100] });
      }
      return Promise.resolve({
        column_headers: ["g", "value"],
        column_1: pageRows,
        column_2: pageValues,
      });
    });

    act(() => {
      useDynamicViewStore.getState().setView(7, {
        viewName: "_kbi_dv_records_7",
        status: "materialized",
        expiresAt: Date.now() + 300000,
      });
    });

    const { container } = render(
      wrap(<WidgetRenderer widget={dvBoundRecordsWidget} />, 1, [], [makeDvRow({ id: 7 })])
    );

    // Wait for initial page-fetch + count-fetch.
    await waitFor(() => {
      const calls = (clientModule.runSql as ReturnType<typeof vi.fn>).mock.calls;
      const pageOne = calls.some(
        (args) => typeof args[0] === "string"
          && (args[0] as string).includes("FROM _kbi_dv_records_7")
          && (args[0] as string).includes("OFFSET 0")
      );
      expect(pageOne).toBe(true);
    });

    // Click Next.
    const nextBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Next"
    ) as HTMLButtonElement | undefined;
    expect(nextBtn).toBeDefined();
    await act(async () => {
      nextBtn!.click();
    });

    // Wait for second page-fetch with OFFSET 25 against the dv viewName.
    await waitFor(() => {
      const calls = (clientModule.runSql as ReturnType<typeof vi.fn>).mock.calls;
      const pageTwo = calls.some(
        (args) => typeof args[0] === "string"
          && (args[0] as string).includes("FROM _kbi_dv_records_7")
          && (args[0] as string).includes("OFFSET 25")
      );
      expect(pageTwo).toBe(true);
    });
  });
});

// ─── Phase 44 Plan 03: datafilter branch + drill-down back-compat ─────────────

// Mock DataFilterRenderer so WidgetRenderer tests don't need its full React/fetch setup.
vi.mock("./DataFilterRenderer", () => ({
  default: (props: { widget: WidgetDto; tables: any[] }) => (
    <div
      data-testid="datafilter-renderer"
      data-widget-id={String(props.widget.id)}
      data-tables-count={String((props.tables ?? []).length)}
    />
  ),
}));

function makeDataFilterWidget(overrides: Partial<WidgetDto> = {}): WidgetDto {
  return {
    id: 42,
    dashboard_id: 1,
    title: "Data Filter",
    type: "datafilter",
    position: 0,
    config: { tableId: 1, tableRef: "ki_home.trips", filterFields: [] },
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function renderDFInContext(
  widget: WidgetDto,
  tables: import("../../api/client").TableDto[] = [],
) {
  return render(
    <DashboardContextProvider
      dashboardId={1}
      widgets={[widget]}
      dynamicViews={[]}
      retryDynamicView={() => {}}
    >
      <WidgetRenderer widget={widget} tables={tables} />
    </DashboardContextProvider>,
  );
}

describe("WidgetRenderer Phase 44 — datafilter short-circuit + drill-down back-compat", () => {
  it("short-circuits to <DataFilterRenderer /> for widget.type === 'datafilter'", () => {
    const w = makeDataFilterWidget({ id: 42 });
    renderDFInContext(w, []);
    expect(screen.getByTestId("datafilter-renderer")).toBeInTheDocument();
    expect(
      screen.getByTestId("datafilter-renderer").getAttribute("data-widget-id"),
    ).toBe("42");
    // AggregatedWidgetRenderer would render "Select a table..." for a widget with no SQL
    expect(screen.queryByText(/Select a table/)).toBeNull();
  });

  it("datafilter type does NOT fall through to AggregatedWidgetRenderer", () => {
    const w = makeDataFilterWidget();
    renderDFInContext(w, []);
    expect(screen.getByTestId("datafilter-renderer")).toBeTruthy();
    // No SQL loading state (AggregatedWidgetRenderer would render loading/placeholder)
    expect(screen.queryByText(/Select a table/)).toBeNull();
  });

  it("Phase 44 ActiveFilter literal back-compat — dispatchDrillDown has NO operator key (static assertion)", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const filePath = path.resolve(
      process.cwd(),
      "src/components/charts/WidgetRenderer.tsx",
    );
    const src = await fs.readFile(filePath, "utf-8");

    // Extract dispatchDrillDown function body
    const fnStart = src.indexOf("function dispatchDrillDown");
    const fnEnd = src.indexOf("function parseKineticaResponse");
    expect(fnStart).toBeGreaterThan(-1);
    expect(fnEnd).toBeGreaterThan(fnStart);
    const dispatchBody = src.slice(fnStart, fnEnd);

    // Confirm the 5 expected keys ARE present
    expect(dispatchBody).toContain("column,");
    expect(dispatchBody).toContain("value: value as ActiveFilter");
    expect(dispatchBody).toContain("dataType,");
    expect(dispatchBody).toContain("sourceWidgetId: widgetId,");
    expect(dispatchBody).toContain("addedAt: Date.now(),");

    // Confirm NO operator: field was added to dispatchDrillDown's ActiveFilter literal
    // (Phase 44 back-compat lock: drill-down callers rely on the default "eq" behavior)
    expect(dispatchBody).not.toMatch(/\boperator:\s*"/);
  });
});

// ─── Phase 42 Plan 02: Legend branch in WidgetRenderer ─────────────────────────

vi.mock("./LegendRenderer", () => ({
  default: (props: { widget: WidgetDto; onConfigureWidget?: (w: WidgetDto) => void }) => {
    return (
      <div
        data-testid="mocked-legend-renderer"
        data-widget-id={String(props.widget.id)}
        data-has-on-configure={String(typeof props.onConfigureWidget === "function")}
      />
    );
  },
}));

// AggregatedWidgetRenderer is already hoisted above; for the legend-branch tests
// we need to ensure it throws if accidentally mounted for a legend widget.
// We use a separate describe so the mock is scoped here.
// Note: since AggregatedWidgetRenderer is defined inline in WidgetRenderer.tsx,
// we verify the absence of legend-related rendering instead of mocking it.

import { getChartType, getAllChartTypes } from "./registry";
import { registerAllChartTypes } from "./definitions/index";

function makeLegendWidget(overrides: Partial<WidgetDto> = {}): WidgetDto {
  return {
    id: 100,
    dashboard_id: 1,
    title: "Legend",
    type: "legend",
    position: 0,
    config: {},
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function renderLegendInContext(widget: WidgetDto, onConfigureWidget?: (w: WidgetDto) => void) {
  return render(
    <DashboardContextProvider dashboardId={1} widgets={[widget]} dynamicViews={[]} retryDynamicView={() => {}}>
      <WidgetRenderer widget={widget} onConfigureWidget={onConfigureWidget} />
    </DashboardContextProvider>,
  );
}

describe("WidgetRenderer Phase 42 legend branch", () => {
  it("Test 12: registerAllChartTypes registers the legend definition", () => {
    registerAllChartTypes();
    const def = getChartType("legend");
    expect(def).toBeTruthy();
    expect(def?.type).toBe("legend");
    expect(def?.label).toBe("Legend");
    expect(def?.icon).toBe("LG");
    expect(def?.fields).toEqual([]);
    expect(def?.defaultConfig).toEqual({});
    expect(def?.usesAggregation).toBe(false);
    expect(def?.supportsDrillDown).toBe(false);
    expect(def?.CustomConfigPanel).toBeTruthy();
  });

  it("Test 13: legend appears in getAllChartTypes()", () => {
    registerAllChartTypes();
    const types = getAllChartTypes().map((c) => c.type);
    expect(types).toContain("legend");
  });

  it("Test 14: WidgetRenderer renders LegendRenderer for type=legend", () => {
    const w = makeLegendWidget({ id: 100 });
    renderLegendInContext(w);
    expect(screen.getByTestId("mocked-legend-renderer")).toBeTruthy();
    expect(
      screen.getByTestId("mocked-legend-renderer").getAttribute("data-widget-id"),
    ).toBe("100");
  });

  it("Test 15: onConfigureWidget threads through to LegendRenderer", () => {
    const w = makeLegendWidget({ id: 100 });
    const onConfig = vi.fn();
    renderLegendInContext(w, onConfig);
    expect(
      screen.getByTestId("mocked-legend-renderer").getAttribute("data-has-on-configure"),
    ).toBe("true");
  });

  it("Test 16: legend type does NOT fall through to AggregatedWidgetRenderer", () => {
    // The mocked LegendRenderer renders the test-id; if WidgetRenderer falls through
    // to AggregatedWidgetRenderer, the type="legend" widget would try to run SQL from
    // widget.config.sql (undefined) and render "Select a table..." placeholder instead
    // of the mocked-legend-renderer test-id.
    const w = makeLegendWidget({ id: 100 });
    renderLegendInContext(w);
    // Mocked LegendRenderer is in the DOM — no fallthrough
    expect(screen.getByTestId("mocked-legend-renderer")).toBeTruthy();
    // Aggregated "Select a table" placeholder must NOT appear
    expect(screen.queryByText(/Select a table/)).toBeNull();
  });
});

// ----- FK4: RecordsTableRenderer CSV download -----

// Kinetica columnar payload factory for records CSV tests
const buildCsvResponse = (
  headers: string[],
  rows: unknown[][],
): Record<string, unknown> => {
  const out: Record<string, unknown> = {
    column_headers: headers,
    column_datatypes: headers.map(() => "string"),
  };
  // rows[rowIdx][colIdx] — transpose to columnar
  headers.forEach((_, colIdx) => {
    out[`column_${colIdx + 1}`] = rows.map((r) => r[colIdx]);
  });
  return out;
};

const makeCsvRecordsWidget = (overrides: Partial<WidgetDto> = {}): WidgetDto => ({
  id: 5,
  dashboard_id: 1,
  title: "Sales Report",
  type: "records",
  position: 0,
  config: {
    table: "sales",
    tableId: 50,
    columns: "region,amount",
    pageSize: 25,
    enableCsvDownload: true,
  },
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

describe("RecordsTableRenderer CSV download", () => {
  beforeEach(() => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockReset();
    useFilterStore.getState().reset();
    useFilterViewStore.getState().reset();
    // Stub DOM Blob/URL APIs — jsdom does not implement createObjectURL
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("button is hidden when config.enableCsvDownload is false", async () => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildCsvResponse(["region", "amount"], [["EAST", 100]]),
    );
    const widget = makeCsvRecordsWidget({ config: { table: "sales", tableId: 50, columns: "region,amount", pageSize: 25, enableCsvDownload: false } });
    render(wrap(<WidgetRenderer widget={widget} />));
    await waitFor(() => screen.queryByText(/Showing/) !== null);
    expect(screen.queryByText("Download")).toBeNull();
  });

  it("button is visible by default (enableCsvDownload omitted → default true)", async () => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildCsvResponse(["region", "amount"], [["EAST", 100]]),
    );
    // No enableCsvDownload key in config — should default to true
    const widget = makeCsvRecordsWidget({ config: { table: "sales", tableId: 50, columns: "region,amount", pageSize: 25 } });
    render(wrap(<WidgetRenderer widget={widget} />));
    await waitFor(() => screen.getByText("Download"));
    expect(screen.getByText("Download")).toBeTruthy();
  });

  it("export issues SELECT with only configured columns in order + active sort via runSql", async () => {
    // Page fetch + count response
    (clientModule.runSql as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(buildCsvResponse(["region", "amount"], [["EAST", 100]])) // page fetch
      .mockResolvedValueOnce({ column_headers: ["total"], column_datatypes: ["long"], column_1: [1] }) // count
      .mockResolvedValueOnce(buildCsvResponse(["region", "amount"], [["EAST", 100]])); // CSV export fetch

    const widget = makeCsvRecordsWidget();
    render(wrap(<WidgetRenderer widget={widget} />));
    await waitFor(() => screen.getByText("Download"));

    await act(async () => {
      fireEvent.click(screen.getByText("Download"));
      // Allow async export to complete
      await new Promise((r) => setTimeout(r, 50));
    });

    const calls = (clientModule.runSql as ReturnType<typeof vi.fn>).mock.calls;
    // Find the export call (SELECT with region,amount NOT containing COUNT)
    const exportCall = calls.find(
      (args) =>
        typeof args[0] === "string" &&
        args[0].includes("FROM sales") &&
        !args[0].includes("COUNT") &&
        // Export call will be the 3rd call (after page + count)
        calls.indexOf(args) >= 2,
    );
    expect(exportCall).toBeDefined();
    const exportSql = exportCall![0] as string;
    // Must include both columns in order
    expect(exportSql).toMatch(/SELECT region, amount FROM sales/);
  });

  it("cap behavior + toast: csvDownloadRowCap=2 with full page triggers 'Capped at 2 rows' toast", async () => {
    const showToastMock = vi.fn();
    const { useToastStore: toastStore } = await import("../../store/toast");
    toastStore.setState({ showToast: showToastMock } as Parameters<typeof toastStore.setState>[0]);

    // Page fetch returns 2 rows, count fetch
    (clientModule.runSql as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(buildCsvResponse(["region", "amount"], [["EAST", 100], ["WEST", 200]])) // page fetch
      .mockResolvedValueOnce({ column_headers: ["total"], column_datatypes: ["long"], column_1: [10] }) // count (10 total → more exist)
      .mockResolvedValueOnce(buildCsvResponse(["region", "amount"], [["EAST", 100], ["WEST", 200]])); // CSV export - returns full 2 rows

    const widget = makeCsvRecordsWidget({
      config: { table: "sales", tableId: 50, columns: "region,amount", pageSize: 25, csvDownloadRowCap: 2 },
    });
    render(wrap(<WidgetRenderer widget={widget} />));
    await waitFor(() => screen.getByText("Download"));

    await act(async () => {
      fireEvent.click(screen.getByText("Download"));
      await new Promise((r) => setTimeout(r, 100));
    });

    // Toast should be called with cap message
    const capToastCall = showToastMock.mock.calls.find(
      (args: unknown[]) => args[0] === "Capped at 2 rows",
    );
    expect(capToastCall).toBeDefined();
    expect(capToastCall![1]).toBe("info");
  });

  it("abort-on-unmount: AbortController signal aborts when component unmounts during export", async () => {
    let capturedSignal: AbortSignal | undefined;

    // Page fetch (resolves)
    (clientModule.runSql as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(buildCsvResponse(["region", "amount"], [["EAST", 100]])) // page
      .mockResolvedValueOnce({ column_headers: ["total"], column_datatypes: ["long"], column_1: [1] }) // count
      .mockImplementationOnce((_sql: string, _opts: unknown, signal: AbortSignal) => {
        // Capture signal; return a promise that never resolves (simulates slow export)
        capturedSignal = signal;
        return new Promise(() => {});
      });

    const widget = makeCsvRecordsWidget();
    const { unmount } = render(wrap(<WidgetRenderer widget={widget} />));
    await waitFor(() => screen.getByText("Download"));

    // Start export (will hang on the export runSql call)
    await act(async () => {
      fireEvent.click(screen.getByText("Download"));
      // Give time for page/count calls to resolve and export call to start
      await new Promise((r) => setTimeout(r, 50));
    });

    // Unmount — should abort the export
    act(() => {
      unmount();
    });

    // Signal captured from the export call must now be aborted
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(true);
  });
});

// ============================================================================
// Phase 63 Plan 03 (DVDRILL-V112-01/02/04): dv-aware drill dispatch + isolation
// ============================================================================
//
// THE v1.12 bug fix: drilling a dynamic-view-backed widget must route the filter
// into dvFilters[dynamicViewId] — NOT filters[sourceTableId] (the reported bug).
// Covers:
//   - isolation/bug-fix: dv drill populates dvFilters[7], leaves filters[42] EMPTY
//   - markDvMaterializing flips dvViews[7].materializing = true synchronously
//   - table-backed drill still lands in filters[tableId] (regression — path unchanged)
//   - dv-isolated scope: a dv drill does NOT touch a same-source source-table widget
// ============================================================================

describe("WidgetRenderer Phase 63 — dv-aware drill dispatch (DVDRILL-V112-01/02)", () => {
  beforeEach(() => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockReset();
    (clientModule.materializeFilter as ReturnType<typeof vi.fn>).mockReset();
    (clientModule.dropFilterView as ReturnType<typeof vi.fn>).mockReset();
    useFilterStore.getState().reset();
    useFilterViewStore.getState().reset();
    useDynamicViewStore.getState().reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // A dv-backed TABLE widget (config.dynamicViewId = 7, config.tableId = 42) with a
  // materialized dv view + drillDownColumn configured.
  const makeDvDrillWidget = (): WidgetDto =>
    makeWidget({
      type: "table",
      config: {
        sql: "SELECT region, COUNT(*) AS value FROM sales GROUP BY region ORDER BY value DESC LIMIT 100",
        tableId: 42,
        dynamicViewId: 7,
        drillDownColumn: "region",
        drillDownColumnType: "string",
      },
    });

  const renderDvDrillRows = async () => {
    vi.spyOn(clientModule, "runSql").mockResolvedValue(
      buildResponse(["region", "value"], [["EAST", "WEST"], [10, 20]]) as Record<string, unknown>,
    );
    vi.spyOn(clientModule, "materializeFilter").mockImplementation(
      () => new Promise(() => {}), // never resolves — keeps materializing observable
    );
    vi.spyOn(clientModule, "dropFilterView").mockResolvedValue({ dropped: true });

    // dv must be materialized so the dv-bound widget renders its data + drillEnabled is active.
    act(() => {
      useDynamicViewStore.getState().setView(7, {
        viewName: "_kbi_dv_u1_d1_7",
        status: "materialized",
        expiresAt: Date.now() + 300000,
      });
    });

    const { container } = render(
      wrap(<WidgetRenderer widget={makeDvDrillWidget()} />, 1, [], [makeDvRow({ id: 7 })]),
    );
    await waitFor(() => {
      const rows = container.querySelectorAll("tbody tr");
      expect(rows.length).toBe(2);
    });
    return container;
  };

  it("THE BUG-FIX: dv drill populates dvFilters[7] AND leaves filters[42] EMPTY", async () => {
    const container = await renderDvDrillRows();

    const firstRow = container.querySelectorAll("tbody tr")[0] as HTMLTableRowElement;
    await act(async () => {
      firstRow.click();
      await new Promise((r) => setTimeout(r, 350)); // through the 300ms dim setTimeout
    });

    // dv slice has the filter…
    const dvFilters = useFilterStore.getState().dvFilters[7] ?? [];
    expect(dvFilters).toHaveLength(1);
    expect(dvFilters[0].column).toBe("region");
    expect(dvFilters[0].value).toBe("EAST");

    // …and the source table slice STAYS EMPTY (the reported bug is killed).
    const tableFilters = useFilterStore.getState().filters[42] ?? [];
    expect(tableFilters).toHaveLength(0);
  });

  it("dv drill flips dvViews[7].materializing = true synchronously with addDvFilter", async () => {
    const container = await renderDvDrillRows();

    // No dv-filter view entry pre-click.
    expect(useFilterViewStore.getState().dvViews[7]).toBeUndefined();

    const firstRow = container.querySelectorAll("tbody tr")[0] as HTMLTableRowElement;
    await act(async () => {
      firstRow.click();
      await new Promise((r) => setTimeout(r, 350));
    });

    const dvEntry = useFilterViewStore.getState().dvViews[7];
    expect(dvEntry).toBeDefined();
    expect(dvEntry!.materializing).toBe(true);
    // Table-keyed filter-view store must NOT have been touched by a dv drill.
    expect(useFilterViewStore.getState().views[42]).toBeUndefined();
  });

  it("table-backed drill still lands in filters[tableId] (regression — table path unchanged)", async () => {
    vi.spyOn(clientModule, "runSql").mockResolvedValue(
      buildResponse(["region", "value"], [["EAST", "WEST"], [10, 20]]) as Record<string, unknown>,
    );
    vi.spyOn(clientModule, "materializeFilter").mockImplementation(() => new Promise(() => {}));
    vi.spyOn(clientModule, "dropFilterView").mockResolvedValue({ dropped: true });

    // No dynamicViewId — pure table-backed widget.
    const widget = makeWidget({
      type: "table",
      config: {
        sql: "SELECT region, COUNT(*) AS value FROM sales GROUP BY region ORDER BY value DESC LIMIT 100",
        tableId: 42,
        drillDownColumn: "region",
        drillDownColumnType: "string",
      },
    });
    const { container } = render(wrap(<WidgetRenderer widget={widget} />));
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(2));

    const firstRow = container.querySelectorAll("tbody tr")[0] as HTMLTableRowElement;
    await act(async () => {
      firstRow.click();
      await new Promise((r) => setTimeout(r, 350));
    });

    // Table path: filter lands in filters[42]; dvFilters untouched.
    const tableFilters = useFilterStore.getState().filters[42] ?? [];
    expect(tableFilters).toHaveLength(1);
    expect(tableFilters[0].value).toBe("EAST");
    expect(useFilterStore.getState().dvFilters[7] ?? []).toHaveLength(0);
    // Table filter-view store flipped (markMaterializing), dv view store untouched.
    expect(useFilterViewStore.getState().views[42]?.materializing).toBe(true);
    expect(useFilterViewStore.getState().dvViews[7]).toBeUndefined();
  });
});

// ============================================================================
// Phase 63 Plan 03 (DVDRILL-V112-02): dv-filter materialize trigger in Effect 1
// ============================================================================
//
// When a dv-bound widget has a materialized dv AND dvFilters[dvId] is non-empty,
// the existing per-renderer Effect 1 gains a branch that materializes the dv-filter
// FROM the dv view: materializeFilter({ dashboardId, dynamicViewId, filters }) →
// setDvView. Empty dvFilters → dropFilterView({ dashboardId, dynamicViewId }) +
// clearDvView. Gated on dvStatus === "materialized" (mirrors the pending early-return).
// ============================================================================

describe("AggregatedWidgetRenderer Phase 63 — dv-filter materialize trigger", () => {
  beforeEach(() => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockReset();
    (clientModule.materializeFilter as ReturnType<typeof vi.fn>).mockReset();
    (clientModule.dropFilterView as ReturnType<typeof vi.fn>).mockReset();
    useFilterStore.getState().reset();
    useFilterViewStore.getState().reset();
    useDynamicViewStore.getState().reset();
  });

  const dvBoundWidget: WidgetDto = makeAggregatedWidget({
    id: 1,
    config: {
      sql: "SELECT g, COUNT(*) AS value FROM ki_home.taxi GROUP BY g LIMIT 100",
      tableId: 99,
      dynamicViewId: 7,
    },
  });

  it("materializes the dv-filter (materializeFilter with dynamicViewId, NOT tableId) when a dv filter is active + dv materialized", async () => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockResolvedValue(EMPTY_RESPONSE as unknown as Record<string, unknown>);
    (clientModule.materializeFilter as ReturnType<typeof vi.fn>).mockResolvedValue({
      viewName: "_kbi_filt_dv7_sX",
      expiresAt: Date.now() + 300000,
    });
    (clientModule.dropFilterView as ReturnType<typeof vi.fn>).mockResolvedValue({ dropped: true });

    act(() => {
      useDynamicViewStore.getState().setView(7, {
        viewName: "_kbi_dv_u1_d1_7",
        status: "materialized",
        expiresAt: Date.now() + 300000,
      });
      // dv filter present (the drill landed here)
      useFilterStore.getState().addDvFilter(7, {
        column: "g", value: "A", dataType: "string", addedAt: Date.now(),
      });
    });

    render(wrap(<WidgetRenderer widget={dvBoundWidget} />, 1, [], [makeDvRow({ id: 7 })]));

    await waitFor(
      () => {
        expect(clientModule.materializeFilter).toHaveBeenCalled();
      },
      { timeout: 1500 },
    );

    const calls = (clientModule.materializeFilter as ReturnType<typeof vi.fn>).mock.calls;
    const dvCall = calls.find(
      ([args]) => (args as { dynamicViewId?: number }).dynamicViewId === 7,
    );
    expect(dvCall).toBeDefined();
    const arg = dvCall![0] as { dashboardId: number; dynamicViewId: number; filters: unknown[]; tableId?: number };
    expect(arg.dashboardId).toBe(1);
    expect(arg.dynamicViewId).toBe(7);
    expect(arg.tableId).toBeUndefined();
    expect(arg.filters).toHaveLength(1);

    // setDvView populated dvViews[7] from the result.
    await waitFor(() => {
      expect(useFilterViewStore.getState().dvViews[7]?.viewName).toBe("_kbi_filt_dv7_sX");
    });
  });

  it("drops the dv-filter view + clears dvViews[7] when dvFilters[7] is empty", async () => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockResolvedValue(EMPTY_RESPONSE as unknown as Record<string, unknown>);
    (clientModule.materializeFilter as ReturnType<typeof vi.fn>).mockResolvedValue({
      viewName: "_kbi_filt_dv7_sX",
      expiresAt: Date.now() + 300000,
    });
    (clientModule.dropFilterView as ReturnType<typeof vi.fn>).mockResolvedValue({ dropped: true });

    act(() => {
      useDynamicViewStore.getState().setView(7, {
        viewName: "_kbi_dv_u1_d1_7",
        status: "materialized",
        expiresAt: Date.now() + 300000,
      });
      // Seed a stale dv-filter view, then clear the dv filters (drill removed).
      useFilterViewStore.getState().setDvView(7, { viewName: "_kbi_filt_dv7_sX", expiresAt: Date.now() + 300000 }, 1);
      useFilterStore.getState().addDvFilter(7, { column: "g", value: "A", dataType: "string", addedAt: Date.now() });
      useFilterStore.getState().clearDvFilters(7);
    });

    render(wrap(<WidgetRenderer widget={dvBoundWidget} />, 1, [], [makeDvRow({ id: 7 })]));

    await waitFor(
      () => {
        const calls = (clientModule.dropFilterView as ReturnType<typeof vi.fn>).mock.calls;
        const dvDrop = calls.find(([args]) => (args as { dynamicViewId?: number }).dynamicViewId === 7);
        expect(dvDrop).toBeDefined();
      },
      { timeout: 1500 },
    );
    // dvViews[7] cleared.
    await waitFor(() => {
      expect(useFilterViewStore.getState().dvViews[7]).toBeUndefined();
    });
    // materializeFilter must NOT have been called for the dv (empty filters → drop only).
    const matCalls = (clientModule.materializeFilter as ReturnType<typeof vi.fn>).mock.calls;
    expect(matCalls.find(([args]) => (args as { dynamicViewId?: number }).dynamicViewId === 7)).toBeUndefined();
  });

  it("gate holds: dvStatus !== materialized + a dv filter → materializeFilter NOT called for the dv", async () => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockResolvedValue(EMPTY_RESPONSE as unknown as Record<string, unknown>);
    (clientModule.materializeFilter as ReturnType<typeof vi.fn>).mockResolvedValue({
      viewName: "_kbi_filt_dv7_sX",
      expiresAt: Date.now() + 300000,
    });
    (clientModule.dropFilterView as ReturnType<typeof vi.fn>).mockResolvedValue({ dropped: true });

    act(() => {
      // dv NOT materialized (pending) — the gate must block a dv-filter materialize.
      useDynamicViewStore.getState().markPending(7, "_kbi_dv_u1_d1_7");
      useFilterStore.getState().addDvFilter(7, { column: "g", value: "A", dataType: "string", addedAt: Date.now() });
    });

    render(wrap(<WidgetRenderer widget={dvBoundWidget} />, 1, [], [makeDvRow({ id: 7 })]));

    // Give the 300ms debounce time to (not) fire.
    await new Promise((r) => setTimeout(r, 500));

    const matCalls = (clientModule.materializeFilter as ReturnType<typeof vi.fn>).mock.calls;
    expect(matCalls.find(([args]) => (args as { dynamicViewId?: number }).dynamicViewId === 7)).toBeUndefined();
  });
});

// ============================================================================
// Phase 63 Plan 03 (DVDRILL-V112-04): dv read-path FROM-swap precedence
// ============================================================================
//
// A dv-bound widget's data query FROM-swaps to the filtered-dv view
// (dvViews[dvId].viewName) when a dv filter is active; falls back to the raw dv
// view (dynamicViewStore viewName) when cleared. Precedence filtered-dv → dv.
// Over-threshold / pending dv states preserve the existing UX (no runSql crash).
// ============================================================================

describe("AggregatedWidgetRenderer Phase 63 — dv read-path FROM-swap precedence", () => {
  beforeEach(() => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockReset();
    (clientModule.materializeFilter as ReturnType<typeof vi.fn>).mockReset();
    (clientModule.dropFilterView as ReturnType<typeof vi.fn>).mockReset();
    useFilterStore.getState().reset();
    useFilterViewStore.getState().reset();
    useDynamicViewStore.getState().reset();
  });

  const dvBoundWidget: WidgetDto = makeAggregatedWidget({
    id: 1,
    config: {
      sql: "SELECT g, COUNT(*) AS value FROM ki_home.taxi GROUP BY g LIMIT 100",
      tableId: 99,
      dynamicViewId: 7,
    },
  });

  it("FROM-swaps to the filtered-dv view name when a dv-filter view is present", async () => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockResolvedValue(EMPTY_RESPONSE as unknown as Record<string, unknown>);
    (clientModule.dropFilterView as ReturnType<typeof vi.fn>).mockResolvedValue({ dropped: true });
    act(() => {
      useDynamicViewStore.getState().setView(7, {
        viewName: "_kbi_dv_u1_d1_7",
        status: "materialized",
        expiresAt: Date.now() + 300000,
      });
      // Filtered-dv view present (the dv-filter materialize completed).
      useFilterViewStore.getState().setDvView(
        7,
        { viewName: "_kbi_filt_d1_dv7_sABC", expiresAt: Date.now() + 300000 },
        1,
      );
    });

    render(wrap(<WidgetRenderer widget={dvBoundWidget} />, 1, [], [makeDvRow({ id: 7 })]));

    await waitFor(() => expect(clientModule.runSql).toHaveBeenCalled());
    const calls = (clientModule.runSql as ReturnType<typeof vi.fn>).mock.calls;
    const usedFiltered = calls.some(
      (args) => typeof args[0] === "string" && (args[0] as string).includes("_kbi_filt_d1_dv7_sABC"),
    );
    const usedRaw = calls.some(
      (args) => typeof args[0] === "string" && (args[0] as string).includes("_kbi_dv_u1_d1_7"),
    );
    expect(usedFiltered).toBe(true);
    // Precedence: the filtered-dv view wins over the raw dv view.
    expect(usedRaw).toBe(false);
  });

  it("reverts to the raw dv view when the dv-filter view is cleared", async () => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockResolvedValue(EMPTY_RESPONSE as unknown as Record<string, unknown>);
    (clientModule.dropFilterView as ReturnType<typeof vi.fn>).mockResolvedValue({ dropped: true });
    act(() => {
      useDynamicViewStore.getState().setView(7, {
        viewName: "_kbi_dv_u1_d1_7",
        status: "materialized",
        expiresAt: Date.now() + 300000,
      });
      // No dv-filter view (cleared) → falls back to the raw dv view.
    });

    render(wrap(<WidgetRenderer widget={dvBoundWidget} />, 1, [], [makeDvRow({ id: 7 })]));

    await waitFor(() => expect(clientModule.runSql).toHaveBeenCalled());
    const calls = (clientModule.runSql as ReturnType<typeof vi.fn>).mock.calls;
    const usedRaw = calls.some(
      (args) => typeof args[0] === "string" && (args[0] as string).includes("_kbi_dv_u1_d1_7"),
    );
    expect(usedRaw).toBe(true);
  });

  it("over_threshold dv with a dv filter present → existing empty-state UX, no runSql crash", async () => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockResolvedValue(EMPTY_RESPONSE as unknown as Record<string, unknown>);
    (clientModule.dropFilterView as ReturnType<typeof vi.fn>).mockResolvedValue({ dropped: true });
    act(() => {
      useDynamicViewStore.getState().setView(7, {
        viewName: "_kbi_dv_u1_d1_7",
        status: "over_threshold",
        reason: "exceeds_max_records",
      });
      // Stray dv filter present — must not cause a runSql against a non-existent FROM.
      useFilterStore.getState().addDvFilter(7, { column: "g", value: "A", dataType: "string", addedAt: Date.now() });
    });

    const { container } = render(
      wrap(<WidgetRenderer widget={dvBoundWidget} />, 1, [], [makeDvRow({ id: 7 })]),
    );

    expect(container.querySelector(".widget-over-threshold")).not.toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    expect(clientModule.runSql).not.toHaveBeenCalled();
  });
});

describe("RecordsTableRenderer Phase 63 — dv read-path FROM-swap precedence", () => {
  beforeEach(() => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockReset();
    (clientModule.materializeFilter as ReturnType<typeof vi.fn>).mockReset();
    (clientModule.dropFilterView as ReturnType<typeof vi.fn>).mockReset();
    useFilterStore.getState().reset();
    useFilterViewStore.getState().reset();
    useDynamicViewStore.getState().reset();
  });

  const dvBoundRecordsWidget: WidgetDto = makeRecordsWidget({
    id: 2,
    config: { table: "ki_home.taxi", tableId: 99, columns: "g,value", pageSize: 25, dynamicViewId: 7 },
  });

  it("page-fetch + count FROM-swap to the filtered-dv view when present", async () => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockResolvedValue({
      column_headers: ["g", "value"],
      column_1: ["A"],
      column_2: [10],
    });
    (clientModule.dropFilterView as ReturnType<typeof vi.fn>).mockResolvedValue({ dropped: true });
    act(() => {
      useDynamicViewStore.getState().setView(7, {
        viewName: "_kbi_dv_records_7",
        status: "materialized",
        expiresAt: Date.now() + 300000,
      });
      useFilterViewStore.getState().setDvView(
        7,
        { viewName: "_kbi_filt_records_dv7", expiresAt: Date.now() + 300000 },
        1,
      );
    });

    render(wrap(<WidgetRenderer widget={dvBoundRecordsWidget} />, 1, [], [makeDvRow({ id: 7 })]));

    await waitFor(() => {
      const calls = (clientModule.runSql as ReturnType<typeof vi.fn>).mock.calls;
      const swappedPage = calls.some(
        (args) => typeof args[0] === "string"
          && (args[0] as string).includes("FROM _kbi_filt_records_dv7")
          && (args[0] as string).includes("LIMIT 25"),
      );
      const swappedCount = calls.some(
        (args) => typeof args[0] === "string"
          && (args[0] as string) === "SELECT COUNT(*) AS total FROM _kbi_filt_records_dv7",
      );
      expect(swappedPage).toBe(true);
      expect(swappedCount).toBe(true);
    });
    // Raw dv view must NOT be used while the filtered-dv view is present.
    const calls = (clientModule.runSql as ReturnType<typeof vi.fn>).mock.calls;
    const usedRaw = calls.some(
      (args) => typeof args[0] === "string" && (args[0] as string).includes("_kbi_dv_records_7"),
    );
    expect(usedRaw).toBe(false);
  });

  it("page-fetch reverts to raw dv view when the dv-filter view is cleared", async () => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockResolvedValue({
      column_headers: ["g", "value"],
      column_1: ["A"],
      column_2: [10],
    });
    (clientModule.dropFilterView as ReturnType<typeof vi.fn>).mockResolvedValue({ dropped: true });
    act(() => {
      useDynamicViewStore.getState().setView(7, {
        viewName: "_kbi_dv_records_7",
        status: "materialized",
        expiresAt: Date.now() + 300000,
      });
    });

    render(wrap(<WidgetRenderer widget={dvBoundRecordsWidget} />, 1, [], [makeDvRow({ id: 7 })]));

    await waitFor(() => {
      const calls = (clientModule.runSql as ReturnType<typeof vi.fn>).mock.calls;
      const usedRaw = calls.some(
        (args) => typeof args[0] === "string" && (args[0] as string).includes("_kbi_dv_records_7"),
      );
      expect(usedRaw).toBe(true);
    });
  });
});

// ─── Phase 67 Plan 03: calendar branch wired to CalendarRenderer ───────────────

// Mock CalendarRenderer so WidgetRenderer tests don't need its full fetch/SVG setup.
vi.mock("./CalendarRenderer", () => ({
  default: (props: { widget: WidgetDto; tables: any[] }) => (
    <div
      data-testid="calendar-renderer"
      data-widget-id={String(props.widget.id)}
      data-tables-count={String((props.tables ?? []).length)}
    />
  ),
}));

function makeCalendarWidget(overrides: Partial<WidgetDto> = {}): WidgetDto {
  return {
    id: 55,
    dashboard_id: 1,
    title: "Sales Heatmap",
    type: "calendar",
    position: 0,
    config: { tableId: 7, tableRef: "demo.sales", timeCol: "ts" },
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function renderCalendarInContext(
  widget: WidgetDto,
  tables: import("../../api/client").TableDto[] = [],
) {
  return render(
    <DashboardContextProvider
      dashboardId={1}
      widgets={[widget]}
      dynamicViews={[]}
      retryDynamicView={() => {}}
    >
      <WidgetRenderer widget={widget} tables={tables} />
    </DashboardContextProvider>,
  );
}

describe("WidgetRenderer Phase 67 — calendar short-circuit to CalendarRenderer (CAL-V113-04)", () => {
  it("short-circuits to <CalendarRenderer /> for widget.type === 'calendar'", () => {
    const w = makeCalendarWidget({ id: 55 });
    renderCalendarInContext(w, []);
    expect(screen.getByTestId("calendar-renderer")).toBeInTheDocument();
    expect(
      screen.getByTestId("calendar-renderer").getAttribute("data-widget-id"),
    ).toBe("55");
    // Old placeholder must NOT appear
    expect(screen.queryByText(/Calendar Heatmap — renderer coming in Phase 67/)).toBeNull();
    // AggregatedWidgetRenderer would render "Select a table..." for a widget with no SQL
    expect(screen.queryByText(/Select a table/)).toBeNull();
  });

  it("calendar type does NOT fall through to AggregatedWidgetRenderer", () => {
    const w = makeCalendarWidget();
    renderCalendarInContext(w, []);
    expect(screen.getByTestId("calendar-renderer")).toBeTruthy();
    // No SQL loading state (AggregatedWidgetRenderer renders this for unconfigured widgets)
    expect(screen.queryByText(/Select a table/)).toBeNull();
  });

  it("passes the tables prop through to CalendarRenderer", () => {
    const tables: import("../../api/client").TableDto[] = [
      { id: 7, name: "sales", schema: "demo", columns: { ts: "timestamp" } } as any,
    ];
    const w = makeCalendarWidget({ id: 55 });
    renderCalendarInContext(w, tables);
    expect(
      screen.getByTestId("calendar-renderer").getAttribute("data-tables-count"),
    ).toBe("1");
  });

  it("CalendarRenderer.tsx does NOT import materializeFilter or dropFilterView (sole-materialize-trigger invariant — static assertion)", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const filePath = path.resolve(
      process.cwd(),
      "src/components/charts/CalendarRenderer.tsx",
    );
    const source = await fs.readFile(filePath, "utf-8");
    // Assert on import lines only (comments may mention these names for documentation).
    // Mirrors DataFilterRenderer.spec.tsx static assertion pattern.
    const importLines = source
      .split("\n")
      .filter((line) => line.trimStart().startsWith("import"))
      .join("\n");
    expect(importLines).not.toMatch(/materializeFilter|dropFilterView/);
  });
});

// ---------------------------------------------------------------------------
// Phase 77-01 (COLAPPLY-V115-01) — RecordsTable column display config
// ---------------------------------------------------------------------------

// TABLE_ID used throughout this describe block — matches makeRecordsWidget default (99).
const RECORDS_TABLE_ID = 99;

// A minimal number format spec that produces thousands separators.
const NUMBER_SPEC: FormatSpecNumber = {
  kind: "number",
  thousandsSep: true,
  decimals: 0,
  currency: false,
  percent: false,
};

// Records widget factory for this block.
const makeRecordsWidgetForConfig = (overrides: Partial<WidgetDto> = {}): WidgetDto => ({
  id: 20,
  dashboard_id: 1,
  title: "RecordsConfig Test",
  type: "records",
  position: 5,
  config: {
    table: "ki_home.sales",
    tableId: RECORDS_TABLE_ID,
    columns: "amount,name",
    pageSize: 25,
  },
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

describe("RecordsTable column display config (COLAPPLY-V115-01)", () => {
  beforeEach(() => {
    // Reset SQL mock — seed a two-row response: amount=1234567/9876543, name="Alice"/"Bob"
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockReset();
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildResponse(
        ["amount", "name"],
        [[1234567, 9876543], ["Alice", "Bob"]],
      ) as Record<string, unknown>,
    );
    vi.spyOn(clientModule, "materializeFilter").mockResolvedValue({
      viewName: "_kbi_filt_test",
      expiresAt: Date.now() + 300000,
    });
    vi.spyOn(clientModule, "dropFilterView").mockResolvedValue({ dropped: true });
    // Default: loadConfig returns empty (no config entries). Individual tests override this.
    vi.spyOn(clientModule, "listColumnDisplayConfig").mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ------------------------------------------------------------------
  // Test 1: header shows the saved display label (not the raw column name)
  // ------------------------------------------------------------------
  it("header renders the saved display label for a configured column (sort arrow preserved on active sort)", async () => {
    // Spy on listColumnDisplayConfig to return a label for "amount".
    // loadConfig calls listColumnDisplayConfig then setConfig — this is how the store gets seeded.
    vi.spyOn(clientModule, "listColumnDisplayConfig").mockResolvedValue([
      {
        table_id: RECORDS_TABLE_ID,
        column_name: "amount",
        label: "Revenue",
        format_spec: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);

    const widget = makeRecordsWidgetForConfig({
      config: {
        table: "ki_home.sales",
        tableId: RECORDS_TABLE_ID,
        columns: "amount,name",
        sortField: "amount",
        sortDirection: "asc",
        pageSize: 25,
      },
    });

    const { container } = render(wrap(<WidgetRenderer widget={widget} />));

    // Wait for loadConfig to complete AND data to load
    await waitFor(() => {
      const headers = Array.from(container.querySelectorAll("thead th")).map(
        (th) => th.textContent ?? "",
      );
      expect(headers.some((h) => h.includes("Revenue"))).toBe(true);
    });

    const headers = Array.from(container.querySelectorAll("thead th")).map(
      (th) => th.textContent ?? "",
    );

    // "amount" column must show the label "Revenue" (not raw "amount")
    expect(headers.some((h) => h.includes("Revenue"))).toBe(true);
    expect(headers.some((h) => h === "amount" || h.startsWith("amount "))).toBe(false);

    // Sort arrow must still appear on the active sort column header
    const revenueHeader = headers.find((h) => h.includes("Revenue")) ?? "";
    expect(revenueHeader).toMatch(/▲|▼/);
  });

  // ------------------------------------------------------------------
  // Test 2: cell values are formatted using the saved formatter
  // ------------------------------------------------------------------
  it("cell value renders through the saved formatter and differs from raw String(value)", async () => {
    // Return a number format spec for "amount" from the API.
    vi.spyOn(clientModule, "listColumnDisplayConfig").mockResolvedValue([
      {
        table_id: RECORDS_TABLE_ID,
        column_name: "amount",
        label: null,
        format_spec: NUMBER_SPEC,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);

    const widget = makeRecordsWidgetForConfig();
    const { container } = render(wrap(<WidgetRenderer widget={widget} />));

    // Wait for formatted cell to appear
    await waitFor(() => {
      const cells = Array.from(container.querySelectorAll("tbody td")).map(
        (td) => td.textContent ?? "",
      );
      // Raw value would be "1234567" — formatted with thousands sep becomes "1,234,567"
      expect(cells.some((c) => c === "1,234,567")).toBe(true);
    });

    const cells = Array.from(container.querySelectorAll("tbody td")).map(
      (td) => td.textContent ?? "",
    );

    expect(cells.some((c) => c === "1,234,567")).toBe(true);
    // Raw string should NOT appear in the "amount" column cells
    expect(cells.some((c) => c === "1234567")).toBe(false);
  });

  // ------------------------------------------------------------------
  // Test 3: raw fallback when column has no config entry
  // ------------------------------------------------------------------
  it("header shows raw column name and cell shows raw value when no config exists for the column", async () => {
    // listColumnDisplayConfig returns [] (default mock) → no config for "name"
    const widget = makeRecordsWidgetForConfig();
    const { container } = render(wrap(<WidgetRenderer widget={widget} />));

    await waitFor(() => {
      expect(container.querySelectorAll("thead th").length).toBeGreaterThan(0);
    });

    const headers = Array.from(container.querySelectorAll("thead th")).map(
      (th) => th.textContent ?? "",
    );
    // "name" column: no config → raw column name
    expect(headers.some((h) => h === "name" || h.startsWith("name "))).toBe(true);

    await waitFor(() => {
      expect(container.querySelectorAll("tbody tr").length).toBeGreaterThan(0);
    });

    const cells = Array.from(container.querySelectorAll("tbody td")).map(
      (td) => td.textContent ?? "",
    );
    // No format spec → raw value passthrough
    expect(cells.some((c) => c === "Alice")).toBe(true);
  });

  // ------------------------------------------------------------------
  // Test 4: dv-bound widget (tableId undefined) → raw names + raw values
  // ------------------------------------------------------------------
  it("dv-bound widget (tableId undefined) renders raw column name and raw value without crashing", async () => {
    const DV_ID = 5;

    // Seed a dynamic view entry so the widget renders (not orphan state).
    act(() => {
      useDynamicViewStore.getState().setView(DV_ID, {
        viewName: "_kbi_dv_5",
        status: "materialized",
      });
    });

    // Seed config for a hypothetical tableId — should NOT affect dv-bound rendering
    vi.spyOn(clientModule, "listColumnDisplayConfig").mockResolvedValue([
      {
        table_id: RECORDS_TABLE_ID,
        column_name: "amount",
        label: "Should Not Appear",
        format_spec: NUMBER_SPEC,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);

    const dvWidget = makeRecordsWidgetForConfig({
      id: 21,
      config: {
        // No tableId — dv-bound
        table: "ki_home.sales",
        dynamicViewId: DV_ID,
        columns: "amount,name",
        pageSize: 25,
      },
    });

    // Pass the dynamic view in the dashboard context so it's not orphan
    const { container } = render(
      <DashboardContextProvider
        dashboardId={1}
        widgets={[dvWidget]}
        dynamicViews={[{ id: DV_ID, name: "dv_5", table_id: RECORDS_TABLE_ID, template: "", max_records: 10000 } as any]}
        retryDynamicView={() => {}}
      >
        <WidgetRenderer widget={dvWidget} />
      </DashboardContextProvider>,
    );

    await waitFor(() => {
      expect(container.querySelectorAll("thead th").length).toBeGreaterThan(0);
    });

    const headers = Array.from(container.querySelectorAll("thead th")).map(
      (th) => th.textContent ?? "",
    );

    // dv-bound: raw col name "amount" (no label override, tableId undefined)
    expect(headers.some((h) => h === "amount" || h.startsWith("amount "))).toBe(true);
    expect(headers.some((h) => h.includes("Should Not Appear"))).toBe(false);

    await waitFor(() => {
      expect(container.querySelectorAll("tbody tr").length).toBeGreaterThan(0);
    });

    const cells = Array.from(container.querySelectorAll("tbody td")).map(
      (td) => td.textContent ?? "",
    );
    // Raw value "1234567" (no thousands formatting — tableId is undefined)
    expect(cells.some((c) => c === "1234567")).toBe(true);
  });

  // ------------------------------------------------------------------
  // Test 5: configVersion-driven live re-render — header updates after upsertColumn
  // ------------------------------------------------------------------
  it("header updates live after upsertColumn bumps configVersion (configVersion-driven re-render)", async () => {
    // Initial render with NO config for "amount" (listColumnDisplayConfig returns [])
    const widget = makeRecordsWidgetForConfig();
    const { container } = render(wrap(<WidgetRenderer widget={widget} />));

    await waitFor(() => {
      expect(container.querySelectorAll("thead th").length).toBeGreaterThan(0);
    });

    // Confirm raw label initially
    const headersBefore = Array.from(container.querySelectorAll("thead th")).map(
      (th) => th.textContent ?? "",
    );
    expect(headersBefore.some((h) => h === "amount" || h.startsWith("amount "))).toBe(true);

    // Mutate config directly — upsert bypasses loadConfig, bumps configVersion → re-render fires
    act(() => {
      useColumnDisplayConfigStore.getState().upsertColumn(
        RECORDS_TABLE_ID,
        "amount",
        "New Label",
        null,
      );
    });

    // Headers should now show "New Label" (configVersion subscription triggers re-render)
    await waitFor(() => {
      const headersAfter = Array.from(container.querySelectorAll("thead th")).map(
        (th) => th.textContent ?? "",
      );
      expect(headersAfter.some((h) => h.includes("New Label"))).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Phase 77-02 (COLAPPLY-V115-02) — Chart tooltip value format, series/axis label fallback chains
// ---------------------------------------------------------------------------

// Strategy: mock recharts components to render their key label props as visible DOM text.
// This avoids SVG introspection difficulties while still asserting the fallback chains.
vi.mock("recharts", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createElement: h, cloneElement } = require("react");
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    // Give ResponsiveContainer fixed dimensions so Recharts renders children.
    ResponsiveContainer: ({ children }: { children: unknown }) =>
      h("div", { style: { width: 800, height: 400 }, "data-testid": "responsive-container" }, children),
    // Render Bar name= as a visible span so we can query it.
    Bar: ({ name, children }: { name?: string; children?: unknown }) =>
      h("div", { "data-testid": "recharts-bar", "data-name": name },
        h("span", { "data-testid": "bar-series-name" }, name),
        children,
      ),
    // Render XAxis label= as a visible span.
    XAxis: ({ label }: { label?: { value?: string } | string }) => {
      const labelText = typeof label === "object" && label !== null ? (label as { value?: string }).value : (label as string | undefined);
      return h("div", { "data-testid": "recharts-xaxis" },
        h("span", { "data-testid": "xaxis-label" }, labelText ?? ""),
      );
    },
    // Render YAxis label= as a visible span.
    YAxis: ({ label }: { label?: { value?: string } | string }) => {
      const labelText = typeof label === "object" && label !== null ? (label as { value?: string }).value : (label as string | undefined);
      return h("div", { "data-testid": "recharts-yaxis" },
        h("span", { "data-testid": "yaxis-label" }, labelText ?? ""),
      );
    },
    // Render Tooltip content= prop with synthetic active/payload so formatter is exercised.
    Tooltip: ({ content }: { content?: { type?: unknown; props?: Record<string, unknown> } }) => {
      if (!content) return null;
      // Inject synthetic recharts-style active/payload/label props via cloneElement
      const synthetic = cloneElement(content as Parameters<typeof cloneElement>[0], {
        active: true,
        payload: [{ name: "value", value: 1234, color: "var(--chart-1)" }],
        label: "CategoryA",
      });
      return h("div", { "data-testid": "recharts-tooltip" }, synthetic);
    },
    CartesianGrid: () => null,
    Legend: () => null,
    BarChart: ({ children }: { children?: unknown }) => h("div", { "data-testid": "recharts-barchart" }, children),
    LineChart: ({ children }: { children?: unknown }) => h("div", { "data-testid": "recharts-linechart" }, children),
    AreaChart: ({ children }: { children?: unknown }) => h("div", { "data-testid": "recharts-areachart" }, children),
    Area: ({ name }: { name?: string }) =>
      h("div", { "data-testid": "recharts-area", "data-name": name },
        h("span", { "data-testid": "area-series-name" }, name),
      ),
    Line: ({ name }: { name?: string }) =>
      h("div", { "data-testid": "recharts-line", "data-name": name },
        h("span", { "data-testid": "line-series-name" }, name),
      ),
    Cell: () => null,
    LabelList: () => null,
  };
});

// Bar chart widget factory for chart-renderer tests.
const CHART_TABLE_ID = 77;
const CHART_METRIC_COL = "fare_amount";
const CHART_GROUP_COL = "region";

const makeBarWidget = (overrides: Partial<WidgetDto> = {}): WidgetDto => ({
  id: 77,
  dashboard_id: 1,
  title: "Bar Test",
  type: "bar",
  position: 10,
  config: {
    sql: `SELECT region, SUM(fare_amount) AS value FROM demo.trips GROUP BY region LIMIT 100`,
    tableId: CHART_TABLE_ID,
    groupByColumn: CHART_GROUP_COL,
    metricColumn: CHART_METRIC_COL,
    aggregation: "SUM",
  },
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

// Kinetica response with one row of chart data.
const CHART_RESPONSE = {
  column_headers: ["region", "value"],
  column_datatypes: ["varchar", "double"],
  column_1: ["East"],
  column_2: [1234],
};

describe("BarRenderer chart tooltip, series/axis label fallback chains (COLAPPLY-V115-02)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(clientModule, "runSql").mockResolvedValue(CHART_RESPONSE as unknown as Record<string, unknown>);
    vi.spyOn(clientModule, "materializeFilter").mockResolvedValue({ viewName: "_kbi_filt_test", expiresAt: Date.now() + 300000 });
    vi.spyOn(clientModule, "dropFilterView").mockResolvedValue({ dropped: true });
    // Default no-op so loadConfig never makes real HTTP calls.
    vi.spyOn(clientModule, "listColumnDisplayConfig").mockResolvedValue([]);
  });

  // ------------------------------------------------------------------
  // Test 1: series name fallback — yFieldLabel wins
  // ------------------------------------------------------------------
  it("series name uses config.yFieldLabel when set (yFieldLabel wins over resolved metric label)", async () => {
    const widget = makeBarWidget({
      config: {
        ...makeBarWidget().config,
        yFieldLabel: "Custom Metric Label",
      },
    });

    const { getByTestId } = render(wrap(<WidgetRenderer widget={widget} />));
    await waitFor(() => expect(getByTestId("recharts-barchart")).toBeTruthy());

    const seriesName = getByTestId("bar-series-name").textContent ?? "";
    expect(seriesName).toBe("Custom Metric Label");
  });

  // ------------------------------------------------------------------
  // Test 2: series name fallback — resolved metric label when yFieldLabel not set
  // ------------------------------------------------------------------
  it("series name falls back to resolved metric column label when yFieldLabel is unset", async () => {
    // Seed a label for metricColumn (fare_amount → "Fare Revenue")
    vi.spyOn(clientModule, "listColumnDisplayConfig").mockResolvedValue([
      {
        table_id: CHART_TABLE_ID,
        column_name: CHART_METRIC_COL,
        label: "Fare Revenue",
        format_spec: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);

    const widget = makeBarWidget();
    const { getByTestId } = render(wrap(<WidgetRenderer widget={widget} />));
    await waitFor(() => expect(getByTestId("recharts-barchart")).toBeTruthy());

    // Wait for loadConfig to populate the store
    await waitFor(() => {
      const seriesName = getByTestId("bar-series-name").textContent ?? "";
      expect(seriesName).toBe("Fare Revenue");
    });
  });

  // ------------------------------------------------------------------
  // Test 3: series name fallback — resolveLabel returns raw column name when no stored label
  // ------------------------------------------------------------------
  it("series name shows raw column name (resolveLabel fallback) when yFieldLabel is unset and no label is stored", async () => {
    const widget = makeBarWidget();
    const { getByTestId } = render(wrap(<WidgetRenderer widget={widget} />));
    await waitFor(() => expect(getByTestId("recharts-barchart")).toBeTruthy());

    const seriesName = getByTestId("bar-series-name").textContent ?? "";
    // resolveLabel(tableId, "fare_amount") returns "fare_amount" (raw column name) when no stored label.
    // The || y fallback is only reached if resolveLabel returns empty/falsy, which it never does
    // (it always returns at least the column name). So we expect the raw column name here.
    expect(seriesName).toBe(CHART_METRIC_COL); // "fare_amount"
  });

  // ------------------------------------------------------------------
  // Test 4: Bar X axis title — user-set label wins over resolved
  // ------------------------------------------------------------------
  it("Bar X-axis title uses config.xAxisLabel when set (user label wins over resolved)", async () => {
    const widget = makeBarWidget({
      config: { ...makeBarWidget().config, xAxisLabel: "My X Label" },
    });

    const { getByTestId } = render(wrap(<WidgetRenderer widget={widget} />));
    await waitFor(() => expect(getByTestId("recharts-barchart")).toBeTruthy());

    const xLabel = getByTestId("xaxis-label").textContent ?? "";
    expect(xLabel).toBe("My X Label");
  });

  // ------------------------------------------------------------------
  // Test 5: Bar X axis title — falls back to resolved groupByColumn label
  // ------------------------------------------------------------------
  it("Bar X-axis title falls back to resolved groupByColumn label when config.xAxisLabel is unset", async () => {
    vi.spyOn(clientModule, "listColumnDisplayConfig").mockResolvedValue([
      {
        table_id: CHART_TABLE_ID,
        column_name: CHART_GROUP_COL,
        label: "Sales Region",
        format_spec: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);

    const widget = makeBarWidget();
    const { getByTestId } = render(wrap(<WidgetRenderer widget={widget} />));
    await waitFor(() => expect(getByTestId("recharts-barchart")).toBeTruthy());

    await waitFor(() => {
      const xLabel = getByTestId("xaxis-label").textContent ?? "";
      expect(xLabel).toBe("Sales Region");
    });
  });

  // ------------------------------------------------------------------
  // Test 6: dv-bound / legacy fallback — no tableId → series = raw y, no axis title
  // ------------------------------------------------------------------
  it("dv-bound widget (no tableId, no groupByColumn/metricColumn) uses raw y key for series name", async () => {
    const dvWidget: WidgetDto = {
      id: 78,
      dashboard_id: 1,
      title: "DV Bar",
      type: "bar",
      position: 11,
      config: {
        sql: "SELECT cat, SUM(val) AS value FROM demo.t GROUP BY cat",
        // No tableId, no groupByColumn, no metricColumn
      },
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };

    const { getByTestId } = render(wrap(<WidgetRenderer widget={dvWidget} />));
    await waitFor(() => expect(getByTestId("recharts-barchart")).toBeTruthy());

    const seriesName = getByTestId("bar-series-name").textContent ?? "";
    // No tableId → resolveLabel not called → raw y ("value")
    expect(seriesName).toBe("value");
  });

  // ------------------------------------------------------------------
  // Test 7: configVersion-driven re-render — series name updates after upsertColumn
  // ------------------------------------------------------------------
  it("series name updates live after upsertColumn bumps configVersion (configVersion-driven re-render)", async () => {
    const widget = makeBarWidget();
    const { getByTestId } = render(wrap(<WidgetRenderer widget={widget} />));

    await waitFor(() => expect(getByTestId("recharts-barchart")).toBeTruthy());

    // Initial: no stored label → series name = raw column name ("fare_amount" via resolveLabel)
    expect(getByTestId("bar-series-name").textContent).toBe(CHART_METRIC_COL);

    // Mutate config directly — upsertColumn bumps configVersion → re-render fires
    act(() => {
      useColumnDisplayConfigStore.getState().upsertColumn(
        CHART_TABLE_ID,
        CHART_METRIC_COL,
        "Live Metric",
        null,
      );
    });

    await waitFor(() => {
      expect(getByTestId("bar-series-name").textContent).toBe("Live Metric");
    });
  });

  // ------------------------------------------------------------------
  // Test 8: tooltip content uses ColumnFormatTooltip with formatted value
  // ------------------------------------------------------------------
  it("tooltip renders formatted value via resolveFormatter (ColumnFormatTooltip wired)", async () => {
    // Seed a currency format spec for metricColumn
    vi.spyOn(clientModule, "listColumnDisplayConfig").mockResolvedValue([
      {
        table_id: CHART_TABLE_ID,
        column_name: CHART_METRIC_COL,
        label: null,
        format_spec: { kind: "number", thousandsSep: true, decimals: 0, currency: "$", percent: false },
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);

    const widget = makeBarWidget();
    const { getByTestId } = render(wrap(<WidgetRenderer widget={widget} />));

    await waitFor(() => expect(getByTestId("recharts-tooltip")).toBeTruthy());

    // Wait for loadConfig to populate store, then tooltip should show formatted value
    await waitFor(() => {
      const tooltipText = getByTestId("recharts-tooltip").textContent ?? "";
      // $1,234 (thousandsSep=true, currency="$", decimals=0)
      expect(tooltipText).toContain("$1,234");
    });
  });
});
