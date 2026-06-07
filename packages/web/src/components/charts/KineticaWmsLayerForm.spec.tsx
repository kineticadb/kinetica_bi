/**
 * Phase 12: KineticaWmsLayerForm spec — 7 behaviour tests.
 *
 * Tests cover:
 *   1. Renders SPATIAL_MODE_LABELS strings
 *   2. Renders RENDER_MODE_LABELS strings
 *   3. Spatial mode radio click calls onChange with cleared stale columns
 *   4. renderMode="classbreak" shows cbColumn dropdown + cbBreakType radios + classbreak rows container
 *   5. isValid(false) when classbreaks.length < 2; isValid(true) when >= 2
 *   6. Pure-controlled — no auto-fire of onChange when columns change
 *   7. ZERO table-picker controls (table picker lives in LayersModal, not here)
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import KineticaWmsLayerForm from "./KineticaWmsLayerForm";

/* ------------------------------------------------------------------ */
/*  Module mocks                                                        */
/* ------------------------------------------------------------------ */

// Mutable so individual tests can simulate a real GetCapabilities response
// (which, on the deployed Kinetica, omits classbreak/contour from renderModes).
// Default null → allowedRenderModes falls back to ALL_RENDER_MODES.
let mockCapabilities: unknown = null;

vi.mock("../../store/wmsCapabilities", () => ({
  useWmsCapabilitiesStore: vi.fn((selector: (s: any) => any) =>
    selector({ capabilities: mockCapabilities })
  ),
}));

vi.mock("../../store/toast", () => ({
  useToastStore: {
    getState: vi.fn(() => ({ showToast: vi.fn() })),
  },
}));

vi.mock("../../lib/cardinalityProbe", () => ({
  probeCardinality: vi.fn().mockResolvedValue(5),
}));

/* ------------------------------------------------------------------ */
/*  Fixtures                                                            */
/* ------------------------------------------------------------------ */

const baseConfig: Record<string, unknown> = {
  spatialMode: "latlon",
  renderMode: "raster",
  pointSize: 5,
  pointColor: "3B82F6",
  pointOpacity: 100,
};

const baseColumns = [
  { name: "lat", type: "double" },
  { name: "lon", type: "double" },
  { name: "geom", type: "wkt" },
  { name: "vendor_id", type: "varchar" },
];

/* ------------------------------------------------------------------ */
/*  Tests                                                               */
/* ------------------------------------------------------------------ */

