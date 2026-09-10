# Project Research Summary

**Project:** Kinetica BI Dashboard — Interactive Cross-Filtering Milestone
**Domain:** BI Dashboard with GPU-accelerated columnar database (Kinetica)
**Researched:** 2026-04-02
**Confidence:** HIGH (stack verified from installed node_modules; architecture grounded in direct codebase analysis; features and pitfalls drawn from established BI tool patterns)

---

## Executive Summary

This is a subsequent milestone on an already-deployed React 18 + Zustand + Recharts 2.x + Express + SQLite stack. The goal is to transform a working but passive dashboard into an interactive exploration tool: click-to-filter across all chart types, cross-chart coordination via a shared filter context, polished visual feedback, and dashboard state persistence. The research is not about technology selection — the stack is fixed — it is about what to add and how to wire it without breaking what works.

The recommended approach is layered and dependency-ordered. A single Zustand filter store (`useDashboardFilterStore`) is the foundation that everything else plugs into. Interactive filtering is server-side only: every filter click re-queries Kinetica with an augmented SQL WHERE clause, never filtering client-side on truncated data. Persistence is dual-layer: URL params for shareable transient state, SQLite for named saved states. No major dependencies change — React, Zustand, Recharts, TypeScript, and Vite all stay at current installed versions to avoid migration churn.

The dominant risks are architectural. The most likely failure mode is filter state scattered across component-local `useState` rather than a single coordinated store — producing charts that fall out of sync, an inoperable filter bar, and no shareable state. A secondary risk is SQL injection via click-value interpolation into filter WHERE clauses. Both must be addressed in the first implementation phase, before any click handlers are wired. The Views model (existing `view.filter_clause` in SQLite) must be kept strictly separate from transient interactive filter state, or every drill-down click corrupts the persisted snapshot.

---

## Key Findings

### Recommended Stack

The existing stack is the right stack for this milestone. No new framework choices are needed; the work is additive. React 18.3.1, Zustand 4.5.7, Recharts 2.15.4, Express 4.22.1, and better-sqlite3 12.8.0 are all confirmed installed and working. Do not upgrade React, Zustand, Vite (5.4.21), or TypeScript (5.9.3) — each is one major version behind current, and each major upgrade introduces breaking changes that would derail this milestone.

Recharts 2.x is the correct charting library for this milestone. The `onClick` event on `BarChart`, `PieChart`, `ScatterChart`, and `LineChart` provides exactly the click-to-filter entry points needed. The `Cell` + `activeIndex` pattern enables visual selection highlighting. Upgrading to Recharts 3.x changes event handler signatures and `ResponsiveContainer` behavior — skip it.

**Core technologies:**
- React 18.3.1: UI framework — stable, compatible with Recharts 2.x; defer React 19
- Recharts 2.15.4: Charting — `onClick` on all chart types works; `Cell` highlighting works; do not upgrade to 3.x
- Zustand 4.5.7: State management — add `useDashboardFilterStore` as second store; do not upgrade to v5
- better-sqlite3 12.8.0: Persistence — add `dashboard_saved_states` table via DDL only; no new library
- Express 4.22.1: REST API — add saved states endpoints; remains a stateless SQL proxy
- URLSearchParams (native): URL filter serialization — zero new dependencies for shareable links
- `use-debounce` ^10.0.0: Debounce filter-triggered refetches — tiny library, add with drill-down implementation
- react-grid-layout 2.2.3: Minor patch upgrade from 2.2.2; safe to apply now

### Expected Features

The research mapped features against Metabase, Superset, Grafana, Redash, Tableau, and Power BI. Interactive cross-filtering and a filter bar are table stakes in the BI category — their absence makes the product feel unfinished. GPU-speed cross-filtering and shareable filter URLs are genuine differentiators given the Kinetica backend.

**Must have (P1 — this milestone):**
- Global Zustand filter store — the root dependency; nothing else works without it
- Click-to-filter on all chart types (bar, pie, scatter, line, table row) — the primary interaction model
- Active filter chip bar with per-filter remove and global clear-all — users need to see and escape filter state
- Re-query Kinetica on every filter change (no client-side filtering) — exercises GPU acceleration
- Per-widget loading skeleton during refetch — visual feedback; preserves layout stability vs. spinner
- Per-widget empty state and error state — reliability for daily use; prevents silent blank charts
- Dashboard filter state persistence (URL params + optional SQLite saved states)
- Schema/column browser with column types visible — analysts discover data without SQL knowledge
- Consistent chart color palette across widgets for shared dimension values

