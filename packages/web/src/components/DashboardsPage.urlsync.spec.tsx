// Phase 113 Plan 01 (DLINK-V121-01/06/07): URL-sync wiring specs for DashboardsPage.
//
// Mirrors the ResizeObserver/OL stubs + api/client mocks from DashboardsPage.spec.tsx
// (lighter harness variant, per DashboardsPage.panel.spec.tsx precedent — modal mocks
// for DynamicViewsModal/LayersModal/DashboardAccessModal are NOT needed since this
// spec never opens those modals).
//
// Every test title is prefixed "URLSYNC-113:" per the plan's grep anchor.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { seedDesignerStore } from "../test/seedAuthStore";
import { useAuthStore } from "../store/auth";
import { DASHBOARD_HISTORY_MARKER, openDashboardUrl } from "../lib/dashboardUrl";

// ResizeObserver is used by ol/Map at construction time — stub it before any OL import.
vi.stubGlobal("ResizeObserver", vi.fn().mockImplementation(function (this: any, _cb: ResizeObserverCallback) {
  this.observe = vi.fn();
  this.disconnect = vi.fn();
  this.unobserve = vi.fn();
  return this;
}));

// Mock OL and related modules (they fail in JSDOM due to canvas / ResizeObserver dependencies)
// — mirrors DashboardsPage.spec.tsx:23-70.
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

// Mock the api/client module — stub data-loading helpers so DashboardsPage mounts.
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
    // Phase 117 Plan 02 (DSET-117): view/edit transitions need updateDashboard (Save on the edit
    // form) and createDashboard (the New Dashboard flow) mocked so those forms can actually submit
    // in tests — echoes the requested attrs back onto the dashboard, mirroring
    // DashboardsPage.spec.tsx's own updateDashboard mock shape.
    updateDashboard: vi.fn((id: number, attrs: Record<string, unknown>) =>
      Promise.resolve({ id, name: "Test Dashboard", filter_display_mode: "topbar", created_at: "x", updated_at: "x", ...attrs })),
    createDashboard: vi.fn(),
  };
});

import DashboardsPage from "./DashboardsPage";
import {
  listDashboards,
  listWidgets,
  listViews,
  listDashboardTables,
  updateDashboard,
  createDashboard,
} from "../api/client";

const dashboard = {
  id: 77,
  name: "URL Sync Dashboard",
  filter_display_mode: "topbar" as const,
  created_at: "2026-09-11T00:00:00Z",
  updated_at: "2026-09-11T00:00:00Z",
};

