/**
 * lib.rbacDb.spec.ts — Unit tests for rbacDb.ts permission-resolution data layer.
 *
 * Covers all resolution paths:
 *   - Admin short-circuit (empty DB, uppercase, APP_ADMIN_USERNAME override)
 *   - Analyst fallback (zero user_roles rows → live DB analyst mapping)
 *   - Single-role resolution
 *   - Multi-role union (deduped)
 *   - Custom role (built_in=0)
 *   - Case-insensitive user_roles lookup
 *   - getEffectiveRoles (admin, zero-rows, named roles)
 *   - getEffectiveRolesAndPermissions (shape + consistency)
 *
 * Uses createDb(":memory:") — seedRbac runs at construction, so the 4 built-in
 * roles + default mappings are already present in the fresh in-memory instance.
 */
import { describe, it, expect, afterEach } from "vitest";
import { createDb } from "../src/db";
import {
  getEffectivePermissions,
  getEffectiveRoles,
  getEffectiveRolesAndPermissions,
} from "../src/lib/rbacDb";
import { ALL_PERMISSIONS } from "../src/lib/permissions";

// Helper: assign a role by name to a username (lowercase-stored, per CONTEXT.md).
function assignRole(db: ReturnType<typeof createDb>, username: string, roleName: string): void {
  const row = db.prepare<[string], { id: number }>("SELECT id FROM roles WHERE name = ?").get(roleName);
  if (!row) throw new Error(`Role '${roleName}' not found in test DB`);
  db.prepare("INSERT OR IGNORE INTO user_roles (username, role_id) VALUES (?, ?)").run(
    username.toLowerCase(),
    row.id
  );
}

