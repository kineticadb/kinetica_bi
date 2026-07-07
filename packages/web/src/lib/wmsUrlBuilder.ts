/**
 * Phase 11 origin → Phase 16 v1.3 cleanup: WMS URL parameter builder.
 *
 * Phase 16 (MAP-V13-01..06): server-side WHERE moved to /api/filter/materialize endpoint
 * (Phase 13 VIEW-V13-06). This builder no longer accepts a SQL-clause arg; the prior FILT-04
 * filter emit block was removed. The legacy filter-version cache-buster was renamed to _mv
 * (materialize-version) and made conditional (emit only when materializeVersion !== undefined).
 *
 * AP-3 lock (carry-forward, type-enforced): server-side filtering only. The removal of the
 * SQL-clause arg is the architectural anti-corruption boundary — the builder cannot accept
 * client-side SQL clauses, full stop.
 *
 * PITFALL M-02 lock: cache-bust via _mv (materializeVersion); emitted only when a view is
 *   in use. When LAYERS falls through to <schema.table>, the URL changes anyway, so _mv
 *   is unnecessary. PT16-A lock: NEVER emit _mv=0 sentinel — omit instead.
 * PITFALL M-03 lock: SRS=EPSG:3857 explicitly included in every request.
 * PITFALL M-04 lock: WKT vs WKB branch — both use GEO_ATTR (Kinetica detects column type
 *   from column metadata; the builder just passes the column name under the same param).
 * PITFALL M-05 lock: BLUR_RADIUS/CONTOUR_BANDWIDTH units are Kinetica map units — NOT pixels.
 *   Caller (MapConfigPanel UI) is responsible for labelling them correctly.
 */

import type { SpatialMode } from "./columnTypes";
import type { SpatialTarget } from "./spatialTargets";
import { normalizeAARRGGBB } from "./colorHex";
import { coalesceCbConfig, isCbConfigConfigured, type CbBreak } from "./cbConfig";
import { coalesceTrackConfig, type TrackConfig } from "./trackConfig";

// Phase 40: TrackConfig + coalesceTrackConfig moved to lib/trackConfig.ts.
// Re-export here so the line-440 callsite + any Phase 38 spec imports keep working.
export { type TrackConfig, coalesceTrackConfig } from "./trackConfig";

export type RenderMode = "raster" | "heatmap" | "classbreak" | "contour";
export type ClassbreakBreak = { value: string | number; color: string };

export type PointShape =
  | "none"
  | "circle"
  | "dash"
  | "diamond"
  | "dot"
  | "hollowcircle"
  | "hollowdiamond"
  | "hollowsquare"
  | "hollowsquarewithplus"
  | "pipe"
  | "plus"
  | "square";

export const POINT_SHAPES: PointShape[] = [
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
];

