# Roadmap

> **Shipped milestones (v1.0–v1.10):** details collapsed to `milestones/` per the complete-milestone pattern. See `MILESTONES.md` and `milestones/v1.*-ROADMAP.md` for the archived phase-by-phase records (Phases 1–57).

## Milestones

- ✅ **v1.0 Authentication & Per-User Access** — Phases 1-3 (shipped 2026-04-29) — see `milestones/v1.0-ROADMAP.md`
- ✅ **v1.1 OIDC SSO Support** — Phases 4-8 (shipped 2026-05-02) — see `milestones/v1.1-ROADMAP.md`
- ✅ **v1.2 Interactive Dashboards** — Phases 9-12 (shipped 2026-05-06) — see `milestones/v1.2-ROADMAP.md`
- ✅ **v1.3 Unified Dashboard Filtering** — Phases 13-17 (shipped 2026-05-07) — see `milestones/v1.3-ROADMAP.md`
- ✅ **v1.4 Map Info Popup** — Phases 18-24 (shipped 2026-05-11) — see `milestones/v1.4-ROADMAP.md`
- ✅ **v1.5 Spatial filtering on map** — Phases 25-31 (shipped 2026-05-14) — see `milestones/v1.5-ROADMAP.md`
- ✅ **v1.6 Dynamic Views** — Phases 32-36 (shipped 2026-05-19) — see `milestones/v1.6-ROADMAP.md`
- ✅ **v1.7 WMS Class Break, Track & Legend** — Phases 37-45 (shipped 2026-06-05) — see `milestones/v1.7-ROADMAP.md`
- ✅ **v1.8 Roles & Permissions (RBAC)** — Phases 46-51 incl. 50.1-50.3 (shipped 2026-06-06) — see `milestones/v1.8-ROADMAP.md`
- ✅ **v1.9 Better Track Rendering** — Phases 52-54 (shipped 2026-06-08) — see `milestones/v1.9-ROADMAP.md`
- ✅ **v1.10 Per-Dashboard View Permissions** — Phases 55-57 (shipped 2026-06-10) — see `milestones/v1.10-ROADMAP.md`
- ✅ **v1.11 Programmable Widgets (Cross-Widget Control)** — Phases 58-61 incl. 58.1 / 60.1 / 60.2 (shipped 2026-06-15) — see `milestones/v1.11-ROADMAP.md`
- ✅ **v1.12 Drill-Down on Dynamic-View-Backed Widgets** — Phases 62-64 incl. 63.1 (shipped 2026-06-16) — see `milestones/v1.12-ROADMAP.md`
- 🚧 **v1.13 Calendar Heatmap Visualization** — Phases 65-69 (in progress)

---

## Progress

| Phase | Milestone | Status | Completed |
|-------|-----------|--------|-----------|
| 1–54  | v1.0–v1.9 | Complete (archived) | 2026-04-29 → 2026-06-08 |
| 55. access-model-server-enforcement | v1.10 | Complete | 2026-06-09 |
| 56. access-management-ui-list-open-ux | v1.10 | Complete | 2026-06-09 |
| 57. verification-live-uat | v1.10 | Complete | 2026-06-10 |
| 58. action-engine-contract-allowlist-canary | v1.11 | Complete    | 2026-06-10 |
| 58.1. action-engine-foundation-fix | 1/1 | Complete    | 2026-06-10 |
| 59. radio-group-registry-config-panel | 1/2 | Complete    | 2026-06-10 |
| 60. radio-renderer-wiring-persistence-seam | 1/3 | Complete    | 2026-06-11 |
| 61. verification-live-uat | v1.11 | Complete    | 2026-06-15 |
| 62. server-materialize-from-dv-view | 2/2 | Complete    | 2026-06-15 |
| 63. client-dv-drill-down | 4/4 | Complete   | 2026-06-15 |
| 63.1. map-layer-dv-filter-swap | 1/1 | Complete | 2026-06-15 |
| 64. verification-live-uat | 3/3 | Complete   | 2026-06-16 |
| 65. calendar-sql-builder-kinetica-spike | v1.13 | Not started | - |
| 66. chart-type-definition-config-panel | v1.13 | Not started | - |
| 67. svg-calendar-renderer-read-only | v1.13 | Not started | - |
| 68. cell-drill-integration | v1.13 | Not started | - |
| 69. verification-live-uat | v1.13 | Not started | - |

