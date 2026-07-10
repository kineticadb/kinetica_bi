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
- ✅ **v1.19 Visualization Customization** — Phases 97-104 (shipped 2026-07-08) — see `milestones/v1.19-ROADMAP.md`
- 🚧 **v1.20 Filter Panel** — Phases 105-110 (IN PROGRESS, started 2026-07-08)

---

## v1.20 Filter Panel — IN PROGRESS (started 2026-07-08)

**Goal:** Give dashboards a richer, discoverable way to see and manage active filters — an alternative collapsible right-side filter panel (vs. the current top bar), chosen per-dashboard by the designer, with full chip parity, a global clear-all, and visibility into which widgets each filter affects (in-panel list + on-canvas highlight). A PRESENTATION LAYER over the existing filter system — no new materialize path, no filter-semantics change.

**Granularity:** standard. **Phases:** 6 (105-110). **Coverage:** 17/17 requirements mapped.

**Source-of-truth (load-bearing — all four research agents converged):** ACTIVE FILTERS = `useFilterStore` (`.filters` per tableId + `.dvFilters` per dvId) + `useSpatialFilterStore` (`.shapes`). The DERIVED `filterCombinationStore` is written ONLY by the orchestrator and must NEVER be read as the chip/source-of-truth list (that is the exact permanent-staleness bug `FilteringBadge` already hit). The panel reads/mutates the SAME input stores the top bar uses.

**Invariant (every phase):** `AggregatedWidgetRenderer` remains the SOLE materialize trigger. The panel is a pure presentation/management layer — global clear-all mutates INPUT stores only and lets the untouched `useCombinationOrchestrator` ref-count DROP views. No new materialize path, no filter-semantics change, no new npm packages. Static grep `grep -rE "materializeFilter|dropCombinationView" packages/web/src/components/` finds only authorized call sites (the panel/clear-all handler is not among them). Theme-tokens-only / no invented CSS classes (undefined classes + `rgba()`/wrong tokens pass all gates but render broken — verify the panel + highlight VISUALLY in light + dark + narrow viewport).

### Phases

- [x] **Phase 105: Reverse-Mapping Pure Lib + Tests** (completed 2026-07-08) — FRONTEND-ONLY — `resolveWidgetsForFilter.ts`, the INVERSE of `resolveFilterSet`/`resolveSpatialShapes`/`useFilterScopeSummary`, enumerating BOTH read paths (`w:<id>` chart widgets + `l:<id>` map layers → owning map widget) × all filter kinds (eq/in/between+datetime/spatial) × `dvFilterScopeDisabled`. Pure + fully unit-tested. **(research flag — HIGHEST RISK)**
- [x] **Phase 106: Display-Mode Persistence** (completed 2026-07-09) — BOTH-stack — add a `dashboards.filter_display_mode` column (PRAGMA-guarded ALTER, mirroring the v1.18 `filter_scope` migration) + `DashboardDto`/update plumbing; default `'topbar'` → absent = byte-identical top bar. The milestone's ONLY server touch.
- [x] **Phase 107: Panel Shell + Reflow + XOR Switch + Chips** (completed 2026-07-09) — FRONTEND-ONLY — collapsible right drawer (reuse `.sidebar` collapse + `filter-bar-*` classes), top-bar XOR panel switch, active-filter chips (shared `FilterChip` + `buildChipText`) for eq/in + datetime-between + spatial, per-chip remove + per-group clear, collapsed count badge, empty state, group-by-source, provenance. Panel is an in-flow flex sibling shrinking the grid container (NOT a fixed overlay) so RGL `useContainerWidth` auto-reflows.
- [ ] **Phase 108: Applies-To List + On-Canvas Highlight** — FRONTEND-ONLY — per-filter "applies to N widgets" list/count (consuming the Phase 105 lib) + hover-highlight + click-to-scroll/flash; new session-only `filterHighlightStore` + `WidgetCard` extraction; `reset()` joins BOTH cleanup chains. **(research flag — HIGH RISK: re-render-storm avoidance + deterministic cleanup)**
- [ ] **Phase 109: Global Clear-All** — FRONTEND-ONLY — one action clears every active filter across all tables + dynamic views + spatial draws by looping `clearFilters`/`clearDvFilters`/`clearAll` (INPUT stores only); the orchestrator DROPs by ref-count; grep-gated that the handler imports no `materializeFilter`/`dropCombinationView` and never `filterStore.reset()` live.
- [ ] **Phase 110: Designer Settings UI + Verification + Live UAT** — BOTH + operator — designer mode-toggle in the dashboard settings (gated by the existing `dashboards:edit`, NO new RBAC permission) + green automated gates on both stacks + a blocking live operator walk-through incl. light/dark + narrow-viewport visual checks.

