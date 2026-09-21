/**
 * lib.dashboardExport.spec.ts — Unit coverage for the Phase 119 Plan 02 export assembler.
 *
 * Seeds real rows against the in-memory singleton db (DB_PATH=":memory:" + vitest `isolate:
 * true` in setup.ts, so this spec file owns a private database — mirrors
 * lib.dashboardAccessDb.spec.ts's structural precedent, but exercises the module-singleton
 * `db` directly via db.ts's own CRUD helpers rather than a locally constructed connection,
 * since `buildDashboardExport` itself always reads through that singleton).
 *
 * Covers: the dashboard_tables ∪ walk-derived table UNION, dashboardTableIds as the
 * associated-only subset, referenced-only custom metrics (EXCL-metric), dangling-reference
 * detection for all four kinds (DANGLE-*), the two `DANGLE-none` no-fabrication cases, and
 * filename injection-safety (DELIV-name).
 */
import { describe, it, expect } from "vitest";
import {
  createDashboard,
  createTable,
  createWidget,
  createDashboardLayer,
  updateDashboardLayer,
  createDashboardDynamicView,
  createCustomMetric,
  addDashboardTable,
} from "../src/db";
import { buildDashboardExport, exportFileName, EXPORT_SCHEMA_VERSION } from "../src/lib/dashboardExport";

describe("buildDashboardExport — table UNION", () => {
  it("tables are the UNION of dashboard_tables membership and walk-derived references", () => {
    const dash = createDashboard("union-dash");
    const associated = createTable({ name: "associated", schema: "" });
    const referencedOnly = createTable({ name: "referenced-only", schema: "" });
    addDashboardTable(dash.id, associated.id);
    createWidget(dash.id, { title: "w", type: "table", position: 0, config: { tableId: referencedOnly.id } });

    const result = buildDashboardExport(dash.id)!;
    const tableIds = result.tables.map((t) => t.id).sort((a, b) => a - b);
    expect(tableIds).toEqual([associated.id, referencedOnly.id].sort((a, b) => a - b));
  });

  it("a table associated via dashboard_tables but referenced by nothing still travels", () => {
    const dash = createDashboard("assoc-only-dash");
    const table = createTable({ name: "unwired", schema: "" });
    addDashboardTable(dash.id, table.id);

    const result = buildDashboardExport(dash.id)!;
    expect(result.tables.map((t) => t.id)).toEqual([table.id]);
  });

  it("dashboardTableIds lists only the dashboard_tables-associated ids, not the full table set", () => {
    const dash = createDashboard("dashboard-table-ids-dash");
    const associated = createTable({ name: "assoc", schema: "" });
    const referencedOnly = createTable({ name: "ref-only", schema: "" });
    addDashboardTable(dash.id, associated.id);
    createWidget(dash.id, { title: "w", type: "table", position: 0, config: { tableId: referencedOnly.id } });

    const result = buildDashboardExport(dash.id)!;
    expect(result.dashboardTableIds).toEqual([associated.id]);
    expect(result.tables.map((t) => t.id).sort((a, b) => a - b)).toContain(referencedOnly.id);
  });

  it("a table referenced only by a dynamic view's source_table_id travels", () => {
    const dash = createDashboard("dv-source-dash");
    const table = createTable({ name: "dv-source", schema: "" });
    createDashboardDynamicView(dash.id, {
      source_table_id: table.id,
      name: "dv1",
      template_sql: "SELECT * FROM {view}",
      max_records: 100,
    });

    const result = buildDashboardExport(dash.id)!;
    expect(result.tables.map((t) => t.id)).toEqual([table.id]);
  });

  it("a table referenced only by a layer's table_id travels", () => {
    const dash = createDashboard("layer-table-dash");
    const table = createTable({ name: "layer-source", schema: "" });
    createDashboardLayer(dash.id, { table_id: table.id });

    const result = buildDashboardExport(dash.id)!;
    expect(result.tables.map((t) => t.id)).toEqual([table.id]);
  });
});

describe("buildDashboardExport — referenced-only custom metrics", () => {
  it("only widget-referenced custom metrics travel", () => {
    const dash = createDashboard("metrics-dash");
    const table = createTable({ name: "metrics-table", schema: "" });
    addDashboardTable(dash.id, table.id);
    const referenced = createCustomMetric(table.id, "Referenced", "SUM(x)", null);
    createCustomMetric(table.id, "Sibling", "AVG(x)", null);
    createWidget(dash.id, { title: "w", type: "table", position: 0, config: { metricId: referenced.id } });

    const result = buildDashboardExport(dash.id)!;
    expect(result.customMetrics.map((m) => m.id)).toEqual([referenced.id]);
  });

  it("EXCL-metric: a sibling metric on an exported table does NOT travel", () => {
    const dash = createDashboard("excl-metric-dash");
    const table = createTable({ name: "excl-metric-table", schema: "" });
    addDashboardTable(dash.id, table.id);
    const referenced = createCustomMetric(table.id, "Kept", "SUM(y)", null);
    const sibling = createCustomMetric(table.id, "Dropped", "AVG(y)", null);
    createWidget(dash.id, { title: "w", type: "table", position: 0, config: { metricId: referenced.id } });

    const result = buildDashboardExport(dash.id)!;
    const ids = result.customMetrics.map((m) => m.id);
    expect(ids).toContain(referenced.id);
    expect(ids).not.toContain(sibling.id);
  });
});

