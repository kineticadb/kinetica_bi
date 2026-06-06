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
