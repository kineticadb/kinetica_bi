/**
 * v1.5 Phase 28 (TARGET-V15-02): co-located SpatialTarget type + helper module
 * for per-map widget spatial filter target configuration.
 *
 * Mirrors the `mapInfoConfig.ts` co-location pattern (type + DEFAULT_* constants
 * + getter helpers in a single file). The `SpatialTarget` type is BYTE-PARITY
 * with the server-side counterpart in `packages/server/src/lib/spatialWhereClause.ts`
 * lines 54-81 — same field names, same optionality, NO frontend-only fields
 * (no UI `id`, no camelCase rename). Phase 30's `materializeFilter` client helper
 * sends this type over the wire as-is (zero projection). The type duplication is
 * the established convention (matches DashboardLayer / DashboardLayerDto).
 *
 * `isSpatialTargetEligible` is the SINGLE SOURCE OF TRUTH for the v1.5
 * three-gate eligibility pattern (MAT-V15-03):
 *   - Config-time:      MapConfigPanel shows WKB warning + incomplete indicator (Plan 28-02)
 *   - Materialize-time: AggregatedWidgetRenderer silently skips ineligible targets (Phase 30)
 *   - Server-time:      buildSpatialOrBlock throws SpatialFilterWkbDeferredError → 501
 *                       (already shipped Phase 26)
 *
 * Phase 28 ships this module DORMANT — Plan 28-02 is the first consumer (UI).
 * Phase 30 is the second consumer (materialize trigger eligibility gate).
 */

import type { MapWidgetConfig } from "./wmsUrlBuilder";
import type { WidgetDto } from "../api/client";

// ─── Types ─────────────────────────────────────────────────────────────────

/**
 * Spatial mode discriminant. Byte-parity with server
 * `packages/server/src/lib/spatialWhereClause.ts` line 54.
 * Note: a same-shape union also lives in `./columnTypes` (Phase 11) — separate
 * declarations for cross-module independence, mirrors the server-side local
 * declaration choice (STATE.md Phase 26 [WHERE-V15-01] decision).
 */
export type SpatialMode = "latlon" | "wkt" | "wkb";

/**
 * Per-table spatial filter target. Byte-parity with server
 * `packages/server/src/lib/spatialWhereClause.ts` lines 75-81 — same field
 * names, same optionality. The Phase 30 materializeFilter helper sends this
 * exact shape over the wire (no projection).
 *
 * Exactly one mode-appropriate column variant must be set for eligibility:
 *   - spatialMode "latlon" → lonCol + latCol BOTH required
 *   - spatialMode "wkt"    → spatialCol required
 *   - spatialMode "wkb"    → ineligible regardless (TD-V14-WKB-SPIKE; isSpatialTargetEligible always returns false)
 */
export type SpatialTarget = {
  tableId: number;
  spatialMode: SpatialMode;
  lonCol?: string;     // required for latlon
  latCol?: string;     // required for latlon
  spatialCol?: string; // required for wkt
};

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Read the per-widget `spatialTargets` array with legacy-default coercion.
 * Returns `[]` for legacy v1.4 widgets that lack the field entirely (no
 * migration needed — spatial filtering inert until operator configures via
 * MapConfigPanel in Plan 28-02).
 *
 * Returns the SAME array reference (no defensive copy) — mirrors
 * `getInfoEnabled` minimal-helper style. Callers that need only eligible
 * targets do: `getSpatialTargets(widget).filter(isSpatialTargetEligible)`.
 */
export function getSpatialTargets(
  widget: { config: Pick<MapWidgetConfig, "spatialTargets"> },
): SpatialTarget[] {
  return widget.config.spatialTargets ?? [];
}

/**
 * Single eligibility predicate. Source of truth across all three v1.5 gates
 * (MAT-V15-03). Returns `false` for:
 *   - spatialMode === "wkb" (TD-V14-WKB-SPIKE; deferred)
 *   - spatialMode === "latlon" AND (missing lonCol OR missing latCol)
 *   - spatialMode === "wkt" AND missing spatialCol
 *
 * Treats empty-string columns as missing (falsy check). Returns `true` only
 * for fully-configured latlon or wkt targets.
 */
export function isSpatialTargetEligible(target: SpatialTarget): boolean {
  if (target.spatialMode === "wkb") return false;
  if (target.spatialMode === "latlon") {
    return Boolean(target.lonCol) && Boolean(target.latCol);
  }
  if (target.spatialMode === "wkt") {
    return Boolean(target.spatialCol);
  }
  return false;
}

/**
 * Phase 30 (MAT-V15-02 prerequisite): aggregate per-table spatial targets across all
 * map widgets in a dashboard.
 *
 * Resolution rules (locked by 30-CONTEXT.md `<decisions>` § "SpatialTarget resolution"):
 *   - Iterate ONLY widgets with widget.type === "map".
 *   - Sort by widget.id ASCENDING (deterministic across renders; survives grid reorders).
 *   - For each map widget, call getSpatialTargets(w).filter(isSpatialTargetEligible) —
 *     WKB and incomplete targets are dropped by isSpatialTargetEligible.
 *   - First eligible target per tableId WINS — subsequent duplicates (from higher-id
 *     widgets targeting the same table) are silently skipped.
 *
 * Returns an empty Map when no widgets, no map widgets, or no eligible targets exist.
 * The returned Map is mutable but callers MUST NOT mutate it (treat as readonly).
 */
export function aggregateSpatialTargetsByTable(
  widgets: WidgetDto[],
): Map<number, SpatialTarget> {
  const result = new Map<number, SpatialTarget>();
  // Sort by id ascending — do NOT rely on caller-supplied order. Phase 30 CONTEXT lock:
  // grid reorders persist position changes but never id changes; id-ascending is stable.
  const mapWidgets = widgets
    .filter((w) => w.type === "map")
    .slice()
    .sort((a, b) => a.id - b.id);
  for (const w of mapWidgets) {
    // Cast through Pick<MapWidgetConfig, "spatialTargets"> — WidgetDto.config is
    // Record<string, unknown>; getSpatialTargets only reads .spatialTargets.
    const eligibleTargets = getSpatialTargets({
      config: w.config as Pick<MapWidgetConfig, "spatialTargets">,
    }).filter(isSpatialTargetEligible);
    for (const target of eligibleTargets) {
      // First-write-wins per tableId — widget-id-ascending makes "first" deterministic.
      if (!result.has(target.tableId)) {
        result.set(target.tableId, target);
      }
    }
  }
  return result;
}
