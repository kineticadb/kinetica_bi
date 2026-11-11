// Phase 151 Plan 03: a finished drag/resize of an AI item is a hand edit (markUserMoved); the keep bar follows undo.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { seedDesignerStore } from "../test/seedAuthStore";
import { useAiSessionStore, selectHasUnsavedAiChanges } from "../store/aiSessionStore";
import { undoAiOps } from "../lib/aiOps/undoAiOp";
import { useWidgetActionStore } from "../store/widgetActionStore";
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

vi.stubGlobal("ResizeObserver", vi.fn().mockImplementation(function (this: any, cb: ResizeObserverCallback) {
  this.observe = vi.fn((el: Element) => {
    cb([{ contentRect: { width: 1400, height: 600 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  });
  this.disconnect = vi.fn();
  this.unobserve = vi.fn();
  return this;
}));
vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
  matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
})));

vi.mock("ol/Map", () => ({
  default: vi.fn().mockImplementation(function MockMap(this: any) {
    this.setTarget = vi.fn(); this.dispose = vi.fn(); this.addLayer = vi.fn(); this.removeLayer = vi.fn();
    this.addInteraction = vi.fn(); this.removeInteraction = vi.fn();
    this.getView = vi.fn(() => ({ fit: vi.fn(), calculateExtent: vi.fn(() => [0, 0, 100, 100]), getResolution: vi.fn(() => 100) }));
    this.updateSize = vi.fn(); this.getSize = vi.fn(() => [800, 600]); this.getPixelFromCoordinate = vi.fn(() => [400, 300]);
    this.addOverlay = vi.fn(); this.removeOverlay = vi.fn(); this.on = vi.fn(); this.un = vi.fn();
    this.forEachFeatureAtPixel = vi.fn(() => undefined); this.getViewport = vi.fn(() => ({ style: { cursor: "" } }));
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

import DashboardsPage from "./DashboardsPage";
import { listDashboards, listWidgets, listViews, listDashboardTables } from "../api/client";

const dashboardId = 1;
const dashboard = {
  id: dashboardId, name: "Leave Dashboard",
  created_at: "2026-07-09T00:00:00Z", updated_at: "2026-07-09T00:00:00Z",
  filter_display_mode: "topbar" as const,
};
const saved = [{
  id: 50, dashboard_id: dashboardId, title: "Saved 50", type: "records", position: 0,
  config: { layout: { x: 0, y: 0, w: 18, h: 24 } },
  created_at: "2026-07-09T00:00:00Z", updated_at: "2026-07-09T00:00:00Z",
}];

const openDashboard = async () => {
  (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([dashboard]);
  (listDashboardTables as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (listViews as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (listWidgets as ReturnType<typeof vi.fn>).mockResolvedValue(saved);
  render(<DashboardsPage onViewChange={() => {}} />);
  await screen.findByText(dashboard.name);
  await userEvent.click(await screen.findByRole("button", { name: /^open$/i }));
  await screen.findByText("Saved 50");
};

const baseline = () => baselineFixture({ widgets: saved as any, layers: [], dynamicViewIds: [], dashboardId });
const addAi = () =>
  act(() => {
    useAiSessionStore.getState().applyTurn(
      { prompt: "t", answer: "ok", ops: [{ ...addWidgetOp(-1, "records", "AI rec"), layout: { x: 0, y: 30, w: 18, h: 24 } }], chat: { status: "ok", answerId: 7, followUps: [], applied: ["Add AI rec"] } },
      baseline(),
    );
  });
const grid = () => (globalThis as any).__gridProps;
const lgOf = () => grid().layouts.lg as any[];
const st = () => useAiSessionStore.getState();

describe("DashboardsPage AI undo hooks (Phase 151 Plan 03)", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    seedDesignerStore();
    st().reset();
    useWidgetActionStore.getState().reset?.();
    try { localStorage.clear(); } catch { /* ignore */ }
  });

  it("UNDOEDIT-1: drag-stop of an AI item marks it user-moved", async () => {
    await openDashboard();
    addAi();
    await screen.findByText("AI rec");
    act(() => grid().onDragStop(lgOf(), null, { i: "-1", x: 0, y: 40, w: 12, h: 20 }, null, new Event("mouseup")));
    expect(st().userMoved[-1]).toBe(true);
  });

  it("UNDOEDIT-2: a plain layout report (first placement) does not mark user-moved", async () => {
    await openDashboard();
    addAi();
    await screen.findByText("AI rec");
    act(() => grid().onLayoutChange(lgOf(), { lg: lgOf() }));
    expect(st().geometry[-1]).toBeDefined();
    expect(st().userMoved[-1]).toBeUndefined();
  });

  it("UNDOEDIT-3: resize-stop marks an AI item; saved and ghost ids never", async () => {
    await openDashboard();
    addAi();
    await screen.findByText("AI rec");
    act(() => grid().onResizeStop(lgOf(), null, { i: "50", x: 0, y: 0, w: 10, h: 10 }, null, new Event("mouseup")));
    expect(st().userMoved).toEqual({});
    act(() => {
      st().applyTurn(
        { prompt: "p", ops: [], chat: { status: "ok", answerId: 8, followUps: [], applied: [], proposal: { ops: [{ ...addWidgetOp(-2, "records", "Ghost"), layout: { x: 0, y: 60, w: 18, h: 24 } }], ticked: [0], status: "pending" } } },
        baseline(),
      );
    });
    await screen.findByText("Ghost");
    act(() => grid().onResizeStop(lgOf(), null, { i: "-2", x: 0, y: 60, w: 10, h: 10 }, null, new Event("mouseup")));
    expect(st().userMoved).toEqual({});
    act(() => grid().onResizeStop(lgOf(), null, { i: "-1", x: 0, y: 30, w: 10, h: 10 }, null, new Event("mouseup")));
    expect(st().userMoved[-1]).toBe(true);
  });

  it("UNDOEDIT-4: the keep bar goes away once the only change is undone", async () => {
    await openDashboard();
    addAi();
    await screen.findByText("AI rec");
    expect(document.querySelector(".ai-change-bar")).not.toBeNull();
    expect(selectHasUnsavedAiChanges(st())).toBe(true);
    act(() => undoAiOps([{ turnId: st().turns[0].id, entryIndex: 0 }], baseline()));
    await waitFor(() => expect(document.querySelector(".ai-change-bar")).toBeNull());
    expect(selectHasUnsavedAiChanges(st())).toBe(false);
  });
});
