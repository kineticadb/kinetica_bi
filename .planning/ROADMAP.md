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
- 🚧 **v1.18 Per-Visualization Filter Selection** — Phases 88-96 incl. 93.5 (in progress)

---

## v1.18 Per-Visualization Filter Selection — IN PROGRESS

### Phases

- [ ] **Phase 88: Foundation — Pure Logic + Types** — Filter-selection types, resolveFilterSet, stableComboHash pure functions + unit tests
- [ ] **Phase 89: Store + Server Foundation** — filterCombinationStore, lifecycle cleanup chain (9th store), keep-alive extension, server viewNaming + materialize param
- [ ] **Phase 90: Combination-Orchestrator** — Sole-materialize-trigger hook: computes unique combinations, diffs registry, fires one POST per new combination, enforces ceiling with fallback *(research pass required)*
- [ ] **Phase 91: WidgetRenderer Wiring** — Replace filterViewStore.views selectors with combination-store selectors; rewrite Effect 1 + Effect 2 in WidgetRenderer; correctness gate: default accept-all is byte-identical to v1.17
- [ ] **Phase 92: MapChartRenderer Wiring** — Replace viewsKey with comboViewsKey; wire BOTH buildWmsParams call sites (Effect 2 + Effect 3) + update both dep arrays
- [ ] **Phase 93: Filter Scope Config UI** — FilterSelectionPanel in ChartConfigPanel + KineticaWmsLayerForm (source allow-list incl. a spatial-draws entry); chart filterScope via widget.config; layer.filterScope as a TOP-LEVEL field persisted like track_config (server layer-PATCH threading); orphan-source warning
- [ ] **Phase 93.5: Spatial Filters in the Combination Model** — Fold spatial (map-draw) filters into the per-combination view: extend stableComboHash + add resolveSpatialShapes; orchestrator reads shapes + includes spatialFilters/spatialTarget in the materialize; reconcile useMapOnlySpatialMaterialize so spatial isn't dropped for chart∧map shared tables nor double-materialized *(research pass required)*
- [ ] **Phase 94: Dynamic View Filter Scope Wiring** — Extend dv-bound widget path in WidgetRenderer to use resolveFilterSet against dvFilters; gated behind deploy-time disable env flag *(research pass required)*
- [ ] **Phase 95: On-Widget Badge Indicator** — Badge "N of M filters" in widget header shown only when ≥1 active filter is ignored; hover tooltip with applied/ignored breakdown
- [ ] **Phase 96: Verification + Live UAT** — Green automated gates (both stacks) + blocking live operator walk-through; all gaps fixed in-session

### Phase Details

#### Phase 88: Foundation — Pure Logic + Types
**Goal**: The codebase has a tested, dependency-free pure-function layer that every subsequent phase imports — filter-selection types, filter resolution, and combination hashing.
**Stack**: FRONTEND-ONLY
**Depends on**: Nothing (first phase of v1.18)
**Requirements**: FSCOPE-V118-01 (partial — types + resolution logic), COMBO-V118-01 (partial — dedup key)
**Research flag**: None — pure-function patterns are well-established in this codebase
**Success Criteria** (what must be TRUE):
  1. A widget with no filterSelection config (absent/undefined) resolves to all active filters unchanged — unit test asserts this explicitly.
  2. A widget with a source-allow-list resolves to only filters whose sourceWidgetId is in the list — unit test covers include and exclude cases.
  3. Two widgets with identical resolved filter arrays produce the same stableComboHash string; two with different arrays produce different hashes — unit tests confirm determinism and collision-resistance.
  4. The NOFILTER sentinel is returned when the resolved filter array is empty, and is never confused with a real hash — unit test asserts the sentinel value.
  5. Frontend vitest 100% green; web tsc clean; theme-guard green.
**Plans**: 1 plan
- [ ] 88-01-PLAN.md — Filter-selection types + resolveFilterSet (allow-list ∩ active, accept-all default) + stableComboHash/comboShortHash/NOFILTER sentinel + unit specs

