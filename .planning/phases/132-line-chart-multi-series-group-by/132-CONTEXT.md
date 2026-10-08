# Phase 132: Line Chart Multi-Series Group By - Context

**Gathered:** 2026-10-08
**Status:** Ready for planning

<domain>
## Phase Boundary

The plain **Line Chart** (`definitions/line.ts`) gets the bar chart's multi-column Group By builder:
- **Group By column 1 is required.** It is the X-axis categories.
- **Optional extra columns** draw one line per series value.

The chart must also:
- show every X-axis label;
- name its legend and axis after the metric, never `value`;
- drill down the way the multi-series bar chart does;
- render missing points as a deliberate gap.

Requirements: LINE-V126-01..04.

**Explicitly NOT in this phase:**
- **No numeric X-axis picker and no multi-metric builder on the Line Chart.** The operator compared the Line Chart with the Timeline chart and first asked for a Timeline-style config: X-axis column, Metrics (max 4), Timeline Group By. We then found that the existing **Numeric Line Chart** (`definitions/numericline.ts`) already provides that: a numeric X-axis column bucketed by Max buckets, Metrics 1–4 and Group by. The operator concluded the Line Chart would duplicate it, and chose to keep the Line Chart a category chart that only adds the Group By builder.
- Merging or renaming Line and Numeric Line: deferred (see below).

</domain>

<decisions>
## Implementation Decisions

### Group By (LINE-V126-01)
- **D-01: Reuse the bar chart's multi-column Group By Columns builder** (`ChartConfigPanel.tsx` ~824-890) for the Line Chart, with the same `groupByColumns` model, the `usesMultiColumnGroupBy` gate and the `toBarPivotInput`/`selectTopSeries`/`pivotSeriesRows` helpers (already chart-agnostic).
- **D-02: Column 1 is REQUIRED** and is the X-axis category. The config cannot be applied without it; validation states that, using the existing panel validation pattern.
- **D-03: Columns 2+ are optional.** Each distinct value (or combination, for 3+ columns, joined the way the bar chart builds series keys) draws one line.
- **D-04: Same series cap and note as bars.** Use `maxBarGroupBySeriesCap` (deploy-wide) and the "Showing top N of M series" note (`bar-truncated-note` pattern).
- **D-05: Existing Line Charts are migrated without a visible change.** Today's single Group By becomes column 1; metric and aggregation are unchanged; saved dashboards render as before. A Line Chart saved with NO Group By renders as today until edited, and editing then requires column 1.

### Missing points (ROADMAP criterion 5)
- **D-06: Gap, not zero.** When a series has no value at an X category, the line breaks there (`connectNulls={false}`), matching the Timeline chart. A lone point between gaps shows as a dot. The tooltip lists only the lines that have a value at that X. The operator verifies this in light and dark mode at the phase checkpoint.

### X-axis labels (LINE-V126-02)
- **D-07: Show every category label.** Override Recharts' default tick thinning (`interval={0}` or equivalent). When labels would overlap, tilt them -45°. When there are too many to fit legibly, the chart scrolls horizontally, using the same approach as the bar chart's min-bar-size scroll region. The X order follows the data order the chart already uses (category sort as today).

### Legend & tooltip naming (LINE-V126-03)
- **D-08: Multi-series.**
  - Legend entries are the series values (e.g. Cash, Credit).
  - The tooltip header is the X value, with one line per series reading "Cash: 12,400".
  - The metric name appears as the **Y-axis label**: the Format-columns label for the metric column if set, else "<Aggregation> of <column>", e.g. "Sum of fare_amount".
- **D-09: Single-series.** The legend shows the metric name (the same resolution as D-08, honouring the existing `yFieldLabel`). It never shows the literal `value`.

### Drill-down (LINE-V126-04)
- **D-10: Same as the multi-series bar chart.** Clicking a point drills on **Group By column 1 = the clicked X category** (`WidgetRenderer.tsx` ~1097-1114: bucket value, `groupByColumns[0]`, `dispatchDrillDown`, 300 ms). The series column is not added to the filter.

