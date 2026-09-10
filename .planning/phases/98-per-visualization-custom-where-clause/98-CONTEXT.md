# Phase 98: Per-Visualization Custom WHERE Clause - Context

**Gathered:** 2026-06-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Add a per-widget config field holding a raw-SQL WHERE predicate that is injected into each plain-SQL widget's OWN read query — ANDed on top of the v1.18 filter-combination materialized view the widget already reads. Applies to all plain-SQL widget types; excludes map/WMS layers. Config + read-query injection only; NO new SQL/materialize path. Empty/absent WHERE must be byte-identical to current behavior.

Covers: VIZSQL-V119-01 (config field + persistence), VIZSQL-V119-02 (ANDed on top of filters), VIZSQL-V119-03 (empty = byte-identical), VIZSQL-V119-04 (invalid WHERE isolated to the widget).

</domain>

<decisions>
## Implementation Decisions

### Input format + framing
- The user types a **bare SQL predicate** (e.g. `status = 'active'`), NOT a full `WHERE ...` clause.
- The app injects it **parenthesized**: emit `WHERE (<predicate>)` when the widget's query has no existing WHERE (aggregated charts, records page-fetch), or ` AND (<predicate>)` when one already exists (e.g. timeline/numeric-line `WHERE <timeCol> IS NOT NULL`, calendar `WHERE <timeCol> IS NOT NULL`). The parenthesization is mandatory so mixed AND/OR predicates bind correctly.
- One shared field across all in-scope widgets — label something like "Custom filter (SQL)" with a hint (e.g. "Raw SQL predicate ANDed with active filters, e.g. `region = 'West'`"), placed in an **Advanced / Query** group so it doesn't crowd the common config. Use the existing `ConfigField` registry pattern + the established config-group UI conventions (`config-group` / `config-group-label`, `ds-field` / `ds-field-label`). Reuse existing classNames only.

