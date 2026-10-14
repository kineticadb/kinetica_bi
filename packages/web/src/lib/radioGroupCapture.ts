/**
 * Phase 59 Plan 01 — Location-aware Capture helper.
 *
 * Pure module — NO React, NO Zustand. The config panel passes already-fetched sources.
 * Mirrors the lib/actionAllowList.ts helper-module style.
 *
 * captureAllowListedSubset(args):
 *   Snapshots the CURRENT allow-listed config subset of a target into a configPatch.
 *   This is the "Capture from target" button logic — operator configures the target
 *   visually via the normal UI, then captures (Power BI bookmark pattern).
 *
 * LOCATION CONTRACT (Phase 58.1 v2 — single source of truth is getFieldLocation):
 *   "layer.config"  → read from layer.config[field]  (renderMode / visible / opacity)
 *   "layer"         → read from layer[field]          (track_config / cb_config — TOP-LEVEL)
 *   "widget.config" → read from widget.config[field]  (real renderer key via WIDGET_OVERLAY_KEY_MAP: show_popup -> infoEnabled, page_size -> pageSize, etc.)
 *
 * IMPORTANT: renderMode (camelCase) is the ONLY render-mode key. The snake-case variant is not in the allow-list.
 * Field names in the returned patch match the allow-list key names exactly.
 */
import { getFieldLocation } from "./actionAllowList";
import { WIDGET_OVERLAY_KEY_MAP } from "./widgetOverlayKeys";
import type { WidgetActionTarget } from "./widgetAction";
import type { DashboardLayerDto, WidgetDto } from "../api/client";

/** D-19: saved aggregation is UPPERCASE; the allow-list enum is lowercase. */
export const WIDGET_CAPTURE_VALUE_TRANSFORMS: Record<string, (v: unknown) => unknown> = {
  aggregation: (v) => String(v).toLowerCase(),
};
const CHART_CAPTURE_TYPES = new Set(["bar", "line", "pie", "table", "bignumber"]);

// ---------------------------------------------------------------------------
// Candidate field name lists per target kind
// ---------------------------------------------------------------------------

/**
 * All allow-listed field names for a layer target.
 * These are the CANDIDATE names we attempt to capture; the actual LOCATION of each
 * is derived via getFieldLocation (no hardcoded field→location mapping here).
 */
export const LAYER_CAPTURE_FIELDS = [
  "renderMode",
  "visible",
  "opacity",
  "track_config",
  "cb_config",
] as const;

/**
 * Allow-listed field names per widget type.
 * Keys match WIDGET_ALLOW_LIST keys in actionAllowList.ts.
 */
export const WIDGET_CAPTURE_FIELDS: Record<string, readonly string[]> = {
  map: ["show_popup", "show_scale_bar", "show_fullscreen"],
  // D-19: keyed by real types; 136-07 maps metric -> metricColumn and normalises aggregation case
  bar: ["metric", "aggregation"],
  line: ["metric", "aggregation"],
  pie: ["metric", "aggregation"],
  table: ["metric", "aggregation"],
  bignumber: ["metric", "aggregation"],
  records: ["page_size"],
};

/**
 * Allow-listed field names for a dynamicView target.
 */
export const DYNAMICVIEW_CAPTURE_FIELDS = ["enabled"] as const;

// ---------------------------------------------------------------------------
// captureAllowListedSubset
// ---------------------------------------------------------------------------

