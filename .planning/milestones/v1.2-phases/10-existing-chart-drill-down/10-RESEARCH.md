# Phase 10: Existing-Chart Drill-Down — Research

**Researched:** 2026-05-04
**Domain:** Recharts click events, column-type classification, dim-peers animation, filter bar JSX rewrite, test patterns
**Confidence:** HIGH — all findings grounded in direct codebase reads; no speculative claims

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- `supportsDrillDown?: boolean` added to `ChartTypeDefinition`; `drillDownColumn?: string` in `widget.config`
- Per-chart-type `onClick` handlers per ARCHITECTURE.md §6 click contract; each calls `useFilterStore.getState().addFilter`
- Column picker excludes WKT, WKB, Kinetica geometry, and large-text columns (PITFALL D-01 lock)
- Filter bar at `DashboardsPage.tsx:450-471` rebuilt to render `useFilterStore.filters[tableId]` chips + legacy static label + `×` dismiss + per-table "Clear all"
- Transient dim-peers: 30% opacity on non-matching peers, active at full saturation, ~300ms
- Persistent row-tint on records/table chart where rows match active filter
- Toast on first add only: `column = 'value'` text; suppressed on dedupe/replace paths
- Default `drillDownColumn` = `groupByColumn` for bar/line/pie; x-axis key for scatter; no auto-default for records/table
- Optional, never required — empty `drillDownColumn` = no-op click
- Chip layout: single-row, horizontal scroll on overflow; no wrap
- Hide entire filter bar when no table has active store filter AND no non-empty `view.filter_clause`
- Cursor: pointer on chart elements ONLY when `supportsDrillDown && cfg.drillDownColumn` is set
- Re-click already-active element: silent no-op (Phase 9 dedupe lock; no toggle-off)
- Chip text: `column = 'value'` with single-quotes for strings; `column IS NULL`; `column = <ISO date>` for datetime; unquoted for numbers/booleans
- AP-1, AP-3, AP-4, AP-5, AP-6 anti-pattern locks carried forward

### Claude's Discretion

- Exact CSS class names + transition timing curve for dim-peers animation (target ~300ms; ease-out feel)
- Whether dim-peers transient is a shared hook (`useDrillDownClickFeedback`) or inline in each renderer's `onClick`
- Whether `inferDataTypeFromColumn` lives next to filter store, in `src/api/client.ts`, or in a new `src/lib/columnTypes.ts`
- Whether records-table row-tint uses existing accent CSS variable or introduces `--filter-active-row-bg` token
- Exact label copy on the per-table "Clear all" button ("Clear all" vs "Clear filters" vs "Reset")
- Whether geometry/large-text exclusion logic is centralized in `isColumnDrillDownSafe(col)` or inlined in `ChartConfigPanel`'s picker
- Test-spec layout: extending `WidgetRenderer.spec.tsx` vs new `DrillDown.spec.tsx` per chart type

### Deferred Ideas (OUT OF SCOPE)

- Range filters (`>=`, `<=`, `between`) — DRILL-V13-02
- Multi-value OR selection (Ctrl-click) — DRILL-V13-01
- Map-chart drill-down — Phase 12 (IDENT-01..IDENT-03)
- Bignumber and heatmap drill-down
- Global "clear all tables" API or button
- Undo last filter (Ctrl+Z) — DRILL-V13-03
- Distinct-count probe in column picker
- Override-C-03 path (keep stale data during refetch)
- Pure DOM-element pulse animation (no peer dimming)
- Always-visible filter bar with empty placeholder
- Chart-card border on charts with active filters
- Re-click toggles filter off
- Toast on dedupe + replace paths
- Required `drillDownColumn` for `supportsDrillDown` charts
- Friendlier toast/chip copy
- Keyboard accessibility on drill-down clicks (future a11y polish)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DRILL-01 | Clicking an interactive element on bar/pie/line/scatter/table chart calls the configured drill-down handler with `(column, value)` and dispatches `addFilter` on the chart's table | Recharts click event shape verified; `addFilter` API confirmed in filterStore.ts; per-renderer wiring pattern identified |
| DRILL-02 | Each `supportsDrillDown` chart type exposes a config-time picker for `drillDownColumn`; geometry/large-text columns excluded | Column metadata pipeline confirmed: `TableDto.columns: Record<string, string>` with Kinetica `DATA_TYPE` values; exclusion helper pattern identified; `allColumns`/`numericColumns` patterns in `ChartConfigPanel.tsx` are the model |
| DRILL-03 | Existing display-only filter bar becomes interactive — dismissable badges (×), "Clear all" per table, reads from `useFilterStore` | Filter bar JSX block (lines 462-482 of DashboardsPage.tsx) fully read; existing CSS classes catalogued; `removeFilter`/`clearFilters` API confirmed in filterStore.ts |
| DRILL-04 | Source chart shows "selected" state after drill-down; toast confirms filter added | Recharts `Cell`/`fillOpacity` dim-peer mechanism confirmed; `useToastStore.getState().showToast(message, kind)` API confirmed with valid `kind` values; 5s dedup window in toast store identified as relevant to toast suppression logic |
</phase_requirements>

---

## Summary

