/**
 * Phase 58 Plan 02 — applyWidgetAction: single dispatch entry for the widget
 * action engine.
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
import type { WidgetAction, WidgetActionResult, WidgetActionTarget } from "./widgetAction";
import { validateActionPatch } from "./actionAllowList";
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
    const currentOverlay = store.layerOverrides[target.id] ?? {};
    const proposed = { ...layer, ...currentOverlay, ...configPatch };
    const current = { ...layer, ...currentOverlay };
    if (fingerprint(proposed) === fingerprint(current)) {
      return { status: "applied", target };
    }
    store.applyLayerOverride(target.id, configPatch as Partial<DashboardLayerDto>);
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