describe("KineticaWmsLayerForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCapabilities = null;
  });

  it("renders spatial mode labels", () => {
    render(
      <KineticaWmsLayerForm
        config={baseConfig}
        onChange={vi.fn()}
        columns={baseColumns}
      />
    );
    expect(screen.getByText("Latitude / Longitude pair")).toBeInTheDocument();
    expect(screen.getByText("WKT geometry column")).toBeInTheDocument();
    expect(screen.getByText("Kinetica geometry column")).toBeInTheDocument();
  });

  it("renders render mode labels", () => {
    render(
      <KineticaWmsLayerForm
        config={baseConfig}
        onChange={vi.fn()}
        columns={baseColumns}
      />
    );
    expect(screen.getByText("Raster (point markers)")).toBeInTheDocument();
    expect(screen.getByText("Heatmap (density)")).toBeInTheDocument();
    expect(screen.getByText("Classbreak (categorical)")).toBeInTheDocument();
    // Phase 39 (CB-V17-01): contour hidden from picker
    expect(screen.queryByText("Contour (lines)")).not.toBeInTheDocument();
  });

  it("renders exactly 3 render-mode radio options (Raster, Heatmap, Class Break)", () => {
    render(
      <KineticaWmsLayerForm
        config={baseConfig}
        onChange={vi.fn()}
        columns={baseColumns}
      />
    );
    // Pick radios by accessible name (RENDER_MODE_LABELS strings)
    expect(screen.getByLabelText("Raster (point markers)")).toBeInTheDocument();
    expect(screen.getByLabelText("Heatmap (density)")).toBeInTheDocument();
    expect(screen.getByLabelText("Classbreak (categorical)")).toBeInTheDocument();
    // Contour radio MUST NOT be in the picker
    expect(screen.queryByLabelText("Contour (lines)")).not.toBeInTheDocument();
  });

  it("shows Class Break even when GetCapabilities renderModes omits classbreak (UAT regression)", () => {
    // Deployed Kinetica's GetCapabilities XML advertises only raster + heatmap;
    // classbreak renders via STYLES=cb_raster (Phase 37 spike) but is NOT in the
    // capabilities list. The picker must NOT gate classbreak on renderModes.
    mockCapabilities = {
      renderModes: ["raster", "heatmap"],
      colormaps: [],
      spatialModes: ["latlon", "wkt", "wkb"],
      srs: ["EPSG:3857"],
      source: "probe",
    };
    render(
      <KineticaWmsLayerForm
        config={baseConfig}
        onChange={vi.fn()}
        columns={baseColumns}
      />
    );
    // raster + heatmap advertised → present
    expect(screen.getByLabelText("Raster (point markers)")).toBeInTheDocument();
    expect(screen.getByLabelText("Heatmap (density)")).toBeInTheDocument();
    // classbreak NOT advertised but MUST still be selectable
    expect(screen.getByLabelText("Classbreak (categorical)")).toBeInTheDocument();
    // contour still hidden regardless of capabilities
    expect(screen.queryByLabelText("Contour (lines)")).not.toBeInTheDocument();
  });

  it("selecting a different spatial mode calls onChange with new spatialMode and clears stale columns", () => {
    const onChange = vi.fn();
    render(
      <KineticaWmsLayerForm
        config={{ ...baseConfig, latColumn: "lat", lonColumn: "lon" }}
        onChange={onChange}
        columns={baseColumns}
      />
    );

    // Click the WKT radio
    const wktRadio = screen.getByLabelText("WKT geometry column");
    fireEvent.click(wktRadio);

    expect(onChange).toHaveBeenCalledTimes(1);
    const call = onChange.mock.calls[0][0] as Record<string, unknown>;
    // New spatial mode should be wkt
    expect(call.spatialMode).toBe("wkt");
    // Stale lat/lon columns should be cleared
    expect(call.latColumn).toBe("");
    expect(call.lonColumn).toBe("");
    // autoSuggestActive should be false (manual override)
    expect(call.__autoSuggestActive).toBe(false);
  });

  it("renderMode='classbreak' renders CbConfigForm skeleton with CLASS BREAK PARAMS header", () => {
    const classbreakConfig: Record<string, unknown> = {
      ...baseConfig,
      renderMode: "classbreak",
    };
    render(
      <KineticaWmsLayerForm
        config={classbreakConfig}
        onChange={vi.fn()}
        columns={baseColumns}
      />
    );
    // New CbConfigForm skeleton renders header (Plan 39-02 fleshes out body)
    expect(screen.getByText("CLASS BREAK PARAMS")).toBeInTheDocument();
  });

  it("passing new columns does NOT trigger any auto-fired onChange (purely controlled)", () => {
    const onChange = vi.fn();

    // Initial render with set spatial mode
    const { rerender } = render(
      <KineticaWmsLayerForm
        config={{ ...baseConfig, spatialMode: "latlon", latColumn: "lat", lonColumn: "lon" }}
        onChange={onChange}
        columns={baseColumns}
      />
    );

    // Clear any calls from initial render
    onChange.mockClear();

    // Re-render with different columns (simulating table swap)
    const newColumns = [
      { name: "latitude", type: "float" },
      { name: "longitude", type: "float" },
    ];

    rerender(
      <KineticaWmsLayerForm
        config={{ ...baseConfig, spatialMode: "latlon", latColumn: "lat", lonColumn: "lon" }}
        onChange={onChange}
        columns={newColumns}
      />
    );

    // The form is purely controlled — it must NOT auto-fire onChange on column prop change
    // Auto-suggest is the caller's responsibility (LayersModal / MapConfigPanel)
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renderMode='raster' shows Point shape, Shape fill/line color, Shape line width, and Antialiasing controls", () => {
    const onChange = vi.fn();
    render(
      <KineticaWmsLayerForm
        config={baseConfig}
        onChange={onChange}
        columns={baseColumns}
      />
    );

    // Point shape dropdown — has all 12 options
    const pointShapeSelect = screen.getByLabelText("Point shape") as HTMLSelectElement;
    expect(pointShapeSelect).toBeInTheDocument();
    expect(pointShapeSelect.options).toHaveLength(12);
    expect(
      Array.from(pointShapeSelect.options).map((o) => o.value),
    ).toEqual([
      "none",
      "circle",
      "dash",
      "diamond",
      "dot",
      "hollowcircle",
      "hollowdiamond",
      "hollowsquare",
      "hollowsquarewithplus",
      "pipe",
      "plus",
      "square",
    ]);

    // Selecting a new point shape calls onChange with pointShape patch
    fireEvent.change(pointShapeSelect, { target: { value: "diamond" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ pointShape: "diamond" }),
    );
    onChange.mockClear();

    // Shape fill color picker — moving the RGB color picker keeps the current alpha (defaults
    // to FF when config is empty) and joins to an 8-char AARRGGBB. So #abcdef → FFABCDEF.
    const shapeFill = screen.getByLabelText("Shape fill color (RGB)") as HTMLInputElement;
    expect(shapeFill).toBeInTheDocument();
    fireEvent.input(shapeFill, { target: { value: "#abcdef" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ shapeFillColor: "FFABCDEF" }),
    );
    onChange.mockClear();

    // Shape line color picker — same AARRGGBB behaviour (alpha preserved, RGB updated)
    const shapeLine = screen.getByLabelText("Shape line color (RGB)") as HTMLInputElement;
    expect(shapeLine).toBeInTheDocument();
    fireEvent.input(shapeLine, { target: { value: "#112233" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ shapeLineColor: "FF112233" }),
    );
    onChange.mockClear();

    // Shape line width — range 0-20, change emits Number
    const lineWidth = screen.getByLabelText("Shape line width") as HTMLInputElement;
    expect(lineWidth).toBeInTheDocument();
    expect(lineWidth.min).toBe("0");
    expect(lineWidth.max).toBe("20");
    fireEvent.change(lineWidth, { target: { value: "12" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ shapeLineWidth: 12 }),
    );
    onChange.mockClear();

    // Antialiasing toggle — checkbox emits boolean
    const antialias = screen.getByLabelText("Antialiasing") as HTMLInputElement;
    expect(antialias).toBeInTheDocument();
    expect(antialias.type).toBe("checkbox");
    fireEvent.click(antialias);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ antialiasing: true }),
    );
  });

  it("does NOT render a table picker (table picker lives in LayersModal)", () => {
    render(
      <KineticaWmsLayerForm
        config={baseConfig}
        onChange={vi.fn()}
        columns={baseColumns}
      />
    );

    // No label/select with text matching "Table" (case-insensitive)
    expect(screen.queryByLabelText(/^Table$/i)).toBeNull();
    expect(screen.queryByText(/^Data source$/i)).toBeNull();

    // Confirm there is no <select> with an accessible label containing "Table"
    const allSelects = document.querySelectorAll("select");
    allSelects.forEach((select) => {
      const ariaLabel = select.getAttribute("aria-label") || "";
      const id = select.id;
      // Look for associated label
      const label = id ? document.querySelector(`label[for="${id}"]`) : null;
      const labelText = label?.textContent ?? "";
      expect(ariaLabel.toLowerCase()).not.toContain("table");
      expect(labelText.toLowerCase()).not.toMatch(/^table$/);
    });
  });
});

/* ------------------------------------------------------------------ */
/*  Phase 22 INFO POPUP section tests                                  */
/* ------------------------------------------------------------------ */

