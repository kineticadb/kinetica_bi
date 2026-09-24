---
phase: 124-impact-report
plan: 01
subsystem: api
tags: [schema-sync, type-classification, pure-lib, vitest, mutation-testing]

# Dependency graph
requires:
  - phase: 122-schema-diff-table-missing-detection
    provides: "ColumnFingerprint shape, SchemaCheckResult three-outcome discriminated union"
  - phase: 123-column-reference-enumeration
    provides: "ColumnRef contract and mutation-probe test pattern this plan continues"
provides:
  - "ColumnTypeClass / ImpactSeverity types"
  - "classifyFingerprint(fp) — refinement-first fingerprint -> UI type-class classifier"
  - "severityForRetype(stored, live) — three-level severity grading"
  - "REMOVED_SEVERITY (breaking), ADDED_SEVERITY (harmless) constants"
  - "NUMERIC_TYPES / BOOLEAN_TYPES / DATETIME_TYPES / normalizeType — byte-parity mirror of packages/web/src/lib/columnTypes.ts:42-69"
affects: [124-02-naming, 124-03-report-assembler, 124-04-route-wiring, 125-persist-history, 126-render-report]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "First web -> server mirror in this repo (the three existing pairs — permissions.ts, spatialTargets.ts, dynamicViewName.ts — all run server -> web)"
    - "Refinement-before-base classification order, to survive an unresolved base-type contradiction between showTableTypes.ts's header and Kinetica's own docs"

key-files:
  created:
    - packages/server/src/lib/columnTypeClass.ts
    - packages/server/tests/lib.columnTypeClass.spec.ts
  modified: []

key-decisions:
  - "Mirrored only the three Sets + normalizeType (Option B from 124-RESEARCH §2.4), not the whole columnTypes.ts file (Option A) and not a new packages/shared workspace (Option C)"
  - "classifyFingerprint checks refinements for a class-determining marker BEFORE falling back to base membership, specifically to avoid classifying a TIMESTAMP (base=long) as number"
  - "unknown on EITHER side of a retype forces severityForRetype to breaking, never changed — deliberately not expressible as a !== b comparison"
  - "boolean/date/time/datetime fingerprint shapes are covered by name on BOTH candidate bases and labelled UNVERIFIED in test titles, per the operator's explicit 2026-09-24 decision, because every table carrying them has been dropped from the live Kinetica instance"

requirements-completed: [SSYNC-V125-12]

duration: 25min
completed: 2026-09-24
---

# Phase 124 Plan 01: Fingerprint Type-Class & Severity Rule Summary

**Refinement-first `classifyFingerprint`/`severityForRetype` pure lib that keeps a Kinetica TIMESTAMP (base `long`) from misclassifying as `number`, mirroring three web-side type Sets with independently-hardcoded parity assertions.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-09-24T15:00:00-04:00 (approx., first file read)
- **Completed:** 2026-09-24T15:12:08-04:00
- **Tasks:** 2 completed
- **Files modified:** 2 (both created)

## Accomplishments
- Shipped `classifyFingerprint`, which checks `refinements` for a class-determining marker BEFORE falling back to `base` — the rule that keeps a TIMESTAMP (`base=long, refinements=[timestamp]`) from classifying as `number` just because `long` is a member of `NUMERIC_TYPES`.
- Shipped `severityForRetype` with the three locked levels (`breaking`/`changed`/`harmless`) and an `unknown`-on-either-side override, plus `REMOVED_SEVERITY`/`ADDED_SEVERITY` constants.
- Mirrored `NUMERIC_TYPES`/`BOOLEAN_TYPES`/`DATETIME_TYPES`/`normalizeType` byte-for-byte from `packages/web/src/lib/columnTypes.ts:42-69`, pinned by three `MIRROR-PARITY:` assertions that hardcode the web literals independently (not an import-and-compare-to-itself).
- Ran and recorded all 9 mutation probes; every one reddened its named test on the first try — no probe required strengthening, no probe was weakened, no implementation was edited to force a probe to fire.

## Task Commits

