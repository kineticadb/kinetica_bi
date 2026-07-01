import { describe, it, expect } from "vitest";
import { buildNumericLineSql } from "./buildNumericLineSql";
import type { NumericMetric } from "./numericBin";
import { MAX_SERIES } from "./groupedSeries";

const metric = (over: Partial<NumericMetric> = {}): NumericMetric => ({
  column: "fare_amount",
  aggregation: "SUM",
  color: "FF66C2A5",
  ...over,
});

describe("buildNumericLineSql", () => {
  it("emits FLOOR-bucket GROUP BY with schema-qualified FROM and LIMIT maxBuckets+1", () => {
    const sql = buildNumericLineSql({
      schema: "demo",
      table: "nyctaxi",
      xField: "trip_distance",
      binWidth: 5,
      metric: metric(),
      maxBuckets: 50,
    });
    expect(sql).toBe(
      "SELECT FLOOR(trip_distance / 5) * 5 AS bucket, SUM(fare_amount) AS value " +
        "FROM demo.nyctaxi WHERE trip_distance IS NOT NULL " +
        "GROUP BY bucket ORDER BY bucket ASC LIMIT 51",
    );
  });

  it("COUNT_DISTINCT → COUNT(DISTINCT col) (not a Kinetica function)", () => {
    const sql = buildNumericLineSql({
      schema: "demo",
      table: "nyctaxi",
      xField: "trip_distance",
      binWidth: 1,
      metric: metric({ aggregation: "COUNT_DISTINCT", column: "vendor_id" }),
      maxBuckets: 25,
    });
    expect(sql).toContain("COUNT(DISTINCT vendor_id) AS value");
    expect(sql).toContain("LIMIT 26");
  });

  it("empty schema → unprefixed FROM (filter-view / DV-bound)", () => {
    const sql = buildNumericLineSql({
      schema: "",
      table: "_kbi_filt_x",
      xField: "trip_distance",
      binWidth: 0.5,
      metric: metric(),
      maxBuckets: 50,
    });
    expect(sql).toContain("FROM _kbi_filt_x ");
    expect(sql).toContain("FLOOR(trip_distance / 0.5) * 0.5 AS bucket");
  });
});

describe("buildNumericLineSql — grouped (Phase 72)", () => {
  it("no group-by arg → byte-identical to baseline", () => {
    const sql = buildNumericLineSql({
      schema: "demo",
      table: "nyctaxi",
      xField: "trip_distance",
      binWidth: 5,
      metric: metric(),
      maxBuckets: 50,
    });
    expect(sql).toBe(
      "SELECT FLOOR(trip_distance / 5) * 5 AS bucket, SUM(fare_amount) AS value " +
        "FROM demo.nyctaxi WHERE trip_distance IS NOT NULL " +
        "GROUP BY bucket ORDER BY bucket ASC LIMIT 51",
    );
  });

  it("groupByColumn emits FLOOR bucket + series + GROUP BY bucket, series + IS NOT NULL", () => {
    const sql = buildNumericLineSql({
      schema: "demo",
      table: "nyctaxi",
      xField: "trip_distance",
      binWidth: 5,
      metric: metric(),
      maxBuckets: 50,
      groupByColumn: "vendor",
    });
    expect(sql).toContain("FLOOR(trip_distance / 5) * 5 AS bucket");
    expect(sql).toContain("vendor AS series");
    expect(sql).toContain("GROUP BY bucket, series");
    expect(sql).toContain("AND vendor IS NOT NULL");
  });

  it("grouped LIMIT scales (maxBuckets + 1) by MAX_SERIES", () => {
    const sql = buildNumericLineSql({
      schema: "demo",
      table: "nyctaxi",
      xField: "trip_distance",
      binWidth: 5,
      metric: metric(),
      maxBuckets: 50,
      groupByColumn: "vendor",
    });
    expect(sql).toContain(`LIMIT ${51 * MAX_SERIES}`);
  });

  it("seriesIn emits numeric IN-filter and LIMIT scaled by list length", () => {
    const sql = buildNumericLineSql({
      schema: "demo",
      table: "nyctaxi",
      xField: "trip_distance",
      binWidth: 5,
      metric: metric(),
      maxBuckets: 50,
      groupByColumn: "vendor",
      seriesIn: [1, 2],
    });
    expect(sql).toContain("vendor IN (1, 2)");
    expect(sql).toContain(`LIMIT ${51 * 2}`);
  });
});

