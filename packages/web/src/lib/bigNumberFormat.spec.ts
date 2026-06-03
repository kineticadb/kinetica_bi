import { describe, it, expect } from "vitest";
import { formatBigNumberValue, pickBigNumberColor } from "./bigNumberFormat";

describe("formatBigNumberValue", () => {
  it("formats plain numbers with the configured decimals", () => {
    expect(formatBigNumberValue(1234.5, { format: "number", decimals: 0 })).toBe("1,235");
    expect(formatBigNumberValue(1234.5, { format: "number", decimals: 2 })).toBe("1,234.50");
  });

  it("formats percent / currency / compact", () => {
    expect(formatBigNumberValue(42.3, { format: "percent", decimals: 1 })).toBe("42.3%");
    expect(formatBigNumberValue(1000, { format: "currency", decimals: 2 })).toBe("$1,000.00");
    expect(formatBigNumberValue(1200, { format: "compact", decimals: 1 })).toBe("1.2K");
  });

  it("formats a value as a date — epoch milliseconds", () => {
    const ms = Date.UTC(2026, 4, 27); // 2026-05-27
    const out = formatBigNumberValue(ms, { format: "date" });
    // toLocaleDateString is locale/timezone-dependent; assert it parsed to that date
    expect(out).toBe(new Date(ms).toLocaleDateString());
    expect(out).not.toBe("—");
  });

  it("formats a value as a date — tolerates epoch seconds (|v| < 1e11)", () => {
    const sec = Math.floor(Date.UTC(2026, 4, 27) / 1000);
    const out = formatBigNumberValue(sec, { format: "date" });
    expect(out).toBe(new Date(sec * 1000).toLocaleDateString());
  });

  it("formats a value as a date — parses an ISO string", () => {
    const out = formatBigNumberValue("2026-05-27T00:00:00Z", { format: "date" });
    expect(out).toBe(new Date(Date.parse("2026-05-27T00:00:00Z")).toLocaleDateString());
  });

  it("falls back to the raw string for non-numeric values", () => {
    expect(formatBigNumberValue("N/A", { format: "number" })).toBe("N/A");
    expect(formatBigNumberValue(null, { format: "number" })).toBe("—");
  });
});

describe("pickBigNumberColor", () => {
  const rules = [
    { max: 0, color: "#ef4444" },        // negatives → red
    { min: 0, max: 100, color: "#f59e0b" }, // [0,100) → amber
    { min: 100, color: "#22c55e" },      // >= 100 → green
  ];

  it("returns the first matching rule's color (open-ended low)", () => {
    expect(pickBigNumberColor(-5, "#000", rules)).toBe("#ef4444");
  });

  it("matches a bounded range [min, max)", () => {
    expect(pickBigNumberColor(50, "#000", rules)).toBe("#f59e0b");
    expect(pickBigNumberColor(0, "#000", rules)).toBe("#f59e0b"); // min inclusive
  });

  it("matches open-ended high and treats max as exclusive", () => {
    expect(pickBigNumberColor(100, "#000", rules)).toBe("#22c55e"); // 100 excluded from amber
    expect(pickBigNumberColor(999, "#000", rules)).toBe("#22c55e");
  });

  it("falls back to the base color when no rule matches or value is non-numeric", () => {
    expect(pickBigNumberColor(50, "#000", [{ min: 200, color: "#fff" }])).toBe("#000");
    expect(pickBigNumberColor("x", "#000", rules)).toBe("#000");
    expect(pickBigNumberColor(5, "#000", undefined)).toBe("#000");
  });
});