## Phase Details

### Phase 105: Reverse-Mapping Pure Lib + Tests
**Goal**: A pure `resolveWidgetsForFilter` library computes, for any active filter, the exact set of dashboard widgets that filter applies to — the inverse of the existing filter resolvers — so the per-filter "applies to" list (Phase 108) and highlight targets can be derived without drifting from the actual read paths.
**Stack**: FRONTEND-ONLY (`packages/web` — new pure lib mirroring `resolveFilterSet.ts` / `resolveSpatialShapes.ts` / `useFilterScopeSummary`; no store subscriptions, no React).
**Depends on**: Nothing (pure lib; parallel-safe with Phase 106).
**Requirements**: FSCOPE-V120-01 (computation portion — the panel display portion lands in Phase 108).
**Invariant**: Pure function — no store/React coupling, no materialize/filter mutation. Must EXACTLY mirror the existing resolvers so the per-widget badge and the per-filter map can't diverge; honors the `dvFilterScopeDisabled` accept-all override just like `useFilterScopeSummary`.
**Research flag**: REQUIRED (HIGHEST RISK) — the enumeration must be exhaustive: both read paths, all filter kinds, layer→map-widget translation, and the dv-disabled override. Get it right at plan time.
**Success Criteria** (what must be TRUE):
  1. Given an equality/in filter, the lib returns exactly the chart widgets (`w:<id>`) AND the map widgets (resolved from their `l:<id>` layers) that apply it, honoring each visualization's per-visualization filter scope.
  2. Datetime `between` filters and spatial-draw filters each resolve to their correct applies-to widget sets (all filter kinds covered — not just eq/in).
  3. Map layers (`l:<id>`) are translated back to their owning map widget; a widget appears exactly once even when several of its layers match the same filter.
  4. When `dvFilterScopeDisabled` is set, dv-backed widgets fall through to accept-all — matching `useFilterScopeSummary`.
  5. Correctness is proven by unit tests spanning 3 filter kinds × both read paths × the dv-disabled override, with zero store/React coupling.
**Plans:** 1/1 plans complete
- [x] 105-01-PLAN.md — Pure computeReverseFilterMap lib (inverse of resolveFilterSet/resolveSpatialShapes; both read paths × all filter kinds × dv-disabled) + exhaustive vitest matrix (completed 2026-07-08, see 105-01-SUMMARY.md)

### Phase 106: Display-Mode Persistence
**Goal**: Each dashboard persists a filter display mode (top bar vs right panel) server-side, returned to every viewer on load, defaulting to top bar so unconfigured dashboards stay byte-identical to today.
**Stack**: BOTH (server: PRAGMA-guarded `ALTER TABLE dashboards ADD COLUMN filter_display_mode`, mirroring the v1.18 `filter_scope` migration; `mapDashboard`/`updateDashboard`/`DashboardDto` + client attrs. Client: read the mode on dashboard load). The milestone's ONLY server touch — isolated early for a clean BOTH-stack review.
**Depends on**: Nothing (parallel-safe with Phase 105).
**Requirements**: FSET-V120-02, FSET-V120-03.
**Invariant**: Absent mode → `'topbar'` → byte-identical top-bar behavior. No materialize / filter-semantics change; the persistence carries display state only. (Scalar `filter_display_mode TEXT DEFAULT 'topbar'` vs a JSON `config` blob is an open plan-time decision — both mirror the v1.18 migration and both default to top bar.)
**Success Criteria** (what must be TRUE):
  1. A dashboard's filter display mode persists server-side and is returned on load to every viewer of that dashboard.
  2. A dashboard with no configured mode reads as top bar (`'topbar'`) — byte-identical to current behavior (backward-compat locked by test).
  3. Setting the mode via the dashboard-update path round-trips through save → reload.
  4. Supertests pass in BOTH auth modes; the migration is idempotent (PRAGMA-guarded ALTER; no crash on an already-migrated DB).
