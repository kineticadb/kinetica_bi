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
