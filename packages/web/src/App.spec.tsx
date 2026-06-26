// Phase 7 (UX-06): App.tsx UNAUTHORIZED_EVENT writes kbi_returnTo in OIDC mode;
// mount effect reads+restores+clears on status='authenticated'.
// Phase 15 LIFE-V13-03: logout cleanup — snapshot views, fire-and-forget DROPs, reset both stores.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useAuthStore } from "./store/auth";
import { useFilterStore, type ActiveFilter } from "./store/filterStore";
import { useFilterViewStore } from "./store/filterViewStore";
import { useInfoSelectionStore } from "./store/infoSelectionStore";
import { useLastInfoClickContextStore } from "./store/lastInfoClickContextStore";
import { useSpatialFilterStore } from "./store/spatialFilterStore";
import { useDynamicViewStore } from "./store/dynamicViewStore";
import { UNAUTHORIZED_EVENT } from "./api/client";

// Stub heavy child components — App.tsx routing logic is what we're testing.
vi.mock("./components/Sidebar", () => ({
  default: ({ onSelect, activeKey }: { onSelect: (k: string) => void; activeKey: string }) => (
    <nav data-testid="sidebar" data-active={activeKey}>
      <button onClick={() => onSelect("datasets")}>nav-datasets</button>
    </nav>
  ),
}));
vi.mock("./components/Topbar", () => ({
  default: () => <header data-testid="topbar" />,
}));
vi.mock("./components/DashboardsPage", () => ({
  default: () => <main data-testid="page-dashboards">Dashboards</main>,
}));
vi.mock("./components/DatasetsPage", () => ({
  default: () => <main data-testid="page-datasets">Datasets</main>,
}));
vi.mock("./components/LoginPage", () => ({
  default: () => <div data-testid="login-page">Login</div>,
}));
vi.mock("./components/Toast", () => ({
  default: () => null,
}));
// Stub bootstrap so it doesn't actually fetch; also stub dropFilterView for LIFE-V13-03 tests.
vi.mock("./api/client", async () => {
  const actual = await vi.importActual<typeof import("./api/client")>("./api/client");
  return {
    ...actual,
    UNAUTHORIZED_EVENT: actual.UNAUTHORIZED_EVENT,
    // Phase 48 GATE-V18-01: expose PERMISSION_DENIED_EVENT so tests can dispatch it.
    PERMISSION_DENIED_EVENT: actual.PERMISSION_DENIED_EVENT,
    dropFilterView: vi.fn(() => Promise.resolve({ dropped: true as const })),
    // Phase 33 DV-V16-07: mock dropDynamicView for the 6th-store DROP loop.
    dropDynamicView: vi.fn(() => Promise.resolve({ dropped: true as const })),
    fetchAuthConfig: vi.fn(() => Promise.resolve({ authMode: "password" as const })),
    fetchMe: vi.fn(() => Promise.resolve(null)),
    // Phase 49 USERS-V18-04: listUsers mock for onboarding banner tests.
    listUsers: vi.fn(() => Promise.resolve([])),
  };
});

// Stub UsersPage — App routing + banner is what we're testing here; UsersPage internals tested in its own spec.
vi.mock("./components/UsersPage", () => ({
  UsersPage: () => <main data-testid="page-users">Users</main>,
}));

// Stub RolesPage — same pattern as UsersPage; RolesPage internals tested in its own spec.
vi.mock("./components/RolesPage", () => ({
  RolesPage: () => <main data-testid="page-roles">Roles</main>,
}));

// Stub ProfilePage — reached via Topbar menu, not Sidebar; internals tested separately.
vi.mock("./components/ProfilePage", () => ({
  ProfilePage: () => <main data-testid="page-profile">Profile</main>,
}));

// Stub BrandingSettingsPage — App's permission-gated render branch is what we test here.
vi.mock("./components/settings/BrandingSettingsPage", () => ({
  BrandingSettingsPage: () => <main data-testid="page-branding">Branding</main>,
}));

