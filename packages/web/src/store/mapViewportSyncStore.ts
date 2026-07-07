/**
 * Phase 104 (MAPSYNC-V119-01..06): Transient per-dashboard viewport-sync store.
 *
 * Holds the most-recently-published OL viewport (center + zoom in EPSG:3857) for each
 * open dashboard. Sync-enabled maps PUBLISH on moveend and SUBSCRIBE to incoming updates
 * from other maps on the same dashboard.
 *
 * Requirements covered:
 *   MAPSYNC-V119-01 — per-map "Sync map viewport" config toggle (default OFF)
 *   MAPSYNC-V119-02 — publish on moveend (MapChartRenderer Effect 9, wired in Plan 104-02)
 *   MAPSYNC-V119-03 — subscribers animate to the incoming viewport (Plan 104-02)
 *   MAPSYNC-V119-04 — echo-loop guard via isSyncDrivenRef (Plan 104-02)
 *   MAPSYNC-V119-05 — scoped per dashboardId; reset() on dashboard-switch
 *   MAPSYNC-V119-06 — absent syncViewport field defaults to false (byte-identical to today)
 *
 * LIFECYCLE — becomes the 11th store in both cleanup chains:
 *   App.tsx logout + DashboardsPage.tsx dashboard-switch.
 *   Use reset() for full wipe (logout); clear(dashboardId) for targeted slot cleanup.
 *   Wired in Plan 104-02; session-only, no server DROP.
 *
 * Test infra: Zustand reset shim at __mocks__/zustand.ts auto-applies via
 * vi.mock("zustand") in src/test/setup.ts. File must live under src/store/ for shim coverage.
 */

import { create } from "zustand";

/** A published map viewport. EPSG:3857 center (matches OL view.getCenter()). */
export type ViewportSnapshot = {
  center: [number, number]; // EPSG:3857
  zoom: number;             // fractional OL zoom
  originWidgetId: number;   // publishing map's widget.id; subscribers skip their own
  bump: number;             // monotonic (Date.now()) — forces re-fire on identical coords
};

type State = {
  viewports: Record<number, ViewportSnapshot | undefined>; // keyed by dashboardId
  publish: (dashboardId: number, snap: ViewportSnapshot) => void;
  clear: (dashboardId: number) => void;
  reset: () => void;
};

export const useMapViewportSyncStore = create<State>((set) => ({
  viewports: {},
  publish: (dashboardId, snap) =>
    set((s) => ({ viewports: { ...s.viewports, [dashboardId]: snap } })),
  clear: (dashboardId) =>
    set((s) => {
      const next = { ...s.viewports };
      delete next[dashboardId];
      return { viewports: next };
    }),
  reset: () => set({ viewports: {} }),
}));
