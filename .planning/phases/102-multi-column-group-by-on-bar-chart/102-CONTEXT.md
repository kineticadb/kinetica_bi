# Phase 102: Multi-Column Group-By on Bar Chart - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Extend the bar chart from a single group-by column to an ordered list of N group-by columns (deploy-time env-var capped), rendered nested/hierarchically as colored series with a grouped (clustered) vs stacked toggle. Reuses the existing timeline/numeric-line series machinery (`groupedSeries.ts` `selectTopSeries`/`pivotSeriesRows`, ColorBrewer cycling). BOTH-stack (tiny server touch for the env var on `/api/auth/me`); the feature logic is web-only.

Covers: BARGRP-V119-01 (pick >1 column), BARGRP-V119-02 (nested render + grouped/stacked toggle), BARGRP-V119-03 (env-var series cap, truncate+warn), BARGRP-V119-04 (0/1 column byte-identical).

</domain>

<decisions>
## Implementation Decisions

### X-axis vs series decomposition
- **Column 1 → x-axis categories.** Columns 2..N combined (compound key) → colored series, rendered clustered or stacked within each x-axis category.
- Generalizes cleanly: 1 column = today's single-series bar (byte-identical); 2 columns = classic grouped/stacked bar (x = col1, series = col2 values); 3+ columns = x = col1, series = compound of col2..N.
- recharts has NO native multi-level nested x-axis — the "nested/hierarchical" render is achieved via this x-category + series-split decomposition (multiple `<Bar>` series), NOT stacked axis ticks.

### Env-var cap (BARGRP-V119-03)
- The single deploy-time env var caps the **number of resulting SERIES** rendered, default **~12** (mirror timeline `MAX_SERIES=12`). Over-cap → keep the **top-N series by aggregate value** + show a truncation warning (badge/note) — graceful, never a crash/fail-fast.
- Column count is naturally bounded (available columns) — the env var is a SERIES cap, not a column cap. (A sane hard column limit, if any, is a plain constant, not the env var.)
- Env-var plumbing MIRRORS `ttlKeepaliveLeadMinutes` / `MAX_COMBINATION_VIEWS_PER_TABLE`: `readPositiveIntEnv(name, default)` at boot (fallback+warn on invalid) → exposed on `GET /api/auth/me` → `MeResponse` type + defensive `fetchMe` coalesce → web auth store field. This is the phase's server touch (→ BOTH-stack). Pick a name like `MAX_BAR_GROUP_BY_SERIES` (Claude's discretion).

### Grouped vs stacked toggle + backward-compat
- **Reuse the existing bar `stacked` config boolean** as the grouped(false) / stacked(true) toggle for multi-series (it is a no-op with a single series today, so repurposing is clean). Multiple `<Bar>` get `stackId` when `stacked === true`, none when grouped.
- **Backward-compat (BARGRP-V119-04):** absent `groupByColumns` OR length ≤ 1 → the EXISTING single-`groupByColumn` SQL + single-`<Bar>` render path, byte-identical, regardless of the `stacked` flag. Lock with a test.

### Series order, color, labels
- **Top-N by aggregate:** rank series by total aggregate value DESC via the existing `selectTopSeries` (returns `{series, truncated, total}`); keep top-N per the env cap; `truncated` drives the warning.
- **Color:** cycle ColorBrewer palette via the existing `ensureColor`/`themeColorsFor` pattern (per series index).
- **Label:** a compound series is labeled by joining the remaining columns' values with `" / "` (e.g. `West / A`). Legend shows these.

### Config + SQL model
- Add an optional ordered `groupByColumns?: string[]` to the bar config (keep the existing `groupByColumn` path for the ≤1 case / migration — planner picks exact shape). Multi-column UI = the add/remove-row builder pattern from `NumericLineConfigPanel` metrics[] (adapted to columns).
- Multi-column SQL: `SELECT col1, col2, …, AGG(metric) AS value FROM <t><customWhere> GROUP BY col1, col2, … ORDER BY value DESC LIMIT <?>`. Renderer pivots rows → recharts (x = col1, series = compound col2..N) via `pivotSeriesRows`, then applies the series cap.
- Bar SQL is baked into `config.sql` at config-save (ChartConfigPanel `generatedSql`); the renderer (`WidgetRenderer` bar path) reads `config.groupByColumns` to pivot the result. Custom WHERE (Phase 98 `whereCustomWhere`) still applies.

### Claude's Discretion
- Exact config field shape/migration (`groupByColumns` vs extending `groupByColumn`); env var name; warning UI (reuse an existing hint/badge class — NEVER invent a className).
- Series-cap application site (client-side after pivot, mirroring timeline) vs SQL.

</decisions>

<open_considerations>
## Open Implementation Consideration (flag for research/planning)

