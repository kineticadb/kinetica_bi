import { describe, it, expect } from "vitest";
import {
  normalizeAARRGGBB,
  rgbFromAARRGGBB,
  alphaFromAARRGGBB,
  joinAARRGGBB,
  alphaPercentToHex,
  alphaHexToPercent,
} from "./colorHex";

describe("normalizeAARRGGBB", () => {
  it("returns an 8-char value unchanged (upper-case)", () => {
    expect(normalizeAARRGGBB("80ff3838")).toBe("80FF3838");
    expect(normalizeAARRGGBB("FFFFFFFF")).toBe("FFFFFFFF");
  });

  it("pads a 6-char value with FF (opaque) alpha", () => {
    expect(normalizeAARRGGBB("FF3838")).toBe("FFFF3838");
    expect(normalizeAARRGGBB("3b82f6")).toBe("FF3B82F6");
  });

  it("strips a leading # prefix", () => {
    expect(normalizeAARRGGBB("#FF3838")).toBe("FFFF3838");
    expect(normalizeAARRGGBB("#80FF3838")).toBe("80FF3838");
  });

  it("falls back to the supplied default on undefined / empty / malformed input", () => {
    expect(normalizeAARRGGBB(undefined)).toBe("FFFFFFFF");
    expect(normalizeAARRGGBB("")).toBe("FFFFFFFF");
    expect(normalizeAARRGGBB("not-a-color", "FFFF3838")).toBe("FFFF3838");
    expect(normalizeAARRGGBB("ZZZZZZ", "FFFF3838")).toBe("FFFF3838");
    expect(normalizeAARRGGBB("ABC", "FFFF3838")).toBe("FFFF3838"); // 3-char short-form not supported
  });
});

describe("rgbFromAARRGGBB / alphaFromAARRGGBB", () => {
  it("splits an 8-char value into alpha and rgb halves", () => {
    expect(alphaFromAARRGGBB("80FF3838")).toBe("80");
    expect(rgbFromAARRGGBB("80FF3838")).toBe("FF3838");
  });

  it("treats a 6-char value as opaque (alpha=FF)", () => {
    expect(alphaFromAARRGGBB("FF3838")).toBe("FF");
    expect(rgbFromAARRGGBB("FF3838")).toBe("FF3838");
  });
});

describe("joinAARRGGBB", () => {
  it("concatenates alpha and rgb upper-cased", () => {
    expect(joinAARRGGBB("80", "FF3838")).toBe("80FF3838");
  });

  it("tolerates # prefixes and lower-case", () => {
    expect(joinAARRGGBB("#80", "#ff3838")).toBe("80FF3838");
  });

  it("pads short alpha to 2 chars with leading zero", () => {
    expect(joinAARRGGBB("F", "FF3838")).toBe("0FFF3838");
  });

  it("pads short rgb to 6 chars with leading zeros", () => {
    expect(joinAARRGGBB("80", "ABC")).toBe("80000ABC");
  });
});

describe("alphaPercentToHex / alphaHexToPercent", () => {
  it("round-trips 0 / 50 / 100 reasonably", () => {
    expect(alphaPercentToHex(0)).toBe("00");
    expect(alphaPercentToHex(100)).toBe("FF");
    expect(alphaHexToPercent("00")).toBe(0);
    expect(alphaHexToPercent("FF")).toBe(100);
    // 50% → 0x80 (128) → 50%
    expect(alphaPercentToHex(50)).toBe("80");
    expect(alphaHexToPercent("80")).toBe(50);
  });

  it("clamps out-of-range percents to [0, 100]", () => {
    expect(alphaPercentToHex(-10)).toBe("00");
    expect(alphaPercentToHex(150)).toBe("FF");
  });

  it("rejects NaN / non-finite percents with FF fallback (opaque)", () => {
    expect(alphaPercentToHex(NaN)).toBe("FF");
    expect(alphaPercentToHex(Infinity)).toBe("FF");
  });

  it("returns 100% for malformed hex byte (defensive fallback)", () => {
    expect(alphaHexToPercent("ZZ")).toBe(100);
  });
});
