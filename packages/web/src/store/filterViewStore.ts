/**
 * Phase 14 (VSTORE-V13-01 / VSTORE-V13-02): per-tableId view-name store.
 *
 * Two-store split (locked at .planning/PROJECT.md § "Current Milestone: v1.3"):
 *   - useFilterStore (UNCHANGED v1.2 slice) — chip state, filterVersion, 10-cap, drill-down dispatch.
 *   - useFilterViewStore (THIS FILE) — server-resolved view names + expiresAt + materializing flag
 *     + materializeVersion per tableId. Phase 15 wires the trigger; Phase 14 ships dormant plumbing.
 *
 * The store is automatically covered by the Zustand reset shim (__mocks__/zustand.ts
 * activated via vi.mock("zustand") in src/test/setup.ts) because it lives under src/store/*.ts.
 *
 * Reference-stable per-tableId updates (mirrors useDashboardLayersStore.updateLayer at
 * dashboardLayersStore.ts:36-46): mutating views[tableId=X] returns a new top-level views object
 * but the entries for OTHER tableIds keep their object identity. Selector-driven widgets must
 * scope to views[tableId] (PITFALL C-02 / S-02 carry-forward).
 *
 * Pitfall locks documented inline:
 *   - V13-P-01: setView is the POST-200 ONLY path. No optimistic update; pre-call action is markMaterializing.
 *   - V13-P-09: deterministic view name accepts multi-tab last-write-wins (out of v1.3 scope).
 *   - V13-P-10: helper signature accepts AbortSignal so caller (Phase 15) can wire a dedicated
 *     materializeAbortRef separate from the chart-query AbortController.
 *   - Phase 15-02 schema extension: dashboardId field on FilterViewEntry — populated by
 *     setView/markMaterializing callers from useDashboardContext().dashboardId. Enables
 *     15-05 logout / dashboard-switch cleanup loops to fire-and-forget DROPs without
 *     external lookups (Pitfall 5 resolution per 15-RESEARCH.md).
 */

import { create } from "zustand";

export type FilterViewEntry = {
  viewName: string;
  expiresAt: number;          // epoch ms; client compares against Date.now() in Phase 15 LIFE-V13-01
  materializing: boolean;     // true between markMaterializing() and setView()/clearView()
  materializeVersion: number; // increments per CREATE OR REPLACE; Phase 16 _mv cache-buster source
  dashboardId: number;        // Phase 15-02: cleanup loops in 15-05 read entry.dashboardId on logout / dashboard-switch
};

export type FilterViewState = {
  views: Record<number, FilterViewEntry>; // keyed by tableId
  // Phase 17-02: increments each time clearMaterializing makes a non-no-op change. Used as a
  // dep in Effect 2 to trigger re-fire specifically on materialize-error clearance, without
  // triggering re-fire on markMaterializing (gate up) or setView (viewName dep handles that).
  clearMaterializingVersion: number;
  setView: (tableId: number, view: { viewName: string; expiresAt: number }, dashboardId: number) => void;
  clearView: (tableId: number) => void;
  markMaterializing: (tableId: number, dashboardId: number) => void;
  clearMaterializing: (tableId: number) => void;
  bumpMaterializeVersion: (tableId: number) => void;
  reset: () => void;
};

export const useFilterViewStore = create<FilterViewState>((set) => ({
  views: {},
  clearMaterializingVersion: 0,

  // V13-P-01 lock: setView is the POST-200 ONLY action. Phase 15 caller pattern is:
  //   markMaterializing(tableId, dashboardId) → await materializeFilter(...) → setView(tableId, response, dashboardId)
  // Never write a viewName before the server confirms — the view doesn't exist yet.
  setView: (tableId, { viewName, expiresAt }, dashboardId) =>
    set((state) => {
      const prev = state.views[tableId];
      const sameName = prev?.viewName === viewName;
      const nextEntry: FilterViewEntry = {
        viewName,
        expiresAt,
        materializing: false,
        materializeVersion: sameName ? prev!.materializeVersion + 1 : 1,
        dashboardId, // Phase 15-02: caller passes from useDashboardContext().dashboardId
      };
      // Reference-stable: only views[tableId] entry is new; entries for other tableIds
      // retain their object identity (selector-driven scope per C-02 lock).
      return { views: { ...state.views, [tableId]: nextEntry } };
    }),

  clearView: (tableId) =>
    set((state) => {
      if (!(tableId in state.views)) return state; // no-op (delete-key semantics, mirrors filterStore.clearFilters)
      const next = { ...state.views };
      delete next[tableId];
      return { views: next };
    }),

  // markMaterializing is the pre-call action. Creates a placeholder entry if missing
  // (so the chart-renderer's "filtering..." badge selector reads materializing: true);
  // preserves prior viewName/expiresAt/materializeVersion if entry exists (so the chart
  // can keep showing previously-filtered data while a refresh is in flight).
  // dashboardId is OVERWRITTEN with caller's value (caller asserts current dashboard at this moment;
  // multi-tab race is V13-P-09 last-write-wins — accepted).
  markMaterializing: (tableId, dashboardId) =>
    set((state) => {
      const prev = state.views[tableId];
      const nextEntry: FilterViewEntry = prev
        ? { ...prev, materializing: true, dashboardId }
        : { viewName: "", expiresAt: 0, materializing: true, materializeVersion: 0, dashboardId };
      return { views: { ...state.views, [tableId]: nextEntry } };
    }),

  // Phase 17-02 gap-closure: clearMaterializing lifts the Effect 2 / Effect 3 suspend gate on
  // materialize error WITHOUT dropping the entry (unlike clearView). Preserves any prior valid
  // viewName/expiresAt/materializeVersion so the next filterVersion cycle can reuse the cached
  // view if still valid. Also increments clearMaterializingVersion (used as Effect 2 dep) so
  // Effect 2 re-fires specifically on error clearance — without re-firing on markMaterializing
  // (gate-up transition) or setView (viewName dep handles that). Reference: 17-02-PLAN.md Task 1.
  clearMaterializing: (tableId) =>
    set((state) => {
      const prev = state.views[tableId];
      if (!prev) return state; // no-op — entry absent, nothing to clear
      if (!prev.materializing) return state; // no-op — already false, avoid allocating
      return {
        views: { ...state.views, [tableId]: { ...prev, materializing: false } },
        clearMaterializingVersion: state.clearMaterializingVersion + 1,
      };
    }),

  // bumpMaterializeVersion: Phase 14 ships the action; Phase 15/16 wire callers
  // (reactive recovery + WMS cache-bust paths). No-op when entry missing.
  bumpMaterializeVersion: (tableId) =>
    set((state) => {
      const prev = state.views[tableId];
      if (!prev) return state;
      const nextEntry: FilterViewEntry = { ...prev, materializeVersion: prev.materializeVersion + 1 };
      return { views: { ...state.views, [tableId]: nextEntry } };
    }),

  // Internal-only — Phase 15 LIFE-V13-03 / LIFE-V13-04 will wire reset() into App.tsx and
  // DashboardsPage.tsx alongside the existing useFilterStore.reset() calls. Phase 14 ships
  // the action; no Phase 14 wiring (CONTEXT.md § "Reset wiring scope" lock).
  reset: () => set({ views: {}, clearMaterializingVersion: 0 }),
}));
