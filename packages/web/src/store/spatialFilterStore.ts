/**
 * Phase 27 (STORE-V15-01..03): Spatial filter store.
 *
 * Session-only Zustand slice holding committed drawn shapes (bbox / lasso / circle) for v1.5
 * spatial filtering. Ships dormant in Phase 27 — Phase 29 (MapDrawToolbar / VectorLayer) and
 * Phase 30 (FilterBar chips + AggregatedWidgetRenderer materialize trigger) are the first
 * consumers.
 *
 * `spatialFilterVersion` mirrors the `filterVersion` pattern from filterStore.ts — it is the
 * dep-array signal that AggregatedWidgetRenderer (Phase 30) will read alongside `filterVersion`
 * to trigger materialize. Increments on every successful mutation; no-op rules below.
 *
 * `shapeCounter` is an internal monotonic counter for label N — kept in state (NOT derived
 * from shapes.length) so post-remove sequences honor the no-recycling rule. Resets to 0 on
 * clearAll() and reset(); NEVER touched by removeShape.
 *
 * Label format (locked): `{TypeCapitalized} {N}` — "Bbox 1", "Circle 2", "Lasso 3" — session-wide
 * single counter (NOT per-type). Capitalization: bbox→Bbox, lasso→Lasso, circle→Circle.
 *
 * spatialFilterVersion semantics (locked by 27-CONTEXT.md):
 *   - addShape: +1
 *   - removeShape(existing id): +1
 *   - removeShape(non-existent id): NO-OP (state reference preserved)
 *   - clearAll() with shapes.length > 0: +1, shapes=[], shapeCounter=0
 *   - clearAll() with shapes.length === 0: NO-OP
 *   - reset(): hard-set to 0 (NOT an increment — lifecycle wipe, not a mutation signal)
 *
 * LIFECYCLE — 5-store reset block extended by Plan 27-02 (STORE-V15-04):
 *   Order: filterViewStore → filterStore → infoSelectionStore → lastInfoClickContextStore →
 *   spatialFilterStore (5th). Wired in App.tsx UNAUTHORIZED + DashboardsPage.tsx DashboardOpen
 *   cleanup. Session-only — NO server-side DROP loop (mirrors lastInfoClickContextStore).
 *
 * Test infra: Zustand reset shim at __mocks__/zustand.ts auto-applies via
 * vi.mock("zustand") in src/test/setup.ts. File must live under src/store/ for shim coverage.
 */

import { create } from "zustand";

export type Shape = {
  /** UUID v4 from crypto.randomUUID(), generated inside addShape. */
  id: string;
  /** Shape geometry kind. Drives label capitalization (bbox→Bbox, lasso→Lasso, circle→Circle). */
  type: "bbox" | "lasso" | "circle";
  /** WKT polygon in EPSG:4326 geographic coordinates. Phase 29 produces via ol/format/WKT
   *  with { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' } after geom.clone(). */
  wkt: string;
  /** Auto-generated `{TypeCapitalized} {N}` — e.g. "Bbox 1". N is session-wide monotonic. */
  label: string;
  /** Human-readable measurement — "5km × 3km", "2.5 km", "12.4 km²". Caller supplies (Phase 29
   *  computes via ol/sphere.getDistance / getArea — never raw EPSG:3857 — V15-P-04). */
  measurement: string;
  /** Date.now() at addShape time. */
  addedAt: number;
};

type State = {
  shapes: Shape[];
  spatialFilterVersion: number;
  /** Internal monotonic counter for label N. NOT exposed via a separate getter — Phase 29/30
   *  consumers read shapes[] and spatialFilterVersion only. Kept in state so the Zustand reset
   *  shim covers it for free. */
  shapeCounter: number;
  addShape: (shape: Omit<Shape, "id" | "label" | "addedAt">) => void;
  removeShape: (id: string) => void;
  clearAll: () => void;
  reset: () => void;
};

const CAPITALIZE: Record<Shape["type"], string> = {
  bbox: "Bbox",
  lasso: "Lasso",
  circle: "Circle",
};

export const useSpatialFilterStore = create<State>((set) => ({
  shapes: [],
  spatialFilterVersion: 0,
  shapeCounter: 0,

  addShape: ({ type, wkt, measurement }) =>
    set((s) => {
      const nextCounter = s.shapeCounter + 1;
      const shape: Shape = {
        id: crypto.randomUUID(),
        type,
        wkt,
        measurement,
        label: `${CAPITALIZE[type]} ${nextCounter}`,
        addedAt: Date.now(),
      };
      return {
        shapes: [...s.shapes, shape],
        spatialFilterVersion: s.spatialFilterVersion + 1,
        shapeCounter: nextCounter,
      };
    }),

  removeShape: (id) =>
    set((s) => {
      const next = s.shapes.filter((sh) => sh.id !== id);
      // Non-existent id — strict no-op. Mirrors filterStore.ts:removeFilter pattern.
      // PITFALL S-02 + Phase 29 reference stability: shapes[] reference preserved when unchanged.
      if (next.length === s.shapes.length) return s;
      return {
        shapes: next,
        spatialFilterVersion: s.spatialFilterVersion + 1,
        // shapeCounter intentionally NOT touched — monotonic no-recycle rule (27-CONTEXT.md).
      };
    }),

  clearAll: () =>
    set((s) => {
      // Empty shapes — strict no-op. Mirrors filterStore.ts:clearFilters pattern (lines 87-97).
      // Locked by success criterion 4: spurious version bumps cause phantom materializations
      // in Phase 30's AggregatedWidgetRenderer dep array.
      if (s.shapes.length === 0) return s;
      return {
        shapes: [],
        spatialFilterVersion: s.spatialFilterVersion + 1,
        shapeCounter: 0, // "start over" semantics — next addShape produces `{Type} 1`.
      };
    }),

  // Internal — called from App.tsx UNAUTHORIZED and DashboardsPage.tsx DashboardOpen cleanup
  // (Plan 27-02 wiring). Hard-set to initial state; NOT an increment-style mutation.
  reset: () =>
    set({ shapes: [], spatialFilterVersion: 0, shapeCounter: 0 }),
}));
