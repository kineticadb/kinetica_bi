import { describe, it, expect } from "vitest";
import { readWebTypeSet } from "./helpers/webColumnTypes";
import {
  canonicalFingerprintJson,
  formatFingerprint,
  type ColumnFingerprint,
  type ColumnFingerprintMap,
} from "../src/lib/schemaFingerprint";
import {
  isStaleAgainst,
  renderColumnType,
  renderColumnsMap,
  SCHEMA_APPLY_STALE_MESSAGE,
  SCHEMA_APPLY_TEXT_WIDTH_GAP,
} from "../src/lib/schemaApply";
import {
  BOOLEAN_TYPES,
  DATETIME_TYPES,
  NUMERIC_TYPES,
  classifyFingerprint,
  normalizeType,
} from "../src/lib/columnTypeClass";

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

// ===========================================================================
// renderColumnsMap — the tables.columns vocabulary
// ===========================================================================

// SYNTHETIC fixtures. The base/refinement pairings follow 122-SPIKE-NOTES.md's live
// /show/table capture (char1/char4/char16 as `properties` markers on a `string` base;
// int8/int16 on an `int` base; `timestamp` on a `long` base). Column names are neutral.
const FIXTURES: Array<{ col: string; fp: ColumnFingerprint; rendered: string }> = [
  { col: "col_ts",    fp: { base: "long",    refinements: ["timestamp"] },  rendered: "timestamp" },
  { col: "col_date",  fp: { base: "long",    refinements: ["date"] },       rendered: "date" },
  { col: "col_time",  fp: { base: "long",    refinements: ["time"] },       rendered: "time" },
  { col: "col_dt",    fp: { base: "long",    refinements: ["datetime"] },   rendered: "datetime" },
  { col: "col_bool",  fp: { base: "int",     refinements: ["boolean"] },    rendered: "boolean" },
  { col: "col_wkt",   fp: { base: "string",  refinements: ["wkt"] },        rendered: "wkt" },
  { col: "col_wkb",   fp: { base: "bytes",   refinements: ["wkb"] },        rendered: "wkb" },
  { col: "col_c4",    fp: { base: "string",  refinements: ["char4"] },      rendered: "string(char4)" },
  { col: "col_c16",   fp: { base: "string",  refinements: ["char16"] },     rendered: "string(char16)" },
  { col: "col_i8",    fp: { base: "int",     refinements: ["int8"] },       rendered: "int(int8)" },
  // Two markers. Refinements are sorted byte-ascending at parse time, so "char4" and
  // "date" each sort BEFORE "timestamp" -- these two rows prove renderColumnType consults
  // TYPE_NAMING_REFINEMENTS in DECLARED precedence, not in the array's own order.
  { col: "col_ts_c4",  fp: { base: "long",   refinements: ["char4", "timestamp"] }, rendered: "timestamp" },
  { col: "col_ts_dt",  fp: { base: "long",   refinements: ["date", "timestamp"] },  rendered: "timestamp" },
  { col: "col_dbl",   fp: { base: "double",  refinements: [] },             rendered: "double" },
  { col: "col_str",   fp: { base: "string",  refinements: [] },             rendered: "string" },
  { col: "col_bytes", fp: { base: "bytes",   refinements: [] },             rendered: "bytes" },
];

const fixtureMap = (): ColumnFingerprintMap => {
  const out: ColumnFingerprintMap = {};
  for (const f of FIXTURES) out[f.col] = f.fp;
  return out;
};

const byCol = (col: string) => {
  const found = FIXTURES.find((f) => f.col === col);
  if (!found) throw new Error(`fixture ${col} missing`);
  return found;
};