#### Phase 89: Store + Server Foundation
**Goal**: The filterCombinationStore exists as the 9th store in both cleanup chains, the keep-alive hook covers combination views, and the server endpoint accepts the optional combinationKey param — all additive, backward-compatible, no renderer wiring yet.
**Stack**: BOTH (frontend-heavy; server adds optional param + viewNaming helper)
**Depends on**: Phase 88 (store imports pure functions from Phase 88)
**Requirements**: COMBO-V118-02 (store + lifecycle + keep-alive), COMBO-V118-03 (ceiling constant defined in store), COMBO-V118-04 (partial — server extension is byte-identical when combinationKey absent)
**Research flag**: None — direct extension of established parallel-slice and lifecycle patterns
**Success Criteria** (what must be TRUE):
  1. filterCombinationStore.reset() is called in BOTH App.tsx (logout) and DashboardsPage.tsx (dashboard switch), with a snapshot-then-DROP loop before reset — grep confirms both sites.
  2. useViewKeepAlive covers combination-registry entries alongside existing filter and dynamic-view entries — a combination view's expiresAt is extended by the keep-alive touch.
  3. POST /api/filter/materialize with no combinationKey in the body produces a view name byte-identical to v1.17 — existing supertest vectors pass unchanged.
  4. POST /api/filter/materialize with a combinationKey appends _c{hash8} to the view name — new supertest confirms the extended shape.
  5. Server tsc clean; server vitest SET-BASED ⊆ TD-V16-TEST-ISOLATION; web vitest 100%; web tsc clean.
**Plans**: 2 plans
- [ ] 89-01-PLAN.md — filterCombinationStore (9th store) + ref-count lifecycle + snapshot-then-DROP cleanup at BOTH reset sites + keep-alive extension + MAX_COMBINATION_VIEWS_PER_TABLE (COMBO-V118-02, COMBO-V118-03)
- [ ] 89-02-PLAN.md — server hashKey8 (exact Phase-88 djb2) + buildFilterViewName combinationKey suffix + POST/DELETE materialize param + both-auth-mode supertests (COMBO-V118-04)

#### Phase 90: Combination-Orchestrator
**Goal**: A single hook owns all combination-view materializations — it computes unique combinations across all dashboard widgets on each filterVersion tick, diffs the registry, fires exactly one POST per new combination, enforces the per-table ceiling with fallback to the global view, and manages ref-counting. Individual renderers never call materializeFilter.
**Stack**: FRONTEND-ONLY
**Depends on**: Phase 88 (pure functions), Phase 89 (store + server param)
**Requirements**: COMBO-V118-01 (one view per unique combination; dedup + ref-count), COMBO-V118-03 (ceiling enforcement + fallback + warning)
**Research flag**: Planning research pass required — most architecturally novel phase; ownership semantics and diff/dispatch algorithm must be documented before coding; reference useDynamicViewMaterializeChain in dynamicViewStore.ts
**Success Criteria** (what must be TRUE):
  1. A single filter click on a dashboard with three widgets all accepting all filters produces exactly one POST /api/filter/materialize call (not three) — network tab confirms one POST per unique combination per filterVersion tick.
  2. When the number of unique combinations for a table would exceed MAX_COMBINATION_VIEWS_PER_TABLE, the excess widgets fall back to the global all-filters view and a console warning is emitted — unit test confirms the ceiling cap and fallback assignment.
  3. When the last widget using a combination leaves the dashboard (or changes its filter selection), the combination view is DROPped — unit test confirms refCount→0 triggers DROP.
  4. Static grep: grep -r "materializeFilter\|dropFilterView" packages/web/src/components/charts/ finds only authorized call sites — no individual chart renderer calls these functions.
  5. Web vitest 100%; web tsc clean; theme-guard green.
**Plans**: 3 plans
- [ ] 90-01-PLAN.md — client.ts cache-key fix: combinationKey on MaterializeFilterArgs + per-combination in-flight branch (COMBO-V118-01)
- [ ] 90-02-PLAN.md — env-var ceiling plumbing: server boot read → /api/me → MeResponse/fetchMe → web auth store, both-auth-mode supertest (COMBO-V118-03)
- [ ] 90-03-PLAN.md — useCombinationOrchestrator hook (diff/dispatch + ref-count DROP + ceiling fallback + info toast) + 11-scenario spec + DashboardOpen mount (COMBO-V118-01, COMBO-V118-03)

