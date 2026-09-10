# Phase 77: Apply Labels + Formatting at Render Surfaces - Context

**Gathered:** 2026-06-20
**Status:** Ready for planning
**Source:** Autonomous run — decisions by Claude per operator's "execute 75–78 without my input" directive. All resolution rules surfaced here for later review.

<domain>
## Phase Boundary

Inject the resolved display LABEL (`resolveLabel(tableId, col)`) and value FORMATTER (`resolveFormatter(tableId, col)`) from the Phase 75 store into the read-path render surfaces:
- **Records Table** — headers = label, cells = formatted value
- **Chart tooltips** (values formatted) + **chart axis titles** + **in-chart series legends** (custom label)
- **Map info popups** — both template `{column}` substitution mode AND key/value mode (label + formatted value)

…while leaving the **map layers legend (`LayersLegendPanel`) UNAFFECTED** (locked by an explicit test).

**FRONTEND-ONLY** (`packages/web`). This is READ-PATH label/format injection only — NO new materialize calls; `AggregatedWidgetRenderer` remains the SOLE materialize trigger. No server diff (flag any as a defect).

**NOT in scope:** the keep-alive (Phase 78); the editor (Phase 76, done); any change to what SQL is sent (formatting is client-side only).

</domain>

<decisions>
## Implementation Decisions

### The tableId resolution rule (CRITICAL — keys every resolveLabel/resolveFormatter call)
- **Records table + chart widgets:** `tableId = widget.config.tableId as number | undefined` (the canonical field, `WidgetRenderer.tsx:1598` / `:373`). If a widget is dynamic-view-bound (`tableId` undefined, `dynamicViewId` set), there is NO client-side source-table mapping → pass `undefined`. `resolveLabel`/`resolveFormatter` already fall back to raw name / identity when `tableId` is undefined or has no config — that's the ACCEPTED behavior for dv-bound widgets this phase (no extra plumbing to chase the dv's source_table_id).
- **Map info popups:** `tableId = layer.table_id` (always defined — layers are always table-bound, `InfoSelectionView.tsx:215`).

### configVersion reactivity (so edits in the Phase 76 editor re-render live surfaces)
- Every renderer that calls resolve* MUST subscribe to `useColumnDisplayConfigStore((s) => s.configVersion)` (primitive selector) and include it in the relevant `useMemo`/render path — mirroring the `filterVersion` / `dynamicViewVersion` primitive-selector pattern (e.g. `LegendRenderer` dynamicViewVersion, `WidgetRenderer` filterVersion at `:394`). This is the canonical re-render trigger.
- Also `loadConfig(tableId)` should be invoked when a surface first needs a table's config (on mount / when tableId becomes known), so the cache is populated. Guard against redundant loads (load once per tableId; the store caches).

### Records Table (COLAPPLY-V115-01)
- **Header** (`WidgetRenderer.tsx:2134`/`:2144`): render `resolveLabel(tableId, col)` instead of raw `col`. Keep the existing sort-arrow affordance; only the displayed text changes.
- **Cell** (`:2185`/`:2186`): render `resolveFormatter(tableId, col)(row[col])` (then `String(... ?? "")`). Raw fallback for columns with no config (built into the formatter).
- Subscribe to `configVersion`.

