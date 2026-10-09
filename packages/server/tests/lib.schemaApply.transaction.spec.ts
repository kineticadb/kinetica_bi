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
import type { SchemaApplyResult } from "../src/lib/schemaApply";
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

/**
 * Pushes every seeded row's timestamps into the PAST.
 *
 * WHY THIS EXISTS — mutation probe P10, which did NOT fire without it. P10 plants a stray
 * `UPDATE widgets SET updated_at = datetime('now')` inside the apply transaction, and the
 * full-row snapshot stayed equal anyway: `datetime('now')` has ONE-SECOND resolution, the
 * fixture had just created the widget in that same second, so the stray UPDATE wrote back a
 * byte-identical value. The snapshot was faithfully comparing full rows and there was
 * genuinely nothing different to see.
 *
 * Ageing the rows to a fixed past instant makes any `datetime('now')` rewrite a VISIBLE
 * change, which is also the realistic case: in production nothing applies a schema sync in
 * the same second a widget was created.
 *
 * Raw SQL on purpose — no accessor can set a timestamp backwards, and the fixture must be
 * able to construct a state the code under test cannot produce.
 */
const AGED_TS = "2020-01-01 00:00:00";
const ageSeededRows = () => {
  db.prepare("UPDATE tables SET created_at = ?, updated_at = ?").run(AGED_TS, AGED_TS);
  db.prepare("UPDATE dashboards SET created_at = ?, updated_at = ?").run(AGED_TS, AGED_TS);
  db.prepare("UPDATE widgets SET created_at = ?, updated_at = ?").run(AGED_TS, AGED_TS);
  db.prepare("UPDATE custom_metrics SET created_at = ?, updated_at = ?").run(AGED_TS, AGED_TS);
  db.prepare("UPDATE column_display_config SET created_at = ?, updated_at = ?").run(
    AGED_TS,
    AGED_TS
  );
  // `dashboard_layers` carries NO timestamp columns at all — confirmed against the DDL. No
  // value on a layer row changes with time, so a stray write to it is invisible to ANY
  // content comparison. That is precisely the hole `expectRowWriteBudget` below closes.
};

/** Registers the synthetic table and seeds the four config tables around it. */
const seedTable = (): number => {
  const table = createTable({ name: "demo_table", schema: "demo_schema" });
  seedConfigRows(table.id);
  ageSeededRows();
  return table.id;
};

/**
 * SQLite's own count of rows modified on this connection since it was opened. A
 * content-independent counterpart to `snapshotConfigTables()`: it sees a write that stores
 * the value already there, and it sees a write to `dashboard_layers`, which has no
 * timestamp column for a row comparison to catch.
 */
const totalRowWrites = (): number =>
  (db.prepare("SELECT total_changes() AS c").get() as { c: number }).c;

/**
 * Asserts an apply modifies EXACTLY the rows it is allowed to modify, and no others.
 *
 * The budget for a successful apply is 2: one `tables` UPDATE and one `table_sync_history`
 * INSERT (the cap sweep's DELETE matches nothing until a table has 20 entries, and the meta
 * upsert only runs when something was actually dropped — both measured). For a no-op or a
 * stale refusal it is 0.
 *
 * This is the guard probe P10 needed. A stray `UPDATE widgets` inside the transaction takes
 * the budget to 3 whether or not the value it writes differs from the value already stored.
 */
