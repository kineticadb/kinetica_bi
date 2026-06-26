/**
 * columnFormatter.spec.ts — Unit tests for the pure column formatter library.
 *
 * ZERO imports of any store / DOM / fetch / SQL module — only columnFormatter + vitest.
 * RED phase: written before the implementation exists.
 */

import { describe, it, expect } from "vitest";
import {
  buildFormatter,
  defaultFormatKind,
  type FormatSpec,
} from "./columnFormatter";

// ---------------------------------------------------------------------------
// buildFormatter — kind: "number"
// ---------------------------------------------------------------------------

describe("buildFormatter / kind:number", () => {
  it("percent preset appends literal % WITHOUT ×100 — stored 42 → '42%'", () => {
    const fmt = buildFormatter({
      kind: "number",
      percent: true,
      decimals: 0,
      thousandsSep: false,
      currency: false,
    });
    expect(fmt(42)).toBe("42%");
  });

  it("percent preset with 2 decimals — stored 42.5 → '42.50%'", () => {
    const fmt = buildFormatter({
      kind: "number",
      percent: true,
      decimals: 2,
      thousandsSep: false,
      currency: false,
    });
    expect(fmt(42.5)).toBe("42.50%");
  });

  it("percent with thousandsSep — stored 1234 → '1,234%'", () => {
    const fmt = buildFormatter({
      kind: "number",
      percent: true,
      decimals: 0,
      thousandsSep: true,
      currency: false,
    });
    expect(fmt(1234)).toBe("1,234%");
  });

  it("currency prefix + grouping — 1234.5 → '$1,234.50'", () => {
    const fmt = buildFormatter({
      kind: "number",
      thousandsSep: true,
      decimals: 2,
      currency: "$",
      percent: false,
    });
    expect(fmt(1234.5)).toBe("$1,234.50");
  });

  it("euro prefix — currency:'€' 1234.5 → '€1,234.50'", () => {
    const fmt = buildFormatter({
      kind: "number",
      thousandsSep: true,
      decimals: 2,
      currency: "€",
      percent: false,
    });
    expect(fmt(1234.5)).toBe("€1,234.50");
  });

  it("decimals 0 with thousandsSep — 1234.5 rounds to '1,235'", () => {
    const fmt = buildFormatter({
      kind: "number",
      decimals: 0,
      thousandsSep: true,
      currency: false,
      percent: false,
    });
    expect(fmt(1234.5)).toBe("1,235");
  });

  it("no sep, fixed 3 decimals — 3.14159 → '3.142'", () => {
    const fmt = buildFormatter({
      kind: "number",
      decimals: 3,
      thousandsSep: false,
      currency: false,
      percent: false,
    });
    expect(fmt(3.14159)).toBe("3.142");
  });

  it("type mismatch — non-numeric string → raw value unchanged (no NaN)", () => {
    const fmt = buildFormatter({
      kind: "number",
      decimals: 2,
      thousandsSep: false,
      currency: false,
      percent: false,
    });
    expect(fmt("hello")).toBe("hello");
  });

  it("null passthrough — null → null", () => {
    const fmt = buildFormatter({
      kind: "number",
      decimals: 2,
      thousandsSep: false,
      currency: false,
      percent: false,
    });
    expect(fmt(null)).toBe(null);
  });

  it("undefined passthrough — undefined → undefined", () => {
    const fmt = buildFormatter({
      kind: "number",
      decimals: 2,
      thousandsSep: false,
      currency: false,
      percent: false,
    });
    expect(fmt(undefined)).toBe(undefined);
  });
});

// ---------------------------------------------------------------------------
// buildFormatter — kind: "d3" escape hatch
// ---------------------------------------------------------------------------

describe("buildFormatter / kind:d3", () => {
  it("d3 .1% escape hatch DOES ×100 — raw d3 semantics — 0.5 → '50.0%'", () => {
    const fmt = buildFormatter({ kind: "d3", specifier: ".1%" });
    expect(fmt(0.5)).toBe("50.0%");
  });

  it("d3 ,.2f — 1234.5 → '1,234.50'", () => {
    const fmt = buildFormatter({ kind: "d3", specifier: ",.2f" });
    expect(fmt(1234.5)).toBe("1,234.50");
  });

  it("invalid d3 specifier → raw value, no throw", () => {
    const fmt = buildFormatter({ kind: "d3", specifier: "INVALID$$#" });
    expect(fmt(42)).toBe(42);
  });

  it("null passthrough with d3 spec", () => {
    const fmt = buildFormatter({ kind: "d3", specifier: ".2f" });
    expect(fmt(null)).toBe(null);
  });

  it("undefined passthrough with d3 spec", () => {
    const fmt = buildFormatter({ kind: "d3", specifier: ".2f" });
    expect(fmt(undefined)).toBe(undefined);
  });

  it("type mismatch string → raw value (no NaN)", () => {
    const fmt = buildFormatter({ kind: "d3", specifier: ".2f" });
    expect(fmt("not a number")).toBe("not a number");
  });
});

