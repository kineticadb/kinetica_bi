/**
 * Phase 59 Plan 01 — Radio-group widget config data model + save-time validation helpers.
 * Phase 60.1 Plan 02 — Layer targets now validate via validateLayerSnapshot (denylist) instead
 * of validateActionPatch (strict allow-list). Widget + dynamic-view targets keep validateActionPatch.
 *
 * Pure module — NO React, NO Zustand, NO filter-store imports.
 * Mirrors the lib/actionAllowList.ts helper-module style.
 *
 * Key types:
 *   RadioOrientation  — "vertical" | "horizontal"
 *   RadioOption       — { id, label, action: WidgetAction }
 *                       each option carries its OWN independent WidgetAction envelope
 *                       (different options may target different widgets/layers/dynamic-views)
 *   RadioGroupConfig  — { title?, orientation, defaultOptionId?, options: RadioOption[] }
 *
 * Helpers:
 *   RADIO_GROUP_DEFAULT_CONFIG   — default shape used when creating a new radio-group widget
 *   validateRadioOption          — for LAYER targets: denylist (validateLayerSnapshot); for widget/dv: strict allow-list (validateActionPatch)
 *   isRadioGroupConfigValid      — true only when all options are valid + non-empty labels
 *
 * IMPORTANT: renderMode (camelCase) is the ONLY render-mode key. The snake-case variant is not in the allow-list.
 * IMPORTANT: Layer-target options use the snapshot denylist (accept render/style/info; reject data-binding/spatial/meta).
 *            Widget/dv-target options use the strict allow-list — these paths are UNCHANGED.
 */
import type { WidgetAction } from "./widgetAction";
import { validateActionPatch, validateLayerSnapshot } from "./actionAllowList";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Layout orientation of the radio group widget. */
export type RadioOrientation = "vertical" | "horizontal";

/**
 * A single radio option.
 * `action` is a full, independent Phase 58 WidgetAction envelope — it may target any
 * same-dashboard widget / map layer / dynamic-view, and its configPatch may set multiple
 * allow-listed fields at once (e.g. renderMode + cb_config together).
 */
export type RadioOption = {
  id: string;
  label: string;
  action: WidgetAction;
};

/**
 * The persisted config shape for a radiogroup widget.
 * Stored in the widget's config JSON blob.
 *
 * - title: optional display title above the group
 * - orientation: "vertical" (default) | "horizontal"
 * - defaultOptionId: optional; Phase 60 applies this option transiently on dashboard open
 * - options: ordered array of RadioOptions; each carries an independent WidgetAction
 */
export type RadioGroupConfig = {
  title?: string;
  orientation: RadioOrientation;
  defaultOptionId?: string;
  options: RadioOption[];
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Default config used when a new radio-group widget is created.
 * No title, no defaultOptionId — both are optional and added by the operator.
 */
export const RADIO_GROUP_DEFAULT_CONFIG: RadioGroupConfig = {
  orientation: "vertical",
  options: [],
};

// ---------------------------------------------------------------------------
// validateRadioOption
// ---------------------------------------------------------------------------

/**
 * Validates a RadioOption's action.configPatch against the Phase 58 allow-list.
 *
 * Rules:
 *   1. configPatch must not be empty — an empty binding carries no intent and cannot be saved.
 *   2. All keys in configPatch must pass validateActionPatch(kind, widgetType, configPatch):
 *      - No permanently-blocked meta/proto keys (id, __proto__, etc.)
 *      - All keys must be in the allow-list for (kind, widgetType)
 *      - All values must satisfy the field's schema validator
 *
 * @param option     The RadioOption to validate.
 * @param widgetType The target widget's type (e.g. "map", "chart"). Required when
 *                   option.action.target.kind === "widget" — callers must supply this.
 *                   Pass undefined for layer / dynamicView targets.
 */
export function validateRadioOption(
  option: RadioOption,
  widgetType?: string,
): { valid: true } | { valid: false; reasons: string[] } {
  const reasons: string[] = [];

  // Rule 1: empty configPatch is not saveable
  if (Object.keys(option.action.configPatch).length === 0) {
    reasons.push("empty configPatch — capture or author at least one field");
  }

  // Rule 2: validate the configPatch.
  //   LAYER targets → denylist (validateLayerSnapshot): accept render/style/info; reject data-binding/spatial/meta.
  //     This is the Phase 60.1 RE-SCOPE: a full-config snapshot is the contract for designer-UI layer options.
  //   WIDGET + DYNAMICVIEW targets → strict allow-list (validateActionPatch): unchanged contract.
  const patchResult =
    option.action.target.kind === "layer"
      ? validateLayerSnapshot(option.action.configPatch)
      : validateActionPatch(option.action.target.kind, widgetType, option.action.configPatch);
  if (!patchResult.valid) {
    reasons.push(...patchResult.reasons);
  }

  if (reasons.length > 0) {
    return { valid: false, reasons };
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// isRadioGroupConfigValid
// ---------------------------------------------------------------------------

/**
 * Returns true only when:
 *   1. options.length > 0 (at least one option must exist)
 *   2. Every option has a non-empty label (after trimming)
 *   3. Every option passes validateRadioOption with the correct widgetType
 *
 * @param config          The RadioGroupConfig to validate.
 * @param widgetTypeFor   Maps a widget target id → widget type so the allow-list can
 *                        resolve per-widget-type fields. Returns undefined for non-widget
 *                        targets (layer / dynamicView); validateRadioOption handles those.
 */
export function isRadioGroupConfigValid(
  config: RadioGroupConfig,
  widgetTypeFor: (id: number) => string | undefined,
): boolean {
  if (config.options.length === 0) return false;

  for (const option of config.options) {
    if (option.label.trim() === "") return false;

    const widgetType =
      option.action.target.kind === "widget"
        ? widgetTypeFor(option.action.target.id)
        : undefined;

    const result = validateRadioOption(option, widgetType);
    if (!result.valid) return false;
  }

  return true;
}