---

## v1.12 Drill-Down on Dynamic-View-Backed Widgets — SHIPPED 2026-06-16

<details>
<summary>✅ v1.12 (Phases 62-64 incl. 63.1) — SHIPPED 2026-06-16 — full phase details archived</summary>

Restored click-through exploration for dynamic-view-backed widgets: drilling a dv-backed chart/table/map filters the dynamic view's own data (not the source table), isolated to widgets on that same dv. Full phase-by-phase detail, success criteria, and plan lists are archived in `milestones/v1.12-ROADMAP.md`; requirements in `milestones/v1.12-REQUIREMENTS.md`.

- [x] Phase 62: Server — Materialize From DV View (2/2 plans) — completed 2026-06-15
- [x] Phase 63: Client — DV Drill-Down (4/4 plans) — completed 2026-06-15
- [x] Phase 63.1: Map-Layer DV-Filter FROM-Swap (gap closure, 1/1 plan) — completed 2026-06-15
- [x] Phase 64: Verification + Live UAT (3/3 plans) — completed 2026-06-16

</details>

---

## 🚧 v1.13 Calendar Heatmap Visualization (In Progress)

**Milestone Goal:** Add a `calendar` chart/widget type — a Superset-style Calendar Heatmap that visualizes a metric aggregated over a timestamp column as a grid of color-scaled blocks, with click-to-drill that filters the dashboard to the clicked time slice. Near-clone of the existing TimelineRenderer; no new server routes.

**Locked invariants (carry into every phase):**
- `AggregatedWidgetRenderer` is the SOLE materialize trigger — `CalendarRenderer` NEVER imports `materializeFilter`; static-grep asserted in Phase 68 and again in Phase 69
- Theme tokens only; no raw hex anywhere in `CalendarRenderer.tsx` or `CalendarConfigPanel.tsx` — `theme-guard.spec.ts` CI gate
- No `fromSwap()` inside `CalendarRenderer` — resolve the FROM target before building SQL (DATE_TRUNC SQL contains FROM tokens that would be clobbered)
- DV-isolated drill routing — dv-bound cell click routes to `dvFilters[dynamicViewId]`, never `filters[tableId]`
- WMS map (and all other consumer read-paths) must reflect the calendar's filter on the same scope — verified in Phase 68, not deferred to UAT
- Test gates: frontend vitest 100% from `packages/web`, web + server `tsc` clean, server vitest set-based ⊆ TD-V16-TEST-ISOLATION

### Phases

- [x] **Phase 65: Calendar SQL Builder + Kinetica Spike** — Pure `buildCalendarSql.ts` + `computeCellBounds` + Kinetica `DATE_TRUNC` unit verification spike
- [x] **Phase 66: Chart-Type Definition + Config Panel** — `definitions/calendar.ts` + `CalendarConfigPanel.tsx` with domain/subdomain dependent pickers + cell-count cap (completed 2026-06-16)
- [ ] **Phase 67: SVG Calendar Renderer (read-only)** — `CalendarRenderer.tsx` short-circuited in `WidgetRenderer`, data fetch, domain/subdomain pivot, gap-fill, color scale, tooltips, filter-aware re-fetch
- [ ] **Phase 68: Cell-Drill Integration** — Cell click → BETWEEN range filter via `setBulkFilters`/`addDvFilter` + `markMaterializing`/`markDvMaterializing`; chips; dv-isolated routing; WMS propagation verified
- [ ] **Phase 69: Verification + Live UAT** — Automated gates + blocking live operator walk-through + compiled verification record

## Phase Details

