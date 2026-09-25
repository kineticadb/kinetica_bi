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
  deleteTableSyncHistoryEntry,
  getTable,
  getTableColumnsFingerprint,
  getTableSyncHistoryEntry,
  insertTableSyncHistoryEntry,
  listTableSyncHistory,
  setTableSchemaSnapshot,
  SYNC_HISTORY_CAP,
  type SyncChangeset,
} from "../src/db";
import { buildImpactReport } from "../src/lib/schemaImpact";
import type { ImpactReport } from "../src/lib/schemaImpact";
import type { SchemaCheckResult } from "../src/lib/schemaDiff";
import type { ColumnRefsInput } from "../src/lib/columnRefs";

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

// SYNTHETIC ImpactReport fixture, built by CALLING the shipped composer rather than
// hand-typing a report object -- a hand-typed report can drift from the shipped contract
// without anything noticing.
const emptyRefsInput: ColumnRefsInput = {
  widgets: [],
  layers: [],
  dynamicViews: [],
  customMetrics: [],
  tableViews: [],
  columnDisplayConfig: [],
};

const makeReport = (tableId: number): ImpactReport => {
  const check: Extract<SchemaCheckResult, { outcome: "diff" }> = {
    outcome: "diff",
    table: "demo_schema.demo_table",
    hasChanges: true,
    added: [{ column: "col_b", live: { base: "long", refinements: [] }, liveType: "long" }],
    removed: [{ column: "col_a", stored: { base: "char", refinements: ["char4"] }, storedType: "char(char4)" }],
    retyped: [],
    live: { col_b: { base: "long", refinements: [] } },
  };
  return buildImpactReport({ check, tableId, refsInput: emptyRefsInput, dashboards: [] });
};

