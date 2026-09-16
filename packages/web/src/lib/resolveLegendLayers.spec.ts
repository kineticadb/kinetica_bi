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

  it("Test 11: layer with NO minZoom/maxZoom + zoom 5 → zoomRange and zoomActive both undefined (ZLGND-V123-07)", () => {
    const layer = makeLayer(1);
    const result = resolveLegendLayers([layer], undefined, 5);
    expect(result).toHaveLength(1);
    expect(result[0].zoomRange).toBeUndefined();
    expect(result[0].zoomActive).toBeUndefined();
  });

  it("Test 12: {minZoom:3, maxZoom:10} + zoom 2.9 → zoomActive true, zoomRange is the RAW wire values", () => {
    const layer = makeLayer(1);
    layer.config = { minZoom: 3, maxZoom: 10 };
    const result = resolveLegendLayers([layer], undefined, 2.9);
    expect(result[0].zoomActive).toBe(true);
    expect(result[0].zoomRange).toEqual({ minZoom: 3, maxZoom: 10 });
  });

  it("Test 13: same layer + zoom 10.5 → zoomActive false", () => {
    const layer = makeLayer(1);
    layer.config = { minZoom: 3, maxZoom: 10 };
    const result = resolveLegendLayers([layer], undefined, 10.5);
    expect(result[0].zoomActive).toBe(false);
  });

  it("Test 14: same layer + zoom argument omitted → zoomRange defined but zoomActive is undefined, NEVER false (ZLGND-V123-06)", () => {
    const layer = makeLayer(1);
    layer.config = { minZoom: 3, maxZoom: 10 };
    const result = resolveLegendLayers([layer], undefined);
    expect(result[0].zoomRange).toEqual({ minZoom: 3, maxZoom: 10 });
    expect(result[0].zoomActive).toBeUndefined();
  });

  it("Test 15: {minZoom:3} only → zoomRange has maxZoom undefined; zoom 2 → inactive, zoom 2.5 → active", () => {
    const layer = makeLayer(1);
    layer.config = { minZoom: 3 };
    const inactive = resolveLegendLayers([layer], undefined, 2);
    expect(inactive[0].zoomRange).toEqual({ minZoom: 3, maxZoom: undefined });
    expect(inactive[0].zoomActive).toBe(false);
    const active = resolveLegendLayers([layer], undefined, 2.5);
    expect(active[0].zoomActive).toBe(true);
  });

  it("Test 16: {maxZoom:0} → zoom 0 is active (0 is a real bound, not falsy-absent); zoom 0.5 is inactive", () => {
    const layer = makeLayer(1);
    layer.config = { maxZoom: 0 };
    const atZero = resolveLegendLayers([layer], undefined, 0);
    expect(atZero[0].zoomActive).toBe(true);
    const above = resolveLegendLayers([layer], undefined, 0.5);
    expect(above[0].zoomActive).toBe(false);
  });

  it("Test 17: visible and existing filtering are unaffected by the zoom argument (mirrors Test 10)", () => {
    const hidden = makeLayer(1);
    hidden.config = { visible: false, minZoom: 3, maxZoom: 10 };
    const result = resolveLegendLayers([hidden], undefined, 5);
    expect(result).toHaveLength(1);
    expect(result[0].visible).toBe(false);
    expect(result[0].zoomActive).toBe(true);
  });
});
