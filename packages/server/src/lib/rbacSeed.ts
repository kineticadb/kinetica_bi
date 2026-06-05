/**
 * rbacSeed.ts — Boot-time idempotent seed for built-in RBAC roles + default mappings.
 *
 * Called once inside createDb() after the PRAGMA-guarded ALTER blocks and before
 * `return instance`. Runs on EVERY boot.
 *
 * Semantics (46-CONTEXT.md § Seed & upgrade semantics + addendum 2026-06-05):
 *
 *   Role rows: INSERT OR IGNORE — unchanged from original.
 *
 *   Mapping rows: history-gated via rbac_seed_history.
 *     For each (role, permission) in DEFAULT_ROLE_MAPPINGS:
 *       1. INSERT OR IGNORE into rbac_seed_history (role_name, permission)
 *       2. Only if that insert actually inserted a NEW row (changes === 1, i.e. first
 *          time this default has EVER been seen) → INSERT OR IGNORE into role_permissions.
 *
 *   This gives the operator-removal-survival contract:
 *     Boot 1 — history row absent → inserted (changes=1) → role_permissions row inserted.
 *     Operator deletes a role_permissions row → next boot: history row exists (changes=0)
 *       → role_permissions insert SKIPPED → removal survives restart.
 *     Future catalog addition (new permission in DEFAULT_ROLE_MAPPINGS) → no history row
 *       → seeded exactly once on the first boot that sees it.
 *
 *   INSERT OR IGNORE only — never DELETE/UPDATE. No reset-to-defaults in v1.8.
 *   Does NOT touch user_roles — admin bootstrap short-circuit in Plan 46-03 handles
 *   APP_ADMIN_USERNAME before any DB lookup.
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
  // History gate: records which (role_name, permission) defaults have EVER been seeded.
  // changes === 1 means this is the first time we're seeing this default → safe to seed.
  // changes === 0 means history row already exists → operator may have removed the mapping;
  // skip the role_permissions insert to let the removal survive restart.
  const insertHistory = db.prepare(
    "INSERT OR IGNORE INTO rbac_seed_history (role_name, permission) VALUES (?, ?)"
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
        // History-gated insert: attempt to claim this (role, permission) in history.
        const histResult = insertHistory.run(roleName, permission);

        // Only seed the actual mapping when the history row is new (first encounter).
        // If changes === 0, history already recorded this default — an operator may
        // have deliberately removed the role_permissions row; do NOT re-insert it.
        if (histResult.changes === 1) {
          insertPermission.run(row.id, permission);
        }
      }
    }
  });

  seed();
}
