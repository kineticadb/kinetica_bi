---
phase: 20-info-selection-store
plan: 02
subsystem: ui
tags: [zustand, vitest, lifecycle, react, info-popup]

# Dependency graph
requires:
  - phase: 20-01-store-and-spec
    provides: useInfoSelectionStore Zustand slice with reset() action ready for lifecycle wiring
  - phase: 15-dashboard-context
    provides: DashboardOpen cleanup useEffect (LIFE-V13-04 — established two-store reset pattern)
  - phase: 09-filters
    provides: App.tsx UNAUTHORIZED handler (LIFE-V13-03 — established two-store reset pattern)
provides:
  - Three-store reset block at App.tsx UNAUTHORIZED handler (filterViewStore + filterStore + infoSelectionStore) — STORE-V14-04 logout reset complete
  - Three-store reset block at DashboardsPage DashboardOpen cleanup — STORE-V14-03 dashboard-switch reset complete
  - Test coverage in App.spec.tsx asserting all three stores reset on logout (state map + activeLayerId)
  - Test coverage in DashboardsPage.spec.tsx asserting all three stores reset on dashboard-switch (state map + activeLayerId)
affects: [21-info-popup, 22-config-ui, 23-info-card]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Three-store reset block: filterViewStore -> filterStore -> infoSelectionStore canonical order at both lifecycle sites (App.tsx UNAUTHORIZED + DashboardsPage DashboardOpen cleanup)"
    - "Session-only store skips DROP loop: info-selection store has no server-side resource, so reset() is sufficient (no fire-and-forget cleanup needed alongside the call)"

key-files:
  created: []
  modified:
    - kinetica_bi/src/App.tsx
    - kinetica_bi/src/App.spec.tsx
    - kinetica_bi/src/components/DashboardsPage.tsx
    - kinetica_bi/src/components/DashboardsPage.spec.tsx

key-decisions:
  - "Reset call placed AFTER existing two resets in canonical order (filterViewStore -> filterStore -> infoSelectionStore) at both sites — matches v1.3 Phase 15 precedent and eases grep-traceability"
  - "No DROP loop for info-selection store at either site — session-only store (STORE-V14-02 lock); no server-side resource (mat view, persisted row) to clean up; just a Zustand wipe"
  - "Test idiom locked from v1.3: DashboardsPage spec uses direct cleanup-logic invocation (lines 40-47 pattern) rather than render-tree drill — DashboardOpen is internal, full render needs non-empty listDashboards mock; pragmatic path is direct invocation matching what production does"
  - "Test names updated from 'BOTH' to 'ALL THREE' — self-documenting three-store invariant; STORE-V14-03/STORE-V14-04 referenced in test name strings for grep traceability"

patterns-established:
  - "Three-store-reset pattern locked at the two canonical lifecycle sites — Phase 21+ consumers can rely on session-boundary cleanup spanning all selection state (chips, view names, info popup)"

requirements-completed: [STORE-V14-03]

# Metrics
duration: 3min
completed: 2026-05-08
---

# Phase 20 Plan 02: Lifecycle Integration Summary

**useInfoSelectionStore.reset() wired into both canonical lifecycle sites (App.tsx UNAUTHORIZED handler + DashboardsPage DashboardOpen cleanup) alongside the existing two-store reset block, with matching three-store assertions in App.spec and DashboardsPage.spec**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-05-08T13:38:00Z
- **Completed:** 2026-05-08T13:40:46Z
- **Tasks:** 2 (each TDD: RED + GREEN commits)
- **Files modified:** 4 (2 production + 2 spec)

## Accomplishments

- App.tsx UNAUTHORIZED handler now resets three stores (filterViewStore -> filterStore -> infoSelectionStore) in canonical order; logout fully clears info-selection state map + activeLayerId.
- DashboardsPage DashboardOpen cleanup useEffect now resets three stores in canonical order; dashboard switch fully clears info-selection state map + activeLayerId.
- App.spec.tsx test "resets ALL THREE stores after the DROP loop fires (...STORE-V14-04)" — extends prior two-store assertion to seed setSelection + setActiveLayer before logout and assert state === {} + activeLayerId === null.
- DashboardsPage.spec.tsx test "resets ALL THREE stores when cleanup runs (...STORE-V14-03)" — extends prior two-store assertion to seed setSelection + setActiveLayer before cleanup and assert state === {} + activeLayerId === null. Uses the locked direct-invocation idiom (matches production cleanup pattern).
- Affected spec runs: 44/44 pass (16 App + 5 DashboardsPage + 23 infoSelectionStore).
- Full frontend test suite: 383/383 pass — zero new regressions across 27 test files.
- TypeScript clean (`npx tsc --noEmit` exit 0).

## Task Commits

Each task was committed atomically with TDD RED + GREEN ceremony:

1. **Task 1 RED: failing test for App.tsx three-store reset** — `6b56219` (test)
2. **Task 1 GREEN: wire useInfoSelectionStore.reset() into App.tsx UNAUTHORIZED handler** — `3451e29` (feat)
3. **Task 2 RED-equivalent: extend DashboardsPage cleanup test to ALL THREE stores** — `59d22c4` (test)
4. **Task 2 GREEN: wire useInfoSelectionStore.reset() into DashboardOpen cleanup** — `34bd217` (feat)

_Note: Task 2 spec uses the locked test idiom of direct cleanup-logic invocation (DashboardsPage.spec.tsx:40-47 pattern). The spec test passes even before the production change because it directly invokes reset() — but the test asserts the three-store invariant which the production change is required to honor at the DashboardOpen cleanup site._

