/**
 * Phase 58 Plan 01 / Phase 58.1 Plan 01 — Versioned allow-list for the widget-action engine.
 *
 * Phase 58.1 corrections (v2 contract):
 *   - ALLOW_LIST_VERSION bumped to "v2" (field names + location structure changed)
 *   - Layer field name corrected: camelCase renderMode is the REAL key read by wmsUrlBuilder.ts
 *   - Each allow-listed field now carries per-field LOCATION metadata:
 *       "layer.config"   — nested inside layer.config blob (renderMode / visible / opacity)
 *       "layer"          — TOP-LEVEL DashboardLayerDto field (track_config / cb_config)
 *       "widget.config"  — nested inside widget.config (all widget kind fields)
 *   - getFieldLocation() exported as the SINGLE SOURCE OF TRUTH for where a field lives.
 *     applyWidgetAction uses it to split layer patches into {config: {...nested}, ...topLevel}.
 *
 * This is the binding AI-safety contract: only fields explicitly listed here
 * may appear in a configPatch. The allow-list is versioned so future additions
 * are tracked and audited. The result of validateActionPatch is consumed by the
 * router (Plan 58-02) to produce a { status: "rejected", reasons } WidgetActionResult
 * when a patch is out-of-list, wrong-type, enum-violating, or contains meta/proto keys.
 *
 * Pure module — NO React, NO Zustand, NO filter-store imports.
 * Mirrors the lib/cbConfig.ts helper-module style.
 */
import { z } from "zod";
import type { WidgetActionTarget } from "./widgetAction";

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

export const ALLOW_LIST_VERSION = "v2" as const;

// ---------------------------------------------------------------------------
// Permanently blocked keys — meta / proto / identity fields
// These are rejected regardless of target kind or widget type.
// Blocking these prevents prototype pollution and identity mutation.
// ---------------------------------------------------------------------------

export const PERMANENTLY_BLOCKED_KEYS = [
  "id",
  "widgetId",
  "dashboardId",
  "dashboard_id",
  "tableId",
  "table_id",
  "type",
  "position",
  "__proto__",
  "constructor",
  "prototype",
] as const;

type PermanentlyBlockedKey = (typeof PERMANENTLY_BLOCKED_KEYS)[number];

function isPermanentlyBlocked(key: string): key is PermanentlyBlockedKey {
  return (PERMANENTLY_BLOCKED_KEYS as readonly string[]).includes(key);
}

// ---------------------------------------------------------------------------
// Field location type
// ---------------------------------------------------------------------------

/**
 * Where a field lives in the data model.
 *   "layer.config"  — nested inside DashboardLayerDto.config blob
 *   "layer"         — TOP-LEVEL DashboardLayerDto field (e.g. track_config, cb_config)
 *   "widget.config" — nested inside WidgetDto.config blob
 */
export type FieldLocation = "layer.config" | "layer" | "widget.config";

// ---------------------------------------------------------------------------
// Field descriptor type
// ---------------------------------------------------------------------------

type FieldDescriptor = {
  schema: z.ZodTypeAny;
  location: FieldLocation;
};

type FieldDescriptors = Record<string, FieldDescriptor>;

// ---------------------------------------------------------------------------
// Allow-list seed — curated, not exhaustive
// ---------------------------------------------------------------------------

/**
 * Aggregation enum for chart widgets.
 * Conservative list of standard aggregation functions.
 */
const CHART_AGGREGATIONS = [
  "sum",
  "avg",
  "min",
  "max",
  "count",
  "count_distinct",
] as const;

/**
 * Widget kind — keyed by widget type (e.g. "map", "chart", "records").
 * All widget config fields live in widget.config.
 */