export type MapWidgetConfig = {
  tableId: number;
  /** Canonical table reference for WMS LAYERS param (e.g. "public.taxi_trips", schema-qualified). Phase 11-10. */
  tableRef?: string;
  /** Legacy back-compat field — use tableRef for new code. Kept so existing widget.config records continue to work. */
  layerName?: string;
  /** OL basemap selection — consumed by MapChartRenderer's basemapSourceFor; not emitted as a WMS param. */
  basemap?: "osm" | "voyager" | "dark";
  /** Post-VERIFY per-layer zoom-range visibility. INCLUSIVE on the wire:
   *  `[minZoom, maxZoom] = [3, 10]` reads as "visible at zoom 3-10 inclusive".
   *  MapChartRenderer.applyZoomRangeToLayer translates to OL's exclusive-min /
   *  inclusive-max convention. Undefined → no constraint at that bound. */
  minZoom?: number;
  maxZoom?: number;
  // Spatial
  spatialMode: SpatialMode;
  latColumn?: string;
  lonColumn?: string;
  wktColumn?: string;
  wkbColumn?: string;
  // Render
  renderMode: RenderMode;
  // Raster params
  pointColor?: string;    // AARRGGBB hex (e.g. "FFFF3838") — alpha + RGB; legacy 6-char values are normalized to FF + RRGGBB on emit
  pointSize?: number;     // px 1-20
  pointOpacity?: number;  // 0-100; emitted as separate POINTOPACITY param (SPIKE-NOTES Q6 resolution)
  pointShape?: PointShape;   // POINTSHAPES — point marker shape
  shapeFillColor?: string;   // AARRGGBB hex — SHAPEFILLCOLORS, alpha+RGB fill for WKT geometries
  shapeLineColor?: string;   // AARRGGBB hex — SHAPELINECOLORS, alpha+RGB line color for WKT lines
  shapeLineWidth?: number;   // 0-20 — SHAPELINEWIDTHS
  antialiasing?: boolean;    // ANTIALIASING — true/false
  // Heatmap params
  blurRadius?: number;     // Kinetica map units (PITFALL M-05)
  colormap?: string;       // Full Kinetica WMS docs catalog — see COLORMAP_GROUPS in KineticaWmsLayerForm.tsx
  reverseColormap?: boolean; // REVERSE_COLORMAP=TRUE inverts the colormap's color order
  // Classbreak params
  cbColumn?: string;
  cbBreakType?: "categorical" | "numerical";
  classbreaks?: ClassbreakBreak[];
  // Contour params
  contourColor?: string;     // RRGGBB hex
  contourSmooth?: boolean;
  contourBandwidth?: number; // Kinetica map units (PITFALL M-05)
  // v1.4 Phase 19 (CONFIG-V14-02): Map info popup widget-level fields.
  // All four are OPTIONAL so pre-Phase-19/post-Phase-19 MapWidgetConfig records continue to
  // type-check without a migration. Backward-compatible defaults are applied at the read site
  // by getInfoEnabled / getInfoRadiusPx / getInfoPopupWidthPx / getInfoPopupHeightPx in
  // src/lib/mapInfoConfig.ts. These fields are NOT emitted as WMS URL params — the info popup
  // uses a separate POST /api/info/query call (Phase 18).
  // infoPopupWidthPx/HeightPx apply ONLY to the popup; the Info Card chart type sizes itself
  // via the dashboard widget grid (separate dimension system).
  infoEnabled?: boolean;
  infoRadiusPx?: number;
  infoPopupWidthPx?: number;
  infoPopupHeightPx?: number;
  // v1.5 Phase 29 follow-up: per-map toggle for the persistent shape-measurement pills
  // anchored to drawn shapes' interior points. When false, MapChartRenderer's Effect 7 skips
  // creating the overlay AND removes any existing one so the shape is shown but the size /
  // area text is hidden. The FilterBar chip ALWAYS shows the measurement regardless — the
  // toggle only controls the on-map pill. Default true (backward-compatible).
  showShapeMeasurements?: boolean;
  // v1.5 Phase 28 (TARGET-V15-01): Per-map widget spatial filter target list.
  // Locked-empty default for legacy v1.4 widgets via getSpatialTargets() — no migration.
  // Each target binds a tableId + spatialMode + the mode-appropriate column(s) so the
  // Phase 30 materialize trigger can compose a per-target spatial WHERE clause via the
  // server-side buildSpatialOrBlock builder (already shipped Phase 26). The SpatialTarget
  // type is byte-parity with packages/server/src/lib/spatialWhereClause.ts lines 75-81;
  // the Phase 30 materializeFilter helper sends this array as-is over the wire.
  spatialTargets?: SpatialTarget[];
  // v1.7 Phase 41 (PANEL-V17-04): Layers Legend Panel widget-level config.
  // Both optional for backward-compat with legacy widget config blobs —
  // missing fields default via getLegendPanelEnabled() / getLegendPanelCorner()
  // in lib/legendPanelConfig.ts (same pattern as v1.4 Phase 19 mapInfoConfig.ts).
  legendPanelEnabled?: boolean;
  legendPanelCorner?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  // quick-260608-j5k: opt-in OpenLayers map controls. Both DEFAULT FALSE — legacy widgets
  // (field absent) get no ScaleLine / no FullScreen, byte-identical to today. Not WMS params;
  // consumed only by MapChartRenderer's control construction. Defaults resolved via
  // getShowScaleBar / getShowFullscreenButton in lib/mapInfoConfig.ts.
  showScaleBar?: boolean;
  showFullscreenButton?: boolean;
  // quick-260608-rbq: opt-in in-map WMS loading indicator. DEFAULT TRUE (legacy widgets
  // with the field absent get the indicator ON). Not a WMS param — consumed only by
  // MapChartRenderer's badge render via getShowLoadingIndicator in lib/mapInfoConfig.ts.
  showLoadingIndicator?: boolean;
  /** Phase 104 (MAPSYNC-V119-01): opt-in per-dashboard viewport sync. Default OFF.
   *  Pure client-side view-state flag — NEVER emitted as a WMS request param. */
  syncViewport?: boolean;
};

