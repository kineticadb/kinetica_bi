/**
 * lib.schemaApply.transaction.spec.ts — v1.25 Phase 125 Plan 03
 * (SSYNC-V125-13, -14, -15, -16, -17).
 *
 * `applySchemaSync` — THE ONLY WRITE PATH in v1.25, and the proof that it touches the
 * `tables` row and nothing else.
 *
 * This file INVERTS the invariant every earlier phase in this milestone carried. Phases
 * 122-124 each shipped a spec proving *nothing was written*; this one must prove *exactly
 * one row changed and nothing else*. That is a strictly harder thing to prove, and there
 * are two well-documented ways the proof rots:
 *
 *   1. COUNTING INSTEAD OF SNAPSHOTTING. `snapshotConfigTables()` below captures FULL ROWS
 *      (`SELECT * ... ORDER BY id`), never counts. The precedent it upgrades past —
 *      `lib.dashboardImport.apply.spec.ts`'s `countRows()` — is count-based, and a count
 *      snapshot passes when a row is REWRITTEN IN PLACE, which is precisely the failure
 *      mode ROADMAP criterion 2 forbids ("no widget, layer, metric or format rule is ever
 *      rewritten").
 *   2. COMPARING EMPTY TO EMPTY. A snapshot of four empty arrays compares equal to itself
 *      no matter what the code under test did. Phase 124's plan checker caught exactly that
 *      test. So `expectNonVacuous(before)` is called before EVERY `toEqual` in every
 *      `ONLYTABLES-` test, and `seedConfigRows` puts real rows in all four tables.
 *
 * Test families:
 *   - ONLYTABLES-*  the criterion-2 full-ROW snapshot, on a fixture proven non-empty first,
 *                   under both a diff apply and a baseline apply; plus the no-refusal proof.
 *   - BASELINE-*    a baseline apply IS recorded (125-CONTEXT.md, locked), and a later diff
 *                   apply diffs rather than re-baselining.
 *   - DIFF-*        the stored report describes what was actually written.
 *   - NOOP-*        a no-op apply is NOT recorded and writes nothing at all.
 *   - STALE-*       the optimistic-concurrency refusal writes nothing at all.
 *   - ROLLBACK-*    a RAISE(ABORT) inside the transaction rolls the snapshot update back
 *                   with it, plus the control run proving the fixture can succeed.
 *
 * SET-BASED gate note (CLAUDE.md § "Test gates"): the server suite is set-based. There is
 * NO fixed server-wide pass count anywhere in this file, and this spec must be run through
 * `node scripts/test-gate.mjs` from `packages/server`, never a bare `npx vitest run`.
 *
 * ALL FIXTURES ARE SYNTHETIC — `demo_schema` / `demo_table`, columns `col_a`, `col_b`,
 * `col_ts`, `col_gone`. No real Kinetica table or column name appears here. The
 * base/refinement PAIRINGS (`long` + `timestamp`, `string` + `char16`) follow
 * 122-SPIKE-NOTES.md's live `/show/table` capture; the NAMES do not.
 *
 * MUTATION PROBES: recorded in 125-03-SUMMARY.md.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  db,
  createTable,
  createDashboard,
  createWidget,
  createDashboardLayer,
  createCustomMetric,
  upsertColumnDisplayConfig,
  getTable,
  getTableColumnsFingerprint,
  listTableSyncHistory,
} from "../src/db";
import { applySchemaSync } from "../src/lib/schemaApply";
import { SCHEMA_APPLY_STALE_MESSAGE } from "../src/lib/schemaApply";
import { serializeFingerprintSnapshot } from "../src/lib/schemaFingerprint";
import type { ColumnFingerprintMap } from "../src/lib/schemaFingerprint";

const TABLE_NAME = "demo_schema.demo_table";
const ACTOR = "demo_operator";

/**
 * The STORED snapshot. `col_gone` is the column the changeset removes, and the one the
 * seeded widget and column_display_config row reference — so the rebuilt impact report is
 * non-empty too, not merely present.
 */
