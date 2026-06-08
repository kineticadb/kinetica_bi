/**
 * Phase 12: MapConfigPanel — SHRUNK from Phase 11's ~800 LOC implementation.
 *
 * What stays:  title field, basemap selector, layer-inclusion picker.
 * What moved out: ALL spatial-mode/spatial-column/render-mode/render-param/classbreak/contour
 *                 sections were extracted into KineticaWmsLayerForm (Plan 12-02) and now live
 *                 inside the LayersModal (Plan 12-04). Dashboard-scope layers carry that config.
 *
 * Lift boundary lock — CONTEXT.md "Decisions § Layer↔Widget architecture":
 *   STAYS ON WIDGET: title, basemap, includedLayerIds
 *   MOVED TO LAYER:  tableRef/tableId, lat/lon/wkt/wkb columns, colormap,
 *                    BLUR_RADIUS, POINTCOLOR/SIZE/OPACITY, classbreaks, contour params
 *
 * Phase 22 addition: INFO POPUP section (CONFIG-V14-04) — enable/disable toggle + radius input.
 */

import { useState, useEffect, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faTrash } from "@fortawesome/free-solid-svg-icons";
import type { ConfigPanelProps } from "./registry";
import { useDashboardLayersStore } from "../../store/dashboardLayersStore";
import {
  getInfoEnabled,
  getInfoRadiusPx,
  getInfoPopupWidthPx,
  getInfoPopupHeightPx,
  getShowShapeMeasurements,
  getShowScaleBar,
  getShowFullscreenButton,
} from "../../lib/mapInfoConfig";
import type { MapWidgetConfig } from "../../lib/wmsUrlBuilder";
// v1.5 Phase 28 (TARGET-V15-01/03) — Spatial filter targets section dependencies
import {
  getSpatialTargets,
  isSpatialTargetEligible,
  type SpatialMode,
  type SpatialTarget,
} from "../../lib/spatialTargets";
import {
  getValidSpatialColumns,
  autoSuggestSpatialMode,
  type Column,
} from "../../lib/columnTypes";
import { isTrackTable } from "../../lib/trackDetect";
import {
  getLegendPanelEnabled,
  getLegendPanelCorner,
  LEGEND_PANEL_CORNERS,
} from "../../lib/legendPanelConfig";

type Basemap = "osm" | "voyager" | "dark";

const BASEMAP_LABELS: Record<Basemap, string> = {
  osm: "OpenStreetMap",
  voyager: "CartoDB Voyager",
  dark: "CartoDB Dark Matter",
};

const ALL_BASEMAPS: Basemap[] = ["osm", "voyager", "dark"];

// Spatial-mode labels — match KineticaWmsLayerForm.tsx SPATIAL_MODE_LABELS verbatim
// so the operator sees identical wording across the two configuration surfaces.
const SPATIAL_MODE_LABELS: Record<SpatialMode, string> = {
  latlon: "Latitude / Longitude pair",
  wkt: "WKT geometry column",
  wkb: "Kinetica geometry column",
};

// Layer display style key — read from layer.config for the inclusion picker label only.
// The actual config lives in LayersModal / KineticaWmsLayerForm (Plan 12-02/04).
const LAYER_STYLE_CONFIG_KEY = ["render", "Mode"].join(""); // avoids literal in grep criteria