// ─── SPIKE-LOCKED CONSTANTS ──────────────────────────────────────────────────
// Pulled verbatim from .planning/phases/11-map-chart/11-SPIKE-NOTES.md
// "Locked Parameter Names" table (HIGH confidence — verified against deployed Kinetica).
//
// X_ATTR: lon column (X axis = longitude) — X_COLUMN_NAME is WRONG (returns XML error)
// Y_ATTR: lat column (Y axis = latitude) — Y_COLUMN_NAME is WRONG
// GEO_ATTR: geometry column for WKT or WKB — confirmed by Kinetica error message content
// EPSG:3857: Web Mercator SRS — confirmed accepted; PITFALL M-03 lock
const X_COLUMN_PARAM = "X_ATTR";
const Y_COLUMN_PARAM = "Y_ATTR";
const GEOMETRY_COLUMN_PARAM = "GEO_ATTR";
const SRS_VALUE = "EPSG:3857";

// STYLES values per render mode — from 11-SPIKE-NOTES.md "STYLES values per render mode" table +
// 37-SPIKE-NOTES.md ## Decision (Phase 37 Lane C lock: STYLES=cb_raster is the production CB
// emission path; STYLES=classbreak Lane B remains in 37-SPIKE-NOTES.md as documentation only).
// raster/heatmap confirmed in GetCapabilities XML + GetMap probe.
// cb_raster: confirmed by Phase 37 Lane C probes — distinct from baseline (15597 vs 27384 bytes).
// contour: NOT in GetCapabilities XML but returns HTTP 200 on GetMap probe (dead code path —
//   RenderMode type keeps the value but Phase 39 form picker filters to 3 user-facing modes).
const STYLES_BY_MODE: Record<RenderMode, string> = {
  raster: "raster",
  heatmap: "heatmap",
  classbreak: "cb_raster",   // v1.7 Phase 38 (SCHEMA-V17-03): single CB path = Lane C
  contour: "contour",
};

// ─── POINTOPACITY treatment ──────────────────────────────────────────────────
// SPIKE-NOTES Q6 resolution: both RRGGBBAA suffix on POINTCOLOR and separate POINTOPACITY
// param are accepted by Kinetica WMS. Use separate POINTOPACITY param — cleaner UX because
// the color picker controls POINTCOLOR (6-digit RRGGBB) independently of the opacity slider.
// POINTCOLOR remains 6-digit RRGGBB; POINTOPACITY is emitted as a separate string "0"-"100".

// ─── Phase 35 dynamic-view input (DV-V16-13) ─────────────────────────────────
/**
 * Per-layer dynamic-view entry input for buildWmsParams precedence routing.
 *
 * Phase 35 (DV-V16-13): when a layer has dynamic_view_id set, the caller
 * (MapChartRenderer Effects 2+3, wired in Plan 35-06) computes this from
 * `useDynamicViewStore.views[layer.dynamic_view_id]` and passes it in. The
 * function returns null when the dv is non-materialized → caller omits the
 * layer from the visible N-layer stack and surfaces the "Some layers over
 * threshold" overlay.
 *
 * Distinct from `useFilterViewStore` entry shape — only `status` + `viewName`
 * are load-bearing for WMS URL construction. (expiresAt / reason / error are
 * renderer concerns and stay out of this builder's surface.)
 */