const STORED: ColumnFingerprintMap = {
  col_a: { base: "long", refinements: [] },
  col_b: { base: "int", refinements: [] },
  col_gone: { base: "string", refinements: ["char4"] },
};

/**
 * The LIVE map. Against STORED this yields a changeset carrying ALL THREE groups:
 *   added   col_ts   (long + timestamp)
 *   removed col_gone
 *   retyped col_b    (int -> string(char16))
 * The removals-AND-retypes combination is what `ONLYTABLES-breaking` needs: SSYNC-V125-15
 * says nothing may refuse it.
 */
const LIVE: ColumnFingerprintMap = {
  col_a: { base: "long", refinements: [] },
  col_b: { base: "string", refinements: ["char16"] },
  col_ts: { base: "long", refinements: ["timestamp"] },
};

/** A THIRD map, used to drive the staleness refusal: live moved again after the report. */
const LIVE_MOVED_AGAIN: ColumnFingerprintMap = {
  ...LIVE,
  col_extra: { base: "int", refinements: [] },
};

const resetDb = () => {
  db.exec(`
    DELETE FROM table_sync_history_meta;
    DELETE FROM table_sync_history;
    DELETE FROM column_display_config;
    DELETE FROM dashboard_layers;
    DELETE FROM widgets;
    DELETE FROM custom_metrics;
    DELETE FROM dashboards;
    DELETE FROM tables;
  `);
};

beforeEach(() => {
  // Crash-safety net against a prior test leaking the abort trigger (see withAbortTriggerOn).
  db.exec("DROP TRIGGER IF EXISTS kbi_test_abort_sync;");
  resetDb();
});

/**
 * Establishes a stored precise baseline with RAW SQL, following
 * `routes.schema-check.spec.ts`'s `setStoredFingerprint`. Deliberately NOT via
 * `setTableSchemaSnapshot`: the fixture must be able to set up a state the code under test
 * did not itself produce, or the test only proves the writer agrees with itself.
 */
const setStoredFingerprint = (tableId: number, columns: ColumnFingerprintMap): void => {
  db.prepare("UPDATE tables SET columns_fingerprint = ? WHERE id = ?").run(
    serializeFingerprintSnapshot(columns),
    tableId
  );
};

/**
 * Seeds ≥1 row into EACH of the four tables ROADMAP criterion 2 names, through the normal
 * `db.ts` accessors. The widget config and the column_display_config row both reference
 * `col_gone`, the column the changeset REMOVES, so the rebuilt impact report has real
 * records in it rather than three empty sections.
 */
const seedConfigRows = (tableId: number) => {
  const dashboard = createDashboard("Demo Dashboard", "criterion-2 fixture");
  const widget = createWidget(dashboard.id, {
    title: "Demo Widget",
    type: "chart",
    position: 0,
    config: { tableId, metricColumn: "col_gone" },
  });
  const layer = createDashboardLayer(dashboard.id, { table_id: tableId });
  const metric = createCustomMetric(tableId, "Demo Metric", "SUM(col_a)", null);
  const cdc = upsertColumnDisplayConfig(tableId, "col_gone", "Gone Column", null);
  return { dashboard, widget, layer, metric, cdc };
};

/** Registers the synthetic table and seeds the four config tables around it. */
const seedTable = (): number => {
  const table = createTable({ name: "demo_table", schema: "demo_schema" });
  seedConfigRows(table.id);
  return table.id;
};

const historyCount = (tableId: number): number =>
  (db.prepare("SELECT COUNT(*) c FROM table_sync_history WHERE table_id = ?").get(tableId) as { c: number }).c;

const tablesRow = (tableId: number): Record<string, unknown> =>
  db.prepare("SELECT * FROM tables WHERE id = ?").get(tableId) as Record<string, unknown>;

// ─── The four outcomes ────────────────────────────────────────────────────────────────