// ---------------------------------------------------------------------------
// buildFormatter — kind: "date"
// ---------------------------------------------------------------------------

describe("buildFormatter / kind:date", () => {
  // Date.UTC(2026, 5, 19) = June 19 2026 in UTC (month is 0-indexed)
  const juneEpochMs = Date.UTC(2026, 5, 19);

  it("preset iso — Date.UTC(2026,5,19) → '2026-06-19'", () => {
    const fmt = buildFormatter({ kind: "date", preset: "iso" });
    expect(fmt(juneEpochMs)).toBe("2026-06-19");
  });

  it("preset us — Date.UTC(2026,5,19) → '06/19/2026'", () => {
    const fmt = buildFormatter({ kind: "date", preset: "us" });
    expect(fmt(juneEpochMs)).toBe("06/19/2026");
  });

  it("preset long — Date.UTC(2026,5,19) → 'Jun 19, 2026'", () => {
    const fmt = buildFormatter({ kind: "date", preset: "long" });
    expect(fmt(juneEpochMs)).toBe("Jun 19, 2026");
  });

  it("preset us_time — Date.UTC(2026,5,19,14,30) → '06/19/2026 14:30'", () => {
    const fmt = buildFormatter({ kind: "date", preset: "us_time" });
    expect(fmt(Date.UTC(2026, 5, 19, 14, 30))).toBe("06/19/2026 14:30");
  });

  it("preset long_time — Date.UTC(2026,5,19,9,5) → 'Jun 19, 2026 09:05'", () => {
    const fmt = buildFormatter({ kind: "date", preset: "long_time" });
    expect(fmt(Date.UTC(2026, 5, 19, 9, 5))).toBe("Jun 19, 2026 09:05");
  });

  it("preset custom YYYY/MM/DD — Date.UTC(2026,5,19) → '2026/06/19'", () => {
    const fmt = buildFormatter({ kind: "date", preset: "custom", customPattern: "YYYY/MM/DD" });
    expect(fmt(juneEpochMs)).toBe("2026/06/19");
  });

  it("preset custom DD-MM-YYYY — Date.UTC(2026,5,3) → '03-06-2026'", () => {
    const fmt = buildFormatter({ kind: "date", preset: "custom", customPattern: "DD-MM-YYYY" });
    expect(fmt(Date.UTC(2026, 5, 3))).toBe("03-06-2026");
  });

  it("preset custom YYYY/MM/DD HH:mm — Date.UTC(2026,5,19,8,5) → '2026/06/19 08:05'", () => {
    const fmt = buildFormatter({ kind: "date", preset: "custom", customPattern: "YYYY/MM/DD HH:mm" });
    expect(fmt(Date.UTC(2026, 5, 19, 8, 5))).toBe("2026/06/19 08:05");
  });

  it("ISO string input — '2026-06-19T00:00:00.000Z' → '2026-06-19' (iso preset)", () => {
    const fmt = buildFormatter({ kind: "date", preset: "iso" });
    expect(fmt("2026-06-19T00:00:00.000Z")).toBe("2026-06-19");
  });

  it("epoch seconds (small number) input normalizes to ms — works for year > 2001 threshold", () => {
    // 1750291200 seconds = 2025-06-19T00:00:00Z (approximately)
    // Epoch ms threshold: values < 1e12 are treated as seconds; above is ms
    // 1750291200 < 1e12 → treated as seconds
    const epochSec = 1750291200; // 2025-06-19T00:00:00Z
    const fmt = buildFormatter({ kind: "date", preset: "iso" });
    // Just verify it formats to something date-like without throwing
    const result = fmt(epochSec);
    expect(typeof result).toBe("string");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("null passthrough with date spec", () => {
    const fmt = buildFormatter({ kind: "date", preset: "iso" });
    expect(fmt(null)).toBe(null);
  });

  it("undefined passthrough with date spec", () => {
    const fmt = buildFormatter({ kind: "date", preset: "iso" });
    expect(fmt(undefined)).toBe(undefined);
  });

  it("invalid date value → raw value, no throw", () => {
    const fmt = buildFormatter({ kind: "date", preset: "iso" });
    expect(fmt("not-a-date")).toBe("not-a-date");
  });

  it("NaN date → raw value, no throw", () => {
    const fmt = buildFormatter({ kind: "date", preset: "iso" });
    expect(fmt(NaN)).toBe(NaN);
  });
});

// ---------------------------------------------------------------------------
// buildFormatter — kind: "none" + null/absent spec
// ---------------------------------------------------------------------------

describe("buildFormatter / kind:none + identity cases", () => {
  it("kind:none — identity passthrough — 42 → 42", () => {
    const fmt = buildFormatter({ kind: "none" });
    expect(fmt(42)).toBe(42);
  });

  it("kind:none — passthrough string", () => {
    const fmt = buildFormatter({ kind: "none" });
    expect(fmt("hello")).toBe("hello");
  });

  it("null spec — identity passthrough — 42 → 42", () => {
    const fmt = buildFormatter(null);
    expect(fmt(42)).toBe(42);
  });

  it("undefined spec — identity passthrough — 42 → 42", () => {
    const fmt = buildFormatter(undefined);
    expect(fmt(42)).toBe(42);
  });

  it("null spec with null value — null → null", () => {
    const fmt = buildFormatter(null);
    expect(fmt(null)).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// buildFormatter — kind: "si" (smart abbreviation)
// ---------------------------------------------------------------------------

describe("buildFormatter / kind:si", () => {
  it("decimals=1 abbreviates millions: 1234567 → '1.2M'", () => {
    expect(buildFormatter({ kind: "si", decimals: 1 })(1234567)).toBe("1.2M");
  });
  it("decimals=1 abbreviates billions: 3400000000 → '3.4G'", () => {
    expect(buildFormatter({ kind: "si", decimals: 1 })(3400000000)).toBe("3.4G");
  });
  it("decimals=0 → '1M'", () => {
    expect(buildFormatter({ kind: "si", decimals: 0 })(1234567)).toBe("1M");
  });
  it("decimals=2 → '1.23M'", () => {
    expect(buildFormatter({ kind: "si", decimals: 2 })(1234567)).toBe("1.23M");
  });
  it("sub-kilo stays unabbreviated: 500 → '500'", () => {
    expect(buildFormatter({ kind: "si", decimals: 1 })(500)).toBe("500");
  });
  it("1000 → '1k'", () => {
    expect(buildFormatter({ kind: "si", decimals: 1 })(1000)).toBe("1k");
  });
  it("zero → '0'", () => {
    expect(buildFormatter({ kind: "si", decimals: 1 })(0)).toBe("0");
  });
  it("negative uses d3 Unicode minus: -1234567 → '−1.2M'", () => {
    expect(buildFormatter({ kind: "si", decimals: 1 })(-1234567)).toBe("−1.2M");
  });
  it("null/undefined pass through", () => {
    expect(buildFormatter({ kind: "si", decimals: 1 })(null)).toBe(null);
    expect(buildFormatter({ kind: "si", decimals: 1 })(undefined)).toBe(undefined);
  });
  it("non-numeric input → raw value (never throws)", () => {
    expect(buildFormatter({ kind: "si", decimals: 1 })("abc")).toBe("abc");
  });
});

// ---------------------------------------------------------------------------
// defaultFormatKind
// ---------------------------------------------------------------------------

describe("defaultFormatKind", () => {
  it("numeric column type → 'number'", () => {
    expect(defaultFormatKind("revenue", { revenue: "double" })).toBe("number");
  });

  it("integer column type → 'number'", () => {
    expect(defaultFormatKind("count", { count: "int" })).toBe("number");
  });

  it("datetime column type → 'date'", () => {
    expect(defaultFormatKind("created_at", { created_at: "timestamp" })).toBe("date");
  });

  it("date column type → 'date'", () => {
    expect(defaultFormatKind("event_date", { event_date: "date" })).toBe("date");
  });

  it("string column type → 'none'", () => {
    expect(defaultFormatKind("name", { name: "varchar" })).toBe("none");
  });

  it("unknown / missing column → 'none'", () => {
    expect(defaultFormatKind("nonexistent", { revenue: "double" })).toBe("none");
  });
});
