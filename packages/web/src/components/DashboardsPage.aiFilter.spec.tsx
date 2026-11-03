// Phase 138 Plan 07 (D-14): AI-applied filter chips show the "AI" tag at every column-chip site
// (top-bar table chips, top-bar dynamic-view chips, panel chips). Setup mirrors DashboardsPage.panel.spec.tsx.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { seedDesignerStore } from "../test/seedAuthStore";
import { useFilterStore } from "../store/filterStore";
import { useSpatialFilterStore } from "../store/spatialFilterStore";
import { useFilterHighlightStore } from "../store/filterHighlightStore";  // Phase 108 Plan 02

// ResizeObserver is used by ol/Map at construction time — stub it before any OL import
// (mirrors DashboardsPage.spec.tsx:15). Extended for Phase 107-02 bugfix: it now reports a
// configurable `contentRect.width` so react-grid-layout's useContainerWidth measures a real
// value (the panel-mode grid lives in a narrowed flex sibling). Default is a wide `lg` width
// so pre-existing tests are unaffected; the panel-mode layout test overrides it to a narrow
// value to exercise the breakpoint-pinning fix.
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
  };
});

import DashboardsPage from "./DashboardsPage";
import { listDashboards, listWidgets, listViews, listDashboardTables } from "../api/client";

const dashboardId = 1;
const tableId = 42;

// Every fixture EXPLICITLY sets filter_display_mode (Open Question #4 lock).
const panelDashboard = {
  id: dashboardId,
  name: "Panel Dashboard",
  created_at: "2026-07-09T00:00:00Z",
  updated_at: "2026-07-09T00:00:00Z",
  filter_display_mode: "panel" as const,
};
const topbarDashboard = {
  id: dashboardId,
  name: "Topbar Dashboard",
  created_at: "2026-07-09T00:00:00Z",
  updated_at: "2026-07-09T00:00:00Z",
  filter_display_mode: "topbar" as const,
};

const associatedTable = {
  id: tableId,
  name: "trips",
  schema: "demo",
  columns: { zone: "string" },
  created_at: "2026-07-09T00:00:00Z",
  updated_at: "2026-07-09T00:00:00Z",
};

const mapWidgetWithLatlonTarget = {
  id: 100,
  dashboard_id: dashboardId,
  title: "Map",
  type: "map",
  position: 0,
  config: {
    spatialTargets: [{ tableId, spatialMode: "latlon", lonCol: "lon", latCol: "lat" }],
  },
  created_at: "2026-07-09T00:00:00Z",
  updated_at: "2026-07-09T00:00:00Z",
};

const openDashboard = async (dashboard: typeof panelDashboard | typeof topbarDashboard, widgets: unknown[] = []) => {
  (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([dashboard]);
  (listDashboardTables as ReturnType<typeof vi.fn>).mockResolvedValue([associatedTable]);
  (listViews as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (listWidgets as ReturnType<typeof vi.fn>).mockResolvedValue(widgets);
  const utils = render(<DashboardsPage onViewChange={() => {}} />);
  await screen.findByText(dashboard.name);
  const openBtn = await screen.findByRole("button", { name: /^open$/i });
  await userEvent.click(openBtn);
  await waitFor(() => {
    expect(listWidgets).toHaveBeenCalled();
  });
  return utils;
};

describe("DashboardsPage AI filter chips (138-07)", () => {
  beforeEach(() => {
    roReportedWidth = 1400;
    seedDesignerStore();
    useFilterStore.getState().reset();
    useSpatialFilterStore.getState().reset();
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  const aiFilter = { column: "zone", value: "East", dataType: "string" as const, addedAt: 1, aiApplied: true };
  const userFilter = { column: "region", value: "West", dataType: "string" as const, addedAt: 2 };

  it("DASHF-1: top-bar table chip shows the AI tag only for the AI-applied filter", async () => {
    act(() => {
      useFilterStore.getState().addFilter(tableId, aiFilter);
      useFilterStore.getState().addFilter(tableId, userFilter);
    });
    await openDashboard(topbarDashboard, [mapWidgetWithLatlonTarget]);
    const aiChip = (await screen.findByText(/zone = 'East'/)).closest(".filter-bar-chip") as HTMLElement;
    expect(aiChip.querySelector(".widget-filter-badge")?.textContent).toBe("AI");
    const userChip = (await screen.findByText(/region = 'West'/)).closest(".filter-bar-chip") as HTMLElement;
    expect(userChip.querySelector(".widget-filter-badge")).toBeNull();
  });

  it("DASHF-2: top-bar dynamic-view chip shows the AI tag", async () => {
    act(() => {
      useFilterStore.getState().addDvFilter(90, aiFilter);
      useFilterStore.getState().addDvFilter(90, userFilter);
    });
    await openDashboard(topbarDashboard, [mapWidgetWithLatlonTarget]);
    const aiChip = (await screen.findByText(/zone = 'East'/)).closest(".filter-bar-chip") as HTMLElement;
    expect(aiChip.querySelector(".widget-filter-badge")?.textContent).toBe("AI");
    const userChip = (await screen.findByText(/region = 'West'/)).closest(".filter-bar-chip") as HTMLElement;
    expect(userChip.querySelector(".widget-filter-badge")).toBeNull();
  });

  it("DASHF-3: panel chip shows the AI tag and the AI provenance", async () => {
    act(() => {
      useFilterStore.getState().addFilter(tableId, aiFilter);
    });
    await openDashboard(panelDashboard, [mapWidgetWithLatlonTarget]);
    const chip = (await screen.findByText(/zone = 'East'/)).closest(".filter-panel-chip") as HTMLElement;
    expect(chip.querySelector(".widget-filter-badge")?.textContent).toBe("AI");
    expect(chip.textContent).toContain("from AI assistant");
  });
});
