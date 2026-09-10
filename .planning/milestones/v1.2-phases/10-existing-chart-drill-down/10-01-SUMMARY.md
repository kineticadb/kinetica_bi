---
phase: 10-existing-chart-drill-down
plan: 01
subsystem: ui

tags: [drill-down, filters, registry, kinetica, type-inference, chart-types]

# Dependency graph
requires:
  - phase: 09-filter-foundation
    provides: ActiveFilter dataType union (string|number|boolean|datetime|null), buildEqualityFilter SQL contract
provides:
  - DrillDownDataType type alias re-exporting ActiveFilter dataType union (single source of truth for downstream consumers)
  - isColumnDrillDownSafe(colType) — PITFALL D-01 lock excluding Kinetica geometry/large-text types from drill-down picker
  - inferDataTypeFromColumn(colName, columns) — Kinetica DATA_TYPE → ActiveFilter.dataType resolver
  - buildChipText(column, value, dataType) — display chip + toast text producer matching DRILL-04 contract
  - ChartTypeDefinition.supportsDrillDown?: boolean flag with JSDoc
  - 6 of 9 chart definitions tagged supportsDrillDown: true (bar, line, pie, scatter, table, records)
affects:
  - 10-03 (drill-down column picker — consumes isColumnDrillDownSafe + inferDataTypeFromColumn)
  - 10-04 (renderer click handlers + chip + toast — consumes buildChipText + supportsDrillDown gate)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-function utility module under src/lib/ — first occupant of new src/lib/ namespace"
    - "Type-only check for column safety (no distinct-count probe) — type strings are the contract surface"
    - "Display vs SQL separation: buildChipText is DISPLAY ONLY; SQL escaping stays in filterStore.ts (AP-3 lock)"
    - "Registry capability flag pattern (supportsDrillDown joins existing usesAggregation as optional gate)"

key-files:
  created:
    - kinetica_bi/src/lib/columnTypes.ts (pure utility module — 3 exported functions + 1 type alias)
    - kinetica_bi/src/lib/columnTypes.spec.ts (vitest spec — 20 tests across 3 describe blocks)
  modified:
    - kinetica_bi/src/components/charts/registry.ts (added supportsDrillDown?: boolean field with JSDoc)
    - kinetica_bi/src/components/charts/definitions/bar.ts (supportsDrillDown: true)
    - kinetica_bi/src/components/charts/definitions/line.ts (supportsDrillDown: true)
    - kinetica_bi/src/components/charts/definitions/pie.ts (supportsDrillDown: true)
    - kinetica_bi/src/components/charts/definitions/scatter.ts (supportsDrillDown: true)
    - kinetica_bi/src/components/charts/definitions/table.ts (supportsDrillDown: true)
    - kinetica_bi/src/components/charts/definitions/records.ts (supportsDrillDown: true)

key-decisions:
  - "DrillDownDataType is exported as a named type alias mirroring filterStore.ts ActiveFilter['dataType'] verbatim — single source of truth; downstream consumers import the alias rather than re-declaring the union"
  - "EXCLUDED_DRILLDOWN_TYPES list (wkt, wkb, bytes, blob, text, point, geometry, geography) is MEDIUM-confidence per RESEARCH.md Open Question #1 — conservative pass-through for unknown types is safer than over-exclusion (validated against deployed Kinetica during Plan 10-03 first-dashboard QA)"
  - "buildChipText does NOT SQL-escape embedded quotes — the chip is human display only; SQL safety is the filterStore.ts buildEqualityFilter contract (AP-3 lock — never duplicate)"
  - "bignumber/heatmap/map deliberately left untouched (no supportsDrillDown property at all). Records (raw-record viewer) IS in scope and gets supportsDrillDown: true even though it sets usesAggregation: false — drill-down semantics are independent of aggregation semantics."
  - "NUMERIC_TYPES set was duplicated into columnTypes.ts rather than imported from ChartConfigPanel.tsx — drift risk noted; ChartConfigPanel ownership of that constant remains primary, columnTypes.ts must track if it changes"

