/**
 * Phase 111 (MAPVIEW-V121-01/04): Transient per-WIDGET live map-view store.
 *
 * Holds the CURRENT on-screen OL view (center + zoom, EPSG:3857) of every mounted map
 * widget, so MapConfigPanel can show a live readout of the view it would capture as the
 * widget's default. The config modal's `.modal-overlay` (position: fixed; inset: 0)
 * completely hides the map, so the panel MUST be able to read the view it is about to
 * save — a blind save was explicitly rejected in 111-CONTEXT.md.
 *
 * WHY NOT mapViewportSyncStore (Phase 104): it publishes ONLY when the per-map
 * "Sync viewport" toggle is on (default OFF), and it is keyed by dashboardId — a single
 * last-writer-wins slot that returns the WRONG map's view on a multi-map dashboard.
 * This store is ALWAYS-ON and keyed by widget.id. Never add a syncViewport gate here.
 *
 * Direction is strictly one-way: MapChartRenderer publishes -> MapConfigPanel reads.
 * Nothing ever animates a map in response to this store, so there is no echo loop and
 * `isSyncDrivenRef` is irrelevant here.
 *
 * LIFECYCLE — becomes the 13th store in both cleanup chains (filterHighlightStore,
 * Phase 108, is the 12th):
 *   App.tsx logout + DashboardsPage.tsx dashboard-switch (wired in Plan 111-02).
 *   Use reset() for the full wipe; clear(widgetId) for per-widget unmount cleanup.
 *   Session-only, no server DROP.
 *
 * Test infra: Zustand reset shim at __mocks__/zustand.ts auto-applies via
 * vi.mock("zustand") in src/test/setup.ts. File MUST live under src/store/ for shim coverage.
 */

import { create } from "zustand";

/** The live OL view of one map widget, in OL's native projection. */
export type MapCurrentView = {
  center: [number, number]; // EPSG:3857 — matches view.getCenter()
  zoom: number;             // fractional OL zoom, UNROUNDED (111-CONTEXT.md lock)
};

type State = {
  views: Record<number, MapCurrentView | undefined>; // keyed by widget.id
  publish: (widgetId: number, view: MapCurrentView) => void;
  clear: (widgetId: number) => void;
  reset: () => void;
};

export const useMapCurrentViewStore = create<State>((set) => ({
  views: {},
  publish: (widgetId, view) =>
    set((s) => ({ views: { ...s.views, [widgetId]: view } })),
  clear: (widgetId) =>
    set((s) => {
      const next = { ...s.views };
      delete next[widgetId];
      return { views: next };
    }),
  reset: () => set({ views: {} }),
}));
