// Phase 45 Plan 02 (TIMELINE-V17-03): TimelineConfigPanel specs.
// Mirrors DataFilterConfigPanel.spec.tsx layout. Uses @testing-library/react.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TimelineConfigPanel, { MAX_METRICS, DEFAULT_COLOR_THEME, type TimelineConfig } from "./TimelineConfigPanel";

const TABLES: NonNullable<Parameters<typeof TimelineConfigPanel>[0]["tables"]> = [
  {
    id: 1,
    name: "nyctaxi",
    schema: "demo",
    columns: {
      pickup_time: "timestamp",
      dropoff_time: "datetime",
      fare_amount: "double",
      passenger_count: "int",
      pickup_geom: "wkt",
      driver_id: "varchar",
    },
  },
  {
    id: 2,
    name: "other",
    schema: "demo",
    columns: { ts: "timestamp", amt: "double" },
  },
];

function renderPanel(initial: Partial<TimelineConfig> = {}, opts?: { isValid?: (b: boolean) => void }) {
  const onChange = vi.fn();
  const isValid = opts?.isValid ?? vi.fn();
  const utils = render(
    <TimelineConfigPanel
      config={{ metrics: [], ...initial } as Record<string, unknown>}
      onChange={onChange}
      tables={TABLES}
      isValid={isValid}
    />,
  );
  return { onChange, isValid, ...utils };
}

