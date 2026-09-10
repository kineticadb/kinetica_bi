# Phase 72: Group-By for Timeline + Numeric-Line Charts - Context

**Gathered:** 2026-06-18
**Status:** Ready for planning
**Source:** Orchestrator-authored (autonomous run; user pre-approved all edits, requirements well-defined)

<domain>
## Phase Boundary

Add an OPTIONAL group-by dimension to the Timeline chart and the Numeric-Line chart. Today both render 1–4 parallel metrics as separate lines on alternating Y-axes (no series-split). With a group-by set, the chart instead renders ONE series per distinct value of the group-by column, over a SINGLE metric. This mirrors the existing bar/line/pie group-by pattern (`ChartConfigPanel.tsx`), adapted to the time-bucketed / numeric-binned line charts.

FRONTEND-ONLY (`packages/web`). Both charts are `usesAggregation:false` / `usesDataSource:false` — they OWN their SQL lifecycle (NOT routed through AggregatedWidgetRenderer, which stays the sole materialize trigger). Zero server diff expected. Flag any server diff.

Covers requirements: **GROUP-V114-01, GROUP-V114-02, GROUP-V114-03, GROUP-V114-04**.
</domain>

<decisions>
## Implementation Decisions (LOCKED)

### Single metric when grouped (GROUP-V114-03 — UI-enforced mutual exclusion)
- When `groupByColumn` is set (non-empty), the chart uses EXACTLY ONE metric: `metrics[0]`. Series = the distinct values of the group-by column.
- Multi-metric (1–4) remains available ONLY when no group-by is set. The config panel must enforce this: when a group-by is selected, collapse/disable the metrics builder to a single metric row (hide "Add metric"); when group-by is cleared, restore the normal 1–4 multi-metric builder.
- Do not silently drop configured metrics on toggle — keep `metrics[0]` and just stop using/showing 2..4 while grouped (preserve them in config so clearing group-by restores them, OR truncate with a clear UI affordance — planner's discretion, but prefer non-destructive).

### Group-by SQL shape (GROUP-V114-04)
- Extend the pure builders with an OPTIONAL group-by column arg:
  - `buildTimelineSql` (`lib/buildTimelineSql.ts`): when grouped, emit
    `SELECT <bucket> AS bucket, <groupByCol> AS series, <agg> AS value FROM <fromTarget> WHERE <timeCol> IS NOT NULL AND <groupByCol> IS NOT NULL GROUP BY bucket, series ORDER BY bucket ASC LIMIT <bound>`.
  - `buildNumericLineSql` (`lib/buildNumericLineSql.ts`): same shape with the `FLOOR(<xField>/<binWidth>)*<binWidth>` bucket + `WHERE <xField> IS NOT NULL AND <groupByCol> IS NOT NULL`.
- Ungrouped path is UNCHANGED (backward-compat — existing per-metric SQL stays byte-identical when no group-by arg is passed). Add the group-by as an optional field so existing callers/tests don't change.
- Null group values are EXCLUDED (`AND <groupByCol> IS NOT NULL`) — no "(null)" series. (Discretion: a "(none)" bucket is acceptable but default is exclude.)
- The grouped `LIMIT` must accommodate buckets × series without clipping any series' buckets. Recommended approach (planner's discretion to pick one, but it MUST NOT silently clip a series mid-range):
  - (a) Two-step: a top-N pre-query `SELECT <groupByCol> AS series, <agg> AS value FROM <table> WHERE <groupByCol> IS NOT NULL GROUP BY series ORDER BY value DESC LIMIT <N>`, then the main grouped query filters `WHERE ... AND <groupByCol> IN (<top-N values>)` with `LIMIT <buckets × N + margin>`; OR
  - (b) Single query with a generous `LIMIT` (≥ maxIntervals/maxBuckets × MAX_SERIES) then client-side top-N selection.
  - Whichever is chosen, log/annotate when series are truncated (no silent cap — per project convention).

### Top-N series cap (GROUP-V114-04)
- Default cap = **12 series** (a line chart with >12 lines is unreadable). Series ranked by total metric value descending; keep the top 12, drop the rest.
- If more than the cap exist, surface it (e.g. a small "showing top 12 of N" note in the legend/subtitle) — do NOT silently truncate.
- Planner's discretion whether to expose the cap as a config control (like `maxIntervals`) or keep it a constant `MAX_SERIES = 12`. A constant is acceptable for this milestone.

