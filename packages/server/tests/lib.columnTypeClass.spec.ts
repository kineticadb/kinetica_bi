import { describe, it, expect } from "vitest";
import { readWebTypeSet } from "./helpers/webColumnTypes";
import {
  NUMERIC_TYPES,
  BOOLEAN_TYPES,
  DATETIME_TYPES,
  normalizeType,
  classifyFingerprint,
  severityForRetype,
  REMOVED_SEVERITY,
  ADDED_SEVERITY,
} from "../src/lib/columnTypeClass";
import type { ColumnFingerprint } from "../src/lib/schemaFingerprint";

// Small fingerprint-construction helper, mirroring tests/lib.schemaDiff.spec.ts.
const fp = (base: string, refinements: string[] = []): ColumnFingerprint => ({ base, refinements });

describe("the mirrored type sets", () => {
  // v1.25 audit F2: these compared the server Sets against hardcoded copies of the web's,
  // which reddens on a SERVER edit but never on a WEB one. The right side is now parsed out
  // of packages/web/src/lib/columnTypes.ts, so an edit to either side reddens. Sorted on
  // both sides so the assertion does not depend on Set insertion order.
  it("MIRROR-PARITY: NUMERIC_TYPES equals the web's NUMERIC_TYPES, read from source", () => {
    expect([...NUMERIC_TYPES].sort()).toEqual(readWebTypeSet("NUMERIC_TYPES").sort());
  });

  it("MIRROR-PARITY: BOOLEAN_TYPES and DATETIME_TYPES equal the web's, read from source", () => {
    expect([...BOOLEAN_TYPES].sort()).toEqual(readWebTypeSet("BOOLEAN_TYPES").sort());
    expect([...DATETIME_TYPES].sort()).toEqual(readWebTypeSet("DATETIME_TYPES").sort());
  });

  it("MIRROR-PARITY: normalizeType lowercases, strips a parenthesised suffix, and trims", () => {
    expect(normalizeType("DECIMAL(18,4)")).toBe("decimal");
    expect(normalizeType("  Character(256) ")).toBe("character");
    expect(normalizeType("BIGINT")).toBe("bigint");
  });
});

describe("classifyFingerprint", () => {
  it("CLASS: LIVE-VERIFIED — a TIMESTAMP (base long, refinements [timestamp]) is datetime, NOT number", () => {
    // THE decisive case. LIVE-VERIFIED against the deployed instance
    // (124-RESEARCH ADDENDUM).
    expect(classifyFingerprint(fp("long", ["timestamp"]))).toBe("datetime");
    // The base-only trap this rule exists to avoid:
    expect(NUMERIC_TYPES.has("long")).toBe(true);
  });

  it("CLASS: LIVE-VERIFIED — numeric(p,s) arrives as base double with no refinement and is number", () => {
    // LIVE-VERIFIED (ADDENDUM) — corrects the research body's docs-derived
    // decimal claim (which said decimal sits on base `string`).
    expect(classifyFingerprint(fp("double", []))).toBe("number");
  });

  it("CLASS: LIVE-VERIFIED — char1 / char4 / char16 / char256 on base string are string", () => {
    expect(classifyFingerprint(fp("string", ["char1"]))).toBe("string");
    expect(classifyFingerprint(fp("string", ["char4"]))).toBe("string");
    expect(classifyFingerprint(fp("string", ["char16"]))).toBe("string");
    expect(classifyFingerprint(fp("string", ["char256"]))).toBe("string");
  });

  it("CLASS: LIVE-VERIFIED — int8 / int16 on base int, and a bare float, are number", () => {
    expect(classifyFingerprint(fp("int", ["int8"]))).toBe("number");
    expect(classifyFingerprint(fp("int", ["int16"]))).toBe("number");
    expect(classifyFingerprint(fp("float", []))).toBe("number");
  });

  it("CLASS: UNVERIFIED — a boolean marker is boolean on EITHER an int or a string base", () => {
    // UNVERIFIED — documentation-derived. Every registered table carrying
    // boolean/date/time/datetime has been DROPPED from Kinetica, so no live
    // /show/table body exists for them. Asserted on BOTH candidate bases
    // precisely because the base is the thing in doubt.
    expect(classifyFingerprint(fp("int", ["boolean"]))).toBe("boolean");
    expect(classifyFingerprint(fp("string", ["boolean"]))).toBe("boolean");
  });

  it("CLASS: UNVERIFIED — date / time / datetime markers are datetime on EITHER a string or a long base", () => {
    expect(classifyFingerprint(fp("string", ["date"]))).toBe("datetime");
    expect(classifyFingerprint(fp("long", ["date"]))).toBe("datetime");
    expect(classifyFingerprint(fp("string", ["time"]))).toBe("datetime");
    expect(classifyFingerprint(fp("string", ["datetime"]))).toBe("datetime");
    expect(classifyFingerprint(fp("long", ["datetime"]))).toBe("datetime");
  });

  it("CLASS: UNVERIFIED — a decimal(p,s) refinement is number even though the base is string", () => {
    expect(classifyFingerprint(fp("string", ["decimal(18,4)"]))).toBe("number");
  });

  it("CLASS: a refinement marker beats the base, including when the base is the unknown sentinel", () => {
    // The marker beats the base, even the failure sentinel.
    expect(classifyFingerprint(fp("unknown", ["timestamp"]))).toBe("datetime");
  });

  it("CLASS: the unknown sentinel with no class-determining refinement stays unknown", () => {
    expect(classifyFingerprint(fp("unknown", []))).toBe("unknown");
    expect(classifyFingerprint(fp("", []))).toBe("unknown");
  });

  it("CLASS: wkt and bytes carry no class marker and fall through to string", () => {
    // No live fingerprint of a geometry column has ever been captured (LOW
    // confidence). Consistent with today's legacy behaviour, where
    // inferDataTypeFromColumn("geometry") falls through to "string".
    expect(classifyFingerprint(fp("string", ["wkt"]))).toBe("string");
    expect(classifyFingerprint(fp("bytes", []))).toBe("string");
  });
});

