/**
 * Quick 261116-cnt — a "Count (*)" aggregation that counts rows and ignores the metric column.
 * Pure-layer specs (CNT-1..5); the config-panel specs live with each panel (CNT-6..8).
 */
import { describe, it, expect } from "vitest";
import {
  AGGREGATIONS, COUNT_ALL, aggregateExpr, isCountAggregation, valueFormatColumn,
} from "./aggregationLabels";
import { buildChartSql, deriveChartConfig, type ChartSqlInput } from "./chartSql";
import { buildExtraMetricSelect, extraMetricHeader } from "./tableExtraMetrics";
import { buildTimelineSql } from "./buildTimelineSql";
import { buildNumericLineSql } from "./buildNumericLineSql";
import { buildCalendarSql } from "./buildCalendarSql";
import { INTERVAL_LADDER, type TimelineInterval } from "./timelineBin";
import { resolveLineMetricTitle } from "./lineChartTitle";

const base = (over: Partial<ChartSqlInput> & { draft: Record<string, unknown> }): ChartSqlInput => ({
  widgetType: "bar",
  table: "demo.t",
  flags: { usesAggregation: true, requiresGroupBy: true },
  columnTypeMap: {},
  maxBarGroupBySeriesCap: 12,
  resolveMetricExpr: (id, fallback) => (id === undefined ? fallback : null),
  ...over,
});

describe("Count (*) aggregation (CNT)", () => {
  it("CNT-1 is a listed aggregation that emits COUNT(*), formats as a plain count, and ignores the column", () => {
    expect(COUNT_ALL).toBe("COUNT_ALL");
    expect(AGGREGATIONS.find((a) => a.value === COUNT_ALL)?.label).toBe("Count (*)");
    expect(aggregateExpr(COUNT_ALL, "fare")).toBe("COUNT(*)");
    expect(aggregateExpr(COUNT_ALL, "")).toBe("COUNT(*)");
    expect(aggregateExpr("COUNT_DISTINCT", "fare")).toBe("COUNT(DISTINCT fare)");
    expect(aggregateExpr("SUM", "fare")).toBe("SUM(fare)");
    expect(isCountAggregation(COUNT_ALL)).toBe(true);
    expect(valueFormatColumn("fare", COUNT_ALL)).toBe("");
  });

  it("CNT-2 chart SQL: scalar, grouped, multi-column and heatmap need no metric column (a leftover one is ignored)", () => {
    const scalar = { usesAggregation: true, requiresGroupBy: false };
    expect(buildChartSql(base({ widgetType: "bignumber", flags: scalar, draft: { aggregation: COUNT_ALL } })))
      .toBe("SELECT COUNT(*) AS value FROM demo.t");
    expect(buildChartSql(base({ draft: { aggregation: COUNT_ALL, metricColumn: "fare", groupByColumn: "vendor" } })))
      .toBe("SELECT vendor, COUNT(*) AS value FROM demo.t GROUP BY vendor ORDER BY value DESC LIMIT 100");
    expect(buildChartSql(base({ draft: { aggregation: COUNT_ALL, metricColumn: "", groupByColumn: "vendor" } })))
      .toBe("SELECT vendor, COUNT(*) AS value FROM demo.t GROUP BY vendor ORDER BY value DESC LIMIT 100");
    expect(buildChartSql(base({ draft: { aggregation: COUNT_ALL, groupByColumns: ["vendor", "kind"], groupByColumn: "vendor" } })))
      .toBe("SELECT vendor, kind, COUNT(*) AS value FROM demo.t GROUP BY vendor, kind ORDER BY value DESC LIMIT 2400");
    expect(buildChartSql(base({ widgetType: "heatmap", draft: { aggregation: COUNT_ALL, groupByColumns: ["a", "b"], groupByColumn: "a" } })))
      .toContain("SELECT a, b, COUNT(*) AS value FROM demo.t GROUP BY a, b");
    // A non-count aggregation still needs its column.
    expect(buildChartSql(base({ draft: { aggregation: "SUM", metricColumn: "", groupByColumn: "vendor" } })))
      .toBe("SELECT * FROM demo.t LIMIT 100");
    // The AI / overlay derive step accepts it.
    const ctx = { tableName: "demo.t", tableColumns: { vendor: "string" }, maxBarGroupBySeriesCap: 12 };
    expect(deriveChartConfig("bar", { aggregation: COUNT_ALL, groupByColumn: "vendor" }, ctx)?.sql)
      .toBe("SELECT vendor, COUNT(*) AS value FROM demo.t GROUP BY vendor ORDER BY value DESC LIMIT 100");
  });

  it("CNT-3 Data Table additional metric: Count (*) emits without a column and heads its column COUNT(*)", () => {
    expect(buildExtraMetricSelect({ extraMetrics: [{ aggregation: COUNT_ALL }, { column: "fare", aggregation: "SUM" }] }, () => null))
      .toBe("COUNT(*) AS value_2, SUM(fare) AS value_3, ");
    expect(extraMetricHeader({ aggregation: COUNT_ALL, column: "" }, 0)).toBe("COUNT(*)");
  });

  it("CNT-4 timeline, numeric line and calendar SQL emit COUNT(*) for an empty column", () => {
    const hour = INTERVAL_LADDER.find((i) => i.key === "hour")! as TimelineInterval;
    expect(buildTimelineSql({ schema: "demo", table: "t", timeCol: "ts", metric: { column: "", aggregation: COUNT_ALL, color: "FF66C2A5" }, interval: hour, maxIntervals: 200 }))
      .toBe("SELECT DATE_TRUNC('hour', ts) AS bucket, COUNT(*) AS value FROM demo.t WHERE ts IS NOT NULL GROUP BY bucket ORDER BY bucket ASC LIMIT 200");
    expect(buildNumericLineSql({ schema: "demo", table: "t", xField: "d", binWidth: 5, metric: { column: "", aggregation: COUNT_ALL, color: "FF66C2A5" }, maxBuckets: 50 }))
      .toContain("FLOOR(d / 5) * 5 AS bucket, COUNT(*) AS value");
    expect(buildCalendarSql({ fromTarget: "demo.t", timeCol: "ts", metricColumn: "", aggregation: COUNT_ALL, domain: "month", subdomain: "day" }))
      .toContain("AS subdomain_bucket, COUNT(*) AS value FROM demo.t");
  });

  it("CNT-5 the value-axis / series title reads 'Count of rows', never the ignored column", () => {
    expect(resolveLineMetricTitle({ metricColumn: "fare", columnLabel: "Fare ($)", aggregation: COUNT_ALL })).toBe("Count of rows");
    expect(resolveLineMetricTitle({ metricColumn: "", aggregation: COUNT_ALL })).toBe("Count of rows");
    expect(resolveLineMetricTitle({ yFieldLabel: "Trips", aggregation: COUNT_ALL })).toBe("Trips");
  });
});
