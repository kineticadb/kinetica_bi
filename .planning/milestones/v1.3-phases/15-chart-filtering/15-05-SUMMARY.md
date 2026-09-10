---
phase: 15-chart-filtering
plan: "05"
subsystem: ui
tags: [react, zustand, vitest, lifecycle, filter-view, cleanup, logout, dashboard-switch]

# Dependency graph
requires:
  - phase: 15-02
    provides: FilterViewEntry.dashboardId extension (populated by setView/markMaterializing callers — enables cleanup loops to fire-and-forget DROPs without external lookups)
  - phase: 15-04
    provides: dropFilterView API helper (client.ts) — used by logout + dashboard-switch cleanup loops
provides:
  - App.tsx logout effect: snapshot active views, fire-and-forget DROP for each entry.dashboardId/tableId, reset both filterViewStore + filterStore (LIFE-V13-03)
  - DashboardsPage.tsx dashboard-switch cleanup: same snapshot-loop-DROP-reset pattern (LIFE-V13-04)
  - App.spec.tsx LIFE-V13-03 describe block: 5 new test cases for logout cleanup behavior
  - DashboardsPage.spec.tsx: new file with 5 tests for dashboard-switch cleanup behavior + smoke test
  - LIFE-V13-05 acknowledged as no-op: page-refresh/tab-close cleanup handled solely by Kinetica 5-min sliding TTL
affects: [phase-16-map-layers, phase-17-e2e]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - snapshot-loop-DROP-reset: snapshot views BEFORE reset (loop reads entry.dashboardId), fire-and-forget DROP .catch(() => {}), then reset filterViewStore, then reset filterStore
    - V13-P-12 fire-and-forget: DROP errors silently swallowed on session boundary (user is logging out/switching; nothing to surface)
    - entry.dashboardId sourced from FilterViewEntry (15-02 schema extension) — no current-dashboard derivation needed; correct for edge cases where stale views persist

key-files:
  created:
    - kinetica_bi/src/components/DashboardsPage.spec.tsx
  modified:
    - kinetica_bi/src/App.tsx
    - kinetica_bi/src/App.spec.tsx
    - kinetica_bi/src/components/DashboardsPage.tsx

key-decisions:
  - "V13-P-12 lock: fire-and-forget .catch(() => {}) is the sole error handler — no toast on logout/dashboard-switch DROP failures; user is leaving, nothing to surface"
  - "entry.dashboardId not current-dashboard.id: cleanup loop reads dashboardId directly from each FilterViewEntry, defensive against state races where stale views from a prior dashboard persist"
  - "LIFE-V13-05 acknowledged no-op: page-refresh/tab-close cleanup is entirely delegated to Kinetica 5-min sliding TTL; no client-side beforeunload handler needed or implemented"
  - "DashboardsPage.spec.tsx uses direct cleanup-logic invocation: DashboardOpen is an internal component; driving its useEffect cleanup via full render tree requires navigating into open view (heavy mock setup); pragmatic direct invocation per CONTEXT.md spec scope"
  - "App.spec.tsx extended not replaced: existing Phase 7 UX-06 tests preserved; top-level vi.mock extended to add dropFilterView stub alongside existing UNAUTHORIZED_EVENT re-export"

patterns-established:
  - "snapshot-loop-reset ordering: views snapshot → DROP loop (fire-and-forget) → filterViewStore.reset() → filterStore.reset() — views first, then chips; ordering is locked"
  - "Direct cleanup-logic invocation in tests: when internal component cleanup is tested directly, mirror production code exactly; assertions validate logic is correct"

requirements-completed: [LIFE-V13-03, LIFE-V13-04, LIFE-V13-05]

# Metrics
duration: 5min
completed: 2026-05-07
---

# Phase 15 Plan 05: Lifecycle Reset Extensions Summary

**Logout and dashboard-switch lifecycle effects extended with snapshot-loop-DROP-reset pattern: fire-and-forget dropFilterView for each active FilterViewEntry.dashboardId, then reset both filterViewStore and filterStore**

## Performance

- **Duration:** 5 min
- **Started:** 2026-05-07T02:20:36Z
- **Completed:** 2026-05-07T02:25:39Z
- **Tasks:** 4
- **Files modified:** 4 (2 extended, 1 extended, 1 created)

## Accomplishments

