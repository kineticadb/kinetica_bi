---
phase: 122-schema-diff-table-missing-detection
plan: 01
subsystem: server-lib
tags: [schema-sync, kinetica, fingerprint, show-table]
requires: []
provides:
  - "packages/server/src/lib/schemaFingerprint.ts (ColumnFingerprint, ColumnFingerprintMap, FingerprintSnapshot, TablePresence, NON_TYPE_PROPERTIES, tablePresence, parseColumnFingerprints, formatFingerprint, parseFingerprintSnapshot, serializeFingerprintSnapshot)"
  - "kineticaShowTable(req, tableName, { route, op, showOptions? }) — showOptions spread into /show/table request body"
affects:
  - "Phase 123 (columnRefs enumeration) — reads nothing from this plan directly"
  - "Phase 124 (impact report) — will consume ColumnFingerprint to classify retype severity"
  - "Phase 125 (apply + sync history) — will call serializeFingerprintSnapshot to persist baselines and kineticaShowTable with showOptions.no_error_if_not_exists to detect table-missing"
tech-stack:
  added: []
  patterns:
    - "Pure lib under packages/server/src/lib/ (zero db, zero network) — mirrors showTableTypes.ts's defensive parsing/table_names-index-matching style"
key-files:
  created:
    - packages/server/src/lib/schemaFingerprint.ts
    - packages/server/tests/lib.schemaFingerprint.spec.ts
    - packages/server/tests/kinetica.showTable.options.spec.ts
  modified:
    - packages/server/src/kinetica.ts
decisions:
  - "char256 is a real type-refining width marker, not a storage marker — a test-fixture bug (not implementation) surfaced this while turning GREEN on Task 1; fixed the test, not NON_TYPE_PROPERTIES."
  - "M6 (drop .sort() on refinements) did not redden any existing test on first attempt, exactly as the plan predicted — no fixture had two type-refining markers on one column. Strengthened the TEST with a synthetic two-marker fixture per CLAUDE.md's mutation-probe rule (never weaken the probe); verified it passes on the real implementation and correctly reddens under the M6 mutation."
metrics:
  duration: ~35min
  completed: 2026-09-21
---

# Phase 122 Plan 01: Pure schemaFingerprint parser + kineticaShowTable showOptions Summary

Built the pure `/show/table`-body-to-per-column-type-fingerprint parser (combining Avro `type_schemas`
base types with `properties` width/temporal refinement markers, Avro-union-aware, `NON_TYPE_PROPERTIES`-filtered)
plus a one-field extension to `kineticaShowTable` that lets a caller request `no_error_if_not_exists`,
the signal that makes "table missing" structurally distinguishable from "could not reach Kinetica".

## What Was Built

### Task 1 — `packages/server/src/lib/schemaFingerprint.ts`

Exports exactly the contract specified in the plan:
`ColumnFingerprint`, `ColumnFingerprintMap`, `FingerprintSnapshot`, `TablePresence`,
`NON_TYPE_PROPERTIES`, `tablePresence`, `parseColumnFingerprints`, `formatFingerprint`,
`parseFingerprintSnapshot`, `serializeFingerprintSnapshot`.

```ts
export type ColumnFingerprint = { base: string; refinements: string[] };
export type ColumnFingerprintMap = Record<string, ColumnFingerprint>;
export type FingerprintSnapshot = { v: 1; columns: ColumnFingerprintMap };
export type TablePresence = "present" | "missing" | "unreadable";
```

`parseColumnFingerprints` iterates `type_schemas.fields` (the authoritative column list) and pairs each
with the matching `properties` entry: markers are lowercased, deduplicated, filtered against
`NON_TYPE_PROPERTIES` (`data`, `store_only`, `disk_optimized`, `text_search`, `primary_key`,
`shard_key`, `dict`, `init_with_now`, `nullable`, `unique`), and sorted. Avro union types
(`["string","null"]`) are normalized by filtering `"null"` and taking the first remaining entry.
`tablePresence` gives the three-state classification the milestone requires: an object without an
array `table_names` is `"unreadable"`; an empty array is `"missing"`; a non-empty array is `"present"`.
`parseFingerprintSnapshot`/`serializeFingerprintSnapshot` round-trip the `{v:1, columns}` stored shape,
returning `null` (not `{}`) for anything malformed, unversioned, or absent — the signal Phase 125 turns
into `baseline_required`.

Verified against the REAL fixture bodies in `122-SPIKE-NOTES.md`:
- `demo.nyctaxi` — 9 columns, proving `char4`/`char16`/`char1` (identical base `string`) and
  `int8`/`int16` (identical base `int`) both fingerprint distinctly, and `int -> double` is visible
  with identical empty refinements.
- `pg_catalog.pg_views` (Addendum) — the ONLY fixture carrying an Avro union (`["string","null"]`) and
  a `"nullable"` property marker. This exercises the union-filtering path and proves `nullable` is
  excluded from refinements (SSYNC-F5 stays deferred) with real data, not an invented shape.

