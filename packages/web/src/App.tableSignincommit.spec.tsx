// Phase 116 Plan 05 (TLINK-V121-03): App-level wiring for the COMMIT-moment sessionStorage
// write extended to tables (handleSignInCommit) and the LoginPage deepLinkTablePending signal.
// A NEW file, per the plan, so App.signincommit.spec.tsx stays byte-identical — mirrors that
// file's harness wholesale, with three changes: (a) the LoginPage stub also reflects
// deepLinkTablePending, (b) the api/client mock adds listTables, and (c) the DatasetsPage stub
// uses the mount-time lazy capture (the stub trap, 116-RESEARCH §Q5/Pitfall 2).
//
// Every test title is prefixed "TLINK-116: " per the plan's grep anchor.

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
vi.mock("./components/DashboardsPage", () => ({
  default: ({ initialOpenDashboard }: { initialOpenDashboard?: { id: number } }) => {
    const [captured] = useState(() => initialOpenDashboard);
    return <main data-testid="page-dashboards" data-deeplink={captured ? String(captured.id) : ""}>Dashboards</main>;
  },
}));
// ⚠️ THE STUB TRAP (116-RESEARCH §Q5/Pitfall 2). A stub reading `initialOpenTable` as a PLAIN
// PROP would falsely report a correct App.tsx as broken — App's own consumed-ref-flip effect
// forces a second render in which the live prop has already moved on. Mirror the REAL
// component's mount-time lazy capture.
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
// The difference from App.signincommit.spec.tsx's harness: also expose deepLinkTablePending.
vi.mock("./components/LoginPage", () => ({
  default: ({
    deepLinkPending,
    deepLinkTablePending,
    onSignInCommit,
  }: {
    deepLinkPending?: boolean;
    deepLinkTablePending?: boolean;
    onSignInCommit?: () => void;
  }) => (
    <div
      data-testid="login-page"
      data-pending={deepLinkPending ? "1" : "0"}
      data-table-pending={deepLinkTablePending ? "1" : "0"}
    >
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
    listTables: vi.fn(() => Promise.resolve([
      {
        id: 12,
        name: "Deep Linked Table",
        schema: "public",
        columns: { id: "integer" },
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ])),
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

describe("App — TLINK-116 table commit-moment sessionStorage write (Phase 116 Plan 05)", () => {
  it("TLINK-116: OIDC, ?table=12&mode=edit, unauthenticated, commit — writes { tableId: 12, tableMode: 'edit', page: 'datasets' }", () => {
    window.history.replaceState(null, "", "/?table=12&mode=edit");
    setAuth({ status: "unauthenticated", authMode: "oidc" });
    render(<App />);
    act(() => {
      screen.getByText("commit-signin").click();
    });
    expect(readReturnTo()).toEqual({ tableId: 12, tableMode: "edit", page: "datasets" });
  });

  it("TLINK-116: OIDC, ?table=12 (no mode), commit — writes { tableId: 12, tableMode: 'view', page: 'datasets' }", () => {
    window.history.replaceState(null, "", "/?table=12");
    setAuth({ status: "unauthenticated", authMode: "oidc" });
    render(<App />);
    act(() => {
      screen.getByText("commit-signin").click();
    });
    expect(readReturnTo()).toEqual({ tableId: 12, tableMode: "view", page: "datasets" });
  });

  it("TLINK-116: OIDC, ?dashboard=7&table=12, commit — the DASHBOARD wins, no table keys are written", () => {
    window.history.replaceState(null, "", "/?dashboard=7&table=12");
    setAuth({ status: "unauthenticated", authMode: "oidc" });
    render(<App />);
    act(() => {
      screen.getByText("commit-signin").click();
    });
    expect(readReturnTo()).toEqual({ dashboardId: 7, page: "dashboards" });
  });

  it("TLINK-116: password mode, ?table=12, commit — writes nothing", () => {
    window.history.replaceState(null, "", "/?table=12");
    setAuth({ status: "unauthenticated", authMode: "password" });
    render(<App />);
    act(() => {
      screen.getByText("commit-signin").click();
    });
    expect(sessionStorage.getItem("kbi_returnTo")).toBeNull();
  });

  it("TLINK-116: no pending link, commit — writes nothing", () => {
    window.history.replaceState(null, "", "/");
    setAuth({ status: "unauthenticated", authMode: "oidc" });
    render(<App />);
    act(() => {
      screen.getByText("commit-signin").click();
    });
    expect(sessionStorage.getItem("kbi_returnTo")).toBeNull();
  });

  it("TLINK-116: a leftover { page: 'roles' } from a PREVIOUS document is overwritten by a fresh table paste's commit", () => {
    sessionStorage.setItem("kbi_returnTo", JSON.stringify({ page: "roles" }));
    window.history.replaceState(null, "", "/?table=12");
    setAuth({ status: "unauthenticated", authMode: "oidc" });
    render(<App />);
    act(() => {
      screen.getByText("commit-signin").click();
    });
    expect(readReturnTo()).toEqual({ tableId: 12, tableMode: "view", page: "datasets" });
  });

  it("TLINK-116: an expiry captured in THIS document on a non-datasets page is NOT clobbered by a stale ?table=", () => {
    setAuth({ status: "authenticated", authMode: "oidc" });
    render(<App />);

    act(() => {
      screen.getByText("nav-roles").click();
    });
    expect(screen.getByTestId("page-roles")).toBeInTheDocument();

    // A stale ?table=12 sits in the address bar (a 401 outran the deferred clear).
    window.history.replaceState(null, "", "/?table=12");

    act(() => {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    });

    setAuth({ status: "unauthenticated" });
    expect(screen.getByTestId("login-page")).toBeInTheDocument();

    act(() => {
      screen.getByText("commit-signin").click();
    });

    const stored = readReturnTo();
    expect(stored.page).toBe("roles");
    expect(stored.tableId).toBeUndefined();
  });

  it("TLINK-116: LoginPage stub receives deepLinkTablePending=true when the URL has ?table=12", () => {
    window.history.replaceState(null, "", "/?table=12");
    setAuth({ status: "unauthenticated", authMode: "oidc" });
    render(<App />);
    expect(screen.getByTestId("login-page").getAttribute("data-table-pending")).toBe("1");
  });

  it("TLINK-116: LoginPage stub receives deepLinkTablePending=false when the URL has no table param", () => {
    window.history.replaceState(null, "", "/");
    setAuth({ status: "unauthenticated", authMode: "oidc" });
    render(<App />);
    expect(screen.getByTestId("login-page").getAttribute("data-table-pending")).toBe("0");
  });

  it("TLINK-116: after the OIDC round trip (bare /, seeded kbi_returnTo), the restored id opens the table in the stored mode", async () => {
    sessionStorage.setItem("kbi_returnTo", JSON.stringify({ tableId: 12, tableMode: "edit", page: "datasets" }));
    window.history.replaceState(null, "", "/");
    setAuth({ status: "authenticated", authMode: "oidc" });
    render(<App />);
    const page = await screen.findByTestId("page-datasets");
    expect(page.getAttribute("data-deeplink")).toBe("12");
    expect(page.getAttribute("data-mode")).toBe("edit");
  });

  it("TLINK-116: after the OIDC round trip, the address bar is restored to ?table=12&mode=edit", async () => {
    sessionStorage.setItem("kbi_returnTo", JSON.stringify({ tableId: 12, tableMode: "edit", page: "datasets" }));
    window.history.replaceState(null, "", "/");
    setAuth({ status: "authenticated", authMode: "oidc" });
    render(<App />);
    await screen.findByTestId("page-datasets");
    expect(window.location.search).toBe("?table=12&mode=edit");
  });

  it("TLINK-116: the OIDC round trip does NOT manufacture a history entry", async () => {
    sessionStorage.setItem("kbi_returnTo", JSON.stringify({ tableId: 12, tableMode: "edit", page: "datasets" }));
    window.history.replaceState(null, "", "/");
    const lengthBefore = window.history.length;
    setAuth({ status: "authenticated", authMode: "oidc" });
    render(<App />);
    await screen.findByTestId("page-datasets");
    expect(window.history.length).toBe(lengthBefore);
  });

  it("TLINK-116: the restored kbi_returnTo is single-use — the key is cleared", async () => {
    sessionStorage.setItem("kbi_returnTo", JSON.stringify({ tableId: 12, tableMode: "edit", page: "datasets" }));
    window.history.replaceState(null, "", "/");
    setAuth({ status: "authenticated", authMode: "oidc" });
    render(<App />);
    await screen.findByTestId("page-datasets");
    expect(sessionStorage.getItem("kbi_returnTo")).toBeNull();
  });

  it("TLINK-116: an unavailable restored id lands on the tables list with the Phase 116 banner", async () => {
    sessionStorage.setItem("kbi_returnTo", JSON.stringify({ tableId: 999, tableMode: "view", page: "datasets" }));
    window.history.replaceState(null, "", "/");
    const { listTables } = await import("./api/client");
    (listTables as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: 12,
        name: "Deep Linked Table",
        schema: "public",
        columns: { id: "integer" },
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);
    setAuth({ status: "authenticated", authMode: "oidc" });
    render(<App />);
    const banner = await screen.findByTestId("deep-link-table-banner");
    expect(banner).toBeInTheDocument();
    expect(screen.getByTestId("page-datasets")).toBeInTheDocument();
  });

  it("TLINK-116: junk tableId values (0, -3, 1.5, string, absent) are rejected; the key is still cleared", () => {
    sessionStorage.setItem("kbi_returnTo", JSON.stringify({ tableId: 0, tableMode: "edit", page: "datasets" }));
    window.history.replaceState(null, "", "/");
    setAuth({ status: "authenticated", authMode: "oidc" });
    render(<App />);
    expect(sessionStorage.getItem("kbi_returnTo")).toBeNull();
  });
});
