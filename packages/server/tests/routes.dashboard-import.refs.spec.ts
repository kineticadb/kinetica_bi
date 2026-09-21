/**
 * routes.dashboard-import.refs.spec.ts — Phase 120 Plan 05 (DXIM-V124-03/-04/-05/-06/-07/-09/-10/-11)
 *
 * The claim the whole Import phase exists to support, tested directly: EVERY reference inside an
 * imported widget's config — plus the sixth-site layer `filter_scope` and the `dashboard_tables`
 * union edge — points at the NEWLY created/matched record, verified PER REFERENCE KIND
 * (IMPNEW-REF1..REF8), not inferred from "the dashboard rendered" or a naive round trip.
 *
 * THE ARMED FIXTURE. The kitchen-sink dashboard is seeded exactly as
 * `routes.dashboard-export.spec.ts` does (all eight reference kinds + the sixth site), exported
 * for real over `GET /api/dashboards/:id/export`, then ONLY `file.tables[].schema` is rewritten to
 * `"kbi_target"` before `POST /api/dashboards/import`. That single change is what forces genuinely
 * old->new `tableIdMap`/`metricIdMap` (tables no longer match by `schema.name`, so they are
 * CREATED, and the new tables carry no custom metrics, so metrics are CREATED too) while every
 * OLD id in the file still resolves to the original kitchen-sink dashboard's own, untouched rows —
 * `IMPNEW-decoy` asserts that trap stays armed. An import that skipped remapping entirely would
 * therefore still produce a working-looking dashboard pointing at those pre-existing rows, and
 * every `IMPNEW-*` test below would fail to catch it if the fixture were not armed this way.
 *
 * ONE-DATABASE LIMITATION (state prominently, do not smooth over). Every assertion here runs
 * inside a single SQLite connection. This proves reference REMAPPING; it does NOT prove
 * cross-environment PORTABILITY — that is Phase 121's operator round-trip between two real
 * environments. In particular REF-2 (`dynamicViewId`), REF-4 (scalar `metricId`) and REF-5
 * (`metrics[].metricId`) have NEVER been exercised outside a fixture: the operator's real Phase 119
 * export contained no dynamic views and no custom metrics. Phase 121 should ask the operator to
 * build a dashboard using a custom metric AND a dynamic view before the cross-environment round
 * trip, or those three kinds will still never have run outside a test.
 *
 * All eight kinds, named for the grep-based coverage check below: IMPNEW-REF1 (tableId),
 * IMPNEW-REF2 (dynamicViewId, config site + the new dynamic view's own source_table_id),
 * IMPNEW-REF3 (sourceMapWidgetId), IMPNEW-REF4 (scalar metricId, config site + the new metric
 * row's table_id), IMPNEW-REF5 (metrics[].metricId, config site + a distinct new row),
 * IMPNEW-REF6 (includedLayerIds), IMPNEW-REF7 (allowedSourceWidgetIds, config site + the sixth
 * layer `filter_scope` site), IMPNEW-REF8 (options[].actions[]/legacy singular action, all three
 * target kinds).
 *
 * Do NOT assert a fixed total server pass-count (SET-BASED TD-V16-TEST-ISOLATION gate).
 *
 * MUTATION PROBES (Plan 120-05 Task 2) — twelve probes run for real against the committed
 * dashboardExportRefs.ts / dashboardImport.ts, each reddening at least its named test below, then
 * reverted; `git diff --exit-code` confirmed the source byte-identical afterward each time. All
 * 12/12 fired on the FIRST attempt — no test required strengthening.
 * M1  deleted the REF-1 `tableId` block from `visitWidgetConfigRefs`
 *       -> reddened "IMPNEW-REF1: the imported bar widget's tableId is the NEW table id..."
 * M2  deleted the REF-2 `dynamicViewId` block
 *       -> reddened "IMPNEW-REF2: the imported calendar widget's dynamicViewId is the NEW..."
 * M3  deleted the REF-3 `sourceMapWidgetId` block
 *       -> reddened "IMPNEW-REF3: the imported legend's sourceMapWidgetId is the NEW map..."
 * M4  deleted the REF-4 scalar `metricId` block
 *       -> reddened "IMPNEW-REF4: the imported bar widget's scalar metricId is the NEW..." — the
 *       shared traversal also drives EXPORT's own collector, so removing the block additionally
 *       means the scalar metric is no longer collected at export time at all, cascading into the
 *       two REF-4/-5 extra-proof tests too (wider blast radius than the single named test, still
 *       a correct and expected consequence of the one-traversal-two-directions design).
 * M5  deleted the REF-5 `metrics[]` loop
 *       -> reddened "IMPNEW-REF5: the imported numericline's metrics[0].metricId is the NEW..."
 *       and the REF-5 extra-proof test (same shared-traversal cascade as M4).
 * M6  deleted the REF-6 `includedLayerIds` loop
 *       -> reddened "IMPNEW-REF6: the imported map widget's includedLayerIds are the two NEW..."
 * M7  deleted the REF-7 `visitFilterSelectionRefs(cfg.filterSelection, visit)` call (config site)
 *       -> reddened "IMPNEW-REF7: the imported numericline's allowedSourceWidgetIds numeric
 *       entry is the NEW widget id" and "IMPTRAP7: allowedSourceWidgetIds is exactly [...]".
 * M8  deleted the REF-8 `options[]` loop
 *       -> reddened all three `IMPNEW-REF8:` tests (widget-kind, layer-kind, legacy singular).
 * M9  in `dashboardImport.ts`, skipped the Pass-2 layer `filter_scope` update (looped over `[]`)
 *       -> reddened "IMPNEW-REF7: the imported layer's filter_scope names the NEW widget id (the
 *       sixth site)" (also reddened "IMPTRAP7: ...no null or undefined entry" as a side effect of
 *       the layer's filter_scope staying null).
 * M10 in `dashboardImport.ts`, mapped `dashboardTableIds` through the identity instead of
 *     `maps.table.get(...)`
 *       -> reddened "IMPNEW-union: the two dashboard_tables associations point at NEW table ids"
 *       (also reddened `ROUNDTRIP-shape` as a side effect).
 * M11 **(deferred probe A2 from Plan 120-03)** changed the widget placeholder from `config: {}`
 *     to `config: w.config`, AND made the Pass-2 rewrite loop skip the LAST widget (the invariant
 *     that would otherwise throw and roll back the whole transaction was neutralized so the
 *     defect surfaces instead of being masked)
 *       -> reddened "IMPNEW-sweep: no imported widget config contains ANY id from the file's
 *       SAME-KIND original id set" — exactly the defect the sweep exists to catch: with the
 *       original config as the placeholder, the skipped last widget (Radio) keeps its OLD widget/
 *       layer/dynamicView ids. Also reddened the three `IMPNEW-REF8:` tests and `ROUNDTRIP-refs`
 *       as expected side effects (Radio's config carries REF-8 sites).
 * M12 in `dashboardExportRefs.ts`, replaced the REF-7 `asId`-gated loop in
 *     `visitFilterSelectionRefs` with a naive `ids.map((entry) => visit({kind:"widget",
 *     id: entry as number}))` (no sentinel gate)
 *       -> reddened BOTH `IMPTRAP7:` tests (the `__spatial_draws__` sentinel is fed into
 *       `visit()` instead of passing through, producing `undefined` in its place) and the
 *       REF-7 config-site test as a side effect.
 * 12/12 probes fired on first attempt. Phase-wide running total: 10 (120-01) + 6 (120-02) +
 * 6 (120-03) + 5 (120-04) + 12 (120-05) = 39 probes, 39/39 fired (three — V5/120-02, A3/120-03,
 * R1+R2/120-04 — required a test strengthened before they discriminated; this plan's 12 needed
 * none).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { buildTestApp } from "./helpers/app";
import { createAdminSession } from "./helpers/db";
import {
  db,
  createDashboard,
  createTable,
  addDashboardTable,
  createWidget,
  updateWidget,
  createDashboardLayer,
  updateDashboardLayer,
  createDashboardDynamicView,
  createCustomMetric,
  getWidget,
  getDashboardLayer,
  getDashboardDynamicView,
  getCustomMetric,
  getTable,
} from "../src/db";
import { collectWidgetConfigRefs } from "../src/lib/dashboardExportRefs";

// ─── Fixture ids (module-level, rebuilt in beforeEach) ───────────────────────

let dash: ReturnType<typeof createDashboard>;
let tWidget: ReturnType<typeof createTable>;
let tLayer: ReturnType<typeof createTable>;
let tDvSource: ReturnType<typeof createTable>;
let tOrphan: ReturnType<typeof createTable>;
let tUnrelated: ReturnType<typeof createTable>;
let mScalar: ReturnType<typeof createCustomMetric>;
let mArray: ReturnType<typeof createCustomMetric>;
let mOrphan: ReturnType<typeof createCustomMetric>;
let dv: ReturnType<typeof createDashboardDynamicView>;
let layerTable: ReturnType<typeof createDashboardLayer>;
let layerDv: ReturnType<typeof createDashboardLayer>;
let wBar: ReturnType<typeof createWidget>;
let wMap: ReturnType<typeof createWidget>;
let wMapAll: ReturnType<typeof createWidget>;
let wLegend: ReturnType<typeof createWidget>;
let wNumLine: ReturnType<typeof createWidget>;
let wCalendar: ReturnType<typeof createWidget>;
let wRadio: ReturnType<typeof createWidget>;

// Populated by beforeEach, exposed to every test.
let file: any; // the REAL export, then armed by rewriting tables[].schema
let report: any; // POST /api/dashboards/import response body.data (ImportReport)
let imported: any; // the re-export of the newly imported dashboard

/** Look up an imported widget by TITLE, never by array index or id — position order is not a promise. */
const newWidgetByTitle = (title: string) => imported.widgets.find((w: any) => w.title === title);
/** Look up the ORIGINAL (file) widget by TITLE — the file's widgets are never rewritten by import itself. */
const oldWidgetByTitle = (title: string) => file.widgets.find((w: any) => w.title === title);

