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
 *   "widget.config" → read from widget.config[field]  (show_popup / metric / page_size / etc.)
 *
 * IMPORTANT: renderMode (camelCase) is the ONLY render-mode key. The snake-case variant is not in the allow-list.
 * Field names in the returned patch match the allow-list key names exactly.
 */
import { getFieldLocation } from "./actionAllowList";
import type { WidgetActionTarget } from "./widgetAction";
import type { DashboardLayerDto, WidgetDto } from "../api/client";

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
  chart: ["metric", "aggregation"],
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
 *   3. Include in patch if value is not undefined AND not null (no value to snapshot).
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
      value = (layer?.config as Record<string, unknown> | undefined)?.[field];
    } else if (location === "layer") {
      // TOP-LEVEL DashboardLayerDto field (track_config / cb_config)
      value = (layer as Record<string, unknown> | undefined)?.[field];
    } else if (location === "widget.config") {
      if (target.kind === "widget") {
        // Nested in widget.config
        value = (widget?.config as Record<string, unknown> | undefined)?.[field];
      } else if (target.kind === "dynamicView") {
        // DynamicView rows have no config blob — read from supplied dynamicViewConfig
        value = dynamicViewConfig?.[field];
      }
    }

    // Include only if a real value exists (null or undefined → skip; no value to snapshot)
    if (value !== undefined && value !== null) {
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
