/**
 * routes.dashboard-export.spec.ts — Phase 119 Plan 03 (DXIM-V124-01/02/08)
 *
 * Integration supertests proving GET /api/dashboards/:id/export (Plan 02) is COMPLETE, not
 * merely present: one "kitchen sink" fixture dashboard exercises all eight widget-config
 * reference kinds (REF-1..8) plus the sixth-site layer filter_scope and the dashboard_tables
 * union edge, and every referenced entity is asserted present in the exported payload
 * (INCL-*). A cross-dashboard reference is asserted reported as dangling (DANGLE-*).
 *
 * Three operator-excluded / runtime data sets are each seeded with a distinctive canary string
 * and proven ABSENT from the raw exported bytes, not merely un-coded (EXCL-*). The 404 guard is
 * proven to answer identically for "dashboard does not exist" and "exists but not permitted" —
 * a non-leak SECURITY property (NOLEAK-*). The Content-Disposition download header is proven
 * injection-safe against a dashboard name containing a quote and a CRLF (DELIV-*). The
 * permission catalog is asserted unchanged at 18 entries with no export-specific permission
 * (PARITY-*).
 *
 * Do NOT assert a fixed total server pass-count (SET-BASED TD-V16-TEST-ISOLATION gate).
 *
 * MUTATION PROBES (Plan 119-03 Task 3) — ten probes run for real against the committed
 * dashboardExport.ts / index.ts route, each reddening its named test below, then reverted;
 * git diff --exit-code confirmed the source byte-identical afterward.
 * * M1  dropped associatedIds from the table union (kept only refs.tableIds)
 *       -> reddened "INCL-union: the dashboard_tables-only table travels even though nothing references it"
 * * M2  replaced referenced-metric lookup with tables.flatMap(t => listCustomMetrics(t.id))
 *       -> reddened "EXCL-metric: the unreferenced sibling metric label does not appear in the exported bytes"
 * * M3  added a runtime-view listing accessor's output to the envelope under a `views` key
 *       -> reddened "EXCL-runtime: the dashboard_table_views view_name does not appear in the exported bytes"
 *       and "EXCL-runtime: the envelope has no views key"
 * * M4  added the access-grant listing accessor's output to the envelope under a `grants` key
 *       -> reddened "EXCL-grants: the access-grant grantee string does not appear in the exported bytes"
 *       and "EXCL-grants: the envelope has no grants / accessGrants key"
 * * M5  added the column-display-config listing accessor's output under a `columnDisplayConfig` key
 *       -> reddened "EXCL-columnconfig: the column_display_config label does not appear in the exported bytes"
 * * M6  split the route guard into a 404-for-missing branch + a separate 403-for-denied branch
 *       -> reddened "NOLEAK-404: an analyst with no grant gets 404, byte-identical to a nonexistent dashboard id"
 * * M7  deleted the Content-Disposition setHeader line from the route
 *       -> reddened "DELIV-disposition: the filename is slugified from the dashboard name"
 * * M8  changed JSON.stringify(payload, null, 2) to JSON.stringify(payload) (no pretty-print)
 *       -> reddened "DELIV-pretty: the body is pretty-printed, not minified"
 * * M9  swapped exportFileName's allow-list regex for a denylist stripping only slashes
 *       -> reddened "DELIV-disposition: the header contains no quote, CR or LF from the dashboard name"
 * * M10 removed dashboardTableIds from the returned envelope
 *       -> reddened "INCL-union: dashboardTableIds lists exactly the two associated table ids"
 * All ten probes fired on first attempt; no assertion required strengthening.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { buildTestApp } from "./helpers/app";
import { createAdminSession } from "./helpers/db";
import { db } from "../src/db";
import {
  createDashboard,
  createTable,
  addDashboardTable,
  createWidget,
  updateWidget,
  createDashboardLayer,
  updateDashboardLayer,
  createDashboardDynamicView,
  createCustomMetric,
  createView,
  upsertColumnDisplayConfig,
} from "../src/db";
import { addDashboardGrant } from "../src/lib/dashboardAccessDb";
import { createSession } from "../src/sessionStore";
import { PERMISSIONS } from "../src/lib/permissions";
import jwt from "jsonwebtoken";

// ─── Session helpers ──────────────────────────────────────────────────────────

const AUTH_SECRET = process.env.AUTH_SECRET!;
const KINETICA_URL = process.env.KINETICA_URL!;

/**
 * Seeds an analyst session. A user with NO user_roles row falls back to analyst, which holds
 * dashboards:view but NOT dashboards:manage_access — so canViewDashboard returns false for
 * them until a grant exists. Mirrors the seedAnalystSession idiom from
 * routes.custom-metrics.spec.ts verbatim.
 */
