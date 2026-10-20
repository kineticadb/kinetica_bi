/**
 * Phase 139 (139-13) — regression proofs: a map layer bound to an AI dynamic view (NEGATIVE
 * dynamic_view_id) resolves the AI view's Kinetica name at BOTH buildWmsParams sites in
 * MapChartRenderer (Effect 2 = ImageWMS construction, Effect 3 = updateParams), and the
 * dynamicViewsKey dep re-fires on a pending -> materialized flip.
 *
 * Harness (mocks for ol/*, stores) copied from MapChartRenderer.spec.tsx lines 1-820.
 * Real tiles are NOT provable in jsdom: routed to the 139-14 operator UAT.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { WidgetDto, DashboardLayerDto, TableDto } from "../../api/client";
// Phase 61 GAP-61-01: real widgetActionStore (NOT mocked) — drive a runtime layer
// overlay to prove the in-map legend follows effectiveLayers, not the persisted store.
import { useWidgetActionStore } from "../../store/widgetActionStore";

/* ------------------------------------------------------------------ */
/*  Shared mutable state (module-level, mutated in beforeEach)         */
/* ------------------------------------------------------------------ */

// These are shared objects mutated by tests and referenced inside vi.mock factories
// (which are hoisted to top of module but execute lazily when the module is imported).

const _filterState = {
  filters: {} as Record<number, any[]>,
  filterVersion: 0,
};

const _layersState = {
  layers: [] as DashboardLayerDto[],
};

const _filterViewState: {
  views: Record<number, {
    viewName: string;
    expiresAt: number;
    materializing: boolean;
    materializeVersion: number;
    dashboardId: number;
  }>;
  dvViews: Record<number, {
    viewName: string;
    expiresAt: number;
    materializing: boolean;
    materializeVersion: number;
    dashboardId: number;
  }>;
} = { views: {}, dvViews: {} };

// Phase 92 (READ-V118-02): filterCombinationStore mock state — mutated by tests, read by the
// selector-aware mock factory below. Keyed l:<layerId> in vizToHash; registry by combo hash.
let _comboVizToHash: Record<string, string | undefined> = {};
let _comboRegistry: Record<string, any> = {};

// Phase 35 (DV-V16-13): per-layer dynamic-view store state. Shared between vi.mock factory
// and tests so tests can mutate dvEntry shape (viewName, status) + dynamicViewVersion and the
// renderer's imperative getState() snapshots read the new state on next effect fire.
const _dynamicViewState: {
  views: Record<number, {
    viewName: string;
    status: "materialized" | "pending" | "over_threshold" | "error";
    expiresAt?: number;
    reason?: string;
    error?: string;
  }>;
  dynamicViewVersion: number;
} = { views: {}, dynamicViewVersion: 0 };

// Phase 21 POPUP-V14 mocks — module-level so they can be captured by vi.mock factories
// and reset in beforeEach (mirrors the _filterState pattern above).
// Typed as `any` to avoid `never[]` inference on the rows array in mockResolvedValue calls.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _infoQueryMock: any = vi.fn(() =>
  Promise.resolve({ rows: [] as Record<string, unknown>[], columns: [] as string[], hasMore: false, page: 0 })
);
const _toastMock = vi.fn();

// Phase 21: per-test infoSelectionStore state (replaced by tests as needed)
const _infoSelectionState = {
  state: {} as Record<number, any>,
  activeLayerId: null as number | null,
  setSelection: vi.fn(),
  appendPage: vi.fn(),
  clearSelection: vi.fn(),
  setActiveLayer: vi.fn(),
  setLoading: vi.fn(),
  setError: vi.fn(),
  reset: vi.fn(),
};

// Plan 23-02: per-test lastInfoClickContextStore state — module-level so vi.mock factory can capture it.
// setContext mirror-writes to .context so tests can assert via either spy calls or current state.
const _lastInfoClickContextState: {
  context:
    | null
    | {
        clickLon: number;
        clickLat: number;
        mapBbox: [number, number, number, number];
        mapWidthPx: number;
        mapHeightPx: number;
        radiusPx: number;
        sourceWidgetId: number;
      };
  setContext: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
} = {
  context: null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setContext: vi.fn((ctx: any) => {
    _lastInfoClickContextState.context = ctx;
  }),
  reset: vi.fn(() => {
    _lastInfoClickContextState.context = null;
  }),
};

// Phase 21: ol/Overlay mock instance — captured for assertions
let lastOverlayInstance: any = null;
// singleclick handler captured from map.on() calls.
// Phase 29 Plan 05: may be a selection-click handler (returns void) or info handler (returns Promise<void>).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let capturedSingleclickHandler: ((event: any) => any) | null = null;