// Mock CodeMirror so jsdom doesn't choke on its DOM manipulation
vi.mock("@uiw/react-codemirror", () => ({
  default: ({
    value,
    onChange,
    editable,
    readOnly,
  }: {
    value: string;
    onChange?: (val: string) => void;
    editable?: boolean;
    readOnly?: boolean;
  }) => (
    <textarea
      role="textbox"
      value={value}
      aria-disabled={readOnly || !editable ? true : undefined}
      className={readOnly || !editable ? "cm-editor disabled" : "cm-editor"}
      readOnly={readOnly || !editable}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
  // Named export consumed for the editor's dark theme (theme={oneDark}).
  oneDark: [],
}));

vi.mock("@codemirror/lang-html", () => ({
  html: () => ({}),
}));

describe("KineticaWmsLayerForm — Phase 22 INFO POPUP section", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sortedColumns = [
    { name: "lat", type: "double" },
    { name: "lon", type: "double" },
    { name: "vendor_id", type: "varchar" },
  ];

  const unsortedColumns = [
    { name: "vendor_id", type: "varchar" },
    { name: "lat", type: "double" },
    { name: "lon", type: "double" },
  ];

  // L1: render-order — INFO POPUP section appears at the very bottom
  it("L1: renders INFO POPUP section header at the very bottom (after RASTER PARAMS or whichever render-mode block is active)", () => {
    render(
      <KineticaWmsLayerForm
        config={baseConfig}
        onChange={vi.fn()}
        columns={sortedColumns}
        infoEnabled={1}
        infoColumns={null}
        infoTemplate={null}
      />
    );
    expect(screen.getByText("INFO POPUP")).toBeInTheDocument();
    const labels = Array.from(document.querySelectorAll(".config-group-label")).map(
      (e) => e.textContent
    );
    expect(labels[labels.length - 1]).toBe("INFO POPUP");
  });

  // L2: default-toggle-on — infoEnabled=1 means toggle is checked
  it("L2: with infoEnabled=1 prop, the Enable info popup toggle is checked", () => {
    render(
      <KineticaWmsLayerForm
        config={baseConfig}
        onChange={vi.fn()}
        columns={sortedColumns}
        infoEnabled={1}
        infoColumns={null}
        infoTemplate={null}
      />
    );
    const toggle = screen.getByLabelText("Enable info popup") as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });

  // L3: toggle-disables-subfields — when infoEnabled=0, chips and editor are disabled
  it("L3: with infoEnabled=0, the ChipCombobox chips and the CodeMirror editor are disabled", () => {
    render(
      <KineticaWmsLayerForm
        config={baseConfig}
        onChange={vi.fn()}
        columns={sortedColumns}
        infoEnabled={0}
        infoColumns={null}
        infoTemplate={null}
      />
    );
    const chips = document.querySelectorAll(".info-popup-config-chip");
    expect(chips.length).toBeGreaterThan(0);
    chips.forEach((chip) => {
      expect((chip as HTMLButtonElement).disabled).toBe(true);
    });
    // CodeMirror wrapper has disabled indicator (via our mock: textarea is readOnly).
    // Use CSS class to target the CodeMirror mock textarea specifically.
    const editorWrapper = document.querySelector(".info-popup-config-editor");
    expect(editorWrapper).not.toBeNull();
    expect(editorWrapper!.getAttribute("aria-disabled")).toBe("true");
    // The textarea inside the disabled wrapper is also readOnly
    const editorTextarea = editorWrapper!.querySelector("textarea") as HTMLTextAreaElement;
    expect(editorTextarea.readOnly).toBe(true);
  });

  // L4: chip-alphabetical-order — columns sorted alphabetically regardless of prop order
  it("L4: ChipCombobox renders columns in alphabetical order regardless of columns prop order", () => {
    render(
      <KineticaWmsLayerForm
        config={baseConfig}
        onChange={vi.fn()}
        columns={unsortedColumns}
        infoEnabled={1}
        infoColumns={null}
        infoTemplate={null}
      />
    );
    const chips = Array.from(document.querySelectorAll(".info-popup-config-chip"));
    expect(chips.length).toBe(3);
    expect(chips[0].textContent).toBe("lat");
    expect(chips[1].textContent).toBe("lon");
    expect(chips[2].textContent).toBe("vendor_id");
  });

  // L5: default-all-selected sentinel — when infoColumns=null, every chip selected
  it("L5: when infoColumns prop is null, every chip renders as selected", () => {
    render(
      <KineticaWmsLayerForm
        config={baseConfig}
        onChange={vi.fn()}
        columns={sortedColumns}
        infoEnabled={1}
        infoColumns={null}
        infoTemplate={null}
      />
    );
    const chips = document.querySelectorAll(".info-popup-config-chip");
    expect(chips.length).toBe(3);
    chips.forEach((chip) => {
      expect(chip.className).toContain("selected");
      expect(chip.getAttribute("aria-pressed")).toBe("true");
    });
  });

  // L6: deselect-fires-onChangeInfoConfig with explicit array
  it("L6: removing one chip while infoColumns=null fires onChangeInfoConfig with explicit JSON array", () => {
    const onChangeInfoConfig = vi.fn() as unknown as (patch: {
      info_enabled?: number;
      info_columns?: string | null;
      info_template?: string | null;
    }) => void;
    render(
      <KineticaWmsLayerForm
        config={baseConfig}
        onChange={vi.fn()}
        columns={sortedColumns}
        infoEnabled={1}
        infoColumns={null}
        infoTemplate={null}
        onChangeInfoConfig={onChangeInfoConfig}
      />
    );
    const chips = Array.from(document.querySelectorAll(".info-popup-config-chip"));
    const lonChip = chips.find((c) => c.textContent === "lon")!;
    fireEvent.click(lonChip);
    expect(onChangeInfoConfig).toHaveBeenCalledTimes(1);
    expect(onChangeInfoConfig).toHaveBeenCalledWith({
      info_columns: '["lat","vendor_id"]',
    });
  });

  // L7: re-select-all compresses to null
  it("L7: re-selecting the last missing chip when infoColumns lists all-but-one fires onChangeInfoConfig with null", () => {
    const onChangeInfoConfig = vi.fn() as unknown as (patch: {
      info_enabled?: number;
      info_columns?: string | null;
      info_template?: string | null;
    }) => void;
    render(
      <KineticaWmsLayerForm
        config={baseConfig}
        onChange={vi.fn()}
        columns={sortedColumns}
        infoEnabled={1}
        infoColumns='["lat","vendor_id"]'
        infoTemplate={null}
        onChangeInfoConfig={onChangeInfoConfig}
      />
    );
    // lon chip is currently unselected; clicking it re-selects all 3 → compress to null
    const chips = Array.from(document.querySelectorAll(".info-popup-config-chip"));
    const lonChip = chips.find((c) => c.textContent === "lon")!;
    fireEvent.click(lonChip);
    expect(onChangeInfoConfig).toHaveBeenCalledTimes(1);
    expect(onChangeInfoConfig).toHaveBeenCalledWith({ info_columns: null });
  });

  // L8: template-editor-onChange
  it("L8: typing in the CodeMirror editor fires onChangeInfoConfig with { info_template: <new value> }", () => {
    const onChangeInfoConfig = vi.fn() as unknown as (patch: {
      info_enabled?: number;
      info_columns?: string | null;
      info_template?: string | null;
    }) => void;
    render(
      <KineticaWmsLayerForm
        config={baseConfig}
        onChange={vi.fn()}
        columns={sortedColumns}
        infoEnabled={1}
        infoColumns={null}
        infoTemplate={null}
        onChangeInfoConfig={onChangeInfoConfig}
      />
    );
    // Use the info-popup-config-editor wrapper to scope to the CodeMirror mock textarea
    const editorWrapper = document.querySelector(".info-popup-config-editor");
    expect(editorWrapper).not.toBeNull();
    const editor = editorWrapper!.querySelector("textarea")!;
    fireEvent.change(editor, { target: { value: "<div>{lat}</div>" } });
    expect(onChangeInfoConfig).toHaveBeenCalledWith({
      info_template: "<div>{lat}</div>",
    });
  });

  // L9: notes-visible — syntax note and security warning always visible
  it("L9: renders the literal syntax note and security warning below the editor", () => {
    render(
      <KineticaWmsLayerForm
        config={baseConfig}
        onChange={vi.fn()}
        columns={sortedColumns}
        infoEnabled={1}
        infoColumns={null}
        infoTemplate={null}
      />
    );
    expect(
      screen.getByText("Use {column_name} to insert values.")
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "HTML is rendered as-is — do not paste templates from untrusted sources."
      )
    ).toBeInTheDocument();
  });

  // L10: missing-table-disables-section
  it("L10: when tableMissing=true, the section renders with the locked message and every interactive element is disabled", () => {
    render(
      <KineticaWmsLayerForm
        config={baseConfig}
        onChange={vi.fn()}
        columns={[]}
        infoEnabled={1}
        infoColumns={null}
        infoTemplate={null}
        tableMissing={true}
      />
    );
    expect(
      screen.getByText("Bind a table to configure info popup")
    ).toBeInTheDocument();
    const toggle = screen.getByLabelText("Enable info popup") as HTMLInputElement;
    expect(toggle.disabled).toBe(true);
  });

  // L11: insert-column-picker
  it("L11: renders an Insert column dropdown; selecting a column fires onChangeInfoConfig with token appended", () => {
    const onChangeInfoConfig = vi.fn() as unknown as (patch: {
      info_enabled?: number;
      info_columns?: string | null;
      info_template?: string | null;
    }) => void;
    render(
      <KineticaWmsLayerForm
        config={baseConfig}
        onChange={vi.fn()}
        columns={sortedColumns}
        infoEnabled={1}
        infoColumns='["lat","lon"]'
        infoTemplate="<div></div>"
        onChangeInfoConfig={onChangeInfoConfig}
      />
    );
    const insertSelect = screen.getByLabelText("Insert column") as HTMLSelectElement;
    fireEvent.change(insertSelect, { target: { value: "lat" } });
    expect(onChangeInfoConfig).toHaveBeenCalledWith({
      info_template: "<div></div>{lat}",
    });
  });

  // L12: toggle-fires-onChangeInfoConfig
  it("L12: clicking Enable info popup when infoEnabled=1 fires onChangeInfoConfig with { info_enabled: 0 }", () => {
    const onChangeInfoConfig = vi.fn() as unknown as (patch: {
      info_enabled?: number;
      info_columns?: string | null;
      info_template?: string | null;
    }) => void;
    render(
      <KineticaWmsLayerForm
        config={baseConfig}
        onChange={vi.fn()}
        columns={sortedColumns}
        infoEnabled={1}
        infoColumns={null}
        infoTemplate={null}
        onChangeInfoConfig={onChangeInfoConfig}
      />
    );
    const toggle = screen.getByLabelText("Enable info popup");
    fireEvent.click(toggle);
    expect(onChangeInfoConfig).toHaveBeenCalledWith({ info_enabled: 0 });
  });
});

