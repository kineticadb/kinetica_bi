/**
 * routes.management.spec.ts — Phase 47 Plan 03 (GUARD-V18-04)
 *
 * Coverage:
 *   - GET /api/users: admin success (union of known_users + user_roles), 403 for non-holder
 *   - POST /api/users/:username/roles: admin assigns role to a target user (Pitfall 6 — targets
 *     req.params.username, NOT the caller), 403 for non-holder
 *   - DELETE /api/users/:username/roles/:roleName: admin revokes role (idempotent), 403 for non-holder
 *   - GET /api/roles: admin gets roles + permissions, 403 for non-holder
 *   - POST /api/roles: admin creates custom role, 409 on duplicate, 403 for non-holder
 *   - PUT /api/roles/:id/permissions: admin replaces permission set, 400 on unknown perm, 403 for non-holder
 *   - DELETE /api/roles/:id: admin deletes custom role, 400 on built-in, 403 for non-holder
 *
 * Follows routes.quantile.spec.ts supertest pattern + createAdminSession helper.
 * Analyst session is seeded by inserting user_roles with analyst-only access.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { buildTestApp } from "./helpers/app";
import { createAdminSession } from "./helpers/db";
import { db } from "../src/db";
import jwt from "jsonwebtoken";
import { createSession } from "../src/sessionStore";

// ─── Session helpers ──────────────────────────────────────────────────────────

const AUTH_SECRET = process.env.AUTH_SECRET!;
const KINETICA_URL = process.env.KINETICA_URL!;

/**
 * Creates a session cookie for a non-admin user (analyst role only).
 * Seeds user_roles so username has the analyst role (not bootstrap admin).
 * Analyst has only dashboards:view — no management permissions.
 */
const createAnalystSession = (username = "analyst_user") => {
  // Get the analyst role id
  const analystRole = db.prepare("SELECT id FROM roles WHERE name = 'analyst'").get() as { id: number } | undefined;
  if (analystRole) {
    db.prepare("INSERT OR IGNORE INTO user_roles (username, role_id) VALUES (lower(?), ?)").run(username, analystRole.id);
  }
  const sid = createSession({ username, secret: "analyst-test-secret", kineticaUrl: KINETICA_URL });
  const token = jwt.sign({ sub: username, sid, v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
  return { cookie: `kbi_session=${token}` };
};

// ─── Cleanup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  db.exec("DELETE FROM sessions");
  db.exec("DELETE FROM known_users");
  db.exec("DELETE FROM user_roles");
  // Remove custom roles (keep built-in roles)
  db.exec("DELETE FROM roles WHERE built_in = 0");
});

// ─── GET /api/users ───────────────────────────────────────────────────────────