const CHANGESET: SyncChangeset = {
  v: 1,
  added: [{ column: "col_b", liveType: "long" }],
  removed: [{ column: "col_a", storedType: "char(char4)" }],
  retyped: [],
};

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
  // ---------------------------------------------------------------------------------------
  // CAP-* : the per-table cap, enforced inside the insert transaction.
  // ---------------------------------------------------------------------------------------

  it("CAP-under: inserting exactly SYNC_HISTORY_CAP entries leaves all of them present and droppedCount 0", () => {
    const t = createTable({ name: "demo_table", schema: "demo_schema" });
    for (let i = 0; i < SYNC_HISTORY_CAP; i++) {
      const res = insertTableSyncHistoryEntry({
        tableId: t.id,
        actor: "tester",
        kind: "diff",
        changeset: CHANGESET,
        report: null,
      });
      expect(res.dropped).toBe(0);
    }
    const history = listTableSyncHistory(t.id);
    expect(history.entries).toHaveLength(SYNC_HISTORY_CAP);
    expect(history.droppedCount).toBe(0);
    expect(history.lastDroppedTs).toBeNull();
    expect(history.cap).toBe(SYNC_HISTORY_CAP);
  });

  it("CAP-over: the entry after the cap leaves exactly SYNC_HISTORY_CAP entries, the OLDEST gone and the newest kept", () => {
    const t = createTable({ name: "demo_table", schema: "demo_schema" });
    const ids: number[] = [];
    for (let i = 0; i < SYNC_HISTORY_CAP; i++) {
      ids.push(
        insertTableSyncHistoryEntry({ tableId: t.id, actor: "tester", kind: "diff", changeset: CHANGESET, report: null }).id
      );
    }
    const overflow = insertTableSyncHistoryEntry({
      tableId: t.id,
      actor: "tester",
      kind: "diff",
      changeset: CHANGESET,
      report: null,
    });
    expect(overflow.dropped).toBe(1);

    const history = listTableSyncHistory(t.id);
    expect(history.entries).toHaveLength(SYNC_HISTORY_CAP);
    const present = history.entries.map((e) => e.id);
    // The OLDEST (first-inserted) id is the one that went.
    expect(present).not.toContain(ids[0]);
    // Every other original id, plus the new one, survived -- newest first.
    expect(present).toEqual([overflow.id, ...ids.slice(1)].sort((a, b) => b - a));
  });

  it("CAP-scoped: filling table A to the cap drops none of table B's entries", () => {
    const a = createTable({ name: "demo_table", schema: "demo_schema" });
    const b = createTable({ name: "other_table", schema: "demo_schema" });

    const bIds = [1, 2, 3].map(
      () => insertTableSyncHistoryEntry({ tableId: b.id, actor: "tester", kind: "baseline", changeset: null, report: null }).id
    );

    for (let i = 0; i < SYNC_HISTORY_CAP + 5; i++) {
      insertTableSyncHistoryEntry({ tableId: a.id, actor: "tester", kind: "diff", changeset: CHANGESET, report: null });
    }

    const bHistory = listTableSyncHistory(b.id);
    expect(bHistory.entries.map((e) => e.id).sort((x, y) => x - y)).toEqual(bIds.sort((x, y) => x - y));
    expect(bHistory.droppedCount).toBe(0);
    expect(listTableSyncHistory(a.id).entries).toHaveLength(SYNC_HISTORY_CAP);
  });

  // ---------------------------------------------------------------------------------------
  // DROPPED-* : the durable, cumulative "older entries were dropped" fact.
  // ---------------------------------------------------------------------------------------

  it("DROPPED-count: after SYNC_HISTORY_CAP + 5 inserts, droppedCount is 5 and lastDroppedTs is non-null", () => {
    const t = createTable({ name: "demo_table", schema: "demo_schema" });
    for (let i = 0; i < SYNC_HISTORY_CAP + 5; i++) {
      insertTableSyncHistoryEntry({ tableId: t.id, actor: "tester", kind: "diff", changeset: CHANGESET, report: null });
    }
    const history = listTableSyncHistory(t.id);
    expect(history.entries).toHaveLength(SYNC_HISTORY_CAP);
    expect(history.droppedCount).toBe(5);
    expect(history.lastDroppedTs).not.toBeNull();
    expect(typeof history.lastDroppedTs).toBe("string");
  });

  it("DROPPED-survives-delete: deleting the newest entry by hand does NOT reset droppedCount", () => {
    const t = createTable({ name: "demo_table", schema: "demo_schema" });
    for (let i = 0; i < SYNC_HISTORY_CAP + 2; i++) {
      insertTableSyncHistoryEntry({ tableId: t.id, actor: "tester", kind: "diff", changeset: CHANGESET, report: null });
    }
    const before = listTableSyncHistory(t.id);
    expect(before.droppedCount).toBe(2);

    expect(deleteTableSyncHistoryEntry(before.entries[0].id)).toBe(true);

    const after = listTableSyncHistory(t.id);
    expect(after.entries).toHaveLength(SYNC_HISTORY_CAP - 1);
    // dropped_count records what the CAP removed -- a hand delete is a different fact.
    expect(after.droppedCount).toBe(2);
    expect(after.lastDroppedTs).toBe(before.lastDroppedTs);
  });

  // ---------------------------------------------------------------------------------------
  // HIST-* : ordering, round-trip, baseline nulls, restart durability, per-entry delete.
  // ---------------------------------------------------------------------------------------

  it("HIST-order: entries written inside the SAME second come back newest-first by id, not by ts", () => {
    const t = createTable({ name: "demo_table", schema: "demo_schema" });
    insertTableSyncHistoryEntry({ tableId: t.id, actor: "tester", kind: "diff", changeset: CHANGESET, report: null });
    insertTableSyncHistoryEntry({ tableId: t.id, actor: "tester", kind: "diff", changeset: CHANGESET, report: null });

    let entries = listTableSyncHistory(t.id).entries;
    // datetime('now') has ONE-SECOND resolution. Retry until two inserts land inside the
    // same second -- without equal ts values this test would pass under an ORDER BY ts DESC
    // implementation purely because the clock ticked, and would prove nothing.
    for (let attempt = 0; attempt < 60 && entries[0].ts !== entries[1].ts; attempt++) {
      insertTableSyncHistoryEntry({ tableId: t.id, actor: "tester", kind: "diff", changeset: CHANGESET, report: null });
      entries = listTableSyncHistory(t.id).entries;
    }

    const a = entries[0];
    const b = entries[1];
    expect(a.ts).toBe(b.ts);
    expect(a.id).toBeGreaterThan(b.id);

    // And the whole tied block is in descending id order, not sorter-arbitrary order.
    const tied = entries.filter((e) => e.ts === a.ts).map((e) => e.id);
    expect(tied).toEqual([...tied].sort((x, y) => y - x));
  });

  it("HIST-roundtrip: report_json is byte-identical to JSON.stringify(report), in the column and back out", () => {
    const t = createTable({ name: "demo_table", schema: "demo_schema" });
    const report = makeReport(t.id);
    const expected = JSON.stringify(report);

    const { id } = insertTableSyncHistoryEntry({
      tableId: t.id,
      actor: "tester",
      kind: "diff",
      changeset: CHANGESET,
      report,
    });

    // RAW column read -- a toEqual on the parsed object would pass even if the layer
    // re-serialised with a different key order, which is exactly what Phase 124's
    // byte-stable sort exists to prevent.
    const raw = db.prepare("SELECT report_json FROM table_sync_history WHERE id = ?").get(id) as {
      report_json: string;
    };
    expect(raw.report_json).toBe(expected);

    const entry = getTableSyncHistoryEntry(id)!;
    expect(JSON.stringify(entry.report)).toBe(expected);
    expect(entry.changeset).toEqual(CHANGESET);
    expect(entry.kind).toBe("diff");
    expect(entry.actor).toBe("tester");
    expect(entry.table_id).toBe(t.id);
  });

  it("HIST-baseline-nulls: a baseline entry stores NULL changeset and NULL report and reads back null/null", () => {
    const t = createTable({ name: "demo_table", schema: "demo_schema" });
    const { id } = insertTableSyncHistoryEntry({
      tableId: t.id,
      actor: "tester",
      kind: "baseline",
      changeset: null,
      report: null,
    });

    const raw = db
      .prepare("SELECT changeset_json, report_json FROM table_sync_history WHERE id = ?")
      .get(id) as { changeset_json: string | null; report_json: string | null };
    expect(raw.changeset_json).toBeNull();
    expect(raw.report_json).toBeNull();

    const entry = getTableSyncHistoryEntry(id)!;
    expect(entry.kind).toBe("baseline");
    expect(entry.changeset).toBeNull();
    expect(entry.report).toBeNull();
  });

  it("HIST-restart: entries written to a file-backed database are still there after close and re-open", () => {
    const dbPath = mkTempDbPath();
    const first = createDb(dbPath);
    const tableId = Number(
      first
        .prepare("INSERT INTO tables (name, schema, description, columns) VALUES (?, ?, ?, ?)")
        .run("demo_table", "demo_schema", "", "{}").lastInsertRowid
    );
    const reportJson = JSON.stringify(makeReport(tableId));
    first
      .prepare("INSERT INTO table_sync_history (table_id, actor, kind, changeset_json, report_json) VALUES (?, ?, ?, ?, ?)")
      .run(tableId, "tester", "diff", JSON.stringify(CHANGESET), reportJson);
    first
      .prepare("INSERT INTO table_sync_history_meta (table_id, dropped_count, last_dropped_ts) VALUES (?, ?, datetime('now'))")
      .run(tableId, 4);
    first.close();

    const second = createDb(dbPath);
    const rows = second
      .prepare("SELECT * FROM table_sync_history WHERE table_id = ? ORDER BY id DESC")
      .all(tableId) as Array<{ actor: string; kind: string; changeset_json: string; report_json: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].actor).toBe("tester");
    expect(rows[0].kind).toBe("diff");
    expect(rows[0].report_json).toBe(reportJson);
    expect(rows[0].changeset_json).toBe(JSON.stringify(CHANGESET));

    const meta = second
      .prepare("SELECT dropped_count, last_dropped_ts FROM table_sync_history_meta WHERE table_id = ?")
      .get(tableId) as { dropped_count: number; last_dropped_ts: string | null };
    expect(meta.dropped_count).toBe(4);
    expect(meta.last_dropped_ts).not.toBeNull();
    second.close();
  });

  it("HIST-delete-one: deleting one entry leaves siblings AND the stored schema untouched", () => {
    const t = createTable({ name: "demo_table", schema: "demo_schema" });
    setTableSchemaSnapshot(t.id, { col_a: "char(4)", col_b: "bigint" }, FP_JSON);

    const report = makeReport(t.id);
    const first = insertTableSyncHistoryEntry({ tableId: t.id, actor: "tester", kind: "baseline", changeset: null, report: null });
    const middle = insertTableSyncHistoryEntry({ tableId: t.id, actor: "tester", kind: "diff", changeset: CHANGESET, report });
    const last = insertTableSyncHistoryEntry({ tableId: t.id, actor: "tester", kind: "diff", changeset: CHANGESET, report: null });

    expect(deleteTableSyncHistoryEntry(middle.id)).toBe(true);

    const history = listTableSyncHistory(t.id);
    expect(history.entries.map((e) => e.id)).toEqual([last.id, first.id]);
    expect(getTableSyncHistoryEntry(middle.id)).toBeUndefined();
    expect(getTableSyncHistoryEntry(first.id)!.kind).toBe("baseline");
    expect(getTableSyncHistoryEntry(last.id)!.changeset).toEqual(CHANGESET);

    // ROADMAP criterion 5: the stored schema is not collateral damage.
    expect(getTable(t.id)!.columns).toEqual({ col_a: "char(4)", col_b: "bigint" });
    expect(getTableColumnsFingerprint(t.id)).toBe(FP_JSON);
  });

  it("HIST-delete-missing: deleting an unknown entry id returns false", () => {
    expect(deleteTableSyncHistoryEntry(999999)).toBe(false);
  });

  it("HIST-empty: a table with no entries reads back an empty list with zeroed cap facts", () => {
    const t = createTable({ name: "demo_table", schema: "demo_schema" });
    expect(listTableSyncHistory(t.id)).toEqual({ entries: [], droppedCount: 0, lastDroppedTs: null, cap: SYNC_HISTORY_CAP });
  });

  it("HIST-corrupt-json: a malformed stored payload reads back as null instead of throwing", () => {
    const t = createTable({ name: "demo_table", schema: "demo_schema" });
    const id = Number(
      db
        .prepare("INSERT INTO table_sync_history (table_id, actor, kind, changeset_json, report_json) VALUES (?, ?, ?, ?, ?)")
        .run(t.id, "tester", "diff", "{not json", "{also not json").lastInsertRowid
    );
    const entry = getTableSyncHistoryEntry(id)!;
    expect(entry.changeset).toBeNull();
    expect(entry.report).toBeNull();
    expect(() => listTableSyncHistory(t.id)).not.toThrow();
  });
});
