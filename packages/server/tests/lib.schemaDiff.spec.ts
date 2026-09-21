import { describe, it, expect } from "vitest";
import {
  diffColumnFingerprints,
  diffResult,
  baselineRequiredResult,
  tableMissingResult,
  type ColumnFingerprintMap,
} from "../src/lib/schemaDiff";
import type { ColumnFingerprint } from "../src/lib/schemaFingerprint";

// Small fingerprint-construction helpers to keep fixtures readable.
const fp = (base: string, refinements: string[] = []): ColumnFingerprint => ({
  base,
  refinements,
});

describe("diffColumnFingerprints", () => {
  it("a column present only in live is added, carrying its live type", () => {
    const stored: ColumnFingerprintMap = {};
    const live: ColumnFingerprintMap = { new_col: fp("string", ["char4"]) };
    const diff = diffColumnFingerprints(stored, live);
    expect(diff.added).toEqual([
      { column: "new_col", live: fp("string", ["char4"]), liveType: "string(char4)" },
    ]);
    expect(diff.removed).toEqual([]);
    expect(diff.retyped).toEqual([]);
  });

  it("a column present only in stored is removed, carrying its stored type", () => {
    const stored: ColumnFingerprintMap = { old_col: fp("int", ["int8"]) };
    const live: ColumnFingerprintMap = {};
    const diff = diffColumnFingerprints(stored, live);
    expect(diff.removed).toEqual([
      { column: "old_col", stored: fp("int", ["int8"]), storedType: "int(int8)" },
    ]);
    expect(diff.added).toEqual([]);
    expect(diff.retyped).toEqual([]);
  });

  it("char8 -> char32 with identical base 'string' is a retype", () => {
    const stored: ColumnFingerprintMap = { payment_type: fp("string", ["char8"]) };
    const live: ColumnFingerprintMap = { payment_type: fp("string", ["char32"]) };
    const diff = diffColumnFingerprints(stored, live);
    expect(diff.retyped).toHaveLength(1);
    expect(diff.retyped[0].column).toBe("payment_type");
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it("int -> double with identical empty refinements is a retype", () => {
    const stored: ColumnFingerprintMap = { trip_distance: fp("int") };
    const live: ColumnFingerprintMap = { trip_distance: fp("double") };
    const diff = diffColumnFingerprints(stored, live);
    expect(diff.retyped).toHaveLength(1);
    expect(diff.retyped[0].column).toBe("trip_distance");
  });

  it("int8 -> int16 on the same base 'int' is a retype", () => {
    const stored: ColumnFingerprintMap = { rate_code_id: fp("int", ["int8"]) };
    const live: ColumnFingerprintMap = { rate_code_id: fp("int", ["int16"]) };
    const diff = diffColumnFingerprints(stored, live);
    expect(diff.retyped).toHaveLength(1);
    expect(diff.retyped[0].column).toBe("rate_code_id");
  });

  it("a retyped entry carries BOTH the stored type and the live type", () => {
    const stored: ColumnFingerprintMap = { vendor_id: fp("string", ["char4"]) };
    const live: ColumnFingerprintMap = { vendor_id: fp("string", ["char16"]) };
    const diff = diffColumnFingerprints(stored, live);
    expect(diff.retyped).toEqual([
      {
        column: "vendor_id",
        stored: fp("string", ["char4"]),
        storedType: "string(char4)",
        live: fp("string", ["char16"]),
        liveType: "string(char16)",
      },
    ]);
  });

  it("unchanged columns appear in no group", () => {
    const stored: ColumnFingerprintMap = {
      a: fp("string", ["char4"]),
      b: fp("int", ["int8"]),
    };
    const live: ColumnFingerprintMap = {
      a: fp("string", ["char4"]),
      b: fp("int", ["int8"]),
    };
    const diff = diffColumnFingerprints(stored, live);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.retyped).toEqual([]);
  });

  it("an identical stored and live map yields three empty arrays", () => {
    const stored: ColumnFingerprintMap = { x: fp("float") };
    const live: ColumnFingerprintMap = { x: fp("float") };
    const diff = diffColumnFingerprints(stored, live);
    expect(diff).toEqual({ added: [], removed: [], retyped: [] });
  });

  it("a renamed column is one removal plus one addition (pickup_zone -> pu_zone)", () => {
    const stored: ColumnFingerprintMap = { pickup_zone: fp("string", ["char16"]) };
    const live: ColumnFingerprintMap = { pu_zone: fp("string", ["char16"]) };
    const diff = diffColumnFingerprints(stored, live);
    expect(diff.removed).toEqual([
      { column: "pickup_zone", stored: fp("string", ["char16"]), storedType: "string(char16)" },
    ]);
    expect(diff.added).toEqual([
      { column: "pu_zone", live: fp("string", ["char16"]), liveType: "string(char16)" },
    ]);
    expect(diff.retyped).toEqual([]);
  });

  it("the serialized result of a rename contains no rename / similar / score / ordinal token", () => {
    const stored: ColumnFingerprintMap = { pickup_zone: fp("string", ["char16"]) };
    const live: ColumnFingerprintMap = { pu_zone: fp("string", ["char16"]) };
    const json = JSON.stringify(diffColumnFingerprints(stored, live)).toLowerCase();
    for (const token of ["renam", "similar", "score", "ordinal", "probabl", "likely", "match"]) {
      expect(json).not.toContain(token);
    }
  });

  it("a case change is one removal plus one addition (CustomerID vs customerid)", () => {
    const stored: ColumnFingerprintMap = { CustomerID: fp("string", ["char16"]) };
    const live: ColumnFingerprintMap = { customerid: fp("string", ["char16"]) };
    const diff = diffColumnFingerprints(stored, live);
    expect(diff.removed).toEqual([
      { column: "CustomerID", stored: fp("string", ["char16"]), storedType: "string(char16)" },
    ]);
    expect(diff.added).toEqual([
      { column: "customerid", live: fp("string", ["char16"]), liveType: "string(char16)" },
    ]);
  });

  it("every group is sorted by column name ascending, regardless of key insertion order", () => {
    const stored: ColumnFingerprintMap = {};
    const live: ColumnFingerprintMap = {
      zeta: fp("string"),
      alpha: fp("string"),
      mike: fp("string"),
    };
    const diff = diffColumnFingerprints(stored, live);
    expect(diff.added.map((c) => c.column)).toEqual(["alpha", "mike", "zeta"]);

    const stored2: ColumnFingerprintMap = {
      zeta: fp("string"),
      alpha: fp("string"),
      mike: fp("string"),
    };
    const diff2 = diffColumnFingerprints(stored2, {});
    expect(diff2.removed.map((c) => c.column)).toEqual(["alpha", "mike", "zeta"]);

    const storedRetyped: ColumnFingerprintMap = {
      zeta: fp("int"),
      alpha: fp("int"),
      mike: fp("int"),
    };
    const liveRetyped: ColumnFingerprintMap = {
      zeta: fp("double"),
      alpha: fp("double"),
      mike: fp("double"),
    };
    const diff3 = diffColumnFingerprints(storedRetyped, liveRetyped);
    expect(diff3.retyped.map((c) => c.column)).toEqual(["alpha", "mike", "zeta"]);
  });
});

describe("SchemaCheckResult builders", () => {
  it("tableMissingResult: outcome is 'table_missing' and the payload has no added/removed/retyped keys", () => {
    const result = tableMissingResult("demo.nyctaxi");
    expect(result.outcome).toBe("table_missing");
    expect(result).not.toHaveProperty("added");
    expect(result).not.toHaveProperty("removed");
    expect(result).not.toHaveProperty("retyped");
  });

  it("tableMissingResult: the message names the table and covers BOTH dropped and renamed", () => {
    const result = tableMissingResult("demo.nyctaxi");
    if (result.outcome !== "table_missing") throw new Error("expected table_missing");
    expect(result.message).toContain("demo.nyctaxi");
    expect(result.message.toLowerCase()).toContain("dropped");
    expect(result.message.toLowerCase()).toContain("renamed");
  });

  it("baselineRequiredResult: outcome is 'baseline_required' and carries the live fingerprint map", () => {
    const live: ColumnFingerprintMap = { a: fp("string", ["char4"]) };
    const result = baselineRequiredResult("demo.nyctaxi", live);
    expect(result.outcome).toBe("baseline_required");
    if (result.outcome !== "baseline_required") throw new Error("expected baseline_required");
    expect(result.live).toEqual(live);
  });

  it("baselineRequiredResult: the message says type comparison starts from the next check", () => {
    const result = baselineRequiredResult("demo.nyctaxi", {});
    if (result.outcome !== "baseline_required") throw new Error("expected baseline_required");
    expect(result.message.toLowerCase()).toContain("next check");
  });

  it("diffResult: hasChanges is false when the three groups are empty", () => {
    const stored: ColumnFingerprintMap = { a: fp("string") };
    const live: ColumnFingerprintMap = { a: fp("string") };
    const result = diffResult("demo.nyctaxi", stored, live);
    expect(result.outcome).toBe("diff");
    if (result.outcome !== "diff") throw new Error("expected diff");
    expect(result.hasChanges).toBe(false);
  });

  it("diffResult: hasChanges is true when any single group is non-empty", () => {
    const stored: ColumnFingerprintMap = {};
    const live: ColumnFingerprintMap = { a: fp("string") };
    const result = diffResult("demo.nyctaxi", stored, live);
    if (result.outcome !== "diff") throw new Error("expected diff");
    expect(result.hasChanges).toBe(true);
  });

  it("every builder returns an object whose only outcome values are diff | baseline_required | table_missing", () => {
    const outcomes = [
      diffResult("t", {}, {}).outcome,
      baselineRequiredResult("t", {}).outcome,
      tableMissingResult("t").outcome,
    ];
    for (const outcome of outcomes) {
      expect(["diff", "baseline_required", "table_missing"]).toContain(outcome);
    }
  });
});
