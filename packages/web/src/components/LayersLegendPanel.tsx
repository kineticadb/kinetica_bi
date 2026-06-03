/**
 * v1.7 Phase 41 (PANEL-V17-01): Pure presentational LayersLegendPanel component.
 *
 * PANEL-V17-01 lock: This component has NO internal store subscriptions.
 * It is driven entirely by props. The caller (MapChartRenderer in Plan 41-02) reads
 * the store via the legendKey primitive selector and passes the derived
 * ResolvedLegendLayer[] array as a prop.
 *
 * Props contract:
 *   layers         — array of { layer: DashboardLayerDto; visible: boolean }
 *   corner         — one of LEGEND_PANEL_CORNERS (drives corner modifier class)
 *   collapsed      — boolean; collapse state is session-only, owned by the consumer
 *   onToggleCollapse — callback fired on header click (no internal useState)
 *
 * Per-render-mode rendering:
 *   raster / heatmap / contour  → header row + render-mode chip only; no break rows
 *   classbreak (configured)     → header row + N break-rows (swatch + label/value)
 *   classbreak (empty cb_config) → header row + italic hint "No breaks configured"
 *
 * <other> value is rendered verbatim (no titlecasing) per Phase 39 spec lock.
 * Label fallback: if break.label is empty/undefined, shows String(break.value).
 */

import type { LegendPanelCorner } from "../lib/legendPanelConfig";
import { coalesceCbConfig, isCbConfigConfigured, type CbBreak } from "../lib/cbConfig";
import { normalizeAARRGGBB } from "../lib/colorHex";
import { useId, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEye, faEyeSlash, faChevronDown, faChevronRight } from "@fortawesome/free-solid-svg-icons";

// ─── Exported types ───────────────────────────────────────────────────────────

// Phase 42 (Plan 42-01): ResolvedLegendLayer lifted to lib/resolveLegendLayers.ts
// (2nd-consumer extraction per Phase 40 precedent). Back-compat re-export below
// keeps LayersLegendPanel.spec.tsx:6 and MapChartRenderer.tsx:90 working unchanged.
// Both the local import AND the re-export are required — the re-export alone does NOT
// bring the name into local scope for use in LayersLegendPanelProps (per Phase 30 note).
import type { DvLayerStatus, ResolvedLegendLayer } from "../lib/resolveLegendLayers";
export type { DvLayerStatus, ResolvedLegendLayer } from "../lib/resolveLegendLayers";

