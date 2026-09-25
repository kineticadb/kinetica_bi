---
phase: 125-apply-sync-history
plan: 02
subsystem: server-lib
tags: [schema-sync, fingerprint, optimistic-concurrency, type-class, pure-lib]
requires:
  - packages/server/src/lib/schemaFingerprint.ts (ColumnFingerprint / formatFingerprint, Phase 122)
  - packages/server/src/lib/columnTypeClass.ts (classifyFingerprint + the mirrored type Sets, Phase 124)
  - packages/web/src/lib/columnTypes.ts (CANONICAL consumer — READ ONLY, zero diff)
provides:
  - canonicalFingerprintJson (order-independent canonical form)
  - isStaleAgainst + SCHEMA_APPLY_STALE_MESSAGE (the optimistic-concurrency refusal)
  - renderColumnType / renderColumnsMap / TYPE_NAMING_REFINEMENTS
  - SCHEMA_APPLY_TEXT_WIDTH_GAP
affects:
  - packages/server/src/lib/schemaApply.ts is now the home for Plan 125-03's applySchemaSync
tech-stack:
  added: []
  patterns: [pure lib with no db/express/fetch, web->server type-set mirror asserted in the spec, one shared fixture table driving render AND parity tests]
key-files:
  created:
    - packages/server/src/lib/schemaApply.ts
    - packages/server/tests/lib.schemaApply.spec.ts
  modified:
    - packages/server/src/lib/schemaFingerprint.ts (PURE APPEND, 36 added / 0 deleted)
decisions:
  - "Echo the whole fingerprint map over minting a digest — no new check-response field, no second implementation in packages/web, no collision surface"
  - "Canonical key order is byte-ascending, never localeCompare, so the comparison is machine-independent"
  - "canonicalFingerprintJson does NOT re-sort refinements — parseColumnFingerprints already did, and a second sort would create a rival notion of fingerprint identity"
  - "Type-NAMING markers (temporal/boolean/spatial) are emitted BARE; width markers keep the parenthetical, because normalizeType strips it harmlessly there and destructively here"
  - "BOOLEAN_TYPES/DATETIME_TYPES/normalizeType are imported by the SPEC, not the module — the module has no use for them and a third mirror was explicitly forbidden"
metrics:
  tasks: 2
  tests_added: 22
  probes: 8
  duration: ~35m
  completed: 2026-09-25
---

# Phase 125 Plan 02: Apply Primitives — Staleness and the tables.columns Renderer Summary

The two pure decisions the apply hinges on: an order-independent fingerprint comparison so a bare
column REORDER in Kinetica never refuses a valid apply, and a renderer that writes `tables.columns`
strings the config panels classify the same way `classifyFingerprint` does — instead of flattening
every TIMESTAMP column back into a number the moment the first apply lands.

## What shipped

| Task | What | Commits |
| ---- | ---- | ------- |
| 1 | `canonicalFingerprintJson` (pure append to `schemaFingerprint.ts`), new `lib/schemaApply.ts` with `isStaleAgainst` + `SCHEMA_APPLY_STALE_MESSAGE` | `66b48ae` (RED), `7a45bfa` (GREEN) |
| 2 | `TYPE_NAMING_REFINEMENTS`, `renderColumnType`, `renderColumnsMap`, `SCHEMA_APPLY_TEXT_WIDTH_GAP` | `d5eede4` (RED), `dd08f5f` (GREEN) |

22 tests in `packages/server/tests/lib.schemaApply.spec.ts`, all green: 9 `STALE-`, 10 `RENDER-`,
3 `PARITY-`. No refactor commit was needed. All fixtures synthetic (`col_a`, `col_b`, `col_ts`,
`col_ts_dt`, `COL_b`, …); no dataset-specific name appears on any added line.

`packages/server/src/lib/schemaFingerprint.ts` is a **pure append**, proven three ways:
`git diff --numstat` = `36 0`, removed-code-line count (`^-[^-]`) = 0, and the original 9821 bytes
are byte-identical as a prefix of the new file.