1. **Task 1: The mirrored sets and classifyFingerprint (refinement-first)** - `4eae586` (feat) — also includes `severityForRetype`/`REMOVED_SEVERITY`/`ADDED_SEVERITY` (see Deviations)
2. **Task 2: severityForRetype fixtures and the mutation probe sweep** - `41c3162` (test)

_Note: both tasks' `files_modified` in the plan name the same two files (`columnTypeClass.ts` + its spec); the implementation ended up landing in one commit rather than split across both — see Deviations._

## Verbatim Declarations

Reproduced exactly as shipped in `packages/server/src/lib/columnTypeClass.ts`. Plans 124-02/03/04 and Phases 125/126 are planned against this text.

```ts
/** The four classes the UI branches on, plus the sentinel. Reproduces
 *  packages/web/src/lib/columnTypes.ts `DrillDownDataType` minus its "null" member (which means
 *  "column absent from the map", a question this module is never asked). */
export type ColumnTypeClass = "string" | "number" | "boolean" | "datetime" | "unknown";

/** Locked in 124-CONTEXT.md § "Severity — three levels, not two". */
export type ImpactSeverity = "breaking" | "changed" | "harmless";

export const NUMERIC_TYPES: ReadonlySet<string> = new Set([
  "int", "integer", "int8", "int16", "int32", "int64",
  "long", "float", "double", "double precision", "decimal", "numeric",
  "smallint", "bigint", "real", "number", "tinyint",
]);
export const BOOLEAN_TYPES: ReadonlySet<string> = new Set(["bool", "boolean"]);
export const DATETIME_TYPES: ReadonlySet<string> = new Set(["timestamp", "date", "time", "datetime"]);

export function normalizeType(colType: string): string {
  return colType.toLowerCase().replace(/\(.*\)/, "").trim();
}

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

export const REMOVED_SEVERITY: ImpactSeverity = "breaking";

export const ADDED_SEVERITY: ImpactSeverity = "harmless";

export function severityForRetype(
  stored: ColumnFingerprint,
  live: ColumnFingerprint,
): ImpactSeverity {
  const storedClass = classifyFingerprint(stored);
  const liveClass = classifyFingerprint(live);
  if (storedClass === "unknown" || liveClass === "unknown") return "breaking";
  return storedClass === liveClass ? "changed" : "breaking";
}
```

## Verification-Status Table (stated honestly, NOT blurred)

"Designed to be safe" is not "verified":

| Fingerprint shape | Class | Status |
|---|---|---|
| `base=long, refinements=[timestamp]` | `datetime` | **LIVE-VERIFIED** (2026-09-23 probe, `124-RESEARCH.md` ADDENDUM) |
| `base=double, refinements=[]` (numeric(p,s)) | `number` | **LIVE-VERIFIED** — corrects the research body's docs-derived claim that decimal sits on base `string` |
| `base=string, refinements=[char1/char4/char16/char256]` | `string` | **LIVE-VERIFIED** |
| `base=int, refinements=[int8/int16]`; `base=float` | `number` | **LIVE-VERIFIED** |
| `boolean` marker (on `int` or `string` base) | `boolean` | **DOCUMENTATION-DERIVED, NOT VERIFIED** against a live body |
| `date` / `time` / `datetime` markers (on `string` or `long` base) | `datetime` | **DOCUMENTATION-DERIVED, NOT VERIFIED** against a live body |
| `wkt` / `bytes` | `string` | **LOW CONFIDENCE** — no live fingerprint of a geometry column has ever been captured |

**Why the four unverified types stayed unverified:** every registered table carrying `boolean`/`date`/`time`/`datetime` has been dropped from Kinetica, so `/show/table` returns `table_names: []` for them and they could not be probed. Per the operator's explicit decision (2026-09-24), they are covered by name on BOTH candidate bases — `fp("int", ["boolean"])` and `fp("string", ["boolean"])`; `fp("string", ["date"])` and `fp("long", ["date"])`, etc. — because the refinement-first rule is designed to be safe under either reading of the `showTableTypes.ts`-vs-Kinetica-docs contradiction. This is a design property, not a live-verification claim, and the test titles say `UNVERIFIED` rather than implying otherwise.

