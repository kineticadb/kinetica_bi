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

// Data Table multi-metric (extraMetrics): extra aggregates are emitted BEFORE the primary
// `AS value` item so liveMetricSql's last-item swap keeps working; aliases are positional.
describe("buildChartSql — Data Table extra metrics", () => {
  const tbl = (draft: Record<string, unknown>, over: Partial<ChartSqlInput> = {}) =>
    buildChartSql(base({ widgetType: "table", draft, ...over }));

  it("TMM-1 single group-by: extras precede the primary value, ORDER BY stays on value", () => {
    expect(
      tbl({
        metricColumn: "outages", aggregation: "SUM", groupByColumn: "site", limit: 25,
        extraMetrics: [{ column: "mttr", aggregation: "AVG" }, { column: "ticket", aggregation: "COUNT_DISTINCT" }],
      }),
    ).toBe(
      "SELECT site, AVG(mttr) AS value_2, COUNT(DISTINCT ticket) AS value_3, SUM(outages) AS value FROM demo.t GROUP BY site ORDER BY value DESC LIMIT 25",
    );
  });

  it("TMM-2 multi group-by and custom primary metric", () => {
    expect(
      tbl(
        { metricId: 3, groupByColumns: ["site", "region"], limit: 10, extraMetrics: [{ column: "mttr", aggregation: "MAX" }] },
        { tableId: 1, resolveMetricExpr: (id) => (id === 3 ? "SUM(a)/COUNT(*)" : null) },
      ),
    ).toBe(
      "SELECT site, region, MAX(mttr) AS value_2, SUM(a)/COUNT(*) AS value FROM demo.t GROUP BY site, region ORDER BY value DESC LIMIT 10",
    );
  });

  it("TMM-3 custom extra metric resolves; incomplete/unsafe/orphaned extras are skipped but keep positional aliases", () => {
    expect(
      tbl(
        {
          metricColumn: "outages", aggregation: "SUM", groupByColumn: "site",
          extraMetrics: [
            { column: "", aggregation: "SUM" },          // incomplete -> skipped (value_2 unused)
            { metricId: 9 },                              // custom -> value_3
            { column: "x; DROP", aggregation: "SUM" },   // unsafe ident -> skipped
            { column: "mttr", aggregation: "MEDIAN) --" }, // unknown aggregation -> skipped
            { metricId: 404 },                            // orphaned custom -> skipped
            { column: "mttr", aggregation: "MIN" },      // value_7
          ],
        },
        { tableId: 1, resolveMetricExpr: (id) => (id === 9 ? "AVG(b - c)" : null) },
      ),
    ).toBe(
      "SELECT site, AVG(b - c) AS value_3, MIN(mttr) AS value_7, SUM(outages) AS value FROM demo.t GROUP BY site ORDER BY value DESC LIMIT 100",
    );
  });

  it("TMM-4 byte-identical without extras; extras ignored on non-table types", () => {
    const d = { metricColumn: "fare", aggregation: "SUM", groupByColumn: "vendor", limit: 10 };
    const plain = "SELECT vendor, SUM(fare) AS value FROM demo.t GROUP BY vendor ORDER BY value DESC LIMIT 10";
    expect(tbl(d)).toBe(plain);
    expect(tbl({ ...d, extraMetrics: [] })).toBe(plain);
    expect(buildChartSql(base({ widgetType: "bar", draft: { ...d, extraMetrics: [{ column: "tip", aggregation: "SUM" }] } }))).toBe(plain);
  });
});

describe("deriveChartConfig — Data Table extra metrics", () => {
  const ctx = { tableName: "demo.t", tableColumns: { vendor: "string", fare: "double", tip: "double" }, maxBarGroupBySeriesCap: 12 };
  const ok = { metricColumn: "fare", aggregation: "SUM", groupByColumn: "vendor", limit: 10 };

  it("TMM-5 derives extras for a table and fails closed on unsafe extras", () => {
    expect(deriveChartConfig("table", { ...ok, extraMetrics: [{ column: "tip", aggregation: "AVG" }] }, ctx)?.sql).toBe(
      "SELECT vendor, AVG(tip) AS value_2, SUM(fare) AS value FROM demo.t GROUP BY vendor ORDER BY value DESC LIMIT 10",
    );
    expect(deriveChartConfig("table", { ...ok, extraMetrics: "tip" }, ctx)).toBeNull();
    expect(deriveChartConfig("table", { ...ok, extraMetrics: [{ column: "tip x", aggregation: "AVG" }] }, ctx)).toBeNull();
    expect(deriveChartConfig("table", { ...ok, extraMetrics: [{ column: "tip", aggregation: "AVG(1)) --" }] }, ctx)).toBeNull();
    expect(deriveChartConfig("table", { ...ok, extraMetrics: ["tip"] }, ctx)).toBeNull();
  });
});

// Quick 261116-bti: bar chart time bucketing in the SQL generator.
describe("buildChartSql — bar time bucketing (BTI)", () => {
  const types = { ts: "timestamp", vendor: "string", fare: "double" };
  const bar = (draft: Record<string, unknown>) =>
    buildChartSql(base({ widgetType: "bar", draft, columnTypeMap: types }));
  const d = { metricColumn: "fare", aggregation: "SUM", groupByColumn: "ts", limit: 100 };

  it("BTI-5 a time x-axis buckets with DATE_TRUNC and orders by time (latest kept); Auto stores a month fallback", () => {
    expect(bar({ ...d, timeInterval: "day" })).toBe(
      "SELECT DATE_TRUNC('day', ts) AS ts, SUM(fare) AS value FROM demo.t GROUP BY DATE_TRUNC('day', ts) ORDER BY DATE_TRUNC('day', ts) DESC LIMIT 100",
    );
    expect(bar({ ...d, timeInterval: "auto" })).toContain("DATE_TRUNC('month', ts) AS ts");
    expect(bar({ ...d, timeInterval: "auto", timeIntervalMin: "year" })).toContain("DATE_TRUNC('year', ts) AS ts");
    expect(
      bar({ metricColumn: "fare", aggregation: "SUM", groupByColumns: ["ts", "vendor"], groupByColumn: "ts", limit: 10, timeInterval: "hour" }),
    ).toBe(
      "SELECT DATE_TRUNC('hour', ts) AS ts, vendor, SUM(fare) AS value FROM demo.t GROUP BY DATE_TRUNC('hour', ts), vendor ORDER BY DATE_TRUNC('hour', ts) DESC LIMIT 240",
    );
  });

  it("BTI-6 byte-identical when the interval is None/absent, the column is not temporal, or the type is not bar", () => {
    const legacy = "SELECT ts, SUM(fare) AS value FROM demo.t GROUP BY ts ORDER BY value DESC LIMIT 100";
    expect(bar(d)).toBe(legacy);
    expect(bar({ ...d, timeInterval: "none" })).toBe(legacy);
    expect(bar({ ...d, groupByColumn: "vendor", timeInterval: "auto" })).toBe(
      "SELECT vendor, SUM(fare) AS value FROM demo.t GROUP BY vendor ORDER BY value DESC LIMIT 100",
    );
    expect(buildChartSql(base({ widgetType: "line", draft: { ...d, timeInterval: "auto" }, columnTypeMap: types }))).toBe(legacy);
  });
});
