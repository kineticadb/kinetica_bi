---
phase: 132-line-chart-multi-series-group-by
plan: 01
subsystem: web/lib
tags: [line-chart, pure-helpers, tdd]
requires: []
provides: [aggregationLabels, lineChartTitle, lineChartLayout, lineChartData]
affects: [132-02, 132-03, 132-04, 132-05]
key-files:
  created:
    - packages/web/src/lib/aggregationLabels.ts
    - packages/web/src/lib/lineChartTitle.ts
    - packages/web/src/lib/lineChartLayout.ts
    - packages/web/src/lib/lineChartData.ts
    - packages/web/src/lib/aggregationLabels.spec.ts
    - packages/web/src/lib/lineChartTitle.spec.ts
    - packages/web/src/lib/lineChartLayout.spec.ts
    - packages/web/src/lib/lineChartData.spec.ts
metrics:
  completed: 2026-10-08
---

# Phase 132 Plan 01: Pure line-chart helpers Summary

Four pure modules (title resolution, x-axis layout arithmetic, isolated-point and blank-row helpers, X sort, category-count SQL and notice copy) with 33 specs.

PLAN_BASE: d35081ffde662788ccd961213d487b671af2f0a5. No component file modified. Shared docs untouched.

## Pinned exports (verbatim)

```ts
// lib/aggregationLabels.ts
export type AggregationOption = { value: string; label: string };
export const AGGREGATIONS: readonly AggregationOption[];
export function aggregationLabel(value: string | undefined): string;

// lib/lineChartTitle.ts
export type LineMetricTitleInput = {
  yFieldLabel?: string; customLabel?: string | null; columnLabel?: string | null;
  metricColumn?: string; aggregation?: string; fallbackKey?: string;
};
export function resolveLineMetricTitle(a: LineMetricTitleInput): string;

// lib/lineChartLayout.ts
export const LINE_CATEGORY_SLOT_PX = 48;
export const LINE_TILTED_SLOT_PX = LINE_CATEGORY_SLOT_PX / 2; // 24
export const LINE_MIN_PLOT_PX = 160;
export const LINE_DOT_DENSITY_MAX = 24;
export const LINE_LABEL_PX_PER_CHAR = 7;
export const LINE_UNKNOWN_WIDTH_TILT_N = 8;
export const LINE_DEFAULT_X_AXIS_HEIGHT = 30;
export type LineXAxisLayout = { tilt: boolean; scroll: boolean; xAxisHeight: number; minInnerWidth: number; minInnerHeight: number };
export function computeLineXAxisLayout(a: { n: number; plotWidthPx: number; maxLabelChars: number }): LineXAxisLayout;
export function isIsolatedLinePoint(points: ReadonlyArray<{ y?: number | null } | null | undefined>, index: number): boolean;
export function lineGroupByColumns(config: Record<string, unknown>): string[];
export function lineXColumn(config: Record<string, unknown>): string;

// lib/lineChartData.ts
export function sortLineRowsByX<T>(rows: readonly T[], xOf: (row: T) => unknown): T[];
export function buildLineCategoryCountSql(sql: string, xColumn: string): string | null;
export function parseCategoryCount(rows: ReadonlyArray<Record<string, unknown>>): number | null;
export type LineCategoryTruncation = { totalCategories: number | null };
export function lineCategoryNoteText(a: { shown: number; total: number | null }): string;
export const LINE_CATEGORY_NOTE_TITLE =
  'The query reached its Result limit, so lower-value points are not shown. Raise "Result limit" or narrow the query.';
```

Copy strings: "Showing N of M categories" / "Some lower values are not shown (result limit reached)" / "Showing top N categories (more exist)". Count SQL alias: `kbi_line_x`.

## Discrimination probes (all reverted)

All went red except one deliberately weak extra probe of mine (noted below):
- Title: fallback `?? "Metric"` -> LCT-7, LCT-8 red. Drop `columnLabel !== metricColumn` -> LCT-4 red.
- Layout: `>` to `>=` -> LCL-5 red. Drop `+ diag` -> LCL-3 red. Drop `trim()` filter -> LCL-8 red. Ignore right neighbour -> LCL-7 red.
- Data: numeric test forced false -> LCD-1 red. Missing first -> LCD-4 red. Optional LIMIT in regex -> LCD-8 red. `shown <= total` -> LCD-11 red.
- A no-op `.sort(() => 0)` probe on the missing-last array stayed green; it was a bad probe (a stable no-op sort), not a test gap. The proper missing-first probe is the LCD-4 one above.

## Gates

- `tsc --noEmit` clean; full web vitest 202 files / 4398 tests pass; theme-guard 158 pass.
- Parallel fake-timer contamination did not occur this run.

## Deviations from Plan

None. The plan executed as written.

## Commits

See `git log` for the three `feat(132-01)` commits (Task 1 titles, Task 2 layout, Task 3 data).
