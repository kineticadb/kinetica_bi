---
phase: 98-per-visualization-custom-where-clause
plan: 01
subsystem: ui
tags: [sql-builder, pure-lib, customWhere, vizsql, timeline, numeric-line, calendar]

# Dependency graph
requires: []
provides:
  - "customWhere.ts: andCustomWhere() and whereCustomWhere() — shared pure helpers for SQL predicate injection"
  - "buildTimelineSql gains optional customWhere arg with AND-append after IS NOT NULL"
  - "buildNumericLineSql gains optional customWhere arg with AND-append after IS NOT NULL"
  - "buildCalendarSql gains optional customWhere arg with AND-append after IS NOT NULL"
affects: [98-02, 98-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "andCustomWhere/whereCustomWhere: single parenthesization source of truth; callers never inline the AND/WHERE splice logic"
    - "TDD RED → GREEN on pure lib helpers first, then consumer builder wiring"
    - "Byte-identical backward-compat: empty/absent arg returns '' from helper, which splices nothing"

key-files:
  created:
    - packages/web/src/lib/customWhere.ts
    - packages/web/src/lib/customWhere.spec.ts
  modified:
    - packages/web/src/lib/buildTimelineSql.ts
    - packages/web/src/lib/buildTimelineSql.spec.ts
    - packages/web/src/lib/buildNumericLineSql.ts
    - packages/web/src/lib/buildNumericLineSql.spec.ts
    - packages/web/src/lib/buildCalendarSql.ts
    - packages/web/src/lib/buildCalendarSql.spec.ts

key-decisions:
  - "andCustomWhere returns leading-space string ' AND (...)' so it slots in before the trailing space preceding GROUP BY — no extra whitespace management needed at call sites"
  - "customWhere injected AFTER grouped AND IS NOT NULL${inClause} so grouped + customWhere cases append last before GROUP BY"
  - "whereCustomWhere exported now (unused in 98-01) to be consumed by aggregated-widget paths in 98-02"

patterns-established:
  - "Phase 98 SQL injection: compute cw = andCustomWhere(customWhere) once at top of builder body; splice ${cw} inline into the string template"

requirements-completed: [VIZSQL-V119-02, VIZSQL-V119-03]

# Metrics
duration: 5min
completed: 2026-06-30
---

# Phase 98 Plan 01: SQL Builder customWhere Foundation Summary

**Shared andCustomWhere/whereCustomWhere pure helpers + customWhere arg threaded into buildTimelineSql, buildNumericLineSql, and buildCalendarSql — parenthesized injection with byte-identical empty/absent fallback locked by 52 passing tests**

## Performance

- **Duration:** 5 min
- **Started:** 2026-06-30T20:48:27Z
- **Completed:** 2026-06-30T20:53:01Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Created `customWhere.ts` pure helper (zero framework imports) exporting `andCustomWhere` and `whereCustomWhere` with mandatory parenthesization and trim-based empty guard
- Threaded optional `customWhere?: string` into all three own-SQL builders via `andCustomWhere`; spliced after the IS NOT NULL clause and before GROUP BY in both ungrouped and grouped paths
- 52 tests green: 12 new customWhere.spec tests + 40 builder tests (5 new per file + 35 pre-existing unchanged)

## Task Commits

1. **Task 1: Shared customWhere splice helper (pure)** - `3beb8bb` (feat)
2. **Task 2: Thread customWhere into the 3 own-SQL builders** - `42fa9b6` (feat)

**Plan metadata:** (docs commit follows)

_Note: TDD tasks — tests written RED first, then implementation GREEN_

## Files Created/Modified
- `packages/web/src/lib/customWhere.ts` - andCustomWhere + whereCustomWhere pure helpers; single parenthesization source of truth
- `packages/web/src/lib/customWhere.spec.ts` - 12 tests: non-empty, undefined, empty, whitespace, leading/trailing trim, OR predicate cases for both functions
- `packages/web/src/lib/buildTimelineSql.ts` - customWhere?: string field + andCustomWhere import + cw splice on both paths
- `packages/web/src/lib/buildTimelineSql.spec.ts` - 3 new Phase 98 tests: absent regression lock + ungrouped + grouped cases
- `packages/web/src/lib/buildNumericLineSql.ts` - same pattern as timeline
- `packages/web/src/lib/buildNumericLineSql.spec.ts` - 3 new Phase 98 tests
- `packages/web/src/lib/buildCalendarSql.ts` - same pattern, single emit path
- `packages/web/src/lib/buildCalendarSql.spec.ts` - 2 new Phase 98 tests (no grouped path in calendar)

## Decisions Made
- `andCustomWhere` returns a leading-space string (` AND (...)`) so the call site `IS NOT NULL${cw} GROUP BY` works without any extra space juggling — the trailing space before GROUP BY stays in the string literal, and cw is either `""` (byte-identical) or ` AND (...)` with its own leading space
- `customWhere` injection position in grouped path: after `AND ${groupByColumn} IS NOT NULL${inClause}${cw}` — appended LAST, before GROUP BY, so per-plan spec
- Exported `whereCustomWhere` now for use in plan 98-02 (aggregated widgets have no existing WHERE)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `customWhere.ts` is the single parenthesization source of truth; plans 98-02 and 98-03 import from it
- All three own-SQL builders accept `customWhere?` and pass the backward-compat test suite unchanged
- Plan 98-02 can proceed immediately to thread `customWhere` through the aggregated widget path (ChartConfigPanel SQL + fromSwap read path) and the records table renderer

## Self-Check: PASSED

All created files confirmed on disk. Both task commits verified in git log.

---
*Phase: 98-per-visualization-custom-where-clause*
*Completed: 2026-06-30*
