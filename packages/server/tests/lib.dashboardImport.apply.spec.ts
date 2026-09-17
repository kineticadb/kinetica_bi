/**
 * lib.dashboardImport.apply.spec.ts — Phase 120 Plan 03 (DXIM-V124-03/-04/-09/-10)
 *
 * `applyDashboardImport` — the whole two-pass create-then-rewrite sequence, inside one
 * `db.transaction`, returning an `ImportReport`.
 *
 * Task 1 (`APPLY-*` / `NEWID-*` / `REPORT-*`): the fixture is built by seeding a real dashboard
 * through the normal `create*` accessors and exporting it via `buildDashboardExport` — a REAL
 * export, not a hand-written approximation that could drift from the envelope shape — then the
 * target is reset to empty before import. `NEWID-collision` seeds a target dashboard AND widgets
 * that occupy the EXACT ids the file carries (via raw `db.prepare` inserts, since AUTOINCREMENT
 * never reuses an id through the normal accessors) and proves those rows are byte-identical
 * after import, and that every newly created id differs from every id the file carries.
 *
 * Task 2 (`ATOMIC-*`): three SQLite `RAISE(ABORT)` triggers, installed and dropped per test,
 * prove rollback at three different points in Pass 1 — widgets, layers, and the LAST creation
 * step (custom metrics) — each asserting the FULL `countRows()` snapshot (all seven affected
 * tables) is unchanged, not just the table the trigger fired on.
 *
 * DIVERGENCE FROM RESEARCH Q5: research recommended a NATURAL fault — seed the target with a
 * `(table_id, label)` collision and let the real `UNIQUE(table_id, label)` constraint fire. That
 * fault is NOT reachable: Plan 120-02's `resolveCustomMetrics` does a fresh `listCustomMetrics`
 * lookup per metric and REUSES an exact label match rather than colliding with it — any row a
 * test seeds out-of-band is visible to that same lookup, so import matches it instead of
 * inserting a duplicate. A SQLite TRIGGER is used instead: it needs ZERO test-only code in
 * production (unlike a `failAfter` seam), it is fully deterministic (unlike a constraint race),
 * and it can be attached at multiple points rather than only one.
 *
 * MUTATION PROBES (Plan 120-03 Task 3) — 6 probes run for real against the committed
 * dashboardImport.ts, each expected to redden a named test (or, for A2, a LATER plan's test),
 * then reverted; `git diff --exit-code` confirmed the source byte-identical afterward.
 * A1 removed the `db.transaction(...)` wrapper and called the body directly
 *      -> reddened every ATOMIC- rollback test (ATOMIC-widgets, ATOMIC-layers, ATOMIC-metrics):
 *      with no transaction, a trigger-induced throw leaves every already-inserted row in place.
 * A2 changed the widget placeholder from `config: {}` to `config: w.config` (the "obvious"
 *      shortcut)
 *      -> did NOT redden anything in THIS spec: `NEWID-collision: no widget on the NEW dashboard
 *      has a config equal to {}` still passes, because Pass 2 still rewrites every widget's
 *      config afterward, overwriting the placeholder regardless of what it started as. This
 *      probe's real discriminating test is a Plan 120-05 per-reference-kind correctness proof
 *      (a widget referencing a SIBLING not yet created at Pass-1-widget-creation time would read
 *      an OLD id off `w.config` for one JSON-round-trip inside the same transaction — invisible
 *      here because Pass 2 runs before the transaction commits and no test reads intermediate
 *      state). DEFERRED to Plan 120-05, as the plan's own Task 3 anticipated.
 * A3 moved the Pass-2 widget rewrite loop INSIDE the Pass-1 widget creation loop
 *      (rewrite-as-you-go)
 *      -> reddened "APPLY-create: every layer in the file exists..." indirectly via
 *      "NEWID-collision: no widget on the NEW dashboard has a config equal to {}" and the
 *      REPORT- stripped-reference count test: a widget referencing a LAYER (REF-6,
 *      includedLayerIds) cannot resolve yet at widget-creation time (layers are created in
 *      Pass-1 step 5, AFTER widgets in step 4), so that reference is incorrectly stripped —
 *      this is the exact "clever ordering" `<the_cycle>` explains cannot work.
 * A4 skipped step 9 (`addDashboardTable`) entirely
 *      -> reddened "APPLY-create: dashboardTableIds are re-associated via dashboard_tables on
 *      the NEW dashboard"
 * A5 dropped the Pass-2 layer `filter_scope` update
 *      -> reddened "APPLY-create: every layer in the file exists with its layer_type, position,
 *      config, cb_config and track_config" (strengthened in this task to also assert
 *      filter_scope is a non-null string naming the new widget id — the plan's own Task 3
 *      instruction to add one if none existed)
 * A6 deleted the "pass 2 rewrote N of M widgets" invariant throw and made the loop skip the
 *      last widget
 *      -> reddened "NEWID-collision: no widget on the NEW dashboard has a config equal to {}"
 * All probes applied to `src/lib/dashboardImport.ts`, run, reverted via `git checkout --`;
 * `git diff --exit-code -- src/lib/dashboardImport.ts` confirmed byte-identical afterward.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  db,
  createDashboard,
  updateDashboard,
  createTable,
  createWidget,
  updateWidget,
  createDashboardLayer,
  updateDashboardLayer,
  createDashboardDynamicView,
  createCustomMetric,
  addDashboardTable,
  listWidgets,
  listDashboardLayers,
  listDashboardDynamicViews,
  listDashboardTables,
  getDashboard,
} from "../src/db";
import { buildDashboardExport } from "../src/lib/dashboardExport";
import { applyDashboardImport } from "../src/lib/dashboardImport";
import type { DashboardExportFile } from "../src/lib/dashboardExport";

// ─── Fixture ──────────────────────────────────────────────────────────────────

/**
 * Seeds a real dashboard (2 tables, 1 metric, 1 dynamic view, 1 layer with cb_config/
 * track_config/dynamic_view_id/filter_scope, 3 widgets covering REF-3/REF-4/REF-6/the sixth
 * site), exports it via `buildDashboardExport` (a REAL export, never a hand-written
 * approximation), then resets the target to empty so import lands in a clean database. Also
 * seeds one deliberately-dangling reference (an `dynamicViewId` on the Bar widget pointing at an
 * id absent from the whole file) so REPORT-'s stripped-reference assertion has something real to
 * find.
 */
