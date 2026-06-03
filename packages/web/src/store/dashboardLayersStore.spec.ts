import { describe, it, expect } from "vitest";
import { useDashboardLayersStore } from "./dashboardLayersStore";
import type { DashboardLayerDto } from "../api/client";

const mk = (id: number, overrides: Partial<DashboardLayerDto> = {}): DashboardLayerDto => ({
  id,
  dashboard_id: 1,
  table_id: 10,
  layer_type: "KineticaWms",
  position: id,
  config: {},
  // v1.4 Phase 19 (CONFIG-V14-02): info popup defaults matching SQLite NOT NULL DEFAULT 1
  info_enabled: 1,
  info_columns: null,
  info_template: null,
  // v1.6 Phase 35 (DV-V16-13): per-layer dynamic-view binding; null = table/filter-view bound
  dynamic_view_id: null,
  // v1.7 Phase 38 (SCHEMA-V17-01/02): classbreak + track config JSON — null = not yet configured
  cb_config: null,
  track_config: null,
  created_at: "2026-05-05T00:00:00Z",
  updated_at: "2026-05-05T00:00:00Z",
  ...overrides,
});

describe("useDashboardLayersStore", () => {
  it("starts empty (Zustand reset shim canary)", () => {
    expect(useDashboardLayersStore.getState().layers).toEqual([]);
  });

  it("setLayers replaces the array", () => {
    useDashboardLayersStore.getState().setLayers([mk(1), mk(2)]);
    expect(useDashboardLayersStore.getState().layers).toHaveLength(2);
  });

  it("addLayer appends to the array", () => {
    useDashboardLayersStore.getState().setLayers([mk(1)]);
    useDashboardLayersStore.getState().addLayer(mk(2));
    expect(useDashboardLayersStore.getState().layers.map((l) => l.id)).toEqual([1, 2]);
  });

  it("updateLayer merges patch into matching id", () => {
    useDashboardLayersStore.getState().setLayers([mk(1), mk(2), mk(3)]);
    useDashboardLayersStore.getState().updateLayer(2, { config: { x: 1 } });
    const layers = useDashboardLayersStore.getState().layers;
    expect(layers[1].config).toEqual({ x: 1 });
    expect(layers[0].config).toEqual({});
  });

  it("updateLayer preserves reference identity for unmodified layers", () => {
    const a = mk(1), b = mk(2), c = mk(3);
    useDashboardLayersStore.getState().setLayers([a, b, c]);
    const before = useDashboardLayersStore.getState().layers;
    useDashboardLayersStore.getState().updateLayer(2, { position: 99 });
    const after = useDashboardLayersStore.getState().layers;
    expect(after[0]).toBe(before[0]); // layer 1 reference unchanged
    expect(after[2]).toBe(before[2]); // layer 3 reference unchanged
    expect(after[1]).not.toBe(before[1]); // layer 2 reference changed
  });

  it("updateLayer with unknown id is a no-op", () => {
    useDashboardLayersStore.getState().setLayers([mk(1)]);
    const before = useDashboardLayersStore.getState().layers;
    useDashboardLayersStore.getState().updateLayer(999, { position: 5 });
    expect(useDashboardLayersStore.getState().layers).toBe(before);
  });

  it("removeLayer filters out matching id", () => {
    useDashboardLayersStore.getState().setLayers([mk(1), mk(2), mk(3)]);
    useDashboardLayersStore.getState().removeLayer(2);
    expect(useDashboardLayersStore.getState().layers.map((l) => l.id)).toEqual([1, 3]);
  });

  it("reorderLayers replaces the array with the new order", () => {
    const a = mk(1), b = mk(2), c = mk(3);
    useDashboardLayersStore.getState().setLayers([a, b, c]);
    useDashboardLayersStore.getState().reorderLayers([c, b, a]);
    expect(useDashboardLayersStore.getState().layers.map((l) => l.id)).toEqual([3, 2, 1]);
  });

  it("updateLayer config patch deep-replaces config (not nested merge)", () => {
    useDashboardLayersStore.getState().setLayers([mk(1, { config: { a: 1, b: 2 } })]);
    useDashboardLayersStore.getState().updateLayer(1, { config: { c: 3 } });
    expect(useDashboardLayersStore.getState().layers[0].config).toEqual({ c: 3 });
  });
});
