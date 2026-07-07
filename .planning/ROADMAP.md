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
- ✅ **v1.13 Calendar Heatmap Visualization** — Phases 65-69 incl. 68.1 / 68.2 (shipped 2026-06-18) — see `milestones/v1.13-ROADMAP.md`
- ✅ **v1.14 Class-Break & Chart Config Refinements** — Phases 70-73 (shipped 2026-06-19) — see `milestones/v1.14-ROADMAP.md`
- ✅ **v1.15 Column Formatting & View Lifecycle** — Phases 74-79 (shipped 2026-06-22) — see `milestones/v1.15-ROADMAP.md`
- ✅ **v1.16 White-Label Theming** — Phases 80-84 (shipped 2026-06-26) — see `milestones/v1.16-ROADMAP.md`
- ✅ **v1.17 Chart Number Formatting** — Phases 85-87 (shipped 2026-06-27) — see `milestones/v1.17-ROADMAP.md`
- ✅ **v1.18 Per-Visualization Filter Selection** — Phases 88-96 incl. 93.5 (shipped 2026-06-30) — see `milestones/v1.18-ROADMAP.md`
- 🚧 **v1.19 Visualization Customization** — Phases 97-104 (IN PROGRESS, started 2026-06-30; Phase 104 added post-verification 2026-07-07)

---

## v1.19 Visualization Customization — IN PROGRESS (started 2026-06-30)

**Goal:** Give designers per-visualization control over data and presentation — a custom WHERE clause and custom table-level metrics for tailoring the data each viz queries, plus smarter axes/grouping/calendar controls — without touching the shared filter/materialize engine.

**Granularity:** standard. **Phases:** 8 (97-104; Phase 104 added 2026-07-07 post-verification). **Coverage:** 26/26 requirements mapped.

**Invariant (every phase):** `AggregatedWidgetRenderer` remains the SOLE materialize trigger. The custom WHERE (VIZSQL) is applied WITHIN each widget's existing read query (ANDed against the materialized view it already reads) — NEVER a new materialize path. Static grep: `grep -rE "materializeFilter|dropFilterView" packages/web/src/components/charts/` finds only authorized call sites.

### Phases

- [ ] **Phase 97: Calendar Smart Domain Control** — FRONTEND-ONLY — alternative single-dropdown smart mode (month/week/day/hour) auto-mapping to domain+subdomain, alongside the existing two-dropdown UI.
- [ ] **Phase 98: Per-Visualization Custom WHERE Clause** — FRONTEND-ONLY — freeform raw-SQL WHERE on every plain-SQL widget, ANDed on top of the existing drill-down/per-viz-selection filter pipeline against the already-filtered materialized view (excludes map/WMS).
- [ ] **Phase 99: Custom Metrics — Server + Store Foundation** — BOTH — per-table `custom_metrics` config table + CRUD (read ungated / write `datasets:manage`, NO new permission) + client store/helpers.
- [ ] **Phase 100: Custom Metrics — Tables-Area Editor + Metric-Picker Integration** — FRONTEND-ONLY — define/edit/delete metrics from the Tables area (mirroring the Column Format editor) + surface them in every viz metric picker, emitted directly into SQL with no extra aggregation wrapper.
- [ ] **Phase 101: Smart / Logarithmic Y-Axis** — FRONTEND-ONLY — per-widget Y-axis scale mode (Zero-based / Smart / Logarithmic) on line, timeline, and bar charts.
- [ ] **Phase 102: Multi-Column Group-By on Bar Chart** — FRONTEND-ONLY — arbitrary N group-by columns (env-var capped), nested/hierarchical, with a grouped (clustered) vs stacked toggle.
- [ ] **Phase 103: Verification + Live UAT** — BOTH + operator — green automated gates on both stacks + a blocking live operator walk-through of all five features.
- [ ] **Phase 104: Synchronized Map Viewports** — FRONTEND-ONLY — added 2026-07-07 (post-verification) — sync-enabled maps on a dashboard pan/zoom together via a transient viewport store; per-map toggle (default off), echo-loop guarded, per-dashboard scoped. Reopens the milestone → Phase 103 must be re-run.

## Phase Details

