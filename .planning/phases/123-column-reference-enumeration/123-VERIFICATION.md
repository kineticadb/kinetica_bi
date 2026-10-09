---
phase: 123-column-reference-enumeration
verified: 2026-09-23T10:50:00Z
status: passed
score: 8/8 must-haves verified
---

# Phase 123: Column Reference Enumeration Verification Report

**Phase Goal:** A single pure traversal answers "what in this app refers to column X of table Y",
covering every structured site exactly and every free-SQL site heuristically, with each finding
carrying which of the two it was.
**Verified:** 2026-09-23
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | All 40 inventoried sites are enumerated and each has a test that reddens if removed | ✓ VERIFIED | `COLUMN_REF_SITES` has 40 entries (counted directly); golden test pins order; deliberately re-deleted `widget.config.metricColumn` myself — 9 tests reddened including both COVERAGE tests, then restored, suite green again (107/107) |
| 2 | `configPatch` copies (both action shapes) are found as distinct findings from the layer they patch | ✓ VERIFIED | `getOptionActionsLike` walks plural `actions[]` and legacy singular `action`; widget 6 (legacy) and widget 11 (plural) both produce findings; "BOTH SHAPES" test and "DISTINCT" test pass |
| 3 | Free-SQL sites (5) + `columns_json[].name` produce heuristic/table-less findings, never rewriting SQL | ✓ VERIFIED | `emitFreeSql`/`scanFreeSql` confirmed table-less (`tableId: null`, `tableScope: "free-sql"`); `columns_json[].name` is value-equality, table-less, `confidence: "heuristic"` never `"low-confidence"`/`"exact"` |
| 4 | Structured findings are exactly table-scoped; a same-named column on a different table yields no finding | ✓ VERIFIED | Explicit tests for widget/layer/dv-bound/spatialTargets all confirm no-finding-on-wrong-table; `resolveWidgetTableId`/`resolveLayerTableId`/`resolveConfigPatchTableId` all dv-authority-first, dangling-dv → `unresolved` (never falls back to cache) |
| 5 | `dashboardExportRefs.ts` zero-diff, cross-referenced in comments only | ✓ VERIFIED | `git diff --stat c522f83..HEAD -- .../dashboardExportRefs.ts` empty; sha256 = `52fd4272...` unchanged; only one `import type` block in `columnRefs.ts`, all `dashboardExportRefs` mentions are inside comments |
| 6 | The module is pure (no db/express/fetch, rewrites nothing) | ✓ VERIFIED | grep for `require(`/`from "../db"`/`from "express"`/`fetch(` = 0; single import is `import type { ... } from "../types"` |
| 7 | Both requirements (SSYNC-V125-07, SSYNC-V125-08) are satisfied by shipped code, not just marked complete | ✓ VERIFIED | REQUIREMENTS.md entries cite concrete mechanisms (`resolveConfigPatchTableId`, both action shapes, `scanFreeSql`/`emitFreeSql`, `tableScope: "free-sql"`) that match the actual code |
| 8 | All test gates pass exactly as claimed | ✓ VERIFIED | Ran every gate myself (see below) — all match SUMMARY claims exactly |

