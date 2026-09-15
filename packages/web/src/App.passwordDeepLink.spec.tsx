// Phase 115 Plan 01 Task 3 (DLINK-V121-03): pins the password-mode logged-out deep-link
// journey that 115-RESEARCH.md §Q1 proved (by executed test) already works end-to-end with
// ZERO changes to App.tsx or LoginPage.tsx. This file is a permanent regression test for
// that finding, adapted from §Q1's throwaway spike.
//
// Mock harness mirrors App.deeplink.spec.tsx, with one deliberate difference: LoginPage is
// NOT mocked here — the real password form must render, because that is exactly the surface
// this regression pins.
//
// Every test title is prefixed "AUTHLINK-115: " per the plan's grep anchor.

import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { act, render, screen } from "@testing-library/react";
import { useAuthStore } from "./store/auth";

vi.mock("./components/Sidebar", () => ({ default: () => <nav data-testid="sidebar" /> }));
vi.mock("./components/Topbar", () => ({ default: () => <header data-testid="topbar" /> }));
// Mirror the REAL DashboardsPage's mount-time lazy-useState capture contract — a dumb
// prop-reflector falsely fails (App's own effects mutate the prop's upstream state after
// mount; see App.deeplink.spec.tsx:27-32 and 115-RESEARCH.md §Q1/Pitfall 2).
vi.mock("./components/DashboardsPage", () => ({
  default: ({ initialOpenDashboard }: { initialOpenDashboard?: { dashboard: { id: number }; mode: string } }) => {
    const [captured] = useState(() => initialOpenDashboard);
    return (
      <main
        data-testid="page-dashboards"
        data-deeplink={captured ? String(captured.dashboard.id) : ""}
        data-mode={captured?.mode ?? ""}
      >
        Dashboards
      </main>
    );
  },
}));
vi.mock("./components/DatasetsPage", () => ({ default: () => <main data-testid="page-datasets" /> }));
// Real LoginPage NOT mocked — we want the real password-form branch to render.
vi.mock("./components/Toast", () => ({ default: () => null }));
vi.mock("./api/client", async () => {
  const actual = await vi.importActual<typeof import("./api/client")>("./api/client");
  return {
    ...actual,
    dropFilterView: vi.fn(() => Promise.resolve({ dropped: true as const })),
    dropDynamicView: vi.fn(() => Promise.resolve({ dropped: true as const })),
    fetchAuthConfig: vi.fn(() => Promise.resolve({ authMode: "password" as const })),
    fetchMe: vi.fn(() => Promise.resolve(null)),
    listUsers: vi.fn(() => Promise.resolve([])),
    listDashboards: vi.fn(() =>
      Promise.resolve([
        {
          id: 12,
          name: "Deep Linked",
          filter_display_mode: "topbar" as const,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ]),
    ),
    fetchWmsCapabilities: vi.fn(() =>
      Promise.resolve({
        renderModes: [],
        colormaps: [],
        spatialModes: [],
        srs: [],
        source: "fallback" as const,
      }),
    ),
  };
});
vi.mock("./components/UsersPage", () => ({ UsersPage: () => <main data-testid="page-users" /> }));
vi.mock("./components/RolesPage", () => ({ RolesPage: () => <main data-testid="page-roles" /> }));
vi.mock("./components/ProfilePage", () => ({ ProfilePage: () => <main data-testid="page-profile" /> }));
vi.mock("./components/settings/BrandingSettingsPage", () => ({
  BrandingSettingsPage: () => <main data-testid="page-branding" />,
}));

import App from "./App";
import { listDashboards } from "./api/client";

const setAuth = (patch: Partial<ReturnType<typeof useAuthStore.getState>>) => {
  act(() => {
    useAuthStore.setState(patch);
  });
};

describe("password-mode logged-out deep link paste (AUTHLINK-115)", () => {
  it("AUTHLINK-115: password mode — a logged-out ?dashboard=12 arrival renders the real login form and keeps the param", async () => {
    window.history.replaceState(null, "", "/?dashboard=12");
    setAuth({
      status: "unauthenticated",
      user: null,
      authMode: "password",
      reason: null,
      error: null,
      bootstrap: async () => {},
    });

    render(<App />);

    expect(await screen.findByLabelText(/username/i)).toBeInTheDocument();
    expect(window.location.search).toBe("?dashboard=12");
    expect(screen.queryByTestId("page-dashboards")).toBeNull();
    expect(listDashboards).not.toHaveBeenCalled();
  });

  it("AUTHLINK-115: password mode — the in-place sign-in flip lands on the linked dashboard, not the list", async () => {
    window.history.replaceState(null, "", "/?dashboard=12");
    setAuth({
      status: "unauthenticated",
      user: null,
      authMode: "password",
      reason: null,
      error: null,
      bootstrap: async () => {},
    });

    render(<App />);
    expect(await screen.findByLabelText(/username/i)).toBeInTheDocument();

    // In-place store flip — exactly the shape a real password login() success uses.
    // No navigation, no reason left set (that would test the wrong thing — see
    // 115-RESEARCH.md §Q5 Pitfall 1).
    setAuth({
      status: "authenticated",
      user: { username: "alice", roles: [], permissions: [] },
      authMode: "password",
    });

    const page = await screen.findByTestId("page-dashboards");
    expect(page.getAttribute("data-deeplink")).toBe("12");
    expect(window.location.search).toBe("?dashboard=12");
  });

  // This is the test that justifies the locked asymmetry — OIDC writes to sessionStorage
  // because it navigates away and back (destroying the URL); password mode never writes
  // because it never leaves the page at all (115-RESEARCH.md §Q3). A second write here would
  // create a second source to reconcile against the same URL-sourced id.
  it("AUTHLINK-115: password mode needs NO sessionStorage — kbi_returnTo is never written on this journey", async () => {
    window.history.replaceState(null, "", "/?dashboard=12");
    setAuth({
      status: "unauthenticated",
      user: null,
      authMode: "password",
      reason: null,
      error: null,
      bootstrap: async () => {},
    });

    render(<App />);
    expect(await screen.findByLabelText(/username/i)).toBeInTheDocument();
    expect(sessionStorage.getItem("kbi_returnTo")).toBeNull();

    setAuth({
      status: "authenticated",
      user: { username: "alice", roles: [], permissions: [] },
      authMode: "password",
    });

    await screen.findByTestId("page-dashboards");
    expect(sessionStorage.getItem("kbi_returnTo")).toBeNull();
  });

  // Phase 117 (DSET-V122-07): the mode qualifier is entity-agnostic here too — the URL itself
  // is the carrier in password mode, exactly as the bare-id case above already proved.
  it("DSET-117: password mode — a ?dashboard=12&mode=edit arrival writes NOTHING to kbi_returnTo and lands on the edit screen after authentication", async () => {
    window.history.replaceState(null, "", "/?dashboard=12&mode=edit");
    setAuth({
      status: "unauthenticated",
      user: null,
      authMode: "password",
      reason: null,
      error: null,
      bootstrap: async () => {},
    });

    render(<App />);
    expect(await screen.findByLabelText(/username/i)).toBeInTheDocument();
    expect(sessionStorage.getItem("kbi_returnTo")).toBeNull();

    setAuth({
      status: "authenticated",
      user: { username: "alice", roles: [], permissions: [] },
      authMode: "password",
    });

    const page = await screen.findByTestId("page-dashboards");
    expect(page).toHaveAttribute("data-mode", "edit");
    expect(sessionStorage.getItem("kbi_returnTo")).toBeNull();
  });
});
