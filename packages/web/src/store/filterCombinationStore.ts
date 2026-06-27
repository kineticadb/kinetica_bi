/**
 * Phase 89 Plan 01 (COMBO-V118-02 / COMBO-V118-03): per-combination view-name registry.
 *
 * This is the 9th store, parallel to filterViewStore. It is keyed by stableComboHash output
 * (encodes sourceType + sourceId + resolved filter array) rather than by tableId. Multiple
 * visualizations sharing the same resolved filter set share one registry entry — deduplication
 * by content hash, enforced through ref-counting.
 *
 * PITFALL S-02 lock: all component subscriptions MUST project to primitive strings.
 *   - Scope to s.vizToHash[vizKey] (one viz's hash) or s.combinationVersion (integer).
 *   - NEVER subscribe to the whole `registry` object — every mutation would re-render all
 *     subscribers (same anti-pattern as PITFALL C-02 / filterStore "never subscribe to
 *     s.filters whole").
 *
 * NOFILTER invariant: hashes that end with the NOFILTER_SENTINEL (":NOFILTER") are NEVER
 * stored in registry. Callers (Phase 90) check `hash.endsWith(NOFILTER_SENTINEL)` before
 * calling setEntry / markMaterializing — the store does not enforce this, but documents it
 * here as an invariant.
 *
 * Ref-count lifecycle:
 *   acquire(hash) → refCount += 1
 *   release(hash) → refCount -= 1; when refCount reaches 0, the entry is DELETED from
 *     registry (DROP-at-0). The network DROP is the CALLER's responsibility; the store
 *     only removes the entry. release on a missing or already-deleted entry is a safe no-op.
 *
 * Cleanup wiring: reset() is called at BOTH cleanup sites (App.tsx logout AND
 * DashboardsPage.tsx dashboard-switch), each preceded by a snapshot-then-DROP loop that
 * fires dropCombinationView for every live entry (mirrors the filterViewStore DROP loop).
 */

import { create } from "zustand";

// Phase 90 will enforce the ceiling. Phase 89 defines the VALUE only.
export const MAX_COMBINATION_VIEWS_PER_TABLE = 10;

export type CombinationEntry = {
  viewName: string;           // Kinetica view name; empty string while materializing
  expiresAt: number;          // epoch ms; 0 when unknown
  materializing: boolean;
  materializeVersion: number; // cache-buster for WMS _mv param; increments per CREATE OR REPLACE
  refCount: number;           // # of visualizations bound to this combination
  dashboardId: number;        // for cleanup loops on dashboard switch / logout
  sourceType: "table" | "dv";
  sourceId: number;           // tableId or dvId
};

export type FilterCombinationState = {
  // Keyed by stableComboHash output. NOFILTER hash never stored (see invariant above).
  registry: Record<string, CombinationEntry>;
  // Viz identity → current hash. Keys: "w:<widgetId>" | "l:<layerId>" | "dv:<dvId>".
  vizToHash: Record<string, string | undefined>;
  // Primitive version counter — Effect dep for suspend-gate lifts (PITFALL S-02 pattern,
  // mirrors filterViewStore.clearMaterializingVersion).
  combinationVersion: number;

  setEntry: (hash: string, entry: CombinationEntry) => void;
  markMaterializing: (
    hash: string,
    dashboardId: number,
    sourceType: "table" | "dv",
    sourceId: number,
  ) => void;
  clearEntry: (hash: string) => void;
  setVizHash: (vizKey: string, hash: string | undefined) => void;
  acquire: (hash: string) => void;  // refCount += 1
  release: (hash: string) => void;  // refCount -= 1; clearEntry when it reaches 0 (DROP-at-0)
  reset: () => void;
};