/** The NEW target-table id for a given OLD file table id, from the report's matched+created union. */
const newTableIdFor = (oldId: number): number => {
  const hit = [...report.tablesCreated, ...report.tablesMatched].find((t: any) => t.oldId === oldId);
  if (!hit) throw new Error(`newTableIdFor: no resolution recorded for old table id ${oldId}`);
  return hit.newId;
};

/** The NEW target-metric id for a given OLD file metric id, from the report's matched+created union. */
const newMetricIdFor = (oldId: number): number => {
  const hit = [...report.metricsCreated, ...report.metricsMatched].find((m: any) => m.oldId === oldId);
  if (!hit) throw new Error(`newMetricIdFor: no resolution recorded for old metric id ${oldId}`);
  return hit.newId;
};

beforeEach(async () => {
  db.exec(`
    DELETE FROM dashboard_layers;
    DELETE FROM dashboard_dynamic_views;
    DELETE FROM widgets;
    DELETE FROM dashboard_tables;
    DELETE FROM custom_metrics;
    DELETE FROM dashboards;
    DELETE FROM tables;
    DELETE FROM sessions;
  `);

  // ── Kitchen-sink dashboard — mirrors routes.dashboard-export.spec.ts's beforeEach verbatim ──

  tWidget = createTable({ schema: "kbi_x", name: "t_widget", columns: { c1: "int" } });
  tLayer = createTable({ schema: "kbi_x", name: "t_layer", columns: { c1: "int" } });
  tDvSource = createTable({ schema: "kbi_x", name: "t_dvsource", columns: { c1: "int" } });
  tOrphan = createTable({ schema: "kbi_x", name: "t_orphan", columns: { c1: "int" } });
  tUnrelated = createTable({ schema: "kbi_x", name: "t_unrelated", columns: { c1: "int" } }); // must never travel

  dash = createDashboard("Import Refs Kitchen Sink", "armed fixture for Plan 120-05");
  addDashboardTable(dash.id, tWidget.id);
  addDashboardTable(dash.id, tOrphan.id); // dashboard_tables-only — the union edge

  mScalar = createCustomMetric(tWidget.id, "Scalar Metric", "SUM(c1)", null); // REF-4
  mArray = createCustomMetric(tWidget.id, "Array Metric", "AVG(c1)", null); // REF-5
  mOrphan = createCustomMetric(tWidget.id, "ZZ Unreferenced Metric", "MAX(c1)", null); // must not travel

  dv = createDashboardDynamicView(dash.id, {
    source_table_id: tDvSource.id,
    name: "DV One",
    template_sql: "SELECT * FROM {view}",
    max_records: 1000,
    columns_json: [{ name: "c1", type: "int" }],
  });

  layerTable = createDashboardLayer(dash.id, { table_id: tLayer.id, position: 0, config: { opacity: 0.5 } });
  updateDashboardLayer(layerTable.id, {
    cb_config: '{"mode":"quantile","breaks":[1,2,3]}',
    track_config: '{"trackIdColumn":"veh"}',
  });
  layerDv = createDashboardLayer(dash.id, { table_id: tDvSource.id, position: 1 });

  wBar = createWidget(dash.id, {
    title: "Bar",
    type: "bar",
    position: 0,
    config: { tableId: tWidget.id, metricId: mScalar.id }, // REF-1, REF-4
  });
  wMap = createWidget(dash.id, { title: "Map", type: "map", position: 1, config: {} });
  wMapAll = createWidget(dash.id, {
    title: "MapAll",
    type: "map",
    position: 2,
    config: { includedLayerIds: [] }, // REF-6 empty-array sentinel
  });
  wLegend = createWidget(dash.id, {
    title: "Legend",
    type: "legend",
    position: 3,
    config: { sourceMapWidgetId: 0 }, // REF-3, patched below
  });
  wNumLine = createWidget(dash.id, {
    title: "NumLine",
    type: "numericline",
    position: 4,
    config: {
      tableId: tWidget.id,
      metrics: [{ metricId: mArray.id }], // REF-5
      filterSelection: { sourceMode: "allowlist", allowedSourceWidgetIds: [] }, // REF-7, patched below
    },
  });
  wCalendar = createWidget(dash.id, {
    title: "Cal",
    type: "calendar",
    position: 5,
    config: { tableId: tWidget.id, dynamicViewId: dv.id }, // REF-2
  });
  wRadio = createWidget(dash.id, { title: "Radio", type: "radiogroup", position: 6, config: {} }); // REF-8, patched below

  // Close the cycles — what makes REF-3, REF-6, REF-7 and REF-8 real.
  updateWidget(wMap.id, {
    config: {
      includedLayerIds: [layerTable.id, layerDv.id], // REF-6
      // REF-9 — spatialTargets[].tableId, the kind Phase 121 found missing from the inventory.
      // Two entries so a single-element loop cannot pass by accident, on two DIFFERENT tables
      // so a remapper that reuses one mapping for both is caught.
      spatialTargets: [
        { tableId: tWidget.id, spatialMode: "latlon", lonCol: "lon", latCol: "lat" },
        { tableId: tLayer.id, spatialMode: "wkt", spatialCol: "geom" },
      ],
    },
  });
  updateWidget(wLegend.id, { config: { sourceMapWidgetId: wMap.id } }); // REF-3
  updateWidget(wNumLine.id, {
    config: {
      tableId: tWidget.id,
      metrics: [{ metricId: mArray.id }],
      filterSelection: {
        sourceMode: "allowlist",
        allowedSourceWidgetIds: [wBar.id, "__spatial_draws__"],
      },
    },
  }); // REF-7 + sentinel
  updateWidget(wRadio.id, {
    config: {
      options: [
        {
          id: "o1",
          label: "A",
          actions: [
            { target: { kind: "widget", id: wBar.id }, configPatch: { page_size: 10 } },
            { target: { kind: "layer", id: layerTable.id }, configPatch: { opacity: 0.2 } },
          ],
        },
        {
          id: "o2",
          label: "B",
          action: { target: { kind: "dynamicView", id: dv.id }, configPatch: { max_records: 50 } }, // legacy singular
        },
      ],
    },
  });
  updateDashboardLayer(layerDv.id, {
    dynamic_view_id: dv.id,
    filter_scope: JSON.stringify({
      sourceMode: "allowlist",
      allowedSourceWidgetIds: [wBar.id, "__spatial_draws__"],
    }), // sixth site
  });

  // ── Export for real, over HTTP ────────────────────────────────────────────

  const app = await buildTestApp();
  const { cookie } = createAdminSession();

  const exportRes = await app.get(`/api/dashboards/${dash.id}/export`).set("Cookie", cookie);
  expect(exportRes.status).toBe(200);
  file = JSON.parse(exportRes.text);

  // ── ARM the fixture: rewrite ONLY tables[].schema. Every OLD id in `file` still resolves to
  // the original kitchen-sink dashboard's own untouched rows after this — IMPNEW-decoy proves it. ──
  file.tables = file.tables.map((t: any) => ({ ...t, schema: "kbi_target" }));

  // ── Import for real, over HTTP (never a direct lib call — see acceptance criterion 7) ──────
  const importRes = await app.post("/api/dashboards/import").set("Cookie", cookie).send(file);
  expect(importRes.status).toBe(201);
  report = importRes.body.data;

  // ── Read the result back through the export route — parsed configs, one call ───────────────
  const importedRes = await app.get(`/api/dashboards/${report.dashboardId}/export`).set("Cookie", cookie);
  expect(importedRes.status).toBe(200);
  imported = JSON.parse(importedRes.text);
});