describe("GET /api/users (GUARD-V18-04)", () => {
  it("returns 403 PERMISSION_DENIED for non-holder (analyst session)", async () => {
    const app = await buildTestApp();
    const { cookie } = createAnalystSession();
    const res = await app.get("/api/users").set("Cookie", cookie);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PERMISSION_DENIED");
  });

  it("admin session returns 200 with users array", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.get("/api/users").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
  });

  it("GET /api/users returns UNION of known_users and user_roles — both sources appear", async () => {
    // Seed a known_users-only user (has logged in but no explicit role assignment)
    db.prepare("INSERT INTO known_users (username) VALUES (?)").run("login_only_user");
    // Seed a user_roles-only user (has a role but has never logged in via the known_users path)
    const designerRole = db.prepare("SELECT id FROM roles WHERE name = 'designer'").get() as { id: number };
    db.prepare("INSERT OR IGNORE INTO user_roles (username, role_id) VALUES (?, ?)").run("assigned_only_user", designerRole.id);

    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.get("/api/users").set("Cookie", cookie);
    expect(res.status).toBe(200);
    const usernames = (res.body.users as Array<{ username: string }>).map((u) => u.username);
    expect(usernames).toContain("login_only_user");
    expect(usernames).toContain("assigned_only_user");
  });

  it("user roles are populated correctly in the response", async () => {
    const designerRole = db.prepare("SELECT id FROM roles WHERE name = 'designer'").get() as { id: number };
    db.prepare("INSERT INTO known_users (username) VALUES (?)").run("testuser");
    db.prepare("INSERT OR IGNORE INTO user_roles (username, role_id) VALUES (?, ?)").run("testuser", designerRole.id);

    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.get("/api/users").set("Cookie", cookie);
    expect(res.status).toBe(200);
    const testUser = (res.body.users as Array<{ username: string; roles: string[] }>).find((u) => u.username === "testuser");
    expect(testUser).toBeDefined();
    expect(testUser!.roles).toContain("designer");
  });

  it("includes last_seen for known users and null for assigned-only users", async () => {
    // login_user has logged in (exists in known_users) — should have non-null last_seen
    db.prepare("INSERT INTO known_users (username) VALUES (?)").run("login_user");
    // assigned_only has a role but has never logged in — should have last_seen === null
    const designerRole = db.prepare("SELECT id FROM roles WHERE name = 'designer'").get() as { id: number };
    db.prepare("INSERT OR IGNORE INTO user_roles (username, role_id) VALUES (?, ?)").run("assigned_only", designerRole.id);

    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.get("/api/users").set("Cookie", cookie);
    expect(res.status).toBe(200);

    type UserRow = { username: string; roles: string[]; last_seen: string | null; is_bootstrap: boolean };
    const users = res.body.users as UserRow[];

    const loginUser = users.find((u) => u.username === "login_user");
    expect(loginUser).toBeDefined();
    expect(typeof loginUser!.last_seen).toBe("string");
    expect(loginUser!.last_seen).not.toBeNull();

    const assignedOnly = users.find((u) => u.username === "assigned_only");
    expect(assignedOnly).toBeDefined();
    expect(assignedOnly!.last_seen).toBeNull();
  });

  it("flags the bootstrap admin row with is_bootstrap:true and others false", async () => {
    db.prepare("INSERT INTO known_users (username) VALUES (?)").run("alice");

    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.get("/api/users").set("Cookie", cookie);
    expect(res.status).toBe(200);

    type UserRow = { username: string; roles: string[]; last_seen: string | null; is_bootstrap: boolean };
    const users = res.body.users as UserRow[];

    const bootstrapName = (process.env.APP_ADMIN_USERNAME || "admin").toLowerCase();
    const bootstrapRow = users.find((u) => u.username === bootstrapName);
    expect(bootstrapRow).toBeDefined();
    expect(bootstrapRow!.is_bootstrap).toBe(true);

    const aliceRow = users.find((u) => u.username === "alice");
    expect(aliceRow).toBeDefined();
    expect(aliceRow!.is_bootstrap).toBe(false);
  });

  it("synthesizes a bootstrap row when bootstrap is absent from both tables", async () => {
    // Only alice in known_users — no bootstrap row anywhere
    db.prepare("INSERT INTO known_users (username) VALUES (?)").run("alice");

    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.get("/api/users").set("Cookie", cookie);
    expect(res.status).toBe(200);

    type UserRow = { username: string; roles: string[]; last_seen: string | null; is_bootstrap: boolean };
    const users = res.body.users as UserRow[];

    const bootstrapName = (process.env.APP_ADMIN_USERNAME || "admin").toLowerCase();
    const bootstrapRow = users.find((u) => u.username === bootstrapName);
    expect(bootstrapRow).toBeDefined();
    expect(bootstrapRow!.is_bootstrap).toBe(true);
    expect(bootstrapRow!.roles).toEqual([]);
    expect(bootstrapRow!.last_seen).toBeNull();
  });
});

// ─── POST /api/users/:username/roles ─────────────────────────────────────────

describe("POST /api/users/:username/roles (GUARD-V18-04)", () => {
  it("returns 403 PERMISSION_DENIED for non-holder (analyst session)", async () => {
    const app = await buildTestApp();
    const { cookie } = createAnalystSession();
    const res = await app.post("/api/users/bob/roles").set("Cookie", cookie).send({ roleName: "designer" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PERMISSION_DENIED");
  });

  it("admin assigns role to req.params.username (Pitfall 6: target is 'bob', not the admin caller)", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    // Assign designer to "bob" — the admin caller must NOT gain the role (Pitfall 6)
    const res = await app.post("/api/users/bob/roles").set("Cookie", cookie).send({ roleName: "designer" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.username).toBe("bob");
    // Verify "bob" (not the admin) has the designer role
    const designerRole = db.prepare("SELECT id FROM roles WHERE name = 'designer'").get() as { id: number };
    const bobRow = db.prepare("SELECT * FROM user_roles WHERE username = ? AND role_id = ?").get("bob", designerRole.id);
    expect(bobRow).toBeDefined();
    // Admin caller must NOT have gained a user_roles row (bootstrap admin doesn't need one)
    const adminUsername = (process.env.APP_ADMIN_USERNAME || "admin").toLowerCase();
    const adminRow = db.prepare("SELECT * FROM user_roles WHERE username = ? AND role_id = ?").get(adminUsername, designerRole.id);
    expect(adminRow).toBeUndefined();
  });

  it("returns 404 if role not found", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.post("/api/users/bob/roles").set("Cookie", cookie).send({ roleName: "nonexistent_role" });
    expect(res.status).toBe(404);
  });

  it("returns 400 if roleName missing", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.post("/api/users/bob/roles").set("Cookie", cookie).send({});
    expect(res.status).toBe(400);
  });
});

// ─── DELETE /api/users/:username/roles/:roleName ──────────────────────────────

