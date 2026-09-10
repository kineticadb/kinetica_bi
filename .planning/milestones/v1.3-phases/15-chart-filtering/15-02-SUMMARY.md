---
phase: 15-chart-filtering
plan: "02"
subsystem: ui
tags: [react, zustand, vitest, sql, from-swap, filtering, materialize]

# Dependency graph
requires:
  - phase: 15-01
    provides: DashboardContext + useDashboardContext (dashboardId plumbing required at every materialize call site)
  - phase: 14-filter-chips
    provides: useFilterStore (chip state), useFilterViewStore (view names + materializing flag), materializeFilter API, FilterViewEntry type
provides:
  - fromSwap(sql, viewName) regex helper (FROM-swap without WHERE injection)
  - FilteringBadge component with scoped Zustand selector + CSS keyframe spinner
  - FilterViewEntry.dashboardId extension (foundation for 15-05 cleanup loops)
  - AggregatedWidgetRenderer fully wired: 300ms debounced materialize trigger + FROM-swap + separate materializeAbortRef
  - Dead-code deletion: escapeKineticaStringLiteral, buildEqualityFilter, buildWhereClause, injectWhereClause removed from filterStore.ts
  - MapChartRenderer migrated off buildWhereClause (Phase 16 TODO stub)
affects: [15-03, 15-04, 15-05, MapChartRenderer-phase-16]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - FROM-swap regex replaces FROM <table> with FROM <viewName> (no WHERE injection in SQL strings)
    - Separate materializeAbortRef (V13-P-10 lock) — aborting materialize does not abort chart query
    - markMaterializing → await materializeFilter → setView pattern with 300ms debounce
    - Scoped Zustand selector (s.views[tableId]?.materializing) to isolate badge re-renders (PITFALL C-02)
    - dashboardId threaded from useDashboardContext() to every materializeFilter / setView call

key-files:
  created:
    - kinetica_bi/src/lib/fromSwap.ts
    - kinetica_bi/src/lib/fromSwap.spec.ts
    - kinetica_bi/src/components/FilteringBadge.tsx
    - kinetica_bi/src/components/FilteringBadge.spec.tsx
  modified:
    - kinetica_bi/src/store/filterViewStore.ts
    - kinetica_bi/src/store/filterViewStore.spec.ts
    - kinetica_bi/src/components/charts/WidgetRenderer.tsx
    - kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx
    - kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx
    - kinetica_bi/src/store/filterStore.ts
    - kinetica_bi/src/store/filterStore.spec.ts
    - kinetica_bi/src/styles/global.css
    - kinetica_bi/src/components/DashboardsPage.tsx

key-decisions:
  - "FROM-swap replaces WHERE injection entirely — SQL stays structurally clean, server-side escaping maintained (Option A in Critical Pitfall 1)"
  - "MapChartRenderer buildWhereClause callsites stubbed to empty string with Phase 16 TODO — avoids dead-code import but defers full map-filter wiring"
  - "materializeAbortRef kept strictly separate from chart-query AbortController (V13-P-10 lock) to prevent cross-abort races"
  - "Exact-duplicate add in useFilterStore is silent no-op (no version bump) — click selected = stay selected UX"
  - "dashboardId added to FilterViewEntry now (15-02) not 15-05 — avoids retrofit cost for cleanup loops"

patterns-established:
  - "FROM-swap pattern: fromSwap(sql, viewName) — zero overhead when viewName falsy, replaces only first FROM match"
  - "Separate AbortController per concern: one for materialize, one for chart query — never share"
  - "FilteringBadge: scoped selector s.views[tableId]?.materializing ?? false — renders null when not materializing, badge span when true"
  - "vi.clearAllMocks() in beforeEach at top level prevents vi.fn() call-count accumulation across tests"

requirements-completed: [FILT-V13-01, FILT-V13-03, FILT-V13-04, FILT-V13-05]

# Metrics
duration: 274min
completed: 2026-05-06
---

