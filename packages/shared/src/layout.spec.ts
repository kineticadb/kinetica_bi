import { describe, it, expect } from "vitest";
import {
  AI_DEFAULT_SIZE, AI_GRID_COLS, placeWidget, rectsOverlap, resolveRect, validateLayout, type GridRect,
} from "./layout";
import { AI_WIDGET_TYPES } from "./aiAsk";

describe("layout", () => {
  it("LAYOUT-1 resolveRect fallback and per-field fill", () => {
    expect([0, 1, 2, 3].map((i) => resolveRect(undefined, i))).toEqual([
      { x: 0, y: 0, w: 18, h: 24 }, { x: 18, y: 0, w: 18, h: 24 },
      { x: 0, y: 24, w: 18, h: 24 }, { x: 18, y: 24, w: 18, h: 24 },
    ]);
    expect(resolveRect({ x: 1, y: 2, w: 7, h: 8 }, 3)).toEqual({ x: 1, y: 2, w: 7, h: 8 });
    expect(resolveRect({ w: 9 }, 1)).toEqual({ x: 18, y: 0, w: 9, h: 24 });
  });
  it("LAYOUT-2 empty dashboard", () => {
    expect(placeWidget([], { w: 18, h: 30 })).toEqual({ x: 0, y: 0, w: 18, h: 30, below: false });
  });
  it("LAYOUT-3 beside and below", () => {
    const a = placeWidget([{ x: 0, y: 0, w: 18, h: 30 }], { w: 18, h: 30 });
    expect(a).toMatchObject({ x: 18, y: 0, below: false });
    const b = placeWidget([{ x: 0, y: 0, w: 18, h: 30 }, { x: 18, y: 0, w: 18, h: 30 }], { w: 9, h: 14 });
    expect(b).toMatchObject({ x: 0, y: 30, below: true });
  });
  it("LAYOUT-4 interior gap", () => {
    const r = placeWidget([{ x: 0, y: 0, w: 36, h: 10 }, { x: 0, y: 30, w: 36, h: 10 }], { w: 36, h: 20 });
    expect(r).toMatchObject({ y: 10, below: false });
  });
  it("LAYOUT-5 no-overlap fuzz", () => {
    let s = 12345;
    const rnd = (n: number) => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s % n; };
    for (let t = 0; t < 200; t++) {
      const existing: GridRect[] = [];
      for (let k = 0; k < rnd(6); k++) {
        const w = 6 + rnd(31), h = 6 + rnd(40);
        const cand = { x: rnd(AI_GRID_COLS - w + 1), y: rnd(60), w, h };
        if (!existing.some((e) => rectsOverlap(cand, e))) existing.push(cand);
      }
      const size = { w: 6 + rnd(31), h: 6 + rnd(40) };
      const r = placeWidget(existing, size);
      expect(existing.some((e) => rectsOverlap(r, e))).toBe(false);
      expect(r.x + r.w).toBeLessThanOrEqual(AI_GRID_COLS);
    }
  });
  it("LAYOUT-6 validateLayout", () => {
    const ok = { x: 0, y: 0, w: 18, h: 10 };
    expect(validateLayout([{ id: 1, ...ok }, { id: 2, ...ok, x: 18 }, { id: 3, ...ok, y: 10 }]).valid).toBe(true);
    const bad = (r: object) => validateLayout([{ id: 1, ...ok, ...r }]).valid;
    expect(bad({ x: 20 })).toBe(false);
    expect(bad({ w: 5 })).toBe(false);
    expect(bad({ h: 5 })).toBe(false);
    expect(bad({ h: 201 })).toBe(false);
    expect(bad({ x: -1 })).toBe(false);
    expect(bad({ y: -1 })).toBe(false);
    expect(bad({ w: 7.5 })).toBe(false);
    const o = validateLayout([{ id: 4, ...ok }, { id: 9, ...ok, x: 17 }]);
    expect(o.valid).toBe(false);
    if (!o.valid) expect(o.reasons.join()).toMatch(/4 and 9 overlap/);
  });
  it("LAYOUT-7 default sizes", () => {
    expect(AI_DEFAULT_SIZE).toEqual({
      bignumber: { w: 9, h: 14 }, bar: { w: 18, h: 30 }, line: { w: 18, h: 30 }, pie: { w: 18, h: 30 },
      table: { w: 18, h: 36 }, records: { w: 36, h: 36 }, map: { w: 28, h: 45 },
    });
    expect(Object.keys(AI_DEFAULT_SIZE).sort()).toEqual([...AI_WIDGET_TYPES].sort());
  });
});