**Plans:** 1/1 plans complete
- [x] 106-01-PLAN.md — Server persistence (PRAGMA-guarded `dashboards.filter_display_mode` migration + DTO coalesce + validated PATCH allow-list) + BOTH-auth-mode supertests + web `DashboardDto` field (completed 2026-07-09, see 106-01-SUMMARY.md)

### Phase 107: Panel Shell + Reflow + XOR Switch + Chips
**Goal**: When a dashboard's mode is "panel", its active filters render in a collapsible right-side drawer (never alongside the top bar) as chips — with per-chip remove, per-group clear, grouping by source, provenance, an empty state, a collapsed count badge — all via a single shared `FilterChip`, with the grid auto-reflowing to make room.
**Stack**: FRONTEND-ONLY (`packages/web` — new `FilterPanel` + shared `FilterChip`; `DashboardOpen` switches the surface top-bar XOR panel by the resolved mode; reuse the `.sidebar` collapse + `filter-bar-*` classes).
**Depends on**: Phase 106 (the mode switch needs the persisted display mode).
**Requirements**: FPANEL-V120-01, FPANEL-V120-02, FPANEL-V120-03, FPANEL-V120-04, FPANEL-V120-05, FPANEL-V120-06, FPANEL-V120-07, FPANEL-V120-08, FPANEL-V120-09.
**Invariant**: Reads/mutates the SAME input stores as the top bar (`useFilterStore.filters`/`.dvFilters` + `useSpatialFilterStore.shapes`) — NEVER the derived `filterCombinationStore` as the chip source (the `FilteringBadge` staleness bug). Every mutation calls the EXISTING filter-store actions; labels via `buildChipText` (never `String(value)`). The panel is an in-flow flex sibling that shrinks the grid container (NOT a `position:fixed` overlay) so `react-grid-layout`'s `useContainerWidth` ResizeObserver auto-reflows. Reuse existing classes (grep `global.css` first — invented classes pass all gates but render unstyled); tokens only, no `rgba()`.
**Success Criteria** (what must be TRUE):
  1. A dashboard in "panel" mode renders its active filters in a collapsible right-side panel and NOT in the top bar; a top-bar dashboard is unchanged — the two surfaces are mutually exclusive (never both rendered).
  2. The panel lists all active filters — equality/in, datetime-between, AND spatial-draw — as chips matching the set the top bar shows, and the widget grid reflows to make room for the panel.
  3. A user can remove an individual filter chip AND clear a whole group; both go through the existing filter-store actions and update every affected widget.
  4. The panel collapses/expands, showing an active-filter count badge (e.g. "Filters 3") when collapsed and an empty state when no filters are active.
  5. Filters are grouped by source (table / dynamic view / spatial draws) with per-filter provenance (the originating source widget when available), and BOTH the top bar and the panel render chips via one shared `FilterChip` component.
**Plans**: 2 plans (wave 1 then wave 2)
- [x] 107-01-PLAN.md — Shared FilterChip extraction + top-bar parity refactor + resolveProvenance helper (completed 2026-07-09, see 107-01-SUMMARY.md)
- [x] 107-02-PLAN.md — Panel shell + rail + reflow + XOR switch + source groups + empty state + count badge, plus an operator-caught grid-cascade fix (breakpoint="lg" pin) (completed 2026-07-09, see 107-02-SUMMARY.md)