## Verbatim Declarations

Reproduced exactly as shipped. **Phase 126 renders `SCHEMA_APPLY_STALE_MESSAGE` verbatim.**

### `packages/server/src/lib/schemaFingerprint.ts`

```ts
export function canonicalFingerprintJson(columns: ColumnFingerprintMap): string {
  const names = Object.keys(columns).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const parts = names.map(
    (n) =>
      JSON.stringify(n) +
      ":{\"base\":" +
      JSON.stringify(columns[n].base) +
      ",\"refinements\":" +
      JSON.stringify(columns[n].refinements) +
      "}"
  );
  return "{" + parts.join(",") + "}";
}
```

### `packages/server/src/lib/schemaApply.ts`

```ts
import {
  canonicalFingerprintJson,
  formatFingerprint,
  type ColumnFingerprint,
  type ColumnFingerprintMap,
} from "./schemaFingerprint";

export const SCHEMA_APPLY_STALE_MESSAGE =
  "Kinetica's columns changed again after this report was built, so applying it would store " +
  "a snapshot you have not seen. Nothing was written. Re-run the check to see the current " +
  "state, then apply that.";

export function isStaleAgainst(
  reportedLive: ColumnFingerprintMap,
  live: ColumnFingerprintMap
): boolean {
  return canonicalFingerprintJson(reportedLive) !== canonicalFingerprintJson(live);
}

const TYPE_NAMING_REFINEMENTS: readonly string[] = [
  "timestamp",
  "datetime",
  "date",
  "time",
  "boolean",
  "bool",
  "wkt",
  "wkb",
];

export const SCHEMA_APPLY_TEXT_WIDTH_GAP =
  "Kinetica's /show/table carries no marker for an unrestricted-length string column, so " +
  "a column INFORMATION_SCHEMA reported as `text` is stored as `string` after an apply and " +
  "becomes selectable in the drill-down picker. This report does NOT detect that case.";

/** Render ONE fingerprint into the tables.columns vocabulary. */
export function renderColumnType(fp: ColumnFingerprint): string {
  const markers = new Set(fp.refinements.map((r) => r.toLowerCase()));
  for (const named of TYPE_NAMING_REFINEMENTS) {
    if (markers.has(named)) return named;
  }
  return formatFingerprint(fp);
}

export function renderColumnsMap(live: ColumnFingerprintMap): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of Object.keys(live)) out[name] = renderColumnType(live[name]);
  return out;
}
```

`TYPE_NAMING_REFINEMENTS` is module-private (**not** exported) — the declaration comment
mandated by the plan, which explains each group's reason, ships in full above each block in the
source and is elided here only for length. `SchemaApplyResult` / `applySchemaSync` are **not**
shipped by this plan; the module header reserves their home for Plan 125-03.

## Mutation probes — 8/8 FIRED, none required strengthening

Each probe was applied to the COMMITTED source, `tests/lib.schemaApply.spec.ts` re-run, then
reverted with `git checkout --` and `git diff --exit-code` confirmed clean.

| # | Mutation | Must redden | Outcome |
|---|----------|-------------|---------|
| P1 | drop `.sort(...)` on `names` | `STALE-reorder` | **FIRED** — `STALE-reorder` + `STALE-reorder-case` (2 failed) |
| P2 | sort with `a.localeCompare(b)` | criterion 4's invocation grep | **FIRED ON BOTH CHANNELS** — see below |
| P3 | omit `refinements` from the emitted value | `STALE-refinement` | **FIRED** (1 failed) |
| P4 | `isStaleAgainst` returns `false` unconditionally | `STALE-added`, `STALE-base`, `STALE-refinement` | **FIRED** — those three plus `STALE-removed` (4 failed) |
| P5 | `renderColumnType` returns `formatFingerprint(fp)` unconditionally | `RENDER-temporal`, `PARITY-class` | **FIRED** — both, plus `RENDER-temporal-all`/`-boolean`/`-spatial`/`-multi`/`-map` and `PARITY-drilldown` (8 failed) |
| P6 | remove `"wkt"` and `"wkb"` | `RENDER-spatial`, `PARITY-drilldown` | **FIRED** — both, plus `RENDER-map` (3 failed) |
| P7 | move `"date"` before `"timestamp"` | `RENDER-multi` | **FIRED** via fixture `col_ts_dt`, plus `RENDER-map` (2 failed) |
| P8 | `renderColumnType` returns `fp.base` | `RENDER-width` | **FIRED** — plus 8 others (9 failed) |

