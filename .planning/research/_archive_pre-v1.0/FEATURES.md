# Feature Research

**Domain:** BI Dashboard — Interactive data exploration on GPU-accelerated columnar database (Kinetica)
**Researched:** 2026-04-02
**Confidence:** MEDIUM — Training knowledge covers Tableau, Power BI, Metabase, Apache Superset, Looker, Grafana, Redash extensively. Web verification was unavailable; specific claims reflect well-established, stable patterns in the BI domain that have not changed materially in 3+ years.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Click-to-filter on chart elements | Every modern BI tool does this; it is the primary interaction model for exploration | MEDIUM | Clicking a bar segment, pie slice, or scatter point adds a filter for that dimension value; all other charts update. Core to the milestone. |
| Visual "active filter" indicator | Users need to know what filters are applied — without it the dashboard state is opaque | LOW | A persistent filter bar or chip strip showing e.g. "Region = West · Sales Rep = Jones". Already scaffolded; needs to be wired to live state. |
| Clear / reset filters | Complement to apply-filter; users get stuck if they can't escape a filtered state | LOW | Single "Clear all" button plus per-filter remove (×) on each chip. |
| Hover tooltips on chart elements | Every charting library shows this; users expect value + label on hover | LOW | Recharts provides this natively; needs consistent formatting and null-value handling across all chart types. |
| Responsive loading states | Slow queries (Kinetica can take 200ms–5s) without a spinner feel broken | LOW | Per-widget skeleton or spinner; global loading indicator optional. |
| Empty-state messaging | Charts with no data (after filtering) need to say "No data" not just render blank | LOW | Blank chart is a common confusing bug; a short message plus a "Clear filters" link resolves it. |
| Error state per widget | Network/query errors should not crash the dashboard silently | LOW | Per-chart error boundary with a human-readable message and retry. |
| Consistent chart color palette | Visual coherence across bar, line, pie; same category = same color | LOW | Recharts does not enforce cross-chart color consistency automatically; requires a shared palette + category-to-color map. |
| Schema / column browser | Users need to discover what tables and columns exist without running SQL | MEDIUM | Table/column explorer panel or sidebar. Already partially implemented per PROJECT.md; needs polish and integration with widget config. |
| Dashboard save / load | State that disappears on refresh is a toy, not a tool | LOW | Persist dashboard layout + widget config to SQLite. Already exists. Filter state persistence is the addition needed. |

### Differentiators (Competitive Advantage)

Features that set the product apart. Not required, but valuable.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| GPU-speed cross-filtering | Kinetica can return filtered results in sub-second even on millions of rows; surfacing this speed gap versus Postgres-backed tools is a strong differentiator | MEDIUM | Requires proper query pass-through (not client-side JS filtering on cached data) so Kinetica's GPU acceleration is actually exercised. |
| Drill-down hierarchy (parent → child dimension) | Moving from Region → Country → City → Store in a single click flow feels like Tableau; most open-source tools lack this | HIGH | Requires a drill-down path definition per widget (ordered list of group-by columns). On click, next level filters + re-groups. Can be deferred if scope is tight. |
| Brush / range selection on time-series | Dragging a time window on a line chart to zoom + cross-filter other charts is a power-user feature that open-source tools often skip | HIGH | Recharts supports `<Brush>` component on line/area charts; wiring brush to the global filter context is the complexity. |
| Shareable dashboard URL with encoded filter state | Analysts share a link that lands a colleague directly in the same filtered view | MEDIUM | Encode active filters as URL query params (or a short server-side token). React Router + serialization. High business value for collaboration. |
| Materialized view pre-aggregation visible in UI | Making Kinetica views first-class (user can see which view backs each widget, trigger refresh) is unique to the GPU-DB context and invisible in generic BI tools | MEDIUM | A small "view" badge per widget with "last refreshed" timestamp and a manual refresh button. |
| Column-type-aware filter controls | Showing a date-range picker for timestamps, a multi-select for categoricals, and a numeric range slider for measures — rather than a generic text box — removes analyst friction | MEDIUM | Requires inferring column type from Kinetica schema metadata and rendering the right control. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Real-time auto-refresh (push streaming) | "Live dashboards" feel powerful | Kinetica is a query-on-demand database, not a streaming broker; polling every N seconds creates thundering-herd query load and adds complex WebSocket / SSE infrastructure for minimal v1 value | Manual refresh button per widget. If streaming needed in v2, use Kinetica's native Change Data Capture (CDC) feed rather than polling. |
| Client-side JS filtering on cached result sets | Seems fast — no round-trips | Bypasses Kinetica's GPU; large datasets blow browser memory; cross-chart counts become wrong after the first filter because you're filtering already-filtered data | Always re-query Kinetica on filter change. Accept the round-trip; it will be fast. |
| Drag-to-reorder filter chips | Allows custom filter ordering | Complicates state management, provides almost no value — filter chips are not order-sensitive for AND predicates | Chips in insertion order; no reorder. |
| Arbitrary SQL editor exposed to analysts | Power users want raw access | Business analysts can't use it; it creates a SQL injection surface; it fragments the query builder model | Structured query builder for analysts; engineers can use Kinetica Workbench directly for ad-hoc SQL. |
| Per-chart independent filter context | "This chart ignores global filters" toggle | Conceptually confusing for analysts; leads to dashboards where charts show different slices of data invisibly; debugging is very hard | One global filter context per dashboard. If someone needs independent views, they build a second dashboard. |
| Export to Excel/CSV on every chart | Common request from business users | Feature creep for this milestone; needs file streaming, format negotiation, and security review of what data is exportable | Defer to v2. Note it in the roadmap. |
| User-defined calculated fields in the UI | Analysts want to create `revenue / units = ASP` in a browser form | Requires a formula parser/validator, type-checking against Kinetica column types, and storing formulas in SQLite; out of scope for a reliability milestone | Engineers define calculated columns in Kinetica views (SQL) and expose them as regular columns. |
| Multi-tab / multi-page dashboards | Feels like a richer product | Each tab needs its own filter context, layout, and data binding; complexity multiplies; v1 has enough value with single-page dashboards | Separate dashboards per analytical domain; use the dashboard list as navigation. |

