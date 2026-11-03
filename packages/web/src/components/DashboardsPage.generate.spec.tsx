// Phase 142 Plan 03 (AIGEN-V20-01): the Generate section of the New Dashboard form + list label.
// Harness (OL / ResizeObserver / grid stubs) copied from DashboardsPage.keep.spec.tsx.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAuthStore } from "../store/auth";
import { PERMISSIONS } from "../lib/permissions";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { seedDesignerStore } from "../test/seedAuthStore";
import { useAiSessionStore } from "../store/aiSessionStore";
import { useFilterStore } from "../store/filterStore";
import { __resetAiConfigCacheForTest } from "../lib/aiSession/aiAvailability";
import { takeGenerateIntent, __resetGenerateIntentForTest } from "../lib/aiSession/generateIntent";

vi.mock("react-grid-layout", async (orig) => {
  const actual = await orig<typeof import("react-grid-layout")>();
  return {
    ...actual,
    ResponsiveGridLayout: (p: any) => <div data-testid="grid">{p.children}</div>,
  };
});

vi.stubGlobal("ResizeObserver", vi.fn().mockImplementation(function (this: any, cb: ResizeObserverCallback) {
  this.observe = vi.fn(() => {
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
    listDashboardGrants: vi.fn(() => Promise.resolve([])),
    getAiConfig: vi.fn(() => Promise.resolve({ enabled: true })),
    generateDashboard: vi.fn(),
    discardGeneratedDashboard: vi.fn(() => Promise.resolve()),
    createDashboard: vi.fn(),
  };
});

import { registerAllChartTypes } from "./charts/definitions";
import DashboardsPage from "./DashboardsPage";
import * as dashboardUrl from "../lib/dashboardUrl";
import { listDashboards, listTables, getAiConfig, generateDashboard, discardGeneratedDashboard, createDashboard } from "../api/client";

const mocked = (f: unknown) => f as ReturnType<typeof vi.fn>;
const stamp = { created_at: "2026-07-09T00:00:00Z", updated_at: "2026-07-09T00:00:00Z", filter_display_mode: "topbar" as const };
const generated = { id: 42, name: "nyctaxi overview", ...stamp, generated_pending: true };
const grantAi = () =>
  useAuthStore.setState((s) => ({ user: { ...s.user!, permissions: [...s.user!.permissions, PERMISSIONS.AI_USE] } }));

const openForm = async () => {
  render(<DashboardsPage onViewChange={() => {}} />);
  await userEvent.click(await screen.findByRole("button", { name: /new dashboard/i }));
  await screen.findByText("New Dashboard");
};
// The open view's marker: the create form is gone and the dashboard screen (with its Back button) is shown.
const openViewShown = async () => {
  await screen.findByRole("button", { name: "Back" });
  expect(screen.queryByText("New Dashboard")).toBeNull();
};
const tick = async () => userEvent.click(await screen.findByLabelText("Generate from a table"));
const chooseTable = async () => {
  await userEvent.selectOptions(await screen.findByLabelText("Table"), "7");
};

describe("DashboardsPage Generate form (Phase 142 Plan 03)", () => {
  beforeEach(() => {
    registerAllChartTypes();
    seedDesignerStore();
    grantAi();
    useAiSessionStore.getState().reset();
    useFilterStore.getState().reset();
    __resetAiConfigCacheForTest();
    __resetGenerateIntentForTest();
    for (const m of [listDashboards, listTables, getAiConfig, generateDashboard, discardGeneratedDashboard, createDashboard]) mocked(m).mockReset();
    mocked(listDashboards).mockResolvedValue([]);
    mocked(listTables).mockResolvedValue([{ id: 7, name: "nyctaxi", schema: "demo", columns: {}, ...stamp }]);
    mocked(getAiConfig).mockResolvedValue({ enabled: true });
    mocked(discardGeneratedDashboard).mockResolvedValue(undefined);
    try { localStorage.clear(); } catch { /* ignore */ }
  });

  it("GENFORM-1: checkbox only with ai:use and AI enabled", async () => {
    await openForm();
    expect(await screen.findByLabelText("Generate from a table")).toBeTruthy();
    expect(listTables).not.toHaveBeenCalled();
  });

  it("GENFORM-1b: absent without ai:use", async () => {
    seedDesignerStore();
    await openForm();
    await screen.findByPlaceholderText("Dashboard name");
    expect(screen.queryByLabelText("Generate from a table")).toBeNull();
    expect(listTables).not.toHaveBeenCalled();
  });

  it("GENFORM-1c: absent when AI is disabled", async () => {
    mocked(getAiConfig).mockResolvedValue({ enabled: false });
    await openForm();
    await screen.findByPlaceholderText("Dashboard name");
    await waitFor(() => expect(getAiConfig).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByLabelText("Generate from a table")).toBeNull();
    expect(listTables).not.toHaveBeenCalled();
  });

  it("GENFORM-2: fields, disabled rules and name prefill", async () => {
    await openForm();
    await tick();
    const btn = screen.getByRole("button", { name: "Generate dashboard" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByPlaceholderText("Optional, for example: tips by payment type")).toBeTruthy();
    expect(screen.getByLabelText("What do you want to see?")).toBeTruthy();
    expect(await screen.findByRole("option", { name: "demo.nyctaxi" })).toBeTruthy();
    await chooseTable();
    expect((screen.getByPlaceholderText("Dashboard name") as HTMLInputElement).value).toBe("nyctaxi overview");
    expect(btn.disabled).toBe(false);
  });

  it("GENFORM-3: success posts once, queues the intent, opens in open mode", async () => {
    let resolve!: (v: unknown) => void;
    mocked(generateDashboard).mockReturnValue(new Promise((r) => { resolve = r; }));
    const openSpy = vi.spyOn(dashboardUrl, "openDashboardUrl");
    await openForm();
    await tick();
    await chooseTable();
    await userEvent.click(screen.getByRole("button", { name: "Generate dashboard" }));
    const busy = (await screen.findByRole("button", { name: "Generating…" })) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    resolve({ ok: true, dashboard: generated });
    await openViewShown();
    expect(generateDashboard).toHaveBeenCalledTimes(1);
    expect(generateDashboard).toHaveBeenCalledWith({ name: "nyctaxi overview", tableId: 7 });
    expect(takeGenerateIntent(42)).toEqual({ question: "Create a starter dashboard for this table." });
    expect(openSpy).toHaveBeenCalledWith(42);
  });

  it("GENFORM-3b: typed prompt and description are passed on", async () => {
    mocked(generateDashboard).mockResolvedValue({ ok: true, dashboard: generated });
    await openForm();
    await userEvent.type(screen.getByPlaceholderText("Optional description"), "About taxis");
    await tick();
    await chooseTable();
    await userEvent.type(screen.getByLabelText("What do you want to see?"), "tips by payment type");
    await userEvent.click(screen.getByRole("button", { name: "Generate dashboard" }));
    await openViewShown();
    expect(generateDashboard).toHaveBeenCalledWith({ name: "nyctaxi overview", description: "About taxis", tableId: 7 });
    expect(takeGenerateIntent(42)).toEqual({ question: "tips by payment type" });
  });

  it("GENFORM-4: two rapid clicks produce one call", async () => {
    mocked(generateDashboard).mockReturnValue(new Promise(() => {}));
    await openForm();
    await tick();
    await chooseTable();
    const btn = screen.getByRole("button", { name: "Generate dashboard" });
    await userEvent.dblClick(btn);
    expect(generateDashboard).toHaveBeenCalledTimes(1);
  });

  it("GENFORM-5: pending 409 offers Open it / Discard it", async () => {
    mocked(generateDashboard).mockResolvedValue({
      ok: false, kind: "pending", existing: { id: 5, name: "Old starter" }, message: "m",
    });
    await openForm();
    await tick();
    await chooseTable();
    await userEvent.click(screen.getByRole("button", { name: "Generate dashboard" }));
    await screen.findByText(`You already have a generated dashboard that isn't kept yet: "Old starter". Keep or discard it first.`);
    const open = screen.getByRole("button", { name: "Open it" });
    const discard = screen.getByRole("button", { name: "Discard it" });
    expect(open.className).toBe("btn-primary btn-sm");
    expect(discard.className).toBe("ghost-sm ghost-danger");
    expect(open.parentElement).toBe(discard.parentElement);
    expect(open.parentElement!.className).toBe("ds-actions");
    await userEvent.click(discard);
    await waitFor(() => expect(discardGeneratedDashboard).toHaveBeenCalledWith(5));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Discard it" })).toBeNull());
    expect((screen.getByPlaceholderText("Dashboard name") as HTMLInputElement).value).toBe("nyctaxi overview");
  });

  it("GENFORM-5b: Open it opens the existing dashboard from the list", async () => {
    mocked(listDashboards).mockResolvedValue([{ id: 5, name: "Old starter", ...stamp, generated_pending: true }]);
    mocked(generateDashboard).mockResolvedValue({
      ok: false, kind: "pending", existing: { id: 5, name: "Old starter" }, message: "m",
    });
    await openForm();
    await tick();
    await chooseTable();
    await userEvent.click(screen.getByRole("button", { name: "Generate dashboard" }));
    await userEvent.click(await screen.findByRole("button", { name: "Open it" }));
    await openViewShown();
  });

  it("GENFORM-6: error renders in .error and stores no intent", async () => {
    mocked(generateDashboard).mockResolvedValue({ ok: false, kind: "error", message: "AI is not configured." });
    await openForm();
    await tick();
    await chooseTable();
    await userEvent.click(screen.getByRole("button", { name: "Generate dashboard" }));
    const err = await screen.findByText("AI is not configured.");
    expect(err.className).toBe("error");
    expect(takeGenerateIntent(42)).toBeNull();
  });

  it("GENFORM-7: plain create unchanged", async () => {
    mocked(createDashboard).mockResolvedValue({ id: 9, name: "Plain", ...stamp });
    await openForm();
    await userEvent.type(screen.getByPlaceholderText("Dashboard name"), "Plain");
    await userEvent.click(screen.getByRole("button", { name: "Create Dashboard" }));
    await waitFor(() => expect(createDashboard).toHaveBeenCalledWith({ name: "Plain", description: "" }));
    expect(generateDashboard).not.toHaveBeenCalled();
  });

  it("GENFORM-8: list label only for unkept rows", async () => {
    mocked(listDashboards).mockResolvedValue([
      { id: 1, name: "Kept one", ...stamp },
      { id: 2, name: "Fresh one", ...stamp, generated_pending: true },
    ]);
    render(<DashboardsPage onViewChange={() => {}} />);
    await screen.findByText("Kept one");
    expect(screen.getAllByText(/Not kept yet/)).toHaveLength(1);
  });
});
