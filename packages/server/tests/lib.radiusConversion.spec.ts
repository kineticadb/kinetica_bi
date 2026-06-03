import { describe, it, expect } from "vitest";
import {
  pxToGroundDistance,
  pxToGroundDegrees,
} from "../src/lib/radiusConversion";

describe("pxToGroundDistance (SPATIAL-V14-05 — meters output for GEODIST consumers)", () => {
  it("returns a positive number > 0 for a 20px radius at NYC zoom", () => {
    // NYC bbox approx: ~30 deg-fraction wide; 800px wide; 600px tall
    const out = pxToGroundDistance(
      20,
      [-74.05, 40.63, -73.75, 40.85],
      800,
      600,
      40.75
    );
    expect(out).toBeGreaterThan(0);
    expect(Number.isFinite(out)).toBe(true);
  });

  it("doubles output when radiusPx doubles (linear in radiusPx)", () => {
    const bbox: [number, number, number, number] = [
      -74.05, 40.63, -73.75, 40.85,
    ];
    const small = pxToGroundDistance(20, bbox, 800, 600, 40.75);
    const large = pxToGroundDistance(40, bbox, 800, 600, 40.75);
    expect(large).toBeCloseTo(small * 2, 6);
  });

  it("zoom proportionality: 4x-zoomed-in bbox (1/4 width) yields ~1/4 the output (SPATIAL-V14-05 success criterion 5)", () => {
    // Same center (-73.90, 40.74) but 4x zoom: bbox shrinks to 1/4 the width and 1/4 the height
    const widerBbox: [number, number, number, number] = [
      -74.05, 40.63, -73.75, 40.85,
    ]; // 0.30 deg wide
    const zoomedInBbox: [number, number, number, number] = [
      -73.9375, 40.7125, -73.8625, 40.7775,
    ]; // 0.075 deg wide (1/4 of 0.30)
    const wide = pxToGroundDistance(20, widerBbox, 800, 600, 40.75);
    const zoomed = pxToGroundDistance(20, zoomedInBbox, 800, 600, 40.75);
    expect(zoomed).toBeCloseTo(wide / 4, 0);
  });

  it("equator click yields a LARGER ground distance than high-latitude click for same px+bbox (cos(lat) correction)", () => {
    const bbox: [number, number, number, number] = [
      -74.05, 40.63, -73.75, 40.85,
    ];
    const equator = pxToGroundDistance(20, bbox, 800, 600, 0);
    const highLat = pxToGroundDistance(20, bbox, 800, 600, 80);
    expect(equator).toBeGreaterThan(highLat);
  });

  it("returns finite, non-NaN, non-Infinity for all valid inputs", () => {
    const out = pxToGroundDistance(
      15,
      [-180, -85, 180, 85],
      1024,
      768,
      37.5
    );
    expect(Number.isFinite(out)).toBe(true);
    expect(Number.isNaN(out)).toBe(false);
  });

  it("returns 0 for radiusPx=0 (degenerate zero-radius case)", () => {
    expect(
      pxToGroundDistance(0, [-74.05, 40.63, -73.75, 40.85], 800, 600, 40.75)
    ).toBe(0);
  });
});

describe("pxToGroundDegrees (SPATIAL-V14-05 — degrees variant for STXY_DISTANCE consumers)", () => {
  it("returns a positive number for non-zero radiusPx", () => {
    const out = pxToGroundDegrees(20, [-74.05, 40.63, -73.75, 40.85], 800);
    expect(out).toBeGreaterThan(0);
  });

  it("returns 0 for radiusPx=0", () => {
    expect(
      pxToGroundDegrees(0, [-74.05, 40.63, -73.75, 40.85], 800)
    ).toBe(0);
  });

  it("scales linearly with radiusPx", () => {
    const bbox: [number, number, number, number] = [
      -74.05, 40.63, -73.75, 40.85,
    ];
    const small = pxToGroundDegrees(10, bbox, 800);
    const large = pxToGroundDegrees(40, bbox, 800);
    expect(large).toBeCloseTo(small * 4, 9);
  });
});
