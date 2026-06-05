/**
 * Auth store seeding helpers for RBAC-aware test specs (Plans 03 + 04).
 *
 * IMPORTANT: Call these helpers INSIDE beforeEach (after the zustand reset shim
 * wipes user→null). Calling before the shim runs will have the seeded state
 * overwritten by the afterEach reset.
 *
 * Uses PERMISSIONS.* constants only — no raw permission strings — so that any
 * catalog rename is caught at compile time.
 */

import { useAuthStore } from "../store/auth";
import { PERMISSIONS } from "../lib/permissions";

/**
 * Seeds useAuthStore with a designer user.
 * Permissions: full dashboard lifecycle + all design tooling + dataset management.
 * Mirrors DEFAULT_ROLE_MAPPINGS.designer from packages/server/src/lib/permissions.ts.
 */
export function seedDesignerStore(): void {
  useAuthStore.setState({
    status: "authenticated",
    user: {
      username: "testdesigner",
      roles: ["designer"],
      permissions: [
        PERMISSIONS.DASHBOARDS_VIEW,
        PERMISSIONS.DASHBOARDS_CREATE,
        PERMISSIONS.DASHBOARDS_EDIT,
        PERMISSIONS.DASHBOARDS_DELETE,
        PERMISSIONS.WIDGETS_CONFIGURE,
        PERMISSIONS.LAYERS_MANAGE,
        PERMISSIONS.DYNAMIC_VIEWS_MANAGE,
        PERMISSIONS.DATA_FILTERS_CONFIGURE,
        PERMISSIONS.DATASETS_MANAGE,
      ],
    },
  });
}

/**
 * Seeds useAuthStore with an analyst user.
 * Permissions: dashboards:view only (analyst-passthrough territory is ungated by design).
 * Mirrors DEFAULT_ROLE_MAPPINGS.analyst from packages/server/src/lib/permissions.ts.
 */
export function seedAnalystStore(): void {
  useAuthStore.setState({
    status: "authenticated",
    user: {
      username: "testanalyst",
      roles: ["analyst"],
      permissions: [PERMISSIONS.DASHBOARDS_VIEW],
    },
  });
}

/**
 * Seeds useAuthStore with an admin user.
 * Permissions: all 16 (includes USERS_VIEW + ROLES_VIEW for Sidebar tests).
 * Mirrors admin bootstrap short-circuit — all permissions granted.
 */
export function seedAdminStore(): void {
  useAuthStore.setState({
    status: "authenticated",
    user: {
      username: "testadmin",
      roles: ["admin"],
      permissions: Object.values(PERMISSIONS),
    },
  });
}
