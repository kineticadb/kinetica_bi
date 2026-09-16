/**
 * Phase 118 (ZLGND-V123-05): boundary-table coverage for the single shared
 * zoom-range predicate. Mirrors applyZoomRangeToLayer.spec.ts's plain
 * pure-function style — no OL import, no render.
 */

import { describe, it, expect } from "vitest";
import { toOlZoomBounds, isLayerActiveAtZoom } from "./zoomRangeBounds";

describe("toOlZoomBounds", () => {
  it("ZLB1: {minZoom: 3, maxZoom: 10} → {minZoom: 2, maxZoom: 10}", () => {
    expect(toOlZoomBounds({ minZoom: 3, maxZoom: 10 })).toEqual({
      minZoom: 2,
      maxZoom: 10,
    });
  });

  it("ZLB2: {minZoom: 5, maxZoom: 5} → {minZoom: 4, maxZoom: 5}", () => {
    expect(toOlZoomBounds({ minZoom: 5, maxZoom: 5 })).toEqual({
      minZoom: 4,
      maxZoom: 5,
    });
  });

  it("ZLB3: {maxZoom: 15} → {minZoom: -Infinity, maxZoom: 15}", () => {
    expect(toOlZoomBounds({ maxZoom: 15 })).toEqual({
      minZoom: -Infinity,
      maxZoom: 15,
    });
  });

  it("ZLB4: {minZoom: 5} → {minZoom: 4, maxZoom: Infinity}", () => {
    expect(toOlZoomBounds({ minZoom: 5 })).toEqual({
      minZoom: 4,
      maxZoom: Infinity,
    });
  });

  it("ZLB5: {} → {minZoom: -Infinity, maxZoom: Infinity}", () => {
    expect(toOlZoomBounds({})).toEqual({
      minZoom: -Infinity,
      maxZoom: Infinity,
    });
  });

  it("ZLB6: {minZoom: 0, maxZoom: 0} → {minZoom: -1, maxZoom: 0} — 0 is a real bound, not falsy-absent", () => {
    expect(toOlZoomBounds({ minZoom: 0, maxZoom: 0 })).toEqual({
      minZoom: -1,
      maxZoom: 0,
    });
  });
});

describe("isLayerActiveAtZoom — verified boundary table", () => {
  it("ZLB7: {minZoom: 3, maxZoom: 10} — the verified boundary table", () => {
    const cfg = { minZoom: 3, maxZoom: 10 };
    // OL translated bounds: (2, 10]. 2 > 2 is false — the exclusive lower edge.
    expect(isLayerActiveAtZoom(cfg, 2.0)).toBe(false);
    expect(isLayerActiveAtZoom(cfg, 2.0001)).toBe(true);
    // 2.9 is the fractional case the old (pre-Phase-118) info-click gate got wrong.
    expect(isLayerActiveAtZoom(cfg, 2.9)).toBe(true);
    expect(isLayerActiveAtZoom(cfg, 3)).toBe(true);
    expect(isLayerActiveAtZoom(cfg, 6.5)).toBe(true);
    // 10 is the inclusive upper edge.
    expect(isLayerActiveAtZoom(cfg, 10)).toBe(true);
    expect(isLayerActiveAtZoom(cfg, 10.5)).toBe(false);
  });

  it("ZLB8: no constraint ({}) is active at any zoom, including extremes", () => {
    expect(isLayerActiveAtZoom({}, -999)).toBe(true);
    expect(isLayerActiveAtZoom({}, 999)).toBe(true);
  });

  it("ZLB9: open lower bound only ({minZoom: 5}) — exclusive at translated 4", () => {
    expect(isLayerActiveAtZoom({ minZoom: 5 }, 4)).toBe(false);
    expect(isLayerActiveAtZoom({ minZoom: 5 }, 4.5)).toBe(true);
  });

  it("ZLB10: open upper bound only ({maxZoom: 5}) — inclusive at 5", () => {
    expect(isLayerActiveAtZoom({ maxZoom: 5 }, 5)).toBe(true);
    expect(isLayerActiveAtZoom({ maxZoom: 5 }, 5.0001)).toBe(false);
  });

  it("ZLB11: {minZoom: 5, maxZoom: 5} single-level — active ONLY at z=5", () => {
    const cfg = { minZoom: 5, maxZoom: 5 };
    expect(isLayerActiveAtZoom(cfg, 4)).toBe(false);
    expect(isLayerActiveAtZoom(cfg, 4.5)).toBe(true);
    expect(isLayerActiveAtZoom(cfg, 5)).toBe(true);
    expect(isLayerActiveAtZoom(cfg, 5.5)).toBe(false);
  });

  it("ZLB12: minZoom: 0 is honoured as a real bound, not treated as absent", () => {
    const cfg = { minZoom: 0, maxZoom: 10 };
    // Translated bounds: (-1, 10]. Confirms `=== undefined` (not falsy) is used.
    expect(isLayerActiveAtZoom(cfg, -1)).toBe(false);
    expect(isLayerActiveAtZoom(cfg, -0.5)).toBe(true);
    expect(isLayerActiveAtZoom(cfg, 0)).toBe(true);
  });

  it("ZLB13: coherence — isLayerActiveAtZoom is derived from toOlZoomBounds, not a parallel formula", () => {
    const cfg = { minZoom: 3, maxZoom: 10 };
    const { minZoom, maxZoom } = toOlZoomBounds(cfg);
    for (const z of [2, 2.0001, 2.9, 3, 10, 10.5]) {
      expect(isLayerActiveAtZoom(cfg, z)).toBe(z > minZoom && z <= maxZoom);
    }
  });
});