### Phase 108: Applies-To List + On-Canvas Highlight
**Goal**: Each filter in the panel shows which widgets it applies to (names/count), and hovering a filter highlights those widgets on the canvas while clicking scrolls to and briefly flashes them.
**Stack**: FRONTEND-ONLY (`packages/web` — new session-only `filterHighlightStore` (Set of highlighted vizKeys) + a `WidgetCard` extraction that subscribes with a scoped boolean selector and toggles a `var(--accent)` outline class; consumes the Phase 105 lib).
**Depends on**: Phase 105 (the reverse-map lib) + Phase 107 (the panel to render into + the canvas cards to highlight).
**Requirements**: FSCOPE-V120-01 (panel display portion — computation is Phase 105), FSCOPE-V120-02, FSCOPE-V120-03.
**Invariant**: Highlight via a CSS-class toggle + a scoped boolean selector — NEVER a whole-object store subscription (that re-renders every widget and flickers maps on each hover). Deterministic cleanup on leave / panel-collapse / dashboard-switch / logout: `filterHighlightStore.reset()` joins BOTH cleanup chains (DashboardOpen unmount + App UNAUTHORIZED handler), taking the store count to the required ~11.
**Research flag**: REQUIRED (HIGH RISK) — re-render-storm avoidance (scoped selector vs CSS-only), the `WidgetCard` extraction, and deterministic cleanup across both reset chains need careful plan-phase design.
**Success Criteria** (what must be TRUE):
  1. For each active filter, the panel shows which widgets it applies to (names and/or count), consistent with the Phase 105 computation across chart widgets + map layers + all filter kinds.
  2. Hovering a filter highlights exactly the affected widgets on the canvas (accent outline), and un-hovering clears it — with no visible re-render/flicker of unaffected widgets or maps.
  3. Clicking a filter scrolls to and briefly flashes the affected widget(s) on the dashboard.
  4. Highlight state is deterministically cleared on leave, panel collapse, dashboard switch, and logout (reset registered in both cleanup chains) — no stuck highlight (leak spec).
**Plans**: 2 plans (strictly sequential — both edit DashboardsPage.tsx)
- [x] 108-01-PLAN.md — Foundation: filterHighlightStore (12th reset-chain store) + WidgetCard extraction (scoped selectors + deterministic flash cleanup) + useReverseFilterMap hook + ring/flash/applies-to CSS [wave 1] (completed 2026-07-10, see 108-01-SUMMARY.md)
- [ ] 108-02-PLAN.md — Panel wiring: applies-to line/expander + hover→ring / click→scroll+flash in FilterChip panel variant + DashboardsPage group builders [wave 2, depends 108-01]

### Phase 109: Global Clear-All
**Goal**: A single action clears every active filter across the whole dashboard — all tables, all dynamic views, and all spatial draws — by mutating only the input stores and letting the orchestrator ref-count DROP the views.
**Stack**: FRONTEND-ONLY (`packages/web` — a clear-all handler in the panel (and, ideally, the top bar) looping the existing store actions).
**Depends on**: Phase 107 (the panel provides the action; sequenced after the panel so live combinations exist to tear down during UAT).
**Requirements**: FCLEAR-V120-01.
**Invariant**: Clear-all loops `clearFilters` / `clearDvFilters` + `spatialFilterStore.clearAll()` ONLY — it NEVER calls `materializeFilter` / `dropCombinationView`, and NEVER `filterStore.reset()` live (that would break the version tick and orphan views). The untouched `useCombinationOrchestrator` DROPs each `_c{hash}` view by ref-count. Grep-gate: the clear-all handler imports no `materialize*` / `drop*View`. Read-only static WHERE (`views[].filter_clause`) is never touched.
**Success Criteria** (what must be TRUE):
  1. One "Clear all" action removes every active filter — across all tables, dynamic views, and spatial draws — in a single step, from the panel.
  2. All widgets return to their unfiltered state and every per-combination Kinetica view (`_c{hash}`) is DROPped by the orchestrator's ref-count (verified in the network tab) — no views orphaned.
  3. The clear-all handler imports no `materializeFilter` / `dropCombinationView` and never calls `filterStore.reset()` live (grep-gated); read-only static WHERE clauses are untouched.
  4. Clear-all is offered from the panel (and ideally the top bar) with consistent behavior across both surfaces.
**Plans**: TBD (derived by `/gsd:plan-phase 109`)

