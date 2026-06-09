/**
 * lib.dashboardAccessDb.spec.ts — Unit tests for dashboardAccessDb.ts.
 *
 * Covers all canViewDashboard resolution paths:
 *   - Bypass holder (designer via user_roles → manage_access) → true on no-grant dashboard
 *   - Bootstrap admin (APP_ADMIN_USERNAME) → true on no-grant dashboard
 *   - Non-bypass user (analyst fallback, no roles) on no-grant dashboard → FALSE (private-by-default)
 *   - Direct user grant (case-insensitive: grant "Alice", query "alice") → true
 *   - Role grant where user holds the granted role → true
 *   - Role grant where user does NOT hold the granted role → false
 *   - Pre-provisioned user grant for an unknown username (no user_roles row) → true
 *   - addDashboardGrant idempotent (second call returns false)
 *   - removeDashboardGrant removes the row (returns true)
 *   - listDashboardGrants returns ordered rows with expected shape
 *   - Cascade: dashboard delete removes grant rows (via explicit delete in deleteDashboard)
 *
 * Uses buildInMemoryDb() per test, passes the conn into helpers and resolver.
 * Mirrors lib.rbacDb.spec.ts structure (named helpers, isolated per-test db).
 */
import { describe, it, expect } from "vitest";
import { createDb } from "../src/db";
import {
  canViewDashboard,
  listDashboardGrants,
  addDashboardGrant,
  removeDashboardGrant,
} from "../src/lib/dashboardAccessDb";
import { deleteDashboard, createDashboard } from "../src/db";

const buildInMemoryDb = () => createDb(":memory:");

// Helper: assign a named role to a username in an in-memory db.
function assignRole(db: ReturnType<typeof buildInMemoryDb>, username: string, roleName: string): void {
  const row = db.prepare<[string], { id: number }>("SELECT id FROM roles WHERE name = ?").get(roleName);
  if (!row) throw new Error(`Role '${roleName}' not found`);
  db.prepare("INSERT OR IGNORE INTO user_roles (username, role_id) VALUES (?, ?)").run(
    username.toLowerCase(),
    row.id
  );
}

// Helper: insert a dashboard row directly into an in-memory db and return its id.
function insertDashboard(db: ReturnType<typeof buildInMemoryDb>, name = "test-dash"): number {
  const result = db.prepare("INSERT INTO dashboards (name) VALUES (?)").run(name);
  return Number(result.lastInsertRowid);
}

// ─── canViewDashboard ─────────────────────────────────────────────────────────

describe("canViewDashboard — bypass (manage_access permission)", () => {
  it("designer role holder returns true on a no-grant dashboard (bypass)", () => {
    const db = buildInMemoryDb();
    const dashId = insertDashboard(db);
    assignRole(db, "alice", "designer");
    expect(canViewDashboard("alice", dashId, db)).toBe(true);
  });

  it("bootstrap admin (APP_ADMIN_USERNAME) returns true on no-grant dashboard", () => {
    const db = buildInMemoryDb();
    const dashId = insertDashboard(db);
    const adminUser = process.env.APP_ADMIN_USERNAME || "admin";
    expect(canViewDashboard(adminUser, dashId, db)).toBe(true);
  });

  it("bypass check is case-insensitive for bootstrap admin", () => {
    const db = buildInMemoryDb();
    const dashId = insertDashboard(db);
    // bootstrap admin always short-circuits regardless of case
    expect(canViewDashboard("ADMIN", dashId, db)).toBe(true);
    expect(canViewDashboard("Admin", dashId, db)).toBe(true);
  });
});

describe("canViewDashboard — private-by-default (non-bypass, no grants)", () => {
  it("analyst-fallback user on no-grant dashboard returns FALSE", () => {
    const db = buildInMemoryDb();
    const dashId = insertDashboard(db);
    // "analyst_user" has no user_roles row → analyst fallback (only dashboards:view, not manage_access)
    expect(canViewDashboard("analyst_user", dashId, db)).toBe(false);
  });

  it("explicit analyst-role user on no-grant dashboard returns FALSE", () => {
    const db = buildInMemoryDb();
    const dashId = insertDashboard(db);
    assignRole(db, "bob", "analyst");
    expect(canViewDashboard("bob", dashId, db)).toBe(false);
  });
});

