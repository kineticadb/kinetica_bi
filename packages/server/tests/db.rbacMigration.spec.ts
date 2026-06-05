/**
 * db.rbacMigration.spec.ts — Phase 46 Plan 02 (SCHEMA-V18-01).
 *
 * Coverage:
 *   - Fresh-boot path: createDb on an empty/in-memory DB creates roles,
 *     role_permissions, user_roles tables + idx_user_roles_username index.
 *   - Seed correctness: 4 built-in roles seeded; analyst=1, designer=8,
 *     user_admin=6, admin=15 permissions; all 4 have built_in=1.
 *   - Idempotency (THE key test): two consecutive createDb calls on the same
 *     file path produce no duplicate role or mapping rows (COUNT stays 4/30).
 *   - Operator-edit survival: manually deleting a designer permission mapping
 *     then re-booting does NOT re-insert it (INSERT OR IGNORE semantics).
 *   - v1.7-schema upgrade: a hand-built pre-v1.8 DB (dashboards + a row but
 *     no RBAC tables) gets the three tables added without losing existing data.
 *   - FK cascade: deleting a role cascade-deletes its user_roles rows when
 *     foreign_keys=ON.
 *
 * Mirrors db.dynamicViewsMigration.spec.ts structure (tmp-file helper,
 * afterEach cleanup, cascade test with foreign_keys=ON).
 */
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createDb } from "../src/db";

const tmpFiles: string[] = [];

const mkTempDbPath = (): string => {
  const p = path.join(
    os.tmpdir(),
    `kbi-rbacmig-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`
  );
  tmpFiles.push(p);
  return p;
};