// Phase 104 (MAPSYNC-V119) + Phase 111 (MAPVIEW-V121-01): every moveend handler registered
// on the map, in registration order. Two effects now register one each: Effect 9a (sync
// publish, ONLY when syncViewport is on) and Effect 9c (always-on current-view publish).
// Tests fire ALL of them, exactly as OL would.
let capturedMoveendHandlers: Array<() => void> = [];
const fireAllMoveend = () => { capturedMoveendHandlers.forEach((h) => h()); };
// Phase 104: mock OL view with getCenter, getZoom, animate — used by sync tests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lastMockView: any = null;

/* ------------------------------------------------------------------ */
/*  ResizeObserver mock                                                */
/* ------------------------------------------------------------------ */

let lastResizeObserverCallback: ResizeObserverCallback | null = null;
let lastResizeObserverInstance: { observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> } | null = null;

const MockResizeObserver = vi.fn().mockImplementation(function (this: any, cb: ResizeObserverCallback) {
  lastResizeObserverCallback = cb;
  this.observe = vi.fn();
  this.disconnect = vi.fn();
  lastResizeObserverInstance = this;
  return this;
});

vi.stubGlobal("ResizeObserver", MockResizeObserver);

/* ------------------------------------------------------------------ */
/*  OL mocks                                                           */
/* ------------------------------------------------------------------ */

let lastMapInstance: any = null;
let lastBasemapLayerInstance: any = null;
const allImageLayerInstances: any[] = [];
const allImageWmsInstances: any[] = [];
let tileLoadListeners: Record<string, Array<(evt?: any) => void>> = {};

// Phase 29: mock viewport element for cursor tests (M7-M10)
let lastViewportElement: { style: { cursor: string } } | null = null;

vi.mock("ol/Map", () => ({
  default: vi.fn().mockImplementation(function MockMap(this: any) {
    this.setTarget = vi.fn();
    this.dispose = vi.fn();
    this.addLayer = vi.fn();
    this.removeLayer = vi.fn();
    this.addInteraction = vi.fn();
    this.removeInteraction = vi.fn();
    const mockView = {
      fit: vi.fn(),
      calculateExtent: vi.fn(() => [0, 0, 100, 100]),
      getResolution: vi.fn(() => 100),
      // Post-VERIFY zoom-range info-click gate: handler reads view.getZoom()
      // to decide whether each layer's configured [minZoom, maxZoom] window
      // contains the current view zoom. Default mock returns 10 — a "middle"
      // value that satisfies the typical no-constraint case (layers with no
      // minZoom/maxZoom in config are always included since the helper falls
      // back to -Infinity / Infinity bounds).
      getZoom: vi.fn(() => 10),
      // Phase 104 (MAPSYNC-V119): getCenter + animate needed for sync effects.
      getCenter: vi.fn(() => [100, 200] as [number, number]),
      animate: vi.fn(),
      // Phase 112: spies so a test can prove the initial view is NOT applied imperatively
      // (an imperative apply would paint the world view first — the forbidden flash).
      setCenter: vi.fn(),
      setZoom: vi.fn(),
    };
    lastMockView = mockView;
    this.getView = vi.fn(() => mockView);
    this.updateSize = vi.fn();
    this.getSize = vi.fn(() => [800, 600]);
    // Edge-aware popup positioning needs click pixel coords from map.getPixelFromCoordinate.
    // For tests, return a deterministic pixel so pickPopupAnchor can compute consistently.
    this.getPixelFromCoordinate = vi.fn(() => [400, 300]);
    this.addOverlay = vi.fn();
    this.removeOverlay = vi.fn();
    this.addControl = vi.fn();
    this.removeControl = vi.fn();
    // Capture singleclick handler for POPUP-V14 tests
    // Phase 29 Plan 05: map supports multiple singleclick handlers (info + selection).
    // Store handlers in an array so each can be fired independently in tests.
    const singleclickHandlers: Array<(event: any) => void> = [];
    this._singleclickHandlers = singleclickHandlers;
    this.on = vi.fn((event: string, handler: any) => {
      if (event === "singleclick") {
        capturedSingleclickHandler = handler;
        singleclickHandlers.push(handler);
      }
      if (event === "moveend") {
        // Phase 104 + Phase 111: collect every registered handler
        capturedMoveendHandlers.push(handler);
      }
    });
    this.un = vi.fn((event: string, handler?: any) => {
      if (event === "singleclick") {
        if (handler) {
          const idx = singleclickHandlers.indexOf(handler);
          if (idx !== -1) singleclickHandlers.splice(idx, 1);
        } else {
          singleclickHandlers.length = 0;
        }
        capturedSingleclickHandler = singleclickHandlers[singleclickHandlers.length - 1] ?? null;
      }
    });
    // Phase 29 Plan 05: forEachFeatureAtPixel — per-test configurable hit-test.
    // Default: no hit (returns undefined). Tests override via lastMapInstance._hitFeature.
    this._hitFeature = null as any;
    this.forEachFeatureAtPixel = vi.fn(
      (_pixel: any, callback: (feature: any, layer: any) => any, _opts?: any) => {
        if (this._hitFeature) {
          return callback(this._hitFeature, null);
        }
        return undefined;
      }
    );
    // Phase 29 (V15-P-02): getViewport mock for cursor tests (M7-M10).
    // Returns a shared mutable viewport object so tests can assert style.cursor.
    const viewport = { style: { cursor: "" } };
    lastViewportElement = viewport;
    this.getViewport = vi.fn(() => viewport);
    lastMapInstance = this;
    return this;
  }),
}));

