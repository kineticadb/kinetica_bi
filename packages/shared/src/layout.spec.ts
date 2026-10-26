import { describe, it, expect } from "vitest";
import {
  AI_DEFAULT_SIZE, AI_GRID_COLS, GENERATE_AI_RECT, GENERATE_MAIN_COLS, placeGenerateBands, placeWidget, rectsOverlap, resolveRect, validateLayout, type GridRect,
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
      table: { w: 18, h: 36 }, records: { w: 36, h: 36 }, map: { w: 28, h: 45 }, timeline: { w: 18, h: 30 },
    });
    expect(Object.keys(AI_DEFAULT_SIZE).sort()).toEqual([...AI_WIDGET_TYPES].sort());
  });
});

describe("placeGenerateBands", () => {
  const mk = (types: string[]) => types.map((type, i) => ({ key: -(i + 1), type }));
  it("GENBAND-1 constants", () => {
    expect(GENERATE_MAIN_COLS).toBe(24);
    expect(GENERATE_AI_RECT).toEqual({ x: 24, y: 0, w: 12, h: 40 });
  });
  it("GENBAND-2 canonical mix", () => {
    const r = placeGenerateBands(mk(["bignumber", "bignumber", "line", "bar", "pie", "map", "records"]));
    expect(r[-1]).toEqual({ x: 0, y: 0, w: 12, h: 14 });
    expect(r[-2]).toEqual({ x: 12, y: 0, w: 12, h: 14 });
    expect(r[-3]).toEqual({ x: 0, y: 14, w: 12, h: 30 });
    expect(r[-4]).toEqual({ x: 12, y: 14, w: 12, h: 30 });
    expect(r[-5]).toEqual({ x: 0, y: 44, w: 24, h: 30 });
    expect(r[-6]).toEqual({ x: 0, y: 74, w: 24, h: 40 });
    expect(r[-7]).toEqual({ x: 0, y: 114, w: 36, h: 36 });
  });
  it("GENBAND-3 KPI rows", () => {
    const three = placeGenerateBands(mk(["bignumber", "bignumber", "bignumber"]));
    expect([-1, -2, -3].map((k) => [three[k].x, three[k].w, three[k].h])).toEqual([[0, 8, 14], [8, 8, 14], [16, 8, 14]]);
    expect(placeGenerateBands(mk(["bignumber"]))[-1]).toEqual({ x: 0, y: 0, w: 12, h: 14 });
    const four = placeGenerateBands(mk(["bignumber", "bignumber", "bignumber", "bignumber"]));
    expect([-1, -2, -3].map((k) => four[k].y)).toEqual([0, 0, 0]);
    expect(four[-4]).toEqual({ x: 0, y: 14, w: 12, h: 14 });
  });
  it("GENBAND-4 records clears the AI column", () => {
    const r = placeGenerateBands(mk(["bignumber", "bignumber", "records"]));
    expect(r[-3]).toEqual({ x: 0, y: 40, w: 36, h: 36 });
  });
  it("GENBAND-5 group order ignores input order", () => {
    const r = placeGenerateBands(mk(["records", "map", "bar", "bignumber"]));
    expect(r[-4].y).toBe(0);
    expect(r[-3]).toMatchObject({ y: 14, w: 24 });
    expect(r[-2].y).toBe(44);
    expect(r[-1].y).toBe(84);
    const l = placeGenerateBands([{ key: -1, type: "bar" }, { key: -2, type: "line" }]);
    expect(l[-2].x).toBe(0);
    expect(l[-1].x).toBe(12);
  });
  it("GENBAND-TL-1 a timeline takes the trend slot ahead of breakdowns", () => {
    const r = placeGenerateBands([{ key: -1, type: "bar" }, { key: -2, type: "pie" }, { key: -3, type: "timeline" }]);
    expect(r[-3]).toEqual({ x: 0, y: 0, w: 12, h: 30 });
    expect(r[-1]).toEqual({ x: 12, y: 0, w: 12, h: 30 });
    expect(r[-2]).toEqual({ x: 0, y: 30, w: 24, h: 30 });
    expect(AI_DEFAULT_SIZE.timeline).toEqual(AI_DEFAULT_SIZE.line);
  });
  it("GENBAND-6 exhaustive 4..8 mixes validate with the AI rect", () => {
    let checked = 0;
    for (let k = 0; k <= 3; k++) for (let l = 0; l <= 1; l++) for (let b = 0; b <= 2; b++) for (let m = 0; m <= 1; m++) for (let rc = 0; rc <= 1; rc++) {
      for (let bt = 0; bt <= b; bt++) for (let pt = 0; pt <= b - bt; pt++) {
        const tb = b - bt - pt;
        const types = [
          ...Array(k).fill("bignumber"), ...Array(l).fill("line"), ...Array(bt).fill("bar"),
          ...Array(pt).fill("pie"), ...Array(tb).fill("table"), ...Array(m).fill("map"), ...Array(rc).fill("records"),
        ] as string[];
        if (types.length < 4 || types.length > 8) continue;
        const rects = placeGenerateBands(mk(types));
        const items = types.map((_, i) => ({ id: -(i + 1), ...rects[-(i + 1)] }));
        expect(validateLayout([...items, { id: 1, ...GENERATE_AI_RECT }])).toEqual({ valid: true });
        for (const it of items) if (it.y < 40) expect(it.x + it.w).toBeLessThanOrEqual(24);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
  it("GENBAND-7 unknown type goes to the middle band", () => {
    const r = placeGenerateBands(mk(["bignumber", "gauge", "records", "map"]));
    expect(r[-2]).toEqual({ x: 0, y: 14, w: 24, h: 30 });
    expect(validateLayout([-1, -2, -3, -4].map((k) => ({ id: k, ...r[k] })).concat([{ id: 1, ...GENERATE_AI_RECT }]))).toEqual({ valid: true });
  });
});
