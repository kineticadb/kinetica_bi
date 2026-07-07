/**
 * v1.4 Phase 19 (CONFIG-V14-02): backward-compatible default getters for the map info
 * popup widget-level config fields. Map widgets stored BEFORE Phase 19 carry no
 * `infoEnabled` and no `infoRadiusPx` in their `widget.config` JSON; these helpers
 * default the missing values to the locked v1.4 defaults so legacy widgets render
 * the popup at the standard click radius without a migration.
 *
 * LOCKED DEFAULTS (from REQUIREMENTS.md CONFIG-V14-02 + ROADMAP Phase 19 Notes):
 *   infoEnabled  → true   (per-widget click popup is opt-out, not opt-in)
 *   infoRadiusPx → 3      (click radius in pixels — tightened from the
 *                          original v1.4 default of 20 to reduce overlap noise)
 *
 * Phase 19 ships these helpers DORMANT. Phase 21 (map-click-popup) is the first
 * caller — it imports getInfoEnabled to decide whether to register the OL click
 * listener at all (kill switch lock per STATE.md v1.4 architecture decisions:
 * "Per-widget infoEnabled: false disables the OL click listener entirely (no listener
 * registration)"). Phase 22 (config-ui) writes explicit values via MapConfigPanel.
 *
 * NO CLAMPING / VALIDATION HERE — Phase 22 UI is responsible for min/max enforcement
 * (REQUIREMENTS.md CONFIG-V14-04: "numeric input for infoRadiusPx (pixel radius,
 * integer, min 1, max 200, default 3)"). These helpers are pure reads; they pass
 * through whatever value is set, including 0 / negative / non-integer / NaN. Phase 22
 * is where the user-facing bound is enforced.
 */

import type { MapWidgetConfig } from "./wmsUrlBuilder";

/** Locked default for `infoEnabled` per CONFIG-V14-02. */
export const DEFAULT_INFO_ENABLED = true;

/** Locked default for `infoRadiusPx` (click radius in pixels) per CONFIG-V14-02. */
export const DEFAULT_INFO_RADIUS_PX = 3;

/** Default popup body width in pixels — matches the pre-config-UI CSS baseline (360px). */
export const DEFAULT_INFO_POPUP_WIDTH_PX = 360;

/** Default popup body height in pixels — replaces the prior max-height: 60vh CSS rule.
 *  Operator-tuned post-VERIFY from 400 to 250 (denser default reveals more of the
 *  underlying map at first click; operator can resize via the widget config). */
export const DEFAULT_INFO_POPUP_HEIGHT_PX = 250;

/** Default for `showShapeMeasurements` — backwards-compatible: legacy widgets show the pill. */
export const DEFAULT_SHOW_SHAPE_MEASUREMENTS = true;

/**
 * Read the per-widget info-popup kill switch. Returns DEFAULT_INFO_ENABLED (true) when
 * the config carries no `infoEnabled` field — legacy / pre-Phase-19 widgets opt in
 * automatically.
 *
 * Pass an explicit boolean to override the default. Pre-Phase-19 stored widget configs
 * (which lack the field entirely) read as `true` here; widgets created in Phase 22 with
 * an explicit `infoEnabled: false` read as `false` (kill switch active).
 */
export function getInfoEnabled(config: Pick<MapWidgetConfig, "infoEnabled">): boolean {
  return config.infoEnabled ?? DEFAULT_INFO_ENABLED;
}

/**
 * Read the per-widget info-popup click radius in pixels. Returns DEFAULT_INFO_RADIUS_PX
 * (3) when the config carries no `infoRadiusPx` field.
 *
 * NO clamping — this getter passes through whatever value is set (including 0, negative,
 * NaN). Phase 22's MapConfigPanel UI enforces the min=1, max=200 bound at edit time.
 */
export function getInfoRadiusPx(config: Pick<MapWidgetConfig, "infoRadiusPx">): number {
  return config.infoRadiusPx ?? DEFAULT_INFO_RADIUS_PX;
}

/**
 * Read the per-widget info-popup body width in pixels. Returns DEFAULT_INFO_POPUP_WIDTH_PX
 * (360) when the config carries no `infoPopupWidthPx` field. Applies ONLY to the popup;
 * Info Card widgets size themselves via the dashboard widget grid.
 */