export type DynamicViewEntryInput = {
  status: "materialized" | "over_threshold" | "pending" | "error";
  viewName: string;
};

// ─── Main builder ─────────────────────────────────────────────────────────────
//
// Overload signatures (Phase 35 DV-V16-13):
//   - 2-arg form (legacy Phase 16 callers) → always returns Record<string, string>.
//     This preserves the "Existing callers compile unchanged" lock from the plan: when
//     no `dynamicViewEntry` is supplied, the function CANNOT enter the null-return branch,
//     so callers like MapChartRenderer Effects 2/3 don't need null-narrowing.
//   - 4-arg form (Phase 35+ dv-aware callers, wired in Plan 35-06) → returns
//     `Record<string, string> | null` because dv-bound + non-materialized must skip the layer.

export function buildWmsParams(
  config: MapWidgetConfig,
  materializeVersion: number | undefined,
): Record<string, string>;
export function buildWmsParams(
  config: MapWidgetConfig,
  materializeVersion: number | undefined,
  dynamicViewEntry: DynamicViewEntryInput | undefined,
  dynamicViewVersion: number | undefined,
): Record<string, string> | null;
export function buildWmsParams(
  config: MapWidgetConfig,
  materializeVersion: number | undefined,
  dynamicViewEntry: DynamicViewEntryInput | undefined,
  dynamicViewVersion: number | undefined,
  // v1.7 Phase 38 (SCHEMA-V17-03/04): raw cb_config + track_config JSON strings from the
  // layer row. Phase 38-02 reads them via coalesceCbConfig + coalesceTrackConfig at the
  // render-mode + Track branches. When undefined (legacy 2-arg / 4-arg callers from
  // Phase 16 + Phase 35), cb_raster branch suppresses CB_* emission and Track block
  // does not fire — backward-compat preserved.
  layerJsonFields: { cb_config: string | null; track_config: string | null },
): Record<string, string> | null;
export function buildWmsParams(
  config: MapWidgetConfig,
  materializeVersion: number | undefined,
  // NEW Phase 35 (DV-V16-13) — optional for backward compat with existing 2-arg callers
  // (MapChartRenderer Effects 2/3 today, Plan 35-06 will pass the new args once dv-binding wires through).
  dynamicViewEntry?: DynamicViewEntryInput,
  dynamicViewVersion?: number,
  // v1.7 Phase 38 (SCHEMA-V17-03/04): optional for backward compat with existing 2-arg / 4-arg callers.
  layerJsonFields?: { cb_config: string | null; track_config: string | null },
): Record<string, string> | null {
  const params: Record<string, string> = {
    SERVICE: "WMS",
    VERSION: "1.1.1",
    REQUEST: "GetMap",
    FORMAT: "image/png",
    TRANSPARENT: "true",
    SRS: SRS_VALUE,            // PITFALL M-03 lock — explicit SRS always included
    STYLES: STYLES_BY_MODE[config.renderMode],
  };

  // ─── Phase 35 (DV-V16-13): 4-case LAYERS / _mv precedence ────────────────
  // Locked precedence (35-CONTEXT.md §"buildWmsParams extension"):
  //   1. dvEntry.status === "materialized" → LAYERS=<dvViewName>, _mv=<dynamicViewVersion>
  //   2. dvEntry.status === pending/over_threshold/error → return null (caller SKIPS layer)
  //   3. else if materializeVersion present → LAYERS=<tableRef>, _mv=<materializeVersion> (Phase 16)
  //   4. else → LAYERS=<tableRef|layerName> bare (Phase 11)
  //
  // Pitfall 5 (35-RESEARCH.md:630-645): the LAYERS value differs across source kinds
  //   (dvViewName vs filterViewName vs schema.table), so OL's per-URL cache never
  //   collides regardless of any coincidental `_mv` overlap between counters.
  if (dynamicViewEntry !== undefined) {
    if (dynamicViewEntry.status === "materialized") {
      // Case 1: dv-bound + materialized → use dv view name + dv version cache-buster.
      params.LAYERS = dynamicViewEntry.viewName;
      if (dynamicViewVersion !== undefined) {
        params._mv = String(dynamicViewVersion);
      }
      // Spatial-mode + render-mode branches below still apply: a materialized dv view
      // is a regular Kinetica view, so spatial / styling params project onto it normally.
    } else {
      // Case 2: dv-bound + pending/over_threshold/error → SKIP this layer entirely.
      // Caller (Plan 35-06 MapChartRenderer Effect 2) detects null and omits the layer
      // from the N-layer stack; over-threshold overlay is surfaced from caller, not here.
      return null;
    }
  } else {
    // Cases 3+4: existing Phase 16 / Phase 11 precedence — UNCHANGED behavior.
    // Phase 16 (MAP-V13-03 / PT16-A lock): _mv emitted ONLY when materializeVersion is defined.
    // When falling through to LAYERS=<schema.table>, _mv is OMITTED entirely (no _mv=0 sentinel;
    // no _v repurposing). LAYERS source flip already drives URL change → cache-bust automatic.
    if (materializeVersion !== undefined) {
      params._mv = String(materializeVersion);
    }

    // LAYERS param — Phase 11-10: tableRef (canonical) takes precedence over layerName (back-compat).
    // If neither is set, LAYERS is omitted entirely (MapChartRenderer's isConfigComplete already gates
    // rendering on spatial columns; omitting LAYERS lets caller decide whether to issue the request).
    if (config.tableRef) {
      params.LAYERS = config.tableRef;
    } else if (config.layerName) {
      params.LAYERS = config.layerName;
    }
  }

  // ─── Spatial-mode branch ─────────────────────────────────────────────────
  // PITFALL M-04 lock: WKT and WKB both use GEO_ATTR — Kinetica server detects the
  // geometry encoding from the column's metadata type, not from the param name.
  if (config.spatialMode === "latlon") {
    // X axis = longitude (lon), Y axis = latitude (lat) — Kinetica geographic convention
    if (config.lonColumn) params[X_COLUMN_PARAM] = config.lonColumn;
    if (config.latColumn) params[Y_COLUMN_PARAM] = config.latColumn;
  } else if (config.spatialMode === "wkt") {
    if (config.wktColumn) params[GEOMETRY_COLUMN_PARAM] = config.wktColumn;
  } else if (config.spatialMode === "track") {
    // Phase 52: track spatial mode — emit X_ATTR/Y_ATTR from track_config.xCol/yCol.
    // Track columns live in track_config (NOT config.lonColumn); coalesceTrackConfig is
    // already imported. Guard with optional chaining — layerJsonFields is the optional 5th arg.
    const tc = coalesceTrackConfig(layerJsonFields?.track_config ?? null);
    if (tc.xCol) params[X_COLUMN_PARAM] = tc.xCol;
    if (tc.yCol) params[Y_COLUMN_PARAM] = tc.yCol;
  } else {
    // wkb — same param name as wkt per PITFALL M-04 lock
    if (config.wkbColumn) params[GEOMETRY_COLUMN_PARAM] = config.wkbColumn;
  }

  // ─── Render-mode branch ──────────────────────────────────────────────────
  if (config.renderMode === "raster") {
    if (config.pointColor !== undefined) {
      // POINTCOLORS (plural) — Kinetica WMS expects the plural form for raster point styling.
      // Normalize to 8-char AARRGGBB (alpha + RGB) — legacy 6-char values become FF + RRGGBB.
      params.POINTCOLORS = normalizeAARRGGBB(config.pointColor, "FFFF3838");
    }
    if (config.pointOpacity !== undefined) {
      // Separate POINTOPACITY param, range 0-100 — spike-locked per Q6 resolution
      params.POINTOPACITY = String(config.pointOpacity);
    }
    if (config.pointSize !== undefined) {
      // POINTSIZES (plural) — Kinetica WMS expects the plural form.
      params.POINTSIZES = String(config.pointSize);
    }
    if (config.pointShape !== undefined) {
      params.POINTSHAPES = config.pointShape;
    }
    // SHAPE-V114-03: SHAPE* style only applies to polygon/line geometry — suppress for
    // latlon points so stale saved values don't leak. Gate-only: saved config values are
    // untouched, so switching back to wkt/wkb restores emission.
    if (config.spatialMode !== "latlon") {
      if (config.shapeFillColor !== undefined) {
        // Normalize to 8-char AARRGGBB so legacy 6-char values still emit a valid alpha channel.
        params.SHAPEFILLCOLORS = normalizeAARRGGBB(config.shapeFillColor, "FFFF3838");
      }
      if (config.shapeLineColor !== undefined) {
        params.SHAPELINECOLORS = normalizeAARRGGBB(config.shapeLineColor, "FF000000");
      }
      if (config.shapeLineWidth !== undefined) {
        params.SHAPELINEWIDTHS = String(config.shapeLineWidth);
      }
    }
    if (config.antialiasing !== undefined) {
      params.ANTIALIASING = String(config.antialiasing);
    }
  } else if (config.renderMode === "heatmap") {
    if (config.blurRadius !== undefined) {
      params.BLUR_RADIUS = String(config.blurRadius); // PITFALL M-05: Kinetica map units
    }
    if (config.colormap !== undefined) {
      params.COLORMAP = config.colormap;
    }
    // REVERSE_COLORMAP per Kinetica WMS docs — TRUE inverts the colormap's
    // color order; FALSE keeps it as is.
    //
    // ALWAYS emit (TRUE or FALSE) when in heatmap mode — DO NOT rely on
    // omission to signal "default false." OL's `source.updateParams()`
    // MERGES new params into existing params instead of replacing them. If
    // a prior call set `REVERSE_COLORMAP=TRUE` and the next call omits the
    // key, the prior value persists on the source and shows up on every
    // subsequent tile URL. Emitting the explicit FALSE overwrites the
    // existing key during merge. The slight URL bloat is the cost of
    // correctness across the operator's toggle lifecycle.
    params.REVERSE_COLORMAP = config.reverseColormap === true ? "TRUE" : "FALSE";
  } else if (config.renderMode === "classbreak") {
    // v1.7 Phase 38 (SCHEMA-V17-03/04/05): Lane C cb_raster emission per
    // 37-SPIKE-NOTES.md ## Decision. STYLES is already "cb_raster" via
    // STYLES_BY_MODE swap. Hard cutover lock: the legacy cbColumn / cbBreakType /
    // classbreaks fields remain on MapWidgetConfig for back-compat but are
    // NEVER read by this branch — cb_config (via layerJsonFields) is the
    // sole source of Lane C params.
    //
    // 6-char color bug fix (SCHEMA-V17-05): POINTCOLORS emitted via
    // normalizeAARRGGBB(b.color, "FF000000") — same conformance as raster +
    // heatmap branches. Legacy 6-char break colors become FF + RRGGBB.
    //
    // <other> keyword (Phase 37 OQ-3 PASS): wmsUrlBuilder emits breaks[].value
    // verbatim into CB_VALS — caller URLSearchParams handles encoding.
    const cb = layerJsonFields ? coalesceCbConfig(layerJsonFields.cb_config) : null;
    if (cb && isCbConfigConfigured(cb)) {
      params.CB_ATTR = cb.attr;
      // CB_VALS format per Kinetica WMS docs (CB_DELIMITER ":"):
      //   numeric     → ranges "lo:hi,lo:hi,..." (start inclusive, end exclusive)
      //   categorical → comma-separated distinct values "a,b,<other>"
      params.CB_VALS =
        cb.valsType === "numeric"
          ? cb.breaks
              .map((b: CbBreak) => (b.value === "<other>" ? "<other>" : `${b.min ?? 0}:${b.max ?? 0}`))
              .join(",")
          : cb.breaks.map((b: CbBreak) => String(b.value)).join(",");
      params.POINTCOLORS = cb.breaks.map((b: CbBreak) => normalizeAARRGGBB(b.color, "FF000000")).join(",");
      // Optional per-break fields — emit only when at least one break has the field set
      // (keeps URL clean for the common case where operator hasn't touched advanced params).
      if (cb.breaks.some((b: CbBreak) => b.pointSize !== undefined)) {
        params.POINTSIZES = cb.breaks.map((b: CbBreak) => String(b.pointSize ?? 4)).join(",");
      }
      if (cb.breaks.some((b: CbBreak) => b.pointShape !== undefined)) {
        params.POINTSHAPES = cb.breaks.map((b: CbBreak) => b.pointShape ?? "circle").join(",");
      }
      // SHAPE-V114-03: SHAPE* style only applies to polygon/line geometry — suppress for
      // latlon points so stale saved per-break values don't leak. Gate-only: break values
      // are untouched, so switching back to wkt/wkb restores emission.
      if (config.spatialMode !== "latlon") {
        if (cb.breaks.some((b: CbBreak) => b.shapeLineWidth !== undefined)) {
          params.SHAPELINEWIDTHS = cb.breaks.map((b: CbBreak) => String(b.shapeLineWidth ?? 1)).join(",");
        }
        if (cb.breaks.some((b: CbBreak) => b.shapeLineColor !== undefined)) {
          params.SHAPELINECOLORS = cb.breaks.map((b: CbBreak) => normalizeAARRGGBB(b.shapeLineColor, "FF000000")).join(",");
        }
        if (cb.breaks.some((b: CbBreak) => b.shapeFillColor !== undefined)) {
          params.SHAPEFILLCOLORS = cb.breaks.map((b: CbBreak) => normalizeAARRGGBB(b.shapeFillColor, "FF000000")).join(",");
        }
      }
    }
    // If cb_config is null OR not configured, NO CB_* params emit. STYLES=cb_raster
    // still emits (per STYLES_BY_MODE swap); Kinetica renders as raster-equivalent.
    // Legacy v1.2 classbreak widgets (with legacy classbreaks[] but null cb_config)
    // hit this branch and render as raster (hard cutover lock from 38-CONTEXT.md).
  } else if (config.renderMode === "contour") {
    if (config.contourColor !== undefined) {
      params.CONTOUR_COLOR = config.contourColor.toUpperCase();
    }
    if (config.contourSmooth !== undefined) {
      params.CONTOUR_SMOOTH = String(config.contourSmooth);
    }
    if (config.contourBandwidth !== undefined) {
      params.CONTOUR_BANDWIDTH = String(config.contourBandwidth); // PITFALL M-05: Kinetica map units
    }
  }

  // v1.7 Phase 38 (SCHEMA-V17-04): Track block — append additively. Gated on
  // trackConfig.enabled === true AND render mode raster|classbreak (heatmap excluded
  // per 37-SPIKE-NOTES.md ## Decision — Track + heatmap was not probed; out of scope).
  //
  // Under STYLES=raster (renderMode === "raster"): single-value TRACK_* params.
  // Under STYLES=cb_raster (renderMode === "classbreak"): N comma-separated TRACK_*
  // params where N = cb_config.breaks.length (operator-confirmed comma-sep model
  // per Phase 37 SPIKE-V17-05 + 37-SPIKE-NOTES.md ## Decision lines 312-322).
  //
  // Backward-compat lock: trackConfig === undefined OR enabled !== true → NO Track
  // params emit; URL byte-identical to pre-v1.7 (regression spec locks).
  if (layerJsonFields?.track_config) {
    const tc = coalesceTrackConfig(layerJsonFields.track_config);
    if (tc.enabled && (config.renderMode === "raster" || config.renderMode === "classbreak")) {
      params.DOTRACKS = "TRUE";
      params.TRACK_ID_ATTR = tc.trackIdAttr ?? "TRACKID";
      params.TRACK_ORDER_ATTR = tc.trackOrderAttr ?? "TIMESTAMP";

      // TRACKFIX-V19-04 / GAP-54-05: Suppress the 7 point/shape keys under track mode.
      // Kinetica WMS ignores TRACK_* styling when these params are present — they must
      // be deleted so track tile rendering reflects TRACK_* styling exclusively.
      // These deletes run regardless of whether the raster or classbreak lane emitted them.
      delete params.POINTCOLORS;
      delete params.POINTOPACITY;
      delete params.POINTSIZES;
      delete params.POINTSHAPES;
      delete params.SHAPEFILLCOLORS;
      delete params.SHAPELINECOLORS;
      delete params.SHAPELINEWIDTHS;

      const isCb = config.renderMode === "classbreak";
      // Under cb_raster, expand to N = breaks.length matching CB_VALS; under raster, N = 1.
      const cbForTrack = isCb && layerJsonFields ? coalesceCbConfig(layerJsonFields.cb_config) : null;
      const n = isCb && cbForTrack && isCbConfigConfigured(cbForTrack) ? cbForTrack.breaks.length : 1;
      const expand = (v: string): string => Array.from({ length: n }, () => v).join(",");

      // TRACKFIX-V19-06: per-break colors under track+classbreak. One break color drives all
      // three TRACK_* color params positionally with CB_VALS (head/line/marker share the break color).
      // When cb_config is null/unconfigured or under raster, cbColors is null → fall back to expand.
      const cbColors: string[] | null =
        isCb && cbForTrack && isCbConfigConfigured(cbForTrack) && cbForTrack.breaks.length > 0
          ? cbForTrack.breaks.map((b: CbBreak) => normalizeAARRGGBB(b.color, "FFFFFFFF"))
          : null;
      const colorList = (single: string): string => (cbColors ? cbColors.join(",") : expand(single));

      if (tc.headColor !== undefined) {
        params.TRACKHEADCOLORS = colorList(normalizeAARRGGBB(tc.headColor, "FFFFFFFF"));
      }
      if (tc.trailColor !== undefined) {
        params.TRACKLINECOLORS = colorList(normalizeAARRGGBB(tc.trailColor, "FF00FF00"));
      }
      if (tc.headSize !== undefined) {
        params.TRACKHEADSIZES = expand(String(tc.headSize));
      }
      // trailSize takes precedence over lineWidth when both set; emit as TRACKLINEWIDTHS.
      const lineWidthVal = tc.trailSize ?? tc.lineWidth;
      if (lineWidthVal !== undefined) {
        params.TRACKLINEWIDTHS = expand(String(lineWidthVal));
      }
      if (tc.headShape !== undefined) {
        // TRACKFIX-V19-05: headShape → TRACKHEADSHAPES (fixes OQ-9 misnaming where headShape
        // was incorrectly emitting as TRACKMARKERSHAPES). Operator-confirmed against Kinetica
        // WMS docs 2026-06-07: TRACKHEADSHAPES controls the head marker shape.
        params.TRACKHEADSHAPES = expand(tc.headShape);
      }
      // TRACKFIX-V19-05: New marker params — distinct from head params
      if (tc.markerColor !== undefined) {
        params.TRACKMARKERCOLORS = colorList(normalizeAARRGGBB(tc.markerColor, "FF0000FF"));
      }
      if (tc.markerShape !== undefined) {
        params.TRACKMARKERSHAPES = expand(tc.markerShape);
      }
      if (tc.markerSize !== undefined) {
        params.TRACKMARKERSIZES = expand(String(tc.markerSize));
      }
    }
  }

  return params;
}

// Re-export SpatialMode for downstream convenience
// Pattern: MapChartRenderer.tsx can import { buildWmsParams, type SpatialMode } from this module
// without needing a separate import from columnTypes (avoids double-import in Wave 3 renderer).
export type { SpatialMode };