### P2, the probe the plan predicted would half-miss

The plan anticipated that `STALE-reorder` would stay GREEN under a `localeCompare` sort (it does —
`col_a`/`col_b`/`col_ts` order identically under both comparators) and pre-authorised adding a case
whose byte order and locale order disagree. That case was written **up front**, in the RED commit,
rather than retrofitted: `STALE-reorder-case` uses `"COL_b"` vs `"col_a"` and asserts the
disagreement itself as a precondition (`"COL_b" < "col_a"` is `true` while
`"COL_b".localeCompare("col_a")` is `> 0`), then asserts the canonical form places `COL_b` first.

Result: P2 fired on **both** channels — `STALE-reorder-case` reddened (1 failed) **and** criterion
4's invocation grep went 0 → 1. No test was weakened or deleted anywhere in this plan.

## Acceptance criteria — all RUN, actual output recorded

Every "before" value was measured at the current tree (identical to `688ff43` for
`packages/server`) before any code was written. `canonicalFingerprintJson`, `schemaApply`,
`isStaleAgainst`, `SCHEMA_APPLY_STALE_MESSAGE`, `renderColumnsMap`, `renderColumnType`,
`TYPE_NAMING_REFINEMENTS` and `SCHEMA_APPLY_TEXT_WIDTH_GAP` each matched **0 files** under
`packages/`; `it("STALE-`, `it("RENDER-` and `it("PARITY-` each matched **0** across `tests/`.

| Task | Criterion | Expected | Actual |
|---|---|---|---|
| 1.1 | `grep -cE "^export function canonicalFingerprintJson" src/lib/schemaFingerprint.ts` | 1 | **1** |
| 1.2 | `grep -cE "^export function isStaleAgainst" src/lib/schemaApply.ts` | 1 | **1** |
| 1.3 | `grep -cE "^export const SCHEMA_APPLY_STALE_MESSAGE" src/lib/schemaApply.ts` | 1 | **1** |
| 1.4 | purity: `grep -nE "localeCompare\(\|new Date\(\|Date\.now\(\|Math\.random\(" src/lib/schemaFingerprint.ts` | no matches | **no matches** |
| 1.5 | `it("STALE-` count, spec green | ≥6 | **9**, 9/9 green at that point |
| 1.6 | `grep -c "Object.keys" tests/lib.schemaApply.spec.ts` | ≥1 | **4** |
| 1.7 | `git diff 688ff43 -- .../schemaFingerprint.ts \| grep -c '^-'` | 0 | **1 — BROKEN CRITERION, see below** |
| 1.8 | dataset hygiene, ADDED lines only | 0 | **0** |
| 1.9 | `npx tsc --noEmit` | clean | **clean** |
| 2.1 | `grep -cE "^export function renderColumnsMap" src/lib/schemaApply.ts` | 1 | **1** |
| 2.2 | `grep -cE "^export function renderColumnType" src/lib/schemaApply.ts` | 1 | **1** |
| 2.3 | `grep -cE "^const TYPE_NAMING_REFINEMENTS" src/lib/schemaApply.ts` | 1 | **1** |
| 2.4 | all eight markers present | ≥1 each | **1 each** (`"timestamp",` `"datetime",` `"date",` `"time",` `"boolean",` `"bool",` `"wkt",` `"wkb",`) |
| 2.5 | `grep -cE "^export const SCHEMA_APPLY_TEXT_WIDTH_GAP" src/lib/schemaApply.ts` | 1 | **1** |
| 2.6 | `it("RENDER-` / `it("PARITY-`, spec green | ≥7 / ≥2 | **10 / 3**, 22/22 green |
| 2.7 | `grep -c "classifyFingerprint" tests/lib.schemaApply.spec.ts` | ≥1 | **5** |
| 2.8 | `grep -c "FIXTURES" tests/lib.schemaApply.spec.ts` | ≥3 | **11** |
| 2.9 | `git diff --name-only 688ff43 \| grep -c '^packages/web/'` | 0 | **0** |
| 2.10 | no cross-package import statement | no matches | **no matches** |
| 2.11 | dataset hygiene, ADDED lines only | 0 | **0** |
| 2.12 | `npx tsc --noEmit` + `node scripts/test-gate.mjs` | clean + GATE PASSED | **clean + GATE PASSED** |