export function getInfoPopupWidthPx(config: Pick<MapWidgetConfig, "infoPopupWidthPx">): number {
  return config.infoPopupWidthPx ?? DEFAULT_INFO_POPUP_WIDTH_PX;
}

/**
 * Read the per-widget info-popup body height in pixels. Returns DEFAULT_INFO_POPUP_HEIGHT_PX
 * (400) when the config carries no `infoPopupHeightPx` field. Applies ONLY to the popup.
 */
export function getInfoPopupHeightPx(config: Pick<MapWidgetConfig, "infoPopupHeightPx">): number {
  return config.infoPopupHeightPx ?? DEFAULT_INFO_POPUP_HEIGHT_PX;
}

/**
 * Read the per-widget toggle for persistent shape-measurement pills (the on-map
 * "5km × 3km" / "12.4 km²" labels anchored to drawn shapes). Returns
 * DEFAULT_SHOW_SHAPE_MEASUREMENTS (true) when the config carries no
 * `showShapeMeasurements` field — legacy widgets keep their existing look.
 * Affects ONLY the map overlay; the FilterBar chip text is unaffected.
 */
export function getShowShapeMeasurements(
  config: Pick<MapWidgetConfig, "showShapeMeasurements">,
): boolean {
  return config.showShapeMeasurements ?? DEFAULT_SHOW_SHAPE_MEASUREMENTS;
}

/** Default for `showScaleBar` — opt-in (false): legacy widgets show no scale bar. */
export const DEFAULT_SHOW_SCALE_BAR = false;
/** Default for `showFullscreenButton` — opt-in (false): legacy widgets show no fullscreen button. */
export const DEFAULT_SHOW_FULLSCREEN_BUTTON = false;

/**
 * Read the per-widget opt-in scale bar toggle. Returns DEFAULT_SHOW_SCALE_BAR (false)
 * when the config carries no `showScaleBar` field — legacy widgets are byte-identical
 * to today (no ScaleLine control constructed).
 *
 * quick-260608-j5k: consumed only by MapChartRenderer's control construction at mount time.
 */
export function getShowScaleBar(config: Pick<MapWidgetConfig, "showScaleBar">): boolean {
  return config.showScaleBar ?? DEFAULT_SHOW_SCALE_BAR;
}

/**
 * Read the per-widget opt-in fullscreen button toggle. Returns DEFAULT_SHOW_FULLSCREEN_BUTTON
 * (false) when the config carries no `showFullscreenButton` field — legacy widgets are
 * byte-identical to today (no FullScreen control constructed).
 *
 * quick-260608-j5k: consumed only by MapChartRenderer's control construction at mount time.
 */
export function getShowFullscreenButton(
  config: Pick<MapWidgetConfig, "showFullscreenButton">,
): boolean {
  return config.showFullscreenButton ?? DEFAULT_SHOW_FULLSCREEN_BUTTON;
}

/** Default for `showLoadingIndicator` — DEFAULT TRUE: legacy widgets (field absent) get the indicator ON. */
export const DEFAULT_SHOW_LOADING_INDICATOR = true;

/**
 * Read the per-widget in-map WMS loading indicator toggle. Returns DEFAULT_SHOW_LOADING_INDICATOR
 * (true) when the config carries no `showLoadingIndicator` field — legacy widgets automatically
 * get the indicator ON (opt-out, not opt-in; mirrors getInfoEnabled's default-true pattern).
 *
 * quick-260608-rbq: consumed only by MapChartRenderer's badge render (top-center "Loading…"
 * overlay driven by imageloadstart/imageloadend source events).
 */
export function getShowLoadingIndicator(
  config: Pick<MapWidgetConfig, "showLoadingIndicator">,
): boolean {
  return config.showLoadingIndicator ?? DEFAULT_SHOW_LOADING_INDICATOR;
}

/** Default for `syncViewport` — opt-in (false): legacy maps are byte-identical to today. */
export const DEFAULT_SYNC_VIEWPORT = false;

/**
 * Read the per-widget viewport-sync opt-in toggle. Returns DEFAULT_SYNC_VIEWPORT (false)
 * when the config carries no `syncViewport` field (existing maps). Phase 104 MAPSYNC-V119-01/06.
 */
export function getSyncViewportEnabled(config: Pick<MapWidgetConfig, "syncViewport">): boolean {
  return config.syncViewport ?? DEFAULT_SYNC_VIEWPORT;
}
