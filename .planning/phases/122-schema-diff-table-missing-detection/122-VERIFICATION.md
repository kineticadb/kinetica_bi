---
phase: 122-schema-diff-table-missing-detection
verified: 2026-09-21T15:15:00Z
status: passed
score: 6/6 must-haves verified
---

# Phase 122: Schema Diff & Table-Missing Detection Verification Report

**Phase Goal:** For one registered table, the app can read the live Kinetica column set on demand
and report exactly how it differs from the stored snapshot — added, removed, retyped, or the table
gone entirely — without writing anything.
**Verified:** 2026-09-21
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A changed table's live columns are diffed against the stored precise baseline into added/removed/retyped, retypes naming both the stored and live type | ✓ VERIFIED | `src/lib/schemaDiff.ts:95-133` (`diffColumnFingerprints`); route wiring at `src/index.ts:2477-2513`; proven end-to-end by `tests/routes.schema-check.spec.ts:200-221` (operator's own varchar8→varchar32 case: `vendor_id.storedType === "string(char4)"`, `liveType === "string(char32)"`). Re-ran independently: passes. |
| 2 | A table Kinetica no longer has is reported as a distinct `table_missing` outcome (never a column diff), wording covering both dropped and renamed | ✓ VERIFIED | `tableMissingResult` in `schemaDiff.ts:163-169` carries no `added`/`removed`/`retyped` keys (structurally, not just empty arrays — confirmed by `"added" in res.body === false` in the route spec, `routes.schema-check.spec.ts:240-268`). Message text: "may have been dropped, or renamed in Kinetica — from outside, the two are indistinguishable." |
| 3 | A renamed column is reported as one removal plus one addition; the app never guesses a pairing | ✓ VERIFIED | No pairing/similarity/ordinal logic anywhere in `schemaDiff.ts` or the route (`grep -rniE "possibleRename\|similarity\|levenshtein\|ordinal_position\|pairRename" src/lib/schemaDiff.ts src/index.ts` → 0 hits). Forbidden-token guard present in both `tests/lib.schemaDiff.spec.ts` and the route spec (`routes.schema-check.spec.ts:327-346`), independently re-run and passing. |
| 4 | Running a check changes nothing in the database until explicitly applied | ✓ VERIFIED | No writer for `columns_fingerprint` exists anywhere (`grep -rniE "UPDATE tables SET columns_fingerprint\|setTableColumnsFingerprint" src/` → 0 hits tree-wide). The route contains no INSERT/UPDATE/DELETE. Byte-identical five-table proof (`tables`, `widgets`, `dashboard_layers`, `custom_metrics`, `column_display_config`) in `routes.schema-check.spec.ts:378-436`, seeded non-empty and asserted non-empty *before* comparing (`before[t].length > 0` for all five) — the check the plan's own checker flagged as otherwise-vacuous is present and correctly guards against a false pass. Re-run independently: passes. |
| 5 | The check is a single Kinetica call (`/show/table`); a connection failure is structurally incapable of returning a 200 finding | ✓ VERIFIED | `kineticaShowTable` is called exactly once in the route (`src/index.ts:2486-2490`); no `try/catch` wraps it, so a thrown typed error propagates to `errorMiddleware` (401/403/502), never a 200. `INFORMATION_SCHEMA` occurrence count in `src/index.ts` is unchanged by this phase (all 6 pre-existing, in the older discovery route). Tests: "exactly one Kinetica call" and "unreachable Kinetica: 502 and the body has no outcome field" both pass independently. |
| 6 | A stored baseline that predates precise capture reports `baseline_required`, never a diff claiming every column added | ✓ VERIFIED | `getTableColumnsFingerprint` returns raw TEXT or `null`; `parseFingerprintSnapshot(null) → null`; route falls to `baselineRequiredResult` when `!stored` (`src/index.ts:2510-2511`). Test `"old-format table (columns_fingerprint NULL): 200 outcome 'baseline_required', not a diff"` passes independently. |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/server/src/lib/schemaFingerprint.ts` | Pure `/show/table`-body parser; exports `ColumnFingerprint`, `ColumnFingerprintMap`, `FingerprintSnapshot`, `NON_TYPE_PROPERTIES`, `tablePresence`, `parseColumnFingerprints`, `formatFingerprint`, `parseFingerprintSnapshot`, `serializeFingerprintSnapshot` | ✓ VERIFIED | All exports present exactly as specified; zero `db`/network imports; fixtures use the real `demo.nyctaxi` and `pg_catalog.pg_views` bodies from `122-SPIKE-NOTES.md` verbatim. |
| `packages/server/tests/lib.schemaFingerprint.spec.ts` | Fixture tests from spike notes | ✓ VERIFIED | 19/19 passing (independently re-run); real fixture bodies confirmed byte-matching the spike notes (`char4`/`char16`/`char1`, `int8`/`int16`, the union+`nullable` `pg_catalog.pg_views` addendum fixture). |
| `packages/server/tests/kinetica.showTable.options.spec.ts` | Proves `showOptions` passthrough, default unaffected | ✓ VERIFIED | 3/3 passing independently; `kinetica.ts` diff confirms `options: {}` default preserved and `showOptions?` field added without touching the sole existing caller. |
| `packages/server/src/db.ts` (`columns_fingerprint` + accessor) | Sibling column, PRAGMA-guarded ALTER, SELECT-only accessor | ✓ VERIFIED | DDL, ALTER guard (`PRAGMA table_info(tables)`), and `getTableColumnsFingerprint` all present exactly as planned; zero writer; `Table`/`mapTable`/export/import untouched (confirmed via `git diff` across the whole phase range — empty). |
| `packages/server/tests/db.schemaFingerprintColumn.spec.ts` | Fresh-install/migration/idempotency/accessor coverage | ✓ VERIFIED | 6/6 passing independently. |
| `packages/server/src/lib/schemaDiff.ts` | Pure diff + `SchemaCheckResult` contract | ✓ VERIFIED | All exports present (`SchemaDiff`, `AddedColumn`, `RemovedColumn`, `RetypedColumn`, `SchemaCheckResult`, `diffColumnFingerprints`, `diffResult`, `baselineRequiredResult`, `tableMissingResult`); zero `db`/`express`/`fetch` imports; `tableMissingResult` structurally omits diff-group keys (verified by object literal inspection, not just by test). |
| `packages/server/tests/lib.schemaDiff.spec.ts` | Diff semantics, rename-as-drop+add, determinism, no-rename-token guard | ✓ VERIFIED | 19/19 passing independently; forbidden-token loop present and asserted. |
| `packages/server/src/index.ts` (`GET /api/tables/:id/schema-check`) | Thin route over the two pure libs | ✓ VERIFIED | Route present at line 2477, gated by `requireConfig` + `requirePermission(PERMISSIONS.DATASETS_MANAGE)`, no try/catch, no SQL, no new permission string. |
| `packages/server/tests/routes.schema-check.spec.ts` | Four outcomes + no-write proof + single-call proof + 403 gate | ✓ VERIFIED | 14/14 passing independently (matches SUMMARY's claimed count exactly). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `kinetica.ts` | `POST /show/table` body | `options.showOptions` spread | ✓ WIRED | `body: JSON.stringify({ table_name: tableName, options: { ...(options.showOptions ?? {}) } })` — confirmed in source. |
| `schemaFingerprint.ts` | both `/show/table` sources | `type_schemas` (base) merged with `properties` (refinements) | ✓ WIRED | `parseColumnFingerprints` reads both; confirmed by the char4/char16-on-identical-base test passing. |
| `schemaDiff.ts` | `schemaFingerprint.ts` | `import ... from "./schemaFingerprint"` | ✓ WIRED | Confirmed by source import line and passing type-check. |
| `index.ts` schema-check route | `kineticaShowTable` | `showOptions: { no_error_if_not_exists: "true" }` | ✓ WIRED | Confirmed in route source and by the dedicated request-body test. |
| `index.ts` schema-check route | `db.ts getTableColumnsFingerprint` | SELECT-only read | ✓ WIRED | Confirmed in route source; no write call anywhere in the route. |
| `index.ts` schema-check route | `schemaDiff.ts` builders | `diffResult`/`baselineRequiredResult`/`tableMissingResult` | ✓ WIRED | All three imported and called on the correct branches; confirmed by all three-outcome tests passing. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| SSYNC-V125-02 | 122-01, 122-03, 122-04 | Report added/removed/retyped columns | ✓ SATISFIED | `diffColumnFingerprints` + route; proven by "changed table" test. |
| SSYNC-V125-03 | 122-01, 122-04 | Table-missing reported distinctly, covering dropped-or-renamed | ✓ SATISFIED | `tableMissingResult` + `no_error_if_not_exists` mechanism; proven by both `table_missing` tests. |
| SSYNC-V125-04 | 122-03, 122-04 | Renamed column = one removal + one addition, never a guess | ✓ SATISFIED | No pairing logic anywhere; forbidden-token tests at both the lib and route level. |
| SSYNC-V125-05 | 122-02, 122-04 | A check writes nothing until explicitly applied | ✓ SATISFIED | No writer exists for `columns_fingerprint`; byte-identical five-table proof, correctly non-vacuous (seeded + asserted non-empty). |

No orphaned requirements: all four IDs mapped in REQUIREMENTS.md for Phase 122 appear in at least one plan's `requirements` frontmatter field.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | none found | — | `grep` for TODO/FIXME/PLACEHOLDER/stub patterns in the two new libs and the route returned zero hits. |

### Human Verification Required

None. This phase is server-only, has no UI surface (first web caller is Phase 126), and every locked
behavior (three outcomes, no-write guarantee, single Kinetica call, no rename pairing) is mechanically
verifiable and was independently re-verified against the running codebase rather than trusted from the
SUMMARYs.

### Honesty Check Against SUMMARY Claims

All four items flagged in the task brief were independently checked against the actual code/tests, not
just the SUMMARY prose:

1. **"Writes nothing" — the byte-identical test's discriminating power.** Confirmed the route test
   (`routes.schema-check.spec.ts:378-436`) seeds all five tables (`tables`, `widgets`,
   `dashboard_layers`, `custom_metrics`, `column_display_config`) via `createDashboard`/`createTable`/
   `createWidget`/`createDashboardLayer`/`createCustomMetric`/`upsertColumnDisplayConfig`, and asserts
   `before[t].length > 0` for all five before running the assertion across all three 200 outcomes
   (`diff`, `baseline_required`, `table_missing`). This is exactly the strengthening the plan checker
   required, and it landed in the test as written — confirmed by reading the file directly, not the
   SUMMARY's description of it.
2. **Exactly one Kinetica call, no `INFORMATION_SCHEMA` second query.** `grep -c INFORMATION_SCHEMA
   src/index.ts` = 6, all pre-existing (the older discovery route), none added by this phase's route.
   The route's own comment mentioning `INFORMATION_SCHEMA` is prose only, not a query — confirmed no
   `kineticaSqlHelper`/`fetch(` construct referencing it exists in the new code.
3. **Three 200 outcomes; connection failure structurally incapable of 200.** Confirmed: no try/catch
   wraps `kineticaShowTable` in the route; a rejected `fetch` throws `KineticaUpstreamError` inside
   `kineticaShowTable` itself, well before the route's `tablePresence`/`res.json` logic runs — so a
   502 is the only possible outcome for a network failure. `table_missing` carries no `added`/
   `removed`/`retyped` keys (checked via `"added" in res.body === false`, not merely `.toEqual([])`).
4. **No rename pairing anywhere.** Confirmed via direct grep of `schemaDiff.ts` and `index.ts` for
   `possibleRename`/`similarity`/`levenshtein`/`ordinal_position`/`pairRename` — zero hits. The one
   `ORDINAL_POSITION` hit in `index.ts` is in the pre-existing, unrelated discovery route's SQL string,
   untouched by this phase.
5. **Export/import invariant.** `git diff` across the entire phase commit range (`6673017..ede39ba`)
   for `src/types.ts`, `src/lib/dashboardExport.ts`, `src/lib/dashboardImport.ts` is empty. `Table` and
   `mapTable` are untouched.
6. **Fixtures match the real Kinetica bodies.** The `demo.nyctaxi` fixture in
   `tests/lib.schemaFingerprint.spec.ts` reproduces the exact column names/widths/base-types from
   `122-SPIKE-NOTES.md` Q1/Q2/Q5, and the `pg_catalog.pg_views` fixture reproduces the ADDENDUM's
   union+`nullable` body verbatim (`schemaname: ["data","char256","nullable"]`,
   `type: ["string","null"]`). Not invented shapes.
7. **`packages/web` has zero diff.** Confirmed via `git diff --stat` across the phase range — empty.
   No new RBAC permission (`grep -c SCHEMA_CHECK\|schema_check permissions.ts` = 0;
   `git diff permissions.ts` across the phase range is empty).

**Findings during execution, checked for honest recording (not quietly dropped):**
- 122-01's M6 probe (drop `.sort()` on refinements) did not fire on first attempt; a synthetic
  two-marker test case (`zzz_marker`/`aaa_marker`) was added. Confirmed present in
  `tests/lib.schemaFingerprint.spec.ts:130-146` as `"refinements are sorted deterministically
  regardless of properties insertion order"`. The probe itself was not weakened.
- 122-04's M9 probe (treat "unreadable" as "missing") did not fire against the originally-named test;
  a 14th test using a malformed body with no `table_names` key was added. Confirmed present as
  `"unreadable /show/table body (no table_names array at all): 502, never table_missing or a diff"`
  (`routes.schema-check.spec.ts:296-307`), using fixture `NO_TABLE_NAMES_BODY = { some_other_field:
  ... }`. This test independently passes and reddens under the M9 mutation per the SUMMARY's report.
- 122-03 and 122-04 each reported a non-discriminating grep criterion (their own plan's mandated
  doc-comment text contained a forbidden token). Both verified the real requirement directly
  (type-shape inspection / diff-content inspection) rather than editing code to dodge the grep.
  Confirmed no field named `severity`/`breaking`/`impact` exists on `SchemaCheckResult`, and no
  second Kinetica query construct was added — both true by direct inspection.
- The parallel-wave git race (122-02's test file landing inside 122-01's commit `ed4fc16`) is
  independently confirmed: `git show ed4fc16 --stat` includes
  `tests/db.schemaFingerprintColumn.spec.ts`; the GREEN implementation commit `4c4e59b` is isolated to
  `src/db.ts` only (40 lines). Documented in `.planning/STATE.md` around line 39. Not a code defect —
  reported here only as confirmation that the record is accurate, not a gap.

### Gaps Summary

None. All must-haves across all four plans are verified directly against the codebase (not the
SUMMARYs), all server and web test gates were independently re-run and match the documented results
exactly (server gate: GATE PASSED, same 8 `KNOWN_FAILING` files; web: 181/181 files, 4100/4100 tests;
theme-guard: 152/152), `tsc --noEmit` is clean on both packages, and every honesty-check item in the
task brief was independently confirmed rather than taken on faith.

---

_Verified: 2026-09-21_
_Verifier: Claude (gsd-verifier)_
