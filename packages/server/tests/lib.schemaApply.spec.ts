import { describe, it, expect } from "vitest";
import {
  canonicalFingerprintJson,
  type ColumnFingerprint,
  type ColumnFingerprintMap,
} from "../src/lib/schemaFingerprint";
import { isStaleAgainst, SCHEMA_APPLY_STALE_MESSAGE } from "../src/lib/schemaApply";

// ---------------------------------------------------------------------------
// ALL FIXTURES IN THIS FILE ARE SYNTHETIC. No real table, schema or column
// name from any deployment appears here -- neutral names only (`demo_table`,
// `col_a`, `col_b`, `col_ts`). The base/refinement PAIRINGS follow
// 122-SPIKE-NOTES.md's live /show/table capture; the NAMES do not.
// ---------------------------------------------------------------------------

const fp = (base: string, refinements: string[] = []): ColumnFingerprint => ({ base, refinements });

describe("canonicalFingerprintJson / isStaleAgainst", () => {
  it("STALE-identical: the same map compared with itself is not stale", () => {
    const a: ColumnFingerprintMap = {
      col_a: fp("int", ["int8"]),
      col_b: fp("string", ["char4"]),
      col_ts: fp("long", ["timestamp"]),
    };
    expect(isStaleAgainst(a, a)).toBe(false);
    expect(canonicalFingerprintJson(a)).toBe(canonicalFingerprintJson(a));
  });

  it("STALE-reorder: identical entries inserted in a DIFFERENT key order are not stale", () => {
    // Built key-by-key so the insertion order is genuinely different, and
    // asserted as a PRECONDITION -- otherwise this test could pass vacuously
    // with two maps that happen to have been built the same way.
    const a: ColumnFingerprintMap = {};
    a.col_a = fp("int", ["int8"]);
    a.col_b = fp("string", ["char4"]);
    a.col_ts = fp("long", ["timestamp"]);

    const b: ColumnFingerprintMap = {};
    b.col_ts = fp("long", ["timestamp"]);
    b.col_b = fp("string", ["char4"]);
    b.col_a = fp("int", ["int8"]);

    expect(Object.keys(a)[0]).not.toBe(Object.keys(b)[0]);
    expect(Object.keys(a)).not.toEqual(Object.keys(b));
    expect(Object.keys(a).slice().sort()).toEqual(Object.keys(b).slice().sort());

    expect(canonicalFingerprintJson(a)).toBe(canonicalFingerprintJson(b));
    expect(isStaleAgainst(a, b)).toBe(false);
  });

  it("STALE-reorder-case: byte order and locale order disagree, and byte order wins", () => {
    // "COL_b" < "col_a" byte-ascending (uppercase C is 0x43, lowercase c is
    // 0x63) but localeCompare orders them the other way. Two maps whose
    // insertion order differs must still canonicalise identically, AND the
    // canonical form must place "COL_b" first -- which a localeCompare sort
    // would not. This is what makes the canonical form machine-independent.
    const a: ColumnFingerprintMap = {};
    a.col_a = fp("int");
    a.COL_b = fp("double");

    const b: ColumnFingerprintMap = {};
    b.COL_b = fp("double");
    b.col_a = fp("int");

    expect(Object.keys(a)[0]).not.toBe(Object.keys(b)[0]);
    expect("COL_b" < "col_a").toBe(true);
    expect("COL_b".localeCompare("col_a")).toBeGreaterThan(0);

    const canonical = canonicalFingerprintJson(a);
    expect(canonicalFingerprintJson(b)).toBe(canonical);
    expect(canonical.indexOf("COL_b")).toBeLessThan(canonical.indexOf("col_a"));
    expect(isStaleAgainst(a, b)).toBe(false);
  });

  it("STALE-added: a map with one extra column IS stale", () => {
    const a: ColumnFingerprintMap = { col_a: fp("int"), col_b: fp("string") };
    const b: ColumnFingerprintMap = { col_a: fp("int"), col_b: fp("string"), col_c: fp("double") };
    expect(isStaleAgainst(a, b)).toBe(true);
  });

  it("STALE-removed: a map missing one column IS stale", () => {
    const a: ColumnFingerprintMap = { col_a: fp("int"), col_b: fp("string") };
    const b: ColumnFingerprintMap = { col_a: fp("int") };
    expect(isStaleAgainst(a, b)).toBe(true);
  });

  it("STALE-base: a changed base IS stale", () => {
    const a: ColumnFingerprintMap = { col_a: fp("int"), col_b: fp("string") };
    const b: ColumnFingerprintMap = { col_a: fp("long"), col_b: fp("string") };
    expect(isStaleAgainst(a, b)).toBe(true);
  });

  it("STALE-refinement: a changed refinement (char4 -> char16) IS stale", () => {
    const a: ColumnFingerprintMap = { col_b: fp("string", ["char4"]) };
    const b: ColumnFingerprintMap = { col_b: fp("string", ["char16"]) };
    expect(isStaleAgainst(a, b)).toBe(true);
    // A refinement APPEARING or DISAPPEARING is equally a change: a bare
    // `long` and a `long(timestamp)` are different columns.
    expect(isStaleAgainst({ col_ts: fp("long") }, { col_ts: fp("long", ["timestamp"]) })).toBe(true);
    expect(isStaleAgainst({ col_ts: fp("long", ["timestamp"]) }, { col_ts: fp("long") })).toBe(true);
  });

  it("STALE-empty: two empty maps are not stale", () => {
    expect(isStaleAgainst({}, {})).toBe(false);
    expect(canonicalFingerprintJson({})).toBe("{}");
  });

  it("STALE-message: the refusal names no column and tells the operator to re-run the check", () => {
    // Phase 126 renders this VERBATIM.
    expect(SCHEMA_APPLY_STALE_MESSAGE).toContain("Nothing was written.");
    expect(SCHEMA_APPLY_STALE_MESSAGE).toContain("Re-run the check");
    expect(SCHEMA_APPLY_STALE_MESSAGE).not.toContain("col_");
  });
});
