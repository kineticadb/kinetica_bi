/**
 * Phase 23 (CARD-V14-02): Last-info-click spatial-context store.
 *
 * The Info Card (Plan 23-03) has no mapRef but must fire POST /api/info/query when its
 * dropdown switches to a layer with state[newLayerId] === undefined. The endpoint requires
 * clickLon/clickLat/mapBbox/mapWidthPx/mapHeightPx/radiusPx — the card REPLAYS the most-recent
 * map click's coordinates rather than synthesizing new ones (locked at 23-CONTEXT.md
 * "the card's dropdown-switch CANNOT make up new spatial coordinates").
 *
 * Strategy B locked at .planning/phases/23-info-card/23-RESEARCH.md § Q1: sibling slice
 * (NOT a Phase 20 store-shape change; NOT a recompute-from-mapRef strategy). Mirrors the
 * useFilterStore + useFilterViewStore + useInfoSelectionStore sibling pattern.
 *
 * LIFECYCLE — four-store reset block (Plan 23-02 extends the three-store block from Phase 20-02):
 *   - DashboardsPage.tsx DashboardOpen cleanup (alongside filterViewStore -> filterStore -> infoSelectionStore reset).
 *   - App.tsx UNAUTHORIZED handler (alongside the same three-store reset).
 * Canonical order: filterViewStore -> filterStore -> infoSelectionStore -> lastInfoClickContextStore.
 * Reset is critical — Pitfall 1 in 23-RESEARCH.md: stale dashboard-A coords MUST NOT survive a switch to dashboard-B.
 *
 * The store is automatically covered by the Zustand reset shim (__mocks__/zustand.ts
 * activated via vi.mock("zustand") in src/test/setup.ts) because it lives under src/store/*.ts.
 */

import { create } from "zustand";

export type LastInfoClickContext = {
  /** Click longitude in EPSG:4326 (geographic degrees). Plan 21-03 transforms from OL EPSG:3857 coord. */
  clickLon: number;
  /** Click latitude in EPSG:4326. */
  clickLat: number;
  /** Map viewport bbox in EPSG:4326 [minLon, minLat, maxLon, maxLat] at click time. Caller transforms from EPSG:3857 view extent via transformExtent. Server uses for radiusPx -> ground conversion (SPATIAL-V14-05). */
  mapBbox: [number, number, number, number];
  /** Map widget pixel width at click time (> 0). */
  mapWidthPx: number;
  /** Map widget pixel height at click time (> 0). */
  mapHeightPx: number;
  /** Click radius in pixels — resolved from the owning widget's config via getInfoRadiusPx (default 3). */
  radiusPx: number;
  /** Informational — which map widget produced this context. Cards do NOT filter by this (dashboard-scoped — locked 23-CONTEXT.md). */
  sourceWidgetId: number;
};

type State = {
  context: LastInfoClickContext | null;
  /** Replace-semantics: writes overwrite any prior context. Called from MapChartRenderer.tsx singleclick handler. */
  setContext: (ctx: LastInfoClickContext) => void;
  /** Wipe to null. Wired into App.tsx UNAUTHORIZED + DashboardsPage.tsx DashboardOpen cleanup as fourth call. */
  reset: () => void;
};

export const useLastInfoClickContextStore = create<State>((set) => ({
  context: null,
  setContext: (ctx) => set({ context: ctx }),
  reset: () => set({ context: null }),
}));
