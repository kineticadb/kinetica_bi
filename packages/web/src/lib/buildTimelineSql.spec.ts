import { describe, it, expect } from "vitest";
import { buildTimelineSql } from "./buildTimelineSql";
import { INTERVAL_LADDER } from "./timelineBin";
import type { TimelineInterval, TimelineMetric } from "./timelineBin";

describe("buildTimelineSql", () => {
  // Helpers: look up real ladder entries (tests exercise the real ladder per plan spec)
  const hourEntry = INTERVAL_LADDER.find((i) => i.key === "hour")! as TimelineInterval;
  const thirtyMinEntry = INTERVAL_LADDER.find((i) => i.key === "30min")! as TimelineInterval;
  const dayEntry = INTERVAL_LADDER.find((i) => i.key === "day")! as TimelineInterval;
  const minuteEntry = INTERVAL_LADDER.find((i) => i.key === "minute")! as TimelineInterval;

  const baseMetric: TimelineMetric = {
    column: "fare_amount",
    aggregation: "SUM",
    color: "FF66C2A5",
  };

  // Test 1: Full DATE_TRUNC path — SUM + hour interval
  it("emits DATE_TRUNC bucket + SUM + GROUP BY bucket + ORDER BY + LIMIT", () => {
    const sql = buildTimelineSql({
      schema: "demo",
      table: "nyctaxi",
      timeCol: "pickup_time",
      metric: baseMetric,
      interval: hourEntry,
      maxIntervals: 200,
    });
    expect(sql).toBe(
      "SELECT DATE_TRUNC('hour', pickup_time) AS bucket, SUM(fare_amount) AS value FROM demo.nyctaxi WHERE pickup_time IS NOT NULL GROUP BY bucket ORDER BY bucket ASC LIMIT 200"
    );
  });

  // Test 2: COUNT_DISTINCT emits COUNT(DISTINCT col) not COUNT_DISTINCT(col)
  it("COUNT_DISTINCT aggregation emits COUNT(DISTINCT col) AS value", () => {
    const sql = buildTimelineSql({
      schema: "demo",
      table: "nyctaxi",
      timeCol: "pickup_time",
      metric: { column: "vendor_id", aggregation: "COUNT_DISTINCT", color: "FF4E79A7" },
      interval: hourEntry,
      maxIntervals: 200,
    });
    expect(sql).toContain("COUNT(DISTINCT vendor_id) AS value");
    // Must NOT use incorrect COUNT_DISTINCT syntax
    expect(sql).not.toContain("COUNT_DISTINCT(vendor_id)");
  });

  // Test 3a: COUNT with a real column name emits COUNT(col)
  it("COUNT aggregation with real column emits COUNT(col) AS value", () => {
    const sql = buildTimelineSql({
      schema: "demo",
      table: "nyctaxi",
      timeCol: "pickup_time",
      metric: { column: "trip_id", aggregation: "COUNT", color: "FF59A14F" },
      interval: dayEntry,
      maxIntervals: 100,
    });
    expect(sql).toContain("COUNT(trip_id) AS value");
  });

  // Test 3b: COUNT with "*" column emits COUNT(*) AS value
  it("COUNT aggregation with column='*' emits COUNT(*) AS value", () => {
    const sql = buildTimelineSql({
      schema: "demo",
      table: "nyctaxi",
      timeCol: "pickup_time",
      metric: { column: "*", aggregation: "COUNT", color: "FF59A14F" },
      interval: dayEntry,
      maxIntervals: 100,
    });
    expect(sql).toContain("COUNT(*) AS value");
  });

  // Test 4: FLOOR-epoch bucket for 30min interval
  it("30min interval emits TO_TIMESTAMP(FLOOR(EXTRACT(EPOCH FROM ...)) bucket", () => {
    const sql = buildTimelineSql({
      schema: "demo",
      table: "nyctaxi",
      timeCol: "pickup_time",
      metric: baseMetric,
      interval: thirtyMinEntry,
      maxIntervals: 200,
    });
    expect(sql).toBe(
      "SELECT TO_TIMESTAMP(FLOOR(EXTRACT(EPOCH FROM pickup_time) / 1800) * 1800) AS bucket, SUM(fare_amount) AS value FROM demo.nyctaxi WHERE pickup_time IS NOT NULL GROUP BY bucket ORDER BY bucket ASC LIMIT 200"
    );
  });

  // Test 5: Empty schema (DV-bound) → unprefixed FROM
  it("empty schema emits unprefixed FROM (DV-bound)", () => {
    const sql = buildTimelineSql({
      schema: "",
      table: "_kbi_dv_v1234",
      timeCol: "ts",
      metric: baseMetric,
      interval: hourEntry,
      maxIntervals: 200,
    });
    expect(sql).toContain("FROM _kbi_dv_v1234 ");
    expect(sql).not.toContain("FROM ._kbi_dv_v1234");
    expect(sql).not.toContain("FROM ."); // no leading-dot schema prefix
  });

  // Test 6: WHERE always includes timeCol IS NOT NULL
  it("WHERE clause always includes timeCol IS NOT NULL", () => {
    const sql = buildTimelineSql({
      schema: "demo",
      table: "nyctaxi",
      timeCol: "pickup_time",
      metric: baseMetric,
      interval: dayEntry,
      maxIntervals: 100,
    });
    expect(sql).toContain("WHERE pickup_time IS NOT NULL");
  });

  // Test 7: ORDER BY bucket ASC + LIMIT clause present in all output
  it("ORDER BY bucket ASC and LIMIT maxIntervals always present", () => {
    const sql = buildTimelineSql({
      schema: "demo",
      table: "trips",
      timeCol: "event_time",
      metric: { column: "distance", aggregation: "AVG", color: "FFED665D" },
      interval: minuteEntry,
      maxIntervals: 50,
    });
    expect(sql).toContain("ORDER BY bucket ASC");
    expect(sql).toContain("LIMIT 50");
  });

  // Test 8: GROUP BY uses the literal alias "bucket" (not the full DATE_TRUNC expression)
  it("GROUP BY uses alias 'bucket', not the full DATE_TRUNC expression", () => {
    const sql = buildTimelineSql({
      schema: "demo",
      table: "events",
      timeCol: "ts",
      metric: { column: "revenue", aggregation: "MAX", color: "FF76B7B2" },
      interval: dayEntry,
      maxIntervals: 200,
    });
    // Should use the alias, not repeat the full expression
    expect(sql).toContain("GROUP BY bucket");
    // Verify it's not repeating the DATE_TRUNC in GROUP BY
    expect(sql).not.toContain("GROUP BY DATE_TRUNC");
  });
});