// ─── The meta-test: is the trap actually armed? ──────────────────────────────

describe("IMPNEW-decoy — the armed-fixture guarantee", () => {
  it("IMPNEW-decoy: every OLD id the file references still resolves to a pre-existing record in the target", () => {
    expect(getWidget(oldWidgetByTitle("Bar").id)).toBeDefined();
    expect(getWidget(oldWidgetByTitle("Map").id)).toBeDefined();
    expect(getDashboardLayer(layerTable.id)).toBeDefined();
    expect(getDashboardLayer(layerDv.id)).toBeDefined();
    expect(getDashboardDynamicView(dv.id)).toBeDefined();
    expect(getCustomMetric(mScalar.id)).toBeDefined();
    expect(getCustomMetric(mArray.id)).toBeDefined();
    expect(getTable(tWidget.id)).toBeDefined();
  });
});

// ─── Per-reference-kind NEW-id proofs ─────────────────────────────────────────

describe("IMPNEW — per-reference-kind NEW-id proofs, end to end through the route", () => {
  it("IMPNEW-REF1: the imported bar widget's tableId is the NEW table id, not the file's", () => {
    const bar = newWidgetByTitle("Bar");
    const newTable = newTableIdFor(tWidget.id);
    expect(bar.config.tableId).toBe(newTable);
    expect(bar.config.tableId).not.toBe(tWidget.id);
    expect(getTable(tWidget.id)).toBeDefined(); // old record unchanged
  });

  it("IMPNEW-REF2: the imported calendar widget's dynamicViewId is the NEW dynamic view id", () => {
    const cal = newWidgetByTitle("Cal");
    const newDv = imported.dynamicViews.find((d: any) => d.name === "DV One");
    expect(newDv).toBeDefined();
    expect(cal.config.dynamicViewId).toBe(newDv.id);
    expect(cal.config.dynamicViewId).not.toBe(dv.id);
    expect(getDashboardDynamicView(dv.id)).toBeDefined(); // old record unchanged
  });

  it("IMPNEW-REF3: the imported legend's sourceMapWidgetId is the NEW map widget id", () => {
    const legend = newWidgetByTitle("Legend");
    const newMap = newWidgetByTitle("Map");
    expect(legend.config.sourceMapWidgetId).toBe(newMap.id);
    expect(legend.config.sourceMapWidgetId).not.toBe(wMap.id);
    expect(getWidget(wMap.id)).toBeDefined(); // old record unchanged
  });

  it("IMPNEW-REF4: the imported bar widget's scalar metricId is the NEW custom metric id", () => {
    const bar = newWidgetByTitle("Bar");
    const newMetric = newMetricIdFor(mScalar.id);
    expect(bar.config.metricId).toBe(newMetric);
    expect(bar.config.metricId).not.toBe(mScalar.id);
    expect(getCustomMetric(mScalar.id)).toBeDefined(); // old record unchanged
  });

  it("IMPNEW-REF5: the imported numericline's metrics[0].metricId is the NEW custom metric id", () => {
    const numLine = newWidgetByTitle("NumLine");
    const newMetric = newMetricIdFor(mArray.id);
    expect(numLine.config.metrics[0].metricId).toBe(newMetric);
    expect(numLine.config.metrics[0].metricId).not.toBe(mArray.id);
    expect(getCustomMetric(mArray.id)).toBeDefined(); // old record unchanged
  });

  it("IMPNEW-REF6: the imported map widget's includedLayerIds are the two NEW layer ids", () => {
    const map = newWidgetByTitle("Map");
    const newLayerTableRow = imported.layers.find((l: any) => l.table_id === newTableIdFor(tLayer.id));
    const newLayerDvRow = imported.layers.find((l: any) => l.table_id === newTableIdFor(tDvSource.id));
    expect(newLayerTableRow).toBeDefined();
    expect(newLayerDvRow).toBeDefined();
    const expected = [newLayerTableRow.id, newLayerDvRow.id].sort((a, b) => a - b);
    const actual = [...map.config.includedLayerIds].sort((a: number, b: number) => a - b);
    expect(actual).toEqual(expected);
    expect(actual).not.toEqual([layerTable.id, layerDv.id].sort((a, b) => a - b));
    expect(getDashboardLayer(layerTable.id)).toBeDefined(); // old records unchanged
    expect(getDashboardLayer(layerDv.id)).toBeDefined();
  });

  it("IMPNEW-REF7: the imported numericline's allowedSourceWidgetIds numeric entry is the NEW widget id", () => {
    const numLine = newWidgetByTitle("NumLine");
    const newBar = newWidgetByTitle("Bar");
    expect(numLine.config.filterSelection.allowedSourceWidgetIds).toEqual([newBar.id, "__spatial_draws__"]);
    expect(numLine.config.filterSelection.allowedSourceWidgetIds[0]).not.toBe(wBar.id);
    expect(getWidget(wBar.id)).toBeDefined(); // old record unchanged
  });

  it("IMPNEW-REF7: the imported layer's filter_scope names the NEW widget id (the sixth site)", () => {
    const newBar = newWidgetByTitle("Bar");
    const newLayerDvRow = imported.layers.find((l: any) => l.table_id === newTableIdFor(tDvSource.id));
    expect(newLayerDvRow.filter_scope.allowedSourceWidgetIds).toEqual([newBar.id, "__spatial_draws__"]);
    expect(newLayerDvRow.filter_scope.allowedSourceWidgetIds[0]).not.toBe(wBar.id);
  });

  it("IMPNEW-REF8: the widget-kind action target id is the NEW widget id", () => {
    const radio = newWidgetByTitle("Radio");
    const newBar = newWidgetByTitle("Bar");
    const target = radio.config.options[0].actions[0].target;
    expect(target).toEqual({ kind: "widget", id: newBar.id });
    expect(target.id).not.toBe(wBar.id);
  });

  it("IMPNEW-REF8: the layer-kind action target id is the NEW layer id", () => {
    const radio = newWidgetByTitle("Radio");
    const newLayerTableRow = imported.layers.find((l: any) => l.table_id === newTableIdFor(tLayer.id));
    const target = radio.config.options[0].actions[1].target;
    expect(target).toEqual({ kind: "layer", id: newLayerTableRow.id });
    expect(target.id).not.toBe(layerTable.id);
  });

  it("IMPNEW-REF8: the LEGACY singular action's dynamicView target id is the NEW dynamic view id", () => {
    const radio = newWidgetByTitle("Radio");
    const newDv = imported.dynamicViews.find((d: any) => d.name === "DV One");
    const target = radio.config.options[1].action.target;
    expect(target).toEqual({ kind: "dynamicView", id: newDv.id });
    expect(target.id).not.toBe(dv.id);
  });

  it("IMPNEW-REF9: every spatialTargets[].tableId is the NEW table id", () => {
    const map = newWidgetByTitle("Map");
    const targets = map.config.spatialTargets;
    expect(targets).toHaveLength(2);
    expect(targets[0].tableId).toBe(newTableIdFor(tWidget.id));
    expect(targets[1].tableId).toBe(newTableIdFor(tLayer.id));
    // The armed half: the file's own ids must not survive into the target.
    expect(targets[0].tableId).not.toBe(tWidget.id);
    expect(targets[1].tableId).not.toBe(tLayer.id);
    // The non-id fields ride along untouched.
    expect(targets[0].lonCol).toBe("lon");
    expect(targets[1].spatialCol).toBe("geom");
  });

  it("IMPNEW-union: the two dashboard_tables associations point at NEW table ids", () => {
    const newTWidget = newTableIdFor(tWidget.id);
    const newTOrphan = newTableIdFor(tOrphan.id);
    const actual = [...imported.dashboardTableIds].sort((a: number, b: number) => a - b);
    expect(actual).toEqual([newTWidget, newTOrphan].sort((a, b) => a - b));
    expect(imported.dashboardTableIds).not.toContain(tWidget.id);
    expect(imported.dashboardTableIds).not.toContain(tOrphan.id);
  });
});

