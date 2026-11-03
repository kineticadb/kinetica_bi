import { describe, it, expect } from "vitest";
import { mergeWidgetOverlay } from "./widgetOverlay";
import { deriveChartConfig } from "./chartSql";
import { translateWidgetOverlay } from "./widgetOverlayKeys";
import type { WidgetDto, TableDto } from "../api/client";

const table: TableDto = {
  id: 5, schema: "demo", name: "trips", created_at: "", updated_at: "",
  columns: { vendor_id: "string", fare_amount: "double" },
};
const deps = { tables: [table], maxBarGroupBySeriesCap: 12 };
const w = (type: string, config: Record<string, unknown>): WidgetDto => ({
  id: 1, dashboard_id: 1, title: "t", type, position: 0, config, created_at: "", updated_at: "",
});
const barCfg = { tableId: 5, groupByColumn: "vendor_id", metricColumn: "fare_amount", aggregation: "SUM", sortDir: "DESC", limit: 10 };

describe("mergeWidgetOverlay", () => {
  it("WOV-1: null overlay returns the same widget object", () => {
    const widget = w("bar", barCfg);
    expect(mergeWidgetOverlay(widget, null, deps)).toBe(widget);
  });
  it("WOV-2: SQL-touching overlay regenerates sql like deriveChartConfig", () => {
    const widget = w("bar", barCfg);
    const out = mergeWidgetOverlay(widget, { aggregation: "avg" }, deps);
    const merged = { ...barCfg, ...translateWidgetOverlay("bar", { aggregation: "avg" }) };
    const d = deriveChartConfig("bar", merged, {
      tableName: "demo.trips", tableColumns: table.columns, maxBarGroupBySeriesCap: 12,
      resolveMetricExpr: (_id, fb) => fb,
    });
    expect(d).not.toBeNull();
    expect(out.config.aggregation).toBe("AVG");
    expect(out.config.sql).toBe(d!.sql);
    expect(String(out.config.sql)).toContain("AVG(");
  });
  it("WOV-3: dv-bound bar is merged only, sql untouched", () => {
    const widget = w("bar", { ...barCfg, dynamicViewId: 9, sql: "SELECT 1" });
    const out = mergeWidgetOverlay(widget, { aggregation: "avg" }, deps);
    expect(out.config.sql).toBe("SELECT 1");
    expect(out.config.aggregation).toBe("AVG");
  });
  it("WOV-4: records widget merges without derivation", () => {
    const widget = w("records", { tableId: 5, sql: "SELECT 2" });
    const out = mergeWidgetOverlay(widget, { page_size: 50 }, deps);
    expect(out.config).toEqual({ tableId: 5, sql: "SELECT 2", pageSize: 50 });
  });
});
