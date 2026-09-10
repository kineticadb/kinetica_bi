---
phase: 45-timeline-chart-widget
plan: 02
subsystem: ui
tags: [timeline, config-panel, chart-registry, recharts, colorbrewer, typescript]

# Dependency graph
requires:
  - phase: 45-timeline-chart-widget
    plan: 01
    provides: TimelineMetric / TimelineAggregation / DEFAULT_MAX_INTERVALS from timelineBin.ts
provides:
  - TimelineConfigPanel.tsx — CustomConfigPanel with base-table + time-col + metric builder + options
  - TimelineConfig type — consumed by Plan 45-03 TimelineRenderer
  - MAX_METRICS = 4 constant
  - DEFAULT_COLOR_THEME = "Set2" constant
  - definitions/timeline.ts — registerTimeline() with full ChartTypeDefinition
affects:
  - 45-03-renderer-and-drag-to-filter (imports TimelineConfig type + MAX_METRICS + DEFAULT_COLOR_THEME)
  - WidgetRenderer.tsx short-circuit branch (Plan 45-03 wires it)
  - Visualization picker (auto-discovers "Timeline Chart" via getAllChartTypes())

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CustomConfigPanel pattern: receive draft/onChange/tables/isValid, write to widget.config — mirrors DataFilterConfigPanel"
    - "inferDataTypeFromColumn(name, columns) === 'datetime' for time-col picker (DATETIME_TYPES not exported)"
    - "inferDataTypeFromColumn === 'number' && isColumnDrillDownSafe(type) for metric-col picker (excludes WKT/geometry)"
    - "handleThemeChange re-colors ALL existing metrics from new palette via themeColorsFor()"
    - "handleTableChange clears timeCol + metrics on table switch (old column refs invalid)"
    - "isValid signals true only when tableId + timeCol + >=1 complete metric"
    - "AARRGGBB <-> CSS color conversion: toCssColor (strip FF prefix + #) / toAarrggbb (add FF prefix)"

key-files:
  created:
    - kinetica_bi/src/components/charts/TimelineConfigPanel.tsx
    - kinetica_bi/src/components/charts/TimelineConfigPanel.spec.tsx
    - kinetica_bi/src/components/charts/definitions/timeline.ts
  modified:
    - kinetica_bi/src/components/charts/definitions/index.ts

key-decisions:
  - "DEFAULT_COLOR_THEME = 'Set2' — ColorBrewer 8-color qualitative (locked CONTEXT.md 2026-05-29; Tableau-10 not in colorbrewer package)"
  - "MAX_METRICS = 4 — Add metric button disabled at 4; renderer (Plan 45-03) slices defensively"
  - "Column picker filters use inferDataTypeFromColumn() not raw DATETIME_TYPES/NUMERIC_TYPES sets (those are not exported)"
  - "Plan ships dormant — WidgetRenderer.tsx does NOT yet short-circuit for type=timeline; Plan 45-03 wires the branch"
  - "usesDataSource: false on ChartTypeDefinition suppresses ChartConfigPanel's generic Data Source section; TimelineConfigPanel renders its own picker"
  - "tsc pre-existing errors in DataFilterConfigPanel.spec.tsx / DataFilterRenderer.spec.tsx / Legend*.spec.tsx are carry-forward tech debt; zero new TypeScript errors introduced"

patterns-established:
  - "Two-function color conversion pattern: toCssColor(aarrggbb) for <input type=color> + Recharts stroke; toAarrggbb(css) for storage — same as Class Break form"
  - "themeColorsFor() called with Math.max(1, metrics.length) to always get at least 1 color even with empty metrics list"

requirements-completed:
  - TIMELINE-V17-01
  - TIMELINE-V17-03

# Metrics
duration: 4min
completed: 2026-05-29
---

# Phase 45 Plan 02: Widget Registration and Config Panel Summary

**TimelineConfigPanel ships with base-table picker + time-col picker (datetime-only via inferDataTypeFromColumn) + max-4 metric row builder + options section; definitions/timeline.ts registers type="timeline" with Set2 default + 200 maxIntervals; 10/10 spec tests passing**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-29T21:02:18Z
- **Completed:** 2026-05-29T21:06:18Z
- **Tasks:** 2 (2 commits)
- **Files modified:** 3 new + 1 modified = 4 files

## Accomplishments

