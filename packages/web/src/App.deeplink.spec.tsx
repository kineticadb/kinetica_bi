// Phase 114 Plan 02 (DLINK-V121-02/04/05): App-level wiring for the deep-link resolution
// layer (useDeepLinkDashboard, Plan 01). Mirrors App.spec.tsx's child-stub + api/client
// mock harness, with two differences: the DashboardsPage stub exposes initialOpenDashboard,
// and the Sidebar stub exposes both nav-datasets and nav-dashboards for test 7.
//
// Every test title is prefixed "DEEPLINK-114: " per the plan's grep anchor.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useState } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuthStore } from "./store/auth";
import { DEEP_LINK_UNAVAILABLE_MESSAGE } from "./hooks/useDeepLinkDashboard";

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
// The real DashboardsPage consumes initialOpenDashboard ONCE via a mount-time lazy useState
// initializer (Plan 02 Task 1) — later prop churn (e.g. App's own deepLinkConsumedRef flip)
// must NOT un-set it. Mirror that mount-only contract here rather than a dumb prop-reflector,
// which would falsely fail on a correct App.tsx (Edit 3's setDashboardViewMode("open") forces
// a second App render in the same effect flush, after which the real prop is already undefined
// — irrelevant to the real component because it never re-reads the prop after mount).
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
vi.mock("./components/DatasetsPage", () => ({
  default: () => <main data-testid="page-datasets">Datasets</main>,
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
    // Phase 117 (DSET-117 bullet 11, dashboard-wins precedence): a `&table=` param in the same
    // URL activates useDeepLinkTable's own network call. Unmocked, that hits a real request
    // (any dev server on API_BASE answers 401 with no session cookie) the same way the WMS
    // probe below would — stub it inert; this file tests the dashboard, not the table, path.
    listTables: vi.fn(() => Promise.resolve([])),
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
import { listDashboards } from "./api/client";

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
  useAuthStore.setState({
    status: "authenticated",
    user: { username: "alice", roles: [], permissions: [] },
    authMode: "oidc",
    reason: null,
    error: null,
    bootstrap: async () => {},
  });
});

describe("App deep-link wiring (Phase 114 Plan 02)", () => {
  it("DEEPLINK-114: holds the app-level Loading… and never renders the dashboards page while a deep link is pending", async () => {
    window.history.replaceState(null, "", "/?dashboard=7");
    (listDashboards as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {})); // never settles
    render(<App />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByTestId("page-dashboards")).toBeNull();
  });

  it("DEEPLINK-114: opens the linked dashboard directly once it resolves", async () => {
    window.history.replaceState(null, "", "/?dashboard=7");
    (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([DASH_7]);
    render(<App />);
    const page = await screen.findByTestId("page-dashboards");
    expect(page.getAttribute("data-deeplink")).toBe("7");
    expect(window.location.search).toBe("?dashboard=7");
    expect(screen.queryByTestId("deep-link-banner")).toBeNull();
  });

  it("DEEPLINK-114: shows the single combined banner on the dashboard list when the id is not in the list", async () => {
    window.history.replaceState(null, "", "/?dashboard=7");
    (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([{ ...DASH_7, id: 8 }]);
    render(<App />);
    const banner = await screen.findByTestId("deep-link-banner");
    expect(banner.textContent).toContain(DEEP_LINK_UNAVAILABLE_MESSAGE);
    expect(screen.getByTestId("page-dashboards")).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  it("DEEPLINK-114: the banner names neither the reason nor the requested id", async () => {
    window.history.replaceState(null, "", "/?dashboard=7");
    (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([{ ...DASH_7, id: 8 }]);
    render(<App />);
    const banner = await screen.findByTestId("deep-link-banner");
    expect(banner.textContent).not.toContain("7");
    expect(banner.textContent).not.toMatch(/not permitted|no permission|does not exist|not found/i);
  });

  it("DEEPLINK-114: the banner is dismissible", async () => {
    window.history.replaceState(null, "", "/?dashboard=7");
    (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([{ ...DASH_7, id: 8 }]);
    render(<App />);
    const banner = await screen.findByTestId("deep-link-banner");
    const dismissBtn = within(banner).getByRole("button", { name: "Dismiss" });
    await userEvent.click(dismissBtn);
    expect(screen.queryByTestId("deep-link-banner")).toBeNull();
  });

  it("DEEPLINK-114: a transport failure lands on the list without claiming the dashboard was deleted", async () => {
    window.history.replaceState(null, "", "/?dashboard=7");
    (listDashboards as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("page-dashboards")).toBeInTheDocument());
    expect(screen.queryByTestId("deep-link-banner")).toBeNull();
  });

  it("DEEPLINK-114: navigating away and back does not re-open the deep-linked dashboard", async () => {
    window.history.replaceState(null, "", "/?dashboard=7");
    (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([DASH_7]);
    render(<App />);
    const page = await screen.findByTestId("page-dashboards");
    expect(page.getAttribute("data-deeplink")).toBe("7");
    await userEvent.click(screen.getByText("nav-datasets"));
    await screen.findByTestId("page-datasets");
    await userEvent.click(screen.getByText("nav-dashboards"));
    const pageAgain = await screen.findByTestId("page-dashboards");
    expect(pageAgain.getAttribute("data-deeplink")).toBe("");
  });

  // ─── PHASE 115 AMENDMENT (DLINK-V121-03) ────────────────────────────────────────────────
  // Phase 114's test here was `DEEPLINK-114: a pasted link beats the Phase 7 ReturnTo page
  // restore`, set up as kbi_returnTo={page:"roles"} + URL ?dashboard=7, asserting the dashboard
  // won. Phase 115's locked conflict rule (115-CONTEXT.md) reclassifies that EXACT state: a
  // ReturnTo whose page is not "dashboards" can only have been written by the UNAUTHORIZED_EVENT
  // handler, i.e. an expiry that captured the user somewhere else — and for an expiry, where you
  // actually were wins. The app never produces that shape for a paste: the commit-time write
  // (App.tsx handleSignInCommit) always pairs the id with page:"dashboards". So Phase 114's
  // INTENT survives untouched and is re-tested below in its real shape; only the hand-written
  // setup, which no code path produces, is reclassified. This is a deliberate, recorded
  // amendment — not an accidental weakening.
  //
  // The "paste overwrites a stale ReturnTo page" guard that used to live here now lives in
  // App.signincommit.spec.tsx (Plan 02, test 2) — coverage was moved, not dropped.
  // ────────────────────────────────────────────────────────────────────────────────────────

  it("AUTHLINK-115: a committed fresh paste beats a leftover ReturnTo page", async () => {
    sessionStorage.setItem("kbi_returnTo", JSON.stringify({ dashboardId: 7, page: "dashboards" }));
    window.history.replaceState(null, "", "/?dashboard=7");
    (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([DASH_7]);
    render(<App />);
    const page = await screen.findByTestId("page-dashboards");
    expect(page.getAttribute("data-deeplink")).toBe("7");
    expect(screen.queryByTestId("page-roles")).toBeNull();
  });

  it("AUTHLINK-115: an expiry captured on Roles beats a stale dashboard param, and the param is stripped", async () => {
    sessionStorage.setItem("kbi_returnTo", JSON.stringify({ page: "roles", dashboardViewMode: "list" }));
    window.history.replaceState(null, "", "/?dashboard=7");
    (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([DASH_7]);
    render(<App />);
    await screen.findByTestId("page-roles");
    expect(screen.queryByTestId("page-dashboards")).toBeNull();
    expect(window.location.search).toBe("");
    expect(screen.queryByTestId("deep-link-banner")).toBeNull();
  });

  it("AUTHLINK-115: the suppressed stale link does not resurface later in the same session", async () => {
    sessionStorage.setItem("kbi_returnTo", JSON.stringify({ page: "roles", dashboardViewMode: "list" }));
    window.history.replaceState(null, "", "/?dashboard=7");
    (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([DASH_7]);
    render(<App />);
    await screen.findByTestId("page-roles");
    await userEvent.click(screen.getByText("nav-dashboards"));
    const page = await screen.findByTestId("page-dashboards");
    expect(page.getAttribute("data-deeplink")).toBe("");
  });

  it("AUTHLINK-115: after the OIDC round trip the restored id opens the dashboard", async () => {
    window.history.replaceState(null, "", "/");
    sessionStorage.setItem("kbi_returnTo", JSON.stringify({ dashboardId: 7, page: "dashboards" }));
    (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([DASH_7]);
    render(<App />);
    const page = await screen.findByTestId("page-dashboards");
    expect(page.getAttribute("data-deeplink")).toBe("7");
  });

  it("AUTHLINK-115: after the OIDC round trip the address bar is restored to ?dashboard=7", async () => {
    window.history.replaceState(null, "", "/");
    sessionStorage.setItem("kbi_returnTo", JSON.stringify({ dashboardId: 7, page: "dashboards" }));
    (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([DASH_7]);
    render(<App />);
    await screen.findByTestId("page-dashboards");
    expect(window.location.search).toBe("?dashboard=7");
  });

  it("AUTHLINK-115: the OIDC round trip does not manufacture a history entry", async () => {
    window.history.replaceState(null, "", "/");
    sessionStorage.setItem("kbi_returnTo", JSON.stringify({ dashboardId: 7, page: "dashboards" }));
    (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([DASH_7]);
    const lengthBefore = window.history.length;
    render(<App />);
    await screen.findByTestId("page-dashboards");
    expect(window.history.length).toBe(lengthBefore);
  });

  it("AUTHLINK-115: the restored kbi_returnTo is single-use — the key is cleared", async () => {
    window.history.replaceState(null, "", "/");
    sessionStorage.setItem("kbi_returnTo", JSON.stringify({ dashboardId: 7, page: "dashboards" }));
    (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([DASH_7]);
    render(<App />);
    await screen.findByTestId("page-dashboards");
    expect(sessionStorage.getItem("kbi_returnTo")).toBeNull();
  });

  it("AUTHLINK-115: an unavailable restored id lands on the list with Phase 114's existing banner", async () => {
    window.history.replaceState(null, "", "/");
    sessionStorage.setItem("kbi_returnTo", JSON.stringify({ dashboardId: 7, page: "dashboards" }));
    (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([{ ...DASH_7, id: 8 }]);
    render(<App />);
    const banner = await screen.findByTestId("deep-link-banner");
    expect(banner.textContent).toContain(DEEP_LINK_UNAVAILABLE_MESSAGE);
    expect(window.location.search).toBe("");
  });

  it("DEEPLINK-114: an unauthenticated arrival goes to login and keeps the param for Phase 115", async () => {
    window.history.replaceState(null, "", "/?dashboard=7");
    setAuth({ status: "unauthenticated", user: null });
    render(<App />);
    expect(await screen.findByTestId("login-page")).toBeInTheDocument();
    expect(window.location.search).toBe("?dashboard=7");
    expect(listDashboards).not.toHaveBeenCalled();
  });
});

// ─── PHASE 117 (DSET-V122-03/04/07/08) — App-level arrival coverage for all three dashboard
// modes. New describe block, same harness (child stubs, api/client mock, auth seeding, and the
// beforeEach history/session reset above) — Plan 05 Task 1. ──────────────────────────────────
const DASH_77 = {
  id: 77,
  name: "Settings Linked",
  filter_display_mode: "topbar" as const,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("App dashboard-mode arrival wiring (Phase 117 Plan 05)", () => {
  it("DSET-117: ?dashboard=77&mode=view resolves and the page receives data-mode=\"view\"", async () => {
    window.history.replaceState(null, "", "/?dashboard=77&mode=view");
    (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([DASH_77]);
    render(<App />);
    const page = await screen.findByTestId("page-dashboards");
    expect(page).toHaveAttribute("data-mode", "view");
  });

  it("DSET-117: ?dashboard=77&mode=edit resolves and the page receives data-mode=\"edit\"", async () => {
    window.history.replaceState(null, "", "/?dashboard=77&mode=edit");
    (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([DASH_77]);
    render(<App />);
    const page = await screen.findByTestId("page-dashboards");
    expect(page).toHaveAttribute("data-mode", "edit");
  });

  it("DSET-117: a bare ?dashboard=77 resolves and the page receives data-mode=\"open\" (DSET-V122-08)", async () => {
    window.history.replaceState(null, "", "/?dashboard=77");
    (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([DASH_77]);
    render(<App />);
    const page = await screen.findByTestId("page-dashboards");
    expect(page).toHaveAttribute("data-mode", "open");
  });

  it("DSET-117: after a bare arrival resolves, the address bar carries no mode qualifier (DSET-V122-08)", async () => {
    window.history.replaceState(null, "", "/?dashboard=77");
    (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([DASH_77]);
    render(<App />);
    await screen.findByTestId("page-dashboards");
    // Two independent assertions, deliberately: a single toBe would also pass if the whole
    // param were dropped rather than the mode qualifier specifically being absent.
    expect(window.location.search).toBe("?dashboard=77");
    expect(window.location.search).not.toContain("mode");
  });

  it("DSET-117: after a &mode=view arrival resolves, the address bar is exactly ?dashboard=77&mode=view", async () => {
    window.history.replaceState(null, "", "/?dashboard=77&mode=view");
    (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([DASH_77]);
    render(<App />);
    await screen.findByTestId("page-dashboards");
    expect(window.location.search).toBe("?dashboard=77&mode=view");
  });

  it("DSET-117: ?dashboard=77&mode=banana resolves to data-mode=\"open\", not to the failure banner", async () => {
    window.history.replaceState(null, "", "/?dashboard=77&mode=banana");
    (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([DASH_77]);
    render(<App />);
    const page = await screen.findByTestId("page-dashboards");
    expect(page).toHaveAttribute("data-mode", "open");
    expect(screen.queryByTestId("deep-link-banner")).toBeNull();
  });

  it("DSET-117: the app-level Loading… is held for the whole of a &mode=edit resolution — page-dashboards never renders while pending", async () => {
    window.history.replaceState(null, "", "/?dashboard=77&mode=edit");
    (listDashboards as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {})); // never settles
    render(<App />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByTestId("page-dashboards")).toBeNull();
  });

  it("DSET-117: ?dashboard=99&mode=view not in the list -> the list with the combined banner, both params stripped", async () => {
    window.history.replaceState(null, "", "/?dashboard=99&mode=view");
    (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([DASH_77]);
    render(<App />);
    const banner = await screen.findByTestId("deep-link-banner");
    expect(banner.textContent).toContain(DEEP_LINK_UNAVAILABLE_MESSAGE);
    expect(screen.getByTestId("page-dashboards")).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  it("DSET-117: that banner names neither the reason nor the requested id (DSET-V122-04 regression)", async () => {
    window.history.replaceState(null, "", "/?dashboard=99&mode=view");
    (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([DASH_77]);
    render(<App />);
    const banner = await screen.findByTestId("deep-link-banner");
    expect(banner.textContent).not.toContain("99");
    expect(banner.textContent).not.toMatch(/not permitted|no permission|does not exist|not found/i);
  });

  it("DSET-117: an UNAUTHENTICATED ?dashboard=77&mode=edit arrival goes to login and keeps BOTH params in the bar", async () => {
    window.history.replaceState(null, "", "/?dashboard=77&mode=edit");
    setAuth({ status: "unauthenticated", user: null });
    render(<App />);
    expect(await screen.findByTestId("login-page")).toBeInTheDocument();
    expect(window.location.search).toBe("?dashboard=77&mode=edit");
    expect(listDashboards).not.toHaveBeenCalled();
  });

  it("DSET-117: ?dashboard=7&mode=view&table=12 — the DASHBOARD opens, page-datasets is not rendered, stale ?table= is stripped", async () => {
    window.history.replaceState(null, "", "/?dashboard=7&mode=view&table=12");
    (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([DASH_7]);
    render(<App />);
    const page = await screen.findByTestId("page-dashboards");
    expect(page.getAttribute("data-deeplink")).toBe("7");
    expect(page).toHaveAttribute("data-mode", "view");
    expect(screen.queryByTestId("page-datasets")).toBeNull();
    expect(window.location.search).not.toContain("table=");
  });
});
