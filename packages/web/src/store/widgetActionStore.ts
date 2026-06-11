/**
 * Phase 58 Plan 02 — Session overlay store for the widget action engine.
 * Phase 60 Plan 01 — Refactored to SOURCE-CONTROL-keyed contributions with
 * derived per-target overlay maps (switch-replace semantics: RADIO-V111-03).
 *
 * SESSION-SCOPED, TRANSIENT-FOR-EVERYONE: this store holds runtime config
 * overlays applied by control widgets (e.g. radio groups). It NEVER persists
 * to the server — it is always cleared on dashboard-switch / logout.
 *
 * Lifecycle position: 7TH store in the DashboardOpen cleanup chain.
 *   filterViewStore → filterStore → infoSelectionStore → lastInfoClickContextStore
 *   → spatialFilterStore → dynamicViewStore → widgetActionStore (this)
 *
 * // INVARIANT: ACTION-ENGINE-NO-FILTER
 * This module NEVER imports filter-store symbols (materializeFilter /
 * dropFilterView / addFilter / setBulkFilters / filterVersion). Engine
 * decoupling from the filter/materialize system is enforced by the static
 * source-grep assertion in Phase 58 Plan 02 actionEngineDecoupling.spec.ts.
 *
 * Internal model (Phase 60.01 refactor):
 *   contributions: Record<controlId, { widget, layer, dynamicView }>
 *   Each control's contribution is REPLACED wholesale on re-select (switch-replace).
 *   The three derived overlay maps are recomputed on every contribution write.
 *
 * Consumer-facing read shape is UNCHANGED from Phase 58:
 *   widgetOverrides[targetId]     → Record<string, unknown>  (WidgetRenderer)
 *   layerOverrides[targetId]      → Record<string, unknown>  (MapChartRenderer)
 *   dynamicViewOverrides[targetId]→ Record<string, unknown>
 *
 * Derive logic:
 *   - widget/dynamicView: shallow-merge contributions across controls
 *     (Object.keys insertion order = control order; last writer per field wins).
 *   - layer: deep-merge the DTO shape — config sub-objects merge
 *     { ...accConfig, ...patchConfig }; top-level fields (track_config, cb_config)
 *     shallow-merge. Mirrors MapChartRenderer.effectiveLayers expectations.
 */

import { create } from "zustand";

// ---------------------------------------------------------------------------
// Internal contribution shape
// ---------------------------------------------------------------------------

/** Per-control contribution for one target kind. */
type KindContributions = Record<number, Record<string, unknown>>;

/** A single control's full contribution across all target kinds + target ids. */
type ControlContribution = {
  widget: KindContributions;
  layer: KindContributions;
  dynamicView: KindContributions;
};

// ---------------------------------------------------------------------------
// State + actions
// ---------------------------------------------------------------------------

type WidgetActionStoreState = {
  /**
   * SOURCE-CONTROL-keyed contributions: { [controlId]: { widget, layer, dynamicView } }.
   * Each control's entry is REPLACED wholesale by setControlContribution (switch-replace).
   * Not read by consumers — they use the derived overlay maps below.
   */
  contributions: Record<number, ControlContribution>;

  /**
   * DERIVED — Per-widget config overlays: { [widgetId]: configPatch }.
   * Shallow-merged with widget.config at render time (WidgetRenderer.tsx).
   * Recomputed whenever contributions change.
   */
  widgetOverrides: Record<number, Record<string, unknown>>;

  /**
   * DERIVED — Per-layer overlays: { [layerId]: Record<string, unknown> }.
   * DTO-shaped: { config?: { renderMode?, visible?, opacity? }, track_config?, cb_config? }
   * MapChartRenderer.effectiveLayers deep-merges: { ...l, ...topLevel, config: { ...l.config, ...cfgPatch } }
   * Recomputed whenever contributions change.
   * See [[track-config-toplevel-field]] memory and 58.1-CONTEXT.md.
   */
  layerOverrides: Record<number, Record<string, unknown>>;

  /**
   * DERIVED — Per-dynamic-view overlays: { [dvId]: configPatch }.
   * Recomputed whenever contributions change.
   */
  dynamicViewOverrides: Record<number, Record<string, unknown>>;

  // --- Actions ---

  /**
   * Record a control's CURRENT contribution, REPLACING any prior contribution
   * from the same controlId (switch-replace semantics: fields the new option
   * does not set revert to the target's saved baseline).
   *
   * Contribution shape:
   *   {
   *     widget?:      { [targetWidgetId]:  configPatch }
   *     layer?:       { [targetLayerId]:   dtoPatch }   // DTO-shaped: { config?, track_config?, cb_config? }
   *     dynamicView?: { [targetDvId]:      configPatch }
   *   }
   * Missing kinds default to {}.
   */
  setControlContribution: (
    controlId: number,
    contribution: Partial<ControlContribution>
  ) => void;

  /**
   * Remove a control's contribution entirely.
   * Recomputes the derived overlay maps.
   * No-op if the control has no prior contribution.
   */
  clearControl: (controlId: number) => void;

  /**
   * Reset all contributions AND derived maps to {}.
   * MUST be called as the 7th store reset in the DashboardOpen cleanup effect.
   */
  reset: () => void;
};

