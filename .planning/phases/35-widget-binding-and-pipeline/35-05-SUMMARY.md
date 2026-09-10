---
phase: 35-widget-binding-and-pipeline
plan: 05
subsystem: ui

tags: [react, zustand, dynamic-views, fromswap, renderer, tdd, vitest]

# Dependency graph
requires:
  - phase: 33-dynamic-view-store
    provides: "useDynamicViewStore (scoped per-id selectors, 4-state union: pending/materialized/over_threshold/error)"
  - phase: 35-widget-binding-and-pipeline (Plan 35-03)
    provides: "useDynamicViewMaterializeChain orchestrator hook + DashboardContext.dynamicViews threading + retry(id) function in DashboardOpen scope"
  - phase: 34-dynamic-view-ui
    provides: "ToastKind locked union (permission | info | error) — renderer Retry button does NOT toast (orchestrator does)"
  - phase: 15-filter-view-store (Phase 15-02 / 17-02 / 17-03)
    provides: "AggregatedWidgetRenderer Effect 1 / Effect 2 + RecordsTableRenderer page+count effects — TEMPLATES that this plan extends without touching Effect 1's dep arrays"
provides:
  - "AggregatedWidgetRenderer dv-bound branches: scoped useDynamicViewStore.views[dynamicViewId] selectors; Effect 2 viewName source flips; suspend-gate extends to dvStatus === 'pending'; render body 5-state + orphan gates"
  - "RecordsTableRenderer dv-bound branches: page-fetch + count-fetch viewName source flips with same gates; pagination preserved on materialized dv"
  - "DashboardContext extended with retryDynamicView: (id) => void — sourced from Plan 35-03 orchestrator's retry function, mounted in DashboardOpen"
  - "Effect 1 in BOTH renderers verifiably UNCHANGED — locked from research finding #2 lock (filter view stays the {view} substitution source for dv templates); regression test asserts materializeFilter not re-fired by dvStatus changes"
  - "Pitfall 4 defense-in-depth: materialized + empty viewName → internal error (never reaches runSql with empty FROM)"
  - "LIFE-V13-02 reactive view-not-found retry scoped to non-dv-bound widgets — orchestrator owns dv-bound retry path"
  - "CSS classes: .widget-over-threshold, .widget-orphan-dynamic-view, .widget-retry-btn — namespaced, compose with existing .widget-placeholder / .widget-error"