#### Phase 91: WidgetRenderer Wiring
**Goal**: Standard chart widgets (WidgetRenderer/AggregatedWidgetRenderer, TimelineRenderer, NumericLineRenderer) read their view name from filterCombinationStore instead of filterViewStore.views[tableId], and an existing dashboard with no filterScope config behaves byte-identically to v1.17.
**Stack**: FRONTEND-ONLY
**Depends on**: Phase 90 (orchestrator must exist before renderers become read-only consumers)
**Requirements**: READ-V118-01 (WidgetRenderer FROM-swap bound to combination view), COMBO-V118-04 (default accept-all is byte-identical to v1.17 — correctness gate for this phase)
**Research flag**: None — ARCHITECTURE.md documents exact file:line references for all integration points
**Success Criteria** (what must be TRUE):
  1. An existing dashboard with no filterScope config on any widget produces at most one POST /api/filter/materialize per table per filter change — same as v1.17, confirmed in the network tab.
  2. A widget with a source-allow-list that excludes one active filter reads from a different (narrower) combination view than a widget accepting all filters on the same table — confirmed by inspecting filterCombinationStore.vizToHash in devtools.
  3. While a new combination view is materializing, the widget shows a loading state and does not render the old (stale) view or the raw unfiltered table.
  4. Frontend vitest 100%; web tsc clean; theme-guard green.
**Plans**: 2 plans
- [ ] 91-01-PLAN.md — AggregatedWidgetRenderer: flip table read to filterCombinationStore + remove Effect 1 table branch + Effect 2 rewire (clearEntry retry) + COMBO-V118-04 byte-identical spec (READ-V118-01, COMBO-V118-04)
- [ ] 91-02-PLAN.md — TimelineRenderer + NumericLineRenderer: selector-only flip to filterCombinationStore + clearEntry expiry + NOFILTER/suspend specs (READ-V118-01)

#### Phase 92: MapChartRenderer Wiring
**Goal**: WMS map layers bind to their combination view by name — both buildWmsParams call sites (Effect 2 ADD/REMOVE and Effect 3 updateParams) resolve the per-layer combination view, and the comboViewsKey dep-key selector causes layer re-requests when the bound combination view changes.
**Stack**: FRONTEND-ONLY
**Depends on**: Phase 91 (combination store is stable; wiring both renderer paths in one milestone window reduces regression risk)
**Requirements**: READ-V118-02 (both buildWmsParams sites + dep keys; filters never in WMS request — only view name changes), COMBO-V118-04 (cross-cutting correctness gate: default accept-all map layers read the same single view as v1.17)
**Research flag**: None — ARCHITECTURE.md documents exact line numbers and selector patterns for both call sites
**Success Criteria** (what must be TRUE):
  1. A map layer with default (accept-all) filterScope continues to receive WMS tiles from the same view as a chart widget on the same table — byte-identical to v1.17 map behavior.
  2. A map layer with a source-allow-list receives WMS tiles from its own combination view, independent of the all-filters view used by other widgets on the same table — confirmed by comparing WMS tile request URLs in the network tab.
  3. Both buildWmsParams call sites in MapChartRenderer (Effect 2 and Effect 3) have been updated — grep confirms no remaining filterViewStore.views[tableId] reads in either effect for the table-backed path.
  4. The comboViewsKey selector (not viewsKey) is in both Effect 2 and Effect 3 dep arrays — confirmed by code inspection.
  5. Web vitest 100%; web tsc clean; theme-guard green.
**Plans**: 2 plans
- [ ] 92-01-PLAN.md — Orchestrator layer enumeration (l:<id> vizKeys, layersKey dep, STEP E guard) + DashboardLayerDto.filterScope? + DashboardOpen mount
- [ ] 92-02-PLAN.md — MapChartRenderer both buildWmsParams sites read combo view (comboViewsKey, uniqueTableIds removed, dv path untouched) + COMBO-V118-04 byte-identical spec