**Test-fixture bug found and fixed while turning GREEN (not a Rule 1-3 code fix — this was my own test
bug):** my first draft of the "storage and index markers are excluded" test asserted
`schemaname: { base: "string", refinements: [] }`, but `char256` in the real `pg_catalog.pg_views` body
is a genuine width refinement (not a storage marker) — the correct expectation is
`refinements: ["char256"]`. Corrected the test, left `NON_TYPE_PROPERTIES` unchanged.

### Task 2 — `kineticaShowTable` showOptions

`options` gained an optional field: `showOptions?: Record<string, string>`, spread into the request
body's `options` map (`options: { ...(options.showOptions ?? {}) }`). The default call (no
`showOptions` passed, as the sole existing caller in `index.ts` does) sends `options: {}` —
byte-identical to the pre-122 body, confirmed by test and by `git diff --stat -- src/index.ts` showing
zero change. `no_error_if_not_exists: "true"` is now forwardable, closing the collision where a
missing-table response (HTTP 400, `status: "ERROR"`) and a genuine connection failure both mapped to
`KineticaUpstreamError`.

## Mutation-Probe Results

All 8 probes run: implementation broken the specified way, spec run, named test confirmed reddened,
collateral noted, reverted before the next probe.

| # | Mutation | Named test | Result |
|---|----------|-----------|--------|
| M1 | Stop merging `properties` (always `refinements: []`) | "combines type_schemas base with properties width — char4 and char16 differ on identical base 'string'" | **Fired.** Also reddened "vendor_id fingerprints as...", "int8 and int16 refine...", and "storage and index markers are excluded..." (3 collateral). |
| M2 | Stop reading `type_schemas` (hardcode `base: "string"`) | "int -> double is a base-type change visible with identical empty refinements" | **Fired.** Also reddened "int8 and int16 refine..." and "a nullable Avro union..." (2 collateral). |
| M3 | Remove `"nullable"` from `NON_TYPE_PROPERTIES` | "storage and index markers are excluded from the fingerprint (SSYNC-F5 stays deferred)" | **Fired.** Clean, no collateral. |
| M4 | `tablePresence` returns `"missing"` when `table_names` is not an array | "tablePresence: a body with no table_names is 'unreadable', never 'missing'" | **Fired.** Clean, no collateral. |
| M5 | Avro union branch takes `type[0]` without filtering `"null"` | "a nullable Avro union ['null','int'] fingerprints as base 'int'" | **Fired.** Clean, no collateral. |
| M6 | Drop `.sort()` on refinements | (plan: "add/keep a case with two refinements... if no existing test fires, ADD one") | **Did NOT fire on first attempt**, exactly as the plan flagged as most likely. No existing fixture has two type-refining markers on one column. **Strengthened the test** (added a synthetic two-marker case, `zzz_marker`/`aaa_marker`, whose sorted output differs from insertion order) rather than weakening the probe — verified the new test passes on the real implementation, then re-ran the M6 mutation and confirmed it now reddens exactly that test. |
| M7 | `kineticaShowTable` ignores `showOptions`, keeps `options: {}` | "forwards showOptions into the /show/table request body" | **Fired.** Clean, no collateral. |
| M8 | `parseFingerprintSnapshot` returns `{}` instead of `null` for malformed JSON | "parseFingerprintSnapshot returns null for null, empty string, malformed JSON and an unknown version" | **Fired.** Clean, no collateral. |

## Acceptance Criteria — grep results (all run from `packages/server`)

Task 1:
1. `test -f src/lib/schemaFingerprint.ts` → PASS
2. `grep -c "NON_TYPE_PROPERTIES" src/lib/schemaFingerprint.ts` → 3 (≥2 required)
3. `grep -c "tablePresence" src/lib/schemaFingerprint.ts` → 1 (≥1 required)
4. `grep -c "\"nullable\"" src/lib/schemaFingerprint.ts` → 1, with `SSYNC-F5` on the line above (both present)
5. `grep -c "char16" tests/lib.schemaFingerprint.spec.ts` → 4 (≥1 required)
6. `grep -c "store_and_fwd_flag" tests/lib.schemaFingerprint.spec.ts` → 3 (≥1 required)
7. `grep -c "unreadable" src/lib/schemaFingerprint.ts` → 5 (≥1 required)
8. `grep -cE "from \"\.\./db\"|require\(.*db" src/lib/schemaFingerprint.ts` → 0 (pure lib confirmed)
9. `npx vitest run tests/lib.schemaFingerprint.spec.ts` → 19/19 passing (≥12 required; 12 named + 6 malformed-input `it.each` rows + the M6-strengthening test = 19)
10. `npx tsc --noEmit` → clean