// Phase 21: ol/Overlay mock
vi.mock("ol/Overlay", () => ({
  default: vi.fn().mockImplementation(function MockOverlay(this: any, opts: any) {
    this._opts = opts;
    this._position = undefined as any;
    this._positioning = opts?.positioning ?? "top-left";
    this._offset = opts?.offset ?? [0, 0];
    this.setPosition = vi.fn((pos: any) => { this._position = pos; });
    this.getPosition = vi.fn(() => this._position);
    this.setPositioning = vi.fn((p: any) => { this._positioning = p; });
    this.setOffset = vi.fn((o: any) => { this._offset = o; });
    // Phase 29 Plan 03: getElement needed by Effect 7's measurement text sync
    this.getElement = vi.fn(() => opts?.element ?? null);
    lastOverlayInstance = this;
    return this;
  }),
}));

// Phase 21: ol/proj mock — provides transform() for EPSG:3857 → EPSG:4326 conversion.
// Bug-fix follow-up: transformExtent() added so MapChartRenderer can transform the
// view bbox from EPSG:3857 to EPSG:4326 before sending to the server (server-side
// radiusConversion expects EPSG:4326 degrees, not raw Web Mercator meters).
vi.mock("ol/proj", () => ({
  transform: vi.fn((coord: [number, number], _from: string, _to: string) => {
    // Simple pass-through for tests; real EPSG conversion is integration-level.
    // POPUP-V14-P13: when called with [-13627665, 4548000] (EPSG:3857), the real
    // transform returns roughly [-122.4, 37.7] (EPSG:4326). For mock, we return
    // [-122.4, 37.7] when coord matches, else return scaled values.
    if (coord[0] === -13627665 && coord[1] === 4548000) return [-122.4, 37.7];
    return [coord[0] / 111320, coord[1] / 111320];
  }),
  transformExtent: vi.fn(
    (extent: [number, number, number, number], _from: string, _to: string) => {
      // Mock: divide each component by 111320 to give a deterministic, easily-asserted
      // EPSG:4326-shaped result for any given EPSG:3857 input. The real OL conversion
      // is integration-level. With calculateExtent() returning [0, 0, 100, 100] in the
      // shared map mock, this yields ~[0, 0, 0.000898, 0.000898].
      return [
        extent[0] / 111320,
        extent[1] / 111320,
        extent[2] / 111320,
        extent[3] / 111320,
      ];
    }
  ),
}));

vi.mock("ol/View", () => ({
  default: vi.fn().mockImplementation(function MockView(this: any, opts: any) {
    // Phase 112 (MAPVIEW-V121-02/-03): the initial center/zoom are CONSTRUCTOR arguments,
    // so the payload is the only place the applied initial view is observable.
    this._opts = opts;
    return this;
  }),
}));

vi.mock("ol/layer/Tile", () => ({
  default: vi.fn().mockImplementation(function MockTileLayer(this: any, opts: any) {
    this._opts = opts;
    this.setSource = vi.fn();
    lastBasemapLayerInstance = this;
    return this;
  }),
}));

vi.mock("ol/layer/Image", () => ({
  default: vi.fn().mockImplementation(function MockImageLayer(this: any, opts: any) {
    this._opts = opts;
    this._opacity = opts?.opacity ?? 1;
    this._zIndex = opts?.zIndex ?? 0;
    // Post-VERIFY zoom-range support: OL BaseLayer defaults — minZoom=-Infinity,
    // maxZoom=Infinity. Our `applyZoomRangeToLayer` helper relies on get/setMinZoom
    // + get/setMaxZoom existing on the layer instance.
    this._minZoom = opts?.minZoom ?? -Infinity;
    this._maxZoom = opts?.maxZoom ?? Infinity;
    this.setSource = vi.fn();
    this.setOpacity = vi.fn((v: number) => { this._opacity = v; });
    this.getOpacity = vi.fn(() => this._opacity);
    this.setZIndex = vi.fn((v: number) => { this._zIndex = v; });
    this.getZIndex = vi.fn(() => this._zIndex);
    this.setMinZoom = vi.fn((v: number) => { this._minZoom = v; });
    this.getMinZoom = vi.fn(() => this._minZoom);
    this.setMaxZoom = vi.fn((v: number) => { this._maxZoom = v; });
    this.getMaxZoom = vi.fn(() => this._maxZoom);
    allImageLayerInstances.push(this);
    return this;
  }),
}));

