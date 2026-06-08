/**
 * Phase 12: MapConfigPanel spec — shrunk surface (title + basemap + layer-inclusion picker).
 *
 * Tests:
 *   1. Renders title input with current value
 *   2. Typing into title input fires onChange with { title: <new value> }
 *   3. Renders basemap dropdown with 3 options
 *   4. Selecting a basemap fires onChange with { basemap: <new value> }
 *   5. When layers store is empty, renders verbatim empty-state copy
 *   6. When store has 2 layers, renders 2 checkbox rows; both checked by default (all-on state)
 *   7. Toggling one checkbox from all-on fires onChange with includedLayerIds = [<other id>]
 *   8. With explicit includedLayerIds=[1] and 2 store layers, layer 1 checked, layer 2 unchecked
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MapConfigPanel from "./MapConfigPanel";
import type { DashboardLayerDto } from "../../api/client";
import { isSpatialTargetEligible } from "../../lib/spatialTargets";

/* ------------------------------------------------------------------ */
/*  Store mock                                                         */
/* ------------------------------------------------------------------ */

const _storeState = {
  layers: [] as DashboardLayerDto[],
};

vi.mock("../../store/dashboardLayersStore", () => ({
  useDashboardLayersStore: (selector: (s: any) => any) =>
    selector({ layers: _storeState.layers }),
}));

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const makeLayer = (id: number, position: number = 0): DashboardLayerDto => ({
  id,
  dashboard_id: 1,
  table_id: 10 + id,
  layer_type: "KineticaWms",
  position,
  config: { renderMode: "raster", visible: true },
  // v1.4 Phase 19 (CONFIG-V14-02): info popup defaults matching SQLite NOT NULL DEFAULT 1
  info_enabled: 1,
  info_columns: null,
  info_template: null,
  dynamic_view_id: null,
  cb_config: null,
  track_config: null,
  created_at: "2026-05-05T00:00:00Z",
  updated_at: "2026-05-05T00:00:00Z",
});

