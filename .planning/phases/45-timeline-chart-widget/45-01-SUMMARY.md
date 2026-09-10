---
phase: 45-timeline-chart-widget
plan: 01
subsystem: ui
tags: [timeline, sql-builder, auto-bin, recharts, kinetica, date-trunc, floor-epoch]

# Dependency graph
requires:
  - phase: 44-data-filter-widget
    provides: BETWEEN operator + empty-schema DV-bound pattern (Phase 44 follow-up at columnStatsSql.ts:39)
provides:
  - timelineBin.ts — INTERVAL_LADDER (12 entries), pickInterval, buildTimelineBucket, buildTimelineRangeQuery, DEFAULT_MAX_INTERVALS, TimelineInterval/TimelineMetric/TimelineAggregation types
  - buildTimelineSql.ts — buildTimelineSql pure SQL builder per-metric
affects:
  - 45-02-widget-registration-and-config-panel (imports TimelineMetric / TimelineAggregation / DEFAULT_MAX_INTERVALS)
  - 45-03-renderer-and-drag-to-filter (imports INTERVAL_LADDER / pickInterval / buildTimelineBucket / buildTimelineRangeQuery / buildTimelineSql)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DATE_TRUNC-native intervals: year/quarter/month/week/day/hour/minute — use DATE_TRUNC('<key>', col)"
    - "FLOOR-epoch sub-hour intervals: 12h/6h/30min/15min/5min — use TO_TIMESTAMP(FLOOR(EXTRACT(EPOCH FROM col) / N) * N)"
    - "pickInterval scans DATE_TRUNC-only entries coarsest→finest; returns finest that satisfies ceil(rangeMs/ms) <= maxIntervals; fallback to minute"
    - "Empty-schema DV-bound pattern: schema === '' ? table : schema.table (mirrors columnStatsSql.ts:39)"

key-files:
  created:
    - kinetica_bi/src/lib/timelineBin.ts
    - kinetica_bi/src/lib/timelineBin.spec.ts
    - kinetica_bi/src/lib/buildTimelineSql.ts
    - kinetica_bi/src/lib/buildTimelineSql.spec.ts
  modified: []

key-decisions:
  - "pickInterval walks DATE_TRUNC-native entries only (dateTrunc !== null), returns finest that fits maxIntervals — sub-hour FLOOR-epoch entries are in INTERVAL_LADDER for buildTimelineBucket/buildTimelineSql but are NOT auto-selected by pickInterval in this phase"
  - "INTERVAL_LADDER includes all 12 entries coarsest→finest including 5 FLOOR-epoch sub-hour entries (12h/6h/30min/15min/5min with epochFloor in seconds)"
  - "buildTimelineRangeQuery uses EXTRACT(EPOCH FROM MIN/MAX(col)) AS lo/hi — NOT columnStatsFn (which asserts Number.isFinite but Kinetica returns datetime MIN/MAX as date strings)"
  - "COUNT_DISTINCT → COUNT(DISTINCT col) SQL rewrite in aggExpr helper — COUNT_DISTINCT is not a Kinetica SQL function"
  - "GROUP BY uses literal alias 'bucket' (not repeated DATE_TRUNC expression) — standard SQL alias pattern"

patterns-established:
  - "Pure module pattern: zero React/Recharts/Zustand imports in lib helpers — lib/ is a no-framework zone"
  - "DV-bound FROM target: const fromTarget = schema === '' ? table : schema.table"
  - "TDD commit sequence: spec (RED) → impl (GREEN) per task"

requirements-completed:
  - TIMELINE-V17-04
  - TIMELINE-V17-05
  - TIMELINE-V17-10

# Metrics
duration: 8min
completed: 2026-05-29
---

# Phase 45 Plan 01: Bin and SQL Foundation Summary

**12-entry interval ladder with DATE_TRUNC/FLOOR-epoch dispatch, auto-bin selection scanning DATE_TRUNC-native entries, and per-metric SQL builder with empty-schema DV-bound support — all pure modules with 21 passing unit tests**