// ─── REF-2, REF-4, REF-5 — never exercised outside a fixture; one extra proof each ───

describe("IMPNEW — REF-2/-4/-5 extra proofs (fixture-only, see header)", () => {
  it("IMPNEW-REF2: the NEW dynamic view's source_table_id is the NEW table id, not the file's", () => {
    const newDv = imported.dynamicViews.find((d: any) => d.name === "DV One");
    expect(newDv.source_table_id).toBe(newTableIdFor(tDvSource.id));
    expect(newDv.source_table_id).not.toBe(tDvSource.id);
  });

  it("IMPNEW-REF4: the NEW custom metric row's table_id is the NEW table id", () => {
    const newScalar = imported.customMetrics.find((m: any) => m.label === "Scalar Metric");
    expect(newScalar).toBeDefined();
    expect(newScalar.table_id).toBe(newTableIdFor(tWidget.id));
  });

  it("IMPNEW-REF5: the NEW metric created for metrics[] is a DIFFERENT row from the scalar metric's", () => {
    const newArrayMetricId = newMetricIdFor(mArray.id);
    const newScalarMetricId = newMetricIdFor(mScalar.id);
    expect(newArrayMetricId).not.toBe(newScalarMetricId);
  });
});

// ─── The whole-config sweep — catch-all for a ninth kind nobody enumerated ───

