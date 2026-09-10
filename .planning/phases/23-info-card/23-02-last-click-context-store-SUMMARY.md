---
phase: 23-info-card
plan: 02
subsystem: ui
tags: [react, zustand, openlayers, info-popup, info-card, lifecycle-reset]

# Dependency graph
requires:
  - phase: 20-info-selection-store
    provides: three-store reset block (filterViewStore -> filterStore -> infoSelectionStore) at App.tsx UNAUTHORIZED + DashboardsPage.tsx DashboardOpen cleanup; canonical sibling-slice pattern
  - phase: 21-popup-component
    provides: MapChartRenderer.tsx singleclick handler with EPSG:3857 -> EPSG:4326 transform, getInfoRadiusPx, eligibleLayers fan-out
provides:
  - useLastInfoClickContextStore Zustand sibling slice (LastInfoClickContext type with 7 fields, setContext + reset actions)
  - MapChartRenderer.tsx click-handler write site (before fan-out loop, captures clickLon/clickLat/mapBbox/mapWidthPx/mapHeightPx/radiusPx/sourceWidgetId)
  - Four-store reset block (extends Phase 20-02's three-store block) at App.tsx UNAUTHORIZED + DashboardsPage.tsx DashboardOpen cleanup
affects: [23-03-info-card-renderer, future Info Card consumers needing replay-fetch coords]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sibling Zustand slice pattern (Strategy B from 23-RESEARCH.md Q1) — minimal shape mirrored on dashboardLayersStore.ts; ships LIVE not dormant; MapChartRenderer is immediate writer, Plan 23-03 InfoSelectionView is reader"
    - "Four-store reset block — canonical order filterViewStore -> filterStore -> infoSelectionStore -> lastInfoClickContextStore at the same two lifecycle sites (extends Phase 20-02 three-store block)"
    - "Mirror-write Zustand mock for spec — setContext mock impl writes to .context so tests can assert via either spy calls or current state"

key-files:
  created:
    - kinetica_bi/src/store/lastInfoClickContextStore.ts (55 lines — type + slice with 2 actions)
    - kinetica_bi/src/store/lastInfoClickContextStore.spec.ts (76 lines — 6 tests covering L1-L6)
  modified:
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx (import + setContext call at line 732, before fan-out loop)
    - kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx (mock + reset block + LCC1/LCC2 tests)
    - kinetica_bi/src/App.tsx (import + fourth reset call at line 64)
    - kinetica_bi/src/App.spec.tsx (extended ALL THREE -> ALL FOUR test + Pitfall 1 regression test)
    - kinetica_bi/src/components/DashboardsPage.tsx (import + fourth reset call at line 406)
    - kinetica_bi/src/components/DashboardsPage.spec.tsx (extended ALL THREE -> ALL FOUR test)

key-decisions:
  - "Strategy B (sibling slice) over Strategy A (extend useInfoSelectionStore would break Phase 20 store-shape lock) and Strategy C (find a primary mapRef, no precedent)"
  - "setContext fires UNCONDITIONALLY before fan-out loop — even when all layers fail/abort, the click happened and coords are valid context (Pitfall 2 lock from 23-RESEARCH.md)"
  - "Fourth reset added immediately after useInfoSelectionStore.getState().reset() at both sites, in canonical order — Pitfall 1 lock prevents stale dashboard-A coords surviving dashboard-B switch"
  - "widget.id (top-level prop, stable across renders) used as sourceWidgetId — not added to Effect 6 dep array because lifetime-stable"
  - "Spec-level mock mirror-writes setContext to .context so LCC1/LCC2 can assert both spy calls AND current state"
  - "L6 (compile-time) test uses @ts-expect-error to enforce the 7-field requirement at type level"

patterns-established:
  - "Pattern 1: Sibling Zustand slice for cross-component replay state — when a consumer (Info Card) needs to replay context that was captured at a different mount point (MapChartRenderer), a dedicated slice is preferred over either extending an existing store-shape lock or recomputing from a non-existent ref"
  - "Pattern 2: Lifecycle-reset block extension — adding a new sibling slice to the canonical reset block requires updating BOTH App.tsx UNAUTHORIZED handler and DashboardsPage.tsx DashboardOpen cleanup, plus their respective spec files (extending ALL THREE -> ALL FOUR test names)"
  - "Pattern 3: Mock mirror-write for spy + state assertions — when a test needs to verify both that a setter was called AND that the resulting state is correct, the mock implementation should both record the call (vi.fn()) and write to the shared module-level state object"

requirements-completed:
  - CARD-V14-02

# Metrics
duration: 9min
completed: 2026-05-09
---

# Phase 23 Plan 02: Last-Click Context Store Summary

**Sibling Zustand slice `useLastInfoClickContextStore` capturing the most-recent map click's spatial context (clickLon/clickLat/mapBbox/mapWidthPx/mapHeightPx/radiusPx/sourceWidgetId), wired LIVE into MapChartRenderer's singleclick handler before fan-out, with four-store reset block at App.tsx UNAUTHORIZED + DashboardsPage DashboardOpen cleanup.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-05-09T21:24:36Z (approx — plan executor session start)
- **Completed:** 2026-05-09T21:33:21Z
- **Tasks:** 3 (all TDD)
- **Files modified:** 8 (2 created, 6 modified)

## Accomplishments

- New sibling slice `useLastInfoClickContextStore` mirrors `dashboardLayersStore.ts` minimal shape; `LastInfoClickContext` type with all 7 contractual fields exported; setContext (replace-semantics) + reset actions
- MapChartRenderer.tsx singleclick handler writes context UNCONDITIONALLY on every info-enabled click, BEFORE the eligibleLayers fan-out loop — even when all layers fail/abort, the spatial context is still captured for Plan 23-03 replay
- Four-store reset block extends Phase 20-02's three-store block at the same two lifecycle sites — Pitfall 1 closed (stale dashboard-A coords cannot leak into dashboard-B)
- Spec coverage: 6 store tests + 2 click-handler tests (LCC1 complete-payload assertion; LCC2 write-before-fan-out under all-error path) + 1 Pitfall 1 regression test in App.spec.tsx
- Full regression: 32 vitest files / 479 tests passing; tsc --noEmit clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Create useLastInfoClickContextStore slice + spec** — `29f4e93` (feat)
2. **Task 2: Wire MapChartRenderer.tsx singleclick handler to write context** — `ccf856c` (feat)
3. **Task 3: Extend three-store reset block to four-store at App + DashboardsPage** — `91db88a` (feat)

**Plan metadata commit:** _to be added in final commit step_

## Files Created/Modified

- `kinetica_bi/src/store/lastInfoClickContextStore.ts` (created, 55 lines) — Zustand slice with 7-field LastInfoClickContext type, setContext + reset actions; cite-locks-inline JSDoc style mirroring infoSelectionStore.ts
- `kinetica_bi/src/store/lastInfoClickContextStore.spec.ts` (created, 76 lines) — 6 tests covering initial state, setContext write, replace-semantics, reset, key-shape sanity, compile-time type contract
- `kinetica_bi/src/components/charts/MapChartRenderer.tsx` (modified) — added import (line 54) + setContext call (line 732, after radiusPx resolution at line 724, before fan-out loop at line 743)
- `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` (modified) — added module-level `_lastInfoClickContextState` with mirror-write impl, vi.mock factory for the new slice, beforeEach reset, two new tests (LCC1, LCC2) at end of POPUP-V14 describe block
- `kinetica_bi/src/App.tsx` (modified) — added import (line 12) + fourth reset call (line 64) immediately after `useInfoSelectionStore.getState().reset()`
- `kinetica_bi/src/App.spec.tsx` (modified) — extended STORE-V14-04 test from ALL THREE -> ALL FOUR; new Pitfall 1 regression test
- `kinetica_bi/src/components/DashboardsPage.tsx` (modified) — added import (line 26) + fourth reset call (line 406) immediately after `useInfoSelectionStore.getState().reset()`
- `kinetica_bi/src/components/DashboardsPage.spec.tsx` (modified) — extended STORE-V14-03 test from ALL THREE -> ALL FOUR

## Decisions Made

- **Strategy B locked** (sibling slice) — Strategy A (extend useInfoSelectionStore) would have broken the Phase 20 store-shape lock; Strategy C (recompute from a primary mapRef) had no precedent and would have broken dashboard-scoped framing.
- **Write site before fan-out** — Pitfall 2 lock encoded as production behavior: setContext fires unconditionally even when all eligibleLayers fail/abort, because the click happened and the coords are valid context for Plan 23-03's dropdown-switch + Load-more replay.
- **widget.id used as sourceWidgetId** — top-level prop on MapChartRenderer, lifetime-stable; not added to Effect 6 dep array because changing widgets unmount/remount the component anyway.
- **Mock mirror-write for spec assertions** — setContext mock writes the payload to `_lastInfoClickContextState.context` so LCC1/LCC2 can assert via either `setContext.mock.calls[0][0]` OR `_lastInfoClickContextState.context`; mockImplementation re-installed in beforeEach because mockReset clears impl.
- **Reset position locked** — fourth reset call placed immediately after `useInfoSelectionStore.getState().reset()` at both sites, preserving canonical order: filterViewStore -> filterStore -> infoSelectionStore -> lastInfoClickContextStore.

## Deviations from Plan

None - plan executed exactly as written. The plan's `<action>` blocks were precise enough that no auto-fix rules triggered; tsc was clean after each task; full vitest regression passed without intervention.

---

**Total deviations:** 0
**Impact on plan:** Plan executed verbatim. The detailed `<read_first>` and `<action>` blocks (especially the exact import-line + insertion-line specifications and the inline-mock pattern from existing P-tests) eliminated all ambiguity.

## Issues Encountered

None during planned work. Vitest CLI quirk noted: `npm test -- --run lastInfoClickContextStore.spec` failed because the script already passes `--run`; retried with `npm test -- lastInfoClickContextStore.spec` and it worked. (Documented for future task executors but not a deviation since it didn't change the plan.)

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Plan 23-03 (info-card-renderer)** unblocked: `useLastInfoClickContextStore` ships LIVE with a guaranteed writer (MapChartRenderer click) and a guaranteed reset path. Card's `<InfoSelectionView />` will read from this slice for the on-demand fetch (`POST /api/info/query` when `state[newLayerId]` is undefined) and Load-more paths.
- **Pitfall 1 closed**: stale dashboard-A click coords cannot survive a dashboard-B switch or a logout boundary. App.spec.tsx Pitfall 1 regression test asserts this directly.
- **Pitfall 2 closed**: when `context === null` (initial state, post-reset, or before any click), the Plan 23-03 dropdown-switch path will short-circuit per the locked behavior.

## Self-Check: PASSED

Verified:
- `kinetica_bi/src/store/lastInfoClickContextStore.ts` FOUND
- `kinetica_bi/src/store/lastInfoClickContextStore.spec.ts` FOUND
- Commit `29f4e93` FOUND (Task 1: feat — slice + spec)
- Commit `ccf856c` FOUND (Task 2: feat — MapChartRenderer write site)
- Commit `91db88a` FOUND (Task 3: feat — four-store reset block)
- 6 store-spec tests pass; 48 MapChartRenderer.spec tests pass (46 prior + LCC1 + LCC2); 17 App.spec tests pass (16 prior + Pitfall 1); 5 DashboardsPage.spec tests pass; full suite 479/479 across 32 files
- tsc --noEmit clean
- Acceptance criteria for all three tasks satisfied per grep checks

---
*Phase: 23-info-card*
*Completed: 2026-05-09*
