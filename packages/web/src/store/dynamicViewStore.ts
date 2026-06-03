/**
 * Phase 33 (DV-V16-06): per-dynamic_view_id materialization state.
 *
 * Session-only Zustand slice holding the dashboard's current dynamic-view materialization
 * state (one entry per dynamic_view_id, dashboard-scoped via the caller passing dynamic_view_id
 * keys produced by Phase 32 server endpoints). Ships dormant in Phase 33 — Phase 34 management
 * modal is first writer at create/edit/preview; Phase 35 renderer is first reader at FROM-swap.
 *
 * `dynamicViewVersion` mirrors the `filterVersion` / `spatialFilterVersion` pattern — it is the
 * dep-array signal Phase 35 AggregatedWidgetRenderer reads alongside `filterVersion` to trigger
 * cascading re-materialize. Increments on every successful mutation (rules below).
 *
 * Status union (locked by ROADMAP success criterion 1, extended this phase):
 *   "materialized" | "over_threshold" | "pending" | "error"
 *
 * No "stale" status — TTL-expired entries are derived client-side from `expiresAt + Date.now()`
 * by Phase 35 renderers, not stored.
 *
 * Entry shape (locked by 33-CONTEXT.md § "Store shape"):
 *   { viewName: string, status, expiresAt?, error?, reason? }
 *
 * viewName invariant: always populated (deterministic via buildDynamicViewName from markPending
 * forward). Never empty/null on pending/over_threshold/error entries (except the defensive
 * setError-on-absent fallback — see action body below).
 *
 * dynamicViewVersion semantics (locked by 33-CONTEXT.md § "dynamicViewVersion semantics"):
 *   - setView: always +1 (even byte-identical payload)
 *   - markPending: always +1 (even markPending-over-pending)
 *   - setError: always +1 (even setError-over-already-error)
 *   - clearView(existing): +1
 *   - clearView(non-existent): NO-OP (no version bump, state reference preserved)
 *   - reset(): hard-set to 0 — NOT an increment (mirrors spatialFilterStore.reset)
 *
 * LIFECYCLE — 6-store reset block extended by Plan 33-03 (DV-V16-07):
 *   Order: filterViewStore → filterStore → infoSelectionStore → lastInfoClickContextStore →
 *   spatialFilterStore → dynamicViewStore (6th). Wired at App.tsx UNAUTHORIZED + DashboardsPage.tsx
 *   DashboardOpen cleanup. DROP loop is callsite-resident (Plan 33-03 wiring) — NOT inside this store.
 *
 * Test infra: Zustand reset shim at __mocks__/zustand.ts auto-applies via
 * vi.mock("zustand") in src/test/setup.ts. File MUST live under src/store/ for shim coverage.
 *
 * Reference stability lock (PITFALL C-02 / S-02 carry-forward): `views: { ...state.views, [id]: nextEntry }`
 * produces a new top-level object but other keys keep object identity. Phase 35 selector consumers
 * scope to `s.views[id]`.
 */

import { create } from "zustand";

export type DynamicViewStatus = "materialized" | "over_threshold" | "pending" | "error";
export type DynamicViewReason = "no_filter" | "exceeds_max_records";

export type DynamicViewEntry = {
  viewName: string;
  status: DynamicViewStatus;
  expiresAt?: number;
  error?: string;
  reason?: DynamicViewReason;
};

export type DynamicViewState = {
  views: Record<number, DynamicViewEntry>;
  dynamicViewVersion: number;
  setView: (
    id: number,
    payload: {
      viewName: string;
      status: DynamicViewStatus;
      expiresAt?: number;
      error?: string;
      reason?: DynamicViewReason;
    },
  ) => void;
  markPending: (id: number, viewName: string) => void;
  setError: (id: number, error: string) => void;
  clearView: (id: number) => void;
  reset: () => void;
};

export const useDynamicViewStore = create<DynamicViewState>((set) => ({
  views: {},
  dynamicViewVersion: 0,

  // REPLACE semantics — caller passes full payload; store writes verbatim. ALWAYS bumps version
  // (even on byte-identical payload — mirrors filterViewStore.setView at filterViewStore.ts:59-73
  // and 33-CONTEXT.md § "dynamicViewVersion semantics" first bullet).
  // Only spread optional fields that are present in the payload — REPLACE means a payload
  // without expiresAt MUST produce an entry without expiresAt (not a merge with prior entry).
  setView: (id, payload) =>
    set((s) => {
      const nextEntry: DynamicViewEntry = {
        viewName: payload.viewName,
        status: payload.status,
        ...(payload.expiresAt !== undefined ? { expiresAt: payload.expiresAt } : {}),
        ...(payload.error !== undefined ? { error: payload.error } : {}),
        ...(payload.reason !== undefined ? { reason: payload.reason } : {}),
      };
      return {
        views: { ...s.views, [id]: nextEntry },
        dynamicViewVersion: s.dynamicViewVersion + 1,
      };
    }),

  // Placeholder write before materializeDynamicView call. If entry exists: overwrite status to
  // "pending", strip expiresAt/error/reason, KEEP existing viewName unchanged (locked 33-CONTEXT.md
  // § "Action contract" markPending bullet — preserves prior cached name for retry without re-fetch).
  // If entry absent: create placeholder { viewName: <caller-arg>, status: "pending" }.
  // ALWAYS bumps version (locked rule — overlapping triggers signal abort+retry; Phase 35 dedupes
  // via AbortController).
  markPending: (id, viewName) =>
    set((s) => {
      const prev = s.views[id];
      const nextEntry: DynamicViewEntry = prev
        ? { viewName: prev.viewName, status: "pending" }
        : { viewName, status: "pending" };
      return {
        views: { ...s.views, [id]: nextEntry },
        dynamicViewVersion: s.dynamicViewVersion + 1,
      };
    }),

  // Error transition. Preserves prior viewName (append-fail UX lock — Phase 35 can retry without
  // re-fetching the deterministic name). Sets status: "error", populates error, strips expiresAt
  // and reason. If entry absent: creates defensive placeholder { viewName: "", status: "error", error }.
  // ALWAYS bumps version (locked rule — even setError-over-already-error).
  setError: (id, error) =>
    set((s) => {
      const prev = s.views[id];
      const nextEntry: DynamicViewEntry = prev
        ? { viewName: prev.viewName, status: "error", error }
        : { viewName: "", status: "error", error };
      return {
        views: { ...s.views, [id]: nextEntry },
        dynamicViewVersion: s.dynamicViewVersion + 1,
      };
    }),

  // DELETE-KEY semantics. Removes the per-id entry on existing; STRICT NO-OP on non-existent
  // (state reference preserved — mirrors filterViewStore.clearView at filterViewStore.ts:75-81
  // and spatialFilterStore.removeShape no-op rule). Bumps version only on successful removal.
  clearView: (id) =>
    set((s) => {
      if (!(id in s.views)) return s; // strict no-op — preserve state reference
      const next = { ...s.views };
      delete next[id];
      return {
        views: next,
        dynamicViewVersion: s.dynamicViewVersion + 1,
      };
    }),

  // Internal-only — Plan 33-03 wires reset() into the canonical 6-store reset block at App.tsx
  // UNAUTHORIZED and DashboardsPage.tsx DashboardOpen cleanup. Hard-set to initial state; NOT an
  // increment (mirrors spatialFilterStore.reset at spatialFilterStore.ts:126-127).
  reset: () => set({ views: {}, dynamicViewVersion: 0 }),
}));