describe("DELETE /api/users/:username/roles/:roleName (GUARD-V18-04)", () => {
  it("returns 403 PERMISSION_DENIED for non-holder (analyst session)", async () => {
    const app = await buildTestApp();
    const { cookie } = createAnalystSession();
    const res = await app.delete("/api/users/bob/roles/designer").set("Cookie", cookie);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PERMISSION_DENIED");
  });

  it("admin revokes a role (idempotent — 200 even if row didn't exist)", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    // Assign first
    await app.post("/api/users/carol/roles").set("Cookie", cookie).send({ roleName: "analyst" });
    // Then revoke
    const res = await app.delete("/api/users/carol/roles/analyst").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // Verify row is gone
    const analystRole = db.prepare("SELECT id FROM roles WHERE name = 'analyst'").get() as { id: number };
    const carolRow = db.prepare("SELECT * FROM user_roles WHERE username = ? AND role_id = ?").get("carol", analystRole.id);
    expect(carolRow).toBeUndefined();
  });

  it("second DELETE is idempotent (200, not 404)", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    // Revoke a role that was never assigned — should still be 200 (idempotent)
    const res = await app.delete("/api/users/nobody/roles/analyst").set("Cookie", cookie);
    expect(res.status).toBe(200);
  });
});

// ─── DELETE /api/users/:username/roles/admin — SAFE-V18-01 ───────────────────

describe("DELETE /api/users/:username/roles/admin — SAFE-V18-01", () => {
  it("rejects revoking admin from the last non-bootstrap admin (400, verbatim message, row preserved)", async () => {
    const adminRole = db.prepare("SELECT id FROM roles WHERE name = 'admin'").get() as { id: number };
    // Explicitly seed user_roles(admin) for a non-bootstrap username (createAdminSession uses
    // the bootstrap short-circuit and has NO user_roles row — so solo_admin is the only non-bootstrap admin)
    db.prepare("INSERT OR IGNORE INTO user_roles (username, role_id) VALUES (?, ?)").run("solo_admin", adminRole.id);

    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.delete("/api/users/solo_admin/roles/admin").set("Cookie", cookie);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(
      "Cannot revoke: this is the last admin. At least one non-bootstrap user must hold the admin role."
    );
    // Row must NOT be deleted
    const row = db.prepare("SELECT * FROM user_roles WHERE username = ? AND role_id = ?").get("solo_admin", adminRole.id);
    expect(row).toBeDefined();
  });

  it("allows revoking admin when two non-bootstrap admins exist (200, row deleted)", async () => {
    const adminRole = db.prepare("SELECT id FROM roles WHERE name = 'admin'").get() as { id: number };
    db.prepare("INSERT OR IGNORE INTO user_roles (username, role_id) VALUES (?, ?)").run("admin_a", adminRole.id);
    db.prepare("INSERT OR IGNORE INTO user_roles (username, role_id) VALUES (?, ?)").run("admin_b", adminRole.id);

    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.delete("/api/users/admin_a/roles/admin").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // admin_a row should be gone
    const goneRow = db.prepare("SELECT * FROM user_roles WHERE username = ? AND role_id = ?").get("admin_a", adminRole.id);
    expect(goneRow).toBeUndefined();
    // admin_b row must remain
    const remainRow = db.prepare("SELECT * FROM user_roles WHERE username = ? AND role_id = ?").get("admin_b", adminRole.id);
    expect(remainRow).toBeDefined();
  });

  it("does not engage for a non-admin role (designer revoke succeeds even as sole holder)", async () => {
    const designerRole = db.prepare("SELECT id FROM roles WHERE name = 'designer'").get() as { id: number };
    db.prepare("INSERT OR IGNORE INTO user_roles (username, role_id) VALUES (?, ?)").run("lonely_designer", designerRole.id);

    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.delete("/api/users/lonely_designer/roles/designer").set("Cookie", cookie);
    expect(res.status).toBe(200);
  });

  it("does not engage when target does not currently hold admin (idempotent 200)", async () => {
    // ghost has no user_roles row at all — revoking admin should return 200 (idempotent)
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.delete("/api/users/ghost/roles/admin").set("Cookie", cookie);
    expect(res.status).toBe(200);
  });

  it("bootstrap admin is not counted — sole non-bootstrap admin + explicit bootstrap row still blocks", async () => {
    const adminRole = db.prepare("SELECT id FROM roles WHERE name = 'admin'").get() as { id: number };
    const bootstrapName = (process.env.APP_ADMIN_USERNAME || "admin").toLowerCase();
    // Insert explicit user_roles row for bootstrap (even though it normally uses short-circuit)
    db.prepare("INSERT OR IGNORE INTO user_roles (username, role_id) VALUES (?, ?)").run(bootstrapName, adminRole.id);
    // Also insert real_admin as the sole non-bootstrap admin
    db.prepare("INSERT OR IGNORE INTO user_roles (username, role_id) VALUES (?, ?)").run("real_admin", adminRole.id);

    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.delete("/api/users/real_admin/roles/admin").set("Cookie", cookie);
    // Bootstrap is excluded from the count — real_admin is still the last non-bootstrap admin
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(
      "Cannot revoke: this is the last admin. At least one non-bootstrap user must hold the admin role."
    );
  });
});

// ─── GET /api/roles ───────────────────────────────────────────────────────────

