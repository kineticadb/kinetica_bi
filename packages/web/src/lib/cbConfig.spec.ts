/**
 * cbConfig.spec.ts — Phase 38 Plan 01 Task 3 + Phase 39 Plan 01 Task 1 vitest unit coverage.
 *
 * Covers all exports of lib/cbConfig.ts: EMPTY_CB_CONFIG constant,
 * coalesceCbConfig null-coalescer, isCbConfigConfigured predicate,
 * isNumericValsType predicate, isCategoricalValsType predicate.
 * Phase 39 additions: PALETTE_COLORS, createDefaultBreak, filterCbEligibleColumns,
 * detectValsTypeFromColumn.
 *
 * Mirrors src/lib/mapInfoConfig.spec.ts pattern: one describe
 * block per export, positive + negative cases per helper, pure unit tests
 * (no React, no Zustand, no async).
 */
import { describe, it, expect } from "vitest";
import {
  EMPTY_CB_CONFIG,
  coalesceCbConfig,
  isCbConfigConfigured,
  isNumericValsType,
  isCategoricalValsType,
  PALETTE_COLORS,
  createDefaultBreak,
  filterCbEligibleColumns,
  detectValsTypeFromColumn,
  type CbConfig,
} from "./cbConfig";

describe("EMPTY_CB_CONFIG", () => {
  it("has attr === empty string", () => {
    expect(EMPTY_CB_CONFIG.attr).toBe("");
  });

  it("has valsType === 'numeric'", () => {
    expect(EMPTY_CB_CONFIG.valsType).toBe("numeric");
  });

  it("has breaks deep-equal to [] (no includeOtherBucket)", () => {
    expect(EMPTY_CB_CONFIG.breaks).toEqual([]);
    expect(EMPTY_CB_CONFIG.includeOtherBucket).toBeUndefined();
  });
});

describe("coalesceCbConfig", () => {
  it("returns EMPTY_CB_CONFIG for null input", () => {
    const result = coalesceCbConfig(null);
    expect(result.attr).toBe("");
    expect(result.valsType).toBe("numeric");
    expect(result.breaks).toEqual([]);
  });

  it("returns EMPTY_CB_CONFIG for invalid JSON input (JSON.parse throws)", () => {
    const result = coalesceCbConfig('not-json-bogus{');
    expect(result.attr).toBe("");
    expect(result.valsType).toBe("numeric");
    expect(result.breaks).toEqual([]);
  });

  it("returns parsed CbConfig for valid JSON with attr + breaks shape", () => {
    const raw = '{"attr":"fare","valsType":"numeric","breaks":[{"value":10,"color":"FF112233"}]}';
    const result = coalesceCbConfig(raw);
    expect(result.attr).toBe("fare");
    expect(result.valsType).toBe("numeric");
    expect(result.breaks).toHaveLength(1);
    expect(result.breaks[0].value).toBe(10);
    expect(result.breaks[0].color).toBe("FF112233");
  });

  it("returns EMPTY_CB_CONFIG for valid JSON that lacks required shape (no attr key)", () => {
    const result = coalesceCbConfig('{"valsType":"numeric","breaks":[]}');
    expect(result.attr).toBe("");
    expect(result.breaks).toEqual([]);
  });

  it("returns EMPTY_CB_CONFIG for valid JSON that lacks required shape (no breaks key)", () => {
    const result = coalesceCbConfig('{"attr":"fare","valsType":"numeric"}');
    expect(result.attr).toBe("");
    expect(result.breaks).toEqual([]);
  });
});

describe("isCbConfigConfigured", () => {
  it("returns false for EMPTY_CB_CONFIG (attr is empty string)", () => {
    expect(isCbConfigConfigured(EMPTY_CB_CONFIG)).toBe(false);
  });

  it("returns false when attr is non-empty but breaks.length === 0", () => {
    const cfg: CbConfig = { attr: "x", valsType: "numeric", breaks: [] };
    expect(isCbConfigConfigured(cfg)).toBe(false);
  });

  it("returns true when attr is non-empty AND breaks.length > 0", () => {
    const cfg: CbConfig = {
      attr: "x",
      valsType: "numeric",
      breaks: [{ value: 1, color: "FF000000" }],
    };
    expect(isCbConfigConfigured(cfg)).toBe(true);
  });
});

describe("isNumericValsType", () => {
  it("returns true when valsType === 'numeric'", () => {
    const cfg: CbConfig = { attr: "x", valsType: "numeric", breaks: [] };
    expect(isNumericValsType(cfg)).toBe(true);
  });

  it("returns false when valsType === 'categorical'", () => {
    const cfg: CbConfig = { attr: "x", valsType: "categorical", breaks: [] };
    expect(isNumericValsType(cfg)).toBe(false);
  });
});

describe("isCategoricalValsType", () => {
  it("returns true when valsType === 'categorical'", () => {
    const cfg: CbConfig = { attr: "x", valsType: "categorical", breaks: [] };
    expect(isCategoricalValsType(cfg)).toBe(true);
  });

  it("returns false when valsType === 'numeric'", () => {
    const cfg: CbConfig = { attr: "x", valsType: "numeric", breaks: [] };
    expect(isCategoricalValsType(cfg)).toBe(false);
  });
});

// ─── Phase 39 Plan 01 additions ───────────────────────────────────────────────