## Mirror-vs-Move Decision (reproduced from the plan's `<mirror_vs_move_decision>`)

**Decided: mirror the three Sets plus `normalizeType` into a new server lib (Option B). Not Option A (mirror the whole 330-line `columnTypes.ts` file), not Option C (a `packages/shared` workspace).**

1. **A shared package is structurally blocked without touching `packages/web`.** `NUMERIC_TYPES`, `BOOLEAN_TYPES`, `DATETIME_TYPES` and `normalizeType` are file-local `const`/`function` in `packages/web/src/lib/columnTypes.ts`, **NOT exported** (verified: `grep -cE "^export const (NUMERIC_TYPES|BOOLEAN_TYPES|DATETIME_TYPES)" packages/web/src/lib/columnTypes.ts` = 0). Options A and C both require changing that file's export surface or copying it; only the Set-level mirror leaves `packages/web` byte-unchanged, which this server-only phase requires.
2. **The whole-file mirror imports dead weight.** `columnTypes.ts` is 330 lines of which ~200 are UI-only (`buildChipText`, `formatDatetimeRange`, `getValidSpatialColumns`, `getTrackIdColumns`, `autoSuggestSpatialMode`) plus a second file (`trackDetect.ts`) the server would never call.
3. **The novel code was never going to be a mirror of anything.** `inferDataTypeFromColumn` takes a flat `INFORMATION_SCHEMA`-shaped string; a `ColumnFingerprint` has no such string. `classifyFingerprint` is genuinely new server code with no web counterpart — calling it a "port" would be false.
4. **Direction is a first for this repo.** `permissions.ts`, `spatialTargets.ts`, `dynamicViewName.ts` all run server -> web; this runs web -> server, so the parity mechanism is made explicit exactly as `dynamicViewName.ts` did it: a header comment naming the canonical file and line range, plus a spec (`MIRROR-PARITY:`) that hardcodes the literals independently rather than importing and comparing to itself.

## Mutation Probe Table (all 9 fired against their named tests)

| # | Mutation | Named test | Result |
|---|----------|------------|--------|
| P1 | Delete the `DATETIME_TYPES`-over-refinements loop | "CLASS: LIVE-VERIFIED — a TIMESTAMP (base long, refinements [timestamp]) is datetime, NOT number" | **REDDENED** as specified — `long` base fell through to `NUMERIC_TYPES.has("long")` and returned `number`. Collateral: 5 other `datetime`-refinement tests also failed, as expected. |
| P2 | Move the `NUMERIC_TYPES.has(normalizeType(fp.base))` base check ABOVE the refinement loops | same as P1 | **REDDENED** — with the base check first, `fp("long",["timestamp"])` returned `number` before the refinement loop was ever reached. |
| P3 | Delete the `BOOLEAN_TYPES`-over-refinements loop | "CLASS: UNVERIFIED — a boolean marker is boolean on EITHER an int or a string base" | **REDDENED** — `fp("int",["boolean"])` fell through to base membership and returned `number`. |
| P4 | Delete the `NUMERIC_TYPES.has(normalizeType(r))` refinement loop | "CLASS: UNVERIFIED — a decimal(p,s) refinement is number even though the base is string" | **REDDENED** — `fp("string",["decimal(18,4)"])` fell through to the string default. |
| P5 | Return `"string"` instead of `"unknown"` for the sentinel base | "CLASS: the unknown sentinel with no class-determining refinement stays unknown" | **REDDENED** — `fp("unknown",[])` returned `"string"`. |
| P6 | Move the `unknown`-sentinel check ABOVE the refinement loops | "CLASS: a refinement marker beats the base, including when the base is the unknown sentinel" | **REDDENED** — `fp("unknown",["timestamp"])` returned `"unknown"` instead of `"datetime"` because the sentinel check pre-empted the refinement loop. |
| P7 | Remove `"long"` from the mirrored `NUMERIC_TYPES` | "MIRROR-PARITY: NUMERIC_TYPES is exactly the 17 members of the web original" | **REDDENED** — set comparison and the `.size` assertion both failed (16 vs 17 members). |
| P8 | Change `normalizeType` to drop the `.trim()` | "MIRROR-PARITY: normalizeType lowercases, strips a parenthesised suffix, and trims" | **REDDENED** — `normalizeType("  Character(256) ")` returned `"  character "` instead of `"character"`. |
| P9 | Replace `severityForRetype`'s unknown guard with a plain `storedClass === liveClass` test | "SEVERITY: a retype touching the unknown sentinel on EITHER side is breaking" | **REDDENED** — specifically on the `unknown -> unknown` case (`storedClass === liveClass` is trivially true for two `"unknown"` classes, so the plain-equality mutant returned `"changed"` instead of `"breaking"`), which is exactly the equal-but-still-breaking case this probe exists to catch. |