describe("GET /api/roles (GUARD-V18-04)", () => {
  it("returns 403 PERMISSION_DENIED for non-holder (analyst session)", async () => {
    const app = await buildTestApp();
    const { cookie } = createAnalystSession();
    const res = await app.get("/api/roles").set("Cookie", cookie);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PERMISSION_DENIED");
  });

  it("admin session returns 200 with roles array including built-in roles", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.get("/api/roles").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.roles)).toBe(true);
    // All 4 built-in roles must be present
    const names = (res.body.roles as Array<{ name: string }>).map((r) => r.name);
    expect(names).toContain("admin");
    expect(names).toContain("analyst");
    expect(names).toContain("designer");
    expect(names).toContain("user_admin");
  });

  it("each role has id, name, description, built_in, permissions fields", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.get("/api/roles").set("Cookie", cookie);
    const roles = res.body.roles as Array<{ id: number; name: string; description: string; built_in: boolean; permissions: string[] }>;
    for (const role of roles) {
      expect(typeof role.id).toBe("number");
      expect(typeof role.name).toBe("string");
      expect(typeof role.description).toBe("string");
      expect(typeof role.built_in).toBe("boolean");
      expect(Array.isArray(role.permissions)).toBe(true);
    }
  });
});

// ─── POST /api/roles ──────────────────────────────────────────────────────────

describe("POST /api/roles (GUARD-V18-04)", () => {
  it("returns 403 PERMISSION_DENIED for non-holder (analyst session)", async () => {
    const app = await buildTestApp();
    const { cookie } = createAnalystSession();
    const res = await app.post("/api/roles").set("Cookie", cookie).send({ name: "test", permissions: [] });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PERMISSION_DENIED");
  });

  it("admin creates a custom role with 201 response", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.post("/api/roles").set("Cookie", cookie).send({
      name: "custom_role_test",
      description: "test custom role",
      permissions: ["dashboards:view"],
    });
    expect(res.status).toBe(201);
    expect(res.body.role.name).toBe("custom_role_test");
    expect(res.body.role.built_in).toBe(false);
    expect(res.body.role.permissions).toContain("dashboards:view");
  });

  it("returns 409 if role name already exists", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    await app.post("/api/roles").set("Cookie", cookie).send({ name: "duplicate_role", permissions: [] });
    const res2 = await app.post("/api/roles").set("Cookie", cookie).send({ name: "duplicate_role", permissions: [] });
    expect(res2.status).toBe(409);
  });
});

// ─── PUT /api/roles/:id/permissions ──────────────────────────────────────────

describe("PUT /api/roles/:id/permissions (GUARD-V18-04)", () => {
  it("returns 403 PERMISSION_DENIED for non-holder (analyst session)", async () => {
    const app = await buildTestApp();
    const { cookie } = createAnalystSession();
    const analystRole = db.prepare("SELECT id FROM roles WHERE name = 'analyst'").get() as { id: number };
    const res = await app.put(`/api/roles/${analystRole.id}/permissions`).set("Cookie", cookie).send({ permissions: [] });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PERMISSION_DENIED");
  });

  it("admin replaces a role's permission set", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    // Create a custom role to modify
    const createRes = await app.post("/api/roles").set("Cookie", cookie).send({
      name: "perm_test_role",
      permissions: ["dashboards:view"],
    });
    const roleId = createRes.body.role.id;
    const res = await app.put(`/api/roles/${roleId}/permissions`).set("Cookie", cookie).send({
      permissions: ["dashboards:view", "dashboards:create"],
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.permissions).toContain("dashboards:create");
  });

  it("returns 400 for unknown permission string", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const analystRole = db.prepare("SELECT id FROM roles WHERE name = 'analyst'").get() as { id: number };
    const res = await app.put(`/api/roles/${analystRole.id}/permissions`).set("Cookie", cookie).send({
      permissions: ["unknown:permission_that_does_not_exist"],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown permissions/);
  });

  it("returns 404 for non-existent role id", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.put("/api/roles/99999/permissions").set("Cookie", cookie).send({ permissions: [] });
    expect(res.status).toBe(404);
  });
});

// ─── DELETE /api/roles/:id ────────────────────────────────────────────────────

describe("DELETE /api/roles/:id (GUARD-V18-04)", () => {
  it("returns 403 PERMISSION_DENIED for non-holder (analyst session)", async () => {
    const app = await buildTestApp();
    const { cookie } = createAnalystSession();
    const analystRole = db.prepare("SELECT id FROM roles WHERE name = 'analyst'").get() as { id: number };
    const res = await app.delete(`/api/roles/${analystRole.id}`).set("Cookie", cookie);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PERMISSION_DENIED");
  });

  it("admin deletes a custom role successfully", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    // Create a custom role first
    const createRes = await app.post("/api/roles").set("Cookie", cookie).send({
      name: "deletable_role",
      permissions: [],
    });
    const roleId = createRes.body.role.id;
    const res = await app.delete(`/api/roles/${roleId}`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // Verify it's gone
    const gone = db.prepare("SELECT id FROM roles WHERE id = ?").get(roleId);
    expect(gone).toBeUndefined();
  });

  it("returns 400 when trying to delete a built-in role", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const analystRole = db.prepare("SELECT id FROM roles WHERE name = 'analyst'").get() as { id: number };
    const res = await app.delete(`/api/roles/${analystRole.id}`).set("Cookie", cookie);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/built-in/);
  });

  it("returns 404 for non-existent role id", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.delete("/api/roles/99999").set("Cookie", cookie);
    expect(res.status).toBe(404);
  });
});