# Phase 15 Plan 02: Materialize Trigger + FROM-swap + FilteringBadge Summary

**AggregatedWidgetRenderer wired end-to-end with 300ms debounced materialize trigger, FROM-swap SQL rewrite via `fromSwap()`, and scoped "Filtering..." badge; four dead utility functions atomically deleted from filterStore.ts**

## Performance

- **Duration:** ~274 min
- **Started:** 2026-05-06T21:30:00Z
- **Completed:** 2026-05-06T22:03:00Z
- **Tasks:** 6
- **Files modified:** 14 (4 created, 10 modified)

## Accomplishments

- `fromSwap(sql, viewName)` regex helper created with 9-case spec (happy path, falsy viewName variants, schema-qualified names, case-insensitive FROM, first-FROM-only)
- `FilteringBadge` component created with scoped `s.views[tableId]?.materializing` selector, CSS keyframe spinner, and 8-test spec covering null states, render states, a11y, and selector isolation
- `FilterViewEntry.dashboardId` added to filterViewStore; setView and markMaterializing signatures extended; 21 filterViewStore tests updated and passing
- AggregatedWidgetRenderer rewritten: Effect 1 (materialize trigger with 300ms debounce, markMaterializing → await materializeFilter → setView), Effect 2 (fromSwap replaces WHERE injection, deps `[sql, filterVersion, viewName]`), separate `materializeAbortRef` (V13-P-10 lock), toast routing on PermissionError/UpstreamError/generic Error
- Dead-code deletion: `escapeKineticaStringLiteral`, `buildEqualityFilter`, `buildWhereClause`, `injectWhereClause` atomically deleted from filterStore.ts + matching spec blocks removed; `tsc --noEmit` clean
- MapChartRenderer migrated off `buildWhereClause` to empty `whereClause = ""` with Phase 16 TODO tags at both callsites

## Task Commits

Each task was committed atomically:

1. **Task 1: fromSwap helper** - `c5c28da` (feat)
2. **Task 2: FilteringBadge + CSS** - `f544430` (feat)
3. **Task 3: filterViewStore dashboardId extension** - `7b64771` (feat)
4. **Task 4: MapChartRenderer migration** - `96ebab6` (fix)
5. **Task 5: filterStore dead-code deletion** - `55feee0` (chore)
6. **Task 6: AggregatedWidgetRenderer + DashboardsPage + WidgetRenderer.spec** - `c7a8bea` (feat)

## Files Created/Modified

- `kinetica_bi/src/lib/fromSwap.ts` — FROM-swap regex helper, zero overhead when viewName falsy
- `kinetica_bi/src/lib/fromSwap.spec.ts` — 9 test cases
- `kinetica_bi/src/components/FilteringBadge.tsx` — Scoped materializing badge with CSS spinner
- `kinetica_bi/src/components/FilteringBadge.spec.tsx` — 8 test cases
- `kinetica_bi/src/store/filterViewStore.ts` — dashboardId field added to FilterViewEntry; setView/markMaterializing signatures extended
- `kinetica_bi/src/store/filterViewStore.spec.ts` — All calls updated; 5 new dashboardId tests added (21 total)
- `kinetica_bi/src/components/charts/WidgetRenderer.tsx` — AggregatedWidgetRenderer rewritten with Effect 1 (materialize) + Effect 2 (fromSwap)
- `kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx` — vi.clearAllMocks fix; wrap() helper; 4 new describe blocks; 16 tests
- `kinetica_bi/src/components/charts/MapChartRenderer.tsx` — Both buildWhereClause callsites migrated to empty string stubs
- `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` — buildWhereClause/injectWhereClause mock entries removed
- `kinetica_bi/src/store/filterStore.ts` — 4 utility functions deleted (lines 104-195)
- `kinetica_bi/src/store/filterStore.spec.ts` — Matching 4 describe blocks deleted; imports updated
- `kinetica_bi/src/styles/global.css` — .widget-filtering-badge, .widget-filtering-spinner, @keyframes filtering-spin appended
- `kinetica_bi/src/components/DashboardsPage.tsx` — FilteringBadge import + render in widget card header

