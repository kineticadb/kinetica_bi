# Phase 44: Data Filter widget - Context

**Gathered:** 2026-05-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Ship a new dashboard widget type, **"Data Filter"** (`type: "datafilter"`), that lets an operator pick filter values from form controls and push those selections into the existing `useFilterStore` so every widget reading the same Kinetica table re-queries through the v1.3 transient materialized-view pipeline. The widget is a **multi-column control panel** — one widget can hold N filter fields, each bound to one column on a chosen base table.

In scope:
- New chart type registered alongside map / info-card / legend with its own short-circuit renderer + CustomConfigPanel.
- Per-column-type control variants (string / numeric / date / boolean) at config time.
- Extension of `ActiveFilter` and the server WHERE builder to support `IN` and `BETWEEN` operators (not just `=` / `IS NULL`).
- Apply button → batched dispatch into `useFilterStore`; widget-local Clear button.

Out of scope (this phase): cross-table filters, widget-target picker (selecting which downstream widgets to narrow), OR semantics across columns, default-value config, persistence of last user selection, operators beyond `=` / `IN` / `BETWEEN`, animated/time-window controls.

</domain>

<decisions>
## Implementation Decisions

### Widget shape
- ONE Data Filter widget holds N configured filter fields (multi-column).
- Each field binds to exactly one column on the widget's base table.
- WKT / geometry columns are **excluded** from the column picker (no filter variants apply).

### Per-column-type control variants

**String columns** — operator picks one of four control kinds at config time:
1. Text input — single value, dispatches `=`.
2. Text input with IN clause — operator types comma-separated values; dispatches `IN (…)`.
3. Dropdown — single value chosen from base-table distinct values; dispatches `=`.
4. Multi-select — multiple values chosen from base-table distinct values; dispatches `IN (…)`.

**Numeric columns** — operator picks one of two:
1. Number input — single value, dispatches `=`.
2. Range — two numeric inputs (min / max) initialized from `/api/column-stats` against the **base table** (NOT the materialized view); dispatches `BETWEEN`.

**Date / timestamp columns** — operator picks one of two at config time:
1. Single date — calendar picker; dispatches `=`.
2. Date range — from / to calendar pickers; dispatches `BETWEEN`.

**Boolean columns** — 3-state toggle (Any / True / False). "Any" means no filter for that column. True / False dispatch `=`.

### Value universe (for dropdowns, multi-selects, numeric range bounds)
- Distinct values for dropdowns / multi-selects come from `/api/top-values` against the **base table** (ignores active filters).
- Min/max for numeric range come from `/api/column-stats` against the **base table**.
- Fetched once on widget mount; **NOT** cascading. This is consistent with the numeric-range rule — values stay stable as the operator filters.

### Apply behavior
- **Explicit Apply button** at the bottom of the widget. Operator stages selections in all controls, then presses Apply.
- One Apply press batches all configured fields into a single materialize cycle (rather than N separate dispatches as the operator types).
- **Initial state on widget mount:** no filter applied; controls show empty / default position; no entries in `useFilterStore` for the configured columns. Dashboard renders unfiltered until the operator hits Apply.

### Reset / Clear
- Widget-scoped **Clear filters** button. Removes only the columns this widget owns from `useFilterStore` and resets the widget's controls. Does NOT touch drill-down chips or other widgets' contributions.

### Combine semantics across configured columns
- Always **AND** across columns within the same widget. Matches the existing `composeWhereClause` behavior — no new OR path.

### Scope of effect
- Same as click-through drill-down today: filters key by `tableId`, every widget reading that table re-queries via the existing materialized-view pipeline.
- No widget-target picker; no per-widget opt-out. Net-zero new architecture for scoping.

### Filter store + WHERE builder extensions (the real architectural work)
- `ActiveFilter.value` (currently `string | number | boolean | Date | null`) extended to also carry:
  - `string[] | number[]` for IN-clause filters
  - `[min, max]` tuples for BETWEEN-clause filters
- `ActiveFilter` gains an `operator` discriminator: `"eq" | "in" | "between" | "isNull"` (default `"eq"` for back-compat with existing drill-down callers).
- Server `whereClause.ts` `buildServerWhereClause` extended to emit:
  - `column IN (val1, val2, …)` for `operator: "in"`
  - `column BETWEEN min AND max` (or `column >= min AND column <= max`) for `operator: "between"`
- Existing scalar-`=` semantics preserved verbatim for drill-down callers (no migration).

