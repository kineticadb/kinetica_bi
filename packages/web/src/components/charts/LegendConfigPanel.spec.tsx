import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import LegendConfigPanel from "./LegendConfigPanel";
import type { WidgetDto } from "../../api/client";
import fs from "fs";
import path from "path";

function makeWidget(overrides: Partial<WidgetDto>): WidgetDto {
  return {
    id: 1,
    dashboard_id: 1,
    title: "",
    type: "bar",
    position: 0,
    config: {},
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

describe("LegendConfigPanel (Phase 42 / WIDGET-V17-03)", () => {
  it("Test 1: empty mapWidgets — disabled select + placeholder + hint", () => {
    const onChange = vi.fn();
    render(
      <LegendConfigPanel
        config={{}}
        onChange={onChange}
        widgets={[makeWidget({ id: 1, type: "bar" })]}
      />
    );
    const select = screen.getByLabelText("Source map widget") as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.disabled).toBe(true);
    expect(screen.getByText("— no map widgets on this dashboard —")).toBeTruthy();
    expect(screen.getByText("Add a map widget first, then bind the legend.")).toBeTruthy();
  });

  it("Test 2: populated dropdown + select placeholder + bar widget filtered out", () => {
    const widgets = [
      makeWidget({ id: 1, type: "map", title: "Map A" }),
      makeWidget({ id: 2, type: "map", title: "Map B" }),
      makeWidget({ id: 3, type: "bar", title: "Bar C" }),
    ];
    render(<LegendConfigPanel config={{}} onChange={vi.fn()} widgets={widgets} />);
    const select = screen.getByLabelText("Source map widget") as HTMLSelectElement;
    expect(select.disabled).toBe(false);
    expect(screen.getByText("— select —")).toBeTruthy();
    expect(screen.getByText("Map A")).toBeTruthy();
    expect(screen.getByText("Map B")).toBeTruthy();
    expect(screen.queryByText("Bar C")).toBeNull();
  });

  it("Test 3: sourceMapWidgetId pre-selected; placeholder absent", () => {
    const widgets = [
      makeWidget({ id: 1, type: "map", title: "Map A" }),
      makeWidget({ id: 2, type: "map", title: "Map B" }),
    ];
    render(<LegendConfigPanel config={{ sourceMapWidgetId: 2 }} onChange={vi.fn()} widgets={widgets} />);
    const select = screen.getByLabelText("Source map widget") as HTMLSelectElement;
    expect(select.value).toBe("2");
    expect(screen.queryByText("— select —")).toBeNull();
  });

  it("Test 4: onChange fires with numeric sourceMapWidgetId on selection", () => {
    const onChange = vi.fn();
    const widgets = [
      makeWidget({ id: 1, type: "map", title: "Map A" }),
      makeWidget({ id: 2, type: "map", title: "Map B" }),
    ];
    render(<LegendConfigPanel config={{ sourceMapWidgetId: 1 }} onChange={onChange} widgets={widgets} />);
    const select = screen.getByLabelText("Source map widget") as HTMLSelectElement;
    // Clear auto-pick calls (none expected here since sourceMapWidgetId is set, but be defensive)
    onChange.mockClear();
    fireEvent.change(select, { target: { value: "2" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ sourceMapWidgetId: 2 });
  });

  it("Test 5: auto-pick fires onChange with first map widget id on mount", () => {
    const onChange = vi.fn();
    const widgets = [
      makeWidget({ id: 7, type: "map", title: "Map A" }),
      makeWidget({ id: 9, type: "map", title: "Map B" }),
    ];
    render(<LegendConfigPanel config={{}} onChange={onChange} widgets={widgets} />);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ sourceMapWidgetId: 7 });
  });

  it("Test 6: no auto-pick when sourceMapWidgetId already set", () => {
    const onChange = vi.fn();
    const widgets = [makeWidget({ id: 7, type: "map" })];
    render(<LegendConfigPanel config={{ sourceMapWidgetId: 7 }} onChange={onChange} widgets={widgets} />);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Test 7: no auto-pick when no map widgets exist", () => {
    const onChange = vi.fn();
    render(<LegendConfigPanel config={{}} onChange={onChange} widgets={[]} />);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Test 8: widgets prop undefined — defaults to empty array (no throw)", () => {
    expect(() =>
      render(<LegendConfigPanel config={{}} onChange={vi.fn()} />)
    ).not.toThrow();
    const select = screen.getByLabelText("Source map widget") as HTMLSelectElement;
    expect(select.disabled).toBe(true);
  });

  it("Test 9: source file does NOT import or call useDashboardContext", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "LegendConfigPanel.tsx"),
      "utf-8"
    );
    expect(source).not.toMatch(/useDashboardContext/);
  });

  it("Test 10: non-map widget types filtered out (records, info-card, bar)", () => {
    const widgets = [
      makeWidget({ id: 1, type: "map", title: "MapOne" }),
      makeWidget({ id: 2, type: "records", title: "Records" }),
      makeWidget({ id: 3, type: "info-card", title: "InfoCard" }),
      makeWidget({ id: 4, type: "bar", title: "BarChart" }),
    ];
    render(<LegendConfigPanel config={{ sourceMapWidgetId: 1 }} onChange={vi.fn()} widgets={widgets} />);
    expect(screen.getByText("MapOne")).toBeTruthy();
    expect(screen.queryByText("Records")).toBeNull();
    expect(screen.queryByText("InfoCard")).toBeNull();
    expect(screen.queryByText("BarChart")).toBeNull();
  });
});