## Decisions Made

- **FROM-swap replaces WHERE injection entirely.** SQL strings stay structurally clean; server-side escaping is maintained. The deleted buildWhereClause/injectWhereClause approach was SQL-in-strings with client-side escaping — a security downgrade vs. the materialized view approach.
- **MapChartRenderer Option A (empty stub).** Migrated both buildWhereClause callsites to `const whereClause = ""` with explicit Phase 16 TODO tags rather than importing a new helper prematurely. Avoids dead-code import, keeps the map chart in a known-working state.
- **materializeAbortRef strictly separate from chart-query AbortController** (V13-P-10 lock). A shared AbortController would cancel the chart query when a filter change aborts a stale materialize — unacceptable UX.
- **dashboardId added in 15-02, not 15-05.** The cleanup loops in 15-05 need dashboardId on FilterViewEntry. Retrofit at that stage would touch filterViewStore, setView call sites, and markMaterializing call sites — a high-cost change. Added now with minimal delta.
- **vi.clearAllMocks() in global beforeEach** (not afterEach or vi.restoreAllMocks). vi.fn() instances created by vi.mock() are persistent — restoreAllMocks does not clear call counts. clearAllMocks() before each test prevents accumulation across tests.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed vi.fn() cross-test call-count contamination in WidgetRenderer.spec.tsx**
- **Found during:** Task 6 (WidgetRenderer wiring)
- **Issue:** vi.mock("../../api/client", ...) creates persistent vi.fn() instances. Without clearing, call counts from earlier tests accumulated — e.g., materializeFilter "called 1 time" assertion failed with "called 4 times" when tests ran in sequence.
- **Fix:** Added `beforeEach(() => { vi.clearAllMocks(); })` at the top level of WidgetRenderer.spec.tsx. This clears all mock call histories before each test without restoring spies.
- **Files modified:** kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx
- **Verification:** Ran the failing test in isolation (passed) confirming cross-test contamination; full suite 283/283 after fix.
- **Committed in:** c7a8bea (Task 6 commit)

**2. [Rule 1 - Bug] Updated FILT-02 WHERE-clause test assertions to match FROM-swap reality**
- **Found during:** Task 6 (WidgetRenderer wiring)
- **Issue:** Existing FILT-02 tests asserted `expect(runSql).toHaveBeenCalledWith(expect.stringContaining("WHERE"))` — WHERE injection is eliminated in Phase 15-02, so these assertions were now incorrect.
- **Fix:** Updated FILT-02 tests to verify filterVersion-driven re-fetches instead of WHERE clause content. The isolation guarantee (widget SQL never contains another table's filter value) still holds via FROM-swap scoping.
- **Files modified:** kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx
- **Verification:** 16 WidgetRenderer tests passing.
- **Committed in:** c7a8bea (Task 6 commit)

---

**Total deviations:** 2 auto-fixed (2 Rule 1 - bugs)
**Impact on plan:** Both auto-fixes necessary for test correctness. No scope creep.

## Issues Encountered

- **Orphan scan (grep for deleted symbols)** found references to `buildWhereClause` in MapChartRenderer.tsx and `buildEqualityFilter` in WidgetRenderer.tsx after deletion. Analysis confirmed these were doc comment references only (AP-3 comments describing old approach), not production imports or function calls. No action required.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 15-03 (filter bar UI) can proceed: AggregatedWidgetRenderer materialize trigger is live, fromSwap is available, FilteringBadge is mounted
- 15-05 (cleanup loops) can proceed: FilterViewEntry.dashboardId is present at every call site
- MapChartRenderer: Phase 16 TODO stubs are clearly tagged at both callsites — no ambiguity about what remains

---
*Phase: 15-chart-filtering*
*Completed: 2026-05-06*

## Self-Check: PASSED

All 5 created files found on disk. All 6 task commits verified in git log.