Every probe fired on the first attempt with no test strengthening needed and no implementation edited to force a fire. After each probe the source file was restored via file copy and diffed byte-identical against the pre-mutation version before moving to the next probe.

## Files Created/Modified
- `packages/server/src/lib/columnTypeClass.ts` — pure lib: `ColumnTypeClass`, `ImpactSeverity`, the three mirrored Sets + `normalizeType`, `classifyFingerprint`, `severityForRetype`, `REMOVED_SEVERITY`, `ADDED_SEVERITY`. Type-only import of `ColumnFingerprint` from `./schemaFingerprint`; no other imports.
- `packages/server/tests/lib.columnTypeClass.spec.ts` — 21 tests: 3 `MIRROR-PARITY:` set/function assertions, 10 `CLASS:` fixtures (labelled `LIVE-VERIFIED` or `UNVERIFIED`), 8 `SEVERITY:` fixtures covering all three severity levels plus the unknown-sentinel override plus the two unconditional constants.

## Decisions Made
- Mirrored only the three Sets + `normalizeType` (Option B), not the whole `columnTypes.ts` file or a new `packages/shared` workspace — see "Mirror-vs-Move Decision" above.
- Kept the refinement-first check order exactly as specified in the plan (datetime markers, then boolean markers, then numeric markers, then the unknown sentinel, then base membership, then string default) — this order is what makes P1/P2/P6 discriminating mutation probes.
- Left `boolean`/`date`/`time`/`datetime` fixtures labelled `UNVERIFIED` in test titles rather than implying they were confirmed against a live body.

## Deviations from Plan

### Process deviation (not a Rule 1-4 case — no code behavior affected)

**Task 1/Task 2 boundary collapsed into a single implementation write.** The plan splits the work into Task 1 (mirrored sets + `classifyFingerprint`) and Task 2 (`severityForRetype` + `REMOVED_SEVERITY`/`ADDED_SEVERITY` + the mutation sweep), both touching the same two files. Because the full `columnTypeClass.ts` content was drafted as one file in one `Write` call, the Task 1 commit (`4eae586`) already contains `severityForRetype`/`REMOVED_SEVERITY`/`ADDED_SEVERITY`, not just `classifyFingerprint`. The Task 2 commit (`41c3162`) then contains only the spec extension (the `severityForRetype` `SEVERITY:` fixtures) plus the mutation-probe verification work. Both files' final content match the plan's `<action>` blocks exactly; only the commit-boundary granularity differs from the plan's task-by-task split. No functional impact — flagging per the "document all deviations" instruction.

### Toothless acceptance criterion found and reported (not fixed by editing code)

**Task 1, acceptance criterion 8** (`grep -cE '\brequire\(|from "\.\./db"|from "express"|fetch\(|packages/web' src/lib/columnTypeClass.ts` = 0) **does not discriminate as written.** The plan's own Task 1 `<action>` block *requires* the header comment to cite `packages/web/src/lib/columnTypes.ts` by path (prose naming the canonical file being mirrored, per the `dynamicViewName.ts` precedent) — so the literal string `packages/web` necessarily appears 6 times in header-comment prose. The grep counted 6, not 0.