vi.mock("ol/source/OSM", () => ({
  default: vi.fn().mockImplementation(function MockOSM(this: any) {
    this._type = "osm";
    return this;
  }),
}));

vi.mock("ol/source/XYZ", () => ({
  default: vi.fn().mockImplementation(function MockXYZ(this: any) {
    this._type = "xyz";
    return this;
  }),
}));

vi.mock("ol/source/ImageWMS", () => ({
  default: vi.fn().mockImplementation(function MockImageWMS(this: any) {
    this.updateParams = vi.fn();
    this.refresh = vi.fn();
    this.setImageLoadFunction = vi.fn((fn: any) => { this._loadFn = fn; });
    this.on = vi.fn((event: string, handler: (evt?: any) => void) => {
      if (!tileLoadListeners[event]) tileLoadListeners[event] = [];
      tileLoadListeners[event].push(handler);
    });
    this.un = vi.fn();
    allImageWmsInstances.push(this);
    return this;
  }),
}));

vi.mock("ol/control", () => ({
  defaults: vi.fn(() => ({ extend: vi.fn(() => []) })),
}));

vi.mock("ol/control/Attribution", () => ({
  default: vi.fn().mockImplementation(function (this: any) { return this; }),
}));

vi.mock("ol/control/ScaleLine", () => ({
  default: vi.fn().mockImplementation(function (this: any) { return this; }),
}));

vi.mock("ol/control/FullScreen", () => ({
  default: vi.fn().mockImplementation(function (this: any, opts: any) { this._opts = opts; return this; }),
}));

vi.mock("ol/ol.css", () => ({}));

/* ------------------------------------------------------------------ */
/*  Store mocks — read from shared _filterState / _layersState         */
/* ------------------------------------------------------------------ */

vi.mock("../../store/filterStore", () => {
  // useFilterStore as hook
  const hook = (selector: (s: any) => any) =>
    selector({
      filters: _filterState.filters,
      filterVersion: _filterState.filterVersion,
    });
  // useFilterStore.getState() for imperative reads inside effects
  (hook as any).getState = () => ({
    filters: _filterState.filters,
    filterVersion: _filterState.filterVersion,
  });
  return { useFilterStore: hook };
});

vi.mock("../../store/dashboardLayersStore", () => {
  const hook = (selector: (s: any) => any) =>
    selector({ layers: _layersState.layers });
  // Expose getState() so resolvedLegendLayers useMemo can read layers imperatively.
  (hook as any).getState = () => ({ layers: _layersState.layers });
  return { useDashboardLayersStore: hook };
});

vi.mock("../../store/filterViewStore", () => {
  const hook = (selector: (s: any) => any) => selector({ views: _filterViewState.views, dvViews: _filterViewState.dvViews });
  (hook as any).getState = () => ({ views: _filterViewState.views, dvViews: _filterViewState.dvViews });
  return { useFilterViewStore: hook };
});

// Phase 92: filterCombinationStore mock — selector-aware hook + getState(), mirrors the
// filterViewStore mock pattern. NOFILTER_SENTINEL exported so the renderer's hash.endsWith check works.
vi.mock("../../store/filterCombinationStore", () => {
  const state = () => ({ vizToHash: _comboVizToHash, registry: _comboRegistry, combinationVersion: 0 });
  const hook = (selector: (s: any) => any) => selector(state());
  (hook as any).getState = () => state();
  return { useFilterCombinationStore: hook, MAX_COMBINATION_VIEWS_PER_TABLE: 10 };
});

// Phase 35 (DV-V16-13): dynamicViewStore mock — same imperative .getState() pattern as
// filterViewStore. Hook for reactive selectors (the dynamicViewsKey primitive selector at
// MapChartRenderer.tsx:411-417 mirror); getState() for per-layer .views[id] reads inside
// Effect 2 and Effect 3 bodies.
vi.mock("../../store/dynamicViewStore", () => {
  const hook = (selector: (s: any) => any) =>
    selector({
      views: _dynamicViewState.views,
      dynamicViewVersion: _dynamicViewState.dynamicViewVersion,
    });
  (hook as any).getState = () => ({
    views: _dynamicViewState.views,
    dynamicViewVersion: _dynamicViewState.dynamicViewVersion,
  });
  return { useDynamicViewStore: hook };
});

vi.mock("../../store/toast", () => ({
  useToastStore: {
    getState: vi.fn(() => ({ showToast: (...args: any[]) => _toastMock(...args) })),
  },
}));

vi.mock("../../api/client", () => ({
  UNAUTHORIZED_EVENT: "kbi:unauthorized",
  API_BASE: "http://localhost:4000",
  // Phase 21 POPUP-V14: infoQuery mock — reset in each describe block beforeEach
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  infoQuery: (req: any, signal?: any) => _infoQueryMock(req, signal),
}));

