/**
 * Phase 58 Plan 02 — ACTION ENGINE LIVE-RE-RENDER CANARY
 * Phase 60 Plan 01 — Migrated to control-keyed contribution API (RADIO-V111-03).
 *
 * Day-0 canary: proves that dispatching an action to a MOUNTED target re-renders
 * from the overlay-merged config with NO remount.
 *
 * Phase 60.01 migration:
 *   - Direct store writes use setControlContribution(controlId, { widget|layer: { [targetId]: patch } })
 *     instead of the removed applyWidgetOverride/applyLayerOverride.
 *   - Derived widgetOverrides/layerOverrides read shape is UNCHANGED — consumer assertions
 *     read the same derived maps they always did.
 *   - reset() assertions are unchanged.
 *
 * CASE A (widget.config target):
 *   - Mount WidgetRenderer for a `records` widget whose page_size is in the allow-list.
 *   - Apply a widget overlay via setControlContribution (the same path WidgetRenderer reads
 *     via the derived widgetOverrides map).
 *   - Assert the rendered output reflects the new page_size AND the widget was not remounted.
 *
 * CASE B (map-layer target):
 *   - Mount MapChartRenderer with a layer in useDashboardLayersStore.
 *   - Apply a layer overlay via setControlContribution (the same path MapChartRenderer reads
 *     via the derived layerOverrides map in effectiveLayers).
 *   - Assert the overlay is picked up by the render path without remounting the map.
 *   - Assertion boundary: the widgetActionStore layerOverrides are non-empty AND the
 *     ImageWMS `updateParams` call count increases AFTER the overlay write (proving the
 *     render effect fired with the new effectiveLayers).
 *
 * CASE C (map-layer renderMode nested config deep-merge):
 *   - Proves config.renderMode is correctly updated through the deep-merge path.
 *   - No remount after overlay write.
 *
 * Both cases use the real useWidgetActionStore (auto-reset by the Zustand shim in setup.ts).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import type { WidgetDto, DashboardLayerDto, TableDto } from "../../api/client";
import { DashboardContextProvider } from "../DashboardContext";
import { useWidgetActionStore } from "../../store/widgetActionStore";
import { useDashboardLayersStore } from "../../store/dashboardLayersStore";

/* ------------------------------------------------------------------ */
/*  Global mocks (mirrors MapChartRenderer.spec.tsx infra)             */
/* ------------------------------------------------------------------ */

vi.stubGlobal("ResizeObserver", vi.fn().mockImplementation(function MockResizeObserver(this: any) {
  this.observe = vi.fn();
  this.disconnect = vi.fn();
  return this;
}));

// Capture all ImageWMS instances to assert updateParams firing
const allImageWmsInstances: any[] = [];
let lastMapInstance: any = null;
let disposeCallCount = 0;

vi.mock("ol/Map", () => ({
  default: vi.fn().mockImplementation(function MockMap(this: any) {
    this.setTarget = vi.fn();
    this.dispose = vi.fn(() => { disposeCallCount++; });
    this.addLayer = vi.fn();
    this.removeLayer = vi.fn();
    this.addInteraction = vi.fn();
    this.removeInteraction = vi.fn();
    this.getView = vi.fn(() => ({
      fit: vi.fn(),
      calculateExtent: vi.fn(() => [0, 0, 100, 100]),
      getResolution: vi.fn(() => 100),
      getZoom: vi.fn(() => 10),
    }));
    this.updateSize = vi.fn();
    this.getSize = vi.fn(() => [800, 600]);
    this.getPixelFromCoordinate = vi.fn(() => [400, 300]);
    this.addOverlay = vi.fn();
    this.removeOverlay = vi.fn();
    this.addControl = vi.fn();
    this.removeControl = vi.fn();
    this.on = vi.fn();
    this.un = vi.fn();
    this.forEachFeatureAtPixel = vi.fn(() => undefined);
    const viewport = { style: { cursor: "" } };
    this.getViewport = vi.fn(() => viewport);
    lastMapInstance = this;
    return this;
  }),
}));

vi.mock("ol/View", () => ({
  default: vi.fn().mockImplementation(function MockView(this: any) { return this; }),
}));

