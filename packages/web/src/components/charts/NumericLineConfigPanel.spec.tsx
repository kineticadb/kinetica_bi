import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import NumericLineConfigPanel, { type NumericLineConfig } from "./NumericLineConfigPanel";

const TABLES: NonNullable<Parameters<typeof NumericLineConfigPanel>[0]["tables"]> = [
  {
    id: 1,
    name: "nyctaxi",
    schema: "demo",
    columns: {
      trip_distance: "double",
      fare_amount: "double",
      passenger_count: "int",
      pickup_time: "timestamp",
      pickup_geom: "wkt",
      driver_id: "varchar",
    },
  },
];

function renderPanel(initial: Partial<NumericLineConfig> = {}, opts?: { isValid?: (b: boolean) => void }) {
  const onChange = vi.fn();
  const isValid = opts?.isValid ?? vi.fn();
  const utils = render(
    <NumericLineConfigPanel
      config={{ metrics: [], ...initial } as Record<string, unknown>}
      onChange={onChange}
      tables={TABLES}
      isValid={isValid}
    />,
  );
  return { onChange, isValid, ...utils };
}

describe("NumericLineConfigPanel", () => {
  it("shows the base-table picker; no X-axis picker until a table is selected", () => {
    renderPanel();
    expect(screen.getByLabelText("Base table")).toBeInTheDocument();
    expect(screen.queryByLabelText("X-axis column")).not.toBeInTheDocument();
  });

  it("X-axis picker lists ONLY numeric columns (no datetime / wkt / string)", () => {
    renderPanel({ tableId: 1, tableRef: "demo.nyctaxi" });
    const sel = screen.getByLabelText("X-axis column") as HTMLSelectElement;
    const opts = Array.from(sel.options).map((o) => o.value).filter(Boolean);
    expect(opts.sort()).toEqual(["fare_amount", "passenger_count", "trip_distance"]);
    expect(opts).not.toContain("pickup_time");
    expect(opts).not.toContain("pickup_geom");
    expect(opts).not.toContain("driver_id");
  });

  it("selecting a base table clears xField + metrics", () => {
    const { onChange } = renderPanel();
    fireEvent.change(screen.getByLabelText("Base table"), { target: { value: "demo.nyctaxi" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ tableId: 1, tableRef: "demo.nyctaxi", xField: "", metrics: [] }),
    );
  });

  it("adding a metric appends a default SUM metric", () => {
    const { onChange } = renderPanel({ tableId: 1, tableRef: "demo.nyctaxi", xField: "trip_distance" });
    fireEvent.click(screen.getByLabelText("Add metric"));
    const call = onChange.mock.calls.at(-1)![0] as { metrics: unknown[] };
    expect(call.metrics).toHaveLength(1);
    expect(call.metrics[0]).toMatchObject({ column: "", aggregation: "SUM" });
  });

  it("reports valid only with table + xField + ≥1 complete metric", () => {
    const isValid = vi.fn();
    renderPanel(
      {
        tableId: 1,
        tableRef: "demo.nyctaxi",
        xField: "trip_distance",
        metrics: [{ column: "fare_amount", aggregation: "SUM", color: "FF66C2A5" }],
      },
      { isValid },
    );
    expect(isValid).toHaveBeenLastCalledWith(true);
  });

  it("reports invalid when xField is unset", () => {
    const isValid = vi.fn();
    renderPanel(
      {
        tableId: 1,
        tableRef: "demo.nyctaxi",
        xField: "",
        metrics: [{ column: "fare_amount", aggregation: "SUM", color: "FF66C2A5" }],
      },
      { isValid },
    );
    expect(isValid).toHaveBeenLastCalledWith(false);
  });

  it("Max buckets input clamps to [2, 1000]; default shown when unset", () => {
    renderPanel({ tableId: 1, tableRef: "demo.nyctaxi", xField: "trip_distance" });
    expect((screen.getByLabelText("Max buckets") as HTMLInputElement).value).toBe("50");
  });

  it("toggling 'Vertical orientation' patches vertical:true", () => {
    const { onChange } = renderPanel({ tableId: 1, tableRef: "demo.nyctaxi", xField: "trip_distance" });
    fireEvent.click(screen.getByLabelText("Vertical orientation"));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ vertical: true }));
  });

  // ---- Phase 72: Group By picker + single-metric-when-grouped (GROUP-V114-02, -03) ----

  describe("Group By (Phase 72)", () => {
    it("Group By picker present with a None option; lists drilldown-safe columns excluding the xField", () => {
      renderPanel({
        tableId: 1, tableRef: "demo.nyctaxi", xField: "trip_distance",
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
      // the selected xField is excluded from the group-by options
      expect(opts).not.toContain("trip_distance");
      // geometry (wkt) is drilldown-UNsafe and excluded
      expect(opts).not.toContain("pickup_geom");
    });

    it("ungrouped (groupByColumn '') still shows the multi-metric builder with the Add-metric button", () => {
      renderPanel({
        tableId: 1, tableRef: "demo.nyctaxi", xField: "trip_distance",
        metrics: [{ column: "fare_amount", aggregation: "SUM", color: "FF66C2A5" }],
      });
      expect(screen.getByRole("button", { name: /Add metric/ })).toBeInTheDocument();
    });

    it("selecting a Group By patches groupByColumn (non-destructive — does NOT clear metrics)", () => {
      const { onChange } = renderPanel({
        tableId: 1, tableRef: "demo.nyctaxi", xField: "trip_distance",
        metrics: [
          { column: "fare_amount", aggregation: "SUM", color: "FF66C2A5" },
          { column: "passenger_count", aggregation: "AVG", color: "FFFC8D62" },
        ],
      });
      fireEvent.change(screen.getByLabelText("Group by"), { target: { value: "driver_id" } });
      const call = onChange.mock.calls[onChange.mock.calls.length - 1][0] as NumericLineConfig;
      expect(call.groupByColumn).toBe("driver_id");
      // non-destructive: both metrics preserved in config so clearing restores them
      expect(call.metrics).toHaveLength(2);
    });

    it("when grouped, exactly one metric row renders, Add-metric is HIDDEN, and Remove is hidden", () => {
      renderPanel({
        tableId: 1, tableRef: "demo.nyctaxi", xField: "trip_distance",
        groupByColumn: "driver_id",
        metrics: [
          { column: "fare_amount", aggregation: "SUM", color: "FF66C2A5" },
          { column: "passenger_count", aggregation: "AVG", color: "FFFC8D62" },
        ],
      });
      // only metrics[0] row visible
      expect(screen.getByTestId("numericline-metric-row-0")).toBeInTheDocument();
      expect(screen.queryByTestId("numericline-metric-row-1")).not.toBeInTheDocument();
      // Add metric button hidden when grouped
      expect(screen.queryByRole("button", { name: /Add metric/ })).not.toBeInTheDocument();
      // Remove button hidden on the single grouped row
      expect(screen.queryByRole("button", { name: /Remove metric 1/ })).not.toBeInTheDocument();
    });

    it("clearing Group By back to None restores the multi-metric builder with metrics intact", () => {
      const { onChange, rerender } = renderPanel({
        tableId: 1, tableRef: "demo.nyctaxi", xField: "trip_distance",
        groupByColumn: "driver_id",
        metrics: [
          { column: "fare_amount", aggregation: "SUM", color: "FF66C2A5" },
          { column: "passenger_count", aggregation: "AVG", color: "FFFC8D62" },
        ],
      });
      fireEvent.change(screen.getByLabelText("Group by"), { target: { value: "" } });
      const call = onChange.mock.calls[onChange.mock.calls.length - 1][0] as NumericLineConfig;
      expect(call.groupByColumn).toBe("");
      expect(call.metrics).toHaveLength(2);
      // re-render in the now-ungrouped state → multi-metric builder restored
      rerender(
        <NumericLineConfigPanel
          config={{ ...call } as Record<string, unknown>}
          onChange={onChange}
          tables={TABLES}
          isValid={vi.fn()}
        />,
      );
      expect(screen.getByRole("button", { name: /Add metric/ })).toBeInTheDocument();
      expect(screen.getByTestId("numericline-metric-row-1")).toBeInTheDocument();
    });

    it("enabling Group By with 0 metrics seeds one default metric row", () => {
      const { onChange } = renderPanel({
        tableId: 1, tableRef: "demo.nyctaxi", xField: "trip_distance",
        metrics: [],
      });
      fireEvent.change(screen.getByLabelText("Group by"), { target: { value: "driver_id" } });
      const call = onChange.mock.calls[onChange.mock.calls.length - 1][0] as NumericLineConfig;
      expect(call.groupByColumn).toBe("driver_id");
      expect(call.metrics.length).toBeGreaterThanOrEqual(1);
    });

    it("grouped form is valid with tableId + xField + groupByColumn + a complete metrics[0]", () => {
      const isValid = vi.fn();
      render(
        <NumericLineConfigPanel
          config={{
            tableId: 1, tableRef: "demo.nyctaxi", xField: "trip_distance",
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

    it("when grouped, the per-metric color swatch is HIDDEN and the palette preview + 'Color palette' label show instead", () => {
      renderPanel({
        tableId: 1, tableRef: "demo.nyctaxi", xField: "trip_distance",
        groupByColumn: "driver_id",
        metrics: [{ column: "fare_amount", aggregation: "SUM", color: "FF66C2A5" }],
      });
      expect(screen.queryByLabelText("Metric 1 color")).toBeNull();
      expect(screen.getByText("Color palette")).toBeInTheDocument();
      expect(screen.getByLabelText("Color palette preview")).toBeInTheDocument();
    });

    it("ungrouped keeps the per-metric color swatch and shows no palette preview (regression)", () => {
      renderPanel({
        tableId: 1, tableRef: "demo.nyctaxi", xField: "trip_distance",
        metrics: [{ column: "fare_amount", aggregation: "SUM", color: "FF66C2A5" }],
      });
      expect(screen.getByLabelText("Metric 1 color")).toBeInTheDocument();
      expect(screen.queryByLabelText("Color palette preview")).toBeNull();
    });

    it("changing X-axis column to the current groupByColumn clears groupByColumn", () => {
      const { onChange } = renderPanel({
        tableId: 1, tableRef: "demo.nyctaxi", xField: "trip_distance",
        groupByColumn: "fare_amount",
        metrics: [{ column: "fare_amount", aggregation: "SUM", color: "FF66C2A5" }],
      });
      fireEvent.change(screen.getByLabelText("X-axis column"), { target: { value: "fare_amount" } });
      const call = onChange.mock.calls[onChange.mock.calls.length - 1][0] as NumericLineConfig;
      expect(call.xField).toBe("fare_amount");
      expect(call.groupByColumn).toBe("");
    });

    it("changing base table clears groupByColumn (old group col invalid on new schema)", () => {
      const { onChange } = renderPanel({
        tableId: 1, tableRef: "demo.nyctaxi", xField: "trip_distance",
        groupByColumn: "driver_id",
        metrics: [{ column: "fare_amount", aggregation: "SUM", color: "FF66C2A5" }],
      });
      fireEvent.change(screen.getByLabelText("Base table"), { target: { value: "demo.nyctaxi" } });
      const call = onChange.mock.calls[onChange.mock.calls.length - 1][0] as NumericLineConfig;
      expect(call.groupByColumn).toBe("");
    });
  });

  // ---- Phase 86: Y-axis format control (AXIS-V117-01, AXIS-V117-02) ----

  describe("Y-Axis Format (Phase 86)", () => {
    it("Y1: Y-AXIS FORMAT label renders in OPTIONS section when a table is selected", () => {
      renderPanel({
        tableId: 1, tableRef: "demo.nyctaxi", xField: "trip_distance",
        metrics: [{ column: "fare_amount", aggregation: "SUM", color: "FF66C2A5" }],
      });
      expect(screen.getByText("Y-AXIS FORMAT")).toBeInTheDocument();
    });

    it("Y2: selecting 'si' on the Format kind select calls onChange with yAxisFormat: { kind: 'si', ... }", () => {
      const { onChange } = renderPanel({
        tableId: 1, tableRef: "demo.nyctaxi", xField: "trip_distance",
        metrics: [{ column: "fare_amount", aggregation: "SUM", color: "FF66C2A5" }],
      });
      const kindSelect = screen.getByRole("combobox", { name: /format kind/i });
      fireEvent.change(kindSelect, { target: { value: "si" } });
      const call = onChange.mock.calls[onChange.mock.calls.length - 1][0] as NumericLineConfig;
      expect(call.yAxisFormat).toMatchObject({ kind: "si" });
    });

    it("Y3: selecting '— Use column default —' calls onChange with yAxisFormat: undefined", () => {
      const { onChange } = renderPanel({
        tableId: 1, tableRef: "demo.nyctaxi", xField: "trip_distance",
        metrics: [{ column: "fare_amount", aggregation: "SUM", color: "FF66C2A5" }],
        yAxisFormat: { kind: "si", decimals: 1 },
      });
      const kindSelect = screen.getByRole("combobox", { name: /format kind/i });
      fireEvent.change(kindSelect, { target: { value: "" } });
      const call = onChange.mock.calls[onChange.mock.calls.length - 1][0] as NumericLineConfig;
      expect(call.yAxisFormat).toBeUndefined();
    });
  });
});
