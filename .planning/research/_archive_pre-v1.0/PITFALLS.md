# Pitfalls Research

**Domain:** BI dashboard with interactive cross-filtering, drill-down, and chart coordination
**Researched:** 2026-04-02
**Confidence:** HIGH (grounded in actual codebase analysis + established BI/React patterns)

---

## Critical Pitfalls

### Pitfall 1: Filter State Scattered Across Widget-Local State

**What goes wrong:**
Each `WidgetRenderer` currently manages its own data via `useState` + `useEffect([sql])`. When drill-down is added, the natural impulse is to pass a filter down as a prop to each widget and re-run the SQL query locally. This creates N separate fetch calls (one per widget), no coordination between charts about what's "currently filtered," and no place to read or clear the active filter globally. The filter bar already exists in `DashboardOpen` state, but there is no shared filter context wiring it to `WidgetRenderer`.

**Why it happens:**
The existing architecture fetches data per-widget. Adding a `filterValue` prop feels like a small change but it silently turns the dashboard into N independent query executors rather than one coordinated system.

**How to avoid:**
Introduce a single `DashboardFilterContext` (React context or a Zustand slice) at the `DashboardOpen` level. The context holds `{ filters: FilterMap, setFilter, clearFilter }`. Every widget reads from this context to augment its SQL query. Filter changes trigger all widgets simultaneously. The filter bar reads from the same context and renders what is set there.

**Warning signs:**
- Each widget fires its own fetch when a bar is clicked
- Clearing a filter requires props changes in multiple components
- Two widgets show different "active" states for the same dimension
- Filter bar state and widget query state drift apart

**Phase to address:**
Cross-filtering foundation phase — before any drill-down click handlers are wired.

---

### Pitfall 2: SQL Injection via Client-Side Filter Construction

**What goes wrong:**
When a user clicks a bar chart element, the clicked value (a string from Kinetica data) is used to build a WHERE clause such as `WHERE region = '${clickedValue}'`. If `clickedValue` comes from Kinetica data that was itself user-provided or externally loaded, this string lands in a SQL query sent to `runSql()`. The current `kineticaSql` function in `server/src/index.ts` already has a SQL injection issue flagged in `CONCERNS.md` (lines 227, 242). Filter construction adds a new, more accessible attack surface because the value comes from clicking chart elements — values that end users can control if the underlying data is user-writable.

**Why it happens:**
Template literals for SQL construction are the obvious pattern. The fix (`WHERE col = ?` parameterized queries) requires Kinetica to support parameterized binding, which its `/execute/sql` endpoint may not. The fallback is aggressive escaping.

