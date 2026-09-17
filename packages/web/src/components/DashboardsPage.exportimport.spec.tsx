// Phase 121 Plan 03 (DXIM-V124-01/-03/-10): dashboard list Export/Import wiring specs.
//
// Mirrors the ResizeObserver/OL stubs + api/client mock spread from
// DashboardsPage.urlsync.spec.tsx (the lighter harness variant) — DashboardsPage transitively
// imports OpenLayers at module scope, so these stubs are required just to import the module.
//
// Every test title is prefixed "UIWIRE-" per the plan's grep anchor.

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { seedDesignerStore, seedAnalystStore } from "../test/seedAuthStore";
import { useAuthStore } from "../store/auth";
import { PERMISSIONS } from "../lib/permissions";
import type { ImportReportDto } from "../api/client";

// ResizeObserver is used by ol/Map at construction time — stub it before any OL import.
vi.stubGlobal("ResizeObserver", vi.fn().mockImplementation(function (this: any, _cb: ResizeObserverCallback) {
  this.observe = vi.fn();
  this.disconnect = vi.fn();
  this.unobserve = vi.fn();
  return this;
}));

// Mock OL and related modules (they fail in JSDOM due to canvas / ResizeObserver dependencies)
// — mirrors DashboardsPage.urlsync.spec.tsx:25-71.
vi.mock("ol/Map", () => ({
  default: vi.fn().mockImplementation(function MockMap(this: any) {
    this.setTarget = vi.fn();
    this.dispose = vi.fn();
    this.addLayer = vi.fn();
    this.removeLayer = vi.fn();
    this.addInteraction = vi.fn();
    this.removeInteraction = vi.fn();
    this.getView = vi.fn(() => ({
      fit: vi.fn(),
      calculateExtent: vi.fn(() => [0, 0, 100, 100]),
      getResolution: vi.fn(() => 100),
      getCenter: vi.fn(() => [0, 0] as [number, number]),
      getZoom: vi.fn(() => 2),
    }));
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

// Mock the api/client module — stub data-loading helpers so DashboardsPage mounts, plus
// downloadDashboardExport (this spec's own override — other spec files' mocks are untouched).
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
    updateDashboard: vi.fn((id: number, attrs: Record<string, unknown>) =>
      Promise.resolve({ id, name: "Test Dashboard", filter_display_mode: "topbar", created_at: "x", updated_at: "x", ...attrs })),
    createDashboard: vi.fn(),
    downloadDashboardExport: vi.fn(() => Promise.resolve()),
  };
});

// Mock ImportDashboardModal — capture props on globalThis.__lastIDMProps, mirroring the
// __lastDAMProps idiom at DashboardsPage.spec.tsx:1142/1153 for DashboardAccessModal.
vi.mock("./ImportDashboardModal", () => ({
  __esModule: true,
  default: (props: { onClose: () => void; onImported: (report: ImportReportDto) => void }) => {
    (globalThis as unknown as { __lastIDMProps?: unknown }).__lastIDMProps = props;
    return <div data-testid="import-dashboard-modal-mock" />;
  },
}));

import DashboardsPage from "./DashboardsPage";
import { listDashboards, downloadDashboardExport } from "../api/client";

const dashboard = {
  id: 4,
  name: "Test Dashboard",
  filter_display_mode: "topbar" as const,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
};

const mockReport: ImportReportDto = {
  dashboardId: 99,
  dashboardName: "Imported Dashboard",
  widgetsCreated: 0,
  layersCreated: 0,
  dynamicViewsCreated: 0,
  tablesMatched: [],
  tablesCreated: [],
  metricsMatched: [],
  metricsCreated: [],
  metricConflicts: [],
  strippedReferences: [],
  warnings: [],
  preflightDangling: [],
};

// Do NOT call this seedPermissions helper before the zustand reset shim runs (per
// seedAuthStore.ts's own header warning) — always call it at the top of the test body,
// same as seedDesignerStore()/seedAnalystStore() are called elsewhere in this file.
const seedPermissions = (permissions: string[]) =>
  useAuthStore.setState({
    status: "authenticated",
    user: { username: "testcustom", roles: ["custom"], permissions },
  });

describe("DashboardsPage export/import wiring (Phase 121 Plan 03)", () => {
  beforeEach(() => {
    (listDashboards as Mock).mockReset();
    (listDashboards as Mock).mockResolvedValue([dashboard]);
    (downloadDashboardExport as Mock).mockReset();
    (downloadDashboardExport as Mock).mockResolvedValue(undefined);
    (globalThis as unknown as { __lastIDMProps?: unknown }).__lastIDMProps = null;
  });

  it("UIWIRE-export-visible: designer sees an Export button in the row", async () => {
    seedDesignerStore();
    render(<DashboardsPage onViewChange={() => {}} />);
    await screen.findByText(dashboard.name);
    expect(screen.getByRole("button", { name: /^export$/i })).toBeInTheDocument();
  });

  it("UIWIRE-export-analyst: analyst ALSO sees Export (route gates on canViewDashboard only, and the list is already server-filtered by it)", async () => {
    seedAnalystStore();
    render(<DashboardsPage onViewChange={() => {}} />);
    await screen.findByText(dashboard.name);
    expect(screen.getByRole("button", { name: /^export$/i })).toBeInTheDocument();
  });

  it("UIWIRE-export-click: clicking Export calls downloadDashboardExport exactly once with the dashboard's id and name", async () => {
    seedDesignerStore();
    render(<DashboardsPage onViewChange={() => {}} />);
    await screen.findByText(dashboard.name);
    await userEvent.click(screen.getByRole("button", { name: /^export$/i }));
    expect(downloadDashboardExport).toHaveBeenCalledTimes(1);
    const arg = (downloadDashboardExport as Mock).mock.calls[0][0];
    expect(arg.id).toBe(4);
    expect(arg.name).toBe("Test Dashboard");
  });

  it("UIWIRE-export-error: downloadDashboardExport rejecting renders the error message in the list", async () => {
    seedDesignerStore();
    (downloadDashboardExport as Mock).mockRejectedValue(new Error("Dashboard not found."));
    render(<DashboardsPage onViewChange={() => {}} />);
    await screen.findByText(dashboard.name);
    await userEvent.click(screen.getByRole("button", { name: /^export$/i }));
    await screen.findByText("Dashboard not found.");
  });

  it("UIWIRE-import-designer: designer (BOTH permissions) sees Import dashboard", async () => {
    seedDesignerStore();
    render(<DashboardsPage onViewChange={() => {}} />);
    await screen.findByText(dashboard.name);
    expect(screen.getByRole("button", { name: /import dashboard/i })).toBeInTheDocument();
  });

  it("UIWIRE-import-analyst: analyst (NEITHER) does not see Import dashboard", async () => {
    seedAnalystStore();
    render(<DashboardsPage onViewChange={() => {}} />);
    await screen.findByText(dashboard.name);
    expect(screen.queryByRole("button", { name: /import dashboard/i })).toBeNull();
  });

  it("UIWIRE-import-create-only: AND-gate probe A — dashboards:create alone does not see Import dashboard, but still sees + New Dashboard", async () => {
    seedPermissions([PERMISSIONS.DASHBOARDS_VIEW, PERMISSIONS.DASHBOARDS_CREATE]);
    render(<DashboardsPage onViewChange={() => {}} />);
    await screen.findByText(dashboard.name);
    expect(screen.queryByRole("button", { name: /import dashboard/i })).toBeNull();
    expect(screen.getByRole("button", { name: /\+ new dashboard/i })).toBeInTheDocument();
  });

  it("UIWIRE-import-manage-only: AND-gate probe B — datasets:manage alone sees neither Import dashboard nor + New Dashboard", async () => {
    seedPermissions([PERMISSIONS.DASHBOARDS_VIEW, PERMISSIONS.DATASETS_MANAGE]);
    render(<DashboardsPage onViewChange={() => {}} />);
    await screen.findByText(dashboard.name);
    expect(screen.queryByRole("button", { name: /import dashboard/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /\+ new dashboard/i })).toBeNull();
  });

  it("UIWIRE-import-opens: designer clicking Import dashboard mounts the modal", async () => {
    seedDesignerStore();
    render(<DashboardsPage onViewChange={() => {}} />);
    await screen.findByText(dashboard.name);
    await userEvent.click(screen.getByRole("button", { name: /import dashboard/i }));
    await waitFor(() => {
      expect(screen.getByTestId("import-dashboard-modal-mock")).toBeInTheDocument();
    });
  });

  it("UIWIRE-import-refetch: invoking the stub's captured onImported causes listDashboards to be called a second time", async () => {
    seedDesignerStore();
    render(<DashboardsPage onViewChange={() => {}} />);
    await screen.findByText(dashboard.name);
    await userEvent.click(screen.getByRole("button", { name: /import dashboard/i }));
    await waitFor(() => {
      expect(screen.getByTestId("import-dashboard-modal-mock")).toBeInTheDocument();
    });
    expect(listDashboards).toHaveBeenCalledTimes(1);
    const props = (globalThis as unknown as {
      __lastIDMProps: { onImported: (report: ImportReportDto) => void };
    }).__lastIDMProps;
    props.onImported(mockReport);
    await waitFor(() => {
      expect(listDashboards).toHaveBeenCalledTimes(2);
    });
  });

  it("UIWIRE-import-close: invoking the stub's captured onClose unmounts the modal", async () => {
    seedDesignerStore();
    render(<DashboardsPage onViewChange={() => {}} />);
    await screen.findByText(dashboard.name);
    await userEvent.click(screen.getByRole("button", { name: /import dashboard/i }));
    await waitFor(() => {
      expect(screen.getByTestId("import-dashboard-modal-mock")).toBeInTheDocument();
    });
    const props = (globalThis as unknown as { __lastIDMProps: { onClose: () => void } }).__lastIDMProps;
    props.onClose();
    await waitFor(() => {
      expect(screen.queryByTestId("import-dashboard-modal-mock")).toBeNull();
    });
  });

  it("UIWIRE-newdash-class: the + New Dashboard button's className is exactly btn-primary btn-sm", async () => {
    seedDesignerStore();
    render(<DashboardsPage onViewChange={() => {}} />);
    await screen.findByText(dashboard.name);
    const btn = screen.getByRole("button", { name: /\+ new dashboard/i });
    expect(btn.className).toBe("btn-primary btn-sm");
  });

  it("UIWIRE-actions-pair: + New Dashboard and Import dashboard share the same parent, whose className includes ds-actions", async () => {
    seedDesignerStore();
    render(<DashboardsPage onViewChange={() => {}} />);
    await screen.findByText(dashboard.name);
    const newDashBtn = screen.getByRole("button", { name: /\+ new dashboard/i });
    const importBtn = screen.getByRole("button", { name: /import dashboard/i });
    expect(newDashBtn.parentElement).toBe(importBtn.parentElement);
    expect(newDashBtn.parentElement?.className).toContain("ds-actions");
  });
});