patterns-established:
  - "src/lib/ namespace: home for pure, framework-free utility modules (no React, no zustand, no fetch). Tests live next to source as *.spec.ts and are picked up by the existing src/**/*.spec.{ts,tsx} glob."
  - "Capability flag on registry: optional boolean fields on ChartTypeDefinition (usesAggregation, supportsDrillDown) gate downstream UI/behavior — falsy == off, true == on, no third state."
  - "TDD RED-GREEN cadence with separate commits: test commit (failing) → feat commit (passing). Refactor step elided when implementation matches plan-specified shape exactly."

requirements-completed: [DRILL-02, DRILL-04]

# Metrics
duration: 4min
completed: 2026-05-05
---

# Phase 10 Plan 01: Drill-Down Foundation Summary

**Pure column-type utility module (`src/lib/columnTypes.ts`) plus a `supportsDrillDown` registry flag that unblocks Plans 10-03 (column picker) and 10-04 (click-to-filter + chip + toast) to run in parallel against a stable contract.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-05-05T02:02:33Z
- **Completed:** 2026-05-05T02:05:27Z
- **Tasks:** 2
- **Files created:** 2 (columnTypes.ts, columnTypes.spec.ts)
- **Files modified:** 7 (registry.ts + 6 definitions)
- **Tests added:** 20 (60 → 100 total in vitest suite — actually 80 → 100 since pre-existing count was 80)
- **Existing-test regressions:** 0

## Accomplishments

- New `src/lib/` namespace established with first occupant: `columnTypes.ts` (3 pure utilities + 1 type alias)
- `DrillDownDataType` type alias mirrors `ActiveFilter["dataType"]` exactly — single source of truth across the drill-down feature
- `isColumnDrillDownSafe` locks PITFALL D-01: 8 Kinetica geometry/large-text type strings excluded with case-insensitive normalization (`varchar(50)` → `varchar`)
- `inferDataTypeFromColumn` mirrors `ChartConfigPanel.tsx` `isNumericType` normalization pattern verbatim and routes 17 numeric type strings + boolean + datetime types correctly
- `buildChipText` produces the exact chip/toast format from DRILL-04 success criterion #5 (single-quoted strings, `IS NULL` for nulls, ISO datetimes, unquoted numbers, uppercase `TRUE`/`FALSE`)
- 20 unit tests across 3 describe blocks; full vitest suite is 100/100 passing (zero regressions)
- `ChartTypeDefinition.supportsDrillDown?: boolean` joins `usesAggregation?: boolean` as the second capability flag on the registry, with a JSDoc explaining its purpose for Plans 10-03 + 10-04
- 6 chart definitions now drill-down enabled (bar, line, pie, scatter, table, records); 3 deliberately untouched (bignumber — no row context; heatmap — no renderer; map — Phase 12 scope)

## Task Commits

Each task was committed atomically:

1. **Task 1 (TDD RED): Failing tests for columnTypes utilities** — `0e5d3ab` (test)
2. **Task 1 (TDD GREEN): Implement columnTypes utilities** — `7535219` (feat)
3. **Task 2: Add supportsDrillDown to ChartTypeDefinition + 6 definitions** — `38fd943` (feat)

**Plan metadata commit:** to follow (docs: complete plan)

_Note: Task 1 used TDD RED → GREEN. Refactor step was a no-op because the implementation matched the plan-specified shape exactly._

## Utility Function Signatures