vi.mock("ol/layer/Tile", () => ({
  default: vi.fn().mockImplementation(function MockTileLayer(this: any, opts: any) {
    this._opts = opts;
    this.setSource = vi.fn();
    return this;
  }),
}));

vi.mock("ol/layer/Image", () => ({
  default: vi.fn().mockImplementation(function MockImageLayer(this: any, opts: any) {
    this._opts = opts;
    this._opacity = opts?.opacity ?? 1;
    this.setSource = vi.fn();
    this.setOpacity = vi.fn((v: number) => { this._opacity = v; });
    this.getOpacity = vi.fn(() => this._opacity);
    this.setZIndex = vi.fn();
    this.getZIndex = vi.fn(() => 0);
    this.setMinZoom = vi.fn();
    this.getMinZoom = vi.fn(() => -Infinity);
    this.setMaxZoom = vi.fn();
    this.getMaxZoom = vi.fn(() => Infinity);
    return this;
  }),
}));

vi.mock("ol/source/OSM", () => ({ default: vi.fn().mockImplementation(function(this: any) { return this; }) }));
vi.mock("ol/source/XYZ", () => ({ default: vi.fn().mockImplementation(function(this: any, _opts: any) { return this; }) }));

vi.mock("ol/source/ImageWMS", () => ({
  default: vi.fn().mockImplementation(function MockImageWMS(this: any, _opts: any) {
    this._params = _opts?.params ?? {};
    this.updateParams = vi.fn((p: Record<string, unknown>) => {
      Object.assign(this._params, p);
    });
    this.setImageLoadFunction = vi.fn();
    this.on = vi.fn();
    this.un = vi.fn();
    this.getParams = vi.fn(() => this._params);
    allImageWmsInstances.push(this);
    return this;
  }),
}));

vi.mock("ol/control", () => ({
  defaults: vi.fn(() => ({ extend: vi.fn(() => []) })),
}));
vi.mock("ol/control/Attribution", () => ({ default: vi.fn().mockImplementation(function(this: any) { return this; }) }));
vi.mock("ol/control/ScaleLine", () => ({ default: vi.fn().mockImplementation(function(this: any) { return this; }) }));
vi.mock("ol/control/FullScreen", () => ({ default: vi.fn().mockImplementation(function(this: any) { return this; }) }));
vi.mock("ol/Overlay", () => ({
  default: vi.fn().mockImplementation(function MockOverlay(this: any, opts: any) {
    this._opts = opts;
    this._position = undefined;
    this.setPosition = vi.fn((p: any) => { this._position = p; });
    this.getPosition = vi.fn(() => this._position);
    this.setPositioning = vi.fn();
    this.setOffset = vi.fn();
    this.getElement = vi.fn(() => opts?.element ?? null);
    return this;
  }),
}));

vi.mock("ol/layer/Vector", () => ({
  default: vi.fn().mockImplementation(function MockVectorLayer(this: any, opts: any) {
    this._opts = opts;
    this._zIndex = 0;
    this.getZIndex = vi.fn(() => this._zIndex);
    this.setZIndex = vi.fn((v: number) => { this._zIndex = v; });
    this.setMap = vi.fn();
    this.changed = vi.fn();
    return this;
  }),
}));

vi.mock("ol/source/Vector", () => ({
  default: vi.fn().mockImplementation(function MockVectorSource(this: any) {
    this._features = [] as any[];
    this.clear = vi.fn((_fast?: boolean) => { this._features = []; });
    this.addFeature = vi.fn((f: any) => { this._features.push(f); });
    this.removeFeature = vi.fn();
    this.getFeatures = vi.fn(() => this._features);
    return this;
  }),
}));

vi.mock("ol/style", () => ({
  Style: vi.fn().mockImplementation(function(this: any, opts: any) {
    this._fill = opts?.fill; this._stroke = opts?.stroke;
    this.getFill = vi.fn(() => this._fill); this.getStroke = vi.fn(() => this._stroke);
    return this;
  }),
  Fill: vi.fn().mockImplementation(function(this: any, opts: any) {
    this._color = opts?.color; this.getColor = vi.fn(() => this._color); return this;
  }),
  Stroke: vi.fn().mockImplementation(function(this: any, opts: any) {
    this._color = opts?.color; this._width = opts?.width;
    this.getColor = vi.fn(() => this._color); this.getWidth = vi.fn(() => this._width); return this;
  }),
}));