### Phase 97: Calendar Smart Domain Control
**Goal**: Designers can configure a calendar to expose a single "smart" time-granularity dropdown (month / week / day / hour) that auto-maps to the correct domain+subdomain pair, without disturbing existing two-dropdown calendars.
**Stack**: FRONTEND-ONLY (`packages/web` — `CalendarConfigPanel.tsx` / `CalendarRenderer.tsx` + config model; mirrors the v1.13 Phase 68.1 view-local-control pattern).
**Depends on**: Nothing (independent feature; can run in parallel with 98 / 101 / 102).
**Requirements**: CALSMART-V119-01, CALSMART-V119-02, CALSMART-V119-03
**Invariant**: `AggregatedWidgetRenderer` stays the sole materialize trigger — this is config + render only; no new SQL/materialize path.
**Success Criteria** (what must be TRUE):
  1. A designer can switch a calendar widget between the advanced two-dropdown (domain + subdomain) UI and a smart single-dropdown UI from the config panel.
  2. In smart mode, selecting month / week / day / hour renders the calendar with the mapped pair (month→year/month, week→month/week, day→month/day, hour→day/hour).
  3. A designer can restrict which smart options are selectable by the viewer; only the allowed options appear in the viewer dropdown.
  4. An existing calendar with no smart config keeps its current two-dropdown behavior byte-identically (backward-compat locked by test).
**Plans**: 2 plans
- [ ] 97-01-PLAN.md — Smart→pair mapping (calendarBin.ts) + controlMode/smartScale/allowedSmartScales config model & mode-branched panel UI
- [ ] 97-02-PLAN.md — Renderer reconciliation: suppress viewer control bar in smart mode + backward-compat lock

### Phase 98: Per-Visualization Custom WHERE Clause
**Goal**: On every plain-SQL widget, a designer can enter a freeform raw-SQL WHERE expression that is ANDed on top of the active drill-down / per-viz-selection filters against the materialized view the widget already reads — never a new materialize path.
**Stack**: FRONTEND-ONLY (`packages/web` — per-widget config field + read-query WHERE injection in the chart/records/big-number read paths; excludes `MapChartRenderer` / WMS).
**Depends on**: Nothing (independent feature; parallel-safe with 97 / 101 / 102).
**Requirements**: VIZSQL-V119-01, VIZSQL-V119-02, VIZSQL-V119-03, VIZSQL-V119-04
**Invariant**: The custom WHERE is appended WITHIN the widget's existing read query — ANDed against the already-filtered materialized view, on top of the existing drill-down / per-viz-selection pipeline (NOT a base-table query, NOT a new materialize). `AggregatedWidgetRenderer` stays the sole materialize trigger. Map / WMS layers are explicitly excluded.
**Success Criteria** (what must be TRUE):
  1. On a plain-SQL widget (calendar, line, timeline, pie, bar, records table, big number, etc.), the designer can enter a raw-SQL WHERE expression in the widget config and it persists.
  2. A non-empty custom WHERE narrows that widget's data, applied on top of any active drill-down / per-viz filters (ANDed against the same materialized view), while other widgets are unaffected.
  3. An empty/absent custom WHERE leaves the widget's query byte-identical to current behavior (backward-compat locked by test).
  4. An invalid WHERE surfaces the query error on that widget only; the rest of the dashboard keeps rendering.
**Plans**: 3 plans
Plans:
- [ ] 98-01-PLAN.md — Shared customWhere helper + thread into the 3 own-SQL builders (timeline/numeric-line/calendar), byte-identical-when-empty locked
- [ ] 98-02-PLAN.md — Field on 7 registry widgets + WHERE injection in aggregated config.sql (ChartConfigPanel) + records SQL (RecordsTableRenderer)
- [ ] 98-03-PLAN.md — Field in the 3 CustomConfigPanels + thread customWhere through their renderers into the builders

