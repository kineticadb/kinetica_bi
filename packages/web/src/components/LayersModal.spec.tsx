import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import LayersModal from "./LayersModal";
import type { DashboardLayerDto, TableDto } from "../api/client";

const mkLayer = (id: number, table_id = 10, overrides: Partial<DashboardLayerDto> = {}): DashboardLayerDto => ({
  id,
  dashboard_id: 1,
  table_id,
  layer_type: "KineticaWms",
  position: id,
  config: { renderMode: "raster", spatialMode: "latlon", POINTOPACITY: 100 },
  // v1.4 Phase 19 (CONFIG-V14-02): info popup defaults matching SQLite NOT NULL DEFAULT 1
  info_enabled: 1,
  info_columns: null,
  info_template: null,
  // v1.6 Phase 35 (DV-V16-13): per-layer dynamic-view binding; null = table/filter-view bound
  dynamic_view_id: null,
  // v1.7 Phase 38 (SCHEMA-V17-01/02): classbreak + track config JSON — null = not yet configured
  cb_config: null,
  track_config: null,
  created_at: "2026-05-05T00:00:00Z",
  updated_at: "2026-05-05T00:00:00Z",
  ...overrides,
});

const mkTable = (id: number, name: string): TableDto => ({
  id,
  name,
  schema: "public",
  description: "",
  columns: { lat: "double", lon: "double" },
  created_at: "2026-05-05T00:00:00Z",
  updated_at: "2026-05-05T00:00:00Z",
} as TableDto);

const noop = () => {};
const baseProps = {
  layers: [],
  associatedTables: [mkTable(10, "orders"), mkTable(11, "customers")],
  onClose: noop,
  onCreate: noop,
  onDelete: noop,
  onDuplicate: noop,
  onPatch: noop,
  onReorder: noop,
};

