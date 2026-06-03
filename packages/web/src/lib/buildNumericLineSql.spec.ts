import { describe, it, expect } from "vitest";
import { buildNumericLineSql } from "./buildNumericLineSql";
import type { NumericMetric } from "./numericBin";

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