const WIDGET_ALLOW_LIST: Record<string, FieldDescriptors> = {
  map: {
    // Whether to show the info/popup panel on feature click (safe boolean toggle)
    show_popup: { schema: z.boolean(), location: "widget.config" },
    // Whether to show the map scale bar
    show_scale_bar: { schema: z.boolean(), location: "widget.config" },
    // Whether fullscreen button is visible
    show_fullscreen: { schema: z.boolean(), location: "widget.config" },
  },
  chart: {
    // The metric column for the chart (safe string; column name)
    metric: { schema: z.string(), location: "widget.config" },
    // The aggregation function applied to the metric
    aggregation: { schema: z.enum(CHART_AGGREGATIONS), location: "widget.config" },
  },
  records: {
    // Page size for the records table
    page_size: { schema: z.number().int().positive(), location: "widget.config" },
  },
};

/**
 * Layer kind — with per-field location metadata.
 *
 * CRITICAL location facts (proven by direct code inspection, Phase 58.1):
 *   - renderMode → NESTED in layer.config (wmsUrlBuilder.ts reads config.renderMode)
 *   - visible    → NESTED in layer.config (layerVisibility.ts reads config.visible)
 *   - opacity    → NESTED in layer.config (config field, mirrors visible/renderMode)
 *   - track_config → TOP-LEVEL DashboardLayerDto field (JSON string)
 *     See [[track-config-toplevel-field]] memory and client.ts DashboardLayerDto
 *   - cb_config  → TOP-LEVEL DashboardLayerDto field (JSON string)
 */
const LAYER_ALLOW_LIST: FieldDescriptors = {
  // WMS render mode — NESTED in layer.config (wmsUrlBuilder reads config.renderMode)
  // camelCase (renderMode) is the REAL field name. Phase 58 had this wrong.
  renderMode: {
    schema: z.enum(["raster", "heatmap", "classbreak", "contour"]),
    location: "layer.config",
  },
  // Layer visibility — NESTED in layer.config (layerVisibility.ts reads config.visible)
  visible: { schema: z.boolean(), location: "layer.config" },
  // Layer opacity (0–1 inclusive) — NESTED in layer.config (config field)
  opacity: { schema: z.number().min(0).max(1), location: "layer.config" },
  // TOP-LEVEL DashboardLayerDto field — JSON string carrying track styling config
  // (NOT config.track_config — see DashboardLayerDto in client.ts and [[track-config-toplevel-field]])
  track_config: { schema: z.string(), location: "layer" },
  // TOP-LEVEL DashboardLayerDto field — JSON string carrying classbreak config
  // (NOT config.cb_config — see DashboardLayerDto in client.ts)
  cb_config: { schema: z.string(), location: "layer" },
};

/**
 * DynamicView kind — lightweight single allow-listed field.
 * The "enabled" toggle is safe and exercisable for canary/testing purposes.
 */
const DYNAMIC_VIEW_ALLOW_LIST: FieldDescriptors = {
  enabled: { schema: z.boolean(), location: "widget.config" },
};

// ---------------------------------------------------------------------------
// Allow-list resolver
// ---------------------------------------------------------------------------