Phase 10 is a pure consumer of Phase 9's infrastructure. It has no server changes, no store changes, and no SQL utility changes. The implementation surface is: six definition files, `ChartTypeDefinition` type, `ChartConfigPanel.tsx`, `WidgetRenderer.tsx`, and `DashboardsPage.tsx:462-482`. A new `isColumnDrillDownSafe` helper and `inferDataTypeFromColumn` utility are needed.

The installed Recharts version is **2.15.4** (package.json declares `^2.10.3`; npm registry resolves to 2.15.4). The `CategoricalChartFunc` signature `(nextState: CategoricalChartState, event: any) => void` is confirmed in the installed type definitions. `activePayload` is `any[]` on `CategoricalChartState`. For `<Pie>`, the `onClick` prop is `(data: any, index: number, e: React.MouseEvent) => void` where `data` is the `PieSectorDataItem` object containing a `payload?: any` field (the source row). The CONTEXT.md click-contract table is correct but needs one precision: for pie, `data.payload` is the source row, not `data` itself.

Column type metadata comes from Kinetica's `INFORMATION_SCHEMA.COLUMNS` via a `SELECT COLUMN_NAME, DATA_TYPE` query, stored as `TableDto.columns: Record<string, string>` (column name to Kinetica DATA_TYPE string). The `ChartConfigPanel` already has this as `allColumns: Array<{name, type}>`. The geometry/large-text exclusion logic needs to map known Kinetica `DATA_TYPE` strings — specifically `WKT`, `WKB`, `BYTES`, and string types with unbounded/large length — to an exclusion set. `isNumericType` in `ChartConfigPanel.tsx` is the direct pattern to extend.

`inferDataTypeFromColumn` should consult `TableDto.columns` by column name and map the Kinetica DATA_TYPE string to `ActiveFilter.dataType`. This is new code; no existing equivalent exists in the codebase.

The filter bar at `DashboardsPage.tsx:462-482` currently iterates `views`, renders a per-`view` row with `filter-bar-item` / `filter-bar-table` / `filter-bar-clause` CSS classes. The rewrite adds `useFilterStore` subscription alongside the existing `views` state and changes the show-condition from `views.length > 0` to "any table has active store filters OR non-empty filter_clause".

**Primary recommendation:** Implement in two or three plans — (1) registry flag + config panel picker + column-type utilities, (2) per-renderer onClick handlers + dim-peers + toast, (3) filter bar rewrite + row-tint. The picker and utilities can parallel the renderer work if the plans are independent.

---

## Standard Stack

### Core (already installed — no new dependencies)

| Library | Installed Version | Purpose | Notes |
|---------|-------------------|---------|-------|
| recharts | 2.15.4 | Chart rendering + click events | `BarChart onClick`, `Pie onClick` already in use |
| zustand | 4.5.2 | Filter store (already shipped Phase 9) | Phase 10 is consumer only |
| react | 18.3.1 | Component + hooks | `useState` for local `clickedElement` state |

### No new packages needed

Phase 10 adds no npm dependencies. All required primitives are in the installed packages.

---

## Architecture Patterns

### Recommended Project Structure Changes

```
src/
├── components/
│   ├── charts/
│   │   ├── WidgetRenderer.tsx        # add onClick handlers + dim-peers transient (MODIFIED)
│   │   ├── ChartConfigPanel.tsx      # add drillDownColumn picker (MODIFIED)
│   │   ├── registry.ts               # add supportsDrillDown field (MODIFIED)
│   │   └── definitions/
│   │       ├── bar.ts                # add supportsDrillDown: true (MODIFIED)
│   │       ├── line.ts               # add supportsDrillDown: true (MODIFIED)
│   │       ├── pie.ts                # add supportsDrillDown: true (MODIFIED)
│   │       ├── scatter.ts            # add supportsDrillDown: true (MODIFIED)
│   │       ├── table.ts              # add supportsDrillDown: true (MODIFIED)
│   │       ├── records.ts            # add supportsDrillDown: true (MODIFIED)
│   │       ├── bignumber.ts          # unchanged (supportsDrillDown unset/false)
│   │       └── heatmap.ts            # unchanged (supportsDrillDown unset/false)
│   └── DashboardsPage.tsx            # filter bar rewrite (MODIFIED)
└── lib/
    └── columnTypes.ts                # NEW: isColumnDrillDownSafe, inferDataTypeFromColumn
```

`src/lib/` does not exist yet — STRUCTURE.md notes it as the appropriate location for shared helpers that are neither API clients nor stores. The CONTEXT.md notes this placement is at Claude's discretion.

### Pattern 1: Registry Flag Addition

**What:** Add `supportsDrillDown?: boolean` to `ChartTypeDefinition` in `registry.ts`. Set `true` on six definitions, leave unset on bignumber/heatmap/map.

**When to use:** The flag gates the drill-down column picker in `ChartConfigPanel` and the cursor style in `WidgetRenderer`. Reading it: `getChartType(widget.type)?.supportsDrillDown`.

```typescript
// registry.ts — add after usesAggregation
/**
 * Whether this chart type supports drill-down click-to-filter.
 * When true, config panel shows drillDownColumn picker.
 * When false or undefined, click handlers are no-ops.
 */
supportsDrillDown?: boolean;
```