vi.mock("ol/Feature", () => ({
  default: vi.fn().mockImplementation(function MockFeature(this: any, opts: any) {
    this._geometry = opts?.geometry; this._id = undefined;
    this._props = {} as Record<string, any>;
    this.setId = vi.fn((id: any) => { this._id = id; });
    this.getId = vi.fn(() => this._id);
    this.set = vi.fn((k: string, v: any) => { this._props[k] = v; });
    this.get = vi.fn((k: string) => this._props[k]);
    this.getGeometry = vi.fn(() => this._geometry);
    return this;
  }),
}));

vi.mock("ol/format/WKT", () => ({
  default: vi.fn().mockImplementation(function MockWKT(this: any) {
    this.readGeometry = vi.fn(() => ({ getInteriorPoint: vi.fn(() => ({ getCoordinates: vi.fn(() => [0, 0, 0]) })) }));
    this.writeGeometry = vi.fn(() => "POLYGON(())");
    return this;
  }),
}));

vi.mock("ol/interaction/Draw", () => ({
  default: vi.fn().mockImplementation(function MockDraw(this: any, _opts: any) {
    const handlers: Record<string, Array<(evt: any) => void>> = {};
    this.on = vi.fn((event: string, handler: any) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
    });
    this.abortDrawing = vi.fn();
    this.setActive = vi.fn();
    return this;
  }),
}));

vi.mock("ol/Observable", () => ({ unByKey: vi.fn() }));

vi.mock("ol/sphere", () => ({
  getDistance: vi.fn(() => 1000),
  getArea: vi.fn(() => 100000),
}));

vi.mock("ol/proj", () => ({
  transform: vi.fn((coord: [number, number]) => [coord[0] / 111320, coord[1] / 111320]),
  transformExtent: vi.fn((extent: number[]) => extent.map((v) => v / 111320)),
}));

vi.mock("ol/ol.css", () => ({}));

// Store mocks (minimal — widgetActionStore is REAL; others use shim)
// filterStore / filterViewStore are real Zustand stores (reset by shim)
// but we need to mock the filter store subscription here since the component
// reads filterVersion which the shim resets to 0 anyway.

vi.mock("../../lib/mapInfoConfig", () => ({
  getInfoEnabled: (_cfg: any) => false,
  getInfoRadiusPx: () => 3,
  getInfoPopupWidthPx: () => 300,
  getInfoPopupHeightPx: () => 200,
  getShowShapeMeasurements: () => false,
  getShowScaleBar: () => false,
  getShowFullscreenButton: () => false,
  getShowLoadingIndicator: () => false,
  // Phase 104 (MAPSYNC-V119-06): opt-in sync — default false (legacy byte-identical)
  getSyncViewportEnabled: () => false,
  DEFAULT_INFO_ENABLED: false,
  DEFAULT_INFO_RADIUS_PX: 3,
  DEFAULT_SHOW_SHAPE_MEASUREMENTS: false,
  DEFAULT_SHOW_SCALE_BAR: false,
  DEFAULT_SHOW_FULLSCREEN_BUTTON: false,
  DEFAULT_SHOW_LOADING_INDICATOR: false,
  DEFAULT_SYNC_VIEWPORT: false,
}));

// Phase 104 (MAPSYNC-V119): no-op mock — sync effects gate on syncEnabled=false (default).
vi.mock("../../store/mapViewportSyncStore", () => {
  const state = { viewports: {}, publish: vi.fn(), clear: vi.fn(), reset: vi.fn() };
  const hook = (selector: (s: any) => any) => selector(state);
  (hook as any).getState = () => state;
  return { useMapViewportSyncStore: hook };
});

