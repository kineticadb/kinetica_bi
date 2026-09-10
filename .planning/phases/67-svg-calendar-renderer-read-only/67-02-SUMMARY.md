---
phase: 67-svg-calendar-renderer-read-only
plan: "02"
subsystem: frontend-chart
tags: [calendar, heatmap, svg, fetch-lifecycle, gap-fill, color-scale, filter-aware, read-only]
dependency_graph:
  requires: [67-01-calendarColorScale, 67-01-calendarGapFill, 67-01-chartColors.emptyCell, 65-01-buildCalendarSql, 66-03-CalendarConfigPanel]
  provides: [CalendarRenderer, CalendarRenderer.spec]
  affects: [67-03-WidgetRenderer-wiring, 68-cell-drill-integration]
tech_stack:
  added: []
  patterns: [fetch-lifecycle-mirror-TimelineRenderer, pre-resolved-FROM-no-fromSwap, filter-aware-dep-set, reactive-useMemo-color-domain, 2D-gap-fill-useMemo, SVG-heatmap-grid]
key_files:
  created:
    - packages/web/src/components/charts/CalendarRenderer.tsx
    - packages/web/src/components/charts/CalendarRenderer.spec.tsx
  modified: []
decisions:
  - "dvStatus gate uses 'materialized' (not 'ready') — matches DynamicViewStatus enum in dynamicViewStore.ts"
  - "Static invariant test checks import lines only (not whole source) — comments mentioning fromSwap are OK per DataFilterRenderer.spec.tsx precedent; import lines must be clean"
  - "LEGEND_HEIGHT / LEGEND_SWATCH constants kept small (28px / 14px) — matches cell size; legend strip below scrollable SVG"
  - "Empty-state gates placed before hooks with eslint-disable-next-line, mirroring TimelineRenderer pattern (hooks after-conditional is intentional and documented)"
metrics:
  duration: "9 minutes"
  completed: "2026-06-16"
  tasks: 2
  files: 2
---

# Phase 67 Plan 02: CalendarRenderer (read-only SVG heatmap) Summary

**One-liner:** SVG calendar heatmap renderer with pre-resolved FROM precedence, single runSql(buildCalendarSql), reactive 5-bucket color scale, 2D gap-fill, both-axis labels, per-cell tooltip, and filter-aware re-fetch (CAL-V113-04 + CAL-V113-05).

## Tasks Completed

| Task | Name | Commits | Result |
|------|------|---------|--------|
| 1 | CalendarRenderer fetch lifecycle | 8dacce5 | tsc clean; FROM resolution + single runSql; filter-aware dep set |
| 2 | SVG render + spec | 3e7c5b3 | 11/11 tests pass; theme-guard 50/50; tsc clean |

## Component Interface (for Plan 67-03 WidgetRenderer wiring)

```typescript
// packages/web/src/components/charts/CalendarRenderer.tsx
export default function CalendarRenderer({
  widget,
  tables,
}: {
  widget: WidgetDto;
  tables: TableDto[];
}): JSX.Element;
```

**Reads from `widget.config`** (as `Partial<CalendarConfig>`):
- `tableId?: number` — used to scope filter store selectors
- `tableRef?: string` — "schema.name" parsed for effectiveSchema.effectiveTable
- `dynamicViewId?: number` — activates dv path (dvFilterViewName || dvViewName as FROM)
- `timeCol: string` — passed to buildCalendarSql
- `metricColumn: string` — defaults to `"*"`
- `aggregation: TimelineAggregation` — defaults to `"COUNT"`
- `domain: CalendarDomain` — defaults to `"month"`
- `subdomain: CalendarSubdomain` — defaults to `"day"`
- `colorTheme: string` — defaults to `"Greens"` (fed to calendarBucketColors)

## Data Attributes (for Phase 68 click handler)

| Attribute | Element | Value | Purpose |
|-----------|---------|-------|---------|
| `data-testid="calendar-renderer"` | `<svg>` | always present | test selector; Phase 68 click target parent |
| `data-testid="calendar-loading"` | `<div>` | loading state | |
| `data-testid="calendar-error"` | `<div>` | error state | |
| `data-testid="calendar-empty"` | `<div>` | no data | |
| `data-testid="calendar-legend"` | `<div>` | legend strip | |
| `data-empty="true"` | `<rect>` | null-value cells | Phase 68 click guard: `if (cell.value === null) return` |