const openViaClick = async () => {
  (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([dashboard]);
  (listDashboardTables as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (listViews as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (listWidgets as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  const utils = render(<DashboardsPage onViewChange={() => {}} />);
  await screen.findByText(dashboard.name);
  const openBtn = await screen.findByRole("button", { name: /^open$/i });
  await userEvent.click(openBtn);
  return utils;
};

describe("DashboardsPage URL sync (Phase 113)", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    seedDesignerStore();
    (listDashboards as ReturnType<typeof vi.fn>).mockReset();
    (listDashboardTables as ReturnType<typeof vi.fn>).mockReset();
    (listViews as ReturnType<typeof vi.fn>).mockReset();
    (listWidgets as ReturnType<typeof vi.fn>).mockReset();
  });

  it("URLSYNC-113: opening a dashboard puts ?dashboard=<id> in the address bar", async () => {
    await openViaClick();
    // Assert WITHOUT waiting for widget fetches to settle — the URL updates immediately.
    expect(window.location.search).toBe("?dashboard=77");
    expect((window.history.state as Record<string, unknown>)[DASHBOARD_HISTORY_MARKER]).toBe(true);
  });

  it("URLSYNC-113: browser Back from an open dashboard returns to the dashboard list", async () => {
    await openViaClick();
    await act(async () => {
      window.history.replaceState(null, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(await screen.findByRole("button", { name: /^open$/i })).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  it('URLSYNC-113: the in-app Back button pops the pushed entry instead of pushing another', async () => {
    await openViaClick();
    const backSpy = vi.spyOn(window.history, "back");
    const backToDashboardsBtn = await screen.findByRole("button", { name: /^back/i });
    await userEvent.click(backToDashboardsBtn);
    expect(await screen.findByRole("button", { name: /^open$/i })).toBeInTheDocument();
    expect(backSpy).toHaveBeenCalledTimes(1);
    backSpy.mockRestore();
  });

  it("URLSYNC-113: the in-app Back button eventually clears the address bar via traversal", async () => {
    await openViaClick();
    const backToDashboardsBtn = await screen.findByRole("button", { name: /^back/i });
    await userEvent.click(backToDashboardsBtn);
    // jsdom's traversal is several macrotasks away — waitFor is mandatory.
    await waitFor(() => expect(window.location.search).toBe(""));
  });

  it("URLSYNC-113: browser Forward into an entry we already left clears the stale param instead of re-opening", async () => {
    await openViaClick();
    const backToDashboardsBtn = await screen.findByRole("button", { name: /^back/i });
    await userEvent.click(backToDashboardsBtn);
    await screen.findByRole("button", { name: /^open$/i });

    await act(async () => {
      window.history.replaceState(null, "", "/?dashboard=77");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    await waitFor(() => expect(window.location.search).toBe(""));
    // The list is still on screen — we reconciled the URL, we did NOT open anything.
    expect(screen.getByRole("button", { name: /^open$/i })).toBeInTheDocument();
  });

  it("URLSYNC-113: unmounting the dashboards page while authenticated clears the dashboard param", async () => {
    const { unmount } = await openViaClick();
    expect(window.location.search).toBe("?dashboard=77");
    unmount();
    await waitFor(() => expect(window.location.search).toBe(""));
  });

  it("URLSYNC-113: unmounting after the session ends leaves the dashboard param alone", async () => {
    const { unmount } = await openViaClick();
    expect(window.location.search).toBe("?dashboard=77");
    useAuthStore.setState({ status: "unauthenticated", user: null });
    unmount();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(window.location.search).toBe("?dashboard=77");
  });

  it("URLSYNC-113: StrictMode double-invoke does not wipe the just-opened param", async () => {
    (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([dashboard]);
    (listDashboardTables as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (listViews as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (listWidgets as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const React = await import("react");
    await act(async () => {
      render(
        React.createElement(
          React.StrictMode,
          null,
          React.createElement(DashboardsPage, { onViewChange: () => {} }),
        ),
      );
    });
    await screen.findByText(dashboard.name);
    const openBtn = await screen.findByRole("button", { name: /^open$/i });
    await act(async () => {
      await userEvent.click(openBtn);
    });
    // Let the deferred clear fire, or not — the trailing macrotask wait is mandatory,
    // without it the timer has not had a chance to fire and the test passes vacuously.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(window.location.search).toBe("?dashboard=77");
  });

  it("URLSYNC-113: a stale unmount timer does not clear a different dashboard's param", async () => {
    const { unmount } = await openViaClick();
    expect(window.location.search).toBe("?dashboard=77");
    // open dashboard 77, then sidebar-away (unmount) — this SCHEDULES the deferred clear
    unmount();
    // user immediately reopens a DIFFERENT dashboard, synchronously
    openDashboardUrl(88);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0)); // now A's stale timer fires
    });
    expect(window.location.search).toBe("?dashboard=88"); // B's param survives
  });
});

// Phase 114 Plan 02 (DLINK-V121-02): initialOpenDashboard wiring. Every title prefixed
// "DEEPLINK-114:" per the plan's grep anchor.
const DASH_77 = {
  id: 77,
  name: "Deep Linked",
  filter_display_mode: "topbar" as const,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("DashboardsPage initialOpenDashboard (Phase 114 Plan 02)", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    seedDesignerStore();
    (listDashboards as ReturnType<typeof vi.fn>).mockReset();
    (listDashboardTables as ReturnType<typeof vi.fn>).mockReset();
    (listViews as ReturnType<typeof vi.fn>).mockReset();
    (listWidgets as ReturnType<typeof vi.fn>).mockReset();
    (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([DASH_77]);
    (listDashboardTables as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (listViews as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (listWidgets as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it("DEEPLINK-114: mounts straight into the open dashboard when initialOpenDashboard is supplied", async () => {
    window.history.replaceState(null, "", "/?dashboard=77");
    const { unmount } = render(<DashboardsPage initialOpenDashboard={{ dashboard: DASH_77, mode: "open" }} />);
    expect(await screen.findByRole("button", { name: /^back/i })).toBeInTheDocument();
    expect(screen.queryByText("Dashboards")).toBeNull();
    expect(screen.queryByRole("button", { name: /new dashboard/i })).toBeNull();
    // Explicit unmount + macrotask flush so this instance's deferred unmount-cleanup timer
    // (DashboardsPage.tsx DashboardOpen, Phase 113) fires and settles WITHIN this test rather
    // than leaking into the next test's identical dashboard id via RTL's automatic afterEach
    // cleanup() (see URLSYNC-113's own "stale unmount timer" test for the same hazard).
    unmount();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  it("DEEPLINK-114: a deep-link arrival pushes no history entry of its own", async () => {
    window.history.replaceState(null, "", "/?dashboard=77");
    const { unmount } = render(<DashboardsPage initialOpenDashboard={{ dashboard: DASH_77, mode: "open" }} />);
    await screen.findByRole("button", { name: /^back/i });
    expect(window.location.search).toBe("?dashboard=77");
    expect((window.history.state as Record<string, unknown> | null ?? {})[DASHBOARD_HISTORY_MARKER]).toBeUndefined();
    unmount();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  it("DEEPLINK-114: the in-app Back button from a deep-link arrival writes the list URL instead of ejecting", async () => {
    window.history.replaceState(null, "", "/?dashboard=77");
    render(<DashboardsPage initialOpenDashboard={{ dashboard: DASH_77, mode: "open" }} />);
    const backBtn = await screen.findByRole("button", { name: /^back/i });
    await userEvent.click(backBtn);
    await waitFor(() => expect(window.location.search).toBe(""));
    expect(await screen.findByRole("button", { name: /^open$/i })).toBeInTheDocument();
  });

  it("DEEPLINK-114: without initialOpenDashboard the page still starts on the list", async () => {
    render(<DashboardsPage />);
    expect(await screen.findByRole("button", { name: /^open$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^back/i })).toBeNull();
  });
});

// Phase 117 Plan 02 (DSET-117): view/edit transition + arrival coverage. Every title prefixed
// "DSET-117:" per the plan's grep anchor. A THIRD describe block, separate from URLSYNC-113 and
// DEEPLINK-114 above, so a future reader can see at a glance which tests came from which phase.
const DASH_42 = {
  id: 42,
  name: "Settings Dashboard",
  filter_display_mode: "topbar" as const,
  created_at: "2026-09-15T00:00:00Z",
  updated_at: "2026-09-15T00:00:00Z",
};

const readHistoryMarker = () =>
  (window.history.state as Record<string, unknown> | null ?? {})[DASHBOARD_HISTORY_MARKER];

describe("DashboardsPage view/edit URL sync (Phase 117 Plan 02)", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    seedDesignerStore();
    (listDashboards as ReturnType<typeof vi.fn>).mockReset();
    (listDashboardTables as ReturnType<typeof vi.fn>).mockReset();
    (listViews as ReturnType<typeof vi.fn>).mockReset();
    (listWidgets as ReturnType<typeof vi.fn>).mockReset();
    (createDashboard as ReturnType<typeof vi.fn>).mockReset();
    (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([DASH_42]);
    (listDashboardTables as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (listViews as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (listWidgets as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  // Several tests below spy on window.history.pushState/back without a matching mockRestore()
  // on the failure path — an assertion throw would otherwise skip the restore and leak a wrapped
  // spy into the next test. Restoring here (not vi.useRealTimers() — MEMORY: "Web vitest parallel
  // fake-timer leak" is about timers, not spies) keeps each test's spy call-count isolated.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Writing the link ──────────────────────────────────────────────────────────

  it("DSET-117: clicking View puts ?dashboard=42&mode=view in the address bar", async () => {
    render(<DashboardsPage onViewChange={() => {}} />);
    await screen.findByText(DASH_42.name);
    await userEvent.click(await screen.findByRole("button", { name: /^view$/i }));
    expect(window.location.search).toBe("?dashboard=42&mode=view");
  });

  it("DSET-117: clicking Edit in the list row puts ?dashboard=42&mode=edit", async () => {
    render(<DashboardsPage onViewChange={() => {}} />);
    await screen.findByText(DASH_42.name);
    await userEvent.click(await screen.findByRole("button", { name: /^edit$/i }));
    expect(window.location.search).toBe("?dashboard=42&mode=edit");
  });

  it("DSET-117: clicking View pushes exactly ONE history entry", async () => {
    const pushSpy = vi.spyOn(window.history, "pushState");
    render(<DashboardsPage onViewChange={() => {}} />);
    await screen.findByText(DASH_42.name);
    await userEvent.click(await screen.findByRole("button", { name: /^view$/i }));
    expect(pushSpy).toHaveBeenCalledTimes(1);
    pushSpy.mockRestore();
  });

  it("DSET-117: clicking Edit in the list row pushes exactly ONE history entry", async () => {
    const pushSpy = vi.spyOn(window.history, "pushState");
    render(<DashboardsPage onViewChange={() => {}} />);
    await screen.findByText(DASH_42.name);
    await userEvent.click(await screen.findByRole("button", { name: /^edit$/i }));
    expect(pushSpy).toHaveBeenCalledTimes(1);
    pushSpy.mockRestore();
  });

  it("DSET-117: clicking Open still puts exactly ?dashboard=42 with no mode qualifier (DSET-V122-08)", async () => {
    const { unmount } = render(<DashboardsPage onViewChange={() => {}} />);
    await screen.findByText(DASH_42.name);
    await userEvent.click(await screen.findByRole("button", { name: /^open$/i }));
    expect(window.location.search).toBe("?dashboard=42");
    // Explicit unmount + macrotask flush so this instance's deferred unmount-cleanup timer
    // (DashboardOpen, Phase 113) settles WITHIN this test rather than leaking into a later
    // test that reuses the same dashboard id — mirrors the DEEPLINK-114 tests above.
    unmount();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  // ── The two in-place transitions (Pitfall 1's coverage) ────────────────────────

  // Split into two tests DELIBERATELY (not one composite), per CLAUDE.md's mutation-probe
  // discrimination rule: a single test asserting both "the URL says edit" AND "no new entry was
  // pushed" reddens identically whether the whole write is MISSING (Pitfall 1's exact failure) or
  // merely uses the WRONG writer (a push instead of an in-place replace) — the two probes would
  // then redden the SAME test object, proving nothing about which mistake was made. Splitting the
  // two assertions into independent tests makes each probe redden a DIFFERENT one.
  it("DSET-117: clicking Edit inside the settings screen changes the mode qualifier to edit", async () => {
    render(<DashboardsPage onViewChange={() => {}} />);
    await screen.findByText(DASH_42.name);
    await userEvent.click(await screen.findByRole("button", { name: /^view$/i }));
    expect(window.location.search).toBe("?dashboard=42&mode=view");
    await userEvent.click(await screen.findByRole("button", { name: /^edit$/i }));
    expect(window.location.search).toBe("?dashboard=42&mode=edit");
  });

  it("DSET-117: clicking Edit inside the settings screen does not push a new history entry", async () => {
    render(<DashboardsPage onViewChange={() => {}} />);
    await screen.findByText(DASH_42.name);
    await userEvent.click(await screen.findByRole("button", { name: /^view$/i }));
    const lengthBefore = window.history.length;
    const pushSpy = vi.spyOn(window.history, "pushState");
    await userEvent.click(await screen.findByRole("button", { name: /^edit$/i }));
    expect(window.history.length).toBe(lengthBefore);
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it("DSET-117: saving from the edit screen rewrites the bar to mode=view without pushing a new entry", async () => {
    render(<DashboardsPage onViewChange={() => {}} />);
    await screen.findByText(DASH_42.name);
    await userEvent.click(await screen.findByRole("button", { name: /^edit$/i }));
    expect(window.location.search).toBe("?dashboard=42&mode=edit");
    const lengthBefore = window.history.length;
    const pushSpy = vi.spyOn(window.history, "pushState");
    await userEvent.click(await screen.findByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(window.location.search).toBe("?dashboard=42&mode=view"));
    expect(window.history.length).toBe(lengthBefore);
    expect(pushSpy).not.toHaveBeenCalled();
    pushSpy.mockRestore();
  });

  it("DSET-117: list -> View -> in-app Edit -> Save: after both in-place changes the in-app Back still POPS", async () => {
    render(<DashboardsPage onViewChange={() => {}} />);
    await screen.findByText(DASH_42.name);
    await userEvent.click(await screen.findByRole("button", { name: /^view$/i }));
    expect(readHistoryMarker()).toBe(true);
    await userEvent.click(await screen.findByRole("button", { name: /^edit$/i }));
    expect(readHistoryMarker()).toBe(true);
    await userEvent.click(await screen.findByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(window.location.search).toBe("?dashboard=42&mode=view"));
    expect(readHistoryMarker()).toBe(true);
    const backSpy = vi.spyOn(window.history, "back");
    await userEvent.click(await screen.findByRole("button", { name: /^back$/i }));
    expect(backSpy).toHaveBeenCalledTimes(1);
    backSpy.mockRestore();
  });

  // Same discrimination rule applies here: "the URL is right" and "the entry did not become one
  // we own" are independent claims. A writer that hardcodes the marker to `true` (Pitfall 1's
  // OTHER failure mode — see Probe B) gets the URL right but wrongly marks the entry; a writer
  // that never fires at all gets neither right. Two separate tests so each mistake reddens its
  // own assertion, not a shared one.
  it("DSET-117: deep-link arrival into view -> clicking in-app Edit changes the mode qualifier to edit", async () => {
    window.history.replaceState(null, "", "/?dashboard=42&mode=view");
    render(<DashboardsPage initialOpenDashboard={{ dashboard: DASH_42, mode: "view" }} />);
    await userEvent.click(await screen.findByRole("button", { name: /^edit$/i }));
    expect(window.location.search).toBe("?dashboard=42&mode=edit");
  });

  it("DSET-117: deep-link arrival into view -> clicking in-app Edit does not turn the arrived entry into one we own", async () => {
    window.history.replaceState(null, "", "/?dashboard=42&mode=view");
    render(<DashboardsPage initialOpenDashboard={{ dashboard: DASH_42, mode: "view" }} />);
    expect(readHistoryMarker()).toBeUndefined();
    await userEvent.click(await screen.findByRole("button", { name: /^edit$/i }));
    expect(readHistoryMarker()).toBeUndefined();
  });

  it("DSET-117: deep-link arrival into view -> in-app Edit: the in-app Back still WRITES", async () => {
    window.history.replaceState(null, "", "/?dashboard=42&mode=view");
    render(<DashboardsPage initialOpenDashboard={{ dashboard: DASH_42, mode: "view" }} />);
    await userEvent.click(await screen.findByRole("button", { name: /^edit$/i }));
    const backSpy = vi.spyOn(window.history, "back");
    await userEvent.click(await screen.findByRole("button", { name: /^cancel$/i }));
    expect(backSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(window.location.search).toBe(""));
  });

  it("DSET-117: deep-link arrival into edit -> Save: the in-app Back still WRITES", async () => {
    window.history.replaceState(null, "", "/?dashboard=42&mode=edit");
    render(<DashboardsPage initialOpenDashboard={{ dashboard: DASH_42, mode: "edit" }} />);
    expect(readHistoryMarker()).toBeUndefined();
    await userEvent.click(await screen.findByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(window.location.search).toBe("?dashboard=42&mode=view"));
    expect(readHistoryMarker()).toBeUndefined();
    const backSpy = vi.spyOn(window.history, "back");
    await userEvent.click(await screen.findByRole("button", { name: /^back$/i }));
    expect(backSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(window.location.search).toBe(""));
    backSpy.mockRestore();
  });

  // ── Back / popstate ─────────────────────────────────────────────────────────────

  it("DSET-117: browser Back from the settings screen returns to the dashboard list", async () => {
    render(<DashboardsPage onViewChange={() => {}} />);
    await screen.findByText(DASH_42.name);
    await userEvent.click(await screen.findByRole("button", { name: /^view$/i }));
    expect(window.location.search).toBe("?dashboard=42&mode=view");
    await act(async () => {
      window.history.replaceState(null, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(await screen.findByRole("button", { name: /^open$/i })).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  it("DSET-117: browser Forward into an entry already left clears the stale param instead of re-opening", async () => {
    render(<DashboardsPage onViewChange={() => {}} />);
    await screen.findByText(DASH_42.name);
    await userEvent.click(await screen.findByRole("button", { name: /^view$/i }));
    const backBtn = await screen.findByRole("button", { name: /^back$/i });
    await userEvent.click(backBtn);
    await screen.findByRole("button", { name: /^open$/i });
    await act(async () => {
      window.history.replaceState(null, "", "/?dashboard=42&mode=view");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await waitFor(() => expect(window.location.search).toBe(""));
    expect(screen.getByRole("button", { name: /^open$/i })).toBeInTheDocument();
  });

  it("DSET-117: the in-app Back from a deep-link arrival into view writes the list URL and the list renders", async () => {
    window.history.replaceState(null, "", "/?dashboard=42&mode=view");
    render(<DashboardsPage initialOpenDashboard={{ dashboard: DASH_42, mode: "view" }} />);
    const backBtn = await screen.findByRole("button", { name: /^back$/i });
    await userEvent.click(backBtn);
    await waitFor(() => expect(window.location.search).toBe(""));
    expect(await screen.findByRole("button", { name: /^open$/i })).toBeInTheDocument();
  });

  // ── Creating ─────────────────────────────────────────────────────────────────────

  it("DSET-117: creating a dashboard lands on its settings screen with ?dashboard=<new id>&mode=view and pushes one entry", async () => {
    (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const created = { id: 99, name: "New One", filter_display_mode: "topbar" as const, created_at: "x", updated_at: "x" };
    (createDashboard as ReturnType<typeof vi.fn>).mockResolvedValue(created);
    render(<DashboardsPage onViewChange={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "+ New Dashboard" }));
    const [nameInput] = screen.getAllByRole("textbox");
    await userEvent.type(nameInput, "New One");
    const pushSpy = vi.spyOn(window.history, "pushState");
    await userEvent.click(await screen.findByRole("button", { name: /^create dashboard$/i }));
    await waitFor(() => expect(window.location.search).toBe("?dashboard=99&mode=view"));
    expect(pushSpy).toHaveBeenCalledTimes(1);
    pushSpy.mockRestore();
  });

  // ── Arrival / no flash ───────────────────────────────────────────────────────────

  it("DSET-117: a { dashboard, mode: 'view' } arrival mounts straight into the settings screen with the list chrome absent", async () => {
    window.history.replaceState(null, "", "/?dashboard=42&mode=view");
    const { container } = render(<DashboardsPage initialOpenDashboard={{ dashboard: DASH_42, mode: "view" }} />);
    expect(await screen.findByRole("button", { name: /^edit$/i })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /^back$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ New Dashboard" })).toBeNull();
    // The list's "Updated" COLUMN HEADER (not DashboardDetail's own "Updated" detail-row label)
    // lives exclusively inside the list's ".ds-header.dash-grid" — absent here proves the list
    // chrome itself never rendered, not merely that no visible "Updated" text exists anywhere.
    expect(container.querySelector(".ds-header.dash-grid")).toBeNull();
  });

  it("DSET-117: a { dashboard, mode: 'edit' } arrival mounts straight into the edit form with the list chrome absent", async () => {
    window.history.replaceState(null, "", "/?dashboard=42&mode=edit");
    const { container } = render(<DashboardsPage initialOpenDashboard={{ dashboard: DASH_42, mode: "edit" }} />);
    expect(await screen.findByRole("button", { name: /^save$/i })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /^cancel$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ New Dashboard" })).toBeNull();
    expect(container.querySelector(".ds-header.dash-grid")).toBeNull();
  });

  it("DSET-117: a { dashboard, mode: 'open' } arrival still mounts into the running dashboard", async () => {
    window.history.replaceState(null, "", "/?dashboard=42");
    const { unmount } = render(<DashboardsPage initialOpenDashboard={{ dashboard: DASH_42, mode: "open" }} />);
    expect(await screen.findByRole("button", { name: /^back$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ New Dashboard" })).toBeNull();
    unmount();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  it("DSET-117: an arrival into view or edit pushes no history entry of its own", async () => {
    window.history.replaceState(null, "", "/?dashboard=42&mode=view");
    render(<DashboardsPage initialOpenDashboard={{ dashboard: DASH_42, mode: "view" }} />);
    await screen.findByRole("button", { name: /^back$/i });
    expect(window.location.search).toBe("?dashboard=42&mode=view");
    expect(readHistoryMarker()).toBeUndefined();
  });
});