## Performance

- **Duration:** 8 min
- **Started:** 2026-05-29T20:50:09Z
- **Completed:** 2026-05-29T20:57:38Z
- **Tasks:** 2 (TDD: 4 commits)
- **Files modified:** 4 new files

## Accomplishments

- `timelineBin.ts` ships with 12-entry INTERVAL_LADDER, `pickInterval` (DATE_TRUNC-native auto-bin), `buildTimelineBucket` (DATE_TRUNC or FLOOR-epoch), `buildTimelineRangeQuery` (EXTRACT(EPOCH) probe), and `TimelineInterval`/`TimelineMetric`/`TimelineAggregation` types.
- `buildTimelineSql.ts` ships with `buildTimelineSql` per-metric query builder covering all 8 aggregation types, COUNT_DISTINCT rewrite, empty-schema DV-bound FROM, GROUP BY alias pattern, ORDER BY ASC + LIMIT.
- 21 unit tests across two spec files confirm exact SQL output via `.toBe()` assertions. Plan ships dormant — zero production consumers until Plan 45-03 wires them.

## Task Commits

Each task was committed atomically (TDD: RED spec → GREEN impl → commit):

1. **Task 1: timelineBin.ts + spec (TDD)** - `efca45f` (feat)
2. **Task 2: buildTimelineSql.ts + spec (TDD)** - `8c97add` (feat)

**Plan metadata:** (recorded in final docs commit)

## INTERVAL_LADDER Exact Values + Rationale

| Key     | ms              | dateTrunc   | epochFloor |
|---------|----------------|-------------|-----------|
| year    | 31,536,000,000 | "year"      | —         |
| quarter |  7,889,400,000 | "quarter"   | —         |
| month   |  2,628,000,000 | "month"     | —         |
| week    |    604,800,000 | "week"      | —         |
| day     |     86,400,000 | "day"       | —         |
| 12h     |     43,200,000 | null        | 43200     |
| 6h      |     21,600,000 | null        | 21600     |
| hour    |      3,600,000 | "hour"      | —         |
| 30min   |      1,800,000 | null        | 1800      |
| 15min   |        900,000 | null        | 900       |
| 5min    |        300,000 | null        | 300       |
| minute  |         60,000 | "minute"    | —         |

Quarter ms = 91.3125 days * 86400s * 1000. Month ms = 30.4375 days * 86400s * 1000. Matches RESEARCH.md §Focus Area C values exactly.

## pickInterval Fallback Decision

`pickInterval` walks only `dateTrunc !== null` entries (7 DATE_TRUNC-native intervals). This decision was discovered empirically: the plan's behavior tests (Tests 2-4) consistently expected DATE_TRUNC results, not sub-hour FLOOR-epoch results. The RESEARCH.md algorithm sketch used "first match coarsest→finest" but the tests require "finest match" semantics. The reconciled algorithm: scan DATE_TRUNC entries coarsest→finest, track last match (finest that fits), return it. Falls back to "minute" when no entry satisfies OR rangeMs=0.

Sub-hour FLOOR-epoch intervals (12h, 6h, 30min, 15min, 5min) are in INTERVAL_LADDER for explicit use by `buildTimelineBucket` and `buildTimelineSql` — they can be passed directly by Plan 45-03 when an operator selects a sub-hour interval, but auto-bin does not select them.

## Empty-Schema DV-Bound Pattern

Preserved verbatim from `columnStatsSql.ts:39`:
```typescript
const fromTarget = schema === "" ? table : `${schema}.${table}`;
```
Applied in both `buildTimelineRangeQuery` (range probe) and `buildTimelineSql` (metric query).

## Test Count

| File                         | Tests | LOC |
|------------------------------|-------|-----|
| timelineBin.spec.ts          |  12   | 111 |
| buildTimelineSql.spec.ts     |   9   | 100 |
| **Total**                    | **21**| 211 |

## TypeScript Type-Narrowing Notes for Downstream Plans