**Should have (P2 — after core is validated):**
- Shareable URL with encoded filter state — high collaboration value; low risk after serialization exists
- Column-type-aware filter controls (date picker, multi-select, numeric range slider)
- Materialized view badge per widget with last-refreshed timestamp

**Defer (v2+):**
- Drill-down hierarchy (Region → Country → City) — high value, high complexity; needs drill-path UX design
- Brush/range selection on time-series — `<Brush>` component in Recharts; assess after usage patterns emerge
- Export to CSV/Excel — needs security review; add to backlog
- Real-time auto-refresh — explicitly out of scope; manual refresh only for v1

**Anti-features to avoid building:**
- Client-side JS filtering on cached result sets — bypasses Kinetica GPU; produces wrong cross-chart counts
- Per-chart independent filter context toggle — conceptually confusing; one global context per dashboard
- Arbitrary SQL editor for analysts — SQL injection surface; use structured query builder

### Architecture Approach

The architecture is hub-and-spoke with Zustand as the hub. A single `useDashboardFilterStore` holds all active filters for the current dashboard session. Widget renderers subscribe to the store (read-only) and independently re-fetch on filter change. `DashboardOpen` is the sole dispatcher for filter writes. The backend remains a stateless SQL proxy — all filter logic is resolved to a SQL string on the client before crossing the network boundary. Filter SQL injection uses subquery wrapping: `SELECT * FROM (baseSql) AS _filtered WHERE <clause>`, which avoids conflicts with existing GROUP BY / ORDER BY in stored widget SQL.

**Build order (dependency chain):**
1. `types/filters.ts` — `ActiveFilter`, `FilterOperator` type definitions; zero dependencies
2. `store/dashboardFilters.ts` — Zustand store with `buildWhereClause`; depends on filter types
3. `hooks/useWidgetData.ts` — encapsulates fetch + parse + filter injection; gating item for all rendering work
4. `WidgetRenderer.tsx` (update) — wire `onDataPointClick` prop and `useWidgetData` hook per chart type
5. `FilterBar.tsx` (extract + update) — extract from `DashboardOpen`; connect to store for chip display and clear
6. `DashboardOpen.tsx` (update) — add `handleDrillDown` dispatcher; call `setDashboard(id)` on mount

### Critical Pitfalls

1. **Filter state scattered in component-local state** — implement `useDashboardFilterStore` before writing any onClick handler; never pass `filterValue` as a prop chain through the widget tree. Use Zustand selectors per widget to avoid cascade re-renders.

2. **SQL injection via chart-click value interpolation** — build a `buildFilteredSql()` function that validates column names against widget config schema and escapes string values (`replace(/'/g, "''")`) before the first click handler is wired. The existing `/api/kinetica/sql` endpoint already has a known SQL injection concern flagged in CONCERNS.md; the filter layer adds a new, more accessible surface.

3. **Query explosion on filter change** — add `AbortController` cancellation to `runSql` from the start; add 150-300ms debounce on filter propagation to `WidgetRenderer` `useEffect` deps. With 8 widgets, each filter click fires 8 parallel Kinetica queries — cancellation prevents stale data races.

4. **Views model conflated with interactive filter state** — the existing `view.filter_clause` SQLite field is for pre-built snapshots, not live session state. Interactive filters must never call `updateView()`. Keep them strictly in Zustand + URL params.

5. **Recharts `onClick` payload shape varies by chart type** — `BarChart`, `PieChart`, `ScatterChart`, and `LineChart` each provide different payload structures. Write chart-type-specific extraction functions in each renderer that normalize to `{ dimensionKey, dimensionValue }` before calling the shared filter handler. Test each chart type independently.

---

## Implications for Roadmap

Based on the dependency chain from ARCHITECTURE.md and the pitfall-to-phase mapping from PITFALLS.md, three phases are recommended.

### Phase 1: Cross-Filtering Foundation

**Rationale:** Every feature in this milestone flows through the filter store. The store, type definitions, and safe SQL construction must exist before any click handler can be written. Pitfalls 1, 2, 3, and 7 (state scatter, SQL injection, query explosion, views conflation) must all be prevented here — their recovery cost is HIGH if caught later.