### Series look
- **D-11: Same palette as the bar chart's multi-series**, so the same value gets the same color across bar and line.
  - Dots on points when X values are few, hidden when dense (threshold at Claude's discretion).
  - The existing Line Width setting applies to every line.
  - No new color-theme picker.

### Claude's Discretion
- The dot-density threshold. The exact angle/scroll trigger thresholds and minimum per-category width.
- Where the migration lives (read-time normalisation vs config migration). It must be lossless and not change saved JSON unexpectedly.
- Whether LineRenderer shares code with BarRenderer's series loop or ports it.
- Rewording LINE-V126-01 to add "Group By column 1 is required" (the last plan does it by hand in REQUIREMENTS.md).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/REQUIREMENTS.md`: LINE-V126-01..04
- `.planning/ROADMAP.md`: Phase 132 success criteria 1–5 (criterion 5 is a `checkpoint:human-verify`: sparse multi-series data, gap-vs-zero, light/dark)

### Code
- `packages/web/src/components/charts/ChartConfigPanel.tsx` ~824-890: the bar chart's Group By Columns builder to reuse
- `packages/web/src/lib/barGroupedSeries.ts`, `packages/web/src/lib/groupedSeries.ts`: `toBarPivotInput`, `selectTopSeries`, `pivotSeriesRows` (chart-agnostic)
- `packages/web/src/components/charts/WidgetRenderer.tsx`: `BarRenderer` (~990): per-series loop, truncation note (~1272), multi-series drill (~1097-1114), scroll region; `LineRenderer` (~1313): single `<Line>`, legend `name` resolution (yFieldLabel / resolveLabel), default XAxis ticks
- `packages/web/src/components/charts/definitions/line.ts` (Line Chart definition), `definitions/bar.ts` (for the groupByColumns shape)
- `packages/web/src/components/charts/TimelineRenderer.tsx` ~690-715: `connectNulls={false}` gap precedent; the tooltip for grouped series
- `packages/web/src/components/charts/definitions/numericline.ts`, `NumericLineConfigPanel.tsx`: the existing numeric/multi-metric line chart. Reference only, not changed.
- Phase 102 (bar group-by) planning: `.planning/milestones/` or `.planning/phases/102-*` CONTEXT/SUMMARY, if present, for the bar builder's decisions (series key format, cap)

### Project rules
- `CLAUDE.md`: UI conventions (existing global.css classes only, theme tokens, no raw hex), verifiable acceptance criteria, test gates
- Memory notes: CSS bugs evade tests and theme-guard (verify visually); widget modals must portal (not expected here)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- The bar Group By builder, the series helpers, the cap/note and the scroll region are all reusable for the line chart.
- `resolveLabel(tableId, column)` and `yFieldLabel` already exist for metric naming.
- `ColumnFormatTooltip` is used by Timeline for grouped tooltips.

### Established Patterns
- Multi-series pivot: rows → `{ bucket, [seriesKey]: value }`, with missing combinations left undefined (→ gaps with connectNulls false).
- Recharts XAxis default `interval` thins ticks. That is the root cause of LINE-V126-02.

### Integration Points
- ChartConfigPanel (line-type branch), LineRenderer, the line definition, and the SQL builder for aggregated widgets (GROUP BY on all groupByColumns).

</code_context>

<specifics>
## Specific Ideas

- The operator compared the Line Chart with the Timeline chart (screenshots) and wanted the line chart to "work correctly" with a required group-by. The numeric/multi-metric use case is served by the existing Numeric Line Chart.

</specifics>

<deferred>
## Deferred Ideas

- Merging Line Chart and Numeric Line Chart, or renaming them so their purposes are clearer in the picker (the operator noticed they look like duplicates).
- A Timeline-style metrics builder (max 4) on the plain Line Chart: not needed, since Numeric Line covers it.
- A per-widget "missing values: gap / connect / zero" setting.
- Pre-existing bug (Phase 58): records `page_size` widget-action override is a no-op (`page_size` vs `pageSize`). Logged in STATE; unrelated to this phase.

</deferred>

---

*Phase: 132-line-chart-multi-series-group-by*
*Context gathered: 2026-10-08*
