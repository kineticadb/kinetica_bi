/**
 * Phase 12: MapChartRenderer — N-layer ImageWMS stack, per-layer filter subscription,
 * old-config reconfigure overlay, empty-state overlay, basemap swap.
 *
 * PITFALL M-01 lock: `map.setTarget(undefined); map.dispose()` in cleanup; mapRef guard
 *   prevents React 18 StrictMode's double-invoke from constructing two Map instances.
 * PITFALL M-02 lock: filter changes call `source.updateParams()` per layer — NEVER rebuild the Map.
 *   `_v=filterVersion` is always included as a cache-buster (per layer).
 * PITFALL M-03 lock: OL View is locked to `EPSG:3857`; ImageWMS request includes `SRS=EPSG:3857`.
 * PITFALL S-02 lock: `filterVersion` (primitive) is the useEffect dep — NEVER the array reference.
 *   eslint-disable comment for table filter deps is intentional: filterVersion always advances on mutation.
 * PITFALL C-02 lock: per-layer filter subscription reads `filters[layer.table_id]` — NEVER `s.filters` whole.
 * AP-3 lock (carry-forward, type-enforced via Phase 16 wmsUrlBuilder signature change):
 *   server-side WHERE only. The buildWmsParams arg list NO LONGER accepts whereClause.
 *   Phase 16 (MAP-V13-01..06) replaces the LAYERS param wholesale with the LAYERS-swap:
 *   LAYERS=<viewName> when filtered, LAYERS=<schema.table> otherwise. _v cache-buster
 *   renamed to _mv (materialize version) and made conditional on viewName presence.
 * AP-1 lock: filter state lives ONLY in useFilterStore — no useState shadow copies.
 * Phase 11-10: switched from TileWMS + TileLayer to ImageWMS + ImageLayer for single-image rendering.
 *   Kinetica WMS renders better as a single image (no tile-seam artifacts).
 * Phase 12-02: bboxHelper import removed; auto-fit-on-mount (Effect 5) + zoom-to-data button removed.
 * Phase 12-05: HARD CUTOVER — N-layer stack driven by useDashboardLayersStore + widget.config.includedLayerIds.
 *   Old-config Phase 11 widgets (spatialMode set, includedLayerIds absent) render the reconfigure overlay.
 *   Per-layer filter subscription key MUST use top-level `layer.table_id` (DashboardLayerDto column),
 *   Per-layer filter subscription key MUST use top-level `layer.table_id` — the DashboardLayerDto field
 *   (a SQLite column on dashboard_layers). The config field for tableId is always undefined in Phase 12.
 */

import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import OlMap from "ol/Map";
import OlView from "ol/View";
import TileLayer from "ol/layer/Tile";
import ImageLayer from "ol/layer/Image";
import OSM from "ol/source/OSM";
import XYZ from "ol/source/XYZ";
import ImageWMS from "ol/source/ImageWMS";
import { defaults as defaultControls } from "ol/control";
import Attribution from "ol/control/Attribution";
import ScaleLine from "ol/control/ScaleLine";
import FullScreen from "ol/control/FullScreen";
import type Control from "ol/control/Control";
import Overlay from "ol/Overlay";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Style, Fill, Stroke } from "ol/style";
import Feature from "ol/Feature";
import WKT from "ol/format/WKT";
import type Polygon from "ol/geom/Polygon";
import Draw from "ol/interaction/Draw";
import { unByKey } from "ol/Observable";
import type { EventsKey } from "ol/events";
import type LineString from "ol/geom/LineString";
import { getDistance } from "ol/sphere";
import { transform, transformExtent } from "ol/proj";
import "ol/ol.css";

import type { WidgetDto, TableDto } from "../../api/client";
import { UNAUTHORIZED_EVENT, API_BASE } from "../../api/client";
import { infoQuery, type InfoSpatialMode } from "../../api/client";
import { wrapLongitude } from "../../lib/geoWrap";
import { useFilterStore } from "../../store/filterStore";
import { useFilterViewStore } from "../../store/filterViewStore";
import { useFilterCombinationStore } from "../../store/filterCombinationStore";
import { NOFILTER_SENTINEL } from "../../lib/stableComboHash";
import { useDashboardContextOptional } from "../DashboardContext";
import { useDynamicViewStore } from "../../store/dynamicViewStore";
import { isViewExpired } from "../../lib/viewExpiry";
import { useToastStore } from "../../store/toast";
import { buildWmsParams, type MapWidgetConfig, coalesceTrackConfig } from "../../lib/wmsUrlBuilder";
import { isLayerEffectivelyVisible } from "../../lib/layerVisibility";
import { getSpatialTargets, isSpatialTargetEligible } from "../../lib/spatialTargets";
import { buildSpatialColumns } from "../../lib/spatialColumns";
import { useDashboardLayersStore } from "../../store/dashboardLayersStore";
import { useThemeStore } from "../../store/theme";
import type { DashboardLayerDto } from "../../api/client";
import { useInfoSelectionStore } from "../../store/infoSelectionStore";
import { useLastInfoClickContextStore } from "../../store/lastInfoClickContextStore";
import {
  getInfoEnabled,
  getInfoRadiusPx,
  getInfoPopupWidthPx,
  getInfoPopupHeightPx,
  getShowShapeMeasurements,
  getShowScaleBar,
  getShowFullscreenButton,
  getShowLoadingIndicator,
} from "../../lib/mapInfoConfig";
import InfoPopup from "./InfoPopup";
import {
  buildDrawInteraction,
  computeMeasurement,
  isDegenerateExtent,
  formatDistance,
  type DrawMode,
} from "../../lib/shapeDraw";
import { useSpatialFilterStore } from "../../store/spatialFilterStore";
import MapDrawToolbar from "./MapDrawToolbar";
import MapZoomToolbar from "./MapZoomToolbar";
import { LayersLegendPanel } from "../LayersLegendPanel";
import type { ResolvedLegendLayer, DvLayerStatus } from "../LayersLegendPanel";
import { resolveLegendLayers } from "../../lib/resolveLegendLayers";
import { computeFilterScopeSummary } from "../../lib/useFilterScopeSummary";
import { useAuthStore } from "../../store/auth";
import { applyLayerOverrides } from "../../lib/applyLayerOverrides";
import { useLayerVisibilityToggle } from "../../hooks/useLayerVisibilityToggle";
import { useWidgetActionStore } from "../../store/widgetActionStore";
import { getLegendPanelEnabled, getLegendPanelCorner } from "../../lib/legendPanelConfig";

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

type Props = {
  widget: WidgetDto;
  // Phase 12: each layer carries its own table binding via top-level DashboardLayerDto.table_id.
  // `tables` is the dashboard's associated tables, used to resolve table_id → schema.name for the
  // WMS LAYERS param (buildWmsParams reads `tableRef`). Optional for tests; defaults to [].
  tables?: TableDto[];
};

type TileErrorState = { count: number; lastAt: number } | null;

/* ------------------------------------------------------------------ */
/*  Module-level helpers                                                */
/* ------------------------------------------------------------------ */

/**
 * Base zIndex offset for WMS image layers. Must stay above the basemap TileLayer
 * (which is opaque and defaults to zIndex 0) for any realistic layer count.
 * Image layer zIndex = LAYER_Z_BASE - position, so position 0 paints on top.
 */
const LAYER_Z_BASE = 1000;

/**
 * Phase 29 (SHAPE-V15-01): Per-type fixed color palette — locked by 29-UI-SPEC.md.
 * Bbox = blue, Lasso = green, Circle = orange. Fill = 10% opacity of the stroke color.
 * Overlap-additive fills produce darker areas on multi-shape overlap (semantically correct
 * for OR-composed spatial filters).
 */
const SHAPE_COLORS: Record<"bbox" | "lasso" | "circle", { fill: string; stroke: string }> = {
  bbox:   { fill: "rgba(37, 99, 235, 0.10)",  stroke: "#2563eb" },
  lasso:  { fill: "rgba(22, 163, 74, 0.10)",  stroke: "#16a34a" },
  circle: { fill: "rgba(234, 88, 12, 0.10)",  stroke: "#ea580c" },
};

/**
 * Determine if a layer config has enough spatial information to build an ImageWMS source.
 * Returns false when spatialMode is missing or required column(s) are not set.
 */
export function isConfigComplete(config: Partial<MapWidgetConfig>): boolean {
  if (!config.spatialMode) return false;
  if (config.spatialMode === "latlon") {
    return !!config.latColumn && !!config.lonColumn;
  }
  if (config.spatialMode === "wkt") {
    return !!config.wktColumn;
  }
  if (config.spatialMode === "wkb") {
    return !!config.wkbColumn;
  }
  // Phase 52: track mode requires all four track fields to be set (xCol, yCol, trackIdAttr, trackOrderAttr).
  // Configuration is complete only when the operator has seeded all four column assignments.
  if (config.spatialMode === "track") {
    const tc = coalesceTrackConfig((config as { track_config?: string | null }).track_config ?? null);
    return !!tc.xCol && !!tc.yCol && !!tc.trackIdAttr && !!tc.trackOrderAttr;
  }
  return false;
}

/**
 * Apply an inclusive [minZoom, maxZoom] range to an OL ImageLayer.
 *
 * Wire format (layer.config) uses INCLUSIVE semantics — `[3, 10]` means
 * "show at zoom 3, 4, 5, ..., 10". OL's BaseLayer convention is:
 *   - minZoom is EXCLUSIVE (visible when view.zoom > minZoom)
 *   - maxZoom is INCLUSIVE (visible when view.zoom <= maxZoom)
 * Translation: internalMin = userMin - 1, internalMax = userMax.
 *
 * `undefined` values on the wire mean "no constraint" → fall back to OL's
 * defaults (-Infinity / Infinity) so the layer renders at every zoom.
 *
 * Idempotent: skips setMinZoom / setMaxZoom when the current OL value
 * already matches the target (avoids unnecessary OL renderFrame triggers
 * during config edits).
 */
export function applyZoomRangeToLayer(
  imageLayer: import("ol/layer/Image").default<any>,
  config: { minZoom?: number; maxZoom?: number },
): void {
  // INCLUSIVE userMin → EXCLUSIVE internal: subtract 1. When undefined → -Infinity.
  const nextMinZoom =
    config.minZoom === undefined ? -Infinity : config.minZoom - 1;
  // INCLUSIVE userMax → INCLUSIVE internal: pass through. When undefined → Infinity.
  const nextMaxZoom =
    config.maxZoom === undefined ? Infinity : config.maxZoom;
  if (imageLayer.getMinZoom() !== nextMinZoom) {
    imageLayer.setMinZoom(nextMinZoom);
  }
  if (imageLayer.getMaxZoom() !== nextMaxZoom) {
    imageLayer.setMaxZoom(nextMaxZoom);
  }
}

/**
 * Phase 12 hard cutover: detect Phase 11 widgets that have a single-WMS config shape
 * (spatialMode + render params on the widget itself) but no `includedLayerIds`.
 * These widgets render the reconfigure overlay until the user re-creates layers.
 */
export function isOldPhase11Config(config: Record<string, unknown>): boolean {
  return config.spatialMode !== undefined && config.includedLayerIds === undefined;
}

type BasemapType = "osm" | "voyager" | "dark";

/**
 * Create an OL tile source for the given basemap type.
 * All three use EPSG:3857 (Web Mercator), no API key required.
 */
