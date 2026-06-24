/**
 * RolesPage.spec.tsx — Phase 50, Plan 02, Task 3
 *
 * Covers:
 *   Test 1 — ROLES-V18-01: matrix renders 18 checkboxes in 6 group sections.
 *   Test 2 — ROLES-V18-02: toggling + Save sends exactly one updateRolePermissions call with full set.
 *   Test 3 — ROLES-V18-02: built-in role Save triggers window.confirm.
 *   Test 4 — SAFE-V18-02 mirror: user_admin viewer sees admin role locked + "Only admins…" text;
 *             an unheld permission (dashboards:create) is disabled with the verbatim tooltip.
 *   Test 5 — ROLES-V18-03: bad-slug create blocked client-side (no API call); valid slug calls createRole.
 *   Test 6 — ROLES-V18-04: custom role with holders_count > 0 → delete control disabled.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { useAuthStore } from "../store/auth";
import { useToastStore } from "../store/toast";
import { seedAdminStore, seedUserAdminStore } from "../test/seedAuthStore";
import { PERMISSIONS } from "../lib/permissions";

// Mock the api/client module
vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    listRoles: vi.fn(),
    updateRolePermissions: vi.fn(),
    createRole: vi.fn(),
    deleteRole: vi.fn(),
  };
});

import {
  listRoles,
  updateRolePermissions,
  createRole,
  deleteRole,
} from "../api/client";
import { RolesPage } from "./RolesPage";

// ─── Mock data ────────────────────────────────────────────────────────────────

const ALL_PERMS = Object.values(PERMISSIONS);

const MOCK_ADMIN_ROLE = {
  id: 1,
  name: "admin",
  description: "All permissions",
  built_in: true,
  permissions: [...ALL_PERMS],
  holders_count: 0,
};

const MOCK_ANALYST_ROLE = {
  id: 4,
  name: "analyst",
  description: "View only",
  built_in: true,
  permissions: [PERMISSIONS.DASHBOARDS_VIEW],
  holders_count: 2,
};

const MOCK_CUSTOM_ROLE_FREE = {
  id: 10,
  name: "my_custom",
  description: "",
  built_in: false,
  permissions: [PERMISSIONS.DASHBOARDS_VIEW, PERMISSIONS.DASHBOARDS_CREATE],
  holders_count: 0,
};

const MOCK_CUSTOM_ROLE_HELD = {
  id: 11,
  name: "held_custom",
  description: "",
  built_in: false,
  permissions: [],
  holders_count: 3,
};

const MOCK_ROLES = [
  MOCK_ADMIN_ROLE,
  {
    id: 2,
    name: "user_admin",
    description: "User management",
    built_in: true,
    permissions: [
      PERMISSIONS.USERS_VIEW,
      PERMISSIONS.USERS_ASSIGN_ROLES,
      PERMISSIONS.ROLES_VIEW,
      PERMISSIONS.ROLES_MANAGE_PERMISSIONS,
      PERMISSIONS.ROLES_CREATE_CUSTOM,
      PERMISSIONS.DASHBOARDS_VIEW,
    ],
    holders_count: 1,
  },
  {
    id: 3,
    name: "designer",
    description: "Dashboard design",
    built_in: true,
    permissions: [PERMISSIONS.DASHBOARDS_VIEW, PERMISSIONS.DASHBOARDS_CREATE],
    holders_count: 0,
  },
  MOCK_ANALYST_ROLE,
  MOCK_CUSTOM_ROLE_FREE,
  MOCK_CUSTOM_ROLE_HELD,
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Click a role row by name in the left pane list */
async function selectRole(roleName: string) {
  // roles-list-name spans contain the role name text within list items
  const items = await screen.findAllByText(roleName);
  // Find the one inside a roles-list-item
  const listItem = items
    .map((el) => el.closest(".roles-list-item"))
    .find(Boolean);
  if (listItem) {
    fireEvent.click(listItem);
  } else {
    fireEvent.click(items[0]);
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("RolesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listRoles).mockResolvedValue(MOCK_ROLES);
    vi.mocked(updateRolePermissions).mockResolvedValue({ ok: true });
    vi.mocked(createRole).mockResolvedValue({ ok: true, role: { id: 99, name: "new_role", description: "", built_in: false, permissions: [], holders_count: 0 } });
    vi.mocked(deleteRole).mockResolvedValue({ ok: true });
  });

  // ── Test 1: ROLES-V18-01 — 18 checkboxes in 6 group sections ─────────────────

  it("renders 18 permission checkboxes in 6 group sections after selecting a role", async () => {
    seedAdminStore();
    render(<RolesPage />);

    // Select "analyst" role (has 1 permission, but matrix shows all 18)
    await selectRole("analyst");

    // Wait for the matrix to appear
    await waitFor(() => {
      expect(screen.getAllByRole("checkbox").length).toBe(18);
    });

    // All 6 group headers present (use getAllByText since "Roles" may appear in the left pane title too)
    for (const group of ["Dashboards", "Design", "Users", "Roles", "Audit", "Branding"]) {
      const matches = screen.getAllByText(group);
      expect(matches.length).toBeGreaterThan(0);
    }
  });

  // ── Test 2: ROLES-V18-02 — toggling + Save sends one call with full set ───────

  it("toggling a checkbox and clicking Save calls updateRolePermissions once with the full permission set", async () => {
    seedAdminStore();
    // analyst is a built-in role, so Save will trigger window.confirm first; approve it
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<RolesPage />);

    await selectRole("analyst");

    // analyst initially has only dashboards:view checked
    // Toggle dashboards:create (unchecked → checked)
    const dashCreateCheckbox = await screen.findByRole("checkbox", {
      name: /dashboards:create/,
    });
    expect(dashCreateCheckbox).not.toBeChecked();
    fireEvent.click(dashCreateCheckbox);

    // Wait for isDirty to be reflected in the Save button state
    const saveBtn = await screen.findByRole("button", { name: /Save/ });
    await waitFor(() => expect(saveBtn).not.toBeDisabled());
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(updateRolePermissions).toHaveBeenCalledTimes(1);
    });

    // The call should include both dashboards:view (was checked) and dashboards:create (just toggled)
    const [calledId, calledPerms] = vi.mocked(updateRolePermissions).mock.calls[0];
    expect(calledId).toBe(MOCK_ANALYST_ROLE.id);
    expect(calledPerms).toContain(PERMISSIONS.DASHBOARDS_VIEW);
    expect(calledPerms).toContain(PERMISSIONS.DASHBOARDS_CREATE);

    confirmSpy.mockRestore();
  });

  // ── Test 3: ROLES-V18-02 — built-in Save triggers window.confirm ──────────────

  it("saving a built-in role calls window.confirm before updateRolePermissions", async () => {
    seedAdminStore();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<RolesPage />);
    await selectRole("analyst");

    // Toggle one perm to make dirty
    const checkboxes = await screen.findAllByRole("checkbox");
    // Find an unchecked one and toggle it
    const unchecked = checkboxes.find((cb) => !(cb as HTMLInputElement).checked);
    expect(unchecked).toBeDefined();
    fireEvent.click(unchecked!);

    const saveBtn = await screen.findByRole("button", { name: /Save/ });
    await waitFor(() => expect(saveBtn).not.toBeDisabled());
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledWith(
        expect.stringContaining("analyst"),
      );
      expect(updateRolePermissions).toHaveBeenCalledTimes(1);
    });

    confirmSpy.mockRestore();
  });

  it("cancelling the built-in confirm aborts Save and does not call updateRolePermissions", async () => {
    seedAdminStore();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<RolesPage />);
    await selectRole("analyst");

    const checkboxes = await screen.findAllByRole("checkbox");
    const unchecked = checkboxes.find((cb) => !(cb as HTMLInputElement).checked);
    fireEvent.click(unchecked!);

    const saveBtn = await screen.findByRole("button", { name: /Save/ });
    await waitFor(() => expect(saveBtn).not.toBeDisabled());
    fireEvent.click(saveBtn);

    // Give time for any async flush
    await new Promise((r) => setTimeout(r, 50));
    expect(updateRolePermissions).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  // ── Test 4: SAFE-V18-02 mirror — user_admin sees admin locked ─────────────────

  it("user_admin viewer: selecting admin role shows locked state + 'Only admins can modify the admin role.'", async () => {
    seedUserAdminStore();
    render(<RolesPage />);

    await selectRole("admin");

    await waitFor(() => {
      expect(
        screen.getByText("Only admins can modify the admin role."),
      ).toBeInTheDocument();
    });

    // All checkboxes in the admin role matrix should be disabled
    const checkboxes = screen.getAllByRole("checkbox");
    for (const cb of checkboxes) {
      expect(cb).toBeDisabled();
    }

    // Save button should not be visible (or is absent) for the locked admin role
    const saveBtn = screen.queryByRole("button", { name: /Save/ });
    expect(saveBtn).toBeNull();
  });

  it("user_admin viewer: a permission they don't hold (dashboards:create) is disabled with tooltip", async () => {
    // user_admin does NOT hold dashboards:create
    seedUserAdminStore();
    render(<RolesPage />);

    // Select a non-admin role so we see the matrix
    await selectRole("analyst");

    // dashboards:create label should have the unheld tooltip
    const dashCreateCheckbox = await screen.findByRole("checkbox", {
      name: /dashboards:create/,
    });
    expect(dashCreateCheckbox).toBeDisabled();

    // The label wrapping it should have the tooltip title
    const label = dashCreateCheckbox.closest("label");
    expect(label?.getAttribute("title")).toBe(
      "You can only grant permissions you hold.",
    );
  });

  // ── Test 5: ROLES-V18-03 — create validation and API call ────────────────────

  it("bad slug (uppercase letters) is blocked client-side without calling createRole", async () => {
    seedAdminStore();
    render(<RolesPage />);

    // Wait for roles to load
    await waitFor(() => screen.getByRole("button", { name: /New role/ }));

    // Click [+ New role]
    fireEvent.click(screen.getByRole("button", { name: /New role/ }));

    // Type a bad slug
    const input = screen.getByPlaceholderText("role_name");
    fireEvent.change(input, { target: { value: "BadSlug" } });

    // Confirm (press Enter or click Create)
    fireEvent.click(screen.getByRole("button", { name: /Create/ }));

    // Error shown, no API call
    await waitFor(() => {
      expect(
        screen.getByText(/lowercase slug/i),
      ).toBeInTheDocument();
    });
    expect(createRole).not.toHaveBeenCalled();
  });

  it("reserved name 'admin' is blocked client-side", async () => {
    seedAdminStore();
    render(<RolesPage />);

    await waitFor(() => screen.getByRole("button", { name: /New role/ }));
    fireEvent.click(screen.getByRole("button", { name: /New role/ }));

    const input = screen.getByPlaceholderText("role_name");
    fireEvent.change(input, { target: { value: "admin" } });
    fireEvent.click(screen.getByRole("button", { name: /Create/ }));

    await waitFor(() => {
      expect(screen.getByText(/'admin' is a reserved/i)).toBeInTheDocument();
    });
    expect(createRole).not.toHaveBeenCalled();
  });

  it("valid slug calls createRole with empty permissions array", async () => {
    seedAdminStore();
    render(<RolesPage />);

    await waitFor(() => screen.getByRole("button", { name: /New role/ }));
    fireEvent.click(screen.getByRole("button", { name: /New role/ }));

    const input = screen.getByPlaceholderText("role_name");
    fireEvent.change(input, { target: { value: "new_role" } });
    fireEvent.click(screen.getByRole("button", { name: /Create/ }));

    await waitFor(() => {
      expect(createRole).toHaveBeenCalledWith("new_role", []);
    });
  });

  // ── Test 6: ROLES-V18-04 — delete disabled for held roles ────────────────────

  it("custom role with holders_count > 0 has delete button disabled with count tooltip", async () => {
    seedAdminStore();
    render(<RolesPage />);

    await waitFor(() => screen.getByText("held_custom"));

    const deleteBtn = screen.getByRole("button", { name: /Delete role held_custom/ });
    expect(deleteBtn).toBeDisabled();
    expect(deleteBtn.getAttribute("title")).toContain("3 user(s) hold this role");
  });

  it("custom role with holders_count = 0 has delete button enabled and calls deleteRole after confirm", async () => {
    seedAdminStore();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<RolesPage />);

    await waitFor(() => screen.getByText("my_custom"));

    const deleteBtn = screen.getByRole("button", { name: /Delete role my_custom/ });
    expect(deleteBtn).not.toBeDisabled();

    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(deleteRole).toHaveBeenCalledWith(MOCK_CUSTOM_ROLE_FREE.id);
    });

    confirmSpy.mockRestore();
  });

  // ── Test 7: dirty guard on role switch ────────────────────────────────────────

  // ── Test: description text renders in permission matrix ───────────────────────

  it("permission descriptions render as muted secondary text under each permission label", async () => {
    seedAdminStore();
    render(<RolesPage />);

    // Select a role so the matrix renders
    await selectRole("analyst");

    // A verbatim description string must be present in the document
    // Using users:assign_roles → "Assign and revoke user roles" (unambiguous, specific)
    expect(
      await screen.findByText("Assign and revoke user roles"),
    ).toBeInTheDocument();
  });

  it("switching roles with unsaved changes triggers confirm; cancel keeps current selection", async () => {
    seedAdminStore();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<RolesPage />);

    await selectRole("analyst");

    // Make it dirty by toggling a checkbox
    const checkboxes = await screen.findAllByRole("checkbox");
    const unchecked = checkboxes.find((cb) => !(cb as HTMLInputElement).checked);
    fireEvent.click(unchecked!);

    // Try switching to designer
    await selectRole("designer");

    // confirm was called
    expect(confirmSpy).toHaveBeenCalledWith("Discard unsaved changes?");
    // analyst detail pane title should still be shown (cancel blocked the switch)
    // Use the detail pane title (h2 in roles-detail-pane)
    const detailTitle = document.querySelector(".roles-detail-title");
    expect(detailTitle?.textContent).toBe("analyst");

    confirmSpy.mockRestore();
  });
});
