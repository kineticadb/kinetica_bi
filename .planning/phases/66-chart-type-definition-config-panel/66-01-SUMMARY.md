---
phase: 66-chart-type-definition-config-panel
plan: 01
subsystem: ui
tags: [calendar, heatmap, cell-count, estimation, sql, pure-lib, vitest, tdd]

# Dependency graph
requires:
  - phase: 65-calendar-sql-builder-kinetica-spike
    provides: calendarBin.ts (CELL_LIMIT=10000, CalendarDomain, CalendarSubdomain types)
provides:
  - estimateCalendarCells(rangeMs, subdomain) — conservative upper-bound cell count
  - buildCalendarRangeQuery(fromTarget, timeCol) — MIN/MAX epoch probe SQL
  - SUBDOMAIN_GRANULARITY_MS constant record (hour/day/week/month granularities)
affects:
  - 66-03 CalendarConfigPanel (consumes all three exports for hard-block cap check at save)
  - 67-calendar-renderer (may use buildCalendarRangeQuery for data range probing)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure lib pattern: zero React/Zustand/Recharts imports; mirrors calendarBin.ts / buildCalendarSql.ts"
    - "Conservative upper-bound estimation: use smallest month divisor (28d) to err toward blocking"
    - "Pre-resolved fromTarget contract: caller resolves schema+table before calling, no first-FROM regex inside"

key-files:
  created:
    - packages/web/src/lib/estimateCalendarCells.ts
    - packages/web/src/lib/estimateCalendarCells.spec.ts
  modified: []

key-decisions:
  - "SUBDOMAIN_GRANULARITY_MS[month] = 2_419_200_000 ms (28 days) not 30 days — smallest real month gives more estimated cells, conservatively blocking over-limit grids"
  - "estimateCalendarCells takes (rangeMs, subdomain) only — domain is irrelevant because subdomain bucket count IS the worst-case cell count; domain re-arranges into rows but does not multiply"
  - "buildCalendarRangeQuery accepts pre-resolved fromTarget (same contract as buildCalendarSql) — no schema prefixing logic inside the function"

patterns-established:
  - "Cell-count upper bound = ceil(rangeMs / SUBDOMAIN_GRANULARITY_MS[subdomain]); returns 0 for rangeMs <= 0"
  - "EXTRACT(EPOCH FROM MIN/MAX) probe returns seconds; caller multiplies by 1000 for ms (matching TimelineRenderer line 244)"

requirements-completed: [CAL-V113-05]

# Metrics
duration: 2min
completed: 2026-06-16
---

# Phase 66 Plan 01: estimateCalendarCells — Pure Cell-Count Upper-Bound Estimator Summary

**Conservative cell-count estimator (ceil(rangeMs/28d-subdomain-divisor)) + MIN/MAX epoch probe SQL builder, fully TDD-tested pure lib for Plan 66-03 cap enforcement**

## Performance

- **Duration:** 2 min
- **Started:** 2026-06-16T14:22:55Z
- **Completed:** 2026-06-16T14:24:47Z
- **Tasks:** 1 (TDD: 2 commits — RED + GREEN)
- **Files modified:** 2

## Accomplishments

- `estimateCalendarCells` returns a conservative upper-bound cell count from (rangeMs, subdomain) using 28-day month granularity as divisor — errs toward blocking, never under-counting
- `buildCalendarRangeQuery` emits a MIN/MAX epoch probe over a pre-resolved fromTarget, matching the buildCalendarSql fromTarget contract (no first-FROM regex hazard)
- `SUBDOMAIN_GRANULARITY_MS` record exported for consumption by Plan 66-03 and any future callers
- All 8 vitest tests green; web tsc clean; zero React/Zustand/Recharts imports confirmed

## Task Commits

1. **Task 1 (RED): Failing tests** - `095b833` (test)
2. **Task 1 (GREEN): Implementation** - `bb9bcc8` (feat)

_TDD task: 2 commits (test → feat)_

## Files Created/Modified

- `packages/web/src/lib/estimateCalendarCells.ts` — Pure estimator module: SUBDOMAIN_GRANULARITY_MS, estimateCalendarCells, buildCalendarRangeQuery; imports CalendarSubdomain type from calendarBin
- `packages/web/src/lib/estimateCalendarCells.spec.ts` — 8 vitest tests: 5 estimator cases (hour/day/year-hour over-cap, month-day safe, degenerate zero) + month divisor < 30d assertion + 2 SQL probe tests

## Decisions Made

- Month granularity = 28 days (2_419_200_000 ms): smallest real month gives the LARGEST divisor result (more cells estimated), guaranteeing a conservative upper bound. The spec explicitly asserts `SUBDOMAIN_GRANULARITY_MS["month"] < 30 * 86_400_000`.
- `estimateCalendarCells` signature is `{ rangeMs, subdomain }` only — the `domain` parameter would be superfluous because subdomain bucket count IS the worst-case cell count; domain grouping arranges cells into rows but does not multiply them.
- `buildCalendarRangeQuery` uses pre-resolved `fromTarget` (same contract as `BuildCalendarSqlArgs.fromTarget`) — no schema-prefixing logic inside, matching the Phase 65 established pattern.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `estimateCalendarCells`, `buildCalendarRangeQuery`, and `SUBDOMAIN_GRANULARITY_MS` are ready for Plan 66-03 `CalendarConfigPanel` to import and use for the hard-block cap check at config-save time
- Plan 66-02 (chart-type definition / registry entry) may already be done based on git log (`2626157 feat(66-02)`) — confirm before starting 66-03
- No blockers

---
*Phase: 66-chart-type-definition-config-panel*
*Completed: 2026-06-16*
