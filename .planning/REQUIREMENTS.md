# Requirements: Kinetica BI — v1.13 Calendar Heatmap Visualization

**Defined:** 2026-06-16
**Core Value:** Click-through data exploration — users drill into chart elements and the entire dashboard filters to that slice of data, without writing SQL.

**Milestone goal:** Add a new `calendar` chart/widget type (Superset-style Calendar Heatmap) that visualizes a metric aggregated over a timestamp column as a grid of color-scaled blocks, configured with a Domain + Subdomain time model, with click-to-drill that filters the dashboard to the clicked time slice.

**Locked decisions (2026-06-16):**
- **Domain + Subdomain time model:** two dropdowns — Domain = the time unit blocks are grouped by; Subdomain = each cell's unit, a SMALLER unit than the domain (subdomain dropdown is dependent on the domain). Valid combos: year×{month, week, day}, month×{week, day}, week×{day, hour}, day×hour.
- **Metric colors the cells:** an aggregated metric (reuse the existing aggregation set) over a timestamp column; sequential color scale (default purple-like, palette selectable); empty/missing buckets render muted/grey (client-side gap-fill).
- **Cell click = drill-down range filter:** clicking a cell applies a timestamp range filter `BETWEEN cell_start AND cell_end` (where `cell_end = nextBucketStart − 1ms`, reconciling half-open `DATE_TRUNC` buckets with inclusive `BETWEEN`), reusing the v1.7 `between` operator; removable chip; consistent with the v1.3 core value.
- **Table + dynamic-view binding:** the calendar binds to a base table OR a dynamic view; a dv-bound cell drill is dv-isolated (routes to `dvFilters[dvId]`, reuses the v1.12 dv drill path).
- **Implementation shape (from research):** custom SVG renderer (no new npm deps; `colorbrewer` already bundled); a near-clone of the existing `TimelineRenderer` — short-circuit in `WidgetRenderer`, `usesAggregation:false`, runs its own `runSql` via a pure `buildCalendarSql` (mirrors `buildTimelineSql`/`timelineBin`); **NO new server routes** (uses the existing `/api/sql` + `/api/filter/materialize`).
- **Invariants:** `AggregatedWidgetRenderer` remains the SOLE materialize trigger (the calendar never imports `materializeFilter`; it is a read-only consumer that re-fetches on `filterVersion`/dv-view changes); theme tokens only (no raw hex — `theme-guard` CI); test gates — frontend vitest 100% from `packages/web`, web + server `tsc` clean, server vitest set-based gate ⊆ TD-V16-TEST-ISOLATION.

## v1 Requirements

### Calendar Chart Type & Data

- [ ] **CAL-V113-01**: A new `calendar` chart type is registered and selectable when creating/editing a widget; it binds to a base table OR a dynamic view (consistent with other widget types) and renders through its own short-circuit renderer in `WidgetRenderer` (it does NOT go through `AggregatedWidgetRenderer`).
- [ ] **CAL-V113-02**: The calendar config panel lets the operator pick a timestamp column, a metric column + aggregation (reusing the existing aggregation set), a Domain time unit, and a dependent Subdomain time unit (only valid combos selectable: year×{month,week,day}, month×{week,day}, week×{day,hour}, day×hour), plus a color-palette choice.
- [x] **CAL-V113-03**: The calendar fetches a time-bucketed aggregation — `AGG(metric)` grouped by `DATE_TRUNC(domain, ts)` and `DATE_TRUNC(subdomain, ts)` over the bound table or dv view — via a pure `buildCalendarSql` builder run through the existing SQL path; bucketing is UTC-consistent and uses Kinetica `DATE_TRUNC` units verified against the live instance (incl. the `week` start-day anchor).
- [ ] **CAL-V113-04**: The calendar renders as a grid of Domain groups, each containing its Subdomain cells colored by the metric on a sequential scale (default + selected palette); missing/empty buckets render as muted/grey (gap-fill, not collapsed); the grid shows time-axis labels and a per-cell hover tooltip (time slice + metric value). All colors come from theme tokens / a `chartTheme` palette (no raw hex).
- [ ] **CAL-V113-05**: The calendar is a filter-aware consumer — it re-fetches and re-renders when another widget applies a filter to its bound table/dv (watches `filterVersion` / dv-view changes) — and guards against runaway grids over wide time ranges with a sane cell-count cap + sensible defaults (oversized configs are prevented or surfaced, not silently rendered huge).