affects: [36-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Status-aware render gate cascade: orphan → status-branch → existing render switch. Render-body gates are mirror of Effect 2's runtime short-circuits — single source of truth on what the dv status means in both the data layer and the JSX layer."
    - "Dual primitive-dep pattern: dynamicViewId + dvStatus + dvViewName ALL in deps (PITFALL S-02 carry-forward). Object references never enter deps; the entry's identity changes whenever any primitive changes (Phase 33 setView always bumps dynamicViewVersion)."
    - "Mutual-exclusion at branch-time: dynamicViewId !== undefined branches BEFORE filter-view path. Legacy widgets (no dv) continue using Phase 15 / 17 flow byte-identically."
    - "Defense-in-depth empty-viewName guard (Pitfall 4): materialized status with empty viewName triggers setError instead of reaching fromSwap (which would produce broken SQL via raw FROM table fallthrough)."

key-files:
  created: []
  modified:
    - "kinetica_bi/src/components/charts/WidgetRenderer.tsx (319-line diff): import useDynamicViewStore; AggregatedWidgetRenderer adds dynamicViewId read + scoped dv selectors + isOrphanDynamicView; Effect 2 extends with suspend-gate + status short-circuits + viewName source flip; render body adds orphan + 4-status gates before existing chain. RecordsTableRenderer mirrors AggregatedWidget (page-fetch + count-fetch + render gates). Effect 1 in both renderers untouched."
    - "kinetica_bi/src/components/DashboardContext.tsx: DashboardContextValue + provider props extended with retryDynamicView: (dynamicViewId: number) => void."
    - "kinetica_bi/src/components/DashboardContext.spec.tsx: 8 fixture updates adding retryDynamicView={() => {}} default to existing DashboardContextProvider usages."
    - "kinetica_bi/src/components/charts/InfoCardRenderer.spec.tsx: 1 fixture update for new required prop."
    - "kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx: wrap helper signature extended with retryDynamicView parameter (default no-op); two new describe blocks (Phase 35 — AggregatedWidget 8 tests, RecordsTable 7 tests) covering all 5 statuses + orphan + Effect 1 regression + suspend-gate."
    - "kinetica_bi/src/styles/global.css: new CSS classes .widget-over-threshold, .widget-orphan-dynamic-view, .widget-retry-btn (composed with existing .widget-placeholder + .widget-error)."

key-decisions:
  - "Effect 1 untouched in BOTH renderers (research finding #2 lock). Filter-view still materializes for dv-bound widgets because the filter view provides the {view} substitution source for the dynamic-view template. The dv cascade is owned by Plan 35-03's orchestrator hook (downstream of filter-view materialize). Regression test asserts materializeFilter is NOT re-fired by dvStatus transitions (locks the dep array)."
  - "Suspend-gate extension to dvStatus === 'pending' (research finding #7 lock). Without this, chart query race-fires against the prior (stale) dv viewName during cascade re-materialize. Mirrors the v1.3 materializing gate (existing Phase 17-02 lock) — both gates engage when their respective materialization is in flight."
  - "DV-V16-14 message ROADMAP-verbatim, single message regardless of reason (no_filter vs exceeds_max_records). Operator UX clarity: same actionable copy in both cases. Reason field intentionally not consumed in the renderer (could surface as a tooltip in a follow-up but not in this plan)."
  - "retryDynamicView via DashboardContext (vs. direct hook import in renderer). Renderers stay context-driven (no React hook coupling beyond DashboardContext). Plan 35-03 mounts the orchestrator hook at DashboardOpen; this plan threads its retry function down to the renderers via context — same surface as the Phase 30 widgets-required pattern."
  - "Pitfall 4 defense-in-depth: materialized status with empty viewName triggers setError + render-body error gate. Prevents the silent-broken-SQL case where fromSwap(sql, '') would return sql unchanged (regex doesn't match) and runSql would fire against the raw FROM table — operator sees data but it's WRONG data. The internal-error message is intentional fail-loud."
  - "LIFE-V13-02 reactive view-not-found retry scoped to non-dv-bound (dynamicViewId === undefined) widgets. Dv-bound retry path is the orchestrator's retry function, surfaced via the Retry button. Without this scoping, the legacy v1.3 reactive retry would try to materializeFilter for a tableId — but the dv widget's viewName is a DV view name, not a filter view name, so the retry would build a fresh filter view that doesn't match the SQL's FROM substitution target."
  - "All five fixtures in DashboardContext.spec.tsx + InfoCardRenderer.spec.tsx updated via simple sed pass + targeted multi-line edit. Phase 30 widgets-required pattern preserved (compile-time honesty over optional-with-default convenience). Cost: ~9 fixture updates across 3 files."
  - "CSS reuses existing .widget-placeholder + .widget-error composition rather than introducing standalone classes. .widget-over-threshold + .widget-orphan-dynamic-view are tone variants (muted color, italic for orphan); .widget-retry-btn is a small inline button using the same red as .widget-error. Total CSS additions: 29 lines."

patterns-established:
  - "Pattern 1: render-body status gates mirror effect-body short-circuits. dvStatus → JSX gate AND dvStatus → runSql gate use the same union exhaustion logic, ensuring no state shows visible loading while runSql is suppressed (or vice versa)."
  - "Pattern 2: dual-write avoidance via mutual-exclusion at branch-time. cfg.dynamicViewId !== undefined branches the renderer's data layer (Effect 2 selects dvViewName) AND the render layer (status gates render BEFORE legacy fallthrough). No widget config can be both dv-bound and filter-view-only at the renderer level — the picker (Plan 35-04) enforces mutual exclusion at config-time."
  - "Pattern 3: retry-via-context, not retry-via-hook-import. Renderers consume retryDynamicView from useDashboardContext() — same surface as dashboardId / widgets / dynamicViews. The orchestrator hook is mounted ONCE at DashboardOpen scope; its retry function flows down through context to N renderers without re-mounting."

requirements-completed: [DV-V16-13, DV-V16-14]

# Metrics
duration: 40min
completed: 2026-05-15
---

# Phase 35 Plan 05: dv-bound renderer 5-state + orphan + Retry context Summary

**AggregatedWidgetRenderer + RecordsTableRenderer status-aware rendering for dv-bound widgets (5-state + orphan), Effect 2 viewName source flip with suspend-gate extension to dvStatus === "pending", DashboardContext extended with retryDynamicView from the orchestrator hook — Effect 1 in BOTH renderers verifiably unchanged.**

## Performance

- **Duration:** 40 min
- **Started:** 2026-05-15T17:13:37Z
- **Completed:** 2026-05-15T17:53:41Z
- **Tasks:** 2 (TDD: 2 atomic commits — 1 test + 1 feat)
- **Files modified:** 5 (5 modified, 0 created)
- **Tests added:** 15 new cases (8 AggregatedWidget + 7 RecordsTable)
- **Full frontend suite after change:** 961/961 pass (44 test files)

## Accomplishments

- **Both renderers branch on `cfg.dynamicViewId`** — viewName source flips to `useDynamicViewStore.views[dynamicViewId]?.viewName` for dv-bound widgets; legacy widgets continue using `useFilterViewStore.views[tableId]?.viewName` byte-identically.
- **All 6 critical locks honored**:
  1. Effect 1 UNCHANGED in BOTH renderers (research finding #2 lock — regression test asserts `materializeFilter` NOT re-fired by `dvStatus` transitions).
  2. Effect 2 suspend-gate extends to `dvStatus === "pending"` (research finding #7) — `runSql` does not fire even when filter view is ready.
  3. 5-state render mapping: orphan → undefined/pending → over_threshold → error → materialized fallthrough.
  4. DV-V16-14 message ROADMAP-verbatim: `"Too much data — narrow your filters to enable this view."` (single message, no reason-branching).
  5. Orphan message verbatim: `"This dynamic view was deleted. Reconfigure the widget."`
  6. Retry button calls `retryDynamicView(dynamicViewId)` from DashboardContext (sourced from orchestrator hook's retry).
- **Pitfall 4 defense-in-depth**: materialized status with empty viewName triggers setError instead of reaching `fromSwap("", sql)` (which would silently fall through to raw FROM table — operator sees WRONG data).
- **LIFE-V13-02 reactive retry scoped to non-dv-bound widgets** — orchestrator owns dv-bound retry path; legacy v1.3 reactive retry only fires when `dynamicViewId === undefined`.
- **CSS additions** (29 lines): `.widget-over-threshold`, `.widget-orphan-dynamic-view`, `.widget-retry-btn` — namespaced, compose with existing `.widget-placeholder` + `.widget-error`.
- **DashboardContext extended** with required `retryDynamicView: (id) => void` — Phase 30 widgets-required compile-time-honesty pattern preserved; 9 fixture updates across 3 spec files.

## Task Commits

Each task committed atomically following the TDD red → green pattern:

1. **Task 1 RED + Task 2 RED: failing dv-bound renderer spec (15 cases)** — `7d62056` (test)
2. **Task 1 GREEN + Task 2 GREEN: dv-bound renderer 5-state + orphan + Retry context** — `361c395` (feat)

_Note: Task 1 (implementation) and Task 2 (tests) overlap heavily in TDD execution — the tests were added first as the executable spec, the implementation made them green._

## Files Created/Modified

**Modified:**
- `kinetica_bi/src/components/charts/WidgetRenderer.tsx` — 319-line diff:
  - Import `useDynamicViewStore` (Phase 33 store).
  - AggregatedWidgetRenderer: read `cfg.dynamicViewId`; scoped `useDynamicViewStore.views[dynamicViewId]` selectors (dvEntry / dvStatus / dvViewName / dvError); orphan detection via `dashboardDynamicViews.some(...)` from context; Effect 2 extended with new suspend-gate + status short-circuits + viewName source flip (Pitfall 4 guard); render body adds orphan + 4-status gates BEFORE existing loading/error/data chain.
  - RecordsTableRenderer: same pattern applied to page-fetch effect (line 1404) AND count-fetch effect (line 1456); render body adds same status gates.
- `kinetica_bi/src/components/DashboardContext.tsx` — `DashboardContextValue` + provider props extended with `retryDynamicView: (dynamicViewId: number) => void`; useMemo dep array extended.
- `kinetica_bi/src/components/DashboardContext.spec.tsx` — 8 fixture updates adding `retryDynamicView={() => {}}` to existing `<DashboardContextProvider>` test fixtures.
- `kinetica_bi/src/components/charts/InfoCardRenderer.spec.tsx` — 1 fixture update for the new required prop.
- `kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx` — `wrap` helper signature extended with optional `retryDynamicView` parameter (default no-op); 2 new describe blocks at end of file (AggregatedWidget 8 tests + RecordsTable 7 tests).
- `kinetica_bi/src/styles/global.css` — 29 lines added for new CSS classes.

_Note: DashboardsPage.tsx was modified by Plan 35-04 (commit `c2e795e`) which removed the underscore prefix from `_retryDynamicView` and added `retryDynamicView={retryDynamicView}` to the `<DashboardContextProvider>` mount — this plan's work was already absorbed by the parallel-plan commit. Net effect identical to plan spec._

## Decisions Made

See `key-decisions` in frontmatter for the 8 decisions captured. Highest-impact:

- **Effect 1 untouched in BOTH renderers** — locked from research finding #2 to keep the filter-view materialize trigger as the sole source of `{view}` substitution for dv templates. The dv cascade is downstream of filter-view materialize, owned by Plan 35-03's orchestrator. Regression test (T7 of the dv branches describe block) asserts `materializeFilter` is NOT re-fired by `dvStatus` transitions.
- **Suspend-gate extension to dvStatus === "pending"** — prevents stale-viewName race during cascade re-materialize. The chart query waits for the orchestrator's setView before re-firing.
- **Retry via DashboardContext, not direct hook import** — renderers stay context-driven. Mirrors Phase 30 widgets-required pattern (compile-time honesty over optional-with-default).
- **Pitfall 4 defense-in-depth** — materialized + empty viewName is a fail-loud internal error, not a silent fallthrough to raw FROM table (which would produce WRONG data with the operator unaware).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] LIFE-V13-02 reactive retry must be scoped to non-dv-bound widgets**
- **Found during:** Task 1 GREEN (initial impl re-used the existing LIFE-V13-02 retry path verbatim)
- **Issue:** The plan's `<action>` section describes the Effect 2 viewName source flip but doesn't explicitly call out that LIFE-V13-02's reactive view-not-found → materializeFilter retry should ONLY fire for non-dv-bound widgets. Without the scoping, a dv-bound widget hitting view-not-found would trigger `materializeFilter` for the source table — but the viewName mismatch means the retry's freshly materialized filter view would NOT match the SQL's FROM substitution (which targets the dv view name). Result: silent retry that produces a fresh but UNUSED filter view, while the chart query falls through to raw FROM table → wrong data.
- **Fix:** Added `dynamicViewId === undefined &&` as the first guard in the LIFE-V13-02 retry branch. For dv-bound widgets, view-not-found errors fall through to the standard `setError((err as Error).message)` path, which surfaces an error UI to the operator. Operator can click Retry to call `retryDynamicView(dynamicViewId)` from the orchestrator, which is the correct retry surface for dv-bound widgets.
- **Files modified:** `kinetica_bi/src/components/charts/WidgetRenderer.tsx`
- **Verification:** Existing LIFE-V13-02 spec (`AggregatedWidgetRenderer — LIFE-V13-02 (reactive isViewNotFoundError max-1-retry)` describe block — 4 tests) continues to pass with no changes (those tests don't set `dynamicViewId`). New Phase 35 tests don't depend on the LIFE-V13-02 path.
- **Committed in:** `361c395` (Task 1 GREEN)

**2. [Rule 2 - Missing Critical] Pitfall 4 defense-in-depth (materialized + empty viewName)**
- **Found during:** Task 1 GREEN (implementing the viewName source flip)
- **Issue:** The plan's `<action>` section mentions Pitfall 4 verbatim ("Pitfall 4 lock — defense-in-depth check after status gate: `if (dvStatus === 'materialized' && !dvViewName) return <error-internal />;`") but the literal JSX-return approach is incompatible with the Effect 2 body (effects can't return JSX). The correct integration point is the Effect 2 body: when `dvStatus === "materialized"` but `dvViewName` is empty/null/undefined, set the error state via `setError("Internal error: materialized dynamic view has no viewName")` instead of reaching `fromSwap("", sql)` — which would silently return `sql` unchanged (FROM regex wouldn't match empty string) and runSql would fire against raw FROM table, producing WRONG data with the operator unaware.
- **Fix:** Added the defense-in-depth check inside Effect 2's body right before computing `effectiveViewName`. The setError + early-return short-circuit Effect 2; the existing `error` render gate (`if (error) return ...`) surfaces the message to the operator (fail-loud).
- **Files modified:** `kinetica_bi/src/components/charts/WidgetRenderer.tsx`
- **Verification:** No new test added explicitly for this case (Phase 33 store's setView contract guarantees materialized status always has a populated viewName; this is purely defense-in-depth). Test coverage is the Phase 33 store spec's invariant assertions.
- **Committed in:** `361c395` (Task 1 GREEN)

---

**Total deviations:** 2 auto-fixed (1 blocking-scoping, 1 missing-critical defense-in-depth)
**Impact on plan:** Both deviations are correctness fixes that satisfy the locked plan contracts. Deviation 1 closes a silent-bug case where a dv-bound widget could produce wrong data after a view-not-found error. Deviation 2 implements Pitfall 4's intent in a way that's compatible with React effect semantics (setError + early-return instead of JSX return). No scope creep, no architectural changes, no behavioral surprises for downstream consumers.

## Issues Encountered

- **`wrap` helper signature extension was a quick fixture update** — Phase 30 widgets-required pattern already established the precedent; extending the helper with an optional `retryDynamicView` parameter (default no-op) kept existing call sites compile-clean without per-test updates. 9 existing fixtures across 3 spec files needed `retryDynamicView={() => {}}` added; handled via a single sed pass + one targeted multi-line edit.
- **`DashboardsPage.tsx` was modified by parallel Plan 35-04 commit (`c2e795e`)** — Plan 35-04 (chart-config-panel picker) was running in parallel to this plan. Its commit dropped the underscore prefix from `_retryDynamicView` and added the `retryDynamicView` prop to the `<DashboardContextProvider>` mount — the exact edit this plan's spec required. Net effect: my Plan 35-05 edits to DashboardsPage were absorbed by the Plan 35-04 commit (likely because both plans' wave-3 work shared the same file region). Verified the final state matches the locked spec by inspecting commit `c2e795e`'s diff and the current file state.
- **Pre-existing ChartConfigPanel tsc error during RED phase** — `error TS2339: Property 'tableId' does not exist on type 'DataSourceOption'` was visible during the RED phase but resolved itself before GREEN — Plan 35-04 (parallel) fixed it. Out-of-scope deferred items pattern preserved.

## User Setup Required

None — pure-frontend extension with no env vars, no external service, no schema changes (Plan 35-01 already shipped the schema; this plan consumes Phase 33 store + Plan 35-03 orchestrator client-side only).

## Self-Check: PASSED

Verified via grep + test run:
- `kinetica_bi/src/components/charts/WidgetRenderer.tsx` modified (319-line diff). Confirmed.
- `kinetica_bi/src/components/DashboardContext.tsx` extended with `retryDynamicView`. Confirmed.
- `kinetica_bi/src/components/DashboardContext.spec.tsx` fixtures updated. Confirmed.
- `kinetica_bi/src/components/charts/InfoCardRenderer.spec.tsx` fixture updated. Confirmed.
- `kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx` extended with 15 new tests. Confirmed.
- `kinetica_bi/src/styles/global.css` new CSS classes added. Confirmed.
- Commits `7d62056` (RED), `361c395` (GREEN) found in `git log --oneline`.
- `npx tsc --noEmit` clean (zero errors).
- `npx vitest run` 961/961 passing across 44 test files.
- All 12 acceptance criteria grep gates pass:
  1. `grep -c "useDynamicViewStore" WidgetRenderer.tsx` = 8 (≥ 2 required)
  2. `grep -q "dynamicViewId" WidgetRenderer.tsx` ✓
  3. `grep -q "Too much data — narrow your filters to enable this view" WidgetRenderer.tsx` ✓
  4. `grep -q "This dynamic view was deleted" WidgetRenderer.tsx` ✓
  5. `grep -q "retryDynamicView" WidgetRenderer.tsx` ✓
  6. `grep -q "retryDynamicView" DashboardContext.tsx` ✓
  7. `grep -q 'dvStatus === "pending"' WidgetRenderer.tsx` ✓
  8. `grep -q "isOrphan" WidgetRenderer.tsx` ✓
  9. `grep -q ".widget-over-threshold" global.css` ✓
  10. `grep -q ".widget-orphan-dynamic-view" global.css` ✓
  11. `! grep -q '"warning"' WidgetRenderer.tsx` ✓ (no forbidden toast kind)
  12. Effect 1 dep array verbatim: `grep -n "sql, filterVersion, dashboardId, tableId, spatialFilterVersion" WidgetRenderer.tsx` = line 409 (unchanged from pre-plan state)

## Next Plan Readiness

Wave 3 of Phase 35 (Plans 35-04 chartconfig-picker, 35-05 renderer-status-gates, 35-06 map-renderer-and-layer-picker) is COMPLETE. All three plans landed in parallel without conflicts because they touched disjoint file regions:
- 35-04: ChartConfigPanel.tsx + DashboardsPage.tsx (WidgetConfigModal prop pass-through)
- 35-05: WidgetRenderer.tsx + DashboardContext.tsx + 3 specs + global.css
- 35-06: MapChartRenderer.tsx + KineticaWmsLayerForm.tsx + LayersModal.tsx + specs

Phase 35 SUCCESS CRITERIA closed:
- DV-V16-12 (ChartConfigPanel picker) — closed by Plan 35-04.
- DV-V16-13 (renderer FROM/LAYERS-swap) — closed by Plans 35-05 (AggregatedWidget + RecordsTable) + 35-06 (MapChart per-layer).
- DV-V16-14 (over-threshold empty state) — closed by Plan 35-05 (DV-V16-14 ROADMAP-verbatim message in chart + records-table renderers).

**Ready for Phase 36 (VERIFY-V16-01)** — Phase 36 verifier can attest source-only against the contract or run live UAT against a dashboard with dv-bound widgets.

---
*Phase: 35-widget-binding-and-pipeline*
*Completed: 2026-05-15*