const buildFixtureFile = (): DashboardExportFile => {
  resetDb();

  const tMain = createTable({ schema: "kbi_apply", name: "t_main", columns: { c1: "int" } });
  const tOrphan = createTable({ schema: "kbi_apply", name: "t_orphan", columns: { c1: "int" } });

  let dash = createDashboard("Apply Fixture Dashboard", "seeded for lib.dashboardImport.apply.spec.ts");
  dash = updateDashboard(dash.id, { filter_display_mode: "panel" })!;
  addDashboardTable(dash.id, tMain.id);
  addDashboardTable(dash.id, tOrphan.id);

  const metric = createCustomMetric(tMain.id, "Fixture Metric", "SUM(c1)", null);

  const dv = createDashboardDynamicView(dash.id, {
    source_table_id: tMain.id,
    name: "Fixture DV",
    template_sql: "SELECT * FROM {view}",
    max_records: 500,
    columns_json: [{ name: "c1", type: "int" }],
  });

  const layer = createDashboardLayer(dash.id, { table_id: tMain.id, position: 0, config: { opacity: 0.4 } });
  updateDashboardLayer(layer.id, {
    cb_config: '{"mode":"quantile","breaks":[1,2,3]}',
    track_config: '{"trackIdColumn":"veh"}',
    dynamic_view_id: dv.id,
  });

  const wMap = createWidget(dash.id, { title: "Fixture Map", type: "map", position: 0, config: {} });
  const wLegend = createWidget(dash.id, {
    title: "Fixture Legend",
    type: "legend",
    position: 1,
    config: { sourceMapWidgetId: 0 }, // patched below once wMap's id is known
  });
  const wBar = createWidget(dash.id, {
    title: "Fixture Bar",
    type: "bar",
    position: 2,
    config: {
      tableId: tMain.id,
      metricId: metric.id,
      dynamicViewId: 999999999, // deliberately dangling — no such id anywhere in this file
    },
  });

  updateWidget(wMap.id, { config: { includedLayerIds: [layer.id] } }); // REF-6
  updateWidget(wLegend.id, { config: { sourceMapWidgetId: wMap.id } }); // REF-3

  // Sixth site: layer.filter_scope names a widget.
  updateDashboardLayer(layer.id, {
    filter_scope: JSON.stringify({ sourceMode: "allowlist", allowedSourceWidgetIds: [wBar.id] }),
  });

  const file = buildDashboardExport(dash.id)!;
  resetDb(); // land the import in an empty target
  return file;
};

