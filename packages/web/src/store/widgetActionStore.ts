/**
 * Phase 58 Plan 02 — Session overlay store for the widget action engine.
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
 */

import { create } from "zustand";

// ---------------------------------------------------------------------------
// State + actions
// ---------------------------------------------------------------------------

type WidgetActionStoreState = {
  /**
   * Per-widget config overlays: { [widgetId]: configPatch }.
   * Shallow-merged with widget.config at render time (WidgetRenderer.tsx).
   * Depth-1 merge only — consistent with the allow-list granularity.
   */
  widgetOverrides: Record<number, Record<string, unknown>>;

  /**
   * Per-layer overlays: { [layerId]: Record<string, unknown> }.
   * Phase 58.1: overlays are DTO-shaped — applyWidgetAction splits by allow-list location:
   *   - { config?: { renderMode?, visible?, opacity? } } for nested layer.config fields
   *   - { track_config?, cb_config? } for TOP-LEVEL DashboardLayerDto fields
   * MapChartRenderer.effectiveLayers deep-merges: { ...l, ...topLevel, config: { ...l.config, ...cfgPatch } }
   * See [[track-config-toplevel-field]] memory and 58.1-CONTEXT.md.
   */
  layerOverrides: Record<number, Record<string, unknown>>;

  /**
   * Per-dynamic-view overlays: { [dvId]: configPatch }.
   * Lightweight — exercised once in unit tests; no render-path wiring this phase.
   */
  dynamicViewOverrides: Record<number, Record<string, unknown>>;

  // --- Actions ---

  /**
   * Merge `patch` into the existing widget override for `id`.
   * Reference-stable: only the target entry is recreated.
   */
  applyWidgetOverride: (id: number, patch: Record<string, unknown>) => void;

  /**
   * Merge `patch` (DTO-shaped layer overlay) into the existing layer override for `id`.
   * Depth-1 merge: { config? } sub-object is replaced wholesale — applyWidgetAction
   * deep-merges config before calling this to preserve prior nested config keys.
   */
  applyLayerOverride: (id: number, patch: Record<string, unknown>) => void;

  /**
   * Merge `patch` into the existing dynamic-view override for `id`.
   */
  applyDynamicViewOverride: (id: number, patch: Record<string, unknown>) => void;

  /**
   * Remove a single override entry by kind + id. No-op if the entry doesn't exist.
   */
  clearOverride: (kind: "widget" | "layer" | "dynamicView", id: number) => void;

  /**
   * Reset all three override maps to {}.
   * MUST be called as the 7th store reset in the DashboardOpen cleanup effect.
   */
  reset: () => void;
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useWidgetActionStore = create<WidgetActionStoreState>((set) => ({
  widgetOverrides: {},
  layerOverrides: {},
  dynamicViewOverrides: {},

  applyWidgetOverride: (id, patch) =>
    set((state) => ({
      widgetOverrides: {
        ...state.widgetOverrides,
        [id]: { ...(state.widgetOverrides[id] ?? {}), ...patch },
      },
    })),

  applyLayerOverride: (id, patch) =>
    set((state) => ({
      layerOverrides: {
        ...state.layerOverrides,
        [id]: { ...(state.layerOverrides[id] ?? {}), ...patch },
      },
    })),

  applyDynamicViewOverride: (id, patch) =>
    set((state) => ({
      dynamicViewOverrides: {
        ...state.dynamicViewOverrides,
        [id]: { ...(state.dynamicViewOverrides[id] ?? {}), ...patch },
      },
    })),

  clearOverride: (kind, id) =>
    set((state) => {
      if (kind === "widget") {
        const next = { ...state.widgetOverrides };
        delete next[id];
        return { widgetOverrides: next };
      } else if (kind === "layer") {
        const next = { ...state.layerOverrides };
        delete next[id];
        return { layerOverrides: next };
      } else {
        const next = { ...state.dynamicViewOverrides };
        delete next[id];
        return { dynamicViewOverrides: next };
      }
    }),

  reset: () =>
    set({ widgetOverrides: {}, layerOverrides: {}, dynamicViewOverrides: {} }),
}));
