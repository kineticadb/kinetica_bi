// Phase 116 Plan 04 (TLINK-V121-02/04): App-level wiring for the table deep-link resolution
// layer (useDeepLinkTable, Plan 02). Mirrors App.deeplink.spec.tsx's child-stub + api/client
// mock harness exactly, with a DatasetsPage stub that exposes initialOpenTable instead of
// initialOpenDashboard. A NEW sibling file, not a growth of App.deeplink.spec.tsx — keeping
// that file byte-identical is the cleanest possible evidence for criterion 6.
//
// Every test title is prefixed "TLINK-116: " per the plan's grep anchor.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useState } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuthStore } from "./store/auth";
import { DEEP_LINK_TABLE_UNAVAILABLE_MESSAGE } from "./hooks/useDeepLinkTable";

// Stub heavy child components — App.tsx routing logic is what we're testing.
vi.mock("./components/Sidebar", () => ({
  default: ({ onSelect, activeKey }: { onSelect: (k: string) => void; activeKey: string }) => (
    <nav data-testid="sidebar" data-active={activeKey}>
      <button onClick={() => onSelect("datasets")}>nav-datasets</button>
      <button onClick={() => onSelect("dashboards")}>nav-dashboards</button>
    </nav>
  ),
}));
vi.mock("./components/Topbar", () => ({
  default: () => <header data-testid="topbar" />,
}));
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
// ⚠️ THE STUB TRAP (116-RESEARCH §Q5/Pitfall 2). A stub that reads `initialOpenTable` as a PLAIN
// PROP would falsely report a correct App.tsx as broken, because App's own consumed-ref-flip
// effect forces a second render in which the live prop has already moved on. Mirror the REAL
// component's mount-time lazy capture (DatasetsPage.tsx:43-47's useState(() => ...) initializer).
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
vi.mock("./components/LoginPage", () => ({
  default: () => <div data-testid="login-page">Login</div>,
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
    listDashboards: vi.fn(),
    listTables: vi.fn(),
    // Phase 11 MAP-01/02's WMS probe fires on every authenticated mount; unmocked, it hits a
    // real network call (any dev server on API_BASE answers 401 with no session cookie),
    // which dispatches UNAUTHORIZED_EVENT and logs the test out mid-await. Not part of what
    // this spec verifies — stub it inert like fetchMe/listUsers above.
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
import { listDashboards, listTables } from "./api/client";

const TABLE_12 = {
  id: 12,
  name: "Deep Linked Table",
  schema: "public",
  columns: { id: "integer" },
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const DASH_7 = {
  id: 7,
  name: "Deep Linked",
  filter_display_mode: "topbar" as const,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const setAuth = (patch: Partial<ReturnType<typeof useAuthStore.getState>>) => {
  act(() => {
    useAuthStore.setState(patch);
  });
};

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  sessionStorage.clear();
  (listDashboards as ReturnType<typeof vi.fn>).mockReset();
  (listTables as ReturnType<typeof vi.fn>).mockReset();
  useAuthStore.setState({
    status: "authenticated",
    user: { username: "alice", roles: [], permissions: [] },
    authMode: "oidc",
    reason: null,
    error: null,
    bootstrap: async () => {},
  });
});

describe("App table deep-link wiring (Phase 116 Plan 04)", () => {
  it("TLINK-116: holds the app-level Loading… and never renders the datasets page while a table link is pending", async () => {
    window.history.replaceState(null, "", "/?table=12");
    (listTables as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {})); // never settles
    render(<App />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByTestId("page-datasets")).toBeNull();
  });

  it("TLINK-116: opens the linked table directly in VIEW mode once it resolves", async () => {
    window.history.replaceState(null, "", "/?table=12");
    (listTables as ReturnType<typeof vi.fn>).mockResolvedValue([TABLE_12]);
    render(<App />);
    const page = await screen.findByTestId("page-datasets");
    expect(page.getAttribute("data-deeplink")).toBe("12");
    expect(page.getAttribute("data-mode")).toBe("view");
    expect(window.location.search).toBe("?table=12");
    expect(screen.queryByTestId("deep-link-table-banner")).toBeNull();
  });

  it("TLINK-116: opens the linked table directly in EDIT mode for ?table=12&mode=edit", async () => {
    window.history.replaceState(null, "", "/?table=12&mode=edit");
    (listTables as ReturnType<typeof vi.fn>).mockResolvedValue([TABLE_12]);
    render(<App />);
    const page = await screen.findByTestId("page-datasets");
    expect(page.getAttribute("data-deeplink")).toBe("12");
    expect(page.getAttribute("data-mode")).toBe("edit");
  });

  it("TLINK-116: ?table=12&mode=banana opens in VIEW mode, not as a failure", async () => {
    window.history.replaceState(null, "", "/?table=12&mode=banana");
    (listTables as ReturnType<typeof vi.fn>).mockResolvedValue([TABLE_12]);
    render(<App />);
    const page = await screen.findByTestId("page-datasets");
    expect(page.getAttribute("data-deeplink")).toBe("12");
    expect(page.getAttribute("data-mode")).toBe("view");
    expect(screen.queryByTestId("deep-link-table-banner")).toBeNull();
  });

  it("TLINK-116: shows the combined banner on the tables list when the id is not in the list", async () => {
    window.history.replaceState(null, "", "/?table=12");
    (listTables as ReturnType<typeof vi.fn>).mockResolvedValue([{ ...TABLE_12, id: 99 }]);
    render(<App />);
    const banner = await screen.findByTestId("deep-link-table-banner");
    expect(banner.textContent).toContain(DEEP_LINK_TABLE_UNAVAILABLE_MESSAGE);
    expect(screen.getByTestId("page-datasets")).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  it("TLINK-116: the banner names neither the reason nor the requested id", async () => {
    window.history.replaceState(null, "", "/?table=12");
    (listTables as ReturnType<typeof vi.fn>).mockResolvedValue([{ ...TABLE_12, id: 99 }]);
    render(<App />);
    const banner = await screen.findByTestId("deep-link-table-banner");
    expect(banner.textContent).not.toContain("12");
    expect(banner.textContent).not.toMatch(/not permitted|no permission|does not exist|not found/i);
  });

  it("TLINK-116: the banner is dismissible", async () => {
    window.history.replaceState(null, "", "/?table=12");
    (listTables as ReturnType<typeof vi.fn>).mockResolvedValue([{ ...TABLE_12, id: 99 }]);
    render(<App />);
    const banner = await screen.findByTestId("deep-link-table-banner");
    const dismissBtn = within(banner).getByRole("button", { name: "Dismiss" });
    await userEvent.click(dismissBtn);
    expect(screen.queryByTestId("deep-link-table-banner")).toBeNull();
  });

  it("TLINK-116: a transport failure lands on the tables list without claiming the table was deleted", async () => {
    window.history.replaceState(null, "", "/?table=12");
    (listTables as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("page-datasets")).toBeInTheDocument());
    expect(screen.queryByTestId("deep-link-table-banner")).toBeNull();
  });

  it("TLINK-116: navigating away and back does not re-open the deep-linked table", async () => {
    window.history.replaceState(null, "", "/?table=12");
    (listTables as ReturnType<typeof vi.fn>).mockResolvedValue([TABLE_12]);
    render(<App />);
    const page = await screen.findByTestId("page-datasets");
    expect(page.getAttribute("data-deeplink")).toBe("12");
    await userEvent.click(screen.getByText("nav-dashboards"));
    await screen.findByTestId("page-dashboards");
    await userEvent.click(screen.getByText("nav-datasets"));
    const pageAgain = await screen.findByTestId("page-datasets");
    expect(pageAgain.getAttribute("data-deeplink")).toBe("");
  });

  it("TLINK-116: an unauthenticated arrival goes to login and keeps the param", async () => {
    window.history.replaceState(null, "", "/?table=12");
    setAuth({ status: "unauthenticated", user: null });
    render(<App />);
    expect(await screen.findByTestId("login-page")).toBeInTheDocument();
    expect(window.location.search).toBe("?table=12");
    expect(listTables).not.toHaveBeenCalled();
  });

  it("TLINK-116: ?dashboard=7&table=12 — the DASHBOARD opens, page-datasets is not rendered", async () => {
    window.history.replaceState(null, "", "/?dashboard=7&table=12");
    (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([DASH_7]);
    (listTables as ReturnType<typeof vi.fn>).mockResolvedValue([TABLE_12]);
    render(<App />);
    const page = await screen.findByTestId("page-dashboards");
    expect(page.getAttribute("data-deeplink")).toBe("7");
    expect(screen.queryByTestId("page-datasets")).toBeNull();
  });

  it("TLINK-116: ?dashboard=7&table=12 — the stale ?table= is stripped from the address bar", async () => {
    window.history.replaceState(null, "", "/?dashboard=7&table=12");
    (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([DASH_7]);
    (listTables as ReturnType<typeof vi.fn>).mockResolvedValue([TABLE_12]);
    render(<App />);
    await screen.findByTestId("page-dashboards");
    expect(window.location.search).not.toContain("table=");
  });
});
