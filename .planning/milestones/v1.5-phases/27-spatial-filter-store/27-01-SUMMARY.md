---
phase: 27-spatial-filter-store
plan: 01
subsystem: ui
tags: [zustand, vitest, store, spatial-filter, typescript]

# Dependency graph
requires:
  - phase: 26-server-spatial-where
    provides: buildSpatialOrBlock and composeWhereClause — downstream spatialFilterVersion consumer context
  - phase: 23-info-card
    provides: lastInfoClickContextStore pattern (session-only Zustand slice, 4-store reset block) — direct structural sibling
provides:
  - useSpatialFilterStore Zustand slice (shapes[], spatialFilterVersion, shapeCounter, 4 actions)
  - Shape type export for Phase 29 (MapDrawToolbar) and Phase 30 (FilterBar chips)
  - spatialFilterStore.spec.ts with 15 behavioral tests (canary through structural)
affects:
  - 27-02 (lifecycle reset wiring — imports useSpatialFilterStore)
  - 29-spatial-draw (first OL consumer — MapDrawToolbar writes addShape at drawend)
  - 30-materialize-and-chips (AggregatedWidgetRenderer dep array reads spatialFilterVersion; FilterBar renders shapes[])

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Session-only Zustand slice with monotonic counter (shapeCounter) kept in state for post-removal label monotonicity"
    - "spatialFilterVersion as dep-array signal — mirrors filterStore.ts:filterVersion pattern exactly"
    - "Strict no-op rules: removeShape(non-existent) and clearAll(empty) return state identity (shapes[] reference stable)"
    - "CAPITALIZE lookup table keyed on Shape['type'] union — avoids conditional branches for label generation"

key-files:
  created:
    - kinetica_bi/src/store/spatialFilterStore.ts
    - kinetica_bi/src/store/spatialFilterStore.spec.ts
  modified:
    - .planning/REQUIREMENTS.md

key-decisions:
  - "shapeCounter kept in Zustand state (not derived from shapes.length) — only way to honor monotonic no-recycle rule after removeShape"
  - "clearAll() resets shapeCounter to 0 ('start over' user semantics), reset() also zeroes all — neither is an increment"
  - "removeShape and clearAll-when-empty both return s (state identity) to preserve shapes[] reference for Phase 29 PITFALL S-02 mitigation"
  - "Store ships dormant (no production consumer in Phase 27) — useSpatialFilterStore.ts exists but no App.tsx/DashboardsPage.tsx import until Plan 27-02"

patterns-established:
  - "5th-store slot reserved: spatialFilterStore is the 5th in canonical reset order after lastInfoClickContextStore"
  - "CAPITALIZE Record<Shape['type'], string> table pattern for type-to-label-prefix mapping"

requirements-completed:
  - STORE-V15-01
  - STORE-V15-02
  - STORE-V15-03

# Metrics
duration: 2min
completed: 2026-05-12
---

# Phase 27 Plan 01: spatial-filter-store Summary

**Session-only Zustand slice `useSpatialFilterStore` with Shape type, monotonic label counter, version signal, strict no-op rules, and 15-test vitest spec — ships dormant for Phase 29/30 consumers**

## Performance

- **Duration:** 2 min
- **Started:** 2026-05-12T16:17:02Z
- **Completed:** 2026-05-12T16:19:00Z
- **Tasks:** 3 (Tasks 1+2 committed together as TDD GREEN, Task 3 separate)
- **Files modified:** 3

## Accomplishments

- Created `spatialFilterStore.ts` with full Shape type, State type, and `useSpatialFilterStore` export; `addShape` synthesizes `id` (crypto.randomUUID), `label` ({TypeCapitalized} {N}), and `addedAt` (Date.now) internally; shapeCounter is monotonic and never decremented by removeShape
- Created `spatialFilterStore.spec.ts` with 15 passing tests covering all behavioral contracts: canary (C1/C2 prove Zustand shim), addShape×4 (A1-A4 including session-wide global counter), removeShape×3 (R1-R3 including strict no-op + reference identity), clearAll×3 (CL1-CL3 including post-clearAll counter reset), reset×1 (RS1), structural×2 (K1 key shape, K2 compile-time Shape completeness)
- Fixed REQUIREMENTS.md STORE-V15-01 path drift (`src/state/` → `src/store/`) so requirements file aligns with locked CONTEXT.md path and Zustand shim coverage

## Task Commits

Each task was committed atomically:

1. **Task 1+2: Create useSpatialFilterStore + sibling spec (TDD GREEN)** - `fce51c3` (feat)
2. **Task 3: Fix REQUIREMENTS.md STORE-V15-01 path** - `6b67a39` (fix)

**Plan metadata:** (docs commit below)

_Note: Tasks 1 and 2 committed together — spec was written first (RED), then implementation brought all 15 tests to GREEN in one atomic commit per TDD GREEN protocol._

## Files Created/Modified

- `kinetica_bi/src/store/spatialFilterStore.ts` — New Zustand slice: Shape type export, useSpatialFilterStore with addShape/removeShape/clearAll/reset, CAPITALIZE lookup table, no middleware
- `kinetica_bi/src/store/spatialFilterStore.spec.ts` — New 15-test vitest spec with crypto.randomUUID stub, Date.now stub, canary + action + structural coverage
- `.planning/REQUIREMENTS.md` — One-line path correction on STORE-V15-01 (src/state/ → src/store/)

## Decisions Made

- `shapeCounter` in Zustand state (not derived from `shapes.length`): the monotonic no-recycle rule requires tracking N independently of current array length; after `removeShape`, `shapes.length` would produce the wrong label on the next `addShape`
- `clearAll()` resets `shapeCounter` to 0 alongside emptying `shapes[]`: user mental model is "start over" — next drawn shape should be labeled `{Type} 1`
- `reset()` hard-sets all three fields to 0/[] without incrementing `spatialFilterVersion`: lifecycle wipe semantics, not a mutation signal
- Store ships dormant: no import sites added outside the spec; Plan 27-02 adds the production import sites (App.tsx + DashboardsPage.tsx) as STORE-V15-04

## Deviations from Plan

None — plan executed exactly as written. Both tasks were straightforward: spec verbatim from plan, implementation verbatim from plan's `<action>` block, one-line path fix in REQUIREMENTS.md.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `useSpatialFilterStore` and `Shape` type ready for Plan 27-02 import (App.tsx + DashboardsPage.tsx lifecycle wiring, STORE-V15-04)
- `spatialFilterVersion` semantics locked and tested — Phase 30 AggregatedWidgetRenderer dep-array consumer can rely on no spurious increments
- `shapes[]` reference-stable on no-ops — Phase 29 PITFALL S-02 mitigation (shapesKey primitive selector) is safe to implement
- No blockers for Plan 27-02

---
*Phase: 27-spatial-filter-store*
*Completed: 2026-05-12*
