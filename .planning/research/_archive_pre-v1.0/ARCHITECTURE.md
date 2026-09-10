# Architecture Research

**Domain:** BI Dashboard — interactive cross-filtering and drill-down on a Kinetica GPU-DB backend
**Researched:** 2026-04-02
**Confidence:** HIGH (based on direct codebase analysis + established BI dashboard patterns)

---

## Standard Architecture for BI Cross-Filtering

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        React Frontend                                │
├───────────────────────┬─────────────────────────────────────────────┤
│   DashboardOpen       │        Filter Coordination Layer            │
│  (page host)          │  ┌──────────────────────────────────────┐   │
│                       │  │  useDashboardFilterStore (Zustand)   │   │
│  - owns widget list   │  │                                      │   │
│  - owns views[]       │  │  filters: FilterState[]              │   │
│  - owns layout        │  │  addFilter(col, op, value)           │   │
│                       │  │  removeFilter(col)                   │   │
│                       │  │  clearFilters()                      │   │
│                       │  │  buildWhereClause(tableColumns)      │   │
│                       │  └──────────────────────────────────────┘   │
├───────────────────────┴─────────────────────────────────────────────┤
│                       Widget Grid (react-grid-layout)                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │  WidgetCard  │  │  WidgetCard  │  │  WidgetCard  │              │
│  │  ┌────────┐  │  │  ┌────────┐  │  │  ┌────────┐  │              │
│  │  │Widget  │  │  │  │Widget  │  │  │  │Widget  │  │              │
│  │  │Renderer│  │  │  │Renderer│  │  │  │Renderer│  │              │
│  │  └────────┘  │  │  └────────┘  │  │  └────────┘  │              │
│  │  onClick →   │  │  reads       │  │  reads       │              │
│  │  dispatch    │  │  filter ctx  │  │  filter ctx  │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
├─────────────────────────────────────────────────────────────────────┤
│                       Filter Bar (read-only display)                 │
│   [schema.table WHERE col = 'X']  [table2  No filters]              │
└─────────────────────────────────────────────────────────────────────┘
         │ POST /api/sql (SQL with injected WHERE clause)
┌─────────────────────────────────────────────────────────────────────┐
│                     Express Backend (port 4000)                      │
│   /api/sql  →  Kinetica /execute/sql  (raw proxy, no filter logic)  │
│   /api/dashboards, /api/widgets, /api/views  →  SQLite              │
└─────────────────────────────────────────────────────────────────────┘
         │
┌─────────────────────────────────────────────────────────────────────┐
│               Kinetica GPU-DB  +  SQLite (metadata)                  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Component Responsibilities

| Component | Responsibility | Communicates With |
|-----------|----------------|-------------------|
| `DashboardOpen` | Owns widget list, associated tables, views, layout persistence; routes config/removal actions | All child components, backend API |
| `useDashboardFilterStore` (new Zustand slice) | Single source of truth for active cross-filters; exposes add/remove/clear actions and a SQL WHERE builder | Read by every `WidgetRenderer`; written by click handlers |
| `WidgetCard` (wrapper div in grid) | Renders header, drag handle, configure/remove buttons; forwards click events up | `WidgetRenderer`, `DashboardOpen` |
| `WidgetRenderer` | Fetches data via `runSql`, parses Kinetica columnar format, renders chart; fires `onDataPointClick` callback on interaction | Filter store (read), `runSql` API client |
| `FilterBar` | Displays active filters as readable pills; "Clear all" button | Filter store (read) |
| `ChartConfigPanel` | Structured query builder; generates SQL stored on widget config; not involved in runtime filtering | `DashboardOpen` (via modal) |
| Express `/api/sql` | Stateless SQL proxy; authenticates to Kinetica; returns raw columnar JSON | Kinetica GPU-DB |
| SQLite (via `db.ts`) | Persists dashboards, widgets (including `config.sql`), table associations, view metadata | Express routes only |

---

## Recommended Project Structure