### Phase 99: Custom Metrics — Server + Store Foundation
**Goal**: A per-table custom-metrics config (label + SQL aggregate expression) is persisted server-side with full CRUD, and a client store exposes it — the foundation the Tables editor and metric pickers build on.
**Stack**: BOTH (server: new `custom_metrics` SQLite table + CRUD endpoints — composite-keyed per table, read ungated / write `datasets:manage`, NO new RBAC permission, mirroring v1.15 `column_display_config`; client: store + helpers mirroring `columnDisplayConfigStore`).
**Depends on**: Nothing (server/store foundation; unblocks Phase 100). Can run in parallel with 97 / 98 / 101 / 102.
**Requirements**: METRIC-V119-01 (server persistence portion), METRIC-V119-02
**Invariant**: `AggregatedWidgetRenderer` stays the sole materialize trigger — custom metrics are config CRUD + a read-time SQL fragment, never a new materialize path. NO new permission (reuse `datasets:manage` for writes, ungated reads).
**Success Criteria** (what must be TRUE):
  1. A custom metric (label + SQL aggregate expression, e.g. `SUM(revenue)/SUM(cost)`) can be created, edited, and deleted against a table via the CRUD endpoints, scoped per table.
  2. Custom metrics persist server-side and are returned per table for reuse across all dashboards using that table.
  3. Writes are gated by the existing `datasets:manage` permission; reads are ungated — no new permission is introduced (byte-parity check on the permission catalog).
  4. The client store loads a table's custom metrics and exposes them to consumers (mirrors the v1.15 column-config store pattern).
**Plans**: 2 plans
- [ ] 99-01-PLAN.md — Server foundation: custom_metrics table + CRUD/map db fns + CustomMetricRow type + GET-ungated/write-gated routes + dual-auth supertests + permission-parity
- [ ] 99-02-PLAN.md — Client foundation: CustomMetricRow + API client fns + customMetricsStore (+ selectMetrics selector) + dashboard-lifecycle reset wiring

### Phase 100: Custom Metrics — Tables-Area Editor + Metric-Picker Integration
**Goal**: Users define/edit/delete custom metrics from the Tables area (mirroring the Column Format editor), and those metrics appear in every visualization's metric picker, emitted directly into the widget SQL with no extra aggregation wrapper.
**Stack**: FRONTEND-ONLY (`packages/web` — Tables-area editor modal + metric-picker integration across config panels + SQL emission).
**Depends on**: Phase 99 (needs the persisted store + CRUD helpers).
**Requirements**: METRIC-V119-01 (Tables-area authoring UI portion), METRIC-V119-03, METRIC-V119-04
**Invariant**: When a custom metric is selected, its aggregate expression is emitted DIRECTLY into the widget's SELECT with NO additional aggregation wrapper applied (it is already an aggregate). `AggregatedWidgetRenderer` stays the sole materialize trigger.
**Success Criteria** (what must be TRUE):
  1. From the Tables area, a user can define / edit / delete a labeled custom metric (mirroring the Column Format editor reach + layout).
  2. Custom metrics appear in every visualization's metric picker alongside real columns, labeled.
  3. Selecting a custom metric emits its aggregate expression directly into the widget SQL with no further aggregation wrapper, and the widget renders the computed value.
  4. Widgets using only real columns are byte-identical to current behavior.
**Plans**: 3 plans
Plans:
- [ ] 100-01-PLAN.md — CustomMetricsEditorModal (two-pane CRUD) + DatasetsPage reach (METRIC-V119-01 UI)
- [ ] 100-02-PLAN.md — Shared customMetricSql helper + metricId marker + branch all 4 SQL-emission sites (byte-identical + custom tests) (METRIC-V119-04)
- [ ] 100-03-PLAN.md — Custom-metrics picker in all 4 config panels (optgroup, hide-agg, deleted-marker) + renderer tableId threading (METRIC-V119-03 + -01 picker)

### Phase 101: Smart / Logarithmic Y-Axis
**Goal**: On line, timeline, and bar charts, a designer can choose the Y-axis scale mode — Zero-based (default), Smart, or Logarithmic — per widget.
**Stack**: FRONTEND-ONLY (`packages/web` — per-widget config field + recharts axis `domain`/`scale` in the line / timeline / bar renderers; mirrors the v1.17 per-widget Y-axis-format pattern).
**Depends on**: Nothing (independent feature; parallel-safe with 97 / 98 / 102).
**Requirements**: YAXIS-V119-01, YAXIS-V119-02, YAXIS-V119-03, YAXIS-V119-04
**Invariant**: Pure render-config — `AggregatedWidgetRenderer` stays the sole materialize trigger; no SQL/materialize change. Scoped to line / timeline / bar only (pie / calendar excluded — deferred YAXIS-V2-01).
**Success Criteria** (what must be TRUE):
  1. On a line, timeline, or bar chart, the designer can pick a Y-axis scale mode: Zero-based, Smart, or Logarithmic.
  2. Smart mode derives the Y-axis min/max from the data range and does not force a 0 baseline.
  3. Logarithmic mode renders the value axis on a log scale.
  4. A widget with no scale-mode config defaults to Zero-based — current behavior unchanged for existing widgets (backward-compat locked by test).