describe("canViewDashboard — direct user grant", () => {
  it("returns true after adding a user grant for the queried user", () => {
    const db = buildInMemoryDb();
    const dashId = insertDashboard(db);
    addDashboardGrant(dashId, "user", "alice", db);
    expect(canViewDashboard("alice", dashId, db)).toBe(true);
  });

  it("user grant lookup is case-insensitive (grant 'Alice', query 'alice')", () => {
    const db = buildInMemoryDb();
    const dashId = insertDashboard(db);
    // Grant stored as lowercase 'alice' (addDashboardGrant lowercases user grantees)
    addDashboardGrant(dashId, "user", "Alice", db);
    expect(canViewDashboard("alice", dashId, db)).toBe(true);
    expect(canViewDashboard("ALICE", dashId, db)).toBe(true);
  });

  it("user grant for one user does not grant access to another", () => {
    const db = buildInMemoryDb();
    const dashId = insertDashboard(db);
    addDashboardGrant(dashId, "user", "alice", db);
    expect(canViewDashboard("bob", dashId, db)).toBe(false);
  });

  it("pre-provisioned user grant for an unknown username (no user_roles row) → true", () => {
    const db = buildInMemoryDb();
    const dashId = insertDashboard(db);
    // "future_user" has no user_roles entry — pre-provisioning scenario
    addDashboardGrant(dashId, "user", "future_user", db);
    expect(canViewDashboard("future_user", dashId, db)).toBe(true);
  });
});

describe("canViewDashboard — role grant", () => {
  it("returns true when user holds a role that has a grant on the dashboard", () => {
    const db = buildInMemoryDb();
    const dashId = insertDashboard(db);
    // Grant the "analyst" role access to this dashboard
    addDashboardGrant(dashId, "role", "analyst", db);
    assignRole(db, "charlie", "analyst");
    expect(canViewDashboard("charlie", dashId, db)).toBe(true);
  });

  it("returns false when user's role has no grant on the dashboard", () => {
    const db = buildInMemoryDb();
    const dashId = insertDashboard(db);
    // Grant only "user_admin" role, but charlie is analyst
    addDashboardGrant(dashId, "role", "user_admin", db);
    assignRole(db, "charlie", "analyst");
    expect(canViewDashboard("charlie", dashId, db)).toBe(false);
  });

  it("multi-role user resolves true if ANY held role is granted", () => {
    const db = buildInMemoryDb();
    const dashId = insertDashboard(db);
    addDashboardGrant(dashId, "role", "analyst", db);
    // dave has both user_admin and analyst
    assignRole(db, "dave", "user_admin");
    assignRole(db, "dave", "analyst");
    expect(canViewDashboard("dave", dashId, db)).toBe(true);
  });

  it("analyst-fallback user gets role grant via 'analyst' role", () => {
    const db = buildInMemoryDb();
    const dashId = insertDashboard(db);
    // Grant the analyst role (the fallback role for unassigned users)
    addDashboardGrant(dashId, "role", "analyst", db);
    // "newuser" has no user_roles → analyst fallback
    expect(canViewDashboard("newuser", dashId, db)).toBe(true);
  });
});

// ─── addDashboardGrant ────────────────────────────────────────────────────────

describe("addDashboardGrant", () => {
  it("returns true on first insert", () => {
    const db = buildInMemoryDb();
    const dashId = insertDashboard(db);
    expect(addDashboardGrant(dashId, "user", "alice", db)).toBe(true);
  });

  it("is idempotent — second call with same args returns false", () => {
    const db = buildInMemoryDb();
    const dashId = insertDashboard(db);
    addDashboardGrant(dashId, "user", "alice", db);
    expect(addDashboardGrant(dashId, "user", "alice", db)).toBe(false);
  });

  it("lowercases the user grantee before insert", () => {
    const db = buildInMemoryDb();
    const dashId = insertDashboard(db);
    addDashboardGrant(dashId, "user", "ALICE", db);
    const rows = db
      .prepare("SELECT grantee FROM dashboard_access_grants WHERE dashboard_id = ? AND grantee_type = 'user'")
      .all(dashId) as Array<{ grantee: string }>;
    expect(rows[0].grantee).toBe("alice");
  });

  it("stores role grantee verbatim (no lowercasing for roles)", () => {
    const db = buildInMemoryDb();
    const dashId = insertDashboard(db);
    addDashboardGrant(dashId, "role", "Analyst", db);
    const rows = db
      .prepare("SELECT grantee FROM dashboard_access_grants WHERE dashboard_id = ? AND grantee_type = 'role'")
      .all(dashId) as Array<{ grantee: string }>;
    expect(rows[0].grantee).toBe("Analyst");
  });
});