```
src/
├── store/
│   ├── user.ts              # existing — user preferences
│   └── dashboardFilters.ts  # NEW — cross-filter state (FilterState[], actions, WHERE builder)
│
├── components/
│   ├── charts/
│   │   ├── registry.ts           # existing — chart type registry
│   │   ├── ChartConfigPanel.tsx  # existing — structured query builder
│   │   ├── WidgetRenderer.tsx    # existing — needs: onDataPointClick prop + filter injection
│   │   └── definitions/          # existing — per-type field definitions
│   │
│   ├── DashboardOpen.tsx    # existing — needs: pass filter context, handle drill-down
│   ├── FilterBar.tsx        # existing (inline in DashboardOpen) — extract to own file
│   ├── DashboardsPage.tsx   # existing — unchanged
│   └── ChartCard.tsx        # existing — unchanged
│
├── hooks/
│   └── useWidgetData.ts     # NEW — encapsulate fetch + parse + filter injection logic
│
├── api/
│   └── client.ts            # existing — unchanged for this milestone
│
└── types/
    └── filters.ts           # NEW — FilterState, FilterOperator, ActiveFilter types
```

### Structure Rationale

- **`store/dashboardFilters.ts`:** Filters must be global within a dashboard session. A Zustand slice (matching the existing `user.ts` pattern) gives every widget read access without prop drilling. Scope it to dashboard ID so navigating between dashboards resets state.
- **`hooks/useWidgetData.ts`:** The current `WidgetRenderer` has fetch + parse + render all in one component. Extracting data-fetching into a hook makes filter injection one clean insertion point: append the WHERE clause to the widget's stored SQL before the fetch fires.
- **`types/filters.ts`:** Centralizes the filter shape so `FilterBar`, `WidgetRenderer`, and the store all agree on what a filter is.
- **`FilterBar.tsx` as its own file:** It is already complex enough (table lookup + filter display) to justify extraction; it will grow when "click to clear" is added.

---

## Architectural Patterns

### Pattern 1: Global Filter Store (Hub-and-Spoke)

**What:** A single Zustand store holds all active cross-filters for the current dashboard. Every widget reads from it; any widget's click dispatches to it. The store is the only coordination point — widgets do not communicate directly with each other.

**When to use:** This project. Single-page, single dashboard open at a time, moderate number of widgets (< 50). Simple to reason about, trivial to debug.

**Trade-offs:** Filters are scoped to one dashboard view at a time (acceptable). All widgets re-render on any filter change (acceptable at this scale; use `useMemo` for SQL generation to avoid unnecessary fetches).

**Example:**

```typescript
// src/store/dashboardFilters.ts
import { create } from "zustand";

export type FilterOperator = "=" | "!=" | ">" | "<" | ">=" | "<=" | "IN" | "LIKE";

export type ActiveFilter = {
  column: string;
  operator: FilterOperator;
  value: string | number | (string | number)[];
  sourceWidgetId?: number; // which widget produced the filter (for highlight)
};

type FilterStore = {
  dashboardId: number | null;
  filters: ActiveFilter[];
  setDashboard: (id: number) => void;
  addFilter: (filter: ActiveFilter) => void;
  removeFilter: (column: string) => void;
  clearFilters: () => void;
  buildWhereClause: () => string;
};

export const useDashboardFilterStore = create<FilterStore>((set, get) => ({
  dashboardId: null,
  filters: [],
  setDashboard: (id) => set({ dashboardId: id, filters: [] }),
  addFilter: (filter) =>
    set((s) => ({
      filters: [...s.filters.filter((f) => f.column !== filter.column), filter]
    })),
  removeFilter: (column) =>
    set((s) => ({ filters: s.filters.filter((f) => f.column !== column) })),
  clearFilters: () => set({ filters: [] }),
  buildWhereClause: () => {
    const { filters } = get();
    if (filters.length === 0) return "";
    const clauses = filters.map((f) => {
      if (f.operator === "IN" && Array.isArray(f.value)) {
        const list = f.value.map((v) => `'${v}'`).join(", ");
        return `${f.column} IN (${list})`;
      }
      const val = typeof f.value === "string" ? `'${f.value}'` : f.value;
      return `${f.column} ${f.operator} ${val}`;
    });
    return clauses.join(" AND ");
  }
}));
```