### Edge-case resolutions (post-research follow-up, 2026-05-28)
- **Empty multi-select / IN**: if the operator clears all values from a multi-select / IN field before Apply, **skip that field** — drop it from the dispatch and remove the column from `useFilterStore`. Never emit `column IN ()` (invalid Kinetica SQL). UX treats it as "no filter on this column".
- **Top-N cap**: raise `/api/top-values` route validation from `n ≤ 256` to `n ≤ 1000`. Dropdowns / multi-selects may request up to 1000 distinct values. Server cost is bounded by Kinetica's `GROUP BY ... LIMIT 1000`.
- **Filter 10-cap**: when Apply would push the table's filter count over 10, **raise the cap to 25** (a constant in `filterStore.ts`) and let Apply succeed. The cap exists to bound runaway-filter state, not to enforce a tiny limit; multi-column Data Filter widgets legitimately need more headroom.
- **`setBulkFilters` action**: single store action that replaces N column filters in one `set()` call with one `filterVersion` increment — avoids N separate `addFilter` calls producing N materialize cycles. Apply button calls this; existing `addFilter` (single-column) stays for drill-down callers.

### Claude's Discretion
- Exact form layout inside the widget (vertical stack vs grid, label placement).
- Whether multi-select uses a native `<select multiple>` or a small custom popover — pick the one that doesn't pull in a new dependency.
- Dropdown's empty-state row ("(any)" / "—") wording.
- How a dropdown's distinct-value list paginates / virtualizes if a column has thousands of distinct values (use `topValuesFn`'s `n` argument — pick a sensible cap, e.g. 1000, and show "showing top N" hint).
- Whether the IN-text input parses on blur or on Apply press.
- Loading and error states for `/api/top-values` and `/api/column-stats` calls during widget mount.
- Behavior when a configured column is deleted from the underlying table — show an inline warning + skip that field, don't crash the widget.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Filter system (the integration target)
- `kinetica_bi/src/store/filterStore.ts` — `ActiveFilter` type (lines 14–20) and store actions (`addFilter`, `removeFilter`, `clearFilters`, `reset`). The shape this phase extends.
- `kinetica_bi/server/src/lib/whereClause.ts` — `buildServerWhereClause` (lines 71–92). Currently `=` and `IS NULL` only; this phase adds `IN` and `BETWEEN`.
- `kinetica_bi/src/components/charts/WidgetRenderer.tsx` — `dispatchDrillDown` (lines 87–129) and Effect-1 materialize trigger (the path Data Filter Apply must mirror).

### Materialize pipeline (must not be broken)
- `.planning/phases/13-spike-and-endpoint/` — v1.3 materialize endpoint contract.
- `.planning/phases/14-filter-view-store/` — `useFilterViewStore` semantics.
- `.planning/phases/15-chart-filtering/` — sole-trigger invariant: `AggregatedWidgetRenderer` is the ONLY component that calls `POST /api/filter/materialize`. **Data Filter widget must NOT call materialize directly** — it dispatches into `useFilterStore` and lets the existing trigger fire.

### Widget registration pattern (the boilerplate)
- `kinetica_bi/src/components/charts/registry.ts` — `ChartTypeDefinition` shape.
- `kinetica_bi/src/components/charts/definitions/legend.ts` — closest precedent for a widget that uses `CustomConfigPanel` and has no SQL.
- `kinetica_bi/src/components/charts/definitions/info-card.ts` — second precedent (custom renderer, custom config).
- `kinetica_bi/src/components/charts/definitions/index.ts` — registration index.

### Column metadata + value APIs (the data sources)
- `kinetica_bi/src/lib/columnTypes.ts` (lines 47–141) — `NUMERIC_TYPES`, `DATETIME_TYPES`, `BOOLEAN_TYPES`, `normalizeType()`, `inferDataTypeFromColumn()`. Use this to filter the column picker by control kind.
- `kinetica_bi/src/api/client.ts` (lines 1090–1146) — `topValuesFn` (string dropdown population) + `columnStatsFn` (numeric min/max). Both already wired against base-table SQL by the v1.7 class-break work; reuse verbatim.