**Delivers:** A working global filter context; click-to-filter on all chart types; cross-chart coordination; filter chip bar with clear actions; per-widget loading/empty/error states; AbortController cancellation on SQL requests.

**Addresses (from FEATURES.md P1):**
- Global filter context / store
- Click-to-filter (bar, pie, scatter, line, table)
- Active filter chip bar + per-filter remove + clear-all
- Re-query Kinetica on filter change
- Loading, empty, and error states per widget

**Avoids:**
- Pitfall 1: Filter state scatter — Zustand store is created first
- Pitfall 2: SQL injection — `buildFilteredSql()` with escaping created in same PR as first click handler
- Pitfall 3: Query explosion — AbortController added to `runSql` in this phase
- Pitfall 4: Stale closure — `useWidgetData` hook with explicit `[sql, filtersKey]` dependency
- Pitfall 7: Views conflation — `updateView()` never called from drill-down path

**Research flag:** Standard patterns — no additional research needed. Architecture is well-defined; Zustand slice pattern is identical to existing `user.ts`; Recharts onClick API verified against installed source.

---

### Phase 2: Persistence and Schema Discovery

**Rationale:** Once cross-filtering works, filter state must survive navigation and enable sharing. This phase also completes the schema browser, which analysts need to configure widgets without guessing column names. These features share infrastructure (filter serialization, Kinetica schema API) and can be built in parallel once Phase 1 is stable.

**Delivers:** URL-encoded filter state (shareable links); SQLite `dashboard_saved_states` table with save/restore endpoints; schema/column browser UI wired to existing API endpoints; column type metadata surfaced in browser.

**Addresses (from FEATURES.md P1 and P2):**
- Dashboard filter state persistence (URL params + SQLite saved states)
- Schema/column browser polish
- Shareable URL with encoded filter state (P2)

**Avoids:**
- Pitfall 6: Filter state lost on navigation — URL encoding via `btoa(JSON.stringify(filters))`; guard malformed params with try/catch
- Pitfall 2 (secondary): localStorage avoided; URL params are universally reliable

**Stack additions:** One new Express route group (`/api/dashboards/:id/states`); one new SQLite table (`dashboard_saved_states`); no new frontend dependencies.

**Research flag:** Standard patterns. URL search param serialization and SQLite DDL are well-documented; schema browser uses existing API endpoints already returning column type metadata. No research-phase needed.

---

### Phase 3: Polish and Visual Coherence

**Rationale:** Once filter round-trips are reliable and state persists, invest in the visual quality that signals the product is production-grade rather than a prototype. These features have no hard dependencies on each other and can be sequenced within the phase.

**Delivers:** Consistent chart color palette across widgets for shared dimension values; column-type-aware filter controls (date picker for timestamps, multi-select for categoricals, numeric range slider for measures); materialized view badge with last-refreshed timestamp; `stopPropagation()` fix for Recharts/react-grid-layout click conflicts.

**Addresses (from FEATURES.md P1 and P2):**
- Consistent chart color palette (P1)
- Column-type-aware filter controls (P2)
- Materialized view badge (P2)

**Avoids:**
- Pitfall 5: Recharts payload shape mismatch — per-renderer extraction functions; each chart type tested independently
- Pitfall 8 (UX): Filter bar showing raw SQL vs. human-readable summaries — render as "Region = West", not WHERE clause
- Click/drag conflict (Pitfall 5 from PITFALLS.md) — `stopPropagation()` in Recharts onClick handlers

**Research flag:** May need shallow research on Recharts `Cell` + `activeIndex` highlight pattern and color-palette implementation if the existing `WidgetRenderer` structure makes cross-widget color coordination non-trivial. Overall, established patterns.

---

### Phase Ordering Rationale

- **Phase 1 must come first** — the filter store is the root dependency. Every other feature either reads from it or writes to it. Building click handlers before the store exists produces the highest-cost pitfall (filter state scatter, HIGH recovery cost).
- **Phase 2 before Phase 3** — persistence is a stated active requirement and the team will feel the pain of lost filter state within days of Phase 1 going live. Polish is valuable but not blocking.
- **Phase 3 last** — visual coherence and UX polish do not block any functional requirements. They improve daily-use quality but have no downstream technical dependencies.
- **Drill-down hierarchy and Brush selection are intentionally out of scope** — both are HIGH complexity, require product UX design decisions (drill-path config, time range UI), and carry HIGH risk of scope creep. Roadmap them to v2.