/**
 * Captures the current allow-listed config subset of a target into a configPatch.
 *
 * For each allow-listed candidate field of the target kind:
 *   1. getFieldLocation(kind, widgetType, field) → location or null (not allow-listed → skip)
 *   2. Read the value from the correct source per location:
 *      - "layer.config"  → layer?.config?.[field]
 *      - "layer"         → layer?.[field]  (top-level DTO field, e.g. track_config/cb_config)
 *      - "widget.config" → widget?.config?.[field] (for kind "widget")
 *                          dynamicViewConfig?.[field] (for kind "dynamicView")
 *   3. Include in patch if value is not undefined, null or "" (no value to snapshot).
 *
 * Returns a Record<string, unknown> whose keys are the REAL allow-listed field names
 * (renderMode camelCase, cb_config / track_config snake as defined in the allow-list).
 *
 * @param args.target           - The action target (kind + id)
 * @param args.widgetType       - For kind "widget": the target widget's type (e.g. "map")
 * @param args.layer            - Fetched DashboardLayerDto (for kind "layer")
 * @param args.widget           - Fetched WidgetDto (for kind "widget")
 * @param args.dynamicViewConfig - Parsed config for the dynamic view row (for kind "dynamicView")
 */
export function captureAllowListedSubset(args: {
  target: WidgetActionTarget;
  widgetType?: string;
  layer?: DashboardLayerDto;
  widget?: WidgetDto;
  dynamicViewConfig?: Record<string, unknown>;
}): Record<string, unknown> {
  const { target, widgetType, layer, widget, dynamicViewConfig } = args;
  const patch: Record<string, unknown> = {};

  // Determine the candidate field names to attempt for this target kind
  const candidateFields = getCandidateFields(target.kind, widgetType);

  for (const field of candidateFields) {
    // Derive location from the allow-list — NEVER hardcode field→location here
    const location = getFieldLocation(target.kind, widgetType, field);
    if (location === null) {
      // Field is not in the allow-list for this (kind, widgetType) — skip
      continue;
    }

    let value: unknown;

    if (location === "layer.config") {
      // Nested in layer.config blob (renderMode / visible / opacity)
      const lc = layer?.config as Record<string, unknown> | undefined;
      value = lc?.[field];
      // D-19: opacity is stored as POINTOPACITY 0-100 by LayersModal
      if (field === "opacity" && value === undefined && typeof lc?.POINTOPACITY === "number") {
        value = lc.POINTOPACITY / 100;
      }
    } else if (location === "layer") {
      // TOP-LEVEL DashboardLayerDto field (track_config / cb_config)
      value = (layer as Record<string, unknown> | undefined)?.[field];
    } else if (location === "widget.config") {
      if (target.kind === "widget") {
        // Nested in widget.config under the renderer's REAL key (GAP-134-01): the allow-list
        // key (show_popup ...) is only the persisted option shape; saved widgets store
        // infoEnabled / showScaleBar / showFullscreenButton / pageSize.
        const realKey = WIDGET_OVERLAY_KEY_MAP[widgetType ?? ""]?.[field] ?? field;
        value = (widget?.config as Record<string, unknown> | undefined)?.[realKey];
        if (value != null && CHART_CAPTURE_TYPES.has(widgetType ?? "") && WIDGET_CAPTURE_VALUE_TRANSFORMS[field]) {
          value = WIDGET_CAPTURE_VALUE_TRANSFORMS[field](value);
        }
      } else if (target.kind === "dynamicView") {
        // DynamicView rows have no config blob — read from supplied dynamicViewConfig
        value = dynamicViewConfig?.[field];
      }
    }

    // Include only if a real value exists (null, undefined or "" → skip; no value to snapshot).
    // "" occurs for saved custom-metric charts (metricColumn "") and is not a valid allow-list value.
    if (value !== undefined && value !== null && value !== "") {
      patch[field] = value;
    }
  }

  return patch;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns the candidate field names to attempt for a given (kind, widgetType).
 * These are enumerated here so tests can verify the right set is attempted;
 * the LOCATION of each is always derived via getFieldLocation.
 */
function getCandidateFields(
  kind: WidgetActionTarget["kind"],
  widgetType: string | undefined,
): readonly string[] {
  if (kind === "layer") {
    return LAYER_CAPTURE_FIELDS;
  }
  if (kind === "dynamicView") {
    return DYNAMICVIEW_CAPTURE_FIELDS;
  }
  if (kind === "widget") {
    if (!widgetType) return [];
    return WIDGET_CAPTURE_FIELDS[widgetType] ?? [];
  }
  return [];
}