Task 2:
1. `grep -c "showOptions" src/kinetica.ts` → 3 (≥3 required: type, JSDoc, spread)
2. `grep -c "no_error_if_not_exists" src/kinetica.ts` → 1 (≥1 required)
3. `grep -c "options: {} })" src/kinetica.ts` → 0 (literal gone); `grep -c "options: {}," src/kinetica.ts` → 1, unchanged (the `/execute/sql` body untouched)
4. `git diff --stat -- src/index.ts` → empty (no change)
5. `npx vitest run tests/routes.discovery.spec.ts` → passing
6. `npx tsc --noEmit` → clean

All BEFORE values were verified against the tree before committing to each criterion (per CLAUDE.md);
none were toothless. No criterion needed re-anchoring.

## Test Gates

- `cd packages/server && npx tsc --noEmit` → **clean**.
- `cd packages/server && node scripts/test-gate.mjs` → **GATE PASSED**. Full run: 1201/1260 tests
  passed; 9 files failing. 8 are the documented `KNOWN_FAILING` set (all TD-V11-04 OIDC-mock,
  `db.smoke.spec.ts` schema-snapshot drift, `routes.wms.spec.ts`) — unchanged from baseline, none
  introduced by this plan. The 9th, `tests/db.schemaFingerprintColumn.spec.ts`, is plan 122-02's file
  (running in parallel this same session) — re-ran in isolation by the gate itself and **passed alone**
  (TD-V16-TEST-ISOLATION contamination, allowed by the gate's own logic). Never asserted a fixed
  pass-count.
- `cd packages/web && npx tsc --noEmit` → clean (untouched, as expected).
- `git diff --name-only c9c34b7 HEAD | grep -c '^packages/web/'` → **0**.
- `git diff --name-only c9c34b7 HEAD | grep 'src/db.ts'` → **empty** (db.ts never touched by this plan).

## Deviations from Plan

### Auto-fixed Issues

None that required a code change to the plan's design — the one fix during execution was to my own
test fixture (see "char256" note above), not to `schemaFingerprint.ts` or `kinetica.ts`.

### Mutation-probe fixture strengthening (not a deviation from plan — an explicit plan instruction)

M6's test was strengthened per the plan's own contingency instruction ("if no existing test fires, ADD
one rather than dropping the probe"). See the mutation-probe table above for the full before/after.

### Git-history note — concurrent commit sweep (process observation, not a code defect)

**1. A parallel-executor race swept plan 122-02's test file into this plan's Task 1 commit.**
- **Found during:** immediately after committing Task 1 (`ed4fc16`), `git show --stat HEAD` showed an
  unexpected third file, `packages/server/tests/db.schemaFingerprintColumn.spec.ts`.
- **Cause:** I ran `git add <2 files>` then `git commit -m ...` with no pathspec. Plan 122-02's
  executor, running in parallel in the same working tree, staged its own new test file in the window
  between my `add` and my `commit`; a bare `git commit` commits the whole index, not just what I
  personally staged.
- **Verified no destructive collision:** `git diff --stat -- packages/server/src/db.ts` at that point
  was empty — I never wrote to `db.ts`, and 122-02's own `db.ts` work was still uncommitted, untouched
  and unaffected. The swept file's content was correct (122-02's own test), just misattributed to my
  commit message.
- **Not fixed via amend/rebase** — per the git safety protocol (never rewrite history without an
  explicit request), left the commit as-is. 122-02 subsequently completed and committed cleanly
  (`4c4e59b feat(122-02): add columns_fingerprint sibling column + read accessor`, `db.ts` only, 40
  lines) — no conflict, no duplicate file, no lost work.
- **Process fix applied immediately:** every commit after this one used `git commit -m "..." -- <exact
  paths>` (explicit trailing pathspec on the commit command itself, not just on `git add`) to make the
  commit scope immune to any further concurrent staging by another process.

## Self-Check

```
FOUND: packages/server/src/lib/schemaFingerprint.ts
FOUND: packages/server/tests/lib.schemaFingerprint.spec.ts
FOUND: packages/server/tests/kinetica.showTable.options.spec.ts
FOUND commit: e6ac4a9
FOUND commit: ed4fc16
FOUND commit: f67efeb
FOUND commit: f7810a2
FOUND commit: 34ceccb
```

## Self-Check: PASSED

## Contract for Downstream Plans

Plans 02/03/04 (and Phases 124/125) should import from `packages/server/src/lib/schemaFingerprint.ts`:

```ts
import {
  parseColumnFingerprints, tablePresence, formatFingerprint,
  parseFingerprintSnapshot, serializeFingerprintSnapshot,
  NON_TYPE_PROPERTIES,
  type ColumnFingerprint, type ColumnFingerprintMap, type FingerprintSnapshot, type TablePresence,
} from "./lib/schemaFingerprint";
```

And call `kineticaShowTable(req, tableName, { route, op, showOptions: { no_error_if_not_exists: "true" } })`
to get the `no_error_if_not_exists: true` behavior; omit `showOptions` for the pre-122 default body.

Phase 122 writes nothing to the database anywhere in this plan (`serializeFingerprintSnapshot` exists
and is tested, but is never called outside `tests/`) — consistent with the locked "check reports,
apply writes" decision in `122-CONTEXT.md`.
