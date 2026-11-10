// Phase 150 Plan 05 (APPROVE-V22-02): dimmed ghost cards for a pending AI proposal. Ghosts are never counted, locked, persisted or sent in a snapshot.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { seedDesignerStore } from "../test/seedAuthStore";
import { useAiSessionStore, selectHasUnsavedAiChanges } from "../store/aiSessionStore";
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
const ui = (onViewChange: (m: string) => void = () => {}) => (
  <>
    <DashboardsPage onViewChange={onViewChange} />
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


const pending = () =>
  act(() => {
    useAiSessionStore.getState().applyTurn(
      {
        prompt: "t",
        ops: [],
        chat: {
          status: "ok", answerId: 7, followUps: [], applied: [],
          proposal: { ops: [{ ...addWidgetOp(-1, "records", "Ghost rec", { tableId: 5 }), layout: { x: 0, y: 30, w: 18, h: 24 } }], ticked: [0], status: "pending" },
        },
      },
      baselineFixture({ widgets: saved as any, layers: [], dynamicViewIds: [], dashboardId }),
    );
  });
const turnId = () => useAiSessionStore.getState().turns[0].id;

describe("DashboardsPage proposal ghosts (Phase 150 Plan 05)", () => {
  beforeEach(() => {
    roReportedWidth = 1400;
    window.history.replaceState(null, "", "/");
    seedDesignerStore();
    useAiSessionStore.getState().reset();
    useWidgetActionStore.getState().reset?.();
    try { localStorage.clear(); } catch { /* ignore */ }
  });

  it("APPRGHOST-7: a ticked added chart renders as a dimmed Proposed card and nothing is counted or locked", async () => {
    await openDashboard();
    pending();
    const card = (await screen.findByText("Ghost rec")).closest(".widget-card") as HTMLElement;
    expect(card.className).toContain("widget-card--proposed");
    expect(within(card).getByText("Proposed")).toBeInTheDocument();
    expect(screen.queryByText(/AI changes?\b/i)).toBeNull();
    expect(selectHasUnsavedAiChanges(useAiSessionStore.getState())).toBe(false);
    expect(useAiSessionStore.getState().derived.addedWidgets).toEqual([]);
    const ghostItem = (globalThis as any).__gridProps.layouts.lg.find((l: any) => l.i === "-1");
    expect(ghostItem.static).toBe(true);
  });

  it("APPRGHOST-8: unticking or rejecting removes the ghost", async () => {
    await openDashboard();
    pending();
    await screen.findByText("Ghost rec");
    act(() => toggleProposalTick(turnId(), 0, false));
    await waitFor(() => expect(screen.queryByText("Ghost rec")).toBeNull());
    act(() => toggleProposalTick(turnId(), 0, true));
    await screen.findByText("Ghost rec");
    act(() => useAiSessionStore.getState().setProposal(turnId(), { status: "rejected", ops: [] }));
    await waitFor(() => expect(screen.queryByText("Ghost rec")).toBeNull());
  });

  it("APPRGHOST-9: a layout report that includes the ghost never reaches session geometry", async () => {
    await openDashboard();
    pending();
    await screen.findByText("Ghost rec");
    const lg = (globalThis as any).__gridProps.layouts.lg as any[];
    expect(lg.some((l) => l.i === "-1")).toBe(true);
    act(() => (globalThis as any).__gridProps.onLayoutChange(lg, { lg }));
    expect(useAiSessionStore.getState().geometry[-1]).toBeUndefined();
  });
});
