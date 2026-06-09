/**
 * dashboardAccessDb.ts — Per-dashboard view-access resolver + grant CRUD helpers (v1.10 ACCESS-V110-01..04).
 *
 * Provides:
 *   canViewDashboard(username, dashboardId, conn?) — boolean access resolver.
 *   listDashboardGrants(dashboardId, conn?)         — array of grant rows.
 *   addDashboardGrant(dashboardId, grantee_type, grantee, conn?) — idempotent insert.
 *   removeDashboardGrant(dashboardId, grantee_type, grantee, conn?) — delete.
 *
 * canViewDashboard resolution order:
 *   1. Bypass: getEffectivePermissions(username).has(DASHBOARDS_MANAGE_ACCESS) — covers admin,
 *      designer, bootstrap admin (short-circuits to ALL_PERMISSIONS internally), and any custom
 *      role granted manage_access. Checked first — cheapest path for common admin/designer case.
 *   2. Direct user grant: SELECT 1 WHERE grantee_type='user' AND grantee=lower(username).
 *   3. Role grant: intersect getEffectiveRoles(username) with role grantees for the dashboard.
 *   4. Otherwise false (private-by-default — a dashboard with no grants is invisible to non-bypass users).
 *
 * Grant model:
 *   - User grantees are stored LOWERCASED (matches user_roles convention; case-insensitive lookup).
 *   - Role grantees are stored VERBATIM (role names are case-sensitive identifiers).
 *   - Pre-provisioning allowed: user grant strings are free-form lowercased — no FK to known_users.
 *
 * Pure module — only SQLite reads/writes via conn. No side effects.
 * Mirrors lib/rbacDb.ts style: injectable conn = defaultDb default parameter, named exports, no default export.
 */

import type Database from "better-sqlite3";
import { db as defaultDb } from "../db";
import { getEffectivePermissions, getEffectiveRoles } from "./rbacDb";
import { PERMISSIONS } from "./permissions";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GranteeType = "user" | "role";

export interface DashboardGrant {
  grantee_type: GranteeType;
  grantee: string;
  created_at: string;
}

// ─── Access resolver ──────────────────────────────────────────────────────────

/**
 * Returns true if the user may view the dashboard.
 *
 * Resolution order (union semantics — any path returning true is sufficient):
 *   (a) Bypass: user holds dashboards:manage_access (admin / designer / bootstrap / custom role).
 *       getEffectivePermissions internally short-circuits to ALL_PERMISSIONS for bootstrap admin
 *       BEFORE any DB read, so this covers every admin path.
 *   (b) Direct user grant in dashboard_access_grants (grantee_type='user', grantee=lower(username)).
 *   (c) Role grant: any of getEffectiveRoles(username) appears as grantee_type='role' grant.
 *
 * A dashboard with NO grants returns false for all non-bypass users (private-by-default).
 */
export const canViewDashboard = (
  username: string,
  dashboardId: number,
  conn: Database.Database = defaultDb
): boolean => {
  // (a) Bypass check — fires before any grant query.
  if (getEffectivePermissions(username, conn).has(PERMISSIONS.DASHBOARDS_MANAGE_ACCESS)) {
    return true;
  }

  const normalizedUser = username.trim().toLowerCase();

  // (b) Direct user grant.
  const userGrant = conn
    .prepare<[number, string], { found: number }>(
      `SELECT 1 AS found FROM dashboard_access_grants
       WHERE dashboard_id = ? AND grantee_type = 'user' AND grantee = ?`
    )
    .get(dashboardId, normalizedUser);
  if (userGrant) {
    return true;
  }

  // (c) Role grant — fetch all role grantees for this dashboard, then intersect with
  //     the user's effective roles. Fetching role grantees once (one query) is cheaper
  //     than N parameterized role lookups when a user has many roles.
  const roleGrantRows = conn
    .prepare<[number], { grantee: string }>(
      `SELECT grantee FROM dashboard_access_grants
       WHERE dashboard_id = ? AND grantee_type = 'role'`
    )
    .all(dashboardId);

  if (roleGrantRows.length > 0) {
    const grantedRoles = new Set(roleGrantRows.map((r) => r.grantee));
    const userRoles = getEffectiveRoles(username, conn);
    for (const role of userRoles) {
      if (grantedRoles.has(role)) {
        return true;
      }
    }
  }

  return false;
};

// ─── Grant CRUD helpers ───────────────────────────────────────────────────────

/**
 * List all grants for a dashboard, ordered deterministically by grantee_type, grantee.
 */
export const listDashboardGrants = (
  dashboardId: number,
  conn: Database.Database = defaultDb
): DashboardGrant[] => {
  return conn
    .prepare<[number], DashboardGrant>(
      `SELECT grantee_type, grantee, created_at
       FROM dashboard_access_grants
       WHERE dashboard_id = ?
       ORDER BY grantee_type ASC, grantee ASC`
    )
    .all(dashboardId);
};

/**
 * Add a grant. User grantees are lowercased before insert. Idempotent (INSERT OR IGNORE).
 * Returns true if the row was inserted (first time), false if it already existed.
 */
export const addDashboardGrant = (
  dashboardId: number,
  granteeType: GranteeType,
  grantee: string,
  conn: Database.Database = defaultDb
): boolean => {
  const storedGrantee = granteeType === "user" ? grantee.trim().toLowerCase() : grantee;
  const result = conn
    .prepare(
      `INSERT OR IGNORE INTO dashboard_access_grants (dashboard_id, grantee_type, grantee)
       VALUES (?, ?, ?)`
    )
    .run(dashboardId, granteeType, storedGrantee);
  return result.changes > 0;
};

/**
 * Remove a grant. User grantees are lowercased to match the stored value.
 * Returns true if a row was deleted, false if no matching grant existed.
 */
export const removeDashboardGrant = (
  dashboardId: number,
  granteeType: GranteeType,
  grantee: string,
  conn: Database.Database = defaultDb
): boolean => {
  const storedGrantee = granteeType === "user" ? grantee.trim().toLowerCase() : grantee;
  const result = conn
    .prepare(
      `DELETE FROM dashboard_access_grants
       WHERE dashboard_id = ? AND grantee_type = ? AND grantee = ?`
    )
    .run(dashboardId, granteeType, storedGrantee);
  return result.changes > 0;
};