// ─── createUserAdminSession helper ───────────────────────────────────────────

/**
 * Creates a session cookie for a non-admin user with the user_admin role.
 * Seeds an explicit user_roles row so getEffectiveRoles returns ["user_admin"].
 * user_admin holds: users:view, users:assign_roles, roles:view,
 * roles:manage_permissions, roles:create_custom, dashboards:view.
 * Crucially does NOT hold roles:delete_custom (Guard 3 unheld example).
 */
const createUserAdminSession = (username = "test_user_admin") => {
  const role = db.prepare("SELECT id FROM roles WHERE name = 'user_admin'").get() as { id: number } | undefined;
  if (role) {
    db.prepare("INSERT OR IGNORE INTO user_roles (username, role_id) VALUES (lower(?), ?)").run(username, role.id);
  }
  const sid = createSession({ username, secret: "useradmin-test-secret", kineticaUrl: KINETICA_URL });
  const token = jwt.sign({ sub: username, sid, v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
  return { cookie: `kbi_session=${token}` };
};

// ─── SAFE-V18-02: Guard 1 — assign-admin escalation ──────────────────────────

describe("SAFE-V18-02 Guard 1 — assign-admin escalation", () => {
  it("user_admin caller assigning admin role → 403 with escalation error", async () => {
    const app = await buildTestApp();
    const { cookie } = createUserAdminSession();
    const res = await app.post("/api/users/bob/roles").set("Cookie", cookie).send({ roleName: "admin" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Only admins can assign the admin role.");
  });

  it("user_admin caller assigning a non-admin role (designer) → 200 (passes Guard 1)", async () => {
    const app = await buildTestApp();
    const { cookie } = createUserAdminSession();
    const res = await app.post("/api/users/bob/roles").set("Cookie", cookie).send({ roleName: "designer" });
    expect(res.status).toBe(200);
  });

  it("bootstrap admin caller assigning admin role → 200 (passes Guard 1)", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.post("/api/users/bob/roles").set("Cookie", cookie).send({ roleName: "admin" });
    expect(res.status).toBe(200);
  });

  it("explicit admin-role holder assigning admin role → 200 (passes Guard 1)", async () => {
    // Seed an explicit user with the admin role.
    // Session is created AFTER buildTestApp() to avoid auth_mode_change_wipe deleting it.
    const adminRole = db.prepare("SELECT id FROM roles WHERE name = 'admin'").get() as { id: number };
    db.prepare("INSERT OR IGNORE INTO user_roles (username, role_id) VALUES (?, ?)").run("explicit_admin", adminRole.id);

    const app = await buildTestApp();

    const sid = createSession({ username: "explicit_admin", secret: "explicit-secret", kineticaUrl: KINETICA_URL });
    const token = jwt.sign({ sub: "explicit_admin", sid, v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
    const cookie = `kbi_session=${token}`;

    const res = await app.post("/api/users/target_user/roles").set("Cookie", cookie).send({ roleName: "admin" });
    expect(res.status).toBe(200);
  });
});

// ─── SAFE-V18-02: Guard 2 — modify-admin-role escalation ─────────────────────

describe("SAFE-V18-02 Guard 2 — modify-admin-role escalation", () => {
  it("user_admin caller modifying admin role permissions → 403 with escalation error", async () => {
    const app = await buildTestApp();
    const { cookie } = createUserAdminSession();
    const adminRole = db.prepare("SELECT id FROM roles WHERE name = 'admin'").get() as { id: number };
    const res = await app.put(`/api/roles/${adminRole.id}/permissions`).set("Cookie", cookie).send({
      permissions: ["dashboards:view"],
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Only admins can modify the admin role.");
  });

  it("user_admin caller modifying a non-admin built-in role (analyst) → not blocked by Guard 2", async () => {
    const app = await buildTestApp();
    const { cookie } = createUserAdminSession();
    const analystRole = db.prepare("SELECT id FROM roles WHERE name = 'analyst'").get() as { id: number };
    // Guard 2 passes; Guard 3 also passes (dashboards:view is held by user_admin)
    const res = await app.put(`/api/roles/${analystRole.id}/permissions`).set("Cookie", cookie).send({
      permissions: ["dashboards:view"],
    });
    expect(res.status).toBe(200);
  });

  it("bootstrap admin caller modifying admin role → 200 (passes Guard 2)", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const adminRole = db.prepare("SELECT id FROM roles WHERE name = 'admin'").get() as { id: number };
    const res = await app.put(`/api/roles/${adminRole.id}/permissions`).set("Cookie", cookie).send({
      permissions: ["dashboards:view"],
    });
    expect(res.status).toBe(200);
  });
});

// ─── SAFE-V18-02: Guard 3 — grant-unheld-permission escalation ───────────────

describe("SAFE-V18-02 Guard 3 — grant-unheld-permission escalation", () => {
  it("unknown permission string → 400 catalog check BEFORE Guard 3 403", async () => {
    const app = await buildTestApp();
    const { cookie } = createUserAdminSession();
    // Create a custom role to operate on
    const adminCookie = createAdminSession().cookie;
    const createRes = await app.post("/api/roles").set("Cookie", adminCookie).send({
      name: "guard3_test_role",
      permissions: [],
    });
    const roleId = createRes.body.role.id;

    const res = await app.put(`/api/roles/${roleId}/permissions`).set("Cookie", cookie).send({
      permissions: ["totally_invalid:perm_that_does_not_exist"],
    });
    // Catalog check fires at 400 BEFORE the 403 escalation guard
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown permissions/);
  });

  it("user_admin granting roles:delete_custom (unheld) → 403 naming the permission", async () => {
    const app = await buildTestApp();
    const { cookie } = createUserAdminSession();
    // Create a custom role so we can PUT its permissions
    const adminCookie = createAdminSession().cookie;
    const createRes = await app.post("/api/roles").set("Cookie", adminCookie).send({
      name: "guard3_unheld_test",
      permissions: [],
    });
    const roleId = createRes.body.role.id;

    // roles:delete_custom is NOT held by user_admin
    const res = await app.put(`/api/roles/${roleId}/permissions`).set("Cookie", cookie).send({
      permissions: ["roles:delete_custom"],
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain("roles:delete_custom");
    expect(res.body.error).toContain("Cannot grant permissions you do not hold");
  });

  it("user_admin granting dashboards:view (held) on a custom role → 200", async () => {
    const app = await buildTestApp();
    const { cookie } = createUserAdminSession();
    const adminCookie = createAdminSession().cookie;
    const createRes = await app.post("/api/roles").set("Cookie", adminCookie).send({
      name: "guard3_held_test",
      permissions: [],
    });
    const roleId = createRes.body.role.id;

    // dashboards:view IS held by user_admin
    const res = await app.put(`/api/roles/${roleId}/permissions`).set("Cookie", cookie).send({
      permissions: ["dashboards:view"],
    });
    expect(res.status).toBe(200);
  });

  it("bootstrap admin granting any permission → 200 (passes Guard 3)", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const createRes = await app.post("/api/roles").set("Cookie", cookie).send({
      name: "guard3_admin_test",
      permissions: [],
    });
    const roleId = createRes.body.role.id;

    // admin can grant any permission
    const res = await app.put(`/api/roles/${roleId}/permissions`).set("Cookie", cookie).send({
      permissions: ["roles:delete_custom", "dashboards:create"],
    });
    expect(res.status).toBe(200);
  });
});

// ─── ROLES-V18-04: Held-role delete block ─────────────────────────────────────

describe("ROLES-V18-04 held-role delete block", () => {
  it("deleting a custom role with an active holder → 409 naming count", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    // Create a custom role
    const createRes = await app.post("/api/roles").set("Cookie", cookie).send({
      name: "held_custom_role",
      permissions: [],
    });
    const roleId = createRes.body.role.id as number;

    // Assign a user to the role so it has a holder
    db.prepare("INSERT OR IGNORE INTO user_roles (username, role_id) VALUES (?, ?)").run("holder_user", roleId);

    const res = await app.delete(`/api/roles/${roleId}`).set("Cookie", cookie);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Cannot delete/);
    expect(res.body.error).toMatch(/1 user\(s\)/);
  });

  it("deleting a custom role with no holders → 200", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const createRes = await app.post("/api/roles").set("Cookie", cookie).send({
      name: "unheld_custom_role",
      permissions: [],
    });
    const roleId = createRes.body.role.id as number;
    // No holders seeded

    const res = await app.delete(`/api/roles/${roleId}`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("built-in role delete still → 400 (built-in check fires before holder check)", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const analystRole = db.prepare("SELECT id FROM roles WHERE name = 'analyst'").get() as { id: number };
    const res = await app.delete(`/api/roles/${analystRole.id}`).set("Cookie", cookie);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/built-in/);
  });
});

// ─── ROLES-V18-03: POST /api/roles slug validation ───────────────────────────

describe("ROLES-V18-03 POST /api/roles slug validation", () => {
  it("uppercase name → 400 slug error", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.post("/api/roles").set("Cookie", cookie).send({ name: "MyRole", permissions: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/lowercase slug/);
  });

  it("name with space → 400 slug error", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.post("/api/roles").set("Cookie", cookie).send({ name: "my role", permissions: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/lowercase slug/);
  });

  it("name with hyphen → 400 slug error", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.post("/api/roles").set("Cookie", cookie).send({ name: "my-role", permissions: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/lowercase slug/);
  });

  it("reserved built-in name 'admin' → 400 reservation error", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.post("/api/roles").set("Cookie", cookie).send({ name: "admin", permissions: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reserved/);
  });

  it("reserved built-in name 'analyst' → 400 reservation error", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.post("/api/roles").set("Cookie", cookie).send({ name: "analyst", permissions: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reserved/);
  });

  it("case-insensitive duplicate of existing custom role → 409", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    // Create the original (lowercase slug passes validation)
    await app.post("/api/roles").set("Cookie", cookie).send({ name: "my_custom_role", permissions: [] });
    // Attempt to create the same name again (case-insensitive match)
    const res = await app.post("/api/roles").set("Cookie", cookie).send({ name: "my_custom_role", permissions: [] });
    expect(res.status).toBe(409);
  });

  it("valid lowercase slug name → 201", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.post("/api/roles").set("Cookie", cookie).send({ name: "valid_slug_123", permissions: [] });
    expect(res.status).toBe(201);
    expect(res.body.role.name).toBe("valid_slug_123");
  });
});

// ─── AUDIT-V18-01: rbac_audit emission assertions ────────────────────────────

// Helper to get the latest rbac_audit row
const getLatestAuditRow = () =>
  db.prepare("SELECT * FROM rbac_audit ORDER BY id DESC LIMIT 1").get() as {
    id: number;
    ts: string;
    actor: string;
    action: string;
    target: string;
    before_json: string | null;
    after_json: string | null;
  } | undefined;

const getAuditCount = () =>
  (db.prepare("SELECT COUNT(*) AS c FROM rbac_audit").get() as { c: number }).c;

describe("AUDIT-V18-01 role_assigned audit emission", () => {
  it("successful POST /api/users/:username/roles inserts one rbac_audit row", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const adminUsername = (process.env.APP_ADMIN_USERNAME || "admin").toLowerCase();

    const countBefore = getAuditCount();
    const res = await app.post("/api/users/audit_target/roles").set("Cookie", cookie).send({ roleName: "designer" });
    expect(res.status).toBe(200);

    expect(getAuditCount()).toBe(countBefore + 1);
    const row = getLatestAuditRow();
    expect(row).toBeDefined();
    expect(row!.action).toBe("role_assigned");
    expect(row!.actor).toBe(adminUsername);
    expect(row!.target).toBe("audit_target");
    expect(typeof row!.ts).toBe("string");
    // before_json and after_json should be JSON arrays of role names
    const before = JSON.parse(row!.before_json ?? "null");
    const after = JSON.parse(row!.after_json ?? "null");
    expect(Array.isArray(before)).toBe(true);
    expect(Array.isArray(after)).toBe(true);
    expect(after).toContain("designer");
  });

  it("no audit row written when assign is rejected (Guard 1 403)", async () => {
    const app = await buildTestApp();
    const { cookie } = createUserAdminSession("audit_useradmin");

    const countBefore = getAuditCount();
    const res = await app.post("/api/users/bob/roles").set("Cookie", cookie).send({ roleName: "admin" });
    expect(res.status).toBe(403);
    // No row written on rejection
    expect(getAuditCount()).toBe(countBefore);
  });
});

describe("AUDIT-V18-01 role_revoked audit emission", () => {
  it("successful DELETE /api/users/:username/roles/:roleName inserts one rbac_audit row", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const adminUsername = (process.env.APP_ADMIN_USERNAME || "admin").toLowerCase();

    // Assign first, then revoke
    await app.post("/api/users/revoke_target/roles").set("Cookie", cookie).send({ roleName: "designer" });

    const countBefore = getAuditCount();
    const res = await app.delete("/api/users/revoke_target/roles/designer").set("Cookie", cookie);
    expect(res.status).toBe(200);

    expect(getAuditCount()).toBe(countBefore + 1);
    const row = getLatestAuditRow();
    expect(row).toBeDefined();
    expect(row!.action).toBe("role_revoked");
    expect(row!.actor).toBe(adminUsername);
    expect(row!.target).toBe("revoke_target");
    const before = JSON.parse(row!.before_json ?? "null");
    const after = JSON.parse(row!.after_json ?? "null");
    expect(Array.isArray(before)).toBe(true);
    expect(Array.isArray(after)).toBe(true);
    expect(before).toContain("designer");
    expect(after).not.toContain("designer");
  });

  it("no audit row written when revoke is blocked (SAFE-V18-01 400)", async () => {
    const adminRole = db.prepare("SELECT id FROM roles WHERE name = 'admin'").get() as { id: number };
    db.prepare("INSERT OR IGNORE INTO user_roles (username, role_id) VALUES (?, ?)").run("solo_audit_admin", adminRole.id);

    const app = await buildTestApp();
    const { cookie } = createAdminSession();

    const countBefore = getAuditCount();
    const res = await app.delete("/api/users/solo_audit_admin/roles/admin").set("Cookie", cookie);
    expect(res.status).toBe(400);
    expect(getAuditCount()).toBe(countBefore);
  });
});

