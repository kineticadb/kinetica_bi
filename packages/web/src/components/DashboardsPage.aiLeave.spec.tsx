// Phase 134 Plan 08 (AISES-V20-07): leave guard on the DashboardsPage paths (Back buttons, popstate,
// beforeunload). AILEAVE-1 and -5 are positive controls (clean session behaves as before).

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
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

import DashboardsPage from "./DashboardsPage";
import AiLeaveDialog from "./AiLeaveDialog";
import { listDashboards, listWidgets, listViews, listDashboardTables } from "../api/client";

const dashboardId = 1;
const dashboard = {
  id: dashboardId, name: "Leave Dashboard",
  created_at: "2026-07-09T00:00:00Z", updated_at: "2026-07-09T00:00:00Z",
  filter_display_mode: "topbar" as const,
};
const saved = [{
  id: 11, dashboard_id: dashboardId, title: "Saved 11", type: "records", position: 0,
  config: { layout: { x: 0, y: 0, w: 18, h: 24 } },
  created_at: "2026-07-09T00:00:00Z", updated_at: "2026-07-09T00:00:00Z",
}];
const turn = () =>
  act(() => {
    useAiSessionStore.getState().applyTurn(
      { prompt: "t", ops: [addWidgetOp(-1, "records", "AI records")] },
      baselineFixture({ widgets: saved as any, layers: [], dynamicViewIds: [], dashboardId }),
    );
  });

const ui = (onViewChange: (m: string) => void = () => {}) => (
  <>
    <DashboardsPage onViewChange={onViewChange} />
    <AiLeaveDialog />
  </>
);

const openDashboard = async (wrap?: (n: React.ReactElement) => React.ReactElement, onViewChange?: (m: string) => void) => {
  (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([dashboard]);
  (listDashboardTables as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (listViews as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (listWidgets as ReturnType<typeof vi.fn>).mockResolvedValue(saved);
  const utils = render(wrap ? wrap(ui(onViewChange)) : ui(onViewChange));
  await screen.findByText(dashboard.name);
  await userEvent.click(await screen.findByRole("button", { name: /^open$/i }));
  await screen.findByText("Saved 11");
  return utils;
};

const dialog = () => screen.queryByRole("dialog");
const simulateBrowserBack = () =>
  act(async () => {
    window.history.replaceState(null, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
const listShown = () => screen.findByRole("button", { name: /^open$/i });

describe("DashboardsPage AI leave guard (Phase 134 Plan 08)", () => {
  beforeEach(() => {
    roReportedWidth = 1400;
    window.history.replaceState(null, "", "/");
    seedDesignerStore();
    useAiSessionStore.getState().reset();
    useWidgetActionStore.getState().reset?.();
    try { localStorage.clear(); } catch { /* ignore */ }
  });

  it("AILEAVE-1: clean session, toolbar Back goes straight to the list, no dialog", async () => {
    await openDashboard();
    await userEvent.click(screen.getByRole("button", { name: /^back$/i }));
    await listShown();
    expect(dialog()).toBeNull();
  });

  it("AILEAVE-2: dirty, Back shows the dialog; Stay keeps the dashboard and the turns", async () => {
    await openDashboard();
    turn();
    await userEvent.click(screen.getByRole("button", { name: /^back$/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^open$/i })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^stay$/i }));
    expect(dialog()).toBeNull();
    expect(screen.getByRole("button", { name: /^back$/i })).toBeInTheDocument();
    expect(useAiSessionStore.getState().turns.length).toBe(1);
  });

  it("AILEAVE-3: dirty, Back then Discard and leave returns to the list with the session cleared", async () => {
    await openDashboard();
    turn();
    await userEvent.click(screen.getByRole("button", { name: /^back$/i }));
    await userEvent.click(await screen.findByRole("button", { name: /discard and leave/i }));
    await listShown();
    expect(useAiSessionStore.getState().turns).toHaveLength(0);
    expect(Object.keys(useWidgetActionStore.getState().contributions)).not.toContain("0");
  });

  it("AILEAVE-4: dirty, browser Back restores ?dashboard=<id>, keeps the dashboard and shows the dialog; Discard leaves", async () => {
    await openDashboard();
    expect(window.location.search).toBe("?dashboard=1");
    turn();
    await simulateBrowserBack();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(window.location.search).toContain("dashboard=1");
    expect(screen.queryByRole("button", { name: /^open$/i })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /discard and leave/i }));
    await listShown();
    expect(useAiSessionStore.getState().turns).toHaveLength(0);
  });

  it("AILEAVE-5: clean, browser Back returns to the list with no dialog", async () => {
    await openDashboard();
    await simulateBrowserBack();
    await listShown();
    expect(dialog()).toBeNull();
  });

  it("AILEAVE-6: beforeunload is cancelled only while AI changes are unsaved", async () => {
    await openDashboard();
    const fire = () => {
      const ev = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    expect(fire()).toBe(false);
    turn();
    expect(fire()).toBe(true);
    act(() => useAiSessionStore.getState().reset());
    expect(fire()).toBe(false);
  });

  it("AILEAVE-7: under StrictMode exactly one beforeunload listener is live while dirty, none when clean", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const live = () =>
      add.mock.calls.filter((c) => c[0] === "beforeunload").length -
      remove.mock.calls.filter((c) => c[0] === "beforeunload").length;
    await openDashboard((n) => <React.StrictMode>{n}</React.StrictMode>);
    expect(live()).toBe(0);
    turn();
    expect(live()).toBe(1);
    act(() => useAiSessionStore.getState().reset());
    expect(live()).toBe(0);
    add.mockRestore();
    remove.mockRestore();
  });
});
