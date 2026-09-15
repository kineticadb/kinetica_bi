// Phase 116 Plan 05 Task 3 (TLINK-V121-03): pins the password-mode logged-out TABLE deep-link
// journey, mirroring App.passwordDeepLink.spec.tsx's three dashboard tests. 115-RESEARCH §Q1's
// finding (window.location.search survives an in-place unauthenticated -> authenticated store
// flip because there is no navigation) is entity-agnostic and holds identically here — this file
// pins it with an executed test rather than assuming it carries over.
//
// Mock harness mirrors App.passwordDeepLink.spec.tsx, with one deliberate difference: LoginPage
// is NOT mocked here — the real password form must render, because that is exactly the surface
// this regression pins. Adds listTables to the api/client mock and uses the lazy-capture
// DatasetsPage stub (the stub trap, 116-RESEARCH §Q5/Pitfall 2).
//
// Every test title is prefixed "TLINK-116: " per the plan's grep anchor.

import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { act, render, screen } from "@testing-library/react";
import { useAuthStore } from "./store/auth";

vi.mock("./components/Sidebar", () => ({ default: () => <nav data-testid="sidebar" /> }));
vi.mock("./components/Topbar", () => ({ default: () => <header data-testid="topbar" /> }));
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
// ⚠️ THE STUB TRAP (116-RESEARCH §Q5/Pitfall 2). Mirror the REAL DatasetsPage's mount-time lazy
// useState capture contract — a dumb prop-reflector falsely fails (App's own effects mutate the
// prop's upstream state after mount).
vi.mock("./components/DatasetsPage", () => ({
  default: ({ initialOpenTable }: { initialOpenTable?: { table: { id: number }; mode: string } }) => {
    const [captured] = useState(() => initialOpenTable);
    return (
      <main
        data-testid="page-datasets"
        data-deeplink={captured ? String(captured.table.id) : ""}
        data-mode={captured?.mode ?? ""}
      >
        Datasets
      </main>
    );
  },
}));
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
    listDashboards: vi.fn(() => Promise.resolve([])),
    listTables: vi.fn(() =>
      Promise.resolve([
        {
          id: 12,
          name: "Deep Linked Table",
          schema: "public",
          columns: { id: "integer" },
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
import { listTables } from "./api/client";

const setAuth = (patch: Partial<ReturnType<typeof useAuthStore.getState>>) => {
  act(() => {
    useAuthStore.setState(patch);
  });
};

describe("password-mode logged-out table deep link paste (TLINK-116)", () => {
  it("TLINK-116: password mode — a logged-out ?table=12&mode=edit arrival renders the real login form and keeps the param", async () => {
    window.history.replaceState(null, "", "/?table=12&mode=edit");
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
    expect(window.location.search).toBe("?table=12&mode=edit");
    expect(screen.queryByTestId("page-datasets")).toBeNull();
    expect(listTables).not.toHaveBeenCalled();
  });

  it("TLINK-116: password mode — the in-place sign-in flip lands on the linked table in EDIT mode, not the list", async () => {
    window.history.replaceState(null, "", "/?table=12&mode=edit");
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
    setAuth({
      status: "authenticated",
      user: { username: "alice", roles: [], permissions: [] },
      authMode: "password",
    });

    const page = await screen.findByTestId("page-datasets");
    expect(page.getAttribute("data-deeplink")).toBe("12");
    expect(page.getAttribute("data-mode")).toBe("edit");
    expect(window.location.search).toBe("?table=12&mode=edit");
  });

  it("TLINK-116: password mode needs NO sessionStorage — kbi_returnTo is never written on this journey", async () => {
    window.history.replaceState(null, "", "/?table=12&mode=edit");
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

    await screen.findByTestId("page-datasets");
    expect(sessionStorage.getItem("kbi_returnTo")).toBeNull();
  });
});