export function basemapSourceFor(basemap: BasemapType | string | undefined): OSM | XYZ {
  switch (basemap) {
    case "voyager":
      return new XYZ({
        url: "https://{a-c}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
        attributions: "© <a href='https://carto.com/attributions'>CARTO</a> © <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap contributors</a>",
      });
    case "dark":
      return new XYZ({
        url: "https://{a-c}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        attributions: "© <a href='https://carto.com/attributions'>CARTO</a> © <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap contributors</a>",
      });
    case "osm":
    default:
      return new OSM();
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Convert an ArrayBuffer to a base64-encoded string.
 * Matches the pattern used in mapComponents/KWmsOlLayer.js (base64ArrayBuffer).
 * Using Uint8Array + String.fromCharCode in chunks avoids call-stack overflow
 * for large PNG responses.
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Edge-aware popup anchor picker.
 *
 * Given the click pixel coords (within the map element), the map size, and the
 * popup width/height, returns the OL Overlay `positioning` + `offset` that keeps
 * the popup inside the map's visible area.
 *
 * Preference order (post-VERIFY operator request — prefer BELOW the cursor
 * when space allows; above is the fallback):
 *   1. bottom-right of cursor (anchor "top-left",     offset [0,  gap])  ← default
 *   2. bottom-left of cursor  (anchor "top-right",    offset [0,  gap])
 *   3. top-right of cursor    (anchor "bottom-left",  offset [0, -gap])
 *   4. top-left of cursor     (anchor "bottom-right", offset [0, -gap])
 *   5. fallback: bottom-right (matches the new default behavior)
 *
 * Pure function — no DOM access, no React. Easy to unit-test.
 */
type PopupAnchor = {
  positioning: "bottom-left" | "bottom-right" | "top-left" | "top-right";
  offset: [number, number];
};
const POPUP_ANCHOR_GAP_PX = 8;
export function pickPopupAnchor(
  clickPx: [number, number],
  mapSize: [number, number],
  popupW: number,
  popupH: number,
): PopupAnchor {
  const [cx, cy] = clickPx;
  const [mapW, mapH] = mapSize;
  const gap = POPUP_ANCHOR_GAP_PX;
  const fitsAbove = cy - popupH - gap >= 0;
  const fitsBelow = cy + popupH + gap <= mapH;
  const fitsRight = cx + popupW <= mapW;
  const fitsLeft = cx - popupW >= 0;
  // Prefer below-cursor — the popup reveals records associated with the
  // clicked point and the operator's eye is already there; opening downward
  // (the natural reading direction) keeps the click anchor in view.
  if (fitsBelow && fitsRight) return { positioning: "top-left", offset: [0, gap] };
  if (fitsBelow && fitsLeft) return { positioning: "top-right", offset: [0, gap] };
  if (fitsAbove && fitsRight) return { positioning: "bottom-left", offset: [0, -gap] };
  if (fitsAbove && fitsLeft) return { positioning: "bottom-right", offset: [0, -gap] };
  // No corner fits cleanly — fall back to bottom-right (matches the new default).
  return { positioning: "top-left", offset: [0, gap] };
}

// GAP-24-01-A ROOT CAUSE (Phase 24-04 Task 1, 2026-05-11):
//   Symptom: toggling a layer's visibility OFF in LayersModal blanks the entire app
//            (dark-blue background, no dashboard, no widgets, no topbar). Page refresh
//            required to recover. Screenshot:
//            .planning/phases/24-verification/screenshots/24-01-task1-layer-visibility-blank-app.png
//   Captured stack: Live capture not possible from this execution environment (no dev
//            browser). Static-code root-cause via the four-hypothesis grid in
//            .planning/phases/24-verification/24-04-PLAN.md <interfaces>. Live re-walk
//            after the fix is the verification gate (Task 3 vitest + STEP 24-01 re-walk).
//   Failing file:line: src/components/charts/MapChartRenderer.tsx:468-469
//            (source.on("imageloaderror", handleTileError) / source.on("imageloadend",
//             handleTileLoadEnd) — listeners attached but never unsubscribed before
//             map.removeLayer fires in Effect 2's REMOVE loop at lines 408-416).
//   Root cause: **stale OL source-listener race** (hypothesis category: stale-listener
//            race). When the eye-toggle flips a layer's config.visible to false, Effect 2
//            calls map.removeLayer(imageLayer); existing.delete(id); imageSourcesRef.delete(id).
//            However, the ImageWMS source's `imageloaderror` and `imageloadend` listeners
//            (attached at lines 468-469) are NEVER unsubscribed. The source object — and
//            its in-flight XHR image-load (started by setImageLoadFunction's XHR loader)
//            — outlives the removeLayer call. When the in-flight image-load completes
//            after removal, the listener's handleTileError invokes setTileLoadError + the
//            debounced toast useToastStore.getState().showToast(...); handleTileLoadEnd
//            invokes setTileLoadError(null) + setErrorOverlayDismissed(true). These
//            setState calls land in a component whose owning React tree may already be
//            mid-reconciliation of the visibility-toggle render, OR the OL internal dispose
//            in map.removeLayer synchronously fires an imageloaderror that re-enters the
//            React render path before Effect 2 finishes. The re-entry on a half-updated
//            ref state (existing.delete already ran but image-source listener fires
//            synchronously) produces an uncaught exception that no ErrorBoundary catches
//            (grep -rn "ErrorBoundary" returns 0 matches), so React's default behavior
//            unmounts the root tree → blank dark-blue screen.
//   Why this hypothesis over the alternatives:
//     - DashboardsPage.handleLayerPatch (DashboardsPage.tsx:557-566) is pure: optimistic
//       store updateLayer + debounced server PATCH. dashboardLayersStore.updateLayer
//       (store/dashboardLayersStore.ts:36-46) is a pure object spread; cannot throw on a
//       {config: {...}} patch. Rules out FIX SHAPE C (onPatch null-deref).
//     - InfoPopup/InfoSelectionView ALREADY handles the toggled-off-active-layer case
//       gracefully (InfoSelectionView.tsx:104-108 useEffect calls onActiveLayerIneligible
//       when activeLayerId leaves eligibleLayers; the early return on line 297 prevents
//       null-deref). Rules out FIX SHAPE B (popup null-deref) as the primary culprit.
//     - The empty-state and visible:false-at-mount test (MapChartRenderer.spec.tsx Test E)
//       PASS, proving the render path itself handles the [] includedLayers case. The
//       failure must therefore be in the TRANSITION from visible→invisible at runtime,
//       which is exactly when in-flight image-loads can complete-after-remove.
//     - GAP-24-02-A (dashboard-switch crash at MapChartRenderer.tsx:483) has the same
//       async-after-detach shape; Phase 24-06 will fix it with a mountedRef cleanup-gate.
//       This GAP-24-01-A fix (per-listener unsubscribe in Effect 2's REMOVE loop) is the
//       orthogonal half of the same root cause family. Both must land for the OL-async vs
//       React-state lifecycle to be safe.
//   Fix shape (Task 2): FIX SHAPE A — store per-layer listener cleanup functions in a
//   sourceListenerCleanupRef Map. Attach listeners in the ADD branch and register the
//   `source.un(type, handler)` unsubscriber. Call the unsubscriber FIRST in the REMOVE
//   loop, BEFORE map.removeLayer(imageLayer). Also clear the ref Map in Effect 1's
//   cleanup alongside imageLayersRef.current.clear().

// GAP-24-02-A ROOT CAUSE (Phase 24-06 Task 1, 2026-05-11):
//   Symptom: switching from Dashboard A (with a map widget) to Dashboard B (also with
//            a map widget) throws `Error: Image load error` at the `map.addLayer(imageLayer)`
//            call site in Effect 2's ADD branch (currently MapChartRenderer.tsx:583)
//            followed by `Uncaught NotFoundError: Failed to execute 'insertBefore' on 'Node':
//            The node before which the new node is to be inserted is not a child of this
//            node.` Dashboard B does NOT render — operator sees the dark-blue
//            dashboard-switch-crash background. Screenshot:
//            .planning/phases/24-verification/screenshots/24-02-task2-dashboard-switch-crash.png
//   Captured stack: `NotFoundError` originates in OpenLayers' internal `ImageWMS#renderFrame`
//            path which calls `insertBefore` on the OL canvas-container parent node. That
//            parent was already detached from the DOM at the React-unmount step
//            (`map.setTarget(undefined)` in Effect 1's cleanup).
//   Failing file:line: src/components/charts/MapChartRenderer.tsx:583
//            (`map.addLayer(imageLayer)`) — this is Dashboard B's NEW map's addLayer call;
//            the exception actually fires from Dashboard A's leftover in-flight XHR
//            resolving and triggering OL's `image.getImage().src = "data:image/png;base64,..."`
//            on an orphan source (lines ~393 of imageLoadFunctionFor). The OL frame
//            scheduler then bubbles the resulting DOM-insert failure up the call stack —
//            React surfaces it at the most-recent addLayer call site, hence line 583.
//   Root cause: **async OL image-load completing AFTER React unmount**. The crash
//            timeline (from 24-06-PLAN.md <interfaces>):
//              t0  Dashboard A mounted; Effect 2 attached an ImageWMS source with
//                  `setImageLoadFunction(imageLoadFunctionFor())` (XHR-based loader).
//              t1  Dashboard A's WMS request fires; XHR is in flight.
//              t2  Operator clicks 'switch to Dashboard B'. React unmounts Dashboard A.
//                  Effect 1's cleanup runs: `map.setTarget(undefined)` detaches the OL
//                  container from the React DOM tree. GAP-24-01-A's per-layer
//                  `sourceListenerCleanupRef` ALSO detaches `imageloaderror` +
//                  `imageloadend` listeners — but does NOT abort the in-flight XHR
//                  (`xhr.onreadystatechange` is not held by any ref).
//              t3  Dashboard B begins mounting. New MapChartRenderer instance; new OL Map.
//                  Effect 2 fires: `new ImageWMS` → `map.addLayer(imageLayer)` (line 583).
//              t4  Dashboard A's leftover XHR resolves. `xhr.onreadystatechange` fires
//                  with `readyState === 4` (line 381-394); it sets
//                  `image.getImage().src = "data:image/png;base64,..."`. OL's image
//                  element is still bound to Dashboard A's (now-orphan) ImageWMS source,
//                  which is still tied to Dashboard A's (now-detached) container. OL's
//                  next renderFrame tries `insertBefore` on the detached container →
//                  the browser throws `NotFoundError`.
//              t5  React surfaces the exception. With no `ErrorBoundary` in `src/`
//                  (grep confirms 0 matches), React's default behavior unmounts the entire
//                  root tree → blank dark-blue screen replaces Dashboard B.
//   Why GAP-24-01-A's per-layer listener cleanup is INSUFFICIENT on its own:
//     GAP-24-01-A's sourceListenerCleanupRef unsubscribes `imageloaderror` and
//     `imageloadend` listeners — but the OL DOM-insert that throws happens INSIDE OL's
//     internal renderFrame, NOT inside the React-bound listeners. The XHR resolves and
//     mutates `image.getImage().src`; OL's frame scheduler does the DOM-insert
//     independent of listeners. Detaching the listeners stops setTileLoadError from
//     firing on an unmounted component (which is its own bug shape, captured in
//     GAP-24-01-A), but does NOT stop the orphan XHR → OL renderFrame → insertBefore
//     chain. The fix below stops the chain at the XHR onreadystatechange site.
//   Fix shape (Task 2): mountedRef cleanup-gate. Mirrors v1.3 Phase 15's
//   materializeAbortRef threading pattern (STATE.md Phase 15 LIFE-V13-04 decision).
//     1. `const mountedRef = useRef<boolean>(true);` at component top (alongside other refs).
//     2. Effect 1's cleanup return sets `mountedRef.current = false;` as the FIRST line
//        (BEFORE map.setTarget(undefined) + map.dispose() — so any callback firing during
//        teardown is also blocked).
//     3. imageLoadFunctionFor's `xhr.onreadystatechange`: guard with
//        `if (!mountedRef.current) return;` as the FIRST line of the `readyState === 4`
//        branch. Without this guard, `image.getImage().src = ...` triggers OL's DOM-insert
//        on the detached container.
//     4. handleTileError + handleTileLoadEnd: each guards with `if (!mountedRef.current) return;`
//        BEFORE any setState call. Defense in depth — GAP-24-01-A's listener cleanup
//        already handles the in-tree listener-detach case, but if a stale handler ref
//        survives (e.g., a future regression), this guard prevents setState-on-unmounted.
//     5. Effect 6 (singleclick handler) post-await sites: guard `if (!mountedRef.current) return;`
//        immediately after each `await infoQuery(...)` (the controller.signal.aborted check
//        does not cover post-unmount cases where the React tree is gone). Also at handler-top
//        and inside the catch block.
//   Paths to guard (Task 2):
//     1. imageLoadFunctionFor xhr.onreadystatechange (~line 381) — XHR loader.
//     2. handleTileError (~line 541) — OL `imageloaderror` listener.
//     3. handleTileLoadEnd (~line 553) — OL `imageloadend` listener.
//     4. Effect 6 singleclick handler — top of handler, post-await sites, catch block (~line 706-825).

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function MapChartRenderer({ widget, tables = [] }: Props) {
  const widgetConfig = (widget.config ?? {}) as Record<string, unknown>;

  // quick-260608-j5k: opt-in map-control flags (default false for legacy widgets). Derived at
  // component scope so the live control-sync effect can depend on the resolved booleans.
  const showScaleBarFlag = getShowScaleBar({
    showScaleBar: (widgetConfig as Partial<MapWidgetConfig>).showScaleBar,
  });
  const showFullscreenFlag = getShowFullscreenButton({
    showFullscreenButton: (widgetConfig as Partial<MapWidgetConfig>).showFullscreenButton,
  });

  // Theme-aware basemap: pick the basemap configured for the active app theme so the
  // base layer suits light/dark, and swap it live when the theme toggles. Legacy widgets
  // only have `basemap` — fall back to it (preserving their original look).
  const appTheme = useThemeStore((s) => s.theme);
  const effectiveBasemap =
    appTheme === "light"
      ? ((widgetConfig.basemapLight as string | undefined) ??
         (widgetConfig.basemap as string | undefined) ??
         "voyager")
      : ((widgetConfig.basemapDark as string | undefined) ??
         (widgetConfig.basemap as string | undefined) ??
         "dark");

  // ── Dashboard layers store subscription ─────────────────────────────────
  // PITFALL S-01 lock: layer list lives ONLY in useDashboardLayersStore.
  const allLayers = useDashboardLayersStore((s) => s.layers);

  // Phase 58 Plan 02 / Phase 58.1 Plan 01 (ENGINE-V111-03 map-layer render path):
  // Subscribe to the session overlay store for layer config overlays.
  // Merge overlays into allLayers AFTER reading from the layers store so that
  // the render pipeline (includedLayers / WMS / legend) sees the overlay-merged
  // values — including TOP-LEVEL track_config/cb_config fields and NESTED
  // config fields (renderMode/visible/opacity).
  //
  // Phase 58.1 deep-merge: applyWidgetAction stores DTO-shaped overlays:
  //   { config?: { renderMode?, visible?, opacity? }, track_config?, cb_config? }
  // We split the overlay into config patch vs top-level and deep-merge config
  // so config.renderMode (and other nested fields) actually change.
  // Null-safe: no override → return `l` unchanged (referentially stable).
  //
  // The [[track-config-toplevel-field]] invariant is preserved:
  //   track_config/cb_config are TOP-LEVEL and land directly on the merged object.
  //   renderMode/visible/opacity are NESTED and land inside the merged config blob.
  //
  // The CONFIG-TIME path (dashboardLayersStore.updateLayer) is untouched — this
  // is a RENDER-TIME overlay only; the store retains the saved config as baseline.
  const layerOverrides = useWidgetActionStore((s) => s.layerOverrides);
  // v1.14: merge via the shared applyLayerOverrides helper so the STANDALONE
  // LegendRenderer reads byte-identical overlay-merged layers (GAP-61-01 parity —
  // the standalone legend previously read the raw store and drifted from the map).
  const effectiveLayers = useMemo(
    () => applyLayerOverrides(allLayers, layerOverrides),
    [allLayers, layerOverrides]
  );

  // PITFALL S-02 lock: primitive filterVersion dep only — never the array reference.
  const filterVersion = useFilterStore((s) => s.filterVersion);

  // Post-VERIFY (Phase 35 follow-up): dashboard's dynamic-view list — feeds the
  // effective-visibility check below so layers whose dv binding is orphaned (dv
  // deleted upstream) or whose dv has no name auto-hide from the WMS stack.
  // Sourced from DashboardContext (populated by useDynamicViewMaterializeChain
  // mount-fetch + dynamicViewVersion-watch).
  //
  // Lenient variant — falls back to null when no provider is mounted. Legacy
  // MapChartRenderer.spec fixtures render the component without wrapping in a
  // provider, so we gate the dv-orphan check on `applyDvOrphanCheck`: only
  // enforce the dv-existence requirement when we have a list to check against.
  // Production always has the provider (DashboardOpen mounts it), so the
  // orphan check always runs there. In tests without a provider, dv-bound
  // layers fall through to the existing buildWmsParams gating (which still
  // returns null for pending/over_threshold/error status → layer skip).
  const dashboardCtx = useDashboardContextOptional();
  const dashboardDynamicViews = dashboardCtx?.dynamicViews ?? [];
  const applyDvOrphanCheck = dashboardCtx !== null;

  // Resolve the set of layers to render based on includedLayerIds and effective
  // visibility (operator preference AND source validity).
  // Phase 12 lazy/inclusive default: empty or undefined includedLayerIds = all layers ON.
  // Post-VERIFY: effective-visibility check via `isLayerEffectivelyVisible` —
  // auto-hides layers when their table or dynamic-view source is missing / null /
  // empty string. Prevents broken WMS requests + visible-but-unrenderable layer
  // rows. The operator's `config.visible` preference is preserved (not flipped);
  // the layer simply doesn't render until the source is rebound.
  const includedLayers = useMemo<DashboardLayerDto[]>(() => {
    const ids = widgetConfig.includedLayerIds as number[] | undefined;
    // Phase 58 Plan 02: use effectiveLayers (overlay-merged) instead of allLayers
    // so the WMS/legend pipeline reads the overlay-merged config (incl. top-level
    // track_config/cb_config/render_mode/visible/opacity).
    const filtered =
      ids === undefined || ids.length === 0
        ? effectiveLayers
        : effectiveLayers.filter((l) => ids.includes(l.id));
    const visible = filtered.filter((l) => {
      const userVisible =
        (l.config as { visible?: boolean }).visible !== false;
      if (!userVisible) return false;
      // Apply the dv-orphan check only when we have a context-provided
      // dynamic-view list to validate against. See `applyDvOrphanCheck` above.
      if (applyDvOrphanCheck) {
        return isLayerEffectivelyVisible(l, tables, dashboardDynamicViews);
      }
      return true;
    });
    // Sort by position ascending (render-order lock).
    return visible.slice().sort((a, b) => a.position - b.position);
  }, [
    effectiveLayers,
    widgetConfig.includedLayerIds,
    tables,
    dashboardDynamicViews,
    applyDvOrphanCheck,
  ]);

  // Phase 92 (READ-V118-02): per-layer combination view dep-key. Replaces viewsKey.
  // Scoped to THIS map's includedLayers (Pitfall 3 — NOT the whole registry), table-bound only,
  // per-layer (two layers on the same table can have distinct future filterScopes). Primitive
  // joined string (S-02 — Pitfall 2) so Effects 2+3 re-fire only when a bound combo view changes.
  const comboViewsKey = useFilterCombinationStore((s) =>
    includedLayers
      .filter((l) => l.dynamic_view_id === null || l.dynamic_view_id === undefined)
      .map((l) => {
        const hash = s.vizToHash[`l:${l.id}`];
        const entry = hash && !hash.endsWith(`:${NOFILTER_SENTINEL}`) ? s.registry[hash] : undefined;
        return `${l.id}:${entry?.viewName ?? ""}:${entry?.materializeVersion ?? 0}:${entry?.materializing ? "1" : "0"}`;
      })
      .join("|"),
  );

  // Phase 35 (DV-V16-13) — Pitfall 7 lock (35-RESEARCH.md §"Pitfall 7" verbatim):
  // dynamic-view-bound layers need their own primitive key so Effects 2 + 3 re-fire when
  // a dv re-materializes. The filter-view path's viewsKey doesn't move when only the dv
  // store changes (dv viewName/status are tracked in useDynamicViewStore.views, NOT in
  // useFilterViewStore), so without this selector a pending→materialized transition would
  // leave dv-bound layers stuck without their LAYERS-swap.
  //
  // Sorted ascending by dv id for stability across drag-reorder of includedLayers.
  // Includes both viewName + status so the key moves on EITHER a viewName population
  // (markPending → store-write) OR a status flip (pending → materialized / over_threshold / error).
  // Filtered to layers with dynamic_view_id !== null — no segment for plain table-bound layers.
  const dynamicViewsKey = useDynamicViewStore((s) =>
    includedLayers
      .filter((l) => l.dynamic_view_id !== null && l.dynamic_view_id !== undefined)
      .map((l) => l.dynamic_view_id!)
      .sort((a, b) => a - b)
      .map((id) =>
        `${id}:${s.views[id]?.viewName ?? ''}:${s.views[id]?.status ?? ''}`
      )
      .join('|')
  );

  // Phase 94 (FSCOPE-V118-03): dv-COMBO re-render subscription. Replaces Phase 63.1 dvFilterViewsKey
  // (which read filterViewStore.dvViews). MapChartRenderer dv-layer read-path is now
  // filterCombinationStore.vizToHash["l:<id>"] → registry[hash], matching the table path.
  // Primitive joined string (S-02) — Effects 2+3 re-fire only when a dv-layer combo entry changes.
  // Filtered to dv-bound layers only (dynamic_view_id !== null), keyed by layer id (l:<id>).
  const dvComboViewsKey = useFilterCombinationStore((s) =>
    includedLayers
      .filter((l) => l.dynamic_view_id !== null && l.dynamic_view_id !== undefined)
      .map((l) => {
        const hash = s.vizToHash[`l:${l.id}`];
        const entry = hash && !hash.endsWith(`:${NOFILTER_SENTINEL}`) ? s.registry[hash] : undefined;
        return `${l.id}:${entry?.viewName ?? ""}:${entry?.materializeVersion ?? 0}:${entry?.materializing ? "1" : "0"}`;
      })
      .join("|"),
  );

  // PITFALL S-02 lock: primitive shapesKey selector (joined ids) — Effect 7's dep array key.
  // Reads as string — never the array reference, never the whole store state.
  const shapesKey = useSpatialFilterStore((s) => s.shapes.map((sh) => sh.id).join("|"));
  // Primitive shapes-count for MapDrawToolbar prop (trash visibility gate).
  const shapesCount = useSpatialFilterStore((s) => s.shapes.length);

  // v1.7 Phase 41 (PANEL-V17-02): legendKey primitive selector mirrors viewsKey/dynamicViewsKey/shapesKey.
  // Joined per-layer string changes when ANY layer's id/renderMode/cb_config changes; primitive string
  // short-circuits React re-renders on irrelevant store mutations.
  // Visibility is appended so toggling config.visible from the legend's eye button
  // recomputes resolvedLegendLayers (and flips the eye icon). Without it the key is
  // stable across a visibility change and the memo never re-runs.
  // v1.11 Phase 61 (GAP-61-01 fix): derive the legend key from effectiveLayers
  // (overlay-merged) rather than the raw persisted store. A radio-group runtime
  // overlay patches renderMode/cb_config via widgetActionStore; effectiveLayers
  // reflects that, so the key now moves on an overlay change and re-runs
  // resolvedLegendLayers below. Previously this read s.layers directly, so the
  // in-map legend stayed frozen on the SAVED config while the WMS tiles switched
  // live — a visible inconsistency on every radio switch.
  const legendKey = useMemo(
    () =>
      effectiveLayers
        .map(
          (l) =>
            `${l.id}:${(l.config as { renderMode?: string })?.renderMode ?? "raster"}:${l.cb_config ?? "null"}:${(l.config as { visible?: boolean })?.visible !== false}`,
        )
        .join("|"),
    [effectiveLayers],
  );

  // v1.7 Phase 41 (PANEL-V17-03 + Phase 12 includedLayerIds semantic):
  // Build the filtered legend-layer list. Empty includedLayerIds === all layers visible.
  // widgetConfig is Record<string,unknown>; includedLayerIds is NOT a MapWidgetConfig field —
  // it's a top-level widget config field read from the raw blob.
  const includedLayerIdsForLegend = widgetConfig.includedLayerIds as number[] | undefined;
  const resolvedLegendLayers = useMemo<ResolvedLegendLayer[]>(() => {
    // GAP-61-01 fix: resolve from effectiveLayers (overlay-merged) so the legend's
    // renderMode/cb_config reflect the active radio-group overlay, matching the WMS
    // tiles. legendKey (now effectiveLayers-derived) is the re-run trigger.
    const base = resolveLegendLayers(
      effectiveLayers,
      includedLayerIdsForLegend,
    );
    // Phase 44 follow-up: enrich each entry with dv-materialization status so the
    // legend panel can show inline "Over threshold" / "Materializing…" / "Error"
    // badges for layers that aren't currently rendering on the map. Pure read from
    // the dv store (state-time, not subscribed here) — dynamicViewsKey above is the
    // re-render trigger and is already in this useMemo's deps via the outer effect chain.
    const dvViews = useDynamicViewStore.getState().views;

    // COMM-V118-02 (GAP 6) + GAP 3 legend portion: compute per-layer filterSummary.
    // Imperative getState() reads (state-time) — filterVersion + shapesKey are the
    // re-render triggers already in this useMemo's dep array. dvFilterScopeDisabled
    // is read from auth store (same state-time pattern).
    const filterState = useFilterStore.getState();
    const spatialState = useSpatialFilterStore.getState();
    const dvFilterScopeDisabled = useAuthStore.getState().dvFilterScopeDisabled;

    return base.map((entry) => {
      const dvId = entry.layer.dynamic_view_id;
      const isDv = dvId !== null && dvId !== undefined;

      // dvStatus enrichment (Phase 44 follow-up)
      let dvStatus: DvLayerStatus | undefined;
      if (isDv) {
        const dvEntry = dvViews[dvId!];
        dvStatus = dvEntry ? dvEntry.status : "absent";
      }

      // COMM-V118-02: per-layer filter-scope indicator.
      // - dv-bound: use dvFilters[dvId], spatialCapable=false (dv+spatial deferred).
      // - table-bound: use filters[tableId], spatialCapable = layer has an eligible SpatialTarget.
      // - GAP 3: when dvFilterScopeDisabled + isDv → cfg=undefined (accept-all → no indicator).
      // layer.filter_scope is a TOP-LEVEL field (track_config-toplevel-field pattern).
      const rawCfg = isDv && dvFilterScopeDisabled
        ? undefined
        : (entry.layer.filter_scope ?? undefined);

      let activeFilters;
      let activeShapes: ReturnType<typeof spatialState.shapes.slice>;
      let spatialCapable: boolean;

      if (isDv) {
        activeFilters = (filterState.dvFilters ?? {})[dvId!] ?? [];
        activeShapes = [];
        spatialCapable = false;
      } else {
        activeFilters = filterState.filters[entry.layer.table_id] ?? [];
        // spatialCapable: this map widget's spatialTargets must include this layer's table.
        // Reuse the existing getSpatialTargets + isSpatialTargetEligible pattern
        // (same as eligibleTargetTableNames ~lines 686-694 above). Single widget, NOT array.
        spatialCapable = getSpatialTargets({
          config: widget.config as Pick<MapWidgetConfig, "spatialTargets">,
        })
          .filter(isSpatialTargetEligible)
          .some((t) => t.tableId === entry.layer.table_id);
        activeShapes = spatialCapable ? spatialState.shapes : [];
      }

      const summary = computeFilterScopeSummary({
        cfg: rawCfg,
        activeFilters,
        activeShapes,
        spatialCapable,
      });

      const filterSummary = {
        appliedCount: summary.appliedCount,
        totalCount: summary.totalCount,
      };

      return { ...entry, dvStatus, filterSummary };
    });
    // legendKey is the read-trigger; includedLayerIdsForLegend is the filter trigger;
    // dynamicViewsKey is the dv-state re-render trigger.
    // filterVersion drives re-computation when filters change (already subscribed above).
    // shapesKey drives re-computation when spatial shapes change (already subscribed above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legendKey, includedLayerIdsForLegend, dynamicViewsKey, filterVersion, shapesKey]);

  // v1.7 Phase 41 (PANEL-V17-06): session-only collapse state. NOT persisted to MapWidgetConfig.
  const [legendCollapsed, setLegendCollapsed] = useState<boolean>(false);

  // Eye-toggle handler for the in-map legend overlay — flips config.visible
  // (optimistic store update + debounce-free PATCH). The store change re-runs the
  // includedLayers memo + Effect 2, which adds/removes the OL layer from the map.
  const toggleLayerVisible = useLayerVisibilityToggle();

  // eligibleLayers — only excludes layers whose per-layer "info popup" toggle is off
  // (info_enabled === 0). All three spatial modes are supported by /api/info/query
  // (latlon → GEODIST; wkt/wkb → STXY_DISTANCE on the geometry column). Sort order
  // = ascending position (inherited from includedLayers).
  const eligibleLayers = useMemo<DashboardLayerDto[]>(() => {
    return includedLayers.filter((layer) => layer.info_enabled !== 0);
  }, [includedLayers]);

  // Names of tables for which this map widget has an eligible spatial-filter target
  // (Phase 30 hover-tooltip on draw buttons). Empty array signals "no targets configured"
  // → drawing produces no chip and no materialize (CONTEXT.md orphan-shape behavior).
  // WKB / incomplete targets are filtered out by isSpatialTargetEligible.
  const eligibleTargetTableNames = useMemo<string[]>(() => {
    const targets = getSpatialTargets({
      config: widget.config as Pick<MapWidgetConfig, "spatialTargets">,
    }).filter(isSpatialTargetEligible);
    return targets.map((t) => {
      const tbl = tables.find((x) => x.id === t.tableId);
      return tbl ? `${tbl.schema}.${tbl.name}` : `table ${t.tableId}`;
    });
  }, [widget.config, tables]);

  // Display-name resolver for InfoPopup dropdown. Matches the Map Layers panel / legend
  // naming: an operator-set config.name wins; otherwise fall back to `{schema.name} — {renderMode}`.
  const layerNameFor = useCallback((layer: DashboardLayerDto): string => {
    const custom = (layer.config as { name?: string }).name;
    if (typeof custom === "string" && custom.trim().length > 0) return custom.trim();
    const t = tables.find((tbl) => tbl.id === layer.table_id);
    const tableName = t ? `${t.schema}.${t.name}` : "(unset table)";
    const renderMode = (layer.config as { renderMode?: string }).renderMode ?? "raster";
    return `${tableName} — ${renderMode}`;
  }, [tables]);

  // ── Refs ─────────────────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  // PITFALL M-01 lock: mapRef guard prevents StrictMode double-construction.
  const mapRef = useRef<OlMap | null>(null);
  const basemapLayerRef = useRef<TileLayer<OSM | XYZ> | null>(null);

  // Phase 12: keyed by DashboardLayer.id; preserves layer instances across re-renders
  // so we can imperatively add/remove via map.addLayer / map.removeLayer (M-01 lock).
  // PITFALL Pitfall 1: NEVER tear down all layers on list change — only add/remove delta.
  const imageLayersRef = useRef<Map<number, ImageLayer<ImageWMS>>>(new Map());
  const imageSourcesRef = useRef<Map<number, ImageWMS>>(new Map());
  // Phase 17-03 (follow-up): per-layer fingerprint of last-emitted WMS params.
  // OL's source.updateParams triggers an image reload unconditionally — even when params are
  // semantically unchanged. When filterVersion ticks for a filter on table A, Effect 3 iterates
  // ALL layers (including layers on table B with no filter activity). Without this guard the
  // table-B layer would re-issue a redundant WMS GetMap. The fingerprint compare skips the call
  // when nothing changed for that layer.
  const lastEmittedParamsRef = useRef<Map<number, string>>(new Map());

  // GAP-24-01-A fix (Phase 24-04): per-layer ImageWMS source-listener unsubscriber map.
  // Keyed by DashboardLayer.id; value is a closure that calls source.un("imageloaderror", h)
  // + source.un("imageloadend", h) with the EXACT handler references captured at attach
  // time. Effect 2's REMOVE loop invokes the unsubscriber BEFORE map.removeLayer so a
  // delayed image-load callback cannot fire setTileLoadError on an orphan source after
  // the layer is gone from the React tree (root cause documented at the top of this
  // file). Effect 1's cleanup also clears this Map alongside imageLayersRef on unmount.
  const sourceListenerCleanupRef = useRef<Map<number, () => void>>(new Map());

  // quick-260608-rbq: per-layer boolean loading tracker. Keyed by DashboardLayer.id;
  // true = source is currently loading tiles. Aggregated into isMapLoading state via
  // recomputeLoading() called inside microtask-deferred handlers (same defer discipline
  // as handleTileError/handleTileLoadEnd — OL fires imageloadstart synchronously during
  // the render commit; synchronous setState corrupts the OL/React DOM tree → app blanks).
  // Cleared on unmount (Effect 1 cleanup) and per-layer on remove (cleanup closure).
  const loadingByLayerRef = useRef<Map<number, boolean>>(new Map());

  // GAP-24-02-A fix (Phase 24-06): mountedRef cleanup-gate. Set to true on mount;
  // Effect 1's cleanup flips it to false BEFORE map.setTarget(undefined) + map.dispose().
  // ALL async OL callbacks that could fire post-unmount guard with
  // `if (!mountedRef.current) return;` BEFORE any setState or OL DOM-touching call:
  //   1. imageLoadFunctionFor's xhr.onreadystatechange (XHR-based loader; OL renderFrame
  //      would otherwise call insertBefore on a detached container after src= mutation)
  //   2. handleTileError (defense-in-depth alongside GAP-24-01-A's listener cleanup)
  //   3. handleTileLoadEnd (same)
  //   4. Effect 6 singleclick post-await sites (info-query controller.signal.aborted
  //      check alone does not cover post-unmount where the React tree is gone)
  // Mirrors v1.3 Phase 15's materializeAbortRef threading pattern (LIFE-V13-04 lock).
  const mountedRef = useRef<boolean>(true);

  // ── Phase 29 (DRAW-V15-02 + V15-P-01 mode-guard FIRST-CODE-CHANGE) ────────
  // Component-local mode state. NOT in useSpatialFilterStore (out-of-Phase-27 scope per 29-CONTEXT.md).
  // The ref mirror (drawModeRef) is what Effect 6's singleclick handler reads imperatively — so
  // we do NOT have to widen Effect 6's deps array (which would tear down/recreate the listener
  // on every mode change). See 29-RESEARCH.md Pattern 6 + Pitfall 2 for the stale-closure trap.
  const [drawMode, setDrawMode] = useState<DrawMode>("info");
  const drawModeRef = useRef<DrawMode>("info");
  // previousModeRef tracks the last non-draw mode so drawend / ESC can auto-restore (DRAW-V15-02).
  // Updated ONLY when drawMode transitions to a non-draw value (pan / info); draw modes leave it alone.
  const previousModeRef = useRef<DrawMode>("info");

  // ── Phase 29 (SHAPE-V15-01..03): Vector overlay refs ─────────────────────
  // vectorLayerRef + vectorSourceRef are set in Effect 1 and disposed in Effect 1's cleanup.
  // shapeOverlaysRef tracks per-shape persistent measurement-pill Overlays (one per committed
  // shape). Cleared atomically in Effect 7 on shape removal AND in Effect 1's cleanup.
  const vectorLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const vectorSourceRef = useRef<VectorSource | null>(null);
  const shapeOverlaysRef = useRef<Map<string, Overlay>>(new Map());
  // quick-260608-j5k: live handles for the opt-in ScaleLine + FullScreen controls so a
  // config toggle can add/remove them without remounting the map (see the sync effect below).
  const scaleLineRef = useRef<ScaleLine | null>(null);
  const fullScreenRef = useRef<FullScreen | null>(null);

  // ── Phase 29 (DRAW-V15-04): Active Draw interaction ref ──────────────────
  // Set by Effect 8 on mode change to a draw mode; null otherwise. Used by the ESC
  // keydown handler to call abortDrawing() without going through state.
  const drawRef = useRef<Draw | null>(null);

  // Timestamp of the most recent OL Draw `drawend` event. Effect 6 (info-popup
  // singleclick) checks this and suppresses any click within ~350ms — that window
  // covers OL's 250ms singleclick debounce, so the click that COMPLETED a draw
  // (and synchronously restored drawMode to "info" / "pan") does not pop the info
  // popup. Without this guard the V15-P-01 mode-guard misses the case: by the
  // time the singleclick handler reads drawModeRef, mode has already been restored.
  const lastDrawEndAtRef = useRef<number>(0);

  // ── Phase 29 (SHAPE-V15-04): Selection state ──────────────────────────────
  // Component-local — NOT in useSpatialFilterStore (Plan 27 store stays unmodified).
  // The ref mirror lets the VectorLayer style function read the current selection
  // without re-running the entire Effect 1 setup on every selection change.
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
  const selectedShapeIdRef = useRef<string | null>(null);

  // ── Phase 21 Info Popup refs ─────────────────────────────────────────────
  // popupContainerRef: rendered in JSX so it exists in DOM before map.addOverlay() (Pitfall 1).
  // infoQueryAbortRef: per-click AbortController (mirrors materializeAbortRef V13-P-10 lock).
  const popupContainerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<Overlay | null>(null);
  const infoQueryAbortRef = useRef<AbortController | null>(null);

  // Debounce timestamp for tile-error toast (2s burst window).
  const lastToastAtRef = useRef<number>(0);

  // ── Local state ──────────────────────────────────────────────────────────
  const [tileLoadError, setTileLoadError] = useState<TileErrorState>(null);
  const [errorOverlayDismissed, setErrorOverlayDismissed] = useState(false);
  // Phase 35 (DV-V16-13/14): "Some layers over threshold" overlay state. Set by Effect 2's
  // post-loop reconciliation after counting layers whose dv-bound + non-materialized status
  // caused buildWmsParams to return null. The overlay surfaces silently — no toast fires
  // per the locked status-aware-rendering taxonomy (35-CONTEXT.md §"Status → render mapping").
  const [hasOverThresholdLayers, setHasOverThresholdLayers] = useState<boolean>(false);
  // quick-260608-rbq: aggregate loading state. True when ANY configured layer's ImageWMS
  // source is mid-load. Drives the top-center "Loading…" badge render (badge shows iff
  // isMapLoading && getShowLoadingIndicator(widgetConfig)). Recomputed inside microtask-
  // deferred handlers via recomputeLoading() — same OL-fires-synchronously-during-commit
  // discipline as handleTileError/handleTileLoadEnd.
  const [isMapLoading, setIsMapLoading] = useState<boolean>(false);

  // ── Transparent placeholder (Fix C — loop prevention) ────────────────────
  const TRANSPARENT_PLACEHOLDER =
    "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";

  // ── XHR imageLoadFunction factory ────────────────────────────────────────
  // Fix E (11-10 deviation): XHR + arraybuffer + base64 instead of fetch+blob.
  // withCredentials=true sends session cookie for same-origin /api/wms proxy.
  // DO NOT set crossOrigin on ImageWMS — that strips cookies.
  const imageLoadFunctionFor = useCallback(
    () =>
      (image: any, src: string) => {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", src, true);
        xhr.withCredentials = true;
        xhr.responseType = "arraybuffer";
        xhr.onreadystatechange = () => {
          if (xhr.readyState !== 4) return;
          // GAP-24-02-A fix (Phase 24-06): bail out if the component has unmounted.
          // Setting image.getImage().src below triggers OL's internal renderFrame, which
          // calls insertBefore on the parent container. If Effect 1's cleanup already ran
          // (map.setTarget(undefined) detached the container), insertBefore throws
          // NotFoundError. The guard prevents the chain.
          if (!mountedRef.current) return;
          // Post-VERIFY fix (live UAT, dv-binding follow-up): also guard against the
          // case where the component is STILL mounted but the OL container is detached
          // from the DOM (observed when react-grid-layout reflows widgets as a new map
          // is added — the existing widget's container is briefly orphaned during the
          // reconciliation tick). image.getImage().src in that window triggers OL's
          // renderFrame → insertBefore on a node whose tracked sibling has been moved,
          // which crashes the entire React tree (NotFoundError bubbles past the
          // WidgetErrorBoundary's recovery render). Node.isConnected returns false for
          // detached nodes; defer + re-check on next microtask gives react-grid-layout
          // a chance to re-attach.
          if (!containerRef.current || !containerRef.current.isConnected) {
            // Drop this tile silently — the next render cycle will trigger a fresh load
            // once the container is re-attached. Avoids src assignment on an orphan OL.
            return;
          }
          if (xhr.status === 401) {
            window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
            queueMicrotask(() => {
              if (!mountedRef.current) return;
              if (!containerRef.current?.isConnected) return;
              image.getImage().src = TRANSPARENT_PLACEHOLDER;
            });
            return;
          }
          if (xhr.status < 200 || xhr.status >= 300) {
            queueMicrotask(() => {
              if (!mountedRef.current) return;
              if (!containerRef.current?.isConnected) return;
              image.getImage().src = TRANSPARENT_PLACEHOLDER;
            });
            return;
          }
          const b64 = arrayBufferToBase64(xhr.response as ArrayBuffer);
          // Microtask defer (same rationale as the error paths above): if the XHR
          // resolves while React + react-grid-layout are mid-reconciliation (e.g. the
          // operator just added a second map widget), assigning src synchronously can
          // crash OL's renderFrame at insertBefore. Defer until the current commit
          // settles, then re-check mount + container attachment.
          queueMicrotask(() => {
            if (!mountedRef.current) return;
            if (!containerRef.current?.isConnected) return;
            image.getImage().src = "data:image/png;base64," + b64;
          });
        };
        xhr.send();
      },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ── Effect 1: Mount / unmount the OL Map exactly once (M-01 lock) ────────
  useEffect(() => {
    // GAP-24-06-A fix: re-arm mountedRef on every Effect 1 run. The cleanup return
    // below flips mountedRef.current = false (GAP-24-02-A protection). React 18
    // StrictMode in dev runs mount → cleanup → mount on the SAME hook state, and
    // useRef preserves `.current` across that cycle — so without this re-arm the
    // SECOND mount inherits a stale `false`, every XHR/imageload callback short-
    // circuits, and WMS image bytes arrive but never get applied to the OL layer
    // (request succeeds, map paints blank). The initial useRef(true) only runs on
    // the FIRST mount; this line covers all subsequent ones.
    mountedRef.current = true;
    // PITFALL M-01 lock: StrictMode guard — second invocation is a no-op.
    if (mapRef.current) return;
    if (!containerRef.current) return;

    const basemapSource = basemapSourceFor(effectiveBasemap);
    const basemapLayer = new TileLayer({ source: basemapSource });
    basemapLayerRef.current = basemapLayer as TileLayer<OSM | XYZ>;

    // quick-260608-j5k: the opt-in ScaleLine + FullScreen controls are NOT constructed here.
    // The map is built once (M-01 invariant, empty deps), so wiring them at mount would mean a
    // config toggle only took effect on the next remount. Instead a dedicated sync effect below
    // adds/removes them live via map.addControl/removeControl keyed on the config flags.
    const extraControls: Control[] = [new Attribution({ collapsible: true, collapsed: true })];

    const map = new OlMap({
      target: containerRef.current,
      layers: [basemapLayer],
      // Disable the default OL Zoom control — replaced by the custom MapZoomToolbar
      // React overlay (visual parity with MapDrawToolbar). attribution stays disabled
      // here and is added explicitly via Attribution() below so its collapsed state
      // is configurable.
      controls: defaultControls({ attribution: false, zoom: false }).extend(extraControls),
      view: new OlView({
        // PITFALL M-03 lock: EPSG:3857 locked for all OL views.
        projection: "EPSG:3857",
        center: [0, 0],
        zoom: 2,
      }),
    });

    mapRef.current = map;

    // ── Phase 29 (SHAPE-V15-01): VectorLayer + VectorSource for committed shapes ─
    // Pitfall 6 lock: zIndex 10000 puts shapes above all WMS image layers (max ~1000).
    // The style function reads feature.get("shapeType") for per-type color (29-UI-SPEC.md).
    // selectedShapeIdRef is added by Plan 05; in this plan all features render unselected (width 2).
    const vectorSource = new VectorSource();
    vectorSourceRef.current = vectorSource;
    const vectorLayer = new VectorLayer({
      source: vectorSource,
      zIndex: 10000,
      style: (feature) => {
        const type = feature.get("shapeType") as "bbox" | "lasso" | "circle";
        const palette = SHAPE_COLORS[type] ?? SHAPE_COLORS.bbox;
        const isSelected = feature.getId() === selectedShapeIdRef.current;
        const baseStyle = new Style({
          fill: new Fill({ color: palette.fill }),
          stroke: new Stroke({ color: palette.stroke, width: isSelected ? 4 : 2 }),
        });
        if (!isSelected) return baseStyle;
        // Selection halo (29-UI-SPEC.md): inner white halo over the per-type stroke.
        // Returning Style[] layers strokes — OL paints in order.
        const haloStyle = new Style({
          stroke: new Stroke({ color: "rgba(255,255,255,0.6)", width: 1 }),
        });
        return [baseStyle, haloStyle];
      },
    });
    vectorLayerRef.current = vectorLayer;
    map.addLayer(vectorLayer);

    // Fix D: ResizeObserver handles zero-size container on mount (see Phase 11 Fix D notes).
    const ro = new ResizeObserver(() => {
      map.updateSize();
    });
    ro.observe(containerRef.current);

    const rafHandle = requestAnimationFrame(() => {
      map.updateSize();
    });

    // Cleanup: PITFALL M-01 lock.
    return () => {
      // GAP-24-02-A fix (Phase 24-06): flip mountedRef FIRST so any in-flight async
      // callback (XHR onreadystatechange, OL imageloaderror/imageloadend, Effect 6
      // post-await sites) sees mountedRef.current === false BEFORE we touch the OL
      // map or detach the container. Without this, an XHR resolving mid-teardown
      // would still mutate image.getImage().src → OL renderFrame → insertBefore on
      // an orphan parent → NotFoundError → unboundary'd React tree blanks the app.
      mountedRef.current = false;
      cancelAnimationFrame(rafHandle);
      ro.disconnect();
      // GAP-24-01-A fix (Phase 24-04): unsubscribe ALL ImageWMS source listeners BEFORE
      // disposing the map. Mirrors the per-layer cleanup in Effect 2's REMOVE loop, but
      // covers the unmount path too — without this, any in-flight image-load completing
      // after map.dispose() could still fire setState on the unmounting component.
      // Pair this with the imageLayersRef + imageSourcesRef + sourceListenerCleanupRef
      // clears below so the next mount starts with empty bookkeeping.
      for (const cleanup of sourceListenerCleanupRef.current.values()) {
        try { cleanup(); } catch { /* listener already detached; ignore */ }
      }
      // Phase 29 (Pitfall 3 ghost-overlay): remove every per-shape persistent overlay BEFORE
      // map disposal. Without this, leftover Overlay elements survive map.dispose() and any
      // future re-mount inherits stale DOM nodes (and the map.removeOverlay calls in Effect 7
      // never fire for the previous instance's overlays).
      for (const overlay of shapeOverlaysRef.current.values()) {
        try { map.removeOverlay(overlay); } catch { /* already detached; ignore */ }
      }
      shapeOverlaysRef.current.clear();
      // quick-260608-j5k: drop the opt-in control handles — map.dispose() tears the controls
      // down with the map, so the next mount must start from null and re-add via the sync effect.
      scaleLineRef.current = null;
      fullScreenRef.current = null;
      map.setTarget(undefined);
      map.dispose();
      mapRef.current = null;
      basemapLayerRef.current = null;
      vectorLayerRef.current = null;
      vectorSourceRef.current = null;
      // Clear per-layer refs on map disposal.
      imageLayersRef.current.clear();
      imageSourcesRef.current.clear();
      sourceListenerCleanupRef.current.clear();
      lastEmittedParamsRef.current.clear();
      // quick-260608-rbq: clear the per-layer loading tracker on unmount.
      loadingByLayerRef.current.clear();
      // Phase 21: abort any in-flight info request; clear ref.
      infoQueryAbortRef.current?.abort();
      infoQueryAbortRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── quick-260608-j5k: opt-in map controls (ScaleLine + FullScreen) live sync ──
  // Runs on mount AND whenever either config toggle flips. Adds/removes the controls
  // on the live map via addControl/removeControl, so enabling the checkbox in the config
  // panel shows the control immediately — no widget remount required. (M-01 governs the
  // OL map instance lifecycle; these controls are detachable and managed independently.)
  // Each control is created at most once (ref guard) and removed when its flag goes false.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (showScaleBarFlag && !scaleLineRef.current) {
      const ctrl = new ScaleLine();
      scaleLineRef.current = ctrl;
      map.addControl(ctrl);
    } else if (!showScaleBarFlag && scaleLineRef.current) {
      map.removeControl(scaleLineRef.current);
      scaleLineRef.current = null;
    }

    if (showFullscreenFlag && !fullScreenRef.current && containerRef.current) {
      // FullScreen targets the widget's map container (NOT document.body) so fullscreen fills
      // the dashboard grid cell and exiting restores the OL layout.
      const ctrl = new FullScreen({ source: containerRef.current });
      fullScreenRef.current = ctrl;
      map.addControl(ctrl);
    } else if (!showFullscreenFlag && fullScreenRef.current) {
      map.removeControl(fullScreenRef.current);
      fullScreenRef.current = null;
    }
  }, [showScaleBarFlag, showFullscreenFlag]);

  // ── Phase 29: drawModeRef mirror sync ────────────────────────────────────
  // Effect runs on every drawMode change; updates the ref so Effect 6's singleclick
  // handler can read the current mode without being in Effect 6's deps array.
  useEffect(() => {
    drawModeRef.current = drawMode;
  }, [drawMode]);

  // ── Phase 29 (SHAPE-V15-04): selectedShapeIdRef mirror + style re-render ─
  // Updates the ref so the VectorLayer style function reads current selection imperatively.
  // Calls vectorLayer.changed() to force a style re-evaluation across all features
  // (the style function is invoked on every layer.changed()).
  useEffect(() => {
    selectedShapeIdRef.current = selectedShapeId;
    vectorLayerRef.current?.changed();
  }, [selectedShapeId]);

  // ── Phase 29: test seam — setdrawmode custom event ─────────────────────
  // Allows vitest specs to drive drawMode without a real toolbar (Plan 02 adds that).
  // Only active when containerRef is mounted; harmless in production (no emitter outside tests).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleTestMode = (e: Event) => {
      const mode = (e as CustomEvent<DrawMode>).detail;
      if (mode) setDrawMode(mode);
    };
    container.addEventListener("setdrawmode", handleTestMode);
    return () => {
      container.removeEventListener("setdrawmode", handleTestMode);
    };
  }, []);

  // ── Phase 29: previousModeRef tracker ────────────────────────────────────
  // Captures the last non-draw mode (Pan / Info) so drawend (Plan 04) and ESC (Plan 04)
  // can auto-restore via setDrawMode(previousModeRef.current).
  useEffect(() => {
    if (drawMode === "bbox" || drawMode === "lasso" || drawMode === "circle") return;
    previousModeRef.current = drawMode;
  }, [drawMode]);

  // ── Phase 29 (V15-P-02): cursor management ──────────────────────────────
  // Single useEffect dep on drawMode. Cleanup return covers mode-change AND unmount paths.
  useEffect(() => {
    const viewport = mapRef.current?.getViewport();
    if (!viewport) return;
    const cursor =
      drawMode === "pan" ? "grab" :
      drawMode === "bbox" || drawMode === "lasso" || drawMode === "circle" ? "crosshair" :
      "";
    viewport.style.cursor = cursor;
    return () => {
      viewport.style.cursor = "";
    };
  }, [drawMode]);

  // ── Effect 2: Layer-stack reconciliation — add / remove / update opacity ───
  // PITFALL Pitfall 1: NEVER dispose the map. Use map.addLayer / map.removeLayer imperatively.
  // CRITICAL FIX: reads layer.table_id (top-level DashboardLayerDto field).
  // Phase 12 stores tableId as a SQLite column on dashboard_layers, NOT inside the JSON config blob.
  // The config field for tableId is always undefined in Phase 12 — use the top-level DTO field.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Old-config Phase 11 widgets are handled by the reconfigure overlay.
    if (isOldPhase11Config(widgetConfig)) return;

    const desired = new Set(includedLayers.map((l) => l.id));
    const existing = imageLayersRef.current;
    // Phase 35 (DV-V16-13/14): count layers omitted from the visible stack because
    // their dv binding is non-materialized (pending/over_threshold/error). Surface
    // via "Some layers over threshold" overlay at end of effect.
    let overThresholdCount = 0;

    // 1. REMOVE layers no longer included or no longer visible.
    for (const [id, imageLayer] of existing) {
      if (!desired.has(id)) {
        // GAP-24-01-A fix (Phase 24-04): unsubscribe the ImageWMS source's
        // "imageloaderror" + "imageloadend" listeners BEFORE map.removeLayer fires.
        // Without this, an in-flight image-load completing after removal would invoke
        // handleTileError / handleTileLoadEnd against the still-mounted component on
        // a half-detached source object, throwing an uncaught exception that React
        // (with no ErrorBoundary in this app) handles by unmounting the entire root
        // tree → blank dark-blue screen. The cleanup closure was captured at attach
        // time in the ADD branch below and holds the exact handler references OL
        // needs to identify-and-detach each listener.
        const cleanup = sourceListenerCleanupRef.current.get(id);
        if (cleanup) {
          try { cleanup(); } catch { /* listener already detached; ignore */ }
          sourceListenerCleanupRef.current.delete(id);
        }
        // Phase 17-03 follow-up: drop fingerprint so a future re-add doesn't see stale params.
        lastEmittedParamsRef.current.delete(id);
        map.removeLayer(imageLayer);
        existing.delete(id);
        imageSourcesRef.current.delete(id);
      }
    }

    // 2. ADD newly-included layers (PITFALL Pitfall 1: addLayer, not dispose+rebuild).
    for (const layer of includedLayers) {
      // Phase 35 (DV-V16-13): even already-added layers must be re-checked when their dv
      // status changes — Effect 2 fires when dynamicViewsKey moves. A previously-materialized
      // dv layer that flips to non-materialized must be REMOVED from the visible stack.
      const cfg = layer.config as Record<string, unknown>;
      // GAP-54-01 (TRACKFIX-V19-01): track_config is a TOP-LEVEL DashboardLayerDto column,
      // not a key inside layer.config. isConfigComplete's track branch reads config.track_config,
      // so merge the top-level field in before the gate — mirrors LayersModal:557-561 (form
      // edit merge) and the buildWmsParams call at ~1079 (already reads layer.track_config).
      const cfgForGate = { ...cfg, track_config: layer.track_config };
      if (!isConfigComplete(cfgForGate as Partial<MapWidgetConfig>)) continue;

      // CRITICAL FIX: use top-level `layer.table_id` (DashboardLayerDto column, Phase 12+).
      // The config-embedded tableId is always undefined in Phase 12.
      const tableId = layer.table_id;

      // Skip until `tables` has loaded; PT16-C: viewName resolution AFTER tableMeta guard.
      const tableMeta = tables.find((t) => t.id === tableId);
      if (!tableMeta) continue;
      const rawTableRef = `${tableMeta.schema}.${tableMeta.name}`;

      // Phase 35 (DV-V16-13) — per-layer dv lookup BEFORE buildWmsParams call.
      // Imperative .getState() snapshot at effect-fire time (PITFALL C-02 pattern: same as
      // useFilterViewStore.getState() below). dynamicViewsKey selector at top of component
      // is the dep-array trigger; the imperative read here gets the same-tick snapshot.
      const dvEntry =
        layer.dynamic_view_id !== null && layer.dynamic_view_id !== undefined
          ? useDynamicViewStore.getState().views[layer.dynamic_view_id]
          : undefined;
      const dvVersion =
        layer.dynamic_view_id !== null && layer.dynamic_view_id !== undefined
          ? useDynamicViewStore.getState().dynamicViewVersion
          : undefined;

      // Phase 94 (FSCOPE-V118-03): dv-combo → raw-dv precedence. Replaces Phase 63.1 filterViewStore.dvViews read.
      // When this layer's dv has an active combo entry (materializing===false + non-empty viewName) in
      // filterCombinationStore.vizToHash["l:<id>"] → registry[hash], FROM-swap to the combo view with
      // the combo entry's materializeVersion as _mv. Else fall through to raw-dv dvEntry/dvVersion.
      let resolvedDvEntry = dvEntry !== undefined ? { status: dvEntry.status, viewName: dvEntry.viewName } : undefined;
      let resolvedDvVersion = dvVersion;
      if (layer.dynamic_view_id !== null && layer.dynamic_view_id !== undefined) {
        const dvLayerVizKey = `l:${layer.id}`;
        const dvComboHash = useFilterCombinationStore.getState().vizToHash[dvLayerVizKey];
        const dvComboEntry =
          dvComboHash && !dvComboHash.endsWith(`:${NOFILTER_SENTINEL}`)
            ? useFilterCombinationStore.getState().registry[dvComboHash]
            : undefined;
        if (dvComboEntry && !dvComboEntry.materializing && dvComboEntry.viewName) {
          resolvedDvEntry = { status: "materialized", viewName: dvComboEntry.viewName };
          resolvedDvVersion = dvComboEntry.materializeVersion;
        }
      }

      // Phase 92 (READ-V118-02): per-layer combination view snapshot (replaces filterViewStore.views[tableId]).
      // Filters NEVER travel in the WMS request — only the view NAME changes. undefined/NOFILTER → base table.
      const layerVizKey = `l:${layer.id}`;
      const comboHash = useFilterCombinationStore.getState().vizToHash[layerVizKey];
      const comboEntry =
        comboHash && !comboHash.endsWith(`:${NOFILTER_SENTINEL}`)
          ? useFilterCombinationStore.getState().registry[comboHash]
          : undefined;
      const expired = comboEntry ? isViewExpired(comboEntry) : false;
      const viewName = comboEntry && !expired ? comboEntry.viewName : undefined;
      const materializeVersion = comboEntry && !expired ? comboEntry.materializeVersion : undefined;

      // Phase 17-03: `||` not `??` — empty-string falls through to rawTableRef.
      const wmsConfigInput = { ...cfg, tableId, tableRef: viewName || rawTableRef } as MapWidgetConfig;
      // Phase 35 (DV-V16-13): 4-arg call form — buildWmsParams returns null when dv-bound
      // + non-materialized so this layer must be skipped from the visible stack.
      // v1.7 Phase 38 (SCHEMA-V17-03/04): 5th arg passes raw cb_config + track_config JSON
      // so the cb_raster + Track branches can read them via coalesceCbConfig / coalesceTrackConfig.
      // Both null for legacy/pre-v1.7 layers → no CB_* / Track emit (backward-compat preserved).
      const wmsParams = buildWmsParams(
        wmsConfigInput,
        materializeVersion,
        resolvedDvEntry,
        resolvedDvVersion,
        { cb_config: layer.cb_config, track_config: layer.track_config },
      );

      // Phase 35 (DV-V16-13): null → dv-bound + non-materialized (pending/over_threshold/error).
      // Omit the layer from the visible stack. If we already have a previously-materialized OL
      // layer for this id, remove it now (status flipped mid-session). Count it for the overlay.
      if (wmsParams === null) {
        overThresholdCount += 1;
        const stale = existing.get(layer.id);
        if (stale) {
          const cleanup = sourceListenerCleanupRef.current.get(layer.id);
          if (cleanup) {
            try { cleanup(); } catch { /* listener already detached; ignore */ }
            sourceListenerCleanupRef.current.delete(layer.id);
          }
          lastEmittedParamsRef.current.delete(layer.id);
          map.removeLayer(stale);
          existing.delete(layer.id);
          imageSourcesRef.current.delete(layer.id);
        }
        continue;
      }

      // Skip if the layer is already added (normal table-bound path or already-materialized dv).
      if (existing.has(layer.id)) continue;

      const source = new ImageWMS({
        url: `${API_BASE}/api/wms`,
        params: wmsParams,
        ratio: 1,
      });
      source.setImageLoadFunction(imageLoadFunctionFor());

      // Image error listener — drives error overlay + debounced toast.
      //
      // Post-VERIFY: defer setState calls to a microtask via queueMicrotask. OpenLayers
      // fires `imageloaderror` synchronously during the WMS image element's onerror
      // callback, which can occur DURING a React render commit (Effect 2's
      // map.addLayer → source.setImageLoadFunction → Kinetica returns error tile →
      // imageloaderror inline). Calling setState during the same render commit causes
      // React to schedule a re-render while OL is still mutating the layer DOM tree —
      // the next render's reconciler then fails on insertBefore because OL has moved
      // sibling nodes. Microtask defer guarantees setState runs AFTER the current
      // render commit completes, so the re-render reconciles against a stable DOM.
      //
      // quick-260608-rbq: recomputeLoading is called INSIDE the microtask block (after
      // re-checking mountedRef) by all three event handlers. The microtask defer is
      // MANDATORY — OL fires imageloadstart synchronously during the render commit just
      // like imageloaderror; synchronous setState here would corrupt the OL/React DOM
      // tree and blank the app (same pitfall documented in the comment above).
      const recomputeLoading = () => {
        const next = Array.from(loadingByLayerRef.current.values()).some(Boolean);
        setIsMapLoading(next);
      };
      const handleTileLoadStart = () => {
        // GAP-24-02-A: bail out if unmounted before the microtask fires.
        if (!mountedRef.current) return;
        loadingByLayerRef.current.set(layer.id, true);
        queueMicrotask(() => {
          if (!mountedRef.current) return; // re-check after task boundary
          recomputeLoading();
        });
      };
      const handleTileError = () => {
        // GAP-24-02-A fix (Phase 24-06): do not run setState / showToast on unmounted
        // component. Defense in depth alongside GAP-24-01-A's per-layer listener cleanup.
        if (!mountedRef.current) return;
        queueMicrotask(() => {
          if (!mountedRef.current) return; // re-check after task boundary
          // quick-260608-rbq: a failed load is no longer "loading".
          loadingByLayerRef.current.set(layer.id, false);
          recomputeLoading();
          setTileLoadError((prev) => ({
            count: (prev?.count ?? 0) + 1,
            lastAt: Date.now(),
          }));
          setErrorOverlayDismissed(false);
          const now = Date.now();
          if (now - lastToastAtRef.current > 2000) {
            lastToastAtRef.current = now;
            useToastStore.getState().showToast("Map tiles failed to load.", "error");
          }
        });
      };
      const handleTileLoadEnd = () => {
        // GAP-24-02-A fix (Phase 24-06): same guard as handleTileError above.
        // Post-VERIFY: also deferred to microtask for symmetry with handleTileError —
        // same OL-mid-render-commit risk.
        if (!mountedRef.current) return;
        queueMicrotask(() => {
          if (!mountedRef.current) return;
          // quick-260608-rbq: load finished — clear this layer's loading bit.
          loadingByLayerRef.current.set(layer.id, false);
          recomputeLoading();
          setTileLoadError(null);
          setErrorOverlayDismissed(true);
        });
      };
      source.on("imageloadstart", handleTileLoadStart);
      source.on("imageloaderror", handleTileError);
      source.on("imageloadend", handleTileLoadEnd);
      // GAP-24-01-A fix (Phase 24-04): register the per-layer cleanup closure NOW so
      // Effect 2's REMOVE loop (and Effect 1's unmount cleanup) can detach these exact
      // handler references later. OL's source.un requires the original handler reference
      // — passing `undefined` would NOT detach. Holding the closures by layer.id keeps
      // re-add paths clean (the prior unsubscribe + delete fires before re-attach).
      sourceListenerCleanupRef.current.set(layer.id, () => {
        // `as never` casts mirror the existing OL typing pattern in this file; OL's
        // type signature for source.un is structurally identical to source.on.
        source.un("imageloadstart" as never, handleTileLoadStart as never);
        source.un("imageloaderror" as never, handleTileError as never);
        source.un("imageloadend" as never, handleTileLoadEnd as never);
        // quick-260608-rbq: clear this layer's loading bit on remove so the indicator
        // can hide immediately (covers Effect 2 REMOVE loop, over-threshold removal,
        // and unmount path via Effect 1's for-loop over cleanup closures).
        loadingByLayerRef.current.delete(layer.id);
        // Guard setState: on the unmount path mountedRef is already false.
        if (mountedRef.current) recomputeLoading();
      });

      // PITFALL Pitfall 3: opacity has a single source of truth in layer.config (not CSS, not WMS param).
      const opacity = ((cfg.POINTOPACITY as number | undefined) ?? 100) / 100;
      const imageLayer = new ImageLayer({
        source,
        opacity,
        // Top of LayersModal rail (lowest `position`) renders on top of the map stack:
        // higher zIndex paints last. The basemap TileLayer's zIndex is undefined (treated as 0),
        // and the basemap is opaque — so image layers MUST stay above 0 or the opaque basemap
        // hides them. Use LAYER_Z_BASE - position so position 0 → highest zIndex above basemap,
        // and position N → lower zIndex (still above basemap for any realistic N).
        zIndex: LAYER_Z_BASE - layer.position,
      });
      // Post-VERIFY (operator request): per-layer zoom-range visibility.
      // Apply inclusive [minZoom, maxZoom] from layer.config — translates to
      // OL's exclusive-min/inclusive-max convention. Undefined values → no
      // constraint (renders at all zooms). See `applyZoomRangeToLayer` JSDoc.
      applyZoomRangeToLayer(imageLayer, {
        minZoom: cfg.minZoom as number | undefined,
        maxZoom: cfg.maxZoom as number | undefined,
      });
      map.addLayer(imageLayer);
      existing.set(layer.id, imageLayer);
      imageSourcesRef.current.set(layer.id, source);
      // Phase 17-03 follow-up: seed fingerprint with construction-time params so Effect 3's
      // first run after add doesn't immediately re-emit identical params (which OL would
      // treat as a change and re-fetch the image).
      // v1.7 Phase 38: extend fingerprint with raw cb_config + track_config strings so
      // PATCH-coalesced style edits (Phase 39 + 40 form auto-save) trigger updateParams
      // even when the resulting wmsParams object happens to byte-match (e.g. operator
      // changes a label that doesn't surface in the URL — fingerprint catches it).
      const fingerprint = JSON.stringify({ p: wmsParams, c: layer.cb_config, t: layer.track_config });
      lastEmittedParamsRef.current.set(layer.id, fingerprint);
    }

    // 3. UPDATE opacity AND zIndex AND zoom-range for ALL existing layers
    // (config / position may have changed without add/remove — e.g. drag-reorder
    // in LayersModal, opacity slider tweak, zoom-range slider tweak).
    // PITFALL Pitfall 3: always push from config — single source of truth.
    for (const layer of includedLayers) {
      const imageLayer = existing.get(layer.id);
      if (!imageLayer) continue;
      const cfg = layer.config as Record<string, unknown>;
      const opacity = ((cfg.POINTOPACITY as number | undefined) ?? 100) / 100;
      if (imageLayer.getOpacity() !== opacity) {
        imageLayer.setOpacity(opacity);
      }
      const zIndex = LAYER_Z_BASE - layer.position;
      if (imageLayer.getZIndex() !== zIndex) {
        imageLayer.setZIndex(zIndex);
      }
      // Post-VERIFY zoom-range update: idempotent — helper skips setMinZoom /
      // setMaxZoom when the current OL value already matches the target.
      applyZoomRangeToLayer(imageLayer, {
        minZoom: cfg.minZoom as number | undefined,
        maxZoom: cfg.maxZoom as number | undefined,
      });
    }

    // Phase 35 (DV-V16-13/14): reconcile the over-threshold overlay state ONCE per Effect 2 fire.
    // Functional setState — only triggers a render when the boolean flips.
    const nextHas = overThresholdCount > 0;
    setHasOverThresholdLayers((prev) => (prev === nextHas ? prev : nextHas));
    // PITFALL S-02 + Pitfall 7 (35-RESEARCH.md): dynamicViewsKey added so Effect 2 re-fires
    // when any bound dv's viewName or status changes (e.g. pending → materialized after
    // orchestrator cascade completes).
    // Phase 92 (READ-V118-02): comboViewsKey (per-layer combo dep-key) replaces viewsKey.
    // Phase 94 (FSCOPE-V118-03): dvComboViewsKey replaces dvFilterViewsKey — dv-layer read-path
    // now reads filterCombinationStore.vizToHash["l:<id>"] (not filterViewStore.dvViews).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includedLayers, widgetConfig, imageLoadFunctionFor, tables, comboViewsKey, dynamicViewsKey, dvComboViewsKey]);

  // ── Effect 3: Per-layer filter subscription (M-02 lock; fires on filterVersion + viewsKey) ──
  // PT16-E: filterVersion stays in dep array (300ms debounce window before view-store writes).
  // Phase 35 (DV-V16-13): dynamicViewsKey added so updateParams re-fires when a bound dv's
  // viewName or status changes (orchestrator cascade pending → materialized hand-off).
  useEffect(() => {
    if (isOldPhase11Config(widgetConfig)) return;
    for (const layer of includedLayers) {
      const source = imageSourcesRef.current.get(layer.id);
      if (!source) continue;
      const cfg = layer.config as Record<string, unknown>;
      const tableId = layer.table_id; // CRITICAL: top-level DashboardLayerDto column (Phase 12+)
      const tableMeta = tables.find((t) => t.id === tableId);
      if (!tableMeta) continue;
      const rawTableRef = `${tableMeta.schema}.${tableMeta.name}`;

      // Phase 35 (DV-V16-13) — per-layer dv lookup BEFORE buildWmsParams call. Same imperative
      // .getState() snapshot pattern as the filter-view lookup below (PITFALL C-02 / Pitfall 7).
      const dvEntry =
        layer.dynamic_view_id !== null && layer.dynamic_view_id !== undefined
          ? useDynamicViewStore.getState().views[layer.dynamic_view_id]
          : undefined;
      const dvVersion =
        layer.dynamic_view_id !== null && layer.dynamic_view_id !== undefined
          ? useDynamicViewStore.getState().dynamicViewVersion
          : undefined;

      // Phase 94 (FSCOPE-V118-03): dv-combo → raw-dv precedence (Effect 3). Same logic as Effect 2's
      // dv-combo resolution block. Replaces Phase 63.1 filterViewStore.dvViews read.
      let resolvedDvEntry = dvEntry !== undefined ? { status: dvEntry.status, viewName: dvEntry.viewName } : undefined;
      let resolvedDvVersion = dvVersion;
      if (layer.dynamic_view_id !== null && layer.dynamic_view_id !== undefined) {
        const dvLayerVizKey = `l:${layer.id}`;
        const dvComboHash = useFilterCombinationStore.getState().vizToHash[dvLayerVizKey];
        const dvComboEntry =
          dvComboHash && !dvComboHash.endsWith(`:${NOFILTER_SENTINEL}`)
            ? useFilterCombinationStore.getState().registry[dvComboHash]
            : undefined;
        if (dvComboEntry && !dvComboEntry.materializing && dvComboEntry.viewName) {
          resolvedDvEntry = { status: "materialized", viewName: dvComboEntry.viewName };
          resolvedDvVersion = dvComboEntry.materializeVersion;
        }
      }

      // Phase 92 (READ-V118-02): per-layer combination view snapshot + suspend gate.
      const layerVizKey = `l:${layer.id}`;
      const comboHash = useFilterCombinationStore.getState().vizToHash[layerVizKey];
      const comboEntry =
        comboHash && !comboHash.endsWith(`:${NOFILTER_SENTINEL}`)
          ? useFilterCombinationStore.getState().registry[comboHash]
          : undefined;
      // Phase 17-02 suspend gate: skip updateParams while this layer's combo view materializes.
      if (comboEntry?.materializing) continue;
      const expired = comboEntry ? isViewExpired(comboEntry) : false;
      const viewName = comboEntry && !expired ? comboEntry.viewName : undefined;
      const materializeVersion = comboEntry && !expired ? comboEntry.materializeVersion : undefined;

      // Phase 17-03: `||` not `??` — empty-string falls through to rawTableRef (M-02 lock).
      const wmsConfigInput = { ...cfg, tableId, tableRef: viewName || rawTableRef } as MapWidgetConfig;
      // Phase 35 (DV-V16-13): 4-arg form — null = dv-bound + non-materialized; skip updateParams
      // (Effect 2 handles the layer-omission/removal side).
      // v1.7 Phase 38 (SCHEMA-V17-03/04): 5th arg passes raw cb_config + track_config JSON
      // so the cb_raster + Track branches read them. Both null for legacy layers (no CB_*/Track emit).
      const wmsParams = buildWmsParams(
        wmsConfigInput,
        materializeVersion,
        resolvedDvEntry,
        resolvedDvVersion,
        { cb_config: layer.cb_config, track_config: layer.track_config },
      );
      if (wmsParams === null) continue;
      // Phase 17-03: skip updateParams when params fingerprint unchanged (OL fires reload unconditionally).
      // v1.7 Phase 38: extended fingerprint includes cb_config + track_config JSON so PATCH-coalesced
      // style edits (Phase 39 + 40 form auto-save) trigger updateParams re-fire even when wmsParams
      // byte-matches (prevents silent cache-bust misses for CB color/shape + Track config changes).
      const fingerprint = JSON.stringify({ p: wmsParams, c: layer.cb_config, t: layer.track_config });
      if (lastEmittedParamsRef.current.get(layer.id) === fingerprint) continue;
      lastEmittedParamsRef.current.set(layer.id, fingerprint);
      source.updateParams(wmsParams);
    }
    // PITFALL S-02 + PT16-E + Pitfall 7: filterVersion (chip-state) + comboViewsKey (post-materialize)
    // + dynamicViewsKey (dv re-materialize / status flip).
    // Phase 92 (READ-V118-02): comboViewsKey (per-layer combo dep-key) replaces viewsKey.
    // Phase 94 (FSCOPE-V118-03): dvComboViewsKey replaces dvFilterViewsKey — dv-layer read-path
    // now reads filterCombinationStore.vizToHash["l:<id>"] (not filterViewStore.dvViews).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterVersion, comboViewsKey, dynamicViewsKey, dvComboViewsKey, includedLayers, tables]);

  // ── Effect 4: Basemap swap — swap source, NOT Map rebuild ─────────────────
  // Fires on a basemap config change OR an app-theme toggle (both move
  // effectiveBasemap). PITFALL M-02 lock: swaps the layer's SOURCE only.
  useEffect(() => {
    if (!basemapLayerRef.current) return;
    basemapLayerRef.current.setSource(basemapSourceFor(effectiveBasemap));
  }, [effectiveBasemap]);

  // ── Retry tile load ───────────────────────────────────────────────────────
  const onRetryTiles = useCallback(() => {
    imageSourcesRef.current.forEach((source) => source.refresh());
  }, []);

  // ── Phase 21 (POPUP-V14-05): dismiss handler — close X, ESC, click-outside, new-click ──
  // Plan 23-03 Task 1: dropdown-switch + Load-more fetch handlers moved INTO <InfoSelectionView />.
  // The view owns its own AbortController for those fetches; both surfaces (popup wrapper +
  // Info Card) replay coords from useLastInfoClickContextStore.
  // MapChartRenderer keeps ONLY the click-fan-out path (Effect 6 below) + this dismiss.
  const handleDismiss = useCallback(() => {
    infoQueryAbortRef.current?.abort();
    infoQueryAbortRef.current = null;
    useInfoSelectionStore.getState().reset();  // Phase 20 lock: reset() — setActiveLayer() signature is (layerId: number), null is forbidden
    overlayRef.current?.setPosition(undefined);
  }, []);

  // Plan 23-03 Task 1: resolveTable helper for InfoSelectionView's on-demand fetch payload.
  // Pure derivation from `tables` prop — no store access; same shape passed by InfoCardRenderer.
  const resolveTable = useCallback(
    (tableId: number): { schema: string; name: string } | null => {
      const t = tables.find((tbl) => tbl.id === tableId);
      return t ? { schema: t.schema, name: t.name } : null;
    },
    [tables],
  );

  // ── Effect 5 (Phase 21 POPUP-V14-01): ol/Overlay mount/unmount ────────────
  // Pitfall 1: popupContainerRef rendered in JSX BEFORE addOverlay(). Empty deps —
  // overlay lifetime matches component. PITFALL M-01: mapRef guard for StrictMode.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !popupContainerRef.current) return;
    const overlay = new Overlay({
      element: popupContainerRef.current,
      autoPan: false,            // manual edge-clamping (deferred polish; v1.4 ships without)
      positioning: "bottom-left",
      offset: [0, -8],
      stopEvent: true,           // prevent map drag/click while interacting with popup body
    });
    map.addOverlay(overlay);
    overlayRef.current = overlay;
    return () => {
      map.removeOverlay(overlay);
      overlayRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Effect 6 (Phase 21 POPUP-V14-01 / V14-06): singleclick handler ────────
  // Kill switch (POPUP-V14-06): getInfoEnabled gates listener registration.
  // Sequential fan-out: z-order layers; first hit opens popup; errors treated as empty.
  // PITFALL M-01: mapRef guard. PITFALL M-03: EPSG:3857→4326 transform.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!getInfoEnabled(widgetConfig as MapWidgetConfig)) return;  // POPUP-V14-06 kill switch

    const handler = async (event: { coordinate: [number, number] }) => {
      // PHASE 29 V15-P-01 MODE-GUARD — FIRST LINE (locked by STATE.md as the FIRST code change
      // of Phase 29). Reads drawModeRef imperatively to avoid stale closure WITHOUT widening
      // Effect 6's deps array (which would tear down/recreate the singleclick listener on every
      // mode change, racing the cleanup gate). See 29-RESEARCH.md Pattern 6 + Pitfall 2.
      const mode = drawModeRef.current;
      if (mode !== "pan" && mode !== "info") return;

      // Suppress the singleclick that fires from the SAME gesture that completed a Draw
      // (drawend restored drawMode to "info"/"pan" before this handler ran, so the
      // mode-guard above passes). OL's singleclick has a ~250ms debounce; 350ms covers
      // it plus slack. Without this, finishing a bbox/lasso/circle draw pops the info
      // popup immediately.
      if (Date.now() - lastDrawEndAtRef.current < 350) return;

      if (eligibleLayers.length === 0) return;
      // GAP-24-02-A fix (Phase 24-06): defensive top-of-handler guard. The OL singleclick
      // event is dispatched synchronously by OL but the handler is async — if a click
      // event is queued before unmount and the microtask runs after Effect 1's cleanup
      // begins, mountedRef will already be false.
      if (!mountedRef.current) return;

      infoQueryAbortRef.current?.abort(); // abort prior fan-out on re-click
      useInfoSelectionStore.getState().reset();
      overlayRef.current?.setPosition(undefined);
      const controller = new AbortController();
      infoQueryAbortRef.current = controller;

      const view = map.getView();
      const size = map.getSize();
      if (!size) return;
      const [rawLon, clickLat] = transform(
        event.coordinate,
        "EPSG:3857",
        "EPSG:4326"
      ) as [number, number];
      // OL multi-world wrapping: a click in a repeated world copy (panned across
      // the date line) yields a longitude beyond ±180. Normalize so the spatial
      // query matches the table's [-180,180) data (otherwise info-click finds
      // nothing near the antimeridian).
      const clickLon = wrapLongitude(rawLon);
      // BUG FIX: server-side radiusConversion expects bbox in EPSG:4326 (degrees);
      // view.calculateExtent returns the view's projection (EPSG:3857 / meters).
      // Without this transform the server computed radii millions-of-meters too large.
      const mapBbox = transformExtent(
        view.calculateExtent(size),
        "EPSG:3857",
        "EPSG:4326"
      ) as [number, number, number, number];
      const radiusPx = getInfoRadiusPx(widgetConfig as MapWidgetConfig);

      // Plan 23-02 (CARD-V14-02): capture the click context for cross-component replay.
      // Card's <InfoSelectionView /> dropdown-switch + Load-more (Plan 23-03) read from this slice
      // because the card has no mapRef. setContext fires UNCONDITIONALLY on every info-enabled click,
      // BEFORE the fan-out loop — even if all layers fail/abort, the click happened and the coords
      // are valid context. Pitfall 2 lock: when this is null, dropdown-switch in the view short-circuits.
      useLastInfoClickContextStore.getState().setContext({
        clickLon,
        clickLat,
        mapBbox,
        mapWidthPx: size[0],
        mapHeightPx: size[1],
        radiusPx,
        sourceWidgetId: widget.id,
      });

      let errorCount = 0;
      let firstHit = false;

      // Post-VERIFY zoom-range gate for info-click fan-out: a layer that is
      // visually hidden because the current map zoom is outside its configured
      // [minZoom, maxZoom] range should NOT participate in the info-query
      // fan-out — otherwise the operator clicks "empty map space" (no visible
      // tile rendered for that layer) but still receives records from a layer
      // they can't see. Skipping is silent (NOT errorCount++) because the
      // layer's absence at this zoom is operator-configured, not an error
      // condition. Wire format is INCLUSIVE on both bounds (mirrors
      // ZoomRangeSlider + applyZoomRangeToLayer semantics).
      const currentZoom = view.getZoom();
      const isLayerVisibleAtCurrentZoom = (
        layer: DashboardLayerDto,
      ): boolean => {
        if (currentZoom === undefined) return false; // defensive — no info-query when zoom is unknown
        const cfg = layer.config as Partial<MapWidgetConfig>;
        const min = cfg.minZoom ?? -Infinity;
        const max = cfg.maxZoom ?? Infinity;
        return currentZoom >= min && currentZoom <= max;
      };

      for (const layer of eligibleLayers) {
        if (controller.signal.aborted) return;

        // Zoom-range gate (post-VERIFY): silently skip layers the operator can't
        // see at the current zoom. Empty `errorCount`-style ledger NOT bumped —
        // out-of-range is intentional, not failure.
        if (!isLayerVisibleAtCurrentZoom(layer)) continue;

        const tableMeta = tables.find((t) => t.id === layer.table_id);
        if (!tableMeta) { errorCount++; continue; }
        const cfg = layer.config as Partial<MapWidgetConfig>;
        // TRACKFIX-V19-07 (GAP-54-08): thread layer.track_config as the 2nd arg so
        // buildSpatialColumns can resolve xCol/yCol for track-mode layers. track_config
        // is a top-level DashboardLayerDto column — it is NOT inside layer.config.
        const spatialColumns = buildSpatialColumns(cfg, layer.track_config);
        if (!spatialColumns) { errorCount++; continue; }

        // Pick the FROM target for the info-query SQL. The server's info-query
        // endpoint uses `viewName` (when set) verbatim as the FROM clause —
        // mirrors what the WMS tile layer renders. Precedence:
        //
        //   1. DV-bound + materialized → query the DYNAMIC VIEW. The tiles the
        //      operator clicked were rendered from this view; querying the
        //      filter view (or source table) would return records that don't
        //      match what's visible — confusing UX. Post-VERIFY operator
        //      report: the prior code path used filter-view name even for
        //      dv-bound layers, surfacing record sets that didn't correspond
        //      to the rendered tiles.
        //
        //   2. Filter view (v1.3 path) → for table-bound layers with an
        //      active filter, query the filter view so records align with the
        //      filtered tile set.
        //
        //   3. undefined → server falls through to FROM <schema>.<table>
        //      (Phase 18 default for unfiltered table-bound layers).
        let queryViewName: string | undefined;
        if (layer.dynamic_view_id != null) {
          const dvEntry =
            useDynamicViewStore.getState().views[layer.dynamic_view_id];
          if (dvEntry?.status === "materialized" && dvEntry.viewName) {
            queryViewName = dvEntry.viewName;
          } else {
            // DV-bound but non-materialized (pending / over_threshold / error
            // / undefined). The WMS tile fan-out gate above (zoom check) +
            // earlier in this loop already returned `continue` for layers
            // whose dv isn't materialized — defense-in-depth: skip if we
            // somehow got here without a materialized dv.
            continue;
          }
        } else {
          const fvEntry = useFilterViewStore.getState().views[layer.table_id];
          if (fvEntry && !isViewExpired(fvEntry) && fvEntry.viewName) {
            queryViewName = fvEntry.viewName;
          }
        }

        useInfoSelectionStore.getState().setLoading(layer.id, true);
        try {
          // Phase 52: translate track→latlon at the wire boundary. The wire (InfoSpatialMode)
          // is a 3-mode union that never includes "track". buildSpatialColumns already
          // returns latlon-shaped {lonCol,latCol} for track layers, so the wire gets latlon.
          const infoMode: InfoSpatialMode =
            cfg.spatialMode === "track" ? "latlon" : (cfg.spatialMode as InfoSpatialMode);
          const res = await infoQuery({
            layerId: layer.id,
            tableId: layer.table_id,
            schema: tableMeta.schema,
            table: tableMeta.name,
            viewName: queryViewName,
            spatialMode: infoMode,
            spatialColumns,
            clickLon,
            clickLat,
            radiusPx,
            mapBbox,
            mapWidthPx: size[0],
            mapHeightPx: size[1],
            page: 0,
          }, controller.signal);
          // GAP-24-02-A fix (Phase 24-06): post-await mountedRef guard. The
          // controller.signal.aborted check does NOT cover the post-unmount case (Effect
          // 1's cleanup aborts the controller via infoQueryAbortRef.current?.abort(), but
          // a click queued just before unmount may race the cleanup such that the await
          // resolves on a different microtask boundary).
          if (!mountedRef.current) return;
          if (controller.signal.aborted) return;
          useInfoSelectionStore.getState().setLoading(layer.id, false);

          if (res.rows.length > 0) {
            const s = useInfoSelectionStore.getState();
            s.setSelection(layer.id, res);
            s.setActiveLayer(layer.id);
            // Edge-aware positioning: prefer top-right of cursor; flip to whichever
            // corner has enough room for the popup. Fallback = original top-right.
            const popupW = getInfoPopupWidthPx(widgetConfig as MapWidgetConfig);
            const popupH = getInfoPopupHeightPx(widgetConfig as MapWidgetConfig);
            const pixel = map.getPixelFromCoordinate(event.coordinate) as [number, number] | null;
            if (overlayRef.current && pixel) {
              const { positioning, offset } = pickPopupAnchor(
                pixel,
                [size[0], size[1]],
                popupW,
                popupH,
              );
              overlayRef.current.setPositioning(positioning);
              overlayRef.current.setOffset(offset);
            }
            overlayRef.current?.setPosition(event.coordinate);
            firstHit = true;
            break; // stop fan-out on first hit
          }
        } catch (err: unknown) {
          // GAP-24-02-A fix (Phase 24-06): catch-block guard mirrors the success-branch.
          if (!mountedRef.current) return;
          if (controller.signal.aborted) return;
          const e = err as { name?: string };
          if (e?.name === "AbortError") return;
          errorCount++;
          useInfoSelectionStore.getState().setLoading(layer.id, false);
        }
      }

      if (!firstHit) {
        if (errorCount === eligibleLayers.length && errorCount > 0) {
          useToastStore.getState().showToast(
            `Failed to fetch info for ${errorCount} layer(s)`,
            "error"
          );
        } else {
          useToastStore.getState().showToast("No records within click radius", "info");
        }
      }
    };

    map.on("singleclick", handler as never);
    return () => {
      map.un("singleclick", handler as never);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getInfoEnabled(widgetConfig as MapWidgetConfig), eligibleLayers, tables, widgetConfig]);

  // ── Effect 7 (Phase 29 SHAPE-V15-02 / V15-03): shape sync — store → OL features + overlays ─
  // Subscribed to shapesKey primitive (PITFALL S-02). Atomic clear+re-add (Pitfall 1: avoid
  // duplicate features with Plan 04's drawend). Per-shape persistent measurement-pill Overlay
  // anchored to polygon interior point (Pitfall 3: clean up overlays on removal).
  //
  // showShapeMeasurements toggle (Phase 29 follow-up): when false the on-map pill is hidden
  // and existing overlays are removed. The FilterBar chip's measurement text is unaffected —
  // it lives in DashboardsPage, not on the map.
  const showShapeMeasurements = getShowShapeMeasurements(widgetConfig as MapWidgetConfig);
  useEffect(() => {
    const map = mapRef.current;
    const source = vectorSourceRef.current;
    if (!map || !source) return;
    if (!mountedRef.current) return;

    const shapes = useSpatialFilterStore.getState().shapes;
    const currentIds = new Set(shapes.map((sh) => sh.id));

    // Tear down stale per-shape overlays first. When the on-map pill toggle is off,
    // tear down ALL existing overlays — currentIds is treated as empty for overlay-keep.
    for (const [id, overlay] of shapeOverlaysRef.current) {
      if (!showShapeMeasurements || !currentIds.has(id)) {
        try { map.removeOverlay(overlay); } catch { /* already detached; ignore */ }
        shapeOverlaysRef.current.delete(id);
      }
    }

    // Atomic clear + re-add (avoids feature-id collision; mirrors Phase 16 patterns).
    source.clear(true);

    const wktFormat = new WKT();
    for (const shape of shapes) {
      let geom: Polygon;
      try {
        geom = wktFormat.readGeometry(shape.wkt, {
          dataProjection: "EPSG:4326",
          featureProjection: "EPSG:3857",
        }) as Polygon;
      } catch {
        // Defensive: corrupt WKT in the store would otherwise crash the sync. Skip it.
        continue;
      }

      const feature = new Feature({ geometry: geom });
      feature.setId(shape.id);
      feature.set("shapeType", shape.type);
      source.addFeature(feature);

      // Persistent measurement label (SHAPE-V15-03). Skip entirely when the toggle is off —
      // shapes still render on the VectorLayer; only the measurement pill is hidden.
      if (!showShapeMeasurements) continue;

      let overlay = shapeOverlaysRef.current.get(shape.id);
      if (!overlay) {
        const el = document.createElement("div");
        el.className = "shape-measurement-pill";
        el.textContent = shape.measurement;
        el.setAttribute("aria-hidden", "true");
        overlay = new Overlay({
          element: el,
          positioning: "center-center",
          stopEvent: false,
        });
        map.addOverlay(overlay);
        shapeOverlaysRef.current.set(shape.id, overlay);
      } else {
        // Same id, same measurement — defensive sync of text content.
        const el = overlay.getElement() as HTMLElement | null;
        if (el) el.textContent = shape.measurement;
      }
      // Position overlay at polygon interior point (works for non-convex lassos).
      const interior = geom.getInteriorPoint().getCoordinates();
      overlay.setPosition([interior[0], interior[1]]);
    }
    // No explicit cleanup beyond Effect 1's overlay-clear — overlay set/delete is managed in-effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapesKey, showShapeMeasurements]);

  // ── Effect 8 (Phase 29 DRAW-V15-04..06): OL Draw interaction lifecycle ───
  // Mounts a new Draw interaction per draw mode; drawstart adds a live measurement tooltip
  // overlay; drawend validates → simplifies (lasso only) → measures → WKT-serializes →
  // commits to useSpatialFilterStore → removes the sketch feature (Pitfall 1) → auto-restores
  // previousMode. ESC keydown aborts the current draw and restores previousMode.
  //
  // mountedRef gate + window-level keydown listener cleanup (Pitfall 8) prevent leaks.
  useEffect(() => {
    const map = mapRef.current;
    const source = vectorSourceRef.current;
    if (!map || !source) return;
    if (drawMode === "pan" || drawMode === "info") return;

    const draw = buildDrawInteraction(drawMode, source);
    if (!draw) return;
    drawRef.current = draw;

    // ── Live tooltip lifecycle (Pattern 9) ──────────────────────────────────
    let tipOverlay: Overlay | null = null;
    let geomChangeKey: EventsKey | null = null;

    const cleanupLiveTooltip = () => {
      if (geomChangeKey) { unByKey(geomChangeKey); geomChangeKey = null; }
      if (tipOverlay) { map.removeOverlay(tipOverlay); tipOverlay = null; }
    };

    draw.on("drawstart", (event: any) => {
      if (!mountedRef.current) return;
      const sketchGeom = event.feature.getGeometry();
      if (!sketchGeom) return;

      const el = document.createElement("div");
      el.className = "shape-measurement-pill";
      el.setAttribute("aria-hidden", "true");
      tipOverlay = new Overlay({
        element: el,
        positioning: "bottom-left",
        offset: [12, -8],
        stopEvent: false,
      });
      map.addOverlay(tipOverlay);

      geomChangeKey = sketchGeom.on("change", () => {
        if (!mountedRef.current || !tipOverlay) return;
        const geomType = sketchGeom.getType();
        let text = "";
        let tipCoord: [number, number] | null = null;
        if (geomType === "Polygon") {
          // bbox / circle / lasso post-close — compute the mode's measurement
          try {
            text = computeMeasurement(drawMode as "bbox" | "lasso" | "circle", sketchGeom as Polygon);
            const interior = (sketchGeom as Polygon).getInteriorPoint().getCoordinates();
            tipCoord = [interior[0], interior[1]];
          } catch { /* defensive — Pitfall 5: mid-draw geometry may be transient */ }
        } else if (geomType === "LineString") {
          // Pitfall 5: lasso freehand mid-draw is a LineString. Show running length.
          try {
            const line = sketchGeom as LineString;
            const lastCoord = line.getLastCoordinate() as [number, number];
            const firstCoord = ((line as any).getCoordinates()[0] ?? lastCoord) as [number, number];
            const a = transform(firstCoord, "EPSG:3857", "EPSG:4326") as [number, number];
            const b = transform(lastCoord, "EPSG:3857", "EPSG:4326") as [number, number];
            const distMeters = getDistance(a, b);
            text = formatDistance(distMeters);
            tipCoord = lastCoord;
          } catch { /* defensive */ }
        }
        if (tipOverlay) {
          (tipOverlay.getElement() as HTMLElement).textContent = text;
          if (tipCoord) tipOverlay.setPosition(tipCoord);
        }
      }) as EventsKey;
    });

    // ── drawend pipeline (Pattern 3) ────────────────────────────────────────
    draw.on("drawend", (event: any) => {
      cleanupLiveTooltip();
      if (!mountedRef.current) return;

      const feature = event.feature;
      const geom = feature.getGeometry() as Polygon;
      const view = map.getView();
      const resolution = view.getResolution() ?? 1;

      // (1) Reject degenerate (V15-P-13 + DRAW-V15-06).
      if (isDegenerateExtent(geom.getExtent(), resolution)) {
        try { source.removeFeature(feature); } catch { /* ignore */ }
        useToastStore.getState().showToast("Shape too small — try again", "info");
        // Suppress the trailing singleclick from this same gesture — see lastDrawEndAtRef.
        lastDrawEndAtRef.current = Date.now();
        setDrawMode(previousModeRef.current);
        return;
      }

      // (2) Lasso simplification (V15-P-03). simplify() returns a NEW Polygon.
      let finalGeom: Polygon = geom;
      if (drawMode === "lasso") {
        finalGeom = geom.simplify(resolution * 2) as Polygon;
      }

      // (3) Compute measurement (DRAW-V15-05) — ol/sphere only (V15-P-04 lock).
      const measurement = computeMeasurement(drawMode as "bbox" | "lasso" | "circle", finalGeom);

      // (4) WKT serialize in EPSG:4326. WKT writer handles the transform internally
      //     when both dataProjection + featureProjection are provided.
      const wkt = new WKT().writeGeometry(finalGeom, {
        dataProjection: "EPSG:4326",
        featureProjection: "EPSG:3857",
      });

      // (5) Remove the sketch feature so Effect 7's reconcile is the sole writer
      //     of VectorSource state (Pitfall 1 duplicate-feature guard).
      try { source.removeFeature(feature); } catch { /* may already be removed */ }

      // (6) Commit to store. addShape synthesizes id/label/addedAt internally (Phase 27 contract).
      useSpatialFilterStore.getState().addShape({
        type: drawMode as "bbox" | "lasso" | "circle",
        wkt,
        measurement,
      });

      // (7) Auto-restore previous mode (DRAW-V15-02).
      // Stamp lastDrawEndAtRef BEFORE setDrawMode so Effect 6's singleclick suppression
      // window starts the moment the draw completed — covers the OL 250ms debounce.
      lastDrawEndAtRef.current = Date.now();
      setDrawMode(previousModeRef.current);
    });

    map.addInteraction(draw);

    // ── ESC keydown abort (Pitfall 8: window-level, cleaned up on mode change) ────
    const escHandler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!drawRef.current) return;
      try { drawRef.current.abortDrawing(); } catch { /* ignore */ }
      cleanupLiveTooltip();
      setDrawMode(previousModeRef.current);
    };
    window.addEventListener("keydown", escHandler);

    // Cleanup on mode change AND unmount.
    return () => {
      window.removeEventListener("keydown", escHandler);
      cleanupLiveTooltip();
      try { map.removeInteraction(draw); } catch { /* ignore */ }
      drawRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawMode]);

  // ── Phase 29 (SHAPE-V15-04): selection-click listener ────────────────────
  // Mode-gated to bbox/lasso/circle (NOT info — would conflict with v1.4 popup;
  // NOT pan — Pan has no shape-interaction surface).
  // This is a SECOND singleclick listener on the map. Both this and Effect 6's
  // info listener fire on every click. The mode-guards keep them orthogonal:
  // - Info mode: Effect 6 fan-out fires; this listener short-circuits via deps gate.
  // - Bbox/Lasso/Circle: Effect 6 short-circuits via V15-P-01 mode-guard (Plan 01);
  //   this listener handles selection.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (drawMode !== "bbox" && drawMode !== "lasso" && drawMode !== "circle") return;

    const handler = (event: { pixel: [number, number] }) => {
      if (!mountedRef.current) return;
      let hitId: string | null = null;
      map.forEachFeatureAtPixel(
        event.pixel,
        (feature) => {
          const id = feature.getId();
          if (typeof id === "string") { hitId = id; return true; }
          return false;
        },
        { layerFilter: (l) => l === vectorLayerRef.current },
      );
      setSelectedShapeId(hitId); // null clears (empty area click)
    };
    map.on("singleclick", handler as never);
    return () => {
      map.un("singleclick", handler as never);
    };
  }, [drawMode]);

  // ── Phase 29 (SHAPE-V15-04): Delete keydown — removes selected shape ────
  // Mode-gated to draw modes (NOT info — would interfere with form inputs that
  // bind Backspace; NOT pan). Silent no-op when no selection.
  useEffect(() => {
    if (drawMode !== "bbox" && drawMode !== "lasso" && drawMode !== "circle") return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const id = selectedShapeIdRef.current;
      if (!id) return; // silent no-op (29-CONTEXT.md lock)
      useSpatialFilterStore.getState().removeShape(id);
      setSelectedShapeId(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [drawMode]);

  // ── Phase 29 (SHAPE-V15-04): clear selection when switching to non-draw mode ──
  // 29-CONTEXT.md: "Selection cleared automatically when switching to Info/Pan mode."
  // Switching between draw modes (bbox↔lasso↔circle) PRESERVES selection.
  useEffect(() => {
    if (drawMode === "pan" || drawMode === "info") {
      setSelectedShapeId(null);
    }
  }, [drawMode]);

  // ── Phase 29 (SHAPE-V15-04): clear dangling selection ────────────────────
  // If the selected shape is removed by ANY path (Delete, clearAll, future chip×
  // from Phase 30), selectedShapeId would otherwise hold a stale id. Reconcile
  // to null on every shapes-list change.
  useEffect(() => {
    const id = selectedShapeIdRef.current;
    if (id === null) return;
    const shapes = useSpatialFilterStore.getState().shapes;
    if (!shapes.some((s) => s.id === id)) {
      setSelectedShapeId(null);
    }
    // Reads via ref to avoid making selectedShapeId itself a dep (would loop).
    // Dep on shapesKey ensures the check runs on every shape mutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapesKey]);

  // ── JSX ───────────────────────────────────────────────────────────────────
  // containerRef div MUST always render (Effect 1 fires once on mount; M-01 lock).
  const showReconfigureOverlay = isOldPhase11Config(widgetConfig);
  const showEmptyOverlay = !showReconfigureOverlay && includedLayers.length === 0;

  return (
    <div className="widget-map">
      {/* Phase 35 post-VERIFY CRITICAL: popup container MUST be the FIRST child of
          widget-map (NOT the last). OL's `map.addOverlay(overlay)` physically MOVES
          popupContainerRef.current into the OL viewport (child of widget-map-canvas)
          via appendChild — so this <div>'s React-tracked position no longer matches
          its DOM position after the OL Overlay effect runs.

          When popup was at position 9 (last), React's getHostSibling for a conditional
          mid-tree insertion (e.g. {hasOverThresholdLayers && <div>} flipping true)
          could walk forward and find the popup fiber as the next host sibling. React
          would then call parent.insertBefore(newDiv, popupDOM) — and crash with
          "The node before which the new node is to be inserted is not a child of
          this node" because OL had moved popupDOM out of widget-map's children.

          Placing the popup at position 0 means no later-sibling insertion ever
          references it via getHostSibling (the walk goes forward only). The OL move
          still happens, but never causes a reconciliation crash.

          See: live UAT after adding a dv-bound layer to a new map widget — the
          over-threshold overlay (Plan 35-06) flipped true and triggered the crash.
          The bug was latent before Phase 35 because no conditional sibling between
          the canvas and the popup ever flipped while the popup was at position 9. */}
      <div
        ref={popupContainerRef}
        className="info-popup-overlay-element"
        style={{ width: `${getInfoPopupWidthPx(widgetConfig as MapWidgetConfig)}px` }}
      >
        <InfoPopup
          eligibleLayers={eligibleLayers}
          layerNameFor={layerNameFor}
          resolveTable={resolveTable}
          onClose={handleDismiss}
          widthPx={getInfoPopupWidthPx(widgetConfig as MapWidgetConfig)}
          heightPx={getInfoPopupHeightPx(widgetConfig as MapWidgetConfig)}
        />
      </div>

      {/* Phase 29 test seam: data-draw-mode attribute for spec assertions; aria-hidden so screen readers skip it */}
      <span
        data-testid="draw-mode-debug"
        data-draw-mode={drawMode}
        aria-hidden="true"
        style={{ display: "none" }}
      />
      {/* Phase 29 (SHAPE-V15-04) test seam: exposes selectedShapeId for spec assertions */}
      <span
        data-testid="selected-shape-id"
        data-selected-shape-id={selectedShapeId ?? ""}
        aria-hidden="true"
        style={{ display: "none" }}
      />
      {/* OL renders into this div — PITFALL M-01 lock: ref points here */}
      <div ref={containerRef} className="widget-map-canvas" />

      {/* quick-260608-rbq: top-center "Loading…" badge. React overlay (V15-P-17 lock —
          NOT an ol/control). Shown iff isMapLoading AND showLoadingIndicator is enabled
          (default true — legacy widgets without the field get the indicator ON). Uses
          the existing .widget-filtering-spinner for the spinner. pointer-events:none so
          the badge never blocks map interaction. */}
      {isMapLoading && getShowLoadingIndicator(widgetConfig as MapWidgetConfig) && (
        <div className="widget-map-loading-badge" role="status" aria-live="polite">
          <span className="widget-filtering-spinner" aria-hidden="true" />
          <span>Loading…</span>
        </div>
      )}

      {/* Custom zoom toolbar (visual parity with MapDrawToolbar). Sibling to OL canvas
          per V15-P-17 lock. Animates the view by ±1 zoom level over 200ms — matches
          the default OL Zoom control's duration. View constraints (min/max zoom)
          clamp automatically inside ol/View.animate. */}
      <MapZoomToolbar
        onZoomIn={() => {
          const view = mapRef.current?.getView();
          if (!view) return;
          const z = view.getZoom();
          if (z === undefined) return;
          view.animate({ zoom: z + 1, duration: 200 });
        }}
        onZoomOut={() => {
          const view = mapRef.current?.getView();
          if (!view) return;
          const z = view.getZoom();
          if (z === undefined) return;
          view.animate({ zoom: z - 1, duration: 200 });
        }}
      />

      {/* Phase 29 (DRAW-V15-01): drawing toolbar overlay. Sibling to the OL canvas
          (NOT a child) per V15-P-17 lock — React component, NOT ol/control/Control. */}
      <MapDrawToolbar
        drawMode={drawMode}
        onModeChange={setDrawMode}
        shapesCount={shapesCount}
        onClearAll={() => useSpatialFilterStore.getState().clearAll()}
        eligibleTargetTableNames={eligibleTargetTableNames}
      />

      {/* v1.7 Phase 41 (PANEL-V17-03/05): in-map legend overlay.
          React tree only — NOT OL addOverlay (Phase 35 popup-DOM-tracking lesson).
          z=1000 sits below toolbars (z=1001 per V15-P-17 lock). */}
      {getLegendPanelEnabled(widgetConfig as MapWidgetConfig) && (
        <LayersLegendPanel
          layers={resolvedLegendLayers}
          corner={getLegendPanelCorner(widgetConfig as MapWidgetConfig)}
          collapsed={legendCollapsed}
          onToggleCollapse={() => setLegendCollapsed((c) => !c)}
          onToggleVisible={toggleLayerVisible}
        />
      )}

      {showReconfigureOverlay && (
        <div className="widget-map-reconfigure" role="status">
          <div className="widget-map-reconfigure-badge">
            This map needs to be reconfigured. Open the Layers panel to create layers, then select them in this widget&apos;s config.
          </div>
        </div>
      )}

      {showEmptyOverlay && (
        <div className="widget-map-empty" role="status">
          No layers — open the Layers panel to add some
        </div>
      )}

      {/* Phase 35 (DV-V16-14): "Some layers over threshold" overlay surfaces when at least
          one dv-bound layer is non-materialized (pending / over_threshold / error / absent
          entry). buildWmsParams returns null for those layers and Effect 2 omits them from
          the visible stack; this overlay tells the operator a layer is intentionally hidden.
          Silent / inline visual — no toast fires (per locked status-aware-rendering taxonomy).

          Layout collision avoidance: when the in-map Layers panel is anchored
          top-right, the warning would sit underneath it. Detect that case and
          flip the warning to bottom-left via a modifier class. */}
      {hasOverThresholdLayers && (() => {
        const legendEnabled = getLegendPanelEnabled(widgetConfig as MapWidgetConfig);
        const legendCorner = getLegendPanelCorner(widgetConfig as MapWidgetConfig);
        const flipToBottomLeft = legendEnabled && legendCorner === "top-right";
        return (
          <div
            className={`map-over-threshold-overlay${flipToBottomLeft ? " map-over-threshold-overlay--bottom-left" : ""}`}
            role="status"
            aria-live="polite"
          >
            Some layers over threshold
          </div>
        );
      })()}

      {/* Tile-error overlay — UI-SPEC.md Copywriting Contract: exact copy strings */}
      {tileLoadError && !errorOverlayDismissed && (
        <div className="widget-map-error">
          <div className="widget-map-error-title">Failed to load map tiles</div>
          <div className="widget-map-error-body">
            Tiles could not be fetched from Kinetica. Check your filter or retry.
          </div>
          <button
            className="widget-map-error-retry ghost-sm"
            aria-label="Retry loading map tiles"
            onClick={onRetryTiles}
          >
            Retry
          </button>
        </div>
      )}

      {/* Phase 21 POPUP-V14-01 (Phase 35 post-VERIFY relocation): popup container
          MOVED to the TOP of widget-map (first child) to prevent React reconciler
          crashes when OL's addOverlay relocates popupContainerRef.current out of
          widget-map's child list. See the comment block at the top of this return
          statement for the full rationale. */}
    </div>
  );
}