const makeConfig = (overrides: Record<string, unknown> = {}) => ({
  basemap: "osm",
  title: "Test Map",
  ...overrides,
});

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("MapConfigPanel — Phase 12 shrunk surface", () => {
  beforeEach(() => {
    _storeState.layers = [];
    vi.clearAllMocks();
  });

  // 1. Renders title input with current value
  it("renders the title input with the current config.title value", () => {
    _storeState.layers = [];
    render(
      <MapConfigPanel
        config={makeConfig({ title: "My Dashboard Map" })}
        onChange={vi.fn()}
      />,
    );
    const titleInput = screen.getByPlaceholderText("Map widget title") as HTMLInputElement;
    expect(titleInput.value).toBe("My Dashboard Map");
  });

  // 2. Typing into title input fires onChange
  it("typing into title input fires onChange with updated title", () => {
    const onChange = vi.fn();
    _storeState.layers = [];
    render(
      <MapConfigPanel config={makeConfig({ title: "Old Title" })} onChange={onChange} />,
    );
    const titleInput = screen.getByPlaceholderText("Map widget title");
    fireEvent.change(titleInput, { target: { value: "New Title" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ title: "New Title" }),
    );
  });

  // 3. Renders separate light + dark basemap pickers, each with 3 options
  it("renders light + dark basemap pickers, each with the 3 basemap options", () => {
    render(
      <MapConfigPanel config={makeConfig()} onChange={vi.fn()} />,
    );
    const lightSel = screen.getByLabelText("Light mode basemap") as HTMLSelectElement;
    const darkSel = screen.getByLabelText("Dark mode basemap") as HTMLSelectElement;
    const labels = (sel: HTMLSelectElement) => Array.from(sel.options).map((o) => o.textContent);
    expect(labels(lightSel)).toEqual(["OpenStreetMap", "CartoDB Voyager", "CartoDB Dark Matter"]);
    expect(labels(darkSel)).toEqual(["OpenStreetMap", "CartoDB Voyager", "CartoDB Dark Matter"]);
  });

  // 4. Selecting a basemap fires onChange with the per-theme key
  it("selecting light/dark basemap fires onChange with { basemapLight } / { basemapDark }", () => {
    const onChange = vi.fn();
    render(
      <MapConfigPanel config={makeConfig({ basemapLight: "voyager", basemapDark: "dark" })} onChange={onChange} />,
    );
    fireEvent.change(screen.getByLabelText("Light mode basemap"), { target: { value: "osm" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ basemapLight: "osm" }));
    fireEvent.change(screen.getByLabelText("Dark mode basemap"), { target: { value: "voyager" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ basemapDark: "voyager" }));
  });

  // 4b. Legacy widgets (only `basemap`) fall back for both pickers.
  it("legacy `basemap` value seeds both pickers when basemapLight/basemapDark are absent", () => {
    render(
      <MapConfigPanel config={makeConfig({ basemap: "voyager" })} onChange={vi.fn()} />,
    );
    expect((screen.getByLabelText("Light mode basemap") as HTMLSelectElement).value).toBe("voyager");
    expect((screen.getByLabelText("Dark mode basemap") as HTMLSelectElement).value).toBe("voyager");
  });

  // 5. Empty store layers → empty-state copy
  it("when layers store is empty, renders the verbatim empty-state copy", () => {
    _storeState.layers = [];
    render(
      <MapConfigPanel config={makeConfig()} onChange={vi.fn()} />,
    );
    expect(
      screen.getByText(
        "No layers on this dashboard yet — add layers from the Layers panel.",
      ),
    ).toBeInTheDocument();
    expect(document.querySelector(".config-layer-none")).not.toBeNull();
  });

  // 6. 2 store layers → 2 checkbox rows; both checked in all-on state
  it("when store has 2 layers and includedLayerIds is not set, renders 2 checked checkboxes (all-on default)", () => {
    _storeState.layers = [makeLayer(1, 0), makeLayer(2, 1)];
    render(
      <MapConfigPanel
        config={makeConfig({ includedLayerIds: undefined })}
        onChange={vi.fn()}
      />,
    );
    // Query only layer picker checkboxes (scoped to .config-layer-picker to exclude INFO POPUP toggle)
    const layerPickerEl = document.querySelector(".config-layer-picker")!;
    const checkboxes = Array.from(
      layerPickerEl.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    );
    expect(checkboxes).toHaveLength(2);
    checkboxes.forEach((cb) => {
      expect(cb.checked).toBe(true);
    });
  });

  // 7. Toggling one checkbox from all-on state fires onChange with only the other id
  it("toggling one checkbox from all-on fires onChange with includedLayerIds=[<other layer id>]", () => {
    const onChange = vi.fn();
    _storeState.layers = [makeLayer(1, 0), makeLayer(2, 1)];
    render(
      <MapConfigPanel
        config={makeConfig({ includedLayerIds: [] })} // empty = all-on
        onChange={onChange}
      />,
    );
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    // Uncheck the first checkbox (layer 1)
    fireEvent.click(checkboxes[0]);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ includedLayerIds: [2] }),
    );
  });

  // 8. Explicit includedLayerIds=[1] — layer 1 checked, layer 2 unchecked
  it("with includedLayerIds=[1] and 2 store layers, layer 1's checkbox is checked, layer 2's is unchecked", () => {
    _storeState.layers = [makeLayer(1, 0), makeLayer(2, 1)];
    render(
      <MapConfigPanel
        config={makeConfig({ includedLayerIds: [1] })}
        onChange={vi.fn()}
      />,
    );
    const cb1 = screen.getByRole("checkbox", { name: /Layer #1/ }) as HTMLInputElement;
    const cb2 = screen.getByRole("checkbox", { name: /Layer #2/ }) as HTMLInputElement;
    expect(cb1.checked).toBe(true);
    expect(cb2.checked).toBe(false);
  });
});

describe("MapConfigPanel — quick-260608-j5k MAP CONTROLS checkboxes", () => {
  beforeEach(() => {
    _storeState.layers = [];
    vi.clearAllMocks();
  });

  it("renders 'Show scale bar' checkbox unchecked when config has no showScaleBar field", () => {
    render(<MapConfigPanel config={makeConfig()} onChange={vi.fn()} />);
    const cb = screen.getByLabelText("Show scale bar") as HTMLInputElement;
    expect(cb).toBeInTheDocument();
    expect(cb.checked).toBe(false);
  });

  it("ticking 'Show scale bar' fires onChange with objectContaining({ showScaleBar: true })", () => {
    const onChange = vi.fn();
    render(<MapConfigPanel config={makeConfig()} onChange={onChange} />);
    const cb = screen.getByLabelText("Show scale bar");
    fireEvent.click(cb);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ showScaleBar: true }));
  });

  it("renders 'Show fullscreen button' checkbox unchecked when config has no showFullscreenButton field", () => {
    render(<MapConfigPanel config={makeConfig()} onChange={vi.fn()} />);
    const cb = screen.getByLabelText("Show fullscreen button") as HTMLInputElement;
    expect(cb).toBeInTheDocument();
    expect(cb.checked).toBe(false);
  });

  it("ticking 'Show fullscreen button' fires onChange with objectContaining({ showFullscreenButton: true })", () => {
    const onChange = vi.fn();
    render(<MapConfigPanel config={makeConfig()} onChange={onChange} />);
    const cb = screen.getByLabelText("Show fullscreen button");
    fireEvent.click(cb);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ showFullscreenButton: true }));
  });

  it("renders 'Show scale bar' checked when config.showScaleBar is true", () => {
    render(<MapConfigPanel config={makeConfig({ showScaleBar: true })} onChange={vi.fn()} />);
    const cb = screen.getByLabelText("Show scale bar") as HTMLInputElement;
    expect(cb.checked).toBe(true);
  });

  it("renders 'Show fullscreen button' checked when config.showFullscreenButton is true", () => {
    render(<MapConfigPanel config={makeConfig({ showFullscreenButton: true })} onChange={vi.fn()} />);
    const cb = screen.getByLabelText("Show fullscreen button") as HTMLInputElement;
    expect(cb.checked).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  Phase 22 — INFO POPUP section tests                               */
/* ------------------------------------------------------------------ */

describe("MapConfigPanel — Phase 22 INFO POPUP section", () => {
  beforeEach(() => {
    _storeState.layers = [];
    vi.clearAllMocks();
  });

  // W1: INFO POPUP section header renders at bottom (after LAYERS)
  it("renders INFO POPUP section header at bottom (after LAYERS section)", () => {
    render(<MapConfigPanel config={makeConfig()} onChange={vi.fn()} />);
    expect(screen.getByText("INFO POPUP")).toBeInTheDocument();
    const labels = Array.from(
      document.querySelectorAll(".config-group-label"),
    ).map((el) => el.textContent);
    const titleIdx = labels.indexOf("TITLE");
    const basemapIdx = labels.indexOf("BASEMAP");
    const layersIdx = labels.indexOf("LAYERS");
    const infoIdx = labels.indexOf("INFO POPUP");
    expect(titleIdx).toBeGreaterThanOrEqual(0);
    expect(basemapIdx).toBeGreaterThan(titleIdx);
    expect(layersIdx).toBeGreaterThan(basemapIdx);
    expect(infoIdx).toBeGreaterThan(layersIdx);
  });

  // W2: Default infoEnabled=undefined → toggle reads as checked (default true via getInfoEnabled)
  it("with no infoEnabled in config, the Enable info popup checkbox is checked (default true via getInfoEnabled)", () => {
    render(<MapConfigPanel config={makeConfig()} onChange={vi.fn()} />);
    const toggle = screen.getByLabelText("Enable info popup") as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });

  // W3: Clicking toggle when ON fires onChange with infoEnabled=false
  it("clicking Enable info popup toggle when ON fires onChange with infoEnabled=false", () => {
    const onChange = vi.fn();
    render(
      <MapConfigPanel
        config={makeConfig({ infoEnabled: true })}
        onChange={onChange}
      />,
    );
    const toggle = screen.getByLabelText("Enable info popup");
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ infoEnabled: false }),
    );
  });

  // W4: Default infoRadiusPx=undefined → radius input shows '3' (tightened from v1.4 default of 20)
  it("with no infoRadiusPx in config, the radius input shows value '3'", () => {
    render(<MapConfigPanel config={makeConfig()} onChange={vi.fn()} />);
    const radiusInput = screen.getByLabelText("Click radius (px)") as HTMLInputElement;
    expect(radiusInput.value).toBe("3");
  });

  // W5: Clamp high — 999 → 200, fires onChange with infoRadiusPx=200, shows error
  it("typing 999 into radius input and firing blur snaps to 200, fires onChange with infoRadiusPx=200, shows inline error 'Must be 1–200'", () => {
    const onChange = vi.fn();
    render(
      <MapConfigPanel config={makeConfig({ infoEnabled: true })} onChange={onChange} />,
    );
    const radiusInput = screen.getByLabelText("Click radius (px)");
    fireEvent.change(radiusInput, { target: { value: "999" } });
    fireEvent.blur(radiusInput);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ infoRadiusPx: 200 }),
    );
    expect(screen.getByText("Must be 1–200")).toBeInTheDocument();
  });

  // W6: Clamp low — 0 → 1, fires onChange with infoRadiusPx=1
  it("typing 0 into radius input and blurring snaps to 1, fires onChange with infoRadiusPx=1", () => {
    const onChange = vi.fn();
    render(
      <MapConfigPanel config={makeConfig({ infoEnabled: true })} onChange={onChange} />,
    );
    const radiusInput = screen.getByLabelText("Click radius (px)");
    fireEvent.change(radiusInput, { target: { value: "0" } });
    fireEvent.blur(radiusInput);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ infoRadiusPx: 1 }),
    );
  });

  // W7: Clamp negative — -5 → 1, fires onChange with infoRadiusPx=1
  it("typing -5 into radius input and blurring snaps to 1, fires onChange with infoRadiusPx=1", () => {
    const onChange = vi.fn();
    render(
      <MapConfigPanel config={makeConfig({ infoEnabled: true })} onChange={onChange} />,
    );
    const radiusInput = screen.getByLabelText("Click radius (px)");
    fireEvent.change(radiusInput, { target: { value: "-5" } });
    fireEvent.blur(radiusInput);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ infoRadiusPx: 1 }),
    );
  });

  // W8: Clamp non-integer — 50.7 → 51 (Math.round), fires onChange with infoRadiusPx=51
  it("typing 50.7 into radius input and blurring snaps to 51 (round-int), fires onChange with infoRadiusPx=51", () => {
    const onChange = vi.fn();
    render(
      <MapConfigPanel config={makeConfig({ infoEnabled: true })} onChange={onChange} />,
    );
    const radiusInput = screen.getByLabelText("Click radius (px)");
    fireEvent.change(radiusInput, { target: { value: "50.7" } });
    fireEvent.blur(radiusInput);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ infoRadiusPx: 51 }),
    );
  });

  // W9: No onChange during typing (clamp-on-blur lock)
  it("typing 999 into radius input does NOT call onChange (clamp-on-blur lock)", () => {
    const onChange = vi.fn();
    render(
      <MapConfigPanel config={makeConfig({ infoEnabled: true })} onChange={onChange} />,
    );
    const radiusInput = screen.getByLabelText("Click radius (px)");
    fireEvent.change(radiusInput, { target: { value: "999" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  // W10: Disabled radius when infoEnabled=false
  it("when infoEnabled=false, radius input is disabled (HTML disabled attribute set + aria-disabled='true')", () => {
    render(
      <MapConfigPanel
        config={makeConfig({ infoEnabled: false })}
        onChange={vi.fn()}
      />,
    );
    const radiusInput = screen.getByLabelText("Click radius (px)") as HTMLInputElement;
    expect(radiusInput.disabled).toBe(true);
    expect(radiusInput.getAttribute("aria-disabled")).toBe("true");
  });

  // ─── GAP-24-01-B regression specs (Phase 24-05) ────────────────────────
  // Bug: prior to Phase 24-05 fix, useState initializers captured only the first render's
  // config; subsequent re-renders with a new config left the draft frozen at the original
  // value (typically the default 360/400/3).
  it("GAP-24-01-B: with infoPopupWidthPx=800 in config, the Popup width input shows '800'", () => {
    render(
      <MapConfigPanel
        config={makeConfig({ infoPopupWidthPx: 800, infoEnabled: true })}
        onChange={vi.fn()}
      />,
    );
    const widthInput = screen.getByLabelText("Popup width (px)") as HTMLInputElement;
    expect(widthInput.value).toBe("800");
  });

  it("GAP-24-01-B: with infoPopupHeightPx=1200 in config, the Popup height input shows '1200'", () => {
    render(
      <MapConfigPanel
        config={makeConfig({ infoPopupHeightPx: 1200, infoEnabled: true })}
        onChange={vi.fn()}
      />,
    );
    const heightInput = screen.getByLabelText("Popup height (px)") as HTMLInputElement;
    expect(heightInput.value).toBe("1200");
  });

  it("GAP-24-01-B: with infoRadiusPx=50 in config, the Click radius input shows '50' (regression coverage for same bug shape)", () => {
    render(
      <MapConfigPanel
        config={makeConfig({ infoRadiusPx: 50, infoEnabled: true })}
        onChange={vi.fn()}
      />,
    );
    const radiusInput = screen.getByLabelText("Click radius (px)") as HTMLInputElement;
    expect(radiusInput.value).toBe("50");
  });

  it("GAP-24-01-B: when config prop changes after mount (parent re-render), draft re-syncs to new value", () => {
    const { rerender } = render(
      <MapConfigPanel
        config={makeConfig({ infoPopupWidthPx: 360, infoEnabled: true })}
        onChange={vi.fn()}
      />,
    );
    const widthInput = screen.getByLabelText("Popup width (px)") as HTMLInputElement;
    expect(widthInput.value).toBe("360");
    rerender(
      <MapConfigPanel
        config={makeConfig({ infoPopupWidthPx: 800, infoEnabled: true })}
        onChange={vi.fn()}
      />,
    );
    expect(widthInput.value).toBe("800");
  });

  it("GAP-24-01-B: mid-type guard — when draft differs from prior config value, external config update does NOT clobber the in-progress draft", () => {
    const { rerender } = render(
      <MapConfigPanel
        config={makeConfig({ infoPopupWidthPx: 360, infoEnabled: true })}
        onChange={vi.fn()}
      />,
    );
    const widthInput = screen.getByLabelText("Popup width (px)") as HTMLInputElement;
    // Simulate user typing (no blur yet)
    fireEvent.change(widthInput, { target: { value: "12" } });
    expect(widthInput.value).toBe("12");
    // External config update (e.g., a side-effect bumped infoPopupWidthPx to 400)
    rerender(
      <MapConfigPanel
        config={makeConfig({ infoPopupWidthPx: 400, infoEnabled: true })}
        onChange={vi.fn()}
      />,
    );
    // Mid-type guard: draft "12" must NOT be clobbered to "400"
    expect(widthInput.value).toBe("12");
  });
});

/* ------------------------------------------------------------------ */
/*  Phase 28 — Spatial filter targets section tests                   */
/* ------------------------------------------------------------------ */

type SpecTableInfo = {
  id: number;
  name: string;
  schema: string;
  columns: Record<string, string>;
};

const makeTables = (): SpecTableInfo[] => [
  {
    id: 10,
    name: "orders",
    schema: "public",
    columns: { lat: "double", lon: "double", geom: "wkt", id: "int" },
  },
  {
    id: 11,
    name: "customers",
    schema: "public",
    columns: { latitude: "double", longitude: "double", region: "varchar" },
  },
  {
    id: 12,
    name: "regions",
    schema: "public",
    // Geometry-only table — autoSuggestSpatialMode returns 'wkt' for any
    // column whose type contains "wkt" (columnTypes.ts line 145-149).
    columns: { boundary: "wkt", region_name: "varchar" },
  },
];

describe("MapConfigPanel — Phase 28 Spatial filter targets section", () => {
  beforeEach(() => {
    _storeState.layers = [];
    vi.clearAllMocks();
  });

  // T1: Section header renders below INFO POPUP
  it("renders SPATIAL FILTER TARGETS section header below INFO POPUP", () => {
    render(<MapConfigPanel config={makeConfig()} onChange={vi.fn()} tables={makeTables()} />);
    expect(screen.getByText("SPATIAL FILTER TARGETS")).toBeInTheDocument();
    const labels = Array.from(
      document.querySelectorAll(".config-group-label"),
    ).map((el) => el.textContent);
    const infoIdx = labels.indexOf("INFO POPUP");
    const spatialIdx = labels.indexOf("SPATIAL FILTER TARGETS");
    expect(infoIdx).toBeGreaterThanOrEqual(0);
    expect(spatialIdx).toBeGreaterThan(infoIdx);
  });

  // T2: Empty-state placeholder renders when no spatialTargets configured
  it("renders the 'No spatial filter targets configured.' placeholder when widget.config.spatialTargets is undefined", () => {
    render(<MapConfigPanel config={makeConfig()} onChange={vi.fn()} tables={makeTables()} />);
    expect(
      screen.getByText("No spatial filter targets configured."),
    ).toBeInTheDocument();
  });

  // T3: + add affordance is always visible (in section header)
  it("renders the + add affordance in the section header (always visible)", () => {
    render(<MapConfigPanel config={makeConfig()} onChange={vi.fn()} tables={makeTables()} />);
    const addBtn = screen.getByLabelText("Add spatial filter target");
    expect(addBtn).toBeInTheDocument();
  });

  // Icon presence — Font Awesome (consistent with the map toolbars). Verified via the
  // FontAwesome-rendered SVG's `data-icon` attribute rather than visible text since the
  // buttons are now icon-only.
  it("add affordance renders a Font Awesome plus icon (no '+' character)", () => {
    render(<MapConfigPanel config={makeConfig()} onChange={vi.fn()} tables={makeTables()} />);
    const addBtn = screen.getByLabelText("Add spatial filter target");
    expect(addBtn.querySelector("svg[data-icon='plus']")).not.toBeNull();
    // No leftover literal '+' text inside the button
    expect(addBtn.textContent).toBe("");
  });

  it("remove affordance renders a Font Awesome trash icon (no '🗑' emoji)", () => {
    render(
      <MapConfigPanel
        config={makeConfig({
          spatialTargets: [{ tableId: 10, spatialMode: "latlon" }],
        })}
        onChange={vi.fn()}
        tables={makeTables()}
      />,
    );
    const removeBtn = screen.getByLabelText("Remove spatial filter target 1");
    expect(removeBtn.querySelector("svg[data-icon='trash']")).not.toBeNull();
    expect(removeBtn.textContent).toBe("");
  });

  // T4: Clicking + appends a fresh row with first associated table's id; spatial mode is
  // auto-suggested from the first table's columns (preferWktOverWkb=true so geometry
  // columns suggest 'wkt' instead of the deferred 'wkb'). The makeTables() fixture's
  // first table has columns { lat: double, lon: double, geom: 'wkt', id: int } — the
  // 'wkt'-typed `geom` column triggers the wkt-hint rule, so the suggested mode is 'wkt'.
  it("clicking + add affordance fires onChange with a fresh row using auto-suggested mode for the first table", () => {
    const onChange = vi.fn();
    render(
      <MapConfigPanel
        config={makeConfig()}
        onChange={onChange}
        tables={makeTables()}
      />,
    );
    const addBtn = screen.getByLabelText("Add spatial filter target");
    fireEvent.click(addBtn);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        spatialTargets: [{ tableId: 10, spatialMode: "wkt" }],
      }),
    );
  });

  // T5: Clicking + with no associated tables uses fallback tableId=0
  it("clicking + with empty tables prop fires onChange with tableId=0 fallback row", () => {
    const onChange = vi.fn();
    render(
      <MapConfigPanel
        config={makeConfig()}
        onChange={onChange}
        tables={[]}
      />,
    );
    const addBtn = screen.getByLabelText("Add spatial filter target");
    fireEvent.click(addBtn);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        spatialTargets: [{ tableId: 0, spatialMode: "latlon" }],
      }),
    );
  });

  // T6: Trash icon removes the row
  it("clicking the trash icon on a row fires onChange with that row removed", () => {
    const onChange = vi.fn();
    render(
      <MapConfigPanel
        config={makeConfig({
          spatialTargets: [
            { tableId: 10, spatialMode: "latlon", lonCol: "lon", latCol: "lat" },
          ],
        })}
        onChange={onChange}
        tables={makeTables()}
      />,
    );
    const removeBtn = screen.getByLabelText("Remove spatial filter target 1");
    fireEvent.click(removeBtn);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ spatialTargets: [] }),
    );
  });

  // T7: Changing spatial mode clears stale columns
  it("changing spatial mode on a row clears all column fields (lonCol/latCol/spatialCol → undefined)", () => {
    const onChange = vi.fn();
    render(
      <MapConfigPanel
        config={makeConfig({
          spatialTargets: [
            { tableId: 10, spatialMode: "latlon", lonCol: "lon", latCol: "lat" },
          ],
        })}
        onChange={onChange}
        tables={makeTables()}
      />,
    );
    const wktRadio = screen.getByRole("radio", { name: "WKT geometry column" });
    fireEvent.click(wktRadio);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        spatialTargets: [
          {
            tableId: 10,
            spatialMode: "wkt",
            lonCol: undefined,
            latCol: undefined,
            spatialCol: undefined,
          },
        ],
      }),
    );
  });

  // T8: Changing table to another lat/lon-shape table clears stale columns; auto-suggest keeps 'latlon'
  it("changing table on a row clears all column fields; auto-suggest preserves 'latlon' when the new table's columns still suggest latlon", () => {
    const onChange = vi.fn();
    render(
      <MapConfigPanel
        config={makeConfig({
          spatialTargets: [
            { tableId: 10, spatialMode: "latlon", lonCol: "lon", latCol: "lat" },
          ],
        })}
        onChange={onChange}
        tables={makeTables()}
      />,
    );
    const tableSelect = screen.getByLabelText(
      "Spatial filter target 1 table",
    ) as HTMLSelectElement;
    // tableId=11 has columns { latitude, longitude, region } → autoSuggestSpatialMode → 'latlon'
    fireEvent.change(tableSelect, { target: { value: "11" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        spatialTargets: [
          {
            tableId: 11,
            spatialMode: "latlon",
            lonCol: undefined,
            latCol: undefined,
            spatialCol: undefined,
          },
        ],
      }),
    );
  });

  // T8b (NEW — addresses checker context_compliance blocker): Changing table to a
  // geometry-only table flips the row's spatialMode to 'wkt' automatically via
  // autoSuggestSpatialMode. The prior spatialMode ('latlon') is NOT preserved —
  // it would be invalid for a table with no lat/lon numeric columns.
  // Source: CONTEXT.md §"Per-row UX" line 57 LOCKED decision; LayersModal.tsx
  // handleTableChange (lines 147-165) canonical pattern.
  // auto-suggest-on-table-change
  it("changing table to one whose columns suggest a different mode flips spatialMode automatically (auto-suggest-on-table-change)", () => {
    const onChange = vi.fn();
    render(
      <MapConfigPanel
        config={makeConfig({
          spatialTargets: [
            { tableId: 10, spatialMode: "latlon", lonCol: "lon", latCol: "lat" },
          ],
        })}
        onChange={onChange}
        tables={makeTables()}
      />,
    );
    const tableSelect = screen.getByLabelText(
      "Spatial filter target 1 table",
    ) as HTMLSelectElement;
    // tableId=12 has columns { boundary: "wkt", region_name: "varchar" }.
    // autoSuggestSpatialMode precedence: "type contains 'wkt'" → returns 'wkt'.
    // The prior row mode ('latlon') MUST NOT be preserved here.
    fireEvent.change(tableSelect, { target: { value: "12" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        spatialTargets: [
          {
            tableId: 12,
            spatialMode: "wkt", // ← auto-suggested, NOT preserved from prior
            lonCol: undefined,
            latCol: undefined,
            spatialCol: undefined,
          },
        ],
      }),
    );
  });

  // T9: Picking a longitude column on a latlon row fires onChange with lonCol set
  it("picking a longitude column on a latlon row fires onChange with lonCol set on that row", () => {
    const onChange = vi.fn();
    render(
      <MapConfigPanel
        config={makeConfig({
          spatialTargets: [{ tableId: 10, spatialMode: "latlon" }],
        })}
        onChange={onChange}
        tables={makeTables()}
      />,
    );
    const lonSelect = screen.getByLabelText(
      "Spatial filter target 1 longitude column",
    ) as HTMLSelectElement;
    fireEvent.change(lonSelect, { target: { value: "lon" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        spatialTargets: [
          expect.objectContaining({ tableId: 10, spatialMode: "latlon", lonCol: "lon" }),
        ],
      }),
    );
  });

  // T10: Picking a spatial column on a wkt row fires onChange with spatialCol set
  it("picking a spatial column on a wkt row fires onChange with spatialCol set on that row", () => {
    const onChange = vi.fn();
    render(
      <MapConfigPanel
        config={makeConfig({
          spatialTargets: [{ tableId: 10, spatialMode: "wkt" }],
        })}
        onChange={onChange}
        tables={makeTables()}
      />,
    );
    const spatialSelect = screen.getByLabelText(
      "Spatial filter target 1 spatial column",
    ) as HTMLSelectElement;
    fireEvent.change(spatialSelect, { target: { value: "geom" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        spatialTargets: [
          expect.objectContaining({ tableId: 10, spatialMode: "wkt", spatialCol: "geom" }),
        ],
      }),
    );
  });

  // T11: WKB row shows the locked verbatim warning text
  it("WKB row renders the locked verbatim warning text 'WKB spatial mode not yet supported — deferred'", () => {
    render(
      <MapConfigPanel
        config={makeConfig({
          spatialTargets: [{ tableId: 10, spatialMode: "wkb" }],
        })}
        onChange={vi.fn()}
        tables={makeTables()}
      />,
    );
    expect(
      screen.getByText("WKB spatial mode not yet supported — deferred"),
    ).toBeInTheDocument();
  });

  // T12: WKB row does NOT render a column picker
  it("WKB row renders NO column picker dropdown", () => {
    render(
      <MapConfigPanel
        config={makeConfig({
          spatialTargets: [{ tableId: 10, spatialMode: "wkb" }],
        })}
        onChange={vi.fn()}
        tables={makeTables()}
      />,
    );
    // No spatial column / lat column / lon column labels for a wkb row
    expect(
      screen.queryByLabelText("Spatial filter target 1 spatial column"),
    ).toBeNull();
    expect(
      screen.queryByLabelText("Spatial filter target 1 latitude column"),
    ).toBeNull();
    expect(
      screen.queryByLabelText("Spatial filter target 1 longitude column"),
    ).toBeNull();
  });

  // T13: Incomplete latlon row shows the inline indicator
  it("incomplete latlon row (missing both columns) renders 'Incomplete — will not filter'", () => {
    render(
      <MapConfigPanel
        config={makeConfig({
          spatialTargets: [{ tableId: 10, spatialMode: "latlon" }],
        })}
        onChange={vi.fn()}
        tables={makeTables()}
      />,
    );
    expect(screen.getByText("Incomplete — will not filter")).toBeInTheDocument();
  });

  // T14: Complete latlon row does NOT show the inline indicator
  it("complete latlon row (both columns set) does NOT render the 'Incomplete — will not filter' indicator", () => {
    render(
      <MapConfigPanel
        config={makeConfig({
          spatialTargets: [
            { tableId: 10, spatialMode: "latlon", lonCol: "lon", latCol: "lat" },
          ],
        })}
        onChange={vi.fn()}
        tables={makeTables()}
      />,
    );
    expect(screen.queryByText("Incomplete — will not filter")).toBeNull();
  });

  // T15: WKB row does NOT show 'Incomplete — will not filter' (WKB has its own warning instead)
  it("WKB row does NOT render the generic 'Incomplete' indicator (WKB has its own warning)", () => {
    render(
      <MapConfigPanel
        config={makeConfig({
          spatialTargets: [{ tableId: 10, spatialMode: "wkb" }],
        })}
        onChange={vi.fn()}
        tables={makeTables()}
      />,
    );
    expect(screen.queryByText("Incomplete — will not filter")).toBeNull();
  });

  // T16: Multiple rows render in order
  it("renders multiple rows in the order they appear in spatialTargets[]", () => {
    render(
      <MapConfigPanel
        config={makeConfig({
          spatialTargets: [
            { tableId: 10, spatialMode: "latlon", lonCol: "lon", latCol: "lat" },
            { tableId: 11, spatialMode: "wkt", spatialCol: "geom" },
          ],
        })}
        onChange={vi.fn()}
        tables={makeTables()}
      />,
    );
    // Both rows present (by their unique aria-labels)
    expect(screen.getByLabelText("Spatial filter target 1 table")).toBeInTheDocument();
    expect(screen.getByLabelText("Spatial filter target 2 table")).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/*  TRACKFIX-V19-08 (GAP-54-09): Track-shaped-table spatial target     */
/*  translation — new-row, changeTable, changeMode, radio display      */
/* ------------------------------------------------------------------ */

// A minimal track-shaped table fixture: TRACKID + X + Y + TIMESTAMP
// autoSuggestSpatialMode returns "track" for this column set.
const makeTrackTables = (): SpecTableInfo[] => [
  {
    id: 20,
    name: "track",
    schema: "demo",
    columns: {
      TRACKID: "string",
      X: "double",
      Y: "double",
      TIMESTAMP: "timestamp",
      SPEED: "double",
    },
  },
  {
    id: 21,
    name: "orders",
    schema: "public",
    columns: { lat: "double", lon: "double", id: "int" },
  },
];

describe("MapConfigPanel — TRACKFIX-V19-08: track target translation", () => {
  beforeEach(() => {
    _storeState.layers = [];
    vi.clearAllMocks();
  });

  // TRK-1: new-row path — clicking + with a track-shaped first table must store
  // {spatialMode:"latlon", lonCol:"X", latCol:"Y"}, NOT spatialMode:"track".
  it("TRK-1: clicking + with a track-shaped first table stores {spatialMode:'latlon', lonCol:'X', latCol:'Y'}", () => {
    const onChange = vi.fn();
    render(
      <MapConfigPanel
        config={makeConfig()}
        onChange={onChange}
        tables={makeTrackTables()}
      />,
    );
    fireEvent.click(screen.getByLabelText("Add spatial filter target"));
    const call = onChange.mock.calls[0][0];
    const stored = call.spatialTargets[0];
    expect(stored.spatialMode).toBe("latlon");
    expect(stored.lonCol).toBe("X");
    expect(stored.latCol).toBe("Y");
    // isSpatialTargetEligible must return true for the stored target
    expect(stored.tableId).toBe(20);
  });

  // TRK-2: changeTable to track-shaped table stores {spatialMode:"latlon", lonCol:"X", latCol:"Y"}
  it("TRK-2: changing table to a track-shaped table stores {spatialMode:'latlon', lonCol:'X', latCol:'Y'}", () => {
    const onChange = vi.fn();
    render(
      <MapConfigPanel
        config={makeConfig({
          spatialTargets: [{ tableId: 21, spatialMode: "latlon", lonCol: "lon", latCol: "lat" }],
        })}
        onChange={onChange}
        tables={makeTrackTables()}
      />,
    );
    const tableSelect = screen.getByLabelText(
      "Spatial filter target 1 table",
    ) as HTMLSelectElement;
    fireEvent.change(tableSelect, { target: { value: "20" } });
    const call = onChange.mock.calls[0][0];
    const stored = call.spatialTargets[0];
    expect(stored.spatialMode).toBe("latlon");
    expect(stored.lonCol).toBe("X");
    expect(stored.latCol).toBe("Y");
    expect(stored.tableId).toBe(20);
  });

  // TRK-3: isSpatialTargetEligible returns true for the translated target
  it("TRK-3: the translated track target {spatialMode:'latlon', lonCol:'X', latCol:'Y'} is eligible", () => {
    // This target is what should be stored after the translation
    const target = { tableId: 20, spatialMode: "latlon" as const, lonCol: "X", latCol: "Y" };
    expect(isSpatialTargetEligible(target)).toBe(true);
  });

  // TRK-4: Mode radio group shows exactly 3 options (latlon/wkt/wkb) — NO "track" option
  it("TRK-4: mode radio group shows exactly 3 options (latlon, wkt, wkb) — no track option", () => {
    render(
      <MapConfigPanel
        config={makeConfig({
          spatialTargets: [{ tableId: 20, spatialMode: "latlon", lonCol: "X", latCol: "Y" }],
        })}
        onChange={vi.fn()}
        tables={makeTrackTables()}
      />,
    );
    const radioGroup = document.querySelector('[role="radiogroup"]')!;
    const radios = radioGroup.querySelectorAll('input[type="radio"]');
    expect(radios).toHaveLength(3);
    const values = Array.from(radios).map((r) => (r as HTMLInputElement).value);
    expect(values).toContain("latlon");
    expect(values).toContain("wkt");
    expect(values).toContain("wkb");
    expect(values).not.toContain("track");
  });

  // TRK-5: A legacy stored spatialMode:"track" row is coerced to latlon for radio
  // display — the "Lat/Lon" radio is checked, not none of them.
  it("TRK-5: a row with legacy spatialMode:'track' stored in config shows the latlon radio as checked", () => {
    render(
      <MapConfigPanel
        config={makeConfig({
          // @ts-ignore — testing legacy/stale stored value coercion
          spatialTargets: [{ tableId: 20, spatialMode: "track" }],
        })}
        onChange={vi.fn()}
        tables={makeTrackTables()}
      />,
    );
    const latlonRadio = screen.getByRole("radio", {
      name: "Latitude / Longitude pair",
    }) as HTMLInputElement;
    expect(latlonRadio.checked).toBe(true);
  });

  // TRK-6: changeMode latlon→wkt→latlon — switching back to latlon for a track
  // table repopulates lonCol/latCol from isTrackTable (columns are NOT wiped).
  // Uses rerender to simulate the parent applying the intermediate config update.
  it("TRK-6: changeMode latlon→wkt→latlon on a track table repopulates lonCol/latCol (not wiped)", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <MapConfigPanel
        config={makeConfig({
          spatialTargets: [
            { tableId: 20, spatialMode: "latlon", lonCol: "X", latCol: "Y" },
          ],
        })}
        onChange={onChange}
        tables={makeTrackTables()}
      />,
    );
    // Step 1: switch to wkt
    fireEvent.click(screen.getByRole("radio", { name: "WKT geometry column" }));
    const afterWkt = onChange.mock.calls[0][0].spatialTargets[0];
    expect(afterWkt.spatialMode).toBe("wkt");

    // Simulate parent applying the update (controlled component pattern)
    rerender(
      <MapConfigPanel
        config={makeConfig({ spatialTargets: [afterWkt] })}
        onChange={onChange}
        tables={makeTrackTables()}
      />,
    );

    // Step 2: switch back to latlon — columns should be repopulated for track table
    onChange.mockClear();
    fireEvent.click(screen.getByRole("radio", { name: "Latitude / Longitude pair" }));
    const afterLatlon = onChange.mock.calls[0][0].spatialTargets[0];
    expect(afterLatlon.spatialMode).toBe("latlon");
    expect(afterLatlon.lonCol).toBe("X");
    expect(afterLatlon.latCol).toBe("Y");
  });

  // TRK-7: Non-track latlon/wkt/wkb flows unchanged (regression guard).
  // Changing table to a non-track latlon table still works as before.
  it("TRK-7: non-track latlon table changeTable still stores latlon with undefined columns (regression)", () => {
    const onChange = vi.fn();
    render(
      <MapConfigPanel
        config={makeConfig({
          spatialTargets: [{ tableId: 20, spatialMode: "latlon", lonCol: "X", latCol: "Y" }],
        })}
        onChange={onChange}
        tables={makeTrackTables()}
      />,
    );
    const tableSelect = screen.getByLabelText(
      "Spatial filter target 1 table",
    ) as HTMLSelectElement;
    // tableId=21 is orders: lat/lon columns, not a track table
    fireEvent.change(tableSelect, { target: { value: "21" } });
    const call = onChange.mock.calls[0][0];
    const stored = call.spatialTargets[0];
    expect(stored.spatialMode).toBe("latlon");
    expect(stored.lonCol).toBeUndefined();
    expect(stored.latCol).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/*  SHAPE DISPLAY section (Phase 29 follow-up)                         */
/* ------------------------------------------------------------------ */

describe("MapConfigPanel — SHAPE DISPLAY section", () => {
  beforeEach(() => {
    _storeState.layers = [];
    vi.clearAllMocks();
  });

  it("renders SHAPE DISPLAY section header", () => {
    render(<MapConfigPanel config={makeConfig()} onChange={vi.fn()} />);
    expect(screen.getByText("SHAPE DISPLAY")).toBeInTheDocument();
  });

  it("with no showShapeMeasurements in config, the toggle is checked (default true)", () => {
    render(<MapConfigPanel config={makeConfig()} onChange={vi.fn()} />);
    const toggle = screen.getByLabelText("Show shape measurements on map") as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });

  it("with showShapeMeasurements=false, the toggle is unchecked", () => {
    render(
      <MapConfigPanel
        config={makeConfig({ showShapeMeasurements: false })}
        onChange={vi.fn()}
      />,
    );
    const toggle = screen.getByLabelText("Show shape measurements on map") as HTMLInputElement;
    expect(toggle.checked).toBe(false);
  });

  it("clicking the toggle ON fires onChange with showShapeMeasurements: false", () => {
    const onChange = vi.fn();
    render(
      <MapConfigPanel config={makeConfig({ showShapeMeasurements: true })} onChange={onChange} />,
    );
    fireEvent.click(screen.getByLabelText("Show shape measurements on map"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ showShapeMeasurements: false }),
    );
  });

  it("clicking the toggle OFF fires onChange with showShapeMeasurements: true", () => {
    const onChange = vi.fn();
    render(
      <MapConfigPanel
        config={makeConfig({ showShapeMeasurements: false })}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText("Show shape measurements on map"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ showShapeMeasurements: true }),
    );
  });
});

/* ------------------------------------------------------------------ */
/*  LAYERS PANEL section (Phase 41)                                    */
/* ------------------------------------------------------------------ */

describe("LAYERS PANEL section (Phase 41)", () => {
  beforeEach(() => {
    _storeState.layers = [];
    vi.clearAllMocks();
  });

  it("renders LAYERS PANEL section label", () => {
    render(<MapConfigPanel config={makeConfig()} onChange={vi.fn()} />);
    expect(screen.getByText("LAYERS PANEL")).toBeInTheDocument();
  });

  it("toggle is unchecked by default (legendPanelEnabled missing)", () => {
    render(<MapConfigPanel config={makeConfig()} onChange={vi.fn()} />);
    const cb = screen.getByLabelText("Show Layers Panel") as HTMLInputElement;
    expect(cb.checked).toBe(false);
  });

  it("corner picker is hidden when toggle off", () => {
    render(<MapConfigPanel config={makeConfig()} onChange={vi.fn()} />);
    expect(document.getElementById("map-legend-panel-corner")).toBeNull();
  });

  it("corner picker is visible when legendPanelEnabled: true", () => {
    render(<MapConfigPanel config={makeConfig({ legendPanelEnabled: true })} onChange={vi.fn()} />);
    expect(document.getElementById("map-legend-panel-corner")).not.toBeNull();
  });

  it("toggling on fires onChange with legendPanelEnabled: true", async () => {
    const onChange = vi.fn();
    render(<MapConfigPanel config={makeConfig()} onChange={onChange} />);
    await userEvent.click(screen.getByLabelText("Show Layers Panel"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ legendPanelEnabled: true }));
  });

  it("corner select fires onChange with new corner", async () => {
    const onChange = vi.fn();
    render(<MapConfigPanel config={makeConfig({ legendPanelEnabled: true })} onChange={onChange} />);
    await userEvent.selectOptions(document.getElementById("map-legend-panel-corner")!, "bottom-left");
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ legendPanelCorner: "bottom-left" }));
  });

  it("defaults to top-right when legendPanelCorner missing", () => {
    render(<MapConfigPanel config={makeConfig({ legendPanelEnabled: true })} onChange={vi.fn()} />);
    const sel = document.getElementById("map-legend-panel-corner") as HTMLSelectElement;
    expect(sel.value).toBe("top-right");
  });

  it("exposes 4 corner options", () => {
    render(<MapConfigPanel config={makeConfig({ legendPanelEnabled: true })} onChange={vi.fn()} />);
    const opts = (document.getElementById("map-legend-panel-corner") as HTMLSelectElement).querySelectorAll("option");
    expect(opts).toHaveLength(4);
    expect(Array.from(opts).map(o => o.value)).toEqual(["top-right", "top-left", "bottom-right", "bottom-left"]);
  });

  it("option labels are operator-friendly", () => {
    render(<MapConfigPanel config={makeConfig({ legendPanelEnabled: true })} onChange={vi.fn()} />);
    const opts = (document.getElementById("map-legend-panel-corner") as HTMLSelectElement).querySelectorAll("option");
    const labels = Array.from(opts).map(o => o.textContent);
    expect(labels).toEqual(["Top-right (default)", "Top-left", "Bottom-right", "Bottom-left"]);
  });

  it("section has role=group + aria-labelledby", () => {
    render(<MapConfigPanel config={makeConfig()} onChange={vi.fn()} />);
    const labelEl = screen.getByText("LAYERS PANEL");
    expect(labelEl.id).toBe("map-legend-panel-label");
    const groupEl = labelEl.closest('[role="group"]')!;
    expect(groupEl).toHaveAttribute("aria-labelledby", "map-legend-panel-label");
  });

  it("toggling off does not emit a legendPanelCorner reset", async () => {
    const onChange = vi.fn();
    render(
      <MapConfigPanel
        config={makeConfig({ legendPanelEnabled: true, legendPanelCorner: "bottom-left" })}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByLabelText("Show Layers Panel"));
    const call = onChange.mock.calls[0][0];
    expect(call.legendPanelCorner).toBe("bottom-left");
    expect(call.legendPanelEnabled).toBe(false);
  });
});
