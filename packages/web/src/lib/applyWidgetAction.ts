/**
 * Phase 58 Plan 02 / Phase 58.1 Plan 01 / Phase 60 Plan 01 —
 * applyWidgetAction: single dispatch entry for the widget action engine.
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
 * Phase 60.01 changes:
 *   - Accepts a `controlId: number` (the dispatching control's widget id).
 *   - Write-side records a CONTROL'S CONTRIBUTION (replacing its prior) via
 *     setControlContribution(controlId, nextContribution).
 *   - Switch-replace semantics: the control's contribution for that target is
 *     REPLACED wholesale — fields the new option does not set revert to baseline.
 *   - Other targets/kinds in the same control's contribution are preserved.
 *   - Idempotency: compares the per-control contribution for that target;
 *     if unchanged, returns { status: "applied" } without writing.
 *
 * Phase 58.1 changes:
 *   - Layer patches are SPLIT by allow-list location metadata (single source of truth)
 *     into { config?: {...nested}, ...topLevel } — no hardcoded field names here.
 *   - renderMode/visible/opacity → nested under config sub-object
 *   - track_config/cb_config → remain at top level
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
 *   3. Build the control's NEW contribution for this target (switch-replace: replaces prior
 *      entry for this target; other targets in the same control's contribution preserved).
 *   4. Idempotency — if the per-control contribution for that target is unchanged →
 *      return { status: "applied" } without writing.
 *   5. Write via store.setControlContribution(controlId, nextContribution).
 *
 * This function is pure aside from side-effects on the overlay store and toast store.
 * It NEVER calls updateWidget, updateLayer, or any network route.
 *
 * Layer overlay shape (Phase 58.1):
 *   The split patch is DTO-shaped: { config?: {renderMode, visible, opacity, ...}, track_config?, cb_config? }
 *   - "layer.config" fields → nested under config sub-object
 *   - "layer" fields → top-level (track_config, cb_config)
 */
export function applyWidgetAction(
  action: WidgetAction,
  lookups: ActionLookups,
  controlId: number
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

  // --- Step 3: Build the control's NEW contribution for this target ---

  const store = useWidgetActionStore.getState();
  const existingContrib = store.contributions[controlId] ?? {
    widget: {},
    layer: {},
    dynamicView: {},
  };

  let newTargetPatch: Record<string, unknown>;

  if (target.kind === "layer") {
    // Phase 58.1: split the validated configPatch by allow-list location metadata.
    // The allow-list is the SINGLE SOURCE OF TRUTH — no hardcoded field names here.
    // - "layer.config" fields → split.config (nested)
    // - "layer" fields        → split.topLevel (top-level: track_config, cb_config)
    const split = splitLayerPatch(configPatch);
    // Build DTO-shaped patch to record: top-level fields stay top-level; config nested.
    newTargetPatch = {
      ...split.topLevel,
      ...(split.config && Object.keys(split.config).length > 0 ? { config: split.config } : {}),
    };
  } else {
    // widget / dynamicView: store configPatch directly
    newTargetPatch = configPatch;
  }

  // --- Step 4: Idempotency — compare against existing per-control contribution for this target ---

  const existingTargetPatch =
    target.kind === "widget"
      ? existingContrib.widget[target.id]
      : target.kind === "layer"
        ? existingContrib.layer[target.id]
        : existingContrib.dynamicView[target.id];

  if (
    existingTargetPatch !== undefined &&
    fingerprint(newTargetPatch) === fingerprint(existingTargetPatch)
  ) {
    return { status: "applied", target };
  }

  // --- Step 5: Write via setControlContribution (switch-replace for this target) ---

  // Build the next contribution for this control: preserve other targets/kinds,
  // REPLACE only the entry for this target.id within this kind.
  const nextContrib = {
    widget: { ...existingContrib.widget },
    layer: { ...existingContrib.layer },
    dynamicView: { ...existingContrib.dynamicView },
  };

  if (target.kind === "widget") {
    nextContrib.widget = { ...existingContrib.widget, [target.id]: newTargetPatch };
  } else if (target.kind === "layer") {
    nextContrib.layer = { ...existingContrib.layer, [target.id]: newTargetPatch };
  } else {
    nextContrib.dynamicView = { ...existingContrib.dynamicView, [target.id]: newTargetPatch };
  }

  store.setControlContribution(controlId, nextContrib);

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