#### Phase 93: Filter Scope Config UI
**Goal**: Designers can configure each visualization's filter scope via a "Filter Scope" section in ChartConfigPanel (chart widgets) and KineticaWmsLayerForm (per layer), and the config persists correctly — layer.filterScope stored as a top-level field, not nested in layer.config.
**Stack**: BOTH (frontend-heavy; server adds `filterScope` persistence to the dashboard-layers path — threaded TOP-LEVEL exactly like `track_config`/`cb_config`: DTO + updateLayer Pick + PATCH route body + updateDashboardLayer + SQLite column. Chart-widget filterScope persists via the existing widget.config JSON blob — no schema change. NO dynamic-view migration here — that is Phase 94.)
**Depends on**: Phase 91 (the engine is wired, so absent filterScope already falls through to accept-all; UI can be added safely)
**Requirements**: FSCOPE-V118-01 (source-widget allow-list UI; only filter-PRODUCING widgets listed — chart drill-downs, DataFilter widget, map spatial-draws sentinel; NOT records/info-popup/legend; default accept-all), FSCOPE-V118-02 (chart widgets + map WMS layers; layer.filterScope top-level field threaded like track_config)
**Research flag**: None — config panel patterns well-established; ARCHITECTURE.md has the exact config shape
**Success Criteria** (what must be TRUE):
  1. Opening a chart widget's config panel shows a "Filter Scope" section with an opt-out toggle (default: accept all) and a source-widget checklist listing only filter-producing widgets (chart drill-downs, DataFilter, map spatial draws) — NOT records table, map info popup, or legend.
  2. Opening a map layer's form shows the same "Filter Scope" section at the layer level (not at the map widget level), and the config is stored on layer.filterScope (top-level), not inside layer.config.
  3. When a referenced source widget is deleted from the dashboard, the FilterSelectionPanel shows an orphan warning (mirrors RadioGroupConfigPanel pattern).
  4. Saving a filter-scope config persists via the existing PATCH routes and survives a page reload — the widget re-opens with the configured allow-list intact.
  5. Server tsc clean; server vitest SET-BASED ⊆ TD-V16-TEST-ISOLATION; web vitest 100%; web tsc clean; theme-guard green.
**Plans**: 2 plans
- [ ] 93-01-PLAN.md — Shared FilterSelectionPanel + filter-source enumeration constant + ChartConfigPanel integration + widgetId self-exclusion (FRONTEND-ONLY; FSCOPE-V118-01)
- [ ] 93-02-PLAN.md — Layer filter_scope top-level persistence (track_config mirror, 6 gaps + naming reconcile) + KineticaWmsLayerForm integration + widget threading + both-auth-mode supertests (BOTH; FSCOPE-V118-02)

#### Phase 93.5: Spatial Filters in the Combination Model
**Goal**: Spatial (map-draw) filters flow through the same one-view-per-unique-combination model as column filters — each visualization's resolved set + dedup hash incorporate the spatial shapes it accepts (per its source allow-list's spatial-draws entry), the orchestrator owns spatial materialization (no per-renderer trigger), and a table shared between a chart and a map no longer drops spatial. Default accept-all keeps spatial applied everywhere — byte-identical to prior behavior.
**Stack**: FRONTEND-ONLY (server `composeWhereClause` already composes spatial ∧ column WHERE; `buildFilterViewName` already appends the `_c{hash8}` combo suffix; `materializeFilter` already sends `spatialFilters`/`spatialTarget` — all reusable as-is)
**Depends on**: Phase 90 (orchestrator owns materialization), Phase 91/92 (read paths already consume the combo view by name), Phase 93 (config UI writes the spatial-draws allow-list entry the resolver reads)
**Requirements**: SPATIAL-V118-01
**Research flag**: Planning research pass required — reconcile the existing spatial trigger paths (`useMapOnlySpatialMaterialize` + the dv-branch Effect 1) against orchestrator ownership; lock how spatial shapes hash into stableComboHash (sorted shape-WKT hashes, order-independent) and how `spatialFilterVersion` enters the orchestrator dep array WITHOUT a re-render loop (mirror the combinationVersion exclusion rule).
**Success Criteria** (what must be TRUE):
  1. A table shown on BOTH a chart and a map, with an active spatial draw and default (accept-all) config, materializes ONE combination view that includes the spatial predicate, and both the chart and the map read it — spatial is not dropped (the post-Phase-91 gap is closed) and not double-materialized.
  2. With default accept-all, a single spatial draw produces exactly one POST /api/filter/materialize per affected table (carrying spatialFilters + spatialTarget) — confirmed in the network tab; behavior matches v1.5/v1.17.
  3. A visualization whose source allow-list EXCLUDES spatial draws reads a combination view WITHOUT the spatial predicate, while a sibling accepting spatial reads one WITH it — different view names, confirmed via filterCombinationStore.vizToHash.
  4. Two visualizations accepting the same column filters + the same spatial shapes share ONE combination view (dedup holds across spatial); changing/removing a shape re-derives the hash and ref-counts/DROPs correctly.
  5. resolveSpatialShapes has unit coverage (accept-all default, allow-list include/exclude, empty-shapes passthrough); stableComboHash spatial extension has determinism + order-independence unit coverage; web vitest 100%; web tsc clean; theme-guard green.