### Renderer: series pivot + N-series rendering (GROUP-V114-04)
- When grouped, the data pipeline changes from "N parallel per-metric queries merged by bucket" to a SINGLE grouped query, pivoted client-side into Recharts rows keyed by series value: `{ bucket, [seriesA]: v, [seriesB]: v, ... }`, missing combos → null (gap), same gap semantics as today's metric-merge.
- Render one `<Line>` per series value. Use a SINGLE shared Y-axis when grouped (the alternating per-metric dual-axis only makes sense for multi-metric; all series share the one metric's scale). Colors cycle the chart's existing `colorTheme` ramp via `themeColorsFor` / `getCbColorTheme` (`lib/cbColorThemes.ts`) across series — NO raw hex.
- Legend shows series values. Tooltip shows series value + bucket + metric value.
- Timeline drag-to-filter (BETWEEN on `timeCol`) MUST be preserved when grouped — it operates on the bucket axis, independent of series. Numeric-line keeps whatever its current x-interaction is.

### Config panel: Group By picker (GROUP-V114-01, -02)
- Add `groupByColumn?: string` to `TimelineConfig` (`TimelineConfigPanel.tsx`) and `NumericLineConfig` (`NumericLineConfigPanel.tsx`).
- Add a "Group By" single-select picker (with an explicit empty/"None" option to clear). Filter the column list to group-eligible dimensions — reuse the existing `isColumnDrillDownSafe` / categorical-friendly filtering already used for group-by elsewhere (see `ChartConfigPanel.tsx` group-by + `columnTypes.ts`). Selecting "None" clears grouping and restores multi-metric.

### Claude's Discretion
- Plan/wave decomposition (e.g. SQL builders → config panels → renderers, or split by chart). Timeline + Numeric-Line are symmetric; share helpers where clean.
- Whether `MAX_SERIES` is a constant or a config control (constant 12 acceptable).
- The exact top-N mechanism (two-step IN-filter vs generous-LIMIT + client cap) — must avoid silent per-series clipping.
- Whether to factor a shared "grouped series pivot" helper used by both renderers.
- Spec-test placement (extend `buildTimelineSql.spec.ts`, `buildNumericLineSql.spec.ts`, `TimelineConfigPanel`/`NumericLineConfigPanel` + renderer specs).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing group-by pattern to mirror (bar/line/pie/scatter)
- `packages/web/src/components/charts/ChartConfigPanel.tsx`:
  - `groupByColumn` in config defaults: **lines 234, 245**.
  - Group-by SQL build (the canonical pattern): **lines 293-320** — `SELECT ${groupByColumn}, ${aggExpr} AS value FROM ${table} GROUP BY ${groupByColumn} ORDER BY value ${dir} LIMIT ${groupLimit}`; `ALLOWED_LIMITS = [5,10,25,50,100,250,500]` at **317**.

### Timeline chart
- `packages/web/src/components/charts/definitions/timeline.ts` — chart-type def (`usesAggregation:false`, `usesDataSource:false`).
- `packages/web/src/components/charts/TimelineConfigPanel.tsx` — `TimelineConfig` type at **lines 31-43** (timeCol, metrics[0..4], maxIntervals, colorTheme, etc.); `MAX_METRICS=4` at **28**; aggregation list **45-54**; column filtering helpers imported from `columnTypes` (`inferDataTypeFromColumn`, `isColumnDrillDownSafe`).
- `packages/web/src/lib/buildTimelineSql.ts` — pure per-metric SQL builder (full file is short; emitted shape documented at **lines 36-66**). Extend with optional group-by.
- `packages/web/src/components/charts/TimelineRenderer.tsx` (493 lines) — pipeline: range probe (**~224-243**) → `pickInterval` (**244**) → N parallel `runSql(buildTimelineSql)` per metric (**248-260**) → merge by bucket, missing→null (**262-276**) → multi-axis Recharts `LineChart` with alternating `YAxis` per metric (**~365-400+**). Drag-to-filter band logic + `appliedBand` memo (**~173-190**). Effect dep key uses `JSON.stringify(metrics.map(...))` at **297** — group-by must be added to the dep key.

### Numeric-Line chart (symmetric)
- `packages/web/src/components/charts/definitions/numericline.ts`
- `packages/web/src/components/charts/NumericLineConfigPanel.tsx` (388 lines) — `NumericLineConfig` (xField, metrics[0..4], maxBuckets, colorTheme).
- `packages/web/src/lib/buildNumericLineSql.ts` — pure per-metric SQL builder (full file short; shape at **lines 35-63**). Bucket = `FLOOR(xField/binWidth)*binWidth`. Extend with optional group-by.
- `packages/web/src/components/charts/NumericLineRenderer.tsx` (451 lines) — same pipeline shape as TimelineRenderer (bin probe → N per-metric queries → merge → multi-axis LineChart). `numericBin.ts` has `pickNumericBinWidth`.

### Color + column helpers (reuse — no raw hex)
- `packages/web/src/lib/cbColorThemes.ts` — `CB_COLOR_THEMES`, `getCbColorTheme`, `themeColorsFor` (the ramp to cycle across series).
- `packages/web/src/lib/columnTypes.ts` — `isColumnDrillDownSafe`, `inferDataTypeFromColumn` (group-by column eligibility filtering).
</canonical_refs>

<specifics>
## Specific Ideas

Tests should assert:
- `buildTimelineSql` / `buildNumericLineSql` with NO group-by arg → byte-identical to today's output (backward-compat lock).
- With a group-by arg → SQL contains `<groupByCol> AS series`, `GROUP BY bucket, series`, and `<groupByCol> IS NOT NULL`.
- Config panel: selecting a Group By collapses the metrics builder to a single metric (no "Add metric"); clearing restores 1–4 metrics.
- Renderer (grouped): one `<Line>` per distinct series value, single shared Y-axis, colors from the colorTheme ramp; series count capped at 12 with a "top 12 of N" affordance when exceeded.
- Renderer (ungrouped): unchanged multi-metric behavior (regression lock).
- Timeline drag-to-filter still dispatches a BETWEEN filter on timeCol when grouped.
- theme-guard stays green (no raw hex introduced).
</specifics>

<deferred>
## Deferred Ideas

- Metrics × groups (multi-metric AND group-by simultaneously) — explicitly OUT OF SCOPE per REQUIREMENTS.md.
- Group-by for other chart types (calendar/map) — out of scope; this phase is timeline + numeric-line only.
</deferred>

---

*Phase: 72-group-by-timeline-numericline*
*Context gathered: 2026-06-18 (autonomous orchestrator run)*