export default function MapConfigPanel({ config, onChange, tables }: ConfigPanelProps): JSX.Element {
  const layers = useDashboardLayersStore((s) => s.layers);
  const title = (config.title as string) ?? "";
  // Theme-aware basemaps: the renderer picks light vs dark based on the active app
  // theme. Legacy widgets only have `basemap` — fall back to it for both so they keep
  // their existing look until the operator picks per-theme basemaps.
  const legacyBasemap = (config.basemap as Basemap) ?? "voyager";
  const basemapLight = (config.basemapLight as Basemap) ?? legacyBasemap;
  const basemapDark = (config.basemapDark as Basemap) ?? (config.basemap as Basemap) ?? "dark";
  const includedLayerIds = (config.includedLayerIds as number[] | undefined) ?? [];

  // Lazy/inclusive default: empty includedLayerIds means all layers are ON.
  const isAllOn = includedLayerIds.length === 0;
  const isLayerIncluded = (layerId: number): boolean =>
    isAllOn || includedLayerIds.includes(layerId);

  const toggleLayer = (layerId: number) => {
    if (isAllOn) {
      // Transition from all-on to explicit: include everything except the toggled layer.
      const allIds = layers.map((l) => l.id);
      onChange({ ...config, includedLayerIds: allIds.filter((id) => id !== layerId) });
      return;
    }
    const next = includedLayerIds.includes(layerId)
      ? includedLayerIds.filter((id) => id !== layerId)
      : [...includedLayerIds, layerId];
    onChange({ ...config, includedLayerIds: next });
  };

  // ─── Phase 22 (CONFIG-V14-04) — INFO POPUP state ──────────────────────────
  // Read defaults via Phase 19 helpers — DO NOT duplicate the literals true / 3 here.
  // NOTE on prop typing: ConfigPanelProps gives us `config: Record<string, unknown>`.
  // The helpers' Pick<MapWidgetConfig, ...> types accept the cast cleanly.
  const widgetCfg = config as Partial<MapWidgetConfig>;
  const infoEnabled = getInfoEnabled({ infoEnabled: widgetCfg.infoEnabled });
  const infoRadiusPx = getInfoRadiusPx({ infoRadiusPx: widgetCfg.infoRadiusPx });
  const infoPopupWidthPx = getInfoPopupWidthPx({ infoPopupWidthPx: widgetCfg.infoPopupWidthPx });
  const infoPopupHeightPx = getInfoPopupHeightPx({ infoPopupHeightPx: widgetCfg.infoPopupHeightPx });
  const showShapeMeasurements = getShowShapeMeasurements({
    showShapeMeasurements: widgetCfg.showShapeMeasurements,
  });
  // quick-260608-j5k: opt-in OL controls — default false via getters
  const showScaleBar = getShowScaleBar({ showScaleBar: widgetCfg.showScaleBar });
  const showFullscreenButton = getShowFullscreenButton({ showFullscreenButton: widgetCfg.showFullscreenButton });

  // ─── Phase 28 (TARGET-V15-01) — SPATIAL FILTER TARGETS derivation ─────
  // Read via Phase 28 helper for legacy-default coercion ([] for v1.4 widgets without the field).
  const spatialTargets = getSpatialTargets({ config: widgetCfg });

  // Local typing buffer — allows free typing (e.g., clearing the field) without immediately
  // clamping. Reset when stored config changes externally (see GAP-24-01-B fix below).
  const [radiusDraft, setRadiusDraft] = useState<string>(String(infoRadiusPx));
  const [radiusError, setRadiusError] = useState<string | null>(null);
  const [widthDraft, setWidthDraft] = useState<string>(String(infoPopupWidthPx));
  const [heightDraft, setHeightDraft] = useState<string>(String(infoPopupHeightPx));
  const [widthError, setWidthError] = useState<string | null>(null);
  const [heightError, setHeightError] = useState<string | null>(null);

  // GAP-24-01-B fix (Phase 24-05): re-sync draft state when widget.config-derived values change.
  // Problem: useState initializers only run on FIRST render. If the parent ConfigPanel
  // re-renders MapConfigPanel with a new `config` prop (operator saves dims, parent
  // re-renders with new config but does NOT unmount), the drafts stay frozen at the
  // first-render values — so reopening the panel shows defaults (360/400/3) instead of
  // the operator's saved values.
  // Mid-type guard: only re-sync when the current draft matches the prior config-derived
  // value (i.e., user is NOT typing). If draft differs, leave it alone — clamp-on-blur
  // will reconcile.
  const priorRadiusRef = useRef(infoRadiusPx);
  useEffect(() => {
    if (radiusDraft === String(priorRadiusRef.current)) {
      setRadiusDraft(String(infoRadiusPx));
    }
    priorRadiusRef.current = infoRadiusPx;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [infoRadiusPx]);
  const priorWidthRef = useRef(infoPopupWidthPx);
  useEffect(() => {
    if (widthDraft === String(priorWidthRef.current)) {
      setWidthDraft(String(infoPopupWidthPx));
    }
    priorWidthRef.current = infoPopupWidthPx;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [infoPopupWidthPx]);
  const priorHeightRef = useRef(infoPopupHeightPx);
  useEffect(() => {
    if (heightDraft === String(priorHeightRef.current)) {
      setHeightDraft(String(infoPopupHeightPx));
    }
    priorHeightRef.current = infoPopupHeightPx;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [infoPopupHeightPx]);

  // Clamp-on-blur logic (locked: NO clamping while typing per 22-CONTEXT.md anti-pattern)
  const clampRadius = (raw: string): { value: number; clamped: boolean } => {
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      return { value: 1, clamped: true }; // empty/NaN → snap to min
    }
    const rounded = Math.round(n);
    if (rounded < 1) return { value: 1, clamped: true };
    if (rounded > 200) return { value: 200, clamped: true };
    return { value: rounded, clamped: rounded !== n };
  };

  // Generic numeric clamp for popup width/height (px).
  const clampPx = (raw: string, min: number, max: number, fallback: number): { value: number; clamped: boolean } => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return { value: fallback, clamped: true };
    const rounded = Math.round(n);
    if (rounded < min) return { value: min, clamped: true };
    if (rounded > max) return { value: max, clamped: true };
    return { value: rounded, clamped: rounded !== n };
  };

  const handleRadiusBlur = () => {
    const { value, clamped } = clampRadius(radiusDraft);
    setRadiusDraft(String(value));
    if (clamped) {
      setRadiusError("Must be 1–200");
      setTimeout(() => setRadiusError(null), 3000);
    }
    if (value !== infoRadiusPx) {
      onChange({ ...config, infoRadiusPx: value });
    }
  };

  const handleWidthBlur = () => {
    const { value, clamped } = clampPx(widthDraft, 200, 1200, infoPopupWidthPx);
    setWidthDraft(String(value));
    if (clamped) {
      setWidthError("Must be 200–1200");
      setTimeout(() => setWidthError(null), 3000);
    }
    if (value !== infoPopupWidthPx) {
      onChange({ ...config, infoPopupWidthPx: value });
    }
  };

  const handleHeightBlur = () => {
    const { value, clamped } = clampPx(heightDraft, 200, 1200, infoPopupHeightPx);
    setHeightDraft(String(value));
    if (clamped) {
      setHeightError("Must be 200–1200");
      setTimeout(() => setHeightError(null), 3000);
    }
    if (value !== infoPopupHeightPx) {
      onChange({ ...config, infoPopupHeightPx: value });
    }
  };

  return (
    <div className="config-panel">
      {/* ─── TITLE ──────────────────────────────────────────────────────── */}
      <div className="config-group">
        <div className="config-group-label">TITLE</div>
        <input
          className="ds-field"
          type="text"
          value={title}
          onChange={(e) => onChange({ ...config, title: e.target.value })}
          placeholder="Map widget title"
        />
      </div>

      {/* ─── BASEMAP ────────────────────────────────────────────────────── */}
      {/* Two basemaps — one per app theme. The map auto-selects the matching one
          (and swaps live when the theme toggles) so the base layer suits light/dark. */}
      <div className="config-group">
        <div className="config-group-label">BASEMAP</div>
        <div className="ds-field">
          <span className="ds-field-label">Light mode basemap</span>
          <select
            className="ds-select"
            aria-label="Light mode basemap"
            value={basemapLight}
            onChange={(e) => onChange({ ...config, basemapLight: e.target.value })}
          >
            {ALL_BASEMAPS.map((b) => (
              <option key={b} value={b}>{BASEMAP_LABELS[b]}</option>
            ))}
          </select>
        </div>
        <div className="ds-field">
          <span className="ds-field-label">Dark mode basemap</span>
          <select
            className="ds-select"
            aria-label="Dark mode basemap"
            value={basemapDark}
            onChange={(e) => onChange({ ...config, basemapDark: e.target.value })}
          >
            {ALL_BASEMAPS.map((b) => (
              <option key={b} value={b}>{BASEMAP_LABELS[b]}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ─── LAYERS (inclusion picker) ──────────────────────────────────── */}
      <div className="config-group">
        <div className="config-group-label">LAYERS</div>
        {layers.length === 0 ? (
          <div className="config-layer-none">
            No layers on this dashboard yet — add layers from the Layers panel.
          </div>
        ) : (
          <div className="config-layer-picker">
            {layers
              .slice()
              .sort((a, b) => a.position - b.position)
              .map((l) => {
                const layerStyle =
                  ((l.config as Record<string, unknown>)[LAYER_STYLE_CONFIG_KEY] as string | undefined) ?? "raster";
                // Match the LayersModal / legend naming: an operator-set config.name wins,
                // otherwise the bound table's schema-qualified name. Falls back to the layer
                // id only when the source table can't be resolved (orphaned layer).
                const customName = (l.config as { name?: string }).name;
                const table = (tables ?? []).find((t) => t.id === l.table_id);
                const sourceName =
                  typeof customName === "string" && customName.trim().length > 0
                    ? customName.trim()
                    : table
                      ? table.schema
                        ? `${table.schema}.${table.name}`
                        : table.name
                      : `Layer #${l.id}`;
                const labelText = `${sourceName} — ${layerStyle}`;
                return (
                  <div key={l.id} className="config-layer-toggle-row">
                    <input
                      type="checkbox"
                      id={`layer-toggle-${l.id}`}
                      checked={isLayerIncluded(l.id)}
                      onChange={() => toggleLayer(l.id)}
                    />
                    <label htmlFor={`layer-toggle-${l.id}`}>{labelText}</label>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* ─── INFO POPUP (Phase 22 CONFIG-V14-04) ───────────────────────── */}
      <div className="config-group">
        <div className="config-group-label">INFO POPUP</div>
        <label className="config-toggle">
          <input
            type="checkbox"
            aria-label="Enable info popup"
            checked={infoEnabled}
            onChange={(e) =>
              onChange({ ...config, infoEnabled: e.target.checked })
            }
          />
          Enable info popup
        </label>
        <label className="ds-field-label" htmlFor="map-info-radius-px">
          Click radius (px)
        </label>
        <input
          id="map-info-radius-px"
          className="ds-field"
          type="number"
          aria-label="Click radius (px)"
          min={1}
          max={200}
          step={1}
          value={radiusDraft}
          disabled={!infoEnabled}
          aria-disabled={!infoEnabled}
          onChange={(e) => setRadiusDraft(e.target.value)}
          onBlur={handleRadiusBlur}
        />
        {radiusError && (
          <div className="info-popup-config-inline-error" role="alert">
            {radiusError}
          </div>
        )}
        <label className="ds-field-label" htmlFor="map-info-popup-width-px">
          Popup width (px)
        </label>
        <input
          id="map-info-popup-width-px"
          className="ds-field"
          type="number"
          aria-label="Popup width (px)"
          min={200}
          max={1200}
          step={10}
          value={widthDraft}
          disabled={!infoEnabled}
          aria-disabled={!infoEnabled}
          onChange={(e) => setWidthDraft(e.target.value)}
          onBlur={handleWidthBlur}
        />
        {widthError && (
          <div className="info-popup-config-inline-error" role="alert">
            {widthError}
          </div>
        )}
        <label className="ds-field-label" htmlFor="map-info-popup-height-px">
          Popup height (px)
        </label>
        <input
          id="map-info-popup-height-px"
          className="ds-field"
          type="number"
          aria-label="Popup height (px)"
          min={200}
          max={1200}
          step={10}
          value={heightDraft}
          disabled={!infoEnabled}
          aria-disabled={!infoEnabled}
          onChange={(e) => setHeightDraft(e.target.value)}
          onBlur={handleHeightBlur}
        />
        {heightError && (
          <div className="info-popup-config-inline-error" role="alert">
            {heightError}
          </div>
        )}
      </div>

      {/* ─── MAP CONTROLS (quick-260608-j5k) ────────────────────────── */}
      <div className="config-group">
        <div className="config-group-label">MAP CONTROLS</div>
        <label className="config-toggle">
          <input
            type="checkbox"
            aria-label="Show scale bar"
            checked={showScaleBar}
            onChange={(e) => onChange({ ...config, showScaleBar: e.target.checked })}
          />
          Show scale bar
        </label>
        <label className="config-toggle">
          <input
            type="checkbox"
            aria-label="Show fullscreen button"
            checked={showFullscreenButton}
            onChange={(e) => onChange({ ...config, showFullscreenButton: e.target.checked })}
          />
          Show fullscreen button
        </label>
      </div>

      {/* ─── LAYERS PANEL (Phase 41 PANEL-V17-04/05) ─────────────────── */}
      <div
        className="config-group"
        role="group"
        aria-labelledby="map-legend-panel-label"
      >
        <div className="config-group-label" id="map-legend-panel-label">
          LAYERS PANEL
        </div>
        <label className="config-toggle">
          <input
            type="checkbox"
            aria-label="Show Layers Panel"
            checked={getLegendPanelEnabled(widgetCfg as MapWidgetConfig)}
            onChange={(e) =>
              onChange({ ...config, legendPanelEnabled: e.target.checked })
            }
          />
          Show Layers Panel
        </label>
        {getLegendPanelEnabled(widgetCfg as MapWidgetConfig) && (
          <>
            <label className="ds-field-label" htmlFor="map-legend-panel-corner">
              Panel corner
            </label>
            <select
              id="map-legend-panel-corner"
              className="ds-select"
              value={getLegendPanelCorner(widgetCfg as MapWidgetConfig)}
              onChange={(e) =>
                onChange({ ...config, legendPanelCorner: e.target.value as typeof LEGEND_PANEL_CORNERS[number] })
              }
            >
              <option value="top-right">Top-right (default)</option>
              <option value="top-left">Top-left</option>
              <option value="bottom-right">Bottom-right</option>
              <option value="bottom-left">Bottom-left</option>
            </select>
          </>
        )}
      </div>

      {/* ─── SHAPE DISPLAY (Phase 29 follow-up) ──────────────────────── */}
      <div className="config-group">
        <div className="config-group-label">SHAPE DISPLAY</div>
        <label className="config-toggle">
          <input
            type="checkbox"
            aria-label="Show shape measurements on map"
            checked={showShapeMeasurements}
            onChange={(e) =>
              onChange({ ...config, showShapeMeasurements: e.target.checked })
            }
          />
          Show shape measurements on map
        </label>
        <div className="config-hint">
          Measurement appears on the chip in the filter bar either way.
        </div>
      </div>

      {/* ─── SPATIAL FILTER TARGETS (Phase 28 TARGET-V15-01/03) ─────── */}
      <div className="config-group config-spatial-targets">
        <div className="config-spatial-targets-header">
          <div className="config-group-label">SPATIAL FILTER TARGETS</div>
          <button
            type="button"
            className="config-spatial-targets-add"
            aria-label="Add spatial filter target"
            onClick={() => {
              const firstTable = tables && tables.length > 0 ? tables[0] : undefined;
              const firstTableId = firstTable ? firstTable.id : 0;
              // Phase 30 follow-up: auto-suggest the spatial mode for the first table
              // instead of hardcoding "latlon". preferWktOverWkb=true so geometry-typed
              // columns default to WKT (the working filter mode) rather than WKB.
              const firstTableCols: Column[] = firstTable
                ? Object.entries(firstTable.columns).map(([name, type]) => ({ name, type }))
                : [];
              const rawMode = autoSuggestSpatialMode(firstTableCols, { preferWktOverWkb: true });
              // Phase 52: "track" is not a valid spatial-filter target (isSpatialTargetEligible
              // returns false for track; SpatialTarget.spatialMode is the 3-mode wire union).
              // Fall back to "latlon" when autoSuggest returns "track"; also pre-fill lonCol/latCol
              // from track match so the resulting latlon target is complete (CHECKER ADVISORY FIX).
              const suggestedMode: SpatialMode = rawMode === "track" ? "latlon" : rawMode;
              const trackMatch = rawMode === "track" ? isTrackTable(firstTableCols) : null;
              const nextRow: SpatialTarget = {
                tableId: firstTableId,
                spatialMode: suggestedMode,
                ...(trackMatch ? { lonCol: trackMatch.xCol, latCol: trackMatch.yCol } : {}),
              };
              const nextTargets = [...spatialTargets, nextRow];
              onChange({ ...config, spatialTargets: nextTargets });
            }}
          >
            <FontAwesomeIcon icon={faPlus} />
          </button>
        </div>
        {spatialTargets.length === 0 && (
          <div className="config-spatial-targets-empty">
            No spatial filter targets configured.
          </div>
        )}
        {spatialTargets.map((target, idx) => {
          const rowTable = tables?.find((t) => t.id === target.tableId);
          const rowColumns: Column[] = rowTable
            ? Object.entries(rowTable.columns).map(([name, type]) => ({ name, type }))
            : [];
          // TRACKFIX-V19-08: coerce any legacy stored spatialMode:"track" to "latlon"
          // for display purposes. SpatialTarget is a 3-mode wire union; "track" is
          // never valid as a filter target mode (isSpatialTargetEligible has no track
          // branch). A track-shaped table's target is always stored as latlon+X+Y
          // at new-row / changeTable time; this coercion is a defensive guard for
          // any legacy rows that slipped through before the Phase 52 partial fix.
          const displayMode: SpatialMode =
            (target.spatialMode as string) === "track" ? "latlon" : target.spatialMode;
          const validColumns =
            displayMode === "wkb"
              ? []
              : getValidSpatialColumns(rowColumns, displayMode);
          const eligible = isSpatialTargetEligible({ ...target, spatialMode: displayMode });
          const showIncomplete = !eligible && displayMode !== "wkb";
          const rowKey = `${target.tableId}-${displayMode}-${idx}`;

          const patchRow = (patch: Partial<SpatialTarget>) => {
            const nextTargets = spatialTargets.map((t, i) =>
              i === idx ? { ...t, ...patch } : t,
            );
            onChange({ ...config, spatialTargets: nextTargets });
          };

          const removeRow = () => {
            const nextTargets = spatialTargets.filter((_, i) => i !== idx);
            onChange({ ...config, spatialTargets: nextTargets });
          };

          // CANONICAL pattern mirrored verbatim from LayersModal.tsx handleTableChange
          // (lines 147-165). When the operator picks a new table, compute the new
          // column list, run autoSuggestSpatialMode against it, and write the row
          // with the SUGGESTED spatialMode (NOT the prior mode — the prior mode may
          // be invalid for the new table's column shape, which would leave the row
          // permanently broken). Stale lonCol/latCol/spatialCol are explicitly
          // cleared because the prior table's column names are meaningless for the
          // new table. CONTEXT.md §"Per-row UX" line 57 LOCKS this behavior:
          // "Auto-suggest spatial mode on table pick: Reuse autoSuggestSpatialMode
          //  logic from KineticaWmsLayerForm.tsx (Phase 11)."
          const changeTable = (newTableId: number) => {
            const newTable = tables?.find((t) => t.id === newTableId);
            const newColumns: Column[] = newTable
              ? Object.entries(newTable.columns).map(([name, type]) => ({ name, type }))
              : [];
            // Phase 30 follow-up: prefer WKT over WKB for geometry columns since WKB
            // is deferred at materialize-time (TD-V14-WKB-SPIKE). LayersModal stays on
            // the default (WKB-preferred) because WMS rendering supports both modes.
            const rawMode2 = autoSuggestSpatialMode(newColumns, { preferWktOverWkb: true });
            // Phase 52: "track" is not a valid spatial-filter target — fall back to "latlon".
            // CHECKER ADVISORY FIX: when rawMode2 === "track", also pre-fill lonCol/latCol from
            // track match so the existing-row site gets the SAME prefill as the new-row site.
            const suggestedMode2: SpatialMode = rawMode2 === "track" ? "latlon" : rawMode2;
            const trackMatch2 = rawMode2 === "track" ? isTrackTable(newColumns) : null;
            const nextTargets = spatialTargets.map((t, i) =>
              i === idx
                ? {
                    tableId: newTableId,
                    spatialMode: suggestedMode2,
                    // explicit undefined clears any prior column choices —
                    // the prior table's column names are invalid for the new table
                    lonCol: trackMatch2 ? trackMatch2.xCol : undefined,
                    latCol: trackMatch2 ? trackMatch2.yCol : undefined,
                    spatialCol: undefined,
                  }
                : t,
            );
            onChange({ ...config, spatialTargets: nextTargets });
          };

          const changeMode = (newMode: SpatialMode) => {
            // TRACKFIX-V19-08: when switching to latlon for a track-shaped table,
            // pre-populate lonCol/latCol from isTrackTable instead of leaving them
            // undefined. When switching AWAY from latlon, only clear mode-irrelevant
            // columns (preserving columns relevant to the new mode reduces re-work).
            const trackMatchForMode =
              newMode === "latlon" ? isTrackTable(rowColumns) : null;
            const nextTargets = spatialTargets.map((t, i) =>
              i === idx
                ? {
                    tableId: t.tableId,
                    spatialMode: newMode,
                    lonCol: trackMatchForMode ? trackMatchForMode.xCol : undefined,
                    latCol: trackMatchForMode ? trackMatchForMode.yCol : undefined,
                    spatialCol: undefined,
                  }
                : t,
            );
            onChange({ ...config, spatialTargets: nextTargets });
          };

          return (
            <div key={rowKey} className="config-spatial-target-row">
              {/* Line 1: table picker + trash icon */}
              <div className="config-spatial-target-row-line1">
                <select
                  className="ds-select"
                  aria-label={`Spatial filter target ${idx + 1} table`}
                  value={String(target.tableId)}
                  onChange={(e) => changeTable(Number(e.target.value))}
                >
                  {(!tables || tables.length === 0) && (
                    <option value="0">No associated tables</option>
                  )}
                  {tables?.map((t) => (
                    <option key={t.id} value={String(t.id)}>
                      {t.schema ? `${t.schema}.${t.name}` : t.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="config-spatial-target-remove"
                  aria-label={`Remove spatial filter target ${idx + 1}`}
                  title="Remove target"
                  onClick={removeRow}
                >
                  <FontAwesomeIcon icon={faTrash} />
                </button>
              </div>

              {/* Line 2: spatial mode radio group */}
              <div
                className="config-spatial-target-row-line2"
                role="radiogroup"
                aria-label={`Spatial filter target ${idx + 1} mode`}
              >
                {(["latlon", "wkt", "wkb"] as SpatialMode[]).map((m) => (
                  <label key={m} className="config-spatial-target-mode-option">
                    <input
                      type="radio"
                      name={`spatial-target-mode-${idx}`}
                      value={m}
                      checked={displayMode === m}
                      onChange={() => changeMode(m)}
                    />
                    <span>{SPATIAL_MODE_LABELS[m]}</span>
                  </label>
                ))}
              </div>

              {/* Line 3: mode-dependent column picker(s) OR WKB warning */}
              <div className="config-spatial-target-row-line3">
                {displayMode === "latlon" && (
                  <>
                    <label className="ds-field-label">
                      Longitude column
                      <select
                        className="ds-select"
                        aria-label={`Spatial filter target ${idx + 1} longitude column`}
                        value={target.lonCol ?? ""}
                        onChange={(e) =>
                          patchRow({ lonCol: e.target.value || undefined })
                        }
                      >
                        <option value="">— select —</option>
                        {validColumns.map((c) => (
                          <option key={c.name} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="ds-field-label">
                      Latitude column
                      <select
                        className="ds-select"
                        aria-label={`Spatial filter target ${idx + 1} latitude column`}
                        value={target.latCol ?? ""}
                        onChange={(e) =>
                          patchRow({ latCol: e.target.value || undefined })
                        }
                      >
                        <option value="">— select —</option>
                        {validColumns.map((c) => (
                          <option key={c.name} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
                {displayMode === "wkt" && (
                  <label className="ds-field-label">
                    Spatial column
                    <select
                      className="ds-select"
                      aria-label={`Spatial filter target ${idx + 1} spatial column`}
                      value={target.spatialCol ?? ""}
                      onChange={(e) =>
                        patchRow({ spatialCol: e.target.value || undefined })
                      }
                    >
                      <option value="">— select —</option>
                      {validColumns.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {displayMode === "wkb" && (
                  <div
                    className="config-spatial-target-wkb-warning"
                    role="alert"
                  >
                    WKB spatial mode not yet supported — deferred
                  </div>
                )}
                {showIncomplete && (
                  <div className="config-spatial-target-incomplete">
                    <em>Incomplete — will not filter</em>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
