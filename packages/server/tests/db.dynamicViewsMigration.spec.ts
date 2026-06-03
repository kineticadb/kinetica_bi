/**
 * db.dynamicViewsMigration.spec.ts — Phase 32 Plan 01 Task 1 (DV-V16-01).
 *
 * Coverage:
 *   - Fresh-install path: createDb on an empty DB creates `dashboard_dynamic_views`
 *     with the exact 9-column shape locked in 32-CONTEXT.md + a per-dashboard index.
 *   - Idempotency: calling createDb twice on the same file path does not throw.
 *   - Pre-v1.6 migration: a database that predates v1.6 (no dashboard_dynamic_views)
 *     gets the table added by CREATE TABLE IF NOT EXISTS without dropping existing data.
 *   - ON DELETE CASCADE: deleting the parent dashboard wipes its dynamic-view rows.
 *
 * Mirrors db.smoke.spec.ts shape (vitest, no jest globals, createDb usage).
 */
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createDb } from "../src/db";

const tmpFiles: string[] = [];

const mkTempDbPath = (): string => {
  const p = path.join(os.tmpdir(), `kbi-dvmig-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
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

describe("dashboard_dynamic_views migration (Phase 32 DV-V16-01)", () => {
  it("creates dashboard_dynamic_views table on fresh boot with 9 columns in locked order", () => {
    const x = createDb(":memory:");
    const cols = x
      .prepare("PRAGMA table_info(dashboard_dynamic_views)")
      .all()
      .map((r: { name: string }) => r.name);
    expect(cols).toEqual([
      "id",
      "dashboard_id",
      "source_table_id",
      "name",
      "template_sql",
      "max_records",
      "columns_json",
      "created_at",
      "updated_at",
    ]);

    // Type / nullable / default sanity per CONTEXT.md § D7 + Endpoints section
    const info = x
      .prepare("PRAGMA table_info(dashboard_dynamic_views)")
      .all() as Array<{
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
      }>;
    const byName = Object.fromEntries(info.map((c) => [c.name, c]));

    expect(byName.id.type).toBe("INTEGER");
    expect(byName.dashboard_id.type).toBe("INTEGER");
    expect(byName.dashboard_id.notnull).toBe(1);
    expect(byName.source_table_id.type).toBe("INTEGER");
    expect(byName.source_table_id.notnull).toBe(1);
    expect(byName.name.type).toBe("TEXT");
    expect(byName.name.notnull).toBe(1);
    expect(byName.template_sql.type).toBe("TEXT");
    expect(byName.template_sql.notnull).toBe(1);
    expect(byName.max_records.type).toBe("INTEGER");
    expect(byName.max_records.notnull).toBe(1);
    expect(byName.max_records.dflt_value).toContain("100000");
    expect(byName.columns_json.type).toBe("TEXT");
    expect(byName.columns_json.notnull).toBe(0);
  });

  it("is idempotent — calling createDb twice on the same file path does not error", () => {
    const dbPath = mkTempDbPath();
    // First run materialises the schema...
    const first = createDb(dbPath);
    first.close();
    // ...second run on the same file must be a clean no-op (CREATE TABLE IF NOT EXISTS).
    expect(() => {
      const second = createDb(dbPath);
      const tableNames = second
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name = 'dashboard_dynamic_views'"
        )
        .all()
        .map((r: { name: string }) => r.name);
      expect(tableNames).toContain("dashboard_dynamic_views");
      second.close();
    }).not.toThrow();
  });

  it("creates index idx_dashboard_dynamic_views_dashboard_id on dashboard_id", () => {
    const x = createDb(":memory:");
    const indexes = x
      .prepare("PRAGMA index_list(dashboard_dynamic_views)")
      .all() as Array<{ name: string }>;
    const names = indexes.map((i) => i.name);
    expect(names).toContain("idx_dashboard_dynamic_views_dashboard_id");

    // Sanity: the index covers the dashboard_id column.
    const indexInfo = x
      .prepare("PRAGMA index_info(idx_dashboard_dynamic_views_dashboard_id)")
      .all() as Array<{ name: string }>;
    expect(indexInfo.map((i) => i.name)).toContain("dashboard_id");
  });

  it("dropping the parent dashboard cascade-deletes its dynamic views", () => {
    const x = createDb(":memory:");
    // foreign_keys must be ON for ON DELETE CASCADE to fire in better-sqlite3.
    x.pragma("foreign_keys = ON");

    // Seed a dashboard + a table + a dynamic_view row pointing at both.
    const dashRes = x
      .prepare("INSERT INTO dashboards (name, description) VALUES (?, ?)")
      .run("test", "");
    const dashId = Number(dashRes.lastInsertRowid);
    const tblRes = x
      .prepare("INSERT INTO tables (name, schema, description, columns) VALUES (?, ?, ?, ?)")
      .run("events", "ki_home", "", "{}");
    const tableId = Number(tblRes.lastInsertRowid);

    x.prepare(
      "INSERT INTO dashboard_dynamic_views (dashboard_id, source_table_id, name, template_sql, max_records, columns_json) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(dashId, tableId, "vendors_by_hour", "SELECT * FROM {view}", 100000, null);

    const preCount = (
      x.prepare("SELECT COUNT(*) AS c FROM dashboard_dynamic_views").get() as { c: number }
    ).c;
    expect(preCount).toBe(1);

    // Drop the parent dashboard — cascade should wipe the dynamic_view row.
    x.prepare("DELETE FROM dashboards WHERE id = ?").run(dashId);

    const postCount = (
      x.prepare("SELECT COUNT(*) AS c FROM dashboard_dynamic_views").get() as { c: number }
    ).c;
    expect(postCount).toBe(0);
  });

  it("pre-v1.6 migration: a DB lacking dashboard_dynamic_views gets the table via createDb without dropping existing data", () => {
    // Build a pre-v1.6-shape DB by hand (no dashboard_dynamic_views).
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
      .run("legacy-dashboard", "from-v1.5");
    seed.close();

    // Booting createDb against the pre-v1.6 DB must add dashboard_dynamic_views WITHOUT
    // dropping the existing dashboards row.
    const upgraded = createDb(dbPath);
    const tableNames = upgraded
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = 'dashboard_dynamic_views'"
      )
      .all()
      .map((r: { name: string }) => r.name);
    expect(tableNames).toContain("dashboard_dynamic_views");

    // Pre-existing data preserved.
    const dashRow = upgraded
      .prepare("SELECT name, description FROM dashboards WHERE name = ?")
      .get("legacy-dashboard") as { name: string; description: string } | undefined;
    expect(dashRow).toBeDefined();
    expect(dashRow!.description).toBe("from-v1.5");
    upgraded.close();
  });
});