### Pattern 2: Column-Type Utilities (`src/lib/columnTypes.ts`)

**What:** Two exported helpers used by `ChartConfigPanel` (picker exclusion) and `WidgetRenderer` (dataType inference).

```typescript
// PITFALL D-01 lock: exclude WKT, WKB, Kinetica geometry, large-text columns.
// Kinetica DATA_TYPE strings from INFORMATION_SCHEMA.COLUMNS (via /api/kinetica/.../columns).
// Confirmed mapping from server/src/index.ts:647-653 — DATA_TYPE is the raw Kinetica type string.
const EXCLUDED_TYPES = new Set([
  "wkt", "wkb", "bytes",                    // geometry types
  "blob", "text",                            // unbounded text
  "point", "geometry", "geography",          // spatial types
]);

// PITFALL D-01 lock
export function isColumnDrillDownSafe(colType: string): boolean {
  const t = colType.toLowerCase().replace(/\(.*\)/, "").trim();
  return !EXCLUDED_TYPES.has(t);
}

// Maps Kinetica DATA_TYPE string to ActiveFilter.dataType
export function inferDataTypeFromColumn(
  colName: string,
  columns: Record<string, string>
): "string" | "number" | "boolean" | "datetime" | "null" {
  const rawType = (columns[colName] ?? "").toLowerCase().replace(/\(.*\)/, "").trim();
  if (["int", "integer", "int8", "int16", "int32", "int64",
       "long", "float", "double", "decimal", "numeric",
       "smallint", "bigint", "real", "number", "tinyint"].includes(rawType)) return "number";
  if (["bool", "boolean"].includes(rawType)) return "boolean";
  if (["timestamp", "date", "time", "datetime"].includes(rawType)) return "datetime";
  if (!rawType) return "null";
  return "string";
}
```

**Column metadata source:** `TableDto.columns: Record<string, string>` — keyed by column name, value is the Kinetica `DATA_TYPE` string from `INFORMATION_SCHEMA.COLUMNS`. This is already available in `ChartConfigPanel` as `allColumns = Object.entries(selectedTable.columns).map(([name, type]) => ({name, type}))`. At render time in `WidgetRenderer`, `cfg` does not carry the full column-type map — `inferDataTypeFromColumn` needs the column type map passed in or derived from a per-widget lookup. The simplest approach: store `drillDownColumnType` alongside `drillDownColumn` in `widget.config` at save time (ChartConfigPanel has `selectedTable.columns` and can set it directly). This avoids any runtime column-type lookup in renderers.

### Pattern 3: Recharts Click Event Wiring (verified against installed 2.15.4 types)

**BarChart / LineChart / ScatterChart (AreaChart variant included):**

```typescript
// CategoricalChartFunc = (nextState: CategoricalChartState, event: any) => void
// nextState.activePayload is any[] where each element has a .payload property = the source row
<BarChart
  data={data}
  onClick={(nextState) => {
    const payload = nextState?.activePayload?.[0]?.payload as Row | undefined;
    if (!payload || !cfg.drillDownColumn) return;
    handleDrillDown(payload[cfg.drillDownColumn as string]);
  }}
>
```

**Pie:**

```typescript
// <Pie onClick> signature: (data: PieSectorDataItem, index: number, e: React.MouseEvent) => void
// data.payload is the source row object (PieSectorDataItem.payload?: any)
<Pie
  onClick={(data) => {
    const row = data?.payload as Row | undefined;
    if (!row || !cfg.drillDownColumn) return;
    handleDrillDown(row[cfg.drillDownColumn as string]);
  }}
>
```

**IMPORTANT PRECISION — Pie click contract difference from other chart types:**
CONTEXT.md table row for pie says `slice.payload` is "the source row". The installed type definition confirms `PieSectorDataItem.payload?: any`. The first argument to `Pie onClick` IS the `PieSectorDataItem` object, so the source row is at `data.payload` (not `data` directly). The CONTEXT.md wording is accurate — "slice.payload" means `firstArg.payload`.

**Table/Records chart rows:**

```typescript
// No Recharts event — plain DOM <tr onClick>
<tr
  key={i}
  className={...}
  onClick={() => {
    if (!cfg.drillDownColumn) return;
    handleDrillDown(row[cfg.drillDownColumn as string]);
  }}
  style={{ cursor: cfg.drillDownColumn ? "pointer" : undefined }}
>
```

### Pattern 4: Dim-Peers Transient (local state, sequenced before store dispatch)

**What:** Component-local `clickedElement` state drives per-cell `fillOpacity` during the ~300ms window before `addFilter` is called.

**Key invariant:** Dispatch `addFilter` AFTER the CSS transition duration has elapsed (300ms `setTimeout`), not immediately. This honors Phase 9 PITFALL C-03 — data clears to null on filter change → loading state. The dim animation runs on current data; then store dispatch clears data.