### FilterBar integration
- `kinetica_bi/src/components/DashboardsPage.tsx` (lines 811–840) — chip rendering. Data Filter widget contributions render as chips here automatically once they hit `useFilterStore`; **no FilterBar code changes required**.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`topValuesFn` / `columnStatsFn`** (`src/api/client.ts:1090-1146`): Drop-in for dropdown population and numeric-range bounds. Already used by Class Break auto-suggest — no new endpoints needed.
- **`normalizeType` + type sets** (`src/lib/columnTypes.ts:47-141`): Use to drive the column-picker filter and per-column control-kind suggestions. NUMERIC / DATETIME / BOOLEAN sets already partition Kinetica's type strings.
- **`useFilterStore.addFilter` / `removeFilter`** (`src/store/filterStore.ts`): The Apply button dispatches into these. Per-column replacement semantics already match what a multi-column filter widget needs.
- **`ZoomRangeSlider.tsx`**: Precedent for a range-style slider component. Inspect before deciding whether to build a numeric-range slider from scratch.
- **Class Break form** (`src/components/charts/CbConfigForm.tsx`): Precedent for a CustomConfigPanel with N-row builder + per-row controls. The Data Filter config UI follows the same shape — list of fields, add/remove rows, per-row column + kind picker.

### Established Patterns
- **Short-circuit renderer pattern** (`WidgetRenderer.tsx:235-250`): `if (widget.type === "datafilter") body = <DataFilterRenderer widget={widget} />`. Mirrors map / records / info-card / legend. The renderer owns its full lifecycle; no AggregatedWidgetRenderer path.
- **CustomConfigPanel pattern** (`ChartConfigPanel.tsx:332-336`): Definition exposes `CustomConfigPanel?: React.ComponentType<…>` to bypass the generic field-rendering path entirely. Legend and Map use this.
- **Sole materialize trigger** (`AggregatedWidgetRenderer` only): Critical invariant — Data Filter must dispatch into `useFilterStore` and let the existing materialize trigger fire via filterVersion tick. Never call `materializeFilter` directly from this widget.
- **300ms drill-down debounce** (`dispatchDrillDown`): Apply button can re-use the same sequencing — dispatch into store, let the existing effect chain handle materialize → re-query.

### Integration Points
- **`registerAllChartTypes()`** (`src/components/charts/definitions/index.ts`): Add `registerDataFilter()` call alongside the existing 11 types.
- **Visualization picker modal** (`DashboardsPage.tsx:1025-1058`): Pulls from `getAllChartTypes()` — auto-includes the new type once registered. No picker code changes.
- **Filter store + WHERE builder**: Extending these is the **biggest non-trivial work item**. The codebase explicitly defers IN / BETWEEN to "v2" — this phase IS that v2. Touch points: `filterStore.ts`, `whereClause.ts`, `whereClause.spec.ts`, materialize-route supertests, and any drill-down callers that construct `ActiveFilter` literals (add the optional `operator` discriminator with `"eq"` default for back-compat).
- **No FilterBar changes**: Once Data Filter dispatches into `useFilterStore`, chips render automatically. Multi-value (IN) and range (BETWEEN) chip text formatting is the only new wrinkle — extend `buildChipText` to handle the new operators (e.g., `region in (EAST, WEST)`, `fare between 5 and 50`).

</code_context>

<specifics>
## Specific Ideas

- "min and max from the original table, not the view" — explicit requirement for numeric range bounds. By extension, dropdown / multi-select distinct values also come from the base table. Universe of pickable values is **stable as the operator filters**, not cascading.
- WKT / geometry columns explicitly excluded — operator never sees them in the column picker.
- Operator picks the control kind per column at config time (e.g. for a string column: text vs text-IN vs dropdown vs multi-select). No auto-detect; the operator drives.
- Date column kind (single vs range) is also operator-chosen at config time.

</specifics>

<deferred>
## Deferred Ideas

- **Widget-target picker** (limit which downstream widgets a Data Filter affects) — net-new scoping architecture; not in v1. Filters remain table-scoped.
- **OR semantics across configured columns** — requires new WHERE-builder code path; not in v1. All columns AND.
- **Default values at config time** — operator could pre-set initial selections; deferred. Widget mounts with no filter applied.
- **Persist last user selection across reloads** — localStorage / user-prefs persistence; deferred.
- **Cascading value universes** (distinct values reflect currently-active filters) — deferred; would create flicker as values appear / disappear, and contradicts the "from base table" rule.
- **Operators beyond `=` / `IN` / `BETWEEN`** — e.g., `!=`, `<`, `>`, `LIKE`, `NOT IN`. Not in v1.
- **Live (on-change) apply** — explicit Apply button instead. Hybrid live + apply also deferred.
- **Animated time-window slider** for date columns (auto-advance through time) — deferred.

</deferred>

---

*Phase: 44-data-filter-widget*
*Context gathered: 2026-05-28*
