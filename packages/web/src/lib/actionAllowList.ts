/**
 * Phase 58 Plan 01 — Versioned allow-list for the widget-action engine.
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

export const ALLOW_LIST_VERSION = "v1" as const;

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
// Field validator map type
// ---------------------------------------------------------------------------

type FieldValidators = Record<string, z.ZodTypeAny>;

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
 */
const WIDGET_ALLOW_LIST: Record<string, FieldValidators> = {
  map: {
    // Whether to show the info/popup panel on feature click (safe boolean toggle)
    show_popup: z.boolean(),
    // Whether to show the map scale bar
    show_scale_bar: z.boolean(),
    // Whether fullscreen button is visible
    show_fullscreen: z.boolean(),
  },
  chart: {
    // The metric column for the chart (safe string; column name)
    metric: z.string(),
    // The aggregation function applied to the metric
    aggregation: z.enum(CHART_AGGREGATIONS),
  },
  records: {
    // Page size for the records table
    page_size: z.number().int().positive(),
  },
};

/**
 * Layer kind — keyed by top-level DashboardLayerDto field names.
 * Note: track_config and cb_config are TOP-LEVEL DashboardLayerDto fields
 * (JSON strings), NOT nested under layer.config. This is a critical distinction —
 * see [[track-config-toplevel-field]] memory and 58-CONTEXT.md.
 */
const LAYER_ALLOW_LIST: FieldValidators = {
  // WMS render mode — must be one of the Kinetica-supported modes
  render_mode: z.enum(["raster", "heatmap", "classbreak", "contour"]),
  // Layer visibility toggle
  visible: z.boolean(),
  // Layer opacity (0–1 inclusive)
  opacity: z.number().min(0).max(1),
  // TOP-LEVEL DashboardLayerDto field — JSON string carrying track styling config
  // (NOT config.track_config — see DashboardLayerDto in client.ts and [[track-config-toplevel-field]])
  track_config: z.string(),
  // TOP-LEVEL DashboardLayerDto field — JSON string carrying classbreak config
  // (NOT config.cb_config — see DashboardLayerDto in client.ts)
  cb_config: z.string(),
};

/**
 * DynamicView kind — lightweight single allow-listed field.
 * The "enabled" toggle is safe and exercisable for canary/testing purposes.
 */
const DYNAMIC_VIEW_ALLOW_LIST: FieldValidators = {
  enabled: z.boolean(),
};

// ---------------------------------------------------------------------------
// Allow-list resolver
// ---------------------------------------------------------------------------

function resolveAllowList(
  kind: WidgetActionTarget["kind"],
  widgetType: string | undefined,
): FieldValidators | null {
  if (kind === "layer") return LAYER_ALLOW_LIST;
  if (kind === "dynamicView") return DYNAMIC_VIEW_ALLOW_LIST;
  if (kind === "widget") {
    if (!widgetType) return null;
    return WIDGET_ALLOW_LIST[widgetType] ?? null;
  }
  return null;
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

    const validator = allowList[key];
    if (validator === undefined) {
      reasons.push(`unknown field: ${key}`);
      continue;
    }

    const parseResult = validator.safeParse(configPatch[key]);
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