### Phase 65: Calendar SQL Builder + Kinetica Spike
**Goal**: A pure, fully-tested SQL builder (`buildCalendarSql`) and cell-bounds helper (`computeCellBounds`) exist — with the Kinetica `DATE_TRUNC` unit set and `week` start-day anchor verified against a live instance — so all downstream phases build on a correct bucketing foundation.
**Depends on**: Nothing (first v1.13 phase)
**Requirements**: CAL-V113-03
**Success Criteria** (what must be TRUE):
  1. `buildCalendarSql` produces a valid two-level `DATE_TRUNC(domain) / DATE_TRUNC(subdomain) + AGG` query with no `fromSwap` post-processing — the FROM target is resolved before the string is built
  2. `computeCellBounds(date, subdomainUnit)` returns `[cellStartIso, cellEndIso]` with `cellEnd = nextBucketStart − 1ms` (inclusive BETWEEN semantics) — passing unit tests for month-end (Feb 28/29), year-end (Dec 31), and DST-night boundaries, using UTC only
  3. Kinetica spike is documented: each `DATE_TRUNC` unit string used by the calendar (`year`, `month`, `week`, `day`, `hour`) is confirmed valid or flagged, with the `week` start-day anchor (Mon vs Sun) recorded; any unsupported unit is rejected at config-save time via a `KINETICA_DATE_TRUNC_UNITS` constant
  4. The SQL builder emits a `LIMIT 10000` safety cap and includes all required columns (`domain_bucket`, `subdomain_bucket`, `value`) in a shape that the renderer can pivot directly
**Plans**: 2 plans

Plans:
- [x] 65-01-PLAN.md — `calendarBin.ts` (computeCellBounds + valid-combo/DATE_TRUNC-unit/LIMIT constants) + `buildCalendarSql.ts` two-level DATE_TRUNC builder; TDD specs RED first (month-end / leap / year-end / week / DST / UTC-only)
- [x] 65-02-PLAN.md — Kinetica DATE_TRUNC spike via the app `/api/sql` path: confirm unit strings + `week` start-day anchor + UTC/format against the live instance; annotate `KINETICA_DATE_TRUNC_UNITS` (or record NOT-RUN + flag Phase 69)

### Phase 66: Chart-Type Definition + Config Panel
**Goal**: Operators can add a Calendar Heatmap widget to a dashboard, configure it end-to-end (table/dv binding, timestamp column, metric + aggregation, domain/subdomain dropdowns enforcing the 8 valid combos, palette), and save a valid config — with a cell-count cap preventing runaway grid configurations before any renderer exists.
**Depends on**: Phase 65 (domain/subdomain valid-combo set + cell-count cap informed by confirmed DATE_TRUNC units)
**Requirements**: CAL-V113-01, CAL-V113-02, CAL-V113-05 (cap portion)
**Success Criteria** (what must be TRUE):
  1. A `calendar` chart type appears in the widget-type picker; adding a calendar widget renders a placeholder (not `AggregatedWidgetRenderer`) — `usesAggregation: false`, `usesDataSource: false`, `CustomConfigPanel: CalendarConfigPanel` registered in `definitions/index.ts`
  2. `CalendarConfigPanel` shows table/dv data-source picker, timestamp column dropdown (datetime types only), metric column + aggregation dropdown (reusing the existing `AGGREGATIONS` list), Domain dropdown (`year`/`month`/`week`), and a dependent Subdomain dropdown whose valid options are gated by the selected domain (exactly the 8 valid combos: year×{month,week,day}, month×{week,day}, week×{day,hour}, day×hour)
  3. Saving an invalid domain/subdomain combination (e.g., domain=day + subdomain=year) is blocked — `isValid(false)` prevents save; the invalid subdomain option is not selectable or is greyed out
  4. Saving a configuration whose estimated cell count exceeds the cap produces a clear user-facing message and does NOT persist the config; sensible default domain/subdomain values are pre-filled on creation
**Plans**: 4 plans