**Row-LIMIT vs series-cap interaction (the trickiest part):** the existing single-group-by `LIMIT` (`ALLOWED_LIMITS`, default 100) bounds SQL rows. With multi-column `GROUP BY col1, col2, …`, a naive `ORDER BY value DESC LIMIT 100` can STARVE the x-category × series grid (it may return only some (col1,col2) combos, dropping series for some x categories). The planner/researcher must resolve the LIMIT strategy so the pivot has enough rows to populate all shown x-categories × top-N series — e.g. bound x-categories by the existing `limit` (top-N primary groups) and fetch enough combination rows, applying `selectTopSeries` client-side for the series cap (mirroring how TimelineRenderer does `selectTopSeries` on returned rows). Recommend enabling research for this phase to lock the SQL/limit/pivot approach before planning.

</open_considerations>

<specifics>
## Specific Ideas

- User's framing: "The bar chart need a way to group by multiple columns" → arbitrary N, env-capped, nested, designer grouped-vs-stacked toggle (milestone questioning).

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.** No external specs — canonical sources are the existing group-by + env patterns:

### Requirements
- `.planning/REQUIREMENTS.md` §"Multi-Column Group-By on Bar Chart (BARGRP)" — BARGRP-V119-01/02/03/04.
- `.planning/ROADMAP.md` §"Phase 102" — goal, invariant (env-var cap boot-read fallback+warn; graceful over-cap), 4 success criteria; the BOTH-stack note.

### Reuse patterns (from codebase scout)
- `packages/web/src/lib/groupedSeries.ts` — `selectTopSeries` (~56-76, rank+top-N `{series,truncated,total}`), `pivotSeriesRows` (~93-127, flat→keyed rows), `MAX_SERIES` (~23).
- `packages/web/src/components/charts/TimelineRenderer.tsx` — series split + `ensureColor`/ColorBrewer cycling (~93-98), `selectTopSeries` usage (~58, 117-140) — the rows→series pivot+cap+color pattern to mirror.
- `packages/web/src/components/charts/NumericLineConfigPanel.tsx` — the add/remove-row `metrics[]` builder (~150-250) = the N-columns config UI pattern to adapt.
- `packages/web/src/components/charts/ChartConfigPanel.tsx` — bar config fields (~270-286), the single group-by control (~715-734), grouped `generatedSql` (~361-385: `SELECT groupByColumn, aggExpr AS value … GROUP BY … ORDER BY value <dir> LIMIT <limit>`), `whereCustomWhere` injection (~318).
- `packages/web/src/components/charts/WidgetRenderer.tsx` — bar render path (~860-1050): `resolveKeys` (~822-828), `<BarChart>`/`<Bar dataKey="value">` (~1007-1045), drill-down `resolveAggregatedDrillTarget` (~925).

### Env-var → /api/auth/me → store chain to mirror
- `packages/server/src/index.ts` — `readPositiveIntEnv` (~162-173); env consts (`TTL_KEEPALIVE_LEAD_MINUTES` ~175, `MAX_COMBINATION_VIEWS_PER_TABLE` ~180); `/api/auth/me` payload (~420).
- `packages/web/src/api/client.ts` — `MeResponse` type (~251) + defensive `fetchMe` coalesce (~288-292).
- `packages/web/src/store/auth.ts` — cap state fields (~16-20) + bootstrap set (~49-52).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `groupedSeries.ts` `selectTopSeries` + `pivotSeriesRows` + `MAX_SERIES` — the series cap + pivot (mirror timeline usage).
- `ensureColor`/`themeColorsFor` (ColorBrewer) — series coloring.
- `NumericLineConfigPanel` metrics[] add/remove-row builder — the multi-column config UI.
- `readPositiveIntEnv` + the `/api/auth/me` → `MeResponse` → `auth.ts` chain — the env-var cap exposure.

### Established Patterns
- Bar SQL baked into `config.sql` at save (ChartConfigPanel `generatedSql`); renderer reads config to pivot. `stacked` boolean already present (repurpose). `whereCustomWhere` (Phase 98) still applies. Drill-down on the primary group column.

### Integration Points
- Config: add `groupByColumns?: string[]` + N-column builder UI to the bar config; env cap read from auth store.
- SQL: multi-column `GROUP BY` in `generatedSql`.
- Renderer: `WidgetRenderer` bar path pivots rows → N `<Bar>` series (x=col1, series=col2..N), `stackId` when stacked, top-N cap + truncation warning, palette + compound labels.
- Server: new env var on `/api/auth/me` (BOTH-stack).

### Invariants
- `AggregatedWidgetRenderer` stays SOLE materialize trigger; pure config + render + SQL-string (no new materialize). 0/1 column → byte-identical (BARGRP-V119-04). Env cap boot-read fallback+warn; over-cap graceful truncate+warn. Reuse classNames; theme tokens only.

</code_context>

<deferred>
## Deferred Ideas

- Multi-column group-by on OTHER chart types (pie/line/timeline) — out of scope (this phase is bar-only).
- True multi-level nested x-axis ticks (grouped axis labels) — out of scope; nesting is via series split.
- A per-series manual color/label editor for compound series — out of scope (auto palette + auto ' / ' labels).

</deferred>

---

*Phase: 102-multi-column-group-by-on-bar-chart*
*Context gathered: 2026-07-01*
