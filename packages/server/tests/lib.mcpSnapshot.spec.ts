// Phase 143 (AIMCP-V20-08): the snapshot of a saved dashboard, built on the server for a Claude Desktop edit session.
import { describe, it, expect, beforeEach } from "vitest";
import { db, createDashboard, createTable, addDashboardTable, createWidget, createDashboardLayer, createDashboardDynamicView } from "../src/db";
import { snapshotForDashboard } from "../src/lib/mcp/mcpSnapshot";

beforeEach(() => {
  db.exec("DELETE FROM dashboard_layers; DELETE FROM dashboard_dynamic_views; DELETE FROM widgets; DELETE FROM dashboard_tables; DELETE FROM dashboards; DELETE FROM tables;");
});

describe("snapshotForDashboard", () => {
  it("MCPSNAP-1 widgets with layout and binding, layers on their map, views with columns; never filter values or SQL", () => {
    const d = createDashboard("Saved", "").id;
    const T = createTable({ schema: "fleet", name: "trips", columns: {} }).id;
    addDashboardTable(d, T);
    const W = createWidget(d, { title: "Fares", type: "bar", position: 0, config: { tableId: T, metricColumn: "fare", aggregation: "SUM", groupByColumn: "zone", sql: "SELECT secret", customWhere: "zone = 'SECRET_VALUE'", layout: { x: 0, y: 0, w: 12, h: 20 } } }).id;
    const M = createWidget(d, { title: "Map", type: "map", position: 1, config: { layout: { x: 12, y: 0, w: 24, h: 40 } } }).id;
    const L = createDashboardLayer(d, { table_id: T, config: { renderMode: "heatmap", name: "Pickups", latColumn: "lat", lonColumn: "lon" } }).id;
    const V = createDashboardDynamicView(d, { source_table_id: T, name: "By zone", template_sql: "SELECT zone, COUNT(*) AS n FROM {view} GROUP BY zone", max_records: 10, columns_json: [{ name: "zone", type: "string" }, { name: "n", type: "long" }] }).id;
    const s = snapshotForDashboard(d);
    expect(s.widgets).toEqual([
      { id: W, type: "bar", title: "Fares", tableId: T, layout: { x: 0, y: 0, w: 12, h: 20 }, binding: { aggregation: "SUM", metricColumn: "fare", groupByColumn: "zone" } },
      { id: M, type: "map", title: "Map", layout: { x: 12, y: 0, w: 24, h: 40 } },
    ]);
    expect(s.layers).toEqual([{ id: L, widgetId: M, title: "Pickups", tableId: T, renderMode: "heatmap", columns: expect.arrayContaining(["lat", "lon"]) }]);
    expect(s.dynamicViews).toEqual([{ id: V, name: "By zone", baseTableId: T, aggregated: true, columns: [{ name: "zone", type: "string" }, { name: "n", type: "long" }] }]);
    expect(s.filters).toEqual([]);
    expect(JSON.stringify(s)).not.toMatch(/SECRET_VALUE|SELECT secret/);
  });
});
