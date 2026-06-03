import { describe, it, expect } from "vitest";
import { wrapLongitude } from "./geoWrap";

describe("wrapLongitude", () => {
  it("leaves in-range longitudes unchanged", () => {
    expect(wrapLongitude(0)).toBe(0);
    expect(wrapLongitude(-122.4)).toBeCloseTo(-122.4);
    expect(wrapLongitude(151.2)).toBeCloseTo(151.2);
    expect(wrapLongitude(-180)).toBe(-180);
  });

  it("wraps a click in the eastern world copy back into range", () => {
    expect(wrapLongitude(200)).toBeCloseTo(-160); // 200°E === 160°W
    expect(wrapLongitude(190)).toBeCloseTo(-170);
    expect(wrapLongitude(540)).toBeCloseTo(-180); // 540 - 360 = 180, which maps to -180
  });

  it("wraps a click in the western world copy back into range", () => {
    expect(wrapLongitude(-200)).toBeCloseTo(160); // -200 === +160
    expect(wrapLongitude(-260)).toBeCloseTo(100);
  });

  it("maps the +180 antimeridian to -180 (equivalent point)", () => {
    expect(wrapLongitude(180)).toBe(-180);
  });

  it("passes through non-finite values untouched", () => {
    expect(Number.isNaN(wrapLongitude(NaN))).toBe(true);
  });
});