describe("buildDashboardExport — envelope shape", () => {
  it("schemaVersion is EXPORT_SCHEMA_VERSION and exportedAt is an ISO-8601 Z timestamp", () => {
    const dash = createDashboard("envelope-dash");
    const result = buildDashboardExport(dash.id)!;
    expect(result.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
    expect(result.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("widget config is re-embedded as a parsed object, not a JSON string", () => {
    const dash = createDashboard("parsed-config-dash");
    const table = createTable({ name: "parsed-config-table", schema: "" });
    createWidget(dash.id, { title: "w", type: "table", position: 0, config: { tableId: table.id } });

    const result = buildDashboardExport(dash.id)!;
    expect(typeof result.widgets[0].config).toBe("object");
    expect(result.widgets[0].config).toEqual({ tableId: table.id });
  });

  it("layer cb_config and track_config survive as their raw strings", () => {
    const dash = createDashboard("layer-raw-strings-dash");
    const table = createTable({ name: "layer-raw-table", schema: "" });
    const layer = createDashboardLayer(dash.id, { table_id: table.id });
    const cbConfig = JSON.stringify({ breaks: [1, 2, 3] });
    const trackConfig = JSON.stringify({ mode: "point" });
    updateDashboardLayer(layer.id, { cb_config: cbConfig, track_config: trackConfig });

    const result = buildDashboardExport(dash.id)!;
    expect(result.layers[0].cb_config).toBe(cbConfig);
    expect(result.layers[0].track_config).toBe(trackConfig);
    expect(typeof result.layers[0].cb_config).toBe("string");
  });

  it("buildDashboardExport returns undefined for an unknown dashboard id", () => {
    expect(buildDashboardExport(9_999_999)).toBeUndefined();
  });
});

describe("buildDashboardExport — dangling reference detection", () => {
  it("DANGLE-widget: a sourceMapWidgetId pointing off-dashboard is reported with its source widget", () => {
    const dash = createDashboard("dangle-widget-dash");
    const w = createWidget(dash.id, {
      title: "legend",
      type: "legend",
      position: 0,
      config: { sourceMapWidgetId: 9_999_991 },
    });

    const result = buildDashboardExport(dash.id)!;
    expect(result.danglingReferences).toContainEqual({ from: `widget:${w.id}`, kind: "widget", id: 9_999_991 });
  });

  it("DANGLE-table: a tableId pointing at a deleted table is reported", () => {
    const dash = createDashboard("dangle-table-dash");
    const w = createWidget(dash.id, {
      title: "chart",
      type: "table",
      position: 0,
      config: { tableId: 9_999_992 },
    });

    const result = buildDashboardExport(dash.id)!;
    expect(result.danglingReferences).toContainEqual({ from: `widget:${w.id}`, kind: "table", id: 9_999_992 });
  });

  it("DANGLE-metric: a metricId pointing at a deleted metric is reported", () => {
    const dash = createDashboard("dangle-metric-dash");
    const w = createWidget(dash.id, {
      title: "chart",
      type: "table",
      position: 0,
      config: { metricId: 9_999_993 },
    });

    const result = buildDashboardExport(dash.id)!;
    expect(result.danglingReferences).toContainEqual({ from: `widget:${w.id}`, kind: "customMetric", id: 9_999_993 });
  });

  it("DANGLE-layer: an includedLayerIds entry not on this dashboard is reported", () => {
    const dash = createDashboard("dangle-layer-dash");
    const w = createWidget(dash.id, {
      title: "map",
      type: "map",
      position: 0,
      config: { includedLayerIds: [9_999_994] },
    });

    const result = buildDashboardExport(dash.id)!;
    expect(result.danglingReferences).toContainEqual({ from: `widget:${w.id}`, kind: "layer", id: 9_999_994 });
  });

  it("DANGLE-none: a well-formed dashboard reports an empty danglingReferences array", () => {
    const dash = createDashboard("dangle-none-dash");
    const table = createTable({ name: "well-formed-table", schema: "" });
    addDashboardTable(dash.id, table.id);
    createWidget(dash.id, { title: "w", type: "table", position: 0, config: { tableId: table.id } });

    const result = buildDashboardExport(dash.id)!;
    expect(result.danglingReferences).toEqual([]);
  });

  it("DANGLE-none: an EMPTY includedLayerIds array produces no dangling entries", () => {
    const dash = createDashboard("dangle-none-empty-layers-dash");
    createWidget(dash.id, { title: "map", type: "map", position: 0, config: { includedLayerIds: [] } });

    const result = buildDashboardExport(dash.id)!;
    expect(result.danglingReferences).toEqual([]);
  });
});

describe("exportFileName — injection safety", () => {
  it("DELIV-name: exportFileName slugifies to [a-z0-9-] only", () => {
    const name = exportFileName({ id: 1, name: "My Dashboard!! 2024" });
    expect(name).toMatch(/^dashboard-1-[a-z0-9-]+\.json$/);
  });

  it("DELIV-name: a dashboard name containing quotes and CRLF cannot escape the filename", () => {
    expect(exportFileName({ id: 5, name: 'Q3 "Sales"\r\nReport' })).toBe("dashboard-5-q3-sales-report.json");
  });

  it("DELIV-name: an all-punctuation dashboard name falls back to a usable filename", () => {
    expect(exportFileName({ id: 2, name: "!!!???" })).toBe("dashboard-2-export.json");
  });
});