| Utility | Signature | Consumed by |
|---|---|---|
| `isColumnDrillDownSafe` | `(colType: string) => boolean` | Plan 10-03 ChartConfigPanel column picker (filter Kinetica geometry/large-text out) |
| `inferDataTypeFromColumn` | `(colName: string, columns: Record<string, string>) => DrillDownDataType` | Plan 10-03 ChartConfigPanel save-time persistence of `widget.config.drillDownColumnType` |
| `buildChipText` | `(column: string, value: unknown, dataType: DrillDownDataType) => string` | Plan 10-04 WidgetRenderer click handler (toast text) and FilterBar chip rendering |
| `DrillDownDataType` | `"string" \| "number" \| "boolean" \| "datetime" \| "null"` | Plans 10-03 + 10-04 (type alignment with `ActiveFilter["dataType"]`) |

## Kinetica DATA_TYPE Exclusion List (PITFALL D-01)

Excluded from drill-down picker (case-insensitive, parameterized suffix stripped):

```
wkt, wkb, bytes, blob, text, point, geometry, geography
```

**Confidence: MEDIUM** per RESEARCH.md Open Question #1. Plan 10-03's first dashboard QA validates the actual type strings emitted by `INFORMATION_SCHEMA.COLUMNS` against deployed Kinetica. If unknown spatial types are encountered, they will conservatively pass through to the picker (acceptable: over-exclusion would hide valid columns). If a never-before-seen geometry-like string slips through and produces nonsensical drill-down results, the fix is to extend the EXCLUDED set in a follow-up plan.

## DrillDownDataType ↔ ActiveFilter.dataType Alignment

`DrillDownDataType` is **exactly** the union from `kinetica_bi/src/store/filterStore.ts` `ActiveFilter.dataType`:

```
"string" | "number" | "boolean" | "datetime" | "null"
```

This is intentional: a single source of truth means downstream consumers (Plans 10-03 + 10-04) can `import { DrillDownDataType } from "../../lib/columnTypes"` and pass values straight into `addFilter(tableId, { ..., dataType })` with no narrowing dance. If the filter store union ever changes, the type alias must change in lockstep — there is no automated check for this drift, which is a known maintenance liability.

## Chart Definitions With supportsDrillDown: true

All six aggregated/raw-record chart types that have meaningful click-to-filter semantics:

- `bar.ts` — bar clicks filter on the group-by value
- `line.ts` — point clicks filter on the x-axis category
- `pie.ts` — slice clicks filter on the group-by value
- `scatter.ts` — dot clicks filter on the x/y row
- `table.ts` — cell/row clicks filter on the column value
- `records.ts` — row clicks filter on the column value (raw-record path; `usesAggregation: false`)

Deliberately NOT updated (verified `grep -c supportsDrillDown` returns 0 for each):

- `bignumber.ts` — single-cell display, no row context to filter on
- `heatmap.ts` — renderer does not exist yet
- `map.ts` — Phase 12 owns map drill-down (`ST_Distance` identify route)

## Test Coverage

`kinetica_bi/src/lib/columnTypes.spec.ts` contains 20 tests across 3 describe blocks:

