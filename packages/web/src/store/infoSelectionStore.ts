/**
 * Phase 20 (STORE-V14-01..05): per-layerId info-selection store.
 *
 * Three-store split (locked at .planning/STATE.md § "Key v1.4 Architecture Decisions"):
 *   - useFilterStore (UNCHANGED v1.2 slice) — chip state, filterVersion.
 *   - useFilterViewStore (UNCHANGED v1.3 slice) — server-resolved view names per tableId.
 *   - useInfoSelectionStore (THIS FILE) — current map info-popup selection per layerId.
 *
 * All three stores reset together at the same two lifecycle sites:
 *   - DashboardsPage.tsx DashboardOpen cleanup (lines 386-399).
 *   - App.tsx UNAUTHORIZED handler (lines 42-56).
 * Plan 20-02 wires this store at those sites; this file ships the store + actions only.
 *
 * The store is automatically covered by the Zustand reset shim (__mocks__/zustand.ts
 * activated via vi.mock("zustand") in src/test/setup.ts) because it lives under src/store/*.ts.
 *
 * Reference-stable per-layerId updates (mirrors useFilterViewStore.setView at filterViewStore.ts:59-73):
 * mutating state[layerId=A] returns a new top-level state object but entries for OTHER layerIds
 * keep their object identity. Phase 21/23 selector consumers must scope to s.state[layerId].
 *
 * activeLayerId invariant (locked in 20-CONTEXT.md § "activeLayerId invariant"):
 *   - Type signature is `number` not `number | null` — there is NO setActiveLayer(null) path.
 *   - The only paths to activeLayerId === null are: (a) initial state, (b) reset().
 *   - Phase 21 popup dismiss (POPUP-V14-05) calls reset(), not setActiveLayer(null).
 *
 * Layer-switch state retention (locked in 20-CONTEXT.md § "Layer-switch state retention"):
 *   - setActiveLayer(B) when current is A (A !== B) FULLY DELETES state[A] (rows, columns, page,
 *     hasMore, loading, error all gone). Returning to A re-fetches from scratch.
 *   - state[B] is NOT touched by setActiveLayer (Phase 21 click handler decides whether to
 *     overwrite via setSelection).
 *   - setActiveLayer(A) when current is A is a full no-op (no state change).
 *
 * setSelection loading-flag preservation (locked in 20-CONTEXT.md § "Action contract" line 28):
 *   - setSelection does NOT auto-clear `loading`. Caller toggles setLoading(true) before fetch
 *     and setLoading(false) after success/error. setSelection writes `loading: prev?.loading ?? false`
 *     so a setLoading(true) -> setSelection(payload) sequence preserves the loading flag for the
 *     caller to clear via setLoading(false). Phase 21 click handler is built against this contract.
 *   - setSelection DOES clear `error` to null (judgment call — not locked by CONTEXT.md): settled
 *     rows obsolete the prior error. Caller does not need to setError(null) before/after setSelection.
 *
 * Append-fail rows-preserved (locked in 20-CONTEXT.md § "specifics"):
 *   - setError leaves prior rows in place (mirrors filterViewStore.clearMaterializing preserves-fields
 *     pattern at filterViewStore.ts:104-113). Page 4 fail must NOT wipe pages 1-3 — hostile UX.
 */

import { create } from "zustand";

export type InfoSelectionEntry = {
  rows: Record<string, unknown>[];
  columns: string[];
  page: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  /**
   * Index into `rows` of the record currently displayed in the popup/card.
   * Shared across surfaces — popup and card stay in sync when both are mounted
   * (mirrors activeLayerId at the store level).
   *
   * Lifecycle:
   *   - setSelection (fresh click): index reset to 0
   *   - appendPage (Load more / Next-past-end): index preserved (caller advances explicitly)
   *   - setCurrentIndex: explicit update from Back/Next handlers
   */
  currentIndex: number;
};

export type InfoSelectionState = {
  state: Record<number, InfoSelectionEntry>; // keyed by layerId (number, matches DashboardLayerDto.id)
  activeLayerId: number | null;

  setSelection: (
    layerId: number,
    payload: { rows: Record<string, unknown>[]; columns: string[]; page: number; hasMore: boolean }
  ) => void;
  appendPage: (
    layerId: number,
    payload: { rows: Record<string, unknown>[]; page: number; hasMore: boolean }
  ) => void;
  clearSelection: (layerId: number) => void;
  setActiveLayer: (layerId: number) => void;
  setLoading: (layerId: number, loading: boolean) => void;
  setError: (layerId: number, error: string | null) => void;
  /** Single-record nav (Back/Next). No clamping — caller is responsible for bounds. */
  setCurrentIndex: (layerId: number, index: number) => void;
  reset: () => void;
};

