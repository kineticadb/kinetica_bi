/**
 * v1.7 Phase 44 Plan 03 (FILTER-V17-11..17): DataFilterRenderer spec.
 *
 * TDD RED phase — tests written before the renderer exists. 23 it() blocks covering:
 *  - Empty-state gates (no tableId, no filterFields)
 *  - Per-kind control rendering (9 variants)
 *  - Apply dispatch: setBulkFilters with correct operators + empty/Any skip rules
 *  - markMaterializing call order (synchronous after setBulkFilters)
 *  - Clear button: clearFilters + staged state reset
 *  - Chip-dismissal sync: external removeFilter re-renders controls to "not applied"
 *  - Mount-time API fetches: topValuesFn (dropdown/multi-select) + columnStatsFn (number-range)
 *  - AbortController cleanup on unmount
 *  - Sole-trigger invariant: DataFilterRenderer NEVER imports materializeFilter
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useFilterStore } from "../../store/filterStore";
import { useFilterViewStore } from "../../store/filterViewStore";
import * as client from "../../api/client";
import * as DashboardContextModule from "../DashboardContext";

// ---- Mocks ----

vi.mock("../DashboardContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../DashboardContext")>();
  return {
    ...actual,
    useDashboardContext: vi.fn(),
  };
});

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    topValuesFn: vi.fn(() => Promise.resolve({ values: [] })),
    columnStatsFn: vi.fn(() =>
      Promise.resolve({ min: 0, max: 100, mean: 50, stddev: 20 }),
    ),
  };
});

// Imports AFTER mocks (hoisting safety)
import DataFilterRenderer from "./DataFilterRenderer";

// ---- Fixtures ----

const defaultTables = [
  {
    id: 1,
    name: "trips",
    schema: "ki_home",
    columns: {
      region: "varchar",
      status: "varchar",
      active: "boolean",
      fare: "double",
      ts: "timestamp",
    },
    created_at: "",
    updated_at: "",
  },
];

function mockContext(tableOverrides: client.TableDto[] = defaultTables) {
  vi.mocked(DashboardContextModule.useDashboardContext).mockReturnValue({
    dashboardId: 100,
    widgets: [],
    dynamicViews: [],
    retryDynamicView: vi.fn(),
  } as unknown as ReturnType<typeof DashboardContextModule.useDashboardContext>);
}

const makeWidget = (
  filterFields: Array<{ column: string; kind: string }> = [],
  configOverrides: Record<string, unknown> = {},
): client.WidgetDto => ({
  id: 42,
  dashboard_id: 1,
  title: "DF",
  type: "datafilter",
  position: 0,
  config: {
    tableId: 1,
    tableRef: "ki_home.trips",
    filterFields,
    ...configOverrides,
  },
  created_at: "",
  updated_at: "",
});

// ---- Setup ----

beforeEach(() => {
  vi.clearAllMocks();
  useFilterStore.getState().reset();
  mockContext();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---- Tests ----

describe("DataFilterRenderer", () => {
  // 1. Empty filterFields
  it("renders empty-state message when widget.config.filterFields is empty", () => {
    render(
      <DataFilterRenderer
        widget={makeWidget([])}
        tables={defaultTables}
      />,
    );
    expect(
      screen.getByText(/No filter fields configured/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("datafilter-apply")).not.toBeInTheDocument();
    expect(screen.queryByTestId("datafilter-clear")).not.toBeInTheDocument();
  });

  // 2. Missing tableId
  it("renders empty-state when tableId is missing", () => {
    const widget = makeWidget([{ column: "a", kind: "text-eq" }], {
      tableId: undefined,
    });
    render(<DataFilterRenderer widget={widget} tables={defaultTables} />);
    expect(screen.getByText(/Widget not yet configured/i)).toBeInTheDocument();
  });

  // 3. text-eq → text input
  it("renders a text input for text-eq kind", async () => {
    render(
      <DataFilterRenderer
        widget={makeWidget([{ column: "region", kind: "text-eq" }])}
        tables={defaultTables}
      />,
    );
    await waitFor(() =>
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument(),
    );
    const input = screen.getByRole("textbox", { name: /region/i });
    expect(input).toBeInTheDocument();
    expect((input as HTMLInputElement).type).toBe("text");
  });

  // 4. text-in → comma-separated input
  it("renders a comma-separated text input for text-in kind", async () => {
    render(
      <DataFilterRenderer
        widget={makeWidget([{ column: "region", kind: "text-in" }])}
        tables={defaultTables}
      />,
    );
    const input = screen.getByRole("textbox", { name: /region.*comma/i });
    expect(input).toBeInTheDocument();
    expect((input as HTMLInputElement).placeholder).toMatch(/comma/i);
  });

  // 5. dropdown → select populated from topValuesFn
  it("renders a select for dropdown kind populated from topValuesFn response", async () => {
    vi.mocked(client.topValuesFn).mockResolvedValue({ values: ["A", "B", "C"] });
    render(
      <DataFilterRenderer
        widget={makeWidget([{ column: "region", kind: "dropdown" }])}
        tables={defaultTables}
      />,
    );
    // Wait for topValuesFn to resolve and options to render
    await waitFor(() =>
      expect(screen.queryByRole("option", { name: "A" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("option", { name: "A" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "B" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "C" })).toBeInTheDocument();
    // placeholder option also present
    expect(screen.getByRole("combobox", { name: /region/i })).toBeInTheDocument();
  });

  // 5b. Race fix: the `tables` registry loads async. A widget that mounts BEFORE
  // its base table resolves must DEFER the value-universe fetch (no spurious
  // "No matches") and RE-FETCH once the metadata arrives.
  it("defers the value fetch until the table registry loads, then re-fetches", async () => {
    vi.mocked(client.topValuesFn).mockResolvedValue({ values: ["A", "B", "C"] });
    const widget = makeWidget([{ column: "region", kind: "dropdown" }]);

    // Mount with an EMPTY tables registry → base table can't resolve → fetch deferred.
    const { rerender } = render(<DataFilterRenderer widget={widget} tables={[]} />);
    expect(client.topValuesFn).not.toHaveBeenCalled();

    // Registry finishes loading → tables prop updates → effect must re-fire and fetch.
    rerender(<DataFilterRenderer widget={widget} tables={defaultTables} />);

    await waitFor(() =>
      expect(client.topValuesFn).toHaveBeenCalledWith(
        expect.objectContaining({ schema: "ki_home", table: "trips", column: "region" }),
        expect.anything(),
      ),
    );

    // Values now populate (no spurious empty state).
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "A" })).toBeInTheDocument(),
    );
  });

  // 6. multi-select → checkbox list populated from topValuesFn
  it("renders a multi-select for multi-select kind populated from topValuesFn response", async () => {
    vi.mocked(client.topValuesFn).mockResolvedValue({ values: ["A", "B", "C"] });
    const user = userEvent.setup();
    render(
      <DataFilterRenderer
        widget={makeWidget([{ column: "status", kind: "multi-select" }])}
        tables={defaultTables}
      />,
    );
    // MultiSelectChips: trigger (role="combobox") + popover (containing the checkbox list).
    // Open the popover first, then `findByRole` (auto-waits) for the topValuesFn
    // promise to resolve and populate the checkbox list inside the popover.
    const trigger = await screen.findByRole("combobox", { name: /status/i });
    await user.click(trigger);
    expect(await screen.findByRole("checkbox", { name: /status: A/i })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /status: B/i })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /status: C/i })).toBeInTheDocument();
  });

  // 6b. multi-select popover is PORTALED to document.body so it is never clipped by the
  // widget card's overflow / the react-grid-layout transform (the reported "dropdown
  // hidden unless the widget is tall enough" bug).
  it("renders the multi-select popover in a portal outside the widget wrapper", async () => {
    vi.mocked(client.topValuesFn).mockResolvedValue({ values: ["A", "B", "C"] });
    const user = userEvent.setup();
    const { container } = render(
      <DataFilterRenderer
        widget={makeWidget([{ column: "status", kind: "multi-select" }])}
        tables={defaultTables}
      />,
    );
    const trigger = await screen.findByRole("combobox", { name: /status/i });
    await user.click(trigger);
    await screen.findByRole("checkbox", { name: /status: A/i });

    const popover = document.querySelector(".datafilter-mschips-popover");
    expect(popover).not.toBeNull();
    // Portaled: rendered into document.body, NOT inside the rendered widget subtree…
    expect(container.contains(popover)).toBe(false);
    // …and NOT nested inside the inline .datafilter-mschips trigger wrapper.
    expect(popover!.closest(".datafilter-mschips")).toBeNull();
    // fixed-positioned (escapes overflow/transform clipping)
    expect((popover as HTMLElement).style.position).toBe("fixed");
  });

  // 7. number-eq → number input
  it("renders a number input for number-eq kind", async () => {
    render(
      <DataFilterRenderer
        widget={makeWidget([{ column: "fare", kind: "number-eq" }])}
        tables={defaultTables}
      />,
    );
    const input = screen.getByRole("spinbutton", { name: /fare/i });
    expect(input).toBeInTheDocument();
    expect((input as HTMLInputElement).type).toBe("number");
  });

  // 8. number-range → min/max inputs initialized from columnStatsFn
  it("renders two number inputs for number-range kind with initial values from columnStatsFn", async () => {
    vi.mocked(client.columnStatsFn).mockResolvedValue({
      min: 5,
      max: 50,
      mean: 27,
      stddev: 10,
    });
    render(
      <DataFilterRenderer
        widget={makeWidget([{ column: "fare", kind: "number-range" }])}
        tables={defaultTables}
      />,
    );
    await waitFor(() =>
      expect(
        (screen.getByRole("spinbutton", { name: /fare min/i }) as HTMLInputElement).value,
      ).toBe("5"),
    );
    expect(
      (screen.getByRole("spinbutton", { name: /fare max/i }) as HTMLInputElement).value,
    ).toBe("50");
  });

  // 9. date-eq → date input
  it("renders a date input for date-eq kind", async () => {
    render(
      <DataFilterRenderer
        widget={makeWidget([{ column: "ts", kind: "date-eq" }])}
        tables={defaultTables}
      />,
    );
    const input = screen.getByLabelText(/^ts$/i);
    expect(input).toBeInTheDocument();
    expect((input as HTMLInputElement).type).toBe("date");
  });

  // 10. date-range → two date inputs
  it("renders two date inputs for date-range kind", async () => {
    render(
      <DataFilterRenderer
        widget={makeWidget([{ column: "ts", kind: "date-range" }])}
        tables={defaultTables}
      />,
    );
    expect(screen.getByLabelText(/ts from/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/ts to/i)).toBeInTheDocument();
  });

  // 11. boolean-toggle → 3-state toggle
  it("renders a 3-state toggle (Any / True / False) for boolean-toggle kind with initial state 'Any'", async () => {
    render(
      <DataFilterRenderer
        widget={makeWidget([{ column: "active", kind: "boolean-toggle" }])}
        tables={defaultTables}
      />,
    );
    const anyBtn = screen.getByRole("radio", { name: /active: any/i });
    const trueBtn = screen.getByRole("radio", { name: /active: true/i });
    const falseBtn = screen.getByRole("radio", { name: /active: false/i });
    expect(anyBtn).toBeInTheDocument();
    expect(trueBtn).toBeInTheDocument();
    expect(falseBtn).toBeInTheDocument();
    // Initial state: "any" is checked
    expect(anyBtn).toHaveAttribute("aria-checked", "true");
    expect(trueBtn).toHaveAttribute("aria-checked", "false");
    expect(falseBtn).toHaveAttribute("aria-checked", "false");
  });

  // 12. Apply dispatches setBulkFilters with correct operators
  it("Apply button dispatches setBulkFilters with one ActiveFilter per non-skipped field", async () => {
    vi.mocked(client.topValuesFn).mockResolvedValue({ values: ["X", "Y", "Z"] });
    const setBulkSpy = vi.spyOn(useFilterStore.getState(), "setBulkFilters");
    const user = userEvent.setup();
    render(
      <DataFilterRenderer
        widget={makeWidget([
          { column: "region", kind: "text-eq" },
          { column: "status", kind: "multi-select" },
          { column: "active", kind: "boolean-toggle" },
        ])}
        tables={defaultTables}
      />,
    );

    // Multi-select checkboxes live in a popover. Open the combobox trigger
    // and `findByRole` waits for both the popover and the topValuesFn fetch.
    const statusTrigger = await screen.findByRole("combobox", { name: /status/i });
    await user.type(screen.getByRole("textbox", { name: /^region$/i }), "EAST");
    await user.click(statusTrigger);
    await user.click(await screen.findByRole("checkbox", { name: /status: X/i }));
    await user.click(screen.getByRole("checkbox", { name: /status: Y/i }));
    await user.click(screen.getByRole("radio", { name: /active: true/i }));
    await user.click(screen.getByTestId("datafilter-apply"));

    expect(setBulkSpy).toHaveBeenCalledTimes(1);
    const [tableId, batch] = setBulkSpy.mock.calls[0];
    expect(tableId).toBe(1);
    expect(batch).toHaveLength(3);
    expect(batch).toContainEqual(
      expect.objectContaining({
        column: "region",
        value: "EAST",
        operator: "eq",
        dataType: "string",
        sourceWidgetId: 42,
      }),
    );
    expect(batch).toContainEqual(
      expect.objectContaining({
        column: "status",
        value: ["X", "Y"],
        operator: "in",
        dataType: "string",
        sourceWidgetId: 42,
      }),
    );
    expect(batch).toContainEqual(
      expect.objectContaining({
        column: "active",
        value: true,
        operator: "eq",
        dataType: "boolean",
        sourceWidgetId: 42,
      }),
    );
  });

  // 13. Apply SKIPS text-eq with empty string
  it("Apply SKIPS text-eq field with empty string value", async () => {
    vi.mocked(client.topValuesFn).mockResolvedValue({ values: ["WEST"] });
    const setBulkSpy = vi.spyOn(useFilterStore.getState(), "setBulkFilters");
    const user = userEvent.setup();
    render(
      <DataFilterRenderer
        widget={makeWidget([
          { column: "region", kind: "text-eq" },
          { column: "status", kind: "dropdown" },
        ])}
        tables={defaultTables}
      />,
    );

    // Wait for dropdown to populate
    await waitFor(() =>
      expect(screen.queryByRole("option", { name: "WEST" })).toBeInTheDocument(),
    );

    // region left empty; select WEST in dropdown
    await user.selectOptions(
      screen.getByRole("combobox", { name: /status/i }),
      "WEST",
    );
    await user.click(screen.getByTestId("datafilter-apply"));

    const [, batch] = setBulkSpy.mock.calls[0];
    expect(batch).toHaveLength(1);
    expect(batch[0]).toMatchObject({ column: "status", value: "WEST" });
  });

  // 14. Apply SKIPS multi-select with empty array (CRITICAL: empty IN must never reach WHERE builder)
  it("Apply SKIPS multi-select with empty array (CRITICAL: empty IN never dispatched)", async () => {
    const setBulkSpy = vi.spyOn(useFilterStore.getState(), "setBulkFilters");
    const user = userEvent.setup();
    render(
      <DataFilterRenderer
        widget={makeWidget([
          { column: "status", kind: "multi-select" },
          { column: "region", kind: "text-eq" },
        ])}
        tables={defaultTables}
      />,
    );

    // multi-select left empty (no checkboxes checked); fill text-eq
    await user.type(screen.getByRole("textbox", { name: /^region$/i }), "EAST");
    await user.click(screen.getByTestId("datafilter-apply"));

    const [, batch] = setBulkSpy.mock.calls[0];
    expect(batch).toHaveLength(1);
    expect(batch[0]).toMatchObject({ column: "region", value: "EAST" });
  });

  // 15. Apply SKIPS number-range with missing bound
  it("Apply SKIPS number-range with missing bound (only min filled)", async () => {
    const setBulkSpy = vi.spyOn(useFilterStore.getState(), "setBulkFilters");
    const user = userEvent.setup();
    // Suppress auto-population from columnStatsFn for this test
    vi.mocked(client.columnStatsFn).mockRejectedValue(new Error("no stats"));
    render(
      <DataFilterRenderer
        widget={makeWidget([
          { column: "fare", kind: "number-range" },
          { column: "region", kind: "text-eq" },
        ])}
        tables={defaultTables}
      />,
    );

    // Wait for error state to settle (loading done)
    await waitFor(() =>
      expect(screen.queryByRole("spinbutton", { name: /fare min/i })).toBeInTheDocument(),
    );

    // Only fill min (max left empty)
    await act(async () => {
      const minInput = screen.getByRole("spinbutton", { name: /fare min/i });
      // Clear any pre-filled value and type a new one
      await user.clear(minInput);
      await user.type(minInput, "10");
      const maxInput = screen.getByRole("spinbutton", { name: /fare max/i });
      await user.clear(maxInput);
    });
    await user.type(screen.getByRole("textbox", { name: /^region$/i }), "EAST");
    await user.click(screen.getByTestId("datafilter-apply"));

    const [, batch] = setBulkSpy.mock.calls[0];
    // fare number-range skipped; only region dispatched
    expect(batch.find((f: { column: string }) => f.column === "fare")).toBeUndefined();
    expect(batch.find((f: { column: string }) => f.column === "region")).toBeDefined();
  });

  // 16. Apply SKIPS boolean-toggle in 'Any' state
  it("Apply SKIPS boolean-toggle in 'Any' state", async () => {
    const setBulkSpy = vi.spyOn(useFilterStore.getState(), "setBulkFilters");
    const user = userEvent.setup();
    render(
      <DataFilterRenderer
        widget={makeWidget([
          { column: "active", kind: "boolean-toggle" },
          { column: "region", kind: "text-eq" },
        ])}
        tables={defaultTables}
      />,
    );
    // boolean-toggle stays at "Any" (default); fill region
    await user.type(screen.getByRole("textbox", { name: /^region$/i }), "NORTH");
    await user.click(screen.getByTestId("datafilter-apply"));

    const [, batch] = setBulkSpy.mock.calls[0];
    expect(batch.find((f: { column: string }) => f.column === "active")).toBeUndefined();
  });

  // 17. Apply calls markMaterializing AFTER setBulkFilters synchronously
  it("Apply calls markMaterializing AFTER setBulkFilters synchronously (in the same click handler)", async () => {
    const calls: string[] = [];
    vi.spyOn(useFilterStore.getState(), "setBulkFilters").mockImplementation(
      () => void calls.push("setBulkFilters"),
    );
    vi.spyOn(
      useFilterViewStore.getState(),
      "markMaterializing",
    ).mockImplementation(() => void calls.push("markMaterializing"));
    const user = userEvent.setup();
    render(
      <DataFilterRenderer
        widget={makeWidget([{ column: "region", kind: "text-eq" }])}
        tables={defaultTables}
      />,
    );
    await user.type(screen.getByRole("textbox", { name: /^region$/i }), "A");
    await user.click(screen.getByTestId("datafilter-apply"));
    expect(calls).toEqual(["setBulkFilters", "markMaterializing"]);
  });

  // 18. Clear button calls clearFilters and resets staged values
  it("Clear button calls clearFilters(tableId) and resets staged values to defaults", async () => {
    vi.mocked(client.topValuesFn).mockResolvedValue({ values: ["WEST"] });
    const clearSpy = vi.spyOn(useFilterStore.getState(), "clearFilters");
    const user = userEvent.setup();
    render(
      <DataFilterRenderer
        widget={makeWidget([
          { column: "region", kind: "text-eq" },
          { column: "status", kind: "dropdown" },
        ])}
        tables={defaultTables}
      />,
    );
    // Wait for dropdown
    await waitFor(() =>
      expect(screen.queryByRole("option", { name: "WEST" })).toBeInTheDocument(),
    );

    await user.type(screen.getByRole("textbox", { name: /^region$/i }), "NORTH");
    await user.selectOptions(screen.getByRole("combobox", { name: /status/i }), "WEST");

    await user.click(screen.getByTestId("datafilter-clear"));

    expect(clearSpy).toHaveBeenCalledWith(1);
    // Region input should be cleared
    expect(
      (screen.getByRole("textbox", { name: /^region$/i }) as HTMLInputElement).value,
    ).toBe("");
    // Dropdown should be reset to placeholder
    expect(
      (screen.getByRole("combobox", { name: /status/i }) as HTMLSelectElement).value,
    ).toBe("");
  });

  // 19. External chip dismissal syncs the control to "not applied" state
  it("externally removing a filter via removeFilter syncs the control to 'not applied' state", async () => {
    vi.mocked(client.topValuesFn).mockResolvedValue({ values: ["WEST"] });
    const user = userEvent.setup();
    render(
      <DataFilterRenderer
        widget={makeWidget([{ column: "status", kind: "dropdown" }])}
        tables={defaultTables}
      />,
    );
    await waitFor(() =>
      expect(screen.queryByRole("option", { name: "WEST" })).toBeInTheDocument(),
    );

    // Apply a filter
    await user.selectOptions(screen.getByRole("combobox", { name: /status/i }), "WEST");
    await user.click(screen.getByTestId("datafilter-apply"));

    // Confirm applied badge visible
    await waitFor(() =>
      expect(document.querySelector(".datafilter-applied-badge")).toBeInTheDocument(),
    );

    // Externally remove the filter (chip × dismissal)
    act(() => {
      useFilterStore.getState().removeFilter(1, "status");
    });

    // Applied badge should disappear
    await waitFor(() =>
      expect(document.querySelector(".datafilter-applied-badge")).not.toBeInTheDocument(),
    );
  });

  // 20. Mount fetches topValuesFn for dropdown/multi-select AND columnStatsFn for number-range
  it("mount fetches topValuesFn for dropdown and multi-select fields, columnStatsFn for number-range fields", async () => {
    vi.mocked(client.topValuesFn).mockResolvedValue({ values: [] });
    vi.mocked(client.columnStatsFn).mockResolvedValue({
      min: 0,
      max: 1,
      mean: 0.5,
      stddev: 0.1,
    });
    render(
      <DataFilterRenderer
        widget={makeWidget([
          { column: "status", kind: "dropdown" },
          { column: "region", kind: "multi-select" },
          { column: "fare", kind: "number-range" },
        ])}
        tables={defaultTables}
      />,
    );
    await waitFor(() => {
      expect(client.topValuesFn).toHaveBeenCalledTimes(2);
      expect(client.columnStatsFn).toHaveBeenCalledTimes(1);
    });
    expect(client.topValuesFn).toHaveBeenCalledWith(
      expect.objectContaining({ column: "status" }),
      expect.any(AbortSignal),
    );
    expect(client.topValuesFn).toHaveBeenCalledWith(
      expect.objectContaining({ column: "region" }),
      expect.any(AbortSignal),
    );
    expect(client.columnStatsFn).toHaveBeenCalledWith(
      expect.objectContaining({ column: "fare" }),
      expect.any(AbortSignal),
    );
  });

  // 21. Mount-time API fetches aborted on unmount
  it("mount-time API fetches are aborted on unmount", async () => {
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(client.topValuesFn).mockImplementation(
      (_args, signal) =>
        new Promise((resolve) => {
          capturedSignal = signal;
          // Never resolves in this test (simulates a slow API call)
        }),
    );
    const { unmount } = render(
      <DataFilterRenderer
        widget={makeWidget([{ column: "status", kind: "dropdown" }])}
        tables={defaultTables}
      />,
    );
    // Wait for topValuesFn to be called
    await waitFor(() => expect(capturedSignal).toBeDefined());
    // Unmount
    unmount();
    expect(capturedSignal!.aborted).toBe(true);
  });

  // 22. Does NOT import materializeFilter (sole-trigger invariant)
  it("does NOT import materializeFilter (sole-trigger invariant — static assertion)", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    // Resolve relative to the project src root so this works in vitest JSDOM env
    const filePath = path.resolve(
      process.cwd(),
      "src/components/charts/DataFilterRenderer.tsx",
    );
    const source = await fs.readFile(filePath, "utf-8");
    expect(source).not.toMatch(/materializeFilter/);
  });

  // 23. Warning for column no longer on base table
  it("renders a warning row for a configured column that no longer exists on the base table", async () => {
    render(
      <DataFilterRenderer
        widget={makeWidget([
          { column: "ghost_column", kind: "text-eq" },
          { column: "region", kind: "text-eq" },
        ])}
        tables={defaultTables}
      />,
    );
    expect(
      screen.getByText(/ghost_column.*not found on base table/i),
    ).toBeInTheDocument();
    // The valid column still renders
    expect(screen.getByRole("textbox", { name: /^region$/i })).toBeInTheDocument();
  });
});