const resetDb = () => {
  db.exec(`
    DELETE FROM dashboard_access_grants;
    DELETE FROM column_display_config;
    DELETE FROM dashboard_table_views;
    DELETE FROM dashboard_layers;
    DELETE FROM dashboard_dynamic_views;
    DELETE FROM widgets;
    DELETE FROM dashboard_tables;
    DELETE FROM custom_metrics;
    DELETE FROM dashboards;
    DELETE FROM tables;
    DELETE FROM sessions;
  `);
};

beforeEach(() => {
  db.exec("DROP TRIGGER IF EXISTS kbi_test_abort;"); // crash-safety net for a prior test's leak
  resetDb();
});

// ─── Task 1: APPLY-create / NEWID-collision / REPORT- ──────────────────────────

describe("applyDashboardImport — creation + report (APPLY-create / REPORT-)", () => {
  it("APPLY-create: the imported dashboard exists with the file's name and description", () => {
    const file = buildFixtureFile();
    const report = applyDashboardImport(file);
    const created = getDashboard(report.dashboardId)!;
    expect(created.name).toBe(file.dashboard.name);
    expect(created.description).toBe(file.dashboard.description);
  });

  it("APPLY-create: filter_display_mode travels from the file", () => {
    const file = buildFixtureFile();
    expect(file.dashboard.filter_display_mode).toBe("panel");
    const report = applyDashboardImport(file);
    const created = getDashboard(report.dashboardId)!;
    expect(created.filter_display_mode).toBe("panel");
  });

  it("APPLY-create: every widget in the file exists on the new dashboard with its title, type and position", () => {
    const file = buildFixtureFile();
    const report = applyDashboardImport(file);
    const created = listWidgets(report.dashboardId);
    expect(created).toHaveLength(file.widgets.length);
    const byTitle = new Map(created.map((w) => [w.title, w]));
    for (const w of file.widgets) {
      const match = byTitle.get(w.title);
      expect(match).toBeDefined();
      expect(match!.type).toBe(w.type);
      expect(match!.position).toBe(w.position);
    }
  });

  it("APPLY-create: every layer in the file exists with its layer_type, position, config, cb_config and track_config", () => {
    const file = buildFixtureFile();
    const report = applyDashboardImport(file);
    const created = listDashboardLayers(report.dashboardId);
    expect(created).toHaveLength(file.layers.length);
    const fileLayer = file.layers[0];
    const createdLayer = created[0];
    expect(createdLayer.layer_type).toBe(fileLayer.layer_type);
    expect(createdLayer.position).toBe(fileLayer.position);
    expect(createdLayer.config).toEqual(fileLayer.config);
    expect(createdLayer.cb_config).toBe(fileLayer.cb_config);
    expect(createdLayer.track_config).toBe(fileLayer.track_config);
    // filter_scope must have been rewritten to the NEW widget id, not left null and not left
    // pointing at the file's OLD widget id (Task 3's A5 probe target). mapDashboardLayer parses
    // the stored JSON-as-TEXT column back to an object on read (db.ts's own documented "object on
    // the wire, string in DB" contract), so no JSON.parse is needed here.
    expect(createdLayer.filter_scope).not.toBeNull();
    const parsedScope = createdLayer.filter_scope as unknown as { allowedSourceWidgetIds: number[] };
    const createdWidgets = listWidgets(report.dashboardId);
    const newBarId = createdWidgets.find((w) => w.title === "Fixture Bar")!.id;
    expect(parsedScope.allowedSourceWidgetIds).toEqual([newBarId]);
  });

  it("APPLY-create: every dynamic view in the file exists with its template_sql, max_records and columns_json", () => {
    const file = buildFixtureFile();
    const report = applyDashboardImport(file);
    const created = listDashboardDynamicViews(report.dashboardId);
    expect(created).toHaveLength(file.dynamicViews.length);
    expect(created[0].template_sql).toBe(file.dynamicViews[0].template_sql);
    expect(created[0].max_records).toBe(file.dynamicViews[0].max_records);
    expect(created[0].columns_json).toEqual(file.dynamicViews[0].columns_json);
  });

  it("APPLY-create: dashboardTableIds are re-associated via dashboard_tables on the NEW dashboard", () => {
    const file = buildFixtureFile();
    expect(file.dashboardTableIds).toHaveLength(2);
    const report = applyDashboardImport(file);
    const associated = listDashboardTables(report.dashboardId);
    expect(associated).toHaveLength(2);
  });

  it("REPORT-: the report names the NEW dashboard id and it differs from the file's dashboard id", () => {
    const file = buildFixtureFile();
    const report = applyDashboardImport(file);
    expect(typeof report.dashboardId).toBe("number");
    expect(report.dashboardId).not.toBe(file.dashboard.id);
  });

  it("REPORT-: the report lists tables matched and tables created, and their union covers every file table", () => {
    const file = buildFixtureFile();
    const report = applyDashboardImport(file);
    expect(report.tablesMatched.length + report.tablesCreated.length).toBe(file.tables.length);
  });

  it("REPORT-: the report lists metrics created with their target ids", () => {
    const file = buildFixtureFile();
    const report = applyDashboardImport(file);
    expect(report.metricsCreated.length).toBeGreaterThanOrEqual(1);
    for (const m of report.metricsCreated) expect(typeof m.newId).toBe("number");
  });

  it("REPORT-: widgetsCreated / layersCreated / dynamicViewsCreated equal the file's collection lengths", () => {
    const file = buildFixtureFile();
    const report = applyDashboardImport(file);
    expect(report.widgetsCreated).toBe(file.widgets.length);
    expect(report.layersCreated).toBe(file.layers.length);
    expect(report.dynamicViewsCreated).toBe(file.dynamicViews.length);
  });

  it("REPORT-: a stripped reference appears in strippedReferences with its kind and OLD id", () => {
    const file = buildFixtureFile();
    const report = applyDashboardImport(file);
    const hit = report.strippedReferences.find((s) => s.kind === "dynamicView" && s.id === 999999999);
    expect(hit).toBeDefined();
  });
});