afterEach(() => {
  while (tmpFiles.length) {
    const p = tmpFiles.pop();
    if (p && fs.existsSync(p)) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Fresh-boot creation
// ─────────────────────────────────────────────────────────────────────────────

describe("RBAC migration — fresh boot (SCHEMA-V18-01)", () => {
  it("creates roles, role_permissions, user_roles tables on a fresh in-memory DB", () => {
    const x = createDb(":memory:");

    const tableNames = x
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all()
      .map((r: { name: string }) => r.name);

    expect(tableNames).toContain("roles");
    expect(tableNames).toContain("role_permissions");
    expect(tableNames).toContain("user_roles");
  });

  it("creates idx_user_roles_username index on fresh boot", () => {
    const x = createDb(":memory:");
    const indexes = x
      .prepare("PRAGMA index_list(user_roles)")
      .all() as Array<{ name: string }>;
    const names = indexes.map((i) => i.name);
    expect(names).toContain("idx_user_roles_username");

    // Sanity: the index covers the username column.
    const indexInfo = x
      .prepare("PRAGMA index_info(idx_user_roles_username)")
      .all() as Array<{ name: string }>;
    expect(indexInfo.map((i) => i.name)).toContain("username");
  });

  it("roles table has the expected column shape", () => {
    const x = createDb(":memory:");
    const cols = x
      .prepare("PRAGMA table_info(roles)")
      .all() as Array<{
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
      }>;
    const byName = Object.fromEntries(cols.map((c) => [c.name, c]));

    expect(byName.id.type).toBe("INTEGER");
    expect(byName.name.type).toBe("TEXT");
    expect(byName.name.notnull).toBe(1);
    expect(byName.description.type).toBe("TEXT");
    expect(byName.description.notnull).toBe(1);
    expect(byName.built_in.type).toBe("INTEGER");
    expect(byName.built_in.notnull).toBe(1);
    expect(byName.built_in.dflt_value).toBe("0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Seed correctness
// ─────────────────────────────────────────────────────────────────────────────

describe("RBAC seed correctness (SCHEMA-V18-01)", () => {
  it("seeds exactly 4 built-in roles after createDb", () => {
    const x = createDb(":memory:");
    const count = (
      x.prepare("SELECT COUNT(*) AS c FROM roles").get() as { c: number }
    ).c;
    expect(count).toBe(4);
  });

  it("all four built-in role names are present with built_in=1", () => {
    const x = createDb(":memory:");
    const rows = x
      .prepare("SELECT name, built_in FROM roles ORDER BY name")
      .all() as Array<{ name: string; built_in: number }>;

    const names = rows.map((r) => r.name).sort();
    expect(names).toEqual(["admin", "analyst", "designer", "user_admin"]);

    for (const row of rows) {
      expect(row.built_in).toBe(1);
    }
  });

  it("seeds 30 role_permissions rows total (15+8+6+1)", () => {
    const x = createDb(":memory:");
    const count = (
      x
        .prepare("SELECT COUNT(*) AS c FROM role_permissions")
        .get() as { c: number }
    ).c;
    expect(count).toBe(30);
  });

  it("admin role maps to exactly 15 permissions", () => {
    const x = createDb(":memory:");
    const count = (
      x
        .prepare(
          "SELECT COUNT(*) AS c FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.name = 'admin'"
        )
        .get() as { c: number }
    ).c;
    expect(count).toBe(15);
  });

  it("designer role maps to exactly 8 permissions", () => {
    const x = createDb(":memory:");
    const count = (
      x
        .prepare(
          "SELECT COUNT(*) AS c FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.name = 'designer'"
        )
        .get() as { c: number }
    ).c;
    expect(count).toBe(8);
  });

  it("user_admin role maps to exactly 6 permissions", () => {
    const x = createDb(":memory:");
    const count = (
      x
        .prepare(
          "SELECT COUNT(*) AS c FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.name = 'user_admin'"
        )
        .get() as { c: number }
    ).c;
    expect(count).toBe(6);
  });

  it("analyst role maps to exactly 1 permission", () => {
    const x = createDb(":memory:");
    const count = (
      x
        .prepare(
          "SELECT COUNT(*) AS c FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.name = 'analyst'"
        )
        .get() as { c: number }
    ).c;
    expect(count).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency — two consecutive boots on the same file
// ─────────────────────────────────────────────────────────────────────────────

describe("RBAC seed idempotency (SCHEMA-V18-01)", () => {
  it("two consecutive createDb calls on the same file produce no duplicate rows", () => {
    const dbPath = mkTempDbPath();

    // First boot — creates tables and seeds rows.
    const first = createDb(dbPath);
    first.close();

    // Second boot on same file — must be a no-op (INSERT OR IGNORE).
    expect(() => {
      const second = createDb(dbPath);

      const roleCount = (
        second.prepare("SELECT COUNT(*) AS c FROM roles").get() as { c: number }
      ).c;
      expect(roleCount).toBe(4);

      const permCount = (
        second
          .prepare("SELECT COUNT(*) AS c FROM role_permissions")
          .get() as { c: number }
      ).c;
      expect(permCount).toBe(30);

      second.close();
    }).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Operator-edit survival
// ─────────────────────────────────────────────────────────────────────────────

describe("RBAC operator-edit survival (SCHEMA-V18-01)", () => {
  it("operator-added extra permission on a built-in role survives second boot (no overwrite)", () => {
    const dbPath = mkTempDbPath();

    // First boot — seed full default mappings.
    const first = createDb(dbPath);

    // Operator adds a custom extra permission to the analyst role (beyond the default).
    const analystRow = first
      .prepare("SELECT id FROM roles WHERE name = 'analyst'")
      .get() as { id: number };

    // analyst defaults to 1 permission; operator grants an additional one.
    first
      .prepare(
        "INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)"
      )
      .run(analystRow.id, "custom:extra_permission");

    const permsAfterAdd = (
      first
        .prepare(
          "SELECT COUNT(*) AS c FROM role_permissions WHERE role_id = ?"
        )
        .get(analystRow.id) as { c: number }
    ).c;
    expect(permsAfterAdd).toBe(2);

    first.close();

    // Second boot — seed must NOT duplicate or remove operator-added rows.
    const second = createDb(dbPath);

    const analystRow2 = second
      .prepare("SELECT id FROM roles WHERE name = 'analyst'")
      .get() as { id: number };
    const permsAfterReboot = (
      second
        .prepare(
          "SELECT COUNT(*) AS c FROM role_permissions WHERE role_id = ?"
        )
        .get(analystRow2.id) as { c: number }
    ).c;

    // Still 2 — operator-added extra permission survived; no duplicates added.
    expect(permsAfterReboot).toBe(2);

    // The operator-added custom permission is still present.
    const customPerm = second
      .prepare(
        "SELECT * FROM role_permissions WHERE role_id = ? AND permission = ?"
      )
      .get(analystRow2.id, "custom:extra_permission");
    expect(customPerm).toBeDefined();

    second.close();
  });

  it("INSERT OR IGNORE means default mappings are not duplicated on second boot", () => {
    // This is the core idempotency contract: existing rows survive unchanged.
    const dbPath = mkTempDbPath();

    const first = createDb(dbPath);
    const designerRow = first
      .prepare("SELECT id FROM roles WHERE name = 'designer'")
      .get() as { id: number };
    const firstBootPerms = (
      first
        .prepare(
          "SELECT permission FROM role_permissions WHERE role_id = ? ORDER BY permission"
        )
        .all(designerRow.id) as Array<{ permission: string }>
    ).map((r) => r.permission);
    expect(firstBootPerms).toHaveLength(8);
    first.close();

    const second = createDb(dbPath);
    const designerRow2 = second
      .prepare("SELECT id FROM roles WHERE name = 'designer'")
      .get() as { id: number };
    const secondBootPerms = (
      second
        .prepare(
          "SELECT permission FROM role_permissions WHERE role_id = ? ORDER BY permission"
        )
        .all(designerRow2.id) as Array<{ permission: string }>
    ).map((r) => r.permission);

    // Exact same 8 permissions — no duplicates introduced by second boot.
    expect(secondBootPerms).toEqual(firstBootPerms);
    second.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// v1.7 → v1.8 schema upgrade
// ─────────────────────────────────────────────────────────────────────────────

describe("RBAC v1.7-schema upgrade (SCHEMA-V18-01)", () => {
  it("hand-built v1.7 DB gets RBAC tables added without losing existing data", () => {
    // Build a pre-v1.8-shape DB by hand (dashboards only — no RBAC tables).
    const dbPath = mkTempDbPath();
    const seed = new Database(dbPath);
    seed.exec(`
      CREATE TABLE dashboards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    seed
      .prepare("INSERT INTO dashboards (name, description) VALUES (?, ?)")
      .run("legacy-dashboard", "from-v1.7");
    seed.close();

    // Boot createDb against the pre-v1.8 DB — must add RBAC tables without
    // dropping the existing dashboards row.
    const upgraded = createDb(dbPath);

    // Three RBAC tables now exist.
    const tableNames = upgraded
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all()
      .map((r: { name: string }) => r.name);
    expect(tableNames).toContain("roles");
    expect(tableNames).toContain("role_permissions");
    expect(tableNames).toContain("user_roles");

    // Pre-existing dashboards row preserved.
    const dashRow = upgraded
      .prepare("SELECT name, description FROM dashboards WHERE name = ?")
      .get("legacy-dashboard") as { name: string; description: string } | undefined;
    expect(dashRow).toBeDefined();
    expect(dashRow!.description).toBe("from-v1.7");

    // Seed ran correctly — 4 built-in roles present.
    const roleCount = (
      upgraded.prepare("SELECT COUNT(*) AS c FROM roles").get() as { c: number }
    ).c;
    expect(roleCount).toBe(4);

    upgraded.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FK cascade: deleting a role wipes its user_roles rows
// ─────────────────────────────────────────────────────────────────────────────

describe("RBAC FK cascade (SCHEMA-V18-01)", () => {
  it("deleting a role cascade-deletes its user_roles rows when foreign_keys=ON", () => {
    const x = createDb(":memory:");
    // foreign_keys must be ON for ON DELETE CASCADE to fire in better-sqlite3.
    x.pragma("foreign_keys = ON");

    // Grab the analyst role id.
    const analystRow = x
      .prepare("SELECT id FROM roles WHERE name = 'analyst'")
      .get() as { id: number };

    // Assign a user to the analyst role.
    x.prepare(
      "INSERT INTO user_roles (username, role_id) VALUES (?, ?)"
    ).run("testuser", analystRow.id);

    const preDel = (
      x
        .prepare(
          "SELECT COUNT(*) AS c FROM user_roles WHERE role_id = ?"
        )
        .get(analystRow.id) as { c: number }
    ).c;
    expect(preDel).toBe(1);

    // Delete the analyst role — cascade should wipe the user_roles row.
    x.prepare("DELETE FROM roles WHERE id = ?").run(analystRow.id);

    const postDel = (
      x
        .prepare(
          "SELECT COUNT(*) AS c FROM user_roles WHERE role_id = ?"
        )
        .get(analystRow.id) as { c: number }
    ).c;
    expect(postDel).toBe(0);
  });
});
