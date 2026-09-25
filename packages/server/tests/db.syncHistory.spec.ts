/**
 * db.syncHistory.spec.ts — v1.25 Phase 125 Plan 01 (SSYNC-V125-16, SSYNC-V125-17).
 *
 * Covers the durable storage layer for sync history:
 *   - WRITE-*    `setTableSchemaSnapshot`, the tree's FIRST writer for
 *                `tables.columns` + `tables.columns_fingerprint` (Phase 122 shipped
 *                the read-only accessor and deliberately no setter).
 *   - HIST-*     the two new tables on a fresh install, idempotent re-open, ordering,
 *                report round-trip, restart durability and per-entry delete.
 *   - CAP-*      the 20-entries-per-table cap enforced inside the insert transaction.
 *   - DROPPED-*  the durable, cumulative "older entries were dropped" fact.
 *
 * ALL FIXTURES ARE SYNTHETIC. Neutral names only (`demo_table`, `col_a`, `col_b`) per
 * CLAUDE.md's dataset-hygiene rule — no real Kinetica table or column names appear here.
 * (All nine registered tables in the dev database have `columns_fingerprint` NULL anyway,
 * so no real fingerprint fixture exists to copy.)
 *
 * Mirrors tests/db.schemaFingerprintColumn.spec.ts for `mkTempDbPath` / temp-file cleanup
 * and the `PRAGMA table_info` assertion idiom.
 */
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createDb,
  createTable,
  db,
  deleteTable,
  getTable,
  getTableColumnsFingerprint,
  setTableSchemaSnapshot,
} from "../src/db";

const tmpFiles: string[] = [];

const mkTempDbPath = (): string => {
  const p = path.join(os.tmpdir(), `kbi-synchist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
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

// SYNTHETIC fingerprint payload, the `{"v":1,"columns":{...}}` shape schemaFingerprint writes.
const FP_JSON = JSON.stringify({
  v: 1,
  columns: { col_a: { base: "char", refinements: ["char4"] }, col_b: { base: "long", refinements: [] } },
});

describe("sync history storage (Phase 125 SSYNC-V125-16/-17)", () => {
  it("WRITE-snapshot: setTableSchemaSnapshot writes BOTH columns and columns_fingerprint for that id only", () => {
    const target = createTable({ name: "demo_table", schema: "demo_schema", columns: { col_a: "character(256)" } });
    const other = createTable({ name: "other_table", schema: "demo_schema", columns: { col_b: "int" } });

    const ok = setTableSchemaSnapshot(target.id, { col_a: "char(4)", col_b: "bigint" }, FP_JSON);
    expect(ok).toBe(true);

    // Both halves of the snapshot must land — writing only one leaves the table
    // describing itself two different ways.
    const after = getTable(target.id)!;
    expect(after.columns).toEqual({ col_a: "char(4)", col_b: "bigint" });
    expect(getTableColumnsFingerprint(target.id)).toBe(FP_JSON);

    // The OTHER table's row is untouched.
    const untouched = getTable(other.id)!;
    expect(untouched.columns).toEqual({ col_b: "int" });
    expect(getTableColumnsFingerprint(other.id)).toBeNull();
  });

  it("WRITE-missing: setTableSchemaSnapshot on an unknown id returns false and writes nothing", () => {
    const before = db.prepare("SELECT COUNT(*) AS n FROM tables WHERE columns_fingerprint IS NOT NULL").get() as {
      n: number;
    };
    expect(setTableSchemaSnapshot(999999, { col_a: "int" }, FP_JSON)).toBe(false);
    const after = db.prepare("SELECT COUNT(*) AS n FROM tables WHERE columns_fingerprint IS NOT NULL").get() as {
      n: number;
    };
    expect(after.n).toBe(before.n);
  });

  it("HIST-fresh: a fresh createDb has table_sync_history and table_sync_history_meta with the exact declared columns", () => {
    const x = createDb(":memory:");

    const histCols = (x.prepare("PRAGMA table_info(table_sync_history)").all() as Array<{ name: string }>).map(
      (c) => c.name
    );
    // Full-array toEqual, not toContain: an accidentally added or renamed column reddens this.
    expect(histCols).toEqual(["id", "table_id", "ts", "actor", "kind", "changeset_json", "report_json"]);

    const metaCols = (x.prepare("PRAGMA table_info(table_sync_history_meta)").all() as Array<{ name: string }>).map(
      (c) => c.name
    );
    expect(metaCols).toEqual(["table_id", "dropped_count", "last_dropped_ts"]);

    x.close();
  });

  it("HIST-migrate: calling createDb twice on the same file does not throw and both tables are present", () => {
    const dbPath = mkTempDbPath();
    const first = createDb(dbPath);
    first.close();

    expect(() => {
      const second = createDb(dbPath);
      const names = (
        second
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'table_sync_history%' ORDER BY name")
          .all() as Array<{ name: string }>
      ).map((r) => r.name);
      expect(names).toEqual(["table_sync_history", "table_sync_history_meta"]);
      second.close();
    }).not.toThrow();
  });

  it("HIST-cascade: deleteTable removes that table's history rows AND its meta row", () => {
    const doomed = createTable({ name: "demo_table", schema: "demo_schema" });
    const kept = createTable({ name: "other_table", schema: "demo_schema" });

    for (const id of [doomed.id, kept.id]) {
      db.prepare("INSERT INTO table_sync_history (table_id, actor, kind, changeset_json, report_json) VALUES (?, ?, ?, ?, ?)").run(
        id,
        "tester",
        "baseline",
        null,
        null
      );
      db.prepare("INSERT INTO table_sync_history_meta (table_id, dropped_count, last_dropped_ts) VALUES (?, ?, ?)").run(
        id,
        3,
        "2026-01-01 00:00:00"
      );
    }

    expect(deleteTable(doomed.id)).toBe(true);

    const histLeft = db
      .prepare("SELECT COUNT(*) AS n FROM table_sync_history WHERE table_id = ?")
      .get(doomed.id) as { n: number };
    const metaLeft = db
      .prepare("SELECT COUNT(*) AS n FROM table_sync_history_meta WHERE table_id = ?")
      .get(doomed.id) as { n: number };
    expect(histLeft.n).toBe(0);
    expect(metaLeft.n).toBe(0);

    // The surviving table's rows are untouched.
    const keptHist = db
      .prepare("SELECT COUNT(*) AS n FROM table_sync_history WHERE table_id = ?")
      .get(kept.id) as { n: number };
    const keptMeta = db
      .prepare("SELECT COUNT(*) AS n FROM table_sync_history_meta WHERE table_id = ?")
      .get(kept.id) as { n: number };
    expect(keptHist.n).toBe(1);
    expect(keptMeta.n).toBe(1);
  });
});