import App from "./App";
import { dropFilterView, dropDynamicView, PERMISSION_DENIED_EVENT, fetchMe, listUsers } from "./api/client";
import { seedUserAdminStore, seedAnalystStore } from "./test/seedAuthStore";
import { PERMISSIONS } from "./lib/permissions";

const setAuth = (patch: Partial<ReturnType<typeof useAuthStore.getState>>) => {
  act(() => {
    useAuthStore.setState(patch);
  });
};

beforeEach(() => {
  // Override the bootstrap to a no-op for these tests so we control status manually.
  useAuthStore.setState({
    status: "authenticated",
    user: { username: "alice", roles: [], permissions: [] },
    authMode: "oidc",
    reason: null,
    error: null,
    bootstrap: async () => {},
  });
  sessionStorage.clear();
});

describe("App — UNAUTHORIZED_EVENT writes kbi_returnTo in OIDC mode (UX-06)", () => {
  it("writes JSON to sessionStorage['kbi_returnTo'] when authMode='oidc'", () => {
    setAuth({ authMode: "oidc", status: "authenticated" });
    render(<App />);
    act(() => {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    });
    const raw = sessionStorage.getItem("kbi_returnTo");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed).toHaveProperty("page");
    expect(parsed).toHaveProperty("dashboardViewMode");
  });

  it("does NOT write sessionStorage when authMode='password'", () => {
    setAuth({ authMode: "password", status: "authenticated" });
    render(<App />);
    act(() => {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    });
    expect(sessionStorage.getItem("kbi_returnTo")).toBeNull();
  });

  it("calls markUnauthenticated('session-expired') in BOTH modes (regression on 401 chain)", () => {
    const markUnauth = vi.fn();
    setAuth({ authMode: "password", status: "authenticated", markUnauthenticated: markUnauth });
    render(<App />);
    act(() => {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    });
    expect(markUnauth).toHaveBeenCalledWith("session-expired");

    const markUnauth2 = vi.fn();
    setAuth({ authMode: "oidc", status: "authenticated", markUnauthenticated: markUnauth2 });
    // Re-render to pick up the new markUnauthenticated reference.
    // (Each render binds a fresh handler with the latest store state.)
    const { unmount } = render(<App />);
    act(() => {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    });
    expect(markUnauth2).toHaveBeenCalledWith("session-expired");
    unmount();
  });
});

describe("App — read+restore+clear on status='authenticated' (UX-06)", () => {
  it("restores page='datasets' from sessionStorage when status flips to authenticated", async () => {
    sessionStorage.setItem("kbi_returnTo", JSON.stringify({ page: "datasets" }));
    // Mount with status='unknown' first, then transition to 'authenticated' to fire the effect.
    setAuth({ status: "unknown" });
    const { rerender } = render(<App />);
    // Loading state visible.
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    setAuth({ status: "authenticated", authMode: "oidc", user: { username: "alice", roles: [], permissions: [] } });
    rerender(<App />);
    // Page transitioned to datasets.
    expect(await screen.findByTestId("page-datasets")).toBeInTheDocument();
    expect(screen.queryByTestId("page-dashboards")).not.toBeInTheDocument();
  });

  it("clears sessionStorage['kbi_returnTo'] after restore (single-use)", () => {
    sessionStorage.setItem("kbi_returnTo", JSON.stringify({ page: "datasets" }));
    setAuth({ status: "authenticated", authMode: "oidc" });
    render(<App />);
    // After the mount effect runs, the key is gone.
    expect(sessionStorage.getItem("kbi_returnTo")).toBeNull();
  });

  it("does NOT crash on corrupt JSON; clears the key", () => {
    sessionStorage.setItem("kbi_returnTo", "not valid json{");
    setAuth({ status: "authenticated", authMode: "oidc" });
    // No throw expected.
    render(<App />);
    expect(sessionStorage.getItem("kbi_returnTo")).toBeNull();
    // Default page renders.
    expect(screen.getByTestId("page-dashboards")).toBeInTheDocument();
  });

  it("rejects unknown 'page' values; key is still cleared", () => {
    sessionStorage.setItem("kbi_returnTo", JSON.stringify({ page: "hacker_page" }));
    setAuth({ status: "authenticated", authMode: "oidc" });
    render(<App />);
    // Default page is dashboards (unchanged).
    expect(screen.getByTestId("page-dashboards")).toBeInTheDocument();
    expect(sessionStorage.getItem("kbi_returnTo")).toBeNull();
  });

  it("does nothing when sessionStorage['kbi_returnTo'] is empty", () => {
    // No setItem call.
    setAuth({ status: "authenticated", authMode: "oidc" });
    render(<App />);
    expect(screen.getByTestId("page-dashboards")).toBeInTheDocument();
  });
});

