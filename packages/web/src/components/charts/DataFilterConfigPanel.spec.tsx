/**
 * v1.7 Phase 44 Plan 02 (FILTER-V17-08..10): DataFilterConfigPanel unit tests.
 *
 * 18 tests covering:
 *   - Base-table picker (render, selection, table-change clears filterFields)
 *   - Row builder gating (no table → no builder)
 *   - Row add / remove
 *   - Column picker (WKT/geometry/large-text exclusion via isColumnDrillDownSafe)
 *   - Kind picker scoped by column data type
 *   - isValid signaling
 *   - Missing-column warning
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DataFilterConfigPanel from "./DataFilterConfigPanel";
import { getAllChartTypes } from "./registry";
import { registerAllChartTypes } from "./definitions/index";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const makeTables = () => [
  {
    id: 1,
    name: "t1",
    schema: "s",
    columns: {
      region: "varchar",
      fare: "double",
      ts: "timestamp",
      active: "boolean",
      geom: "wkt", // excluded
      shape: "geometry", // excluded
      loc: "point", // excluded
      notes: "text", // excluded (large-text)
    },
  },
  {
    id: 2,
    name: "t2",
    schema: "s",
    columns: {
      status: "varchar",
      score: "int",
    },
  },
  {
    id: 3,
    name: "t3",
    schema: "s",
    columns: {
      city: "varchar",
    },
  },
];

const renderPanel = (
  configOverrides: Record<string, unknown> = {},
  propsOverrides: Record<string, unknown> = {},
) => {
  const onChange = vi.fn();
  const isValid = vi.fn();
  const props = {
    config: { ...configOverrides },
    onChange,
    tables: makeTables(),
    isValid,
    ...propsOverrides,
  };
  const utils = render(<DataFilterConfigPanel {...props} />);
  return { ...utils, onChange, isValid };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DataFilterConfigPanel (Phase 44 / FILTER-V17-08..10)", () => {
  it("1: renders an empty base-table picker when config.tableId is undefined", () => {
    renderPanel();
    const select = screen.getByLabelText("Base table") as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(
      screen.getByText("Select a base table..."),
    ).toBeTruthy();
    // All 3 tables should appear as options
    expect(screen.getByText("s.t1")).toBeTruthy();
    expect(screen.getByText("s.t2")).toBeTruthy();
    expect(screen.getByText("s.t3")).toBeTruthy();
  });

  it("2: calls onChange with {tableId, tableRef, filterFields:[]} when operator picks a base table", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPanel();
    const select = screen.getByLabelText("Base table") as HTMLSelectElement;
    await user.selectOptions(select, "s.t1");
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        tableId: 1,
        tableRef: "s.t1",
        filterFields: [],
      }),
    );
  });

  it("3: clears filterFields when the base table changes", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPanel({
      tableId: 1,
      tableRef: "s.t1",
      filterFields: [{ column: "region", kind: "text-eq" }],
    });
    const select = screen.getByLabelText("Base table") as HTMLSelectElement;
    await user.selectOptions(select, "s.t2");
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        tableId: 2,
        tableRef: "s.t2",
        filterFields: [],
      }),
    );
  });

  it("4: does NOT render the row builder until a base table is selected", () => {
    renderPanel({ filterFields: [] });
    expect(screen.queryByLabelText("Add filter field")).toBeNull();
    expect(screen.getByText("Pick a base table first.")).toBeTruthy();
  });

  it("5: renders an 'Add filter field' button when a base table is selected", () => {
    renderPanel({ tableId: 1, tableRef: "s.t1", filterFields: [] });
    expect(screen.getByLabelText("Add filter field")).toBeTruthy();
  });

  it("6: clicking 'Add filter field' adds a row with empty column and kind", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPanel({
      tableId: 1,
      tableRef: "s.t1",
      filterFields: [],
    });
    const addBtn = screen.getByLabelText("Add filter field");
    await user.click(addBtn);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        filterFields: [{ column: "", kind: "" }],
      }),
    );
  });

  it("7: column picker omits WKT / geometry / large-text columns (isColumnDrillDownSafe)", async () => {
    const user = userEvent.setup();
    // Start with one empty row already added
    renderPanel({
      tableId: 1,
      tableRef: "s.t1",
      filterFields: [{ column: "", kind: "" }],
    });
    const colPicker = screen.getByLabelText(
      "Filter field 1 column",
    ) as HTMLSelectElement;

    // Excluded types must not appear
    const optionTexts = Array.from(colPicker.options).map((o) => o.value);
    expect(optionTexts).not.toContain("geom");
    expect(optionTexts).not.toContain("shape");
    expect(optionTexts).not.toContain("loc");
    expect(optionTexts).not.toContain("notes");

    // Eligible columns must appear
    expect(optionTexts).toContain("region");
    expect(optionTexts).toContain("fare");
    expect(optionTexts).toContain("ts");
    expect(optionTexts).toContain("active");
  });

  it("8: column picker shows all eligible columns from the selected base table", () => {
    renderPanel({
      tableId: 1,
      tableRef: "s.t1",
      filterFields: [{ column: "", kind: "" }],
    });
    const colPicker = screen.getByLabelText(
      "Filter field 1 column",
    ) as HTMLSelectElement;
    // t1 eligible columns: region, fare, ts, active (4 eligible + 1 placeholder = 5 options)
    const nonPlaceholderOptions = Array.from(colPicker.options).filter(
      (o) => o.value !== "",
    );
    expect(nonPlaceholderOptions).toHaveLength(4);
  });

  it("9: kind picker is disabled until a column is picked", () => {
    renderPanel({
      tableId: 1,
      tableRef: "s.t1",
      filterFields: [{ column: "", kind: "" }],
    });
    const kindPicker = screen.getByLabelText(
      "Filter field 1 control kind",
    ) as HTMLSelectElement;
    expect(kindPicker.disabled).toBe(true);
  });

  it("10: kind picker offers numeric kinds (number-eq, number-range) when column is numeric", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const isValid = vi.fn();
    let currentConfig: Record<string, unknown> = {
      tableId: 1,
      tableRef: "s.t1",
      filterFields: [{ column: "", kind: "" }],
    };
    const { rerender } = render(
      <DataFilterConfigPanel
        config={currentConfig}
        onChange={(c) => { onChange(c); currentConfig = c; }}
        tables={makeTables()}
        isValid={isValid}
      />,
    );
    const colPicker = screen.getByLabelText("Filter field 1 column");
    await user.selectOptions(colPicker, "fare");
    // Rerender with the config emitted by onChange
    rerender(
      <DataFilterConfigPanel
        config={currentConfig}
        onChange={onChange}
        tables={makeTables()}
        isValid={isValid}
      />,
    );
    const kindPicker = screen.getByLabelText(
      "Filter field 1 control kind",
    ) as HTMLSelectElement;
    const kindValues = Array.from(kindPicker.options)
      .filter((o) => o.value !== "")
      .map((o) => o.value);
    expect(kindValues).toEqual(["number-eq", "number-range", "number-slider"]);
  });

  it("11: kind picker offers string kinds (text-eq, text-in, dropdown, multi-select) when column is string", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const isValid = vi.fn();
    let currentConfig: Record<string, unknown> = {
      tableId: 1,
      tableRef: "s.t1",
      filterFields: [{ column: "", kind: "" }],
    };
    const { rerender } = render(
      <DataFilterConfigPanel
        config={currentConfig}
        onChange={(c) => { onChange(c); currentConfig = c; }}
        tables={makeTables()}
        isValid={isValid}
      />,
    );
    const colPicker = screen.getByLabelText("Filter field 1 column");
    await user.selectOptions(colPicker, "region");
    rerender(
      <DataFilterConfigPanel
        config={currentConfig}
        onChange={onChange}
        tables={makeTables()}
        isValid={isValid}
      />,
    );
    const kindPicker = screen.getByLabelText(
      "Filter field 1 control kind",
    ) as HTMLSelectElement;
    const kindValues = Array.from(kindPicker.options)
      .filter((o) => o.value !== "")
      .map((o) => o.value);
    expect(kindValues).toEqual([
      "text-eq",
      "text-in",
      "dropdown",
      "multi-select",
    ]);
  });

  it("12: kind picker offers date kinds (date-eq, date-range) when column is datetime", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const isValid = vi.fn();
    let currentConfig: Record<string, unknown> = {
      tableId: 1,
      tableRef: "s.t1",
      filterFields: [{ column: "", kind: "" }],
    };
    const { rerender } = render(
      <DataFilterConfigPanel
        config={currentConfig}
        onChange={(c) => { onChange(c); currentConfig = c; }}
        tables={makeTables()}
        isValid={isValid}
      />,
    );
    const colPicker = screen.getByLabelText("Filter field 1 column");
    await user.selectOptions(colPicker, "ts");
    rerender(
      <DataFilterConfigPanel
        config={currentConfig}
        onChange={onChange}
        tables={makeTables()}
        isValid={isValid}
      />,
    );
    const kindPicker = screen.getByLabelText(
      "Filter field 1 control kind",
    ) as HTMLSelectElement;
    const kindValues = Array.from(kindPicker.options)
      .filter((o) => o.value !== "")
      .map((o) => o.value);
    expect(kindValues).toEqual(["date-eq", "date-range"]);
  });

  it("13: kind picker offers boolean-toggle when column is boolean", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const isValid = vi.fn();
    let currentConfig: Record<string, unknown> = {
      tableId: 1,
      tableRef: "s.t1",
      filterFields: [{ column: "", kind: "" }],
    };
    const { rerender } = render(
      <DataFilterConfigPanel
        config={currentConfig}
        onChange={(c) => { onChange(c); currentConfig = c; }}
        tables={makeTables()}
        isValid={isValid}
      />,
    );
    const colPicker = screen.getByLabelText("Filter field 1 column");
    await user.selectOptions(colPicker, "active");
    rerender(
      <DataFilterConfigPanel
        config={currentConfig}
        onChange={onChange}
        tables={makeTables()}
        isValid={isValid}
      />,
    );
    const kindPicker = screen.getByLabelText(
      "Filter field 1 control kind",
    ) as HTMLSelectElement;
    const kindValues = Array.from(kindPicker.options)
      .filter((o) => o.value !== "")
      .map((o) => o.value);
    expect(kindValues).toEqual(["boolean-toggle"]);
  });

  it("14: clicking Remove on a row removes only that row", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPanel({
      tableId: 1,
      tableRef: "s.t1",
      filterFields: [
        { column: "region", kind: "text-eq" },
        { column: "fare", kind: "number-eq" },
        { column: "ts", kind: "date-eq" },
      ],
    });
    const removeButtons = screen.getAllByRole("button", { name: /Remove filter field/ });
    // Remove middle row (index 1)
    await user.click(removeButtons[1]);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        filterFields: [
          { column: "region", kind: "text-eq" },
          { column: "ts", kind: "date-eq" },
        ],
      }),
    );
  });

  it("15: changing a row's column resets that row's kind to ''", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPanel({
      tableId: 1,
      tableRef: "s.t1",
      filterFields: [{ column: "region", kind: "text-eq" }],
    });
    const colPicker = screen.getByLabelText("Filter field 1 column");
    await user.selectOptions(colPicker, "fare");
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        filterFields: [{ column: "fare", kind: "" }],
      }),
    );
  });

  it("16: isValid prop is called with false when filterFields is empty OR any row has empty column/kind", () => {
    // Case A: empty filterFields
    const isValidA = vi.fn();
    render(
      <DataFilterConfigPanel
        config={{ tableId: 1, tableRef: "s.t1", filterFields: [] }}
        onChange={vi.fn()}
        tables={makeTables()}
        isValid={isValidA}
      />,
    );
    expect(isValidA).toHaveBeenLastCalledWith(false);

    // Case B: partially-filled row (column set, kind empty)
    const isValidB = vi.fn();
    render(
      <DataFilterConfigPanel
        config={{
          tableId: 1,
          tableRef: "s.t1",
          filterFields: [{ column: "region", kind: "" }],
        }}
        onChange={vi.fn()}
        tables={makeTables()}
        isValid={isValidB}
      />,
    );
    expect(isValidB).toHaveBeenLastCalledWith(false);
  });

  it("17: isValid prop is called with true when all rows have non-empty column and kind", () => {
    const isValid = vi.fn();
    render(
      <DataFilterConfigPanel
        config={{
          tableId: 1,
          tableRef: "s.t1",
          filterFields: [
            { column: "region", kind: "text-eq" },
            { column: "fare", kind: "number-range" },
          ],
        }}
        onChange={vi.fn()}
        tables={makeTables()}
        isValid={isValid}
      />,
    );
    expect(isValid).toHaveBeenLastCalledWith(true);
  });

  it("18: rows for columns no longer present in the table show an inline 'column missing' warning", () => {
    render(
      <DataFilterConfigPanel
        config={{
          tableId: 1,
          tableRef: "s.t1",
          filterFields: [{ column: "nonexistent", kind: "text-eq" }],
        }}
        onChange={vi.fn()}
        tables={makeTables()}
        isValid={vi.fn()}
      />,
    );
    // The warning text uses HTML entities in the component, but the DOM renders them as literal chars
    expect(
      screen.getByText(/Column .nonexistent. not found on base table/),
    ).toBeTruthy();
  });

  it("bonus: getAllChartTypes includes datafilter type", () => {
    // Register all types first (main.tsx calls this at app start; tests need it explicit)
    registerAllChartTypes();
    const types = getAllChartTypes();
    const df = types.find((t) => t.type === "datafilter");
    expect(df).toBeDefined();
    expect(df?.label).toBe("Data Filter");
    expect(df?.usesDataSource).toBe(false);
    expect(df?.usesAggregation).toBe(false);
    expect(df?.supportsDrillDown).toBe(false);
  });
});