### Research Flags

Phases needing deeper research during planning:
- None identified. The architecture is grounded in direct codebase analysis, and the stack is verified from installed packages. Recharts `onClick` payload shapes should be validated against the installed 2.x source during implementation of Phase 1, not as a pre-planning research task.

Phases with standard patterns (skip research-phase):
- **Phase 1:** Zustand store pattern is identical to existing `user.ts`; Recharts onClick API confirmed from installed source; SQL subquery wrapping is standard ANSI SQL (validate early against Kinetica with a test query).
- **Phase 2:** URL search params are a web platform standard; SQLite DDL follows existing schema patterns.
- **Phase 3:** Recharts Cell/activeIndex is documented in existing working code; color palette is CSS-level work.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Versions confirmed from installed node_modules and `npm outdated`; existing working code validates Recharts 2.x onClick and Zustand v4 patterns |
| Features | MEDIUM | Training knowledge covers Metabase/Superset/Grafana/Tableau extensively; web verification unavailable; BI feature patterns are stable (3+ years); Recharts-specific prop names need runtime verification |
| Architecture | HIGH | Grounded in direct codebase analysis of `WidgetRenderer.tsx`, `DashboardOpen.tsx`, `ChartConfigPanel.tsx`, `store/user.ts`, and `server/src/index.ts`; patterns align with PROJECT.md architectural decisions |
| Pitfalls | HIGH | SQL injection concern independently confirmed in `CONCERNS.md`; pitfall patterns derived from actual code structure, not speculation |

**Overall confidence:** HIGH

### Gaps to Address

- **Kinetica subquery wrapping compatibility:** The SQL injection pattern `SELECT * FROM (baseSql) AS _filtered WHERE <clause>` is standard ANSI SQL, but Kinetica's SQL dialect support should be verified with a test query early in Phase 1 before the pattern is adopted universally. If subquery wrapping is unsupported, the alternative is WHERE clause injection before GROUP BY in the original query, which requires query parsing.

- **`use-debounce` v10 + React 18 compatibility:** Confidence is LOW on this specific version combination (inferred from hooks-only design, not verified against official docs). Verify after installation before relying on it in filter propagation.

- **Kinetica `/execute/sql` parameterized query support:** The backend SQL proxy sends SQL as a raw string. If Kinetica's REST endpoint supports bind parameters, use them. If not, string escaping in `buildFilteredSql()` is the fallback. Check Kinetica API docs or test during Phase 1.

- **Recharts `onClick` payload shapes at runtime:** Training knowledge describes the expected shapes, but they should be logged at runtime for each chart type during the first implementation pass to confirm the actual field names on the installed 2.15.4 version before building normalization functions.

---

## Sources

### Primary (HIGH confidence)
- Installed node_modules inspection (`/kinetica_bi/node_modules/*/package.json`) — version verification for all core packages
- Direct codebase analysis (`WidgetRenderer.tsx`, `ChartConfigPanel.tsx`, `DashboardOpen.tsx`, `store/user.ts`, `api/client.ts`, `server/src/index.ts`) — existing patterns, data flow, component boundaries
- `.planning/codebase/CONCERNS.md` (2026-03-23) — SQL injection, state management gaps, performance bottlenecks confirmed in existing code
- `.planning/codebase/ARCHITECTURE.md` (2026-03-23) — data flow, Views model, component boundaries
- `.planning/PROJECT.md` — architectural decisions (views as snapshots, client-side filtering, active requirements)
- `npm outdated --json` output — latest version comparison and upgrade gap analysis

### Secondary (MEDIUM confidence)
- Training knowledge: Metabase, Apache Superset, Grafana, Redash, Tableau, Power BI cross-filter and drill-down feature sets — stable patterns, established before 2022
- Training knowledge: Recharts 2.x event payload shapes for BarChart, PieChart, ScatterChart, LineChart — consistent with installed version; verify at runtime
- Training knowledge: Zustand v4 `subscribeWithSelector` middleware — consistent with installed version and existing `user.ts` pattern

### Tertiary (LOW confidence)
- `use-debounce` v10 + React 18.3.1 compatibility — inferred from library's hooks-only design; verify before installation
- Kinetica `/execute/sql` parameterized query support — unknown; test early in Phase 1

---

*Research completed: 2026-04-02*
*Ready for roadmap: yes*
