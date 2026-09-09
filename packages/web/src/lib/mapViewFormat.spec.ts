import { describe, it, expect } from "vitest";
import { transform } from "ol/proj";
import { formatLatLon, formatZoom } from "./mapViewFormat";

// Real ol/proj is used (no vi.mock) — transform is pure Web Mercator math with no
// DOM/canvas dependency, unlike ol/Map / ol/View.
const to3857 = (lon: number, lat: number) =>
  transform([lon, lat], "EPSG:4326", "EPSG:3857") as [number, number];

describe("formatLatLon", () => {
  it("F1: formatLatLon([0, 0]) is '0.00°N, 0.00°E' (zero treated as positive hemisphere)", () => {
    expect(formatLatLon([0, 0])).toBe("0.00°N, 0.00°E");
  });

  it("F2: NYC (CONTEXT.md-locked example) formats as '40.71°N, 74.01°W'", () => {
    expect(formatLatLon(to3857(-74.006, 40.7128))).toBe("40.71°N, 74.01°W");
  });

  it("F3: Sydney formats as '33.87°S, 151.21°E' (southern + eastern hemispheres)", () => {
    expect(formatLatLon(to3857(151.2093, -33.8688))).toBe("33.87°S, 151.21°E");
  });

  it("F4: output never contains a '-' character (hemisphere letters replace the sign)", () => {
    expect(formatLatLon([0, 0])).not.toContain("-");
    expect(formatLatLon(to3857(-74.006, 40.7128))).not.toContain("-");
    expect(formatLatLon(to3857(151.2093, -33.8688))).not.toContain("-");
  });
});

describe("formatZoom", () => {
  it("Z1: formatZoom(12.437) is '12.4'", () => {
    expect(formatZoom(12.437)).toBe("12.4");
  });

  it("Z2: formatZoom(8) is '8.0' (whole zooms still render 1dp)", () => {
    expect(formatZoom(8)).toBe("8.0");
  });

  it("Z3: formatZoom(2) is '2.0'", () => {
    expect(formatZoom(2)).toBe("2.0");
  });

  it("Z4: formatZoom does not mutate or round the caller's input", () => {
    const zoom = 12.437;
    formatZoom(zoom);
    expect(zoom).toBe(12.437);
  });
});
