import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Topbar from "./Topbar";
import { seedDesignerStore } from "../test/seedAuthStore";
import { useAuthStore } from "../store/auth";

describe("Topbar", () => {
  const navMock = vi.fn();
  const logoutMock = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    navMock.mockClear();
    logoutMock.mockClear();
    // Seed designer user in the store
    seedDesignerStore();
    // Override logout with a mock
    useAuthStore.setState({ logout: logoutMock });
  });

  it("renders username and initials avatar", () => {
    render(<Topbar onNavigateProfile={navMock} />);
    expect(screen.getByText("testdesigner")).toBeInTheDocument();
  });

  it("renders NO role-chip elements", () => {
    const { container } = render(<Topbar onNavigateProfile={navMock} />);
    expect(container.querySelector(".role-chip")).toBeNull();
  });

  it("menu is closed by default", () => {
    render(<Topbar onNavigateProfile={navMock} />);
    expect(screen.queryByText("Profile")).not.toBeInTheDocument();
    expect(screen.queryByText("Log out")).not.toBeInTheDocument();
  });

  it("clicking the trigger opens the menu with Profile and Log out", () => {
    render(<Topbar onNavigateProfile={navMock} />);
    const trigger = screen.getByRole("button", { name: /open user menu/i });
    fireEvent.click(trigger);
    expect(screen.getByText("Profile")).toBeInTheDocument();
    expect(screen.getByText("Log out")).toBeInTheDocument();
  });

  it("clicking Profile calls onNavigateProfile and closes the menu", () => {
    render(<Topbar onNavigateProfile={navMock} />);
    fireEvent.click(screen.getByRole("button", { name: /open user menu/i }));
    fireEvent.click(screen.getByText("Profile"));
    expect(navMock).toHaveBeenCalledOnce();
    expect(screen.queryByText("Profile")).not.toBeInTheDocument();
  });

  it("clicking Log out calls logout and closes the menu", () => {
    render(<Topbar onNavigateProfile={navMock} />);
    fireEvent.click(screen.getByRole("button", { name: /open user menu/i }));
    fireEvent.click(screen.getByText("Log out"));
    expect(logoutMock).toHaveBeenCalledOnce();
    expect(screen.queryByText("Log out")).not.toBeInTheDocument();
  });

  it("a mousedown outside the menu closes it", () => {
    render(<Topbar onNavigateProfile={navMock} />);
    fireEvent.click(screen.getByRole("button", { name: /open user menu/i }));
    expect(screen.getByText("Profile")).toBeInTheDocument();
    // Simulate outside click
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText("Profile")).not.toBeInTheDocument();
  });

  it("renders the theme toggle button", () => {
    render(<Topbar onNavigateProfile={navMock} />);
    // Theme toggle has aria-label
    expect(screen.getByRole("button", { name: /switch to/i })).toBeInTheDocument();
  });
});