```typescript
// In BarRenderer (or a shared hook):
const [clickedElement, setClickedElement] = useState<unknown>(null);

const handleDrillDownClick = (value: unknown) => {
  if (!cfg.drillDownColumn || !tableId) return;
  setClickedElement(value);                    // 1. dim peers
  setTimeout(() => {
    setClickedElement(null);                   // 3. clear local state (data will be cleared by store)
    const dataType = inferDataTypeFromColumn(
      cfg.drillDownColumn as string,
      cfg.columnTypes as Record<string, string> ?? {}
    );
    const isDedupe = /* check store */ false;
    useFilterStore.getState().addFilter(tableId, {
      column: cfg.drillDownColumn as string,
      value,
      dataType,
      sourceWidgetId: widget.id,
      addedAt: Date.now(),
    });                                         // 2. dispatch (triggers data clear + refetch)
    // Toast on first add (not dedupe/replace) — check before dispatch
  }, 300);
};

// In Bar element:
<Cell
  key={index}
  fill={color}
  fillOpacity={
    clickedElement !== null
      ? String(row[x]) === String(clickedElement) ? 1 : 0.3
      : 1
  }
/>
```

**Toast firing logic:**
The toast must fire BEFORE `addFilter` is called (to correctly detect dedupe/replace). Check the store state before dispatch:

```typescript
const existing = useFilterStore.getState().filters[tableId] ?? [];
const sameCol = existing.find((f) => f.column === cfg.drillDownColumn);
const isDedupe = sameCol?.value === value;
const isReplace = sameCol !== undefined && sameCol.value !== value;
// Show toast only on first add (not dedupe, not replace)
if (!isDedupe && !isReplace) {
  const chipText = buildChipText(cfg.drillDownColumn as string, value, dataType);
  useToastStore.getState().showToast(chipText, "info");
}
useFilterStore.getState().addFilter(tableId, { ... });
```

**Cap-reached toast:** fired independently by `addFilter` itself (already in Phase 9 filterStore.ts:44-49). Phase 10 does NOT need to handle it.

### Pattern 5: Row-Tint (Records/Table persistent visual state)

**Current row styling (verified from WidgetRenderer.tsx):**

- `TableRenderer` line 443: `<tr key={i} className={striped && i % 2 === 1 ? "widget-table-stripe" : ""}>`
- `RecordsTableRenderer` line 636: `<tr key={i} className={striped && i % 2 === 1 ? "widget-table-stripe" : ""}>`

**Phase 10 addition:** When `cfg.drillDownColumn` is set and `tableFilters` contains an active filter on that column, each row gets an additional CSS class or inline style:

```typescript
// TableRenderer — read active filter value from store (via props or selector)
const activeFilterValue = tableFilters.find(
  (f) => f.column === (cfg.drillDownColumn as string)
)?.value;

// In <tr>:
const isFiltered = activeFilterValue !== undefined
  && String(row[cfg.drillDownColumn as string]) === String(activeFilterValue);
<tr
  key={i}
  className={`
    ${striped && i % 2 === 1 ? "widget-table-stripe" : ""}
    ${isFiltered ? "widget-table-row-active" : ""}
  `.trim()}
>
```

The CSS class `widget-table-row-active` should apply a subtle accent-tinted background. This is compatible with zebra striping — applied on top via specificity or ordering.

**Important:** `TableRenderer` is currently inside `AggregatedWidgetRenderer`, which already subscribes to `tableFilters` via `useFilterStore`. No additional subscription is needed — `tableFilters` flows down as a prop to the renderer function. `RecordsTableRenderer` is separate from `AggregatedWidgetRenderer` and does NOT currently subscribe to the filter store. Phase 10 must wire the filter store subscription into `RecordsTableRenderer` for the row-tint to work.

### Pattern 6: Filter Bar Rewrite (DashboardsPage.tsx:462-482)

**Current JSX (verified, lines 462-482):**

```tsx
{views.length > 0 && (
  <div className="filter-bar">
    {views.map((v) => {
      const srcTable = associatedTables.find((t) => t.id === v.table_id);
      const srcName = srcTable
        ? srcTable.schema ? `${srcTable.schema}.${srcTable.name}` : srcTable.name
        : v.view_name;
      const hasFilters = !!v.filter_clause?.trim();
      return (
        <div key={v.id} className="filter-bar-item">
          <span className="filter-bar-table">{srcName}</span>
          {hasFilters ? (
            <span className="filter-bar-clause">WHERE {v.filter_clause}</span>
          ) : (
            <span className="filter-bar-none">No filters</span>
          )}
        </div>
      );
    })}
  </div>
)}
```

**Phase 10 rewrite target:** The outer condition changes from `views.length > 0` to "any view has non-empty filter_clause OR any table has active store filters". The per-view row gains: store chips with `×` dismiss buttons, and a "Clear all" button. The `filter-bar-none` label disappears (rows with no filters simply show nothing except "Clear all" when store filters exist).

New CSS classes needed:
- `filter-bar-chips` — wraps the inline store chips row
- `filter-bar-chip` — individual dismissable chip
- `filter-bar-chip-dismiss` — the `×` button inside a chip
- `filter-bar-clear` — the "Clear all" button
- `widget-table-row-active` — in global.css for row-tint

**The outer `DashboardOpen` component needs `useFilterStore` subscription.** It already imports `useFilterStore` (for the reset in `useEffect([dashboard.id])`). Adding a selector for all current filters:

