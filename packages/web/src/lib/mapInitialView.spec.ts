import { describe, it, expect } from "vitest";
import { resolveInitialView, WORLD_VIEW_CENTER, WORLD_VIEW_ZOOM } from "./mapInitialView";
import type { MapWidgetConfig } from "./wmsUrlBuilder";

const bad = (defaultView: unknown) =>
  resolveInitialView({ defaultView } as Pick<MapWidgetConfig, "defaultView">);

describe("resolveInitialView (Phase 112, MAPVIEW-V121-02/-03/-05)", () => {
  it("A1 — absent default -> world view", () => {
    expect(resolveInitialView({})).toEqual({ center: [0, 0], zoom: 2 });
  });

  it("A2 — explicitly-undefined default -> world view", () => {
    expect(resolveInitialView({ defaultView: undefined })).toEqual({ center: [0, 0], zoom: 2 });
  });

  it("A3 — saved default passes through EXACTLY (no rounding, no reprojection)", () => {
    const result = resolveInitialView({
      defaultView: { center: [-8237642.318, 4970241.327], zoom: 12.437 },
    });
    expect(result.center).toEqual([-8237642.318, 4970241.327]);
    expect(result.zoom).toBe(12.437);
  });

  it("A4 — zoom 0 is a VALID saved default, not falsy/absent", () => {
    const result = resolveInitialView({ defaultView: { center: [0, 0], zoom: 0 } });
    expect(result.zoom).toBe(0);
  });

  describe("A5 — invalid-value matrix: every case falls back to world view, nothing throws", () => {
    it.each([
      ["center [NaN, 0]", { center: [NaN, 0], zoom: 5 }],
      ["center [0, Infinity]", { center: [0, Infinity], zoom: 5 }],
      ["zoom NaN", { center: [0, 0], zoom: NaN }],
      ["zoom Infinity", { center: [0, 0], zoom: Infinity }],
      ["zoom below min (-1)", { center: [0, 0], zoom: -1 }],
      ["zoom above max (28.1)", { center: [0, 0], zoom: 28.1 }],
      ["1-element center array", { center: [0], zoom: 5 }],
      ["3-element center array", { center: [0, 0, 0], zoom: 5 }],
      ["center not an array (string)", { center: "nope", zoom: 5 }],
      ["center null", { center: null, zoom: 5 }],
      ["zoom as string", { center: [0, 0], zoom: "5" }],
    ])("%s -> world view, no throw", (_label, input) => {
      expect(() => bad(input)).not.toThrow();
      expect(bad(input)).toEqual({ center: [0, 0], zoom: 2 });
    });
  });

  it("A6 — boundary zooms 0 and 28 are ACCEPTED (inclusive)", () => {
    expect(resolveInitialView({ defaultView: { center: [0, 0], zoom: 0 } }).zoom).toBe(0);
    expect(resolveInitialView({ defaultView: { center: [0, 0], zoom: 28 } }).zoom).toBe(28);
  });

  it("A7 — MAPVIEW-V121-05: survives a JSON persistence round-trip verbatim", () => {
    const saved = { center: [-8237642.318, 4970241.327] as [number, number], zoom: 12.437 };
    const roundTripped = JSON.parse(JSON.stringify({ defaultView: saved }));
    expect(resolveInitialView(roundTripped)).toEqual({
      center: [-8237642.318, 4970241.327],
      zoom: 12.437,
    });
  });

  it("A8 — a fresh object every call, no shared mutable world-view singleton", () => {
    expect(resolveInitialView({})).not.toBe(resolveInitialView({}));
    expect(resolveInitialView({}).center).not.toBe(resolveInitialView({}).center);
  });

  it("exposes WORLD_VIEW_CENTER / WORLD_VIEW_ZOOM matching the pre-Phase-112 hardcoded values", () => {
    expect(WORLD_VIEW_CENTER).toEqual([0, 0]);
    expect(WORLD_VIEW_ZOOM).toBe(2);
  });
});
