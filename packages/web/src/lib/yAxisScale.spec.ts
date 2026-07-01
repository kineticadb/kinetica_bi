/**
 * Tests for yAxisScale.ts — single source of truth for Y-axis scale props
 * mapped across TimelineRenderer / NumericLineRenderer / WidgetRenderer (bar).
 *
 * RED phase: written before the implementation exists.
 *
 * Key contracts tested:
 *   YAXIS-V119-04: absent mode (undefined) → {} byte-identical (no domain/scale/allowDataOverflow keys)
 *   YAXIS-V119-02: smart mode → ['auto','auto'] domain (no forced 0)
 *   YAXIS-V119-03: log mode → smallest positive value as lower bound; no positive data → {}
 */
import { describe, it, expect } from "vitest";
import { yAxisScaleProps } from "./yAxisScale";

describe("yAxisScaleProps — absent/undefined mode (YAXIS-V119-04 byte-identical guarantee)", () => {
  it("undefined mode → exact empty object {} (no domain, no scale, no allowDataOverflow)", () => {
    expect(yAxisScaleProps(undefined, [1, 2, 3])).toEqual({});
  });
});

describe("yAxisScaleProps — zero mode", () => {
  it("zero mode with data → { domain: [0, 'auto'] }", () => {
    expect(yAxisScaleProps("zero", [1, 2, 3])).toEqual({ domain: [0, "auto"] });
  });

  it("zero mode with empty data → { domain: [0, 'auto'] } (zero never inspects data)", () => {
    expect(yAxisScaleProps("zero", [])).toEqual({ domain: [0, "auto"] });
  });
});

describe("yAxisScaleProps — smart mode (YAXIS-V119-02 no forced 0)", () => {
  it("smart mode with data → { domain: ['auto', 'auto'] }", () => {
    expect(yAxisScaleProps("smart", [5, 9, 20])).toEqual({ domain: ["auto", "auto"] });
  });
});

describe("yAxisScaleProps — log mode (YAXIS-V119-03 positive-min clamp)", () => {
  it("log mode with all positive values → uses smallest positive as lower bound", () => {
    expect(yAxisScaleProps("log", [10, 2, 50])).toEqual({
      scale: "log",
      domain: [2, "auto"],
      allowDataOverflow: true,
    });
  });

  it("log mode with mixed positive/non-positive values → smallest POSITIVE is lower bound", () => {
    expect(yAxisScaleProps("log", [-5, 0, 8, 3])).toEqual({
      scale: "log",
      domain: [3, "auto"],
      allowDataOverflow: true,
    });
  });

  it("log mode with only non-positive values → {} (graceful degrade, no positive data)", () => {
    expect(yAxisScaleProps("log", [0, -1, -3])).toEqual({});
  });

  it("log mode with empty array → {} (no positive data → graceful degrade)", () => {
    expect(yAxisScaleProps("log", [])).toEqual({});
  });

  it("log mode with NaN/Infinity in values → excluded from positive-min, uses only finite positives", () => {
    expect(yAxisScaleProps("log", [NaN, 4, Infinity, 4])).toEqual({
      scale: "log",
      domain: [4, "auto"],
      allowDataOverflow: true,
    });
  });
});
