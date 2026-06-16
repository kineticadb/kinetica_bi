/**
 * Tests for buildCalendarSql.ts — two-level DATE_TRUNC aggregation SQL builder.
 *
 * Output columns contract (pivot contract for the CalendarRenderer):
 *   domain_bucket   — DATE_TRUNC('<domain>', timeCol)   AS domain_bucket
 *   subdomain_bucket — DATE_TRUNC('<subdomain>', timeCol) AS subdomain_bucket
 *   value           — AGG(metricColumn) AS value
 *
 * fromTarget is pre-resolved by the caller — NEVER using fromSwap().
 * (fromSwap's first-FROM regex would clobber the 'FROM' token inside
 *  EXTRACT(EPOCH FROM ...) — the same clobber-reason as TimelineRenderer line 202.)
 */
import { describe, it, expect } from "vitest";
import { buildCalendarSql } from "./buildCalendarSql";
import { CELL_LIMIT } from "./calendarBin";

describe("buildCalendarSql", () => {
  // Test 1: Full shape (month domain, day subdomain, SUM) — exact string match
  it("emits exact two-level DATE_TRUNC + SUM + GROUP BY alias + ORDER BY + LIMIT", () => {
    const sql = buildCalendarSql({
      fromTarget: "demo.nyctaxi",
      timeCol: "pickup_time",
      metricColumn: "fare_amount",
      aggregation: "SUM",
      domain: "month",
      subdomain: "day",
    });
    expect(sql).toBe(
      "SELECT DATE_TRUNC('month', pickup_time) AS domain_bucket, DATE_TRUNC('day', pickup_time) AS subdomain_bucket, SUM(fare_amount) AS value FROM demo.nyctaxi WHERE pickup_time IS NOT NULL GROUP BY domain_bucket, subdomain_bucket ORDER BY domain_bucket ASC, subdomain_bucket ASC LIMIT 10000"
    );
  });

  // Test 2: TWO DATE_TRUNC calls — one for domain_bucket, one for subdomain_bucket
  it("emits two separate DATE_TRUNC calls for domain and subdomain", () => {
    const sql = buildCalendarSql({
      fromTarget: "demo.nyctaxi",
      timeCol: "ts",
      metricColumn: "revenue",
      aggregation: "AVG",
      domain: "year",
      subdomain: "month",
    });
    expect(sql).toContain("DATE_TRUNC('year', ts) AS domain_bucket");
    expect(sql).toContain("DATE_TRUNC('month', ts) AS subdomain_bucket");
    // Both DATE_TRUNC calls present
    const dtCount = (sql.match(/DATE_TRUNC/g) || []).length;
    expect(dtCount).toBeGreaterThanOrEqual(2);
  });

  // Test 3: COUNT_DISTINCT → COUNT(DISTINCT col) AS value — NOT COUNT_DISTINCT(col)
  it("COUNT_DISTINCT aggregation emits COUNT(DISTINCT col) AS value", () => {
    const sql = buildCalendarSql({
      fromTarget: "demo.nyctaxi",
      timeCol: "pickup_time",
      metricColumn: "vendor_id",
      aggregation: "COUNT_DISTINCT",
      domain: "year",
      subdomain: "day",
    });
    expect(sql).toContain("COUNT(DISTINCT vendor_id) AS value");
    expect(sql).not.toContain("COUNT_DISTINCT(vendor_id)");
  });

  // Test 4: COUNT with column "*" → COUNT(*) AS value
  it("COUNT aggregation with column='*' emits COUNT(*) AS value", () => {
    const sql = buildCalendarSql({
      fromTarget: "demo.nyctaxi",
      timeCol: "pickup_time",
      metricColumn: "*",
      aggregation: "COUNT",
      domain: "month",
      subdomain: "day",
    });
    expect(sql).toContain("COUNT(*) AS value");
  });

  // Test 5: Empty schema (dv-bound) — fromTarget "" + table → FROM _kbi_dv_v1234
  it("empty-schema dv-bound: fromTarget passes through without leading dot", () => {
    const sql = buildCalendarSql({
      fromTarget: "_kbi_dv_v1234",
      timeCol: "ts",
      metricColumn: "revenue",
      aggregation: "SUM",
      domain: "week",
      subdomain: "day",
    });
    expect(sql).toContain("FROM _kbi_dv_v1234 ");
    expect(sql).not.toContain("FROM ._kbi_dv_v1234");
    expect(sql).not.toContain("FROM ."); // no leading-dot schema prefix
  });

  // Test 6: WHERE always includes timeCol IS NOT NULL
  it("WHERE clause always includes timeCol IS NOT NULL", () => {
    const sql = buildCalendarSql({
      fromTarget: "demo.trips",
      timeCol: "event_time",
      metricColumn: "distance",
      aggregation: "MAX",
      domain: "year",
      subdomain: "week",
    });
    expect(sql).toContain("WHERE event_time IS NOT NULL");
  });

  // Test 7: GROUP BY uses ALIASES "domain_bucket, subdomain_bucket" — NOT the DATE_TRUNC expressions
  it("GROUP BY uses aliases 'domain_bucket, subdomain_bucket', not the full DATE_TRUNC expressions", () => {
    const sql = buildCalendarSql({
      fromTarget: "demo.events",
      timeCol: "ts",
      metricColumn: "clicks",
      aggregation: "SUM",
      domain: "year",
      subdomain: "month",
    });
    expect(sql).toContain("GROUP BY domain_bucket, subdomain_bucket");
    expect(sql).not.toContain("GROUP BY DATE_TRUNC");
  });

  // Test 8: ORDER BY domain_bucket ASC, subdomain_bucket ASC
  it("ORDER BY domain_bucket ASC, subdomain_bucket ASC always present", () => {
    const sql = buildCalendarSql({
      fromTarget: "demo.events",
      timeCol: "ts",
      metricColumn: "clicks",
      aggregation: "SUM",
      domain: "year",
      subdomain: "month",
    });
    expect(sql).toContain("ORDER BY domain_bucket ASC, subdomain_bucket ASC");
  });

  // Test 9: LIMIT === CELL_LIMIT (10000) by default
  it("LIMIT defaults to CELL_LIMIT (10000)", () => {
    const sql = buildCalendarSql({
      fromTarget: "demo.nyctaxi",
      timeCol: "pickup_time",
      metricColumn: "fare_amount",
      aggregation: "SUM",
      domain: "month",
      subdomain: "day",
    });
    expect(sql).toContain(`LIMIT ${CELL_LIMIT}`);
    expect(sql).toContain("LIMIT 10000");
  });

  // Test 10: Custom limit overrides CELL_LIMIT
  it("custom limit param overrides CELL_LIMIT", () => {
    const sql = buildCalendarSql({
      fromTarget: "demo.nyctaxi",
      timeCol: "pickup_time",
      metricColumn: "fare_amount",
      aggregation: "SUM",
      domain: "month",
      subdomain: "day",
      limit: 5000,
    });
    expect(sql).toContain("LIMIT 5000");
    expect(sql).not.toContain("LIMIT 10000");
  });

  // Test 11: MIN aggregation
  it("MIN aggregation produces correct SQL", () => {
    const sql = buildCalendarSql({
      fromTarget: "warehouse.orders",
      timeCol: "order_date",
      metricColumn: "order_value",
      aggregation: "MIN",
      domain: "year",
      subdomain: "month",
    });
    expect(sql).toContain("MIN(order_value) AS value");
  });

  // Test 12: week×hour combination (finest combo with week domain)
  it("week domain + hour subdomain is emitted correctly", () => {
    const sql = buildCalendarSql({
      fromTarget: "demo.events",
      timeCol: "created_at",
      metricColumn: "count_col",
      aggregation: "COUNT",
      domain: "week",
      subdomain: "hour",
    });
    expect(sql).toContain("DATE_TRUNC('week', created_at) AS domain_bucket");
    expect(sql).toContain("DATE_TRUNC('hour', created_at) AS subdomain_bucket");
    expect(sql).toContain("GROUP BY domain_bucket, subdomain_bucket");
  });
});
