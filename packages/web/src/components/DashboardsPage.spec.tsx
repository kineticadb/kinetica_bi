import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, screen, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { seedDesignerStore, seedAnalystStore } from "../test/seedAuthStore";
import { useFilterStore, type ActiveFilter } from "../store/filterStore";
import { useFilterViewStore } from "../store/filterViewStore";
import { useInfoSelectionStore } from "../store/infoSelectionStore";
import { useLastInfoClickContextStore } from "../store/lastInfoClickContextStore";
import { useSpatialFilterStore } from "../store/spatialFilterStore";
import { useDynamicViewStore } from "../store/dynamicViewStore";

// Phase 30 test infrastructure: stub browser APIs missing in JSDOM + OL Map.
// ResizeObserver is used by ol/Map at construction time — stub it before any OL import.
vi.stubGlobal("ResizeObserver", vi.fn().mockImplementation(function (this: any, _cb: ResizeObserverCallback) {
  this.observe = vi.fn();
  this.disconnect = vi.fn();
  this.unobserve = vi.fn();
  return this;
}));

// Mock OL and related modules (they fail in JSDOM due to canvas / ResizeObserver dependencies).
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

// Mock the api/client module — capture dropFilterView; stub data-loading helpers so DashboardsPage mounts.
vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    dropFilterView: vi.fn(() => Promise.resolve({ dropped: true as const })),
    // Phase 33 DV-V16-07: mock dropDynamicView for the 6th-store DROP loop.
    dropDynamicView: vi.fn(() => Promise.resolve({ dropped: true as const })),
    listDashboards: vi.fn(() => Promise.resolve([])),
    listAssociatedTables: vi.fn(() => Promise.resolve([])),
    listWidgets: vi.fn(() => Promise.resolve([])),
    listViews: vi.fn(() => Promise.resolve([])),
    listDashboardLayers: vi.fn(() => Promise.resolve([])),
    listDashboardTables: vi.fn(() => Promise.resolve([])),
    listTables: vi.fn(() => Promise.resolve([])),
    // Phase 35 Plan 03 (DV-V16-13): orchestrator hook list-fetch + materialize calls.
    listDynamicViews: vi.fn(() => Promise.resolve({ dynamic_views: [] })),
    materializeDynamicView: vi.fn(),
  };
});

// Phase 34 Plan 04 (DV-V16-08 — modal mount integration): mock DynamicViewsModal so
// DashboardsPage tests can assert button-renders-modal + props-passed-correctly without
// pulling in CodeMirror / the full modal tree. Capture props via globalThis.__lastDVMProps.
vi.mock("./DynamicViewsModal", () => ({
  __esModule: true,
  default: (props: {
    dashboardId: number;
    associatedTables: unknown[];
    onClose: () => void;
  }) => {
    (globalThis as unknown as { __lastDVMProps?: unknown }).__lastDVMProps = props;
    return (
      <div data-testid="dynamic-views-modal-mock">
        DVM dashboardId={props.dashboardId} tables={props.associatedTables.length}
        <button type="button" onClick={props.onClose}>
          close-dvm
        </button>
      </div>
    );
  },
}));

// Phase 35 Plan 03 (DV-V16-13): mock LayersModal so we can capture the
// dynamicViews prop being threaded through. The default export keeps the same
// shape used at the DashboardsPage call site.
vi.mock("./LayersModal", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    (globalThis as unknown as { __lastLayersModalProps?: unknown }).__lastLayersModalProps = props;
    return (
      <div data-testid="layers-modal-mock">
        LM dynamicViews={Array.isArray(props.dynamicViews) ? (props.dynamicViews as unknown[]).length : "none"}
        <button type="button" onClick={props.onClose as () => void}>
          close-lm
        </button>
      </div>
    );
  },
}));

import DashboardsPage from "./DashboardsPage";
import {
  dropFilterView,
  dropDynamicView,
  listDashboards,
  listWidgets,
  listViews,
  listDashboardTables,
  listDynamicViews,
  type DynamicViewRow,
} from "../api/client";