// ---------------------------------------------------------------------------
// Pure derive helper
// ---------------------------------------------------------------------------

/**
 * Fold all controls' contributions into the three derived per-target overlay maps.
 *
 * Traversal order: Object.keys(contributions) — insertion order (control order).
 * Last-writer-per-field wins for cross-control field conflicts.
 *
 * widget / dynamicView: shallow-merge { ...acc[targetId], ...patch }
 * layer: deep-merge — config sub-object merges { ...accCfg, ...patchCfg };
 *        top-level fields (track_config, cb_config) shallow-merge.
 */
function deriveOverlays(contributions: Record<number, ControlContribution>): {
  widgetOverrides: Record<number, Record<string, unknown>>;
  layerOverrides: Record<number, Record<string, unknown>>;
  dynamicViewOverrides: Record<number, Record<string, unknown>>;
} {
  const widgetOverrides: Record<number, Record<string, unknown>> = {};
  const layerOverrides: Record<number, Record<string, unknown>> = {};
  const dynamicViewOverrides: Record<number, Record<string, unknown>> = {};

  for (const controlId of Object.keys(contributions)) {
    const contrib = contributions[Number(controlId)];

    // Widget contributions — shallow-merge
    for (const targetIdStr of Object.keys(contrib.widget)) {
      const targetId = Number(targetIdStr);
      const patch = contrib.widget[targetId];
      widgetOverrides[targetId] = { ...(widgetOverrides[targetId] ?? {}), ...patch };
    }

    // Layer contributions — deep-merge the DTO shape
    for (const targetIdStr of Object.keys(contrib.layer)) {
      const targetId = Number(targetIdStr);
      const patch = contrib.layer[targetId];
      const existing = layerOverrides[targetId] ?? {};
      // Separate config sub-object from top-level fields
      const { config: patchConfig, ...patchTopLevel } = patch as {
        config?: Record<string, unknown>;
        [key: string]: unknown;
      };
      const { config: existingConfig, ...existingTopLevel } = existing as {
        config?: Record<string, unknown>;
        [key: string]: unknown;
      };
      const mergedConfig =
        patchConfig !== undefined
          ? { ...(existingConfig ?? {}), ...patchConfig }
          : existingConfig;
      const merged: Record<string, unknown> = {
        ...existingTopLevel,
        ...patchTopLevel,
      };
      if (mergedConfig !== undefined && Object.keys(mergedConfig).length > 0) {
        merged.config = mergedConfig;
      }
      layerOverrides[targetId] = merged;
    }

    // DynamicView contributions — shallow-merge
    for (const targetIdStr of Object.keys(contrib.dynamicView)) {
      const targetId = Number(targetIdStr);
      const patch = contrib.dynamicView[targetId];
      dynamicViewOverrides[targetId] = { ...(dynamicViewOverrides[targetId] ?? {}), ...patch };
    }
  }

  return { widgetOverrides, layerOverrides, dynamicViewOverrides };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useWidgetActionStore = create<WidgetActionStoreState>((set) => ({
  contributions: {},
  widgetOverrides: {},
  layerOverrides: {},
  dynamicViewOverrides: {},

  setControlContribution: (controlId, contribution) =>
    set((state) => {
      const normalized: ControlContribution = {
        widget: contribution.widget ?? {},
        layer: contribution.layer ?? {},
        dynamicView: contribution.dynamicView ?? {},
      };
      const nextContributions = {
        ...state.contributions,
        [controlId]: normalized,
      };
      return {
        contributions: nextContributions,
        ...deriveOverlays(nextContributions),
      };
    }),

  clearControl: (controlId) =>
    set((state) => {
      if (!(controlId in state.contributions)) return state;
      const nextContributions = { ...state.contributions };
      delete nextContributions[controlId];
      return {
        contributions: nextContributions,
        ...deriveOverlays(nextContributions),
      };
    }),

  reset: () =>
    set({
      contributions: {},
      widgetOverrides: {},
      layerOverrides: {},
      dynamicViewOverrides: {},
    }),
}));