describe("renderColumnType / renderColumnsMap", () => {
  it("RENDER-temporal: a timestamp marker renders BARE, never long(timestamp)", () => {
    // The whole point. formatFingerprint would give "long(timestamp)", whose
    // parenthetical the web's normalizeType strips, leaving "long" -- a member of
    // NUMERIC_TYPES. That would classify every TIMESTAMP column as a NUMBER.
    const fpTs = byCol("col_ts").fp;
    expect(formatFingerprint(fpTs)).toBe("long(timestamp)");
    expect(renderColumnType(fpTs)).toBe("timestamp");
    expect(renderColumnType(fpTs)).not.toBe(formatFingerprint(fpTs));
  });

  it("RENDER-temporal-all: date, time and datetime markers each render bare", () => {
    for (const col of ["col_date", "col_time", "col_dt"]) {
      const f = byCol(col);
      expect(renderColumnType(f.fp)).toBe(f.rendered);
      expect(DATETIME_TYPES.has(renderColumnType(f.fp))).toBe(true);
    }
  });

  it("RENDER-boolean: a boolean marker renders bare", () => {
    const f = byCol("col_bool");
    expect(renderColumnType(f.fp)).toBe("boolean");
    expect(BOOLEAN_TYPES.has(renderColumnType(f.fp))).toBe(true);
    // The other spelling Kinetica may use is handled by the same list.
    expect(renderColumnType({ base: "int", refinements: ["bool"] })).toBe("bool");
  });

  it("RENDER-spatial: wkt and wkb markers render bare", () => {
    expect(renderColumnType(byCol("col_wkt").fp)).toBe("wkt");
    expect(renderColumnType(byCol("col_wkb").fp)).toBe("wkb");
    // Not `string(wkt)` -- that normalizes to `string`, which the drill-down
    // picker does NOT exclude.
    expect(renderColumnType(byCol("col_wkt").fp)).not.toBe("string(wkt)");
  });

  it("RENDER-width: char and int widths survive into the stored map", () => {
    expect(renderColumnType(byCol("col_c4").fp)).toBe("string(char4)");
    expect(renderColumnType(byCol("col_c16").fp)).toBe("string(char16)");
    expect(renderColumnType(byCol("col_i8").fp)).toBe("int(int8)");
    // char1/char4/char16 all reported `character(256)` through INFORMATION_SCHEMA;
    // they must now be DISTINCT stored values.
    expect(renderColumnType(byCol("col_c4").fp)).not.toBe(renderColumnType(byCol("col_c16").fp));
    // ...while still normalizing to the same class the old value did.
    expect(normalizeType(renderColumnType(byCol("col_c4").fp))).toBe("string");
    expect(normalizeType(renderColumnType(byCol("col_i8").fp))).toBe("int");
  });

  it("RENDER-plain: a fingerprint with no refinements renders its bare base", () => {
    expect(renderColumnType(byCol("col_dbl").fp)).toBe("double");
    expect(renderColumnType(byCol("col_bytes").fp)).toBe("bytes");
  });

  it("RENDER-multi: markers are consulted in DECLARED precedence, not array order", () => {
    // Both fixtures carry a marker that sorts BEFORE "timestamp" byte-ascending,
    // which is the order parseColumnFingerprints leaves refinements in. If the
    // renderer scanned fp.refinements rather than TYPE_NAMING_REFINEMENTS, these
    // would render "char4" and "date".
    const tsC4 = byCol("col_ts_c4");
    const tsDt = byCol("col_ts_dt");
    expect(tsC4.fp.refinements[0] < "timestamp").toBe(true);
    expect(tsDt.fp.refinements[0] < "timestamp").toBe(true);
    expect(tsC4.fp.refinements).toEqual(tsC4.fp.refinements.slice().sort());
    expect(tsDt.fp.refinements).toEqual(tsDt.fp.refinements.slice().sort());
    expect(renderColumnType(tsC4.fp)).toBe("timestamp");
    expect(renderColumnType(tsDt.fp)).toBe("timestamp");
  });

  it("RENDER-deterministic: rendering is stable, and key order does not change values", () => {
    const a = fixtureMap();
    expect(renderColumnsMap(a)).toEqual(renderColumnsMap(a));

    const reversed: ColumnFingerprintMap = {};
    for (const f of [...FIXTURES].reverse()) reversed[f.col] = f.fp;
    expect(Object.keys(reversed)[0]).not.toBe(Object.keys(a)[0]);

    const ra = renderColumnsMap(a);
    const rr = renderColumnsMap(reversed);
    expect(rr).toEqual(ra);
    // Key order FOLLOWS the input map (Kinetica's ordinal order), deliberately.
    expect(Object.keys(rr)).toEqual(Object.keys(reversed));
  });

  it("RENDER-map: every fixture renders to its declared string through renderColumnsMap", () => {
    const rendered = renderColumnsMap(fixtureMap());
    for (const f of FIXTURES) expect(rendered[f.col]).toBe(f.rendered);
    expect(Object.keys(rendered).length).toBe(FIXTURES.length);
  });

  it("RENDER-text-gap: an unrestricted-length string renders `string`, the documented gap", () => {
    // Pins SCHEMA_APPLY_TEXT_WIDTH_GAP by TEST, not only by prose. Kinetica has no
    // marker for this, so the column INFORMATION_SCHEMA called `text` is stored as
    // `string` -- and `string` is NOT in the web's EXCLUDED_DRILLDOWN_TYPES, so it
    // becomes selectable in the drill-down picker where it was excluded before.
    expect(renderColumnType({ base: "string", refinements: [] })).toBe("string");
    expect(WEB_EXCLUDED_DRILLDOWN_TYPES.has("text")).toBe(true);
    expect(WEB_EXCLUDED_DRILLDOWN_TYPES.has("string")).toBe(false);
    expect(SCHEMA_APPLY_TEXT_WIDTH_GAP).toContain("text");
    expect(SCHEMA_APPLY_TEXT_WIDTH_GAP).toContain("drill-down picker");
  });
});

