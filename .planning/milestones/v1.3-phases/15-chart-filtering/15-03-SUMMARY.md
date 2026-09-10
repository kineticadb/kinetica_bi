---
phase: 15-chart-filtering
plan: "03"
subsystem: ui
tags: [react, zustand, vitest, sql, from-swap, filtering, pure-consumer]

# Dependency graph
requires:
  - phase: 15-02
    provides: useFilterViewStore import in WidgetRenderer.tsx + DashboardsPage FilteringBadge mount + AggregatedWidgetRenderer materialize trigger
  - phase: 14-filter-chips
    provides: useFilterViewStore (view names + materializing flag), FilterViewEntry type
provides:
  - RecordsTableRenderer with viewName scoped selector + fromSource FROM-swap on page-fetch + total-count SQL
  - Total-count effect dep array widened to [table, viewName] (Pitfall 7 resolution)
  - V13-LIMIT-01 inline comment documenting records-table-only-dashboard limitation
  - FILT-V13-02 test suite (5 cases) for RecordsTableRenderer pure-consumer behavior
affects: [15-04, 15-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Pure consumer pattern — RecordsTableRenderer reads viewName but never calls materializeFilter/dropFilterView
    - fromSource = viewName ?? table inline — zero-overhead fall-through when no view active
    - Total-count effect dep array includes viewName — narrows count on filter activation (Pitfall 7 lock)

key-files:
  created: []
  modified:
    - kinetica_bi/src/components/charts/WidgetRenderer.tsx
    - kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx
  unchanged:
    - kinetica_bi/src/components/DashboardsPage.tsx

key-decisions:
  - "RecordsTableRenderer is a PURE consumer — no materializeFilter/dropFilterView calls (VSTORE-V13-02 lock)"
  - "fromSource = viewName ?? table inline (not via fromSwap helper) — direct template literal inside each effect is clearer and matches the plan pattern"
  - "Total-count dep array widened to [table, viewName] not [table] — Pitfall 7: count effect was firing only on table change, not on viewName change, so count stayed at raw-table size after filter activation"
  - "V13-LIMIT-01 documented inline: records-table-only dashboard has no filtering until v1.4 (accepted per VSTORE-V13-02 / FILT-V13 lock)"
  - "Tests adapted from plan to use clientModule.runSql pattern — consistent with rest of spec file which imports via import * as clientModule"

requirements-completed: [FILT-V13-02]

# Metrics
duration: 15min
completed: 2026-05-07
---

# Phase 15 Plan 03: RecordsTableRenderer FROM-swap pure consumer (FILT-V13-02) Summary

**RecordsTableRenderer wired as pure FROM-swap consumer of useFilterViewStore.views[tableId]?.viewName — both page-fetch and COUNT(*) SQL substitute viewName when active; total-count dep array widened from [table] to [table, viewName] per Pitfall 7 lock**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-07T02:05:00Z
- **Completed:** 2026-05-07T02:09:56Z
- **Tasks:** 2
- **Files modified:** 2 (0 created, 2 modified)

## Accomplishments

- `RecordsTableRenderer` extended with 4 surgical edits: (1) scoped viewName selector from useFilterViewStore, (2) fromSource variable in page-fetch effect replacing FROM ${table}, (3) viewName added to page-fetch dep array, (4) fromSource in total-count effect + dep array widened to [table, viewName]
- V13-LIMIT-01 inline comment added documenting pure-consumer lock and records-table-only-dashboard accepted limitation
- New `WidgetRenderer.spec.tsx` describe block "RecordsTableRenderer — FILT-V13-02" with 5 test cases: raw table fall-through, page FROM-swap, COUNT FROM-swap, count re-fires on viewName change (Pitfall 7), pure-consumer assertion (no materializeFilter/dropFilterView)
- tsc clean; 288/288 vitest tests pass; AggregatedWidgetRenderer 15-02 tests unaffected

## Task Commits

1. **Task 1: RecordsTableRenderer viewName selector + fromSource + dep arrays** - `36f3a5b` (feat)
2. **Task 2: FILT-V13-02 test suite describe block** - `29069b3` (test)

## Files Created/Modified

- `kinetica_bi/src/components/charts/WidgetRenderer.tsx` — RecordsTableRenderer: viewName selector (V13-LIMIT-01 comment), fromSource in page-fetch SQL + dep array, fromSource in COUNT SQL + dep array widened
- `kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx` — 5 new tests in "RecordsTableRenderer — FILT-V13-02" describe block; makeRecordsWidget factory
- `kinetica_bi/src/components/DashboardsPage.tsx` — BYTE-UNCHANGED (FilteringBadge already mounted in 15-02)

## Decisions Made

- **RecordsTableRenderer pure consumer lock holds.** No materializeFilter or dropFilterView calls added. The materialize trigger lives exclusively in AggregatedWidgetRenderer (shipped 15-02). VSTORE-V13-02 constraint enforced.
- **fromSource = viewName ?? table inline.** Used direct template literal substitution (`const fromSource = viewName ?? table`) inside each effect, rather than calling the `fromSwap()` helper. This matches the plan spec pattern and keeps the intent clear — fromSource is a simple fallback, not a regex operation.
- **Total-count dep array widened.** Changed from `[table]` to `[table, viewName]`. This is the Pitfall 7 resolution from 15-RESEARCH.md: without viewName in the dep array, the COUNT(*) query would not re-fire when a filter was activated, leaving the pagination count at the unfiltered table size even after the view materialized.
- **Tests use clientModule pattern.** Adapted plan's `(runSql as ReturnType<typeof vi.fn>)` references to `(clientModule.runSql as ReturnType<typeof vi.fn>)` — consistent with existing spec file convention; no additional imports needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Adapted test mock references from bare runSql to clientModule.runSql**
- **Found during:** Task 2 (test authoring)
- **Issue:** Plan's test code referenced `runSql`, `materializeFilter`, `dropFilterView` as bare names, but spec file only imports `import * as clientModule from "../../api/client"`. Direct name references would cause runtime ReferenceErrors.
- **Fix:** Changed all `(runSql as ReturnType<typeof vi.fn>)` to `(clientModule.runSql as ReturnType<typeof vi.fn>)` etc. Semantically identical — both reference the same vi.fn() mock instance.
- **Files modified:** kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx
- **Verification:** All 5 new tests pass.

**2. [Rule 2 - Missing critical functionality] Added beforeEach reset in new describe block**
- **Found during:** Task 2 (test authoring)
- **Issue:** Plan's describe block included `beforeEach(() => { (runSql as ...).mockReset(); })` only; store reset was missing. Without `useFilterViewStore.getState().reset()`, seeded views from one test would leak into the next.
- **Fix:** Added `useFilterStore.getState().reset()` and `useFilterViewStore.getState().reset()` to the describe-local beforeEach alongside mockReset.
- **Files modified:** kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx
- **Verification:** Tests pass in isolation and in sequence without store contamination.

---

**Total deviations:** 2 auto-fixed (1 Rule 1 — bug, 1 Rule 2 — missing test isolation)
**Impact on plan:** Both auto-fixes necessary for test correctness. No scope creep.

## Known Limitation: V13-LIMIT-01

Records-table-only dashboards (no AggregatedWidgetRenderer on the same tableId) will not activate filtering in v1.3. The materialize trigger lives only in AggregatedWidgetRenderer. This is accepted per v1.3 scope lock (VSTORE-V13-02 / FILT-V13). Phase 17 verification will surface if this bites users. The limitation is documented via inline comment in RecordsTableRenderer.

## Next Phase Readiness

- **15-04 (TTL recovery):** Both AggregatedWidgetRenderer and RecordsTableRenderer now have viewName selectors + chart/page-fetch effects that use fromSource. TTL recovery (proactive expiresAt check + reactive isViewNotFoundError retry) extends both effects uniformly.
- **15-05 (lifecycle cleanup):** No dependency on 15-03. DashboardsPage App.tsx lifecycle uses FilterViewEntry.dashboardId (shipped 15-02) for cleanup loops — 15-03 changes are orthogonal.
- **DashboardsPage.tsx:** FilteringBadge mount inherited from 15-02 — records widgets already show the badge when AggregatedWidgetRenderer triggers materialize on the same tableId.

## Self-Check: PASSED
