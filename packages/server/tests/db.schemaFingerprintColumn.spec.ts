/**
 * db.schemaFingerprintColumn.spec.ts — Phase 122 Plan 02 (SSYNC-V125-05).
 *
 * Coverage:
 *   - Fresh-install path: createDb on an empty DB gives `tables` a nullable
 *     `columns_fingerprint` column that defaults to NULL.
 *   - Pre-v1.25 migration: a database built with the OLD `tables` shape (no
 *     `columns_fingerprint`) gets the column added by createDb WITHOUT touching
 *     the existing row's `columns` value — proven byte-identical against the
 *     real lossy value the 122-SPIKE-NOTES.md spike captured.
 *   - Idempotency: calling createDb twice on the same file does not throw.
 *   - `getTableColumnsFingerprint` accessor: null for a never-fingerprinted row,
 *     raw/unparsed TEXT when present, null for an unknown id.
 *
 * Mirrors db.dynamicViewsMigration.spec.ts shape (vitest, mkTempDbPath, createDb usage).
 */
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createDb, createTable, db, getTableColumnsFingerprint } from "../src/db";

const tmpFiles: string[] = [];

const mkTempDbPath = (): string => {
  const p = path.join(os.tmpdir(), `kbi-fpcol-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
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

describe("tables.columns_fingerprint column (Phase 122 SSYNC-V125-05)", () => {
  it("fresh install: tables has a columns_fingerprint column, nullable, defaulting to NULL", () => {
    const x = createDb(":memory:");
    const info = x
      .prepare("PRAGMA table_info(tables)")
      .all() as Array<{ name: string; type: string; notnull: number; dflt_value: string | null }>;
    const byName = Object.fromEntries(info.map((c) => [c.name, c]));

    expect(byName.columns_fingerprint).toBeDefined();
    expect(byName.columns_fingerprint.type).toBe("TEXT");
    expect(byName.columns_fingerprint.notnull).toBe(0);
    expect(byName.columns_fingerprint.dflt_value).toBeNull();

    // A freshly-inserted row must actually resolve to NULL, not some silently
    // applied default.
    const res = x
      .prepare("INSERT INTO tables (name, schema, description, columns) VALUES (?, ?, ?, ?)")
      .run("events", "ki_home", "", "{}");
    const row = x
      .prepare("SELECT columns_fingerprint FROM tables WHERE id = ?")
      .get(Number(res.lastInsertRowid)) as { columns_fingerprint: string | null };
    expect(row.columns_fingerprint).toBeNull();
  });

  it("pre-v1.25 database: createDb adds columns_fingerprint without touching existing rows", () => {
    const dbPath = mkTempDbPath();
    const seed = new Database(dbPath);
    seed.exec(`
      CREATE TABLE tables (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        schema TEXT NOT NULL DEFAULT '',
        description TEXT,
        columns TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    const lossyColumns = JSON.stringify({ vendor_id: "character(256)", passenger_count: "tinyint" });
    seed
      .prepare("INSERT INTO tables (name, schema, description, columns) VALUES (?, ?, ?, ?)")
      .run("trips", "ki_home", "", lossyColumns);
    seed.close();

    const upgraded = createDb(dbPath);

    const info = upgraded
      .prepare("PRAGMA table_info(tables)")
      .all() as Array<{ name: string }>;
    expect(info.map((c) => c.name)).toContain("columns_fingerprint");

    const row = upgraded
      .prepare("SELECT columns, columns_fingerprint FROM tables WHERE name = ?")
      .get("trips") as { columns: string; columns_fingerprint: string | null };
    expect(row.columns).toBe(lossyColumns);
    expect(row.columns_fingerprint).toBeNull();
    upgraded.close();
  });

  it("idempotent: calling createDb twice on the same file does not throw", () => {
    const dbPath = mkTempDbPath();
    const first = createDb(dbPath);
    first.close();
    expect(() => {
      const second = createDb(dbPath);
      const info = second.prepare("PRAGMA table_info(tables)").all() as Array<{ name: string }>;
      expect(info.map((c) => c.name)).toContain("columns_fingerprint");
      second.close();
    }).not.toThrow();
  });

  it("getTableColumnsFingerprint returns null for a row that has never been fingerprinted", () => {
    // Uses the module-singleton `db` (DB_PATH=":memory:" + vitest isolate:true per
    // tests/setup.ts) via db.ts's own createTable helper — mirrors
    // lib.dashboardExport.spec.ts's precedent for exercising the singleton directly.
    const t = createTable({ name: "events", schema: "ki_home" });
    expect(getTableColumnsFingerprint(t.id)).toBeNull();
  });

  it("getTableColumnsFingerprint returns the raw TEXT verbatim, unparsed", () => {
    const t = createTable({ name: "events", schema: "ki_home" });
    const rawFingerprint = '{"vendor_id":"char(4)"}';
    // No setter exists by design (Phase 122 ships no writer) — raw SQL stands in for
    // Phase 125's future apply step purely to exercise the read accessor here.
    db.prepare("UPDATE tables SET columns_fingerprint = ? WHERE id = ?").run(rawFingerprint, t.id);
    expect(getTableColumnsFingerprint(t.id)).toBe(rawFingerprint);
  });

  it("getTableColumnsFingerprint returns null for an unknown table id", () => {
    expect(getTableColumnsFingerprint(999999)).toBeNull();
  });
});