describe("buildNumericLineSql — custom metrics branch (Phase 100-02)", () => {
  // Byte-identical regression lock: absent metricId → EXACT same string as baseline.
  it("absent metricId on metric → byte-identical to baseline (regression lock, criterion 4)", () => {
    const sql = buildNumericLineSql({
      schema: "demo",
      table: "nyctaxi",
      xField: "trip_distance",
      binWidth: 5,
      metric: metric(), // no metricId
      maxBuckets: 50,
      tableId: 42,
    });
    expect(sql).toBe(
      "SELECT FLOOR(trip_distance / 5) * 5 AS bucket, SUM(fare_amount) AS value " +
        "FROM demo.nyctaxi WHERE trip_distance IS NOT NULL " +
        "GROUP BY bucket ORDER BY bucket ASC LIMIT 51",
    );
  });

  it("custom metricId on metric + store seeded → ungrouped emits raw expression (no AGG wrapper)", async () => {
    const { useCustomMetricsStore } = await import("../store/customMetricsStore");
    useCustomMetricsStore.getState().setConfig(42, [
      {
        id: 7,
        table_id: 42,
        label: "ROAS",
        expression: "SUM(revenue)/SUM(cost)",
        format_spec: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);
    const sql = buildNumericLineSql({
      schema: "demo",
      table: "nyctaxi",
      xField: "trip_distance",
      binWidth: 5,
      metric: metric({ metricId: 7 }),
      maxBuckets: 50,
      tableId: 42,
    });
    expect(sql).toContain("SUM(revenue)/SUM(cost) AS value");
    expect(sql).not.toContain("SUM(SUM(");
    expect(sql).not.toContain("SUM()");
    expect(sql).not.toContain("SUM(fare_amount) AS value");
    useCustomMetricsStore.getState().reset();
  });

  it("custom metricId on metric + store seeded → grouped emits raw expression (no AGG wrapper)", async () => {
    const { useCustomMetricsStore } = await import("../store/customMetricsStore");
    useCustomMetricsStore.getState().setConfig(42, [
      {
        id: 7,
        table_id: 42,
        label: "ROAS",
        expression: "SUM(revenue)/SUM(cost)",
        format_spec: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);
    const sql = buildNumericLineSql({
      schema: "demo",
      table: "nyctaxi",
      xField: "trip_distance",
      binWidth: 5,
      metric: metric({ metricId: 7 }),
      maxBuckets: 50,
      groupByColumn: "vendor",
      tableId: 42,
    });
    expect(sql).toContain("SUM(revenue)/SUM(cost) AS value");
    expect(sql).not.toContain("SUM(SUM(");
    expect(sql).not.toContain("SUM(fare_amount) AS value");
    useCustomMetricsStore.getState().reset();
  });
});

describe("buildNumericLineSql — customWhere (Phase 98-01)", () => {
  // Byte-identical regression lock: omitting customWhere must yield EXACT same string as baseline.
  it("absent customWhere → byte-identical to baseline (regression lock)", () => {
    const sql = buildNumericLineSql({
      schema: "demo",
      table: "nyctaxi",
      xField: "trip_distance",
      binWidth: 5,
      metric: metric(),
      maxBuckets: 50,
    });
    expect(sql).toBe(
      "SELECT FLOOR(trip_distance / 5) * 5 AS bucket, SUM(fare_amount) AS value " +
        "FROM demo.nyctaxi WHERE trip_distance IS NOT NULL " +
        "GROUP BY bucket ORDER BY bucket ASC LIMIT 51",
    );
  });

  it("ungrouped + non-empty customWhere → AND (...) appended after IS NOT NULL, before GROUP BY", () => {
    const sql = buildNumericLineSql({
      schema: "demo",
      table: "nyctaxi",
      xField: "trip_distance",
      binWidth: 5,
      metric: metric(),
      maxBuckets: 50,
      customWhere: "status = 'active'",
    });
    expect(sql).toBe(
      "SELECT FLOOR(trip_distance / 5) * 5 AS bucket, SUM(fare_amount) AS value " +
        "FROM demo.nyctaxi WHERE trip_distance IS NOT NULL AND (status = 'active') " +
        "GROUP BY bucket ORDER BY bucket ASC LIMIT 51",
    );
  });

  it("grouped + non-empty customWhere → AND (...) appended LAST before GROUP BY", () => {
    const sql = buildNumericLineSql({
      schema: "demo",
      table: "nyctaxi",
      xField: "trip_distance",
      binWidth: 5,
      metric: metric(),
      maxBuckets: 50,
      groupByColumn: "vendor",
      customWhere: "status = 'active'",
    });
    expect(sql).toContain("AND vendor IS NOT NULL AND (status = 'active') GROUP BY bucket, series");
  });
});