// Phase 21: useInfoSelectionStore mock — imperative getState() pattern (PITFALL S-02)
vi.mock("../../store/infoSelectionStore", () => ({
  useInfoSelectionStore: Object.assign(
    // hook for reactive selectors (InfoPopup uses this; MapChartRenderer uses getState() imperatively)
    (selector: (s: any) => any) => selector(_infoSelectionState),
    {
      getState: () => _infoSelectionState,
    }
  ),
}));

// Plan 23-02: useLastInfoClickContextStore mock — same imperative getState() pattern.
// MapChartRenderer.tsx singleclick handler calls .getState().setContext({...}) before fan-out.
vi.mock("../../store/lastInfoClickContextStore", () => ({
  useLastInfoClickContextStore: Object.assign(
    (selector: (s: any) => any) => selector(_lastInfoClickContextState),
    {
      getState: () => _lastInfoClickContextState,
    }
  ),
}));

// Phase 21 + quick-260608-j5k + quick-260608-rbq: mapInfoConfig mock — expose real values for all getters.
vi.mock("../../lib/mapInfoConfig", () => ({
  getInfoEnabled: (cfg: any) => cfg?.infoEnabled ?? true,
  getInfoRadiusPx: (cfg: any) => cfg?.infoRadiusPx ?? 3,
  getInfoPopupWidthPx: (cfg: any) => cfg?.infoPopupWidthPx ?? 360,
  getInfoPopupHeightPx: (cfg: any) => cfg?.infoPopupHeightPx ?? 400,
  getShowShapeMeasurements: (cfg: any) => cfg?.showShapeMeasurements ?? true,
  // quick-260608-j5k: opt-in controls — default false so legacy tests are byte-identical
  getShowScaleBar: (cfg: any) => cfg?.showScaleBar ?? false,
  getShowFullscreenButton: (cfg: any) => cfg?.showFullscreenButton ?? false,
  // quick-260608-rbq: loading indicator — default TRUE (opt-out; legacy widgets get indicator ON)
  getShowLoadingIndicator: (cfg: any) => cfg?.showLoadingIndicator ?? true,
  // Phase 104 (MAPSYNC-V119-01/06): opt-in sync — default false (legacy byte-identical)
  getSyncViewportEnabled: (cfg: any) => cfg?.syncViewport ?? false,
  // Phase 112 (MAPVIEW-V121-02/-03): mirrors the real getDefaultView — a plain passthrough,
  // undefined is the correct "no default" result (substituted by resolveInitialView).
  getDefaultView: (cfg: any) => cfg?.defaultView,
  DEFAULT_INFO_ENABLED: true,
  DEFAULT_INFO_RADIUS_PX: 3,
  DEFAULT_SHOW_SHAPE_MEASUREMENTS: true,
  DEFAULT_SHOW_SCALE_BAR: false,
  DEFAULT_SHOW_FULLSCREEN_BUTTON: false,
  DEFAULT_SHOW_LOADING_INDICATOR: true,
  DEFAULT_SYNC_VIEWPORT: false,
}));

// Phase 104 (MAPSYNC-V119): mapViewportSyncStore mock — module-level mutable state pattern.
// publish + reset are vi.fn()s so tests can assert call args.
// getState().publish() is the imperative form used inside the moveend handler.
// The hook form (selector) is used by the incomingViewport subscription.
const _syncStoreState = {
  viewports: {} as Record<number, { center: [number, number]; zoom: number; originWidgetId: number; bump: number } | undefined>,
  publish: vi.fn((dashboardId: number, snap: any) => {
    _syncStoreState.viewports[dashboardId] = snap;
  }),
  clear: vi.fn(),
  reset: vi.fn(() => { _syncStoreState.viewports = {}; }),
};

vi.mock("../../store/mapViewportSyncStore", () => {
  const hook = (selector: (s: any) => any) => selector(_syncStoreState);
  (hook as any).getState = () => _syncStoreState;
  return { useMapViewportSyncStore: hook };
});

// Phase 111 (MAPVIEW-V121-01): mapCurrentViewStore mock — mirrors the Phase 104 sync-store
// mock shape. publish/clear are vi.fn()s so tests can assert the always-on publish + cleanup.
const _currentViewState = {
  views: {} as Record<number, { center: [number, number]; zoom: number } | undefined>,
  publish: vi.fn((widgetId: number, view: { center: [number, number]; zoom: number }) => {
    _currentViewState.views[widgetId] = view;
  }),
  clear: vi.fn((widgetId: number) => { delete _currentViewState.views[widgetId]; }),
  reset: vi.fn(() => { _currentViewState.views = {}; }),
};

vi.mock("../../store/mapCurrentViewStore", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hook = (selector: (s: any) => any) => selector(_currentViewState);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (hook as any).getState = () => _currentViewState;
  return { useMapCurrentViewStore: hook };
});

