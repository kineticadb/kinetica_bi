// Phase 116 Plan 05 (TLINK-V121-03): the TABLE variant of the login banner. A NEW sibling file,
// per the plan — LoginPage.spec.tsx (including its 10 AUTHLINK-115 dashboard-banner tests) stays
// byte-identical. Mirrors that file's harness exactly.
//
// Every test title is prefixed "TLINK-116: " per the plan's grep anchor.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import LoginPage from "./LoginPage";
import { useAuthStore } from "../store/auth";

const setAuth = (patch: Partial<ReturnType<typeof useAuthStore.getState>>) => {
  useAuthStore.setState(patch);
};

beforeEach(() => {
  setAuth({ authMode: null, reason: null, error: null });
});

describe("LoginPage — TLINK-116 table deep-link banner + commit (OIDC branch)", () => {
  it("TLINK-116: deepLinkTablePending=true, reason=null — exactly ONE status banner reading 'Sign in to open this table.'", () => {
    setAuth({ authMode: "oidc", reason: null });
    render(<LoginPage deepLinkTablePending={true} />);
    const banners = screen.getAllByRole("status");
    expect(banners).toHaveLength(1);
    expect(banners[0].textContent).toContain("Sign in to open this table.");
  });

  it("TLINK-116: deepLinkTablePending=true, reason='session-expired' — exactly ONE banner, expiry text only, never stacked", () => {
    setAuth({ authMode: "oidc", reason: "session-expired" });
    render(<LoginPage deepLinkTablePending={true} />);
    const banners = screen.getAllByRole("status");
    expect(banners).toHaveLength(1);
    expect(banners[0].textContent).toContain("Your session has ended");
    expect(banners[0].textContent).not.toContain("Sign in to open this table.");
  });

  it("TLINK-116: deepLinkPending=true, deepLinkTablePending=true — exactly ONE banner, reads the DASHBOARD text (precedence consistent with App.tsx)", () => {
    setAuth({ authMode: "oidc", reason: null });
    render(<LoginPage deepLinkPending={true} deepLinkTablePending={true} />);
    const banners = screen.getAllByRole("status");
    expect(banners).toHaveLength(1);
    expect(banners[0].textContent).toContain("Sign in to open this dashboard.");
    expect(banners[0].textContent).not.toContain("Sign in to open this table.");
  });

  it("TLINK-116: deepLinkTablePending=false/undefined, reason=null — no status banner (Phase 7 + Phase 115 regression)", () => {
    setAuth({ authMode: "oidc", reason: null });
    render(<LoginPage />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("TLINK-116: clicking 'Sign in with SSO' calls onSignInCommit exactly once (the same seam, not a second one)", () => {
    setAuth({ authMode: "oidc" });
    const onSignInCommit = vi.fn();
    render(<LoginPage deepLinkTablePending={true} onSignInCommit={onSignInCommit} />);
    const link = screen.getByRole("link", { name: /sign in with sso/i });
    // jsdom logs "Not implemented: navigation (except hash changes)" for the anchor's default
    // action — EXPECTED, not a failure.
    fireEvent.click(link);
    expect(onSignInCommit).toHaveBeenCalledTimes(1);
  });
});

describe("LoginPage — TLINK-116 table deep-link banner (password branch)", () => {
  it("TLINK-116: deepLinkTablePending=true, reason=null — exactly ONE status banner reading 'Sign in to open this table.'", () => {
    setAuth({ authMode: "password", reason: null });
    render(<LoginPage deepLinkTablePending={true} />);
    const banners = screen.getAllByRole("status");
    expect(banners).toHaveLength(1);
    expect(banners[0].textContent).toContain("Sign in to open this table.");
  });

  it("TLINK-116: deepLinkTablePending=true, reason='session-expired' — exactly ONE banner, expiry text only, never stacked", () => {
    setAuth({ authMode: "password", reason: "session-expired" });
    render(<LoginPage deepLinkTablePending={true} />);
    const banners = screen.getAllByRole("status");
    expect(banners).toHaveLength(1);
    expect(banners[0].textContent).toContain("Your session has ended");
    expect(banners[0].textContent).not.toContain("Sign in to open this table.");
  });

  it("TLINK-116: deepLinkPending=true, deepLinkTablePending=true — exactly ONE banner, reads the DASHBOARD text (precedence consistent with App.tsx)", () => {
    setAuth({ authMode: "password", reason: null });
    render(<LoginPage deepLinkPending={true} deepLinkTablePending={true} />);
    const banners = screen.getAllByRole("status");
    expect(banners).toHaveLength(1);
    expect(banners[0].textContent).toContain("Sign in to open this dashboard.");
    expect(banners[0].textContent).not.toContain("Sign in to open this table.");
  });

  it("TLINK-116: deepLinkTablePending=false/undefined, reason=null — no status banner (Phase 7 + Phase 115 regression)", () => {
    setAuth({ authMode: "password", reason: null });
    render(<LoginPage />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
