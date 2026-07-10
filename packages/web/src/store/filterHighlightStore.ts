/**
 * Phase 108 (FSCOPE-V120-02/03): Transient on-canvas filter-highlight store.
 *
 * Holds the set of widget-CARD ids currently highlighted (steady hover ring) and the set
 * currently flashing (transient ~1s pulse on click), plus a monotonic nonce so a re-click
 * on the SAME widget re-fires the flash animation even when flashingIds is referentially
 * unchanged (Set identity would otherwise short-circuit the effect).
 *
 * Map layers are already resolved to their OWNING map widget id by Phase 105's
 * `computeReverseFilterMap` — this store only ever holds widget-card ids, never layer ids.
 *
 * LIFECYCLE — becomes the 12th store in both cleanup chains:
 *   App.tsx UNAUTHORIZED handler + DashboardsPage.tsx dashboard-switch cleanup.
 *   Session-only, no server DROP needed (mirrors mapViewportSyncStore.ts, the 11th store).
 *
 * Test infra: Zustand reset shim at __mocks__/zustand.ts auto-applies via
 * vi.mock("zustand") in src/test/setup.ts. File must live under src/store/ for shim coverage.
 */

import { create } from "zustand";

type State = {
  highlightedIds: Set<number>; // STEADY — hover → ring; widget CARD ids (layers already
  //                              resolved to owning widget by the reverse map)
  flashingIds: Set<number>; // TRANSIENT — click → ~1s pulse; cleared by WidgetCard timers
  flashNonce: number; // monotonic; re-clicking the SAME widget re-fires even when the
  //                     Set ref is equal
  setHighlighted: (ids: number[]) => void;
  clearHighlighted: () => void;
  flash: (ids: number[]) => void;
  reset: () => void;
};

export const useFilterHighlightStore = create<State>((set) => ({
  highlightedIds: new Set(),
  flashingIds: new Set(),
  flashNonce: 0,
  setHighlighted: (ids) => set({ highlightedIds: new Set(ids) }),
  clearHighlighted: () => set({ highlightedIds: new Set() }),
  flash: (ids) => set((s) => ({ flashingIds: new Set(ids), flashNonce: s.flashNonce + 1 })),
  reset: () => set({ highlightedIds: new Set(), flashingIds: new Set(), flashNonce: 0 }),
}));
