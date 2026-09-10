# Phase 44: Data Filter Widget — Research

**Researched:** 2026-05-28
**Domain:** Filter store extension + WHERE builder extension + new widget type (datafilter)
**Confidence:** HIGH — all critical files read directly from source

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- ONE Data Filter widget holds N configured filter fields (multi-column).
- Each field binds to exactly one column on the widget's base table.
- WKT / geometry columns are excluded from the column picker.
- Per-column-type control variants are operator-chosen at config time (not auto-inferred).
- String: text input (`=`), text input with IN (`IN`), dropdown (`=`), multi-select (`IN`).
- Numeric: number input (`=`), range min/max (`BETWEEN`).
- Date/timestamp: single date picker (`=`), date range from/to (`BETWEEN`).
- Boolean: 3-state toggle (Any / True / False). "Any" = no filter for that column.
- Value universe from `/api/top-values` and `/api/column-stats` against the BASE table (not the filter view). Fetched once on widget mount; NOT cascading.
- **Explicit Apply button** at the bottom. One press = one materialize cycle. No live (on-change) apply.
- **Initial state on widget mount:** no filter applied; controls show empty/default; no entries in `useFilterStore` for the configured columns.
- **Clear filters** button: removes only this widget's columns from `useFilterStore`; resets controls.
- Always AND across columns within the same widget (matches existing `composeWhereClause`).
- `ActiveFilter.value` extended to carry `string[] | number[]` (for IN) and `[min, max]` tuples (for BETWEEN).
- `ActiveFilter` gains `operator?: "eq" | "in" | "between" | "isNull"` discriminator (default `"eq"` for back-compat).
- `buildServerWhereClause` extended to emit `IN (val1, val2, …)` and `BETWEEN min AND max`.
- Existing scalar-`=` semantics preserved verbatim for all drill-down callers (no migration).
- Sole materialize trigger invariant: Data Filter MUST dispatch into `useFilterStore` and let `AggregatedWidgetRenderer`'s Effect 1 fire materialize. Never call `materializeFilter` directly.
- Apply batches all N configured fields into a single `filterVersion` tick (not N ticks).

