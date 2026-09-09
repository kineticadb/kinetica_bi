import { describe, it, expect } from "vitest";
import {
  estimateAxisWidth,
  estimateLabelWidth,
  estimateValueAxisWidth,
} from "./estimateAxisWidth";

describe("estimateAxisWidth", () => {
  it("short SI labels produce a narrower axis than long raw labels", () => {
    const si = estimateAxisWidth(["0", "4.5M", "9M", "18M"]);
    const raw = estimateAxisWidth(["0", "4,500,000", "9,000,000", "18,000,000"]);
    expect(si).toBeLessThan(raw);
  });

  it("clamps to the [34, 80] range", () => {
    expect(estimateAxisWidth([""])).toBe(34); // floor
    expect(estimateAxisWidth(["x"])).toBe(34); // still floor
    expect(estimateAxisWidth(["a very long label that exceeds the cap"])).toBe(80); // ceiling
  });

  it("sizes by the LONGEST label, not the count", () => {
    const oneLong = estimateAxisWidth(["1.2M", "888.8M"]);
    const allShort = estimateAxisWidth(["1M", "2M", "3M", "4M", "5M"]);
    expect(oneLong).toBeGreaterThan(allShort);
  });
});

describe("estimateLabelWidth", () => {
  // HeatmapRenderer compares this against a cell's width to decide whether an x
  // tick label fits horizontally or must be rotated, so — unlike estimateAxisWidth
  // — it must NOT clamp and must NOT add a gutter. Clamping would report a 1-char
  // label as 34px wide and rotate labels that fit fine.
  it("grows monotonically with label length", () => {
    expect(estimateLabelWidth("1")).toBeLessThan(estimateLabelWidth("12"));
    expect(estimateLabelWidth("12")).toBeLessThan(estimateLabelWidth("Wednesday"));
  });

  it("does NOT clamp to the axis floor — a short label stays small", () => {
    // estimateAxisWidth(["1"]) floors at 34; the raw extent must stay well under it
    // or every narrow cell would rotate its labels needlessly.
    expect(estimateLabelWidth("1")).toBeLessThan(estimateAxisWidth(["1"]));
    expect(estimateLabelWidth("1")).toBeLessThan(10);
  });

  it("does NOT clamp to the axis ceiling — a very long label exceeds 80px", () => {
    const long = "a very long label that exceeds the cap";
    expect(estimateAxisWidth([long])).toBe(80); // clamped
    expect(estimateLabelWidth(long)).toBeGreaterThan(80); // unclamped
  });

  it("adds no gutter — it is narrower than the axis width for the same label", () => {
    expect(estimateLabelWidth("888.8M")).toBeLessThan(estimateAxisWidth(["888.8M"]));
  });

  it("treats an empty or missing label as zero width", () => {
    expect(estimateLabelWidth("")).toBe(0);
    expect(estimateLabelWidth(undefined as unknown as string)).toBe(0);
  });
});

describe("estimateValueAxisWidth", () => {
  it("returns the floor when there are no finite values", () => {
    expect(estimateValueAxisWidth([NaN, Infinity, -Infinity], (v) => String(v))).toBe(34);
    expect(estimateValueAxisWidth([], (v) => String(v))).toBe(34);
  });

  it("SI formatter yields a narrower axis than a raw comma formatter for the same data", () => {
    const data = [1_234_567, 17_000_000, 4_500_000, 0];
    const siWidth = estimateValueAxisWidth(data, (v) =>
      v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : String(v),
    );
    const rawWidth = estimateValueAxisWidth(data, (v) => v.toLocaleString("en-US"));
    expect(siWidth).toBeLessThan(rawWidth);
  });

  it("accounts for negative extremes (formats min, not just max)", () => {
    const positiveOnly = estimateValueAxisWidth([1000, 2000], (v) => String(v));
    const withNegative = estimateValueAxisWidth([1000, -2_000_000], (v) => String(v));
    expect(withNegative).toBeGreaterThan(positiveOnly);
  });

  it("sizes to rounded ticks, not raw float extremes (recharts draws nice ticks)", () => {
    // AVG-style float data (e.g. "DL Speed"): recharts renders short rounded ticks ("385"),
    // so the axis must not be sized to the raw 8-char "384.7156" — that over-reserves to the
    // 80px cap and wastes plot width on narrow widgets.
    const floaty = estimateValueAxisWidth(
      [164.83217, 384.71563, 275.109876, 330.44, 180.6667],
      (v) => String(v),
    );
    const integers = estimateValueAxisWidth([165, 385, 275, 330, 180], (v) => String(v));
    expect(floaty).toBe(integers);
    expect(floaty).toBeLessThan(50); // ~3-digit ticks, nowhere near the 80px cap
  });

  it("preserves width for genuinely long integer labels", () => {
    const wide = estimateValueAxisWidth([0, 1_234_567], (v) => v.toLocaleString("en-US"));
    const narrow = estimateValueAxisWidth([0, 385], (v) => String(v));
    // "1,200,000"-class labels still reserve a wide axis — rounding drops fractional noise,
    // not integer digits — and stay far wider than a 3-digit axis.
    expect(wide).toBeGreaterThan(70);
    expect(wide).toBeGreaterThan(narrow + 30);
  });
});
