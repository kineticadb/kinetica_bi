---
phase: 120-import
plan: 02
subsystem: api
tags: [dashboard-export-import, validation, table-matching, custom-metrics, sqlite, better-sqlite3, typescript]

# Dependency graph
requires:
  - phase: 120-import
    plan: 01
    provides: "collectWidgetConfigRefs/collectLayerRefs/collectDynamicViewRefs, getTableBySchemaName"
provides:
  - "validateImportFile(raw) — two-tier structural/referential validation gate, zero DB access"
  - "resolveTables(tables) / resolveCustomMetrics(metrics, tableIdMap) — match-or-create resolution with conflict reporting"
  - "ImportReport type — the shape Plan 03's applyDashboardImport fills in"
affects: ["120-03", "120-04", "120-05"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Tier 1 (structural, in-memory, fail-fast) / Tier 2 (referential, accept+report, recomputed never trusted from the file) as two clearly separated phases of one function"
    - "Per-run `seen` map for within-file schema.name dedup, distinct from the cross-run getTableBySchemaName target lookup — both matter, proven via a vi.spyOn call-count assertion, not just outcome assertions"
    - "asId exported from dashboardExportRefs.ts and reused verbatim in the validator rather than a second positive-integer predicate"

key-files:
  created:
    - packages/server/src/lib/dashboardImport.ts
    - packages/server/tests/lib.dashboardImport.validate.spec.ts
  modified:
    - packages/server/src/lib/dashboardExportRefs.ts

key-decisions:
  - "Metric-label conflict policy implemented exactly as locked in 120-CONTEXT.md: reuse the target's existing definition, and report the metric label + schema.name table + the fact the expressions differed. The report message is asserted with three independent toContain() checks against values the TEST defines, never a literal copied from the source."
  - "V5's mutation probe (drop resolveTables' per-run `seen` map) did NOT redden its originally-planned assertions on first attempt: getTableBySchemaName is a live query, so a second file entry sharing one schema.name still resolves to the row the first entry just created, by coincidence of synchronous DB reads rather than by the `seen` map's doing. Rather than accept a non-discriminating test (CLAUDE.md's explicit warning), the test was strengthened with a `vi.spyOn(getTableBySchemaName)` call-count assertion (must be called exactly once for the shared key) — that is the actual, provable effect of the `seen` map, and it reddens correctly under the mutation."
  - "Duplicate-id rejection message deliberately names the collection and the repeated id (`duplicate id 10 found in widgets`) rather than a field path, since there is no single offending array index — the plan's own <action> text describes this as 'a message naming the collection and the repeated id', not a field-path form."

requirements-completed: []
# No DXIM requirement marked complete — Plan 05 owns closure, per the plan's own warning 9.

# Metrics
duration: ~20min
completed: 2026-09-16
---

# Phase 120 Plan 02: Import Validation + Table/Metric Resolution Summary

**Two-tier (structural-reject / referential-report) validation gate plus schema.name / label match-or-create resolution for tables and custom metrics, with the operator's locked same-label-different-expression conflict policy made visible in the report rather than silent.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-09-16
- **Tasks:** 3
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments

- `validateImportFile` rejects a malformed file with a message naming the offending field path
  (e.g. `widgets[0].config`), entirely in memory, before any DB call — zero DB-write calls exist
  anywhere in the module at the point validation alone was measured (Task 1 acceptance criterion 5).
- An unsupported `schemaVersion` is rejected naming both the file's version and the versions this
  build supports, built from `SUPPORTED_IMPORT_SCHEMA_VERSIONS.join(", ")` so the message cannot
  drift from the actual supported list.
- Tier 2 (referential) never trusts the file's own `danglingReferences` — it is recomputed from the
  file's own id sets using the SAME `collect*` functions Phase 119/120-01 established, and a
  deliberately falsified `danglingReferences` array in a test fixture is confirmed ignored.
- `resolveTables` matches by `schema.name`: reuses an existing target row, creates one when absent,
  and never duplicates — either against the target (`getTableBySchemaName`) or within one file (a
  per-run `seen` map). A matched row's `columns`/`description` are never overwritten from the file.
- `resolveCustomMetrics` matches by exact (case-sensitive) `label` on the resolved table. A
  same-label different-expression match reuses the target's existing definition per the operator's
  locked decision (120-CONTEXT.md) and reports a message naming the metric, the `schema.name` table,
  and the substring `DIFFERENT expression` — the report entry the operator's accepted cost depends on.
- `asId` exported from `dashboardExportRefs.ts` so the validator reuses the canonical
  positive-integer predicate rather than defining a second one.
- 6/6 mutation probes fired; one (V5) required strengthening its test to actually discriminate the
  mutation, documented below and in the spec file's header per CLAUDE.md's non-discriminating-
  criterion rule.

## Task Commits

1. **Task 1: validateImportFile — two-tier validation** - `cbfb4c4` (feat) — 19 tests (13
   `VALID-reject`, 4 `VALID-accept`, 3 `VALID-dangle`, 1 `VALID-nowrite`); also modified
   `dashboardExportRefs.ts` to export `asId`.
2. **Task 2: resolveTables + resolveCustomMetrics + ImportReport** - `42fb0a5` (feat) — 14 new tests
   (6 `RESOLVE-table`, 8 `RESOLVE-metric`); 33 tests total in the file.
3. **Task 3: 6 mutation probes** - `b179526` (test) — probe record appended to the spec file's
   header comment.

## Exported Symbol List

From `packages/server/src/lib/dashboardImport.ts` (Plan 120-03 imports these verbatim):

```
SUPPORTED_IMPORT_SCHEMA_VERSIONS, ImportRejection, ValidateResult, validateImportFile,
TableResolution, ResolveTablesResult, resolveTables,
MetricResolution, MetricConflict, ResolveMetricsResult, resolveCustomMetrics,
ImportReport
```

From `packages/server/src/lib/dashboardExportRefs.ts` (newly exported this plan): `asId`.

## Exact Rejection Message Formats

- **`IMPORT_MALFORMED`** (generic field-shape rejection):
  `Import file is malformed: <path> <expectation> (got <actualType>).`
  e.g. `Import file is malformed: widgets[0].config must be an object (got string).`
- **`IMPORT_MALFORMED`** (within-collection duplicate id — no single field path applies, so this
  names the collection and the id instead):
  `Import file is malformed: duplicate id <id> found in <collection>.`
  e.g. `Import file is malformed: duplicate id 10 found in widgets.`
- **`UNSUPPORTED_SCHEMA_VERSION`**:
  `Unsupported schemaVersion: <n> (this build supports <supported list, comma-joined>).`
  e.g. `Unsupported schemaVersion: 2 (this build supports 1).`
- **Metric conflict** (`MetricConflict.message`, not a rejection — this is an accepted-and-reported
  case):
  `Custom metric "<label>" on <schema>.<name> already exists in this environment with a DIFFERENT
  expression. Imported widgets now use the EXISTING definition (<existingExpression>); the file's
  definition (<importedExpression>) was NOT applied.`

## Mutation Probe Table (6/6 fired)

| # | Mutation | Test(s) reddened | Fired? |
|---|---|---|---|
| V1 | Removed the `SUPPORTED_IMPORT_SCHEMA_VERSIONS` membership check (accept any positive integer) | `VALID-reject: schemaVersion 2 is rejected naming both 2 and the supported version` | YES |
| V2 | Treated a missing `widgets` collection as `[]` instead of rejecting | `VALID-reject: a missing widgets array is rejected naming "widgets"` (crashes with a TypeError inside the Tier-2 walk rather than cleanly failing the assertion — still a failing test) | YES |
| V3 | Deleted the within-collection duplicate-id check | `VALID-reject: duplicate widget ids inside the file are rejected` | YES |
| V4 | Made a recomputed dangling reference FATAL (rejected instead of reported) | `VALID-dangle: a widget referencing a widget id absent from the file is reported, NOT rejected` | YES |
| V5 | In `resolveTables`, dropped the `seen` map so a repeated `schema.name` re-queries the target | Did NOT redden on first attempt — see below. Strengthened, then reddened `RESOLVE-table: TWO file entries sharing one schema.name resolve to the SAME new id and create ONE row` | YES (after strengthening) |
| V6 | In `resolveCustomMetrics`, skipped the `existing.expression !== m.expression` comparison | `RESOLVE-metric: a same-label DIFFERENT-expression match is reported in conflicts` | YES |

**6/6 probes fired**, one (V5) only after the test was strengthened.

### V5 — a validation case the plan did not anticipate

The plan's own mutation table asserted that dropping `resolveTables`' per-run `seen` map would
redden "TWO file entries sharing one schema.name resolve to the SAME new id and create ONE row." It
did not, on the first attempt. Investigation: `getTableBySchemaName` performs a live `SELECT`
against the target `tables` table on every call. Because `createTable` (better-sqlite3, synchronous,
same connection) commits its write immediately and visibly to subsequent reads on that same
connection, the SECOND file entry's `getTableBySchemaName` call — even with the `seen` map
removed — independently finds the row the FIRST entry just created, and resolves to the same id by
coincidence of read-your-own-write consistency, not because of the `seen` map. All three of the
test's original assertions (`created` length, same mapped id, row-count delta) therefore held true
under the mutation, meaning the test was non-discriminating for that specific claim — exactly the
"grep that cannot fail" problem CLAUDE.md warns about, applied to a mutation probe instead of a
grep.

Per CLAUDE.md ("If an executor finds a criterion that cannot discriminate, it should ... verify the
real requirement directly"), the test was strengthened rather than the mutation abandoned: a
`vi.spyOn(dbModule, "getTableBySchemaName")` call-count assertion was added, asserting the target is
queried exactly ONCE for the shared key across both file entries. That is the `seen` map's actual,
provable effect (avoiding a redundant target lookup for a key already resolved earlier in the same
run), and the mutation correctly reddens it (2 calls instead of 1). The `seen` map remains
correctness-relevant for a different reason not exercised by this specific test — a within-file
duplicate whose FIRST occurrence's `createTable` has not yet committed relative to some other write
path — but for THIS synchronous, single-connection implementation, its provable, testable effect is
the query-count reduction, and the strengthened test now asserts exactly that.

## Design Notes

- **Fail-fast, not fail-all.** Tier 1 returns the FIRST problem found, matching the plan's explicit
  instruction ("one clear message beats a list").
- **`asId` reused, not duplicated.** `dashboardExportRefs.ts` now exports its canonical
  positive-integer predicate; `dashboardImport.ts` imports it rather than defining
  `isPositiveInt` a second time, avoiding the exact drift risk the plan called out.
- **Zero DB access in `validateImportFile`.** Confirmed at the end of Task 1 (before Task 2 added
  any DB-touching code to the same file):
  `grep -cE "createTable|createWidget|createDashboard|createCustomMetric|db\.prepare|db\.transaction" src/lib/dashboardImport.ts` → `0`.
- **No new dependency.** `git diff -- package.json` empty; `grep -c "zod" src/lib/dashboardImport.ts` → `0`.
- **`danglingReferences` never read from the input.** The two hits in the file for that identifier
  are both comments (verified: `grep -n "danglingReferences" src/lib/dashboardImport.ts` — every
  line starts with `*` or `//` after trimming).

## Deviations from Plan

### Auto-fixed / strengthened

**1. [Rule 3 — non-discriminating test, per CLAUDE.md] V5's mutation probe test strengthened**
- **Found during:** Task 3, running the V5 probe.
- **Issue:** The originally-planned assertions for "TWO file entries sharing one schema.name..."
  passed both with and without the `seen` map, because a live `getTableBySchemaName` re-query
  independently produces the same outcome by coincidence of synchronous read-after-write.
- **Fix:** Added a `vi.spyOn` call-count assertion (exactly 1 call for the shared key), which is the
  map's actual, provable effect and correctly reddens under the mutation.
- **Files modified:** `packages/server/tests/lib.dashboardImport.validate.spec.ts`.
- **Commit:** `b179526`.

No other deviations. All other tasks matched the plan's `<action>` sections exactly, including the
exact message formats specified in Task 1's acceptance criteria.

## Issues Encountered

See "V5 — a validation case the plan did not anticipate" above — the only substantive finding this
plan produced beyond straightforward implementation.

## Process Note (per plan's own warning 8)

`gsd-tools state advance-plan` and `roadmap update-plan-progress` are expected to fail to parse this
project's STATE.md/ROADMAP.md formats (as with all prior 119/120 waves). STATE.md and ROADMAP.md
are updated manually in the existing style in the commit following this SUMMARY.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

Plan 03 (`applyDashboardImport`, the transaction, the two-pass rewrite, the route) can import
`validateImportFile`, `resolveTables`, `resolveCustomMetrics`, and `ImportReport` directly from
`packages/server/src/lib/dashboardImport.ts`. No DXIM requirement was marked complete this plan —
closure remains Plan 05's responsibility, per this plan's explicit scope boundary (warning 9).

## Self-Check: PASSED

- FOUND: `packages/server/src/lib/dashboardImport.ts`
- FOUND: `packages/server/tests/lib.dashboardImport.validate.spec.ts`
- FOUND: `packages/server/src/lib/dashboardExportRefs.ts` (modified, `asId` exported)
- FOUND commit: `cbfb4c4` (Task 1)
- FOUND commit: `42fb0a5` (Task 2)
- FOUND commit: `b179526` (Task 3)

---
*Phase: 120-import*
*Completed: 2026-09-16*