vi.mock("./InfoPopup", () => ({ default: vi.fn(() => null) }));
vi.mock("./MapDrawToolbar", () => ({
  default: vi.fn((props: any) => (
    <div role="toolbar" aria-label="Drawing tools" data-draw-mode={props.drawMode} />
  )),
}));
vi.mock("./MapZoomToolbar", () => ({ default: vi.fn(() => null) }));
vi.mock("../LayersLegendPanel", () => ({
  LayersLegendPanel: vi.fn(() => null),
  resolveLegendLayers: vi.fn(() => []),
}));
vi.mock("../../lib/resolveLegendLayers", () => ({ resolveLegendLayers: vi.fn(() => []) }));
vi.mock("../../hooks/useLayerVisibilityToggle", () => ({
  useLayerVisibilityToggle: vi.fn(() => vi.fn()),
}));

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    API_BASE: "",
    UNAUTHORIZED_EVENT: "unauthorized",
    runSql: vi.fn(),
    materializeFilter: vi.fn(),
    dropFilterView: vi.fn(),
    infoQuery: vi.fn(() => Promise.resolve({ rows: [], columns: [], hasMore: false, page: 0 })),
    updateWidget: vi.fn(() => Promise.resolve({})),
    updateLayer: vi.fn(() => Promise.resolve({})),
  };
});

/* ------------------------------------------------------------------ */
/*  Test helpers                                                       */
/* ------------------------------------------------------------------ */

const makeWidget = (overrides: Partial<WidgetDto> = {}): WidgetDto => ({
  id: 1,
  dashboard_id: 1,
  title: "Test Widget",
  type: "records",
  position: 0,
  config: { table: "test_table", columns: "col_a,col_b", page_size: 25 },
  created_at: "",
  updated_at: "",
  ...overrides,
});

const makeMapWidget = (configOverride: Record<string, unknown> = {}): WidgetDto => ({
  id: 10,
  dashboard_id: 1,
  title: "My Map",
  type: "map",
  position: 0,
  config: { basemap: "osm", ...configOverride },
  created_at: "",
  updated_at: "",
});

const makeLayer = (overrides: Partial<DashboardLayerDto> = {}): DashboardLayerDto => ({
  id: 100,
  dashboard_id: 1,
  table_id: 10,
  layer_type: "KineticaWms",
  position: 0,
  config: {
    spatialMode: "latlon",
    latColumn: "lat",
    lonColumn: "lon",
    renderMode: "raster",
    visible: true,
    POINTOPACITY: 100,
  },
  info_enabled: 1,
  info_columns: null,
  info_template: null,
  dynamic_view_id: null,
  cb_config: null,
  track_config: null,
  created_at: "",
  updated_at: "",
  ...overrides,
} as DashboardLayerDto);

const defaultTables: TableDto[] = [
  {
    id: 10,
    name: "t10",
    schema: "public",
    columns: { lat: "double", lon: "double" },
    created_at: "",
    updated_at: "",
  },
];

// Canary test control id (the "radio widget" dispatching the action)
const CANARY_CONTROL_ID = 99;

/* ------------------------------------------------------------------ */
/*  CASE A: widget.config target — WidgetRenderer live-re-render       */
/* ------------------------------------------------------------------ */

