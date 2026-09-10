---
phase: 45-timeline-chart-widget
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - kinetica_bi/src/lib/timelineBin.ts
  - kinetica_bi/src/lib/timelineBin.spec.ts
  - kinetica_bi/src/lib/buildTimelineSql.ts
  - kinetica_bi/src/lib/buildTimelineSql.spec.ts
autonomous: true
requirements:
  - TIMELINE-V17-04
  - TIMELINE-V17-05
  - TIMELINE-V17-10
must_haves:
  truths:
    - "Auto-bin algorithm picks the coarsest interval that satisfies ceil(rangeMs / intervalMs) <= maxIntervals"
    - "SQL builder emits DATE_TRUNC for native intervals (year/quarter/month/week/day/hour/minute)"
    - "SQL builder emits TO_TIMESTAMP(FLOOR(EXTRACT(EPOCH FROM col) / N) * N) for sub-hour multi-minute intervals (5min/15min/30min/6h/12h)"
    - "Time-range query builder honors empty-schema (DV-bound) FROM emission (FROM <table> with no schema prefix)"
    - "Pure helper modules — zero React/Recharts/Zustand imports"
  artifacts:
    - path: "kinetica_bi/src/lib/timelineBin.ts"
      provides: "INTERVAL_LADDER constant + pickInterval + buildTimelineBucket + buildTimelineRangeQuery + TimelineInterval / TimelineMetric / TimelineAggregation exported types"
      exports: ["INTERVAL_LADDER", "pickInterval", "buildTimelineBucket", "buildTimelineRangeQuery", "TimelineInterval", "TimelineMetric", "TimelineAggregation", "DEFAULT_MAX_INTERVALS"]
    - path: "kinetica_bi/src/lib/timelineBin.spec.ts"
      provides: "pickInterval ladder coverage + range-query SQL shape assertions"
    - path: "kinetica_bi/src/lib/buildTimelineSql.ts"
      provides: "buildTimelineSql pure SQL builder per-metric"
      exports: ["buildTimelineSql"]
    - path: "kinetica_bi/src/lib/buildTimelineSql.spec.ts"
      provides: "SQL builder unit specs covering DATE_TRUNC and FLOOR-epoch paths + empty-schema DV emission"
  key_links:
    - from: "kinetica_bi/src/lib/buildTimelineSql.ts"
      to: "kinetica_bi/src/lib/timelineBin.ts"
      via: "import type { TimelineInterval, TimelineMetric, TimelineAggregation }"
      pattern: "from \"\\./timelineBin\""
---

<objective>
Ship the pure-function foundation for the Timeline Chart widget:
  1. Interval ladder + auto-bin selection algorithm.
  2. Time-range probe SQL builder (EXTRACT(EPOCH FROM MIN/MAX) — NOT columnStatsFn).
  3. Per-metric DATE_TRUNC / FLOOR-epoch SQL builder.

Purpose: Plans 45-02 (config panel) imports the type definitions; Plan 45-03 (renderer) imports the SQL builders. Foundation must land first because the type exports are consumed by both downstream plans.

Output: Two pure-module files + their unit specs. Zero React, zero Recharts, zero Zustand imports. Plan ships dormant — no production consumer until Plan 45-03 calls runSql with the builder output.
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/45-timeline-chart-widget/45-CONTEXT.md
@.planning/phases/45-timeline-chart-widget/45-RESEARCH.md

<!-- Source-of-truth files the executor MUST read before touching anything -->
@kinetica_bi/src/lib/columnTypes.ts
@kinetica_bi/server/src/lib/columnStatsSql.ts

<interfaces>
<!-- These types are CREATED by Plan 45-01 and consumed by 45-02 + 45-03. -->
<!-- Define exactly as shown so downstream plans need no re-discovery. -->

