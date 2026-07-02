/**
 * ChartConfigPanel.spec.tsx — Phase 11-10 tests: custom-panel scaffold fix
 *
 * Covers:
 *   - Title + Data Source scaffold renders for custom-panel chart types (e.g. map)
 *   - Table selection populates columns forwarded to CustomConfigPanel
 *   - Auto-save persists tableRef + tableId
 *   - __autoSuggestActive stripped from persisted config
 *   - No Apply / Cancel inside custom-panel chart UI (auto-save → modal header Close dismisses)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ChartConfigPanel from "./ChartConfigPanel";
import type { ConfigPanelProps } from "./registry";
import * as registry from "./registry";

// ─── Stub CustomConfigPanel for "map" type ───────────────────────────────────

function StubCustomPanel({
  config,
  columns,
  onChange,
}: ConfigPanelProps) {
  return (
    <div data-testid="map-custom-panel">
      <div data-testid="cols-count">{(columns ?? []).length}</div>
      <button
        data-testid="fire-onchange"
        onClick={() =>
          onChange({
            ...config,
            spatialMode: "latlon",
            __autoSuggestActive: true,
          })
        }
      >
        fire
      </button>
    </div>
  );
}

const MAP_DEF = {
  type: "map",
  label: "Map",
  icon: "M",
  fields: [] as import("./registry").ConfigField[],
  defaultConfig: {},
  usesAggregation: false as const,
  CustomConfigPanel: StubCustomPanel,
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TABLE_A = {
  id: 42,
  name: "taxi_trips",
  schema: "public",
  columns: {
    lat: "float",
    lon: "float",
    vendor_id: "string",
  },
};

const TABLE_B = {
  id: 99,
  name: "weather",
  schema: "public",
  columns: {
    temperature: "float",
    humidity: "float",
  },
};

const TABLES = [TABLE_A, TABLE_B];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ChartConfigPanel — custom panel scaffold (Phase 11-10)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(registry, "getChartType").mockImplementation((type: string) => {
      if (type === "map") return MAP_DEF as import("./registry").ChartTypeDefinition;
      return undefined;
    });
  });

  it("renders Title + Data Source for map widget type", () => {
    render(
      <ChartConfigPanel
        widgetType="map"
        title="My Map"
        config={{}}
        tables={TABLES}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // Both scaffold labels must be present
    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText("Data Source")).toBeInTheDocument();
    // The stub CustomConfigPanel should render
    expect(screen.getByTestId("map-custom-panel")).toBeInTheDocument();
  });

  it("populates columns prop after table selection", () => {
    render(
      <ChartConfigPanel
        widgetType="map"
        title="My Map"
        config={{}}
        tables={TABLES}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // Initially 0 columns (no table selected)
    expect(screen.getByTestId("cols-count").textContent).toBe("0");

    // Select the first table (public.taxi_trips — has 3 columns: lat, lon, vendor_id)
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "public.taxi_trips" } });

    // Should now reflect table A's 3 columns
    expect(screen.getByTestId("cols-count").textContent).toBe("3");
  });

  it("persists tableRef and tableId on auto-save", () => {
    const onSave = vi.fn();

    render(
      <ChartConfigPanel
        widgetType="map"
        title="My Map"
        config={{ table: "public.taxi_trips" }}
        tables={TABLES}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );

    // Fire the stub onChange (simulates MapConfigPanel emitting a config change)
    fireEvent.click(screen.getByTestId("fire-onchange"));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          tableRef: "public.taxi_trips",
          tableId: 42,
        }),
      }),
    );
  });

  it("persists a title-only edit on blur (custom-panel branch has no Apply button)", () => {
    const onSave = vi.fn();

    render(
      <ChartConfigPanel
        widgetType="map"
        title="My Map"
        config={{ table: "public.taxi_trips" }}
        tables={TABLES}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );

    // Edit ONLY the title, then blur — without touching the custom panel at all.
    const titleInput = screen.getByDisplayValue("My Map");
    fireEvent.change(titleInput, { target: { value: "Renamed Map" } });
    fireEvent.blur(titleInput);

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Renamed Map" }),
    );
  });

  it("strips __autoSuggestActive from persisted config", () => {
    const onSave = vi.fn();

    render(
      <ChartConfigPanel
        widgetType="map"
        title="My Map"
        config={{ table: "public.taxi_trips" }}
        tables={TABLES}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );

    // fire-onchange stub sets __autoSuggestActive: true in the emitted config
    fireEvent.click(screen.getByTestId("fire-onchange"));

    expect(onSave).toHaveBeenCalled();
    const savedConfig = onSave.mock.calls[0][0].config;
    // __autoSuggestActive must NOT appear in the persisted config
    expect(savedConfig).not.toHaveProperty("__autoSuggestActive");
  });

  it("does not render Apply / Cancel buttons for custom-panel charts (auto-save flow; modal header Close is the dismiss affordance)", () => {
    render(
      <ChartConfigPanel
        widgetType="map"
        title="My Map"
        config={{}}
        tables={TABLES}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /apply/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
  });

  // When chartDef.usesDataSource is false (production map definition), the Data Source
  // section is suppressed and tableRef / tableId are NOT written to the persisted config.
  describe("when chartDef.usesDataSource is false (production map)", () => {
    // Hoist the chartDef to a stable reference — ChartConfigPanel's useEffect on `chartDef`
    // would otherwise re-fire forever if the mock returned a NEW object each call (infinite
    // setState → render loop, hangs the test runner).
    const MAP_DEF_NO_DATA_SOURCE = {
      ...MAP_DEF,
      usesDataSource: false,
    } as import("./registry").ChartTypeDefinition;

    beforeEach(() => {
      vi.clearAllMocks();
      vi.spyOn(registry, "getChartType").mockImplementation((type: string) =>
        type === "map" ? MAP_DEF_NO_DATA_SOURCE : undefined,
      );
    });

    it("does NOT render the Data Source section", () => {
      render(
        <ChartConfigPanel
          widgetType="map"
          title="My Map"
          config={{}}
          tables={TABLES}
          onSave={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      expect(screen.getByText("Title")).toBeInTheDocument();
      expect(screen.queryByText("Data Source")).not.toBeInTheDocument();
      expect(screen.getByTestId("map-custom-panel")).toBeInTheDocument();
    });

    it("omits tableRef / tableId from the persisted config on auto-save", () => {
      const onSave = vi.fn();
      render(
        <ChartConfigPanel
          widgetType="map"
          title="My Map"
          config={{ table: "public.taxi_trips" }}
          tables={TABLES}
          onSave={onSave}
          onCancel={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByTestId("fire-onchange"));

      expect(onSave).toHaveBeenCalledTimes(1);
      const persisted = onSave.mock.calls[0][0].config;
      expect(persisted).not.toHaveProperty("tableRef");
      expect(persisted).not.toHaveProperty("tableId");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 35 dynamic-view picker (DV-V16-12) — TDD RED for Task 1 impl
// ─────────────────────────────────────────────────────────────────────────────

import type { DynamicViewRow } from "../../api/client";

const DV_WITH_COLUMNS: DynamicViewRow = {
  id: 7,
  dashboard_id: 1,
  source_table_id: 42,
  name: "Top vendors",
  template_sql: "SELECT vendor_id, AVG(fare) FROM {view} GROUP BY vendor_id",
  max_records: 10000,
  columns_json: JSON.stringify([
    { name: "vendor_id", type: "TEXT" },
    { name: "avg_fare", type: "DOUBLE" },
  ]),
  created_at: "2026-05-15T00:00:00Z",
  updated_at: "2026-05-15T00:00:00Z",
};

const DV_NULL_COLUMNS: DynamicViewRow = {
  id: 8,
  dashboard_id: 1,
  source_table_id: 42,
  name: "Untested view",
  template_sql: "SELECT * FROM {view}",
  max_records: 10000,
  columns_json: null,
  created_at: "2026-05-15T00:00:00Z",
  updated_at: "2026-05-15T00:00:00Z",
};

const MOCK_DYNAMIC_VIEWS: DynamicViewRow[] = [DV_WITH_COLUMNS, DV_NULL_COLUMNS];

// A "bar" chartDef for the standard (non-custom) branch. Keep stable per
// the "stable mock object" comment above so getChartType doesn't churn.
const BAR_DEF: import("./registry").ChartTypeDefinition = {
  type: "bar",
  label: "Bar",
  icon: "|",
  fields: [],
  defaultConfig: {},
  // usesAggregation: undefined → defaults to true (standard branch)
};

// Hoisted MAP_DEF override for Test 9. MUST be a stable reference — if recreated
// per render, ChartConfigPanel's useEffect([config, chartDef]) loops forever.
const MAP_DEF_NO_DS_PHASE35 = {
  ...MAP_DEF,
  usesDataSource: false,
} as import("./registry").ChartTypeDefinition;

describe("ChartConfigPanel — Phase 35 dynamic-view picker (DV-V16-12)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(registry, "getChartType").mockImplementation((type: string) => {
      if (type === "bar") return BAR_DEF;
      if (type === "map") return MAP_DEF as import("./registry").ChartTypeDefinition;
      return undefined;
    });
  });

  it("renders Dynamic Views optgroup when dynamicViews is non-empty (standard branch)", () => {
    render(
      <ChartConfigPanel
        widgetType="bar"
        title="Bar"
        config={{}}
        tables={TABLES}
        views={[]}
        dynamicViews={MOCK_DYNAMIC_VIEWS}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    // The optgroup label "Dynamic Views" must appear inside the select.
    const optgroup = screen.getByRole("group", { name: /Dynamic Views/i });
    expect(optgroup).toBeInTheDocument();
    // Option label is the bare dv.name (no parenthetical)
    expect(screen.getByRole("option", { name: "Top vendors" })).toBeInTheDocument();
  });

  it("selecting a dynamic-view dual-writes dynamicViewId + tableId on Apply", () => {
    const onSave = vi.fn();
    render(
      <ChartConfigPanel
        widgetType="bar"
        title="Bar"
        config={{}}
        tables={TABLES}
        views={[]}
        dynamicViews={MOCK_DYNAMIC_VIEWS}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );

    // Select the dv:7 option in the Data Source <select>.
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "dv:7" } });

    // Apply
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0];
    expect(saved.config).toEqual(
      expect.objectContaining({
        dynamicViewId: 7,
        tableId: 42, // = source_table_id from DV_WITH_COLUMNS
      }),
    );
  });

  it("hides Dynamic Views optgroup when dynamicViews is empty", () => {
    render(
      <ChartConfigPanel
        widgetType="bar"
        title="Bar"
        config={{}}
        tables={TABLES}
        views={[]}
        dynamicViews={[]}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    // Tables optgroup must still render (sanity), Dynamic Views must NOT.
    expect(screen.getByRole("group", { name: /^Tables$/i })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /Dynamic Views/i })).not.toBeInTheDocument();
  });

  it("renders all three optgroups (Tables, Views, Dynamic Views) when each non-empty", () => {
    const VIEWS = [
      { id: 1, table_id: 42, view_name: "view_a", filter_clause: "", status: "created" },
    ];
    render(
      <ChartConfigPanel
        widgetType="bar"
        title="Bar"
        config={{}}
        tables={TABLES}
        views={VIEWS}
        dynamicViews={MOCK_DYNAMIC_VIEWS}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("group", { name: /^Tables$/i })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /^Views$/i })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /^Dynamic Views$/i })).toBeInTheDocument();
  });

  it("selecting a plain table after a dynamic-view clears dynamicViewId on Apply (mutual exclusion)", () => {
    const onSave = vi.fn();
    render(
      <ChartConfigPanel
        widgetType="bar"
        title="Bar"
        // Pre-select a dynamic-view via config (simulates re-opening a dv-bound widget)
        config={{ dynamicViewId: 7, tableId: 42, table: "public.taxi_trips" }}
        tables={TABLES}
        views={[]}
        dynamicViews={MOCK_DYNAMIC_VIEWS}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );

    // Data Source <select> is the first combobox (multiple exist once dv:7
    // populates the metric/aggregation/group-by selects below).
    const dataSourceSelect = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
    // Confirm dv:7 is the active value
    expect(dataSourceSelect.value).toBe("dv:7");

    // Operator switches to a plain table.
    fireEvent.change(dataSourceSelect, { target: { value: "public.weather" } });
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0];
    expect(saved.config).not.toHaveProperty("dynamicViewId");
    expect(saved.config.tableId).toBe(99); // = TABLE_B.id (weather)
  });

  it("column pickers source from columns_json when a dv with non-null columns_json is selected", () => {
    render(
      <ChartConfigPanel
        widgetType="bar"
        title="Bar"
        // Phase 102: bar uses the N-column builder; seed one row so the select is rendered.
        config={{ groupByColumns: [""] }}
        tables={TABLES}
        views={[]}
        dynamicViews={MOCK_DYNAMIC_VIEWS}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "dv:7" } });

    // Metric column picker should list NUMERIC columns from columns_json: avg_fare (DOUBLE)
    // but NOT vendor_id (TEXT) and NOT the source table's `lat`/`lon`/`vendor_id` columns.
    const metricSelect = screen.getByLabelText("Metric Column") as HTMLSelectElement;
    const metricOptions = Array.from(metricSelect.querySelectorAll("option")).map(
      (o) => o.textContent || "",
    );
    expect(metricOptions.some((t) => t.startsWith("avg_fare"))).toBe(true);
    // Source-table-only columns must NOT appear (lat is a float in TABLE_A — would
    // appear if column source had NOT flipped to columns_json).
    expect(metricOptions.some((t) => t.startsWith("lat"))).toBe(false);

    // Phase 102: bar uses the N-column builder; "Primary group (x-axis)" labels the first row.
    // Verify builder select lists ALL columns from columns_json: vendor_id + avg_fare.
    const groupBySelect = screen.getByLabelText("Primary group (x-axis)") as HTMLSelectElement;
    const groupByOptions = Array.from(groupBySelect.querySelectorAll("option")).map(
      (o) => o.textContent || "",
    );
    expect(groupByOptions.some((t) => t.startsWith("vendor_id"))).toBe(true);
    expect(groupByOptions.some((t) => t.startsWith("avg_fare"))).toBe(true);
  });

  it("when columns_json is null, column pickers are disabled AND hint surfaces", () => {
    render(
      <ChartConfigPanel
        widgetType="bar"
        title="Bar"
        config={{}}
        tables={TABLES}
        views={[]}
        dynamicViews={MOCK_DYNAMIC_VIEWS}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "dv:8" } });

    // Inline hint must appear
    expect(screen.getByText(/Run Preview in Dynamic Views to populate columns/i)).toBeInTheDocument();

    // Metric picker is disabled.
    expect(screen.getByLabelText("Metric Column")).toBeDisabled();
    // Phase 102: bar uses the N-column builder instead of the single Group By select.
    // The "+ Add column" button is disabled when dvColumnsMissing.
    expect(screen.getByRole("button", { name: /\+ Add column/i })).toBeDisabled();
  });

  it("loading a widget with existing dynamicViewId shows dv:<id> as the selected source", () => {
    render(
      <ChartConfigPanel
        widgetType="bar"
        title="Bar"
        config={{ dynamicViewId: 7, tableId: 42, table: "public.taxi_trips" }}
        tables={TABLES}
        views={[]}
        dynamicViews={MOCK_DYNAMIC_VIEWS}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    // First combobox = Data Source picker (the metric/aggregation/group-by selects
    // also render because the widget is now dv-bound with non-null columns_json).
    const dataSourceSelect = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
    expect(dataSourceSelect.value).toBe("dv:7");
  });

  it("map widget (usesDataSource: false) does NOT render Dynamic Views optgroup", () => {
    // Re-bind the existing beforeEach-installed spy with mockImplementation
    // (do NOT call vi.spyOn again — that would create a SECOND spy returning
    // a NEW object each call, triggering the useEffect([config, chartDef]) loop
    // documented at lines 200-213 of this file).
    vi.mocked(registry.getChartType).mockImplementation((type: string) => {
      if (type === "map") return MAP_DEF_NO_DS_PHASE35;
      return undefined;
    });
    render(
      <ChartConfigPanel
        widgetType="map"
        title="My Map"
        config={{}}
        tables={TABLES}
        views={[]}
        dynamicViews={MOCK_DYNAMIC_VIEWS}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    // Title scaffold renders, but Data Source is suppressed entirely
    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.queryByText("Data Source")).not.toBeInTheDocument();
    // Dynamic Views optgroup must not exist (no select at all)
    expect(screen.queryByRole("group", { name: /Dynamic Views/i })).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 42 Plan 42-01 (WIDGET-V17-03) — widgets prop threading
// ─────────────────────────────────────────────────────────────────────────────

import type { WidgetDto } from "../../api/client";

describe("Phase 42 widgets prop threading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Phase 42 Plan 42-01: forwards widgets prop to <Custom> panel slot", () => {
    const widgetsList: WidgetDto[] = [
      { id: 1, dashboard_id: 1, title: "Map A", type: "map", position: 0, config: {}, created_at: "", updated_at: "" },
      { id: 2, dashboard_id: 1, title: "Bar B", type: "bar", position: 1, config: {}, created_at: "", updated_at: "" },
    ];
    let receivedWidgets: WidgetDto[] | undefined;
    const StubCustom = (props: { widgets?: WidgetDto[] }) => {
      receivedWidgets = props.widgets;
      return <div data-testid="stub-custom" />;
    };
    // Register a temporary chart type with the stub CustomConfigPanel
    const testChartDef = {
      type: "__test-custom__",
      label: "Test",
      icon: "T",
      fields: [] as import("./registry").ConfigField[],
      defaultConfig: {},
      usesAggregation: false as const,
      supportsDrillDown: false as const,
      CustomConfigPanel: StubCustom,
    } as import("./registry").ChartTypeDefinition;

    vi.spyOn(registry, "getChartType").mockImplementation((type: string) => {
      if (type === "__test-custom__") return testChartDef;
      return undefined;
    });

    render(
      <ChartConfigPanel
        widgetType="__test-custom__"
        title="Test"
        config={{}}
        tables={[]}
        widgets={widgetsList}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(receivedWidgets).toEqual(widgetsList);
  });
});

describe("ChartConfigPanel — grouped chart sort direction + result limit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(registry, "getChartType").mockReturnValue({
      type: "pie",
      label: "Pie",
      icon: "P",
      fields: [],
      defaultConfig: {},
      usesAggregation: true,
      supportsDrillDown: true,
    } as import("./registry").ChartTypeDefinition);
  });

  const groupedConfig = (over: Record<string, unknown> = {}) => ({
    table: "public.taxi_trips",
    metricColumn: "passenger_count",
    aggregation: "SUM",
    groupByColumn: "vendor_id",
    ...over,
  });

  it("renders Sort direction + Result limit controls for grouped charts", () => {
    render(
      <ChartConfigPanel
        widgetType="pie"
        title="P"
        config={groupedConfig()}
        tables={TABLES}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Sort direction")).toBeInTheDocument();
    const limit = screen.getByLabelText("Result limit") as HTMLSelectElement;
    expect(Array.from(limit.options).map((o) => o.value)).toEqual(
      ["5", "10", "25", "50", "100", "250", "500"],
    );
  });

  it("generated SQL reflects configured sort direction + limit", () => {
    render(
      <ChartConfigPanel
        widgetType="pie"
        title="P"
        config={groupedConfig({ sortDir: "ASC", limit: 25 })}
        tables={TABLES}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/ORDER BY value ASC LIMIT 25/)).toBeInTheDocument();
  });

  it("defaults to DESC + 100 when unset; updates SQL when the limit changes", () => {
    render(
      <ChartConfigPanel
        widgetType="pie"
        title="P"
        config={groupedConfig()}
        tables={TABLES}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/ORDER BY value DESC LIMIT 100/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Result limit"), { target: { value: "500" } });
    expect(screen.getByText(/ORDER BY value DESC LIMIT 500/)).toBeInTheDocument();
  });
});

// Phase 87 (UAT): the reusable "formatSpec" ConfigField type renders the shared
// FormatSpecEditor and persists the picked spec on config[key] (bar Y-axis number format).
describe("ChartConfigPanel — formatSpec field type (bar Y-axis number format)", () => {
  const BAR_DEF_FMT: import("./registry").ChartTypeDefinition = {
    type: "bar",
    label: "Bar",
    icon: "|",
    fields: [
      { key: "yAxisFormat", label: "Value-Axis Number Format", type: "formatSpec", defaultValue: null, group: "Display" },
    ],
    defaultConfig: { yAxisFormat: null },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(registry, "getChartType").mockImplementation((type: string) =>
      type === "bar" ? BAR_DEF_FMT : undefined,
    );
  });

  it("renders the FormatSpecEditor kind picker (incl. Smart abbreviation) for a formatSpec field", () => {
    render(
      <ChartConfigPanel
        widgetType="bar"
        title="Bar"
        config={{}}
        tables={TABLES}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Format kind")).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /Smart abbreviation/i }),
    ).toBeInTheDocument();
  });

  it("persists yAxisFormat = { kind: 'si', decimals: 1 } when SI is picked, then Apply", () => {
    const onSave = vi.fn();
    render(
      <ChartConfigPanel
        widgetType="bar"
        title="Bar"
        config={{}}
        tables={TABLES}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Format kind"), { target: { value: "si" } });
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].config).toEqual(
      expect.objectContaining({ yAxisFormat: { kind: "si", decimals: 1 } }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 98 Plan 02 (VIZSQL-V119-02/03) — customWhere WHERE injection in generatedSql
// ─────────────────────────────────────────────────────────────────────────────

// Stable chart-def stubs for each SQL shape.
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

const RECORDS_DEF: import("./registry").ChartTypeDefinition = {
  type: "records",
  label: "Records Table",
  icon: "[R]",
  fields: [],
  defaultConfig: {},
  usesAggregation: false,
};

describe("Phase 98-02 — customWhere WHERE injection in generatedSql", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── grouped (bar/line/pie/scatter/table) ───────────────────────────────────

  it("grouped: non-empty customWhere injects WHERE (...) before GROUP BY in generated SQL", () => {
    vi.spyOn(registry, "getChartType").mockReturnValue(GROUPED_DEF);
    const onSave = vi.fn();
    render(
      <ChartConfigPanel
        widgetType="pie"
        title="Pie"
        config={{
          table: "sales",
          metricColumn: "amount",
          aggregation: "SUM",
          groupByColumn: "region",
          customWhere: "status = 'active'",
        }}
        tables={TABLES}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const sql: string = onSave.mock.calls[0][0].config.sql;
    expect(sql).toContain("WHERE (status = 'active')");
    // WHERE must appear before GROUP BY
    expect(sql.indexOf("WHERE")).toBeLessThan(sql.indexOf("GROUP BY"));
  });

  it("grouped: empty customWhere → byte-identical SQL (no WHERE clause)", () => {
    vi.spyOn(registry, "getChartType").mockReturnValue(GROUPED_DEF);
    const onSave = vi.fn();
    render(
      <ChartConfigPanel
        widgetType="pie"
        title="Pie"
        config={{
          table: "sales",
          metricColumn: "amount",
          aggregation: "SUM",
          groupByColumn: "region",
          customWhere: "",
        }}
        tables={TABLES}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const sql: string = onSave.mock.calls[0][0].config.sql;
    expect(sql).not.toContain("WHERE");
    expect(sql).toBe(
      "SELECT region, SUM(amount) AS value FROM sales GROUP BY region ORDER BY value DESC LIMIT 100",
    );
  });

  // ── scalar (bignumber) ─────────────────────────────────────────────────────

  it("scalar: non-empty customWhere injects WHERE (...) after FROM <table>", () => {
    vi.spyOn(registry, "getChartType").mockReturnValue(SCALAR_DEF);
    const onSave = vi.fn();
    render(
      <ChartConfigPanel
        widgetType="bignumber"
        title="BN"
        config={{
          table: "orders",
          metricColumn: "revenue",
          aggregation: "SUM",
          customWhere: "region = 'West'",
        }}
        tables={TABLES}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const sql: string = onSave.mock.calls[0][0].config.sql;
    expect(sql).toContain("WHERE (region = 'West')");
    expect(sql).toBe("SELECT SUM(revenue) AS value FROM orders WHERE (region = 'West')");
  });

  it("scalar: absent customWhere → byte-identical SQL", () => {
    vi.spyOn(registry, "getChartType").mockReturnValue(SCALAR_DEF);
    const onSave = vi.fn();
    render(
      <ChartConfigPanel
        widgetType="bignumber"
        title="BN"
        config={{
          table: "orders",
          metricColumn: "revenue",
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
    expect(sql).not.toContain("WHERE");
    expect(sql).toBe("SELECT SUM(revenue) AS value FROM orders");
  });

  // ── records-style (usesAggregation false) ─────────────────────────────────

  it("records-style: non-empty customWhere injects WHERE (...) after FROM <table>", () => {
    vi.spyOn(registry, "getChartType").mockReturnValue(RECORDS_DEF);
    const onSave = vi.fn();
    render(
      <ChartConfigPanel
        widgetType="records"
        title="R"
        config={{
          table: "events",
          customWhere: "q = 1",
        }}
        tables={TABLES}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const sql: string = onSave.mock.calls[0][0].config.sql;
    expect(sql).toContain("WHERE (q = 1)");
    // WHERE must appear before ORDER BY (if any) and before end of string
    const whereIdx = sql.indexOf("WHERE");
    const orderIdx = sql.indexOf("ORDER BY");
    if (orderIdx !== -1) {
      expect(whereIdx).toBeLessThan(orderIdx);
    }
  });

  it("records-style: absent customWhere → byte-identical SQL", () => {
    vi.spyOn(registry, "getChartType").mockReturnValue(RECORDS_DEF);
    const onSave = vi.fn();
    render(
      <ChartConfigPanel
        widgetType="records"
        title="R"
        config={{
          table: "events",
        }}
        tables={TABLES}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const sql: string = onSave.mock.calls[0][0].config.sql;
    expect(sql).not.toContain("WHERE");
    expect(sql).toBe("SELECT * FROM events");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 102 Plan 02 (BARGRP-V119-01/04) — multi-column generatedSql branch
// ─────────────────────────────────────────────────────────────────────────────

// BAR_DEF_GROUPED is a stable bar chart definition with usesAggregation+requiresGroupBy
// for testing the generatedSql multi-column branch and backward-compat single-column path.
const BAR_DEF_GROUPED: import("./registry").ChartTypeDefinition = {
  type: "bar",
  label: "Bar",
  icon: "|",
  fields: [],
  defaultConfig: {},
  usesAggregation: true,
  requiresGroupBy: true,
  supportsDrillDown: true,
};

describe("Phase 102-02 — multi-column generatedSql + backward-compat (BARGRP-V119-01/04)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(registry, "getChartType").mockReturnValue(BAR_DEF_GROUPED);
  });

  // ── Test 1 (BARGRP-V119-04): 1-column → byte-identical to current single-column SQL ──
  it("Test 1 (BARGRP-V119-04): 1-column groupByColumns → byte-identical single-column SQL", () => {
    const onSave = vi.fn();
    render(
      <ChartConfigPanel
        widgetType="bar"
        title="Bar"
        config={{
          table: "sales",
          metricColumn: "amount",
          aggregation: "SUM",
          groupByColumn: "region",
          groupByColumns: ["region"],
        }}
        tables={TABLES}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const sql: string = onSave.mock.calls[0][0].config.sql;
    // MUST be byte-identical to the legacy single-column SQL (BARGRP-V119-04).
    expect(sql).toBe(
      "SELECT region, SUM(amount) AS value FROM sales GROUP BY region ORDER BY value DESC LIMIT 100",
    );
  });

  // ── Test 2 (BARGRP-V119-01): 2-column → multi-column SELECT/GROUP BY + generous LIMIT ──
  it("Test 2 (BARGRP-V119-01): 2-column groupByColumns → multi-column SQL with generous LIMIT", () => {
    const onSave = vi.fn();
    render(
      <ChartConfigPanel
        widgetType="bar"
        title="Bar"
        config={{
          table: "sales",
          metricColumn: "amount",
          aggregation: "SUM",
          groupByColumn: "region",
          groupByColumns: ["region", "category"],
          limit: 100,
        }}
        tables={TABLES}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const sql: string = onSave.mock.calls[0][0].config.sql;
    // SELECT must list all group-by columns + the aggregate.
    expect(sql).toContain("SELECT region, category, SUM(amount) AS value");
    // GROUP BY must list both columns.
    expect(sql).toContain("GROUP BY region, category");
    // Default sort direction is DESC.
    expect(sql).toContain("ORDER BY value DESC");
    // Generous LIMIT = config.limit × maxBarGroupBySeriesCap × 2 = 100 × 12 × 2 = 2400.
    expect(sql).toContain("LIMIT 2400");
    // No spurious WHERE clause when customWhere is absent.
    expect(sql).not.toContain("WHERE");
  });

  // ── Test 3: 3-column + customWhere → WHERE appears before GROUP BY ──
  it("Test 3: 3-column + customWhere → WHERE (predicate) before GROUP BY", () => {
    const onSave = vi.fn();
    render(
      <ChartConfigPanel
        widgetType="bar"
        title="Bar"
        config={{
          table: "sales",
          metricColumn: "amount",
          aggregation: "SUM",
          groupByColumn: "region",
          groupByColumns: ["region", "category", "quarter"],
          customWhere: "status = 'active'",
          limit: 100,
        }}
        tables={TABLES}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const sql: string = onSave.mock.calls[0][0].config.sql;
    // GROUP BY must list all three columns.
    expect(sql).toContain("GROUP BY region, category, quarter");
    // WHERE clause injected.
    expect(sql).toContain("WHERE (status = 'active')");
    // WHERE must appear before GROUP BY (mirrors Phase 98 customWhere pattern).
    expect(sql.indexOf("WHERE")).toBeLessThan(sql.indexOf("GROUP BY"));
  });

  // ── Test 4: sortDir honored in multi-column branch ──
  it("Test 4: sortDir ASC honored in multi-column branch", () => {
    const onSave = vi.fn();
    render(
      <ChartConfigPanel
        widgetType="bar"
        title="Bar"
        config={{
          table: "sales",
          metricColumn: "amount",
          aggregation: "SUM",
          groupByColumn: "region",
          groupByColumns: ["region", "category"],
          sortDir: "ASC",
          limit: 100,
        }}
        tables={TABLES}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const sql: string = onSave.mock.calls[0][0].config.sql;
    expect(sql).toContain("ORDER BY value ASC");
  });

  // ── Test 5: 0-column (no groupByColumns) → falls through to legacy path ──
  it("Test 5 (BARGRP-V119-04): no groupByColumns → falls through to single-column legacy path", () => {
    const onSave = vi.fn();
    render(
      <ChartConfigPanel
        widgetType="bar"
        title="Bar"
        config={{
          table: "sales",
          metricColumn: "amount",
          aggregation: "SUM",
          groupByColumn: "region",
          // groupByColumns absent — should behave identically to single-column path
        }}
        tables={TABLES}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const sql: string = onSave.mock.calls[0][0].config.sql;
    // No multi-column GROUP BY — falls through to single-column legacy SQL.
    expect(sql).toBe(
      "SELECT region, SUM(amount) AS value FROM sales GROUP BY region ORDER BY value DESC LIMIT 100",
    );
  });
});