Plans:
- [ ] 66-01-PLAN.md — Pure cell-count estimator + MIN/MAX range-probe query builder (`estimateCalendarCells.ts` + spec) for the save-time cap
- [ ] 66-02-PLAN.md — Thread `dynamicViews` into `ConfigPanelProps` + forward through `ChartConfigPanel` to the custom panel slot
- [ ] 66-03-PLAN.md — `CalendarConfigPanel.tsx` (dv-aware picker, timestamp/single-metric pickers, dependent domain/subdomain dropdowns, Sequential palette, save-time cell-count cap) + `CalendarConfigPanel.spec.tsx`
- [ ] 66-04-PLAN.md — `definitions/calendar.ts` + `definitions/index.ts` registration + `WidgetRenderer` placeholder short-circuit branch

### Phase 67: SVG Calendar Renderer (Read-Only)
**Goal**: A calendar widget on a dashboard fetches its time-bucketed data, renders a correctly gap-filled domain/subdomain grid with color-scaled cells, empty-cell grey fill, time-axis labels, and per-cell hover tooltips — and automatically re-fetches when another widget applies a filter to the same table or dv.
**Depends on**: Phase 65 (SQL builder + computeCellBounds), Phase 66 (chart type + config registered)
**Requirements**: CAL-V113-04, CAL-V113-05 (filter-aware re-fetch portion)
**Success Criteria** (what must be TRUE):
  1. The calendar fetches data via `runSql(buildCalendarSql(...))` — the FROM target is resolved to `fvViewName || dvFilterViewName || dvViewName || "schema.table"` BEFORE building the SQL string; `fromSwap()` is NOT called inside `CalendarRenderer`
  2. Missing/empty time buckets render as muted/grey cells (client-side gap-fill via `useMemo` over the query response) — deleting all rows for a date range produces grey cells, not collapsed neighbors
  3. All cell colors are sourced from `chartTheme.ts` palette exports or CSS custom properties — no hardcoded hex literals; `theme-guard.spec.ts` passes with `CalendarRenderer.tsx` in scope
  4. The color scale domain is derived reactively: `useMemo(() => computeDomain(data), [data])` — applying and clearing an external filter produces a correctly rescaled palette matching the current data's min/max
  5. When `filterVersion` or `fvViewName` (or `dvFilterViewName`/`dvStatus` for dv-bound) changes, the calendar re-fetches and re-renders — the widget responds to external drill-down filters from other widgets on the same scope
**Plans**: 3 plans

Plans:
- [ ] 67-01-PLAN.md — Pure helpers (TDD): `calendarColorScale.ts` (computeDomain + 5-bucket linear quantize + palette resolver) + `calendarGapFill.ts` (2D domain×subdomain dense gap-fill) + `useChartAxisColors` emptyCell extension
- [ ] 67-02-PLAN.md — `CalendarRenderer.tsx` — fetch lifecycle (single `runSql(buildCalendarSql)`, FROM precedence resolved before SQL, filter-aware re-fetch) + SVG grid render (gap-fill, reactive color domain, Less→More legend, both-axis sparse labels, per-cell tooltip, non-interactive greys) + `CalendarRenderer.spec.tsx`
- [ ] 67-03-PLAN.md — Wire `<CalendarRenderer>` into `WidgetRenderer.tsx` (replace Phase 66 placeholder, branch before AggregatedWidgetRenderer) + spec routing assertion + re-assert no-materialize-import invariant

