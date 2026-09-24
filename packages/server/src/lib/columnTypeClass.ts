/**
 * columnTypeClass.ts — classify a Kinetica `ColumnFingerprint` into the same
 * four-way type CLASS the UI branches on, and grade the severity of a retype
 * between two fingerprints.
 *
 * WHAT THIS MODULE ANSWERS
 * -------------------------
 * (a) What type CLASS does the UI branch on for this column fingerprint
 *     (`classifyFingerprint`), and (b) does a given retype change that class
 *     (`severityForRetype`). Everything downstream — the impact report
 *     (Plan 124-02/03), its persistence (Phase 125), and its rendering
 *     (Phase 126) — is planned against this module's exported surface.
 *
 * PURE.
 * -----
 * No `db`, no `express`, no `fetch`, no Kinetica call. Only a type-only
 * import of `ColumnFingerprint` — the shape being classified.
 *
 * THIS IS A MIRROR.
 * ------------------
 * `NUMERIC_TYPES`, `BOOLEAN_TYPES`, `DATETIME_TYPES` and `normalizeType` are
 * copied verbatim from `packages/web/src/lib/columnTypes.ts` lines 42-69,
 * which is CANONICAL. They are file-local `const`/`function` there (NOT
 * exported — verified: `grep -cE "^export const (NUMERIC_TYPES|BOOLEAN_TYPES|
 * DATETIME_TYPES)" packages/web/src/lib/columnTypes.ts` = 0), and the two
 * packages have zero cross-package imports (npm workspaces, but no
 * `packages/shared`), so a byte-identical copy is the only way the server can
 * reach this taxonomy without editing `packages/web`. Parity is enforced by
 * `tests/lib.columnTypeClass.spec.ts`'s `MIRROR-PARITY:` assertions, which
 * hardcode the web literals INDEPENDENTLY — the same mechanism
 * `packages/web/src/lib/dynamicViewName.ts` uses to mirror the server's
 * `sanitizeForViewName` (a spec with hardcoded round-trip pairs, not a
 * cross-tree import). Editing the web Sets without editing these reddens
 * that spec. This is the FIRST web -> server mirror in this repo — the three
 * existing pairs (`permissions.ts`, `spatialTargets.ts`, `dynamicViewName.ts`)
 * all run server -> web.
 *
 * WHY REFINEMENTS ARE CONSULTED BEFORE BASE.
 * -------------------------------------------
 * A Kinetica TIMESTAMP fingerprint is `{ base: "long", refinements:
 * ["timestamp"] }` — LIVE-VERIFIED against the deployed instance
 * (2026-09-23 probe, `124-RESEARCH.md`'s ADDENDUM). `"long"` is a member of
 * `NUMERIC_TYPES`, so a rule that classifies on `base` alone calls this
 * column `"number"`, and a `timestamp -> bigint` retype (which changes
 * nothing about the base, only the refinement) would then grade as
 * `"harmless"` when it is about as breaking as a change can be — the exact
 * flattening `packages/server/src/lib/showTableTypes.ts` exists to undo one
 * layer up, reintroduced in the code that decides what to TELL the operator.
 *
 * Checking the property MARKER first is also robust to an unresolved
 * contradiction in this project's own sources: this repo's own
 * `showTableTypes.ts` header claims DATE/TIME/DATETIME all share the `long`
 * base, while Kinetica's published 7.1 docs say those three sit on `string`
 * and only TIMESTAMP is `long`-base. The rule below keys on the refinement
 * marker regardless of which base carries it, so it is correct under either
 * reading — the planner does not need to resolve that contradiction to ship
 * a correct rule.
 *
 * VERIFICATION STATUS — STATED PLAINLY, NOT BLURRED.
 * -----------------------------------------------------
 * `timestamp` (`base=long, refinements=[timestamp]`) and `numeric(p,s)`
 * (`base=double, refinements=[]`) are LIVE-VERIFIED against the deployed
 * instance (2026-09-23 probe, recorded in `124-RESEARCH.md`'s ADDENDUM —
 * which CORRECTS the research body's docs-derived claim that decimal sits on
 * base `string`; the real instance returns `base=double` with no
 * refinement). `boolean`, `date`, `time` and `datetime` are
 * DOCUMENTATION-DERIVED and **NOT verified against a live body**: every
 * registered table carrying those types has been dropped from Kinetica
 * (`/show/table` returns `table_names: []` for them), so no live fingerprint
 * of any of the four could be captured. They are covered by name, on BOTH
 * candidate bases, because the refinement-first rule is designed to be safe
 * under either reading of the base-type contradiction above — but
 * designed-to-be-safe is NOT the same claim as verified, and this comment
 * must not blur the two.
 */

import type { ColumnFingerprint } from "./schemaFingerprint";

/**
 * The four classes the UI branches on, plus the sentinel. Reproduces
 * `packages/web/src/lib/columnTypes.ts`'s `DrillDownDataType` minus its
 * `"null"` member (which there means "column absent from the map" — a
 * question this module, which always receives a real fingerprint, is never
 * asked).
 */
export type ColumnTypeClass = "string" | "number" | "boolean" | "datetime" | "unknown";

/** Locked in 124-CONTEXT.md § "Severity — three levels, not two". */
export type ImpactSeverity = "breaking" | "changed" | "harmless";

