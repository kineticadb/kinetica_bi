/**
 * Sidebar spec — covers nav rendering, active state, collapse/expand toggle,
 * and accessibility (aria-expanded, aria-label).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, cleanup } from "@testing-library/react";
import Sidebar from "./Sidebar";
import { useAuthStore } from "../store/auth";
import { seedAnalystStore, seedAdminStore } from "../test/seedAuthStore";

function renderSidebar(
  overrides: Partial<{
    activeKey: string;
    collapsed: boolean;
  }> = {},
) {
  const onSelect = vi.fn();
  const onToggleCollapse = vi.fn();
  const utils = render(
    <Sidebar
      activeKey={overrides.activeKey ?? "dashboards"}
      onSelect={onSelect}
      collapsed={overrides.collapsed ?? false}
      onToggleCollapse={onToggleCollapse}
    />,
  );
  return { ...utils, onSelect, onToggleCollapse };
}

describe("Sidebar", () => {
  beforeEach(() => {
    cleanup();
    useAuthStore.setState({ status: "unauthenticated", user: null });
  });

  it("renders the three nav items with their labels (expanded)", () => {
    renderSidebar();
    expect(screen.getByRole("button", { name: "Dashboards" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Datasets" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
  });

  it("active nav item has the .active class", () => {
    renderSidebar({ activeKey: "datasets" });
    expect(screen.getByRole("button", { name: "Datasets" }).className).toContain("active");
    expect(screen.getByRole("button", { name: "Dashboards" }).className).not.toContain("active");
  });

  it("clicking a nav item fires onSelect with that key", () => {
    const { onSelect } = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: "Datasets" }));
    expect(onSelect).toHaveBeenCalledWith("datasets");
  });

  it("renders the logo when expanded", () => {
    renderSidebar({ collapsed: false });
    expect(screen.getByText("Kinetica BI")).toBeInTheDocument();
  });

  it("hides the logo when collapsed", () => {
    renderSidebar({ collapsed: true });
    expect(screen.queryByText("Kinetica BI")).toBeNull();
  });

  it("collapse toggle has correct aria-label + aria-expanded when expanded", () => {
    renderSidebar({ collapsed: false });
    const toggle = screen.getByRole("button", { name: "Collapse sidebar" });
    expect(toggle).toBeInTheDocument();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("collapse toggle has correct aria-label + aria-expanded when collapsed", () => {
    renderSidebar({ collapsed: true });
    const toggle = screen.getByRole("button", { name: "Expand sidebar" });
    expect(toggle).toBeInTheDocument();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("clicking the collapse toggle fires onToggleCollapse", () => {
    const { onToggleCollapse } = renderSidebar({ collapsed: false });
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  });

  it("collapsed sidebar adds .collapsed class to the aside container", () => {
    const { container } = renderSidebar({ collapsed: true });
    const aside = container.querySelector("aside.sidebar");
    expect(aside?.className).toContain("collapsed");
  });

  it("collapsed nav items carry title attribute for hover tooltip", () => {
    renderSidebar({ collapsed: true });
    expect(screen.getByRole("button", { name: "Dashboards" }).getAttribute("title"))
      .toBe("Dashboards");
  });

  it("expanded nav items have no title attribute (label is already visible)", () => {
    renderSidebar({ collapsed: false });
    expect(screen.getByRole("button", { name: "Dashboards" }).hasAttribute("title"))
      .toBe(false);
  });

  it("renders the GPU-DB footer text when expanded", () => {
    renderSidebar({ collapsed: false });
    expect(screen.getByText("GPU-DB")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
  });

  it("hides the GPU-DB footer text when collapsed (status-dot still rendered)", () => {
    const { container } = renderSidebar({ collapsed: true });
    expect(screen.queryByText("GPU-DB")).toBeNull();
    expect(screen.queryByText("Connected")).toBeNull();
    expect(container.querySelector(".status-dot")).not.toBeNull();
  });

  describe("Phase 48 — gated nav items (GATE-V18-05)", () => {
    it("analyst: User Management and Roles nav items are hidden; base 3 items still present", () => {
      seedAnalystStore();
      renderSidebar();
      // Gated items must NOT be present
      expect(screen.queryByRole("button", { name: "User Management" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Roles" })).toBeNull();
      // Base 3 items always visible
      expect(screen.getByRole("button", { name: "Dashboards" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Datasets" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    });

    it("admin (users:view + roles:view): User Management and Roles nav items are visible", () => {
      seedAdminStore();
      renderSidebar();
      // Gated items must be present
      expect(screen.getByRole("button", { name: "User Management" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Roles" })).toBeInTheDocument();
      // Base 3 items still present
      expect(screen.getByRole("button", { name: "Dashboards" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Datasets" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    });

    it("unauthenticated user: gated items hidden, base 3 items present", () => {
      // user is null — default state after beforeEach reset
      renderSidebar();
      expect(screen.queryByRole("button", { name: "User Management" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Roles" })).toBeNull();
      expect(screen.getByRole("button", { name: "Dashboards" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Datasets" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    });
  });
});