**Plans**: 2 plans
Plans:
- [ ] 101-01-PLAN.md — Shared pure yAxisScaleProps helper + unit spec (foundation; absent→{}, zero, smart, log-clamp, no-positive-data)
- [ ] 101-02-PLAN.md — yAxisScale select on 3 config surfaces + spread helper onto all value axes in 3 renderers + byte-identical/smart/log tests

### Phase 102: Multi-Column Group-By on Bar Chart
**Goal**: On the bar chart, a designer can select arbitrary N group-by columns (env-var capped), rendered nested/hierarchically with a grouped (clustered) vs stacked toggle.
**Stack**: BOTH (`packages/web` — bar group-by builder in ChartConfigPanel + BarRenderer multi-series path + pure barGroupedSeries helper; feature logic is web-only. The one server touch: `MAX_BAR_GROUP_BY_SERIES` env var read at boot + a single `maxBarGroupBySeriesCap` field on `/api/auth/me`, mirroring `maxCombinationViewsPerTable` — dual-auth supertests apply).
**Depends on**: Nothing (independent feature; parallel-safe with 97 / 98 / 101).
**Requirements**: BARGRP-V119-01, BARGRP-V119-02, BARGRP-V119-03, BARGRP-V119-04
**Invariant**: `AggregatedWidgetRenderer` stays the sole materialize trigger. The group-by column / series cap is a deploy-time ENV VAR read once at boot with fallback+warn (mirroring v1.15 TTL env vars / v1.18 `MAX_COMBINATION_VIEWS_PER_TABLE`) — over-cap is handled gracefully, never a fail-fast.
**Success Criteria** (what must be TRUE):
  1. On the bar chart, the designer can select more than one group-by column.
  2. Multiple group-by columns render nested/hierarchically, and a designer toggle switches between grouped (clustered) and stacked.
  3. The number of group-by columns / resulting series is capped via a deploy-time env var (read once at boot, fallback+warn); exceeding the cap is handled gracefully (truncate + warn, no crash).
  4. A single-column group-by (or none) renders byte-identical to current bar-chart behavior (backward-compat locked by test).
**Approach note**: EXTEND the generic `ChartConfigPanel` with a bar-only multi-column builder + a guarded multi-column `generatedSql` branch (NOT a new `BarConfigPanel`) — preserves the bar's already-cohesive Phase 98 customWhere / Phase 100 custom-metric / Phase 101 yAxisScale wiring.
**Plans**: 3 plans
Plans:
- [ ] 102-01-PLAN.md — BOTH-stack foundation: MAX_BAR_GROUP_BY_SERIES env var + /api/auth/me field + web MeResponse/fetchMe/auth-store plumbing (dual-auth supertests) + pure barGroupedSeries pivot helper
- [ ] 102-02-PLAN.md — ChartConfigPanel bar-only N-column group-by builder + multi-column generatedSql branch (generous LIMIT) + byte-identical backward-compat
- [ ] 102-03-PLAN.md — WidgetRenderer BarRenderer multi-series render (N <Bar>, grouped/stacked via reused `stacked`, top-N cap + truncation note, ColorBrewer colors, col1 drill) + byte-identical single-series lock

### Phase 103: Verification + Live UAT
**Goal**: All five features verified green on both stacks plus a blocking live operator walk-through, with any gaps fixed in-session and re-walked to PASS.
**Stack**: BOTH + operator.
**Depends on**: Phases 97, 98, 99, 100, 101, 102 (verifies after all feature phases land).
**Requirements**: VERIFY-V119-01
**Invariant**: Re-assert sole-materialize-trigger (static grep) across all five features; theme-tokens-only (no raw hex); server vitest set-based ⊆ TD-V16-TEST-ISOLATION (NEVER a fixed pass-count).
**Success Criteria** (what must be TRUE):
  1. Automated gates green: web vitest 100% from `packages/web`, web + server `tsc` clean (separate gates), theme-guard green, server vitest set-based ⊆ TD-V16-TEST-ISOLATION.
  2. A blocking live operator walk-through exercises all five features (smart calendar, custom WHERE incl. invalid-error isolation, custom metrics end-to-end, smart/log Y-axis, multi-column bar group-by) and attests PASS.
  3. Any gaps found in the walk are fixed in-session (with regression tests) and re-walked to PASS.
