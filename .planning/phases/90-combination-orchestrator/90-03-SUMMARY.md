---
phase: 90-combination-orchestrator
plan: "03"
subsystem: hooks
tags: [combination-views, orchestrator, ref-count, ceiling, v1.18, frontend-only, filter-selection]

# Dependency graph
requires:
  - phase: 88-foundation-pure-logic-types
    provides: resolveFilterSet, stableComboHash, NOFILTER_SENTINEL, FilterSelectionConfig
  - phase: 89-store-server-foundation
    provides: filterCombinationStore (acquire/release/markMaterializing/setEntry/setVizHash/clearEntry), MAX_COMBINATION_VIEWS_PER_TABLE
  - phase: 90-combination-orchestrator/90-01
    provides: MaterializeFilterArgs.combinationKey, inFlightMaterialize per-combo cache-key
  - phase: 90-combination-orchestrator/90-02
    provides: AuthState.maxCombinationViewsPerTable (ceiling from /api/me env var)
provides:
  - useCombinationOrchestrator(dashboardId, widgets) hook (packages/web/src/hooks/useCombinationOrchestrator.ts)
  - 11-scenario spec covering all COMBO-V118-01/03 requirements (packages/web/src/hooks/useCombinationOrchestrator.spec.ts)
  - DashboardOpen mount point wired (packages/web/src/components/DashboardsPage.tsx)
affects:
  - Phase 91 (WidgetRenderer read-path: will read filterCombinationStore instead of filterViewStore)
  - Phase 92 (MapChartRenderer wiring: reads combination entries from store)
  - Phase 94 (dv-bound combination orchestration: currently skipped via tableId===undefined guard)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dashboard-level orchestrator hook: fires on filterVersion tick, diffs registry, fires one POST per new unique combo, ref-counts with DROP-at-0"
    - "AbortController-per-hash Map with unmount cleanup (mirrors useDynamicViewMaterializeChain pattern)"
    - "widgetsKey stable primitive string dep (useMemo, sorted widget IDs) — prevents array reference instability in Effect deps"
    - "combinationVersion NEVER in Effect dep array — setEntry bumps it, adding it would cause infinite re-fire loop"
    - "DUAL-TRIGGER: orchestrator runs alongside AggregatedWidgetRenderer Effect 1 (combination views have distinct _c<hash8> suffix, no collision)"
    - "Ceiling enforcement: auth-store ceiling fallback to all-filters view + one info toast per table per tick"
    - "NON_TRIGGER_TYPES copied (not imported) from useMapOnlySpatialMaterialize.ts — avoid circular dep risk; extended with radiogroup + calendar"

key-files:
  created:
    - packages/web/src/hooks/useCombinationOrchestrator.ts
    - packages/web/src/hooks/useCombinationOrchestrator.spec.ts
  modified:
    - packages/web/src/components/DashboardsPage.tsx

key-decisions:
  - "DUAL-TRIGGER: orchestrator runs ALONGSIDE AggregatedWidgetRenderer Effect 1 — combination views (_c<hash8> suffix) never collide with legacy views; renderers still read filterViewStore until Phase 91/92 flips the read path"
  - "combinationVersion excluded from Effect deps — this is the no-loop invariant; doc comment in the hook explains why; proven by spec scenario 10"
  - "Ceiling read from useAuthStore(s => s.maxCombinationViewsPerTable) with MAX_COMBINATION_VIEWS_PER_TABLE as fallback — threaded from env var via /api/me (Plan 02)"
  - "NON_TRIGGER_TYPES copied not imported — circular dep risk mitigation; set extended with radiogroup and calendar beyond the useMapOnlySpatialMaterialize original"
  - "vizToHash sync is the authoritative ref-count bind step — acquire/release called per-vizKey hash-change, not per-desired-hash"
  - "Fake timers with shouldAdvanceTime:true required for spec to allow both setTimeout advancement AND waitFor polling"

patterns-established:
  - "Orchestrator diff pattern: enumerate widgets → resolve filter sets → stableComboHash → byTable Map → ceiling enforcement → desired set → diff vs registry → markMaterializing (sync) → materializeFilter (async) → vizToHash sync + acquire/release"
  - "Drop-at-0 caller pattern: capture viewName BEFORE release (entry gone after DROP-at-0), check !registry[hash] after release, then dropCombinationView"
  - "Ceiling toast: one per table per tick, not per widget; kind='info'"

requirements-completed: [COMBO-V118-01, COMBO-V118-03]

# Metrics
duration: 8min
completed: "2026-06-27"
---

# Phase 90 Plan 03: Combination-Orchestrator Hook Summary