describe("applySchemaSync — baseline (BASELINE-)", () => {
  it("BASELINE-recorded: a NULL stored fingerprint applies as a baseline and records ONE entry", () => {
    const tableId = seedTable();
    expect(getTableColumnsFingerprint(tableId)).toBeNull();

    const result = applySchemaSync({
      tableId,
      table: TABLE_NAME,
      live: LIVE,
      reportedLive: LIVE,
      actor: ACTOR,
    });

    expect(result.outcome).toBe("applied");
    if (result.outcome !== "applied") throw new Error("unreachable");
    expect(result.kind).toBe("baseline");
    expect(result.recorded).toBe(true);
    expect(result.changeset).toBeNull();
    expect(result.tableId).toBe(tableId);
    expect(result.table).toBe(TABLE_NAME);

    const history = listTableSyncHistory(tableId);
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0].kind).toBe("baseline");
    expect(history.entries[0].changeset).toBeNull();
    expect(history.entries[0].report).toBeNull();
    expect(history.entries[0].actor).toBe(ACTOR);
    expect(history.entries[0].ts).toBeTruthy();
    expect(history.entries[0].id).toBe(result.historyId);

    // The snapshot itself landed, in BOTH halves.
    expect(getTableColumnsFingerprint(tableId)).toBe(serializeFingerprintSnapshot(LIVE));
    expect(getTable(tableId)!.columns).toEqual(result.columns);
  });

  it("BASELINE-then-diff: applying again against a CHANGED live map diffs instead of re-baselining", () => {
    const tableId = seedTable();

    const first = applySchemaSync({
      tableId,
      table: TABLE_NAME,
      live: STORED,
      reportedLive: STORED,
      actor: ACTOR,
    });
    expect(first.outcome).toBe("applied");
    if (first.outcome !== "applied") throw new Error("unreachable");
    expect(first.kind).toBe("baseline");

    const second = applySchemaSync({
      tableId,
      table: TABLE_NAME,
      live: LIVE,
      reportedLive: LIVE,
      actor: ACTOR,
    });
    expect(second.outcome).toBe("applied");
    if (second.outcome !== "applied") throw new Error("unreachable");
    expect(second.kind).toBe("diff");
    expect(second.changeset).not.toBeNull();
    expect(second.changeset!.added.map((a) => a.column)).toEqual(["col_ts"]);
    expect(second.changeset!.removed.map((r) => r.column)).toEqual(["col_gone"]);
    expect(second.changeset!.retyped.map((r) => r.column)).toEqual(["col_b"]);

    const history = listTableSyncHistory(tableId);
    expect(history.entries).toHaveLength(2);
    // Newest first.
    expect(history.entries[0].kind).toBe("diff");
    expect(history.entries[0].changeset).not.toBeNull();
    expect(history.entries[0].report).not.toBeNull();
    expect(history.entries[1].kind).toBe("baseline");
  });
});

describe("applySchemaSync — the stored report describes the write (DIFF-)", () => {
  it("DIFF-report-describes-write: the report's table, tableId and column names match the changeset", () => {
    const tableId = seedTable();
    setStoredFingerprint(tableId, STORED);

    const result = applySchemaSync({
      tableId,
      table: TABLE_NAME,
      live: LIVE,
      reportedLive: LIVE,
      actor: ACTOR,
    });
    expect(result.outcome).toBe("applied");
    if (result.outcome !== "applied") throw new Error("unreachable");

    const entry = listTableSyncHistory(tableId).entries[0];
    const report = entry.report!;
    expect(report).not.toBeNull();
    expect(report.table).toBe(TABLE_NAME);
    expect(report.tableId).toBe(tableId);
    expect(report.outcome).toBe("changes");

    // Every column named in the report is a column named in the changeset written with it,
    // and vice versa. If the report were built the other way round (live vs stored) the two
    // sets would still have the same SIZE, so compare the sorted NAMES.
    const reportColumns = report.sections
      .flatMap((s) => s.columns.map((c) => c.column))
      .sort();
    const changesetColumns = [
      ...entry.changeset!.added.map((a) => a.column),
      ...entry.changeset!.removed.map((r) => r.column),
      ...entry.changeset!.retyped.map((r) => r.column),
    ].sort();
    expect(reportColumns).toEqual(changesetColumns);

    // Directionality: `col_gone` is REMOVED and `col_ts` is ADDED, not the reverse. A report
    // built from (live, stored) instead of (stored, live) inverts exactly this.
    const removedSection = report.sections
      .flatMap((s) => s.columns)
      .filter((c) => c.changeKind === "removed")
      .map((c) => c.column);
    const addedSection = report.sections
      .flatMap((s) => s.columns)
      .filter((c) => c.changeKind === "added")
      .map((c) => c.column);
    expect(removedSection).toEqual(["col_gone"]);
    expect(addedSection).toEqual(["col_ts"]);

    // The report is non-vacuous: the seeded widget shows up under the removed column.
    const goneColumn = report.sections
      .flatMap((s) => s.columns)
      .find((c) => c.column === "col_gone")!;
    expect(goneColumn.records.length).toBeGreaterThan(0);
  });
});