**Plans**: 2 plans
Plans:
- [ ] 103-01-PLAN.md — SC1 automated gates on both stacks (web tsc/vitest/theme-guard; server tsc + set-based vitest) + sole-materialize-trigger invariant re-grep across all 5 features -> 103-GATES.md
- [ ] 103-02-PLAN.md — BLOCKING live operator walk-through of the full UAT matrix (SC1/F1-F5/X/R) + in-session repro-test-driven gap fixes + 103-UAT.md + 103-VERIFICATION.md (VERIFY-V119-01)

### Phase 104: Synchronized Map Viewports
**Goal**: When a sync-enabled map widget pans/zooms, its viewport (center + zoom, or bbox) is published and every OTHER sync-enabled map on the SAME dashboard pans/zooms to match — so side-by-side maps move together.
**Stack**: FRONTEND-ONLY (preferred) — transient VIEW state; map is a separate OpenLayers/WMS read-path via `MapChartRenderer` (see memory: map-wms-is-separate-read-path).
**Depends on**: Phase 103 (added post-verification — see note below).
**Requirements**: MAPSYNC-V119-01, MAPSYNC-V119-02, MAPSYNC-V119-03, MAPSYNC-V119-04, MAPSYNC-V119-05, MAPSYNC-V119-06
**Locked constraints (from add-phase discussion 2026-07-07)**:
  - Per-map config toggle "Sync map viewport" (default OFF). An enabled map both PUBLISHES and SUBSCRIBES; sync-disabled maps are wholly unaffected.
  - Scope is per-dashboard — maps sync only with other maps on the same dashboard.
  - No feedback loops: a map moved programmatically by an incoming sync must NOT re-publish and echo (guard the sync-driven move).
  - Favor a transient store (mirroring the filter/spatial stores) over server persistence — this is view state, not persisted analytics.
  - Backward-compat: existing maps with no sync config behave exactly as today.
**Success Criteria** (what must be TRUE):
  1. With two sync-enabled maps on a dashboard, panning/zooming one pans/zooms the other to the same viewport; a third sync-DISABLED map does not move.
  2. No echo/oscillation: a sync-driven move does not re-publish (verified by a guard + test).
  3. Maps with no sync config render and behave byte-identically to today (backward-compat).
**Plans**: 2 plans
Plans:
- [ ] 104-01-PLAN.md — Foundation: transient mapViewportSyncStore (+ pure spec) + syncViewport config field + getSyncViewportEnabled getter + "Sync map viewport" toggle in MapConfigPanel (MAPSYNC-V119-01/06)
- [ ] 104-02-PLAN.md — Renderer wiring: moveend publish effect + scoped subscribe/animate effect + isSyncDrivenRef echo guard + reset() in both cleanup chains + OL-mock tests (MAPSYNC-V119-02/03/04/05/06)

> NOTE: v1.19 already passed Phase 103 verification/UAT (2026-07-02). Phase 104 REOPENS the milestone — Phase 103 must be re-run to cover 104 before v1.19 can be closed.

### Phase Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 97. Calendar Smart Domain Control | 0/2 | Planned | - |
| 98. Per-Visualization Custom WHERE Clause | 0/? | Not started | - |
| 99. Custom Metrics — Server + Store Foundation | 0/2 | Planned | - |
| 100. Custom Metrics — Editor + Metric-Picker Integration | 0/3 | Planned | - |
| 101. Smart / Logarithmic Y-Axis | 0/2 | Planned | - |
| 102. Multi-Column Group-By on Bar Chart | 0/3 | Planned | - |
| 103. Verification + Live UAT | 0/2 | Planned | - |
| 104. Synchronized Map Viewports | 0/2 | Planned | - |

---