// Phase 21: InfoPopup mock — renders minimal sentinel so we can confirm it mounts
vi.mock("./InfoPopup", () => ({
  default: vi.fn((_props: any) => null),
}));

// Phase 29 Plan 03: MapDrawToolbar mock — renders a minimal accessible toolbar.
// The real component is tested in MapDrawToolbar.spec.tsx. Here we only need to
// verify that MapChartRenderer mounts it with the right props.
vi.mock("./MapDrawToolbar", () => ({
  default: vi.fn((props: any) => {
    // Expose props via data attributes so tests can assert without importing the component.
    return (
      <div
        role="toolbar"
        aria-label="Drawing tools"
        data-shapes-count={props.shapesCount}
        data-draw-mode={props.drawMode}
      >
        {props.shapesCount > 0 && (
          <button aria-label="Clear all shapes" onClick={props.onClearAll} />
        )}
        <button aria-label="Draw bounding box" onClick={() => props.onModeChange("bbox")} />
      </div>
    );
  }),
}));

/* ------------------------------------------------------------------ */
/*  Phase 29 Plan 03: VectorLayer + VectorSource + WKT mocks           */
/* ------------------------------------------------------------------ */

// Per-test tracking for VectorLayer + VectorSource instances
let lastVectorSourceInstance: any = null;
let lastVectorLayerInstance: any = null;
// Per-test tracking for all VectorSource instances (multi-map test V14)
const allVectorSourceInstances: any[] = [];
const allVectorLayerInstances: any[] = [];

vi.mock("ol/layer/Vector", () => ({
  default: vi.fn().mockImplementation(function MockVectorLayer(this: any, opts: any) {
    this._opts = opts;
    this._zIndex = opts?.zIndex ?? 0;
    this._styleFn = opts?.style;
    this.getZIndex = vi.fn(() => this._zIndex);
    this.setZIndex = vi.fn((v: number) => { this._zIndex = v; });
    this.setMap = vi.fn();
    // Phase 29 Plan 05: changed() triggers a style re-evaluation across all features.
    this.changed = vi.fn();
    lastVectorLayerInstance = this;
    allVectorLayerInstances.push(this);
    return this;
  }),
}));

vi.mock("ol/source/Vector", () => ({
  default: vi.fn().mockImplementation(function MockVectorSource(this: any) {
    this._features = [] as any[];
    this.clear = vi.fn((_fast?: boolean) => { this._features = []; });
    this.addFeature = vi.fn((f: any) => { this._features.push(f); });
    this.removeFeature = vi.fn((f: any) => {
      this._features = this._features.filter((feat: any) => feat !== f);
    });
    this.getFeatures = vi.fn(() => this._features);
    lastVectorSourceInstance = this;
    allVectorSourceInstances.push(this);
    return this;
  }),
}));

vi.mock("ol/style", () => ({
  Style: vi.fn().mockImplementation(function MockStyle(this: any, opts: any) {
    this._fill = opts?.fill;
    this._stroke = opts?.stroke;
    this.getFill = vi.fn(() => this._fill);
    this.getStroke = vi.fn(() => this._stroke);
    return this;
  }),
  Fill: vi.fn().mockImplementation(function MockFill(this: any, opts: any) {
    this._color = opts?.color;
    this.getColor = vi.fn(() => this._color);
    return this;
  }),
  Stroke: vi.fn().mockImplementation(function MockStroke(this: any, opts: any) {
    this._color = opts?.color;
    this._width = opts?.width;
    this.getColor = vi.fn(() => this._color);
    this.getWidth = vi.fn(() => this._width);
    return this;
  }),
}));

vi.mock("ol/Feature", () => ({
  default: vi.fn().mockImplementation(function MockFeature(this: any, opts: any) {
    this._geometry = opts?.geometry;
    this._id = undefined as any;
    this._props = {} as Record<string, any>;
    this.setId = vi.fn((id: any) => { this._id = id; });
    this.getId = vi.fn(() => this._id);
    this.set = vi.fn((key: string, val: any) => { this._props[key] = val; });
    this.get = vi.fn((key: string) => this._props[key]);
    this.getGeometry = vi.fn(() => this._geometry);
    return this;
  }),
}));

// Stub interior point that returns deterministic coordinates
const MOCK_INTERIOR_COORDS = [100, 200, 0];
const mockGeomInstance = {
  getInteriorPoint: vi.fn(() => ({
    getCoordinates: vi.fn(() => MOCK_INTERIOR_COORDS),
  })),
};

vi.mock("ol/format/WKT", () => ({
  default: vi.fn().mockImplementation(function MockWKT(this: any) {
    this.readGeometry = vi.fn((_wkt: string, _opts?: any) => mockGeomInstance);
    this.writeGeometry = vi.fn((_geom: any, _opts?: any) => "POLYGON(())");
    return this;
  }),
}));

