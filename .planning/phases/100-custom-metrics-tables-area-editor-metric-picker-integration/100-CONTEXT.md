# Phase 100: Custom Metrics — Tables-Area Editor + Metric-Picker Integration - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the FRONTEND that consumes the Phase 99 foundation: (1) a Tables-area editor to create/edit/delete a table's custom metrics (mirroring the Column Format editor), and (2) integration of custom metrics into every metric-configuring visualization's picker, emitting the metric's raw SQL aggregate expression DIRECTLY into the widget SELECT with NO additional aggregation wrapper. Consumes the Phase 99 `customMetricsStore` + API client + CRUD. NO server changes.

Covers: METRIC-V119-01 (Tables-area authoring-UI portion — completes the requirement whose server half shipped in Phase 99), METRIC-V119-03, METRIC-V119-04.

</domain>

<decisions>
## Implementation Decisions

### Picker presentation + aggregation control
- Custom metrics appear in the metric dropdown in a **distinct "Custom metrics" group/section**, visually separate from real columns (e.g. an `<optgroup>` or a labeled section).
- When a **custom metric is selected, the aggregation selector is HIDDEN** (a custom metric is already an aggregate → no AGG wrapper). When a real column is selected, the aggregation selector behaves exactly as today.
- Custom metrics always appear regardless of the metric picker's numeric-only / drilldown-safe column filter (they are aggregate expressions, not typed columns).

### Selection identity + SQL emission (the trickiest coexistence)
- A metric selection must distinguish **custom (references the Phase 99 opaque metric `id`)** vs **real column (`column` + `aggregation`)**. Config stores a reference that carries the metric `id` for custom selections (planner picks the concrete shape — e.g. a `metricId`/`kind` marker on the single-metric fields and on each `metrics[]` entry for timeline/numeric-line; a sentinel-encoded value is acceptable if cleaner).
- **SQL builders branch:** custom → emit the metric's raw `expression` with NO `AGG(...)` wrapper; real column → `AGG(column)` exactly as today. Applies at every emission site: `ChartConfigPanel` generatedSql (scalar + grouped), `buildCalendarSql`, `buildTimelineSql`, `buildNumericLineSql`.
- **Resolve id → expression at SQL-build time** by reading `customMetricsStore.selectMetrics(tableId)`. Config stores the id; the builder resolves the CURRENT expression — so editing a metric's expression flows through to every widget automatically (rename-safe + edit-safe, per the Phase 99 id-keying decision).

### Editor UX
- New `CustomMetricsEditorModal`, reached from the Tables area the same way as the Column Format editor (a button on `DatasetsPage.tsx` `TableDetail`, mirroring the "Format columns" trigger).
- **Two-pane layout mirroring `ColumnFormatEditorModal`**, adapted to a growable CRUD list: left pane = the table's custom metrics + an "Add metric" affordance; right pane = the edit form.
- Form fields: **label**, **SQL aggregate expression** (textarea), and an **optional default format** (reuse the v1.15 `FormatSpec` editor / `FormatSpecEditor`). Validation = non-empty label + non-empty expression client-side; server enforces unique-label-per-table (surface the 409 as an inline error).
- **No live SQL preview** (would require executing a query) — deferred.
- Load/save via the Phase 99 `customMetricsStore` + API client fns (`listCustomMetrics`/`createCustomMetric`/`updateCustomMetric`/`deleteCustomMetric`), mirroring how `ColumnFormatEditorModal` uses `columnDisplayConfigStore` + its api client.

### Picker scope
- Integrate into ALL metric-configuring widgets: `ChartConfigPanel` (bar / pie / line / area / big-number), `CalendarConfigPanel`, `TimelineConfigPanel` + `NumericLineConfigPanel` (including their multi-metric `metrics[]` rows). **Scatter excluded** (no metric picker). Column-list augmentation happens at each panel's `allColumns` / `metricColumns` memo (append `selectMetrics(tableId)`).

### Orphaned / deleted / edited metrics
- Widgets reference the metric by `id`. **Edits** (label/expression/format) flow through automatically (builder resolves the live expression at build time).
- **Deletion:** if a widget references a metric id that no longer exists, the picker shows a **"(deleted metric)"** marker and the widget falls back to its EXISTING error/empty state until reconfigured — no crash, no silent fallback. Consistent with the app's dangling-target handling (v1.11 radio actions: typed no-op). NO cross-dashboard reference scan / NO block-on-delete.

