// Phase 7 (OIDC-01): LoginPage renders OIDC branch or password branch based on authStore.authMode.

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import LoginPage from "./LoginPage";
import { useAuthStore } from "../store/auth";

// Helper: directly mutate the Zustand store for the test.
// The __mocks__/zustand.ts shim resets the store after each test.
const setAuth = (patch: Partial<ReturnType<typeof useAuthStore.getState>>) => {
  useAuthStore.setState(patch);
};

beforeEach(() => {
  // Initial defaults — explicit so tests don't depend on store-reset timing.
  setAuth({ authMode: null, reason: null, error: null });
});

describe("LoginPage — OIDC mode (authMode='oidc')", () => {
  it("renders an <a> link to /api/auth/oidc/start", () => {
    setAuth({ authMode: "oidc" });
    render(<LoginPage />);
    const link = screen.getByRole("link", { name: /sign in with sso/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute("href")).toMatch(/\/api\/auth\/oidc\/start$/);
  });

  it("renders the literal text 'Sign in with SSO'", () => {
    setAuth({ authMode: "oidc" });
    render(<LoginPage />);
    expect(screen.getByText("Sign in with SSO")).toBeInTheDocument();
  });

  it("does NOT render the password form (no username/password inputs)", () => {
    setAuth({ authMode: "oidc" });
    render(<LoginPage />);
    expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it("the SSO link uses className='login-submit'", () => {
    setAuth({ authMode: "oidc" });
    render(<LoginPage />);
    const link = screen.getByRole("link", { name: /sign in with sso/i });
    expect(link).toHaveClass("login-submit");
  });

  it("session-expired banner renders when reason='session-expired'", () => {
    setAuth({ authMode: "oidc", reason: "session-expired" });
    render(<LoginPage />);
    const banner = screen.getByRole("status");
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toContain("Your session has ended");
  });

  it("does NOT render session-expired banner when reason=null", () => {
    setAuth({ authMode: "oidc", reason: null });
    render(<LoginPage />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("LoginPage — password mode (authMode='password')", () => {
  it("renders the username and password input fields", () => {
    setAuth({ authMode: "password" });
    render(<LoginPage />);
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it("renders the 'Sign in' submit button", () => {
    setAuth({ authMode: "password" });
    render(<LoginPage />);
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeInTheDocument();
  });

  it("does NOT render the SSO link", () => {
    setAuth({ authMode: "password" });
    render(<LoginPage />);
    expect(screen.queryByText("Sign in with SSO")).not.toBeInTheDocument();
  });

  it("session-expired banner renders above the form when reason='session-expired'", () => {
    setAuth({ authMode: "password", reason: "session-expired" });
    render(<LoginPage />);
    const banner = screen.getByRole("status");
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toContain("Your session has ended");
    // Form is still present in this branch.
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
  });
});

describe("LoginPage — null authMode fallback (initial state)", () => {
  it("renders the password form when authMode=null (safe default)", () => {
    setAuth({ authMode: null });
    render(<LoginPage />);
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.queryByText("Sign in with SSO")).not.toBeInTheDocument();
  });
});