### Pattern 2: SQL Injection at the Widget Data-Fetch Layer

**What:** The widget's stored `config.sql` is a complete, pre-generated SELECT statement (already the case — see `ChartConfigPanel.tsx` line 112). At query time, the WHERE clause from the filter store is appended as a subquery wrapper or injected before `GROUP BY`. The SQL is composed in the frontend, sent to the stateless proxy.

**When to use:** This project. The backend is a thin proxy; all query logic must live in the client.

**Trade-offs:** Appending WHERE to an existing GROUP BY query requires wrapping the original SQL as a subquery, or the query builder must be aware of filters. The cleaner approach: wrap in subquery.

**Example:**

```typescript
// src/hooks/useWidgetData.ts
export function injectFiltersIntoSql(baseSql: string, whereClause: string): string {
  if (!whereClause) return baseSql;
  // Wrap the base query so we don't conflict with existing GROUP BY / ORDER BY
  return `SELECT * FROM (${baseSql}) AS _filtered WHERE ${whereClause}`;
}
```

Note: Kinetica supports subquery wrapping in its SQL dialect. Verify with a test query early in the milestone.

### Pattern 3: Click-to-Filter via Chart Event Callbacks

**What:** Each Recharts component exposes an `onClick` prop. When a user clicks a bar, slice, or data point, the chart renderer calls `onDataPointClick(column, value)` — a prop passed down from `DashboardOpen`. `DashboardOpen` dispatches to the filter store. The filter store update triggers all widgets to re-fetch with the new WHERE clause.

**When to use:** This project. Recharts provides `onClick` on `Bar`, `Cell`, `Pie`, `Line` (via `activeDot`), and `ScatterChart`.

**Trade-offs:** Each chart type fires different payload shapes — the callback needs to normalize them to `{column, value}`. This normalization belongs in `WidgetRenderer` before the callback is called, not in the consumer.

**Example:**

```typescript
// In WidgetRenderer — BarRenderer section
<Bar
  dataKey={y}
  onClick={(entry) => {
    onDataPointClick?.({ column: x, value: entry[x] as string });
  }}
/>
```

### Pattern 4: Filter Scoping by Table

