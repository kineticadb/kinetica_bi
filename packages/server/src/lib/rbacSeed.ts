/**
 * rbacSeed.ts — Boot-time idempotent seed for built-in RBAC roles + default mappings.
 *
 * Called once inside createDb() after the PRAGMA-guarded ALTER blocks and before
 * `return instance`. Runs on EVERY boot; INSERT OR IGNORE makes it a no-op on
 * subsequent restarts when the rows already exist.
 *
 * Semantics (46-CONTEXT.md § Seed & upgrade semantics + PITFALLS Pitfall 11):
 *   - INSERT OR IGNORE only — never DELETE/UPDATE. New catalog permissions land on
 *     built-in defaults on next boot; operator edits to existing mappings persist
 *     (no overwrite). No reset-to-defaults in v1.8.
 *   - Does NOT touch the username↔role join table — no bootstrap assignment is
 *     needed because the admin bootstrap short-circuit in getEffectivePermissions
 *     (Plan 46-03) handles APP_ADMIN_USERNAME before any DB lookup.
 */

import type Database from "better-sqlite3";
import { BUILTIN_ROLES, DEFAULT_ROLE_MAPPINGS } from "./permissions";

const ROLE_DESCRIPTIONS: Record<(typeof BUILTIN_ROLES)[number], string> = {
  admin:      "Full access — governs the application",
  user_admin: "Manages users and role assignments",
  designer:   "Creates and edits dashboards",
  analyst:    "Views dashboards and interacts with data",
};

export function seedRbac(db: Database.Database): void {
  const insertRole = db.prepare(
    "INSERT OR IGNORE INTO roles (name, description, built_in) VALUES (?, ?, 1)"
  );
  const selectRoleId = db.prepare<[string], { id: number }>(
    "SELECT id FROM roles WHERE name = ?"
  );
  const insertPermission = db.prepare(
    "INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)"
  );

  const seed = db.transaction(() => {
    for (const roleName of BUILTIN_ROLES) {
      // INSERT OR IGNORE — row may already exist from a prior boot; that is fine.
      insertRole.run(roleName, ROLE_DESCRIPTIONS[roleName]);

      // Resolve id AFTER the INSERT so we handle both first-boot and re-boot paths
      // without relying on lastInsertRowid (which is 0 when the row was ignored).
      const row = selectRoleId.get(roleName);
      if (!row) continue; // should never happen; defensive guard

      for (const permission of DEFAULT_ROLE_MAPPINGS[roleName]) {
        // INSERT OR IGNORE — operator-edited rows survive restart (no overwrite).
        insertPermission.run(row.id, permission);
      }
    }
  });

  seed();
}