From `kinetica_bi/src/lib/timelineBin.ts` (CREATE):
```typescript
export type TimelineAggregation =
  | "SUM" | "AVG" | "MIN" | "MAX"
  | "COUNT" | "COUNT_DISTINCT"
  | "STDDEV" | "VARIANCE";

export type TimelineMetric = {
  column: string;          // numeric column from base table
  aggregation: TimelineAggregation;
  color: string;           // 8-char AARRGGBB hex (from themeColorsFor or operator-chosen)
  label?: string;          // operator-supplied display name
};

export type TimelineInterval = {
  key: "year" | "quarter" | "month" | "week" | "day"
     | "12h" | "6h" | "hour" | "30min" | "15min" | "5min" | "minute";
  ms: number;              // approximate ms-per-bucket (used for ceil(rangeMs / ms) <= maxIntervals)
  dateTrunc: string | null;          // non-null → DATE_TRUNC SQL; null → FLOOR-epoch path
  epochFloor?: number;     // seconds; required when dateTrunc is null
};

export const DEFAULT_MAX_INTERVALS: number; // 200

export const INTERVAL_LADDER: ReadonlyArray<TimelineInterval>; // coarsest → finest

export function pickInterval(
  args: { rangeMs: number; maxIntervals: number }
): TimelineInterval;

export function buildTimelineBucket(
  timeCol: string,
  interval: TimelineInterval,
): string;

export function buildTimelineRangeQuery(
  args: { schema: string; table: string; timeCol: string }
): string;
```

From `kinetica_bi/src/lib/buildTimelineSql.ts` (CREATE):
```typescript
import type { TimelineInterval, TimelineMetric } from "./timelineBin";

export type BuildTimelineSqlArgs = {
  schema: string;            // empty string for DV-bound (viewName-as-table); see Phase 44 follow-up
  table: string;
  timeCol: string;
  metric: TimelineMetric;
  interval: TimelineInterval;
  maxIntervals: number;      // serves as LIMIT
};

export function buildTimelineSql(args: BuildTimelineSqlArgs): string;
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: timelineBin.ts — interval ladder, pickInterval, buildTimelineBucket, buildTimelineRangeQuery + spec</name>
  <files>kinetica_bi/src/lib/timelineBin.ts, kinetica_bi/src/lib/timelineBin.spec.ts</files>
  <read_first>
    - .planning/phases/45-timeline-chart-widget/45-CONTEXT.md (decisions §Auto-bin selection, §SQL strategy, §Post-research decisions 2026-05-29)
    - .planning/phases/45-timeline-chart-widget/45-RESEARCH.md §Focus Area C (Auto-Bin Algorithm) + §Focus Area D (Time-Range Fetch CRITICAL GOTCHA C-01)
    - kinetica_bi/server/src/lib/columnStatsSql.ts (line 39 empty-schema pattern: `schema === "" ? table : `${schema}.${table}``)
    - kinetica_bi/src/lib/columnTypes.ts (existing pure-module pattern + spec layout to mirror)
  </read_first>
  <behavior>
    - Test 1: INTERVAL_LADDER exports 12 entries in coarsest→finest order: year, quarter, month, week, day, 12h, 6h, hour, 30min, 15min, 5min, minute.
    - Test 2: pickInterval({ rangeMs: 5 * 365 * 86400 * 1000, maxIntervals: 200 }) → key "month" (5 years / month = 60 buckets ≤ 200).
    - Test 3: pickInterval({ rangeMs: 86400 * 1000, maxIntervals: 200 }) → key "hour" (24 buckets ≤ 200; "day" only yields 1 bucket but coarsest valid is hour given the ladder walk).
    - Test 4: pickInterval({ rangeMs: 3600 * 1000, maxIntervals: 200 }) → key "minute" (60 buckets ≤ 200).
    - Test 5: pickInterval({ rangeMs: 0, maxIntervals: 200 }) → key "minute" (degenerate range — finest fallback).
    - Test 6: pickInterval({ rangeMs: 100 * 365 * 86400 * 1000, maxIntervals: 50 }) → key "year" (100 years / year = 100 buckets > 50; falls through to finest "minute" since no ladder entry fits, but coarsest "year" might fit at higher maxIntervals — verify the "fallback to finest" branch fires when nothing satisfies ceil(rangeMs/intervalMs) ≤ maxIntervals).
    - Test 7: INTERVAL_LADDER entries for year/quarter/month/week/day/hour/minute have dateTrunc set; 12h/6h/30min/15min/5min have dateTrunc=null + epochFloor set in seconds (43200/21600/1800/900/300).
    - Test 8: buildTimelineBucket("pickup_time", year-entry) === "DATE_TRUNC('year', pickup_time)".
    - Test 9: buildTimelineBucket("pickup_time", thirty-min-entry) === "TO_TIMESTAMP(FLOOR(EXTRACT(EPOCH FROM pickup_time) / 1800) * 1800)".
    - Test 10: buildTimelineRangeQuery({ schema: "demo", table: "nyctaxi", timeCol: "pickup_time" }) emits `SELECT EXTRACT(EPOCH FROM MIN(pickup_time)) AS lo, EXTRACT(EPOCH FROM MAX(pickup_time)) AS hi FROM demo.nyctaxi WHERE pickup_time IS NOT NULL`.
    - Test 11: buildTimelineRangeQuery({ schema: "", table: "_kbi_dv_v1234", timeCol: "ts" }) emits unprefixed FROM: `... FROM _kbi_dv_v1234 WHERE ts IS NOT NULL` (DV-bound empty-schema; Phase 44 follow-up pattern).
    - Test 12: DEFAULT_MAX_INTERVALS exported === 200.
  </behavior>
  <action>
Create `kinetica_bi/src/lib/timelineBin.ts` exporting:

```typescript
/**
 * Phase 45 Plan 01 (TIMELINE-V17-04, TIMELINE-V17-10): pure auto-bin helpers.
 *
 * Zero React/Recharts/Zustand imports. Consumed by:
 *   - Plan 45-02 TimelineConfigPanel.tsx (TimelineMetric/TimelineAggregation types + DEFAULT_MAX_INTERVALS)
 *   - Plan 45-03 TimelineRenderer.tsx (pickInterval + buildTimelineBucket + buildTimelineRangeQuery)
 *
 * CRITICAL GOTCHA (RESEARCH.md §C-01): columnStatsFn cannot be used for datetime
 * time-range fetch — its parser asserts Number.isFinite(v) but Kinetica returns
 * MIN/MAX as date strings for datetime columns. Use buildTimelineRangeQuery's
 * EXTRACT(EPOCH FROM ...) SQL via runSql instead.
 */