describe("AUDIT-V18-01 mappings_updated audit emission", () => {
  it("successful PUT /api/roles/:id/permissions inserts one rbac_audit row", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const adminUsername = (process.env.APP_ADMIN_USERNAME || "admin").toLowerCase();

    // Create a custom role
    const createRes = await app.post("/api/roles").set("Cookie", cookie).send({
      name: "audit_perm_role",
      permissions: ["dashboards:view"],
    });
    const roleId = createRes.body.role.id;

    const countBefore = getAuditCount();
    const res = await app.put(`/api/roles/${roleId}/permissions`).set("Cookie", cookie).send({
      permissions: ["dashboards:view", "dashboards:create"],
    });
    expect(res.status).toBe(200);

    expect(getAuditCount()).toBe(countBefore + 1);
    const row = getLatestAuditRow();
    expect(row).toBeDefined();
    expect(row!.action).toBe("mappings_updated");
    expect(row!.actor).toBe(adminUsername);
    expect(row!.target).toBe("audit_perm_role");
    // before_json captured BEFORE the mutation — should include the original permission
    const before = JSON.parse(row!.before_json ?? "null");
    const after = JSON.parse(row!.after_json ?? "null");
    expect(Array.isArray(before)).toBe(true);
    expect(Array.isArray(after)).toBe(true);
    expect(before).toContain("dashboards:view");
    expect(after).toContain("dashboards:create");
  });

  it("no audit row written when PUT is rejected (Guard 2 403 — admin role)", async () => {
    const app = await buildTestApp();
    const { cookie } = createUserAdminSession("audit_ua2");
    const adminRole = db.prepare("SELECT id FROM roles WHERE name = 'admin'").get() as { id: number };

    const countBefore = getAuditCount();
    const res = await app.put(`/api/roles/${adminRole.id}/permissions`).set("Cookie", cookie).send({
      permissions: ["dashboards:view"],
    });
    expect(res.status).toBe(403);
    expect(getAuditCount()).toBe(countBefore);
  });
});

