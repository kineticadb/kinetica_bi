---
phase: 20-info-selection-store
plan: 01
subsystem: ui
tags: [zustand, vitest, store, react, info-popup]

# Dependency graph
requires:
  - phase: 14-filter-view-store
    provides: useFilterViewStore reference-stable update / placeholder-on-missing / delete-key / internal-only reset patterns (THE primary template mirrored byte-for-byte)
  - phase: 09-filters
    provides: useFilterStore exact-duplicate dedupe pattern (mirrored for setActiveLayer same-layer no-op)
  - phase: 18-info-query-endpoint
    provides: POST /api/info/query response shape { rows, columns, hasMore, page } that the store types align with byte-for-byte
provides:
  - useInfoSelectionStore Zustand slice (kinetica_bi/src/store/infoSelectionStore.ts) with locked state shape (state Record + activeLayerId) + 7 actions
  - InfoSelectionEntry / InfoSelectionState exported types ready for Phase 21 popup + Phase 23 Info Card consumers
  - Comprehensive vitest spec (23 it blocks across 8 describe blocks) covering all 7 actions, no-op paths, placeholder paths, layer-switch delete-key, append-fail rows-preserved, reference stability, reset shim canary, setSelection-preserves-loading regression
affects: [21-info-popup, 22-config-ui, 23-info-card, 20-02-lifecycle-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Three-store split (chip / view / info-selection) — Phase 20 adds the third orthogonal slice next to useFilterStore + useFilterViewStore"
    - "Per-layerId reference-stable update via { state: { ...s.state, [layerId]: nextEntry } } (mirrors filterViewStore.setView line 72)"
    - "Placeholder-on-missing pattern via shared PLACEHOLDER constant for setLoading/setError on absent layerId (mirrors filterViewStore.markMaterializing)"
    - "Delete-key clear via 'if !(key in state.state) return state; const next = { ...state.state }; delete next[key]' (mirrors filterViewStore.clearView)"
    - "setActiveLayer atomic-delete-and-switch in a single set() call — prior layer entry deleted + activeLayerId updated transactionally"
    - "Internal-only reset() action — exposed in action set but only called from lifecycle sites (Plan 20-02 wires)"
    - "Zustand reset shim auto-coverage (kinetica_bi/__mocks__/zustand.ts) for any new src/store/*.ts — no spec-side beforeEach reset boilerplate"

key-files:
  created:
    - kinetica_bi/src/store/infoSelectionStore.ts
    - kinetica_bi/src/store/infoSelectionStore.spec.ts
  modified: []

key-decisions:
  - "setSelection preserves prior loading flag via 'loading: prev?.loading ?? false' (CONTEXT.md § Action contract lock — codified anti-regression for v0 plan that hard-coded loading: false)"
  - "setSelection clears prior error to null on settled rows (judgment call — not locked by CONTEXT.md): settled rows obsolete the prior error; caller does not need to setError(null) before/after setSelection"
  - "setActiveLayer signature is number not number | null — POPUP-V14-05 dismiss must call reset() not setActiveLayer(null) (activeLayerId invariant lock)"
  - "appendPage no-op when state[layerId] absent — store does not invent rows from a caller bug; APPEND requires a prior setSelection"
  - "setError preserves prior rows (append-fail UX lock from CONTEXT.md § specifics) — page 4 fail must NOT wipe pages 1-3"
  - "Plan 20-01 ships the store dormant — zero consumer imports outside spec (verified by grep). Plan 20-02 wires reset() into App.tsx UNAUTHORIZED handler + DashboardsPage DashboardOpen cleanup alongside the existing useFilterStore + useFilterViewStore reset() calls"
  - "PLACEHOLDER hoisted as a module-level const (not inlined per action body) — same shape reused by setLoading/setError absent paths; shared constant keeps DRY"

patterns-established:
  - "Three-store-reset block pattern: useFilterStore.reset() + useFilterViewStore.reset() + useInfoSelectionStore.reset() at App.tsx UNAUTHORIZED + DashboardsPage DashboardOpen cleanup (Plan 20-02 wires; Plan 20-01 ships the third reset action)"
  - "activeLayerId invariant: non-null iff user has live selection visible; only paths to null are initial state + reset() — type signature forbids setActiveLayer(null)"

requirements-completed: [STORE-V14-01, STORE-V14-02, STORE-V14-04, STORE-V14-05]

# Metrics
duration: 3min
completed: 2026-05-08
---

# Phase 20 Plan 01: Store and Spec Summary

**useInfoSelectionStore Zustand slice (state Record<layerId, entry> + activeLayerId, 7 actions) shipped dormant alongside 23-test vitest spec proving locked Action contract + STORE-V14-05 layer-switch invariant**

## Performance

- **Duration:** 3min (~178s task work)
- **Started:** 2026-05-08T13:31:42Z
- **Completed:** 2026-05-08T13:34:40Z
- **Tasks:** 2
- **Files modified:** 0 (2 created)

## Accomplishments

- `useInfoSelectionStore` Zustand slice live with the exact locked shape (state Record + activeLayerId: number | null) and 7 actions: setSelection (REPLACE, preserves prior loading, clears error), appendPage (APPEND, no-op when absent), clearSelection (DELETE-KEY), setActiveLayer (focus-switch + prior-delete), setLoading (placeholder-on-missing), setError (placeholder-on-missing, rows preserved), reset (two-key wipe).
- 23-test vitest spec passes 100% — covers all 7 actions, no-op paths, placeholder-creation paths, layer-switch delete-key invariant (STORE-V14-05), append-fail rows-preserved invariant, reference-stability assertions, Zustand reset shim canary (PITFALL S-03), and the four verbatim-required regression tests (preserves prior loading, clears prior error, STORE-V14-05 page reset, append-fail rows preserved).
- Full src/store/ test suite still green: 86/86 tests across 6 files (no regression in useFilterStore / useFilterViewStore / dashboardLayersStore / auth / wmsCapabilities specs).
- `tsc --noEmit` clean across the entire frontend.
- Store ships truly dormant — `grep -rn "useInfoSelectionStore" src/` (excluding the two new files) returns zero consumer imports. Plan 20-02 will wire reset() into App.tsx + DashboardsPage.tsx.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create useInfoSelectionStore Zustand slice** — `359db8c` (feat)
2. **Task 2: Comprehensive vitest spec for useInfoSelectionStore** — `26066f7` (test)

_Note: TDD ceremony was constrained by the plan providing CONCRETE CONTENTS for both files; commits map 1:1 to tasks rather than RED/GREEN sub-commits._

## Files Created/Modified

- `kinetica_bi/src/store/infoSelectionStore.ts` (created) — useInfoSelectionStore slice with locked shape and 7 actions; mirrors useFilterViewStore structurally; reference-stable per-layerId updates; placeholder-on-missing for setLoading/setError; delete-key for clearSelection; atomic delete-prior-and-switch for setActiveLayer; internal-only reset.
- `kinetica_bi/src/store/infoSelectionStore.spec.ts` (created) — 23 it blocks across 8 describe blocks (canary + 7 actions); 4 verbatim-required regression tests; uses canonical `useInfoSelectionStore.getState().<action>(...)` invocation; no beforeEach (Zustand shim handles it).

## Decisions Made

All decisions were locked in 20-CONTEXT.md before execution. Plan 20-01 honored every lock:

- **setSelection preserves prior loading flag** (CONTEXT.md § Action contract): production code uses `loading: prev?.loading ?? false`; spec asserts that `setLoading(1, true) → setSelection(1, payload)` leaves loading === true. Codified anti-regression for the v0 plan that hard-coded `loading: false`.
- **setSelection clears prior error to null** (judgment call — not locked by CONTEXT.md): settled rows obsolete the prior error; caller does not need to setError(null) before/after setSelection.
- **setActiveLayer signature is `number` not `number | null`** (activeLayerId invariant lock): POPUP-V14-05 dismiss must call reset(), not setActiveLayer(null). Type system forbids the null path.
- **appendPage no-op when state[layerId] absent**: store does not invent rows from a caller bug; APPEND requires a prior setSelection.
- **setError preserves prior rows** (append-fail UX lock from CONTEXT.md § specifics): page 4 fail must NOT wipe pages 1-3.
- **Hoisted PLACEHOLDER constant** (Claude's discretion per CONTEXT.md): module-level const reused by setLoading/setError absent paths instead of inlining the literal four times. Keeps the file DRY and the shape grep-able as a single source of truth.

## Deviations from Plan

None — plan executed exactly as written.

The plan provided CONCRETE CONTENTS for both files; the executor wrote them verbatim with the exception of one minor structural improvement (PLACEHOLDER hoisting) explicitly permitted by CONTEXT.md § "Claude's Discretion" — "Internal placeholder shape for setLoading / setError on absent layerId". No scope creep, no auto-fixes, no Rule 1/2/3 invocations, no architectural decisions.

## Issues Encountered

None. Task 1 and Task 2 each landed in a single attempt with all acceptance criteria green on first run. Full plan-level verification suite (7 checks: file existence, tsc clean, spec passes, full src/store/ suite green, dormant-store grep, loading-preservation production lock, loading-preservation spec lock) passed clean.

## User Setup Required

None — Plan 20-01 ships pure frontend code with no external service configuration, environment variables, or dashboard wiring.

## Next Phase Readiness

- **Plan 20-02 (lifecycle-integration) ready to ship.** The reset() action exists and is grep-locatable at `kinetica_bi/src/store/infoSelectionStore.ts:170`. Plan 20-02 adds `useInfoSelectionStore.getState().reset()` calls at the two canonical sites (App.tsx UNAUTHORIZED handler ~lines 45-54 + DashboardsPage.tsx DashboardOpen cleanup ~lines 389-397) alongside the existing useFilterStore + useFilterViewStore reset calls, completing STORE-V14-03 (dashboard reset) and the lifecycle wiring half of STORE-V14-04 (logout reset).
- **Phase 21 (popup) can now plan against a stable consumer-ready store.** State shape, action signatures, and locked semantics (REPLACE / APPEND / DELETE-KEY / focus-switch / placeholder / preserve-on-error / two-key reset) are immutable. Phase 21 click handler will use the canonical sequence: `setLoading(layerId, true) → setSelection(layerId, payload) → setLoading(layerId, false)` for fresh-click; `setLoading(layerId, true) → appendPage(layerId, payload) → setLoading(layerId, false)` (or `setError` on failure) for Load-more.
- **Phase 23 (Info Card) can now plan as a pure consumer.** Consumes `state[activeLayerId]` reactively; does not import any fetch helpers. activeLayerId invariant guarantees state[activeLayerId] is non-null whenever activeLayerId is non-null, so Card empty-state path is solely `activeLayerId === null`.

## Self-Check

Verified:
- `kinetica_bi/src/store/infoSelectionStore.ts` exists (FOUND)
- `kinetica_bi/src/store/infoSelectionStore.spec.ts` exists (FOUND)
- Commit `359db8c` (Task 1) exists in git log (FOUND)
- Commit `26066f7` (Task 2) exists in git log (FOUND)

## Self-Check: PASSED

---
*Phase: 20-info-selection-store*
*Completed: 2026-05-08*
