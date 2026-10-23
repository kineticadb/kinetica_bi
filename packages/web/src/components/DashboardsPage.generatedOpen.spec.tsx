// Phase 142 Plan 07 (AIGEN-V20-01/02): open-dashboard half of Generate. Harness copied from DashboardsPage.keep.spec.tsx.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAuthStore } from "../store/auth";
import { PERMISSIONS } from "../lib/permissions";
import { useToastStore } from "../store/toast";
import { render, screen, waitFor, act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { seedDesignerStore } from "../test/seedAuthStore";
import { useAiSessionStore } from "../store/aiSessionStore";
import { useWidgetActionStore } from "../store/widgetActionStore";
import { useFilterStore } from "../store/filterStore";
import { baselineFixture, addWidgetOp } from "../test/aiSessionHarness";
import { placeGenerateBands } from "@kinetica-bi/shared";
import { AI_CHAT_COPY } from "../lib/aiSession/chatText";
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
    this.getView = vi.fn(() => ({ fit: vi.fn(), getCenter: vi.fn(() => [0, 0]), getZoom: vi.fn(() => 2), calculateExtent: vi.fn(() => [0, 0, 100, 100]), getResolution: vi.fn(() => 100) }));
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
    discardGeneratedDashboard: vi.fn(() => Promise.resolve()),
  };
});

vi.mock("../lib/aiSession/askRunner", async (orig) => {
  const actual = await orig<typeof import("../lib/aiSession/askRunner")>();
  return { ...actual, cancelAsk: vi.fn() };
});
vi.mock("../lib/aiSession/aiAvailability", () => ({ useAiConfigured: vi.fn(() => true) }));
import { registerAllChartTypes } from "./charts/definitions";
import DashboardsPage from "./DashboardsPage";
import AiLeaveDialog from "./AiLeaveDialog";
import {
  listDashboards, listWidgets, listViews, listDashboardTables, listDashboardLayers, listDynamicViews, keepAiChanges, updateWidget, discardGeneratedDashboard,
} from "../api/client";

const dashboardId = 1;
const base = {
  id: dashboardId, name: "Generated Dashboard",
  created_at: "2026-07-09T00:00:00Z", updated_at: "2026-07-09T00:00:00Z",
  filter_display_mode: "topbar" as const,
};
const pendingDash = { ...base, generated_pending: true };
const keptDash = { ...base, generated_pending: false };
const aiRect = { x: 24, y: 0, w: 12, h: 40 };
const aiRow = {
  id: 10, dashboard_id: dashboardId, title: "AI Assistant", type: "ai", position: 0,
  config: { layout: aiRect },
  created_at: "2026-07-09T00:00:00Z", updated_at: "2026-07-09T00:00:00Z",
};
const saved = [aiRow];
const baseline = () => baselineFixture({ widgets: saved as any, layers: [], dynamicViewIds: [], dashboardId });
const NOTE = "This generated dashboard isn't kept yet";
const SIX = [
  { tempId: -1, id: 31, type: "bignumber" }, { tempId: -2, id: 32, type: "bignumber" }, { tempId: -3, id: 33, type: "line" },
  { tempId: -4, id: 34, type: "bar" }, { tempId: -5, id: 35, type: "map" }, { tempId: -6, id: 36, type: "records" },
];
const bands = placeGenerateBands(SIX.map((w) => ({ key: w.id, type: w.type })));
const serverSix = () =>
  SIX.map((w) => ({
    id: w.id, dashboard_id: dashboardId, title: `Gen ${w.id}`, type: w.type, position: 0,
    config: { layout: bands[w.id] },
    created_at: "2026-07-09T00:00:00Z", updated_at: "2026-07-09T00:00:00Z",
  }));
const turnOne = () =>
  act(() => {
    useAiSessionStore.getState().applyTurn({ prompt: "t", ops: [addWidgetOp(-1, "records", "AI records")] }, baseline());
  });
const turnSix = () =>
  act(() => {
    useAiSessionStore.getState().applyTurn(
      { prompt: "t", ops: SIX.map((w) => addWidgetOp(w.tempId, w.type, `Gen ${w.id}`)) },
      baseline(),
    );
  });