**Plans**: 2 plans
- [x] 93.5-01-PLAN.md — stableComboHash optional `shapes?` 4th param (WKT-sorted, order-independent, no-break) + resolveSpatialShapes pure fn (all-or-nothing via SPATIAL_DRAWS_SENTINEL) + unit specs (FRONTEND-ONLY; SPATIAL-V118-01)
- [x] 93.5-02-PLAN.md — orchestrator spatial fold-in (imperative shapes read, resolveSpatialShapes + aggregateSpatialTargetsByTable per viz, spatialFilters/spatialTarget in materialize, spatialFilterVersion dep) + remove useMapOnlySpatialMaterialize + records excluded from enumeration + spatial spec scenarios + sole-trigger gate (FRONTEND-ONLY; SPATIAL-V118-01)

#### Phase 94: Dynamic View Filter Scope Wiring
**Goal**: Dynamic-view-backed widgets apply filter-scope selection against their dvFilters (not the base-table filters), gated behind a deploy-time disable env flag that hides the dv filter-scope UI when not wanted.
**Stack**: BOTH (frontend extends dv-bound Effect 1 path; server exposes the disable flag on /api/me mirroring v1.15's ttlKeepaliveLeadMinutes)
**Depends on**: Phase 93 (FilterSelectionPanel exists and can be conditionally shown for dv-bound widgets based on the env flag)
**Requirements**: FSCOPE-V118-03 (dv filter-scope config + deploy-time disable switch exposed to client)
**Research flag**: Planning research pass required — three source-type cases (table-bound, dv-bound with dv-filter, dv-bound without dv-filter) must be enumerated; confirm server buildFilterViewName branches cover both table and dv paths with combinationKey symmetrically
**Success Criteria** (what must be TRUE):
  1. A dv-bound chart widget with a filter-scope allow-list re-materializes its dv-filter combination view when dvFilters change, using the combination key derived from resolveFilterSet(dv.filterSelection, dvFilters[dvId]) — confirmed by observing one POST /api/filter/materialize for the dv path with a combinationKey in the body.
  2. When the deploy-time disable flag is set (env var), the "Filter Scope" section is absent from dv-bound widget config panels — confirmed by checking the flag value and reloading.
  3. A dv-bound layer's filter scope uses the dynamicViewId as the stableComboHash source key (not the tableId) — combination registry entry shows sourceType "dv".
  4. Server tsc clean; server vitest SET-BASED ⊆ TD-V16-TEST-ISOLATION; web vitest 100%; web tsc clean; theme-guard green.
**Plans**: 2 plans
- [ ] 94-01-PLAN.md — Orchestrator dv enumeration (widgets + layers) + remove WidgetRenderer Effect 1 dv-branch + dv renderer read-path flip (WidgetRenderer + MapChartRenderer) to filterCombinationStore + three-source-type spec scenarios (FRONTEND-ONLY; FSCOPE-V118-03 engine half)
- [ ] 94-02-PLAN.md — DISABLE_DV_FILTER_SCOPE env flag across 5 mirror sites (boot → /api/me → MeResponse → fetchMe → auth store) + FilterSelectionPanel UI gating for dv-bound vizs + same-dv source list + both-auth-mode /api/me supertests (BOTH; FSCOPE-V118-03 env-flag half)

#### Phase 95: On-Widget Badge Indicator
**Goal**: Each visualization that is ignoring at least one active filter surfaces a visible "N of M filters" badge in its widget header, giving designers and analysts immediate feedback on which filters are applied without opening config.
**Stack**: FRONTEND-ONLY
**Depends on**: Phase 91 (filterCombinationStore.vizToHash is populated; resolved filter counts are available), Phase 93 (filter scope config exists so meaningful ignore cases can occur)
**Requirements**: COMM-V118-01 (badge shown only when ≥1 active filter is ignored; hover breakdown of applied/ignored filters; global filter-bar unchanged)
**Research flag**: None — pure render work; badge UX fully specified; all dependencies exist after Phase 91
**Success Criteria** (what must be TRUE):
  1. A widget accepting all active filters (default or configured) shows no badge — zero visual change from v1.17 in the default case.
  2. A widget ignoring at least one active filter shows a badge reading "N of M filters" (e.g. "2 of 3 filters") in its widget header, using theme tokens (var(--accent) / var(--accent-text)), with no hardcoded hex.
  3. Hovering the badge shows a breakdown of which filters are applied and which are ignored, with a reason annotation for ignored ones (source excluded).
  4. The widget-filter-badge CSS class exists in global.css before use — theme-guard green; no invented class names.
  5. Web vitest 100%; web tsc clean; theme-guard green.
**Plans**: TBD

#### Phase 96: Verification + Live UAT
**Goal**: The milestone is proven complete — all automated gates pass on both stacks and a live operator walk-through covering every v1.18 feature passes with no unresolved gaps.
**Stack**: BOTH (gates) + operator
**Depends on**: Phase 95 (all feature phases complete)
**Requirements**: VERIFY-V118-01 (green automated gates + blocking live operator walk-through; all gaps fixed in-session)
**Research flag**: None
**Success Criteria** (what must be TRUE):
  1. Automated gates pass: frontend vitest 100% from packages/web; web tsc clean; server tsc clean; server supertests in BOTH auth modes; server vitest SET-BASED ⊆ TD-V16-TEST-ISOLATION; theme-guard green.
  2. Live walk: per-viz filter selection on chart widgets works — widgets with different filter scopes receive different combination views and show different filtered data simultaneously on the same dashboard.
  3. Live walk: WMS map layers respond to per-layer filter scope — a layer with an allow-list shows different map tiles than an all-filters layer on the same table.
  4. Live walk: default accept-all dashboards (no filterScope config) are byte-identical to v1.17 — one materialize per table, no badge, no behavior change.
  5. Live walk: combination dedup, ceiling fallback, on-widget badge, and cleanup on dashboard switch/logout all verified; any gaps fixed in-session and re-walked to PASS.
**Plans**: TBD

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
| 88 | v1.18 | 0/TBD | Not started | — |
| 89 | v1.18 | 0/TBD | Not started | — |
| 90 | v1.18 | 0/3 | Planned | — |
| 91 | v1.18 | 0/TBD | Not started | — |
| 92 | v1.18 | 0/2 | Planned | — |
| 93 | v1.18 | 0/2 | Planned | — |
| 93.5 | v1.18 | 0/2 | Planned | — |
| 94 | v1.18 | 0/2 | Planned | — |
| 95 | v1.18 | 0/TBD | Not started | — |
| 96 | v1.18 | 0/TBD | Not started | — |

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

## v1.13 Calendar Heatmap Visualization — SHIPPED 2026-06-18

<details>
<summary>✅ v1.13 (Phases 65-69 incl. 68.1 / 68.2) — SHIPPED 2026-06-18 — full phase details archived</summary>

A configurable Calendar Heatmap widget: GitHub-style time-bucketed grids across 8 domain×subdomain combinations, color-scaled, with drillable cells that filter the whole dashboard (incl. WMS map tiles) to a time slice, for both table- and dynamic-view-backed bindings. FRONTEND-ONLY (zero server diff). Full phase-by-phase detail, success criteria, and plan lists are archived in `milestones/v1.13-ROADMAP.md`; requirements in `milestones/v1.13-REQUIREMENTS.md`.

- [x] Phase 65: Calendar SQL Builder + Kinetica Spike (2/2 plans) — completed 2026-06-16
- [x] Phase 66: Chart-Type Definition + Config Panel (4/4 plans) — completed 2026-06-16
- [x] Phase 67: SVG Calendar Renderer (read-only) (3/3 plans) — completed 2026-06-16
- [x] Phase 68: Cell-Drill Integration (4/4 plans) — completed 2026-06-16
- [x] Phase 68.1: Calendar UX — wrapped GitHub week-block layout + config-gated on-widget controls (INSERTED, 3/3 plans) — completed 2026-06-17
- [x] Phase 68.2: Calendar week-anchor spike + per-group date-range gap-fill (INSERTED, 3/3 plans) — completed 2026-06-17
- [x] Phase 69: Verification + Live UAT (3/3 plans) — completed 2026-06-18 — 69-VERIFICATION.md passed (4/4 SCs); 3 dv/filter gaps fixed in-session (d60f3b1) + re-walked PASS

</details>