// ─── Task 1: NEWID-collision ────────────────────────────────────────────────────

describe("applyDashboardImport — always-new ids (NEWID-collision)", () => {
  /**
   * AUTOINCREMENT never reuses an id, even across DELETE, so a genuine id collision cannot be
   * produced through the normal accessors after a reset. This directly inserts a "pre-existing"
   * dashboard and widget rows at the EXACT ids the file carries — the collision fixture is the
   * point — and returns their full rows for a byte-identical comparison after import.
   */
  const seedCollidingPreexistingRows = (file: DashboardExportFile) => {
    db.prepare(
      "INSERT INTO dashboards (id, name, description, filter_display_mode) VALUES (?, ?, ?, ?)"
    ).run(file.dashboard.id, "PRE-EXISTING DASHBOARD", "must not change", "topbar");
    for (const w of file.widgets) {
      db.prepare(
        "INSERT INTO widgets (id, dashboard_id, title, type, position, config) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(w.id, file.dashboard.id, "PRE-EXISTING WIDGET", "bar", 0, JSON.stringify({ preexisting: true }));
    }
    const dashboardBefore = db.prepare("SELECT * FROM dashboards WHERE id = ?").get(file.dashboard.id);
    const widgetsBefore = file.widgets.map((w) => db.prepare("SELECT * FROM widgets WHERE id = ?").get(w.id));
    return { dashboardBefore, widgetsBefore };
  };

  it("NEWID-collision: importing a file whose dashboard id collides with an existing dashboard succeeds", () => {
    const file = buildFixtureFile();
    seedCollidingPreexistingRows(file);
    expect(() => applyDashboardImport(file)).not.toThrow();
  });

  it("NEWID-collision: the pre-existing dashboard row is byte-identical after the import", () => {
    const file = buildFixtureFile();
    const { dashboardBefore } = seedCollidingPreexistingRows(file);
    applyDashboardImport(file);
    const dashboardAfter = db.prepare("SELECT * FROM dashboards WHERE id = ?").get(file.dashboard.id);
    expect(dashboardAfter).toEqual(dashboardBefore);
  });

  it("NEWID-collision: the pre-existing widget rows are byte-identical after the import", () => {
    const file = buildFixtureFile();
    const { widgetsBefore } = seedCollidingPreexistingRows(file);
    applyDashboardImport(file);
    const widgetsAfter = file.widgets.map((w) => db.prepare("SELECT * FROM widgets WHERE id = ?").get(w.id));
    expect(widgetsAfter).toEqual(widgetsBefore);
  });

  it("NEWID-collision: every created widget id differs from every id in the file", () => {
    const file = buildFixtureFile();
    seedCollidingPreexistingRows(file);
    const report = applyDashboardImport(file);
    const fileWidgetIds = new Set(file.widgets.map((w) => w.id));
    const createdWidgetIds = listWidgets(report.dashboardId).map((w) => w.id);
    for (const id of createdWidgetIds) expect(fileWidgetIds.has(id)).toBe(false);
  });

  it("NEWID-collision: no widget on the NEW dashboard has a config equal to {} (all were rewritten)", () => {
    const file = buildFixtureFile();
    seedCollidingPreexistingRows(file);
    const report = applyDashboardImport(file);
    const created = listWidgets(report.dashboardId);
    for (const w of created) expect(w.config).not.toEqual({});
  });
});

// ─── Task 2: ATOMIC- (trigger-induced rollback proofs) ─────────────────────────

/**
 * Full row-count snapshot across every table `applyDashboardImport` can write. A per-table
 * `toBe` would let a stray row in an unchecked table slip through unnoticed — a single `toEqual`
 * covering all seven tables does not.
 */
const countRows = () => ({
  dashboards: (db.prepare("SELECT COUNT(*) c FROM dashboards").get() as any).c,
  widgets: (db.prepare("SELECT COUNT(*) c FROM widgets").get() as any).c,
  layers: (db.prepare("SELECT COUNT(*) c FROM dashboard_layers").get() as any).c,
  dynamicViews: (db.prepare("SELECT COUNT(*) c FROM dashboard_dynamic_views").get() as any).c,
  tables: (db.prepare("SELECT COUNT(*) c FROM tables").get() as any).c,
  metrics: (db.prepare("SELECT COUNT(*) c FROM custom_metrics").get() as any).c,
  dashboardTables: (db.prepare("SELECT COUNT(*) c FROM dashboard_tables").get() as any).c,
});

/**
 * Installs a `RAISE(ABORT)` trigger on `table` for the duration of `fn`, then ALWAYS drops it —
 * even if `fn` throws (which it is expected to, in every caller here). A leaked trigger would
 * silently redden every OTHER spec file that inserts into the same table days later, and
 * `test-gate.mjs`'s set-based re-run would misattribute it to `TD-V16-TEST-ISOLATION` instead of
 * surfacing the real regression. The `finally` here plus the `beforeEach` module-level drop
 * (above) are the two lines this file's own acceptance criteria count.
 */
const withAbortTriggerOn = (table: string, fn: () => void) => {
  db.exec("DROP TRIGGER IF EXISTS kbi_test_abort;");
  db.exec(
    `CREATE TRIGGER kbi_test_abort BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'induced import failure'); END;`
  );
  try {
    fn();
  } finally {
    db.exec("DROP TRIGGER IF EXISTS kbi_test_abort;");
  }
};

describe("applyDashboardImport — atomicity (ATOMIC-)", () => {
  it("ATOMIC-widgets: a failure at the first widget insert leaves zero new rows in ANY table", () => {
    const file = buildFixtureFile();
    const before = countRows();
    withAbortTriggerOn("widgets", () => {
      expect(() => applyDashboardImport(file)).toThrow();
    });
    const after = countRows();
    expect(after).toEqual(before);
  });

  it("ATOMIC-widgets: the table row created earlier in the same import is rolled back too", () => {
    const file = buildFixtureFile();
    const beforeTables = (db.prepare("SELECT COUNT(*) c FROM tables").get() as any).c;
    withAbortTriggerOn("widgets", () => {
      expect(() => applyDashboardImport(file)).toThrow();
    });
    const afterTables = (db.prepare("SELECT COUNT(*) c FROM tables").get() as any).c;
    // Tables (Pass 1 step 1) are created strictly before widgets (step 4) in the same
    // transaction — proving THIS count is unchanged proves rollback reached backward across
    // entity kinds, not merely that the failing insert itself never landed.
    expect(afterTables).toBe(beforeTables);
  });

  it("ATOMIC-layers: a failure at the first layer insert leaves zero new rows in ANY table", () => {
    const file = buildFixtureFile();
    const before = countRows();
    withAbortTriggerOn("dashboard_layers", () => {
      expect(() => applyDashboardImport(file)).toThrow();
    });
    const after = countRows();
    expect(after).toEqual(before);
  });

  it("ATOMIC-layers: the dashboard, widgets and dynamic views created earlier are all rolled back", () => {
    const file = buildFixtureFile();
    const before = {
      dashboards: (db.prepare("SELECT COUNT(*) c FROM dashboards").get() as any).c,
      widgets: (db.prepare("SELECT COUNT(*) c FROM widgets").get() as any).c,
      dynamicViews: (db.prepare("SELECT COUNT(*) c FROM dashboard_dynamic_views").get() as any).c,
    };
    withAbortTriggerOn("dashboard_layers", () => {
      expect(() => applyDashboardImport(file)).toThrow();
    });
    const after = {
      dashboards: (db.prepare("SELECT COUNT(*) c FROM dashboards").get() as any).c,
      widgets: (db.prepare("SELECT COUNT(*) c FROM widgets").get() as any).c,
      dynamicViews: (db.prepare("SELECT COUNT(*) c FROM dashboard_dynamic_views").get() as any).c,
    };
    expect(after).toEqual(before);
  });

  it("ATOMIC-metrics: a failure at the custom_metrics insert — the LAST creation step — still rolls back everything", () => {
    const file = buildFixtureFile();
    // The fixture's customMetrics must resolve to a metric the (freshly-reset, empty) target
    // does not already have, or the trigger never fires (resolveCustomMetrics matches instead of
    // inserting) — ATOMIC-clean (below) proves this fixture creates >= 1 metric on a clean import.
    const before = countRows();
    withAbortTriggerOn("custom_metrics", () => {
      expect(() => applyDashboardImport(file)).toThrow();
    });
    const after = countRows();
    expect(after).toEqual(before);
  });

  it("ATOMIC-throws: applyDashboardImport propagates the failure rather than returning a partial report", () => {
    const file = buildFixtureFile();
    withAbortTriggerOn("dashboard_layers", () => {
      let threw = false;
      let result: unknown;
      try {
        result = applyDashboardImport(file);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
      expect(result).toBeUndefined();
    });
  });

  // Run LAST (declaration order in this file is execution order for vitest's default sequential
  // scheduling within one file): if any trigger above leaked, this control fails loudly here
  // instead of silently reddening an unrelated spec file three days later.
  it("ATOMIC-clean: with no trigger installed, the same file imports successfully", () => {
    const file = buildFixtureFile();
    const report = applyDashboardImport(file);
    expect(report.dashboardId).toBeGreaterThan(0);
    // Also the fixture-validity proof ATOMIC-metrics depends on: this fixture DOES create at
    // least one metric on a clean import, so the metrics trigger above genuinely fires on an
    // INSERT rather than being skipped by resolveCustomMetrics' match-and-reuse path.
    expect(report.metricsCreated.length).toBeGreaterThanOrEqual(1);
  });
});
