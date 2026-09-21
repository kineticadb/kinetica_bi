/**
 * liveMetricSql.spec.ts — Phase 121 Plan 05 (DXIM-V124-10 gap closure).
 *
 * Parser proofs (`parseAggregatedSelectList` / `replaceValueSelectItem`) against the exact
 * fixtures in the plan's <design_decision>, plus resolution proofs (`applyLiveMetricExpr`)
 * against the six-row state table. Every `it(` title is prefixed `LIVEMETRIC-` so the ids are
 * greppable and new. Pure lib, no DOM.
 */
import { describe, it, expect, vi } from "vitest";
import { parseAggregatedSelectList, replaceValueSelectItem, applyLiveMetricExpr } from "./liveMetricSql";
import { useCustomMetricsStore } from "../store/customMetricsStore";
import type { CustomMetricRow } from "../api/client";

// Mock the api/client module so listCustomMetrics is never called for real.
vi.mock("../api/client", () => ({
  listCustomMetrics: vi.fn(),
}));

const TABLE_ID = 5;

const makeRow = (id: number, expression: string): CustomMetricRow => ({
  id,
  table_id: TABLE_ID,
  label: "try_again",
  expression,
  format_spec: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

describe("liveMetricSql — parser", () => {
  it("LIVEMETRIC-parse-scalar: swaps the sole select item in a scalar (bignumber) query", () => {
    const sql = "SELECT AVG(total_amount - tip_amount) AS value FROM demo.nyctaxi";
    const result = replaceValueSelectItem(sql, "AVG(total_amount - tip_amount) * 50.111111");
    expect(result).toBe(
      "SELECT AVG(total_amount - tip_amount) * 50.111111 AS value FROM demo.nyctaxi",
    );
  });

  it("LIVEMETRIC-parse-single-group: only the metric item changes; GROUP BY/ORDER BY/LIMIT untouched", () => {
    const sql =
      "SELECT vendor_id, AVG(total_amount - tip_amount) AS value FROM demo.nyctaxi GROUP BY vendor_id ORDER BY value DESC LIMIT 100";
    const result = replaceValueSelectItem(sql, "AVG(total_amount - tip_amount) * 50.111111");
    expect(result).toBe(
      "SELECT vendor_id, AVG(total_amount - tip_amount) * 50.111111 AS value FROM demo.nyctaxi GROUP BY vendor_id ORDER BY value DESC LIMIT 100",
    );
  });

  it("LIVEMETRIC-parse-comma-inside-parens: a comma inside ROUND(...) must NOT split an item", () => {
    const sql =
      "SELECT region, category, ROUND(AVG(amount), 2) AS value FROM sales GROUP BY region, category ORDER BY value DESC LIMIT 100";
    const parsed = parseAggregatedSelectList(sql);
    expect(parsed).not.toBeNull();
    expect(parsed!.items).toHaveLength(3);
    const result = replaceValueSelectItem(sql, "ROUND(AVG(amount), 2) * 2");
    expect(result).toBe(
      "SELECT region, category, ROUND(AVG(amount), 2) * 2 AS value FROM sales GROUP BY region, category ORDER BY value DESC LIMIT 100",
    );
  });

  it("LIVEMETRIC-parse-heatmap-bucket: quoted literal + comma-in-parens + preceding AS alias; only LAST item changes", () => {
    const sql =
      "SELECT payment_type, DATE_TRUNC('day', pickup_datetime) AS pickup_datetime, AVG(total_amount) AS value FROM demo.nyctaxi GROUP BY payment_type, DATE_TRUNC('day', pickup_datetime) ORDER BY value DESC LIMIT 5000";
    const parsed = parseAggregatedSelectList(sql);
    expect(parsed).not.toBeNull();
    expect(parsed!.items).toHaveLength(3);
    const result = replaceValueSelectItem(sql, "AVG(total_amount) * 1.5");
    expect(result).toBe(
      "SELECT payment_type, DATE_TRUNC('day', pickup_datetime) AS pickup_datetime, AVG(total_amount) * 1.5 AS value FROM demo.nyctaxi GROUP BY payment_type, DATE_TRUNC('day', pickup_datetime) ORDER BY value DESC LIMIT 5000",
    );
  });

  it("LIVEMETRIC-parse-last-item: a group-by column literally named 'value' — the LAST item is rewritten", () => {
    const sql = "SELECT value, AVG(x) AS value FROM t GROUP BY value ORDER BY value DESC LIMIT 100";
    const result = replaceValueSelectItem(sql, "AVG(x) * 2");
    expect(result).toBe("SELECT value, AVG(x) * 2 AS value FROM t GROUP BY value ORDER BY value DESC LIMIT 100");
  });

  it("LIVEMETRIC-parse-from-inside-string-literal: a ' FROM ' inside a string literal is NOT the select-list terminator", () => {
    const sql = "SELECT SUM(CASE WHEN note = ' FROM ' THEN 1 ELSE 0 END) AS value FROM t";
    const result = replaceValueSelectItem(sql, "SUM(CASE WHEN note = ' FROM ' THEN 1 ELSE 0 END) * 2");
    expect(result).toBe(
      "SELECT SUM(CASE WHEN note = ' FROM ' THEN 1 ELSE 0 END) * 2 AS value FROM t",
    );
  });

  it("LIVEMETRIC-parse-comma-inside-string-literal: a bare comma inside a top-level quoted string is not a separator", () => {
    const sql =
      "SELECT status, CASE WHEN note = 'a,b' THEN 1 ELSE 0 END AS flag, AVG(x) AS value FROM t GROUP BY status";
    const parsed = parseAggregatedSelectList(sql);
    expect(parsed).not.toBeNull();
    expect(parsed!.items).toHaveLength(3);
    const result = replaceValueSelectItem(sql, "AVG(x) * 2");
    expect(result).toBe(
      "SELECT status, CASE WHEN note = 'a,b' THEN 1 ELSE 0 END AS flag, AVG(x) * 2 AS value FROM t GROUP BY status",
    );
  });

  it("LIVEMETRIC-parse-custom-where: the trailing WHERE clause is untouched", () => {
    const sql = "SELECT SUM(revenue) AS value FROM orders WHERE (region = 'West')";
    const result = replaceValueSelectItem(sql, "SUM(revenue) * 2");
    expect(result).toBe("SELECT SUM(revenue) * 2 AS value FROM orders WHERE (region = 'West')");
  });

  it("LIVEMETRIC-parse-no-value-alias-returns-null: records-table shape (no AS value) returns null", () => {
    const sql = "SELECT a, b FROM t ORDER BY a ASC";
    expect(replaceValueSelectItem(sql, "SUM(a)")).toBeNull();
  });

  it("LIVEMETRIC-parse-placeholder-returns-null: the panel's placeholder SELECT * returns null", () => {
    const sql = "SELECT * FROM demo.nyctaxi LIMIT 100";
    expect(replaceValueSelectItem(sql, "SUM(a)")).toBeNull();
  });

  it("LIVEMETRIC-parse-bad-newexpr-returns-null: a depth-0 comma or an unbalanced paren in newExpr returns null", () => {
    const sql = "SELECT AVG(x) AS value FROM t";
    expect(replaceValueSelectItem(sql, "AVG(a), AVG(b)")).toBeNull();
    expect(replaceValueSelectItem(sql, "AVG(a")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

describe("liveMetricSql — applyLiveMetricExpr resolution", () => {
  it("LIVEMETRIC-noncustom-identity: a non-custom selection returns the SAME string reference", () => {
    useCustomMetricsStore.getState().reset();
    const storedSql = "SELECT vendor_id, AVG(fare) AS value FROM t";
    const result = applyLiveMetricExpr(storedSql, undefined, TABLE_ID);
    expect(result.kind).toBe("ready");
    expect((result as { kind: "ready"; sql: string | undefined }).sql).toBe(storedSql);
  });

  it("LIVEMETRIC-no-tableid-identity: a custom selection with tableId undefined returns the stored sql unchanged", () => {
    useCustomMetricsStore.getState().reset();
    const storedSql = "SELECT AVG(fare) AS value FROM t";
    const result = applyLiveMetricExpr(storedSql, 7, undefined);
    expect(result).toEqual({ kind: "ready", sql: storedSql });
  });

  it("LIVEMETRIC-unhydrated-pending: a custom selection on a never-loaded table reports pending", () => {
    useCustomMetricsStore.getState().reset();
    const storedSql = "SELECT AVG(fare) AS value FROM t";
    const result = applyLiveMetricExpr(storedSql, 7, TABLE_ID);
    expect(result).toEqual({ kind: "pending" });
  });

  it("LIVEMETRIC-orphan-returns-stored: a hydrated table with the id absent (deleted metric) falls back to stored sql", () => {
    useCustomMetricsStore.getState().reset();
    useCustomMetricsStore.getState().setConfig(TABLE_ID, []); // hydrated, empty
    const storedSql = "SELECT AVG(fare) AS value FROM t";
    const result = applyLiveMetricExpr(storedSql, 7, TABLE_ID);
    expect(result).toEqual({ kind: "ready", sql: storedSql });
  });

  it("LIVEMETRIC-resolved-swaps-expression: cross-environment proof — target definition replaces the source expression", () => {
    useCustomMetricsStore.getState().reset();
    useCustomMetricsStore
      .getState()
      .setConfig(TABLE_ID, [makeRow(2, "AVG(total_amount - tip_amount) * 50.111111")]);
    const storedSql =
      "SELECT vendor_id, AVG(total_amount - tip_amount) AS value FROM demo.nyctaxi GROUP BY vendor_id ORDER BY value DESC LIMIT 100";
    const result = applyLiveMetricExpr(storedSql, 2, TABLE_ID);
    expect(result).toEqual({
      kind: "ready",
      sql:
        "SELECT vendor_id, AVG(total_amount - tip_amount) * 50.111111 AS value FROM demo.nyctaxi GROUP BY vendor_id ORDER BY value DESC LIMIT 100",
    });
  });

  it("LIVEMETRIC-unparseable-returns-stored: a resolved metric against an unparseable stored sql falls back to stored sql", () => {
    useCustomMetricsStore.getState().reset();
    useCustomMetricsStore.getState().setConfig(TABLE_ID, [makeRow(2, "AVG(x)")]);
    const storedSql = "SELECT a, b FROM t ORDER BY a ASC"; // no AS value — unparseable for this lib
    const result = applyLiveMetricExpr(storedSql, 2, TABLE_ID);
    expect(result).toEqual({ kind: "ready", sql: storedSql });
  });
});