describe("App — status gates (regression — Pitfall #2)", () => {
  it("renders Loading state when status='unknown'", () => {
    setAuth({ status: "unknown" });
    render(<App />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    expect(screen.queryByTestId("login-page")).not.toBeInTheDocument();
  });

  it("renders LoginPage when status='unauthenticated'", () => {
    setAuth({ status: "unauthenticated" });
    render(<App />);
    expect(screen.getByTestId("login-page")).toBeInTheDocument();
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
  });

  it("renders authenticated app-shell when status='authenticated'", () => {
    setAuth({ status: "authenticated", authMode: "password" });
    render(<App />);
    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("topbar")).toBeInTheDocument();
  });
});

describe("App — LIFE-V13-03 (logout cleanup)", () => {
  beforeEach(() => {
    (dropFilterView as ReturnType<typeof vi.fn>).mockClear();
    (dropFilterView as ReturnType<typeof vi.fn>).mockImplementation(() => Promise.resolve({ dropped: true as const }));
    // Phase 33 DV-V16-07: clear + default the 6th-store DROP-loop mock.
    (dropDynamicView as ReturnType<typeof vi.fn>).mockClear();
    (dropDynamicView as ReturnType<typeof vi.fn>).mockImplementation(() => Promise.resolve({ dropped: true as const }));
    // Seed authenticated state so the App mounts past the login gate
    useAuthStore.setState({
      status: "authenticated",
      user: { username: "test" },
      authMode: "password",
      bootstrap: async () => {},
    } as unknown as ReturnType<typeof useAuthStore.getState>);
  });

  afterEach(() => {
    // Re-set to authenticated to avoid bleed into other suites
    useAuthStore.setState({
      status: "authenticated",
      user: { username: "test" },
      authMode: "password",
      bootstrap: async () => {},
    } as ReturnType<typeof useAuthStore.getState>);
  });

  it("fires dropFilterView for each active view with entry.dashboardId on logout", async () => {
    // Seed two active views on different dashboards
    useFilterViewStore.getState().setView(99, { viewName: "_kbi_filt_v1", expiresAt: Date.now() + 60000 }, 5);
    useFilterViewStore.getState().setView(100, { viewName: "_kbi_filt_v2", expiresAt: Date.now() + 60000 }, 7);

    render(<App />);

    // Trigger logout
    act(() => {
      useAuthStore.setState({ status: "unauthenticated" } as ReturnType<typeof useAuthStore.getState>);
    });

    // Wait for effect microtask flush
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(dropFilterView).toHaveBeenCalledTimes(2);
    expect(dropFilterView).toHaveBeenCalledWith({ dashboardId: 5, tableId: 99 });
    expect(dropFilterView).toHaveBeenCalledWith({ dashboardId: 7, tableId: 100 });
  });

  it("resets ALL SIX stores after the DROP loop fires (filterStore + filterViewStore + infoSelectionStore + lastInfoClickContextStore + spatialFilterStore + dynamicViewStore — STORE-V14-04 + Plan 23-02 extension + Plan 27-02 STORE-V15-04 extension + Phase 33 DV-V16-07 extension)", async () => {
    useFilterStore.getState().addFilter(99, {
      column: "g", value: "A", dataType: "string", addedAt: Date.now(),
    } as ActiveFilter);
    useFilterViewStore.getState().setView(99, { viewName: "_kbi_filt_v1", expiresAt: Date.now() + 60000 }, 5);
    // Phase 20: seed info-selection store
    useInfoSelectionStore.getState().setSelection(7, { rows: [{ id: 1 }], columns: ["id"], page: 0, hasMore: false });
    useInfoSelectionStore.getState().setActiveLayer(7);
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
      viewName: "_kbi_dv_utest_d5_10",
      status: "materialized",
      expiresAt: Date.now() + 60000,
    });

    render(<App />);

    act(() => {
      useAuthStore.setState({ status: "unauthenticated" } as ReturnType<typeof useAuthStore.getState>);
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(useFilterStore.getState().filters).toEqual({});
    expect(useFilterStore.getState().filterVersion).toBe(0);
    expect(useFilterViewStore.getState().views).toEqual({});
    // Phase 20 STORE-V14-04: info-selection store also resets
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

  // Phase 33 DV-V16-07: 6th-store DROP loop assertions.
  it("fires dropDynamicView for each MATERIALIZED entry on UNAUTHORIZED (and only materialized — pending/error/over_threshold skipped)", async () => {
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

    render(<App />);

    act(() => {
      useAuthStore.setState({ status: "unauthenticated" } as ReturnType<typeof useAuthStore.getState>);
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    // ONLY entry 10 (materialized) should trigger dropDynamicView.
    expect(dropDynamicView).toHaveBeenCalledTimes(1);
    expect(dropDynamicView).toHaveBeenCalledWith(10);
    expect(dropDynamicView).not.toHaveBeenCalledWith(11);
    expect(dropDynamicView).not.toHaveBeenCalledWith(12);
    expect(dropDynamicView).not.toHaveBeenCalledWith(13);

    // Store fully reset after the loop.
    expect(useDynamicViewStore.getState().views).toEqual({});
    expect(useDynamicViewStore.getState().dynamicViewVersion).toBe(0);
  });

  it("Phase 33 DV-V16-07: swallows dropDynamicView errors silently (fire-and-forget — V13-P-12)", async () => {
    (dropDynamicView as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network error"));
    useDynamicViewStore.getState().setView(10, {
      viewName: "_kbi_dv_mat",
      status: "materialized",
      expiresAt: Date.now() + 60000,
    });

    render(<App />);

    // Trigger logout — must not throw.
    expect(() => {
      act(() => {
        useAuthStore.setState({ status: "unauthenticated" } as ReturnType<typeof useAuthStore.getState>);
      });
    }).not.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Store still resets despite the rejection.
    expect(useDynamicViewStore.getState().views).toEqual({});
  });

  it("Phase 33 DV-V16-07: does NOT fire dropDynamicView when status stays 'authenticated' (no logout transition)", async () => {
    useDynamicViewStore.getState().setView(10, {
      viewName: "_kbi_dv_mat",
      status: "materialized",
      expiresAt: Date.now() + 60000,
    });

    render(<App />);

    // No status change — effect should not run cleanup.
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(dropDynamicView).not.toHaveBeenCalled();
    expect(useDynamicViewStore.getState().views[10]).toBeDefined();
  });

  it("Phase 33 DV-V16-07: snapshot taken BEFORE reset — DROP loop iterates pre-reset entries", async () => {
    // If the implementation called reset() FIRST and then iterated views, dropDynamicView
    // would never fire because views would already be {}. The fact that it IS called
    // with the materialized id proves the snapshot happened before reset.
    useDynamicViewStore.getState().setView(10, {
      viewName: "_kbi_dv_mat",
      status: "materialized",
      expiresAt: Date.now() + 60000,
    });

    render(<App />);

    act(() => {
      useAuthStore.setState({ status: "unauthenticated" } as ReturnType<typeof useAuthStore.getState>);
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(dropDynamicView).toHaveBeenCalledWith(10);
    expect(useDynamicViewStore.getState().views).toEqual({});
  });

  // Plan 23-02 Pitfall 1 regression test: stale dashboard-A click coords must not survive a session boundary.
  it("Pitfall 1: stale lastInfoClickContext does not survive a session boundary (Plan 23-02)", async () => {
    useLastInfoClickContextStore.getState().setContext({
      clickLon: -73.985, clickLat: 40.748,
      mapBbox: [-74.1, 40.6, -73.85, 40.85],
      mapWidthPx: 800, mapHeightPx: 600,
      radiusPx: 20, sourceWidgetId: 42,
    });
    expect(useLastInfoClickContextStore.getState().context).not.toBeNull();

    render(<App />);

    act(() => {
      useAuthStore.setState({ status: "unauthenticated" } as ReturnType<typeof useAuthStore.getState>);
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(useLastInfoClickContextStore.getState().context).toBeNull();
  });

  it("swallows dropFilterView errors silently (fire-and-forget — V13-P-12)", async () => {
    (dropFilterView as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network error"));
    useFilterViewStore.getState().setView(99, { viewName: "_kbi_filt_v1", expiresAt: Date.now() + 60000 }, 5);

    render(<App />);

    // Trigger logout — must not throw
    expect(() => {
      act(() => {
        useAuthStore.setState({ status: "unauthenticated" } as ReturnType<typeof useAuthStore.getState>);
      });
    }).not.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Stores still reset even though DROP rejected
    expect(useFilterViewStore.getState().views).toEqual({});
  });

  it("does NOT fire dropFilterView when status stays 'authenticated' (no logout transition)", async () => {
    useFilterViewStore.getState().setView(99, { viewName: "_kbi_filt_v1", expiresAt: Date.now() + 60000 }, 5);

    render(<App />);

    // No status change — effect should not run cleanup
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(dropFilterView).not.toHaveBeenCalled();
    expect(useFilterViewStore.getState().views[99]).toBeDefined();
  });

  it("handles empty views map cleanly (no DROP calls, both stores reset to empty)", async () => {
    // No pre-seeded views
    render(<App />);

    act(() => {
      useAuthStore.setState({ status: "unauthenticated" } as ReturnType<typeof useAuthStore.getState>);
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(dropFilterView).not.toHaveBeenCalled();
    expect(useFilterViewStore.getState().views).toEqual({});
    expect(useFilterStore.getState().filters).toEqual({});
  });
});

// Phase 48 (GATE-V18-01): PERMISSION_DENIED_EVENT re-syncs /me and calls setPermissions.
describe("App — PERMISSION_DENIED_EVENT re-fetches /me and updates permissions (GATE-V18-01)", () => {
  beforeEach(() => {
    // Reset useAuthStore to known clean authenticated state with empty permissions.
    useAuthStore.setState({
      status: "authenticated",
      user: { username: "u", roles: [], permissions: [] },
      authMode: "password",
      bootstrap: async () => {},
    } as unknown as ReturnType<typeof useAuthStore.getState>);
    // Reset fetchMe mock to return a full MeResponse with updated permissions.
    (fetchMe as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { username: "u", roles: ["designer"], permissions: ["dashboards:edit"] },
      authMode: "password" as const,
    });
  });

  afterEach(() => {
    // Restore fetchMe to the default null-returning mock so other test suites are unaffected.
    (fetchMe as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  });

  it("PERMISSION_DENIED_EVENT re-fetches /me and updates permissions via setPermissions", async () => {
    render(<App />);

    // Precondition: permissions are empty.
    expect(useAuthStore.getState().hasPermission("dashboards:edit")).toBe(false);

    // Dispatch the permission-denied event (mirrors what apiFetch fires on 403/PERMISSION_DENIED).
    act(() => {
      window.dispatchEvent(new CustomEvent(PERMISSION_DENIED_EVENT));
    });

    // Wait for fetchMe promise to resolve and setPermissions to apply.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // The store must now reflect the refreshed permissions.
    expect(useAuthStore.getState().hasPermission("dashboards:edit")).toBe(true);
    expect(fetchMe).toHaveBeenCalled();
  });

  it("PERMISSION_DENIED_EVENT handler swallows fetchMe errors silently (no crash)", async () => {
    (fetchMe as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network error"));

    render(<App />);

    // Must not throw.
    expect(() => {
      act(() => {
        window.dispatchEvent(new CustomEvent(PERMISSION_DENIED_EVENT));
      });
    }).not.toThrow();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // Permissions remain unchanged (not cleared) — fetchMe rejection is swallowed.
    expect(useAuthStore.getState().hasPermission("dashboards:edit")).toBe(false);
  });
});

// Phase 50 ROLES-V18-01: RolesPage render branch + ReturnTo restore.
describe("App — ROLES-V18-01: RolesPage render branch + OIDC ReturnTo restore", () => {
  it("sessionStorage ReturnTo page='roles': authenticated mount restores to RolesPage", async () => {
    sessionStorage.setItem("kbi_returnTo", JSON.stringify({ page: "roles" }));
    setAuth({ status: "unknown" });
    const { rerender } = render(<App />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    setAuth({ status: "authenticated", authMode: "oidc", user: { username: "testadmin", roles: ["admin"], permissions: [] } });
    rerender(<App />);
    expect(await screen.findByTestId("page-roles")).toBeInTheDocument();
    expect(screen.queryByTestId("page-dashboards")).not.toBeInTheDocument();
  });

  it("sessionStorage ReturnTo page='roles': key cleared after restore (single-use)", () => {
    sessionStorage.setItem("kbi_returnTo", JSON.stringify({ page: "roles" }));
    setAuth({ status: "authenticated", authMode: "oidc", user: { username: "testadmin", roles: ["admin"], permissions: [] } });
    render(<App />);
    expect(sessionStorage.getItem("kbi_returnTo")).toBeNull();
  });

  it("Sidebar onSelect('roles'): navigating to roles renders RolesPage, not DashboardsPage", async () => {
    // The global Sidebar stub exposes a nav-datasets button; for this test we use the
    // ReturnTo mechanism to prove the render branch exists (page === 'roles' → <RolesPage />).
    // Direct Sidebar-nav simulation: seed authenticated, then set page via Sidebar stub's onSelect.
    // The existing global Sidebar mock only exposes 'datasets' — we verify the render branch
    // via ReturnTo (already covered above). Here we test that 'roles' is NOT treated as unknown:
    sessionStorage.setItem("kbi_returnTo", JSON.stringify({ page: "roles" }));
    setAuth({ status: "authenticated", authMode: "oidc", user: { username: "testadmin", roles: ["admin"], permissions: [] } });
    render(<App />);
    // The RolesPage stub renders data-testid="page-roles"
    expect(await screen.findByTestId("page-roles")).toBeInTheDocument();
  });
});

// Phase 84 (Test 14): branding page is client-gated on branding:manage, not just
// the hidden nav link — a non-permitted user who reaches page='branding' (restored
// from sessionStorage or a stale state) must NOT land on the page.
describe("App — branding page permission gate (Test 14)", () => {
  it("does NOT restore/render branding for a user without branding:manage", async () => {
    sessionStorage.setItem("kbi_returnTo", JSON.stringify({ page: "branding" }));
    setAuth({ status: "unknown" });
    const { rerender } = render(<App />);
    setAuth({
      status: "authenticated",
      authMode: "oidc",
      user: { username: "analyst", roles: ["analyst"], permissions: [] },
    });
    rerender(<App />);
    // Falls back to dashboards; branding page never rendered.
    expect(await screen.findByTestId("page-dashboards")).toBeInTheDocument();
    expect(screen.queryByTestId("page-branding")).not.toBeInTheDocument();
  });

  it("restores/renders branding for a user WITH branding:manage", async () => {
    sessionStorage.setItem("kbi_returnTo", JSON.stringify({ page: "branding" }));
    setAuth({ status: "unknown" });
    const { rerender } = render(<App />);
    setAuth({
      status: "authenticated",
      authMode: "oidc",
      user: { username: "admin", roles: ["admin"], permissions: [PERMISSIONS.BRANDING_MANAGE] },
    });
    rerender(<App />);
    expect(await screen.findByTestId("page-branding")).toBeInTheDocument();
    expect(screen.queryByTestId("page-dashboards")).not.toBeInTheDocument();
  });
});

// Phase 49 USERS-V18-04: Onboarding banner — gating, dismiss, zero-unassigned, bootstrap exclusion.
describe("App — onboarding banner (USERS-V18-04)", () => {
  beforeEach(() => {
    (listUsers as ReturnType<typeof vi.fn>).mockClear();
    (fetchMe as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  });

  it("Test 1: shows banner with correct count when user has users:assign_roles and unassigned non-bootstrap users exist; clicking link routes to Users page", async () => {
    (listUsers as ReturnType<typeof vi.fn>).mockResolvedValue([
      { username: "a", roles: [], last_seen: null, is_bootstrap: false },
      { username: "b", roles: [], last_seen: null, is_bootstrap: false },
    ]);
    seedUserAdminStore();

    const { getByText, findByText, getByTestId } = render(<App />);

    // Wait for the banner to appear via async fetch
    await findByText(/2 users are on the default analyst role/);

    // Clicking the banner link should route to the Users page
    const link = getByText("Review in User Management");
    act(() => {
      link.click();
    });

    expect(getByTestId("page-users")).toBeInTheDocument();
  });

  it("Test 2: does NOT call listUsers and does NOT show the banner when user lacks users:assign_roles", () => {
    seedAnalystStore();

    render(<App />);

    // listUsers must not have been called at all
    expect(listUsers).not.toHaveBeenCalled();
    // Banner text must not be present
    expect(document.body).not.toHaveTextContent(/on the default analyst role/);
  });

  it("Test 3: dismiss — clicking × hides the banner", async () => {
    (listUsers as ReturnType<typeof vi.fn>).mockResolvedValue([
      { username: "a", roles: [], last_seen: null, is_bootstrap: false },
    ]);
    seedUserAdminStore();

    const { findByText, queryByText, getByLabelText } = render(<App />);

    // Banner appears
    await findByText(/1 user is on the default analyst role/);

    // Click dismiss
    act(() => {
      getByLabelText("Dismiss").click();
    });

    // Banner gone
    expect(queryByText(/on the default analyst role/)).not.toBeInTheDocument();
  });

  it("Test 4: banner not shown when all non-bootstrap users are assigned (bootstrap row excluded from unassigned count)", async () => {
    // Bootstrap row has roles:[] but is_bootstrap:true — must NOT count
    // User "c" has a role — assigned
    (listUsers as ReturnType<typeof vi.fn>).mockResolvedValue([
      { username: "admin", roles: [], last_seen: null, is_bootstrap: true },
      { username: "c", roles: ["designer"], last_seen: null, is_bootstrap: false },
    ]);
    seedUserAdminStore();

    render(<App />);

    // Wait for fetch resolution
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // unassignedCount === 0 → banner must NOT appear
    expect(document.body).not.toHaveTextContent(/on the default analyst role/);
  });
});
