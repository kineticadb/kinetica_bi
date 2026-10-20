/**
 * Phase 139 (139-13) — WidgetRenderer regression proofs for a widget bound to an AI dynamic view
 * (NEGATIVE dynamicViewId): materialized renders from the view, dangling id is the orphan
 * placeholder, over-threshold shows the existing empty states, repointed (dynamicViewId undefined)
 * is table-bound. Harness (mocks, wrap) copied from WidgetRenderer.spec.tsx lines 20-255.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { stopAllExportTracking } from "../../store/exportTracker";
import { useWidgetActionStore } from "../../store/widgetActionStore";
import { render, waitFor, act, screen, fireEvent } from "@testing-library/react";
import WidgetRenderer, { resolveAggregatedDrillTarget } from "./WidgetRenderer";
import { useFilterStore } from "../../store/filterStore";
import { useFilterViewStore } from "../../store/filterViewStore";
import { useAuthStore } from "../../store/auth";
import { useSpatialFilterStore } from "../../store/spatialFilterStore";
// Phase 35 Plan 05 (DV-V16-13/14): dynamic-view store + Retry context wiring tests
import { useDynamicViewStore } from "../../store/dynamicViewStore";
import { DashboardContextProvider } from "../DashboardContext";
import { FilteringBadge } from "../FilteringBadge";
import * as clientModule from "../../api/client";
// Phase 77-01 (COLAPPLY-V115-01): column display config store — used directly (real store, no mock).
import { useColumnDisplayConfigStore } from "../../store/columnDisplayConfigStore";
import type { FormatSpecNumber } from "../../lib/columnFormatter";

// Phase 91 (READ-V118-01 / COMBO-V118-04): filterCombinationStore mock state.
// These let-bindings drive the selector-aware mock; reset in beforeEach.
// vizKey convention: "w:<widgetId>" — must match what AggregatedWidgetRenderer computes.
let mockVizToHash: Record<string, string | undefined> = {};
let mockRegistry: Record<string, { viewName: string; expiresAt: number; materializing: boolean }> = {};
let mockCombinationVersion = 0;

// Selector-aware mock for useFilterCombinationStore.
// Mirrors the TimelineRenderer.spec.tsx pattern (lines 97-113).
vi.mock("../../store/filterCombinationStore", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const useFilterCombinationStore = ((selector?: (s: unknown) => unknown) => {
    const state = {
      vizToHash: mockVizToHash,
      registry: mockRegistry,
      combinationVersion: mockCombinationVersion,
    };
    return selector ? selector(state) : state;
  }) as unknown as { getState: () => unknown };
  useFilterCombinationStore.getState = () => ({
    vizToHash: mockVizToHash,
    registry: mockRegistry,
    combinationVersion: mockCombinationVersion,
    clearEntry: vi.fn(),
  });
  return { ...actual, useFilterCombinationStore };
});

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
    // Phase 131-07: background export client calls (dialog Start/poll/cancel).
    startExport: vi.fn(),
    cancelExportJob: vi.fn(),
    getExportJob: vi.fn(),
  };
});
vi.mock("../../lib/exportDownload", async (o) => ({
  ...(await o<typeof import("../../lib/exportDownload")>()),
  startExportDownload: vi.fn(),
}));
afterEach(() => {
  stopAllExportTracking();
});

// Clear all mock call histories between tests to prevent cross-test contamination.
// vi.restoreAllMocks() restores spies but does NOT clear vi.fn() call counts.
// Phase 91: also reset combo store mock state.
beforeEach(() => {
  vi.clearAllMocks();
  mockVizToHash = {};
  mockRegistry = {};
  mockCombinationVersion = 0;
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
    // Phase 111 (MAPVIEW-V121-01): getCenter/getZoom needed — Effect 9c's always-on
    // publish calls both unconditionally at mount, for every map widget.
    this.getView = vi.fn(() => ({
      fit: vi.fn(),
      calculateExtent: vi.fn(() => [0, 0, 100, 100]),
      getCenter: vi.fn(() => [0, 0] as [number, number]),
      getZoom: vi.fn(() => 2),
    }));
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
  getShowLoadingIndicator: (_cfg: any) => true,
  // Phase 104 (MAPSYNC-V119-06): opt-in sync — default false (legacy byte-identical)
  getSyncViewportEnabled: (_cfg: any) => false,
  // Phase 112 (MAPVIEW-V121-02/-03): mirrors the real getDefaultView passthrough.
  getDefaultView: (_cfg: any) => undefined,
  DEFAULT_INFO_ENABLED: true,
  DEFAULT_INFO_RADIUS_PX: 3,
  DEFAULT_INFO_POPUP_WIDTH_PX: 360,
  DEFAULT_INFO_POPUP_HEIGHT_PX: 400,
  DEFAULT_SHOW_SHAPE_MEASUREMENTS: true,
  DEFAULT_SHOW_SCALE_BAR: false,
  DEFAULT_SHOW_FULLSCREEN_BUTTON: false,
  DEFAULT_SHOW_LOADING_INDICATOR: true,
  DEFAULT_SYNC_VIEWPORT: false,
}));
vi.mock("./InfoPopup", () => ({ default: vi.fn(() => null) }));
// Phase 104 (MAPSYNC-V119): no-op mock — sync is disabled by default (getSyncViewportEnabled=false above).
vi.mock("../../store/mapViewportSyncStore", () => {
  const state = { viewports: {}, publish: vi.fn(), clear: vi.fn(), reset: vi.fn() };
  const hook = (selector: (s: any) => any) => selector(state);
  (hook as any).getState = () => state;
  return { useMapViewportSyncStore: hook };
});
// Phase 12-02: bboxHelper deleted — mock removed (file no longer exists)

import type { WidgetDto } from "../../api/client";

const makeDvRow = (overrides: Partial<import("../../api/client").DynamicViewRow> = {}): import("../../api/client").DynamicViewRow => ({
  id: -3,
  dashboard_id: 1,
  source_table_id: 99,
  name: "Trips by hour",
  template_sql: "SELECT * FROM {view}",
  max_records: 10000,
  columns_json: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

const EMPTY_RESPONSE = {
  column_headers: [] as string[],
  column_datatypes: [] as string[],
};

const AI_VIEW = "_kbi_ai_ualice_s01234567_n0a1b2c3d_3";
const BASE_SQL = "SELECT g, COUNT(*) AS value FROM ki_home.taxi GROUP BY g LIMIT 100";

describe("Phase 139 widget bound to an AI dynamic view (negative dynamicViewId)", () => {
  beforeEach(() => {
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockReset();
    (clientModule.runSql as ReturnType<typeof vi.fn>).mockResolvedValue(EMPTY_RESPONSE as unknown as Record<string, unknown>);
    useFilterStore.getState().reset();
    useFilterViewStore.getState().reset();
    useDynamicViewStore.getState().reset();
  });

  const aiWidget = (cfg: Record<string, unknown> = {}): WidgetDto =>
    makeAggregatedWidget({ id: 1, config: { sql: BASE_SQL, tableId: 99, dynamicViewId: -3, ...cfg } });

  it("WRDV-1: -3 in the context list + materialized store entry -> not the orphan placeholder; runSql FROM is the AI view", async () => {
    act(() => {
      useDynamicViewStore.getState().setView(-3, {
        viewName: AI_VIEW,
        status: "materialized",
        expiresAt: Date.now() + 300000,
      });
    });
    const { container } = render(wrap(<WidgetRenderer widget={aiWidget()} />, 1, [], [makeDvRow({ id: -3 })]));
    await waitFor(() => expect(clientModule.runSql).toHaveBeenCalled());
    expect(container.querySelector(".widget-orphan-dynamic-view")).toBeNull();
    const sqls = (clientModule.runSql as ReturnType<typeof vi.fn>).mock.calls.map((a) => String(a[0]));
    expect(sqls.some((s) => s.includes(AI_VIEW))).toBe(true);
    expect(sqls.some((s) => s.includes("ki_home.taxi"))).toBe(false);
  });

  it("WRDV-2: -3 absent from the context list and the store -> orphan placeholder, no runSql", async () => {
    const { container } = render(wrap(<WidgetRenderer widget={aiWidget()} />, 1, [], [makeDvRow({ id: 7 })]));
    expect(screen.getByText("This dynamic view was deleted. Reconfigure the widget.")).toBeInTheDocument();
    expect(container.querySelector(".widget-orphan-dynamic-view")).not.toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    expect(clientModule.runSql).not.toHaveBeenCalled();
  });

  it("WRDV-3: over_threshold reasons show the existing empty states; no runSql", async () => {
    act(() => {
      useDynamicViewStore.getState().setView(-3, { viewName: AI_VIEW, status: "over_threshold", reason: "no_filter" });
    });
    const first = render(wrap(<WidgetRenderer widget={aiWidget()} />, 1, [], [makeDvRow({ id: -3 })]));
    expect(
      screen.getByText("No filter applied — load the full table, or apply a filter to narrow it."),
    ).toBeInTheDocument();
    first.unmount();

    act(() => {
      useDynamicViewStore.getState().setView(-3, {
        viewName: AI_VIEW,
        status: "over_threshold",
        reason: "exceeds_max_records",
      });
    });
    render(wrap(<WidgetRenderer widget={aiWidget()} />, 1, [], [makeDvRow({ id: -3 })]));
    expect(screen.getByText("Too much data — narrow your filters to enable this view.")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(clientModule.runSql).not.toHaveBeenCalled();
  });

  it("WRDV-4: repointed (dynamicViewId key present, value undefined) -> table-bound: no dv gate, runSql FROM the base table", async () => {
    // A stale AI entry must be ignored once the widget no longer references it.
    act(() => {
      useDynamicViewStore.getState().setView(-3, { viewName: AI_VIEW, status: "over_threshold", reason: "no_filter" });
    });
    const { container } = render(
      wrap(<WidgetRenderer widget={aiWidget({ dynamicViewId: undefined })} />, 1, [], []),
    );
    await waitFor(() => expect(clientModule.runSql).toHaveBeenCalled());
    expect(container.querySelector(".widget-over-threshold")).toBeNull();
    expect(container.querySelector(".widget-orphan-dynamic-view")).toBeNull();
    const sqls = (clientModule.runSql as ReturnType<typeof vi.fn>).mock.calls.map((a) => String(a[0]));
    expect(sqls.some((s) => s.includes("ki_home.taxi"))).toBe(true);
    expect(sqls.some((s) => s.includes(AI_VIEW))).toBe(false);
  });
});