describe("rbacDb — getEffectivePermissions", () => {
  it("admin short-circuit: 'admin' returns all 16 permissions on EMPTY db (before seed)", () => {
    // Use a raw fresh DB with NO seedRbac to prove the short-circuit fires before any DB read.
    // We can't easily get a pre-seed DB via createDb(), so use the already-seeded one — the
    // short-circuit must fire BEFORE any query regardless of DB state.
    const db = createDb(":memory:");
    // Delete all role_permissions to simulate empty DB for this assertion.
    db.prepare("DELETE FROM role_permissions").run();
    db.prepare("DELETE FROM roles").run();
    const result = getEffectivePermissions("admin", db);
    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(16);
    expect([...result].sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  it("admin short-circuit: 'ADMIN' (uppercase) also returns all 16 — case-insensitive bootstrap", () => {
    const db = createDb(":memory:");
    const result = getEffectivePermissions("ADMIN", db);
    expect(result.size).toBe(16);
    expect([...result].sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  it("admin short-circuit: '  Admin  ' (whitespace + mixed case) returns all 16", () => {
    const db = createDb(":memory:");
    const result = getEffectivePermissions("  Admin  ", db);
    expect(result.size).toBe(16);
  });

  it("APP_ADMIN_USERNAME override: 'alice@corp.com' returns all 16; 'admin' does NOT short-circuit", () => {
    const db = createDb(":memory:");
    const original = process.env.APP_ADMIN_USERNAME;
    try {
      process.env.APP_ADMIN_USERNAME = "alice@corp.com";
      // alice@corp.com (case variations) gets admin short-circuit
      expect(getEffectivePermissions("Alice@Corp.com", db).size).toBe(16);
      expect(getEffectivePermissions("ALICE@CORP.COM", db).size).toBe(16);
      // "admin" must NOT short-circuit when APP_ADMIN_USERNAME is overridden
      // (it may still have permissions from DB; the point is it doesn't short-circuit)
      // With an empty user_roles for "admin", it should fall back to analyst (dashboards:view).
      const adminResult = getEffectivePermissions("admin", db);
      // Should NOT be 16 (no short-circuit)
      expect(adminResult.size).not.toBe(16);
      // Should be analyst fallback (1 permission: dashboards:view)
      expect(adminResult.has("dashboards:view")).toBe(true);
      expect(adminResult.size).toBe(1);
    } finally {
      if (original === undefined) {
        delete process.env.APP_ADMIN_USERNAME;
      } else {
        process.env.APP_ADMIN_USERNAME = original;
      }
    }
  });

  it("analyst fallback: zero user_roles rows → analyst's live DB permission set (dashboards:view)", () => {
    const db = createDb(":memory:");
    // "newuser" has no role assignments
    const result = getEffectivePermissions("newuser@corp.com", db);
    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBeGreaterThan(0); // NOT locked out
    expect(result.has("dashboards:view")).toBe(true);
    // Analyst has exactly 1 permission per DEFAULT_ROLE_MAPPINGS
    expect(result.size).toBe(1);
  });

  it("single role: user assigned 'designer' → returns designer's 9 permissions", () => {
    const db = createDb(":memory:");
    assignRole(db, "alice", "designer");
    const result = getEffectivePermissions("alice", db);
    const expected = [
      "dashboards:view",
      "dashboards:create",
      "dashboards:edit",
      "dashboards:delete",
      "widgets:configure",
      "layers:manage",
      "dynamic_views:manage",
      "data_filters:configure",
      "datasets:manage",
    ];
    expect(result.size).toBe(9);
    for (const perm of expected) {
      expect(result.has(perm)).toBe(true);
    }
  });

  it("multi-role union: user assigned 'designer' + 'user_admin' → union of permissions (deduped)", () => {
    const db = createDb(":memory:");
    assignRole(db, "bob", "designer");
    assignRole(db, "bob", "user_admin");
    const result = getEffectivePermissions("bob", db);
    // designer: 9, user_admin: 6, overlap: dashboards:view → union = 14
    // designer: view,create,edit,delete,widgets:configure,layers:manage,dynamic_views:manage,data_filters:configure,datasets:manage
    // user_admin: users:view, users:assign_roles, roles:view, roles:manage_permissions, roles:create_custom, dashboards:view
    // overlap: dashboards:view (1)
    // total unique = 9 + 6 - 1 = 14
    expect(result.size).toBe(14);
    // Check some from each role
    expect(result.has("dashboards:create")).toBe(true); // designer only
    expect(result.has("users:assign_roles")).toBe(true); // user_admin only
    expect(result.has("dashboards:view")).toBe(true); // both
  });

  it("custom role: user assigned a custom role (built_in=0) with arbitrary subset", () => {
    const db = createDb(":memory:");
    // Insert custom role
    db.prepare("INSERT INTO roles (name, description, built_in) VALUES ('custom_viewer', 'Custom test role', 0)").run();
    const roleRow = db.prepare<[string], { id: number }>("SELECT id FROM roles WHERE name = ?").get("custom_viewer")!;
    // Assign 2 permissions
    db.prepare("INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)").run(roleRow.id, "dashboards:view");
    db.prepare("INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)").run(roleRow.id, "layers:manage");
    // Assign user
    db.prepare("INSERT OR IGNORE INTO user_roles (username, role_id) VALUES (?, ?)").run("carol", roleRow.id);

    const result = getEffectivePermissions("carol", db);
    expect(result.size).toBe(2);
    expect(result.has("dashboards:view")).toBe(true);
    expect(result.has("layers:manage")).toBe(true);
  });

  it("case-insensitive user_roles lookup: role assigned to 'bob' (stored lower), lookup via 'BOB' returns same", () => {
    const db = createDb(":memory:");
    assignRole(db, "bob", "analyst");
    // Lookup with uppercase
    const result = getEffectivePermissions("BOB", db);
    expect(result.size).toBe(1);
    expect(result.has("dashboards:view")).toBe(true);
  });
});

describe("rbacDb — getEffectiveRoles", () => {
  it("admin short-circuit → returns ['admin']", () => {
    const db = createDb(":memory:");
    expect(getEffectiveRoles("admin", db)).toEqual(["admin"]);
  });

  it("uppercase ADMIN → returns ['admin']", () => {
    const db = createDb(":memory:");
    expect(getEffectiveRoles("ADMIN", db)).toEqual(["admin"]);
  });

  it("zero user_roles rows → returns ['analyst']", () => {
    const db = createDb(":memory:");
    expect(getEffectiveRoles("unknown_user", db)).toEqual(["analyst"]);
  });

  it("user assigned 'designer' + 'user_admin' → returns both role names", () => {
    const db = createDb(":memory:");
    assignRole(db, "dave", "designer");
    assignRole(db, "dave", "user_admin");
    const roles = getEffectiveRoles("dave", db);
    expect(roles).toHaveLength(2);
    expect(roles).toContain("designer");
    expect(roles).toContain("user_admin");
  });
});

describe("rbacDb — getEffectiveRolesAndPermissions", () => {
  it("returns { roles: string[], permissions: string[] } with consistent data", () => {
    const db = createDb(":memory:");
    assignRole(db, "eve", "designer");
    const result = getEffectiveRolesAndPermissions("eve", db);
    expect(result).toHaveProperty("roles");
    expect(result).toHaveProperty("permissions");
    expect(Array.isArray(result.roles)).toBe(true);
    expect(Array.isArray(result.permissions)).toBe(true);
    expect(result.roles).toEqual(["designer"]);
    expect(result.permissions).toHaveLength(9);
    expect(result.permissions).toContain("dashboards:view");
    expect(result.permissions).toContain("datasets:manage");
  });

  it("admin: roles=['admin'], permissions has all 16", () => {
    const db = createDb(":memory:");
    const result = getEffectiveRolesAndPermissions("admin", db);
    expect(result.roles).toEqual(["admin"]);
    expect(result.permissions).toHaveLength(16);
  });

  it("zero user_roles: roles=['analyst'], permissions has dashboards:view", () => {
    const db = createDb(":memory:");
    const result = getEffectiveRolesAndPermissions("nobody", db);
    expect(result.roles).toEqual(["analyst"]);
    expect(result.permissions).toContain("dashboards:view");
    expect(result.permissions).toHaveLength(1);
  });
});