## Files Created/Modified

- `kinetica_bi/src/App.tsx` (modified line 11 + lines 56-60) — added useInfoSelectionStore import and third reset call in UNAUTHORIZED branch with comment explaining no-DROP-loop rationale (session-only store).
- `kinetica_bi/src/App.spec.tsx` (modified line 10 + lines 230-254) — added useInfoSelectionStore import; replaced "resets BOTH stores" test with "resets ALL THREE stores ... STORE-V14-04" test that seeds setSelection + setActiveLayer and asserts state === {} + activeLayerId === null.
- `kinetica_bi/src/components/DashboardsPage.tsx` (modified line 25 + lines 397-401) — added useInfoSelectionStore import and third reset call in DashboardOpen cleanup return with comment.
- `kinetica_bi/src/components/DashboardsPage.spec.tsx` (modified line 5 + lines 54-79) — added useInfoSelectionStore import; replaced "resets BOTH stores" test with "resets ALL THREE stores ... STORE-V14-03" test using direct-invocation idiom.

## Decisions Made

All decisions were locked in 20-CONTEXT.md § "Lifecycle reset wiring scope" before execution. Plan 20-02 honored every lock:

- **Canonical reset order: filterViewStore -> filterStore -> infoSelectionStore** — third reset added AFTER the existing two at both sites, matching the order from Phase 15 precedent.
- **No DROP loop for info-selection** — STORE-V14-02 session-only lock; no server-side mat-view or persisted row to clean up. Just `useInfoSelectionStore.getState().reset()`.
- **Test name change from BOTH to ALL THREE** — mandatory per plan; self-documents the three-store invariant.
- **STORE-V14-03/STORE-V14-04 referenced in test name strings** — enables grep-based requirement traceability (matches LIFE-V13-03/LIFE-V13-04 precedent).
- **Direct-invocation test idiom (DashboardsPage spec only)** — locked from v1.3 Phase 15 (DashboardsPage.spec.tsx:40-47); DashboardOpen is internal, full render-tree drill requires non-empty listDashboards mock; pragmatic path is direct invocation matching what production does.

## Deviations from Plan

None — plan executed exactly as written.

The plan provided concrete code snippets for both production additions (the comment block + reset call) and both spec test bodies. The executor wrote them verbatim. No Rule 1/2/3 invocations, no auth gates, no architectural decisions.

## Issues Encountered

None. All four commits landed in a single attempt:
- Task 1 RED test failed on cue (state was `{ 7: { ... } }` instead of `{}`) — confirming the test catches the missing reset wiring.
- Task 1 GREEN: tsc clean, App.spec 16/16 pass on first run.
- Task 2 spec extension: 5/5 DashboardsPage.spec pass on first run (passed even before production change because the test uses direct-invocation pattern; this is the locked v1.3 idiom).
- Task 2 GREEN: tsc clean, DashboardsPage.spec 5/5 still pass.
- Plan-level verification: 44/44 affected tests pass; full frontend suite 383/383 pass.

## User Setup Required

None — Plan 20-02 ships pure frontend code with no external service configuration, environment variables, or dashboard wiring.

## Next Phase Readiness

- **Phase 20 complete.** All 5 STORE-V14-* requirements landed:
  - STORE-V14-01 (slice + actions) — Plan 20-01
  - STORE-V14-02 (session-only) — Plan 20-01
  - STORE-V14-03 (dashboard-switch reset) — Plan 20-02 (THIS PLAN)
  - STORE-V14-04 (logout reset) — Plan 20-01 (store side: reset action) + Plan 20-02 (wiring side: App.tsx call)
  - STORE-V14-05 (layer-switch invariant) — Plan 20-01
- **Phase 21 (popup) ready to ship.** The `MapChartRenderer` click handler can now consume the store knowing both lifecycle sites already wipe state — no popup-internal logic needed for session-boundary cleanup. Click handler uses the canonical sequence: `setLoading(layerId, true) -> setSelection(layerId, payload) -> setLoading(layerId, false)` (or `setError` on failure).
- **Phase 23 (Info Card) ready to ship.** As a pure consumer reading `state[activeLayerId]` reactively, the Info Card can rely on activeLayerId === null after logout/dashboard-switch as the canonical empty-state path.
- **No blockers or concerns for v1.4 milestone progression.** The three-store reset pattern is now the established invariant for session boundaries; any future v1.4 phase that adds a new top-level slice (e.g., Phase 22 config-ui scratch state) should evaluate whether to register at these two canonical sites.

## Self-Check

Verified:
- `kinetica_bi/src/App.tsx` modified — import + reset call (FOUND)
- `kinetica_bi/src/App.spec.tsx` modified — import + ALL THREE test (FOUND)
- `kinetica_bi/src/components/DashboardsPage.tsx` modified — import + reset call (FOUND)
- `kinetica_bi/src/components/DashboardsPage.spec.tsx` modified — import + ALL THREE test (FOUND)
- Commit `6b56219` (Task 1 RED) exists in git log (FOUND)
- Commit `3451e29` (Task 1 GREEN) exists in git log (FOUND)
- Commit `59d22c4` (Task 2 spec extension) exists in git log (FOUND)
- Commit `34bd217` (Task 2 GREEN) exists in git log (FOUND)

## Self-Check: PASSED

---
*Phase: 20-info-selection-store*
*Completed: 2026-05-08*