### Charts (COLAPPLY-V115-02)
Data is server-AGGREGATED (`SELECT <groupByColumn>, AGG(<metricColumn>) AS value`). The real, resolvable column names are `config.groupByColumn` (category/x) and `config.metricColumn` (the metric's source column); `value` is a synthetic alias. Apply:
- **Custom Tooltip content component** (replaces the bare `<Tooltip {...RECHARTS_TOOLTIP_PROPS} />` spread; keep `RECHARTS_TOOLTIP_PROPS` for styling): show the category via `resolveLabel(tableId, groupByColumn)` and FORMAT the numeric value via `resolveFormatter(tableId, metricColumn)`. (Formatting the metric's formatter over an aggregate is correct — e.g. SUM of a currency column is still currency.)
- **In-chart series legend label** (`name={config.yFieldLabel || y}` at `:1066`/`:1181`/`:1202`): fall back chain → `config.yFieldLabel || resolveLabel(tableId, metricColumn) || y`. (User-set `yFieldLabel` still wins.)
- **Axis titles** (`xAxisLabel`/`yAxisLabel`, user-entered): when the user has NOT set an explicit axis label, fall back to `resolveLabel(tableId, groupByColumn)` for the X title and `resolveLabel(tableId, metricColumn)` for the Y title; if the user set one, it wins. (Do NOT format axis titles — they're labels, not values.)
- **Where a column is not resolvable** (no `groupByColumn`/`metricColumn` in config, or dv-bound undefined tableId): keep CURRENT behavior (raw key / existing fallback). Never break legacy widgets.
- Apply across the chart renderers that share these props (Bar/Line/Pie/Scatter in WidgetRenderer + TimelineRenderer + NumericLineRenderer). Subscribe to `configVersion` at the AggregatedWidgetRenderer level (or per renderer) so tooltips/legends re-render on edit.

### Map info popups (COLAPPLY-V115-03)
- **Template mode** (`renderInfoTemplate.ts:48`): the `{column}` substitution should emit `resolveFormatter(tableId, col)(value)` instead of raw `String(v)`. `renderInfoTemplate` is a pure lib — pass the formatter (or a `(col,value)=>string` resolver) IN as an argument rather than importing the store into the lib (keep the lib pure). The caller (`InfoSelectionView`) supplies it with `layer.table_id` bound.
- **KV mode** (`InfoSelectionView.tsx:441-442`): key cell shows `resolveLabel(layer.table_id, col)`; value cell shows `formatKvValue(resolveFormatter(layer.table_id, col)(value))`.
- Subscribe to `configVersion` in `InfoSelectionView`.

### Legend exclusion (COLAPPLY-V115-04 — LOCKED)
- `LayersLegendPanel` must remain purely presentational (renders layer name + break swatch/label/value — NO column data). Do NOT add any resolveLabel/resolveFormatter call or tableId prop to it.
- Add an explicit GUARD TEST asserting the panel renders break/layer config verbatim and does NOT apply column label/formatting (e.g. a column with a saved display-config label/format renders UNCHANGED in the legend).

### Theme / invariants (LOCKED)
- Theme tokens only, NO raw hex. The custom Tooltip component must pass theme-guard WITHOUT allowlisting (use `var(--…)` for any styling, or reuse `RECHARTS_TOOLTIP_PROPS` style values).
- NO new materialize calls — `AggregatedWidgetRenderer` stays the sole trigger. Confirm via the existing static-import grep convention (no `materializeFilter`/`fromSwap`/`dropFilterView` added to touched files).

### Claude's Discretion
- Exact custom Tooltip component name/location + whether it's shared across renderers.
- Whether `renderInfoTemplate` takes a `formatValue(col,value)` callback or a formatter map (prefer a callback to keep it pure + testable).
- Plan/file split across the surfaces and the exact test breakdown.
- Whether to memoize resolved labels or call inline (inline is fine given configVersion-driven re-render).

</decisions>

<specifics>
## Specific Ideas

- Keep the formatter/label resolution OUT of pure libs (`renderInfoTemplate.ts`) — inject via callback so the lib stays store-free and unit-testable.
- The dv-bound "no tableId → raw fallback" behavior is intentional and acceptable this phase; do not over-engineer source-table lookup.
- Mirror the established primitive-version-selector reactivity pattern exactly — it's how every other live-updating surface in this app works.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 75 helpers (the injection source)
- `packages/web/src/store/columnDisplayConfigStore.ts` — `resolveLabel(tableId, col)`, `resolveFormatter(tableId, col)`, `loadConfig(tableId)`, `configVersion`. resolve* already fall back (label→raw name, formatter→identity) when no config / undefined tableId.

### Render surfaces (exact sites)
- `packages/web/src/components/charts/WidgetRenderer.tsx` — RecordsTableRenderer (`:1582`+; headers `:2134/:2144`, cells `:2185/:2186`; `tableId` at `:1598`); chart renderers (Bar/Line/Pie/Scatter) with series `name=` at `:1066/:1181/:1202`; `config.groupByColumn` (`:1423`), `config.metricColumn` (`:1425`); `filterVersion` reactivity precedent at `:394`.
- `packages/web/src/lib/chartTheme.ts:20` — `RECHARTS_TOOLTIP_PROPS` (style only; needs a custom content component to format values).
- `packages/web/src/components/charts/TimelineRenderer.tsx`, `NumericLineRenderer.tsx` — also consume the tooltip props; apply consistently.
- `packages/web/src/lib/renderInfoTemplate.ts:43-53` — template `{column}` substitution (pure lib — inject formatter via callback).
- `packages/web/src/components/charts/InfoSelectionView.tsx:215` (`layer.table_id`), `:370`+ KV mode, `:441-442` (key/value cells), `formatKvValue` at `:478`.
- `packages/web/src/components/LayersLegendPanel.tsx` — EXCLUDED surface (guard test target; PANEL-V17-01 presentational lock).

### Reactivity precedent
- `packages/web/src/components/charts/LegendRenderer.tsx` — `dynamicViewVersion` primitive-selector + useMemo dep pattern to mirror for `configVersion`.

### Requirements
- `.planning/REQUIREMENTS.md` — COLAPPLY-V115-01 (records), -02 (chart tooltip+axes+series), -03 (map popups both modes), -04 (legend exclusion, test-locked).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `resolveLabel`/`resolveFormatter`/`loadConfig`/`configVersion` (Phase 75) — the whole resolution layer exists; this phase only wires call sites.
- `RECHARTS_TOOLTIP_PROPS` (styling) — keep for the custom Tooltip's container style.
- The primitive-version-selector reactivity pattern (filterVersion/dynamicViewVersion) — copy for configVersion.

### Established Patterns
- Renderers subscribe to store version counters via primitive selectors and include them in useMemo/effect deps to re-render on change.
- Pure libs (`renderInfoTemplate.ts`) take data/callbacks as args — no store imports.
- `LayersLegendPanel` is a locked presentational component (no store, props-only).
- Static-import grep guards keep `AggregatedWidgetRenderer` the sole materialize trigger.

### Integration Points
- WidgetRenderer (records headers/cells + chart tooltip/axes/series), TimelineRenderer, NumericLineRenderer.
- renderInfoTemplate.ts (callback param) + InfoSelectionView (template + KV).
- LayersLegendPanel.spec.tsx (new guard test).
- No server, no new materialize.

</code_context>

<deferred>
## Deferred Ideas

- Resolving a dv-bound widget's underlying source_table_id client-side so dv-bound widgets also get labels/formatting — deferred (would need new client plumbing; raw fallback is acceptable now).
- Formatting aggregated values with awareness of the aggregation (e.g. COUNT should maybe be integer regardless of the metric column's format) — out of scope; apply the metric column's formatter as-is. Revisit only if it looks wrong in UAT.

</deferred>

---

*Phase: 77-apply-labels-formatting-at-render-surfaces*
*Context gathered: 2026-06-20 (autonomous)*
