import { describe, it, expect } from "vitest";
import { estimateAxisWidth, estimateValueAxisWidth } from "./estimateAxisWidth";

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
});
