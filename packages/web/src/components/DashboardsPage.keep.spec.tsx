// Phase 141 Plan 13 (AISES-V20-05/06): DashboardsPage Keep glue. Save posts a body built from page state,
// the four lists swap to the server rows, the bar disappears. Harness copied from DashboardsPage.aiWidget.spec.tsx.

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
import { baselineFixture, addWidgetOp, setTitleOp } from "../test/aiSessionHarness";
import { useDashboardVersionStore } from "../store/dashboardVersionStore";

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
    keepAiChanges: vi.fn(),
  };
});

vi.mock("../lib/aiSession/askRunner", async (orig) => {
  const actual = await orig<typeof import("../lib/aiSession/askRunner")>();
  return { ...actual, cancelAsk: vi.fn() };
});
vi.mock("../lib/aiSession/aiAvailability", () => ({ useAiConfigured: vi.fn(() => true) }));
import { registerAllChartTypes } from "./charts/definitions";
import DashboardsPage from "./DashboardsPage";
import {
  listDashboards, listWidgets, listViews, listDashboardTables, listDashboardLayers, listDynamicViews, keepAiChanges,
} from "../api/client";

const dashboardId = 1;
const dashboard = {
  id: dashboardId, name: "Keep Dashboard",
  created_at: "2026-07-09T00:00:00Z", updated_at: "2026-07-09T00:00:00Z",
  filter_display_mode: "topbar" as const,
};
const mk = (id: number, x: number, title = `Saved ${id}`) => ({
  id, dashboard_id: dashboardId, title, type: "records", position: 0,
  config: { layout: { x, y: 0, w: 18, h: 24 } },
  created_at: "2026-07-09T00:00:00Z", updated_at: "2026-07-09T00:00:00Z",
});
const saved = [mk(11, 0), mk(12, 18)];
const baseline = () => baselineFixture({ widgets: saved as any, layers: [], dynamicViewIds: [], dashboardId });
const turn = () =>
  act(() => {
    useAiSessionStore.getState().applyTurn(
      { prompt: "t", ops: [addWidgetOp(-1, "records", "AI records"), setTitleOp(11, "Renamed 11")] },
      baseline(),
    );
  });
const gridItems = (): any[] => (globalThis as any).__gridProps.layouts.lg;
const mocked = (f: unknown) => f as ReturnType<typeof vi.fn>;

const openDashboard = async () => {
  mocked(listDashboards).mockResolvedValue([dashboard]);
  mocked(listDashboardTables).mockResolvedValue([]);
  mocked(listViews).mockResolvedValue([]);
  mocked(listWidgets).mockResolvedValue(saved);
  render(<DashboardsPage onViewChange={() => {}} />);
  await screen.findByText(dashboard.name);
  await userEvent.click(await screen.findByRole("button", { name: /^open$/i }));
  await screen.findByText("Saved 11");
};

describe("DashboardsPage Keep glue (Phase 141 Plan 13)", () => {
  beforeEach(() => {
    registerAllChartTypes();
    roReportedWidth = 1400;
    seedDesignerStore();
    useAiSessionStore.getState().reset();
    useFilterStore.getState().reset();
    useDashboardVersionStore.getState().clear(dashboardId);
    for (const l of ["widgets", "layers", "dynamic-views", "tables"] as const) useDashboardVersionStore.getState().noteRead(dashboardId, l, 7);
    mocked(keepAiChanges).mockReset();
    try { localStorage.clear(); } catch { /* ignore */ }
  });

  const clickKeepThenSave = async () => {
    await userEvent.click(screen.getByRole("button", { name: "Keep" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
  };
  const okKeep = () =>
    mocked(keepAiChanges).mockResolvedValue({
      ok: true,
      response: { idMap: { widgets: { "-1": 31 }, layers: {}, dynamicViews: {} }, version: 9, warnings: [] },
    });
  const serverRows = () => [mk(11, 0, "Renamed 11"), mk(12, 18), mk(31, 36, "AI records")];

  it("KPAGE-1: Save posts a body built from page state", async () => {
    await openDashboard();
    turn();
    await screen.findByText("AI records");
    const shown = gridItems().find((i) => i.i === "-1");
    okKeep();
    await clickKeepThenSave();
    await waitFor(() => expect(keepAiChanges).toHaveBeenCalledTimes(1));
    const [id, body] = mocked(keepAiChanges).mock.calls[0];
    expect(id).toBe(dashboardId);
    expect(body.baselineVersion).toBe(7);
    expect(body.widgets.add).toHaveLength(1);
    expect(body.widgets.add[0].tempId).toBe(-1);
    expect(body.widgets.add[0].rect).toEqual({ x: shown.x, y: shown.y, w: shown.w, h: shown.h });
    const edit = body.widgets.edit.find((e: any) => e.id === 11);
    expect(edit.title).toBe("Renamed 11");
  });

  it("KPAGE-2: on success the four lists are refetched and swapped to the server rows", async () => {
    await openDashboard();
    turn();
    await screen.findByText("AI records");
    okKeep();
    mocked(listWidgets).mockResolvedValue(serverRows());
    const before = [listWidgets, listDashboardLayers, listDashboardTables, listDynamicViews].map((f) => mocked(f).mock.calls.length);
    await clickKeepThenSave();
    await waitFor(() => expect(gridItems().some((i) => i.i === "31")).toBe(true));
    expect(gridItems().some((i) => i.i === "-1")).toBe(false);
    const after = [listWidgets, listDashboardLayers, listDashboardTables, listDynamicViews].map((f) => mocked(f).mock.calls.length);
    after.forEach((n, k) => expect(n).toBeGreaterThan(before[k]));
  });

  it("KPAGE-3: the bar disappears and the chat note is archived", async () => {
    await openDashboard();
    turn();
    await screen.findByText("AI records");
    okKeep();
    mocked(listWidgets).mockResolvedValue(serverRows());
    await clickKeepThenSave();
    await waitFor(() => expect(document.querySelector(".ai-change-bar")).toBeNull());
    const notes = useAiSessionStore.getState().savedTurns.filter((i) => i.kind === "note") as { text: string }[];
    expect(notes.map((n) => n.text)).toContain("Changes saved.");
    expect(useAiSessionStore.getState().keepBlocked).toBeNull();
  });
});