describe("TimelineConfigPanel", () => {
  it("Test 1: renders base-table picker with all tables; no fields visible until table selected", () => {
    renderPanel();
    expect(screen.getByLabelText("Base table")).toBeInTheDocument();
    expect(screen.getByText("Pick a base table first.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Time column")).not.toBeInTheDocument();
  });

  it("Test 2: selecting a base table calls onChange clearing timeCol+metrics", () => {
    const { onChange } = renderPanel();
    fireEvent.change(screen.getByLabelText("Base table"), { target: { value: "demo.nyctaxi" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ tableId: 1, tableRef: "demo.nyctaxi", timeCol: "", metrics: [] }),
    );
  });

  it("Test 3: time-column picker only lists datetime columns (pickup_time + dropoff_time) — no numeric/wkt/string", () => {
    renderPanel({ tableId: 1, tableRef: "demo.nyctaxi" });
    const sel = screen.getByLabelText("Time column") as HTMLSelectElement;
    const opts = Array.from(sel.querySelectorAll("option")).map((o) => o.value);
    expect(opts).toContain("pickup_time");
    expect(opts).toContain("dropoff_time");
    expect(opts).not.toContain("fare_amount");
    expect(opts).not.toContain("pickup_geom");
    expect(opts).not.toContain("driver_id");
  });

  it("Test 4: metric column picker only lists numeric+drilldown-safe columns; wkt excluded", () => {
    renderPanel({
      tableId: 1, tableRef: "demo.nyctaxi", timeCol: "pickup_time",
      metrics: [{ column: "", aggregation: "SUM", color: "FF66C2A5" }],
    });
    const colSel = screen.getByLabelText("Metric 1 column") as HTMLSelectElement;
    const opts = Array.from(colSel.querySelectorAll("option")).map((o) => o.value);
    expect(opts).toContain("fare_amount");
    expect(opts).toContain("passenger_count");
    expect(opts).not.toContain("pickup_time");
    expect(opts).not.toContain("driver_id");
    expect(opts).not.toContain("pickup_geom");
  });

  it("Test 5: Add metric button caps at MAX_METRICS=4 (disabled at 4)", () => {
    const metrics = Array.from({ length: 4 }, () => ({ column: "fare_amount", aggregation: "SUM" as const, color: "FF66C2A5" }));
    renderPanel({ tableId: 1, tableRef: "demo.nyctaxi", timeCol: "pickup_time", metrics });
    const btn = screen.getByRole("button", { name: /Add metric/ });
    expect(btn).toBeDisabled();
  });

  it("Test 6: isValid(true) once tableId + timeCol + ≥1 complete metric; isValid(false) otherwise", () => {
    const isValid = vi.fn();
    const { rerender } = render(
      <TimelineConfigPanel
        config={{ tableId: 1, tableRef: "demo.nyctaxi", timeCol: "", metrics: [] } as Record<string, unknown>}
        onChange={vi.fn()}
        tables={TABLES}
        isValid={isValid}
      />,
    );
    expect(isValid).toHaveBeenLastCalledWith(false);

    rerender(
      <TimelineConfigPanel
        config={{
          tableId: 1, tableRef: "demo.nyctaxi", timeCol: "pickup_time",
          metrics: [{ column: "fare_amount", aggregation: "SUM", color: "FF66C2A5" }],
        } as Record<string, unknown>}
        onChange={vi.fn()}
        tables={TABLES}
        isValid={isValid}
      />,
    );
    expect(isValid).toHaveBeenLastCalledWith(true);
  });

  it("Test 7: default color theme is 'Set2' when colorTheme unspecified", () => {
    renderPanel({ tableId: 1, tableRef: "demo.nyctaxi", timeCol: "pickup_time", metrics: [{ column: "fare_amount", aggregation: "SUM", color: "FF66C2A5" }] });
    expect((screen.getByLabelText("Color theme") as HTMLSelectElement).value).toBe(DEFAULT_COLOR_THEME);
  });

  it("Test 8: changing color theme re-colors all metrics", () => {
    const { onChange } = renderPanel({
      tableId: 1, tableRef: "demo.nyctaxi", timeCol: "pickup_time",
      metrics: [
        { column: "fare_amount", aggregation: "SUM", color: "FF000000" },
        { column: "passenger_count", aggregation: "AVG", color: "FF111111" },
      ],
    });
    fireEvent.change(screen.getByLabelText("Color theme"), { target: { value: "Dark2" } });
    const call = onChange.mock.calls[onChange.mock.calls.length - 1][0] as TimelineConfig;
    expect(call.colorTheme).toBe("Dark2");
    expect(call.metrics).toHaveLength(2);
    // New colors from Dark2 palette — must NOT equal the previous overrides.
    expect(call.metrics[0].color).not.toBe("FF000000");
    expect(call.metrics[1].color).not.toBe("FF111111");
  });

  it("Test 9: changing base table clears timeCol AND metrics (old refs invalid)", () => {
    const { onChange } = renderPanel({
      tableId: 1, tableRef: "demo.nyctaxi", timeCol: "pickup_time",
      metrics: [{ column: "fare_amount", aggregation: "SUM", color: "FF66C2A5" }],
    });
    fireEvent.change(screen.getByLabelText("Base table"), { target: { value: "demo.other" } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ tableId: 2, timeCol: "", metrics: [] }),
    );
  });

  it("Test 10: maxIntervals input clamps to [2, 1000]; default 500 displayed when unset", () => {
    renderPanel({ tableId: 1, tableRef: "demo.nyctaxi", timeCol: "pickup_time", metrics: [{ column: "fare_amount", aggregation: "SUM", color: "FF66C2A5" }] });
    expect((screen.getByLabelText("Max intervals") as HTMLInputElement).value).toBe("500");
  });

  it("Test 11: toggling 'Vertical orientation' patches vertical:true", () => {
    const { onChange } = renderPanel({ tableId: 1, tableRef: "demo.nyctaxi", timeCol: "pickup_time", metrics: [{ column: "fare_amount", aggregation: "SUM", color: "FF66C2A5" }] });
    fireEvent.click(screen.getByLabelText("Vertical orientation"));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ vertical: true }));
  });

  // ---- Phase 72: Group By picker + single-metric-when-grouped (GROUP-V114-01, -03) ----

  describe("Group By (Phase 72)", () => {
    it("Test 12: Group By picker present with a None option; lists drilldown-safe columns excluding the timeCol", () => {
      renderPanel({
        tableId: 1, tableRef: "demo.nyctaxi", timeCol: "pickup_time",
        metrics: [{ column: "fare_amount", aggregation: "SUM", color: "FF66C2A5" }],
      });
      const sel = screen.getByLabelText("Group by") as HTMLSelectElement;
      const opts = Array.from(sel.querySelectorAll("option")).map((o) => o.value);
      // explicit None option to clear grouping
      expect(opts).toContain("");
      // categorical/drilldown-safe columns are eligible
      expect(opts).toContain("driver_id");
      expect(opts).toContain("fare_amount");
      expect(opts).toContain("passenger_count");
      // the selected timeCol is excluded from the group-by options
      expect(opts).not.toContain("pickup_time");
      // geometry (wkt) is drilldown-UNsafe and excluded
      expect(opts).not.toContain("pickup_geom");
    });

    it("Test 13: ungrouped (groupByColumn '') still shows the multi-metric builder with the Add-metric button", () => {
      renderPanel({
        tableId: 1, tableRef: "demo.nyctaxi", timeCol: "pickup_time",
        metrics: [{ column: "fare_amount", aggregation: "SUM", color: "FF66C2A5" }],
      });
      expect(screen.getByRole("button", { name: /Add metric/ })).toBeInTheDocument();
    });

    it("Test 14: selecting a Group By patches groupByColumn (non-destructive — does NOT clear metrics)", () => {
      const { onChange } = renderPanel({
        tableId: 1, tableRef: "demo.nyctaxi", timeCol: "pickup_time",
        metrics: [
          { column: "fare_amount", aggregation: "SUM", color: "FF66C2A5" },
          { column: "passenger_count", aggregation: "AVG", color: "FFFC8D62" },
        ],
      });
      fireEvent.change(screen.getByLabelText("Group by"), { target: { value: "driver_id" } });
      const call = onChange.mock.calls[onChange.mock.calls.length - 1][0] as TimelineConfig;
      expect(call.groupByColumn).toBe("driver_id");
      // non-destructive: both metrics preserved in config so clearing restores them
      expect(call.metrics).toHaveLength(2);
    });

    it("Test 15: when grouped, exactly one metric row renders, Add-metric is HIDDEN, and Remove is hidden", () => {
      renderPanel({
        tableId: 1, tableRef: "demo.nyctaxi", timeCol: "pickup_time",
        groupByColumn: "driver_id",
        metrics: [
          { column: "fare_amount", aggregation: "SUM", color: "FF66C2A5" },
          { column: "passenger_count", aggregation: "AVG", color: "FFFC8D62" },
        ],
      });
      // only metrics[0] row visible
      expect(screen.getByTestId("timeline-metric-row-0")).toBeInTheDocument();
      expect(screen.queryByTestId("timeline-metric-row-1")).not.toBeInTheDocument();
      // Add metric button hidden when grouped
      expect(screen.queryByRole("button", { name: /Add metric/ })).not.toBeInTheDocument();
      // Remove button hidden on the single grouped row
      expect(screen.queryByRole("button", { name: /Remove metric 1/ })).not.toBeInTheDocument();
    });

    it("Test 16: clearing Group By back to None restores the multi-metric builder with metrics intact", () => {
      // Start grouped with 2 metrics preserved; clearing should keep both and re-show Add metric.
      const { onChange, rerender } = renderPanel({
        tableId: 1, tableRef: "demo.nyctaxi", timeCol: "pickup_time",
        groupByColumn: "driver_id",
        metrics: [
          { column: "fare_amount", aggregation: "SUM", color: "FF66C2A5" },
          { column: "passenger_count", aggregation: "AVG", color: "FFFC8D62" },
        ],
      });
      fireEvent.change(screen.getByLabelText("Group by"), { target: { value: "" } });
      const call = onChange.mock.calls[onChange.mock.calls.length - 1][0] as TimelineConfig;
      expect(call.groupByColumn).toBe("");
      expect(call.metrics).toHaveLength(2);
      // re-render in the now-ungrouped state → multi-metric builder restored
      rerender(
        <TimelineConfigPanel
          config={{ ...call } as Record<string, unknown>}
          onChange={onChange}
          tables={TABLES}
          isValid={vi.fn()}
        />,
      );
      expect(screen.getByRole("button", { name: /Add metric/ })).toBeInTheDocument();
      expect(screen.getByTestId("timeline-metric-row-1")).toBeInTheDocument();
    });

    it("Test 17: enabling Group By with 0 metrics seeds one default metric row", () => {
      const { onChange } = renderPanel({
        tableId: 1, tableRef: "demo.nyctaxi", timeCol: "pickup_time",
        metrics: [],
      });
      fireEvent.change(screen.getByLabelText("Group by"), { target: { value: "driver_id" } });
      const call = onChange.mock.calls[onChange.mock.calls.length - 1][0] as TimelineConfig;
      expect(call.groupByColumn).toBe("driver_id");
      expect(call.metrics.length).toBeGreaterThanOrEqual(1);
    });

    it("Test 18: grouped form is valid with tableId + timeCol + groupByColumn + a complete metrics[0]", () => {
      const isValid = vi.fn();
      render(
        <TimelineConfigPanel
          config={{
            tableId: 1, tableRef: "demo.nyctaxi", timeCol: "pickup_time",
            groupByColumn: "driver_id",
            metrics: [{ column: "fare_amount", aggregation: "SUM", color: "FF66C2A5" }],
          } as Record<string, unknown>}
          onChange={vi.fn()}
          tables={TABLES}
          isValid={isValid}
        />,
      );
      expect(isValid).toHaveBeenLastCalledWith(true);
    });

    it("Test 19: when grouped, the per-metric color swatch is HIDDEN and the palette preview + 'Color palette' label show instead", () => {
      renderPanel({
        tableId: 1, tableRef: "demo.nyctaxi", timeCol: "pickup_time",
        groupByColumn: "driver_id",
        metrics: [{ column: "fare_amount", aggregation: "SUM", color: "FF66C2A5" }],
      });
      // the misleading single metric color swatch is gone (series colors come from the palette)
      expect(screen.queryByLabelText("Metric 1 color")).toBeNull();
      // the palette picker is framed as a palette + a preview strip is shown
      expect(screen.getByText("Color palette")).toBeInTheDocument();
      expect(screen.getByLabelText("Color palette preview")).toBeInTheDocument();
    });

    it("Test 20: ungrouped keeps the per-metric color swatch and shows no palette preview (regression)", () => {
      renderPanel({
        tableId: 1, tableRef: "demo.nyctaxi", timeCol: "pickup_time",
        metrics: [{ column: "fare_amount", aggregation: "SUM", color: "FF66C2A5" }],
      });
      expect(screen.getByLabelText("Metric 1 color")).toBeInTheDocument();
      expect(screen.queryByLabelText("Color palette preview")).toBeNull();
    });

    it("Test 19: changing time column to the current groupByColumn clears groupByColumn", () => {
      const { onChange } = renderPanel({
        tableId: 1, tableRef: "demo.nyctaxi", timeCol: "pickup_time",
        groupByColumn: "dropoff_time",
        metrics: [{ column: "fare_amount", aggregation: "SUM", color: "FF66C2A5" }],
      });
      fireEvent.change(screen.getByLabelText("Time column"), { target: { value: "dropoff_time" } });
      const call = onChange.mock.calls[onChange.mock.calls.length - 1][0] as TimelineConfig;
      expect(call.timeCol).toBe("dropoff_time");
      expect(call.groupByColumn).toBe("");
    });

    it("Test 20: changing base table clears groupByColumn (old group col invalid on new schema)", () => {
      const { onChange } = renderPanel({
        tableId: 1, tableRef: "demo.nyctaxi", timeCol: "pickup_time",
        groupByColumn: "driver_id",
        metrics: [{ column: "fare_amount", aggregation: "SUM", color: "FF66C2A5" }],
      });
      fireEvent.change(screen.getByLabelText("Base table"), { target: { value: "demo.other" } });
      const call = onChange.mock.calls[onChange.mock.calls.length - 1][0] as TimelineConfig;
      expect(call.groupByColumn).toBe("");
    });
  });
});
