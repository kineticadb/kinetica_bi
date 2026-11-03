import { describe, it, expect } from "vitest";
import { mapViewForBounds, lonLatToMercator, MAP_VIEW_MIN_ZOOM, MAP_VIEW_MAX_ZOOM, MAP_VIEW_POINT_ZOOM, AiMapDefaultViewSchema } from "./mapView";
import { validateAiWidgetConfig } from "./aiCatalog";

// demo.nyctaxi 2nd..98th percentile pickup extent (approximate)
const NYC = { minLon: -74.02, maxLon: -73.78, minLat: 40.63, maxLat: 40.85 };

describe("mapViewForBounds", () => {
  it("MV-1 NYC bounds -> centre near Manhattan, zoom ~10-12", () => {
    const v = mapViewForBounds(NYC)!;
    expect(v).not.toBeNull();
    const [mx, my] = lonLatToMercator(-73.9, 40.74);
    expect(Math.abs(v.center[0] - mx)).toBeLessThan(2000);
    expect(Math.abs(v.center[1] - my)).toBeLessThan(2000);
    expect(v.zoom).toBeGreaterThanOrEqual(10);
    expect(v.zoom).toBeLessThanOrEqual(12);
  });

  it("MV-2 centre is EPSG:3857 metres (lon -74 is ~ -8.24e6 m)", () => {
    const [x, y] = lonLatToMercator(-74, 40.7);
    expect(x).toBeCloseTo(-8237642.3, 0);
    expect(y).toBeGreaterThan(4.96e6);
    expect(y).toBeLessThan(4.97e6);
  });

  it("MV-3 padded extent fits the viewport at the chosen zoom", () => {
    const vp = { w: 900, h: 500 };
    const v = mapViewForBounds(NYC, vp)!;
    const res = (2 * Math.PI * 6378137) / (256 * 2 ** v.zoom);
    const [x0, y0] = lonLatToMercator(NYC.minLon, NYC.minLat);
    const [x1, y1] = lonLatToMercator(NYC.maxLon, NYC.maxLat);
    expect((x1 - x0) / res).toBeLessThanOrEqual(vp.w * 0.8 + 1e-6);
    expect((y1 - y0) / res).toBeLessThanOrEqual(vp.h * 0.8 + 1e-6);
  });

  it("MV-4 a smaller viewport never zooms in further", () => {
    expect(mapViewForBounds(NYC, { w: 300, h: 200 })!.zoom).toBeLessThan(mapViewForBounds(NYC, { w: 900, h: 500 })!.zoom);
  });

  it("MV-5 world-spanning extent clamps to the minimum zoom", () => {
    expect(mapViewForBounds({ minLon: -180, maxLon: 180, minLat: -85, maxLat: 85 })!.zoom).toBe(MAP_VIEW_MIN_ZOOM);
  });

  it("MV-6 one-point extent -> point zoom at that point", () => {
    const v = mapViewForBounds({ minLon: 2.35, maxLon: 2.35, minLat: 48.85, maxLat: 48.85 })!;
    expect(v.zoom).toBe(MAP_VIEW_POINT_ZOOM);
    const [x, y] = lonLatToMercator(2.35, 48.85);
    expect(v.center[0]).toBeCloseTo(x, 3);
    expect(v.center[1]).toBeCloseTo(y, 3);
  });

  it("MV-7 tiny extent clamps to the maximum zoom", () => {
    expect(mapViewForBounds({ minLon: 2.35, maxLon: 2.3501, minLat: 48.85, maxLat: 48.8501 })!.zoom).toBe(MAP_VIEW_MAX_ZOOM);
  });

  it.each([
    [{ minLon: NaN, maxLon: 1, minLat: 0, maxLat: 1 }],
    [{ minLon: 0, maxLon: Infinity, minLat: 0, maxLat: 1 }],
    [{ minLon: 5, maxLon: 1, minLat: 0, maxLat: 1 }],
    [{ minLon: 0, maxLon: 1, minLat: 0, maxLat: 95 }],
    [{ minLon: -200, maxLon: 1, minLat: 0, maxLat: 1 }],
  ])("MV-8 unusable bounds -> null (%j)", (b) => {
    expect(mapViewForBounds(b)).toBeNull();
  });

  it("MV-9 output satisfies the web resolveInitialView rules (finite, 2-array, zoom 0..28)", () => {
    for (const b of [NYC, { minLon: -180, maxLon: 180, minLat: -85, maxLat: 85 }, { minLon: 1, maxLon: 1, minLat: 1, maxLat: 1 }]) {
      const v = mapViewForBounds(b)!;
      expect(v.center).toHaveLength(2);
      expect(v.center.every(Number.isFinite)).toBe(true);
      expect(Number.isFinite(v.zoom)).toBe(true);
      expect(v.zoom).toBeGreaterThanOrEqual(0);
      expect(v.zoom).toBeLessThanOrEqual(28);
      expect(AiMapDefaultViewSchema.safeParse(v).success).toBe(true);
    }
  });
});

describe("server-stamped map defaultView in the AI catalogue", () => {
  const view = mapViewForBounds(NYC)!;
  it("MV-10 the model cannot set defaultView (default validation rejects it)", () => {
    const r = validateAiWidgetConfig("map", { tableId: 1, defaultView: view });
    expect(r.valid).toBe(false);
  });
  it("MV-11 a server-stamped defaultView is accepted with allowServerStamped", () => {
    expect(validateAiWidgetConfig("map", { tableId: 1, defaultView: view }, { allowServerStamped: true }).valid).toBe(true);
  });
  it("MV-12 a malformed stamped defaultView is still rejected", () => {
    expect(validateAiWidgetConfig("map", { defaultView: { center: [0], zoom: 3 } }, { allowServerStamped: true }).valid).toBe(false);
    expect(validateAiWidgetConfig("map", { defaultView: { center: [0, 0], zoom: 99 } }, { allowServerStamped: true }).valid).toBe(false);
  });
  it("MV-13 stamped keys are map-only", () => {
    expect(validateAiWidgetConfig("bar", { metric: "a", aggregation: "sum", groupByColumn: "b", defaultView: view }, { allowServerStamped: true }).valid).toBe(false);
  });
});