export type TimelineAggregation =
  | "SUM" | "AVG" | "MIN" | "MAX"
  | "COUNT" | "COUNT_DISTINCT"
  | "STDDEV" | "VARIANCE";

export type TimelineMetric = {
  column: string;
  aggregation: TimelineAggregation;
  color: string;       // 8-char AARRGGBB (e.g. "FF66C2A5")
  label?: string;
};

export type TimelineInterval = {
  key:
    | "year" | "quarter" | "month" | "week" | "day"
    | "12h" | "6h" | "hour" | "30min" | "15min" | "5min" | "minute";
  ms: number;
  dateTrunc: string | null;
  epochFloor?: number;
};

export const DEFAULT_MAX_INTERVALS = 200;

// Coarsest → finest. Walk in array order; return first interval where
// ceil(rangeMs / intervalMs) ≤ maxIntervals.
export const INTERVAL_LADDER: readonly TimelineInterval[] = [
  { key: "year",    ms: 31_536_000_000, dateTrunc: "year"    },
  { key: "quarter", ms:  7_889_400_000, dateTrunc: "quarter" },
  { key: "month",   ms:  2_628_000_000, dateTrunc: "month"   },
  { key: "week",    ms:    604_800_000, dateTrunc: "week"    },
  { key: "day",     ms:     86_400_000, dateTrunc: "day"     },
  { key: "12h",     ms:     43_200_000, dateTrunc: null, epochFloor: 43_200 },
  { key: "6h",      ms:     21_600_000, dateTrunc: null, epochFloor: 21_600 },
  { key: "hour",    ms:      3_600_000, dateTrunc: "hour"    },
  { key: "30min",   ms:      1_800_000, dateTrunc: null, epochFloor: 1_800  },
  { key: "15min",   ms:        900_000, dateTrunc: null, epochFloor:   900  },
  { key: "5min",    ms:        300_000, dateTrunc: null, epochFloor:   300  },
  { key: "minute",  ms:         60_000, dateTrunc: "minute"  },
] as const;