## FROM Precedence (for Plan 67-03 + Phase 68)

```
Table path (dynamicViewId === undefined):
  fvViewName (from useFilterViewStore.views[tableId].viewName)
    → unprefixed view name (empty schema)
  else: effectiveSchema.effectiveTable

DV path (dynamicViewId !== undefined):
  dvFilterViewName (from useFilterViewStore.dvViews[dynamicViewId].viewName)
    → preferred (filtered-dv)
  || dvViewName (from useDynamicViewStore.views[dynamicViewId].viewName)
    → fallback (raw dv, gated on dvStatus === "materialized")
  NO fromSwap — pre-resolved before buildCalendarSql call
```

**Gate: DV path only fetches when `dvStatus === "materialized"`.**
Table path suspends on `fvMaterializing`.

## Re-fetch Dep Array (CAL-V113-05)

```
[effectiveSchema, effectiveTable, timeCol, metricColumn, aggregation,
 domain, subdomain, filterVersion, fvViewName, fvExpiresAt, fvMaterializing,
 dvFilterViewName, dvFilterMaterializing, dvViewName, dvStatus]
```

## Spec Coverage

| Test | What it asserts |
|------|----------------|
| 0 | Static: import lines do NOT reference materializeFilter/dropFilterView/fromSwap |
| 1 | Source contains exact string `useMemo(() => computeDomain(data), [data])` |
| 2 | On mount, runSql called once; SQL contains DATE_TRUNC + domain_bucket; FROM demo.sales (no filter view) |
| 3 | Active table filter-view → SQL FROM = view name (unprefixed), NOT schema.table |
| 4a | dvFilterViewName set → SQL FROM = filtered-dv view (preferred) |
| 4b | dvViewName only (no dvFilter) → SQL FROM = raw dv view |
| 5 | filterVersion bump → runSql called again (re-fetch) |
| 6 | Sparse response → data-empty="true" cells (no `<title>`); populated cells have `<title>` |
| 7 | Empty response → calendar-empty testid with "No data for this time range" |
| 8 | Missing tableId → config hint shown, no calendar |
| 9 | fvMaterializing=true → runSql NOT called (suspend gate) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] DV status gate used wrong status value**
- **Found during:** Task 1 tsc check
- **Issue:** Plan spec said `dvStatus !== "ready"` but `DynamicViewStatus` enum only has `"materialized" | "over_threshold" | "pending" | "error"` — `"ready"` does not exist
- **Fix:** Changed gate to `dvStatus !== "materialized"` (matching WidgetRenderer.tsx line 510)
- **Files modified:** packages/web/src/components/charts/CalendarRenderer.tsx
- **Commit:** 8dacce5

**2. [Rule 1 - Bug] Static invariant matched comments, not just imports**
- **Found during:** Task 2 spec run
- **Issue:** The `not.toMatch(/materializeFilter|dropFilterView|fromSwap/)` assertion fired on the comment block at the top of CalendarRenderer.tsx which documents what NOT to import
- **Fix:** Changed assertion to filter import lines only (mirrors DataFilterRenderer.spec.tsx intent: "the file doesn't IMPORT these" not "the file doesn't MENTION these")
- **Files modified:** packages/web/src/components/charts/CalendarRenderer.spec.tsx
- **Commit:** 3e7c5b3

## Verification

- `npx vitest run src/components/charts/CalendarRenderer.spec.tsx` — 11/11 pass
- `npx vitest run src/styles/theme-guard.spec.ts` — 50/50 pass (CalendarRenderer.tsx in scope, no raw hex, no allowlist entry)
- `npx tsc --noEmit` — clean

## Self-Check: PASSED

- FOUND: packages/web/src/components/charts/CalendarRenderer.tsx
- FOUND: packages/web/src/components/charts/CalendarRenderer.spec.tsx
- FOUND commit 8dacce5 (Task 1 — fetch lifecycle)
- FOUND commit 3e7c5b3 (Task 2 — SVG render + spec)