function resolveAllowList(
  kind: WidgetActionTarget["kind"],
  widgetType: string | undefined,
): FieldDescriptors | null {
  if (kind === "layer") return LAYER_ALLOW_LIST;
  if (kind === "dynamicView") return DYNAMIC_VIEW_ALLOW_LIST;
  if (kind === "widget") {
    if (!widgetType) return null;
    return WIDGET_ALLOW_LIST[widgetType] ?? null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// getFieldLocation — single source of truth for field location
// ---------------------------------------------------------------------------

/**
 * Returns the location of a field for a given (kind, widgetType, field) triple,
 * or null if the field is not in the allow-list (e.g. unknown or non-allow-listed
 * fields).
 *
 * This is the SINGLE SOURCE OF TRUTH for where a field lives.
 * applyWidgetAction uses this to split a layer patch into:
 *   - config sub-object for "layer.config" fields (renderMode, visible, opacity)
 *   - top-level for "layer" fields (track_config, cb_config)
 *
 * No hardcoded field names in the router — the allow-list drives the split.
 */
export function getFieldLocation(
  kind: WidgetActionTarget["kind"],
  widgetType: string | undefined,
  field: string,
): FieldLocation | null {
  const allowList = resolveAllowList(kind, widgetType);
  if (!allowList) return null;
  const descriptor = allowList[field];
  if (!descriptor) return null;
  return descriptor.location;
}

/**
 * Split a validated layer configPatch into nested-config fields and top-level fields,
 * using the allow-list location metadata as the single source of truth.
 *
 * Returns: { config?: Record<string, unknown>; topLevel: Record<string, unknown> }
 *   - config: fields with location "layer.config" — go under layer.config
 *   - topLevel: fields with location "layer" — go at top level (track_config, cb_config)
 *
 * Only call this after validateActionPatch has returned { valid: true }.
 * Unknown/blocked keys are silently excluded (they should not be present post-validation).
 */
export function splitLayerPatch(configPatch: Record<string, unknown>): {
  config?: Record<string, unknown>;
  topLevel: Record<string, unknown>;
} {
  const config: Record<string, unknown> = {};
  const topLevel: Record<string, unknown> = {};

  for (const key of Object.keys(configPatch)) {
    const location = getFieldLocation("layer", undefined, key);
    if (location === "layer.config") {
      config[key] = configPatch[key];
    } else if (location === "layer") {
      topLevel[key] = configPatch[key];
    }
    // Unknown fields post-validation should not occur; silently skip
  }

  return {
    ...(Object.keys(config).length > 0 ? { config } : {}),
    topLevel,
  };
}

// ---------------------------------------------------------------------------
// validateActionPatch — the binding contract for the action engine
// ---------------------------------------------------------------------------

/**
 * Validates that every key in `configPatch` is:
 *   1. Not a permanently-blocked meta/proto key
 *   2. Listed in the allow-list for (kind, widgetType)
 *   3. A value that satisfies the field's zod validator
 *
 * IMPORTANT: This function NEVER spreads the untrusted patch into an object
 * before validating — it uses Object.keys() to enumerate safely, preventing
 * prototype pollution at the validation boundary.
 *
 * The result is consumed by the router (Plan 58-02) to produce a
 * { status: "rejected", reasons } WidgetActionResult.
 */
export function validateActionPatch(
  kind: WidgetActionTarget["kind"],
  widgetType: string | undefined,
  configPatch: Record<string, unknown>,
): { valid: true } | { valid: false; reasons: string[] } {
  const reasons: string[] = [];

  // Step 1: Check for permanently blocked keys first.
  // Uses Object.keys() — safe enumeration, never spread.
  const keys = Object.keys(configPatch);
  for (const key of keys) {
    if (isPermanentlyBlocked(key)) {
      reasons.push(`blocked meta/proto key: ${key}`);
    }
  }

  // Step 2: Resolve the allow-list for this (kind, widgetType).
  const allowList = resolveAllowList(kind, widgetType);
  if (allowList === null) {
    reasons.push(
      `no allow-list for target: kind="${kind}" widgetType=${widgetType ?? "undefined"}`,
    );
    return { valid: false, reasons };
  }

  // Step 3: Validate each key against the allow-list.
  for (const key of keys) {
    // Skip keys already blocked — they have their reason recorded above.
    if (isPermanentlyBlocked(key)) continue;

    const descriptor = allowList[key];
    if (descriptor === undefined) {
      reasons.push(`unknown field: ${key}`);
      continue;
    }

    const parseResult = descriptor.schema.safeParse(configPatch[key]);
    if (!parseResult.success) {
      const message = parseResult.error.errors.map((e) => e.message).join("; ");
      reasons.push(`invalid value for ${key}: ${message}`);
    }
  }

  if (reasons.length > 0) {
    return { valid: false, reasons };
  }
  return { valid: true };
}
