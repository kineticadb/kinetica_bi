import { describe, it, expect } from "vitest";
import { contrastRatio, passesAA } from "../wcag";

describe("contrastRatio", () => {
  it("returns ~21 for black on white", () => {
    const ratio = contrastRatio("#000000", "#ffffff");
    expect(ratio).toBeGreaterThan(20);
    expect(ratio).toBeLessThanOrEqual(21.1);
  });

  it("returns 1 for identical colors", () => {
    const ratio = contrastRatio("#777777", "#777777");
    expect(ratio).toBeCloseTo(1, 1);
  });

  it("returns a ratio >= 1 for any pair", () => {
    expect(contrastRatio("#0a0a12", "#ece9f6")).toBeGreaterThanOrEqual(1);
  });
});

describe("passesAA", () => {
  it("returns true at the 4.5 threshold boundary", () => {
    expect(passesAA(4.5)).toBe(true);
  });

  it("returns false just below threshold", () => {
    expect(passesAA(4.49)).toBe(false);
  });

  it("returns true well above threshold", () => {
    expect(passesAA(7.0)).toBe(true);
  });

  it("respects custom threshold", () => {
    expect(passesAA(3.0, 3.0)).toBe(true);
    expect(passesAA(2.9, 3.0)).toBe(false);
  });
});