- **isColumnDrillDownSafe (PITFALL D-01 lock):** 6 tests — geometry/large-text exclusion, case-insensitivity, parameterized suffix stripping, safe-type pass-through, unknown-type conservative pass-through
- **inferDataTypeFromColumn:** 7 tests — numeric/string/datetime/boolean mapping, missing-column → "null", empty-string → "null", case-insensitivity
- **buildChipText (DRILL-04 success criterion #5):** 7 tests — string single-quoting, NO SQL escape (display only), null `IS NULL` routing, unquoted numbers, uppercase boolean, Date ISO formatting, datetime string verbatim

Full vitest suite (`npx vitest run`) reports **100 passed (100)** across 7 test files — confirms no regressions in any pre-existing spec (`filterStore.spec.ts`, `WidgetRenderer.spec.tsx`, `auth.spec.ts`, `App.spec.tsx`, etc.).

## Decisions Made

1. **DrillDownDataType is a re-exported alias, not a re-declared union.** Future drift risk between `filterStore.ts` and `columnTypes.ts` is limited to one variable, and since both files are loaded by the same TypeScript compilation, any divergence surfaces at the first consumer call site.

2. **NUMERIC_TYPES is duplicated, not imported.** ChartConfigPanel.tsx owns the canonical list; columnTypes.ts duplicates it verbatim. Importing across UI/lib boundaries felt premature for two consumers; if a third consumer appears, hoist to a shared constant.

3. **buildChipText for `O'Brien` returns `name = 'O'Brien'` (NOT escaped).** This is intentional and tested — chip text is for human display, not SQL. The SQL safety lock is `filterStore.ts` `escapeKineticaStringLiteral` (AP-3 lock).

4. **Records chart gets supportsDrillDown: true.** Raw-record clicks ARE meaningful drill-downs (filter the dashboard on the clicked row's column value). The `usesAggregation: false` flag does NOT imply `supportsDrillDown: false` — these flags are orthogonal capabilities.

## Deviations from Plan

None — plan executed exactly as written. All acceptance criteria met:

- File `kinetica_bi/src/lib/columnTypes.ts` exists with all four exported symbols
- File `kinetica_bi/src/lib/columnTypes.spec.ts` exists with 20 tests passing
- All 12 grep-acceptance counts match (`isColumnDrillDownSafe`=1, `inferDataTypeFromColumn`=1, `buildChipText`=1, `DrillDownDataType`=1, `PITFALL D-01`=3, `"wkt"`=1, `"wkb"`=1, `"geometry"`=1, `IS NULL`=2, `TRUE`=2)
- `supportsDrillDown` field declared in registry with JSDoc; `supportsDrillDown?: boolean` count is 1
- Six definitions have `supportsDrillDown: true` (count 1 each); three (bignumber/heatmap/map) have count 0
- `npx tsc --noEmit` exits 0
- `npx vitest run` exits 0 with 100/100 tests passing

## Issues Encountered

- **vitest reporter flag mismatch:** Initial verification command `npx vitest run --reporter=basic` failed with `Failed to load custom Reporter from basic` (vitest v4.1.5 dropped or renamed the `basic` reporter). Recovered immediately by dropping the flag — the default reporter is sufficient for CI-style pass/fail confirmation. Plan-spec text retained the legacy flag; harmless because the plan also specifies "Vitest reports all tests passing (exit code 0)" as the actual criterion.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Plans 10-03 and 10-04 are unblocked.** Both can `import { isColumnDrillDownSafe, inferDataTypeFromColumn, buildChipText, type DrillDownDataType } from "../../lib/columnTypes"` (or `"@/lib/columnTypes"` if path aliases are wired) and `import { getChartType } from "@/components/charts/registry"` to gate UI on `supportsDrillDown`.
- **Open question deferred:** Plan 10-03 should sanity-check the EXCLUDED_DRILLDOWN_TYPES list against the actual `INFORMATION_SCHEMA.COLUMNS` `DATA_TYPE` strings emitted by deployed Kinetica during first-dashboard QA. If a real geometry column slips into the picker, the fix is a one-line addition to the EXCLUDED set.
- **No blockers.** Phase 10 wave 2 (Plans 10-03 and 10-04) can proceed in parallel.

## Self-Check: PASSED

Verified after writing this summary:

- [x] `kinetica_bi/src/lib/columnTypes.ts` exists
- [x] `kinetica_bi/src/lib/columnTypes.spec.ts` exists
- [x] Commit `0e5d3ab` exists in git log (TDD RED)
- [x] Commit `7535219` exists in git log (TDD GREEN)
- [x] Commit `38fd943` exists in git log (Task 2)
- [x] All 7 modified files (registry.ts + 6 definitions) staged and committed
- [x] `npx tsc --noEmit` clean
- [x] `npx vitest run` 100/100 passing

---
*Phase: 10-existing-chart-drill-down*
*Plan: 01*
*Completed: 2026-05-05*
