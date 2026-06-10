/**
 * Phase 58 Plan 02 / Phase 58.1 Plan 01 — applyWidgetAction: single dispatch entry
 * for the widget action engine.
 *
 * TRANSIENT-ONLY: this function NEVER calls updateWidget, updateLayer, or any
 * server PATCH at runtime. It only writes the session overlay store and returns
 * a typed result. The dashboard's saved config is always the baseline; the overlay
 * is layered on top at render time and is cleared on dashboard-switch / logout.
 *
 * Same-dashboard only: the `lookups` argument contains the CURRENT dashboard's
 * entities so dangling targets (deleted widget/layer/dv) are detected immediately.
 *
 * This is the MCP-future hook: the same envelope an AI/MCP layer produces is
 * consumed here — the allow-list in actionAllowList.ts is the binding contract.
 *
 * Phase 58.1 changes:
 *   - Layer patches are SPLIT by allow-list location metadata (single source of truth)
 *     into { config?: {...nested}, ...topLevel } — no hardcoded field names here.
 *   - renderMode/visible/opacity → nested under config sub-object
 *   - track_config/cb_config → remain at top level
 *   - Idempotency compares against the DEEP-MERGED proposed/current layer
 *     (config is deep-merged, not flat-spread) so renderMode changes are detected.
 *   - Before calling applyLayerOverride, the config portion is deep-merged against
 *     the existing layerOverrides[id]?.config to prevent the store's depth-1 shallow
 *     merge from wiping prior nested config keys on repeated patches.
 *
 * // INVARIANT: ACTION-ENGINE-NO-FILTER
 * This module NEVER imports filter-store symbols (materializeFilter /
 * dropFilterView / addFilter / setBulkFilters / filterVersion). Engine
 * decoupling from the filter/materialize system is enforced by the static
 * source-grep assertion in Plan 58-02 actionEngineDecoupling.spec.ts.
 *
 * // SOLE MATERIALIZE TRIGGER INVARIANT (mirrors DataFilterRenderer.tsx lock)
 * The action engine never calls materializeFilter directly. The overlay store
 * write triggers a re-render of the target widget/layer; existing materialize
 * triggers (AggregatedWidgetRenderer Effect 1 on filterVersion) are untouched.
 * The engine is a pure SESSION-OVERLAY writer with zero filter-system contact.
 */

import type { WidgetDto, DashboardLayerDto } from "../api/client";
// DashboardLayerDto used for ActionLookups only; layer overlays are stored as generic Record
import type { WidgetAction, WidgetActionResult, WidgetActionTarget } from "./widgetAction";
import { validateActionPatch, splitLayerPatch } from "./actionAllowList";
import { useWidgetActionStore } from "../store/widgetActionStore";
import { useToastStore } from "../store/toast";

// ---------------------------------------------------------------------------
// ActionLookups — the caller supplies the current same-dashboard entities
// ---------------------------------------------------------------------------

export type ActionLookups = {
  /** Current widgets on the dashboard (used for target resolution + widget type). */
  widgets: WidgetDto[];
  /** Current layers on the dashboard (used for target resolution + idempotency). */
  layers: DashboardLayerDto[];
  /** Current dynamic-view ids on the dashboard (used for target resolution). */
  dynamicViewIds: number[];
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Stringify a value for idempotency fingerprinting.
 * JSON.stringify with sorted keys for deterministic output.
 */
function fingerprint(value: unknown): string {
  return JSON.stringify(value, (_, v) => {
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      );
    }
    return v;
  });
}

// ---------------------------------------------------------------------------
// applyWidgetAction — the single dispatch entry
// ---------------------------------------------------------------------------

/**
 * Dispatch a widget action:
 *   1. Resolve target — if not found → toast + return { status: "target_not_found" }
 *   2. Validate against allow-list — if invalid → toast + return { status: "rejected", reasons }
 *   3. Idempotency — if merged value is unchanged → return { status: "applied" } without writing
 *   4. Write overlay store → return { status: "applied" }
 *
 * This function is pure aside from side-effects on the overlay store and toast store.
 * It NEVER calls updateWidget, updateLayer, or any network route.
 *
 * Layer overlay shape (Phase 58.1):
 *   The split patch is DTO-shaped: { config?: {renderMode, visible, opacity, ...}, track_config?, cb_config? }
 *   - "layer.config" fields → nested under config sub-object
 *   - "layer" fields → top-level (track_config, cb_config)
 *   applyWidgetAction deep-merges the config portion against existing layerOverrides[id]?.config
 *   before calling applyLayerOverride to avoid the store's depth-1 shallow merge wiping prior
 *   nested config keys on repeated overlay writes to the same layer.
 */
