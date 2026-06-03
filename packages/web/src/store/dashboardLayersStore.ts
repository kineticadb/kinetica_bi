/**
 * Phase 12: Dashboard Layers Store — Zustand slice mirroring the widget-state pattern.
 *
 * Single source of truth for the layer list of the currently-open dashboard.
 * Mirrors useFilterStore's slice shape (PITFALL S-01 lock — no useState shadow copies in
 * components). LayersModal and MapChartRenderer read from this store via selectors.
 *
 * Lifecycle:
 *   - DashboardOpen mounts → fetches layers via listDashboardLayers(dashboardId) → setLayers(...)
 *   - LayersModal mutations → optimistic store update + debounced PATCH to server
 *   - DashboardOpen unmounts / dashboard switch → setLayers([]) (caller-driven reset)
 *
 * The store is automatically covered by the Zustand reset shim (src/test/setup.ts) because
 * it lives under src/store/*.ts — same as useFilterStore.
 */

import { create } from "zustand";
import type { DashboardLayerDto } from "../api/client";

type LayersState = {
  layers: DashboardLayerDto[];
  setLayers: (layers: DashboardLayerDto[]) => void;
  addLayer: (layer: DashboardLayerDto) => void;
  updateLayer: (id: number, patch: Partial<DashboardLayerDto>) => void;
  removeLayer: (id: number) => void;
  reorderLayers: (ordered: DashboardLayerDto[]) => void;
};

export const useDashboardLayersStore = create<LayersState>((set) => ({
  layers: [],

  setLayers: (layers) => set({ layers }),

  addLayer: (layer) => set((state) => ({ layers: [...state.layers, layer] })),

  updateLayer: (id, patch) =>
    set((state) => {
      // Reference-stable update: only the matching layer is recreated.
      // Layers with other ids keep their object reference intact so React.memo
      // selectors downstream do not re-render the whole list.
      const idx = state.layers.findIndex((l) => l.id === id);
      if (idx < 0) return state; // no-op for unknown id
      const next = state.layers.slice();
      next[idx] = { ...next[idx], ...patch };
      return { layers: next };
    }),

  removeLayer: (id) =>
    set((state) => ({
      layers: state.layers.filter((l) => l.id !== id),
    })),

  reorderLayers: (ordered) => set({ layers: ordered }),
}));
