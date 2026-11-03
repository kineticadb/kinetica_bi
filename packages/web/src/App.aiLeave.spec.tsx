// Phase 134 (AISES-V20-07): App-level leave paths are guarded by the AI leave dialog.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useAuthStore } from "./store/auth";
import { NAVIGATE_EXPORTS_EVENT } from "./api/client";
import { useAiSessionStore } from "./store/aiSessionStore";
import { baselineFixture, addWidgetOp } from "./test/aiSessionHarness";

vi.mock("./components/Sidebar", () => ({
  default: ({ onSelect, activeKey }: { onSelect: (k: string) => void; activeKey: string }) => (
    <nav data-testid="sidebar" data-active={activeKey}>
      <button onClick={() => onSelect("datasets")}>nav-datasets</button>
      <button onClick={() => onSelect("exports")}>nav-exports</button>
    </nav>
  ),
}));
vi.mock("./components/Topbar", () => ({ default: () => <header data-testid="topbar" /> }));
vi.mock("./components/DashboardsPage", () => ({ default: () => <main data-testid="page-dashboards">Dashboards</main> }));
vi.mock("./components/DatasetsPage", () => ({ default: () => <main data-testid="page-datasets">Datasets</main> }));
vi.mock("./components/ExportsPage", () => ({ default: () => <main data-testid="page-exports">Exports</main> }));
vi.mock("./store/exportTracker", () => ({ stopAllExportTracking: vi.fn() }));
vi.mock("./components/LoginPage", () => ({ default: () => <div data-testid="login-page">Login</div> }));
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
  };
});
vi.mock("./components/UsersPage", () => ({ UsersPage: () => <main data-testid="page-users">Users</main> }));
vi.mock("./components/RolesPage", () => ({ RolesPage: () => <main data-testid="page-roles">Roles</main> }));
vi.mock("./components/ProfilePage", () => ({ ProfilePage: () => <main data-testid="page-profile">Profile</main> }));
vi.mock("./components/settings/BrandingSettingsPage", () => ({
  BrandingSettingsPage: () => <main data-testid="page-branding">Branding</main>,
}));

import App from "./App";

const dirty = () =>
  act(() => {
    useAiSessionStore.getState().applyTurn({ prompt: "x", ops: [addWidgetOp(-1)] }, baselineFixture());
  });

beforeEach(() => {
  useAiSessionStore.getState().reset();
  useAuthStore.setState({
    status: "authenticated",
    user: { username: "alice", roles: [], permissions: [] },
    authMode: "password",
    reason: null,
    error: null,
    bootstrap: async () => {},
  });
  sessionStorage.clear();
});

describe("App — AI leave guard", () => {
  it("AIAPP-1: clean session navigates immediately, no dialog", () => {
    render(<App />);
    fireEvent.click(screen.getByText("nav-datasets"));
    expect(screen.getByTestId("page-datasets")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("AIAPP-2: dirty session shows dialog; Stay keeps page and turns", () => {
    render(<App />);
    dirty();
    fireEvent.click(screen.getByText("nav-datasets"));
    expect(screen.getByRole("dialog", { name: "You have unsaved AI changes" })).toBeInTheDocument();
    expect(screen.getByTestId("page-dashboards")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("page-dashboards")).toBeInTheDocument();
    expect(useAiSessionStore.getState().turns).toHaveLength(1);
  });

  it("AIAPP-3: Discard and leave navigates and clears the session", () => {
    render(<App />);
    dirty();
    fireEvent.click(screen.getByText("nav-datasets"));
    fireEvent.click(screen.getByRole("button", { name: "Discard and leave" }));
    expect(screen.getByTestId("page-datasets")).toBeInTheDocument();
    expect(useAiSessionStore.getState().turns).toHaveLength(0);
  });

  it("AIAPP-4: NAVIGATE_EXPORTS_EVENT is guarded; Discard goes to exports", () => {
    render(<App />);
    dirty();
    act(() => {
      window.dispatchEvent(new Event(NAVIGATE_EXPORTS_EVENT));
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("page-dashboards")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard and leave" }));
    expect(screen.getByTestId("page-exports")).toBeInTheDocument();
  });

  it("AIAPP-5: logout / session expiry clears the AI session unconditionally, no dialog", () => {
    render(<App />);
    dirty();
    expect(useAiSessionStore.getState().turns).toHaveLength(1);
    act(() => {
      useAuthStore.setState({ status: "unauthenticated" });
    });
    expect(useAiSessionStore.getState().turns).toHaveLength(0);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