const gridItems = (): any[] => (globalThis as any).__gridProps.layouts.lg;
const mocked = (f: unknown) => f as ReturnType<typeof vi.fn>;

const openDashboard = async (dash: Record<string, unknown> = pendingDash) => {
  mocked(listDashboards).mockResolvedValue([dash]);
  mocked(listDashboardTables).mockResolvedValue([]);
  mocked(listViews).mockResolvedValue([]);
  mocked(listWidgets).mockResolvedValue(saved);
  render(<><DashboardsPage onViewChange={() => {}} /><AiLeaveDialog /></>);
  await screen.findByText(new RegExp(base.name));
  await userEvent.click(await screen.findByRole("button", { name: /^open$/i }));
  await waitFor(() => expect(gridItems().some((i) => i.i === "10")).toBe(true));
};
const listShown = () => screen.findByText(/\+ New Dashboard/);
const note = () => screen.queryByText(new RegExp(NOTE));

describe("DashboardsPage generated-open (Phase 142 Plan 07)", () => {
  beforeEach(() => {
    registerAllChartTypes();
    roReportedWidth = 1400;
    window.history.replaceState(null, "", "/");
    seedDesignerStore();
    useAiSessionStore.getState().reset();
    useFilterStore.getState().reset();
    useDashboardVersionStore.getState().clear(dashboardId);
    for (const l of ["widgets", "layers", "dynamic-views", "tables"] as const) useDashboardVersionStore.getState().noteRead(dashboardId, l, 7);
    mocked(keepAiChanges).mockReset();
    mocked(discardGeneratedDashboard).mockClear();
    mocked(updateWidget).mockClear();
    try { localStorage.clear(); } catch { /* ignore */ }
  });

  const okKeep = () =>
    mocked(keepAiChanges).mockResolvedValue({
      ok: true,
      response: {
        idMap: { widgets: Object.fromEntries(SIX.map((w) => [String(w.tempId), w.id])), layers: {}, dynamicViews: {} },
        version: 9, warnings: [],
      },
    });
  const clickKeepThenSave = async () => {
    await userEvent.click(screen.getByRole("button", { name: "Keep" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
  };
  const confirmGeneratedDiscard = async () => {
    const d = await screen.findByRole("dialog");
    expect(d.textContent).toContain("Discard this dashboard?");
    await userEvent.click(within(d).getByRole("button", { name: "Discard" }));
  };

  it("GENOPEN-1: the pending note shows only for a generated_pending dashboard", async () => {
    await openDashboard();
    expect(note()).not.toBeNull();
  });

  it("GENOPEN-1b: no note when generated_pending is absent", async () => {
    await openDashboard(base);
    expect(note()).toBeNull();
  });

  it("GENOPEN-2: the note hides while AI changes exist (one bar at a time)", async () => {
    await openDashboard();
    turnOne();
    await screen.findByText("Unsaved AI changes", { exact: false });
    expect(note()).toBeNull();
  });

  it("GENOPEN-3: change-bar Discard opens the generated dialog, deletes server-side, returns to the list", async () => {
    await openDashboard();
    turnOne();
    await userEvent.click(await screen.findByRole("button", { name: "Discard" }));
    await confirmGeneratedDiscard();
    await listShown();
    expect(discardGeneratedDashboard).toHaveBeenCalledTimes(1);
    expect(discardGeneratedDashboard).toHaveBeenCalledWith(dashboardId);
    expect(window.location.search).not.toContain("dashboard=");
    expect(screen.queryByText(new RegExp(base.name))).toBeNull();
  });

  it("GENOPEN-4: the pending note Discard does the same with no AI changes", async () => {
    await openDashboard();
    await userEvent.click(screen.getByRole("button", { name: "Discard dashboard" }));
    await confirmGeneratedDiscard();
    await listShown();
    expect(discardGeneratedDashboard).toHaveBeenCalledWith(dashboardId);
    expect(screen.queryByText(new RegExp(base.name))).toBeNull();
  });

  it("GENOPEN-5: a plain leave never deletes the unkept dashboard", async () => {
    await openDashboard();
    turnOne();
    await userEvent.click(screen.getByRole("button", { name: /^back$/i }));
    await userEvent.click(await screen.findByRole("button", { name: /discard and leave/i }));
    await listShown();
    expect(discardGeneratedDashboard).not.toHaveBeenCalled();
    expect(screen.getByText(/Not kept yet/)).toBeTruthy();
  });

  it("GENOPEN-6: Keep clears pending via one listDashboards refetch; later Discard is the ordinary dialog", async () => {
    await openDashboard();
    turnSix();
    await screen.findByText("Unsaved AI changes", { exact: false });
    okKeep();
    mocked(listWidgets).mockResolvedValue([aiRow, ...serverSix()]);
    mocked(listDashboards).mockClear();
    mocked(listDashboards).mockResolvedValue([keptDash]);
    await clickKeepThenSave();
    await waitFor(() => expect(gridItems().some((i) => i.i === "31")).toBe(true));
    await waitFor(() => expect(listDashboards).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(document.querySelector(".ai-change-bar")).toBeNull());
    expect(note()).toBeNull();
    act(() => {
      useAiSessionStore.getState().applyTurn({ prompt: "u", ops: [addWidgetOp(-9, "records", "More")] }, baselineFixture({ widgets: [aiRow, ...serverSix()] as any, layers: [], dynamicViewIds: [], dashboardId }));
    });
    await userEvent.click(await screen.findByRole("button", { name: "Discard" }));
    const d = await screen.findByRole("dialog");
    expect(d.textContent).toContain(AI_CHAT_COPY.discardTitle);
    expect(d.textContent).not.toContain("Discard this dashboard?");
    expect(note()).toBeNull();
  });

  it("GENOPEN-7: RGL regression after Keep of a generated widget list", async () => {
    await openDashboard();
    turnSix();
    await screen.findByText("Unsaved AI changes", { exact: false });
    okKeep();
    mocked(listWidgets).mockResolvedValue([aiRow, ...serverSix()]);
    mocked(listDashboards).mockResolvedValue([keptDash]);
    await clickKeepThenSave();
    await waitFor(() => expect(gridItems().some((i) => i.i === "31")).toBe(true));
    mocked(updateWidget).mockClear();
    act(() => {
      (globalThis as any).__gridProps.onLayoutChange([
        { i: "10", x: 24, y: 0, w: 12, h: 40 },
        ...SIX.map((w, k) => ({ i: String(w.tempId), x: 0, y: k * 10, w: 12, h: 10 })),
      ]);
    });
    expect(updateWidget).not.toHaveBeenCalled();
    const kids = ([] as any[]).concat((globalThis as any).__gridProps.children).flat().filter(Boolean);
    expect(kids.length).toBe(7);
    for (const k of kids) {
      const rect = k.key === "10" ? aiRect : bands[Number(k.key)];
      expect(rect).toBeTruthy();
      expect(k.props["data-grid"]).toMatchObject(rect);
      expect(k.props["data-grid"].w).toBeGreaterThan(1);
      expect(k.props["data-grid"].h).toBeGreaterThan(1);
    }
  });

  it("GENOPEN-8: an ordinary dashboard keeps the 137 dialog and Keep does not refetch dashboards", async () => {
    await openDashboard(keptDash);
    turnOne();
    mocked(listDashboards).mockClear();
    await userEvent.click(await screen.findByRole("button", { name: "Discard" }));
    const d = await screen.findByRole("dialog");
    expect(d.textContent).toContain(AI_CHAT_COPY.discardTitle);
    await userEvent.click(within(d).getByRole("button", { name: "Cancel" }));
    okKeep();
    mocked(listWidgets).mockResolvedValue([aiRow, ...serverSix()]);
    await clickKeepThenSave();
    await waitFor(() => expect(document.querySelector(".ai-change-bar")).toBeNull());
    expect(listDashboards).not.toHaveBeenCalled();
    expect(discardGeneratedDashboard).not.toHaveBeenCalled();
  });
});