// Independently hardcoded from packages/web/src/lib/columnTypes.ts:29-38 -- the same
// technique lib.columnTypeClass.spec.ts uses for the three type Sets. There are no
// cross-package imports in this repo, so mirroring in the SPEC is how the server proves
// it writes strings the web's own taxonomy reads correctly.
const WEB_EXCLUDED_DRILLDOWN_TYPES: ReadonlySet<string> = new Set([
  "wkt",
  "wkb",
  "bytes",
  "blob",
  "text",
  "point",
  "geometry",
  "geography",
]);

describe("WEB_EXCLUDED_DRILLDOWN_TYPES mirror", () => {
  it("MIRROR-PARITY: the drill-down exclusion set equals the web's EXCLUDED_DRILLDOWN_TYPES, read from source", () => {
    // Without this, the mirror above is unguarded: the only other assertions on it are two
    // membership spot-checks (`has("text")`, `has("string")`), so the web adding a NINTH
    // excluded type would redden nothing here and PARITY-drilldown would keep passing while
    // silently checking a stale taxonomy. v1.25 audit F2: this used to compare the mirror
    // against a SECOND hardcoded literal, which cannot fail when the web changes. The right
    // side is now parsed out of packages/web/src/lib/columnTypes.ts itself. Sorted on both
    // sides so the assertion does not depend on Set insertion order.
    expect([...WEB_EXCLUDED_DRILLDOWN_TYPES].sort()).toEqual(
      readWebTypeSet("EXCLUDED_DRILLDOWN_TYPES").sort(),
    );
  });
});

/**
 * Local re-implementation of packages/web/src/lib/columnTypes.ts's
 * inferDataTypeFromColumn branch order, built from the sets exported by
 * columnTypeClass.ts -- which lib.columnTypeClass.spec.ts already parity-guards against
 * the web original. This is the WEB's answer, derived from a rendered string.
 */
const webInfer = (rendered: string): string => {
  const t = normalizeType(rendered);
  if (t === "") return "null";
  if (NUMERIC_TYPES.has(t)) return "number";
  if (BOOLEAN_TYPES.has(t)) return "boolean";
  if (DATETIME_TYPES.has(t)) return "datetime";
  return "string";
};

describe("parity between what is WRITTEN and what the web READS", () => {
  it("PARITY-class: every rendered fixture classifies as classifyFingerprint says it should", () => {
    // Asserted against the SHIPPED classifier, never against a table of hardcoded
    // expected classes -- a sweep that restates the classifier's own answers proves
    // nothing. classifyFingerprint's "unknown" sentinel maps to "string", matching
    // inferDataTypeFromColumn's own default branch.
    const rendered = renderColumnsMap(fixtureMap());
    expect(Object.keys(rendered).length).toBe(FIXTURES.length);
    for (const f of FIXTURES) {
      const expected = classifyFingerprint(f.fp);
      const viaWeb = webInfer(rendered[f.col]);
      expect(viaWeb).toBe(expected === "unknown" ? "string" : expected);
    }
  });

  it("PARITY-class-naive: formatFingerprint straight into tables.columns would BREAK this", () => {
    // The counter-proof. Without this the PARITY-class sweep could pass against a
    // renderer that does nothing, and the reader would have no evidence the problem
    // was real. At least one fixture must disagree under the naive renderer.
    const disagreements = FIXTURES.filter((f) => {
      const expected = classifyFingerprint(f.fp);
      return webInfer(formatFingerprint(f.fp)) !== (expected === "unknown" ? "string" : expected);
    }).map((f) => f.col);
    expect(disagreements.length).toBeGreaterThan(0);
    expect(disagreements).toContain("col_ts");
  });

  it("PARITY-drilldown: spatial markers and a bytes base stay OUT of the drill-down picker", () => {
    const rendered = renderColumnsMap(fixtureMap());
    const spatialOrBytes = FIXTURES.filter(
      (f) =>
        f.fp.refinements.includes("wkt") ||
        f.fp.refinements.includes("wkb") ||
        f.fp.base === "bytes",
    );
    expect(spatialOrBytes.length).toBeGreaterThanOrEqual(3);
    for (const f of spatialOrBytes) {
      expect(WEB_EXCLUDED_DRILLDOWN_TYPES.has(normalizeType(rendered[f.col]))).toBe(true);
    }
    // And the naive renderer would admit the geometry column -- `string(wkt)`
    // normalizes to `string`, which is not excluded.
    expect(WEB_EXCLUDED_DRILLDOWN_TYPES.has(normalizeType(formatFingerprint(byCol("col_wkt").fp)))).toBe(false);
  });
});