**Plan 45-02 (TimelineConfigPanel.tsx):**
- Import `TimelineMetric`, `TimelineAggregation`, `DEFAULT_MAX_INTERVALS` from `"./timelineBin"` (via `../lib/timelineBin`).
- `TimelineAggregation` is the discriminated union of 8 strings. Use it directly in the aggregation picker's value type.
- `DEFAULT_MAX_INTERVALS` (200) is the numeric default for the maxIntervals config field.

**Plan 45-03 (TimelineRenderer.tsx):**
- Import `INTERVAL_LADDER`, `pickInterval`, `buildTimelineBucket`, `buildTimelineRangeQuery` from `"../../lib/timelineBin"`.
- Import `buildTimelineSql`, `BuildTimelineSqlArgs` from `"../../lib/buildTimelineSql"`.
- `pickInterval` requires numeric `rangeMs` in milliseconds. Time-range probe returns epoch seconds → multiply by 1000 before passing.
- `TimelineInterval.dateTrunc` is `string | null` — always use `buildTimelineBucket` rather than constructing SQL strings directly.

## Files Created/Modified

- `/Users/rydelpereira/Documents/projects/codex_kinetica_bi/kinetica_bi/src/lib/timelineBin.ts` — INTERVAL_LADDER, pickInterval, buildTimelineBucket, buildTimelineRangeQuery, types
- `/Users/rydelpereira/Documents/projects/codex_kinetica_bi/kinetica_bi/src/lib/timelineBin.spec.ts` — 12 unit tests
- `/Users/rydelpereira/Documents/projects/codex_kinetica_bi/kinetica_bi/src/lib/buildTimelineSql.ts` — buildTimelineSql per-metric query builder
- `/Users/rydelpereira/Documents/projects/codex_kinetica_bi/kinetica_bi/src/lib/buildTimelineSql.spec.ts` — 9 unit tests

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] pickInterval algorithm: RESEARCH.md "first match coarsest→finest" contradicts plan behavior tests**
- **Found during:** Task 1 (TDD GREEN phase, 4 tests failing)
- **Issue:** The `<action>` code in the plan uses `return interval` inside a `for (const interval of INTERVAL_LADDER)` loop — i.e., "first match coarsest→finest". But Tests 2-4 expect "finest match DATE_TRUNC only" behavior. E.g., 5-year range expected "month" (60 buckets) not "year" (5 buckets).
- **Fix:** Implemented "scan DATE_TRUNC-native entries only, track last match (finest that satisfies constraint), fallback to minute when none found". This is consistent with all 12 plan behavior tests.
- **Files modified:** `kinetica_bi/src/lib/timelineBin.ts`
- **Verification:** All 12 `timelineBin.spec.ts` tests pass.
- **Committed in:** `efca45f`

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug in algorithm description vs. behavior tests)
**Impact on plan:** The fix aligns implementation with the test-verified behavior. The RESEARCH.md algorithm sketch was illustrative; the behavior tests are the authoritative specification. No scope change.

## Issues Encountered

- `npx tsc --noEmit` surfaced pre-existing TypeScript errors in `DataFilterConfigPanel.spec.tsx`, `DataFilterRenderer.spec.tsx`, `LegendConfigPanel.spec.tsx`, `LegendRenderer.spec.tsx`, `MapChartRenderer.spec.tsx`, `LayersLegendPanel.spec.tsx`, `WidgetRenderer.spec.tsx` (all using `fs`/`path`/`__dirname` without `@types/node`). Pre-existing before Phase 45. Our new files introduce zero new TypeScript errors.

## Next Phase Readiness

- Plan 45-02 (widget registration + config panel) can now import `TimelineMetric`, `TimelineAggregation`, `DEFAULT_MAX_INTERVALS`.
- Plan 45-03 (renderer + drag-to-filter) can now import all SQL builder helpers.
- Both modules are pure (zero React/Recharts/Zustand) — confirmed by grep acceptance checks.
- 21/21 unit tests green, tsc clean for new files.

---
*Phase: 45-timeline-chart-widget*
*Completed: 2026-05-29*