describe("AUDIT-V18-01 role_created audit emission", () => {
  it("successful POST /api/roles inserts one rbac_audit row", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const adminUsername = (process.env.APP_ADMIN_USERNAME || "admin").toLowerCase();

    const countBefore = getAuditCount();
    const res = await app.post("/api/roles").set("Cookie", cookie).send({
      name: "audit_created_role",
      permissions: ["dashboards:view"],
    });
    expect(res.status).toBe(201);

    expect(getAuditCount()).toBe(countBefore + 1);
    const row = getLatestAuditRow();
    expect(row).toBeDefined();
    expect(row!.action).toBe("role_created");
    expect(row!.actor).toBe(adminUsername);
    expect(row!.target).toBe("audit_created_role");
    expect(row!.before_json).toBeNull();
    const after = JSON.parse(row!.after_json ?? "null");
    expect(Array.isArray(after)).toBe(true);
    expect(after).toContain("dashboards:view");
  });

  it("no audit row written when POST /api/roles is rejected (slug validation 400)", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();

    const countBefore = getAuditCount();
    const res = await app.post("/api/roles").set("Cookie", cookie).send({
      name: "BadSlug!",
      permissions: [],
    });
    expect(res.status).toBe(400);
    expect(getAuditCount()).toBe(countBefore);
  });
});