export function applyWidgetAction(
  action: WidgetAction,
  lookups: ActionLookups
): WidgetActionResult {
  const { target, configPatch } = action;

  // --- Step 1: Resolve target ---

  let widgetType: string | undefined;

  if (target.kind === "widget") {
    const widget = lookups.widgets.find((w) => w.id === target.id);
    if (!widget) {
      return _notFound(target);
    }
    widgetType = widget.type;
  } else if (target.kind === "layer") {
    const layer = lookups.layers.find((l) => l.id === target.id);
    if (!layer) {
      return _notFound(target);
    }
  } else if (target.kind === "dynamicView") {
    if (!lookups.dynamicViewIds.includes(target.id)) {
      return _notFound(target);
    }
  }

  // --- Step 2: Validate against allow-list ---

  const validation = validateActionPatch(target.kind, widgetType, configPatch);
  if (!validation.valid) {
    const reasons = validation.reasons;
    const message = `Action rejected: ${reasons.join("; ")}`;
    useToastStore.getState().showToast(message, "info");
    console.warn("[applyWidgetAction] rejected", { target, reasons });
    return { status: "rejected", target, reasons };
  }

  // --- Step 3: Idempotency check ---

  const store = useWidgetActionStore.getState();

  if (target.kind === "widget") {
    const widget = lookups.widgets.find((w) => w.id === target.id)!;
    const currentOverlay = store.widgetOverrides[target.id] ?? {};
    const proposed = { ...(widget.config ?? {}), ...currentOverlay, ...configPatch };
    const current = { ...(widget.config ?? {}), ...currentOverlay };
    if (fingerprint(proposed) === fingerprint(current)) {
      return { status: "applied", target };
    }
    store.applyWidgetOverride(target.id, configPatch);
  } else if (target.kind === "layer") {
    const layer = lookups.layers.find((l) => l.id === target.id)!;

    // Phase 58.1: split the validated configPatch by allow-list location metadata.
    // The allow-list is the SINGLE SOURCE OF TRUTH — no hardcoded field names here.
    // - "layer.config" fields → split.config (nested)
    // - "layer" fields        → split.topLevel (top-level: track_config, cb_config)
    const split = splitLayerPatch(configPatch);

    // Deep-merge config portion against existing overlay config to avoid the store's
    // depth-1 shallow merge wiping prior nested config keys on repeated patches.
    const existingOverlay = store.layerOverrides[target.id] ?? {};
    const existingOverlayConfig = (existingOverlay.config as Record<string, unknown> | undefined) ?? {};
    const mergedConfig = split.config
      ? { ...existingOverlayConfig, ...split.config }
      : existingOverlayConfig;

    // Build the proposed DTO-shaped overlay patch to write.
    // top-level fields (track_config, cb_config) stay at top level.
    const patchToWrite: Record<string, unknown> = {
      ...split.topLevel,
      ...(Object.keys(mergedConfig).length > 0 ? { config: mergedConfig } : {}),
    };

    // Idempotency: compare the deep-merged proposed layer vs current effective layer.
    // Both use the same deep-merge logic as effectiveLayers in MapChartRenderer.
    const currentConfig = {
      ...(layer.config as Record<string, unknown>),
      ...existingOverlayConfig,
    };
    const proposedConfig = {
      ...(layer.config as Record<string, unknown>),
      ...mergedConfig,
    };
    const currentTopLevel = { ...layer, ...existingOverlay };
    const proposedTopLevel = { ...layer, ...existingOverlay, ...split.topLevel };

    const currentFingerprint = fingerprint({ ...currentTopLevel, config: currentConfig });
    const proposedFingerprint = fingerprint({ ...proposedTopLevel, config: proposedConfig });

    if (currentFingerprint === proposedFingerprint) {
      return { status: "applied", target };
    }

    store.applyLayerOverride(target.id, patchToWrite);
  } else if (target.kind === "dynamicView") {
    const currentOverlay = store.dynamicViewOverrides[target.id] ?? {};
    const proposed = { ...currentOverlay, ...configPatch };
    const current = { ...currentOverlay };
    if (fingerprint(proposed) === fingerprint(current)) {
      return { status: "applied", target };
    }
    store.applyDynamicViewOverride(target.id, configPatch);
  }

  return { status: "applied", target };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function _notFound(target: WidgetActionTarget): WidgetActionResult {
  useToastStore
    .getState()
    .showToast("That control's target is no longer available.", "info");
  console.warn("[applyWidgetAction] target_not_found", target);
  return { status: "target_not_found", target };
}
