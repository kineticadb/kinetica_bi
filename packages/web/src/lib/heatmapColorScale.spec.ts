import { describe, it, expect } from "vitest";
import {
  DEFAULT_HEATMAP_COLOR_THEME,
  HEATMAP_COLOR_THEMES,
  heatmapStops,
  legendSwatches,
  normalizeValue,
  sampleRamp,
} from "./heatmapColorScale";

const HEX = /^#[0-9a-f]{6}$/;

describe("heatmapStops", () => {
  it("resolves the default theme to css hex stops", () => {
    const stops = heatmapStops(DEFAULT_HEATMAP_COLOR_THEME);
    expect(stops.length).toBeGreaterThan(2);
    stops.forEach((s) => expect(s).toMatch(HEX));
  });

  it("reverse flips the ramp direction", () => {
    const fwd = heatmapStops(DEFAULT_HEATMAP_COLOR_THEME);
    const rev = heatmapStops(DEFAULT_HEATMAP_COLOR_THEME, true);
    expect(rev).toEqual([...fwd].reverse());
  });

  it("falls back to the default theme for an unknown id", () => {
    expect(heatmapStops("not-a-theme")).toEqual(
      heatmapStops(DEFAULT_HEATMAP_COLOR_THEME),
    );
  });

  it("uses the theme's LARGEST variant, so the ramp never repeats colors", () => {
    // themeColorsFor() cycles modulo when count exceeds the palette; these stops
    // must instead be the widest ColorBrewer variant with no duplicates.
    const stops = heatmapStops("Blues");
    expect(new Set(stops).size).toBe(stops.length);
  });
});

describe("sampleRamp", () => {
  const stops = ["#000000", "#808080", "#ffffff"];

  it("returns the endpoints at t=0 and t=1", () => {
    expect(sampleRamp(stops, 0)).toBe("#000000");
    expect(sampleRamp(stops, 1)).toBe("#ffffff");
  });

  it("interpolates between adjacent stops", () => {
    expect(sampleRamp(stops, 0.5)).toBe("#808080");
    expect(sampleRamp(["#000000", "#ffffff"], 0.5)).toBe("#808080");
  });

  it("clamps out-of-range t instead of extrapolating", () => {
    expect(sampleRamp(stops, -5)).toBe("#000000");
    expect(sampleRamp(stops, 42)).toBe("#ffffff");
  });

  it("survives a non-finite t", () => {
    expect(sampleRamp(stops, NaN)).toBe("#000000");
    expect(sampleRamp(stops, Infinity)).toBe("#000000");
  });

  it("handles degenerate stop lists", () => {
    expect(sampleRamp(["#123456"], 0.7)).toBe("#123456");
    expect(sampleRamp([], 0.5)).toMatch(HEX);
  });

  it("is monotonic across the ramp for a sequential theme", () => {
    const blues = heatmapStops("Blues");
    const lum = (h: string) =>
      parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
    const samples = Array.from({ length: 20 }, (_, i) => lum(sampleRamp(blues, i / 19)));
    const sorted = [...samples].sort((a, b) => b - a);
    expect(samples).toEqual(sorted); // Blues runs light -> dark
  });
});

describe("normalizeValue", () => {
  it("maps a value onto [0,1]", () => {
    expect(normalizeValue(5, 0, 10)).toBe(0.5);
    expect(normalizeValue(0, 0, 10)).toBe(0);
    expect(normalizeValue(10, 0, 10)).toBe(1);
  });

  it("maps a degenerate domain to the ramp midpoint, not an extreme", () => {
    // A single-valued grid should read as one flat mid color.
    expect(normalizeValue(7, 7, 7)).toBe(0.5);
  });

  it("returns 0 for non-finite inputs", () => {
    expect(normalizeValue(NaN, 0, 1)).toBe(0);
    expect(normalizeValue(1, NaN, 1)).toBe(0);
  });

  it("handles negative domains", () => {
    expect(normalizeValue(-5, -10, 0)).toBe(0.5);
  });
});

describe("legendSwatches", () => {
  it("returns the requested number of hex swatches spanning the ramp", () => {
    const s = legendSwatches(heatmapStops("Blues"), 5);
    expect(s).toHaveLength(5);
    s.forEach((c) => expect(c).toMatch(HEX));
    expect(s[0]).toBe(sampleRamp(heatmapStops("Blues"), 0));
    expect(s[4]).toBe(sampleRamp(heatmapStops("Blues"), 1));
  });
});

describe("HEATMAP_COLOR_THEMES", () => {
  it("offers only ordered scales — qualitative palettes cannot encode magnitude", () => {
    expect(HEATMAP_COLOR_THEMES.length).toBeGreaterThan(0);
    HEATMAP_COLOR_THEMES.forEach((t) =>
      expect(["Sequential", "Diverging"]).toContain(t.group),
    );
  });

  it("includes the reference design's RdYlBu", () => {
    expect(HEATMAP_COLOR_THEMES.map((t) => t.id)).toContain("RdYlBu");
  });
});