export function pickInterval(args: { rangeMs: number; maxIntervals: number }): TimelineInterval {
  const { rangeMs, maxIntervals } = args;
  for (const interval of INTERVAL_LADDER) {
    if (Math.ceil(rangeMs / interval.ms) <= maxIntervals) return interval;
  }
  // No ladder entry satisfies — fall through to finest (minute).
  return INTERVAL_LADDER[INTERVAL_LADDER.length - 1];
}

export function buildTimelineBucket(timeCol: string, interval: TimelineInterval): string {
  if (interval.dateTrunc) {
    return `DATE_TRUNC('${interval.dateTrunc}', ${timeCol})`;
  }
  // FLOOR-epoch fallback for sub-hour multi-minute intervals.
  // Locked in CONTEXT.md §Post-research decisions 2026-05-29.
  const epochSec = interval.epochFloor!;
  return `TO_TIMESTAMP(FLOOR(EXTRACT(EPOCH FROM ${timeCol}) / ${epochSec}) * ${epochSec})`;
}

export function buildTimelineRangeQuery(args: {
  schema: string;
  table: string;
  timeCol: string;
}): string {
  const { schema, table, timeCol } = args;
  // Empty-schema (DV-bound) → unprefixed FROM. Mirrors Phase 44 follow-up pattern.
  // Reference: kinetica_bi/server/src/lib/columnStatsSql.ts line 39.
  const fromTarget = schema === "" ? table : `${schema}.${table}`;
  return (
    `SELECT EXTRACT(EPOCH FROM MIN(${timeCol})) AS lo, ` +
    `EXTRACT(EPOCH FROM MAX(${timeCol})) AS hi ` +
    `FROM ${fromTarget} ` +
    `WHERE ${timeCol} IS NOT NULL`
  );
}
```

Then create `kinetica_bi/src/lib/timelineBin.spec.ts` covering Tests 1-12 above. Use `import { describe, it, expect } from "vitest"` and structure mirroring `kinetica_bi/src/lib/columnTypes.spec.ts` if present, otherwise a single top-level `describe("timelineBin", () => { ... })` block.

Use exact string equality (`.toBe(...)`) for SQL output assertions — partial matches mask whitespace bugs.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/lib/timelineBin.spec.ts</automated>
  </verify>
  <acceptance_criteria>
    - `test -f kinetica_bi/src/lib/timelineBin.ts && test -f kinetica_bi/src/lib/timelineBin.spec.ts` (both files exist)
    - `grep -c "export const INTERVAL_LADDER" kinetica_bi/src/lib/timelineBin.ts` returns 1
    - `grep -c "export function pickInterval" kinetica_bi/src/lib/timelineBin.ts` returns 1
    - `grep -c "export function buildTimelineBucket" kinetica_bi/src/lib/timelineBin.ts` returns 1
    - `grep -c "export function buildTimelineRangeQuery" kinetica_bi/src/lib/timelineBin.ts` returns 1
    - `grep -c "FLOOR(EXTRACT(EPOCH FROM" kinetica_bi/src/lib/timelineBin.ts` returns at least 1 (FLOOR-epoch fallback present)
    - `grep -c "DATE_TRUNC" kinetica_bi/src/lib/timelineBin.ts` returns at least 1
    - `grep -cE "^(import .* from \"react|import .* from \"recharts|import .* from \"zustand)" kinetica_bi/src/lib/timelineBin.ts` returns 0 (pure module — zero React/Recharts/Zustand imports)
    - `cd kinetica_bi && npx vitest run src/lib/timelineBin.spec.ts` exits 0 with at least 12 tests passing
  </acceptance_criteria>
  <done>
    timelineBin.ts exports INTERVAL_LADDER (12 entries, coarsest→finest), pickInterval, buildTimelineBucket, buildTimelineRangeQuery, DEFAULT_MAX_INTERVALS, plus TimelineMetric/TimelineAggregation/TimelineInterval types. Spec passes 12 tests covering ladder selection across multiple range/maxIntervals combos, DATE_TRUNC vs FLOOR-epoch bucket emission, and empty-schema vs prefixed FROM in the range query.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: buildTimelineSql.ts — per-metric DATE_TRUNC/FLOOR-epoch SQL builder + spec</name>
  <files>kinetica_bi/src/lib/buildTimelineSql.ts, kinetica_bi/src/lib/buildTimelineSql.spec.ts</files>
  <read_first>
    - kinetica_bi/src/lib/timelineBin.ts (TimelineInterval, TimelineMetric, TimelineAggregation — created in Task 1)
    - .planning/phases/45-timeline-chart-widget/45-RESEARCH.md §Focus Area C (SQL Builder Skeleton)
    - .planning/phases/45-timeline-chart-widget/45-CONTEXT.md §SQL strategy + §Post-research decisions 2026-05-29
    - kinetica_bi/server/src/lib/columnStatsSql.ts (empty-schema pattern reference at line 39)
  </read_first>
  <behavior>
    - Test 1: buildTimelineSql({ schema: "demo", table: "nyctaxi", timeCol: "pickup_time", metric: { column: "fare_amount", aggregation: "SUM", color: "FF66C2A5" }, interval: INTERVAL_LADDER.find(i=>i.key==="hour")!, maxIntervals: 200 }) emits exactly:
      `SELECT DATE_TRUNC('hour', pickup_time) AS bucket, SUM(fare_amount) AS value FROM demo.nyctaxi WHERE pickup_time IS NOT NULL GROUP BY bucket ORDER BY bucket ASC LIMIT 200`
    - Test 2: aggregation "COUNT_DISTINCT" emits `COUNT(DISTINCT col) AS value` (not `COUNT_DISTINCT(col)`).
    - Test 3: aggregation "COUNT" with column "*" emits `COUNT(*)` — and with a real column emits `COUNT(col)`.
    - Test 4: interval "30min" emits FLOOR-epoch bucket: `SELECT TO_TIMESTAMP(FLOOR(EXTRACT(EPOCH FROM pickup_time) / 1800) * 1800) AS bucket, ...`.
    - Test 5: empty-schema (DV-bound) emits unprefixed FROM: schema="" + table="_kbi_dv_v1234" → `... FROM _kbi_dv_v1234 WHERE ...` (no leading dot, no schema prefix).
    - Test 6: WHERE always includes `${timeCol} IS NOT NULL`.
    - Test 7: ORDER BY bucket ASC + LIMIT clause present in all output.
    - Test 8: GROUP BY uses the literal alias `bucket` (not the full DATE_TRUNC expression) — matches Recharts merge expectations downstream.
  </behavior>
  <action>
Create `kinetica_bi/src/lib/buildTimelineSql.ts`:

```typescript
/**
 * Phase 45 Plan 01 (TIMELINE-V17-05): pure SQL builder for one timeline metric.
 *
 * Plan 45-03 TimelineRenderer issues N parallel runSql() calls (one per metric)
 * and merges the result arrays on the `bucket` column.
 *
 * Empty-schema (schema === "") → unprefixed FROM target. Required for DV-bound
 * widgets (Phase 44 follow-up; mirrors columnStatsSql.ts:39 pattern).
 */

