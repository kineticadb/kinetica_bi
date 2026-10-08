import { describe, it, expect } from "vitest";
import {
  computeLineXAxisLayout,
  isIsolatedLinePoint,
  lineGroupByColumns,
  lineXColumn,
} from "./lineChartLayout";

describe("lineChartLayout", () => {
  it("LCL-1: horizontal", () => {
    expect(computeLineXAxisLayout({ n: 10, plotWidthPx: 518, maxLabelChars: 12 })).toEqual({ tilt: false, scroll: false, xAxisHeight: 30, minInnerWidth: 0, minInnerHeight: 190 });
  });
  it("LCL-2: tilt only", () => {
    expect(computeLineXAxisLayout({ n: 15, plotWidthPx: 518, maxLabelChars: 12 })).toEqual({ tilt: true, scroll: false, xAxisHeight: 76, minInnerWidth: 0, minInnerHeight: 236 });
  });
  it("LCL-3: scroll", () => {
    expect(computeLineXAxisLayout({ n: 30, plotWidthPx: 518, maxLabelChars: 12 })).toEqual({ tilt: true, scroll: true, xAxisHeight: 76, minInnerWidth: 780, minInnerHeight: 236 });
  });
  it("LCL-4: long labels and floor", () => {
    expect(computeLineXAxisLayout({ n: 15, plotWidthPx: 518, maxLabelChars: 24 }).xAxisHeight).toBe(135);
    expect(computeLineXAxisLayout({ n: 15, plotWidthPx: 518, maxLabelChars: 0 }).xAxisHeight).toBe(30);
  });
  it("LCL-5: boundaries", () => {
    expect(computeLineXAxisLayout({ n: 10, plotWidthPx: 480, maxLabelChars: 5 }).tilt).toBe(false);
    expect(computeLineXAxisLayout({ n: 10, plotWidthPx: 479, maxLabelChars: 5 }).tilt).toBe(true);
    const a = computeLineXAxisLayout({ n: 20, plotWidthPx: 480, maxLabelChars: 5 });
    expect([a.tilt, a.scroll]).toEqual([true, false]);
    expect(computeLineXAxisLayout({ n: 20, plotWidthPx: 479, maxLabelChars: 5 }).scroll).toBe(true);
  });
  it("LCL-6: unknown width", () => {
    const a = computeLineXAxisLayout({ n: 9, plotWidthPx: 0, maxLabelChars: 5 });
    expect([a.tilt, a.scroll]).toEqual([true, false]);
    const b = computeLineXAxisLayout({ n: 8, plotWidthPx: 0, maxLabelChars: 5 });
    expect([b.tilt, b.scroll]).toEqual([false, false]);
    expect(computeLineXAxisLayout({ n: 500, plotWidthPx: 0, maxLabelChars: 5 }).scroll).toBe(false);
  });
  it("LCL-7: isIsolatedLinePoint", () => {
    expect(isIsolatedLinePoint([{ y: null }, { y: 5 }, { y: null }], 1)).toBe(true);
    expect(isIsolatedLinePoint([{ y: 5 }, { y: null }], 0)).toBe(true);
    expect(isIsolatedLinePoint([{ y: null }, { y: 5 }], 1)).toBe(true);
    expect(isIsolatedLinePoint([{ y: 5 }, { y: 6 }], 0)).toBe(false);
    expect(isIsolatedLinePoint([{ y: 5 }], 0)).toBe(true);
    expect(isIsolatedLinePoint([{ y: null }, { y: 5 }, { y: null }], 0)).toBe(false);
    expect(isIsolatedLinePoint([{ y: 5 }, { y: 6 }, { y: null }], 1)).toBe(false);
    expect(isIsolatedLinePoint([undefined, { y: 5 }, undefined], 1)).toBe(true);
  });
  it("LCL-8: lineGroupByColumns drops blanks", () => {
    expect(lineGroupByColumns({ groupByColumns: ["region", "", "pay"] })).toEqual(["region", "pay"]);
    expect(lineGroupByColumns({ groupByColumns: ["region", "  "] })).toEqual(["region"]);
    expect(lineGroupByColumns({ groupByColumns: [1, null, "a"] })).toEqual(["a"]);
    expect(lineGroupByColumns({})).toEqual([]);
    expect(lineGroupByColumns({ groupByColumns: "region" })).toEqual([]);
  });
  it("LCL-9: lineXColumn", () => {
    expect(lineXColumn({ groupByColumns: ["day", "pay"] })).toBe("day");
    expect(lineXColumn({ groupByColumns: [], groupByColumn: "region" })).toBe("region");
    expect(lineXColumn({ groupByColumns: [""], groupByColumn: "" })).toBe("");
    expect(lineXColumn({})).toBe("");
  });
});
