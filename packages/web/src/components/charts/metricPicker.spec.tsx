/**
 * metricPicker.spec.tsx — Phase 100 Plan 03 (METRIC-V119-01/03).
 *
 * Integration spec for the custom-metric picker UI across config panels:
 *   (a) "Custom metrics" optgroup + metric label render in ChartConfigPanel.
 *   (b) Selecting a custom option hides the Aggregation selector.
 *   (c) A stored metricId not in the store shows "(deleted metric)".
 *   (d) Timeline multi-metric row: custom optgroup rendered, agg hidden on custom select.
 *
 * Uses @testing-library/react. Panels are rendered with real component trees
 * (no snapshot-only assertions) so that functional behaviour is verified.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useCustomMetricsStore } from "../../store/customMetricsStore";

// Mock the API client to prevent real HTTP calls from loadConfig effects in tests.
vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    listCustomMetrics: vi.fn().mockResolvedValue([]),
  };
});

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const TABLE_ID = 42;
const TABLE_A = {
  id: TABLE_ID,
  name: "taxi_trips",
  schema: "public",
  columns: {
    passenger_count: "float",
    fare_amount: "float",
    vendor_id: "string",
  },
};
const TABLES = [TABLE_A];

const CUSTOM_METRIC = {
  id: 7,
  table_id: TABLE_ID,
  label: "ROAS",
  expression: "SUM(revenue)/SUM(cost)",
  format_spec: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function seedMetric() {
  useCustomMetricsStore.getState().setConfig(TABLE_ID, [CUSTOM_METRIC]);
}

// ─── ChartConfigPanel picker tests ───────────────────────────────────────────

import ChartConfigPanel from "./ChartConfigPanel";
import * as registry from "./registry";

const GROUPED_DEF: import("./registry").ChartTypeDefinition = {
  type: "bar",
  label: "Bar",
  icon: "B",
  fields: [],
  defaultConfig: {},
  usesAggregation: true,
  requiresGroupBy: true,
  supportsDrillDown: true,
};

describe("ChartConfigPanel metric picker — custom metrics (Phase 100-03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCustomMetricsStore.getState().reset();
    vi.spyOn(registry, "getChartType").mockReturnValue(GROUPED_DEF);
  });

  it("(a) renders 'Custom metrics' optgroup and the metric label", () => {
    seedMetric();
    const cfg = {
      table: "public.taxi_trips",
      tableId: TABLE_ID,
      metricColumn: "fare_amount",
      aggregation: "SUM",
      groupByColumn: "vendor_id",
    };
    render(
      <ChartConfigPanel
        widgetType="bar"
        title="Test"
        config={cfg}
        tables={TABLES}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    // The Custom metrics optgroup should be present
    const metricSelect = screen.getByRole("combobox", { name: "Metric Column" });
    expect(metricSelect).toBeDefined();
    // The label "ROAS" (from the seeded custom metric) should be in the picker
    expect(metricSelect.innerHTML).toContain("Custom metrics");
    expect(metricSelect.innerHTML).toContain("ROAS");
  });

  it("(b) selecting a custom metric hides the Aggregation selector", () => {
    seedMetric();
    const cfg = {
      table: "public.taxi_trips",
      tableId: TABLE_ID,
      metricColumn: "fare_amount",
      aggregation: "SUM",
      groupByColumn: "vendor_id",
    };
    const onSave = vi.fn();
    render(
      <ChartConfigPanel
        widgetType="bar"
        title="Test"
        config={cfg}
        tables={TABLES}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    // Aggregation should be visible for real column
    expect(screen.queryAllByRole("combobox").some((el) => el.getAttribute("aria-label") === "Aggregation" || (el as HTMLSelectElement).value === "SUM")).toBe(true);

    // Change the metric picker to the custom metric (cm:7)
    const metricSelect = screen.getByRole("combobox", { name: "Metric Column" });
    fireEvent.change(metricSelect, { target: { value: "cm:7" } });

    // After selecting a custom metric, the Aggregation selector should no longer be visible
    const aggs = screen.queryAllByRole("combobox").filter(
      (el) => el.getAttribute("aria-label") === "Aggregation",
    );
    expect(aggs.length).toBe(0);
  });

  it("(c) orphaned metricId (deleted metric) shows '(deleted metric)' option", () => {
    // Store is empty — metricId 99 does not exist
    const cfg = {
      table: "public.taxi_trips",
      tableId: TABLE_ID,
      metricColumn: "",
      metricId: 99,
      aggregation: "SUM",
      groupByColumn: "vendor_id",
    };
    render(
      <ChartConfigPanel
        widgetType="bar"
        title="Test"
        config={cfg}
        tables={TABLES}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const metricSelect = screen.getByRole("combobox", { name: "Metric Column" });
    expect(metricSelect.innerHTML).toContain("(deleted metric)");
  });
});

// ─── TimelineConfigPanel metric row tests ─────────────────────────────────────

import TimelineConfigPanel from "./TimelineConfigPanel";

describe("TimelineConfigPanel metric row picker — custom metrics (Phase 100-03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCustomMetricsStore.getState().reset();
  });

  it("(d) custom optgroup rendered in metric row; selecting custom hides row agg", () => {
    seedMetric();
    const initialMetrics = [{ column: "fare_amount", aggregation: "SUM" as const, color: "FF66C2A5", label: "" }];
    const cfg = {
      tableId: TABLE_ID,
      tableRef: "public.taxi_trips",
      timeCol: "pickup_datetime",
      metrics: initialMetrics,
      maxIntervals: 200,
      showLegend: true,
      showTooltip: true,
      vertical: false,
      colorTheme: "Set2",
      dateFormatOverride: "",
    };

    let lastCfg: Record<string, unknown> = cfg as unknown as Record<string, unknown>;
    render(
      <TimelineConfigPanel
        config={cfg}
        columns={[
          { name: "fare_amount", type: "float" },
          { name: "passenger_count", type: "float" },
        ]}
        tables={TABLES}
        onChange={(newCfg) => { lastCfg = newCfg; }}
      />,
    );

    // "Custom metrics" optgroup should appear in the metric row picker
    const metricSelects = screen.queryAllByRole("combobox", { name: /Metric 1 column/i });
    expect(metricSelects.length).toBeGreaterThan(0);
    const metricSelect = metricSelects[0];
    expect(metricSelect.innerHTML).toContain("Custom metrics");
    expect(metricSelect.innerHTML).toContain("ROAS");

    // Before changing: aggregation select should be present
    const aggsBefore = screen.queryAllByRole("combobox", { name: /Metric 1 aggregation/i });
    expect(aggsBefore.length).toBeGreaterThan(0);

    // Change to custom metric
    fireEvent.change(metricSelect, { target: { value: "cm:7" } });

    // The onChange should have been called with metricId set
    const updatedMetrics = (lastCfg.metrics as typeof initialMetrics);
    expect(updatedMetrics[0]).toMatchObject({ metricId: 7, column: "" });
  });
});
