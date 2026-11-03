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
 *   - widget/dynamicView: shallow-merge contributions across controls in RECENCY
 *     order (least-recent control first; most-recent writer per field wins).
 *     Recency comes from `order` / `contributionSeq`, NOT object-key order:
 *     integer object keys iterate ascending regardless of insertion, so
 *     insertion order cannot express "most recent" (D-11, Phase 134).
 *     controlId 0 is reserved for the AI session source (AI_SOURCE_ID, Plan 134-03).
 *   - layer: deep-merge the DTO shape — config sub-objects merge
 *     { ...accConfig, ...patchConfig }; top-level fields (track_config, cb_config)
 *     shallow-merge. Mirrors MapChartRenderer.effectiveLayers expectations.
 */

import { create } from "zustand";

/** Monotonic write counter for recency ordering. Never reset (reuse-safe). */
let contributionSeq = 0;

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

  /** Per-control recency (controlId -> sequence). NOT read by consumers. */
  order: Record<number, number>;

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
   * Phase 61 GAP-61-02 — release a single layer.config field from EVERY control's
   * contribution, then recompute the derived overlays.
   *
   * Why: a radio option may pin a layer.config field (e.g. `visible` / `opacity`)
   * that ALSO has a dedicated live control (the legend eye toggle writes
   * config.visible to the persisted dashboardLayersStore). Once an overlay pins
   * that field, effectiveLayers merges the overlay ON TOP of the persisted store,
   * masking the user's live toggle. When the user explicitly toggles such a field,
   * the live action must WIN — so we strip that field from the overlay ("release"
   * the radio's hold), letting the persisted store value take over. Re-selecting a
   * radio option re-applies its full patch (re-pinning the field) — most-recent
   * explicit action wins.
   *
   * No-op if no contribution sets that layer/field.
   * Caveat: it strips the field from the AI source too; the next AI rebuild
   * re-pins it (most recent explicit action wins).
   */
  releaseLayerConfigField: (layerId: number, field: string) => void;

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
 * Traversal order: controls sorted by `order` (recency, D-11 Phase 134); falls
 * back to Number(controlId) when a control has no order entry.
 * Most-recent-writer-per-field wins for cross-control field conflicts.
 *
 * widget / dynamicView: shallow-merge { ...acc[targetId], ...patch }
 * layer: deep-merge — config sub-object merges { ...accCfg, ...patchCfg };
 *        top-level fields (track_config, cb_config) shallow-merge.
 */
function deriveOverlays(
  contributions: Record<number, ControlContribution>,
  order: Record<number, number>,
): {
  widgetOverrides: Record<number, Record<string, unknown>>;
  layerOverrides: Record<number, Record<string, unknown>>;
  dynamicViewOverrides: Record<number, Record<string, unknown>>;
} {
  const widgetOverrides: Record<number, Record<string, unknown>> = {};
  const layerOverrides: Record<number, Record<string, unknown>> = {};
  const dynamicViewOverrides: Record<number, Record<string, unknown>> = {};

  const controlIds = Object.keys(contributions).sort(
    (a, b) => (order[Number(a)] ?? Number(a)) - (order[Number(b)] ?? Number(b)),
  );
  for (const controlId of controlIds) {
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
  order: {},
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
      const nextOrder = { ...state.order, [controlId]: ++contributionSeq };
      return {
        contributions: nextContributions,
        order: nextOrder,
        ...deriveOverlays(nextContributions, nextOrder),
      };
    }),

  clearControl: (controlId) =>
    set((state) => {
      if (!(controlId in state.contributions)) return state;
      const nextContributions = { ...state.contributions };
      delete nextContributions[controlId];
      const nextOrder = { ...state.order };
      delete nextOrder[controlId];
      return {
        contributions: nextContributions,
        order: nextOrder,
        ...deriveOverlays(nextContributions, nextOrder),
      };
    }),

  releaseLayerConfigField: (layerId, field) =>
    set((state) => {
      let changed = false;
      const nextContributions: Record<number, ControlContribution> = {};
      for (const controlIdStr of Object.keys(state.contributions)) {
        const controlId = Number(controlIdStr);
        const contrib = state.contributions[controlId];
        const layerPatch = contrib.layer[layerId] as
          | { config?: Record<string, unknown>; [key: string]: unknown }
          | undefined;
        const cfg = layerPatch?.config;
        if (cfg && field in cfg) {
          changed = true;
          const nextCfg = { ...cfg };
          delete nextCfg[field];
          const { config: _drop, ...topLevel } = layerPatch;
          const nextLayerPatch: Record<string, unknown> = { ...topLevel };
          if (Object.keys(nextCfg).length > 0) nextLayerPatch.config = nextCfg;
          nextContributions[controlId] = {
            ...contrib,
            layer: { ...contrib.layer, [layerId]: nextLayerPatch },
          };
        } else {
          nextContributions[controlId] = contrib;
        }
      }
      if (!changed) return state;
      return {
        contributions: nextContributions,
        ...deriveOverlays(nextContributions, state.order),
      };
    }),

  reset: () =>
    set({
      contributions: {},
      order: {},
      widgetOverrides: {},
      layerOverrides: {},
      dynamicViewOverrides: {},
    }),
}));
