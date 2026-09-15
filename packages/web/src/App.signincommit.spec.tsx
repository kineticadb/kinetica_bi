// Phase 115 Plan 02 (DLINK-V121-03): App-level wiring for the COMMIT-moment sessionStorage
// write (handleSignInCommit) and the LoginPage deepLinkPending signal. A NEW file, per the plan,
// so it collides with nothing — mirrors App.deeplink.spec.tsx's mock harness, with ONE
// difference: the LoginPage stub exposes the commit callback via a "commit-signin" button.
//
// Every test title is prefixed "AUTHLINK-115: " per the plan's grep anchor.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useState } from "react";
import { act, render, screen } from "@testing-library/react";
import { useAuthStore } from "./store/auth";
import { UNAUTHORIZED_EVENT } from "./api/client";

// Stub heavy child components — App.tsx routing logic is what we're testing.
vi.mock("./components/Sidebar", () => ({
  default: ({ onSelect, activeKey }: { onSelect: (k: string) => void; activeKey: string }) => (
    <nav data-testid="sidebar" data-active={activeKey}>
      <button onClick={() => onSelect("datasets")}>nav-datasets</button>
      <button onClick={() => onSelect("roles")}>nav-roles</button>
    </nav>
  ),
}));
vi.mock("./components/Topbar", () => ({
  default: () => <header data-testid="topbar" />,
}));
// Mirror the real DashboardsPage's mount-time lazy-useState capture contract — a dumb
// prop-reflector would falsely fail (App's own effects mutate the prop's upstream state after
// mount). Same pattern as App.deeplink.spec.tsx.
vi.mock("./components/DashboardsPage", () => ({
  default: ({ initialOpenDashboard }: { initialOpenDashboard?: { id: number } }) => {
    const [captured] = useState(() => initialOpenDashboard);
    return <main data-testid="page-dashboards" data-deeplink={captured ? String(captured.id) : ""}>Dashboards</main>;
  },
}));
vi.mock("./components/DatasetsPage", () => ({
  default: () => <main data-testid="page-datasets">Datasets</main>,
}));
// The ONE difference from App.deeplink.spec.tsx's harness: expose onSignInCommit + deepLinkPending.
vi.mock("./components/LoginPage", () => ({
  default: ({ deepLinkPending, onSignInCommit }: { deepLinkPending?: boolean; onSignInCommit?: () => void }) => (
    <div data-testid="login-page" data-pending={deepLinkPending ? "1" : "0"}>
      <button onClick={() => onSignInCommit?.()}>commit-signin</button>
    </div>
  ),
}));
vi.mock("./components/Toast", () => ({
  default: () => null,
}));
vi.mock("./api/client", async () => {
  const actual = await vi.importActual<typeof import("./api/client")>("./api/client");
  return {
    ...actual,
    UNAUTHORIZED_EVENT: actual.UNAUTHORIZED_EVENT,
    PERMISSION_DENIED_EVENT: actual.PERMISSION_DENIED_EVENT,
    dropFilterView: vi.fn(() => Promise.resolve({ dropped: true as const })),
    dropDynamicView: vi.fn(() => Promise.resolve({ dropped: true as const })),
    fetchAuthConfig: vi.fn(() => Promise.resolve({ authMode: "password" as const })),
    fetchMe: vi.fn(() => Promise.resolve(null)),
    listUsers: vi.fn(() => Promise.resolve([])),
    listDashboards: vi.fn(() => Promise.resolve([])),
    // Phase 11 MAP-01/02's WMS probe fires on every authenticated mount; unmocked, it hits a
    // real network call which would dispatch UNAUTHORIZED_EVENT and log the test out mid-await.
    fetchWmsCapabilities: vi.fn(() => Promise.resolve({
      renderModes: [], colormaps: [], spatialModes: [], srs: [], source: "fallback" as const,
    })),
  };
});
vi.mock("./components/UsersPage", () => ({
  UsersPage: () => <main data-testid="page-users">Users</main>,
}));
vi.mock("./components/RolesPage", () => ({
  RolesPage: () => <main data-testid="page-roles">Roles</main>,
}));
vi.mock("./components/ProfilePage", () => ({
  ProfilePage: () => <main data-testid="page-profile">Profile</main>,
}));
vi.mock("./components/settings/BrandingSettingsPage", () => ({
  BrandingSettingsPage: () => <main data-testid="page-branding">Branding</main>,
}));

import App from "./App";

