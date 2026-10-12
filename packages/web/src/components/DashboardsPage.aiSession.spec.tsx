// Phase 134 Plan 05 (AISES-V20-01/07): DashboardsPage session-layer integration specs.
// react-grid-layout's ResponsiveGridLayout is mocked so the spec can capture props and call
// onLayoutChange directly (jsdom cannot drag). AISESS-1 is the positive control proving the
// mocked grid reaches the real handler.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { seedDesignerStore } from "../test/seedAuthStore";
import { useAiSessionStore } from "../store/aiSessionStore";
import { useWidgetActionStore } from "../store/widgetActionStore";
import { baselineFixture, addWidgetOp, removeWidgetOp } from "../test/aiSessionHarness";

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
    createDashboardLayer: vi.fn(),
    updateDashboardLayer: vi.fn(),
    deleteDashboardLayer: vi.fn(),
  };
});

import DashboardsPage from "./DashboardsPage";
import {
  listDashboards, listWidgets, listViews, listDashboardTables,
  createWidget, updateWidget, deleteWidget,
  createDashboardLayer, updateDashboardLayer, deleteDashboardLayer,
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
const saved = [mk(11, 0), mk(12, 18)];
const gp = () => (globalThis as any).__gridProps;
const items = () => gp().layouts.lg as any[];
const baseline = () => baselineFixture({ widgets: saved as any, layers: [], dynamicViewIds: [], dashboardId });
const turn = (ops: unknown[]) =>
  act(() => { useAiSessionStore.getState().applyTurn({ prompt: "t", ops }, baseline()); });

const openDashboard = async () => {
  (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([dashboard]);
  (listDashboardTables as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (listViews as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (listWidgets as ReturnType<typeof vi.fn>).mockResolvedValue(saved);
  const utils = render(<DashboardsPage onViewChange={() => {}} />);
  await screen.findByText(dashboard.name);
  await userEvent.click(await screen.findByRole("button", { name: /^open$/i }));
  await screen.findByText("Saved 11");
  return utils;
};

describe("DashboardsPage AI session layer (Phase 134 Plan 05)", () => {
  beforeEach(() => {
    roReportedWidth = 1400;
    seedDesignerStore();
    useAiSessionStore.getState().reset();
    vi.mocked(updateWidget).mockClear();
    try { localStorage.clear(); } catch { /* ignore */ }
  });

  it("AISESS-1 (positive control): without a session a moved saved widget is persisted", async () => {
    await openDashboard();
    const layout = items().map((i) => (i.i === "11" ? { ...i, y: 30 } : i));
    act(() => gp().onLayoutChange(layout));
    expect(updateWidget).toHaveBeenCalledTimes(1);
    expect((updateWidget as any).mock.calls[0][0]).toBe(11);
  });

  it("AISESS-2: a turn shows the AI widget immediately with no API writes", async () => {
    await openDashboard();
    turn([addWidgetOp(-1, "records", "AI records")]);
    expect(await screen.findByText("AI records")).toBeTruthy();
    for (const m of [createWidget, updateWidget, deleteWidget, createDashboardLayer, updateDashboardLayer, deleteDashboardLayer]) {
      expect(m).not.toHaveBeenCalled();
    }
  });

  it("AISESS-3: saved items are static while locked and layout changes are not persisted", async () => {
    await openDashboard();
    turn([addWidgetOp(-1, "records", "AI records")]);
    const byId = (id: string) => items().find((i) => i.i === id);
    expect(byId("11").static).toBe(true);
    expect(byId("12").static).toBe(true);
    expect(byId("-1").static).not.toBe(true);
    const layout = items().map((i) =>
      i.i === "11" ? { ...i, y: 30 } : i.i === "-1" ? { ...i, x: 0, y: 48, w: 12, h: 20 } : i);
    act(() => gp().onLayoutChange(layout));
    expect(updateWidget).not.toHaveBeenCalled();
    expect(useAiSessionStore.getState().geometry[-1]).toEqual({ x: 0, y: 48, w: 12, h: 20 });
    expect(gp().dragConfig.enabled).toBe(true);
  });

  it("AISESS-4: a new AI widget without geometry is placed below all saved content", async () => {
    await openDashboard();
    turn([addWidgetOp(-1, "records", "AI records")]);
    const ai = items().find((i) => i.i === "-1");
    expect(ai).toMatchObject({ x: 0, y: 24, w: 18, h: 24 });
  });

  it("AISESS-5: reset restores saved widgets and layout exactly", async () => {
    await openDashboard();
    const before = JSON.parse(JSON.stringify(items()));
    turn([addWidgetOp(-1, "records", "AI records"), removeWidgetOp(12)]);
    expect(screen.queryByText("Saved 12")).toBeNull();
    act(() => useAiSessionStore.getState().reset());
    expect(screen.getByText("Saved 12")).toBeTruthy();
    expect(screen.queryByText("AI records")).toBeNull();
    expect(JSON.parse(JSON.stringify(items()))).toEqual(before);
    expect(items().some((i) => "static" in i)).toBe(false);
    expect(Object.keys(useWidgetActionStore.getState().contributions)).not.toContain("0");
  });

  it("AISESS-6: leaving the dashboard clears the session", async () => {
    const { unmount } = await openDashboard();
    turn([addWidgetOp(-1, "records", "AI records")]);
    act(() => useAiSessionStore.getState().setGeometry(-1, { x: 0, y: 48, w: 12, h: 20 }));
    unmount();
    expect(useAiSessionStore.getState().turns).toEqual([]);
    expect(useAiSessionStore.getState().geometry).toEqual({});
  });

  it("AISESS-7: dev harness is installed while open and removed on unmount", async () => {
    const { unmount } = await openDashboard();
    await waitFor(() => expect((window as any).__kbiAiHarness).toBeDefined());
    act(() => { (window as any).__kbiAiHarness.addWidget("records", "Harness widget"); });
    expect(await screen.findByText("Harness widget")).toBeTruthy();
    unmount();
    expect((window as any).__kbiAiHarness).toBeUndefined();
  });
});
