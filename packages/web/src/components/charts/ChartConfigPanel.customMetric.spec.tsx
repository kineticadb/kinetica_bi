/**
 * ChartConfigPanel.customMetric.spec.tsx — Phase 100 Plan 02 (METRIC-V119-04).
 *
 * Covers the custom-metric branch in generatedSql (scalar + grouped):
 *   - Real-column selection (no metricId) → byte-identical SQL (golden strings).
 *   - Custom selection (metricId set + store seeded) → raw expression, NO AGG wrapper.
 *   - draft.metricId appears in the generatedSql deps (verified indirectly via SQL output).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ChartConfigPanel from "./ChartConfigPanel";
import * as registry from "./registry";
import { useCustomMetricsStore } from "../../store/customMetricsStore";

// ─── Stable chart-type stubs ─────────────────────────────────────────────────

const GROUPED_DEF: import("./registry").ChartTypeDefinition = {
  type: "pie",
  label: "Pie",
  icon: "O",
  fields: [],
  defaultConfig: {},
  usesAggregation: true,
  requiresGroupBy: true,
  supportsDrillDown: true,
};

const SCALAR_DEF: import("./registry").ChartTypeDefinition = {
  type: "bignumber",
  label: "Big Number",
  icon: "1",
  fields: [],
  defaultConfig: {},
  usesAggregation: true,
  requiresGroupBy: false,
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TABLE_A = {
  id: 42,
  name: "taxi_trips",
  schema: "public",
  columns: {
    passenger_count: "float",
    fare_amount: "float",
    vendor_id: "string",
  },
};

const TABLES = [TABLE_A];

const TABLE_ID = 42;

const seedCustomMetric = (id = 7, expression = "SUM(revenue)/SUM(cost)") => {
  useCustomMetricsStore.getState().setConfig(TABLE_ID, [
    {
      id,
      table_id: TABLE_ID,
      label: "ROAS",
      expression,
      format_spec: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  ]);
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ChartConfigPanel — custom metric in generatedSql (Phase 100-02)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCustomMetricsStore.getState().reset();
  });

  // ── Scalar (bignumber) — byte-identical lock ──────────────────────────────

  it("scalar: absent metricId → byte-identical SQL (regression lock, criterion 4)", () => {
    vi.spyOn(registry, "getChartType").mockReturnValue(SCALAR_DEF);
    const onSave = vi.fn();
    render(
      <ChartConfigPanel
        widgetType="bignumber"
        title="BN"
        config={{
          table: "public.taxi_trips",
          metricColumn: "passenger_count",
          aggregation: "SUM",
        }}
        tables={TABLES}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const sql: string = onSave.mock.calls[0][0].config.sql;
    expect(sql).toBe("SELECT SUM(passenger_count) AS value FROM public.taxi_trips");
  });

  // ── Scalar (bignumber) — custom metric emits raw expression ───────────────

  it("scalar: custom metricId set + store seeded → emits raw expression (no AGG wrapper)", () => {
    seedCustomMetric(7, "SUM(revenue)/SUM(cost)");
    vi.spyOn(registry, "getChartType").mockReturnValue(SCALAR_DEF);
    const onSave = vi.fn();
    render(
      <ChartConfigPanel
        widgetType="bignumber"
        title="BN"
        config={{
          table: "public.taxi_trips",
          tableId: TABLE_ID,
          metricColumn: "",       // custom selection has no real column
          aggregation: "SUM",
          metricId: 7,
        }}
        tables={TABLES}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const sql: string = onSave.mock.calls[0][0].config.sql;
    expect(sql).toContain("SUM(revenue)/SUM(cost) AS value");
    // Must NOT double-wrap
    expect(sql).not.toMatch(/SUM\(SUM\(/);
    expect(sql).not.toMatch(/SUM\(\)/);
  });

  // ── Grouped (pie/bar/line) — byte-identical lock ──────────────────────────

  it("grouped: absent metricId → byte-identical SQL (regression lock, criterion 4)", () => {
    vi.spyOn(registry, "getChartType").mockReturnValue(GROUPED_DEF);
    const onSave = vi.fn();
    render(
      <ChartConfigPanel
        widgetType="pie"
        title="Pie"
        config={{
          table: "public.taxi_trips",
          metricColumn: "fare_amount",
          aggregation: "SUM",
          groupByColumn: "vendor_id",
        }}
        tables={TABLES}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const sql: string = onSave.mock.calls[0][0].config.sql;
    expect(sql).toBe(
      "SELECT vendor_id, SUM(fare_amount) AS value FROM public.taxi_trips GROUP BY vendor_id ORDER BY value DESC LIMIT 100",
    );
  });

  // ── Grouped (pie/bar/line) — custom metric emits raw expression ───────────

  it("grouped: custom metricId set + store seeded → emits raw expression (no AGG wrapper)", () => {
    seedCustomMetric(7, "SUM(revenue)/SUM(cost)");
    vi.spyOn(registry, "getChartType").mockReturnValue(GROUPED_DEF);
    const onSave = vi.fn();
    render(
      <ChartConfigPanel
        widgetType="pie"
        title="Pie"
        config={{
          table: "public.taxi_trips",
          tableId: TABLE_ID,
          metricColumn: "",       // custom selection has no real column
          aggregation: "SUM",
          groupByColumn: "vendor_id",
          metricId: 7,
        }}
        tables={TABLES}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const sql: string = onSave.mock.calls[0][0].config.sql;
    expect(sql).toContain("SUM(revenue)/SUM(cost) AS value");
    expect(sql).toContain("vendor_id");
    expect(sql).toContain("GROUP BY vendor_id");
    // Must NOT double-wrap
    expect(sql).not.toMatch(/SUM\(SUM\(/);
    expect(sql).not.toMatch(/SUM\(\)/);
  });
});