### Phase 68: Cell-Drill Integration
**Goal**: Clicking a calendar cell applies a timestamp BETWEEN range filter to the dashboard (or the dv scope), shows a removable chip, propagates to all consumer read-paths including WMS map tiles, and the `AggregatedWidgetRenderer`-as-sole-materialize-trigger invariant is preserved and statically asserted.
**Depends on**: Phase 67 (renderer exists and re-fetches on filterVersion)
**Requirements**: CALDR-V113-01, CALDR-V113-02, CALDR-V113-03
**Success Criteria** (what must be TRUE):
  1. Clicking a non-empty calendar cell calls `setBulkFilters(tableId, [{ column, value: [cellStart, cellEnd], operator: "between", dataType: "datetime" }])` + `markMaterializing(tableId, dashboardId)` for table-bound calendars; clicking an empty/grey cell does nothing (click handler guards `if (cell.value === null) return`)
  2. For a dv-bound calendar, the cell click routes to `addDvFilter(dynamicViewId, filter)` + `markDvMaterializing(dynamicViewId, dashboardId)` — `dvFilters[dvId]` receives the BETWEEN filter; `filters[tableId]` is unchanged; same-dv widgets update while source-table and other-dv widgets stay unaffected
  3. A WMS map widget on the same table or dv updates its tiles after a calendar cell click — verified by a dedicated checklist item in-phase (not deferred to live UAT), per the v1.12 Phase 63.1 lesson
  4. A static source-grep assertion confirms `CalendarRenderer.tsx` does NOT import `materializeFilter` or `dropFilterView` — sole-materialize-trigger invariant preserved; a removable filter chip appears and clears on dismiss, resetting back to unfiltered
**Plans**: TBD

Plans:
- [ ] 68-01: Cell click handler — `computeCellBounds` → `setBulkFilters`/`addDvFilter` + `markMaterializing`/`markDvMaterializing`; dv-routing unit test; sole-trigger static grep assertion; spec: dv-bound click dispatches to `dvFilters[dvId]` BETWEEN, `filters[tableId]` unchanged
- [ ] 68-02: Integration verification — WMS map propagation checklist + chip lifecycle (add on click, clear on dismiss, reset on dashboard-switch/logout)

### Phase 69: Verification + Live UAT
**Goal**: The v1.13 milestone is fully verified: automated gates are green, a live operator walk-through confirms the calendar end-to-end (table-bound and dv-bound, including a WMS map on the same scope), and the verification record is compiled and committed.
**Depends on**: Phases 65-68 all complete
**Requirements**: VERIFY-V113-01
**Success Criteria** (what must be TRUE):
  1. Automated gates ALL PASS: frontend vitest 100% from `packages/web` (existing 2141+ plus all new calendar specs), web `tsc` clean, server `tsc` clean, server vitest set-based gate ⊆ TD-V16-TEST-ISOLATION (failing files identical to Phase 64 baseline — no new server regressions)
  2. Live operator walk-through: create a calendar widget on a table, configure domain/subdomain + metric + palette, observe the color-scaled grid with correct time-axis labels and grey empty cells; click a cell — the dashboard (including a bar/pie/records chart on the same table) filters to that time slice; the filter chip clears back to unfiltered on dismiss
  3. Live operator walk-through (dv-bound): bind a calendar to a dynamic view, perform a cell drill — same-dv widgets update; source-table widgets and other-dv widgets are unaffected (dv-isolated scope confirmed)
  4. Live operator walk-through (WMS map): a WMS map widget on the same table/dv updates its tiles after a calendar cell click — chip labels show human-readable date ranges (not raw ISO strings)
**Plans**: TBD

Plans:
- [ ] 69-01: Run automated gates — frontend vitest 100%, web + server tsc clean, server set-based gate; compile gate results
- [ ] 69-02: Live operator walk-through — table-bound + dv-bound + WMS map propagation; author 69-UAT.md; await operator attestation
- [ ] 69-03: Compile verification record (69-VERIFICATION.md); tick VERIFY-V113-01; mark ROADMAP Phase 69 Complete

---

## v1.13 Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 65. calendar-sql-builder-kinetica-spike | 1/2 | Complete    | 2026-06-16 |
| 66. chart-type-definition-config-panel | 4/4 | Complete    | 2026-06-16 |
| 67. svg-calendar-renderer-read-only | 1/3 | In Progress|  |
| 68. cell-drill-integration | 0/TBD | Not started | - |
| 69. verification-live-uat | 0/3 | Not started | - |