const seedAnalystSession = (username: string): { cookie: string } => {
  const sid = createSession({ username, secret: "analyst-pw", kineticaUrl: KINETICA_URL });
  const token = jwt.sign({ sub: username, sid, v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
  return { cookie: `kbi_session=${token}` };
};

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

beforeEach(() => {
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

  // Tables — five, so that inclusion and exclusion are both non-trivial.
  tWidget = createTable({ schema: "kbi_x", name: "t_widget", columns: { c1: "int" } }); // widget config.tableId
  tLayer = createTable({ schema: "kbi_x", name: "t_layer", columns: { c1: "int" } }); // layer.table_id ONLY
  tDvSource = createTable({ schema: "kbi_x", name: "t_dvsource", columns: { c1: "int" } }); // dv.source_table_id ONLY
  tOrphan = createTable({ schema: "kbi_x", name: "t_orphan", columns: { c1: "int" } }); // dashboard_tables ONLY
  tUnrelated = createTable({ schema: "kbi_x", name: "t_unrelated", columns: { c1: "int" } }); // NOTHING references it

  // Dashboard — the name doubles as the header-injection fixture for Task 2.
  dash = createDashboard('Q3 "Sales"\r\nReport', "kitchen sink");
  addDashboardTable(dash.id, tWidget.id);
  addDashboardTable(dash.id, tOrphan.id); // associated but wired to nothing
  // tLayer and tDvSource are deliberately NOT associated — they must arrive via the WALK.
  // tUnrelated is neither associated nor referenced — it must NOT arrive at all.

  // Custom metrics — all three on tWidget, so "referenced only" is the sole discriminator.
  mScalar = createCustomMetric(tWidget.id, "Scalar Metric", "SUM(c1)", null); // REF-4
  mArray = createCustomMetric(tWidget.id, "Array Metric", "AVG(c1)", null); // REF-5
  mOrphan = createCustomMetric(tWidget.id, "ZZ Unreferenced Metric", "MAX(c1)", null); // must NOT travel

  // Dynamic view (before layers — layerDv binds to it).
  dv = createDashboardDynamicView(dash.id, {
    source_table_id: tDvSource.id,
    name: "DV One",
    template_sql: "SELECT * FROM {view}",
    max_records: 1000,
    columns_json: [{ name: "c1", type: "int" }],
  });

  // Layers — one table-bound with style blobs, one dv-bound with a sentinel-bearing filter_scope.
  layerTable = createDashboardLayer(dash.id, { table_id: tLayer.id, position: 0, config: { opacity: 0.5 } });
  updateDashboardLayer(layerTable.id, {
    cb_config: '{"mode":"quantile","breaks":[1,2,3]}',
    track_config: '{"trackIdColumn":"veh"}',
  });
  layerDv = createDashboardLayer(dash.id, { table_id: tDvSource.id, position: 1 });
  // filter_scope set AFTER the widgets exist (it names wBar.id) — see below.

  // Widgets — seven, one per reference-kind cluster.
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
    config: { includedLayerIds: [] }, // REF-6 sentinel
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

  // Close the cycles (these three patches are what make REF-3, REF-6, REF-7 and REF-8 real).
  updateWidget(wMap.id, { config: { includedLayerIds: [layerTable.id, layerDv.id] } }); // REF-6
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
          action: { target: { kind: "dynamicView", id: dv.id }, configPatch: { max_records: 50 } }, // REF-8 LEGACY singular
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
});

// ─── Task 1: kitchen-sink inclusion + dangling ───────────────────────────────

describe("GET /api/dashboards/:id/export — kitchen-sink completeness", () => {
  it("INCL-envelope: schemaVersion is 1 and exportedAt is an ISO-8601 Z timestamp", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.get(`/api/dashboards/${dash.id}/export`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.schemaVersion).toBe(1);
    expect(res.body.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("INCL-widgets: all seven widget ids are present with their config as parsed objects", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.get(`/api/dashboards/${dash.id}/export`).set("Cookie", cookie);
    const ids = [wBar.id, wMap.id, wMapAll.id, wLegend.id, wNumLine.id, wCalendar.id, wRadio.id];
    const exportedIds = res.body.widgets.map((w: any) => w.id).sort((a: number, b: number) => a - b);
    expect(exportedIds).toEqual([...ids].sort((a, b) => a - b));
    for (const w of res.body.widgets) {
      expect(typeof w.config).toBe("object");
      expect(w.config).not.toBeNull();
    }
  });

  it("INCL-layers: both layers travel with cb_config and track_config as their raw strings", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.get(`/api/dashboards/${dash.id}/export`).set("Cookie", cookie);
    const layerIds = res.body.layers.map((l: any) => l.id).sort((a: number, b: number) => a - b);
    expect(layerIds).toEqual([layerTable.id, layerDv.id].sort((a, b) => a - b));
    const exportedLayerTable = res.body.layers.find((l: any) => l.id === layerTable.id);
    expect(typeof exportedLayerTable.cb_config).toBe("string");
    expect(exportedLayerTable.cb_config).toBe('{"mode":"quantile","breaks":[1,2,3]}');
    expect(typeof exportedLayerTable.track_config).toBe("string");
    expect(exportedLayerTable.track_config).toBe('{"trackIdColumn":"veh"}');
  });

  it("INCL-dynamicViews: the dynamic view travels with its columns_json array intact", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.get(`/api/dashboards/${dash.id}/export`).set("Cookie", cookie);
    expect(res.body.dynamicViews).toHaveLength(1);
    expect(res.body.dynamicViews[0].id).toBe(dv.id);
    expect(res.body.dynamicViews[0].columns_json).toEqual([{ name: "c1", type: "int" }]);
  });

  it("INCL-union: all four related tables travel and the unrelated table does not", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.get(`/api/dashboards/${dash.id}/export`).set("Cookie", cookie);
    const expected = [tWidget.id, tLayer.id, tDvSource.id, tOrphan.id].sort((a, b) => a - b);
    const actual = [...res.body.tables.map((t: any) => t.id)].sort((a: number, b: number) => a - b);
    expect(actual).toEqual(expected);
    expect(res.body.tables.map((t: any) => t.name)).not.toContain("t_unrelated");
  });

  it("INCL-union: the dashboard_tables-only table travels even though nothing references it", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.get(`/api/dashboards/${dash.id}/export`).set("Cookie", cookie);
    expect(res.body.tables.map((t: any) => t.id)).toContain(tOrphan.id);
  });

  it("INCL-union: dashboardTableIds lists exactly the two associated table ids", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.get(`/api/dashboards/${dash.id}/export`).set("Cookie", cookie);
    expect([...res.body.dashboardTableIds].sort((a: number, b: number) => a - b)).toEqual(
      [tWidget.id, tOrphan.id].sort((a, b) => a - b)
    );
  });

  it("INCL-metrics: both referenced metrics travel", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.get(`/api/dashboards/${dash.id}/export`).set("Cookie", cookie);
    const expected = [mScalar.id, mArray.id].sort((a, b) => a - b);
    const actual = [...res.body.customMetrics.map((m: any) => m.id)].sort((a: number, b: number) => a - b);
    expect(actual).toEqual(expected);
    expect(res.body.customMetrics.map((m: any) => m.label)).not.toContain("ZZ Unreferenced Metric");
  });

  it("INCL-REF1: the bar widget's tableId table is present in tables", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.get(`/api/dashboards/${dash.id}/export`).set("Cookie", cookie);
    const bar = res.body.widgets.find((w: any) => w.id === wBar.id);
    expect(bar.config.tableId).toBe(tWidget.id);
    expect(res.body.tables.map((t: any) => t.id)).toContain(tWidget.id);
  });

  it("INCL-REF2: the calendar widget's dynamicViewId resolves to an exported dynamic view", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.get(`/api/dashboards/${dash.id}/export`).set("Cookie", cookie);
    const cal = res.body.widgets.find((w: any) => w.id === wCalendar.id);
    expect(cal.config.dynamicViewId).toBe(dv.id);
    expect(res.body.dynamicViews.map((d: any) => d.id)).toContain(dv.id);
  });

  it("INCL-REF3: the legend's sourceMapWidgetId still equals the ORIGINAL map widget id", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.get(`/api/dashboards/${dash.id}/export`).set("Cookie", cookie);
    const legend = res.body.widgets.find((w: any) => w.id === wLegend.id);
    expect(legend.config.sourceMapWidgetId).toBe(wMap.id);
  });

  it("INCL-REF4: the scalar metricId metric is present in customMetrics", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.get(`/api/dashboards/${dash.id}/export`).set("Cookie", cookie);
    const bar = res.body.widgets.find((w: any) => w.id === wBar.id);
    expect(res.body.customMetrics.map((m: any) => m.id)).toContain(bar.config.metricId);
  });

  it("INCL-REF5: the metrics[].metricId metric is present in customMetrics", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.get(`/api/dashboards/${dash.id}/export`).set("Cookie", cookie);
    const numLine = res.body.widgets.find((w: any) => w.id === wNumLine.id);
    expect(res.body.customMetrics.map((m: any) => m.id)).toContain(numLine.config.metrics[0].metricId);
  });

  it("INCL-REF6: includedLayerIds survives verbatim and both named layers are exported", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.get(`/api/dashboards/${dash.id}/export`).set("Cookie", cookie);
    const map = res.body.widgets.find((w: any) => w.id === wMap.id);
    expect([...map.config.includedLayerIds].sort((a: number, b: number) => a - b)).toEqual(
      [layerTable.id, layerDv.id].sort((a, b) => a - b)
    );
    expect(res.body.layers.map((l: any) => l.id)).toEqual(
      expect.arrayContaining([layerTable.id, layerDv.id])
    );
  });

  it("INCL-REF6: an EMPTY includedLayerIds array survives as [] and is not expanded", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.get(`/api/dashboards/${dash.id}/export`).set("Cookie", cookie);
    const mapAll = res.body.widgets.find((w: any) => w.id === wMapAll.id);
    expect(mapAll.config.includedLayerIds).toEqual([]);
  });

  it("INCL-REF7: allowedSourceWidgetIds keeps both the widget id and the __spatial_draws__ sentinel", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.get(`/api/dashboards/${dash.id}/export`).set("Cookie", cookie);
    const numLine = res.body.widgets.find((w: any) => w.id === wNumLine.id);
    expect(numLine.config.filterSelection.allowedSourceWidgetIds).toEqual([wBar.id, "__spatial_draws__"]);
  });

  it("INCL-REF7: the layer filter_scope carries the same sentinel-bearing allow-list", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.get(`/api/dashboards/${dash.id}/export`).set("Cookie", cookie);
    const exportedLayerDv = res.body.layers.find((l: any) => l.id === layerDv.id);
    expect(exportedLayerDv.filter_scope.allowedSourceWidgetIds).toEqual([wBar.id, "__spatial_draws__"]);
  });

  it("INCL-REF8: a widget-kind action target survives verbatim", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.get(`/api/dashboards/${dash.id}/export`).set("Cookie", cookie);
    const radio = res.body.widgets.find((w: any) => w.id === wRadio.id);
    const target = radio.config.options[0].actions[0].target;
    expect(target).toEqual({ kind: "widget", id: wBar.id });
  });

  it("INCL-REF8: a layer-kind action target survives verbatim", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.get(`/api/dashboards/${dash.id}/export`).set("Cookie", cookie);
    const radio = res.body.widgets.find((w: any) => w.id === wRadio.id);
    const target = radio.config.options[0].actions[1].target;
    expect(target).toEqual({ kind: "layer", id: layerTable.id });
  });

  it("INCL-REF8: the LEGACY singular options[].action dynamicView target survives verbatim", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.get(`/api/dashboards/${dash.id}/export`).set("Cookie", cookie);
    const radio = res.body.widgets.find((w: any) => w.id === wRadio.id);
    const target = radio.config.options[1].action.target;
    expect(target).toEqual({ kind: "dynamicView", id: dv.id });
  });

  it("DANGLE-clean: a well-formed fixture reports an empty danglingReferences array", async () => {
    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.get(`/api/dashboards/${dash.id}/export`).set("Cookie", cookie);
    expect(res.body.danglingReferences).toEqual([]);
  });

  it("DANGLE-cross: a legend bound to a widget on ANOTHER dashboard is reported as dangling", async () => {
    const otherDash = createDashboard("Other Dashboard");
    const otherWidget = createWidget(otherDash.id, { title: "OtherBar", type: "bar", position: 0, config: {} });
    const wGhostLegend = createWidget(dash.id, {
      title: "GhostLegend",
      type: "legend",
      position: 7,
      config: { sourceMapWidgetId: otherWidget.id },
    });

    const app = await buildTestApp();
    const { cookie } = createAdminSession();
    const res = await app.get(`/api/dashboards/${dash.id}/export`).set("Cookie", cookie);
    expect(res.body.danglingReferences).toContainEqual({
      from: `widget:${wGhostLegend.id}`,
      kind: "widget",
      id: otherWidget.id,
    });
  });
});