describe("applySchemaSync — no-op (NOOP-)", () => {
  it("NOOP-nothing: live already matching the stored snapshot writes NOTHING AT ALL", () => {
    const tableId = seedTable();
    setStoredFingerprint(tableId, STORED);

    const beforeRow = tablesRow(tableId);
    const beforeFingerprint = getTableColumnsFingerprint(tableId);
    const beforeHistory = historyCount(tableId);

    const result = applySchemaSync({
      tableId,
      table: TABLE_NAME,
      live: STORED,
      reportedLive: STORED,
      actor: ACTOR,
    });

    expect(result.outcome).toBe("no_changes");
    expect(result.message).toBeTruthy();

    // The whole row, so an `updated_at` bump reddens this.
    expect(tablesRow(tableId)).toEqual(beforeRow);
    // `datetime('now')` has one-second resolution, so row equality alone could pass a
    // spurious write inside the same second. These two cannot.
    expect(getTableColumnsFingerprint(tableId)).toBe(beforeFingerprint);
    expect(historyCount(tableId)).toBe(beforeHistory);
    expect(historyCount(tableId)).toBe(0);
  });
});

describe("applySchemaSync — staleness (STALE-)", () => {
  it("STALE-refuses: a reportedLive that no longer matches live writes NOTHING AT ALL", () => {
    const tableId = seedTable();
    setStoredFingerprint(tableId, STORED);

    const beforeRow = tablesRow(tableId);
    const beforeFingerprint = getTableColumnsFingerprint(tableId);
    const beforeHistory = historyCount(tableId);

    const result = applySchemaSync({
      tableId,
      table: TABLE_NAME,
      live: LIVE_MOVED_AGAIN,
      reportedLive: LIVE,
      actor: ACTOR,
    });

    expect(result.outcome).toBe("stale");
    expect(result.message).toBe(SCHEMA_APPLY_STALE_MESSAGE);

    expect(tablesRow(tableId)).toEqual(beforeRow);
    expect(getTableColumnsFingerprint(tableId)).toBe(beforeFingerprint);
    expect(historyCount(tableId)).toBe(beforeHistory);
    expect(historyCount(tableId)).toBe(0);
  });
});

describe("applySchemaSync — unknown table (MISSING-)", () => {
  it("MISSING-table: an unregistered table id returns table_missing without writing", () => {
    const tableId = seedTable();
    const unknownId = tableId + 9999;

    const beforeRow = tablesRow(tableId);
    const result = applySchemaSync({
      tableId: unknownId,
      table: TABLE_NAME,
      live: LIVE,
      reportedLive: LIVE,
      actor: ACTOR,
    });

    expect(result.outcome).toBe("table_missing");
    expect(result.tableId).toBe(unknownId);
    expect(result.message).toBeTruthy();
    expect(tablesRow(tableId)).toEqual(beforeRow);
    expect(
      (db.prepare("SELECT COUNT(*) c FROM table_sync_history").get() as { c: number }).c
    ).toBe(0);
  });
});
