import { describe, it, expect } from "vitest";
import { resolveLegendLayers } from "./resolveLegendLayers";
import type { DashboardLayerDto } from "../api/client";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeLayer(id: number): DashboardLayerDto {
  return {
    id,
    dashboard_id: 1,
    table_id: 1,
    layer_type: "KineticaWms",
    position: 0,
    config: {},
    info_enabled: 1,
    info_columns: null,
    info_template: null,
    dynamic_view_id: null,
    cb_config: null,
    track_config: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("resolveLegendLayers", () => {
  it("Test 1: empty storeLayers + undefined includedLayerIds returns []", () => {
    const result = resolveLegendLayers([], undefined);
    expect(result).toHaveLength(0);
  });

  it("Test 2: empty storeLayers + [] includedLayerIds returns []", () => {
    const result = resolveLegendLayers([], []);
    expect(result).toHaveLength(0);
  });

  it("Test 3: empty storeLayers + non-empty includedLayerIds returns []", () => {
    const result = resolveLegendLayers([], [42, 99]);
    expect(result).toHaveLength(0);
  });

  it("Test 4 (Phase 12 empty-array-means-all-on): 3-layer store + undefined → all 3 layers returned in order", () => {
    const storeLayers = [makeLayer(10), makeLayer(20), makeLayer(30)];
    const result = resolveLegendLayers(storeLayers, undefined);
    expect(result).toHaveLength(3);
    expect(result[0].layer).toBe(storeLayers[0]);
    expect(result[1].layer).toBe(storeLayers[1]);
    expect(result[2].layer).toBe(storeLayers[2]);
    expect(result[0].visible).toBe(true);
  });

  it("Test 5 (empty-array-means-all-on): 3-layer store + [] → all 3 layers returned (same as undefined)", () => {
    const storeLayers = [makeLayer(10), makeLayer(20), makeLayer(30)];
    const result = resolveLegendLayers(storeLayers, []);
    expect(result).toHaveLength(3);
    expect(result[0].layer).toBe(storeLayers[0]);
    expect(result[1].layer).toBe(storeLayers[1]);
    expect(result[2].layer).toBe(storeLayers[2]);
  });

  it("Test 6 (filter applied when non-empty): 3 layers with ids [1,2,3] + includedLayerIds=[2] → 1 result with id 2", () => {
    const storeLayers = [makeLayer(1), makeLayer(2), makeLayer(3)];
    const result = resolveLegendLayers(storeLayers, [2]);
    expect(result).toHaveLength(1);
    expect(result[0].layer.id).toBe(2);
  });

  it("Test 7 (mismatched IDs): 2 layers with ids [1,2] + includedLayerIds=[99] → 0 results", () => {
    const storeLayers = [makeLayer(1), makeLayer(2)];
    const result = resolveLegendLayers(storeLayers, [99]);
    expect(result).toHaveLength(0);
  });

  it("Test 8 (preserves store order): store [{id:3},{id:1},{id:2}] + includedLayerIds=[1,2,3] → order [3,1,2]", () => {
    const l3 = makeLayer(3);
    const l1 = makeLayer(1);
    const l2 = makeLayer(2);
    const storeLayers = [l3, l1, l2];
    const result = resolveLegendLayers(storeLayers, [1, 2, 3]);
    expect(result).toHaveLength(3);
    expect(result[0].layer.id).toBe(3);
    expect(result[1].layer.id).toBe(1);
    expect(result[2].layer.id).toBe(2);
  });

  it("Test 9 (visible defaults true): layers with no config.visible default to visible === true", () => {
    const storeLayers = [makeLayer(1), makeLayer(2), makeLayer(3)];
    const result = resolveLegendLayers(storeLayers, undefined);
    for (const entry of result) {
      expect(entry.visible).toBe(true);
    }
  });

  it("Test 10 (visible reflects config.visible): config.visible===false → visible false; ===true → visible true; included regardless", () => {
    const hidden = makeLayer(1);
    hidden.config = { visible: false };
    const shown = makeLayer(2);
    shown.config = { visible: true };
    const result = resolveLegendLayers([hidden, shown], undefined);
    // Both layers are still returned (hidden layers remain listed in the legend)
    expect(result).toHaveLength(2);
    expect(result[0].layer.id).toBe(1);
    expect(result[0].visible).toBe(false);
    expect(result[1].layer.id).toBe(2);
    expect(result[1].visible).toBe(true);
  });
});