const setAuth = (patch: Partial<ReturnType<typeof useAuthStore.getState>>) => {
  act(() => {
    useAuthStore.setState(patch);
  });
};

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  sessionStorage.clear();
  useAuthStore.setState({
    status: "authenticated",
    user: { username: "alice", roles: [], permissions: [] },
    authMode: "oidc",
    reason: null,
    error: null,
    bootstrap: async () => {},
  });
});

const readReturnTo = () => {
  const raw = sessionStorage.getItem("kbi_returnTo");
  return raw ? JSON.parse(raw) : null;
};

describe("App — AUTHLINK-115 commit-moment sessionStorage write (Phase 115 Plan 02)", () => {
  it("AUTHLINK-115: OIDC — committing to sign in writes { dashboardId, page: 'dashboards' } to kbi_returnTo", () => {
    window.history.replaceState(null, "", "/?dashboard=12");
    setAuth({ status: "unauthenticated", authMode: "oidc" });
    render(<App />);
    act(() => {
      screen.getByText("commit-signin").click();
    });
    expect(readReturnTo()).toEqual({ dashboardId: 12, page: "dashboards" });
  });

  it("AUTHLINK-115: OIDC — the commit write overwrites a leftover ReturnTo page from a previous document", () => {
    // Models a leftover from a tab that was reloaded since — NOT written by THIS document's
    // UNAUTHORIZED_EVENT, so expiredHereRef is false.
    sessionStorage.setItem("kbi_returnTo", JSON.stringify({ page: "roles" }));
    window.history.replaceState(null, "", "/?dashboard=12");
    setAuth({ status: "unauthenticated", authMode: "oidc" });
    render(<App />);
    act(() => {
      screen.getByText("commit-signin").click();
    });
    expect(readReturnTo()).toEqual({ dashboardId: 12, page: "dashboards" });
  });

  it("AUTHLINK-115: OIDC — an expiry captured in THIS document on a non-dashboards page is NOT clobbered by the stale param", () => {
    // Mount authenticated, on the default dashboards page.
    setAuth({ status: "authenticated", authMode: "oidc" });
    render(<App />);

    // Navigate to Roles.
    act(() => {
      screen.getByText("nav-roles").click();
    });
    expect(screen.getByTestId("page-roles")).toBeInTheDocument();

    // A stale ?dashboard=12 sits in the address bar (the 401 outran DashboardsPage's deferred
    // clear — DashboardsPage.tsx:646-651's documented race).
    window.history.replaceState(null, "", "/?dashboard=12");

    // The REAL 401 event — this is what sets expiredHereRef AND writes { page: "roles", ... }.
    act(() => {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    });

    // Flip to unauthenticated (what markUnauthenticated inside the handler ultimately does).
    setAuth({ status: "unauthenticated" });
    expect(screen.getByTestId("login-page")).toBeInTheDocument();

    act(() => {
      screen.getByText("commit-signin").click();
    });

    const stored = readReturnTo();
    expect(stored.page).toBe("roles");
    expect(stored.dashboardId).toBeUndefined();
  });

  it("AUTHLINK-115: password mode — committing to sign in writes nothing", () => {
    window.history.replaceState(null, "", "/?dashboard=12");
    setAuth({ status: "unauthenticated", authMode: "password" });
    render(<App />);
    act(() => {
      screen.getByText("commit-signin").click();
    });
    expect(sessionStorage.getItem("kbi_returnTo")).toBeNull();
  });

  it("AUTHLINK-115: no pending link — committing to sign in writes nothing", () => {
    window.history.replaceState(null, "", "/");
    setAuth({ status: "unauthenticated", authMode: "oidc" });
    render(<App />);
    act(() => {
      screen.getByText("commit-signin").click();
    });
    expect(sessionStorage.getItem("kbi_returnTo")).toBeNull();
  });

  it("AUTHLINK-115: LoginPage is told a link is pending", () => {
    window.history.replaceState(null, "", "/?dashboard=12");
    setAuth({ status: "unauthenticated", authMode: "oidc" });
    render(<App />);
    expect(screen.getByTestId("login-page").getAttribute("data-pending")).toBe("1");
  });

  it("AUTHLINK-115: LoginPage is told NO link is pending when the URL has no dashboard param", () => {
    window.history.replaceState(null, "", "/");
    setAuth({ status: "unauthenticated", authMode: "oidc" });
    render(<App />);
    expect(screen.getByTestId("login-page").getAttribute("data-pending")).toBe("0");
  });
});