### Criteria that could not discriminate

**Criterion 1.7 (`git diff 688ff43 -- .../schemaFingerprint.ts | grep -c '^-'` = 0) is
UNSATISFIABLE, not merely toothless.** A unified diff always opens with `--- a/<path>`, which
`^-` matches. The criterion therefore reads ≥1 for *any* change to the file whatsoever, including
the pure append it was written to certify. It cannot be made to pass by correct work — only by not
touching the file, or by gaming the check.

Per CLAUDE.md, the code was **not** edited to satisfy it. The real requirement (pure append; no
existing line removed or altered) was verified directly, three independent ways:

- `git diff --numstat 688ff43 -- packages/server/src/lib/schemaFingerprint.ts` → `36  0` (zero deletions)
- removed-CODE-line count, `grep -c '^-[^-]'` → **0**
- byte-prefix check: `git show 688ff43:…` is 9821 bytes and `head -c 9821` of the new file is
  `cmp`-identical to it → **PURE APPEND**

The corrected form for future plans is `grep -c '^-[^-]'`, or better `git diff --numstat`'s
deletions column. This is the third criterion in this milestone chain broken by a grep anchor that
matches its own scaffolding — the same family as Phase 124's four, and worth a line in the
conventions doc.

**Criterion 1.4 (purity) is 0-before / 0-after, which is the correct shape for a prohibition
guard, and it is genuinely live.** Proven, not assumed: probe P2 drove it 0 → 1. Its parenthesised
anchor is also load-bearing — after this plan the bare-word form `grep -c "localeCompare"
src/lib/schemaFingerprint.ts` reads **1** (the mandated header prose), exactly the collision the
plan warned about, while the invocation form stays **0**.

**Criteria 1.8 / 2.11 (dataset hygiene) and 2.10 (no cross-package import)** are likewise
0-before / 0-after prohibition guards, correctly scoped to ADDED lines and to import statements
respectively. Not defects.

All other criteria read 0 (or failed) before the work and pass now.

## Known Gaps Carried

**1. `text` → `string`: drill-down over-inclusion (`SCHEMA_APPLY_TEXT_WIDTH_GAP`).**
Kinetica's `/show/table` exposes no marker for an unrestricted-length string column, so such a
column fingerprints as `{base:"string", refinements:[]}` and renders `"string"`. INFORMATION_SCHEMA
reported `"text"`, which **is** a member of the web's `EXCLUDED_DRILLDOWN_TYPES`. After an apply,
a column that was excluded from the drill-down picker becomes selectable there. This is
*over-inclusion*, the direction `columnTypes.ts`'s own D-01 comment already names as acceptable
("over-exclusion would hide valid columns"). It is a real case, not hypothetical: `text` appears in
the dev database's current `tables.columns` vocabulary. Named in the shipped source as
`SCHEMA_APPLY_TEXT_WIDTH_GAP` and pinned by the test `RENDER-text-gap`, which asserts both the
rendered value and the two set memberships that make it a behaviour change. **The report does not
detect this case**, so Phase 126 must not imply it does.