```typescript
const allStoreFilters = useFilterStore((state) => state.filters);
// Show condition: any table with non-empty filter_clause OR any tableId with store filters
const hasAnyFilters = views.some((v) => v.filter_clause?.trim())
  || Object.values(allStoreFilters).some((arr) => arr.length > 0);
```

### Pattern 7: Chip Text Formatting

```typescript
export function buildChipText(
  column: string,
  value: unknown,
  dataType: "string" | "number" | "boolean" | "datetime" | "null"
): string {
  if (dataType === "null" || value === null) return `${column} IS NULL`;
  if (dataType === "string") return `${column} = '${value}'`;
  if (dataType === "datetime") return `${column} = '${value instanceof Date ? value.toISOString() : value}'`;
  return `${column} = ${value}`;  // number, boolean — unquoted
}
```

This also produces the toast text verbatim (DRILL-04 success criterion #5).

### Anti-Patterns to Avoid

- **No per-chart filter state** (AP-1): `clickedElement` is local transient state for animation only; the actual filter lives in `useFilterStore` exclusively.
- **No runtime tableId lookup** (AP-6): read `cfg.tableId as number` directly; it's persisted by Phase 9 plan 09-02.
- **No drillDownColumn sibling registry** (AP-5): `drillDownColumn` lives ONLY in `widget.config.drillDownColumn`.
- **No bypassing `addFilter`** (AP-3): clicked values go through `addFilter` → `buildEqualityFilter` → `escapeKineticaStringLiteral`; never raw string interpolation.
- **No C-03 violation**: sequenced dim-then-dispatch (300ms delay) preserves the "no stale data" contract.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SQL escaping of clicked value | Custom string-replace | `addFilter` → `buildEqualityFilter` → `escapeKineticaStringLiteral` (Phase 9) | Already tested; AP-3 lock |
| Column-type-to-dataType mapping | Inline switch in each renderer | `inferDataTypeFromColumn(colName, columns)` utility | Needs to be consistent across 6 chart types |
| DataType inference at click time | Re-derive from value `typeof` | Store `drillDownColumnType` in `widget.config` at save time | Renderers don't have `TableDto.columns` at render time; config panel does |
| Chip text formatting | Per-chip inline logic | `buildChipText(column, value, dataType)` | Used in both toast and chip rendering; must be identical |

---

## Common Pitfalls

### Pitfall 1: Pie Click — `data.payload` Not `data`

**What goes wrong:** Developer uses `data[cfg.drillDownColumn]` on the first argument of `Pie onClick`, but the source row is at `data.payload`, not on `data` directly. The `data` argument is a `PieSectorDataItem` with geometry/sector fields; `data.payload` is the original data row object.

**Why it happens:** Other Recharts chart types expose the source row at `activePayload[0].payload`. Pie's per-slice `onClick` is a different signature.

**How to avoid:** `const row = data?.payload as Row | undefined; row[cfg.drillDownColumn]`.

**Confidence:** HIGH — verified against installed `Pie.d.ts` types in the node_modules.

### Pitfall 2: `inferDataTypeFromColumn` Requires Column-Type Map at Render Time

**What goes wrong:** Renderers inside `AggregatedWidgetRenderer` receive `cfg` (the widget config) and `data` (the current rows), but NOT `TableDto.columns`. A developer tries to call `inferDataTypeFromColumn` at click time and finds no column type map available.

**Why it happens:** `TableDto` is loaded in `DashboardOpen`, passed to `ChartConfigPanel` as `tables` prop, but NOT passed to `WidgetRenderer`. The renderer only gets `widget: WidgetDto`.

**How to avoid:** At config-save time in `ChartConfigPanel`, store `drillDownColumnType: inferDataTypeFromColumn(selectedDrillDownColumn, selectedTable.columns)` into `widget.config`. Renderers then read `cfg.drillDownColumnType` directly. This is a config-time computation using data that ChartConfigPanel already has.

**Confidence:** HIGH — confirmed by tracing the `WidgetRenderer` prop chain in the codebase.

### Pitfall 3: `RecordsTableRenderer` Not Subscribed to Filter Store

**What goes wrong:** `RecordsTableRenderer` is a separate component from `AggregatedWidgetRenderer`. It currently has no `useFilterStore` subscription. Phase 10 adds row-tint to the records table and also needs to wire click handlers that call `addFilter`. If the developer only modifies `AggregatedWidgetRenderer`, the records table gets no click handling and no row-tint.

**Why it happens:** `RecordsTableRenderer` bypasses `AggregatedWidgetRenderer` entirely (WidgetRenderer.tsx lines 122-127 short-circuit to `<RecordsTableRenderer>` before `<AggregatedWidgetRenderer>`).

**How to avoid:** Phase 10 must independently wire `useFilterStore` subscription and click handlers into `RecordsTableRenderer`. The `tableId` is at `cfg.tableId as number | undefined` (same path as in `AggregatedWidgetRenderer`).

**Confidence:** HIGH — confirmed in WidgetRenderer.tsx source.

### Pitfall 4: Toast 5-Second Dedup Window May Suppress Valid First-Add Toast

**What goes wrong:** `useToastStore` has a 5-second dedup window keyed on `kind::message` (toast.ts:23-25). If a user drills down on the same `column = 'value'` combination within 5 seconds (e.g., clear filter then re-click), the toast is suppressed even though a new filter was genuinely added.

**Why it happens:** The toast store's built-in dedup is designed to prevent duplicate notifications for the same event. Here, it fires for a semantically-different event (a new filter add after clear) but with the same message text.

**How to avoid:** This is acceptable UX for v1.2. The Phase 9 addFilter exact-dedupe path means the second same-value click within 5 seconds would typically be a silent no-op anyway. The dedup window only matters after a clear + re-click, which is an edge case. Document this known behavior; don't work around it.

**Confidence:** HIGH — verified in toast.ts source.

### Pitfall 5: `filterVersion` Causes `AggregatedWidgetRenderer` Re-Fetch Even When Filter Is for Different Table

**What goes wrong:** `AggregatedWidgetRenderer`'s `useEffect` dep array includes `filterVersion`. `filterVersion` advances on EVERY mutation across ALL tables. Adding a filter for table 99 increments `filterVersion`, which fires the `useEffect` in a renderer subscribed to table 42. That renderer reads `buildWhereClause(tableFilters)` — `tableFilters` is empty for table 42 (no filters for table 42), so the WHERE clause is empty, and the fetch runs the same unfiltered SQL. The result is a spurious re-fetch that returns the same data.

**Why it happens:** This was explicitly documented in Phase 9 (WidgetRenderer.spec.tsx test "does NOT leak filter SQL when filter is added for a DIFFERENT tableId"). The test confirms the WHERE clause doesn't leak; it doesn't prevent the re-fetch itself.

**How to avoid:** This is a known accepted tradeoff from Phase 9. The spurious re-fetch is a redundant HTTP round-trip but returns correct data. For v1.2 (up to ~8 charts per dashboard), this is acceptable. Document; do not attempt to optimize in Phase 10.

**Confidence:** HIGH — confirmed in WidgetRenderer.spec.tsx test comments.

### Pitfall 6: Dim-Peers Must Fire BEFORE Store Dispatch (C-03 Sequencing)

**What goes wrong:** Developer dispatches `addFilter` synchronously on click, then tries to show dim-peers. By the time dim-peers render, `AggregatedWidgetRenderer`'s `useEffect` has already fired (triggered by `filterVersion` increment), cleared `data` to show loading state, and the chart has already transitioned to loading. Dim-peers are never visible.

**Why it happens:** React state batching + Zustand synchronous updates mean `useEffect` runs before the next render paint when triggered in the same event handler.

**How to avoid:** Sequenced dim-then-clear as locked in CONTEXT.md: (1) `setClickedElement(value)` first — this triggers one render with dimmed peers, (2) `setTimeout(300ms)` then dispatch. The render with dim-peers is visible for ~300ms before loading state takes over.

**Confidence:** HIGH — understanding of React render cycle and Phase 9's C-03 contract.

### Pitfall 7: Kinetica `DATA_TYPE` Strings Are NOT Standard SQL Types

**What goes wrong:** Developer writes `isColumnDrillDownSafe` expecting SQL standard type names like `VARCHAR`, `NVARCHAR`, `LONGTEXT`. Kinetica's `DATA_TYPE` from `INFORMATION_SCHEMA.COLUMNS` uses Kinetica-specific strings. The geometry exclusion list must use Kinetica's actual type names.

**Why it happens:** The server-side column discovery (server/src/index.ts:642-654) uses `SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS`. The returned types are Kinetica's internal type names.

**Known Kinetica geometry/spatial types to exclude:** `wkt`, `wkb`, `bytes` (Kinetica native binary geometry), `point`, `geometry`, `geography`. The exact set should be documented in a comment with `// PITFALL D-01 lock`.

**How to avoid:** Use a normalized lowercase comparison set. Keep the exclusion list conservative (add unknown types to a safe "pass through" path, not to exclusion — geometry misidentification produces wrong filters but doesn't crash). Confirm type strings against an actual Kinetica `/api/kinetica/.../columns` response during first dashboard test.

**Confidence:** MEDIUM — Kinetica type strings are from server code analysis, not official Kinetica docs. The type strings in the exclusion set should be validated against a real Kinetica instance during manual QA.

---

## Code Examples

### Toast store API (confirmed from toast.ts source)

```typescript
// toast.ts exports:
export type ToastKind = "permission" | "info" | "error";
// showToast signature:
showToast: (message: string, kind?: ToastKind) => void
// kind defaults to "info"
// 5-second dedup window (kind::message key)
// 5-second auto-dismiss

// Phase 10 usage:
useToastStore.getState().showToast(`region = 'EAST'`, "info");
useToastStore.getState().showToast(`status IS NULL`, "info");
useToastStore.getState().showToast(`score = 42`, "info");
```

### Filter store API (confirmed from filterStore.ts source — Phase 10 is consumer only)

```typescript
// addFilter signature (Phase 9):
addFilter(tableId: number, filter: ActiveFilter): void
// where ActiveFilter = { column, value, dataType, sourceWidgetId?, addedAt }

// removeFilter (for chip × button):
removeFilter(tableId: number, column: string): void

// clearFilters (for "Clear all" button):
clearFilters(tableId: number): void

// Pre-dispatch check for toast suppression:
const existing = useFilterStore.getState().filters[tableId] ?? [];
const sameCol = existing.find((f) => f.column === drillDownColumn);
```

### Recharts BarChart/LineChart onClick (confirmed from generateCategoricalChart.d.ts)

```typescript
// CategoricalChartFunc = (nextState: CategoricalChartState, event: any) => void
// CategoricalChartState.activePayload?: any[]
// activePayload[0].payload = the source data row

<BarChart
  data={data}
  onClick={(nextState) => {
    if (!cfg.drillDownColumn) return;
    const payload = nextState?.activePayload?.[0]?.payload as Row | undefined;
    if (!payload) return;
    // value = payload[cfg.drillDownColumn]
  }}
/>
```

### Recharts Pie onClick (confirmed from Pie.d.ts)

```typescript
// Pie onClick: (data: PieSectorDataItem, index: number, e: React.MouseEvent) => void
// PieSectorDataItem.payload?: any  <-- the source row is HERE

<Pie
  onClick={(sliceData) => {
    if (!cfg.drillDownColumn) return;
    const row = sliceData?.payload as Row | undefined;
    if (!row) return;
    // value = row[cfg.drillDownColumn]
  }}
/>
```

### Cell dim-peers pattern (bar example)

```typescript
// x is the groupByColumn (category key)
{data.map((row, index) => (
  <Cell
    key={index}
    fill={color}
    fillOpacity={
      clickedElement !== null
        ? String(row[x]) === String(clickedElement) ? 1.0 : 0.3
        : 1.0
    }
  />
))}
```

### Filter bar chip JSX structure

```tsx
{storeFilters.map((f) => (
  <span key={f.column} className="filter-bar-chip">
    {buildChipText(f.column, f.value, f.dataType)}
    <button
      className="filter-bar-chip-dismiss"
      onClick={() => useFilterStore.getState().removeFilter(tableId, f.column)}
      aria-label={`Remove filter ${f.column}`}
    >
      ×
    </button>
  </span>
))}
{storeFilters.length > 0 && (
  <button
    className="filter-bar-clear"
    onClick={() => useFilterStore.getState().clearFilters(tableId)}
  >
    Clear all
  </button>
)}
```

---

## State of the Art

| Old Approach | Current Approach (Phase 10) | When Changed | Impact |
|---|---|---|---|
| Display-only filter bar (views.filter_clause only) | Interactive filter bar (store chips + static clause unified) | Phase 10 | Users can dismiss individual filters; bar shows dynamic state |
| No drill-down (charts are read-only) | Click-to-filter on 6 chart types | Phase 10 | Core v1.2 value proposition delivered |

**Not present yet (deferred):**
- Range filters — DRILL-V13-02 (v1.3)
- Multi-value OR — DRILL-V13-01 (v1.3)
- Undo — DRILL-V13-03 (v1.3)

---

## Open Questions

1. **Exact Kinetica `DATA_TYPE` strings for geometry/spatial columns**
   - What we know: server returns values from `INFORMATION_SCHEMA.COLUMNS DATA_TYPE` column; server code analysis shows `wkt`, `wkb`, `bytes` are plausible values
   - What's unclear: whether Kinetica uses `WKT`, `wkt`, `GEOMETRY`, or something else for spatial columns; Kinetica version-dependent
   - Recommendation: use case-insensitive normalized comparison in `isColumnDrillDownSafe`; log the actual type strings encountered in `ChartConfigPanel` during development to calibrate the exclusion set. The function's conservative behavior (only exclude known-bad types) means unknown types fall through to the picker, which is safer than over-excluding.

2. **TIMESTAMP literal format for datetime clicks (carried from Phase 9)**
   - What we know: `buildEqualityFilter` in filterStore.ts uses `TIMESTAMP 'YYYY-MM-DD HH:MM:SS'` (LOW confidence per Phase 9 verification, noted at filterStore.ts:139-145)
   - What's unclear: whether deployed Kinetica accepts this exact syntax or requires a different format
   - Recommendation: Phase 10's first datetime-column drill-down click path validates this. If validation fails, the fix is one branch in `buildEqualityFilter` — not Phase 10's responsibility to fix, but its responsibility to validate and report.

3. **`filterVersion` selector isolation in `DashboardOpen`**
   - What we know: subscribing to `useFilterStore((s) => s.filters)` for the filter bar will cause `DashboardOpen` re-render on every filter mutation
   - What's unclear: whether this causes any performance problem at the component level (DashboardOpen renders many children)
   - Recommendation: Use `useFilterStore((s) => s.filterVersion)` as the subscription dep for the filter-bar condition check, and read `useFilterStore.getState().filters` imperatively inside the render for chip content. Or accept the re-render — DashboardOpen is not a hot component.

---

## Technical Inventory of Phase 10 Changes

### Files Modified

| File | Change | Lines Affected |
|------|--------|----------------|
| `src/components/charts/registry.ts` | Add `supportsDrillDown?: boolean` to `ChartTypeDefinition` | +5 lines |
| `src/components/charts/definitions/bar.ts` | Add `supportsDrillDown: true` | +1 line |
| `src/components/charts/definitions/line.ts` | Add `supportsDrillDown: true` | +1 line |
| `src/components/charts/definitions/pie.ts` | Add `supportsDrillDown: true` | +1 line |
| `src/components/charts/definitions/scatter.ts` | Add `supportsDrillDown: true` | +1 line |
| `src/components/charts/definitions/table.ts` | Add `supportsDrillDown: true` | +1 line |
| `src/components/charts/definitions/records.ts` | Add `supportsDrillDown: true` | +1 line |
| `src/components/charts/ChartConfigPanel.tsx` | Add `drillDownColumn` picker section for `supportsDrillDown` chart types; filter columns by `isColumnDrillDownSafe`; persist `drillDownColumnType` | +40-60 lines |
| `src/components/charts/WidgetRenderer.tsx` | Add `onClick` handlers to BarRenderer, LineRenderer, PieRenderer, ScatterRenderer, TableRenderer; dim-peers transient; cursor; RecordsTableRenderer filter subscription + click handler + row-tint | +100-150 lines |
| `src/components/DashboardsPage.tsx` | Rewrite filter bar block (lines 462-482) to add store chips + dismiss + Clear all + new show-condition | Replace 21 lines with ~60 lines |

### Files Created

| File | Purpose |
|------|---------|
| `src/lib/columnTypes.ts` | `isColumnDrillDownSafe`, `inferDataTypeFromColumn`, `buildChipText` |
| `src/lib/columnTypes.spec.ts` (or in spec layout plan) | Unit tests for the three utilities |
| `src/components/charts/WidgetRenderer.spec.tsx` | Extended with Phase 10 click-handler and visual-state tests |

---

## Validation Architecture

> `workflow.nyquist_validation` is explicitly `false` in `.planning/config.json`. Skipping this section.

---

## Sources

### Primary (HIGH confidence)
- Direct read: `kinetica_bi/src/components/charts/WidgetRenderer.tsx` — renderer structure, current row styling, RecordsTableRenderer separation, filter store subscription pattern
- Direct read: `kinetica_bi/src/store/filterStore.ts` — ActiveFilter type, addFilter/removeFilter/clearFilters API, exact dedupe/replace semantics
- Direct read: `kinetica_bi/src/store/toast.ts` — ToastKind union, showToast signature, 5s dedup window
- Direct read: `kinetica_bi/src/components/charts/registry.ts` — ChartTypeDefinition type, existing fields
- Direct read: `kinetica_bi/src/components/charts/ChartConfigPanel.tsx` — column pipeline (allColumns, numericColumns), isNumericType pattern
- Direct read: `kinetica_bi/src/components/DashboardsPage.tsx:462-482` — current filter bar JSX, CSS class names
- Direct read: `kinetica_bi/node_modules/recharts/types/chart/generateCategoricalChart.d.ts` — CategoricalChartFunc, CategoricalChartState.activePayload
- Direct read: `kinetica_bi/node_modules/recharts/types/polar/Pie.d.ts` — PieSectorDataItem, Pie onClick signature
- Direct read: `kinetica_bi/node_modules/recharts/types/cartesian/Scatter.d.ts` — ScatterPointItem.payload
- Direct read: `kinetica_bi/node_modules/recharts/types/chart/types.d.ts` — CategoricalChartState shape
- Direct read: `kinetica_bi/server/src/index.ts:642-654` — column discovery endpoint (INFORMATION_SCHEMA.COLUMNS DATA_TYPE)
- Direct read: `kinetica_bi/vitest.config.ts` — test config (jsdom, globals, setupFiles, include glob)
- Direct read: `kinetica_bi/__mocks__/zustand.ts` — store-reset shim pattern
- Direct read: `kinetica_bi/src/test/setup.ts` — vi.mock("zustand") activation, cleanup
- Direct read: `kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx` — existing test patterns, mock shapes

### Secondary (MEDIUM confidence)
- Kinetica DATA_TYPE strings (wkt, wkb, bytes, geometry) inferred from Kinetica documentation conventions and codebase PITFALLS.md D-01 guidance; not validated against a live Kinetica instance

## Metadata

**Confidence breakdown:**
- Recharts click event shapes: HIGH — confirmed against installed 2.15.4 type definitions
- Column metadata pipeline: HIGH — confirmed against ChartConfigPanel.tsx + server/src/index.ts
- Filter store API: HIGH — confirmed against filterStore.ts (Phase 9 artifact)
- Toast store API: HIGH — confirmed against toast.ts source
- Dim-peers animation: HIGH — Cell + fillOpacity is standard Recharts pattern; 300ms timing at Claude's discretion
- Kinetica DATA_TYPE exclusion strings: MEDIUM — inferred from codebase analysis, not live Kinetica query
- TIMESTAMP literal format: LOW — carried from Phase 9 open question; validated by Phase 10 datetime-click path

**Research date:** 2026-05-04
**Valid until:** 2026-05-18 (Recharts 2.x API is stable; 14-day window adequate)
