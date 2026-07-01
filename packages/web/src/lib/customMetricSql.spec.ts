/**
 * customMetricSql.spec.ts — Phase 100 Plan 02 (METRIC-V119-04).
 *
 * Covers the four resolution behaviors of resolveMetricExpr:
 *   1. Real column (metricId undefined) → realAggExpr UNCHANGED (passthrough, byte-identical).
 *   2. Custom (metricId is a number, store has metric) → raw expression, NO AGG wrapper.
 *   3. Orphan (metricId set, NOT in store) → null.
 *   4. isCustomSelection: true only for a number, false for undefined/null.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useCustomMetricsStore } from "../store/customMetricsStore";
import {
  resolveMetricExpr,
  isCustomSelection,
  encodeCustomValue,
  decodeMetricSelection,
  metricSelectValue,
  isOrphanedMetric,
} from "./customMetricSql";

const TABLE_ID = 42;

const seedMetric = (expression = "SUM(revenue)/SUM(cost)") => {
  useCustomMetricsStore.getState().setConfig(TABLE_ID, [
    {
      id: 7,
      table_id: TABLE_ID,
      label: "ROAS",
      expression,
      format_spec: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  ]);
};

beforeEach(() => {
  useCustomMetricsStore.getState().reset();
});

describe("isCustomSelection", () => {
  it("returns true for a number", () => {
    expect(isCustomSelection(7)).toBe(true);
    expect(isCustomSelection(0)).toBe(true);
  });

  it("returns false for undefined", () => {
    expect(isCustomSelection(undefined)).toBe(false);
  });

  it("returns false for null", () => {
    expect(isCustomSelection(null)).toBe(false);
  });
});

describe("resolveMetricExpr — real column (passthrough)", () => {
  it("returns realAggExpr unchanged when metricId is undefined", () => {
    const result = resolveMetricExpr(undefined, "SUM(x)", TABLE_ID);
    expect(result).toBe("SUM(x)");
  });

  it("returns realAggExpr unchanged when metricId is null", () => {
    const result = resolveMetricExpr(null, "AVG(fare_amount)", TABLE_ID);
    expect(result).toBe("AVG(fare_amount)");
  });

  it("byte-identical passthrough — COUNT(DISTINCT vendor_id)", () => {
    const realAgg = "COUNT(DISTINCT vendor_id)";
    const result = resolveMetricExpr(undefined, realAgg, TABLE_ID);
    expect(result).toBe(realAgg);
  });
});

describe("resolveMetricExpr — custom metric (raw expression)", () => {
  it("returns the raw expression from the store — NO AGG wrapper", () => {
    seedMetric("SUM(revenue)/SUM(cost)");
    const result = resolveMetricExpr(7, "SUM(some_col)", TABLE_ID);
    expect(result).toBe("SUM(revenue)/SUM(cost)");
    // Ensure there is NO double-wrapping like SUM(SUM(...))
    expect(result).not.toMatch(/SUM\(SUM\(/);
    expect(result).not.toMatch(/SUM\(\)/);
  });

  it("returns the raw expression verbatim for any expression shape", () => {
    seedMetric("AVG(price) * COUNT(*) / NULLIF(SUM(qty), 0)");
    const result = resolveMetricExpr(7, "SUM(x)", TABLE_ID);
    expect(result).toBe("AVG(price) * COUNT(*) / NULLIF(SUM(qty), 0)");
  });
});

// ---------------------------------------------------------------------------
// Plan 03: encode/decode + picker helpers
// ---------------------------------------------------------------------------

describe("encodeCustomValue / decodeMetricSelection — round-trip", () => {
  it("encodes a numeric id to cm:<id>", () => {
    expect(encodeCustomValue(7)).toBe("cm:7");
    expect(encodeCustomValue(0)).toBe("cm:0");
    expect(encodeCustomValue(42)).toBe("cm:42");
  });

  it("decodes a cm: value back to { kind: 'custom', metricId }", () => {
    expect(decodeMetricSelection("cm:7")).toEqual({ kind: "custom", metricId: 7 });
    expect(decodeMetricSelection("cm:42")).toEqual({ kind: "custom", metricId: 42 });
    expect(decodeMetricSelection("cm:0")).toEqual({ kind: "custom", metricId: 0 });
  });

  it("decodes a plain column name to { kind: 'real', column }", () => {
    expect(decodeMetricSelection("revenue")).toEqual({ kind: "real", column: "revenue" });
    expect(decodeMetricSelection("")).toEqual({ kind: "real", column: "" });
    expect(decodeMetricSelection("*")).toEqual({ kind: "real", column: "*" });
  });

  it("round-trips: encode then decode returns the original metricId", () => {
    const id = 99;
    const encoded = encodeCustomValue(id);
    const decoded = decodeMetricSelection(encoded);
    expect(decoded).toEqual({ kind: "custom", metricId: id });
  });
});

describe("metricSelectValue", () => {
  it("returns encodeCustomValue when metricId is set", () => {
    expect(metricSelectValue(7, "revenue")).toBe("cm:7");
    expect(metricSelectValue(0, "some_col")).toBe("cm:0");
  });

  it("returns the column name when metricId is undefined", () => {
    expect(metricSelectValue(undefined, "revenue")).toBe("revenue");
    expect(metricSelectValue(undefined, "")).toBe("");
  });
});

describe("isOrphanedMetric", () => {
  it("returns false when metricId is undefined (real column)", () => {
    expect(isOrphanedMetric(undefined, TABLE_ID)).toBe(false);
    expect(isOrphanedMetric(undefined, undefined)).toBe(false);
  });

  it("returns false when metricId is present and metric IS in the store", () => {
    seedMetric();
    expect(isOrphanedMetric(7, TABLE_ID)).toBe(false);
  });

  it("returns true when metricId is present but metric NOT in store (deleted)", () => {
    // Store is empty (reset in beforeEach) — no metrics for any table
    expect(isOrphanedMetric(7, TABLE_ID)).toBe(true);
  });

  it("returns true when tableId is undefined (store not loaded yet)", () => {
    seedMetric();
    expect(isOrphanedMetric(7, undefined)).toBe(true);
  });

  it("returns true when metric exists in a DIFFERENT table", () => {
    useCustomMetricsStore.getState().setConfig(999, [
      {
        id: 7,
        table_id: 999,
        label: "Other",
        expression: "SUM(other)",
        format_spec: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);
    // id 7 is in table 999, not in TABLE_ID (42)
    expect(isOrphanedMetric(7, TABLE_ID)).toBe(true);
  });
});

describe("resolveMetricExpr — orphaned custom id (null)", () => {
  it("returns null when metricId set but metric not in store", () => {
    // Store is empty (reset in beforeEach)
    const result = resolveMetricExpr(99, "SUM(x)", TABLE_ID);
    expect(result).toBeNull();
  });

  it("returns null when store has metrics for a DIFFERENT table", () => {
    useCustomMetricsStore.getState().setConfig(999, [
      {
        id: 7,
        table_id: 999,
        label: "Other",
        expression: "SUM(other)",
        format_spec: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);
    // id 7 exists in table 999, but we ask for TABLE_ID (42)
    const result = resolveMetricExpr(7, "SUM(x)", TABLE_ID);
    expect(result).toBeNull();
  });

  it("returns null when tableId is undefined", () => {
    seedMetric();
    const result = resolveMetricExpr(7, "SUM(x)", undefined);
    expect(result).toBeNull();
  });
});