**2. The Kinetica BOOLEAN marker was NOT live-probed — it is assumed, by name.**
Stated plainly: no `/show/table` body carrying a boolean column was captured in this phase or any
prior one. `columnTypeClass.ts`'s header already records that `boolean`, `date`, `time` and
`datetime` are DOCUMENTATION-DERIVED, because every registered table carrying those types has been
dropped from Kinetica (`/show/table` returns `table_names: []`). `TYPE_NAMING_REFINEMENTS` carries
**both** spellings (`"boolean"` and `"bool"`) on that basis, which is defensive breadth, not
verification. If Kinetica's real marker is a third spelling, a boolean column would render through
`formatFingerprint` as `int(<marker>)` → normalizes to `int` → classifies as a **number**, not a
boolean. Phase 126's operator verification against a live instance can close this; until then it is
an open assumption, and `classifyFingerprint` carries the identical assumption one layer up, so the
two agree and `PARITY-class` would **not** catch it.

**3. Precedence-order divergence between `renderColumnType` and `classifyFingerprint` —
theoretical, deliberately not fixed.**
`renderColumnType` consults markers temporal → boolean → spatial, then falls through to
`formatFingerprint`. `classifyFingerprint` scans datetime refinements → boolean refinements →
**numeric** refinements → base. Those are different orderings. `PARITY-class` proves they agree
**over the fixture table**, not in general. They agree for every live and documented Kinetica shape
because a numeric-type-literal refinement (`int8`, `int16`) never co-occurs with a temporal,
boolean or spatial marker on the same column. If Kinetica ever emitted such a pairing —
say `{base:"long", refinements:["int8","timestamp"]}` — `renderColumnType` would render
`"timestamp"` (datetime) while `classifyFingerprint` would reach its numeric-refinement branch and
answer `"number"`, and `renderColumnsMap`'s output would then disagree with the classifier the
impact report uses. Stated here rather than fixed speculatively: harmonising the two orderings
without a real shape to harmonise them *against* would be a guess written into the write path.

## Deviations from Plan

**1. [Rule 3 - Blocking] `BOOLEAN_TYPES` / `DATETIME_TYPES` / `normalizeType` are imported by the
SPEC, not by the module.**
- **Found during:** Task 2, writing `schemaApply.ts`.
- **Issue:** The plan's `<action>` block lists an import of those three into the module, but
  `renderColumnType` and `renderColumnsMap` never reference them — the marker list is a literal.
  An unused import is dead weight and a future reader's false lead.
