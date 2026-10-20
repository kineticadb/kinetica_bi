// Phase 139 Plan 12 (AIACT-V20-07/08, AISAFE-V20-06): DashboardsPage wiring for AI dynamic views
// (DPDV-1..5). Harness mirrors DashboardsPage.aiWidget.spec.tsx.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { seedDesignerStore } from "../test/seedAuthStore";
import { useAiSessionStore } from "../store/aiSessionStore";
import { useDynamicViewStore } from "../store/dynamicViewStore";
import { baselineFixture } from "../test/aiSessionHarness";
import { __resetAiDvLifecycleForTest } from "../lib/aiDv/aiDvLifecycle";
vi.mock("react-grid-layout", async (orig) => {
  const actual = await orig<typeof import("react-grid-layout")>();
  return {
    ...actual,
    ResponsiveGridLayout: (p: any) => {
      (globalThis as any).__gridProps = p;
      return <div data-testid="grid">{p.children}</div>;
    },
  };
});

// ResizeObserver is used by ol/Map at construction time — stub it before any OL import
// (mirrors DashboardsPage.spec.tsx:15). Extended for Phase 107-02 bugfix: it now reports a
// configurable `contentRect.width` so react-grid-layout's useContainerWidth measures a real
// value (the panel-mode grid lives in a narrowed flex sibling). Default is a wide `lg` width
// so pre-existing tests are unaffected; the panel-mode layout test overrides it to a narrow
// value to exercise the breakpoint-pinning fix.
let gridProps: any = null;
let roReportedWidth = 1400;
vi.stubGlobal("ResizeObserver", vi.fn().mockImplementation(function (this: any, cb: ResizeObserverCallback) {
  this.observe = vi.fn((el: Element) => {
    cb([{ contentRect: { width: roReportedWidth, height: 600 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  });
  this.disconnect = vi.fn();
  this.unobserve = vi.fn();
  return this;
}));

// Phase 107 Plan 02: matchMedia is not stubbed anywhere in test/setup.ts — any spec
// exercising the narrow-viewport default must stub it itself. Default: NOT narrow
// (matches: false); individual tests override via mockImplementationOnce / mockReturnValue.
const matchMediaMock = vi.fn().mockImplementation((query: string) => ({
  matches: false,
  media: query,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
}));
vi.stubGlobal("matchMedia", matchMediaMock);

// Mock OL and related modules (they fail in JSDOM due to canvas / ResizeObserver dependencies)
// — mirrors DashboardsPage.spec.tsx:23-62 verbatim.
vi.mock("ol/Map", () => ({
  default: vi.fn().mockImplementation(function MockMap(this: any) {
    this.setTarget = vi.fn();
    this.dispose = vi.fn();
    this.addLayer = vi.fn();
    this.removeLayer = vi.fn();
    this.addInteraction = vi.fn();
    this.removeInteraction = vi.fn();
    this.getView = vi.fn(() => ({ fit: vi.fn(), calculateExtent: vi.fn(() => [0, 0, 100, 100]), getResolution: vi.fn(() => 100) }));
    this.updateSize = vi.fn();
    this.getSize = vi.fn(() => [800, 600]);
    this.getPixelFromCoordinate = vi.fn(() => [400, 300]);
    this.addOverlay = vi.fn();
    this.removeOverlay = vi.fn();
    this.on = vi.fn();
    this.un = vi.fn();
    this.forEachFeatureAtPixel = vi.fn(() => undefined);
    this.getViewport = vi.fn(() => ({ style: { cursor: "" } }));
    return this;
  }),
}));
vi.mock("ol/layer/Tile", () => ({ default: vi.fn().mockImplementation(function (this: any) { this.setSource = vi.fn(); this.getSource = vi.fn(() => null); return this; }) }));
vi.mock("ol/source/OSM", () => ({ default: vi.fn().mockImplementation(function (this: any) { return this; }) }));
vi.mock("ol/source/XYZ", () => ({ default: vi.fn().mockImplementation(function (this: any) { return this; }) }));
vi.mock("ol/layer/Image", () => ({ default: vi.fn().mockImplementation(function (this: any) { this.setSource = vi.fn(); return this; }) }));
vi.mock("ol/source/ImageWMS", () => ({ default: vi.fn().mockImplementation(function (this: any) { this.on = vi.fn(); this.getUrl = vi.fn(() => ""); return this; }) }));
vi.mock("ol/Overlay", () => ({ default: vi.fn().mockImplementation(function (this: any, opts: any) { this.setPosition = vi.fn(); this.getPosition = vi.fn(); this.getElement = vi.fn(() => opts?.element ?? null); return this; }) }));
vi.mock("ol/proj", () => ({
  transform: vi.fn((coord: [number, number]) => [coord[0] / 111320, coord[1] / 111320]),
  transformExtent: vi.fn((e: [number, number, number, number]) => [e[0] / 111320, e[1] / 111320, e[2] / 111320, e[3] / 111320]),
  fromLonLat: vi.fn((c: [number, number]) => c),
}));
vi.mock("ol/layer/Vector", () => ({ default: vi.fn().mockImplementation(function (this: any) { this.changed = vi.fn(); this.setStyle = vi.fn(); this.getSource = vi.fn(() => ({ addFeature: vi.fn(), removeFeature: vi.fn(), getFeatures: vi.fn(() => []), clear: vi.fn(), on: vi.fn() })); return this; }) }));
vi.mock("ol/source/Vector", () => ({ default: vi.fn().mockImplementation(function (this: any) { this.addFeature = vi.fn(); this.removeFeature = vi.fn(); this.getFeatures = vi.fn(() => []); this.clear = vi.fn(); this.on = vi.fn(); return this; }) }));
vi.mock("ol/interaction/Draw", () => ({ default: vi.fn().mockImplementation(function (this: any) { this.on = vi.fn(); this.setActive = vi.fn(); return this; }) }));
vi.mock("ol/geom/Point", () => ({ default: vi.fn().mockImplementation(function (this: any) { return this; }) }));
vi.mock("ol/Feature", () => ({ default: vi.fn().mockImplementation(function (this: any) { this.setGeometry = vi.fn(); this.getGeometry = vi.fn(); return this; }) }));
vi.mock("ol/format/WKT", () => ({ default: vi.fn().mockImplementation(function (this: any) { this.writeGeometry = vi.fn(() => "POLYGON((0 0,1 0,1 1,0 1,0 0))"); return this; }) }));
vi.mock("ol/sphere", () => ({ getDistance: vi.fn(() => 1000), getArea: vi.fn(() => 1000000) }));

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    dropFilterView: vi.fn(() => Promise.resolve({ dropped: true as const })),
    dropDynamicView: vi.fn(() => Promise.resolve({ dropped: true as const })),
    listDashboards: vi.fn(() => Promise.resolve([])),
    listWidgets: vi.fn(() => Promise.resolve([])),
    listViews: vi.fn(() => Promise.resolve([])),
    listDashboardLayers: vi.fn(() => Promise.resolve([])),
    listDashboardTables: vi.fn(() => Promise.resolve([])),
    listTables: vi.fn(() => Promise.resolve([])),
    listDynamicViews: vi.fn(() => Promise.resolve({ dynamic_views: [] })),
    materializeDynamicView: vi.fn(),
    materializeAiDynamicView: vi.fn(),
    dropAiDynamicView: vi.fn(() => Promise.resolve({ dropped: true as const })),
    listDashboardGrants: vi.fn(() => Promise.resolve([])),
    addDashboardGrant: vi.fn(() => Promise.resolve([])),
    removeDashboardGrant: vi.fn(() => Promise.resolve([])),
    createWidget: vi.fn(),
    updateWidget: vi.fn(() => Promise.resolve({})),
    deleteWidget: vi.fn(),
    createLayer: vi.fn(),
    updateLayer: vi.fn(),
    deleteLayer: vi.fn(),
  };
});

const captured: { ai: any; dynamicViews: any[] } = { ai: null, dynamicViews: [] };
vi.mock("./DashboardContext", async (orig) => {
  const actual = await orig<typeof import("./DashboardContext")>();
  return {
    ...actual,
    DashboardContextProvider: (p: any) => {
      captured.ai = p.ai;
      captured.dynamicViews = p.dynamicViews;
      return <actual.DashboardContextProvider {...p} />;
    },
  };
});

import DashboardsPage from "./DashboardsPage";
import {
  listDashboards, listWidgets, listViews, listDashboardTables, listDynamicViews,
  materializeDynamicView, materializeAiDynamicView, dropDynamicView, dropAiDynamicView,
} from "../api/client";

const dashboardId = 1;
const dashboard = {
  id: dashboardId, name: "Session Dashboard",
  created_at: "2026-07-09T00:00:00Z", updated_at: "2026-07-09T00:00:00Z",
  filter_display_mode: "topbar" as const,
};
const mk = (id: number, x: number, config: Record<string, unknown> = {}) => ({
  id, dashboard_id: dashboardId, title: `Saved ${id}`, type: "records", position: 0,
  config: { layout: { x, y: 0, w: 18, h: 24 }, ...config },
  created_at: "2026-07-09T00:00:00Z", updated_at: "2026-07-09T00:00:00Z",
});
const tripsTable = { id: 5, schema: "demo", name: "trips", columns: { vendor_id: "string", payment_type: "string", fare_amount: "double" }, created_at: "", updated_at: "" };
const savedDv = {
  id: 90, dashboard_id: dashboardId, source_table_id: 5, name: "Late trips", template_sql: "SELECT * FROM {view}",
  max_records: 10, columns_json: [{ name: "fare_amount", type: "double" }], created_at: "", updated_at: "",
};
const MAT = { status: "materialized", view_name: "ai_view_x", row_count: 3, expires_at: 9_999_999_999, columns: [{ name: "trips", type: "long" }], aggregated: true };
const dvSpec = { baseTableId: 5, groupBy: [{ column: "payment_type" }], aggregates: [{ fn: "count", as: "trips" }] };
const stamped = [{ name: "payment_type", type: "string" }, { name: "trips", type: "long" }];
const addDv = { op: "add_dynamic_view", tempId: -3, name: "Trips by type", spec: dvSpec, columns: stamped, maxRecords: 1000, aggregated: true };
const boundBar = (tempId: number, dv: number) => ({
  op: "add_widget", tempId, type: "bar", title: "dv bar",
  config: { dynamicViewId: dv, metric: "trips", aggregation: "sum", groupByColumn: "payment_type" },
});
const saved = [mk(11, 0), mk(12, 18)];
const baseline = (widgets: any[] = saved) => ({
  ...baselineFixture({ widgets: widgets as any, layers: [], dynamicViewIds: [90], dashboardId }),
  dynamicViewSources: { 90: 5 }, dynamicViewColumns: { 90: [{ name: "fare_amount", type: "double" }] }, dynamicViewNames: { 90: "Late trips" },
});
const turn = (ops: unknown[], widgets: any[] = saved) =>
  act(() => { useAiSessionStore.getState().applyTurn({ prompt: "t", ops }, baseline(widgets)); });

const openDashboard = async (widgets: any[] = saved) => {
  (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([dashboard]);
  (listDashboardTables as ReturnType<typeof vi.fn>).mockResolvedValue([tripsTable]);
  (listViews as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (listWidgets as ReturnType<typeof vi.fn>).mockResolvedValue(widgets);
  const utils = render(<DashboardsPage onViewChange={() => {}} />);
  await screen.findByText(dashboard.name);
  await userEvent.click(await screen.findByRole("button", { name: /^open$/i }));
  await screen.findByText(widgets[0].title);
  await waitFor(() => expect(captured.dynamicViews.map((d) => d.id)).toContain(90));
  return utils;
};

describe("DashboardsPage AI dynamic views (Phase 139 Plan 12)", () => {
  beforeEach(() => {
    seedDesignerStore();
    useAiSessionStore.getState().reset();
    useDynamicViewStore.getState().reset();
    __resetAiDvLifecycleForTest();
    captured.ai = null;
    captured.dynamicViews = [];
    vi.mocked(listDynamicViews).mockResolvedValue({ dynamic_views: [savedDv] } as any);
    vi.mocked(materializeDynamicView).mockResolvedValue({ status: "materialized", view_name: "v90", row_count: 1, expires_at: 9_999_999_999 } as any);
    vi.mocked(materializeAiDynamicView).mockReset();
    vi.mocked(materializeAiDynamicView).mockResolvedValue(MAT as any);
    vi.mocked(dropDynamicView).mockClear();
    vi.mocked(dropAiDynamicView).mockClear();
    try { localStorage.clear(); } catch { /* ignore */ }
  });

  it("DPDV-1: a session AI view is materialized through the merged chain and a widget bound to it is not orphaned", async () => {
    const w = [...saved];
    await openDashboard(w);
    turn([addDv, boundBar(-4, -3)], w);
    await waitFor(() => expect(materializeAiDynamicView).toHaveBeenCalled());
    const body = vi.mocked(materializeAiDynamicView).mock.calls[0][0] as any;
    expect(body.tempId).toBe(-3);
    expect(body.nonce).toBe(useAiSessionStore.getState().dvNonce);
    expect(captured.dynamicViews.map((d) => d.id)).toEqual([90, -3]);
    expect(screen.queryByText(/This dynamic view was deleted/)).toBeNull();
  });

  it("DPDV-2: the AI baseline lists SAVED views only, with their sources and columns", async () => {
    await openDashboard();
    turn([addDv]);
    const b = captured.ai.getBaseline();
    expect(b.dynamicViewIds).toEqual([90]);
    expect(b.dynamicViewSources).toEqual({ 90: 5 });
    expect(b.dynamicViewColumns).toEqual({ 90: [{ name: "fare_amount", type: "double" }] });
    expect(b.dynamicViewNames).toEqual({ 90: "Late trips" });
  });

  it("DPDV-3: the ask snapshot lists every effective view with base table, aggregated flag and columns, never the spec", async () => {
    await openDashboard();
    turn([addDv]);
    await waitFor(() => expect(captured.dynamicViews.map((d) => d.id)).toContain(-3));
    const snap = captured.ai.getSnapshot();
    const ai = snap.dynamicViews.find((d: any) => d.id === -3);
    expect(ai).toMatchObject({ name: "Trips by type", baseTableId: 5, aggregated: true, columns: stamped });
    const sv = snap.dynamicViews.find((d: any) => d.id === 90);
    expect(sv).toMatchObject({ name: "Late trips", baseTableId: 5, columns: [{ name: "fare_amount", type: "double" }] });
    expect(JSON.stringify(snap)).not.toContain("\"spec\"");
  });

  it("DPDV-4: an approved session removal of a saved view drops it from the dashboard view list", async () => {
    const w = [mk(11, 0), mk(12, 18, { dynamicViewId: 90 })];
    await openDashboard(w);
    act(() => useAiSessionStore.getState().approveRemoval());
    turn([{ op: "remove_dynamic_view", id: 90, repoint: { widgetIds: [12], layerIds: [], tableId: 5 } }], w);
    await waitFor(() => expect(captured.dynamicViews.map((d) => d.id)).not.toContain(90));
    expect(screen.queryByText(/This dynamic view was deleted/)).toBeNull();
  });

  it("DPDV-5: unmount drops the saved view via dropDynamicView and the AI view only via dropAiDynamicView", async () => {
    const utils = await openDashboard();
    turn([addDv]);
    await waitFor(() => expect(materializeAiDynamicView).toHaveBeenCalled());
    await waitFor(() => expect(useDynamicViewStore.getState().views[-3]?.status).toBe("materialized"));
    // saved view 90 takes the capped no_filter fast-path (over_threshold); seed a materialized entry directly.
    act(() => useDynamicViewStore.getState().setView(90, { viewName: "_kbi_dv_90", status: "materialized", expiresAt: Date.now() + 60000 }));
    utils.unmount();
    expect(dropDynamicView).toHaveBeenCalledTimes(1);
    expect(dropDynamicView).toHaveBeenCalledWith(90);
    expect(dropDynamicView).not.toHaveBeenCalledWith(-3);
    await waitFor(() => expect(dropAiDynamicView).toHaveBeenCalledTimes(1));
    expect((vi.mocked(dropAiDynamicView).mock.calls[0][0] as any).tempId).toBe(-3);
  });
});