## v1.18 Per-Visualization Filter Selection — SHIPPED 2026-06-30

<details>
<summary>✅ v1.18 (Phases 88-96 incl. 93.5) — SHIPPED 2026-06-30 — full phase details archived in milestones/v1.18-ROADMAP.md</summary>

- [x] Phase 88: Foundation — Pure Logic + Types (1/1 plan)
- [x] Phase 89: Store + Server Foundation (2/2 plans)
- [x] Phase 90: Combination-Orchestrator (3/3 plans)
- [x] Phase 91: WidgetRenderer Wiring (2/2 plans)
- [x] Phase 92: MapChartRenderer Wiring (2/2 plans)
- [x] Phase 93: Filter Scope Config UI (2/2 plans)
- [x] Phase 93.5: Spatial Filters in the Combination Model (2/2 plans)
- [x] Phase 94: Dynamic View Filter Scope Wiring (2/2 plans)
- [x] Phase 95: On-Widget Badge Indicator (1/1 plan)
- [x] Phase 96: Verification + Live UAT (3/3 plans + UAT gap closure; operator UAT 11/11)

**Delivered:** Per-visualization filter selection — each chart widget, WMS map layer, and dynamic-view-backed widget chooses which active filters it applies via a source-widget allow-list (incl. self-filter + spatial-draws sources), materializing one Kinetica view per UNIQUE filter combination (deduped, ref-counted, env-bounded with all-filters fallback). Spatial draws folded into the combination model; deploy-time dv disable flag; on-widget "N of M filters" badge + per-layer legend indicator + "All filters (limit)" fallback badge. Default accept-all byte-identical to v1.17. 13/13 requirements; operator UAT 11/11 (6 gaps + 2 scope additions fixed in-session). See `MILESTONES.md` + `milestones/v1.18-ROADMAP.md`.

</details>

---

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1–54  | v1.0–v1.9 | — | Complete (archived) | 2026-04-29 → 2026-06-08 |
| 55–57 | v1.10 | — | Complete | 2026-06-10 |
| 58–61 incl. 58.1 | v1.11 | — | Complete | 2026-06-15 |
| 62–64 incl. 63.1 | v1.12 | — | Complete | 2026-06-16 |
| 65–69 incl. 68.1/68.2 | v1.13 | — | Complete | 2026-06-18 |
| 70–73 | v1.14 | — | Complete | 2026-06-19 |
| 74–79 | v1.15 | 11/11 | Complete | 2026-06-22 |
| 80–84 | v1.16 | 13/13 | Complete (UAT 14/14) | 2026-06-26 |
| 85–87 | v1.17 | 3/3 | Complete (UAT 6/6) | 2026-06-27 |
| 88–96 incl. 93.5 | v1.18 | 20/20 | Complete (UAT 11/11) | 2026-06-30 |
| 97–103 | v1.19 | 0/? | In progress | — |

---

## v1.17 Chart Number Formatting — SHIPPED 2026-06-27

<details>
<summary>✅ v1.17 (Phases 85-87) — SHIPPED 2026-06-27 — full phase details archived in milestones/v1.17-ROADMAP.md</summary>

- [x] Phase 85: SI Smart-Abbreviation Number Format (1/1 plan)
- [x] Phase 86: Chart Y-Axis Number Format (timeline + line) (2/2 plans)
- [x] Phase 87: Verification + Live UAT (6/6 operator UAT PASS)

**Delivered:** SI "smart abbreviation" number format (k/M/G/T) in the column formatter + Column Format editor, plus a hybrid per-widget Y-axis number format on timeline/line/bar (defaults from the bound column, ticks-only). Frontend-only. 6/6 requirements; operator UAT 6/6 (8 polish gaps fixed in-session). See `MILESTONES.md` + `milestones/v1.17-ROADMAP.md`.

</details>

## v1.15 Column Formatting & View Lifecycle — SHIPPED 2026-06-22

<details>
<summary>✅ v1.15 (Phases 74-79) — SHIPPED 2026-06-22 — full phase details archived in milestones/v1.15-ROADMAP.md</summary>

Client-side per-table column display config (custom labels + value formatting) applied across records-table, chart tooltips/axes/series, and map info popups (layers legend excluded), plus env-configurable materialized-view TTL defaults and a client keep-alive touch. Phase 74 pivoted to env vars (no app-settings store/UI/permission). Full detail + requirements in `milestones/v1.15-ROADMAP.md` / `milestones/v1.15-REQUIREMENTS.md`.