**What:** Each filter is annotated with the column name only (not table-qualified). When a widget queries a different table, its SQL does not contain that column, so the injected WHERE clause either has no effect (if the column doesn't exist) or causes an error. To avoid this, `buildWhereClause` should be called table-aware — only include filters whose columns exist in the widget's table schema.

**When to use:** This project, immediately. The existing `associatedTables` array in `DashboardOpen` provides column lists per table.

**Trade-offs:** Requires passing the widget's resolved column list into the WHERE builder, or maintaining a column-to-table index in the store. The simpler approach for v1: pass column names to `buildWhereClause` and filter out inapplicable filters silently.

---

## Data Flow

### Drill-Down / Cross-Filter Flow

```
User clicks bar segment in Widget A
    ↓
BarRenderer.onClick fires with { entry[x] = "West" }
    ↓
WidgetRenderer calls onDataPointClick({ column: "region", value: "West" })
    ↓
DashboardOpen.handleDrillDown dispatches to useDashboardFilterStore.addFilter(...)
    ↓
Filter store updates: filters = [{ column: "region", operator: "=", value: "West" }]
    ↓
All WidgetRenderers subscribed to store re-render
    ↓
useWidgetData (or WidgetRenderer useEffect) detects filter change (new whereClause)
    ↓
Re-issues POST /api/sql with wrapped SQL: SELECT * FROM (...baseSql...) WHERE region = 'West'
    ↓
Express proxies to Kinetica → columnar response
    ↓
parseKineticaResponse() pivots columns to rows
    ↓
Chart renders with filtered data
    ↓
FilterBar reads store and displays: [region = 'West']
```

### Config / Persistence Flow (unchanged, for reference)

```
User opens config panel → ChartConfigPanel generates SQL string
    ↓
onSave(config) → DashboardOpen.handleSaveConfig
    ↓
PATCH /api/widgets/:id with { config: { sql: "...", layout: {...} } }
    ↓
Express → SQLite persists config.sql
    ↓
Next page load: listWidgets() → WidgetRenderer reads config.sql
```

### State Management Summary

```
useDashboardFilterStore (Zustand)
    ↑ addFilter / removeFilter / clearFilters
    │   (called by DashboardOpen.handleDrillDown)
    │
    ↓ filters[], buildWhereClause()
    │   (read by each WidgetRenderer / useWidgetData hook)
    │
    ↓ filters[]
        (read by FilterBar for display)
```

---

## Build Order (Dependency Chain)

Components must be built in this order because each depends on the previous:

1. **`types/filters.ts`** — `ActiveFilter`, `FilterOperator` types. Zero dependencies. All other new code imports from here.

2. **`store/dashboardFilters.ts`** — Zustand store with `buildWhereClause`. Depends on filter types. No React dependency — testable in isolation.

3. **`hooks/useWidgetData.ts`** — Extracts fetch+parse from `WidgetRenderer`; implements `injectFiltersIntoSql`. Depends on filter store and existing `runSql` + `parseKineticaResponse`. This is the gating item for all chart rendering work.

4. **`WidgetRenderer.tsx` (update)** — Add `onDataPointClick` prop to all chart renderers (Bar, Pie, Line, Scatter). Wire existing renderers to call the callback. Switch from inline fetch to `useWidgetData`. Depends on step 3.

5. **`FilterBar.tsx` (extract and update)** — Extract from `DashboardOpen`, connect to filter store, add clear-per-filter and clear-all buttons. Depends on step 2.

6. **`DashboardOpen.tsx` (update)** — Add `handleDrillDown` that dispatches to filter store; call `setDashboard(id)` on mount to reset filters; pass `onDataPointClick` down to `WidgetRenderer`. Depends on steps 2, 4, 5.

7. **Integration / end-to-end verification** — Verify subquery wrapping works in Kinetica's SQL dialect with real data. Validate filter clearing re-fetches all widgets.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Kinetica GPU-DB | Stateless POST to `/api/sql` proxy; no connection pooling; Kinetica handles concurrency | Columnar response must be parsed client-side via `parseKineticaResponse`. Subquery wrapping (`SELECT * FROM (...) WHERE ...`) must be validated against Kinetica SQL dialect early — it is standard ANSI SQL but test before assuming. |
| SQLite (backend) | Synchronous `better-sqlite3` calls; widget `config` stored as JSON blob | Filter state is NOT persisted to SQLite for v1 (client-only session state). Dashboard state persistence (saving filters) is a separate Active requirement and will need a new SQLite column or a separate `dashboard_state` table. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `DashboardOpen` → `WidgetRenderer` | Props: `widget`, `onDataPointClick` | Add `onDataPointClick` as a new optional prop; existing render path unaffected if omitted. |
| `WidgetRenderer` → Filter Store | Zustand `useStore` hook (read-only in renderer) | Renderers subscribe to `buildWhereClause()` result; do not dispatch from renderers directly — always route through the parent callback. |
| `DashboardOpen` → Filter Store | Zustand `useStore` hook (dispatch only) | `handleDrillDown` is the single point where filters are written. |
| `FilterBar` → Filter Store | Zustand `useStore` hook (read + dispatch clear) | FilterBar reads `filters[]` and calls `removeFilter` or `clearFilters`. |
| Frontend → Backend | REST over HTTP; all filter logic resolved to SQL string before crossing this boundary | The backend remains a stateless proxy — zero filter logic belongs there. |

---

## Anti-Patterns

### Anti-Pattern 1: Storing Filters in Backend Views

**What people do:** When a user drills down, update the `filter_clause` on the `View` record in SQLite and re-materialize the Kinetica materialized view.

**Why it's wrong:** Materialized views are DDL operations (`CREATE OR REPLACE MATERIALIZED VIEW`). They are not designed for interactive filter changes — they are expensive, they change underlying Kinetica schema state, and they do not reset when the user clears filters without another DDL call. The existing code already treats views as "pre-built snapshots" for this reason.

**Do this instead:** Keep views as static snapshots for pre-computed datasets. Use client-side SQL injection (Pattern 2 above) for all interactive filtering.

### Anti-Pattern 2: Prop Drilling Filter State Through the Widget Tree

**What people do:** Pass `activeFilters` as a prop from `DashboardOpen` → widget grid → `WidgetCard` → `WidgetRenderer`. Each intermediate component receives a prop it doesn't use, just to forward it down.

**Why it's wrong:** The grid already has two levels of wrapper components. Adding filter props to all of them makes every grid re-render cascade on each filter change, and it couples layout components to data concerns.

**Do this instead:** `WidgetRenderer` reads from the Zustand store directly. `DashboardOpen` only dispatches write actions; it does not pass filter state downward as props.

### Anti-Pattern 3: Re-fetching All Widgets Synchronously on Filter Change

**What people do:** On `addFilter`, iterate over all widgets and await their SQL calls sequentially before updating the UI.

**Why it's wrong:** This blocks the UI, creates a waterfall of network requests, and makes the dashboard feel slow. Kinetica is GPU-accelerated and handles parallel queries well.

**Do this instead:** Let each `WidgetRenderer` independently react to the store update and fetch in parallel. Each component manages its own loading state. The dashboard remains interactive while widgets load.

### Anti-Pattern 4: Concatenating Raw User-Clicked Values Into SQL Strings Unsanitized

**What people do:** Take the value the user clicked in a chart (e.g., a category label from real data) and interpolate it directly: `` `WHERE ${col} = ${value}` ``.

**Why it's wrong:** If data contains SQL-special characters (apostrophes in names, semicolons, etc.) this produces broken or exploitable SQL. Even in an internal tool.

**Do this instead:** Wrap string values in single quotes and escape embedded single quotes (`value.replace(/'/g, "''")`), or (preferred) use a parameterized query pattern if Kinetica's API supports it. Check Kinetica's `/execute/sql` API for bind parameters — if unavailable, apply string escaping in `buildWhereClause`.

---

## Scaling Considerations

This is an internal team tool, not a multi-tenant SaaS. Scale targets are modest:

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1-5 dashboard users | Current architecture is correct. Client-side filter store, parallel widget fetches, stateless backend proxy. |
| 10-50 concurrent users | Kinetica GPU-DB handles this natively. Express is a thin proxy — no changes needed. Consider HTTP connection pooling on the backend fetch calls if many widgets hit it simultaneously. |
| Dashboard state persistence (saving filter state) | Add a `dashboard_state` JSON column to SQLite `dashboards` table. Serialize `filters[]` on `clearFilters` / navigation. Read and restore on `DashboardOpen` mount. This is an Active requirement but architecturally trivial. |
| Many widgets (> 20 per dashboard) | Add debounce (150-300ms) on filter dispatch so rapid drill-down clicks don't spawn N parallel requests per widget. A `useDebounce` hook wrapping the store subscription in `WidgetRenderer` is sufficient. |

---

## Sources

- Direct codebase analysis: `src/components/DashboardsPage.tsx`, `src/components/charts/WidgetRenderer.tsx`, `src/components/charts/ChartConfigPanel.tsx`, `src/api/client.ts`, `server/src/index.ts`, `src/store/user.ts`
- Recharts API documentation (Recharts v2): `onClick` available on `Bar`, `Pie` (via `Cell`), `Line` (via `activeDot onClick`), `ScatterChart`
- Zustand documentation: store creation pattern matches existing `user.ts` slice; confidence HIGH
- PROJECT.md: "Views as pre-built snapshots, not live filters — Simpler architecture; filtering is client-side on top of views"

---

*Architecture research for: Kinetica BI — interactive cross-filtering and drill-down*
*Researched: 2026-04-02*
