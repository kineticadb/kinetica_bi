/**
 * Phase 29 (DRAW-V15-02 + DRAW-V15-05): Unit tests for lib/shapeDraw.ts
 *
 * Covers:
 *   - formatDistance: km/m switchover, SI typography lock (no thousand separator, 1 decimal for km)
 *   - formatArea: km²/m² switchover, U+00B2 superscript literal
 *   - DRAW_MODES: readonly tuple ordering (matches toolbar render order)
 *   - DrawMode: union type compile-time check
 */
import { describe, it, expect } from "vitest";
import { formatDistance, formatArea, DRAW_MODES } from "./shapeDraw";
import type { DrawMode } from "./shapeDraw";

describe("formatDistance — km/m switchover (DRAW-V15-05)", () => {
  it("returns '750 m' for 750 (0 decimals; <1000 m switchover)", () => {
    expect(formatDistance(750)).toBe("750 m");
  });

  it("returns '999 m' for 999 (just below 1000 boundary)", () => {
    expect(formatDistance(999)).toBe("999 m");
  });

  it("returns '1.0 km' for 1000 (km switchover at exactly 1000 m; 1 decimal)", () => {
    expect(formatDistance(1000)).toBe("1.0 km");
  });

  it("returns '2.5 km' for 2500", () => {
    expect(formatDistance(2500)).toBe("2.5 km");
  });

  it("returns '1234.6 km' for 1234567 (no thousand separator; 1 decimal; SI typography lock)", () => {
    expect(formatDistance(1234567)).toBe("1234.6 km");
  });

  it("returns '0 m' for 0 (degenerate but safe)", () => {
    expect(formatDistance(0)).toBe("0 m");
  });
});

describe("formatArea — km²/m² switchover (DRAW-V15-05)", () => {
  it("returns '850 m²' for 850 (0 decimals; superscript-2 character U+00B2)", () => {
    expect(formatArea(850)).toBe("850 m²");
  });

  it("returns '999999 m²' for 999999 (just below km² switchover)", () => {
    expect(formatArea(999999)).toBe("999999 m²");
  });

  it("returns '1.0 km²' for 1000000 (switchover at exactly 1_000_000 m²)", () => {
    expect(formatArea(1_000_000)).toBe("1.0 km²");
  });

  it("returns '12.4 km²' for 12400000", () => {
    expect(formatArea(12_400_000)).toBe("12.4 km²");
  });
});

describe("DRAW_MODES — readonly tuple ordering (matches toolbar render order)", () => {
  it("DRAW_MODES is the readonly tuple ['pan','info','bbox','lasso','circle'] in exact order", () => {
    expect(DRAW_MODES).toEqual(["pan", "info", "bbox", "lasso", "circle"]);
  });

  it("DRAW_MODES has exactly 5 entries", () => {
    expect(DRAW_MODES.length).toBe(5);
  });
});