export const useFilterCombinationStore = create<FilterCombinationState>((set) => ({
  registry: {},
  vizToHash: {},
  combinationVersion: 0,

  // setEntry: stores the entry and bumps combinationVersion (monotonic).
  // Reference-stable: only registry[hash] entry is new; other entries retain their object
  // identity (selector-driven scope per S-02 lock). Mirrors filterViewStore.setView spread pattern.
  setEntry: (hash, entry) =>
    set((s) => ({
      registry: { ...s.registry, [hash]: entry },
      combinationVersion: s.combinationVersion + 1,
    })),

  // markMaterializing: pre-call action before a POST /api/filter/materialize.
  // If entry exists: spread with materializing=true, preserve viewName/expiresAt/
  //   materializeVersion/refCount (widget keeps showing prior filtered data while refresh is in flight).
  // If entry missing: create placeholder { viewName:"", expiresAt:0, materializing:true,
  //   materializeVersion:0, refCount:0, dashboardId, sourceType, sourceId }.
  // Always bumps combinationVersion. dashboardId + sourceType + sourceId are OVERWRITTEN with
  // caller's values (same last-write-wins rationale as filterViewStore.markMaterializing).
  markMaterializing: (hash, dashboardId, sourceType, sourceId) =>
    set((s) => {
      const prev = s.registry[hash];
      const nextEntry: CombinationEntry = prev
        ? { ...prev, materializing: true, dashboardId }
        : {
            viewName: "",
            expiresAt: 0,
            materializing: true,
            materializeVersion: 0,
            refCount: 0,
            dashboardId,
            sourceType,
            sourceId,
          };
      return {
        registry: { ...s.registry, [hash]: nextEntry },
        combinationVersion: s.combinationVersion + 1,
      };
    }),

  // clearEntry: delete-key semantics — no-op (returns s) when hash absent; otherwise clone,
  // delete, bump combinationVersion. Mirrors filterViewStore.clearView.
  clearEntry: (hash) =>
    set((s) => {
      if (!(hash in s.registry)) return s; // no-op
      const next = { ...s.registry };
      delete next[hash];
      return { registry: next, combinationVersion: s.combinationVersion + 1 };
    }),

  // setVizHash: stores or deletes a viz → hash mapping.
  // When hash === undefined: delete-key from a cloned vizToHash (no-op + return s when key absent).
  // Does NOT bump combinationVersion — vizToHash changes are not registry mutations; subscribers
  // scope to their own vizKey so they don't need to react to other vizKeys changing.
  setVizHash: (vizKey, hash) =>
    set((s) => {
      if (hash === undefined) {
        if (!(vizKey in s.vizToHash)) return s; // no-op — key absent
        const next = { ...s.vizToHash };
        delete next[vizKey];
        return { vizToHash: next };
      }
      return { vizToHash: { ...s.vizToHash, [vizKey]: hash } };
    }),

  // acquire: refCount += 1. No-op when entry missing. Bumps combinationVersion.
  acquire: (hash) =>
    set((s) => {
      const prev = s.registry[hash];
      if (!prev) return s; // no-op — entry absent
      return {
        registry: { ...s.registry, [hash]: { ...prev, refCount: prev.refCount + 1 } },
        combinationVersion: s.combinationVersion + 1,
      };
    }),

  // release: refCount -= 1. When next <= 0, DELETE entry (DROP-at-0) — network DROP is
  // CALLER's responsibility. No-op when entry missing. Bumps combinationVersion.
  release: (hash) =>
    set((s) => {
      const prev = s.registry[hash];
      if (!prev) return s; // no-op — entry absent
      const next = prev.refCount - 1;
      if (next <= 0) {
        // DROP-at-0: remove entry; caller fires the network DELETE.
        const nextRegistry = { ...s.registry };
        delete nextRegistry[hash];
        return { registry: nextRegistry, combinationVersion: s.combinationVersion + 1 };
      }
      return {
        registry: { ...s.registry, [hash]: { ...prev, refCount: next } },
        combinationVersion: s.combinationVersion + 1,
      };
    }),

  // reset: zeroes all three slices. Called at BOTH cleanup sites (App.tsx + DashboardsPage.tsx)
  // after a snapshot-then-DROP loop. Mirrors filterViewStore.reset().
  reset: () => set({ registry: {}, vizToHash: {}, combinationVersion: 0 }),
}));