---

## Feature Dependencies

```
[Click-to-filter]
    └──requires──> [Global filter context / store]
                       └──requires──> [Filter → SQL WHERE clause generation]
                                          └──requires──> [Column type metadata from Kinetica schema]

[Active filter indicator bar]
    └──requires──> [Global filter context / store]

[Clear filters]
    └──requires──> [Global filter context / store]

[Cross-chart coordination]
    └──requires──> [Click-to-filter]
    └──requires──> [Global filter context / store]

[Dashboard state persistence]
    └──requires──> [Filter serialization (JSON ↔ SQLite)]

[Shareable URL with filter state]
    └──requires──> [Filter serialization]
    └──requires──> [URL encoding / React Router integration]

[Drill-down hierarchy]
    └──requires──> [Click-to-filter]
    └──requires──> [Per-widget drill-path config]
    └──enhances──> [Global filter context / store]

[Brush / range selection]
    └──requires──> [Click-to-filter infrastructure]
    └──requires──> [Recharts <Brush> component integration]

[Column-type-aware filter controls]
    └──requires──> [Column type metadata from Kinetica schema]
    └──enhances──> [Active filter indicator bar]

[Materialized view badge]
    └──requires──> [View CRUD (existing backend endpoint)]
```

### Dependency Notes

- **Global filter context is the root dependency.** Every interactive feature flows through it. It should be implemented first, before any click handlers or filter UI.
- **Column type metadata** is needed for both type-aware filter controls and for generating valid SQL WHERE predicates (date literals vs string literals vs numeric literals differ). Schema discovery must surface this.
- **Filter serialization** is shared between dashboard persistence and shareable URLs — implement once, use twice. A simple `Record<columnName, FilterValue>` JSON structure works.
- **Drill-down conflicts with per-widget independent filters** (anti-feature) — if a widget has its own filter context, drill-down from it is ambiguous. One global context eliminates this ambiguity.

---

## MVP Definition

### Launch With (v1 — this milestone)

Minimum to make the product reliably useful for daily team use.

- [ ] Global filter context (Zustand store) that all widgets subscribe to — without this nothing else works
- [ ] Click-to-filter on all existing chart types (bar, pie, scatter; line by point; table by row) — core value of the product
- [ ] Active filter chip bar with per-filter remove and clear-all — users need to see and escape filter state
- [ ] Re-query Kinetica on filter change (not client-side filtering) — so GPU acceleration is actually exercised
- [ ] Loading skeleton per widget while query is in flight — visual feedback for networked queries
- [ ] Empty-state and error-state per widget — reliability for daily use
- [ ] Dashboard filter state persistence in SQLite — survives page refresh
- [ ] Schema / column browser with column types visible — analysts discover data without manual config
- [ ] Consistent chart colors across widgets for shared dimensions — visual coherence

### Add After Validation (v1.x)

Add once core daily-use reliability is confirmed.

