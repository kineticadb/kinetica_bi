import { describe, it, expect } from "vitest";
import { stableComboHash, comboShortHash, NOFILTER_SENTINEL } from "./stableComboHash";
import type { ActiveFilter } from "../store/filterStore";

// Factory: builds a minimal ActiveFilter for testing.
function mk(
  column: string,
  value: ActiveFilter["value"] = "x",
  operator?: ActiveFilter["operator"],
  addedAt = 0,
  sourceWidgetId?: number,
): ActiveFilter {
  return { column, value, dataType: "string", operator, sourceWidgetId, addedAt };
}

describe("stableComboHash", () => {
  // Test 1: NOFILTER sentinel for empty filter array
  it("returns NOFILTER sentinel when filters is empty", () => {
    const result = stableComboHash("table", 5, []);
    expect(result).toBe(`table:5:${NOFILTER_SENTINEL}`);
    expect(NOFILTER_SENTINEL).toBe("NOFILTER");
  });

  // Test 2: order-independent — same filters in two different orders produce the same hash
  it("produces the same hash regardless of filter array order", () => {
    const f1 = mk("alpha", "val1");
    const f2 = mk("beta", 42);
    const hash1 = stableComboHash("table", 10, [f1, f2]);
    const hash2 = stableComboHash("table", 10, [f2, f1]);
    expect(hash1).toBe(hash2);
  });

  // Test 3: value-sensitive — different values produce different hashes
  it("produces different hashes for different filter values", () => {
    const fA = mk("col", "value_a");
    const fB = mk("col", "value_b");
    const hash1 = stableComboHash("table", 1, [fA]);
    const hash2 = stableComboHash("table", 1, [fB]);
    expect(hash1).not.toBe(hash2);
  });

  // Test 4: column-sensitive — different columns produce different hashes
  it("produces different hashes for different columns", () => {
    const fA = mk("col_alpha", "x");
    const fB = mk("col_beta", "x");
    const hash1 = stableComboHash("table", 1, [fA]);
    const hash2 = stableComboHash("table", 1, [fB]);
    expect(hash1).not.toBe(hash2);
  });

  // Test 5a: operator-sensitive — "eq" vs "in" produce different hashes
  it("produces different hashes for different operators", () => {
    const fEq = mk("col", "x", "eq");
    const fIn = mk("col", ["x"], "in");
    const hash1 = stableComboHash("table", 1, [fEq]);
    const hash2 = stableComboHash("table", 1, [fIn]);
    expect(hash1).not.toBe(hash2);
  });

  // Test 5b: absent operator normalizes to "eq"
  it("treats absent operator the same as explicit 'eq'", () => {
    const fAbsent = mk("col", "x"); // no operator
    const fExplicit = mk("col", "x", "eq");
    const hash1 = stableComboHash("table", 1, [fAbsent]);
    const hash2 = stableComboHash("table", 1, [fExplicit]);
    expect(hash1).toBe(hash2);
  });

  // Test 6a: source-namespaced — "table" vs "dv" sourceType produce different hashes
  it("produces different hashes for different sourceType", () => {
    const f = mk("col", "x");
    const hashTable = stableComboHash("table", 5, [f]);
    const hashDv = stableComboHash("dv", 5, [f]);
    expect(hashTable).not.toBe(hashDv);
  });

  // Test 6b: different sourceId produces different hash
  it("produces different hashes for different sourceId", () => {
    const f = mk("col", "x");
    const hash1 = stableComboHash("table", 5, [f]);
    const hash2 = stableComboHash("table", 6, [f]);
    expect(hash1).not.toBe(hash2);
  });

  // Test 7: addedAt is ignored — two filters differing only in addedAt produce the same hash
  it("produces the same hash when filters differ only in addedAt (volatile field excluded)", () => {
    const fEarly = mk("col", "x", undefined, 0);
    const fLate = mk("col", "x", undefined, 999999);
    const hash1 = stableComboHash("table", 1, [fEarly]);
    const hash2 = stableComboHash("table", 1, [fLate]);
    expect(hash1).toBe(hash2);
  });

  // Test 8: sentinel never collides with a real hash for the same (sourceType, sourceId)
  it("NOFILTER hash and real-filter hash are distinct for the same source", () => {
    const f = mk("col", "x");
    const realHash = stableComboHash("table", 5, [f]);
    const nofilterHash = stableComboHash("table", 5, []);
    expect(realHash).not.toBe(nofilterHash);
    // The nofilter hash ends with ":NOFILTER"
    expect(nofilterHash).toMatch(/:NOFILTER$/);
    // The real hash does NOT end with ":NOFILTER"
    expect(realHash).not.toMatch(/:NOFILTER$/);
  });
});

describe("comboShortHash", () => {
  // Test 9: shape — returns an 8-char lowercase hex string
  it("returns an 8-character lowercase hex string", () => {
    const result = comboShortHash("some:1:col|eq|\"x\"");
    expect(result).toMatch(/^[0-9a-f]{8}$/);
  });

  // Test 10a: stable — same input produces same output across calls
  it("produces the same output for the same input (stable)", () => {
    const input = "table:42:col|eq|\"value\"";
    expect(comboShortHash(input)).toBe(comboShortHash(input));
  });

  // Test 10b: sensitive — different inputs produce different outputs (overwhelmingly likely)
  it("produces different outputs for different inputs", () => {
    const a = comboShortHash("table:1:col_a|eq|\"x\"");
    const b = comboShortHash("table:1:col_b|eq|\"x\"");
    expect(a).not.toBe(b);
  });
});