const PLACEHOLDER: InfoSelectionEntry = {
  rows: [],
  columns: [],
  page: 0,
  hasMore: false,
  loading: false,
  error: null,
  currentIndex: 0,
};

export const useInfoSelectionStore = create<InfoSelectionState>((set) => ({
  state: {},
  activeLayerId: null,

  // REPLACE semantics — fresh-click path. Caller passes page explicitly; store does NOT auto-increment.
  // Does NOT auto-clear loading per CONTEXT.md § Action contract — preserves prev?.loading so the
  // caller's setLoading(true) -> setSelection(...) -> setLoading(false) sequence works as locked.
  // DOES clear error to null (settled rows obsolete the prior error — not locked, judgment call).
  setSelection: (layerId, { rows, columns, page, hasMore }) =>
    set((s) => {
      const prev = s.state[layerId];
      const nextEntry: InfoSelectionEntry = {
        rows,
        columns,
        page,
        hasMore,
        loading: prev?.loading ?? false,
        error: null,
        currentIndex: 0,  // fresh-click semantics — point cursor at first record
      };
      return { state: { ...s.state, [layerId]: nextEntry } };
    }),

  // APPEND semantics — Load-more path. No-op if entry absent (caller bug; store does not invent rows).
  // columns, loading, error UNCHANGED. page + hasMore taken from payload.
  appendPage: (layerId, { rows, page, hasMore }) =>
    set((s) => {
      const prev = s.state[layerId];
      if (!prev) return s; // no-op — appendPage requires a prior setSelection
      const nextEntry: InfoSelectionEntry = {
        ...prev,
        rows: [...prev.rows, ...rows],
        page,
        hasMore,
      };
      return { state: { ...s.state, [layerId]: nextEntry } };
    }),

  // DELETE-KEY semantics (mirrors useFilterViewStore.clearView at filterViewStore.ts:75-81).
  clearSelection: (layerId) =>
    set((s) => {
      if (!(layerId in s.state)) return s; // no-op
      const next = { ...s.state };
      delete next[layerId];
      return { state: next };
    }),

  // Pure focus-switch. Same-layer is a full no-op (mirrors filterStore exact-duplicate dedupe at
  // filterStore.ts:53-58). Different-layer fully deletes the prior layer's entry (rows, columns,
  // page, hasMore, loading, error all gone) AND sets activeLayerId — single set() call, atomic.
  // The new layer's entry is NOT touched (caller is responsible for setSelection if needed).
  setActiveLayer: (layerId) =>
    set((s) => {
      if (s.activeLayerId === layerId) return s; // no-op — same layer
      const nextStateMap = { ...s.state };
      if (s.activeLayerId !== null && s.activeLayerId in nextStateMap) {
        delete nextStateMap[s.activeLayerId];
      }
      return { state: nextStateMap, activeLayerId: layerId };
    }),

  // Per-layer flag flip. Caller toggles before/after fetch (both fresh-click and Load-more paths).
  // Creates placeholder when layerId absent (mirrors useFilterViewStore.markMaterializing at
  // filterViewStore.ts:89-96).
  setLoading: (layerId, loading) =>
    set((s) => {
      const prev = s.state[layerId];
      const nextEntry: InfoSelectionEntry = prev
        ? { ...prev, loading }
        : { ...PLACEHOLDER, loading };
      return { state: { ...s.state, [layerId]: nextEntry } };
    }),

  // Per-layer error flip. Append-fail path: prior rows are preserved (existing pages remain visible,
  // user can retry). Mirrors filterViewStore.clearMaterializing preserves-prior-fields pattern.
  setError: (layerId, error) =>
    set((s) => {
      const prev = s.state[layerId];
      const nextEntry: InfoSelectionEntry = prev
        ? { ...prev, error }
        : { ...PLACEHOLDER, error };
      return { state: { ...s.state, [layerId]: nextEntry } };
    }),

  // Single-record nav action — Back/Next handlers in InfoSelectionView call this directly.
  // No clamping or bounds-check here; the view enforces 0 <= index < rows.length and
  // triggers Load-more separately when index reaches rows.length.
  setCurrentIndex: (layerId, index) =>
    set((s) => {
      const prev = s.state[layerId];
      if (!prev) return s; // no-op — store should not invent entries from a nav-only action
      if (prev.currentIndex === index) return s; // no-op — same index
      return {
        state: { ...s.state, [layerId]: { ...prev, currentIndex: index } },
      };
    }),

  // Internal-only — Plan 20-02 wires reset() into App.tsx UNAUTHORIZED handler and DashboardsPage
  // DashboardOpen cleanup alongside the existing useFilterStore/useFilterViewStore reset() calls.
  reset: () => set({ state: {}, activeLayerId: null }),
}));