- [ ] Shareable URL with encoded filter state — high collaboration value, low risk after serialization exists
- [ ] Column-type-aware filter controls (date picker, multi-select, range slider) — polish; analysts notice this
- [ ] Materialized view badge per widget with last-refreshed timestamp — makes Kinetica's view model visible

### Future Consideration (v2+)

Defer until the product has proven daily-use adoption.

- [ ] Drill-down hierarchy — high value but high complexity; needs product spec on drill-path configuration UX
- [ ] Brush / range selection on time-series — strong for time-series-heavy workloads; assess after usage patterns emerge
- [ ] Export to Excel/CSV — common request; needs security + format review
- [ ] Real-time / auto-refresh — only if polling latency is a stated user pain, not assumed

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Global filter context | HIGH | MEDIUM | P1 |
| Click-to-filter (all chart types) | HIGH | MEDIUM | P1 |
| Active filter chip bar + clear | HIGH | LOW | P1 |
| Re-query Kinetica on filter change | HIGH | LOW | P1 |
| Loading states per widget | HIGH | LOW | P1 |
| Empty/error states per widget | HIGH | LOW | P1 |
| Filter state persistence | HIGH | LOW | P1 |
| Schema / column browser polish | MEDIUM | MEDIUM | P1 |
| Consistent chart color palette | MEDIUM | LOW | P1 |
| Shareable URL with filter state | HIGH | MEDIUM | P2 |
| Column-type-aware filter controls | MEDIUM | MEDIUM | P2 |
| Materialized view badge | LOW | LOW | P2 |
| Drill-down hierarchy | HIGH | HIGH | P3 |
| Brush / range selection | MEDIUM | HIGH | P3 |
| Export to CSV | MEDIUM | MEDIUM | P3 |

**Priority key:**
- P1: Must have for this milestone
- P2: Add after core is working and validated
- P3: Future milestone

---

## Competitor Feature Analysis

Reference products examined: Metabase (open-source), Apache Superset (open-source), Grafana (open-source, time-series focused), Redash (open-source), Tableau (commercial), Power BI (commercial).

| Feature | Metabase / Superset | Grafana | Our Approach |
|---------|---------------------|---------|--------------|
| Click-to-filter | Yes — dashboard-scoped cross-filter on click; Superset calls it "cross-filters" and makes it configurable per chart | Yes — panel variables and templating, click to set variable | Global Zustand filter store; click handler on each chart type adds predicate to store; all widgets re-query |
| Filter chip bar | Metabase: filter strip at top. Superset: filter drawer on left sidebar | Variable pills in header | Persistent filter bar at dashboard top with chip-per-active-filter; matches Metabase's simpler model |
| Drill-down | Metabase: "drill-through" built-in for linked questions. Superset: data drill via plugin | Grafana: dashboard links, not true drill-down | Phase 2: widget-level drill-path config (ordered group-by columns). Not in v1. |
| Schema browser | Metabase: Browse Data sidebar. Superset: Dataset editor | Grafana: Explore mode with metric/label discovery | Table/column browser panel surfacing Kinetica schema; column types shown |
| Loading states | Per-card spinner | Per-panel spinner | Per-widget skeleton loader (better than spinner for layout stability) |
| URL-encoded filter state | Metabase: yes, URL changes on filter. Superset: yes, permalink feature | Grafana: yes, full state in URL | v1.x: serialize filter store to URL params |
| Color consistency | Metabase: palette-based, consistent. Superset: configurable per chart | Grafana: per-panel scheme | Shared category→color map in filter store or chart config; same dimension = same color |
| Real-time refresh | Metabase: optional auto-refresh (polling). Superset: optional | Grafana: core feature, sub-second | Explicitly out of scope; manual refresh only |

---

## Sources

- Metabase product behavior (training knowledge, HIGH confidence — stable feature set since 2022)
- Apache Superset cross-filter documentation (training knowledge, HIGH confidence — cross-filters added in Superset 1.x, well-documented)
- Grafana dashboard and panel interaction model (training knowledge, HIGH confidence)
- Tableau cross-filtering and drill-down interaction model (training knowledge, HIGH confidence — patterns established before 2020)
- Power BI drill-down and cross-filter model (training knowledge, HIGH confidence)
- Recharts library component reference: `<Brush>`, `onClick` handlers, `<Tooltip>` (training knowledge, MEDIUM confidence — verify specific prop names against current Recharts docs during implementation)
- Kinetica SQL dialect: columnar response format described in PROJECT.md (HIGH confidence — first-party)
- Web search and WebFetch were denied; no external sources could be verified in this session

---
*Feature research for: Kinetica BI Dashboard — Interactive exploration milestone*
*Researched: 2026-04-02*