describe("AUDIT-V18-01 role_deleted audit emission", () => {
  it("successful DELETE /api/roles/:id inserts one rbac_audit row", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const adminUsername = (process.env.APP_ADMIN_USERNAME || "admin").toLowerCase();

    // Create a custom role with a permission, then delete it
    const createRes = await app.post("/api/roles").set("Cookie", cookie).send({
      name: "audit_delete_role",
      permissions: ["dashboards:view"],
    });
    const roleId = createRes.body.role.id;

    const countBefore = getAuditCount();
    const res = await app.delete(`/api/roles/${roleId}`).set("Cookie", cookie);
    expect(res.status).toBe(200);

    expect(getAuditCount()).toBe(countBefore + 1);
    const row = getLatestAuditRow();
    expect(row).toBeDefined();
    expect(row!.action).toBe("role_deleted");
    expect(row!.actor).toBe(adminUsername);
    expect(row!.target).toBe("audit_delete_role");
    // before_json captured BEFORE the delete — should include the role's permissions
    const before = JSON.parse(row!.before_json ?? "null");
    expect(Array.isArray(before)).toBe(true);
    expect(before).toContain("dashboards:view");
    expect(row!.after_json).toBeNull();
  });

  it("no audit row written when DELETE /api/roles/:id is rejected (holder 409)", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();

    // Create a custom role with a holder
    const createRes = await app.post("/api/roles").set("Cookie", cookie).send({
      name: "audit_held_role",
      permissions: [],
    });
    const roleId = createRes.body.role.id as number;
    db.prepare("INSERT OR IGNORE INTO user_roles (username, role_id) VALUES (?, ?)").run("held_by_user", roleId);

    const countBefore = getAuditCount();
    const res = await app.delete(`/api/roles/${roleId}`).set("Cookie", cookie);
    expect(res.status).toBe(409);
    expect(getAuditCount()).toBe(countBefore);
  });
});
