/**
 * Phase 59 Plan 01 — Radio-group widget config data model + save-time validation helpers.
 * Phase 60.1 Plan 02 — Layer targets now validate via validateLayerSnapshot (denylist) instead
 * of validateActionPatch (strict allow-list). Widget + dynamic-view targets keep validateActionPatch.
 * Phase 60.2 Plan 01 — RadioOption.action → actions: WidgetAction[] (ordered, multi-target).
 *   Back-compat normalizer getOptionActions reads either actions[] OR legacy single action.
 *   validateRadioOption validates EVERY action (layer → denylist, widget/dv → allow-list).
 *
 * Pure module — NO React, NO Zustand, NO filter-store imports.
 * Mirrors the lib/actionAllowList.ts helper-module style.
 *
 * Key types:
 *   RadioOrientation  — "vertical" | "horizontal"
 *   RadioOption       — { id, label, actions: WidgetAction[] }
 *                       each option carries an ordered list of independent WidgetAction envelopes
 *                       (different actions may target different widgets/layers/dynamic-views)
 *   RadioGroupConfig  — { title?, orientation, defaultOptionId?, options: RadioOption[] }
 *
 * Helpers:
 *   getOptionActions             — normalize new actions[] or legacy action to an ordered array
 *   RADIO_GROUP_DEFAULT_CONFIG   — default shape used when creating a new radio-group widget
 *   validateRadioOption          — validates EVERY action: layer → denylist (validateLayerSnapshot);
 *                                  widget/dv → strict allow-list (validateActionPatch)
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
 *
 * Phase 60.2 multi-target shape: `actions` carries an ordered array of independent
 * WidgetAction envelopes. Select the option → apply ALL actions as ONE combined contribution.
 * Targets may mix widget / map-layer / dynamic-view kinds freely.
 *
 * Back-compat (pre-60.2 DB blobs): `action` (singular) is kept for legacy options that
 * carry a single action. The normalizer `getOptionActions(option)` reads either shape.
 * New options written by the panel (plan 60.2-02+) will use only `actions[]`.
 * NO DB migration — every reader normalizes via getOptionActions.
 *
 * IMPORTANT: Never access `action` or `actions` directly on an option — always use
 * `getOptionActions(option)`. Both fields are optional because:
 *   - pre-60.2 options have `action` but not `actions`
 *   - post-60.2 options have `actions` but not `action`
 *   - plan 60.2-02 will update RadioGroupConfigPanel to author `actions[]`
 */
export type RadioOption = {
  id: string;
  label: string;
  /**
   * Ordered, independent WidgetAction envelopes; targets may mix widget/layer/dynamicView.
   * Phase 60.2+ shape. Use getOptionActions() to read — handles both shapes.
   */
  actions?: WidgetAction[];
  /**
   * @deprecated Legacy single-action shape (pre-60.2 DB blobs). Read via getOptionActions.
   * New options write only `actions[]`. Plan 60.2-02 will update the config panel to
   * author `actions[]` directly and remove direct `action` access.
   */
  action?: WidgetAction;
};

/**
 * The persisted config shape for a radiogroup widget.
 * Stored in the widget's config JSON blob.
 *
 * - title: optional display title above the group
 * - orientation: "vertical" (default) | "horizontal"
 * - defaultOptionId: optional; Phase 60 applies this option transiently on dashboard open
 * - options: ordered array of RadioOptions; each carries independent WidgetAction envelopes
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
// getOptionActions — back-compat normalizer (Phase 60.2)
// ---------------------------------------------------------------------------

/**
 * Normalize a RadioOption's action(s) to an ordered array.
 * New options carry `actions: WidgetAction[]`. Legacy persisted options carry a single
 * `action` (pre-60.2). `actions` wins when present (even if empty). NO DB migration —
 * every reader (renderer dispatch, validation) normalizes here.
 */
export function getOptionActions(option: Pick<RadioOption, "actions" | "action">): WidgetAction[] {
  return option.actions ?? (option.action ? [option.action] : []);
}

// ---------------------------------------------------------------------------
// validateRadioOption
// ---------------------------------------------------------------------------

/**
 * Validates a RadioOption's actions against the Phase 58 allow-list.
 *
 * Rules:
 *   1. getOptionActions(option) must not be empty — no targets means no intent.
 *   2. Each action's configPatch must not be empty — an empty binding carries no intent.
 *   3. All keys in each action's configPatch must pass the appropriate validator:
 *      - Layer targets  → validateLayerSnapshot (denylist: accept render/style/info; reject data-binding/spatial/meta)
 *      - Widget targets → validateActionPatch (strict allow-list by widget type)
 *      - DV targets     → validateActionPatch (strict allow-list)
 *
 * @param option          The RadioOption to validate.
 * @param widgetTypeFor   Maps a widget target id → widget type (e.g. "map", "records").
 *                        Required when any action targets a widget. Pass undefined for layer/dv
 *                        targets — validateRadioOption handles those without a widget type.
 *
 *                        Two accepted shapes (back-compat for panel callers transitioning to 60.2):
 *                          - `(id: number) => string | undefined`  — new per-action resolver (Phase 60.2)
 *                          - `string`                              — legacy single-widget-type caller (pre-60.2 panel)
 *                            When a string is passed, it is used as the widget type for ALL widget-kind actions.
 */
export function validateRadioOption(
  option: RadioOption,
  widgetTypeFor?: ((id: number) => string | undefined) | string,
): { valid: true } | { valid: false; reasons: string[] } {
  // Normalize the second param: a string becomes a constant resolver; undefined stays undefined.
  const resolveWidgetType: ((id: number) => string | undefined) | undefined =
    typeof widgetTypeFor === "string"
      ? () => widgetTypeFor as string
      : widgetTypeFor;
  const actions = getOptionActions(option);
  const reasons: string[] = [];

  if (actions.length === 0) {
    reasons.push("no targets — add at least one target");
  }

  for (const action of actions) {
    if (Object.keys(action.configPatch).length === 0) {
      reasons.push("empty configPatch — capture or author at least one field");
      continue;
    }
    const result =
      action.target.kind === "layer"
        ? validateLayerSnapshot(action.configPatch)
        : validateActionPatch(
            action.target.kind,
            action.target.kind === "widget" ? resolveWidgetType?.(action.target.id) : undefined,
            action.configPatch,
          );
    if (!result.valid) reasons.push(...result.reasons);
  }

  return reasons.length > 0 ? { valid: false, reasons } : { valid: true };
}

// ---------------------------------------------------------------------------
// isRadioGroupConfigValid
// ---------------------------------------------------------------------------

/**
 * Returns true only when:
 *   1. options.length > 0 (at least one option must exist)
 *   2. Every option has a non-empty label (after trimming)
 *   3. Every option passes validateRadioOption with the correct widgetTypeFor resolver
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
    if (!validateRadioOption(option, widgetTypeFor).valid) return false;
  }

  return true;
}