const expectRowWriteBudget = (expected: number, fn: () => void) => {
  const before = totalRowWrites();
  fn();
  expect(totalRowWrites() - before).toBe(expected);
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

    // Zero rows may be written — not even an `updated_at` bump.
    let result!: SchemaApplyResult;
    expectRowWriteBudget(0, () => {
      result = applySchemaSync({
        tableId,
        table: TABLE_NAME,
        live: STORED,
        reportedLive: STORED,
        actor: ACTOR,
      });
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

    // Zero rows may be written — the refusal happens before the transaction ever opens.
    let result!: SchemaApplyResult;
    expectRowWriteBudget(0, () => {
      result = applySchemaSync({
        tableId,
        table: TABLE_NAME,
        live: LIVE_MOVED_AGAIN,
        reportedLive: LIVE,
        actor: ACTOR,
      });
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

// ─── Criterion 2: only the `tables` row changed (ONLYTABLES-) ─────────────────────────

/**
 * Full-ROW snapshot of the four tables ROADMAP criterion 2 names. Rows, not counts: a count
 * snapshot passes when a row is silently rewritten in place, which is precisely the failure
 * mode "no widget, layer, metric or format rule is ever rewritten" forbids. The precedent
 * this upgrades past -- `lib.dashboardImport.apply.spec.ts`'s `countRows()` -- is
 * count-based, and was adequate there because that spec proves rows were never CREATED.
 */
const snapshotConfigTables = () => ({
  widgets: db.prepare("SELECT * FROM widgets ORDER BY id").all(),
  layers: db.prepare("SELECT * FROM dashboard_layers ORDER BY id").all(),
  metrics: db.prepare("SELECT * FROM custom_metrics ORDER BY id").all(),
  columnDisplayConfig: db
    .prepare("SELECT * FROM column_display_config ORDER BY table_id, column_name")
    .all(),
});

/**
 * Guards the snapshot against vacuity. A snapshot of four empty arrays compares equal to
 * itself no matter what the code under test did -- Phase 124's plan checker caught exactly
 * that test, and it would have passed forever. Called before EVERY `toEqual` below.
 */
const expectNonVacuous = (s: ReturnType<typeof snapshotConfigTables>) => {
  expect(s.widgets.length).toBeGreaterThan(0);
  expect(s.layers.length).toBeGreaterThan(0);
  expect(s.metrics.length).toBeGreaterThan(0);
  expect(s.columnDisplayConfig.length).toBeGreaterThan(0);
};

describe("applySchemaSync — only the tables row changed (ONLYTABLES-)", () => {
  it("ONLYTABLES-seeded: the fixture puts real rows in all four tables criterion 2 names", () => {
    const tableId = seedTable();
    const snap = snapshotConfigTables();
    expectNonVacuous(snap);
    // Named explicitly as well, so a helper that silently stopped checking one table would
    // still be caught here.
    expect(snap.widgets).toHaveLength(1);
    expect(snap.layers).toHaveLength(1);
    expect(snap.metrics).toHaveLength(1);
    expect(snap.columnDisplayConfig).toHaveLength(1);
    expect(tableId).toBeGreaterThan(0);
  });

  it("ONLYTABLES-diff: a diff apply leaves all four config tables byte-identical and changes only the tables row", () => {
    const tableId = seedTable();
    setStoredFingerprint(tableId, STORED);

    const before = snapshotConfigTables();
    expectNonVacuous(before);
    const beforeTablesRow = tablesRow(tableId);

    // Exactly two rows may be written: the `tables` row and the history entry. A stray
    // `UPDATE widgets` inside the transaction breaks this even when it writes back the value
    // already stored — which is exactly what probe P10 does.
    let result!: SchemaApplyResult;
    expectRowWriteBudget(2, () => {
      result = applySchemaSync({
        tableId,
        table: TABLE_NAME,
        live: LIVE,
        reportedLive: LIVE,
        actor: ACTOR,
      });
    });
    expect(result.outcome).toBe("applied");
    if (result.outcome !== "applied") throw new Error("unreachable");
    expect(result.kind).toBe("diff");

    const after = snapshotConfigTables();
    expect(after).toEqual(before);

    // ...and the `tables` row DID change, in both snapshot halves. Without this the test
    // above would also pass against a function that did nothing whatsoever.
    const afterTablesRow = tablesRow(tableId);
    expect(afterTablesRow.columns).not.toEqual(beforeTablesRow.columns);
    expect(afterTablesRow.columns_fingerprint).not.toEqual(beforeTablesRow.columns_fingerprint);
    // `ageSeededRows` put the row's timestamps at AGED_TS, so this is a real comparison
    // rather than one that `datetime('now')`'s one-second resolution would make vacuous.
    expect(beforeTablesRow.updated_at).toBe(AGED_TS);
    expect(afterTablesRow.updated_at).not.toBe(AGED_TS);
    expect(getTableColumnsFingerprint(tableId)).toBe(serializeFingerprintSnapshot(LIVE));

    // The written `tables.columns` keeps the TYPE CLASS, rather than flattening the
    // temporal column back into the number it was before v1.25's renderer existed. A
    // base-only renderer would write "long" here.
    expect(result.columns.col_ts).toBe("timestamp");
    expect(result.columns.col_b).toBe("string(char16)");
    expect(getTable(tableId)!.columns).toEqual({
      col_a: "long",
      col_b: "string(char16)",
      col_ts: "timestamp",
    });
  });

  it("ONLYTABLES-baseline: a baseline apply leaves all four config tables byte-identical too", () => {
    const tableId = seedTable();
    expect(getTableColumnsFingerprint(tableId)).toBeNull();

    const before = snapshotConfigTables();
    expectNonVacuous(before);
    const beforeTablesRow = tablesRow(tableId);

    let result!: SchemaApplyResult;
    expectRowWriteBudget(2, () => {
      result = applySchemaSync({
        tableId,
        table: TABLE_NAME,
        live: LIVE,
        reportedLive: LIVE,
        actor: ACTOR,
      });
    });
    expect(result.outcome).toBe("applied");
    if (result.outcome !== "applied") throw new Error("unreachable");
    expect(result.kind).toBe("baseline");

    const after = snapshotConfigTables();
    expect(after).toEqual(before);

    const afterTablesRow = tablesRow(tableId);
    expect(afterTablesRow.columns).not.toEqual(beforeTablesRow.columns);
    expect(afterTablesRow.columns_fingerprint).not.toEqual(beforeTablesRow.columns_fingerprint);
    expect(afterTablesRow.columns_fingerprint).toBe(serializeFingerprintSnapshot(LIVE));
  });

  it("ONLYTABLES-breaking: an apply carrying BOTH removals and retypes is applied, not refused", () => {
    const tableId = seedTable();
    setStoredFingerprint(tableId, STORED);

    const before = snapshotConfigTables();
    expectNonVacuous(before);

    // SSYNC-V125-15. Note what this test CANNOT do, and what that absence means: there is no
    // second argument to pass, no `{ force: true }` to omit, and no findings-acknowledgement
    // call to skip. The refusal that does not exist cannot be exercised -- its absence is a
    // property of applySchemaSync's input type, which `npx tsc --noEmit` enforces.
    let result!: SchemaApplyResult;
    expectRowWriteBudget(2, () => {
      result = applySchemaSync({
        tableId,
        table: TABLE_NAME,
        live: LIVE,
        reportedLive: LIVE,
        actor: ACTOR,
      });
    });

    expect(result.outcome).toBe("applied");
    if (result.outcome !== "applied") throw new Error("unreachable");
    expect(result.changeset!.removed.length).toBeGreaterThan(0);
    expect(result.changeset!.retyped.length).toBeGreaterThan(0);
    expect(result.recorded).toBe(true);

    // The removal is BREAKING and the seeded widget depends on it -- so this is a genuinely
    // destructive apply that went through, not a cosmetic one.
    const report = listTableSyncHistory(tableId).entries[0].report!;
    const breaking = report.sections.find((s) => s.severity === "breaking")!;
    expect(breaking.columns.map((c) => c.column)).toContain("col_gone");

    expect(snapshotConfigTables()).toEqual(before);
  });
});

// ─── Atomicity (ROLLBACK-) ────────────────────────────────────────────────────────────

/**
 * Installs a `RAISE(ABORT)` trigger on `table` for the duration of `fn`, then ALWAYS drops
 * it -- even if `fn` throws (which it is expected to, in every caller here). A leaked
 * trigger would silently redden every OTHER spec file that inserts into the same table days
 * later, and `test-gate.mjs`'s set-based re-run would misattribute it to
 * TD-V16-TEST-ISOLATION instead of surfacing the real regression. The `finally` here plus
 * the module-level `beforeEach` drop (above) are the two lines this file's own acceptance
 * criteria count.
 *
 * The trigger NAME is deliberately distinct from `lib.dashboardImport.apply.spec.ts`'s
 * `kbi_test_abort`: under parallel scheduling the two spec files must never be able to fight
 * over one name.
 */
const withAbortTriggerOn = (table: string, fn: () => void) => {
  db.exec("DROP TRIGGER IF EXISTS kbi_test_abort_sync;");
  db.exec(
    `CREATE TRIGGER kbi_test_abort_sync BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'induced apply failure'); END;`
  );
  try {
    fn();
  } finally {
    db.exec("DROP TRIGGER IF EXISTS kbi_test_abort_sync;");
  }
};

describe("applySchemaSync — atomicity (ROLLBACK-)", () => {
  it("ROLLBACK-history: an aborted history insert rolls the snapshot update back with it", () => {
    const tableId = seedTable();
    setStoredFingerprint(tableId, STORED);

    const beforeRow = tablesRow(tableId);
    const beforeFingerprint = getTableColumnsFingerprint(tableId);
    const beforeConfig = snapshotConfigTables();

    withAbortTriggerOn("table_sync_history", () => {
      expect(() =>
        applySchemaSync({
          tableId,
          table: TABLE_NAME,
          live: LIVE,
          reportedLive: LIVE,
          actor: ACTOR,
        })
      ).toThrow();
    });

    // The `tables` row is byte-identical: the snapshot UPDATE ran first, inside the same
    // transaction, and must have been rolled back by the aborted insert that followed it.
    expect(tablesRow(tableId)).toEqual(beforeRow);
    expect(getTableColumnsFingerprint(tableId)).toBe(beforeFingerprint);
    expect(historyCount(tableId)).toBe(0);
    expect(snapshotConfigTables()).toEqual(beforeConfig);
  });

  it("ROLLBACK-clean: with no trigger installed the SAME fixture applies successfully", () => {
    const tableId = seedTable();
    setStoredFingerprint(tableId, STORED);

    // The control run. Without it, ROLLBACK-history would also pass against a fixture that
    // could never apply in the first place -- and against a trigger leaked from a previous
    // test, which is the exact failure `withAbortTriggerOn`'s `finally` exists to prevent.
    const result = applySchemaSync({
      tableId,
      table: TABLE_NAME,
      live: LIVE,
      reportedLive: LIVE,
      actor: ACTOR,
    });

    expect(result.outcome).toBe("applied");
    if (result.outcome !== "applied") throw new Error("unreachable");
    expect(result.kind).toBe("diff");
    expect(historyCount(tableId)).toBe(1);
    expect(getTableColumnsFingerprint(tableId)).toBe(serializeFingerprintSnapshot(LIVE));
  });
});