describe("IMPNEW-sweep", () => {
  it("IMPNEW-sweep: no imported widget config contains ANY id from the file's SAME-KIND original id set", () => {
    // CORRECTED per plan-checker info #1: compared PER KIND, never against one merged set — a
    // merged Set would false-positive because each table has an independent AUTOINCREMENT
    // counter, so a correctly remapped NEW widget id can coincidentally equal an OLD table id.
    const oldWidgetIds = new Set(file.widgets.map((w: any) => w.id));
    const oldLayerIds = new Set(file.layers.map((l: any) => l.id));
    const oldDvIds = new Set(file.dynamicViews.map((d: any) => d.id));
    const oldTableIds = new Set(file.tables.map((t: any) => t.id));
    const oldMetricIds = new Set(file.customMetrics.map((m: any) => m.id));

    for (const w of imported.widgets) {
      const refs = collectWidgetConfigRefs(w.config);
      for (const id of refs.widgetIds) expect(oldWidgetIds.has(id)).toBe(false);
      for (const id of refs.layerIds) expect(oldLayerIds.has(id)).toBe(false);
      for (const id of refs.dynamicViewIds) expect(oldDvIds.has(id)).toBe(false);
      for (const id of refs.tableIds) expect(oldTableIds.has(id)).toBe(false);
      for (const id of refs.customMetricIds) expect(oldMetricIds.has(id)).toBe(false);
    }
  });
});