import type { TimelineInterval, TimelineMetric } from "./timelineBin";
import { buildTimelineBucket } from "./timelineBin";

export type BuildTimelineSqlArgs = {
  schema: string;
  table: string;
  timeCol: string;
  metric: TimelineMetric;
  interval: TimelineInterval;
  maxIntervals: number;
};

function aggExpr(metric: TimelineMetric): string {
  if (metric.aggregation === "COUNT_DISTINCT") return `COUNT(DISTINCT ${metric.column})`;
  return `${metric.aggregation}(${metric.column})`;
}

export function buildTimelineSql(args: BuildTimelineSqlArgs): string {
  const { schema, table, timeCol, metric, interval, maxIntervals } = args;
  const fromTarget = schema === "" ? table : `${schema}.${table}`;
  const bucket = buildTimelineBucket(timeCol, interval);
  const agg = aggExpr(metric);
  return (
    `SELECT ${bucket} AS bucket, ${agg} AS value ` +
    `FROM ${fromTarget} ` +
    `WHERE ${timeCol} IS NOT NULL ` +
    `GROUP BY bucket ` +
    `ORDER BY bucket ASC ` +
    `LIMIT ${maxIntervals}`
  );
}
```

Then create `kinetica_bi/src/lib/buildTimelineSql.spec.ts` covering Tests 1-8. Use exact `.toBe(...)` SQL assertions. Import `INTERVAL_LADDER` from `./timelineBin` to look up real interval entries (do not hard-code mock TimelineInterval objects — the test must exercise the real ladder).
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/lib/buildTimelineSql.spec.ts</automated>
  </verify>
  <acceptance_criteria>
    - `test -f kinetica_bi/src/lib/buildTimelineSql.ts && test -f kinetica_bi/src/lib/buildTimelineSql.spec.ts`
    - `grep -c "export function buildTimelineSql" kinetica_bi/src/lib/buildTimelineSql.ts` returns 1
    - `grep -c "from \"./timelineBin\"" kinetica_bi/src/lib/buildTimelineSql.ts` returns at least 1 (imports from Task 1's module)
    - `grep -c "COUNT(DISTINCT" kinetica_bi/src/lib/buildTimelineSql.ts` returns 1 (COUNT_DISTINCT branch)
    - `grep -cE "^(import .* from \"react|import .* from \"recharts|import .* from \"zustand)" kinetica_bi/src/lib/buildTimelineSql.ts` returns 0 (pure module)
    - `cd kinetica_bi && npx vitest run src/lib/buildTimelineSql.spec.ts` exits 0 with at least 8 tests passing
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>
    buildTimelineSql.ts ships with the per-metric SQL builder. Spec covers fixed-interval DATE_TRUNC, sub-hour FLOOR-epoch, empty-schema vs prefixed FROM, COUNT_DISTINCT aggregation, WHERE/GROUP BY/ORDER BY/LIMIT correctness. Plan 45-01 ready for Plan 45-02 and Plan 45-03 to import.
  </done>
</task>

</tasks>

<verification>
- `cd kinetica_bi && npx vitest run src/lib/timelineBin.spec.ts src/lib/buildTimelineSql.spec.ts` exits 0
- `cd kinetica_bi && npx tsc --noEmit` exits 0
- `grep -rc "from \"\\./timelineBin\"\\|from \"\\./buildTimelineSql\"" kinetica_bi/src` returns at least 2 (self-references in the spec files) and at most 4 (until 45-02/45-03 land — plan ships dormant)
- Plan 45-01 introduces ZERO production consumers; downstream plans wire them.
</verification>

<success_criteria>
- INTERVAL_LADDER constant exports 12 entries in coarsest→finest order with correct ms / dateTrunc / epochFloor values.
- `pickInterval({ rangeMs, maxIntervals })` returns the coarsest ladder entry satisfying ceil(rangeMs/intervalMs) ≤ maxIntervals; falls through to "minute" when nothing fits.
- `buildTimelineBucket` emits DATE_TRUNC for 7 native intervals (year/quarter/month/week/day/hour/minute) and FLOOR-epoch for 5 sub-hour intervals (12h/6h/30min/15min/5min).
- `buildTimelineRangeQuery` emits `SELECT EXTRACT(EPOCH FROM MIN(col)) AS lo, EXTRACT(EPOCH FROM MAX(col)) AS hi FROM <target> WHERE col IS NOT NULL` and honors empty-schema (DV-bound) → unprefixed FROM.
- `buildTimelineSql` emits per-metric DATE_TRUNC/FLOOR-epoch SELECT with GROUP BY bucket / ORDER BY bucket ASC / LIMIT maxIntervals; supports all 8 TimelineAggregation values; COUNT_DISTINCT branch correct.
- Both modules are pure (zero React/Recharts/Zustand imports).
- 20+ unit tests across both spec files pass; tsc --noEmit clean.
</success_criteria>

<output>
After completion, create `.planning/phases/45-timeline-chart-widget/45-01-SUMMARY.md` recording:
- INTERVAL_LADDER exact values + rationale for any deviations from RESEARCH.md.
- pickInterval fallback decision (finest entry on no-match).
- Empty-schema DV-bound pattern preserved verbatim from columnStatsSql.ts:39.
- Test count (spec file LOC + test count) for both files.
- Any TypeScript type-narrowing notes for downstream plans (45-02 reads TimelineMetric / TimelineAggregation; 45-03 reads INTERVAL_LADDER / pickInterval / buildTimelineBucket / buildTimelineRangeQuery / buildTimelineSql).
</output>