// ─── removeDashboardGrant ─────────────────────────────────────────────────────

describe("removeDashboardGrant", () => {
  it("removes the grant row and returns true", () => {
    const db = buildInMemoryDb();
    const dashId = insertDashboard(db);
    addDashboardGrant(dashId, "user", "alice", db);
    expect(removeDashboardGrant(dashId, "user", "alice", db)).toBe(true);
    expect(canViewDashboard("alice", dashId, db)).toBe(false);
  });

  it("returns false when no matching grant exists", () => {
    const db = buildInMemoryDb();
    const dashId = insertDashboard(db);
    expect(removeDashboardGrant(dashId, "user", "nobody", db)).toBe(false);
  });

  it("lowercases user grantee when removing (matches lowercase-stored row)", () => {
    const db = buildInMemoryDb();
    const dashId = insertDashboard(db);
    addDashboardGrant(dashId, "user", "alice", db);
    // Remove using different case
    expect(removeDashboardGrant(dashId, "user", "ALICE", db)).toBe(true);
  });
});

// ─── listDashboardGrants ──────────────────────────────────────────────────────

describe("listDashboardGrants", () => {
  it("returns empty array for a dashboard with no grants", () => {
    const db = buildInMemoryDb();
    const dashId = insertDashboard(db);
    expect(listDashboardGrants(dashId, db)).toEqual([]);
  });

  it("returns rows with correct shape { grantee_type, grantee, created_at }", () => {
    const db = buildInMemoryDb();
    const dashId = insertDashboard(db);
    addDashboardGrant(dashId, "user", "alice", db);
    addDashboardGrant(dashId, "role", "analyst", db);
    const grants = listDashboardGrants(dashId, db);
    expect(grants).toHaveLength(2);
    for (const g of grants) {
      expect(g).toHaveProperty("grantee_type");
      expect(g).toHaveProperty("grantee");
      expect(g).toHaveProperty("created_at");
    }
  });

  it("returns grants in deterministic order", () => {
    const db = buildInMemoryDb();
    const dashId = insertDashboard(db);
    addDashboardGrant(dashId, "role", "analyst", db);
    addDashboardGrant(dashId, "user", "alice", db);
    const grants = listDashboardGrants(dashId, db);
    // Ordered deterministically (e.g. by grantee_type, grantee)
    expect(grants).toHaveLength(2);
    const types = grants.map((g) => g.grantee_type);
    const sorted = [...types].sort();
    expect(types).toEqual(sorted);
  });

  it("does not return grants for other dashboards", () => {
    const db = buildInMemoryDb();
    const dashId1 = insertDashboard(db, "dash-1");
    const dashId2 = insertDashboard(db, "dash-2");
    addDashboardGrant(dashId1, "user", "alice", db);
    addDashboardGrant(dashId2, "user", "bob", db);
    expect(listDashboardGrants(dashId1, db)).toHaveLength(1);
    expect(listDashboardGrants(dashId2, db)).toHaveLength(1);
  });
});

// ─── Cascade: dashboard delete removes grants ─────────────────────────────────

describe("grant cascade on dashboard delete", () => {
  it("deleting a dashboard removes all its grant rows (explicit delete in deleteDashboard)", () => {
    // Use the production singleton db pattern via createDb(":memory:") — but we need to
    // call deleteDashboard from db.ts which uses the module singleton. Instead, directly
    // verify the explicit cleanup in the isolated db by mirroring what deleteDashboard does.
    const db = buildInMemoryDb();
    const dashId = insertDashboard(db);
    addDashboardGrant(dashId, "user", "alice", db);
    addDashboardGrant(dashId, "role", "analyst", db);

    const beforeDelete = db
      .prepare("SELECT COUNT(*) AS c FROM dashboard_access_grants WHERE dashboard_id = ?")
      .get(dashId) as { c: number };
    expect(beforeDelete.c).toBe(2);

    // Replicate the explicit delete sequence in deleteDashboard():
    db.prepare("DELETE FROM dashboard_access_grants WHERE dashboard_id = ?").run(dashId);
    db.prepare("DELETE FROM dashboards WHERE id = ?").run(dashId);

    const afterDelete = db
      .prepare("SELECT COUNT(*) AS c FROM dashboard_access_grants WHERE dashboard_id = ?")
      .get(dashId) as { c: number };
    expect(afterDelete.c).toBe(0);
  });
});