**How to avoid:**
Define a safe filter construction function that: (1) validates the column name against the known schema (from `widget.config.groupByColumn`), (2) escapes the value using a whitelist approach (reject anything that isn't a number or safe string), (3) uses Kinetica's parameterized syntax if supported, otherwise builds a literal with explicit escaping. Reject filter values containing `'`, `;`, `--`, `/*`, and other SQL meta-characters. Log rejected values.

**Warning signs:**
- Filter WHERE clause is built by string interpolation in the client
- No validation of clicked value before it enters a query
- Filter works fine for normal values but crashes on values with apostrophes (e.g., `O'Brien`)

**Phase to address:**
Cross-filtering foundation phase — in the same implementation as filter state, before demo or team use.

---

### Pitfall 3: Query Explosion on Cross-Filter Changes

**What goes wrong:**
The dashboard has N widgets. When one filter changes, all N widgets re-fetch. If a dashboard has 8 widgets and a user drills into a value, 8 Kinetica queries fire simultaneously. With Kinetica's GPU-accelerated backend this may be fast, but the existing hard-coded `LIMIT 1000` means each query returns up to 1000 rows, and all responses must be parsed client-side. On a large dashboard with complex queries, this creates a waterfall of requests, UI jank during loading, and potential Kinetica connection exhaustion.

**Why it happens:**
The useEffect dependency on `sql` in `WidgetRenderer` means any change to the SQL string (which encodes the filter) triggers a re-fetch. There is no batching, debouncing, or request deduplication.

**How to avoid:**
(1) Debounce filter changes — don't propagate a new filter until 150-300ms after the last change. (2) Show per-widget loading spinners immediately while the debounce elapses — this signals to the user that something is happening without hammering the server. (3) Cancel in-flight requests (AbortController) when a new filter arrives before the previous response. The current `runSql` call has no cancellation support — add it. (4) Consider a simple request queue that caps concurrent Kinetica queries to 3-4.

**Warning signs:**
- Network tab shows 8 simultaneous requests every time a chart is clicked
- Clicking rapidly through several bar segments causes stale data to land after newer data
- Kinetica returns rate-limit or timeout errors under normal interactive usage

**Phase to address:**
Cross-filtering foundation phase — implement AbortController immediately; debouncing can follow in the polish phase.

---

### Pitfall 4: Stale Closure Trap in useEffect SQL Dependency

**What goes wrong:**
`WidgetRenderer` derives the SQL query from `widget.config.sql`. When filter-aware SQL is introduced, the query string will incorporate a filter value. If the filter value comes from a context that changes but `sql` in the useEffect dependency array is computed stale (e.g., via a memoized value that didn't re-derive), widgets show outdated data while the filter bar shows the new filter. This is a React closure staleness bug — a variant of the stale closure problem in hooks.

**Why it happens:**
The current implementation has `useEffect(() => { ... }, [sql])` where `sql = cfg.sql as string`. When filter augmentation is added, developers often compute `augmentedSql = buildFilteredSql(sql, activeFilters)` and pass it as the dependency, but if `buildFilteredSql` isn't referentially stable, it either never triggers or always triggers.

**How to avoid:**
Compute the filter-augmented SQL string inside the component body (not in a useMemo with incorrect deps), and include both `sql` and `activeFilters` as explicit useEffect dependencies. Use a stable serialization of the filter map (e.g., `JSON.stringify(sortedEntries)`) as the dependency. Test by clicking rapidly between filter values and verifying chart data always matches the displayed filter.

**Warning signs:**
- Filter bar shows `region = West` but bar chart still shows all-regions data
- Clicking "clear filters" does not re-fetch all widgets
- Refreshing the page shows different data than the filtered view

**Phase to address:**
Cross-filtering foundation phase — during the initial wiring of filter context to `WidgetRenderer`.

---

### Pitfall 5: Click Handler Conflicts Between Recharts Events and react-grid-layout Drag

**What goes wrong:**
Recharts fires `onClick` on chart elements (bars, pie slices, points). `react-grid-layout` uses mousedown/mouseup to initiate dragging. When a user tries to click a bar to drill down, the grid layout sometimes intercepts the event and treats it as a drag start. This is especially bad on small widgets, where the click target is near the widget border. The result: drill-down clicks are silently swallowed, or worse, the widget moves a pixel and the click doesn't register as a selection.

**Why it happens:**
`react-grid-layout` registers drag listeners on the entire widget card `div`. The current setup uses `.widget-drag-handle` to restrict drag initiation to the header, but the `dragConfig.handle` implementation in the current version may not fully prevent bubbling issues in all Recharts SVG click scenarios.

**How to avoid:**
(1) Keep the drag handle strictly on the `.widget-drag-handle` element (already done). (2) In Recharts `onClick` handlers, call `event.stopPropagation()` to prevent bubbling to the grid layout. (3) Add a `pointerEvents: none` CSS rule on the resize handle border during click interactions. (4) Test drill-down on a widget near other widgets to verify no accidental drag occurs.

**Warning signs:**
- Clicking a bar moves the widget slightly instead of triggering a filter
- onClick fires only intermittently on small chart elements
- Console logs show click events with coordinate jumps

**Phase to address:**
Drill-down implementation phase — when Recharts onClick handlers are first wired.

---

### Pitfall 6: Filter State Lost on Navigation (No Persistence)

**What goes wrong:**
The PROJECT.md explicitly lists "Dashboard state persistence (save filter state, share dashboards)" as an active requirement. The current architecture stores no filter state — filters live in component state inside `DashboardOpen`. When a user navigates back to the dashboard list and returns, all filters reset. When they copy the URL to share a drill-down view, the recipient sees the unfiltered dashboard. Users who discover a useful data slice have no way to preserve or share it.

**Why it happens:**
Filter state is the new thing being built. There is no existing persistence mechanism and the SQLite schema has no filter state table. The Views model has a `filter_clause` column in the DB but it represents a server-side view snapshot, not an interactive session filter — conflating these two is a second-order trap (see Pitfall 7).

**How to avoid:**
Encode active filters in the URL query string (e.g., `?filters=region:West,year:2024`). Use `history.replaceState` or a URL state library to update the URL as filters change without causing a page reload. On mount, parse the URL to restore filters. This also enables shareable dashboard links. For saved filter sets, add a `saved_filters` table to SQLite.

**Warning signs:**
- Filters disappear on browser back/forward
- Sharing a dashboard URL always shows the unfiltered view
- Users start writing down filter combinations manually

**Phase to address:**
State persistence phase — after the core cross-filtering works. Do not defer indefinitely; the team will hit this pain within days of using the feature.

---

### Pitfall 7: Conflating the Views Model with Interactive Filter State

**What goes wrong:**
The existing architecture has a `views` table in SQLite with a `filter_clause` field. The design decision in PROJECT.md is "views as pre-built snapshots, not live filters." If the cross-filtering implementation is built by updating `view.filter_clause` on every drill-down click — mutating the persisted view record — then: (1) every click fires a backend write; (2) the "view" record mutates rapidly in the DB, losing the snapshot concept; (3) two users viewing the same dashboard simultaneously overwrite each other's filter states; (4) there is no way to "undo" a filter without knowing the previous value.

**Why it happens:**
The filter bar in `DashboardOpen` already renders `view.filter_clause` from the Views API. The natural impulse is to update that clause when a filter changes. It looks right because the filter bar updates correctly — but it's using the DB as a temporary variable for transient UI state.

**How to avoid:**
Maintain a strict separation: Views are immutable-ish snapshots (updated only when a user explicitly "saves" a filter set). Active interactive filters are transient client-side state (context, URL params). The filter bar should render the union of the current interactive filters and the persisted view clause, not just `view.filter_clause`. Build the SQL query as: base table query + view WHERE clause + interactive filter WHERE clause combined.

**Warning signs:**
- `updateView()` API is called on every chart click
- SQLite write logs show continuous updates during user exploration
- Two browser tabs on the same dashboard show each other's filters

**Phase to address:**
Cross-filtering foundation phase — the architecture decision must be made explicit before any click handler is written.

---

### Pitfall 8: Recharts onClick Payload Shape Varies by Chart Type

**What goes wrong:**
Each Recharts chart type passes a different payload shape to its onClick handler. `BarChart` onClick receives `{ activePayload: [{payload: {groupByColumn: val, value: n}}], activeLabel: string }`. `PieChart` onClick on `<Pie>` receives the datum object directly. `ScatterChart` onClick on `<Scatter>` receives a point object. `LineChart` has yet another shape. Writing a single `handleChartClick(payload)` function that correctly extracts the dimension value from all chart types requires chart-type-specific handling. Getting it wrong means drill-down silently filters on `undefined` or the wrong field, producing empty charts with no clear error.

**Why it happens:**
Recharts documentation describes each chart's event signature separately. Developers writing the onClick handler for the first chart type (usually bar) write a handler that works for that specific shape, then apply it to all chart types without testing — producing silent failures in pie, scatter, and line charts.

**How to avoid:**
Define a typed `ChartClickPayload` interface. In each renderer (`BarRenderer`, `PieRenderer`, etc.), write a chart-specific extraction function that normalizes the Recharts payload into `{ dimensionKey: string, dimensionValue: unknown }` before calling the shared filter handler. Test drill-down specifically for each chart type in isolation before integrating. Add a `console.warn` in the extraction fallback path so unrecognized payload shapes are visible.

**Warning signs:**
- Drill-down works on bar charts but not pie charts
- Filter bar shows "undefined" or "[object Object]" as the filter value
- No error is thrown — charts just go empty after a click

**Phase to address:**
Drill-down implementation phase — per-renderer, not as a single cross-cutting onClick handler.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Building filter SQL by string interpolation | Fast to implement | SQL injection surface; breaks on apostrophes in data values | Never — use escaping or parameterization from day one |
| Storing active filter in component state only (no URL) | Zero implementation effort | Filters lost on navigation; shareable links impossible | MVP only, but must be replaced before team daily use |
| Firing all N widget fetches on every filter change | Simple mental model | 8+ simultaneous Kinetica queries per click; stale data races | Never — at minimum add AbortController cancellation |
| Updating `view.filter_clause` for interactive filters | Reuses existing Views infrastructure | DB thrash, multi-user conflicts, loses snapshot semantics | Never — views and interactive filters must stay separate |
| Single `handleChartClick(payload)` with no chart-type dispatch | One function to write | Silent undefined filters for all non-bar charts | Only if bar is the only chart type; not acceptable here |
| Skipping loading states on filter-triggered refetch | Faster to code | Charts flash empty or show stale data while refetching | Never when charts are used for decision-making |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Kinetica `/execute/sql` | Assuming parameterized queries are supported — the REST endpoint receives SQL as a string; there is no native bind parameter mechanism | Use strict escaping: validate column names against known schema, escape string values with `replace(/'/g, "''")` and reject values with SQL meta-characters |
| Kinetica columnar response + client-side pivot | Building filter logic against the pre-pivoted columnar format | Always filter against the post-pivot row format; the `parseKineticaResponse` function in `WidgetRenderer` must run before any filter check |
| Kinetica LIMIT 1000 | Drill-down filtering on a 1000-row truncated dataset produces wrong aggregates (a group that spans rows 1001-2000 shows zero after filtering) | Push all filters to the SQL WHERE clause so Kinetica applies them server-side before the LIMIT; never filter client-side on truncated data |
| react-grid-layout + Recharts SVG | SVG click events bubble through the grid layout drag listeners | Use `stopPropagation()` in Recharts onClick handlers; verify drag handle is strictly scoped to `.widget-drag-handle` |
| Zustand store (currently user-only) | Adding filter state directly to the existing user store | Create a dedicated `dashboardStore` with `activeFilters: FilterMap` and `dashboardId: number`; the user store is for identity, not session state |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| N uncancelled Kinetica requests per filter click | Stale data lands after newer data; charts flash between states; Kinetica shows connection spikes | AbortController in `runSql`; cancel previous request before issuing new one | From the first dashboard with more than 2 widgets |
| Client-side filtering on LIMIT-1000 truncated data | Charts silently show wrong numbers — filtered slice appears smaller than it is because unloaded rows are ignored | Always apply filters server-side in the WHERE clause; never filter rows returned by `parseKineticaResponse` | Whenever the queried table has > 1000 rows |
| No debounce on filter propagation | Rapid clicking (e.g., browser back/forward through filter history) fires a query storm | 150ms debounce on filter context updates before propagating to widget useEffects | During interactive exploration — users click fast |
| Recharts re-rendering all widgets on layout change | Layout drag triggers parent state update, causing all widgets to re-render and potentially re-fetch | Memoize `WidgetRenderer` with `React.memo`; ensure `widget` prop identity is stable during layout-only changes | Any dashboard with 4+ widgets |
| Parsing large Kinetica columnar responses on the main thread | UI freezes for 200-500ms after response arrives | Keep pivot parsing in `parseKineticaResponse`; if response is large, consider a Web Worker | Tables with 1000 rows × 20+ columns |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Building filter WHERE clause from raw chart-click values | Kinetica SQL injection via crafted data values | Validate column name against widget config schema; escape string values; reject SQL meta-characters |
| Exposing full Kinetica error messages to the browser | Schema leakage — Kinetica errors reveal table structure, column names, and SQL dialect details | Backend catches Kinetica errors and returns a sanitized message; full error logged server-side only |
| Storing filter state (including values from data) in localStorage without sanitization | Persisted XSS if filter values are rendered as HTML | Always render filter display values as text content, never innerHTML; validate on read from URL/storage |
| No rate limiting on `/api/kinetica/sql` when filters are applied | Each filter click reaches the Kinetica proxy; malicious rapid clicking = denial of service to Kinetica | Add request rate limiting per IP or session on the SQL proxy endpoint |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No visual feedback when a chart element is "active" (selected as filter source) | Users cannot tell which click registered; may click again thinking it failed, doubling the filter | Highlight the selected element in the chart (Recharts `Cell` with distinct fill); show the active filter in the filter bar immediately (optimistic update before query resolves) |
| Filters stack silently with no UI for "clear all" | Users explore several drill-downs and cannot recover the original view without refreshing | Provide a "Clear all filters" button in the filter bar that clears the context and re-fetches; individual filter pills should have an "×" to remove one filter |
| Charts go blank during refetch with no loading indicator | Data disappears while the new filtered query runs; users think the filter found no results | Show a skeleton/shimmer or a subtle spinner overlay on each widget during refetch; preserve previous data in view until new data arrives |
| Drill-down on a chart that shares no column with the filter dimension | Widget goes empty with no explanation (e.g., user drills by `region` but a widget has no `region` column) | Detect when active filter columns are not present in a widget's query; show a "Filter not applicable to this chart" message instead of an empty state |
| Filter bar shows raw SQL WHERE clause | Data engineers can read it; business analysts cannot | Display human-readable filter summaries ("Region = West") alongside or instead of the SQL clause; the raw clause can be in a tooltip |

---

## "Looks Done But Isn't" Checklist

- [ ] **Drill-down on bar chart:** Works for bars — verify it also fires correctly on pie slice click, scatter point click, and table row click. Each has a different Recharts event payload shape.
- [ ] **Filter bar:** Shows filter — verify it also has a working "clear" action per filter and a "clear all" action. A filter bar with no clear mechanism is a trap.
- [ ] **Cross-chart coordination:** First widget updates on drill-down — verify all other widgets on the dashboard also re-fetch and reflect the same filter. Check with 4+ widgets open.
- [ ] **Filter persistence:** Filters display correctly — verify refreshing the page or copying the URL and opening in a new tab restores the same filter state.
- [ ] **Empty state vs. no-data state:** Filtered results show empty chart — verify the empty state message distinguishes "no data returned" from "filter not applicable to this chart."
- [ ] **Kinetica LIMIT interaction:** Filter appears to work — verify the source table has > 1000 rows and that the filter is applied server-side (WHERE clause in SQL) not client-side on the 1000-row page.
- [ ] **Loading state on filter change:** Chart updates — verify there is a visible loading indicator during refetch so users know data is updating, not gone.
- [ ] **View model not mutated:** Filter bar changes — verify `updateView()` is NOT called on every drill-down click; view records in SQLite should be unchanged during interactive exploration.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Filter state in component state (no URL) | MEDIUM | Introduce `useFilterState` hook that wraps URL params; swap filter reads/writes to go through hook; existing context can call the hook |
| View model mutated by interactive filters | HIGH | Audit DB for corrupted view records; migrate filter session state to URL params or Zustand; add DB migration to reset view filter_clauses to empty |
| SQL injection in filter construction | HIGH | Audit all `runSql` call sites; replace string interpolation with sanitized construction function; add server-side query logging for forensic review |
| Query explosion on filter change | MEDIUM | Add AbortController to `runSql`; add 150ms debounce to filter context propagation; no data migration required |
| Recharts onClick payload mismatch | LOW | Add chart-type-specific extraction functions in each renderer; add logging of raw payload to diagnose which fields are populated |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Filter state scattered across widgets | Cross-filtering foundation — create `DashboardFilterContext` before writing any onClick handler | All widgets refetch when one chart element is clicked; filter bar reads from same context |
| SQL injection via filter construction | Cross-filtering foundation — build `buildFilteredSql()` with escaping before wiring any click handler | Filter with value `' OR '1'='1` does not return all rows |
| Query explosion on filter change | Cross-filtering foundation — add AbortController to `runSql` in same PR as filter wiring | Network tab shows at most N active requests (one per widget); old requests are cancelled |
| Stale closure in useEffect SQL dependency | Cross-filtering foundation — explicit deps array testing | Clicking same filter twice does not double-fetch; clearing filter shows unfiltered data |
| Click handler conflicts with drag | Drill-down implementation — `stopPropagation()` in onClick handlers | Clicking bar does not move widget; dragging widget header does not trigger filter |
| Filter state lost on navigation | State persistence phase — URL-encoded filter state | Copy URL and open in new tab shows same filter state |
| Views model conflated with interactive filters | Cross-filtering foundation — architectural decision before implementation | SQLite view records show no change after interactive drill-down session |
| Recharts payload shape varies by chart type | Drill-down implementation — per-renderer extraction functions | Drill-down tested for bar, pie, scatter, line, table; each produces correct filter dimension |

---

## Sources

- Codebase analysis: `.planning/codebase/CONCERNS.md` (2026-03-23) — identified existing SQL injection, state management gaps, and performance bottlenecks
- Codebase analysis: `.planning/codebase/ARCHITECTURE.md` (2026-03-23) — data flow, Views model, component boundaries
- Project context: `.planning/PROJECT.md` — key architectural decisions, active requirements
- Code inspection: `kinetica_bi/src/components/charts/WidgetRenderer.tsx` — confirmed per-widget fetch pattern, `useEffect([sql])` dependency, Recharts chart types in use
- Code inspection: `kinetica_bi/src/components/DashboardsPage.tsx` — confirmed Views model mutation path, filter bar rendering from `view.filter_clause`, layout change handler
- Domain knowledge: Recharts event payload shapes (BarChart, PieChart, ScatterChart, LineChart onClick signatures differ) — MEDIUM confidence; verify against Recharts 2.x docs when implementing
- Domain knowledge: react-grid-layout drag/click interaction with SVG children — MEDIUM confidence; verify against react-grid-layout 2.x behavior

---

*Pitfalls research for: Kinetica BI — interactive cross-filtering and drill-down milestone*
*Researched: 2026-04-02*