Per CLAUDE.md ("if an executor finds a criterion that cannot discriminate, it should report it and verify the real requirement directly — never edit code to satisfy a broken check"), I did **not** strip the required attribution comments. Instead I verified the real requirement directly:
- `grep -n "^import" src/lib/columnTypeClass.ts` → exactly one line: `import type { ColumnFingerprint } from "./schemaFingerprint";` — the only import in the file, type-only, same-package.
- `grep -nE '\brequire\(|from "\.\./db"|from "express"|fetch\(|packages/web' src/lib/columnTypeClass.ts` → all 6 matches are on comment lines (`//` or `/* */`), zero are on code lines.

The real requirement — purity (no `db`/`express`/`fetch`/`require`) and no actual cross-package import statement — holds. The grep-as-written is a false positive against this plan's own mandated documentation style; a future plan-check pass should anchor this prohibition on code lines only (e.g. exclude comment lines, or match `from "packages/web` with a closing quote) rather than a bare substring.

---

**Total deviations:** 1 process deviation (commit-boundary granularity, no functional impact), 1 toothless-criterion finding (reported, real requirement verified directly, no code changed to game the check).
**Impact on plan:** None on shipped behavior. Both mirrored-set parity and purity hold as specified.

## Issues Encountered

**Operator error during gate verification (self-corrected, not a code issue):** `node scripts/test-gate.mjs` was accidentally invoked once from the repo root (a `--version` typo caused a stray full invocation before `cd packages/server`), which picked up the whole npm-workspaces vitest config and mixed in `packages/web` specs, producing a misleading "156 failing files" result. The stray background process was killed, and the gate was re-run correctly from `packages/server`, producing the clean, expected 8/8 `KNOWN_FAILING` result documented below. No code was affected; this was purely a wrong invocation directory.

## User Setup Required

None — no external service configuration required.

## Gate Reports

- **`cd packages/server && npx tsc --noEmit`** — clean (exit 0), both after Task 1 and after Task 2.
- **`cd packages/server && npx vitest run tests/lib.columnTypeClass.spec.ts`** — 21/21 passed.
- **`cd packages/server && node scripts/test-gate.mjs`** — **SET-BASED**, run twice (once mid-plan, once after the mutation-probe sweep + restore):
  - Full run: 1368-1421/1421 tests passed (1367/1421 or 1368/1421 across the two runs — trivial run-to-run variance, not size drift); 8 or 9 failing files.
  - **8 documented `KNOWN_FAILING`** every time: `tests/auth.oidc.spec.ts`, `tests/auth.routes.spec.ts`, `tests/boot.hardening.spec.ts`, `tests/boot.wipe.spec.ts`, `tests/bootstrap.spec.ts`, `tests/db.smoke.spec.ts`, `tests/oidc.module.spec.ts`, `tests/routes.wms.spec.ts` — set unchanged, has NOT grown.
  - One run additionally saw `tests/routes.filter-materialize.spec.ts` fail under full-parallel scheduling; re-run alone it **PASSED** — `TD-V16-TEST-ISOLATION` contamination, allowed and reported per the gate script's own logic, not a regression from this plan's files.
  - GATE PASSED both times.
- **`git diff --name-only 0a12756 | grep -c '^packages/web/'`** = **0** — `packages/web` is untouched. Web gates (`tsc`, `vitest`, `theme-guard`) were therefore not re-run, per the plan's own verification note.

## Next Phase Readiness

`classifyFingerprint`, `severityForRetype`, `REMOVED_SEVERITY`, and `ADDED_SEVERITY` are exported and ready for Plan 124-02 (naming) and 124-03 (report assembler) to consume. The verbatim declarations above are the contract; no further changes to this module are expected from those plans. No blockers.

---
*Phase: 124-impact-report*
*Completed: 2026-09-24*

## Self-Check: PASSED

- FOUND: `packages/server/src/lib/columnTypeClass.ts`
- FOUND: `packages/server/tests/lib.columnTypeClass.spec.ts`
- FOUND: `.planning/phases/124-impact-report/124-01-SUMMARY.md`
- FOUND: commit `4eae586` (feat(124-01): mirror the type-class sets and classifyFingerprint)
- FOUND: commit `41c3162` (test(124-01): add severityForRetype fixtures and run the 9-probe mutation sweep)