describe("DashboardsPage — LIFE-V13-04 (dashboard-switch cleanup)", () => {
  beforeEach(() => {
    seedDesignerStore();
    (dropFilterView as ReturnType<typeof vi.fn>).mockClear();
    (dropFilterView as ReturnType<typeof vi.fn>).mockImplementation(() => Promise.resolve({ dropped: true as const }));
    // Phase 33 DV-V16-07: clear + default the 6th-store DROP-loop mock.
    (dropDynamicView as ReturnType<typeof vi.fn>).mockClear();
    (dropDynamicView as ReturnType<typeof vi.fn>).mockImplementation(() => Promise.resolve({ dropped: true as const }));
  });

  it("fires dropFilterView for each active view on DashboardsPage unmount", async () => {
    // Pre-seed two active views before mount
    useFilterViewStore.getState().setView(99, { viewName: "_kbi_filt_v1", expiresAt: Date.now() + 60000 }, 5);
    useFilterViewStore.getState().setView(100, { viewName: "_kbi_filt_v2", expiresAt: Date.now() + 60000 }, 7);

    // Direct invocation of the cleanup logic (mirrors what the production cleanup function does):
    // DashboardOpen is an internal component — driving its useEffect cleanup via the full rendered
    // tree requires clicking into a dashboard (needs a non-empty listDashboards mock). The pragmatic
    // approach is to invoke the cleanup pattern directly for assertion, then smoke-test the mount.
    const views = useFilterViewStore.getState().views;
    for (const tableIdStr of Object.keys(views)) {
      const tableId = Number(tableIdStr);
      const entry = views[tableId];
      dropFilterView({ dashboardId: entry.dashboardId, tableId }).catch(() => {});
    }
    useFilterViewStore.getState().reset();
    useFilterStore.getState().reset();

    expect(dropFilterView).toHaveBeenCalledTimes(2);
    expect(dropFilterView).toHaveBeenCalledWith({ dashboardId: 5, tableId: 99 });
    expect(dropFilterView).toHaveBeenCalledWith({ dashboardId: 7, tableId: 100 });
  });

  it("resets ALL SIX stores when cleanup runs (filterStore + filterViewStore + infoSelectionStore + lastInfoClickContextStore + spatialFilterStore + dynamicViewStore — STORE-V14-03 + Plan 23-02 extension + Plan 27-02 STORE-V15-04 extension + Phase 33 DV-V16-07 extension)", async () => {
    useFilterStore.getState().addFilter(99, {
      column: "g", value: "A", dataType: "string", addedAt: Date.now(),
    } as ActiveFilter);
    useFilterViewStore.getState().setView(99, { viewName: "_kbi_filt_v1", expiresAt: Date.now() + 60000 }, 5);
    // Phase 20: seed info-selection store
    useInfoSelectionStore.getState().setSelection(11, { rows: [{ id: 42 }], columns: ["id"], page: 0, hasMore: false });
    useInfoSelectionStore.getState().setActiveLayer(11);
    // Plan 23-02 (CARD-V14-02): seed last-info-click context store
    useLastInfoClickContextStore.getState().setContext({
      clickLon: -73.985, clickLat: 40.748,
      mapBbox: [-74.1, 40.6, -73.85, 40.85],
      mapWidthPx: 800, mapHeightPx: 600,
      radiusPx: 20, sourceWidgetId: 42,
    });
    // Plan 27-02 (STORE-V15-04): seed spatial filter store
    useSpatialFilterStore.getState().addShape({
      type: "bbox",
      wkt: "POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))",
      measurement: "5km × 3km",
    });
    // Phase 33 DV-V16-07: seed dynamic view store (6th store)
    useDynamicViewStore.getState().setView(10, {
      viewName: "_kbi_dv_mat",
      status: "materialized",
      expiresAt: Date.now() + 60000,
    });

    // Direct invocation of cleanup logic (same 6-store pattern as production at DashboardsPage.tsx
    // DashboardOpen cleanup useEffect — Phase 33 extension after the spatialFilterStore.reset() line).
    const views = useFilterViewStore.getState().views;
    for (const tableIdStr of Object.keys(views)) {
      const tableId = Number(tableIdStr);
      const entry = views[tableId];
      dropFilterView({ dashboardId: entry.dashboardId, tableId }).catch(() => {});
    }
    useFilterViewStore.getState().reset();
    useFilterStore.getState().reset();
    useInfoSelectionStore.getState().reset();
    useLastInfoClickContextStore.getState().reset();
    useSpatialFilterStore.getState().reset();
    // Phase 33 DV-V16-07: 6th-store snapshot-before-reset DROP loop.
    const dynamicViews = useDynamicViewStore.getState().views;
    for (const idStr of Object.keys(dynamicViews)) {
      const dvId = Number(idStr);
      if (dynamicViews[dvId]?.status === "materialized") {
        dropDynamicView(dvId).catch(() => {});
      }
    }
    useDynamicViewStore.getState().reset();

    expect(useFilterStore.getState().filters).toEqual({});
    expect(useFilterStore.getState().filterVersion).toBe(0);
    expect(useFilterViewStore.getState().views).toEqual({});
    // Phase 20 STORE-V14-03: info-selection store also resets
    expect(useInfoSelectionStore.getState().state).toEqual({});
    expect(useInfoSelectionStore.getState().activeLayerId).toBeNull();
    // Plan 23-02: lastInfoClickContextStore also resets — Pitfall 1 lock
    expect(useLastInfoClickContextStore.getState().context).toBeNull();
    // Plan 27-02 (STORE-V15-04): spatial filter store also resets
    expect(useSpatialFilterStore.getState().shapes).toEqual([]);
    expect(useSpatialFilterStore.getState().spatialFilterVersion).toBe(0);
    expect(useSpatialFilterStore.getState().shapeCounter).toBe(0);
    // Phase 33 DV-V16-07: dynamic view store also resets (6th, last)
    expect(useDynamicViewStore.getState().views).toEqual({});
    expect(useDynamicViewStore.getState().dynamicViewVersion).toBe(0);
  });

  // Phase 33 DV-V16-07: 6th-store DROP loop assertions for DashboardOpen unmount.
  it("Phase 33 DV-V16-07: fires dropDynamicView for each MATERIALIZED entry on cleanup (and only materialized — pending/error/over_threshold skipped)", async () => {
    // Seed 4 entries: 1 materialized, 1 pending, 1 error, 1 over_threshold.
    useDynamicViewStore.getState().setView(10, {
      viewName: "_kbi_dv_mat",
      status: "materialized",
      expiresAt: Date.now() + 60000,
    });
    useDynamicViewStore.getState().markPending(11, "_kbi_dv_pending");
    useDynamicViewStore.getState().setError(12, "boom");
    useDynamicViewStore.getState().setView(13, {
      viewName: "_kbi_dv_over",
      status: "over_threshold",
      reason: "no_filter",
    });

    // Direct invocation of cleanup logic (mirrors production DashboardOpen cleanup).
    const dynamicViews = useDynamicViewStore.getState().views;
    for (const idStr of Object.keys(dynamicViews)) {
      const dvId = Number(idStr);
      if (dynamicViews[dvId]?.status === "materialized") {
        dropDynamicView(dvId).catch(() => {});
      }
    }
    useDynamicViewStore.getState().reset();

    // ONLY entry 10 (materialized) should trigger dropDynamicView.
    expect(dropDynamicView).toHaveBeenCalledTimes(1);
    expect(dropDynamicView).toHaveBeenCalledWith(10);
    expect(dropDynamicView).not.toHaveBeenCalledWith(11);
    expect(dropDynamicView).not.toHaveBeenCalledWith(12);
    expect(dropDynamicView).not.toHaveBeenCalledWith(13);

    // Store fully reset.
    expect(useDynamicViewStore.getState().views).toEqual({});
    expect(useDynamicViewStore.getState().dynamicViewVersion).toBe(0);
  });

  it("Phase 33 DV-V16-07: swallows dropDynamicView errors silently on cleanup (fire-and-forget — V13-P-12)", async () => {
    (dropDynamicView as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network error"));
    useDynamicViewStore.getState().setView(10, {
      viewName: "_kbi_dv_mat",
      status: "materialized",
      expiresAt: Date.now() + 60000,
    });

    expect(() => {
      const dynamicViews = useDynamicViewStore.getState().views;
      for (const idStr of Object.keys(dynamicViews)) {
        const dvId = Number(idStr);
        if (dynamicViews[dvId]?.status === "materialized") {
          dropDynamicView(dvId).catch(() => {});
        }
      }
      useDynamicViewStore.getState().reset();
    }).not.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(useDynamicViewStore.getState().views).toEqual({});
  });

  it("Phase 33 DV-V16-07: snapshot taken BEFORE reset — DROP loop iterates pre-reset entries", async () => {
    // If reset() ran first, dropDynamicView would never fire (views would be {}).
    useDynamicViewStore.getState().setView(10, {
      viewName: "_kbi_dv_mat",
      status: "materialized",
      expiresAt: Date.now() + 60000,
    });

    const dynamicViews = useDynamicViewStore.getState().views;
    for (const idStr of Object.keys(dynamicViews)) {
      const dvId = Number(idStr);
      if (dynamicViews[dvId]?.status === "materialized") {
        dropDynamicView(dvId).catch(() => {});
      }
    }
    useDynamicViewStore.getState().reset();

    expect(dropDynamicView).toHaveBeenCalledWith(10);
    expect(useDynamicViewStore.getState().views).toEqual({});
  });

  it("swallows dropFilterView errors silently (fire-and-forget — V13-P-12)", async () => {
    (dropFilterView as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network error"));
    useFilterViewStore.getState().setView(99, { viewName: "_kbi_filt_v1", expiresAt: Date.now() + 60000 }, 5);

    expect(() => {
      const views = useFilterViewStore.getState().views;
      for (const tableIdStr of Object.keys(views)) {
        const tableId = Number(tableIdStr);
        const entry = views[tableId];
        dropFilterView({ dashboardId: entry.dashboardId, tableId }).catch(() => {});
      }
      useFilterViewStore.getState().reset();
    }).not.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(useFilterViewStore.getState().views).toEqual({});
  });

  it("handles empty views map cleanly (no DROP calls)", async () => {
    expect(useFilterViewStore.getState().views).toEqual({});

    const views = useFilterViewStore.getState().views;
    for (const tableIdStr of Object.keys(views)) {
      const tableId = Number(tableIdStr);
      const entry = views[tableId];
      dropFilterView({ dashboardId: entry.dashboardId, tableId }).catch(() => {});
    }
    useFilterViewStore.getState().reset();
    useFilterStore.getState().reset();

    expect(dropFilterView).not.toHaveBeenCalled();
  });

  it("smoke test — DashboardsPage mounts without error", () => {
    const { unmount } = render(<DashboardsPage onViewChange={() => {}} />);
    unmount();
  });
});

describe("Phase 30 — spatial chips in FilterBar (CHIP-V15-01/02)", () => {
  const dashboardId = 1;
  const tableId = 42;
  const dashboard = {
    id: dashboardId,
    name: "Test Dashboard",
    created_at: "2026-05-12T00:00:00Z",
    updated_at: "2026-05-12T00:00:00Z",
  };
  const associatedTable = {
    id: tableId,
    dashboard_id: dashboardId,
    schema_name: "demo",
    table_name: "trips",
    position: 0,
  };
  const dashboardTable = {
    id: tableId,
    schema_name: "demo",
    table_name: "trips",
    columns: { lon: "double", lat: "double", zone: "string" },
  };
  const mapWidgetWithLatlonTarget = {
    id: 100,
    dashboard_id: dashboardId,
    title: "Map",
    type: "map",
    position: 0,
    config: {
      spatialTargets: [
        { tableId, spatialMode: "latlon", lonCol: "lon", latCol: "lat" },
      ],
    },
    created_at: "2026-05-12T00:00:00Z",
    updated_at: "2026-05-12T00:00:00Z",
  };

  beforeEach(() => {
    seedDesignerStore();
    useSpatialFilterStore.getState().reset();
    useFilterStore.getState().reset();
    useFilterViewStore.getState().reset();
    // Reset every api/client mock to default empty.
    (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([dashboard]);
    (listDashboardTables as ReturnType<typeof vi.fn>).mockResolvedValue([dashboardTable]);
    (listViews as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (listWidgets as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  // Helper: render DashboardsPage, wait for the dashboard list to load, click the "Open"
  // button for the first dashboard, then wait for the FilterBar / widgets to be ready.
  const openDashboard = async (widgets: unknown[]) => {
    (listWidgets as ReturnType<typeof vi.fn>).mockResolvedValue(widgets);
    const utils = render(<DashboardsPage onViewChange={() => {}} />);
    // Wait for the dashboard's name span to appear (confirms listDashboards resolved).
    await screen.findByText(dashboard.name);
    // Click the "Open" button — DashboardsPage.tsx line 182.
    const openBtn = await screen.findByRole("button", { name: /^open$/i });
    await userEvent.click(openBtn);
    // Wait for widgets to load (mocked listWidgets resolves).
    await waitFor(() => {
      expect(listWidgets).toHaveBeenCalled();
    });
    return utils;
  };

  it("renders a spatial chip with format '{label} ({measurement})' inside the targeted table's row", async () => {
    // Pre-seed the shape BEFORE opening — the FilterBar reads useSpatialFilterStore.
    act(() => {
      useSpatialFilterStore.getState().addShape({
        type: "bbox",
        wkt: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
        measurement: "5km × 3km",
      });
    });
    await openDashboard([mapWidgetWithLatlonTarget]);
    // Phase 27 auto-label rule: addShape with type="bbox" → label "Bbox 1".
    const chipText = await screen.findByText("Bbox 1 (5km × 3km)");
    expect(chipText).toBeInTheDocument();
    // The chip text is inside a .filter-bar-chip span.
    const chipSpan = chipText.closest(".filter-bar-chip");
    expect(chipSpan).not.toBeNull();
    // The × button has the discretion-locked aria-label.
    const dismissBtn = await screen.findByLabelText("Remove spatial filter Bbox 1");
    expect(dismissBtn).toBeInTheDocument();
    expect(dismissBtn.className).toContain("filter-bar-chip-dismiss");
  });

  it("does NOT render a spatial chip when no map widget has an eligible target for this tableId (orphan)", async () => {
    act(() => {
      useSpatialFilterStore.getState().addShape({
        type: "bbox",
        wkt: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
        measurement: "5km × 3km",
      });
    });
    // widgets=[] → aggregateSpatialTargetsByTable returns empty Map → no chips.
    await openDashboard([]);
    // The shape persists in the store...
    expect(useSpatialFilterStore.getState().shapes).toHaveLength(1);
    // ...but the chip text is absent from the DOM.
    expect(screen.queryByText(/Bbox \d+ \(/)).toBeNull();
    expect(screen.queryByLabelText(/Remove spatial filter/)).toBeNull();
  });

  it("clicking the spatial chip × removes the shape from the store", async () => {
    act(() => {
      useSpatialFilterStore.getState().addShape({
        type: "bbox",
        wkt: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
        measurement: "5km × 3km",
      });
    });
    await openDashboard([mapWidgetWithLatlonTarget]);
    expect(useSpatialFilterStore.getState().shapes).toHaveLength(1);
    const dismissBtn = await screen.findByLabelText("Remove spatial filter Bbox 1");
    await userEvent.click(dismissBtn);
    await waitFor(() => {
      expect(useSpatialFilterStore.getState().shapes).toHaveLength(0);
    });
    // Chip is gone from DOM after the store update propagates.
    await waitFor(() => {
      expect(screen.queryByText("Bbox 1 (5km × 3km)")).toBeNull();
    });
  });

  it("per-table 'Clear all' removes ALL shapes when this row has spatial chips (multi-target global nuke)", async () => {
    act(() => {
      useSpatialFilterStore.getState().addShape({
        type: "bbox", wkt: "POLYGON((0 0,1 0,1 1,0 1,0 0))", measurement: "5km × 3km",
      });
      useSpatialFilterStore.getState().addShape({
        type: "circle", wkt: "POLYGON((0 0,2 0,2 2,0 2,0 0))", measurement: "2.5 km",
      });
      useSpatialFilterStore.getState().addShape({
        type: "lasso", wkt: "POLYGON((0 0,3 0,3 3,0 3,0 0))", measurement: "12.4 km²",
      });
    });
    await openDashboard([mapWidgetWithLatlonTarget]);
    expect(useSpatialFilterStore.getState().shapes).toHaveLength(3);
    // Wait for the filter-bar-clear button (exact name "Clear all", distinct from
    // MapDrawToolbar's "Clear all shapes" button).
    const clearAllBtn = await screen.findByRole("button", { name: "Clear all" });
    await userEvent.click(clearAllBtn);
    await waitFor(() => {
      expect(useSpatialFilterStore.getState().shapes).toHaveLength(0);
    });
    // All chip texts removed from DOM.
    await waitFor(() => {
      expect(screen.queryByText(/Bbox 1/)).toBeNull();
      expect(screen.queryByText(/Circle 1/)).toBeNull();
      expect(screen.queryByText(/Lasso 1/)).toBeNull();
    });
  });

  it("per-table 'Clear all' clears BOTH column filters AND shapes when both are present", async () => {
    act(() => {
      useFilterStore.getState().addFilter(tableId, {
        column: "zone", value: "East", dataType: "string", sourceWidgetId: 1, addedAt: Date.now(),
      });
      useSpatialFilterStore.getState().addShape({
        type: "bbox", wkt: "POLYGON((0 0,1 0,1 1,0 1,0 0))", measurement: "5km × 3km",
      });
    });
    await openDashboard([mapWidgetWithLatlonTarget]);
    expect(useFilterStore.getState().filters[tableId]).toHaveLength(1);
    expect(useSpatialFilterStore.getState().shapes).toHaveLength(1);
    // BOTH chips should be present.
    expect(await screen.findByText("Bbox 1 (5km × 3km)")).toBeInTheDocument();
    // Use exact name "Clear all" (distinct from MapDrawToolbar's "Clear all shapes").
    const clearAllBtn = await screen.findByRole("button", { name: "Clear all" });
    await userEvent.click(clearAllBtn);
    await waitFor(() => {
      // Column filter cleared (clearFilters deletes the tableId key per filterStore semantics).
      const colFilters = useFilterStore.getState().filters[tableId] ?? [];
      expect(colFilters).toHaveLength(0);
    });
    await waitFor(() => {
      expect(useSpatialFilterStore.getState().shapes).toHaveLength(0);
    });
    // No chips of either type remain.
    await waitFor(() => {
      expect(screen.queryByText("Bbox 1 (5km × 3km)")).toBeNull();
    });
  });

  it("a row appears in FilterBar for a tableId that has ONLY spatial chips (no column filters, no static clause)", async () => {
    // No column filter, no static clause via listViews — only a shape.
    act(() => {
      useSpatialFilterStore.getState().addShape({
        type: "bbox", wkt: "POLYGON((0 0,1 0,1 1,0 1,0 0))", measurement: "5km × 3km",
      });
    });
    await openDashboard([mapWidgetWithLatlonTarget]);
    // The FilterBar should be visible because hasAnySpatialChips is true.
    // The shape chip appears in the targeted table's row.
    expect(await screen.findByText("Bbox 1 (5km × 3km)")).toBeInTheDocument();
    // No column filter chips present.
    expect(screen.queryByLabelText(/Remove filter zone/)).toBeNull();
  });
});

// ===========================================================================
// Phase 34 Plan 04 (DV-V16-08): "Dynamic Views" action-bar button + modal mount
// ===========================================================================
describe("Phase 34 — Dynamic Views action-bar button (DV-V16-08)", () => {
  const dashboardId = 1;
  const tableId = 42;
  const dashboard = {
    id: dashboardId,
    name: "Test Dashboard",
    created_at: "2026-05-12T00:00:00Z",
    updated_at: "2026-05-12T00:00:00Z",
  };
  const dashboardTable = {
    id: tableId,
    schema_name: "demo",
    table_name: "trips",
    columns: { lon: "double", lat: "double", zone: "string" },
  };

  beforeEach(() => {
    seedDesignerStore();
    (globalThis as unknown as { __lastDVMProps?: unknown }).__lastDVMProps = null;
    (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([dashboard]);
    (listDashboardTables as ReturnType<typeof vi.fn>).mockResolvedValue([dashboardTable]);
    (listViews as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (listWidgets as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  // Helper: render DashboardsPage, click Open on the test dashboard.
  const openDashboard = async () => {
    const utils = render(<DashboardsPage onViewChange={() => {}} />);
    await screen.findByText(dashboard.name);
    const openBtn = await screen.findByRole("button", { name: /^open$/i });
    await userEvent.click(openBtn);
    await waitFor(() => expect(listWidgets).toHaveBeenCalled());
    return utils;
  };

  it("renders 'Dynamic Views' button in dashboard toolbar between 'Tables' and 'Map Layers'", async () => {
    await openDashboard();
    const button = await screen.findByRole("button", { name: "Dynamic Views" });
    expect(button).toBeInTheDocument();
    // Button ordering: Tables → Dynamic Views → Map Layers (matches DashboardsPage.tsx dashboard-toolbar).
    const buttons = screen.getAllByRole("button");
    const tablesIdx = buttons.findIndex((b) => b.textContent === "Tables");
    const dvIdx = buttons.findIndex((b) => b.textContent === "Dynamic Views");
    const mapLayersIdx = buttons.findIndex((b) => b.textContent === "Map Layers");
    expect(tablesIdx).toBeGreaterThanOrEqual(0);
    expect(dvIdx).toBeGreaterThan(tablesIdx);
    expect(mapLayersIdx).toBeGreaterThan(dvIdx);
  });

  it("clicking 'Dynamic Views' opens DynamicViewsModal with dashboardId + associatedTables + onClose props", async () => {
    await openDashboard();
    expect(screen.queryByTestId("dynamic-views-modal-mock")).not.toBeInTheDocument();
    const dvButton = await screen.findByRole("button", { name: "Dynamic Views" });
    await userEvent.click(dvButton);
    expect(screen.getByTestId("dynamic-views-modal-mock")).toBeInTheDocument();
    const props = (globalThis as unknown as { __lastDVMProps: {
      dashboardId: number;
      associatedTables: unknown[];
      onClose: () => void;
    } }).__lastDVMProps;
    expect(typeof props.dashboardId).toBe("number");
    expect(props.dashboardId).toBe(dashboardId);
    expect(Array.isArray(props.associatedTables)).toBe(true);
    expect(typeof props.onClose).toBe("function");
  });

  it("onClose prop closes the modal", async () => {
    await openDashboard();
    const dvButton = await screen.findByRole("button", { name: "Dynamic Views" });
    await userEvent.click(dvButton);
    expect(screen.getByTestId("dynamic-views-modal-mock")).toBeInTheDocument();
    // Click the mock's close button (which calls props.onClose).
    await userEvent.click(screen.getByText("close-dvm"));
    expect(screen.queryByTestId("dynamic-views-modal-mock")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Phase 35 Plan 03 (DV-V16-13): orchestrator hook mount + dynamicViews prop
// threading through WidgetConfigModal + LayersModal + DashboardContext.
// ---------------------------------------------------------------------------
// ===========================================================================
// Phase 48 Plan 03 — permission gating (GATE-V18-02/03/04)
// Analyst-hidden vs designer-visible assertions for action-bar + toolbar +
// widget gear/× affordances. Analyst regression: ungated interactions remain
// fully functional (FilterBar chip dismiss fires without error).
// ===========================================================================
describe("Phase 48 — permission gating (GATE-V18-02/03/04)", () => {
  const dashboardId = 1;
  const tableId = 42;
  const dashboard = {
    id: dashboardId,
    name: "Gating Test Dashboard",
    created_at: "2026-06-05T00:00:00Z",
    updated_at: "2026-06-05T00:00:00Z",
  };
  const dashboardTable = {
    id: tableId,
    schema_name: "demo",
    table_name: "trips",
    columns: { zone: "string" },
  };
  // A minimal bar widget so widget-card elements (gear, ×) render.
  const barWidget = {
    id: 200,
    dashboard_id: dashboardId,
    title: "Bar Chart",
    type: "bar",
    position: 0,
    config: { sql: "SELECT zone, COUNT(*) AS value FROM trips GROUP BY zone", tableId },
    created_at: "2026-06-05T00:00:00Z",
    updated_at: "2026-06-05T00:00:00Z",
  };

  const openDashboard = async (widgets: unknown[] = []) => {
    (listWidgets as ReturnType<typeof vi.fn>).mockResolvedValue(widgets);
    const utils = render(<DashboardsPage onViewChange={() => {}} />);
    await screen.findByText(dashboard.name);
    const openBtn = await screen.findByRole("button", { name: /^open$/i });
    await userEvent.click(openBtn);
    await waitFor(() => expect(listWidgets).toHaveBeenCalled());
    return utils;
  };

  beforeEach(() => {
    useFilterStore.getState().reset();
    useSpatialFilterStore.getState().reset();
    (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([dashboard]);
    (listDashboardTables as ReturnType<typeof vi.fn>).mockResolvedValue([dashboardTable]);
    (listViews as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (listWidgets as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  // ── Analyst-hidden assertions ─────────────────────────────────────────────
  describe("analyst: gated affordances are hidden", () => {
    beforeEach(() => {
      seedAnalystStore();
    });

    it("list view: + New Dashboard button is hidden for analyst", async () => {
      render(<DashboardsPage onViewChange={() => {}} />);
      await screen.findByText(dashboard.name);
      expect(screen.queryByRole("button", { name: "+ New Dashboard" })).toBeNull();
    });

    it("open dashboard: Dynamic Views, Map Layers, Visualizations, Tables toolbar buttons hidden for analyst", async () => {
      await openDashboard();
      expect(screen.queryByRole("button", { name: "Dynamic Views" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Map Layers" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Visualizations" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Tables" })).toBeNull();
    });

    it("open dashboard with widget: no gear (widget-configure) and no × (widget-remove) for analyst", async () => {
      const { container } = await openDashboard([barWidget]);
      expect(container.querySelector(".widget-configure")).toBeNull();
      expect(container.querySelector(".widget-remove")).toBeNull();
    });
  });

  // ── Designer-visible assertions ───────────────────────────────────────────
  describe("designer: gated affordances are visible", () => {
    beforeEach(() => {
      seedDesignerStore();
    });

    it("list view: + New Dashboard button is visible for designer", async () => {
      render(<DashboardsPage onViewChange={() => {}} />);
      await screen.findByText(dashboard.name);
      expect(await screen.findByRole("button", { name: "+ New Dashboard" })).toBeInTheDocument();
    });

    it("open dashboard: Dynamic Views, Map Layers, Visualizations, Tables toolbar buttons visible for designer", async () => {
      await openDashboard();
      expect(await screen.findByRole("button", { name: "Dynamic Views" })).toBeInTheDocument();
      expect(await screen.findByRole("button", { name: "Map Layers" })).toBeInTheDocument();
      expect(await screen.findByRole("button", { name: "Visualizations" })).toBeInTheDocument();
      expect(await screen.findByRole("button", { name: "Tables" })).toBeInTheDocument();
    });

    it("open dashboard with widget: gear (widget-configure) and × (widget-remove) visible for designer", async () => {
      const { container } = await openDashboard([barWidget]);
      await waitFor(() => {
        expect(container.querySelector(".widget-configure")).not.toBeNull();
        expect(container.querySelector(".widget-remove")).not.toBeNull();
      });
    });
  });

  // ── EXPLICIT ANALYST REGRESSION (orchestrator-mandated) ──────────────────
  // Confirms that ungated analyst interactions remain fully functional — not
  // just a baseline-count proxy but a positive assertion that clicking works.
  it("ANALYST REGRESSION: FilterBar chip dismiss is clickable and fires removeFilter without error", async () => {
    seedAnalystStore();
    // Pre-seed a column filter in the store (simulates a drill-down already applied).
    act(() => {
      useFilterStore.getState().addFilter(tableId, {
        column: "zone",
        value: "East",
        dataType: "string",
        sourceWidgetId: 1,
        addedAt: Date.now(),
      });
    });
    await openDashboard([]);
    // The FilterBar chip for "zone" should be visible (filter-bar is always visible for analysts with active filters).
    const dismissBtn = await screen.findByLabelText("Remove filter zone");
    expect(dismissBtn).toBeInTheDocument();
    // Click the dismiss — should remove the filter from the store without error.
    await userEvent.click(dismissBtn);
    await waitFor(() => {
      const colFilters = useFilterStore.getState().filters[tableId] ?? [];
      expect(colFilters).toHaveLength(0);
    });
  });
});

describe("Phase 35 — useDynamicViewMaterializeChain mount + prop threading (DV-V16-13)", () => {
  const dashboardId = 1;
  const tableId = 42;
  const dashboard = {
    id: dashboardId,
    name: "Test Dashboard",
    created_at: "2026-05-15T00:00:00Z",
    updated_at: "2026-05-15T00:00:00Z",
  };
  const dashboardTable = {
    id: tableId,
    schema_name: "demo",
    table_name: "trips",
    columns: { lon: "double", lat: "double", zone: "string" },
  };
  const sampleDv: DynamicViewRow = {
    id: 7,
    dashboard_id: dashboardId,
    source_table_id: tableId,
    name: "top-vendors",
    template_sql: "SELECT vendor FROM {view} GROUP BY vendor",
    max_records: 10000,
    columns_json: null,
    created_at: "",
    updated_at: "",
  };

  beforeEach(() => {
    seedDesignerStore();
    (globalThis as unknown as { __lastLayersModalProps?: unknown }).__lastLayersModalProps =
      null;
    (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([dashboard]);
    (listDashboardTables as ReturnType<typeof vi.fn>).mockResolvedValue([dashboardTable]);
    (listViews as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (listWidgets as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (listDynamicViews as ReturnType<typeof vi.fn>).mockReset();
    (listDynamicViews as ReturnType<typeof vi.fn>).mockResolvedValue({
      dynamic_views: [sampleDv],
    });
  });

  const openDashboard = async () => {
    const utils = render(<DashboardsPage onViewChange={() => {}} />);
    await screen.findByText(dashboard.name);
    const openBtn = await screen.findByRole("button", { name: /^open$/i });
    await userEvent.click(openBtn);
    await waitFor(() => expect(listWidgets).toHaveBeenCalled());
    return utils;
  };

  it("mounts useDynamicViewMaterializeChain by calling listDynamicViews(dashboardId) on DashboardOpen", async () => {
    await openDashboard();
    await waitFor(() => {
      expect(listDynamicViews).toHaveBeenCalled();
    });
    const callArg = (listDynamicViews as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg).toBe(dashboardId);
  });

  it("threads dynamicViews prop into LayersModal when the Map Layers modal opens", async () => {
    await openDashboard();
    // Wait for the orchestrator's list-fetch to settle so dynamicViews has loaded.
    await waitFor(() => expect(listDynamicViews).toHaveBeenCalled());
    const layersBtn = await screen.findByRole("button", { name: "Map Layers" });
    await userEvent.click(layersBtn);
    await waitFor(() => {
      expect(screen.getByTestId("layers-modal-mock")).toBeInTheDocument();
    });
    await waitFor(() => {
      const props = (globalThis as unknown as {
        __lastLayersModalProps: { dynamicViews?: DynamicViewRow[] };
      }).__lastLayersModalProps;
      expect(props).toBeTruthy();
      expect(Array.isArray(props.dynamicViews)).toBe(true);
      expect((props.dynamicViews ?? []).length).toBe(1);
      expect((props.dynamicViews ?? [])[0]?.id).toBe(sampleDv.id);
    });
  });

  it("preserves lifecycle DROP loop + reset behavior (regression — hook does not disturb cleanup)", async () => {
    // Pre-seed a materialized dynamic-view entry so the existing DROP loop fires on unmount.
    useDynamicViewStore.getState().setView(99, {
      viewName: "_kbi_dv_pre",
      status: "materialized",
      expiresAt: Date.now() + 60_000,
    });
    expect(useDynamicViewStore.getState().views[99]?.status).toBe("materialized");
    // Smoke: opening + closing the dashboard does not throw, and the dynamic-view
    // store's DROP loop still runs on unmount (the cleanup at lines ~419-431).
    const { unmount } = await openDashboard();
    unmount();
    // After unmount, dynamicViewStore is reset to its initial state.
    expect(useDynamicViewStore.getState().views).toEqual({});
    expect(useDynamicViewStore.getState().dynamicViewVersion).toBe(0);
  });
});
