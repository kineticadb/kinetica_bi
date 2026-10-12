// Phase 134 Plan 07 (AISES-V20-01/07): edit lock while AI changes are unsaved. Every blocked entry
// point is a PAIR (unlocked half proves the control works; locked half proves it is blocked).
// AILOCK-NEG-* pin the D-08 allowed interactions.


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
const LOCK_TITLE = "Keep or discard the AI changes first";
const TOOLBAR: Array<[string, RegExp, RegExp]> = [
  ["AILOCK-1 Tables", /^tables$/i, /Manage Dashboard Tables/],
  ["AILOCK-2 Dynamic Views", /^dynamic views$/i, /^Dynamic Views$/],
  ["AILOCK-3 Map Layers", /^map layers$/i, /^Map Layers$/],
  ["AILOCK-4 Visualizations", /^visualizations$/i, /Add Visualization/],
  ["AILOCK-5 Settings", /^settings$/i, /Dashboard Settings/],
];

describe("DashboardsPage AI edit lock (Phase 134 Plan 07)", () => {
  beforeEach(() => {
    roReportedWidth = 1400;
    seedDesignerStore();
    useAiSessionStore.getState().reset();
    useFilterStore.getState().reset();
    for (const m of [createWidget, updateWidget, deleteWidget, createLayer, updateLayer, deleteLayer]) vi.mocked(m).mockClear();
    vi.mocked(createWidget).mockImplementation(((_d: number, input: any) =>
      Promise.resolve({ id: 99, dashboard_id: dashboardId, position: 0, created_at: "", updated_at: "", ...input })) as any);
    vi.mocked(deleteWidget).mockImplementation((() => Promise.resolve({})) as any);
    try { localStorage.clear(); } catch { /* ignore */ }
  });

  for (const [name, btnRe, modalRe] of TOOLBAR) {
    it(`${name}: enabled and opens its modal; locked it is disabled with a tooltip and does not open`, async () => {
      await openDashboard();
      const btn = () => screen.getByRole("button", { name: btnRe });
      expect(btn()).toBeEnabled();
      await userEvent.click(btn());
      await waitFor(() => expect(modalTitle()).toMatch(modalRe));
      await userEvent.click(screen.getAllByRole("button", { name: /^close$/i })[0]);
      await waitFor(() => expect(modalTitle()).toBe(""));

      turn();
      expect(await screen.findByText("AI records")).toBeTruthy();
      expect(btn()).toBeDisabled();
      expect(btn().getAttribute("title")).toBe(LOCK_TITLE);
      await userEvent.click(btn());
      expect(modalTitle()).toBe("");
    });
  }

  it("AILOCK-6: widget gear present unlocked; absent when locked (also on the AI widget)", async () => {
    await openDashboard();
    expect(screen.getAllByTitle("Configure").length).toBeGreaterThanOrEqual(2);
    turn();
    await screen.findByText("AI records");
    expect(screen.queryAllByTitle("Configure")).toHaveLength(0);
  });

  it("AILOCK-7: duplicate calls createWidget unlocked; absent and not called when locked", async () => {
    const first = await openDashboard();
    await userEvent.click(screen.getAllByLabelText("Duplicate widget")[0]);
    await waitFor(() => expect(createWidget).toHaveBeenCalledTimes(1));
    first.unmount();
    vi.mocked(createWidget).mockClear();
    useAiSessionStore.getState().reset();
    await openDashboard();
    turn();
    await screen.findByText("AI records");
    expect(screen.queryAllByLabelText("Duplicate widget")).toHaveLength(0);
    expect(createWidget).not.toHaveBeenCalled();
  });

  it("AILOCK-8: remove calls deleteWidget unlocked; absent and not called when locked", async () => {
    const first = await openDashboard();
    await userEvent.click(screen.getAllByTitle("Remove")[0]);
    await waitFor(() => expect(deleteWidget).toHaveBeenCalledTimes(1));
    first.unmount();
    vi.mocked(deleteWidget).mockClear();
    useAiSessionStore.getState().reset();
    await openDashboard();
    turn();
    await screen.findByText("AI records");
    expect(screen.queryAllByTitle("Remove")).toHaveLength(0);
    expect(deleteWidget).not.toHaveBeenCalled();
  });

  it("AILOCK-9a: an open Visualizations modal closes when the lock engages", async () => {
    await openDashboard();
    await userEvent.click(screen.getByRole("button", { name: /^visualizations$/i }));
    await waitFor(() => expect(modalTitle()).toBe("Add Visualization"));
    turn();
    await waitFor(() => expect(modalTitle()).toBe(""));
  });

  it("AILOCK-9b: an open widget config modal closes when the lock engages", async () => {
    await openDashboard();
    await userEvent.click(screen.getAllByTitle("Configure")[0]);
    await waitFor(() => expect(modalTitle()).toMatch(/^Configure: /));
    turn();
    await waitFor(() => expect(modalTitle()).toBe(""));
  });

  it("AILOCK-10: notice appears only while locked; reset re-enables every toolbar button", async () => {
    await openDashboard();
    expect(screen.queryByText(/editing is locked/i)).toBeNull();
    turn();
    const notice = await screen.findByRole("status");
    expect(notice.textContent).toMatch(/editing is locked/i);
    act(() => useAiSessionStore.getState().reset());
    await waitFor(() => expect(screen.queryByText(/editing is locked/i)).toBeNull());
    for (const [, re] of TOOLBAR) expect(screen.getByRole("button", { name: re })).toBeEnabled();
  });

  it("AILOCK-NEG-1 (D-08): Back stays enabled while locked", async () => {
    await openDashboard();
    turn();
    await screen.findByText("AI records");
    expect(screen.getByRole("button", { name: /^back$/i })).toBeEnabled();
  });

  it("AILOCK-NEG-2 (D-08): a radio option click still dispatches while locked", async () => {
    const w = [...saved, radio];
    await openDashboard(w);
    turn(w);
    await screen.findByText("AI records");
    await userEvent.click(await screen.findByLabelText("Option B"));
    await waitFor(() => expect(Object.keys(useWidgetActionStore.getState().contributions)).toContain("13"));
  });

  it("AILOCK-NEG-3 (D-08): a filter chip dismiss still works while locked", async () => {
    act(() => {
      useFilterStore.getState().addFilter(42, {
        column: "zone", value: "East", dataType: "string", sourceWidgetId: 1, addedAt: Date.now(),
      });
    });
    await openDashboard(saved, [dashTable]);
    turn();
    await screen.findByText("AI records");
    await userEvent.click(await screen.findByLabelText("Remove filter zone"));
    await waitFor(() => expect(useFilterStore.getState().filters[42] ?? []).toHaveLength(0));
  });
});