- `App.tsx` logout effect (LIFE-V13-03): snapshot `useFilterViewStore.getState().views`, iterate keys, fire-and-forget `dropFilterView({ dashboardId: entry.dashboardId, tableId }).catch(() => {})`, then `useFilterViewStore.getState().reset()`, then `useFilterStore.getState().reset()`
- `DashboardsPage.tsx` dashboard-switch cleanup (LIFE-V13-04): identical snapshot-loop-DROP-reset pattern inside the `return () => { ... }` cleanup of the `[dashboard.id]` dep-array effect
- `App.spec.tsx` extended with 5 new LIFE-V13-03 test cases (16 total): DROP-loop call args per entry.dashboardId, double-store reset, fire-and-forget error swallow, no-trigger on no-status-change, empty-views handling
- `DashboardsPage.spec.tsx` created with 5 test cases (LIFE-V13-04): same behaviors via direct cleanup-logic invocation + smoke-test DashboardsPage mount
- LIFE-V13-05 explicitly acknowledged as no-op: page-refresh/tab-close cleanup delegated to Kinetica 5-min sliding TTL; no client implementation needed
- Full vitest suite: 318 tests passing, zero regressions to 15-02, 15-03, 15-04, or any prior phase specs
- tsc --noEmit: clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend App.tsx logout effect** - `5a36594` (feat)
2. **Task 2: Create App.spec.tsx LIFE-V13-03 tests** - `0a278d1` (test)
3. **Task 3: Extend DashboardsPage.tsx dashboard-switch cleanup** - `dd5aac6` (feat)
4. **Task 4: Create DashboardsPage.spec.tsx** - `ffc6b35` (test)

## Files Created/Modified

- `kinetica_bi/src/App.tsx` — Logout effect: imports useFilterViewStore + dropFilterView; snapshot-loop-DROP then reset both stores (LIFE-V13-03)
- `kinetica_bi/src/App.spec.tsx` — Extended with LIFE-V13-03 describe block (5 new tests); top-level vi.mock extended to include dropFilterView stub
- `kinetica_bi/src/components/DashboardsPage.tsx` — Dashboard-switch cleanup: imports useFilterViewStore + dropFilterView; snapshot-loop-DROP then reset both stores (LIFE-V13-04)
- `kinetica_bi/src/components/DashboardsPage.spec.tsx` — New file; 5 tests (LIFE-V13-04) + smoke test

## Decisions Made

- **V13-P-12 fire-and-forget lock enforced.** `.catch(() => {})` is the sole error handler at both sites. Awaiting the DROP loop would block logout UX on slow networks; toasting an error when the user is logging out or switching dashboards is wrong UX.
- **entry.dashboardId not current-dashboard.id.** The cleanup loop reads `entry.dashboardId` from each stored `FilterViewEntry` rather than deriving from a current dashboard. This is correct (handles edge cases where stale views from a prior dashboard persist in the store) and avoids the Pitfall 5 trap described in 15-RESEARCH.md.
- **LIFE-V13-05 acknowledged no-op.** Page-refresh / tab-close: Kinetica's 5-min sliding TTL is the sole cleanup mechanism. No `beforeunload` handler is registered. Documented only.
- **DashboardsPage.spec.tsx uses direct invocation.** DashboardOpen is an internal component not exported from DashboardsPage. Driving its useEffect cleanup via a full rendered tree requires mocking `listDashboards` to return at least one entry, clicking into open view, then triggering unmount — heavy setup for one assertion. Direct invocation of the cleanup logic validates correctness; smoke test validates mount.
- **App.spec.tsx extended not replaced.** The existing Phase 7 UX-06 tests cover UNAUTHORIZED_EVENT and returnTo sessionStorage behavior. The LIFE-V13-03 describe block is appended without modifying the existing tests. The top-level vi.mock is extended to add `dropFilterView: vi.fn(...)` alongside the existing spread.

## Deviations from Plan

None — plan executed exactly as written. The minor deviation of extending rather than replacing App.spec.tsx is consistent with the plan's instruction to create focused integration coverage without disrupting existing specs.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Phase 15 complete:** All 10 requirement IDs covered across plans 15-01 through 15-05 (FILT-V13-01..05 + LIFE-V13-01..05)
- **Phase 16 (map LAYERS-swap):** MapChartRenderer.tsx has 2 callsites with `// Phase 16 TODO` tags from 15-02; wmsUrlBuilder.ts QUERY/FILTER_PARAM block + wmsUrlBuilder.spec.ts FILT-04 block are the next milestone work targets; FilterViewEntry.dashboardId schema and FROM-swap pattern conventions are available
- **Phase 17 (e2e verification):** End-to-end walk of FROM-swap pipeline; UAT against deployed Kinetica; OIDC S2.b live DDL re-probe deferred from Phase 13; DashboardsPage.spec.tsx full open-flow testing (list → open → dashboard-switch) is a candidate if the indirect invocation approach is judged insufficient in Phase 17

---
*Phase: 15-chart-filtering*
*Completed: 2026-05-07*