- [x] Phase 74: Env-Driven TTL Defaults (2/2 plans) — SETTINGS-V115-01/02/03
- [x] Phase 75: Column Display Config Foundation (3/3 plans) — COLCFG-V115-01/02/03
- [x] Phase 76: Column Formatting Editor UI (2/2 plans) — COLEDIT-V115-01/02/03
- [x] Phase 77: Apply Labels + Formatting at Render Surfaces (3/3 plans) — COLAPPLY-V115-01/02/03/04
- [x] Phase 78: View TTL Keep-Alive Touch (1/1 plan) — TTLKEEP-V115-01
- [x] Phase 79: Verification + Live UAT (operator-attested PASS) — TTLKEEP-V115-02, VERIFY-V115-01

Six in-session UAT fixes (modal CSS, default-None, DataFilter load-race + popover-portal, chart tooltip/pie/bar label formatting).

</details>

---

## v1.16 White-Label Theming — SHIPPED 2026-06-26

<details>
<summary>✅ v1.16 (Phases 80-84) — SHIPPED 2026-06-26 — full phase details archived in milestones/v1.16-ROADMAP.md</summary>

- [x] Phase 80: Token Foundation + Aurora Default Theme (3/3 plans)
- [x] Phase 81: Brand Config Server Foundation (3/3 plans)
- [x] Phase 82: Client Token Pipeline + FOUC Prevention + Identity (3/3 plans)
- [x] Phase 83: Branding Admin UI (4/4 plans)
- [x] Phase 84: Verification + Live UAT (14/14 operator UAT PASS)

**Delivered:** Runtime white-label theming (logo/name, colors dark+light, fonts, feel levers, sanitized custom CSS) applied live with no redeploy and no FOUC, on the new Aurora default theme. 23/23 requirements; operator UAT 14/14 (2 gaps fixed in-session). See `MILESTONES.md` + `milestones/v1.16-ROADMAP.md`.

</details>

---

## v1.14 Class-Break & Chart Config Refinements — SHIPPED 2026-06-19

<details>
<summary>✅ v1.14 (Phases 70-73) — SHIPPED 2026-06-19 — full phase details archived in milestones/v1.14-ROADMAP.md</summary>

- [x] Phase 70: Numeric `<other>` Catch-All Bucket (1 plan) — CBOTHER-V114-01/02/03
- [x] Phase 71: SHAPE* Hidden for Lat/Lon Point Layers (2 plans) — SHAPE-V114-01/02/03
- [x] Phase 72: Group-By for Timeline + Numeric-Line Charts (3 plans) — GROUP-V114-01/02/03/04
- [x] Phase 73: Verification + Live UAT (operator-attested 12/12 PASS) — VERIFY-V114-01

Three FRONTEND-ONLY refinements + five in-session review fixes / one feature (legend `<other>` label, grouped palette, legend↔map overlay sync, calendar week-anchor drill, radio toggle-buttons). 19 commits, zero server diff. See `milestones/v1.14-ROADMAP.md`.

</details>

## v1.12 Drill-Down on Dynamic-View-Backed Widgets — SHIPPED 2026-06-16

<details>
<summary>✅ v1.12 (Phases 62-64 incl. 63.1) — SHIPPED 2026-06-16 — full phase details archived</summary>

Restored click-through exploration for dynamic-view-backed widgets: drilling a dv-backed chart/table/map filters the dynamic view's own data (not the source table), isolated to widgets on that same dv. Full phase-by-phase detail, success criteria, and plan lists are archived in `milestones/v1.12-ROADMAP.md`; requirements in `milestones/v1.12-REQUIREMENTS.md`.

- [x] Phase 62: Server — Materialize From DV View (2/2 plans) — completed 2026-06-15
- [x] Phase 63: Client — DV Drill-Down (4/4 plans) — completed 2026-06-15
- [x] Phase 63.1: Map-Layer DV-Filter FROM-Swap (gap closure, 1/1 plan) — completed 2026-06-15
- [x] Phase 64: Verification + Live UAT (3/3 plans) — completed 2026-06-16

</details>