- **Fix:** Exactly the fallback the plan itself authorises ("If TypeScript reports them unused in
  the module itself, keep the import in the SPEC instead of the module and note it — do NOT add a
  third mirror"). `tests/lib.schemaApply.spec.ts` imports all three from `columnTypeClass.ts` and
  uses them in `webInfer`, `RENDER-temporal-all`, `RENDER-boolean` and `RENDER-width`. No third
  mirror was created.
- **Commit:** `dd08f5f`

**2. [Rule 2 - Missing coverage] Four tests beyond the plan's `<behavior>` list.**
- `STALE-reorder-case` — the byte-vs-locale disagreement case, written up front so probe P2 had a
  behavioural target rather than only a grep (see P2 above).
- `STALE-message` — pins the refusal text Phase 126 renders verbatim, and asserts it names no
  column (`not.toContain("col_")`), which is the *reason* the message is worded that way.
- `RENDER-map` — every fixture through `renderColumnsMap` (the plan's `RENDER-` list only
  exercised `renderColumnType`).
- `PARITY-class-naive` — **the counter-proof.** `PARITY-class` alone would pass against a renderer
  that does nothing at all if the premise were false, so this test asserts that the naive
  `formatFingerprint` renderer *does* disagree with `classifyFingerprint` on at least one fixture,
  and specifically on `col_ts`. It makes the plan's central claim falsifiable inside the suite
  instead of resting on planning-time analysis.

**3. [Criterion defect, reported not fixed] Criterion 1.7 is unsatisfiable** — see "Criteria that
could not discriminate". No code was changed to accommodate it.

## For the next wave (125-03)

Exact signatures `applySchemaSync` will call:

```ts
// packages/server/src/lib/schemaApply.ts  (same module — add applySchemaSync here)
export const SCHEMA_APPLY_STALE_MESSAGE: string;
export const SCHEMA_APPLY_TEXT_WIDTH_GAP: string;
export function isStaleAgainst(reportedLive: ColumnFingerprintMap, live: ColumnFingerprintMap): boolean;
export function renderColumnType(fp: ColumnFingerprint): string;
export function renderColumnsMap(live: ColumnFingerprintMap): Record<string, string>;

// packages/server/src/lib/schemaFingerprint.ts
export function canonicalFingerprintJson(columns: ColumnFingerprintMap): string;
export function serializeFingerprintSnapshot(columns: ColumnFingerprintMap): string; // unchanged, Phase 122
```

1. **The two serialisers are NOT interchangeable.** `canonicalFingerprintJson` is for **equality
   only** and must never be written to the database; the stored form stays
   `serializeFingerprintSnapshot` (`{"v":1,"columns":{…}}`, insertion order preserved).
2. **`renderColumnsMap(live)` feeds `setTableSchemaSnapshot`'s `columns` argument**, and
   `serializeFingerprintSnapshot(live)` feeds its `fingerprintJson` argument. Both come from the
   **freshly re-read** live map, never from the echoed one.
3. **`isStaleAgainst(reportedLive, live)` → `true` means REFUSE**: write nothing, insert no history
   entry, return `SCHEMA_APPLY_STALE_MESSAGE` verbatim. Argument order is
   `(what the report was built from, what we just re-read)`; it is symmetric, but keep the order for
   readability.
4. **`TYPE_NAMING_REFINEMENTS` is module-private.** If 125-03 or 126 needs the marker list, export
   it in that plan rather than re-declaring it — a second copy is exactly the drift this phase
   argues against.
5. **Key order of `renderColumnsMap`'s output follows the input map**, i.e. Kinetica's ordinal
   column order, which is what the config panels already present. Do not sort it on the way to
   `setTableSchemaSnapshot`.
6. **Empty-map guard is the ROUTE's job.** `isStaleAgainst({}, {})` is `false` and
   `renderColumnsMap({})` is `{}` — neither function refuses an empty body, by design. The route
   must reject one before reaching either.

## Verification

- `cd packages/server && npx tsc --noEmit` → **clean**
- `cd packages/server && npx vitest run tests/lib.schemaApply.spec.ts` → **22/22 passed**
- `cd packages/server && node scripts/test-gate.mjs` → **GATE PASSED**; failing set was exactly the
  8 documented `KNOWN_FAILING` entries on both runs (post-Task-2 and final). No extra contamination
  appeared in either run.
- `git diff --name-only 688ff43 | grep -c '^packages/web/'` → **0**
- `git diff --numstat 688ff43 -- packages/server/src/lib/schemaFingerprint.ts` → **36 added,
  0 deleted** (pure append, byte-prefix verified)
- All 8 mutation probes fired on their named targets; `git diff --exit-code` clean after each.
- Working tree clean; `packages/web` untouched; no `gsd-tools` mutation command was run.

## Self-Check: PASSED

- `packages/server/src/lib/schemaApply.ts` — FOUND (created)
- `packages/server/tests/lib.schemaApply.spec.ts` — FOUND (created)
- `packages/server/src/lib/schemaFingerprint.ts` — FOUND (modified, pure append)
- Commits `66b48ae`, `7a45bfa`, `d5eede4`, `dd08f5f` — all FOUND in `git log`
