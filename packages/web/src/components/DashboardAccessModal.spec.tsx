/**
 * Phase 56 Plan 01 (GRANTUI-V110-01/02): DashboardAccessModal spec.
 *
 * Coverage (≥6 tests):
 *   1. Mount → lists "ann" under People and "analyst" under Roles (split sections).
 *   2. Info line mentioning admins/designers always having access is present.
 *   3. Add a USER grant (free-text): type "jdoe", click Add → addDashboardGrant called correctly.
 *   4. Pre-provisioning: type a username NOT in listUsers() → Add still fires for unknown user.
 *   5. Add a ROLE grant: toggle to Role, select "analyst", click Add → addDashboardGrant with role.
 *   6. Remove: click × for "ann" → removeDashboardGrant called; "ann" disappears.
 *
 * Mock style mirrors DynamicViewsModal.spec.tsx (vi.mock with importActual spread + per-fn vi.fn()).
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import DashboardAccessModal from "./DashboardAccessModal";
import * as clientModule from "../api/client";
import { seedAdminStore } from "../test/seedAuthStore";

// ─── mock ../api/client ───────────────────────────────────────────────────────

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    listDashboardGrants: vi.fn(),
    addDashboardGrant: vi.fn(),
    removeDashboardGrant: vi.fn(),
    listUsers: vi.fn(() =>
      Promise.resolve([
        { username: "jdoe", roles: [], last_seen: null, is_bootstrap: false },
      ]),
    ),
    listRoles: vi.fn(() =>
      Promise.resolve([
        {
          id: 1,
          name: "analyst",
          description: "",
          built_in: true,
          permissions: [],
          holders_count: 0,
        },
      ]),
    ),
  };
});

// ─── typed accessors ─────────────────────────────────────────────────────────

const mockedClient = clientModule as unknown as {
  listDashboardGrants: ReturnType<typeof vi.fn>;
  addDashboardGrant: ReturnType<typeof vi.fn>;
  removeDashboardGrant: ReturnType<typeof vi.fn>;
  listUsers: ReturnType<typeof vi.fn>;
  listRoles: ReturnType<typeof vi.fn>;
};

// ─── fixtures ─────────────────────────────────────────────────────────────────

const INITIAL_GRANTS = [
  { grantee_type: "user" as const, grantee: "ann", created_at: "2026-06-09T00:00:00Z" },
  { grantee_type: "role" as const, grantee: "analyst", created_at: "2026-06-09T00:00:00Z" },
];

// ─── helpers ──────────────────────────────────────────────────────────────────

const renderModal = (props?: Partial<{ dashboardId: number; dashboardName: string; onClose: () => void }>) =>
  render(
    <DashboardAccessModal
      dashboardId={props?.dashboardId ?? 7}
      dashboardName={props?.dashboardName ?? "My Dashboard"}
      onClose={props?.onClose ?? vi.fn()}
    />,
  );

// ─── tests ────────────────────────────────────────────────────────────────────

describe("DashboardAccessModal", () => {
  beforeEach(() => {
    seedAdminStore();
    vi.clearAllMocks();
    mockedClient.listDashboardGrants.mockResolvedValue(INITIAL_GRANTS);
  });

  it("1. mount — lists ann under People and analyst under Roles in split sections", async () => {
    renderModal();
    await waitFor(() => expect(screen.getByText("ann")).toBeInTheDocument());

    // "People" section heading
    expect(screen.getByText("People")).toBeInTheDocument();
    // "Roles" section heading
    expect(screen.getByText("Roles")).toBeInTheDocument();

    // user grant visible
    expect(screen.getByText("ann")).toBeInTheDocument();
    // role grant visible
    expect(screen.getByText("analyst")).toBeInTheDocument();

    // listDashboardGrants called with the dashboard id
    expect(mockedClient.listDashboardGrants).toHaveBeenCalledWith(7);
  });

  it("2. info line — mentions admins and designers always having access", async () => {
    renderModal();
    await waitFor(() => expect(screen.getByText("ann")).toBeInTheDocument());

    expect(
      screen.getByText(/admins and designers/i),
    ).toBeInTheDocument();
  });

  it("3. add user grant — types jdoe, clicks Add → addDashboardGrant called with user type", async () => {
    const updatedGrants = [
      ...INITIAL_GRANTS,
      { grantee_type: "user" as const, grantee: "jdoe", created_at: "2026-06-09T01:00:00Z" },
    ];
    mockedClient.addDashboardGrant.mockResolvedValueOnce(updatedGrants);

    renderModal();
    await waitFor(() => expect(screen.getByText("ann")).toBeInTheDocument());

    // User toggle should already be active (default); type into the input
    const input = screen.getByPlaceholderText("Username");
    fireEvent.change(input, { target: { value: "jdoe" } });

    const addBtn = screen.getByRole("button", { name: /^Add$/ });
    await act(async () => { fireEvent.click(addBtn); });

    expect(mockedClient.addDashboardGrant).toHaveBeenCalledWith(7, {
      grantee_type: "user",
      grantee: "jdoe",
    });

    // After add, jdoe should appear in the list
    await waitFor(() => expect(screen.getByText("jdoe")).toBeInTheDocument());
  });

  it("4. pre-provisioning — username not in listUsers() can still be added (free text)", async () => {
    const updatedGrants = [
      ...INITIAL_GRANTS,
      { grantee_type: "user" as const, grantee: "neverloggedin", created_at: "2026-06-09T02:00:00Z" },
    ];
    mockedClient.addDashboardGrant.mockResolvedValueOnce(updatedGrants);

    renderModal();
    await waitFor(() => expect(screen.getByText("ann")).toBeInTheDocument());

    const input = screen.getByPlaceholderText("Username");
    // "neverloggedin" is NOT in listUsers() mock — must still succeed
    fireEvent.change(input, { target: { value: "neverloggedin" } });

    const addBtn = screen.getByRole("button", { name: /^Add$/ });
    await act(async () => { fireEvent.click(addBtn); });

    expect(mockedClient.addDashboardGrant).toHaveBeenCalledWith(7, {
      grantee_type: "user",
      grantee: "neverloggedin",
    });

    await waitFor(() => expect(screen.getByText("neverloggedin")).toBeInTheDocument());
  });

  it("5. add role grant — toggle to Role, select analyst, click Add → addDashboardGrant with role type", async () => {
    const updatedGrants = [
      ...INITIAL_GRANTS,
      { grantee_type: "role" as const, grantee: "analyst", created_at: "2026-06-09T03:00:00Z" },
    ];
    mockedClient.addDashboardGrant.mockResolvedValueOnce(updatedGrants);

    renderModal();
    await waitFor(() => expect(screen.getByText("ann")).toBeInTheDocument());

    // Switch to Role toggle
    const roleToggle = screen.getByRole("button", { name: "Role" });
    fireEvent.click(roleToggle);

    // The select should now be rendered — choose "analyst"
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "analyst" } });

    const addBtn = screen.getByRole("button", { name: /^Add$/ });
    await act(async () => { fireEvent.click(addBtn); });

    expect(mockedClient.addDashboardGrant).toHaveBeenCalledWith(7, {
      grantee_type: "role",
      grantee: "analyst",
    });
  });

  it("6. remove grant — click × for ann → removeDashboardGrant called; ann disappears", async () => {
    const grantsWithoutAnn = [
      { grantee_type: "role" as const, grantee: "analyst", created_at: "2026-06-09T00:00:00Z" },
    ];
    mockedClient.removeDashboardGrant.mockResolvedValueOnce(grantsWithoutAnn);

    renderModal();
    await waitFor(() => expect(screen.getByText("ann")).toBeInTheDocument());

    const removeBtn = screen.getByRole("button", { name: "Remove user ann" });
    await act(async () => { fireEvent.click(removeBtn); });

    expect(mockedClient.removeDashboardGrant).toHaveBeenCalledWith(7, {
      grantee_type: "user",
      grantee: "ann",
    });

    // ann should no longer be in the DOM
    await waitFor(() => expect(screen.queryByText("ann")).not.toBeInTheDocument());
  });

  it("7. close button routes through onClose", async () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    await waitFor(() => expect(screen.getByText("ann")).toBeInTheDocument());

    const closeBtn = screen.getByRole("button", { name: "Close" });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