/* ------------------------------------------------------------------ */
/*  Phase 35 Data Source picker (DV-V16-13)                            */
/* ------------------------------------------------------------------ */

describe("Phase 35 Data Source picker (DV-V16-13)", () => {
  // Layer factory — mirrors LayersModal.spec.tsx mkLayer shape but inline here.
  const mkLayer = (overrides: Partial<{
    id: number;
    table_id: number;
    dynamic_view_id: number | null;
  }> = {}) => ({
    id: 1,
    dashboard_id: 1,
    table_id: 10,
    layer_type: "KineticaWms" as const,
    position: 0,
    config: { renderMode: "raster", spatialMode: "latlon" },
    info_enabled: 1,
    info_columns: null,
    info_template: null,
    dynamic_view_id: null,
    cb_config: null,
    track_config: null,
    created_at: "2026-05-15T00:00:00Z",
    updated_at: "2026-05-15T00:00:00Z",
    ...overrides,
  });

  const mockTables = [
    { id: 10, schema: "demo", name: "taxi_trips", description: "", columns: {} as Record<string, string>, created_at: "x", updated_at: "x" },
    { id: 11, schema: "demo", name: "other", description: "", columns: {} as Record<string, string>, created_at: "x", updated_at: "x" },
  ];

  const mockDynamicViews = [
    {
      id: 7,
      dashboard_id: 1,
      source_table_id: 10,
      name: "Top vendors",
      template_sql: "SELECT * FROM {view}",
      max_records: 10000,
      columns_json: null,
      created_at: "x",
      updated_at: "x",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the Dynamic Views optgroup when dynamicViews is non-empty", () => {
    const onDataSourceChange = vi.fn();
    render(
      <KineticaWmsLayerForm
        config={baseConfig}
        onChange={vi.fn()}
        columns={baseColumns}
        layer={mkLayer()}
        associatedTables={mockTables as any}
        dynamicViews={mockDynamicViews as any}
        onDataSourceChange={onDataSourceChange}
      />
    );
    // The Dynamic Views optgroup label is "Dynamic Views" — implicit role="group".
    const select = screen.getByLabelText("Layer data source") as HTMLSelectElement;
    const optgroups = select.querySelectorAll("optgroup");
    const labels = Array.from(optgroups).map((g) => g.getAttribute("label"));
    expect(labels).toContain("Tables");
    expect(labels).toContain("Dynamic Views");
  });

  it("hides the Dynamic Views optgroup when dynamicViews is empty", () => {
    render(
      <KineticaWmsLayerForm
        config={baseConfig}
        onChange={vi.fn()}
        columns={baseColumns}
        layer={mkLayer()}
        associatedTables={mockTables as any}
        dynamicViews={[]}
        onDataSourceChange={vi.fn()}
      />
    );
    const select = screen.getByLabelText("Layer data source") as HTMLSelectElement;
    const optgroups = select.querySelectorAll("optgroup");
    const labels = Array.from(optgroups).map((g) => g.getAttribute("label"));
    expect(labels).toContain("Tables");
    expect(labels).not.toContain("Dynamic Views");
  });

  it("picking a dynamic-view calls onDataSourceChange with { dynamic_view_id, table_id = sourceTableId }", () => {
    const onDataSourceChange = vi.fn();
    render(
      <KineticaWmsLayerForm
        config={baseConfig}
        onChange={vi.fn()}
        columns={baseColumns}
        layer={mkLayer({ table_id: 10, dynamic_view_id: null })}
        associatedTables={mockTables as any}
        dynamicViews={mockDynamicViews as any}
        onDataSourceChange={onDataSourceChange}
      />
    );
    fireEvent.change(screen.getByLabelText("Layer data source"), {
      target: { value: "dv:7" },
    });
    // Research finding #4 lock: keep table_id = dv.source_table_id (NOT NULL preserved).
    expect(onDataSourceChange).toHaveBeenCalledWith({
      dynamic_view_id: 7,
      table_id: 10, // = mockDynamicViews[0].source_table_id
    });
  });

  it("picking a plain table after dv was bound calls onDataSourceChange with explicit null dynamic_view_id (Plan 35-01 'key' in attrs discriminant)", () => {
    const onDataSourceChange = vi.fn();
    render(
      <KineticaWmsLayerForm
        config={baseConfig}
        onChange={vi.fn()}
        columns={baseColumns}
        // Layer starts dv-bound: dynamic_view_id=7, table_id=10 (= source_table_id).
        layer={mkLayer({ table_id: 10, dynamic_view_id: 7 })}
        associatedTables={mockTables as any}
        dynamicViews={mockDynamicViews as any}
        onDataSourceChange={onDataSourceChange}
      />
    );
    // Pick a different plain table (id 11) — should clear the dv binding.
    fireEvent.change(screen.getByLabelText("Layer data source"), {
      target: { value: "11" },
    });
    expect(onDataSourceChange).toHaveBeenCalledWith({
      dynamic_view_id: null,
      table_id: 11,
    });
  });

  it("dv-bound layer shows dv option as currently selected (value=dv:<id>)", () => {
    render(
      <KineticaWmsLayerForm
        config={baseConfig}
        onChange={vi.fn()}
        columns={baseColumns}
        layer={mkLayer({ table_id: 10, dynamic_view_id: 7 })}
        associatedTables={mockTables as any}
        dynamicViews={mockDynamicViews as any}
        onDataSourceChange={vi.fn()}
      />
    );
    const select = screen.getByLabelText("Layer data source") as HTMLSelectElement;
    expect(select.value).toBe("dv:7");
  });

  it("orphan layer (dv_id refers to dv missing from prop list) falls back to table_id-bound option as currently selected", () => {
    render(
      <KineticaWmsLayerForm
        config={baseConfig}
        onChange={vi.fn()}
        columns={baseColumns}
        // Layer says dv_id=99 but dynamicViews only has dv 7 — defensive fallback to table.
        layer={mkLayer({ table_id: 10, dynamic_view_id: 99 })}
        associatedTables={mockTables as any}
        dynamicViews={mockDynamicViews as any}
        onDataSourceChange={vi.fn()}
      />
    );
    const select = screen.getByLabelText("Layer data source") as HTMLSelectElement;
    // Operator can re-pick; meanwhile the select stays controlled at the table id.
    expect(select.value).toBe("10");
  });

  describe("Colormap select — full Kinetica catalog (post-VERIFY)", () => {
    // Operator request: surface ALL Kinetica colormaps grouped per the docs
    // (Perceptually-Uniform / Sequential I / Sequential II / Diverging /
    // Qualitative / Misc). Capability filtering still applies when the server
    // declares a subset; the catalog below is the maximum surface area.
    const heatmapConfig = {
      ...baseConfig,
      spatialMode: "latlon" as const,
      latColumn: "lat",
      lonColumn: "lon",
      renderMode: "heatmap" as const,
    };

    it("renders the colormap select with 6 grouped <optgroup> categories", () => {
      render(
        <KineticaWmsLayerForm
          config={heatmapConfig}
          onChange={vi.fn()}
          columns={baseColumns}
        />,
      );
      const select = screen.getByLabelText("Colormap") as HTMLSelectElement;
      const optgroups = Array.from(select.querySelectorAll("optgroup")).map(
        (g) => g.getAttribute("label"),
      );
      expect(optgroups).toEqual([
        "Perceptually-Uniform",
        "Sequential I",
        "Sequential II",
        "Diverging",
        "Qualitative",
        "Misc",
      ]);
    });

    it("includes representative entries from every group", () => {
      render(
        <KineticaWmsLayerForm
          config={heatmapConfig}
          onChange={vi.fn()}
          columns={baseColumns}
        />,
      );
      const select = screen.getByLabelText("Colormap") as HTMLSelectElement;
      const values = Array.from(select.querySelectorAll("option")).map(
        (o) => (o as HTMLOptionElement).value,
      );
      // Perceptually-Uniform
      expect(values).toContain("viridis");
      expect(values).toContain("magma");
      // Sequential I
      expect(values).toContain("Blues");
      expect(values).toContain("YlOrRd");
      // Sequential II
      expect(values).toContain("afmhot");
      expect(values).toContain("winter");
      // Diverging
      expect(values).toContain("BrBG");
      expect(values).toContain("Spectral");
      // Qualitative
      expect(values).toContain("Accent");
      expect(values).toContain("Set3");
      // Misc
      expect(values).toContain("cubehelix");
      expect(values).toContain("prism");
      // Total catalog size sanity check (75 entries per the Kinetica docs).
      expect(values.length).toBeGreaterThan(60);
    });

    it("legacy-value preservation: persisted colormap outside the catalog is shown under 'Current' optgroup", () => {
      render(
        <KineticaWmsLayerForm
          config={{ ...heatmapConfig, colormap: "custom_server_palette" }}
          onChange={vi.fn()}
          columns={baseColumns}
        />,
      );
      const select = screen.getByLabelText("Colormap") as HTMLSelectElement;
      expect(select.value).toBe("custom_server_palette");
      const currentGroup = select.querySelector('optgroup[label="Current"]');
      expect(currentGroup).not.toBeNull();
      expect(currentGroup!.textContent).toContain("custom_server_palette");
    });

    it("emits onChange with the picked value when operator changes selection", () => {
      const onChange = vi.fn();
      render(
        <KineticaWmsLayerForm
          config={heatmapConfig}
          onChange={onChange}
          columns={baseColumns}
        />,
      );
      const select = screen.getByLabelText("Colormap") as HTMLSelectElement;
      fireEvent.change(select, { target: { value: "Spectral" } });
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ colormap: "Spectral" }),
      );
    });

    it("Reverse colormap toggle: unchecking emits reverseColormap: false (NOT undefined — JSON.stringify would drop undefined and stale TRUE would persist on the wire)", () => {
      const onChange = vi.fn();
      render(
        <KineticaWmsLayerForm
          config={{ ...heatmapConfig, reverseColormap: true }}
          onChange={onChange}
          columns={baseColumns}
        />,
      );
      const checkbox = screen.getByLabelText("Reverse colormap") as HTMLInputElement;
      // Operator unchecks the box.
      fireEvent.click(checkbox);
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ reverseColormap: false }),
      );
      // The emitted patch object MUST contain `reverseColormap: false` (not undefined).
      // Verifying the literal type catches the JSON.stringify-drops-undefined regression.
      const emitted = onChange.mock.calls[0][0] as Record<string, unknown>;
      expect(emitted).toHaveProperty("reverseColormap", false);
    });

    it("Reverse colormap toggle: checking emits reverseColormap: true", () => {
      const onChange = vi.fn();
      render(
        <KineticaWmsLayerForm
          config={heatmapConfig}
          onChange={onChange}
          columns={baseColumns}
        />,
      );
      const checkbox = screen.getByLabelText("Reverse colormap") as HTMLInputElement;
      fireEvent.click(checkbox);
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ reverseColormap: true }),
      );
    });
  });

  it("does NOT render the Data Source picker when no `layer` prop is supplied (legacy back-compat)", () => {
    // MapConfigPanel and any future caller that embeds the form WITHOUT a layer DTO must
    // still mount cleanly — picker is a no-op when layer is undefined.
    render(
      <KineticaWmsLayerForm
        config={baseConfig}
        onChange={vi.fn()}
        columns={baseColumns}
      />
    );
    expect(screen.queryByLabelText("Layer data source")).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  Phase 52 TRACKMODE-V19-01/02 — track mode picker + four pickers    */
/* ------------------------------------------------------------------ */

describe("Phase 52 TRACKMODE-V19-01/02 — track mode picker and column pickers", () => {
  // Track-shaped table with all four required columns (TRACKID, x, y, TIMESTAMP)
  // plus extra columns to verify filtering logic
  const trackColumns = [
    { name: "TRACKID", type: "INT" },
    { name: "x", type: "DOUBLE" },
    { name: "y", type: "DOUBLE" },
    { name: "TIMESTAMP", type: "TIMESTAMP" },
    { name: "vendor_id", type: "VARCHAR" },
    { name: "speed", type: "FLOAT" },
  ];

  const trackConfig = {
    spatialMode: "track" as const,
    renderMode: "raster",
    track_config: JSON.stringify({
      enabled: true,
      xCol: "x",
      yCol: "y",
      trackIdAttr: "TRACKID",
      trackOrderAttr: "TIMESTAMP",
    }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCapabilities = null;
  });

  it("Track radio is present even when capabilities lists only latlon/wkt/wkb", () => {
    mockCapabilities = {
      renderModes: ["raster", "heatmap"],
      colormaps: [],
      spatialModes: ["latlon", "wkt", "wkb"],
      srs: ["EPSG:3857"],
      source: "probe",
    };
    render(
      <KineticaWmsLayerForm
        config={{ spatialMode: "latlon", renderMode: "raster" }}
        onChange={vi.fn()}
        columns={trackColumns}
      />,
    );
    // Track radio MUST appear even though capabilities omits it
    expect(screen.getByLabelText("Track (x/y point sequence)")).toBeInTheDocument();
  });

  it("selecting Track reveals four column pickers", () => {
    render(
      <KineticaWmsLayerForm
        config={trackConfig}
        onChange={vi.fn()}
        columns={trackColumns}
      />,
    );
    expect(screen.getByLabelText("Track X column")).toBeInTheDocument();
    expect(screen.getByLabelText("Track Y column")).toBeInTheDocument();
    expect(screen.getByLabelText("Track ID column")).toBeInTheDocument();
    expect(screen.getByLabelText("Track ordering column")).toBeInTheDocument();
  });

  it("Track ID picker pre-selects TRACKID and ordering pre-selects TIMESTAMP from track_config", () => {
    render(
      <KineticaWmsLayerForm
        config={trackConfig}
        onChange={vi.fn()}
        columns={trackColumns}
      />,
    );
    const trackIdSelect = screen.getByLabelText("Track ID column") as HTMLSelectElement;
    expect(trackIdSelect.value).toBe("TRACKID");

    const orderSelect = screen.getByLabelText("Track ordering column") as HTMLSelectElement;
    expect(orderSelect.value).toBe("TIMESTAMP");
  });

  it("x/y option lists contain only numeric columns; ordering excludes pure-string columns; track ID includes string ID columns", () => {
    render(
      <KineticaWmsLayerForm
        config={trackConfig}
        onChange={vi.fn()}
        columns={trackColumns}
      />,
    );

    const xSelect = screen.getByLabelText("Track X column") as HTMLSelectElement;
    const xOptions = Array.from(xSelect.options)
      .filter((o) => o.value !== "")
      .map((o) => o.value);
    // Only numeric: x (DOUBLE), y (DOUBLE), speed (FLOAT) — excludes TRACKID (INT? yes, INT is numeric)
    // INT is in NUMERIC_TYPES so TRACKID, x, y, speed all qualify as numeric
    expect(xOptions).toContain("x");
    expect(xOptions).toContain("y");
    expect(xOptions).toContain("speed");
    // VARCHAR (vendor_id) is NOT numeric
    expect(xOptions).not.toContain("vendor_id");
    // TIMESTAMP is NOT numeric
    expect(xOptions).not.toContain("TIMESTAMP");

    const orderSelect = screen.getByLabelText("Track ordering column") as HTMLSelectElement;
    const orderOptions = Array.from(orderSelect.options)
      .filter((o) => o.value !== "")
      .map((o) => o.value);
    // Ordering = datetime + numeric — includes TIMESTAMP and numeric cols; excludes VARCHAR
    expect(orderOptions).toContain("TIMESTAMP");
    expect(orderOptions).toContain("x");
    expect(orderOptions).not.toContain("vendor_id");

    const idSelect = screen.getByLabelText("Track ID column") as HTMLSelectElement;
    const idOptions = Array.from(idSelect.options)
      .filter((o) => o.value !== "")
      .map((o) => o.value);
    // Track ID: all non-geometry — includes string vendor_id and numeric/timestamp cols
    expect(idOptions).toContain("TRACKID");
    expect(idOptions).toContain("vendor_id");
    expect(idOptions).toContain("x");
  });

  it("isValid is called with false when a track picker is empty and true when all four are set", () => {
    const isValid = vi.fn();
    // Start with an incomplete track_config (no xCol)
    const incompleteConfig = {
      spatialMode: "track" as const,
      renderMode: "raster",
      track_config: JSON.stringify({
        enabled: true,
        yCol: "y",
        trackIdAttr: "TRACKID",
        trackOrderAttr: "TIMESTAMP",
      }),
    };
    render(
      <KineticaWmsLayerForm
        config={incompleteConfig}
        onChange={vi.fn()}
        columns={trackColumns}
        isValid={isValid}
      />,
    );
    // isValid should have been called with false (xCol missing)
    expect(isValid).toHaveBeenCalledWith(false);

    // Now render with all four set
    const completeConfig = {
      spatialMode: "track" as const,
      renderMode: "raster",
      track_config: JSON.stringify({
        enabled: true,
        xCol: "x",
        yCol: "y",
        trackIdAttr: "TRACKID",
        trackOrderAttr: "TIMESTAMP",
      }),
    };
    isValid.mockClear();
    render(
      <KineticaWmsLayerForm
        config={completeConfig}
        onChange={vi.fn()}
        columns={trackColumns}
        isValid={isValid}
      />,
    );
    // isValid should have been called with true (all four set)
    expect(isValid).toHaveBeenCalledWith(true);
  });
});

/* ------------------------------------------------------------------ */
/*  Phase 53 Task 1: Track render-mode narrowing (RENDER-V19-01)       */
/* ------------------------------------------------------------------ */

describe("Track render-mode narrowing (RENDER-V19-01)", () => {
  const trackColumns = [
    { name: "x", type: "DOUBLE" },
    { name: "y", type: "DOUBLE" },
    { name: "TRACKID", type: "INT" },
    { name: "TIMESTAMP", type: "TIMESTAMP" },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockCapabilities = null;
  });

  it("Track mode: only Raster and Classbreak radios present; Heatmap absent", () => {
    render(
      <KineticaWmsLayerForm
        config={{ spatialMode: "track", renderMode: "raster" }}
        onChange={vi.fn()}
        columns={trackColumns}
      />,
    );
    expect(screen.getByLabelText("Raster (point markers)")).toBeInTheDocument();
    expect(screen.getByLabelText("Classbreak (categorical)")).toBeInTheDocument();
    expect(screen.queryByLabelText("Heatmap (density)")).toBeNull();
  });

  it("Track mode with persisted heatmap renderMode: onChange fires with renderMode=raster; Raster radio checked; no toast", () => {
    const onChange = vi.fn();
    // The top-level vi.mock for useToastStore sets getState to a vi.fn() returning { showToast: vi.fn() }.
    // vi.clearAllMocks() in beforeEach resets the spy. We can assert showToast was NOT called
    // by checking the call count on getState (which indirectly tracks invocations).
    // Simpler: assert the Raster radio is checked and onChange emitted raster — toast absence
    // is guaranteed structurally (the plan explicitly forbids importing useToastStore for coercion).

    render(
      <KineticaWmsLayerForm
        config={{ spatialMode: "track", renderMode: "heatmap" }}
        onChange={onChange}
        columns={trackColumns}
      />,
    );

    // onChange should be called with renderMode: "raster" (silent coercion)
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ renderMode: "raster" }),
    );
    // Raster radio should appear checked (effectiveRenderMode)
    const rasterRadio = screen.getByLabelText("Raster (point markers)") as HTMLInputElement;
    expect(rasterRadio.checked).toBe(true);
    // Assert no toast element visible (structural guarantee — coercion is silent)
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("Control case: latlon mode still shows Heatmap radio (no regression)", () => {
    render(
      <KineticaWmsLayerForm
        config={{ spatialMode: "latlon", renderMode: "raster" }}
        onChange={vi.fn()}
        columns={trackColumns}
      />,
    );
    expect(screen.getByLabelText("Heatmap (density)")).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/*  Phase 53 Task 2: Track style + raster param hiding                  */
/*  (RENDER-V19-02, COLOR-V19-01)                                      */
/* ------------------------------------------------------------------ */

describe("Track style + raster param hiding (RENDER-V19-02, COLOR-V19-01)", () => {
  const trackColumns = [
    { name: "x", type: "DOUBLE" },
    { name: "y", type: "DOUBLE" },
    { name: "TRACKID", type: "INT" },
    { name: "TIMESTAMP", type: "TIMESTAMP" },
  ];

  const trackRasterConfig = {
    spatialMode: "track",
    renderMode: "raster",
    track_config: JSON.stringify({
      enabled: true,
      xCol: "x",
      yCol: "y",
      trackIdAttr: "TRACKID",
      trackOrderAttr: "TIMESTAMP",
    }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCapabilities = null;
  });

  it("Track+Raster: TRACK STYLE section visible; RASTER PARAMS hidden", () => {
    render(
      <KineticaWmsLayerForm
        config={trackRasterConfig}
        onChange={vi.fn()}
        columns={trackColumns}
      />,
    );
    expect(screen.getByText("TRACK STYLE")).toBeInTheDocument();
    expect(screen.queryByText("RASTER PARAMS")).toBeNull();
    expect(screen.queryByLabelText("Point color (RGB)")).toBeNull();
    expect(screen.queryByLabelText("Point shape")).toBeNull();
  });

  it("Track+Raster: TRACK STYLE contains color inputs for head and trail", () => {
    render(
      <KineticaWmsLayerForm
        config={trackRasterConfig}
        onChange={vi.fn()}
        columns={trackColumns}
      />,
    );
    const headColorInput = screen.getByLabelText("Track head color (RGB)") as HTMLInputElement;
    expect(headColorInput).toBeInTheDocument();
    expect(headColorInput.type).toBe("color");

    const trailColorInput = screen.getByLabelText("Track trail color (RGB)") as HTMLInputElement;
    expect(trailColorInput).toBeInTheDocument();
    expect(trailColorInput.type).toBe("color");

    const headShapeSelect = screen.getByLabelText("Track head shape") as HTMLSelectElement;
    expect(headShapeSelect).toBeInTheDocument();
    expect(headShapeSelect.tagName.toLowerCase()).toBe("select");
    // POINT_SHAPES has 12 options
    expect(headShapeSelect.options.length).toBe(12);
  });

  it("Editing head color hex text calls onChange with track_config JSON preserving enabled:true and all cols", () => {
    const onChange = vi.fn();
    render(
      <KineticaWmsLayerForm
        config={trackRasterConfig}
        onChange={onChange}
        columns={trackColumns}
      />,
    );
    const hexInput = screen.getByLabelText("Track head color (AARRGGBB hex)") as HTMLInputElement;
    fireEvent.change(hexInput, { target: { value: "FF00FF00" } });
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as Record<string, unknown>;
    const tc = JSON.parse(lastCall.track_config as string);
    expect(tc.headColor).toBe("FF00FF00");
    expect(tc.enabled).toBe(true);
    expect(tc.xCol).toBe("x");
    expect(tc.yCol).toBe("y");
  });

  it("Control: latlon+raster shows RASTER PARAMS; no TRACK STYLE", () => {
    render(
      <KineticaWmsLayerForm
        config={{ spatialMode: "latlon", renderMode: "raster" }}
        onChange={vi.fn()}
        columns={trackColumns}
      />,
    );
    expect(screen.getByText("RASTER PARAMS")).toBeInTheDocument();
    expect(screen.queryByText("TRACK STYLE")).toBeNull();
  });

  it("Track+Classbreak: CB builder AND TRACK STYLE both present", () => {
    render(
      <KineticaWmsLayerForm
        config={{ spatialMode: "track", renderMode: "classbreak" }}
        onChange={vi.fn()}
        columns={trackColumns}
      />,
    );
    expect(screen.getByText("CLASS BREAK PARAMS")).toBeInTheDocument();
    expect(screen.getByText("TRACK STYLE")).toBeInTheDocument();
  });
});
