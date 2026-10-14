// Phase 137 Plan 11 (AIWID-V20-01/02/04, AIGOV-V20-01, AISES-V20-04): DashboardsPage wiring for the
// AI Assistant widget: picker/duplicate gate, 12x40 add, Keep/Discard bar mount, shared AskContext,
// cancelAsk on leave. Harness mirrors DashboardsPage.aiLock.spec.tsx.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAuthStore } from "../store/auth";
import { PERMISSIONS } from "../lib/permissions";
import { useToastStore } from "../store/toast";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { seedDesignerStore } from "../test/seedAuthStore";
import { useAiSessionStore } from "../store/aiSessionStore";
import { useWidgetActionStore } from "../store/widgetActionStore";
import { useFilterStore } from "../store/filterStore";
import { baselineFixture, addWidgetOp } from "../test/aiSessionHarness";

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

vi.mock("../lib/aiSession/aiAvailability", () => ({ useAiConfigured: vi.fn(() => true) }));
import { useAiConfigured } from "../lib/aiSession/aiAvailability";
import { registerAllChartTypes } from "./charts/definitions";
import DashboardsPage from "./DashboardsPage";
import {
  listDashboards, listWidgets, listViews, listDashboardTables,
  createWidget, updateWidget, deleteWidget,
  createLayer, updateLayer, deleteLayer,
} from "../api/client";

const dashboardId = 1;
const dashboard = {
  id: dashboardId, name: "Session Dashboard",
  created_at: "2026-07-09T00:00:00Z", updated_at: "2026-07-09T00:00:00Z",
  filter_display_mode: "topbar" as const,
};
const mk = (id: number, x: number) => ({
  id, dashboard_id: dashboardId, title: `Saved ${id}`, type: "records", position: 0,
  config: { layout: { x, y: 0, w: 18, h: 24 } },
  created_at: "2026-07-09T00:00:00Z", updated_at: "2026-07-09T00:00:00Z",
});
const radio = {
  id: 13, dashboard_id: dashboardId, title: "Radio ctl", type: "radiogroup", position: 0,
  config: {
    layout: { x: 0, y: 24, w: 18, h: 8 },
    orientation: "vertical",
    options: [
      { id: "opt-a", label: "Option A", actions: [{ target: { kind: "widget", id: 11 }, configPatch: { page_size: 10 } }] },
      { id: "opt-b", label: "Option B", actions: [{ target: { kind: "widget", id: 11 }, configPatch: { page_size: 25 } }] },
    ],
  },
  created_at: "2026-07-09T00:00:00Z", updated_at: "2026-07-09T00:00:00Z",
};
const dashTable = { id: 42, schema: "demo", name: "trips", columns: { zone: "string" }, created_at: "", updated_at: "" };
const saved = [mk(11, 0), mk(12, 18)];
const baseline = (w: any[] = saved) => baselineFixture({ widgets: w as any, layers: [], dynamicViewIds: [], dashboardId });
const turn = (w: any[] = saved) =>
  act(() => { useAiSessionStore.getState().applyTurn({ prompt: "t", ops: [addWidgetOp(-1, "records", "AI records")] }, baseline(w)); });

const openDashboard = async (widgets: any[] = saved, tables: any[] = []) => {
  (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([dashboard]);
  (listDashboardTables as ReturnType<typeof vi.fn>).mockResolvedValue(tables);
  (listViews as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (listWidgets as ReturnType<typeof vi.fn>).mockResolvedValue(widgets);
  const utils = render(<DashboardsPage onViewChange={() => {}} />);
  await screen.findByText(dashboard.name);
  await userEvent.click(await screen.findByRole("button", { name: /^open$/i }));
  await screen.findByText(widgets[0].title);
  return utils;
};


const modalTitle = () => document.querySelector(".modal-title")?.textContent ?? "";
const grantAi = () =>
  useAuthStore.setState((s) => ({ user: { ...s.user!, permissions: [...s.user!.permissions, PERMISSIONS.AI_USE] } }));
const openPicker = async () => {
  await userEvent.click(screen.getByRole("button", { name: /^visualizations$/i }));
  await waitFor(() => expect(modalTitle()).toBe("Add Visualization"));
};
const pickerLabels = () => Array.from(document.querySelectorAll(".viz-picker-label")).map((e) => e.textContent);
const aiWidget = {
  id: 21, dashboard_id: dashboardId, title: "AI Assistant", type: "ai", position: 0,
  config: { layout: { x: 0, y: 24, w: 12, h: 40 } },
  created_at: "2026-07-09T00:00:00Z", updated_at: "2026-07-09T00:00:00Z",
};

describe("DashboardsPage AI widget wiring (Phase 137 Plan 11)", () => {
  beforeEach(() => {
    registerAllChartTypes();
    roReportedWidth = 1400;
    seedDesignerStore();
    useAiSessionStore.getState().reset();
    useFilterStore.getState().reset();
    vi.mocked(useAiConfigured).mockReset();
    vi.mocked(useAiConfigured).mockReturnValue(true);
    for (const m of [createWidget, updateWidget, deleteWidget]) vi.mocked(m).mockClear();
    vi.mocked(createWidget).mockImplementation(((_d: number, input: any) =>
      Promise.resolve({ id: 99, dashboard_id: dashboardId, position: 0, created_at: "", updated_at: "", ...input })) as any);
    try { localStorage.clear(); } catch { /* ignore */ }
  });

  it("DPAI-1: without ai:use the picker has no AI Assistant and AI availability is not requested", async () => {
    await openDashboard();
    await openPicker();
    expect(pickerLabels()).not.toContain("AI Assistant");
    expect(pickerLabels().length).toBeGreaterThan(3);
    expect(vi.mocked(useAiConfigured).mock.calls.every((c) => c[0] === false)).toBe(true);
  });

  it("DPAI-2: with ai:use on an AI-enabled server it is listed and adds a 12 x 40 ai widget", async () => {
    grantAi();
    await openDashboard();
    await openPicker();
    expect(pickerLabels()).toContain("AI Assistant");
    await userEvent.click(screen.getByText("AI Assistant"));
    await waitFor(() => expect(createWidget).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createWidget).mock.calls[0][1]).toEqual({
      title: "AI Assistant", type: "ai", config: { layout: { x: 0, y: 24, w: 12, h: 40 } },
    });
  });

  it("DPAI-3: with ai:use but AI not configured it is not listed", async () => {
    grantAi();
    vi.mocked(useAiConfigured).mockReturnValue(false);
    await openDashboard();
    await openPicker();
    expect(pickerLabels()).not.toContain("AI Assistant");
  });

  it("DPAI-4: duplicating an ai widget without ai:use is refused with a toast; a normal widget still duplicates", async () => {
    await openDashboard([...saved, aiWidget]);
    const dups = screen.getAllByLabelText("Duplicate widget");
    await userEvent.click(dups[dups.length - 1]);
    expect(createWidget).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts.some((t: any) => t.message === "You need the Use AI permission to add the AI assistant.")).toBe(true);
    await userEvent.click(screen.getAllByLabelText("Duplicate widget")[0]);
    await waitFor(() => expect(createWidget).toHaveBeenCalledTimes(1));
  });
});