- `TimelineConfigPanel.tsx` exports `TimelineConfig` type (Plan 45-03 import target), `MAX_METRICS = 4`, `DEFAULT_COLOR_THEME = "Set2"`. Config panel renders 4 sections: Data Source / Time column / Metrics / Options.
- Time-col picker filters via `inferDataTypeFromColumn === "datetime"` (CONTEXT.md 2026-05-29 lock confirmed).
- Metric-col picker filters via `inferDataTypeFromColumn === "number" && isColumnDrillDownSafe(type)` — excludes WKT/geometry/large-text.
- `handleThemeChange` re-colors all existing metrics from the new ColorBrewer palette (Set2/Dark2/etc.).
- `handleTableChange` clears `timeCol + metrics` on table switch (old column refs invalid on new schema).
- `isValid` signals `true` only when `tableId + timeCol + ≥1 complete metric` are all set.
- `definitions/timeline.ts` registers with `type: "timeline" / label: "Timeline Chart" / icon: "TL" / usesDataSource: false / usesAggregation: false / supportsDrillDown: false`.
- `definitions/index.ts` updated — `registerTimeline()` added after `registerDataFilter()`.
- Visualization picker auto-includes "Timeline Chart" via `getAllChartTypes()` — no `DashboardsPage.tsx` edit needed.

## Task Commits

1. **Task 1: TimelineConfigPanel.tsx + spec** — `17ee8e1`
2. **Task 2: definitions/timeline.ts + definitions/index.ts** — `6405303`

## TimelineConfig Final Shape

```typescript
export type TimelineConfig = {
  tableId?: number;
  tableRef?: string;          // "schema.name"
  dynamicViewId?: number;     // future-compat; not exposed yet
  timeCol: string;
  metrics: TimelineMetric[];  // 0..4 items
  maxIntervals: number;       // default 200 (DEFAULT_MAX_INTERVALS from timelineBin.ts)
  showLegend: boolean;
  showTooltip: boolean;
  colorTheme: string;         // ColorBrewer scheme id; default "Set2"
  dateFormatOverride: string; // "" → "auto" smart format
};
```

No field changes from CONTEXT.md shape. `dynamicViewId` is present for forward compatibility (not exposed in picker UI yet — per plan defer note).

## DEFAULT_COLOR_THEME = "Set2" Confirmation

Set2 is confirmed in `CB_COLOR_THEMES` at runtime. `getCbColorTheme("Set2")` returns a valid `CbColorTheme` with `group: "Qualitative"`. The qualitative themes dropdown in the panel filters `CB_COLOR_THEMES` to `group === "Qualitative"` — Set2 is the first option rendered (alphabetical sort: Accent, Dark2, Paired, Pastel1, Pastel2, Set1, Set2, Set3).

## MAX_METRICS = 4 Enforcement Points

1. **Add metric button**: `disabled={metrics.length >= MAX_METRICS}` — operator cannot click "Add metric" when 4 rows exist.
2. **Button label** appends `(max 4)` text when at cap.
3. **`handleAddMetric` guard**: early return if `metrics.length >= MAX_METRICS` — defensive double-check.
4. **`formValid` check**: `metrics.length <= MAX_METRICS` in validity predicate.
5. **Plan 45-03 renderer**: will slice defensively per critical invariant #2.

## handleThemeChange Recoloring Semantics

When operator changes `colorTheme` in the Options dropdown:
1. `getCbColorTheme(newTheme)` resolves the new palette.
2. `themeColorsFor(t, Math.max(1, metrics.length))` gets the palette sized to current metric count.
3. Each metric at index `i` gets `palette[i % palette.length]` — modulo wrapping if palette < metric count.
4. Both `colorTheme` and the re-colored `metrics` are dispatched in a single `onChange` call.

This means per-line color overrides set by the operator are REPLACED when the theme changes — same semantics as the Class Break form.

## Spec Test Count

| File | Tests | LOC |
|------|-------|-----|
| TimelineConfigPanel.spec.tsx | 10 | 143 |
| **Total (Plan 45-02)** | **10** | 143 |
| **Cumulative (Phase 45)** | **31** | — |

## Rerender Pattern

Test 6 (isValid signaling) uses `rerender` directly on the `<TimelineConfigPanel>` element (not a wrapper + prop-update pattern) because the test needs to re-render with different `config` props to verify the effect fires with the new validity state. This is the same pattern used in `DataFilterConfigPanel.spec.tsx` tests 10-13.

## Deviations from Plan

None — plan executed exactly as written. The `TimelineConfigPanel.tsx` and `TimelineConfigPanel.spec.tsx` content from the plan's `<action>` blocks was used as-is, with only minor HTML entity handling (`&quot;` in the hint text) to match JSX best practices.

## Pre-existing tsc Issues (Out of Scope)

Same carry-forward as Plan 45-01: pre-existing TypeScript errors in `DataFilterConfigPanel.spec.tsx` (columns union optional props), `DataFilterRenderer.spec.tsx` (`node:fs/promises` not found), `LegendConfigPanel.spec.tsx` / `LegendRenderer.spec.tsx` / `MapChartRenderer.spec.tsx` / `LayersLegendPanel.spec.tsx` / `WidgetRenderer.spec.tsx` (`fs`/`path`/`__dirname` without `@types/node`). Zero new TypeScript errors introduced by Phase 45 Plan 02 code.

---
*Phase: 45-timeline-chart-widget*
*Completed: 2026-05-29*