describe("PALETTE_COLORS", () => {
  it("has length 8", () => {
    expect(PALETTE_COLORS.length).toBe(8);
  });

  it("first entry is FF3B82F6 (blue-500)", () => {
    expect(PALETTE_COLORS[0]).toBe("FF3B82F6");
  });

  it("all entries match /^[0-9A-F]{8}$/ (8 uppercase hex chars)", () => {
    for (const color of PALETTE_COLORS) {
      expect(color).toMatch(/^[0-9A-F]{8}$/);
    }
  });
});

describe("createDefaultBreak", () => {
  it('createDefaultBreak("numeric", 0) returns fully-populated CbBreak with defaults', () => {
    const result = createDefaultBreak("numeric", 0);
    expect(result).toEqual({
      value: 0,
      // Numeric breaks carry a lo:hi range (CB_VALS); categorical use `value`.
      min: 0,
      max: 0,
      color: PALETTE_COLORS[0],
      label: "",
      pointSize: 5,
      pointShape: "circle",
      shapeLineWidth: 1,
      shapeLineColor: "FF000000",
      shapeFillColor: "FFFFFFFF",
    });
  });

  it('createDefaultBreak("categorical", 3).color === PALETTE_COLORS[3]', () => {
    const result = createDefaultBreak("categorical", 3);
    expect(result.color).toBe(PALETTE_COLORS[3]);
    expect(result.value).toBe("");
  });

  it('createDefaultBreak("numeric", 9) wraps palette: color === PALETTE_COLORS[1] (9 % 8 === 1)', () => {
    const result = createDefaultBreak("numeric", 9);
    expect(result.color).toBe(PALETTE_COLORS[1]);
    expect(result.color).toBe(PALETTE_COLORS[9 % 8]);
  });
});

describe("filterCbEligibleColumns", () => {
  it("excludes BYTES-type columns and wkt/datetime/boolean types; keeps int + varchar", () => {
    const cols = [
      { name: "a", type: "int" },
      { name: "b", type: "BYTES" },
      { name: "c", type: "varchar(255)" },
      { name: "d", type: "wkt" },
    ];
    const result = filterCbEligibleColumns(cols).map((c) => c.name);
    expect(result).toEqual(["a", "c"]);
  });

  it("keeps Kinetica character(N) string columns (UAT regression: vendor_id was excluded)", () => {
    const cols = [
      { name: "vendor_id", type: "character(256)" },
      { name: "payment_type", type: "character(256)" },
      { name: "fare_amount", type: "real" },
    ];
    const result = filterCbEligibleColumns(cols).map((c) => c.name);
    expect(result).toEqual(["vendor_id", "payment_type", "fare_amount"]);
    // and character(N) columns auto-detect as categorical
    expect(detectValsTypeFromColumn({ name: "vendor_id", type: "character(256)" })).toBe("categorical");
  });

  it("excludes columns whose type contains 'wkb' (case-insensitive)", () => {
    const cols = [
      { name: "geom_wkb", type: "BYTES" },
      { name: "x", type: "int" },
    ];
    const result = filterCbEligibleColumns(cols).map((c) => c.name);
    expect(result).toEqual(["x"]);
  });

  it("excludes spatialBound columns even if they are numeric type", () => {
    const cols = [
      { name: "lat", type: "double" },
      { name: "lon", type: "double" },
      { name: "x", type: "int" },
    ];
    const result = filterCbEligibleColumns(cols, new Set(["lat", "lon"])).map((c) => c.name);
    expect(result).toEqual(["x"]);
  });

  it("handles decimal(10,2) suffix stripping — keeps decimal columns", () => {
    const cols = [{ name: "x", type: "decimal(10,2)" }];
    const result = filterCbEligibleColumns(cols).map((c) => c.name);
    expect(result).toEqual(["x"]);
  });

  it("includes all numeric types: int, integer, int8, int16, int32, int64, long, float, double, decimal, numeric, smallint, bigint, real, number, tinyint", () => {
    const numericTypes = [
      "int", "integer", "int8", "int16", "int32", "int64",
      "long", "float", "double", "decimal", "numeric",
      "smallint", "bigint", "real", "number", "tinyint",
    ];
    const cols = numericTypes.map((t) => ({ name: t, type: t }));
    const result = filterCbEligibleColumns(cols).map((c) => c.name);
    expect(result).toEqual(numericTypes);
  });

  it("includes string, varchar, char (with suffix stripping)", () => {
    const cols = [
      { name: "a", type: "string" },
      { name: "b", type: "varchar(50)" },
      { name: "c", type: "char(1)" },
    ];
    const result = filterCbEligibleColumns(cols).map((c) => c.name);
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("excludes datetime, boolean, timestamp, wkt types", () => {
    const cols = [
      { name: "a", type: "datetime" },
      { name: "b", type: "boolean" },
      { name: "c", type: "timestamp" },
      { name: "d", type: "wkt" },
    ];
    const result = filterCbEligibleColumns(cols).map((c) => c.name);
    expect(result).toEqual([]);
  });
});

describe("detectValsTypeFromColumn", () => {
  it('returns "categorical" for varchar(50)', () => {
    expect(detectValsTypeFromColumn({ name: "a", type: "varchar(50)" })).toBe("categorical");
  });

  it('returns "numeric" for int', () => {
    expect(detectValsTypeFromColumn({ name: "a", type: "int" })).toBe("numeric");
  });

  it('returns "numeric" for undefined (safe fallback)', () => {
    expect(detectValsTypeFromColumn(undefined)).toBe("numeric");
  });
});
