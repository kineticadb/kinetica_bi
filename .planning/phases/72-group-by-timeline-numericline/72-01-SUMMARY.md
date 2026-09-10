---
phase: 72-group-by-timeline-numericline
plan: 01
subsystem: charts
tags: [timeline, numeric-line, group-by, sql-builder, pure-lib]
requires: []
provides:
  - "buildTimelineSql/buildNumericLineSql optional groupByColumn + seriesIn args"
  - "groupedSeries.ts: MAX_SERIES (12), selectTopSeries, pivotSeriesRows"
  - "grouped SQL contract (<col> AS series, GROUP BY bucket, series, IS NOT NULL) for Wave-2 renderers"
affects:
  - packages/web/src/components/charts/TimelineRenderer.tsx (Wave 2)
  - packages/web/src/components/charts/NumericLineRenderer.tsx (Wave 2)
tech-stack:
  added: []
  patterns:
    - "Optional-arg builder extension with byte-identical ungrouped branch (backward-compat lock)"
    - "Top-N series cap as a shared pure helper consumed by both renderers"
key-files:
  created:
    - packages/web/src/lib/groupedSeries.ts
    - packages/web/src/lib/groupedSeries.spec.ts
  modified:
    - packages/web/src/lib/buildTimelineSql.ts
    - packages/web/src/lib/buildNumericLineSql.ts
    - packages/web/src/lib/buildTimelineSql.spec.ts
    - packages/web/src/lib/buildNumericLineSql.spec.ts
decisions:
  - "MAX_SERIES kept as a constant (12), not a config control — acceptable for this milestone per CONTEXT"
  - "Grouped LIMIT scales bucketBound × MAX_SERIES (or × seriesIn.length) to avoid silent per-series clipping"
  - "seriesIn IN-filter supports both the top-N two-step pre-query path and a generous-LIMIT single query"
  - "pivotSeriesRows takes a numericBuckets flag so numeric-line sorts numerically, timeline lexically"
metrics:
  duration_min: 3
  tasks: 3
  files: 6
  completed: "2026-06-18"
---

# Phase 72 Plan 01: SQL Builders + groupedSeries Helper Summary

Extended `buildTimelineSql` and `buildNumericLineSql` with an OPTIONAL `groupByColumn` (+ `seriesIn`) argument and shipped a shared pure `groupedSeries.ts` helper (`MAX_SERIES` + `selectTopSeries` + `pivotSeriesRows`) — the fixed interface-and-contract foundation the Wave-2 Timeline/Numeric-Line renderers build against. The ungrouped path is byte-identical to before (regression-locked).

## What Was Built

- **groupedSeries.ts** (pure, zero React/Recharts/Zustand): `MAX_SERIES = 12`; `selectTopSeries(rows, {max})` ranks series by summed metric value DESC (ties → series asc), returns `{ series, truncated, total }` for a "top 12 of N" affordance; `pivotSeriesRows(rows, seriesValues, {numericBuckets})` pivots flat grouped rows into Recharts-ready `{ bucket, [series]: number|null }[]`, fills missing combos with null (gap), drops out-of-set series, sorts buckets lexically (timeline) or numerically (numeric-line).
- **buildTimelineSql / buildNumericLineSql**: optional `groupByColumn?: string` + `seriesIn?: (string|number)[]`. Ungrouped branch returns the EXACT prior string. Grouped branch emits `<col> AS series`, `AND <col> IS NOT NULL`, `GROUP BY bucket, series`, and a LIMIT scaled by `MAX_SERIES` (or `seriesIn.length`). `seriesIn` produces an `IN (...)` filter — numbers verbatim, strings single-quoted with `''` escaping (`O'Brien` → `'O''Brien'`).

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 3 | groupedSeries.ts helper + spec | cba31ce | groupedSeries.ts, groupedSeries.spec.ts |
| 1 | Optional group-by branch on both builders | 04f1da7 | buildTimelineSql.ts, buildNumericLineSql.ts |
| 2 | Grouped-builder spec coverage | aa2f365 | buildTimelineSql.spec.ts, buildNumericLineSql.spec.ts |

Task 3 was executed first because both builders import `MAX_SERIES` from `groupedSeries.ts` (dependency order); commits remain atomic per task.

## Verification

- Builder + helper specs: 31 passed (groupedSeries 11, builders 20 incl. baseline byte-identical locks).
- Full frontend vitest: **2412 passed (105 files)** — run from `packages/web`.
- theme-guard.spec.ts (src/styles): 50 passed (no raw hex introduced).
- `packages/web` tsc: clean. `packages/server` tsc: clean.
- No server diff (`git status packages/server` empty) — FRONTEND-ONLY honored.
- Ungrouped output proven byte-identical via unchanged Test 1 baselines + new explicit "byte-identical to baseline" assertions in both grouped describe blocks.

## Deviations from Plan

None — plan executed as written. Note: the plan's `<read_first>` referenced `packages/web/src/phases/72-.../72-CONTEXT.md`; the actual path is `.planning/phases/72-.../72-CONTEXT.md` (read from there). No code impact.

## Notes for Wave 2

- Import `MAX_SERIES`, `selectTopSeries`, `pivotSeriesRows` from `../lib/groupedSeries`.
- Renderers pass `groupByColumn` (and optionally `seriesIn` after a top-N pre-query) to the builders. The grouped query returns `{ bucket, series, value }` rows — feed `selectTopSeries` then `pivotSeriesRows`.
- Numeric-line must pass `numericBuckets: true` to `pivotSeriesRows`.

## Self-Check: PASSED

- groupedSeries.ts FOUND; groupedSeries.spec.ts FOUND.
- Commits cba31ce, 04f1da7, aa2f365 all present.
