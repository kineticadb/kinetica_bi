/**
 * rbacDb.ts — Synchronous per-request permission-resolution data layer (v1.8 SCHEMA-V18-02).
 *
 * Provides:
 *   getEffectivePermissions(username) — Set<string> of all permissions for a user.
 *   getEffectiveRoles(username)       — string[] of role names for a user.
 *   getEffectiveRolesAndPermissions(username) — { roles, permissions } combined view.
 *
 * No caching — synchronous per-request read so role changes take effect immediately
 * (PITFALLS P4/P10). Roles are NOT stored in the session row.
 *
 * Resolution order (ARCHITECTURE Q1 + Anti-Pattern 4):
 *   1. isBootstrapAdmin(username) → short-circuit to ALL_PERMISSIONS (before any DB read).
 *   2. Query user_roles JOIN role_permissions WHERE username = lower(username).
 *   3. If zero rows → analyst fallback (reads analyst role's LIVE DB mappings, NOT a code constant).
 *   4. Else → union of all role permissions.
 *
 * Pure module — no side effects beyond SQLite reads. The db singleton is an injectable
 * default parameter so tests can pass an in-memory createDb() instance.
 *
 * Mirrors lib/viewNaming.ts and lib/dynamicViewSql.ts style (named exports, no default export).
 */

import type Database from "better-sqlite3";
import { db as defaultDb } from "../db";
import { ALL_PERMISSIONS } from "./permissions";

// ─── Bootstrap admin ─────────────────────────────────────────────────────────

/**
 * Read at call time, not cached — APP_ADMIN_USERNAME default 'admin' (Kinetica superuser).
 * Case-insensitive compare in isBootstrapAdmin.
 * Reading at call time (not module-level) allows tests to mutate process.env between cases.
 */
export const getAppAdminUsername = (): string =>
  (process.env.APP_ADMIN_USERNAME || "admin").trim();

/**
 * True if username (case-insensitive, whitespace-trimmed) matches the configured bootstrap
 * admin. The bootstrap admin bypasses all DB lookups and always gets every permission.
 */
export const isBootstrapAdmin = (username: string): boolean =>
  username.trim().toLowerCase() === getAppAdminUsername().toLowerCase();

// ─── Permission resolution ────────────────────────────────────────────────────

/**
 * Resolve the effective permission set for a username.
 *
 * Bootstrap short-circuit fires BEFORE any prepared statement (Anti-Pattern 4 — the admin
 * bypass must NOT depend on the DB; it is an escape hatch for the first deployment before
 * any roles are assigned, and for recovery if the DB becomes corrupted).
 *
 * Analyst fallback reads the analyst role's CURRENT mappings from role_permissions (live DB
 * value, NOT ALL_PERMISSIONS or DEFAULT_ROLE_MAPPINGS constants). This means an operator
 * who edits the analyst role's default permission set sees the change reflected immediately
 * for all unassigned users, without any code deployment.
 *
 * No caching — synchronous per-request read so role changes take effect immediately
 * (PITFALLS P4/P10). Roles are NOT stored in the session row.
 */
export const getEffectivePermissions = (
  username: string,
  conn: Database.Database = defaultDb
): Set<string> => {
  // a. Bootstrap short-circuit BEFORE any DB read.
  if (isBootstrapAdmin(username)) {
    return new Set(ALL_PERMISSIONS);
  }

  // b. Normalise username for case-insensitive lookup (usernames stored LOWERCASED in user_roles).
  const uname = username.trim().toLowerCase();

  // c. Single JOIN query: all permissions for all roles assigned to this user.
  const rows = conn
    .prepare<[string], { permission: string }>(
      `SELECT DISTINCT rp.permission AS permission
       FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       WHERE ur.username = ?`
    )
    .all(uname);

  // d. Zero rows → analyst fallback. Query the analyst role's CURRENT DB mappings
  //    (live DB value — NOT the code constant — so an operator who edits the analyst
  //    role sees the change reflected for unassigned users immediately).
  if (rows.length === 0) {
    const analystRows = conn
      .prepare<[], { permission: string }>(
        `SELECT rp.permission
         FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id
         WHERE r.name = 'analyst'`
      )
      .all();
    return new Set(analystRows.map((r) => r.permission));
  }

  // e. Return the union of all assigned roles' permissions.
  return new Set(rows.map((r) => r.permission));
};

// ─── Role-name resolution ─────────────────────────────────────────────────────

/**
 * Resolve the effective role names for a username.
 *
 * - Bootstrap admin → ["admin"]
 * - Zero user_roles rows → ["analyst"]
 * - Otherwise → the names of all assigned roles.
 */
export const getEffectiveRoles = (
  username: string,
  conn: Database.Database = defaultDb
): string[] => {
  if (isBootstrapAdmin(username)) {
    return ["admin"];
  }

  const uname = username.trim().toLowerCase();

  const rows = conn
    .prepare<[string], { name: string }>(
      `SELECT r.name
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.username = ?`
    )
    .all(uname);

  if (rows.length === 0) {
    return ["analyst"];
  }

  return rows.map((r) => r.name);
};

// ─── Combined helper (Phase 48 /me shape) ────────────────────────────────────

/**
 * Returns { roles: string[], permissions: string[] } — the shape consumed by the
 * Phase 48 /me endpoint and frontend useAuthStore.
 */
export const getEffectiveRolesAndPermissions = (
  username: string,
  conn: Database.Database = defaultDb
): { roles: string[]; permissions: string[] } => ({
  roles: getEffectiveRoles(username, conn),
  permissions: [...getEffectivePermissions(username, conn)],
});
