// Phase 142 AIGOV-V20-05: AI activity page navigation gate (audit:view).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useAuthStore } from "./store/auth";
import { PERMISSIONS } from "./lib/permissions";

vi.mock("./components/Topbar", () => ({ default: () => <header data-testid="topbar" /> }));
vi.mock("./components/DashboardsPage", () => ({
  default: () => <main data-testid="page-dashboards">Dashboards</main>,
}));
vi.mock("./components/DatasetsPage", () => ({ default: () => <main data-testid="page-datasets" /> }));
vi.mock("./components/ExportsPage", () => ({ default: () => <main data-testid="page-exports" /> }));
vi.mock("./store/wmsCapabilities", () => ({ initWmsCapabilities: vi.fn() }));
vi.mock("./store/exportTracker", () => ({ stopAllExportTracking: vi.fn() }));
vi.mock("./components/LoginPage", () => ({ default: () => <div data-testid="login-page" /> }));
vi.mock("./components/Toast", () => ({ default: () => null }));
vi.mock("./components/AiActivityPage", () => ({
  AiActivityPage: () => <h2>AI activity</h2>,
}));
vi.mock("./api/client", async () => {
  const actual = await vi.importActual<typeof import("./api/client")>("./api/client");
  return {
    ...actual,
    fetchAuthConfig: vi.fn(() => Promise.resolve({ authMode: "password" as const })),
    fetchMe: vi.fn(() => Promise.resolve(null)),
    listUsers: vi.fn(() => Promise.resolve([])),
  };
});

import App from "./App";

const setAuth = (patch: Partial<ReturnType<typeof useAuthStore.getState>>) => {
  act(() => {
    useAuthStore.setState(patch);
  });
};
const withAudit = { username: "admin", roles: ["admin"], permissions: [PERMISSIONS.AUDIT_VIEW] };
const withoutAudit = { username: "analyst", roles: ["analyst"], permissions: [] as string[] };

beforeEach(() => {
  useAuthStore.setState({
    status: "authenticated",
    user: withAudit,
    authMode: "oidc",
    reason: null,
    error: null,
    bootstrap: async () => {},
  });
  sessionStorage.clear();
});

describe("App — AI activity gate", () => {
  it("AUDNAV-2: clicking the AI activity nav item renders the page", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "AI activity" }));
    expect(await screen.findByRole("heading", { name: "AI activity" })).toBeInTheDocument();
  });

  it("AUDNAV-3: returnTo restores for audit:view, not without it", async () => {
    sessionStorage.setItem("kbi_returnTo", JSON.stringify({ page: "ai-activity" }));
    setAuth({ status: "unknown" });
    const first = render(<App />);
    setAuth({ status: "authenticated", authMode: "oidc", user: withAudit });
    first.rerender(<App />);
    expect(await screen.findByRole("heading", { name: "AI activity" })).toBeInTheDocument();
    first.unmount();

    sessionStorage.setItem("kbi_returnTo", JSON.stringify({ page: "ai-activity" }));
    setAuth({ status: "unknown" });
    const second = render(<App />);
    setAuth({ status: "authenticated", authMode: "oidc", user: withoutAudit });
    second.rerender(<App />);
    expect(await screen.findByTestId("page-dashboards")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "AI activity" })).not.toBeInTheDocument();
  });

  it("AUDNAV-4: losing audit:view while on the page falls back to Dashboards", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "AI activity" }));
    expect(await screen.findByRole("heading", { name: "AI activity" })).toBeInTheDocument();
    setAuth({ user: withoutAudit });
    expect(await screen.findByTestId("page-dashboards")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "AI activity" })).not.toBeInTheDocument();
  });
});