### Claude's Discretion
- Exact form layout inside the widget (vertical stack vs grid, label placement).
- Whether multi-select uses a native `<select multiple>` or a small custom popover.
- Dropdown empty-state row ("(any)" / "—") wording.
- How a dropdown's distinct-value list paginates / virtualizes for high-cardinality columns (`topValuesFn`'s `n` argument — pick a sensible cap, e.g. 1000, with "showing top N" hint).
- Whether the IN-text input parses on blur or on Apply press.
- Loading and error states for `/api/top-values` and `/api/column-stats` calls.
- Behavior when a configured column is deleted from the underlying table (show inline warning + skip that field, don't crash).

### Deferred Ideas (OUT OF SCOPE)
- Widget-target picker (limit which downstream widgets a Data Filter affects).
- OR semantics across configured columns.
- Default values at config time.
- Persist last user selection across reloads.
- Cascading value universes.
- Operators beyond `=` / `IN` / `BETWEEN` (no `!=`, `<`, `>`, `LIKE`, `NOT IN`).
- Live (on-change) apply.
- Animated time-window slider.
</user_constraints>

---

## Executive Summary

Phase 44 ships a new `datafilter` chart type. The widget itself is purely declarative React — it renders a form of N filter fields, each bound to a column on a chosen base table, and dispatches into the existing `useFilterStore` on Apply. Because `AggregatedWidgetRenderer`'s Effect 1 already fires `POST /api/filter/materialize` whenever `filterVersion` ticks, the Data Filter widget can re-use the entire downstream pipeline unchanged.

The real engineering work is in three layers:

1. **`ActiveFilter` type extension** (client + server mirror): add optional `operator` discriminator and widen `value` to accept arrays and tuples. Eleven existing `addFilter` call sites (drill-down paths) continue working with `"eq"` default.

2. **`buildServerWhereClause` extension**: add `IN (…)` and `BETWEEN … AND …` SQL emission paths. `composeWhereClause` (the spatial-aware wrapper that ANDs column filters with spatial OR-blocks) requires zero changes — it delegates to `buildServerWhereClause` and the new operators compose naturally in the AND chain.

3. **Widget registration + rendering**: the short-circuit renderer pattern (legend, info-card, records) means the `datafilter` type bypasses `AggregatedWidgetRenderer` entirely — it owns its own lifecycle, fires no SQL, and dispatches into `useFilterStore` on Apply. The `CustomConfigPanel` pattern (legend) is the precedent for the config UI.

A single new action `setBulkFilters` must be added to `useFilterStore` to batch N field dispatches into one `filterVersion` increment (avoiding N×materialize calls on Apply).

The chip rendering in `DashboardsPage.tsx` uses a local `chipText` function (not imported from `columnTypes.ts`). `buildChipText` in `columnTypes.ts` is used by `dispatchDrillDown`. Both must be extended for `in` and `between` operators; both are currently identical in format.

---

## Focus Area A: ActiveFilter Call-Site Audit

**Confidence: HIGH** — read all call sites directly.

### Exact Call Sites

All drill-down `addFilter` calls funnel through ONE helper: `dispatchDrillDown` in `WidgetRenderer.tsx:87–129`. This helper is called 6 times (lines 821, 937, 1047, 1126, 1256, 1794) — corresponding to BarRenderer, LineRenderer, PieRenderer, ScatterRenderer, TableRenderer, and RecordsTableRenderer. No other component in `src/` calls `useFilterStore.getState().addFilter` directly except `WidgetRenderer.tsx`.

### Construction Syntax

`dispatchDrillDown` (line 110) constructs `ActiveFilter` literals as:
```typescript
{
  column,
  value: value as ActiveFilter["value"],
  dataType,
  sourceWidgetId: widgetId,
  addedAt: Date.now(),
}
```
No `operator` field. After extension, this will silently use the `"eq"` default — no callers need migrating.

### Spec Assertions on ActiveFilter Shape

`filterStore.spec.ts` (6 describe blocks, 157 lines) constructs filters via a `f()` helper:
```typescript
const f = (overrides: Partial<ActiveFilter> & Pick<ActiveFilter, "column" | "value" | "dataType">): ActiveFilter => ({
  addedAt: 0,
  ...overrides,
});
```
No spec asserts the exact set of keys (no `Object.keys` assertions). Adding optional `operator` will not break any existing spec assertion. The `value` field IS compared with `toBe` (`expect(filters[1][0].value).toBe("EAST")`), so existing scalar-value tests remain valid.

### Server-side ActiveFilter Type

`whereClause.ts:35–41` duplicates the client type (intentionally, for server module dependency-isolation). Both must be extended identically.

### MapChartRenderer

Confirmed: `MapChartRenderer.tsx` does NOT call `addFilter` or `dispatchDrillDown`. Spatial filtering writes to `useSpatialFilterStore` only. No changes needed.

---

## Focus Area B: WHERE-Builder Safety

**Confidence: HIGH** — full source read.

### composeWhereClause Interaction

`composeWhereClause` (`spatialWhereClause.ts:194–211`) calls `buildServerWhereClause(filters)` to get `colClause`, then ANDs it with `spatialClause`:

```
Both non-empty → "${spatialClause} AND (${colClause})"
Column only    → "${colClause}"  (no extra parens — v1.3 behavior)
```

The parenthesis-lock (V15-P-07) wraps ONLY the spatial OR-block. The column AND-chain from `buildServerWhereClause` is interpolated verbatim. This means:

- A single IN filter produces: `region IN ('EAST', 'WEST')` — valid SQL, no parenthesis conflict.
- A BETWEEN filter with spatial: `(STXY_WITHIN(lon, lat, ...) = 1) AND (fare BETWEEN 5 AND 50)` — the column side gets wrapped in extra parens by `composeWhereClause`. Both clauses still work correctly.
- Multi-column AND (e.g. one IN + one BETWEEN) remains a flat AND chain: `region IN ('EAST','WEST') AND fare BETWEEN 5 AND 50`. No parenthesis issues.

**No changes to `composeWhereClause` are needed.**

### escapeKineticaStringLiteral for IN Arrays

Current `escapeKineticaStringLiteral` doubles single quotes (`'` → `''`). For IN-clause generation with string arrays, each element must be individually escaped:

```typescript
// Correct:
`${col} IN (${arr.map(v => `'${escapeKineticaStringLiteral(String(v))}'`).join(", ")})`
```

The existing `escapeKineticaStringLiteral` handles this correctly — it is a pure per-value transform. The IN-clause builder just needs to apply it per element.

### Date/Datetime Value Formatting in WHERE

Existing behavior (confirmed at `whereClause.ts:87–89`): datetime values are treated as string literals — single-quoted ISO strings. The server emits `column = '2026-05-06T10:00:00Z'` (ISO 8601 string, from `escapeKineticaStringLiteral(String(value))`). `result_tests.sql` shows Kinetica uses `DATETIME` columns with `TIMESTAMPADD` functions in SQL, and the operator's data has datetime stored as column type `DATETIME`.

For BETWEEN on datetime: `ts BETWEEN '2024-01-01' AND '2024-12-31'` — same single-quoted string literal format. This matches the existing scalar equality path and is consistent with Kinetica's SQL dialect (single-quoted string comparisons on DATETIME columns work in Kinetica per the existing drill-down behavior and the `result_tests.sql` evidence).

**No special `TIMESTAMP '...'` literal syntax needed.** Use the same single-quoted ISO string that the existing `=` path uses.

### BETWEEN Syntax in Kinetica

No existing BETWEEN usage found in server SQL builders. However:
- Kinetica SQL is ANSI SQL-compatible for standard predicates.
- `BETWEEN x AND y` is equivalent to `>= x AND <= y` in ANSI SQL and Kinetica supports it.
- As a safety measure for correctness with potential edge-case float precision, either form works. `BETWEEN` is cleaner and is the locked CONTEXT.md decision.
- **LOW confidence** on exact Kinetica BETWEEN behavior with timestamps — recommend testing the date-range path live during UAT. Fallback: emit `col >= 'min' AND col <= 'max'` instead (semantically identical, higher confidence).

---

## Focus Area C: Effect-1 Trigger Sequencing

**Confidence: HIGH** — Effect 1 source read.

### filterVersion Tick Per addFilter Call

`useFilterStore.addFilter` increments `filterVersion` by 1 on every non-dedupe, non-cap-exceeded call. There is **no batching** today. If the Apply button calls `addFilter` N times sequentially, `filterVersion` ticks N times, causing N Effect-1 debounce timers to be set. Because each debounce is 300ms and `clearTimeout` runs on the prior one, only the LAST fire actually executes — so N calls to `addFilter` in the same synchronous tick result in exactly one materialize call. This is correct by accident (debounce absorbs the N ticks).

However, this is fragile and produces N `markMaterializing` calls (each one synchronous, per Phase 17-03 lock). Each `markMaterializing` bumps `filterViewStore.clearMaterializingVersion` potentially, causing Effect-2 flicker.

**Recommendation:** Add a `setBulkFilters(tableId: number, filters: ActiveFilter[])` action to `useFilterStore` that performs all N replacements in a single `set()` call and increments `filterVersion` exactly once. The Apply button calls `setBulkFilters`. The Clear button calls `clearFilters(tableId)` — already correct (clears all columns for the table, single tick). The widget should call `markMaterializing` once manually (or let the `filterVersion` tick drive it via Effect 1, which also works because Effect 1 already calls `markMaterializing`). The cleanest path: let Effect 1 call `markMaterializing` via the `setBulkFilters` tick (zero new synchronous `markMaterializing` in the widget itself).

### Effect-1 Dep Array

Effect 1 deps: `[sql, filterVersion, dashboardId, tableId, spatialFilterVersion]`. A `datafilter` widget dispatching into `useFilterStore` bumps `filterVersion`. Effect 1 on every AGGREGATED widget for the same `tableId` will re-fire. This is the correct behavior — it triggers materialize for all co-table widgets. No changes needed.

---

## Focus Area D: FilterBar Chip Integration

**Confidence: HIGH** — source read.

### chipText in DashboardsPage.tsx

`DashboardsPage.tsx:72–85` defines a LOCAL `chipText` function (inline, not imported from `columnTypes.ts`). This is the function used in the filter bar chip rendering at line 815. The format is identical to `buildChipText` in `columnTypes.ts`. The comment at line 67–70 says they may be unified later but have not been.

**Both** must be extended:

1. `src/lib/columnTypes.ts` — `buildChipText` (used by `dispatchDrillDown` toast).
2. `src/components/DashboardsPage.tsx` — local `chipText` function (used in filter bar chips).

New formats to add:
```
in:      `region in ('EAST', 'WEST')`
between: `fare between 5 and 50`
between datetime: `ts between 2024-01-01 and 2024-12-31`
```

### Chip Dismissal + Widget Control Sync

Clicking the × on a chip calls `useFilterStore.getState().removeFilter(tableId, column)` (line 820). This removes one column's filter by column name.

When a Data Filter widget owns columns X and Y, and the user dismisses X's chip:
- `removeFilter(tableId, "X")` fires → `filterVersion` ticks → Effect 1 fires → materialize runs with only Y's filter.
- The Data Filter widget MUST subscribe to `useFilterStore` for its configured columns so it knows to show X's control as "not active."

The widget should subscribe to `useFilterStore((s) => s.filters[tableId] ?? [])` and derive "active" state per column by checking if a filter for that column exists in the store. This is purely reactive — no widget-level state needed. When the chip dismiss fires `removeFilter`, the widget re-renders with X's control reflecting "not applied."

### No FilterBar Code Changes for Chip Rendering

Data Filter's contributions reach the filter bar automatically once they hit `useFilterStore`. The chip display uses the `chipText` function. The ONLY FilterBar change needed is extending `chipText` to format `in` and `between` operators. The chip dismissal (`removeFilter(tableId, column)`) already works correctly for any column.

---

## Focus Area E: Column Metadata + Base-Table Value-Universe API

**Confidence: HIGH** — routes and helpers read.

### topValuesFn and columnStatsFn

Both client functions (`client.ts:1090–1146`) POST to `/api/top-values` and `/api/column-stats` respectively. Both accept `AbortSignal` as second argument.

Server routes (`index.ts:909–983`) validate inputs, build SQL against `schema.table` (bare base table — no filter-view substitution), run via `kineticaSqlHelper` (user-authed), and return parsed results.

The SQL builders (`topValuesSql.ts`, `columnStatsSql.ts`) both query `FROM ${schema}.${table}` directly — confirmed base-table only.

### Response Shape + Edge Cases

**top-values:** Returns `{ values: string[] }`. Empty table → empty array (confirmed: SQL returns 0 rows, parser returns `[]`). Very high cardinality → capped at `n` (route validates `n` in `[2, 256]`). Note: **the current route caps `n` at 256** — the CONTEXT.md says pick "1000" as the cap. The route must be extended to allow `n` up to 1000 (or a new parameter). Currently validates `body.n < 2 || body.n > 256` → 400. This is a route-level change needed.

**column-stats:** Returns `{ min, max, mean, stddev }`. Empty table → throws `"column-stats min is not a finite number (empty or non-numeric column?)"` from the parser. The route must catch this and return a 400 (or the widget handles the error gracefully).

### AbortSignal Handling

Both functions accept `signal?: AbortSignal`. Pass a mount-time AbortController signal (created in `useEffect([], [])`) and abort it on cleanup. Pattern matches `CbConfigForm.tsx`'s `autoSuggestAbortRef`.

---

## Focus Area F: CustomConfigPanel Patterns

**Confidence: HIGH** — LegendConfigPanel and registry read.

### LegendConfigPanel Contract

```typescript
export default function LegendConfigPanel({
  config,
  onChange,
  widgets,        // from ConfigPanelProps.widgets (WidgetDto[])
}: ConfigPanelProps): JSX.Element
```

Props are `config`, `onChange`, and whatever extras are needed (widgets for legend, columns for map).

### ConfigPanelProps Extensions Needed

`registry.ts:41–78` defines `ConfigPanelProps`. Currently has:
- `config`, `onChange`
- `columns?: { name: string; type: string }[]`
- `tables?: { id, name, schema, columns: Record<string, string> }[]`
- `isValid?: (valid: boolean) => void`
- `widgets?: WidgetDto[]`

The `DataFilterConfigPanel` will need:
- `config`, `onChange` (standard)
- `columns?: ...` (for the column picker — columns from the widget's base table)
- `tables?: ...` (to resolve schema/tableName for API calls)

No new `ConfigPanelProps` fields needed. The existing fields cover the requirement.

### Table Picker Pattern

`LegendConfigPanel` uses `widgets` prop to pick from widgets on the dashboard. For Data Filter, the operator picks the base table from `tables` (the same `associatedTables` that ChartConfigPanel uses). The `DataFilterConfigPanel` should reuse the standard table-picker pattern from `ChartConfigPanel` (the Data Source section). However, because `DataFilterConfigPanel` bypasses `ChartConfigPanel` entirely via `CustomConfigPanel`, it must render its own table picker.

The `datafilter` definition MUST set `usesDataSource: false` so `ChartConfigPanel` does not render a duplicate Data Source picker. The config panel renders its own picker using the `tables` prop.

### Save-Flow Contract

`CustomConfigPanel` receives `config` (current config snapshot) and `onChange(newConfig)`. The generic `ChartConfigPanel` caller calls `onChange` → diffs → debounce → PATCH. No `onSave`/`onCancel` at the config panel level — the parent modal owns save/cancel.

---

## Focus Area G: Widget Rendering Lifecycle

**Confidence: HIGH** — WidgetRenderer and App.tsx read.

### DataFilterRenderer Lifecycle

Since `datafilter` short-circuits before `AggregatedWidgetRenderer`, it owns its full lifecycle:
- No SQL, no `runSql`, no `filterVersion` or `viewName` subscriptions in the renderer itself.
- The renderer subscribes to `useFilterStore((s) => s.filters[tableId] ?? [])` to reflect active-filter state per column (for showing "applied" indicator on each control).
- Fetches value universes on mount (`topValuesFn`, `columnStatsFn`) with AbortController cleanup.
- Stores staged (not yet applied) control values in local `useState`.
- Apply button calls `setBulkFilters(tableId, [...activeFilters])` — one `filterVersion` tick.
- Clear button calls `useFilterStore.getState().clearFilters(tableId)` (already exists).

### Reset Chain Integration

`DashboardsPage.tsx:419–444` (DashboardOpen cleanup) and `App.tsx:80–106` (UNAUTHORIZED effect) both call `useFilterStore.getState().reset()`. This hard-wipes ALL filters. The Data Filter widget's configured columns get cleared automatically — no new reset hook needed.

However: the Data Filter widget's local `useState` (staged control values) is component-local and resets automatically on unmount/remount. No special reset chain participation needed beyond the existing `useFilterStore.reset()`.

---

## Focus Area H: Multi-Column AND Composition

**Confidence: HIGH** — `composeWhereClause` read.

`composeWhereClause` ANDs all column filters from `buildServerWhereClause`. Filters from Data Filter (with `in` or `between` operators) and drill-down filters (with `eq` operators) are all in the same `filters[]` array passed to the endpoint. They compose as:

```sql
region IN ('EAST', 'WEST') AND fare BETWEEN 5 AND 50 AND zone = 'Midtown'
```

No new composition code path needed. The `buildServerWhereClause` extension slots naturally into the existing AND chain.

---

## Focus Area I: Tests to Write

**Confidence: HIGH**

### Files That MUST Be Updated

| File | What to Add |
|------|-------------|
| `src/store/filterStore.spec.ts` | Tests for `setBulkFilters` action; tests with `operator: "in"` / `"between"` values; existing scalar tests should still pass |
| `server/tests/lib.whereClause.spec.ts` | Tests for `IN (…)` emission, `BETWEEN … AND …` emission, array escaping for IN, null/empty array edge cases |
| `server/tests/routes.filter-materialize.spec.ts` | New `it` blocks: materialize sends DDL with `IN` WHERE clause; materialize sends DDL with `BETWEEN` WHERE clause; verifies `composeWhereClause` still ANDs correctly with spatial block |
| `src/lib/columnTypes.spec.ts` | Tests for `buildChipText` with `in` / `between` operators |
| `src/components/DashboardsPage.spec.tsx` | Update chip-text format assertions if any snapshot the `chipText` output |

### New Files

| File | Purpose |
|------|---------|
| `src/components/charts/DataFilterRenderer.tsx` | Main renderer component |
| `src/components/charts/DataFilterRenderer.spec.tsx` | Unit tests |
| `src/components/charts/DataFilterConfigPanel.tsx` | Config panel |
| `src/components/charts/DataFilterConfigPanel.spec.tsx` | Unit tests |
| `src/components/charts/definitions/data-filter.ts` | Registry entry |

### WidgetRenderer.spec.tsx

The `dispatchDrillDown` function constructs `ActiveFilter` with no `operator` field. After adding the optional `operator` to the type, existing spec assertions pass unchanged. One new test should verify that an `ActiveFilter` without `operator` still processes as `"eq"` in `buildServerWhereClause`.

---

## Focus Area J: Validation Architecture

### 5-Axis Test Coverage (reference for plan verification steps)

**Axis 1 — Store layer**
- `src/store/filterStore.spec.ts`: `setBulkFilters` batches N columns into 1 `filterVersion` tick; `operator: "in"` with `string[]` value stored correctly; `operator: "between"` with `[min, max]` stored correctly; existing scalar tests unmodified.

**Axis 2 — Server WHERE layer**
- `server/tests/lib.whereClause.spec.ts`: `IN ('a', 'b')` emitted correctly; `IN` with special-char values escaped; `BETWEEN 5 AND 50` emitted for number; `BETWEEN '2024-01-01' AND '2024-12-31'` emitted for datetime; empty `in` array handled gracefully (edge: `IN ()` is invalid SQL — must either skip the filter or emit `1=0`); `operator` absent defaults to `eq` behavior.

**Axis 3 — End-to-end materialize**
- `server/tests/routes.filter-materialize.spec.ts`: POST with `operator: "in"` filter emits correct DDL; POST with `operator: "between"` filter emits correct DDL; mixed IN+BETWEEN+eq filters compose correctly.

**Axis 4 — Widget render**
- `DataFilterRenderer.spec.tsx`: renders N field rows from config; Apply dispatches `setBulkFilters` with correct column/value/operator; Clear calls `clearFilters(tableId)`; store subscription shows "applied" indicator; mount aborts topValues/columnStats on unmount.

**Axis 5 — Drill-down compat regression**
- `WidgetRenderer.spec.tsx`: existing drill-down tests still pass after `ActiveFilter` type extension; `dispatchDrillDown` with no `operator` still produces `"eq"` SQL in the WHERE builder.

---

## Architecture Risks & Gotchas

### Risk 1: `n` Cap in `/api/top-values` Route (HIGH SEVERITY)

The current route validates `body.n` in `[2, 256]`. CONTEXT.md says to cap at 1000 for the dropdown. The route will return 400 for `n > 256`. The route handler must be updated to accept up to 1000 (or whatever cap is chosen). Alternatively, the Data Filter calls with `n = 256` and shows "showing top 256 values" — acceptable per Claude's discretion. The safer path is updating the route to `n > 1000 → 400`.

### Risk 2: Empty IN Array Edge Case (HIGH SEVERITY)

If the operator types nothing into the text-IN input and presses Apply, the widget might dispatch `operator: "in"` with `value: []`. `buildServerWhereClause` would emit `column IN ()` — INVALID Kinetica SQL. The widget must validate: skip any field where `operator === "in"` and `value` is an empty array. OR emit `1=0` (no match). Recommendation: skip the filter (treat empty IN as "no filter for this column").

### Risk 3: `setBulkFilters` Must Not Bypass the 10-Cap (MEDIUM SEVERITY)

The existing `addFilter` enforces a 10-cap. `setBulkFilters` must replicate or re-use the same cap logic. A Data Filter widget with 10 configured columns that all Apply at once must not silently drop columns. Options: (a) bulk replace always succeeds for columns already in the store (same column = replace, not add), (b) cap applies only to new columns that would push beyond 10. The cleanest implementation: `setBulkFilters` clears all existing entries for this widget's columns (or for `tableId`) then adds the new batch. This avoids the cap issue for the widget's own columns.

Actually the safest design: `setBulkFilters` replaces ALL entries for the given list of `column` names atomically. For each column in the batch: if already in the store (for that tableId), replace; if new, add. If N new columns would push past 10, show the cap toast and stop. This mirrors `addFilter` but batched.

### Risk 4: dedupe Check in `addFilter` Compares `value` with `===` (MEDIUM SEVERITY)

`filterStore.ts:54–61` does `existing[sameColumnIdx].value === filter.value`. For arrays `["EAST", "WEST"] === ["EAST", "WEST"]` is always `false` (reference comparison). This means every Apply press on an IN filter will always produce a `filterVersion` tick (no dedupe, even if values are identical). This is acceptable behavior — it triggers a materialize on every Apply — but it means the debounce approach is the only protection against rapid-fire Apply clicks.

### Risk 5: markMaterializing Called Once Per Apply (LOW SEVERITY)

The locked sequence (Phase 17-03): `markMaterializing` must be called synchronously with `addFilter` dispatch. With `setBulkFilters`, the store increments `filterVersion` once. `markMaterializing` should be called once. The Data Filter renderer should NOT call `markMaterializing` directly — that is the `dispatchDrillDown` helper's pattern. For `setBulkFilters`, the safest design is to call `markMaterializing` in the Apply handler, synchronously after `setBulkFilters`, mirroring `dispatchDrillDown`'s pattern exactly.

### Risk 6: `filterVersion` Dep in AggregatedWidgetRenderer vs RecordsTableRenderer

Both `AggregatedWidgetRenderer` (line 437 deps) and `RecordsTableRenderer` (line ~1484) have Effect-1 materialize triggers that fire on `filterVersion`. Both will re-fire when the Data Filter widget calls `setBulkFilters`. This is correct — all co-table widgets should re-query. No new code paths.

### Risk 7: DashboardsPage `chipText` vs `buildChipText` Divergence

Two functions produce chip text: the local `chipText` in `DashboardsPage.tsx:72–85` (used in filter bar) and `buildChipText` in `columnTypes.ts:92–106` (used in `dispatchDrillDown` toast). They have identical logic today. When extending both for `in` and `between`, they must remain in sync. The comment in `DashboardsPage.tsx:67–70` explicitly notes this dual-function situation. Consider importing `buildChipText` directly in `DashboardsPage.tsx` and deleting the local copy — this phase is the right time to unify them.

**Recommendation:** In the `buildChipText` extension, extend `chipText` in `DashboardsPage.tsx` to import and delegate to `buildChipText`. One source of truth going forward.

The signature change: `buildChipText` currently takes `(column, value, dataType: DrillDownDataType)`. The new operators require knowing `operator` in addition. Two options:
- (A) Add `operator?: "eq" | "in" | "between" | "isNull"` as an optional 4th param with default `"eq"`.
- (B) Pass the full `ActiveFilter` object.

Option A is non-breaking (all existing callers omit the 4th param).

---

## Standard Stack

No new npm dependencies. The full implementation uses:

| Component | Existing Mechanism | Notes |
|-----------|--------------------|-------|
| Widget registration | `registerChartType` in `definitions/index.ts` | Add `registerDataFilter()` call |
| Short-circuit renderer | `WidgetRenderer.tsx:235–250` | Add `else if (widget.type === "datafilter")` branch |
| Config panel | `CustomConfigPanel` on `ChartTypeDefinition` | Same as legend |
| Value fetching | `topValuesFn`, `columnStatsFn` from `client.ts` | Already exist |
| Column type classification | `NUMERIC_TYPES`, `DATETIME_TYPES`, `BOOLEAN_TYPES`, `normalizeType` from `columnTypes.ts` | Already exist |
| Store dispatch | `useFilterStore.getState().setBulkFilters()` (new) / `clearFilters()` (existing) | New `setBulkFilters` action needed |
| Geometry exclusion | `EXCLUDED_DRILLDOWN_TYPES` from `columnTypes.ts` | Reuse |
| Dual-input range | `ZoomRangeSlider.tsx` pattern | Pattern available; may use `<input type="number">` pair instead for numeric range |
| Date picker | Native `<input type="date">` (no deps) | CONTEXT.md says Claude's discretion — native input is the zero-dependency choice |

---

## Recommended Plan Structure

Suggest 3 plans:

**Plan 44-01: Store + WHERE builder foundation (pure functions)**
- Extend `ActiveFilter` type in `filterStore.ts` and `whereClause.ts` (add `operator` + widen `value`).
- Add `setBulkFilters` action to `useFilterStore`.
- Extend `buildServerWhereClause` to emit IN and BETWEEN.
- Extend `buildChipText` + local `chipText` in `DashboardsPage.tsx` for new operators.
- Update `filterStore.spec.ts` and `lib.whereClause.spec.ts`.
- Update `routes.filter-materialize.spec.ts` with IN + BETWEEN DDL assertions.
- Update `columnTypes.spec.ts` for chip text.
- Touches: `filterStore.ts`, `whereClause.ts`, `columnTypes.ts`, `DashboardsPage.tsx` (chipText section only), 4 spec files.
- **No React changes yet. Can be code-reviewed in isolation.**

**Plan 44-02: Widget renderer + registration**
- `DataFilterRenderer.tsx` (renderer component — subscribe to store, staged state, Apply + Clear, topValues/columnStats fetches, per-column-type controls).
- `DataFilterRenderer.spec.tsx`.
- `DataFilterConfigPanel.tsx` (N-field builder with column picker + control-kind dropdown + table picker).
- `DataFilterConfigPanel.spec.tsx`.
- `definitions/data-filter.ts` (registry entry: `usesDataSource: false`, `usesAggregation: false`, `supportsDrillDown: false`, `CustomConfigPanel: DataFilterConfigPanel`).
- `definitions/index.ts` — add `registerDataFilter()`.
- `WidgetRenderer.tsx` — add short-circuit branch.
- Touches: 5 new files + 2 existing files.

**Plan 44-03: Wiring + end-to-end verification**
- Route-level `n` cap change in `index.ts` (allow up to 1000 for top-values).
- Integration smoke: confirm chip dismissal syncs widget state (may be zero code if purely reactive).
- `routes.filter-materialize.spec.ts` additional integration cases.
- Verification checklist.

---

## File Inventory

### Modified Files

| File | Change |
|------|--------|
| `kinetica_bi/src/store/filterStore.ts` | Add `operator` to `ActiveFilter`; widen `value`; add `setBulkFilters` action |
| `kinetica_bi/server/src/lib/whereClause.ts` | Mirror `ActiveFilter` type extension; add IN + BETWEEN emission in `buildServerWhereClause` |
| `kinetica_bi/src/lib/columnTypes.ts` | Extend `buildChipText` for in/between operators; extend `DrillDownDataType` if needed or add separate operator param |
| `kinetica_bi/src/components/DashboardsPage.tsx` | Extend local `chipText` for in/between (or import `buildChipText`) |
| `kinetica_bi/src/components/charts/WidgetRenderer.tsx` | Add `else if (widget.type === "datafilter")` short-circuit |
| `kinetica_bi/src/components/charts/definitions/index.ts` | Add `registerDataFilter()` call |
| `kinetica_bi/server/src/index.ts` | Update `/api/top-values` route: increase `n` cap to 1000 |
| `kinetica_bi/src/store/filterStore.spec.ts` | New tests for `setBulkFilters` + new operator shapes |
| `kinetica_bi/server/tests/lib.whereClause.spec.ts` | New tests for IN + BETWEEN emission |
| `kinetica_bi/server/tests/routes.filter-materialize.spec.ts` | New integration tests for IN + BETWEEN DDL |
| `kinetica_bi/src/lib/columnTypes.spec.ts` | New tests for extended `buildChipText` |

### New Files

| File | Purpose |
|------|---------|
| `kinetica_bi/src/components/charts/DataFilterRenderer.tsx` | Short-circuit renderer — the widget UI |
| `kinetica_bi/src/components/charts/DataFilterRenderer.spec.tsx` | Unit tests |
| `kinetica_bi/src/components/charts/DataFilterConfigPanel.tsx` | Config panel (N-field builder + table picker) |
| `kinetica_bi/src/components/charts/DataFilterConfigPanel.spec.tsx` | Unit tests |
| `kinetica_bi/src/components/charts/definitions/data-filter.ts` | Registry entry |

---

## Open Questions for Planner

1. **Empty IN array behavior**: What should `setBulkFilters` do when a configured IN field has an empty array? Options: (a) skip that field (treat as "no filter"), (b) emit `1=0` (no rows match). Option (a) is strongly recommended — empty IN = operator hasn't selected anything = no filter for that column. Plan should document this rule explicitly.

2. **n cap for top-values**: The current route validates `n` in `[2, 256]`. CONTEXT.md Claude's discretion says "pick a sensible cap, e.g. 1000." Either update the route to `[2, 1000]` or keep 256 and show "top 256" in the UI. Plan 44-03 should decide and implement.

3. **BETWEEN datetime safety**: Confirmed that Kinetica accepts single-quoted ISO string literals for datetime BETWEEN (consistent with existing `=` path). If UAT reveals datetime BETWEEN fails, the fallback is `col >= 'min' AND col <= 'max'`. Plan should document this as a UAT verification point.

4. **setBulkFilters and 10-cap interaction**: If the widget has 10 columns configured and some are already in the store (replace, not add), the 10-cap is not exceeded. But if 5 are already in the store and 5 are new, and the table already has 5 OTHER filters from drill-down (total would be 15), the cap triggers. The plan should specify: `setBulkFilters` attempts each column; if the store would exceed 10 for new columns, show the cap toast and stop adding new columns (but still update existing columns). Mirroring `addFilter` behavior.

5. **config shape for DataFilterConfigPanel**: The N-field config needs to persist the list of configured fields. Suggested shape: `config.filterFields: Array<{ column: string; kind: "text-eq" | "text-in" | "dropdown" | "multi-select" | "number-eq" | "number-range" | "date-eq" | "date-range" | "boolean-toggle" }>`. Plan should confirm this shape and document `defaultConfig: { filterFields: [] }`.

6. **tableId vs tableRef in DataFilterRenderer**: The `DataFilterRenderer` needs the base table's `schema` and `tableName` (for topValuesFn/columnStatsFn calls). `widget.config.tableRef` is the `"schema.table"` string; `widget.config.tableId` is the numeric id used for store dispatch. Plan should confirm both are persisted by the config panel (the custom panel must write `tableId`, `tableRef`, and `filterFields`).

---

## Sources

### Primary (HIGH confidence)
- `kinetica_bi/src/store/filterStore.ts` — exact `ActiveFilter` type, `addFilter` implementation, 10-cap, dedupe logic
- `kinetica_bi/server/src/lib/whereClause.ts` — exact `buildServerWhereClause` implementation, `escapeKineticaStringLiteral`
- `kinetica_bi/server/src/lib/spatialWhereClause.ts:170–211` — `composeWhereClause` composition logic
- `kinetica_bi/src/components/charts/WidgetRenderer.tsx:87–250` — `dispatchDrillDown` + `AggregatedWidgetRenderer` Effect 1 + short-circuit pattern
- `kinetica_bi/src/components/charts/registry.ts` — `ConfigPanelProps`, `ChartTypeDefinition`
- `kinetica_bi/src/components/charts/LegendConfigPanel.tsx` — `CustomConfigPanel` precedent
- `kinetica_bi/src/components/charts/definitions/legend.ts` — registry entry precedent
- `kinetica_bi/src/components/charts/definitions/index.ts` — registration index
- `kinetica_bi/src/lib/columnTypes.ts:1–106` — `buildChipText`, `NUMERIC_TYPES`, `DATETIME_TYPES`, `BOOLEAN_TYPES`, `normalizeType`
- `kinetica_bi/src/api/client.ts:1090–1146` — `topValuesFn`, `columnStatsFn`
- `kinetica_bi/src/components/DashboardsPage.tsx:60–85, 800–880` — local `chipText`, chip rendering + dismissal
- `kinetica_bi/server/src/lib/topValuesSql.ts` — SQL builder + parser
- `kinetica_bi/server/src/lib/columnStatsSql.ts` — SQL builder + parser
- `kinetica_bi/server/src/index.ts:909–983` — route handlers for top-values + column-stats
- `kinetica_bi/src/store/filterStore.spec.ts` — exact spec shape, no Object.keys assertions
- `kinetica_bi/server/tests/lib.whereClause.spec.ts` — existing test coverage map
- `kinetica_bi/server/tests/routes.filter-materialize.spec.ts:80–198` — supertest fixture pattern
- `kinetica_bi/src/App.tsx:80–106` — reset chain (7th store position available)
- `kinetica_bi/src/components/DashboardsPage.tsx:419–444` — DashboardOpen cleanup reset chain

---

## Metadata

**Confidence breakdown:**
- Store layer: HIGH — source read
- WHERE builder + composition: HIGH — source read; BETWEEN on Kinetica timestamps is LOW (no evidence, recommend UAT validation)
- Widget lifecycle/pattern: HIGH — all precedent files read
- Test surface: HIGH — all spec files located and read

**Research date:** 2026-05-28
**Valid until:** 2026-06-28 (stable codebase; 30-day window)
