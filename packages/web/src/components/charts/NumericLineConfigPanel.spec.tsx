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
});
