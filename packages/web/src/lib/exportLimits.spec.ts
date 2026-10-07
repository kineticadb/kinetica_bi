import { describe, it, expect } from "vitest";
import { DEFAULT_EXPORT_LIMITS, normalizeExportLimits } from "./exportLimits";

describe("normalizeExportLimits", () => {
  it("EXPLIM-normalize-valid: passes valid values through", () => {
    const v = { maxRows: 10000000, maxFileMb: 2048, maxConcurrentPerUser: 3 };
    expect(normalizeExportLimits(v)).toEqual(v);
  });
  it("EXPLIM-normalize-nulls: null caps stay null", () => {
    const v = { maxRows: null, maxFileMb: null, maxConcurrentPerUser: 2 };
    expect(normalizeExportLimits(v)).toEqual(v);
  });
  it("EXPLIM-normalize-missing: non-objects yield a fresh default", () => {
    for (const raw of [undefined, null, "x", []]) {
      const r = normalizeExportLimits(raw);
      expect(r).toEqual(DEFAULT_EXPORT_LIMITS);
      expect(r).not.toBe(DEFAULT_EXPORT_LIMITS);
    }
  });
  it("EXPLIM-normalize-bad-fields: invalid fields fall back", () => {
    expect(normalizeExportLimits({ maxRows: -1, maxFileMb: "2048", maxConcurrentPerUser: 0 })).toEqual({ maxRows: null, maxFileMb: null, maxConcurrentPerUser: 2 });
    expect(normalizeExportLimits({ maxRows: 1.5, maxFileMb: 1, maxConcurrentPerUser: 1.5 })).toEqual({ maxRows: null, maxFileMb: 1, maxConcurrentPerUser: 2 });
  });
});
