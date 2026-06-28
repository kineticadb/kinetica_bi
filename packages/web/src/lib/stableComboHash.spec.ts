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

// ── Spatial extension tests (Phase 93.5) ───────────────────────────────────────
describe("stableComboHash — spatial extension", () => {
  const fA = { column: "city", value: "NYC", dataType: "string" as const, operator: undefined as undefined, sourceWidgetId: undefined, addedAt: 0 };

  // NO-BREAK: empty/absent shapes are byte-identical to the 3-arg call
  it("empty shapes array produces byte-identical output to 3-arg call", () => {
    const threeArg = stableComboHash("table", 1, [fA]);
    const fourArgEmpty = stableComboHash("table", 1, [fA], []);
    const fourArgUndef = stableComboHash("table", 1, [fA], undefined);
    expect(fourArgEmpty).toBe(threeArg);
    expect(fourArgUndef).toBe(threeArg);
  });

  // NO-BREAK: empty everything still returns NOFILTER sentinel
  it("returns NOFILTER sentinel when both filters and shapes are empty/absent", () => {
    const result = stableComboHash("table", 5, [], []);
    expect(result).toBe(`table:5:${NOFILTER_SENTINEL}`);
    const resultUndef = stableComboHash("table", 5, [], undefined);
    expect(resultUndef).toBe(`table:5:${NOFILTER_SENTINEL}`);
  });

  // Spatial-only (no column filters): must NOT return NOFILTER and must have correct form
  it("spatial-only hash does not end with NOFILTER and has form 'table:5:s:POLYGON_X'", () => {
    const result = stableComboHash("table", 5, [], [{ wkt: "POLYGON_X" }]);
    expect(result).not.toMatch(/:NOFILTER$/);
    expect(result).toBe("table:5:s:POLYGON_X");
  });

  // DETERMINISM: same inputs → same output
  it("produces identical strings on two calls with the same columns + shapes", () => {
    const shapes = [{ wkt: "POLYGON((0 0,1 0,1 1,0 1,0 0))" }, { wkt: "POLYGON((2 2,3 2,3 3,2 3,2 2))" }];
    const hash1 = stableComboHash("table", 1, [fA], shapes);
    const hash2 = stableComboHash("table", 1, [fA], shapes);
    expect(hash1).toBe(hash2);
  });

  // ORDER-INDEPENDENCE: reversed shapes array must produce the same hash
  it("produces the same hash regardless of shape array order", () => {
    const shapes1 = [{ wkt: "AAA" }, { wkt: "BBB" }];
    const shapes2 = [{ wkt: "BBB" }, { wkt: "AAA" }];
    const hash1 = stableComboHash("table", 1, [fA], shapes1);
    const hash2 = stableComboHash("table", 1, [fA], shapes2);
    expect(hash1).toBe(hash2);
  });

  // DISTINCTNESS: different WKTs → different hashes
  it("produces different hashes when WKT sets differ", () => {
    const hashA = stableComboHash("table", 1, [fA], [{ wkt: "POLYGON_A" }]);
    const hashB = stableComboHash("table", 1, [fA], [{ wkt: "POLYGON_B" }]);
    expect(hashA).not.toBe(hashB);
  });

  it("same columns + different shapes → different hashes", () => {
    const hashNoShapes = stableComboHash("table", 1, [fA]);
    const hashWithShapes = stableComboHash("table", 1, [fA], [{ wkt: "POLYGON_X" }]);
    expect(hashNoShapes).not.toBe(hashWithShapes);
  });

  // WKT-ONLY identity: two shapes with identical wkt but different id/label/addedAt hash identically
  it("hashes identically when shapes have same wkt but different id/label/addedAt", () => {
    const shape1 = { wkt: "POLYGON_Q" };
    const shape2 = { wkt: "POLYGON_Q" };
    const hash1 = stableComboHash("table", 1, [fA], [shape1]);
    const hash2 = stableComboHash("table", 1, [fA], [shape2]);
    expect(hash1).toBe(hash2);
  });

  // NO-MUTATION: the passed shapes array must not be reordered in place
  it("does not mutate the caller's shapes array", () => {
    const shapes = Object.freeze([{ wkt: "BBB" }, { wkt: "AAA" }]) as { wkt: string }[];
    const originalOrder = [shapes[0].wkt, shapes[1].wkt];
    stableComboHash("table", 1, [fA], shapes);
    expect([shapes[0].wkt, shapes[1].wkt]).toEqual(originalOrder);
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