### Backward-compat (success criterion 4)
- Widgets using ONLY real columns emit byte-identical SQL and behave identically. Lock with tests (a real-column widget's generated SQL is unchanged; the custom branch only activates when a custom metric is selected).

### Claude's Discretion
- Concrete config shape for the custom-vs-real marker (metricId + kind field vs sentinel-encoded metricColumn) at each picker site.
- Whether the selected custom metric's optional `format_spec` is applied to the rendered value this phase (nice loop-closure with v1.15 formatting) or left to the existing column-format system — lightweight; not a hard requirement of METRIC-V119-03/04.
- Exact optgroup/section styling (reuse existing select/optgroup + config-group conventions; NO invented classNames).

</decisions>

<specifics>
## Specific Ideas

- "These custom metrics need to be selectable in the visualizations which configure metrics." → they appear in every metric picker, grouped + labeled, and emit their expression directly.
- A custom metric = a labeled SQL aggregate (e.g. `SUM(revenue)/SUM(cost)`) applied with NO further aggregation wrapper.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.** No external specs — canonical sources are the Phase 99 foundation + the v1.15 column-format precedent to mirror:

### Requirements
- `.planning/REQUIREMENTS.md` §"Custom Metrics per Table (METRIC)" — METRIC-V119-01 (UI half here), -03 (appear in pickers), -04 (emit expression, no extra aggregation).
- `.planning/ROADMAP.md` §"Phase 100" — goal, invariant (NO extra AGG wrapper), 4 success criteria.

### Phase 99 foundation (consume, do not modify)
- `.planning/phases/99-custom-metrics-server-store-foundation/99-CONTEXT.md` — the id-keyed model, `format_spec`, store shape.
- `packages/web/src/store/customMetricsStore.ts` — `useCustomMetricsStore`, `selectMetrics(tableId)`, `loadConfig`, mutators.
- `packages/web/src/api/client.ts` — `CustomMetricRow` + `listCustomMetrics`/`createCustomMetric`/`updateCustomMetric`/`deleteCustomMetric` (~1615–1670).

### v1.15 precedents to mirror (from codebase scout)
- `packages/web/src/components/ColumnFormatEditorModal.tsx` — two-pane modal structure (~276–323), load (~86), save via store+api (~201–206), CSS classes (`modal-overlay`, `modal-content`, two-pane `modal-left`/`modal-right`, etc.).
- `packages/web/src/components/DatasetsPage.tsx` — `TableDetail` (~124–192), "Format columns" button (~135–136) + modal render (~184–189) = the reach pattern for the new editor.
- `packages/web/src/lib/columnFormatter.ts` `FormatSpec` union + the v1.17-extracted `FormatSpecEditor` (reused for the optional metric format).

### Metric-picker + SQL-emission sites to integrate (from scout)
- `packages/web/src/components/charts/ChartConfigPanel.tsx` — metric+agg picker (~597–627), `allColumns` memo (~210–216), generatedSql AGG emission (~320–323 scalar, ~331–333 grouped).
- `packages/web/src/components/charts/CalendarConfigPanel.tsx` — metric+agg (~466–500), `metricColumns` (~212–222); `packages/web/src/lib/buildCalendarSql.ts` `aggExpr` (~50–55, emit ~93).
- `packages/web/src/components/charts/TimelineConfigPanel.tsx` (`metrics[]`, `metricColumns` ~116–126) + `packages/web/src/lib/buildTimelineSql.ts` `aggExpr` (~55–60, emit ~93).
- `packages/web/src/components/charts/NumericLineConfigPanel.tsx` (`metrics[]`, `metricColumns` ~108–117) + `packages/web/src/lib/buildNumericLineSql.ts` `aggExpr` (~47–52, emit ~90).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ColumnFormatEditorModal.tsx` + its CSS — mirror for `CustomMetricsEditorModal` (two-pane, store+api load/save). `DatasetsPage.tsx` TableDetail — mirror the button+modal reach.
- `customMetricsStore` (`selectMetrics`, `loadConfig`, mutators) + api client CRUD — already built (Phase 99).
- `FormatSpecEditor` / `FormatSpec` (v1.15/v1.17) — for the optional metric format.
- Existing `aggExpr` helpers in the 3 builders + the inline AGG in ChartConfigPanel — the branch points for custom (raw) vs real (wrapped).

### Established Patterns
- Column-list memos (`allColumns`/`metricColumns`) per panel — the injection point to append custom metrics.
- Config `configVersion`-reactive rebuild of generatedSql; renderers resolve at build time.
- Dangling-reference graceful handling precedent: v1.11 radio actions (typed no-op) — mirror for deleted-metric orphans.

### Integration Points
- New `CustomMetricsEditorModal` + `DatasetsPage` trigger; augment 4 config panels' column lists + metric-selection UI (custom group + hide-agg); branch the 4 SQL-emission sites (custom → raw expression via `selectMetrics` resolution). NO server changes.

### Invariants
- `AggregatedWidgetRenderer` stays the SOLE materialize trigger (config + read-time SQL fragment only). Custom metric emitted with NO extra AGG wrapper. Real-column widgets byte-identical (criterion 4). Reuse existing classNames; theme tokens only. FRONTEND-ONLY (flag any server diff).

</code_context>

<deferred>
## Deferred Ideas

- Live SQL preview in the editor (execute the expression for a sample value) — deferred; validation is non-empty + server unique-label only.
- Block-on-delete / cross-dashboard reference tracking for custom metrics — deferred; orphans handled gracefully with a "(deleted metric)" marker.
- Row-level computed columns (METRIC-V2-01) + per-dashboard metric overrides (METRIC-V2-02) — future milestone.

</deferred>

---

*Phase: 100-custom-metrics-tables-area-editor-metric-picker-integration*
*Context gathered: 2026-07-01*