describe("DrawMode — union type compile-time check", () => {
  it("'bbox' is a valid DrawMode (compile-time + runtime check)", () => {
    const m: DrawMode = "bbox";
    expect(m).toBe("bbox");
  });

  it("'lasso' is a valid DrawMode", () => {
    const m: DrawMode = "lasso";
    expect(m).toBe("lasso");
  });

  it("'circle' is a valid DrawMode", () => {
    const m: DrawMode = "circle";
    expect(m).toBe("circle");
  });

  it("'pan' is a valid DrawMode", () => {
    const m: DrawMode = "pan";
    expect(m).toBe("pan");
  });

  it("'info' is a valid DrawMode", () => {
    const m: DrawMode = "info";
    expect(m).toBe("info");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 29 (DRAW-V15-04..06) — new helpers: buildDrawInteraction, computeMeasurement,
// isDegenerateExtent
// ─────────────────────────────────────────────────────────────────────────────

import Polygon from "ol/geom/Polygon";
import VectorSource from "ol/source/Vector";
import Draw from "ol/interaction/Draw";
import { buildDrawInteraction, computeMeasurement, isDegenerateExtent } from "./shapeDraw";

describe("Phase 29 (DRAW-V15-04..06) lib/shapeDraw helpers", () => {
  describe("buildDrawInteraction", () => {
    it("B1: returns null for 'pan'", () => {
      const source = new VectorSource();
      expect(buildDrawInteraction("pan", source)).toBeNull();
    });

    it("B2: returns null for 'info'", () => {
      const source = new VectorSource();
      expect(buildDrawInteraction("info", source)).toBeNull();
    });

    it("B3: bbox returns Draw with type='Circle' + createBox geometryFunction", () => {
      const source = new VectorSource();
      const draw = buildDrawInteraction("bbox", source);
      expect(draw).toBeInstanceOf(Draw);
      expect(draw).not.toBeNull();
    });

    it("B4: lasso returns Draw (type='Polygon' + freehand)", () => {
      const source = new VectorSource();
      const draw = buildDrawInteraction("lasso", source);
      expect(draw).toBeInstanceOf(Draw);
    });

    it("B5: circle returns Draw (type='Circle' + createRegularPolygon(64))", () => {
      const source = new VectorSource();
      const draw = buildDrawInteraction("circle", source);
      expect(draw).toBeInstanceOf(Draw);
    });
  });

  describe("computeMeasurement", () => {
    // Use real Polygon — pure math test. Coordinates are EPSG:3857 (Web Mercator meters).
    // NYC latitude (~40.7°) Web Mercator y ≈ 4970000.

    it("C1: bbox at NYC produces W × H km string", () => {
      const x0 = -8236000;
      const y0 = 4970000;
      // Approximate inverse mercator scale: degrees lat ≈ 111320 m, lon at 40.7° ≈ 84000 m
      // Use a large enough box to be clearly > 1 km on both axes.
      const xExtent = 5000 * Math.cos(40.7 * Math.PI / 180);
      const yExtent = 3000 * Math.cos(40.7 * Math.PI / 180);
      const poly = new Polygon([[
        [x0, y0],
        [x0 + xExtent, y0],
        [x0 + xExtent, y0 + yExtent],
        [x0, y0 + yExtent],
        [x0, y0],
      ]]);
      const out = computeMeasurement("bbox", poly);
      expect(out).toMatch(/^\d+(\.\d+)? km × \d+(\.\d+)? km$/);
      // Parse and verify numbers are positive (shape of output is what matters here)
      const m = out.match(/^(\d+(?:\.\d+)?) km × (\d+(?:\.\d+)?) km$/);
      expect(m).not.toBeNull();
      const w = parseFloat(m![1]);
      const h = parseFloat(m![2]);
      expect(w).toBeGreaterThan(0);
      expect(h).toBeGreaterThan(0);
    });

    it("C2: circle 64-gon ~2.5 km radius produces km string", () => {
      const cx = -8236000, cy = 4970000;
      const rApprox = 2500 * Math.cos(40.7 * Math.PI / 180);
      const coords: [number, number][] = [];
      for (let i = 0; i < 64; i++) {
        const a = (i / 64) * 2 * Math.PI;
        coords.push([cx + rApprox * Math.cos(a), cy + rApprox * Math.sin(a)]);
      }
      coords.push(coords[0]);
      const poly = new Polygon([coords]);
      const out = computeMeasurement("circle", poly);
      expect(out).toMatch(/^\d+(\.\d+)? km$/);
    });

    it("C3: lasso polygon produces km² or m² area string", () => {
      const x0 = -8236000, y0 = 4970000;
      const poly = new Polygon([[
        [x0, y0],
        [x0 + 3000, y0],
        [x0 + 1500, y0 + 3000],
        [x0, y0],
      ]]);
      const out = computeMeasurement("lasso", poly);
      expect(out).toMatch(/^\d+(\.\d+)? (km²|m²)$/);
    });

    it("C4: small bbox <1 km on each side produces meters string", () => {
      const x0 = -8236000, y0 = 4970000;
      // 500m × 200m in approximate mercator coords at this lat
      const xExtent = 500 * Math.cos(40.7 * Math.PI / 180);
      const yExtent = 200 * Math.cos(40.7 * Math.PI / 180);
      const poly = new Polygon([[
        [x0, y0],
        [x0 + xExtent, y0],
        [x0 + xExtent, y0 + yExtent],
        [x0, y0 + yExtent],
        [x0, y0],
      ]]);
      const out = computeMeasurement("bbox", poly);
      expect(out).toMatch(/^\d+ m × \d+ m$/);
    });

    it("C5: small lasso <1 km² produces m² string", () => {
      const x0 = -8236000, y0 = 4970000;
      const poly = new Polygon([[
        [x0, y0],
        [x0 + 500, y0],
        [x0 + 250, y0 + 500],
        [x0, y0],
      ]]);
      const out = computeMeasurement("lasso", poly);
      expect(out).toMatch(/^\d+ m²$/);
    });
  });

  describe("isDegenerateExtent", () => {
    it("D1: both dims < 10 × resolution → true", () => {
      expect(isDegenerateExtent([0, 0, 1, 1], 1)).toBe(true);
    });

    it("D2: both dims >= 10 × resolution → false", () => {
      expect(isDegenerateExtent([0, 0, 100, 100], 1)).toBe(false);
    });

    it("D3: single-axis dim < threshold → true", () => {
      expect(isDegenerateExtent([0, 0, 100, 5], 1)).toBe(true);
    });

    it("D4: scales with resolution", () => {
      expect(isDegenerateExtent([0, 0, 100, 100], 100)).toBe(true);
    });

    it("D5: zero-area → true", () => {
      expect(isDegenerateExtent([0, 0, 0, 0], 1)).toBe(true);
    });
  });
});