**`useCombinationOrchestrator` dashboard-level hook: diff/dispatch with one POST per unique resolved filter combination per filterVersion tick, ref-counted DROP-at-0, per-table ceiling enforcement with all-filters fallback, mounted in DashboardOpen DUAL-TRIGGER alongside legacy Effect 1**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-06-27T23:33:16Z
- **Completed:** 2026-06-27T23:41:36Z
- **Tasks:** 3
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments

- Built `useCombinationOrchestrator(dashboardId, widgets)` — the sole owner of combination-view materializations for the v1.18 per-visualization filter selection feature
- 11-scenario spec green covering: one POST per unique combo, dedup/share with refCount 2, two-distinct-POSTs, refCount-0 DROP, markMaterializing race guard, ceiling cap + fallback + single info toast, NOFILTER skip, combinationVersion-not-in-deps no-loop proof, and unmount-abort
- Mounted in `DashboardsPage.tsx` `DashboardOpen` immediately after `useViewKeepAlive`, alongside all other dashboard-scope chains; renderers are completely untouched (dual-trigger design)

## Task Commits

1. **Task 1: Implement useCombinationOrchestrator** - `1037d5c` (feat)
2. **Task 2: 11-scenario spec** - `102cb23` (test)
3. **Task 3: Mount in DashboardOpen + spec type fixes** - `306186b` (feat)

## Files Created/Modified

- `packages/web/src/hooks/useCombinationOrchestrator.ts` — 405 lines; the dashboard-level orchestrator hook; mirrors useDynamicViewMaterializeChain structure
- `packages/web/src/hooks/useCombinationOrchestrator.spec.ts` — 556 lines; 11-scenario spec; all green
- `packages/web/src/components/DashboardsPage.tsx` — added import + mount call after useViewKeepAlive with dual-trigger comment

## Decisions Made

1. **DUAL-TRIGGER** — orchestrator runs ALONGSIDE AggregatedWidgetRenderer Effect 1. Combination views have a distinct `_c<hash8>` suffix (enforced by the server's `buildFilterViewName` + `comboShort` path), so there is no view-name collision. Renderers remain on the legacy `filterViewStore.views[tableId]` read path until Phase 91/92 swaps them to `filterCombinationStore`.

2. **combinationVersion excluded from Effect deps** — `setEntry` bumps `combinationVersion`; if it were a dep, every successful materialize would re-fire the orchestrator (infinite loop). Proven by spec scenario 10.

3. **NON_TRIGGER_TYPES copied not imported** — copied from `useMapOnlySpatialMaterialize.ts:43` and extended with `"radiogroup"` and `"calendar"` (which WidgetRenderer dispatch never routes to AggregatedWidgetRenderer). Not imported to avoid circular dependency risk.

4. **vizToHash sync is the authoritative bind step** — acquire/release are called per-vizKey hash-change in STEP E, not in STEP D when the desired set is computed. This prevents double-acquire on re-use of an existing hash.

5. **`shouldAdvanceTime: true` in fake timers** — `vi.useFakeTimers({ shouldAdvanceTime: true })` is needed so that `waitFor` can poll (it uses real setTimeout internally) while `advanceTimersByTime(310)` fires the orchestrator's 300ms debounce.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

Minor: Initial spec used `vi.useFakeTimers()` without `shouldAdvanceTime: true`, causing `waitFor` polls to never fire (it uses its own setTimeout internally). Fixed by adding `shouldAdvanceTime: true`. This is the correct pattern for tests that both advance fake time AND wait for async resolution.

Minor: `WidgetDto.position` is `number`, not an object — factory needed `position: 0` not `position: { x, y, w, h }`. TypeScript caught it on the `tsc --noEmit` gate.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `useCombinationOrchestrator` is mounted and operational; on each `filterVersion` tick it materializes combination views (with `_c<hash8>` suffix) that sit in `filterCombinationStore.registry`
- Renderers still read from `filterViewStore.views[tableId]` — Phase 91 (WidgetRenderer Wiring) will flip the read path to `filterCombinationStore.vizToHash[vizKey]` + `registry[hash]`
- The dual-trigger period is intentionally short: Phase 91 retires Effect 1 from individual renderers
- All test gates green: tsc clean, vitest 2878/2878 passed, theme-guard 128/128, zero server diff

## Self-Check

Verified files exist on disk:
- `packages/web/src/hooks/useCombinationOrchestrator.ts` — FOUND
- `packages/web/src/hooks/useCombinationOrchestrator.spec.ts` — FOUND
- Task commits 1037d5c, 102cb23, 306186b — present in git log

## Self-Check: PASSED

---
*Phase: 90-combination-orchestrator*
*Completed: 2026-06-27*