/* ------------------------------------------------------------------ */
/*  Phase 29 Plan 04: OL Draw + Observable + sphere mocks              */
/* ------------------------------------------------------------------ */

// Per-test map from draw instance → captured handlers (drawstart/drawend)
const drawEventHandlers: Map<any, Record<string, Array<(evt: any) => void>>> = new Map();
// Last Draw instance created (for assertions)
let lastDrawInstance: any = null;

vi.mock("ol/interaction/Draw", () => ({
  default: vi.fn().mockImplementation(function MockDraw(this: any, _opts: any) {
    const handlers: Record<string, Array<(evt: any) => void>> = {};
    this._opts = _opts;
    this.on = vi.fn((event: string, handler: (evt: any) => void) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
    });
    this.abortDrawing = vi.fn();
    this.setActive = vi.fn();
    drawEventHandlers.set(this, handlers);
    lastDrawInstance = this;
    return this;
  }),
  createBox: vi.fn(() => vi.fn()),
  createRegularPolygon: vi.fn((_sides: number) => vi.fn()),
}));

// ol/Observable unByKey mock
vi.mock("ol/Observable", () => ({
  unByKey: vi.fn(),
}));

// ol/sphere mock — return deterministic values for getDistance and getArea
vi.mock("ol/sphere", () => ({
  getDistance: vi.fn((_c1: any, _c2: any) => 5000),   // 5 km default
  getArea: vi.fn((_geom: any, _opts?: any) => 12_400_000), // ~12.4 km²
}));

// ol/events mock (for EventsKey type — no runtime needed)
vi.mock("ol/events", () => ({}));

/* ------------------------------------------------------------------ */
/*  Phase 29 Plan 03: spatialFilterStore — use real Zustand store      */
/* ------------------------------------------------------------------ */

// The real useSpatialFilterStore is a proper Zustand hook that triggers React re-renders
// when shapes change (via shapesKey selector). The __mocks__/zustand.ts reset shim
// automatically resets the store to initial state after each test (afterEach).
// We do NOT mock this module — we use the real store so that:
//   1. The shapesKey selector fires Effect 7 when shapes change (real Zustand subscription)
//   2. Cross-map rendering (V14) works via a single shared store instance
// The _spatialFilterState alias is provided so existing beforeEach resets still compile.
// Individual tests use useSpatialFilterStore.getState().addShape/removeShape/clearAll directly.

// Import the real store for test use — must be done AFTER vi.mock calls for other modules.
// Declared here as a type-only import; the actual import is after the mock section.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _spatialFilterState = {
  // Proxy to the real store's getState() — accessed after import in test body.
  // beforeEach resets via __mocks__/zustand.ts afterEach shim.
  get shapes() {
    // This getter is used in beforeEach for length assertion; the real store is reset
    // by the zustand shim after each test.
    return [] as any[];
  },
};

/* ------------------------------------------------------------------ */
/*  Imports (after mocks)                                              */
/* ------------------------------------------------------------------ */

import MapChartRenderer, { pickPopupAnchor } from "./MapChartRenderer";
import OlMap from "ol/Map";
import ScaleLine from "ol/control/ScaleLine";
import FullScreen from "ol/control/FullScreen";
import OlView from "ol/View";
import { useSpatialFilterStore } from "../../store/spatialFilterStore";
import { useThemeStore } from "../../store/theme";
import { DashboardContextProvider } from "../DashboardContext";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const makeWidget = (configOverride: Record<string, unknown> = {}): WidgetDto => ({
  id: 10,
  dashboard_id: 1,
  title: "My Map",
  type: "map",
  position: 0,
  config: { basemap: "osm", ...configOverride },
  created_at: "2026-05-05T00:00:00Z",
  updated_at: "2026-05-05T00:00:00Z",
});

const defaultTables: TableDto[] = [
  {
    id: 10,
    name: "t10",
    schema: "public",
    columns: { lat: "double", lon: "double" },
    created_at: "2026-05-05T00:00:00Z",
    updated_at: "2026-05-05T00:00:00Z",
  },
  {
    id: 11,
    name: "t11",
    schema: "public",
    columns: { lat: "double", lon: "double" },
    created_at: "2026-05-05T00:00:00Z",
    updated_at: "2026-05-05T00:00:00Z",
  },
];

