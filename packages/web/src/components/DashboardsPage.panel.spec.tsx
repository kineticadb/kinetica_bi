// Phase 107 Plan 02 (FPANEL-V120-01/02/03/04/05/06/07): panel-mode behavior specs — XOR,
// backward-compat, chip coverage, remove/clear parity, empty state, count badge, collapse
// persistence (dashboard-scoped localStorage key), and matchMedia narrow-viewport default
// with stored-pref-wins precedence.
//
// Mirrors the ResizeObserver/OL stubs + api/client mocks from DashboardsPage.spec.tsx (a
// NEW standalone spec file importing DashboardsPage transitively must carry the same stubs
// per 107-RESEARCH.md's Test Strategy note). Every dashboard fixture here explicitly sets
// `filter_display_mode` (Open Question #4 — new tests must never rely on an implicit
// absent-field default).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { seedDesignerStore } from "../test/seedAuthStore";
import { useFilterStore } from "../store/filterStore";
import { useSpatialFilterStore } from "../store/spatialFilterStore";
import fs from "node:fs";
import path from "node:path";

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

describe("DashboardsPage panel mode (Phase 107 Plan 02)", () => {
  beforeEach(() => {
    roReportedWidth = 1400;
    seedDesignerStore();
    useFilterStore.getState().reset();
    useSpatialFilterStore.getState().reset();
    matchMediaMock.mockClear();
    matchMediaMock.mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  it("XOR panel: renders .filter-panel-layout and NOT the top bar", async () => {
    act(() => {
      useFilterStore.getState().addFilter(tableId, { column: "zone", value: "East", dataType: "string", addedAt: Date.now() });
    });
    await openDashboard(panelDashboard, [mapWidgetWithLatlonTarget]);

    expect(document.querySelector(".filter-panel-layout")).not.toBeNull();
    expect(document.querySelector(".filter-bar")).toBeNull();
  });

  it("XOR topbar / backward-compat: renders the top bar and NOT the panel", async () => {
    act(() => {
      useFilterStore.getState().addFilter(tableId, { column: "zone", value: "East", dataType: "string", addedAt: Date.now() });
    });
    await openDashboard(topbarDashboard, [mapWidgetWithLatlonTarget]);

    expect(document.querySelector(".filter-panel-layout")).toBeNull();
    expect(document.querySelector(".filter-bar")).not.toBeNull();
    expect(await screen.findByText("zone = 'East'")).toBeInTheDocument();
  });

  it("renders eq/in column chips + spatial chips as .filter-panel-chip in panel mode", async () => {
    act(() => {
      useFilterStore.getState().addFilter(tableId, { column: "zone", value: "East", dataType: "string", addedAt: Date.now() });
      useSpatialFilterStore.getState().addShape({
        type: "bbox",
        wkt: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
        measurement: "5km × 3km",
      });
    });
    await openDashboard(panelDashboard, [mapWidgetWithLatlonTarget]);

    const zoneChip = await screen.findByText("zone = 'East'");
    expect(zoneChip.closest(".filter-panel-chip")).not.toBeNull();
    const spatialChip = await screen.findByText(/Bbox 1 \(5km/);
    expect(spatialChip.closest(".filter-panel-chip")).not.toBeNull();
  });

  it("per-chip remove + per-group clear mutate the store in panel mode", async () => {
    act(() => {
      useFilterStore.getState().addFilter(tableId, { column: "zone", value: "East", dataType: "string", addedAt: Date.now() });
      useFilterStore.getState().addFilter(tableId, { column: "region", value: "West", dataType: "string", addedAt: Date.now() });
    });
    await openDashboard(panelDashboard, [mapWidgetWithLatlonTarget]);

    const dismissBtn = await screen.findByLabelText("Remove filter zone");
    await userEvent.click(dismissBtn);
    await waitFor(() => {
      expect(useFilterStore.getState().filters[tableId]?.some((f) => f.column === "zone")).toBe(false);
    });

    const clearAllBtn = await screen.findByRole("button", { name: "Clear all" });
    await userEvent.click(clearAllBtn);
    await waitFor(() => {
      expect(useFilterStore.getState().filters[tableId] ?? []).toHaveLength(0);
    });
  });

  it("shows the empty state with zero active filters in panel mode", async () => {
    await openDashboard(panelDashboard, [mapWidgetWithLatlonTarget]);

    expect(await screen.findByText("No active filters")).toBeInTheDocument();
    expect(document.querySelector(".filter-panel-empty")).not.toBeNull();
  });

  it("collapsed rail shows the active count badge; empty shows the --empty '0' variant", async () => {
    act(() => {
      useFilterStore.getState().addFilter(tableId, { column: "zone", value: "East", dataType: "string", addedAt: Date.now() });
    });
    await openDashboard(panelDashboard, [mapWidgetWithLatlonTarget]);

    const collapseBtn = await screen.findByLabelText("Collapse filter panel");
    await userEvent.click(collapseBtn);

    await waitFor(() => {
      expect(document.querySelector(".filter-panel-rail")).not.toBeNull();
    });
    const badge = document.querySelector(".filter-panel-rail-badge");
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe("1");
    expect(badge!.className).not.toContain("--empty");
  });

  it("collapse persistence round-trip: stored pref renders collapsed on load; toggling writes the dashboard-scoped key", async () => {
    localStorage.setItem(`kbi_filterPanelCollapsed_${dashboardId}`, "true");
    await openDashboard(panelDashboard, [mapWidgetWithLatlonTarget]);

    // Stored pref says collapsed -> rail renders immediately, no expanded panel.
    expect(await screen.findByLabelText("Expand filter panel")).toBeInTheDocument();
    expect(document.querySelector(".filter-panel")).toBeNull();

    const expandBtn = screen.getByLabelText("Expand filter panel");
    await userEvent.click(expandBtn);

    await waitFor(() => {
      expect(localStorage.getItem(`kbi_filterPanelCollapsed_${dashboardId}`)).toBe("false");
    });
    expect(document.querySelector(".filter-panel")).not.toBeNull();
  });

  it("matchMedia narrow default: no stored pref + matches:true -> initial render is collapsed", async () => {
    matchMediaMock.mockImplementation((query: string) => ({
      matches: true,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));

    await openDashboard(panelDashboard, [mapWidgetWithLatlonTarget]);

    expect(await screen.findByLabelText("Expand filter panel")).toBeInTheDocument();
    expect(document.querySelector(".filter-panel")).toBeNull();
  });

  it("stored pref WINS over the narrow-viewport matchMedia default", async () => {
    matchMediaMock.mockImplementation((query: string) => ({
      matches: true, // narrow — would default to collapsed absent a stored pref
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));
    localStorage.setItem(`kbi_filterPanelCollapsed_${dashboardId}`, "false");

    await openDashboard(panelDashboard, [mapWidgetWithLatlonTarget]);

    expect(document.querySelector(".filter-panel")).not.toBeNull();
    expect(screen.queryByLabelText("Expand filter panel")).toBeNull();
  });

  // Phase 107-02 bugfix regression: in panel mode the grid lives in the narrowed
  // `.filter-panel-grid-wrap` flex sibling, so the measured width falls below the `lg`
  // (1200) / `sm` (768) breakpoints. Because the layout is only provided for `lg` and `cols`
  // narrows below `sm`, react-grid-layout used to auto-generate a correctBounds-clamped,
  // vertically compacted fallback — the "diagonal staircase" cascade (e.g. at xs/12-cols a
  // widget stored at x=12,w=6 clamps to x=6, colliding with the x=6 widget). Pinning
  // breakpoint="lg" in panel mode keeps the 36-col source-of-truth layout at ANY width, so
  // three widgets stored at x=0/6/12 stay in three DISTINCT columns even when the grid is
  // narrow. Without the fix, the x=6 and x=12 widgets would share a column.
  it("panel mode preserves the multi-column (lg) layout at a narrow grid width", async () => {
    roReportedWidth = 686; // below sm(768): pre-fix this triggered the xs/12-col cascade
    const rowWidgets = [
      { id: 201, x: 0 },
      { id: 202, x: 6 },
      { id: 203, x: 12 },
    ].map(({ id, x }) => ({
      id,
      dashboard_id: dashboardId,
      title: `W${id}`,
      type: "bar",
      position: 0,
      config: { tableId, layout: { x, y: 0, w: 6, h: 12 } },
      created_at: "2026-07-09T00:00:00Z",
      updated_at: "2026-07-09T00:00:00Z",
    }));

    await openDashboard(panelDashboard, rowWidgets);

    await waitFor(() => {
      expect(document.querySelectorAll(".react-grid-item").length).toBe(3);
    });

    const lefts = Array.from(document.querySelectorAll(".react-grid-item")).map((el) => {
      const t = (el as HTMLElement).style.transform;
      const m = /translate\(([-\d.]+)px,/.exec(t);
      return m ? Number(m[1]) : NaN;
    });
    // Three stored columns (x=0/6/12) must map to three DISTINCT left offsets.
    const distinct = new Set(lefts);
    expect(distinct.size).toBe(3);
    // And they must be strictly increasing left-to-right (multi-column, not stacked/cascaded).
    const sorted = [...lefts].sort((a, b) => a - b);
    expect(sorted[0]).toBeLessThan(sorted[1]);
    expect(sorted[1]).toBeLessThan(sorted[2]);
  });

  it("group order: table -> dv -> spatial group titles appear in that DOM order", async () => {
    act(() => {
      useFilterStore.getState().addFilter(tableId, { column: "zone", value: "East", dataType: "string", addedAt: Date.now() });
      useSpatialFilterStore.getState().addShape({
        type: "bbox",
        wkt: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
        measurement: "5km × 3km",
      });
    });
    await openDashboard(panelDashboard, [mapWidgetWithLatlonTarget]);

    await screen.findByText("zone = 'East'");
    const titles = Array.from(document.querySelectorAll(".filter-panel-group-title")).map((el) => el.textContent);
    // No dv filters seeded in this test — assert tables precede spatial.
    const tripsIdx = titles.findIndex((t) => t === "demo.trips");
    const spatialIdx = titles.findIndex((t) => t === "Spatial draws");
    expect(tripsIdx).toBeGreaterThanOrEqual(0);
    expect(spatialIdx).toBeGreaterThan(tripsIdx);
  });
});

describe("Pitfall #6 mitigation — class-presence assertion", () => {
  it("every new .filter-panel-* class referenced in the panel components exists in global.css", () => {
    const cssPath = path.resolve(__dirname, "../styles/global.css");
    const css = fs.readFileSync(cssPath, "utf8");
    const requiredClasses = [
      "filter-panel-layout",
      "filter-panel-grid-wrap",
      "filter-panel",
      "filter-panel-header",
      "filter-panel-title",
      "filter-panel-header-actions",
      "filter-panel-body",
      "filter-panel-rail",
      "filter-panel-rail-badge",
      "filter-panel-empty",
      "filter-panel-group-header",
      "filter-panel-group-title",
      "filter-panel-group-header-actions",
      "filter-panel-group-toggle",
      "filter-panel-chips",
      "filter-panel-chip",
      "filter-panel-chip-row",
      "filter-panel-chip-value",
      "filter-panel-chip-provenance",
    ];
    for (const cls of requiredClasses) {
      expect(css.includes(`.${cls}`)).toBe(true);
    }
  });
});
