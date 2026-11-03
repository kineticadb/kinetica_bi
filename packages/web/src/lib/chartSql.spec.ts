import { describe, it, expect } from "vitest";
import { buildChartSql, deriveChartConfig, type ChartSqlInput } from "./chartSql";
import { inferDataTypeFromColumn } from "./columnTypes";

const base = (over: Partial<ChartSqlInput> & { draft: Record<string, unknown> }): ChartSqlInput => ({
  widgetType: "bar",
  table: "demo.t",
  flags: { usesAggregation: true, requiresGroupBy: true },
  columnTypeMap: {},
  maxBarGroupBySeriesCap: 12,
  resolveMetricExpr: (id, fallback) => (id === undefined ? fallback : null),
  ...over,
});

describe("buildChartSql characterization", () => {
  it("CSQL-1 records", () => {
    const flags = { usesAggregation: false, requiresGroupBy: false };
    expect(
      buildChartSql(base({ widgetType: "records", flags, draft: { columns: "a, b, bad col", sortField: "a", sortDirection: "desc" } })),
    ).toBe("SELECT a, b FROM demo.t ORDER BY a DESC");
    expect(buildChartSql(base({ widgetType: "records", flags, draft: { columns: "" } }))).toBe("SELECT * FROM demo.t");
  });

  it("CSQL-2 bignumber", () => {
    const flags = { usesAggregation: true, requiresGroupBy: false };
    const mk = (draft: Record<string, unknown>) => buildChartSql(base({ widgetType: "bignumber", flags, draft }));
    expect(mk({ metricColumn: "fare", aggregation: "SUM" })).toBe("SELECT SUM(fare) AS value FROM demo.t");
    expect(mk({ metricColumn: "fare", aggregation: "COUNT_DISTINCT" })).toBe("SELECT COUNT(DISTINCT fare) AS value FROM demo.t");
    expect(mk({})).toBe("SELECT * FROM demo.t LIMIT 100");
    expect(mk({ metricColumn: "fare", aggregation: "SUM", customWhere: "x > 1" })).toBe(
      "SELECT SUM(fare) AS value FROM demo.t WHERE (x > 1)",
    );
  });

  it("CSQL-3 bar single group-by", () => {
    const d = { metricColumn: "fare", aggregation: "AVG", groupByColumn: "vendor", sortDir: "ASC", limit: 25 };
    expect(buildChartSql(base({ draft: d }))).toBe(
      "SELECT vendor, AVG(fare) AS value FROM demo.t GROUP BY vendor ORDER BY value ASC LIMIT 25",
    );
    expect(buildChartSql(base({ draft: { ...d, limit: 7 } }))).toContain("LIMIT 100");
  });

  it("CSQL-4 multi group-by limit multiplier", () => {
    const d = { metricColumn: "fare", aggregation: "SUM", groupByColumns: ["a", "b"], sortDir: "DESC", limit: 10 };
    expect(buildChartSql(base({ draft: d }))).toBe(
      "SELECT a, b, SUM(fare) AS value FROM demo.t GROUP BY a, b ORDER BY value DESC LIMIT 240",
    );
    expect(buildChartSql(base({ widgetType: "line", draft: d }))).toContain("LIMIT 240");
    expect(buildChartSql(base({ widgetType: "table", draft: d }))).toContain("LIMIT 10");
  });

  it("CSQL-5 custom metric", () => {
    const d = { metricId: 3, groupByColumn: "vendor", sortDir: "DESC", limit: 10 };
    expect(buildChartSql(base({ draft: d, tableId: 1, resolveMetricExpr: () => "SUM(a)/COUNT(*)" }))).toBe(
      "SELECT vendor, SUM(a)/COUNT(*) AS value FROM demo.t GROUP BY vendor ORDER BY value DESC LIMIT 10",
    );
    expect(buildChartSql(base({ draft: d, tableId: 1, resolveMetricExpr: () => null }))).toBe(
      "SELECT * FROM demo.t LIMIT 100",
    );
  });

  it("CSQL-6 heatmap chart bucketed", () => {
    const d = {
      metricColumn: "fare", aggregation: "SUM", groupByColumns: ["pickup", "vendor"],
      xBucket: "day", sortDir: "DESC", limit: 5000,
    };
    expect(
      buildChartSql(base({ widgetType: "heatmap", draft: d, columnTypeMap: { pickup: "timestamp", vendor: "string" } })),
    ).toBe(
      "SELECT DATE_TRUNC('day', pickup) AS pickup, vendor, SUM(fare) AS value FROM demo.t GROUP BY DATE_TRUNC('day', pickup), vendor ORDER BY value DESC LIMIT 5000",
    );
  });
});

describe("deriveChartConfig", () => {
  const ctx = { tableName: "demo.t", tableColumns: { vendor: "string", fare: "double" }, maxBarGroupBySeriesCap: 12 };

  it("CSQL-7 bar", () => {
    expect(
      deriveChartConfig("bar", { metricColumn: "fare", aggregation: "SUM", groupByColumn: "vendor", sortDir: "DESC", limit: 10 }, ctx),
    ).toEqual({
      sql: "SELECT vendor, SUM(fare) AS value FROM demo.t GROUP BY vendor ORDER BY value DESC LIMIT 10",
      drillDownColumn: "vendor",
      drillDownColumnType: inferDataTypeFromColumn("vendor", ctx.tableColumns),
    });
  });

  it("CSQL-8 bignumber has no drill column", () => {
    const r = deriveChartConfig("bignumber", { metricColumn: "fare", aggregation: "SUM" }, ctx);
    expect(r?.drillDownColumn).toBe("");
    expect(r?.drillDownColumnType).toBe("null");
    expect(r?.sql).toBe("SELECT SUM(fare) AS value FROM demo.t");
  });

  it("CSQL-9 hardening", () => {
    const ok = { metricColumn: "fare", aggregation: "SUM", groupByColumn: "vendor" };
    expect(deriveChartConfig("bar", ok, ctx)).not.toBeNull();
    expect(deriveChartConfig("bar", { ...ok, metricColumn: "a b" }, ctx)).toBeNull();
    expect(deriveChartConfig("bar", { ...ok, groupByColumn: "x;DROP" }, ctx)).toBeNull();
    expect(deriveChartConfig("bar", { ...ok, groupByColumns: ["vendor", "y z"] }, ctx)).toBeNull();
    expect(deriveChartConfig("bar", { ...ok, aggregation: "SUM) FROM x" }, ctx)).toBeNull();
    expect(deriveChartConfig("bar", { ...ok, aggregation: "median" }, ctx)).toBeNull();
    expect(deriveChartConfig("bar", ok, { ...ctx, tableName: "demo.t; DROP" })).toBeNull();
    expect(deriveChartConfig("records", ok, ctx)).toBeNull();
    expect(deriveChartConfig("map", ok, ctx)).toBeNull();
  });

  it("CSQL-10 customWhere preserved", () => {
    const r = deriveChartConfig(
      "bar",
      { metricColumn: "fare", aggregation: "SUM", groupByColumn: "vendor", customWhere: "fare > 1", limit: 10 },
      ctx,
    );
    expect(r?.sql).toBe(
      "SELECT vendor, SUM(fare) AS value FROM demo.t WHERE (fare > 1) GROUP BY vendor ORDER BY value DESC LIMIT 10",
    );
  });
});