### Cell Drill-Down (Click-Through)

- [ ] **CALDR-V113-01**: Clicking a calendar cell applies a timestamp range filter (`between`, value `[cell_start, cell_end]` with `cell_end = nextBucketStart − 1ms`) that filters the dashboard to that cell's time slice, shows a removable chip identifying the time range, and clears back to unfiltered on chip removal — consistent with the existing drill-down lifecycle (reset on dashboard-switch/logout).
- [ ] **CALDR-V113-02**: For a dv-bound calendar, the cell drill is dv-isolated — it routes to `dvFilters[dynamicViewId]` (NOT `filters[sourceTableId]`); same-dv widgets update while source-table and other-dv widgets stay unaffected. A table-bound calendar routes to `filters[tableId]`. (Reuses the v1.12 dv-isolation path; named explicitly to prevent the Phase 63 root-cause recurring.)
- [ ] **CALDR-V113-03**: A calendar cell drill propagates to ALL consumer read-paths on the same scope — charts, records tables, AND map WMS layers (verified in-phase, per the v1.12 Phase 63.1 lesson) — and the `AggregatedWidgetRenderer`-as-sole-materialize-trigger invariant is preserved (the calendar never calls `materializeFilter`/`dropFilterView`; static-grep asserted).

### Verification

- [ ] **VERIFY-V113-01**: Live operator UAT — create a calendar widget on a table (and a dv), configure domain/subdomain + metric, see the color-scaled grid with correct labels and gap-filled empties; click a cell → the dashboard (incl. a map widget on the same scope) filters to that time slice live, the chip clears back to unfiltered, dv drill stays dv-isolated; automated gates green (frontend vitest 100% from `packages/web`, web + server `tsc` clean, server vitest set-based gate ⊆ TD-V16-TEST-ISOLATION).

## v2 Requirements

Deferred to a future milestone.

### Calendar enhancements

- **CALX-V2-01**: Full per-threshold custom color editor (explicit value breakpoints + per-bucket colors, like the class-break editor) — v1 ships a sequential scale + palette choice only.
- **CALX-V2-02**: Sub-hour subdomains (15/30-min) and quarter domain — v1 covers hour…year.
- **CALX-V2-03**: Multi-metric / metric-switcher calendars; cell annotations/labels inside cells.
- **CALX-V2-04**: Time-zone selection (v1 buckets in a single consistent zone — UTC contract).

## Out of Scope

Explicitly excluded for v1.13.

| Feature | Reason |
|---------|--------|
| New server routes / endpoints | Calendar runs through the existing `/api/sql` + `/api/filter/materialize`; no new infra (per research). |
| A calendar-heatmap npm dependency | Libraries hard-wire GitHub's year/week/day layout; a custom SVG renderer is required for arbitrary domain×subdomain. |
| Per-threshold custom color breakpoints | v1 ships a sequential scale + palette choice (→ CALX-V2-01). |
| Sub-hour subdomains / quarter domain / timezone picker | v1 covers hour…year, UTC bucketing (→ CALX-V2-02/04). |
| Editing data via the calendar | It's a read + drill visualization, never mutates data. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CAL-V113-01 | Phase 66 | Pending |
| CAL-V113-02 | Phase 66 | Pending |
| CAL-V113-03 | Phase 65 | Complete |
| CAL-V113-04 | Phase 67 | Pending |
| CAL-V113-05 | Phase 66+67 | Pending |
| CALDR-V113-01 | Phase 68 | Pending |
| CALDR-V113-02 | Phase 68 | Pending |
| CALDR-V113-03 | Phase 68 | Pending |
| VERIFY-V113-01 | Phase 69 | Pending |

**Coverage:**
- v1 requirements: 9 total
- Mapped to phases: 9 (Phases 65-69)
- Unmapped: 0 ✓

---
*Requirements defined: 2026-06-16*
*Last updated: 2026-06-16 — v1.13 roadmap created; traceability filled (Phases 65-69)*