// ---------------------------------------------------------------------------
// MIRROR: copied verbatim from packages/web/src/lib/columnTypes.ts:42-69.
// Do not "improve" these — parity with the web original is the point, and is
// enforced by tests/lib.columnTypeClass.spec.ts's MIRROR-PARITY: assertions.
// ---------------------------------------------------------------------------

export const NUMERIC_TYPES: ReadonlySet<string> = new Set([
  "int", "integer", "int8", "int16", "int32", "int64",
  "long", "float", "double", "double precision", "decimal", "numeric",
  "smallint", "bigint", "real", "number", "tinyint",
]);
export const BOOLEAN_TYPES: ReadonlySet<string> = new Set(["bool", "boolean"]);
export const DATETIME_TYPES: ReadonlySet<string> = new Set(["timestamp", "date", "time", "datetime"]);

/** Mirrors columnTypes.ts's normalizeType exactly: lowercase, strip a parenthesised suffix, trim. */
export function normalizeType(colType: string): string {
  return colType.toLowerCase().replace(/\(.*\)/, "").trim();
}

/**
 * Classify a fingerprint into the class the UI branches on.
 *
 * Order matters — each step precedes the next for a specific reason:
 *   1. Refinement MARKERS beat base, in all cases, because a Kinetica
 *      property can refine (override) whatever the base alone would imply.
 *   2. The normalizeAvroType failure sentinel (`base === "unknown"` or
 *      `""`), checked only once no refinement marker has already resolved
 *      the class — a marker beats even the sentinel.
 *   3. Base membership, mirroring inferDataTypeFromColumn's own order.
 *   4. Default to "string" for everything else.
 */
export function classifyFingerprint(fp: ColumnFingerprint): ColumnTypeClass {
  // 1. Class-determining property MARKERS first, regardless of which base
  //    carries them. DATETIME_TYPES ({timestamp,date,time,datetime}) is
  //    consulted here as REFINEMENT markers, never as base values: none of
  //    those four ever appears as a fingerprint's `base` (124-RESEARCH §1.3).
  for (const r of fp.refinements) if (DATETIME_TYPES.has(r)) return "datetime";
  for (const r of fp.refinements) if (BOOLEAN_TYPES.has(r)) return "boolean";
  // `decimal(18,4)` -> normalizeType -> `decimal` in NUMERIC_TYPES. Width
  // markers like `char4`, `int8` are handled here too and are harmless:
  // `char4` matches nothing, `int8` is numeric and its base `int` is numeric
  // too, so the answer is the same either way.
  for (const r of fp.refinements) if (NUMERIC_TYPES.has(normalizeType(r))) return "number";

  // 2. The normalizeAvroType failure sentinel. NEVER silently absorbed into
  //    a real class — a retype involving it is graded `breaking` by
  //    severityForRetype (below).
  if (fp.base === "unknown" || fp.base === "") return "unknown";

  // 3. Base membership, mirroring inferDataTypeFromColumn's own order.
  if (NUMERIC_TYPES.has(normalizeType(fp.base))) return "number";
  if (BOOLEAN_TYPES.has(normalizeType(fp.base))) return "boolean";   // defensive: no native boolean base is known
  if (DATETIME_TYPES.has(normalizeType(fp.base))) return "datetime"; // defensive: only `timestamp` is a known long-base property

  // 4. Everything else — string / bytes bases, char*/ipv4/uuid/json/array/wkt
  //    refinements, and anything unrecognised. Matches
  //    inferDataTypeFromColumn's own default, and matches today's legacy
  //    behaviour for a `geometry` column (which also falls through to
  //    "string").
  return "string";
}

/**
 * A removed column is ALWAYS breaking — including one whose only reference
 * is a heuristic free-SQL match. 124-CONTEXT.md locks that: such a finding
 * stays in the breaking section with its certainty stated, never demoted to
 * a separate "possibly affected" area. A genuinely referenced dropped column
 * is the worst case this feature exists to catch; a false positive costs the
 * operator seconds, because Phase 123 supplies the matched line and offset.
 */
export const REMOVED_SEVERITY: ImpactSeverity = "breaking";

/** An added column breaks nothing — it only needs to become selectable in
 *  config panels (SSYNC-V125-11, ROADMAP criterion 3). */
export const ADDED_SEVERITY: ImpactSeverity = "harmless";

/**
 * `breaking` when the type CLASS flips; `changed` when the class holds but
 * the type moved.
 *
 * `unknown` on EITHER side is breaking, never `changed`: `unknown` is
 * normalizeAvroType's failure sentinel, and grading an unreadable type as
 * "nothing misbehaves" would be a confident claim made from no information.
 * This is the same fail-toward-reporting rule columnRefs.ts and
 * schemaDiff.ts apply throughout this dependency chain. It is deliberately
 * NOT expressible as `a !== b`, because `unknown -> unknown` is
 * equal-but-still-breaking.
 */
export function severityForRetype(
  stored: ColumnFingerprint,
  live: ColumnFingerprint,
): ImpactSeverity {
  const storedClass = classifyFingerprint(stored);
  const liveClass = classifyFingerprint(live);
  if (storedClass === "unknown" || liveClass === "unknown") return "breaking";
  return storedClass === liveClass ? "changed" : "breaking";
}