### Validation + error UX
- **No client-side SQL validation/parser** (explicitly out of scope per REQUIREMENTS — raw SQL is trusted to the designer, bounded by the user's own Kinetica creds).
- A bad WHERE makes the widget's query fail; surface the **Kinetica server error message in the existing per-widget `widget-error` div / error state** (each renderer already has an `error` useState). The error is isolated to that widget — the rest of the dashboard keeps rendering (VIZSQL-V119-04).
- On error, show the error state (do NOT keep stale last-good data) — matches the existing renderer behavior.

### Widget scope
- **Included (all plain-SQL widgets):** calendar, line, timeline, numeric-line, pie, bar, records table, big number, **scatter**.
- **Excluded:** no-SQL widgets (data filter, info-card, legend, radio group) and **map / WMS layers** (separate WMS-param render path — deferred to VIZSQL-V2-01).

### Combination with filters (v1.18 model)
- The custom WHERE lives **only in the widget's own read query** — appended to the widget's SELECT against the shared per-combination view. It **always applies**, independent of the widget's per-viz filter selection (v1.18).
- It does **NOT** alter which materialized view is created/shared: the v1.18 combination key is unchanged, no new materialize is triggered, `AggregatedWidgetRenderer` stays the sole materialize trigger, view dedup is preserved. (Folding the custom WHERE into a per-widget materialized view was explicitly REJECTED.)
- Net effect: the custom WHERE is a pure additive constraint layered on top of the already-filtered view — "ANDed against the same materialized view" in the semantic sense.

### Backward-compat (VIZSQL-V119-03)
- Empty/absent custom WHERE → the emitted SQL is byte-identical to current behavior at every read path. Lock with an explicit test per path (or a representative subset covering both the aggregated path and the own-SQL builders).

### Claude's Discretion
- Exact field key name (e.g. `customWhere`), label/hint wording, and whether the Advanced/Query group is collapsible.
- Whether to add the field once via a shared mechanism vs per chart definition — pick the lowest-duplication approach given the two SQL paths (aggregated via ChartConfigPanel-generated `config.sql`; own-SQL via the `buildXSql` builders + RecordsTableRenderer).
- The precise WHERE-vs-AND splicing per builder (must respect each path's existing clause).

</decisions>

<specifics>
## Specific Ideas

- "An input field — if the user puts anything in there it should be included in the SQL call." Raw passthrough, designer power-user feature for per-widget data customization.
- The custom WHERE is additive on top of drill-down + per-viz filter selection, not a replacement.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

No external specs/ADRs. Requirements + the existing read-path code are the canonical sources:

### Requirements
- `.planning/REQUIREMENTS.md` §"Per-Visualization Custom WHERE Clause (VIZSQL)" — VIZSQL-V119-01/02/03/04 + the "Sandboxing / parsing of user SQL" Out-of-Scope row.
- `.planning/ROADMAP.md` §"Phase 98: Per-Visualization Custom WHERE Clause" — goal, invariant, 4 success criteria.

### Prior milestone context (v1.18 combination model — relevant to "ANDed against the same view")
- `.planning/STATE.md` §"v1.18 Key Architectural Decisions" — `filterCombinationStore`, the per-combination materialized-view FROM-swap (read paths A/B), and the sole-materialize-trigger invariant the custom WHERE must NOT disturb.

</canonical_refs>

<code_context>
## Existing Code Insights

### SQL read paths (where to inject the WHERE) — from codebase scout
- **Aggregated widgets (bar, pie, line, big-number, aggregated table):** SQL is generated in `packages/web/src/components/charts/ChartConfigPanel.tsx` (~lines 294–334) and stored in `widget.config.sql` at save time; executed by `AggregatedWidgetRenderer` in `packages/web/src/components/charts/WidgetRenderer.tsx` (~lines 377–661), with `fromSwap(sql, viewName)` swapping the FROM at render. Aggregated SELECTs have NO existing WHERE → inject `WHERE (<predicate>)` before `GROUP BY`.
- **Timeline:** `packages/web/src/lib/buildTimelineSql.ts` (~lines 81–98) — already emits `WHERE <timeCol> IS NOT NULL [AND ...]`; inject ` AND (<predicate>)`. Executed by `TimelineRenderer.tsx` (owns lifecycle).
- **Numeric-line:** `packages/web/src/lib/buildNumericLineSql.ts` (~lines 80–100) — same pattern; `NumericLineRenderer.tsx`.
- **Calendar:** `packages/web/src/lib/buildCalendarSql.ts` (~lines 67–91) — emits `WHERE <timeCol> IS NOT NULL`; inject ` AND (<predicate>)`. Caller (`CalendarRenderer.tsx`) pre-resolves `fromTarget` BEFORE building SQL (the no-fromSwap-in-renderer rule) — thread `customWhere` as a builder arg, do not post-process the string.
- **Records table:** `RecordsTableRenderer` in `WidgetRenderer.tsx` (~line 1857) builds the page-fetch SQL (`SELECT ... FROM <fromSource>[ORDER BY] LIMIT/OFFSET`) — no existing WHERE → inject `WHERE (<predicate>)` before ORDER BY/LIMIT.
- **Scatter:** routes through `AggregatedWidgetRenderer` (same as bar/pie/line).

### Config field pattern
- `packages/web/src/components/charts/registry.ts` (~lines 23–38) — `ConfigField` type (text/textarea/number/boolean/select/...). Add a `textarea`/`text` field to the in-scope chart definitions (`definitions/*.ts`) and/or the relevant CustomConfigPanels (timeline, numeric-line, calendar). Value persists into `widget.config` on Apply and reads back as `cfg.customWhere` in renderers.

### Error handling pattern
- Every renderer has a per-widget `error` useState + a `widget-error` div (e.g. `WidgetRenderer.tsx` ~line 380 / ~line 739; `RecordsTableRenderer` ~line 1683). Kinetica errors (`status:"ERROR"`) are caught and routed to `setError` — the custom-WHERE failure path reuses this; no new error UI needed.

### Invariants to preserve (static-grep asserted)
- `AggregatedWidgetRenderer` stays the SOLE materialize trigger; no renderer calls `materializeFilter`/`dropFilterView`. No `fromSwap` introduced where it doesn't already exist (esp. CalendarRenderer — thread `customWhere` as a builder arg, not a string rewrite). Theme tokens only. Reuse existing classNames only (invented classNames silently render unstyled and pass all gates).

</code_context>

<deferred>
## Deferred Ideas

- Custom WHERE on map / WMS layers — out of scope (separate WMS-param render path); already tracked as VIZSQL-V2-01.
- Client-side SQL parsing / sandboxing / a builder UI for the predicate — out of scope (raw SQL trusted to designer, bounded by Kinetica creds).

</deferred>

---

*Phase: 98-per-visualization-custom-where-clause*
*Context gathered: 2026-06-30*