const makeLayer = (overrides: Partial<DashboardLayerDto> = {}): DashboardLayerDto => ({
  id: 1,
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

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */


const AI_VIEW = "_kbi_ai_ualice_s01234567_n0a1b2c3d_3";
const AI_VIEW_2 = "_kbi_ai_ualice_s01234567_n0a1b2c3d_4";

describe("Phase 139 AI dynamic view bound map layers (negative dynamic_view_id)", () => {
  beforeEach(() => {
    _comboVizToHash = {};
    _comboRegistry = {};
    _filterState.filters = {};
    _filterState.filterVersion = 0;
    _layersState.layers = [];
    _filterViewState.views = {};
    _filterViewState.dvViews = {};
    _dynamicViewState.views = {};
    _dynamicViewState.dynamicViewVersion = 0;
    lastMapInstance = null;
    lastBasemapLayerInstance = null;
    tileLoadListeners = {};
    allImageLayerInstances.length = 0;
    allImageWmsInstances.length = 0;
    vi.clearAllMocks();
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // table_id 10 exists in defaultTables; the dv-bound layer keeps its base table for tableMeta.
  const layer = () => makeLayer({ id: 1, position: 0, table_id: 10, dynamic_view_id: -3 });
  const ctorParams = async () => {
    const Ctor = (await import("ol/source/ImageWMS")).default as any;
    return Ctor.mock.calls.map((c: any[]) => c[0].params);
  };

  // Site 1: Effect 2 (ImageWMS construction, MapChartRenderer ~L1325).
  it("MAPDV-1: site 1 (Effect 2 construction): materialized -3 -> constructed LAYERS is the AI view name", async () => {
    _dynamicViewState.views = {
      [-3]: { viewName: AI_VIEW, status: "materialized", expiresAt: Date.now() + 60_000 },
    };
    _dynamicViewState.dynamicViewVersion = 2;
    _layersState.layers = [layer()];
    await act(async () => {
      render(<MapChartRenderer widget={makeWidget()} tables={defaultTables} />);
    });
    const all = await ctorParams();
    expect(all.length).toBe(1);
    expect(all[0].LAYERS).toBe(AI_VIEW);
    expect(all[0].LAYERS).not.toBe("public.t10");
    expect(all[0]._mv).toBe("2");
  });

  // Site 2: Effect 3 (updateParams, MapChartRenderer ~L1585). Trigger: an already-constructed
  // source whose AI view is re-materialized under a NEW name (viewName moves dynamicViewsKey).
  it("MAPDV-2: site 2 (Effect 3 updateParams): -3 re-materialized under a new name -> updateParams LAYERS is the new AI view name", async () => {
    _dynamicViewState.views = {
      [-3]: { viewName: AI_VIEW, status: "materialized", expiresAt: Date.now() + 60_000 },
    };
    _layersState.layers = [layer()];
    const { rerender } = render(<MapChartRenderer widget={makeWidget()} tables={defaultTables} />);
    await act(async () => {});
    expect(allImageWmsInstances.length).toBe(1);
    const src = allImageWmsInstances[0];
    src.updateParams.mockClear();

    _dynamicViewState.views = {
      [-3]: { viewName: AI_VIEW_2, status: "materialized", expiresAt: Date.now() + 60_000 },
    };
    _dynamicViewState.dynamicViewVersion = 1;
    await act(async () => {
      rerender(<MapChartRenderer widget={makeWidget()} tables={defaultTables} />);
    });
    expect(src.updateParams).toHaveBeenCalled();
    const arg = src.updateParams.mock.calls[src.updateParams.mock.calls.length - 1][0];
    expect(arg.LAYERS).toBe(AI_VIEW_2);
    expect(arg.LAYERS).not.toBe("public.t10");
  });

  it("MAPDV-3: -3 pending names no base-table tile request; pending -> materialized issues a request with the AI view name", async () => {
    _dynamicViewState.views = { [-3]: { viewName: AI_VIEW, status: "pending" } };
    _layersState.layers = [layer()];
    const { rerender } = render(<MapChartRenderer widget={makeWidget()} tables={defaultTables} />);
    await act(async () => {});
    // While pending: nothing constructed, so no tile request can name the base table.
    expect(allImageWmsInstances.length).toBe(0);
    expect((await ctorParams()).some((p: any) => p.LAYERS === "public.t10")).toBe(false);

    _dynamicViewState.views = {
      [-3]: { viewName: AI_VIEW, status: "materialized", expiresAt: Date.now() + 60_000 },
    };
    _dynamicViewState.dynamicViewVersion = 1;
    await act(async () => {
      rerender(<MapChartRenderer widget={makeWidget()} tables={defaultTables} />);
    });
    const all = await ctorParams();
    expect(all.length).toBe(1);
    expect(all[0].LAYERS).toBe(AI_VIEW);
    expect(all.some((p: any) => p.LAYERS === "public.t10")).toBe(false);
  });

  it("MAPDV-4: -3 over_threshold -> same overlay as a positive dv; no ImageWMS for the base table", async () => {
    _dynamicViewState.views = {
      [-3]: { viewName: AI_VIEW, status: "over_threshold", reason: "no_filter" },
    };
    _layersState.layers = [layer()];
    await act(async () => {
      render(<MapChartRenderer widget={makeWidget()} tables={defaultTables} />);
    });
    expect(allImageWmsInstances.length).toBe(0);
    expect((await ctorParams()).length).toBe(0);
    expect(screen.getByText("Some layers over threshold")).toBeInTheDocument();
  });
});