**Score:** 8/8 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/server/src/lib/columnRefs.ts` | Pure traversal, 40-site registry, `collectColumnRefs` | ✓ VERIFIED | 1465 lines; all exports present (`ColumnRef`, `COLUMN_REF_SITES`, `FREE_SQL_SITES`, `resolveWidgetTableId`, `resolveLayerTableId`, `resolveConfigPatchTableId`, `scanFreeSql`, `maskQuotedLiterals`, `isLowConfidenceColumnName`, `collectColumnRefs`, etc.) |
| `packages/server/tests/lib.columnRefs.spec.ts` | Golden list, per-site coverage, coverage guard | ✓ VERIFIED | 1837 lines, 107/107 passing; sentinel-based master fixture confirmed to produce 40 distinct sentinels (computed independently) |
| `.planning/REQUIREMENTS.md` | SSYNC-V125-07/08 closed | ✓ VERIFIED | Both marked `[x]` with mechanism-specific evidence; no orphaned Phase-123 requirement rows found |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `columnRefs.ts` | `dashboardExportRefs.ts` | header/inline comment cross-reference | ✓ WIRED | 9 comment references found, zero import statements; sha256 of target file unchanged across whole phase range |
| `resolveConfigPatchTableId` | `resolveLayerTableId` / `resolveWidgetTableId` | direct function dispatch on `target.kind` | ✓ WIRED | Confirmed by reading the dispatch code (lines 482-502) and by the "DISTINCT" / "SCOPE: configPatch scoped to TARGET" tests passing |
| `emitMalformedJsonFallback` | `scanFreeSql` | fallback on `JSON.parse` failure, record's own table kept | ✓ WIRED | Both layer- and configPatch-scoped malformed-JSON tests pass, confirming `tableId`/`tableScope` come from the record, not `null`/`"free-sql"` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| SSYNC-V125-07 | 123-01/02/03/04 | Layer + configPatch column-reference coverage, both action shapes | ✓ SATISFIED | 11 layer sites + 8 configPatch sites implemented and tested; both `options[].actions[]` and `options[].action` walked (widgets 6 & 11, real dev-DB rows) |
| SSYNC-V125-08 | 123-01 | Free-SQL sites reported as *possibly* affected (heuristic), never rewritten | ✓ SATISFIED | All 5 `FREE_SQL_SITES` scanned via locked whole-identifier/case-insensitive/literal-skipping regex; `confidence` never `"exact"`; `tableScope` always `"free-sql"` |

No orphaned requirements: `grep "Phase 123" .planning/REQUIREMENTS.md` maps exactly SSYNC-V125-07 and -08, matching what both plans' frontmatter claim.

### Anti-Patterns Found

None. No TODO/FIXME/placeholder markers, no empty-return stubs, no console.log-only handlers in `columnRefs.ts`. The file's own header explicitly documents its 12 synthetic-only sites and the one ROADMAP-criterion-2-adjacent `configPatch.metric` addition — both surfaced in-code, not just in prose.

### Independently Re-Performed Checks (per the verification brief)

1. **Coverage guard re-performed live.** I deleted the `widget.config.metricColumn` emitter block myself (not trusting the SUMMARY's transcript), ran the full spec: **9 failed | 98 passed** — an exact match to the SUMMARY's reported figure — including both `COVERAGE:` tests and the site's own `SITE` test. Restored the file; suite returned to 107/107 green. The guard is real, not decorative.
2. **Sentinel distinctness computed independently** (not copy-pasted from the test file): built the 40-entry `COLUMN_REF_SITES` list and the `sentinel()` transform in a scratch Node script — 40 inputs, 40 distinct outputs, zero collisions.
3. **Set-equality, not containment**: `"COVERAGE: the master fixture's finding sites are EXACTLY the registry, with nothing extra"` asserts `[...seen].sort()` `.toEqual([...COLUMN_REF_SITES].sort())` — genuine two-way set equality, confirmed by reading the assertion directly.
4. **All test gates re-run from scratch**, not taken from the SUMMARY:
   - `cd packages/server && npx tsc --noEmit` → clean.
   - `cd packages/server && npx vitest run tests/lib.columnRefs.spec.ts` → 107/107.
   - `cd packages/server && node scripts/test-gate.mjs` → **GATE PASSED**, exactly the 8 documented `KNOWN_FAILING` files, plus one `TD-V16-TEST-ISOLATION` contamination-only extra (`tests/layers.spec.ts`, confirmed passing in isolation by the gate script itself) — matches the SUMMARY's description of this known flakiness class.
   - `cd packages/web && npx tsc --noEmit` → clean.
   - `cd packages/web && npx vitest run` → **181 files / 4100 tests**, all passed — exact match.
   - `cd packages/web && npx vitest run src/styles/theme-guard.spec.ts` → **152/152**.
   - `git diff --name-only c522f83..HEAD -- packages/web | wc -l` → **0**.
   - `shasum -a 256 packages/server/src/lib/dashboardExportRefs.ts` → `52fd42722d68e650673ba281a979cd79734a5f7b1f49d813877040a6fa8cfe9d` (unchanged).
5. **Purity re-verified by grep** on the actual shipped file: zero `require(`, zero `from "../db"`, zero `from "express"`, zero `fetch(`; exactly one `import` statement and it is `import type`.
6. **a second, joined table correction verified in shipped code**, not just the SUMMARY: the permanent comment at the `dynamicView.columns_json[].name` block reads "REGISTERED as table id 5, distinct from the dv's own source_table_id 4 ... an earlier draft of this comment called that table 'unregistered' — it is not."
7. **`configPatch.metric` decision surfaced in-code**: a "PLANNER NOTE" comment sits directly above the `metric` emitter block explaining it's the one site beyond ROADMAP criterion 2's literal wording, why it was kept, and how to strike it if the operator disagrees — not buried only in the SUMMARY.
8. **12 synthetic-only sites labeled in the module header itself**, matching the SUMMARY's table exactly, plus the deliberate-deletion proof narrated in the same header comment.
9. **Malformed-JSON-not-swallowed confirmed for both the direct layer site and the configPatch fallback** — both dedicated tests pass and assert `confidence` downgraded (never silent), `tableId`/`tableScope` retained from the record (not nulled to free-sql).
10. **Case-sensitivity asymmetry confirmed**: structured matching test "structured matching is case-SENSITIVE: querying ABC does not match a widget whose groupByColumn is abc" passes; free-SQL's `columnMatchRegex` carries the `i` flag and its own case-insensitivity test (`AlphaCo`/`carrier`) passes; the code's own comments state explicitly that unifying the two is forbidden.
11. **Both `configPatch` action shapes confirmed against real dev-DB fixtures**, not synthetic ones: widget 6 (legacy singular `action`) and widget 11 (plural `actions[]`) both real, both produce findings, and the "BOTH SHAPES" test asserts both path shapes (`.action.` and `.actions[0].`) appear.

### Honesty-Requirements Cross-Check

- **Non-discriminating criteria found during execution**: I found **4** explicitly documented instances across three SUMMARYs (123-01 ×2: Task 3 criterion 4 and the Task 2 "BOTH exact+config.sql" test title; 123-02 ×1: Task 2 criterion 4 on `spatialTargets`/`spatialMode`; 123-03 ×1: Task 3 criterion 5 on `info_template`/`scanFreeSql`). The verification brief's phrasing suggested five; I could not locate a fifth explicitly-labeled "non-discriminating acceptance criterion" anywhere in the four SUMMARYs (123-04 has none). Separately, 123-04 documents 2 more "Rule 3 — Blocking" auto-fixes where a grep guard self-tripped on the module's own disclaiming prose (`patch.aggregation`, the `"SITE "` count) — a related but distinct phenomenon (fixed by rewording, not by verifying an alternate requirement). Whichever count is intended, **every instance I found was handled correctly**: each was investigated, the real requirement verified directly against the actual code (not the failing grep), and none was gamed or silently weakened. This is a minor bookkeeping discrepancy in the review brief, not a defect in the phase's work.
- **P11/P15 (123-01) and P14 (123-03) strengthened tests, genuinely stronger**: read each rationale directly — P11's fixture now has a literal preceding the match on the same line (so delete-vs-space discriminates via offset shift); P15's fixture now uses `vendor_id` (mentioned twice) and asserts a count of 1 finding with 2 matches (so emit-per-match vs emit-per-site discriminates); P14's fixture now also plants the sentinel under a top-level `cb_config` key (`valsType`), not only nested inside `breaks[].shapeFillColor`, so a shallow top-level-only mutation discriminates. All three are genuine strengthenings, not probe-weakenings.
- **54-probe re-run in 123-04**: the only fixes were to a scratch probe-runner script in `/private/tmp/.../scratchpad/`, never committed (confirmed: `git log --all -- '**/run_probes*'` returns nothing, and the three 123-04 commits' diffstats show only `columnRefs.ts`, its spec file, and `REQUIREMENTS.md` touched).
- **a second, joined table correction**: confirmed shipped in the code comment (see item 6 above), corrected from an earlier "unregistered" draft.
- **`configPatch.metric` beyond ROADMAP wording**: confirmed surfaced both in-code (PLANNER NOTE) and in the SUMMARY (dedicated "The configPatch.metric Decision" section) — not buried.
- **12 synthetic-only sites**: labeled explicitly in both the module header and every SUMMARY's fixture tables, with the risk ("first place to look if production data ever contradicts these tests") stated plainly.

### Human Verification Required

None. This phase ships a pure, non-UI, non-HTTP library consumed entirely by later phases; every stated behavior is mechanically verifiable and was independently re-verified above.

### Gaps Summary

No gaps found. All eight derived observable truths verified against the actual code (not the SUMMARYs' claims), all three artifacts pass all three levels (exist, substantive, wired), both requirements are satisfied by concrete mechanisms, all test gates were independently re-run and matched claimed figures exactly, and the phase's own central risk — a coverage guard that has never been seen to fail — was independently re-proven by literally deleting a site block myself and observing the correct 9-test redden before restoring. The one discrepancy found (a "five vs four" count of non-discriminating criteria in the verification brief) does not correspond to any actual defect in the shipped code or tests.

---

*Verified: 2026-09-23*
*Verifier: Claude (gsd-verifier)*