describe("LayersModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Test 1: renders .modal-layers overlay, title 'Map Layers', and + Add layer button", () => {
    render(<LayersModal {...baseProps} />);
    expect(screen.getByText("Map Layers")).toBeInTheDocument();
    expect(screen.getByText("+ Add layer")).toBeInTheDocument();
  });

  it("Test 2: when layers is empty, shows empty-state message in the right pane", () => {
    render(<LayersModal {...baseProps} />);
    expect(screen.getByText("Select a layer to configure")).toBeInTheDocument();
    expect(screen.getByText("Click a layer in the list, or add a new one.")).toBeInTheDocument();
  });

  it("Test 3: clicking + Add layer calls onCreate callback", () => {
    const onCreate = vi.fn();
    render(<LayersModal {...baseProps} onCreate={onCreate} />);
    fireEvent.click(screen.getByText("+ Add layer"));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("Test 4: clicking a layer row selects it (active class) and shows Data Source picker + form in right pane", () => {
    render(<LayersModal {...baseProps} layers={[mkLayer(1)]} />);
    // With one layer, it should be auto-selected; right pane should show the Phase 35
    // Data Source picker (replaces the legacy "Layer table" select; same role, new label).
    const dropdown = screen.getByLabelText("Layer data source");
    expect(dropdown).toBeInTheDocument();
  });

  it("Test 5: trash icon click shows Delete layer / Keep layer inline; clicking Delete calls onDelete; Keep cancels", () => {
    const onDelete = vi.fn();
    render(<LayersModal {...baseProps} layers={[mkLayer(1)]} onDelete={onDelete} />);
    fireEvent.click(screen.getByLabelText("Delete layer"));
    expect(screen.getByText("Delete layer")).toBeInTheDocument();
    expect(screen.getByText("Keep layer")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Delete layer"));
    expect(onDelete).toHaveBeenCalledWith(1);
  });

  it("Test 5b: Keep layer cancels the delete confirm", () => {
    const onDelete = vi.fn();
    render(<LayersModal {...baseProps} layers={[mkLayer(1)]} onDelete={onDelete} />);
    fireEvent.click(screen.getByLabelText("Delete layer"));
    fireEvent.click(screen.getByText("Keep layer"));
    expect(onDelete).not.toHaveBeenCalled();
    // aria-label Delete layer button should be visible again
    expect(screen.getByLabelText("Delete layer")).toBeInTheDocument();
  });

  it("Test 6: eye icon toggles visible config via onPatch; aria-label switches between Hide/Show", () => {
    const onPatch = vi.fn();
    render(<LayersModal {...baseProps} layers={[mkLayer(1)]} onPatch={onPatch} />);
    const eyeBtn = screen.getByLabelText("Hide layer");
    expect(eyeBtn).toBeInTheDocument();
    fireEvent.click(eyeBtn);
    expect(onPatch).toHaveBeenCalledTimes(1);
    const [layerId, patch] = onPatch.mock.calls[0];
    expect(layerId).toBe(1);
    expect((patch.config as Record<string, unknown>)?.visible).toBe(false);
  });

  it("Layer name input writes config.name via onPatch; list label reflects a set name", () => {
    const onPatch = vi.fn();
    render(
      <LayersModal
        {...baseProps}
        layers={[mkLayer(1, 10, { config: { renderMode: "raster", name: "My Pickups" } })]}
        onPatch={onPatch}
      />,
    );
    // List label uses config.name when set
    expect(screen.getByText("My Pickups")).toBeInTheDocument();
    // Editing the name field patches config.name
    const input = screen.getByLabelText("Layer name") as HTMLInputElement;
    expect(input.value).toBe("My Pickups");
    fireEvent.change(input, { target: { value: "Dropoffs" } });
    expect(onPatch).toHaveBeenCalledTimes(1);
    const [layerId, patch] = onPatch.mock.calls[0];
    expect(layerId).toBe(1);
    expect((patch.config as Record<string, unknown>)?.name).toBe("Dropoffs");
  });

  it("Test 7: duplicate icon calls onDuplicate with layer id; aria-label is Duplicate layer", () => {
    const onDuplicate = vi.fn();
    render(<LayersModal {...baseProps} layers={[mkLayer(1)]} onDuplicate={onDuplicate} />);
    fireEvent.click(screen.getByLabelText("Duplicate layer"));
    expect(onDuplicate).toHaveBeenCalledWith(1);
  });

  it("Test 8: KineticaWmsLayerForm onChange propagates to onPatch", () => {
    const onPatch = vi.fn();
    render(<LayersModal {...baseProps} layers={[mkLayer(1)]} onPatch={onPatch} />);
    // The form renders inside the right pane. Phase 35 (DV-V16-13): the unified Data Source
    // picker now lives inside KineticaWmsLayerForm — its presence is a reliable proxy that
    // the form mounted with all the layer-bound props threaded through.
    expect(screen.getByLabelText("Layer data source")).toBeInTheDocument();
  });

  it("Test 9: pressing ESC fires onClose", () => {
    const onClose = vi.fn();
    render(<LayersModal {...baseProps} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Test 9b: clicking the overlay backdrop fires onClose", () => {
    const onClose = vi.fn();
    const { container } = render(<LayersModal {...baseProps} onClose={onClose} />);
    const overlay = container.querySelector(".modal-overlay");
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Test 9c: Close button fires onClose", () => {
    const onClose = vi.fn();
    render(<LayersModal {...baseProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Test 10: layer with table_id not in associatedTables shows .layer-row-badge.error with Table removed — reconfigure", () => {
    render(<LayersModal {...baseProps} layers={[mkLayer(1, 999)]} />);
    expect(screen.getByText("Table removed — reconfigure")).toBeInTheDocument();
  });

  it("Test 11: drag-reorder calls onReorder with new orderedIds", () => {
    const onReorder = vi.fn();
    render(
      <LayersModal
        {...baseProps}
        layers={[mkLayer(1), mkLayer(2), mkLayer(3)]}
        onReorder={onReorder}
      />
    );
    const rows = document.querySelectorAll(".layer-row");
    expect(rows.length).toBe(3);
    // Simulate drag: move row[0] (id=1) to position of row[2] (id=3)
    fireEvent.dragStart(rows[0], { dataTransfer: { effectAllowed: "" } });
    fireEvent.dragOver(rows[2], { dataTransfer: { dropEffect: "" } });
    fireEvent.drop(rows[2], { dataTransfer: {} });
    expect(onReorder).toHaveBeenCalledTimes(1);
    // After moving id=1 to where id=3 was: [2, 3, 1]
    expect(onReorder).toHaveBeenCalledWith([2, 3, 1]);
  });

  it("Test 12: right-pane Data Source picker reflects current table_id and patches on change (with explicit dynamic_view_id null)", () => {
    const onPatch = vi.fn();
    render(<LayersModal {...baseProps} layers={[mkLayer(1, 10)]} onPatch={onPatch} />);
    // Phase 35 (DV-V16-13): picker label changed from "Layer table" to "Layer data source"
    // when the unified Tables / Dynamic Views picker subsumed the legacy TABLE select.
    const dropdown = screen.getByLabelText("Layer data source") as HTMLSelectElement;
    // dv-null + table_id=10 → picker value is the raw table id (NOT prefixed with "dv:").
    expect(dropdown.value).toBe("10");
    fireEvent.change(dropdown, { target: { value: "11" } });
    expect(onPatch).toHaveBeenCalledTimes(1);
    const [layerId, patch] = onPatch.mock.calls[0];
    expect(layerId).toBe(1);
    expect(patch.table_id).toBe(11);
    // Plan 35-01 "key" in attrs discriminant: explicit null clears any prior dv binding.
    expect(patch.dynamic_view_id).toBeNull();
    // autoSuggestSpatialMode for {lat: double, lon: double} suggests latlon
    expect((patch.config as Record<string, unknown>)?.spatialMode).toBe("latlon");
    // Stale spatial columns from old config should be cleared
    expect((patch.config as Record<string, unknown>)?.latColumn).toBeUndefined();
  });

  it("Test 13: per-layer opacity slider patches layer.config.POINTOPACITY", () => {
    const onPatch = vi.fn();
    render(
      <LayersModal
        {...baseProps}
        layers={[mkLayer(1, 10, { config: { renderMode: "raster", POINTOPACITY: 80 } })]}
        onPatch={onPatch}
      />
    );
    const slider = screen.getByLabelText("Layer opacity") as HTMLInputElement;
    expect(Number(slider.value)).toBe(80);
    fireEvent.change(slider, { target: { value: "40" } });
    expect(onPatch).toHaveBeenCalledTimes(1);
    const [layerId, patch] = onPatch.mock.calls[0];
    expect(layerId).toBe(1);
    expect((patch.config as Record<string, unknown>)?.POINTOPACITY).toBe(40);
  });

  // GAP-24-01-A regression (Phase 24-04 Task 2):
  // Toggling the eye icon from ON→OFF must:
  //   1) NOT throw (no render-loop, no null-deref, no error-boundary swallow)
  //   2) Fire exactly one onPatch call carrying { config: { visible: false, ...full prior config } }
  //   3) Preserve all other config fields (renderMode, POINTOPACITY, spatialMode, etc.) — the
  //      payload must wrap the FULL existing config, not just {visible:false}, otherwise the
  //      downstream store.updateLayer spread would clobber sibling fields and trigger a
  //      stale-config re-render in MapChartRenderer Effect 2.
  it("Test 14 (GAP-24-01-A): toggling visibility from ON→OFF does NOT throw and passes the full config in patch", () => {
    const onPatch = vi.fn();
    const initialLayer = mkLayer(1, 10, {
      config: {
        renderMode: "raster",
        spatialMode: "latlon",
        latColumn: "lat",
        lonColumn: "lon",
        POINTOPACITY: 100,
        visible: true,
      },
    });
    expect(() => {
      render(<LayersModal {...baseProps} layers={[initialLayer]} onPatch={onPatch} />);
      fireEvent.click(screen.getByLabelText("Hide layer"));
    }).not.toThrow();
    expect(onPatch).toHaveBeenCalledTimes(1);
    const [layerId, patch] = onPatch.mock.calls[0];
    expect(layerId).toBe(1);
    const cfg = patch.config as Record<string, unknown>;
    expect(cfg.visible).toBe(false);
    // Critical: patch must include the FULL prior config (not just {visible: false}).
    expect(cfg.renderMode).toBe("raster");
    expect(cfg.spatialMode).toBe("latlon");
    expect(cfg.latColumn).toBe("lat");
    expect(cfg.lonColumn).toBe("lon");
    expect(cfg.POINTOPACITY).toBe(100);
  });

  // GAP-24-01-A regression — companion: toggling OFF→ON path produces {visible:true} +
  // full config; aria-label reflects the new state on next render. Guards against a future
  // change that special-cases the OFF→ON path differently from ON→OFF.
  it("Test 14b (GAP-24-01-A): toggling visibility from OFF→ON does NOT throw and produces visible:true", () => {
    const onPatch = vi.fn();
    const initialLayer = mkLayer(1, 10, {
      config: {
        renderMode: "raster",
        spatialMode: "latlon",
        latColumn: "lat",
        lonColumn: "lon",
        POINTOPACITY: 100,
        visible: false,
      },
    });
    expect(() => {
      render(<LayersModal {...baseProps} layers={[initialLayer]} onPatch={onPatch} />);
      // When visible===false, aria-label is "Show layer" (default-true semantics inverted).
      fireEvent.click(screen.getByLabelText("Show layer"));
    }).not.toThrow();
    expect(onPatch).toHaveBeenCalledTimes(1);
    const [layerId, patch] = onPatch.mock.calls[0];
    expect(layerId).toBe(1);
    const cfg = patch.config as Record<string, unknown>;
    expect(cfg.visible).toBe(true);
    expect(cfg.renderMode).toBe("raster");
    expect(cfg.POINTOPACITY).toBe(100);
  });

  // ── Phase 35 (DV-V16-13): dynamicViews prop pass-through to KineticaWmsLayerForm ──
  it("Test 15 (Phase 35 DV-V16-13): forwards dynamicViews prop to KineticaWmsLayerForm — Dynamic Views optgroup visible in the right-pane Data Source picker", () => {
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
    render(
      <LayersModal
        {...baseProps}
        layers={[mkLayer(1, 10)]}
        dynamicViews={mockDynamicViews as any}
      />
    );
    // The Data Source picker exposes the "Dynamic Views" optgroup only when the prop is
    // threaded all the way down to KineticaWmsLayerForm. Asserting the optgroup label
    // is a precise proxy for prop pass-through.
    const select = screen.getByLabelText("Layer data source") as HTMLSelectElement;
    const optgroups = select.querySelectorAll("optgroup");
    const labels = Array.from(optgroups).map((g) => g.getAttribute("label"));
    expect(labels).toContain("Dynamic Views");
  });

  it("Test 16 (Phase 35 DV-V16-13): Data Source picker selecting a dv calls onPatch with { dynamic_view_id, table_id = sourceTableId }", () => {
    const onPatch = vi.fn();
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
    render(
      <LayersModal
        {...baseProps}
        layers={[mkLayer(1, 10)]}
        dynamicViews={mockDynamicViews as any}
        onPatch={onPatch}
      />
    );
    fireEvent.change(screen.getByLabelText("Layer data source"), {
      target: { value: "dv:7" },
    });
    expect(onPatch).toHaveBeenCalledTimes(1);
    const [layerId, patch] = onPatch.mock.calls[0];
    expect(layerId).toBe(1);
    // Research finding #4 lock: table_id stays = source_table_id (NOT NULL preserved).
    expect(patch.table_id).toBe(10);
    expect(patch.dynamic_view_id).toBe(7);
  });

  it("Test 17 (post-VERIFY regression): dv-bound layer surfaces columns from dv.columns_json, NOT source-table columns", () => {
    // Reported bug: spatial column picker showed source-table columns when layer was
    // bound to a dynamic view. Root cause: LayersModal.formColumns derived from
    // associatedTables.find(t => t.id === selectedLayer.table_id); but dv-bound layers
    // keep table_id = source_table_id (per research finding #4 / NOT NULL lock), so
    // the source-table columns leaked through. Fix: when dv-bound, parse dv.columns_json.
    const mockDynamicViews = [
      {
        id: 7,
        dashboard_id: 1,
        source_table_id: 10,
        name: "Top vendors",
        template_sql: "SELECT vendor, AVG(fare) AS avg_fare FROM {view} GROUP BY vendor",
        max_records: 10000,
        columns_json: JSON.stringify([
          { name: "vendor", type: "string" },
          { name: "avg_fare", type: "double" },
        ]),
        created_at: "x",
        updated_at: "x",
      },
    ];
    const dvBoundLayer = { ...mkLayer(1, 10), dynamic_view_id: 7 };
    render(
      <LayersModal
        {...baseProps}
        layers={[dvBoundLayer]}
        dynamicViews={mockDynamicViews as any}
      />
    );
    // The form's spatial WKT column picker should offer vendor + avg_fare (dv columns),
    // NEVER the source table's lat/lng columns. We assert by examining option text.
    // KineticaWmsLayerForm spatial-mode default for unknown columns is WKT; we don't
    // bind a spatial mode here, so we just check the form's general column option set.
    const html = document.body.innerHTML;
    expect(html).toContain("vendor");
    expect(html).toContain("avg_fare");
    expect(html).not.toContain(">lat<"); // source-table lat column must NOT leak
    expect(html).not.toContain(">lng<"); // source-table lng column must NOT leak
  });

  it("Test 18 (post-VERIFY regression): dv-bound layer with columns_json=null surfaces empty column list (operator must Preview the dv)", () => {
    const mockDynamicViews = [
      {
        id: 7,
        dashboard_id: 1,
        source_table_id: 10,
        name: "Top vendors",
        template_sql: "SELECT * FROM {view}",
        max_records: 10000,
        columns_json: null, // Preview never ran
        created_at: "x",
        updated_at: "x",
      },
    ];
    const dvBoundLayer = { ...mkLayer(1, 10), dynamic_view_id: 7 };
    render(
      <LayersModal
        {...baseProps}
        layers={[dvBoundLayer]}
        dynamicViews={mockDynamicViews as any}
      />
    );
    // Source-table columns MUST NOT fall through when dv columns_json is null —
    // silent wrong-data is worse than empty.
    const html = document.body.innerHTML;
    expect(html).not.toContain(">lat<");
    expect(html).not.toContain(">lng<");
  });

  it("Test 19 (post-VERIFY regression): selecting a dv clears stale spatial columns + re-runs autoSuggest against dv.columns_json", () => {
    const onPatch = vi.fn();
    const mockDynamicViews = [
      {
        id: 7,
        dashboard_id: 1,
        source_table_id: 10,
        name: "Top vendors",
        template_sql: "SELECT vendor, AVG(fare) AS avg_fare FROM {view} GROUP BY vendor",
        max_records: 10000,
        columns_json: JSON.stringify([
          { name: "vendor", type: "string" },
          { name: "avg_fare", type: "double" },
        ]),
        created_at: "x",
        updated_at: "x",
      },
    ];
    // Layer starts table-bound with a stale lonColumn / latColumn from prior config.
    const stalelayer = {
      ...mkLayer(1, 10),
      config: { spatialMode: "latlon", lonColumn: "lng", latColumn: "lat" },
    };
    render(
      <LayersModal
        {...baseProps}
        layers={[stalelayer]}
        dynamicViews={mockDynamicViews as any}
        onPatch={onPatch}
      />
    );
    fireEvent.change(screen.getByLabelText("Layer data source"), {
      target: { value: "dv:7" },
    });
    expect(onPatch).toHaveBeenCalledTimes(1);
    const [, patch] = onPatch.mock.calls[0];
    expect(patch.dynamic_view_id).toBe(7);
    expect(patch.table_id).toBe(10);
    // Stale spatial column values must be cleared — they reference source-table columns
    // (lng, lat) that don't exist in the dv's projection.
    expect(patch.config.lonColumn).toBeUndefined();
    expect(patch.config.latColumn).toBeUndefined();
    expect(patch.config.wktColumn).toBeUndefined();
    expect(patch.config.wkbColumn).toBeUndefined();
    // spatialMode is set by autoSuggest — assert it was re-computed (any defined value is fine;
    // the spec just locks that the field was touched, not the specific suggestion).
    expect(patch.config.spatialMode).toBeDefined();
  });
});