### Phase 110: Designer Settings UI + Verification + Live UAT
**Goal**: A designer with dashboard-edit permission can choose a dashboard's filter display mode from a dashboard setting; then every feature is verified green on both stacks plus a blocking live operator walk-through — including the light/dark and narrow-viewport visual checks that automated gates cannot catch.
**Stack**: BOTH + operator (settings toggle is web, gated by the existing `dashboards:edit`; verification exercises both stacks; live UAT).
**Depends on**: Phases 105, 106, 107, 108, 109 (VERIFY is the final phase and depends on all others).
**Requirements**: FSET-V120-01, VERIFY-V120-01.
**Invariant**: The mode setting is gated by the EXISTING `dashboards:edit` permission — NO new RBAC permission (avoid the permission-ripple across rbacDb/rbacMigration/web-permissions/RolesPage specs). Re-assert the sole-materialize-trigger grep clean across the milestone; theme-tokens-only / no invented CSS classes (verified VISUALLY — undefined classes + `rgba()`/wrong tokens pass tsc + vitest + theme-guard but render broken); server vitest set-based ⊆ TD-V16-TEST-ISOLATION (NEVER a fixed pass-count).
**Success Criteria** (what must be TRUE):
  1. A designer (with `dashboards:edit`) can pick a dashboard's filter display mode — top bar or right panel — from a dashboard setting; a non-permitted user cannot, and no new permission is introduced (byte-parity check on the permission catalog).
  2. Automated gates green: web vitest 100% from `packages/web`, web + server `tsc` clean (separate gates), theme-guard green, server vitest set-based ⊆ TD-V16-TEST-ISOLATION.
  3. A blocking live operator walk-through exercises the panel + chips (remove / group-clear), global clear-all, the applies-to list + hover/click highlight, and the designer mode toggle — INCLUDING light/dark theme and narrow-viewport visual checks — and attests PASS.
  4. Any gaps found in the walk are fixed in-session (with regression tests) and re-walked to PASS.
**Plans**: TBD (derived by `/gsd:plan-phase 110`)

### Phase Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 105. Reverse-Mapping Pure Lib + Tests | 1/1 | Complete | 2026-07-08 |
| 106. Display-Mode Persistence | 1/1 | Complete | 2026-07-09 |
| 107. Panel Shell + Reflow + XOR Switch + Chips | 2/2 | Complete | 2026-07-09 |
| 108. Applies-To List + On-Canvas Highlight | 0/? | Not started | - |
| 109. Global Clear-All | 0/? | Not started | - |
| 110. Designer Settings UI + Verification + Live UAT | 0/? | Not started | - |

**Dependency spine:** {105, 106} parallel-safe → 107 (needs 106's persisted mode) → {108 (needs 105's lib + 107's panel/cards), 109 (needs 107's panel + live combos to tear down)} → 110 (needs all). The reverse-map lib (105) precedes the panel/highlight that consume it; persistence (106) gates the mode switch (107); clear-all (109) is sequenced last among features so live combos exist to prove the ref-count DROP; VERIFY (110) is final and depends on every feature phase.

---

## v1.19 Visualization Customization — SHIPPED 2026-07-08

<details>
<summary>✅ v1.19 (Phases 97-104) — SHIPPED 2026-07-08 — full phase details archived in milestones/v1.19-ROADMAP.md</summary>

- [x] Phase 97: Calendar Smart Domain Control
- [x] Phase 98: Per-Visualization Custom WHERE Clause
- [x] Phase 99: Custom Metrics — Server + Store Foundation
- [x] Phase 100: Custom Metrics — Tables-Area Editor + Metric-Picker Integration
- [x] Phase 101: Smart / Logarithmic Y-Axis
- [x] Phase 102: Multi-Column Group-By on Bar Chart
- [x] Phase 103: Verification + Live UAT
- [x] Phase 104: Synchronized Map Viewports (added post-verification; Phase 103 re-run)

**Delivered:** Per-visualization control over data + presentation without touching the shared filter/materialize engine — calendar smart domain control, per-viz custom WHERE, custom metrics (the only BOTH-stack feature), smart/log Y-axis, multi-column bar group-by, and synchronized map viewports. 8 phases (97-104), 19 plans; 27/27 requirements; operator UAT PASS on all features. Tag `v1.19`. See `MILESTONES.md` + `milestones/v1.19-ROADMAP.md`.

</details>
