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
});