export type LayersLegendPanelProps = {
  layers: ResolvedLegendLayer[];
  corner: LegendPanelCorner;
  collapsed: boolean;
  onToggleCollapse: () => void;
  /**
   * Phase 42 (Plan 42-01): when false, header renders the "Layers" label only —
   * no chevron icon, no onClick on the header div, no role/aria-expanded/aria-controls,
   * no pointer cursor, and the body ALWAYS renders regardless of `collapsed`.
   * Default `true` preserves Phase 41 in-map overlay behavior.
   * Phase 42 LegendRenderer (Plan 42-02) passes `false` to render a non-collapsible
   * panel inside a dashboard grid cell.
   */
  showChevron?: boolean;
  /**
   * When provided, each layer row renders an eye toggle that flips the layer's
   * visibility on the map. The panel stays presentational (no store import) — the
   * caller owns persistence via the callback. `nextVisible` is the desired state
   * after the click (the inverse of the entry's current `visible`). When omitted,
   * no eye button renders (read-only legend, preserves any caller that wants that).
   */
  onToggleVisible?: (layerId: number, nextVisible: boolean) => void;
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Convert 8-char AARRGGBB to CSS rgba() string for swatch background.
 * Uses normalizeAARRGGBB to handle legacy 6-char values + case normalization.
 */
function aarrggbbToCssColor(aarrggbb: string): string {
  const norm = normalizeAARRGGBB(aarrggbb, "FF000000");
  const a = parseInt(norm.slice(0, 2), 16) / 255;
  const r = parseInt(norm.slice(2, 4), 16);
  const g = parseInt(norm.slice(4, 6), 16);
  const b = parseInt(norm.slice(6, 8), 16);
  return `rgba(${r},${g},${b},${a.toFixed(2)})`;
}

/**
 * Determine display text for a classbreak row.
 *
 * Precedence:
 *   1. brk.label — explicit operator-set legend label (always wins when non-empty).
 *   2. Numeric breaks — render the bucket boundaries. Kinetica CB_VALS semantics are
 *      `lo:hi` (lo INCLUSIVE, hi EXCLUSIVE) per cbConfig.ts:27-33. The form allows
 *      either bound to be empty (open-ended bucket — typical for the first/last row):
 *        - both defined  → "min – max"   (en-dash range)
 *        - only min      → "≥ min"       (open-upper — min is inclusive)
 *        - only max      → "< max"       (open-lower — max is exclusive)
 *      The `value` field is unused for numeric breaks (defaults to 0); rendering
 *      String(value) for open-ended buckets was the pre-fix bug that produced
 *      "0" rows for the first and last break.
 *   3. Categorical break — render brk.value verbatim, preserving "<other>" sink
 *      keyword without titlecasing.
 */
function breakDisplayText(brk: CbBreak): string {
  if (brk.label && brk.label.length > 0) return brk.label;
  const hasMin = typeof brk.min === "number";
  const hasMax = typeof brk.max === "number";
  if (hasMin && hasMax) {
    return `${formatRangeBound(brk.min as number)} – ${formatRangeBound(brk.max as number)}`;
  }
  if (hasMin) {
    return `≥ ${formatRangeBound(brk.min as number)}`;
  }
  if (hasMax) {
    return `< ${formatRangeBound(brk.max as number)}`;
  }
  // Categorical break (or malformed numeric with neither bound): render value verbatim.
  return String(brk.value);
}

/**
 * Format a single numeric range bound for the legend. Integers stay integer-formatted;
 * floats trim to at most 3 decimals (strips trailing zeros). Keeps legend readable
 * when auto-suggest produces high-precision boundaries like 1108667.34375.
 */
function formatRangeBound(n: number): string {
  if (Number.isInteger(n)) return String(n);
  // Round to 3 decimals, then trim trailing zeros (e.g. 1.20000 → "1.2")
  return n.toFixed(3).replace(/\.?0+$/, "");
}

/**
 * Phase 44 follow-up: map dv-materialization status → inline legend-badge label.
 * Returns null for "materialized" (no badge — the normal case).
 * Operator-facing copy locked here so screen reader + visual stay in sync.
 */
function dvStatusBadgeLabel(status: DvLayerStatus): string | null {
  switch (status) {
    case "materialized":   return null;
    case "pending":        return "Materializing…";
    case "over_threshold": return "Over threshold";
    case "error":          return "Error";
    case "absent":         return "Not materialized";
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Pure presentational in-map legend overlay.
 * PANEL-V17-01: NO Zustand store imports — props-only, no side effects.
 */
export function LayersLegendPanel({
  layers,
  corner,
  collapsed,
  onToggleCollapse,
  showChevron = true,
  onToggleVisible,
}: LayersLegendPanelProps): JSX.Element {
  const bodyId = useId();
  const rootClass = `layers-legend-panel layers-legend-panel--${corner}`;

  // Session-only per-layer collapse for classbreak legend rows. Default = expanded
  // (rows visible) to preserve existing behavior; users click the chevron next to
  // a layer name to fold/unfold that layer's break list. State is intentionally
  // internal (purely ephemeral UI) — mirrors the panel-level collapse contract
  // which lives in the consumer, but per-layer fold is not worth lifting.
  const [collapsedLayerIds, setCollapsedLayerIds] = useState<Set<number>>(new Set());
  const toggleLayerCollapsed = (id: number) => {
    setCollapsedLayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className={rootClass} role="region" aria-label="Map layer legend">
      {/* Header — click target is the entire header div for usability */}
      <div
        className="layers-legend-panel-header"
        onClick={showChevron ? onToggleCollapse : undefined}
        style={{ cursor: showChevron ? "pointer" : "default" }}
      >
        {showChevron && (
          <button
            type="button"
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            onClick={(e) => {
              // Prevent double-fire with the parent div onClick
              e.stopPropagation();
              onToggleCollapse();
            }}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
          >
            {collapsed ? "▸" : "▾"}
          </button>
        )}
        <span>Layers</span>
      </div>

      {/* Body — rendered when not collapsed; when showChevron=false, always rendered (PANEL-V17-06: session-only collapse) */}
      {(!showChevron || !collapsed) && (
        <div className="layers-legend-panel-body" id={bodyId}>
          {layers.length === 0 ? (
            <div className="layers-legend-panel-empty">
              No layers configured on this widget.
            </div>
          ) : (
            layers.map(({ layer, visible, dvStatus }) => {
              const renderMode =
                ((layer.config as { renderMode?: string })?.renderMode) ?? "raster";
              const cb = coalesceCbConfig(layer.cb_config);
              const isCb = renderMode === "classbreak";
              const cbConfigured = isCb && isCbConfigConfigured(cb);

              // Defensive name resolution: DashboardLayerDto has no top-level name field;
              // fall through to config.name (some integrations store it there) then to Layer ID.
              const layerName =
                (layer as unknown as { name?: string }).name ??
                (layer.config as { name?: string })?.name ??
                `Layer ${layer.id}`;

              const isLayerCollapsed = collapsedLayerIds.has(layer.id);
              const breaksFoldable = isCb && cbConfigured;
              const breaksBodyId = `${bodyId}-layer-${layer.id}-breaks`;

              // Phase 44 follow-up: dv-status surfacing
              // - badgeLabel non-null → render the inline status pill
              // - stale = TRUE for any non-materialized dv state → dim the row + disable the eye
              //   (toggling visibility on a layer that can't render is meaningless)
              // Pending is included in "stale" — even though it's transient, the layer is not on
              // the map right now and dimming reads as "not currently displayed."
              const badgeLabel = dvStatus ? dvStatusBadgeLabel(dvStatus) : null;
              const stale = dvStatus !== undefined && dvStatus !== "materialized";

              return (
                <div
                  key={layer.id}
                  className={`layers-legend-panel-layer-block${visible ? "" : " hidden"}${stale ? " layers-legend-panel-layer-block--stale" : ""}`}
                >
                  {/* Per-layer header: eye toggle (optional) + fold chevron (classbreak only) + name + dv-status badge */}
                  <div className="layers-legend-panel-layer">
                    {onToggleVisible && (
                      <button
                        type="button"
                        className={`layers-legend-panel-eye${visible ? "" : " hidden"}`}
                        aria-label={visible ? "Hide layer" : "Show layer"}
                        aria-pressed={!visible}
                        title={
                          stale
                            ? "Layer cannot be displayed — see status badge"
                            : visible ? "Hide layer" : "Show layer"
                        }
                        disabled={stale}
                        onClick={(e) => {
                          // Don't bubble to the header's collapse handler.
                          e.stopPropagation();
                          if (stale) return;
                          onToggleVisible(layer.id, !visible);
                        }}
                      >
                        <FontAwesomeIcon icon={visible ? faEye : faEyeSlash} />
                      </button>
                    )}
                    {breaksFoldable && (
                      <button
                        type="button"
                        className="layers-legend-panel-fold"
                        aria-expanded={!isLayerCollapsed}
                        aria-controls={breaksBodyId}
                        aria-label={isLayerCollapsed ? "Show legend values" : "Hide legend values"}
                        title={isLayerCollapsed ? "Show legend values" : "Hide legend values"}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleLayerCollapsed(layer.id);
                        }}
                        style={{
                          background: "none",
                          border: "none",
                          padding: 0,
                          marginRight: 4,
                          cursor: "pointer",
                          color: "inherit",
                          fontSize: 10,
                        }}
                      >
                        <FontAwesomeIcon icon={isLayerCollapsed ? faChevronRight : faChevronDown} />
                      </button>
                    )}
                    <span className="layers-legend-panel-layer-name">{layerName}</span>
                    {badgeLabel !== null && (
                      <span
                        className={`layers-legend-panel-dv-badge layers-legend-panel-dv-badge--${dvStatus}`}
                        role="status"
                        title={`Layer is not rendering — ${badgeLabel}`}
                      >
                        {badgeLabel}
                      </span>
                    )}
                  </div>

                  {/* Classbreak break rows (only when cb_config is configured AND this layer is expanded) */}
                  {breaksFoldable && !isLayerCollapsed && (
                    <div id={breaksBodyId}>
                      {cb.breaks.map((brk, i) => (
                        <div key={i} className="layers-legend-panel-break-row">
                          <span
                            className="layers-legend-panel-swatch"
                            style={{ backgroundColor: aarrggbbToCssColor(brk.color) }}
                            aria-hidden="true"
                          />
                          <span>{breakDisplayText(brk)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Empty classbreak hint */}
                  {isCb && !cbConfigured && (
                    <div className="layers-legend-panel-empty">
                      No breaks configured
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
