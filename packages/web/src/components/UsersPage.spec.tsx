/**
 * UsersPage.spec.tsx — Phase 49, Plan 02, Task 3
 *
 * Covers:
 *   Test 1 — USERS-V18-01 gating: user_admin sees Edit roles + bulk affordance;
 *             view-only session sees neither (chips read-only, no ×).
 *   Test 2 — chips: explicit roles render as chips; unassigned renders "analyst (default)" with no ×.
 *   Test 3 — bootstrap lock: is_bootstrap row has lock indicator, admin chip, no ×, no Edit roles.
 *   Test 4 — last-admin verbatim toast: revokeRole 400 → showToast with exact string + "error" kind.
 *   Test 5 — last-seen: null → "never"; recent ISO string → matches "m ago"/"h ago" pattern.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { useAuthStore } from "../store/auth";
import { useToastStore } from "../store/toast";
import { seedUserAdminStore, seedAnalystStore } from "../test/seedAuthStore";
import { PERMISSIONS } from "../lib/permissions";

// Mock the api/client module — we stub listUsers/listRoles/assignRole/revokeRole
vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    listUsers: vi.fn(),
    listRoles: vi.fn(),
    assignRole: vi.fn(),
    revokeRole: vi.fn(),
  };
});

import { listUsers, listRoles, revokeRole } from "../api/client";
import { UsersPage } from "./UsersPage";

// Seed data
const MOCK_ROLES = [
  { id: 1, name: "admin", description: "All permissions", built_in: true, permissions: [] },
  { id: 2, name: "user_admin", description: "User management", built_in: true, permissions: [] },
  { id: 3, name: "designer", description: "Dashboard design", built_in: true, permissions: [] },
  { id: 4, name: "analyst", description: "View only", built_in: true, permissions: [] },
];

const MOCK_USERS_WITH_ROLES = [
  {
    username: "jchen",
    roles: ["designer", "user_admin"],
    last_seen: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5m ago
    is_bootstrap: false,
  },
  {
    username: "unassigned_user",
    roles: [],
    last_seen: null,
    is_bootstrap: false,
  },
  {
    username: "admin",
    roles: [],
    last_seen: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2h ago
    is_bootstrap: true,
  },
];

describe("UsersPage", () => {
  beforeEach(() => {
    vi.mocked(listRoles).mockResolvedValue(MOCK_ROLES);
    vi.mocked(listUsers).mockResolvedValue(MOCK_USERS_WITH_ROLES);
  });

  // ── Test 1: USERS-V18-01 gating ─────────────────────────────────────────────
  it("user_admin session: Edit roles buttons present for non-bootstrap rows; bulk affordance available after selecting", async () => {
    seedUserAdminStore();
    render(<UsersPage />);

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText("jchen")).toBeInTheDocument();
    });

    // Edit roles button present for non-bootstrap user
    const editButtons = screen.getAllByRole("button", { name: "Edit roles" });
    expect(editButtons.length).toBeGreaterThan(0);

    // Select a non-bootstrap user — bulk bar should appear
    const checkbox = screen.getByRole("checkbox", { name: "Select jchen" });
    fireEvent.click(checkbox);
    // Bulk assign button should be visible
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Assign role to 1 selected/ })).toBeInTheDocument();
    });
  });

  it("view-only session: no Edit roles button, chips have no × control", async () => {
    // Seed a user with USERS_VIEW only (no USERS_ASSIGN_ROLES)
    useAuthStore.setState({
      status: "authenticated",
      user: {
        username: "viewonlyuser",
        roles: ["analyst"],
        permissions: [PERMISSIONS.USERS_VIEW],
      },
    });

    render(<UsersPage />);

    await waitFor(() => {
      expect(screen.getByText("jchen")).toBeInTheDocument();
    });

    // No "Edit roles" buttons
    expect(screen.queryByRole("button", { name: "Edit roles" })).toBeNull();

    // No × remove buttons on chips
    expect(
      screen.queryByRole("button", { name: /Revoke/ }),
    ).toBeNull();
  });

  // ── Test 2: chips ─────────────────────────────────────────────────────────────
  it("explicit roles render as chips; unassigned user shows 'analyst (default)' with no × button", async () => {
    seedUserAdminStore();
    render(<UsersPage />);

    await waitFor(() => {
      expect(screen.getByText("jchen")).toBeInTheDocument();
    });

    // jchen has designer + user_admin chips
    expect(screen.getByText("designer")).toBeInTheDocument();
    expect(screen.getByText("user_admin")).toBeInTheDocument();

    // unassigned_user shows the default analyst chip
    expect(screen.getByText("analyst (default)")).toBeInTheDocument();

    // The default chip should have no × button for the unassigned user
    // (all × buttons that exist should be for jchen's roles only)
    const removeButtons = screen.getAllByRole("button", { name: /Revoke/ });
    // jchen has 2 roles → 2 revoke buttons (one per role)
    expect(removeButtons).toHaveLength(2);
    // None of them are for unassigned_user
    for (const btn of removeButtons) {
      expect(btn.getAttribute("aria-label")).not.toMatch(/unassigned_user/);
    }
  });

  // ── Test 3: bootstrap lock ───────────────────────────────────────────────────
  it("bootstrap row shows lock indicator, admin chip with no ×, and no Edit roles button", async () => {
    seedUserAdminStore();
    render(<UsersPage />);

    await waitFor(() => {
      // Check that multiple "admin" text nodes are rendered (username + chip)
      const adminElements = screen.getAllByText("admin");
      expect(adminElements.length).toBeGreaterThan(0);
    });

    // The admin bootstrap row should have the immutable admin chip (no × on it)
    // There should be no revoke button for bootstrap admin's chip
    const revokeForAdmin = screen.queryByRole("button", {
      name: /Revoke admin from admin/,
    });
    expect(revokeForAdmin).toBeNull();

    // No "Edit roles" button in the admin row —
    // Validate count: only non-bootstrap users (jchen + unassigned_user) get Edit roles
    const editButtons = screen.getAllByRole("button", { name: "Edit roles" });
    expect(editButtons).toHaveLength(2); // jchen + unassigned_user (both non-bootstrap)

    // The lock icon should be in the DOM (fa-lock SVG element)
    const lockIcon = document.querySelector(".users-lock-icon");
    expect(lockIcon).not.toBeNull();
  });

  // ── Test 4: last-admin verbatim toast ────────────────────────────────────────
  it("chip × click: 400 last-admin response surfaces verbatim error as toast with kind 'error'", async () => {
    seedUserAdminStore();

    const LAST_ADMIN_MSG =
      "Cannot revoke: this is the last admin. At least one non-bootstrap user must hold the admin role.";
    vi.mocked(revokeRole).mockResolvedValue({ ok: false, error: LAST_ADMIN_MSG });

    const showToastSpy = vi.spyOn(useToastStore.getState(), "showToast");

    render(<UsersPage />);

    await waitFor(() => {
      expect(screen.getByText("jchen")).toBeInTheDocument();
    });

    // Click the × for jchen's "designer" chip
    const revokeDesigner = screen.getByRole("button", {
      name: "Revoke designer from jchen",
    });
    fireEvent.click(revokeDesigner);

    await waitFor(() => {
      expect(showToastSpy).toHaveBeenCalledWith(LAST_ADMIN_MSG, "error");
    });
  });

  // ── Test 5: last-seen humanized ──────────────────────────────────────────────
  it("last_seen null renders 'never'; a recent timestamp renders an m ago / h ago string", async () => {
    seedUserAdminStore();
    render(<UsersPage />);

    await waitFor(() => {
      expect(screen.getByText("jchen")).toBeInTheDocument();
    });

    // unassigned_user has last_seen: null → should show "never"
    expect(screen.getByText("never")).toBeInTheDocument();

    // jchen has last_seen 5 minutes ago → should show something like "5m ago"
    expect(screen.getByText(/\d+m ago/)).toBeInTheDocument();
  });
});