describe("severityForRetype", () => {
  it("SEVERITY: LIVE-VERIFIED — timestamp -> bigint is breaking, because datetime -> number is a class flip", () => {
    // THE case. Live-verified fingerprints on both sides.
    expect(severityForRetype(fp("long", ["timestamp"]), fp("long", []))).toBe("breaking");
    expect(severityForRetype(fp("long", []), fp("long", ["timestamp"]))).toBe("breaking");
  });

  it("SEVERITY: int -> double is changed — same class, different type", () => {
    expect(severityForRetype(fp("int", []), fp("double", []))).toBe("changed");
  });

  it("SEVERITY: char8 -> char32 is changed — same class, different width", () => {
    expect(severityForRetype(fp("string", ["char8"]), fp("string", ["char32"]))).toBe("changed");
  });

  it("SEVERITY: int8 -> int16 is changed — same class, different width", () => {
    expect(severityForRetype(fp("int", ["int8"]), fp("int", ["int16"]))).toBe("changed");
  });

  it("SEVERITY: int -> varchar is breaking — number -> string is a class flip", () => {
    expect(severityForRetype(fp("int", []), fp("string", ["char32"]))).toBe("breaking");
  });

  it("SEVERITY: UNVERIFIED — date -> varchar is breaking, and boolean -> int is breaking", () => {
    // UNVERIFIED shapes — documentation-derived, no live body exists for
    // either side.
    expect(severityForRetype(fp("string", ["date"]), fp("string", ["char32"]))).toBe("breaking");
    expect(severityForRetype(fp("int", ["boolean"]), fp("int", []))).toBe("breaking");
  });

  it("SEVERITY: a retype touching the unknown sentinel on EITHER side is breaking", () => {
    expect(severityForRetype(fp("unknown", []), fp("int", []))).toBe("breaking");
    expect(severityForRetype(fp("int", []), fp("unknown", []))).toBe("breaking");
    expect(severityForRetype(fp("unknown", []), fp("unknown", []))).toBe("breaking");
  });

  it("SEVERITY: a removed column is breaking and an added column is harmless, whatever the type", () => {
    expect(REMOVED_SEVERITY).toBe("breaking");
    expect(ADDED_SEVERITY).toBe("harmless");
  });
});