// ─── The three traps, end to end ─────────────────────────────────────────────

describe("IMPTRAP — the three rewrite traps survive a real import", () => {
  it("IMPTRAP6: the EMPTY includedLayerIds widget still has [] after import — not the new layer list", () => {
    const mapAll = newWidgetByTitle("MapAll");
    expect(mapAll.config.includedLayerIds).toEqual([]);
  });

  it('IMPTRAP7: allowedSourceWidgetIds is exactly [<new widget id>, "__spatial_draws__"] — order preserved', () => {
    const numLine = newWidgetByTitle("NumLine");
    const newBar = newWidgetByTitle("Bar");
    expect(numLine.config.filterSelection.allowedSourceWidgetIds).toEqual([newBar.id, "__spatial_draws__"]);
  });

  it("IMPTRAP7: the imported filter_scope contains no null or undefined entry", () => {
    const newLayerDvRow = imported.layers.find((l: any) => l.table_id === newTableIdFor(tDvSource.id));
    for (const entry of newLayerDvRow.filter_scope.allowedSourceWidgetIds) {
      expect(entry).not.toBeNull();
      expect(entry).not.toBeUndefined();
    }
  });

  it("IMPTRAP8: the imported radio option o2 still uses the LEGACY singular action key, not actions[]", () => {
    const radio = newWidgetByTitle("Radio");
    const o2 = radio.config.options.find((o: any) => o.label === "B");
    expect(o2.action).toBeDefined();
    expect(o2.actions).toBeUndefined();
  });
});

// ─── Round trip — weaker evidence, stated as such ────────────────────────────

describe("ROUNDTRIP — self-consistency, NOT cross-environment proof (see header)", () => {
  it("ROUNDTRIP-shape: re-exporting the imported dashboard yields the same widget/layer/dv/table counts", () => {
    expect(imported.widgets.length).toBe(file.widgets.length);
    expect(imported.layers.length).toBe(file.layers.length);
    expect(imported.dynamicViews.length).toBe(file.dynamicViews.length);
    expect(imported.tables.length).toBe(file.tables.length);
  });

  it("ROUNDTRIP-refs: the re-export reports an EMPTY danglingReferences array", () => {
    // A self-consistent import produces a dashboard whose own walk finds nothing dangling. This
    // proves self-consistency, NOT correctness against a foreign environment — Phase 121's
    // operator UAT is the real cross-environment proof; see the file header.
    expect(imported.danglingReferences).toEqual([]);
  });
});