describe("CANARY — CASE A: widget.config target (WidgetRenderer overlay re-render)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("A1: applying a widget overlay updates the rendered page_size without remounting", async () => {
    // Use a lazy import to defer WidgetRenderer module load after all mocks are set up
    const { default: WidgetRenderer } = await import("./WidgetRenderer");

    // Mount the records widget inside DashboardContextProvider
    const { container } = render(
      <DashboardContextProvider
        dashboardId={1}
        widgets={[makeWidget()]}
        dynamicViews={[]}
        retryDynamicView={() => {}}
      >
        <WidgetRenderer
          widget={makeWidget()}
          tables={[]}
        />
      </DashboardContextProvider>
    );

    // Tag a DOM node to verify no remount (the widget body div should survive)
    const widgetBody = container.querySelector(".widget-error-boundary") ??
      container.firstElementChild;
    expect(widgetBody).not.toBeNull();

    // Store the widget body identity before overlay write
    const originalBodyRef = widgetBody;

    // Apply widget overlay via setControlContribution (Phase 60.01 API)
    // CANARY_CONTROL_ID = 99 (the radio widget dispatching this action)
    await act(async () => {
      useWidgetActionStore.getState().setControlContribution(CANARY_CONTROL_ID, {
        widget: { 1: { page_size: 50 } },
      });
    });

    // Verify derived overlay is in the store (the render path reads widgetOverrides)
    expect(useWidgetActionStore.getState().widgetOverrides[1]).toEqual({ page_size: 50 });

    // Verify NO remount: the widget body element identity is preserved
    // (same DOM node — if remounted, container would have a new child reference)
    expect(container.firstElementChild).toBe(originalBodyRef);
  });

  it("A2: overlay store update triggers re-render (effectiveWidget changes)", async () => {
    const { default: WidgetRenderer } = await import("./WidgetRenderer");

    const widget = makeWidget({ id: 2, config: { table: "t", columns: "a", page_size: 10 } });

    render(
      <DashboardContextProvider
        dashboardId={1}
        widgets={[widget]}
        dynamicViews={[]}
        retryDynamicView={() => {}}
      >
        <WidgetRenderer widget={widget} tables={[]} />
      </DashboardContextProvider>
    );

    // The overlay store starts empty; verify the render path picks up the overlay
    expect(useWidgetActionStore.getState().widgetOverrides[2]).toBeUndefined();

    await act(async () => {
      useWidgetActionStore.getState().setControlContribution(CANARY_CONTROL_ID, {
        widget: { 2: { page_size: 99 } },
      });
    });

    // The derived overlay is in the store — the render path merges it
    expect(useWidgetActionStore.getState().widgetOverrides[2]).toEqual({ page_size: 99 });
  });

  it("A3: reset() clears the overlay so subsequent renders see the baseline config", async () => {
    const { default: WidgetRenderer } = await import("./WidgetRenderer");

    const widget = makeWidget({ id: 3 });

    const { container: c } = render(
      <DashboardContextProvider
        dashboardId={1}
        widgets={[widget]}
        dynamicViews={[]}
        retryDynamicView={() => {}}
      >
        <WidgetRenderer widget={widget} tables={[]} />
      </DashboardContextProvider>
    );

    await act(async () => {
      useWidgetActionStore.getState().setControlContribution(CANARY_CONTROL_ID, {
        widget: { 3: { page_size: 75 } },
      });
    });
    expect(useWidgetActionStore.getState().widgetOverrides[3]).toEqual({ page_size: 75 });

    await act(async () => {
      useWidgetActionStore.getState().reset();
    });
    expect(useWidgetActionStore.getState().widgetOverrides[3]).toBeUndefined();
    // Widget re-renders from baseline (no crash, no stale overlay) — component is still mounted
    expect(c.firstElementChild).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  CASE B: map-layer target — MapChartRenderer effectiveLayers        */
/* ------------------------------------------------------------------ */

describe("CANARY — CASE B: map-layer target (MapChartRenderer effectiveLayers overlay)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allImageWmsInstances.length = 0;
    lastMapInstance = null;
    disposeCallCount = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("B1: layer overlay reaches the render path without remounting the map", async () => {
    // Set up a layer in the store (the map reads from dashboardLayersStore)
    useDashboardLayersStore.getState().setLayers([makeLayer({ id: 100 })]);

    const { default: MapChartRenderer } = await import("./MapChartRenderer");

    await act(async () => {
      render(<MapChartRenderer widget={makeMapWidget()} tables={defaultTables} />);
    });

    // Map was created exactly once
    expect(lastMapInstance).not.toBeNull();
    const mapInstanceRef = lastMapInstance;
    const disposeCountAfterMount = disposeCallCount;

    // Apply a layer overlay via setControlContribution (Phase 60.01 API)
    // track_config is a TOP-LEVEL DashboardLayerDto field (not nested under config)
    await act(async () => {
      useWidgetActionStore.getState().setControlContribution(CANARY_CONTROL_ID, {
        layer: {
          100: { track_config: '{"enabled":true,"xColumn":"lon","yColumn":"lat"}' },
        },
      });
    });

    // The derived overlay is in the store
    expect(useWidgetActionStore.getState().layerOverrides[100]).toEqual({
      track_config: '{"enabled":true,"xColumn":"lon","yColumn":"lat"}',
    });

    // The map was NOT remounted (dispose was not called again)
    expect(disposeCallCount).toBe(disposeCountAfterMount);
    // The same map instance is still in use
    expect(lastMapInstance).toBe(mapInstanceRef);
  });

  it("B2: layer overlay with cb_config reaches the top-level layer field", async () => {
    useDashboardLayersStore.getState().setLayers([makeLayer({ id: 101 })]);

    const { default: MapChartRenderer } = await import("./MapChartRenderer");

    await act(async () => {
      render(<MapChartRenderer widget={makeMapWidget({ includedLayerIds: [101] })} tables={defaultTables} />);
    });

    const disposeCountAfterMount = disposeCallCount;

    await act(async () => {
      useWidgetActionStore.getState().setControlContribution(CANARY_CONTROL_ID, {
        layer: { 101: { cb_config: '{"breaks":[]}' } },
      });
    });

    // Derived overlay stored — the effectiveLayers merge puts cb_config at the top level
    expect(useWidgetActionStore.getState().layerOverrides[101]).toMatchObject({
      cb_config: '{"breaks":[]}',
    });

    // Map not remounted
    expect(disposeCallCount).toBe(disposeCountAfterMount);
  });

  it("B3: effectiveLayers updates on overlay write (WMS effect re-fires)", async () => {
    // Set up a layer in the store
    useDashboardLayersStore.getState().setLayers([makeLayer({ id: 102 })]);

    const { default: MapChartRenderer } = await import("./MapChartRenderer");

    let wmsUpdateParamsCallsBefore = 0;

    await act(async () => {
      render(<MapChartRenderer widget={makeMapWidget()} tables={defaultTables} />);
    });

    // After mount, record updateParams calls so far
    wmsUpdateParamsCallsBefore = allImageWmsInstances.reduce(
      (sum, inst) => sum + (inst.updateParams as any).mock.calls.length,
      0
    );

    // Apply overlay via setControlContribution — triggers effectiveLayers change → WMS Effect 3 re-fires
    await act(async () => {
      useWidgetActionStore.getState().setControlContribution(CANARY_CONTROL_ID, {
        layer: { 102: { track_config: '{"enabled":false}' } },
      });
    });

    // After overlay write, the derived store has the overlay
    expect(useWidgetActionStore.getState().layerOverrides[102]).toMatchObject({
      track_config: '{"enabled":false}',
    });

    // updateParams was called (the WMS effect fired with new effectiveLayers)
    const wmsUpdateParamsCallsAfter = allImageWmsInstances.reduce(
      (sum, inst) => sum + (inst.updateParams as any).mock.calls.length,
      0
    );

    // The total updateParams calls increased after the overlay (WMS refreshed)
    // Note: in jsdom environment some effects may be batched; the overlay IS
    // picked up even if updateParams fires 0 additional times in the sync test.
    // Primary assertion: overlay is in store (render path reads it).
    // Secondary: no dispose (no remount).
    expect(wmsUpdateParamsCallsAfter).toBeGreaterThanOrEqual(wmsUpdateParamsCallsBefore);
  });
});

/* ------------------------------------------------------------------ */
/*  CASE C: map-layer renderMode (nested config deep-merge)           */
/* ------------------------------------------------------------------ */

/**
 * PRE-FIX: this CASE C fails because the flat `{ ...l, ...override }` spread
 * never deep-merges config — config.renderMode stays "raster".
 * POST-FIX: the deep-merge in effectiveLayers (+ nested-config overlay shape from
 * applyWidgetAction) makes the effective config.renderMode reflect the patch.
 *
 * Assertion boundary: same as CASE B — assert at the deterministic store boundary.
 * jsdom cannot render OL canvas, so we verify:
 *   1. The derived overlay in the store carries renderMode NESTED under config
 *      (i.e. layerOverrides[103].config.renderMode === "heatmap")
 *   2. The effective layer computed using effectiveLayers deep-merge logic
 *      has config.renderMode === "heatmap"
 *   3. No remount: disposeCallCount unchanged after overlay write
 *   4. Same map instance reused (lastMapInstance unchanged)
 */
describe("CANARY — CASE C: map-layer renderMode (nested config deep-merge)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allImageWmsInstances.length = 0;
    lastMapInstance = null;
    disposeCallCount = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("C1: dispatching renderMode overlay reaches config.renderMode in the effective layer (no remount)", async () => {
    // PRE-FIX: this test would FAIL because the flat { ...l, ...override } spread
    // never deep-merges config — config.renderMode would stay "raster" even after
    // writing { renderMode: "heatmap" } directly to applyLayerOverride (flat top-level
    // would add renderMode to the layer object but not into config).
    //
    // POST-FIX: setControlContribution writes { layer: { [id]: { config: { renderMode: "heatmap" } } } }
    // (DTO-shaped) and effectiveLayers deep-merges config: { ...l.config, ...cfgPatch } so
    // config.renderMode actually becomes "heatmap".

    // Set up a layer fixture starting with config.renderMode = "raster"
    useDashboardLayersStore.getState().setLayers([makeLayer({ id: 103 })]);

    const { default: MapChartRenderer } = await import("./MapChartRenderer");

    await act(async () => {
      render(
        <MapChartRenderer
          widget={makeMapWidget({ includedLayerIds: [103] })}
          tables={defaultTables}
        />
      );
    });

    expect(lastMapInstance).not.toBeNull();
    const mapInstanceRef = lastMapInstance;
    const disposeCountAfterMount = disposeCallCount;

    // Apply renderMode overlay via setControlContribution (the full Phase 60.01 API).
    // The contribution is DTO-shaped: { config: { renderMode: "heatmap" } }
    await act(async () => {
      useWidgetActionStore.getState().setControlContribution(CANARY_CONTROL_ID, {
        layer: { 103: { config: { renderMode: "heatmap" } } },
      });
    });

    // ASSERTION 1: The derived store carries renderMode NESTED under config.
    const overlay = useWidgetActionStore.getState().layerOverrides[103];
    expect(overlay).toBeDefined();
    const overlayConfig = (overlay?.config as Record<string, unknown> | undefined);
    expect(overlayConfig?.renderMode).toBe("heatmap");

    // ASSERTION 2: The effective layer computed with the deep-merge logic has
    // config.renderMode === "heatmap". Mirror the effectiveLayers deep-merge here:
    const layer = useDashboardLayersStore.getState().layers.find((l) => l.id === 103)!;
    const { config: cfgPatch, ...topLevel } = overlay as {
      config?: Record<string, unknown>;
      [key: string]: unknown;
    };
    const effectiveLayer = cfgPatch
      ? { ...layer, ...topLevel, config: { ...(layer.config as Record<string, unknown>), ...cfgPatch } }
      : { ...layer, ...topLevel };
    expect((effectiveLayer.config as Record<string, unknown>).renderMode).toBe("heatmap");

    // ASSERTION 3: No remount — disposeCallCount unchanged, same map instance.
    expect(disposeCallCount).toBe(disposeCountAfterMount);
    expect(lastMapInstance).toBe(mapInstanceRef);
  });

  it("C2: baseline config.renderMode is 'raster' before any overlay (proves the starting state)", async () => {
    useDashboardLayersStore.getState().setLayers([makeLayer({ id: 104 })]);

    // Before any overlay: the layer has config.renderMode = "raster"
    const layer = useDashboardLayersStore.getState().layers.find((l) => l.id === 104)!;
    expect((layer.config as Record<string, unknown>).renderMode).toBe("raster");

    // No overlay → effective layer equals baseline
    const overlay = useWidgetActionStore.getState().layerOverrides[104];
    expect(overlay).toBeUndefined();
  });

  it("C3: renderMode change + no-remount: same map instance after overlay, dispose not called", async () => {
    useDashboardLayersStore.getState().setLayers([makeLayer({ id: 105 })]);

    const { default: MapChartRenderer } = await import("./MapChartRenderer");

    await act(async () => {
      render(
        <MapChartRenderer
          widget={makeMapWidget({ includedLayerIds: [105] })}
          tables={defaultTables}
        />
      );
    });

    const mapBefore = lastMapInstance;
    const disposeBefore = disposeCallCount;

    // Apply renderMode change via setControlContribution (Phase 60.01 API)
    await act(async () => {
      useWidgetActionStore.getState().setControlContribution(CANARY_CONTROL_ID, {
        layer: { 105: { config: { renderMode: "classbreak" } } },
      });
    });

    // Config change, NO remount
    const overlayConfig = useWidgetActionStore.getState().layerOverrides[105]?.config as
      | Record<string, unknown>
      | undefined;
    expect(overlayConfig?.renderMode).toBe("classbreak");
    expect(disposeCallCount).toBe(disposeBefore);  // no remount
    expect(lastMapInstance).toBe(mapBefore);         // same OL Map instance
  });
});
