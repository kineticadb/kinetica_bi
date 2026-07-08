---
phase: 105-reverse-mapping-pure-lib-tests
plan: 01
subsystem: filters
tags: [typescript, pure-lib, filter-scope, vitest, resolveFilterSet, resolveSpatialShapes]

# Dependency graph
requires:
  - phase: 088-filter-scope-foundation
    provides: resolveFilterSet.ts, resolveSpatialShapes.ts, FilterSelectionConfig type
  - phase: 095-on-widget-badge
    provides: useFilterScopeSummary.ts dv/spatial forcing rules mirrored here
provides:
  - "computeReverseFilterMap.ts: pure fn inverting per-viz filter-scope resolvers into a per-filter/per-shape, widget-level applies-to map"
  - "VizDescriptor / FilterApplyEntry / ShapeApplyEntry / WidgetApplyEntry public types"
affects: [108-applies-to-list-and-highlight, 095-on-widget-badge-potential-reuse]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-lib-then-hook split (house pattern, Phase 88/93.5/95): pure fn in src/lib/*.ts with zero React/store imports; live-store wiring deferred to a thin consumer hook (Phase 108)"
    - "Reverse-map inversion: iterate every viz descriptor, re-run the SAME forward resolvers (resolveFilterSet/resolveSpatialShapes) per viz against its own source-scoped active list, then invert per-viz membership into per-filter/per-shape widget entries"

key-files:
  created:
    - packages/web/src/lib/computeReverseFilterMap.ts
    - packages/web/src/lib/computeReverseFilterMap.spec.ts
  modified: []

key-decisions:
  - "Public return type is FilterApplyEntry[]/ShapeApplyEntry[] arrays (not a Map) for easier vitest assertions and Phase 108 serialization; internal accumulation still uses Map for O(1) seeding/lookup (per RESEARCH.md Open Question 2)"
  - "isDv derived internally as dynamicViewId !== undefined; no separate isDv field on VizDescriptor, matching useFilterScopeSummary's own convention (per RESEARCH.md Open Question 3)"
  - "Widget-level dedup keyed on plain numeric widgetId (Array.find), never a composite string key"

patterns-established:
  - "Widget-card applies-to aggregation: a map layer viz rolls up onto its OWNING widgetId; multiple matching layers of the same map widget dedup into ONE WidgetApplyEntry with layerNames aggregated; the same physical layer owned by two map widgets correctly yields two separate entries"

requirements-completed: [FSCOPE-V120-01]

# Metrics
duration: ~20min
completed: 2026-07-08
---

# Phase 105 Plan 01: Reverse-Mapping Pure Lib + Tests Summary

**Pure `computeReverseFilterMap.ts` inverts `resolveFilterSet`/`resolveSpatialShapes` across chart widgets and map layers into a per-filter/per-shape, widget-level applies-to map, with an 18-case colocated vitest spec proving operator-agnosticism, both read paths, dv double-override, layer dedup/multi-ownership, zero-match seeding, ordering determinism, reference-identity, and total/non-mutating behavior.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-08T17:48:00Z (approx.)
- **Completed:** 2026-07-08T18:09:00Z
- **Tasks:** 2 completed
- **Files modified:** 2 (both new)

## Accomplishments
- Shipped `packages/web/src/lib/computeReverseFilterMap.ts` — a pure, dependency-free TS module exporting `computeReverseFilterMap` + `VizDescriptor`/`FilterApplyEntry`/`ShapeApplyEntry`/`WidgetApplyEntry`, reusing `resolveFilterSet` + `resolveSpatialShapes` verbatim (zero reimplemented matching logic).
- Mirrored `useFilterScopeSummary`'s dv-accept-all override and dv-forces-non-spatial-capable override byte-for-byte, so the reverse map can never drift from the per-widget badge's forward semantics.
- Wrote an 18-test exhaustive spec covering every dimension in RESEARCH.md's Test Matrix: operator parity (eq/in/between), both read paths (chart widget + map layer), same-widget layer dedup with layer-name aggregation, same-layer-two-widgets, per-source (table vs dv) scoping with no cross-table leak, all four cfg modes, `dvFilterScopeDisabled` false/true, dv double-override (cfg + spatialCapable), spatial sentinel gating, zero-match seeding, ordering determinism, reference-identity join, no-mutation, and totality (malformed descriptor / empty inputs).

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement the pure computeReverseFilterMap lib + public types** - `ff98884` (feat)
2. **Task 2: Write the exhaustive computeReverseFilterMap unit-test matrix and prove green** - `58f8bbe` (test)

**Plan metadata:** (this commit, following)

## Files Created/Modified
- `packages/web/src/lib/computeReverseFilterMap.ts` - Pure reverse-map fn + 4 public types; imports `ActiveFilter`/`Shape` as types only, imports `resolveFilterSet`/`resolveSpatialShapes` as functions; no React/store/zustand/combination-store coupling; no `.operator` branching.
- `packages/web/src/lib/computeReverseFilterMap.spec.ts` - 18 `it()` cases (one `describe` block) mirroring `useFilterScopeSummary.spec.ts`/`resolveFilterSet.spec.ts` factory + assertion conventions.

## Decisions Made
- Array return type (`FilterApplyEntry[]`/`ShapeApplyEntry[]`) chosen over `Map` for the public API — easier `toHaveLength`/`toEqual` assertions in tests and easier for Phase 108 to serialize/debug; internal computation still uses `Map<ActiveFilter, WidgetApplyEntry[]>`/`Map<Shape, WidgetApplyEntry[]>` for O(1) seeding and lookup.
- `isDv` derived internally (`dynamicViewId !== undefined`), no explicit `isDv` field added to `VizDescriptor` — keeps one less field to drift out of sync with the derived truth, matching `useFilterScopeSummary.ts`'s own convention.
- Widget dedup uses a plain numeric `widgetId` key (`Array.find`), not a composite `widgetId:layerId` string — widget ids are already dashboard-wide unique.

## Deviations from Plan

None — plan executed exactly as written. Both tasks' `<action>`/`<acceptance_criteria>` were followed verbatim, including the Pattern 2 algorithm transcribed near-verbatim from RESEARCH.md and the full 16-item Test Matrix from the plan's Task 2 action block.

## Issues Encountered

**Pre-existing, out-of-scope web vitest exit-1 (documented, not fixed):** `cd packages/web && npx vitest run` reports `Test Files 142 passed (142)` / `Tests 3247 passed (3247)` (100% of individual tests pass, including the new 18-case spec) but the overall process exits with code 1 due to 2 "Unhandled Rejection" errors surfacing during `InfoPopup.spec.tsx` (`ReauthRequiredError` from `columnDisplayConfigStore.ts` → `client.ts`) and `DashboardContext.spec.tsx` (`useDashboardContext must be used inside DashboardContext.Provider`). Verified via A/B run (`--exclude "**/computeReverseFilterMap.spec.ts"`) that the identical 2 errors and identical exit code occur with or without this plan's new spec file (`141 passed (141)` files / `3229 passed (3229)` tests, same 2 errors, exit 1) — confirming this is pre-existing test-isolation noise unrelated to `computeReverseFilterMap.ts`/`.spec.ts` (neither file touches `InfoPopup`, `DashboardContext`, or `columnDisplayConfigStore`). Per the SCOPE BOUNDARY rule, this was logged to `.planning/phases/105-reverse-mapping-pure-lib-tests/deferred-items.md` and NOT fixed (out of scope for this plan's file-touch list). `npx tsc --noEmit` is clean (exit 0). The lib's own spec (`npx vitest run src/lib/computeReverseFilterMap.spec.ts`) is 100% green in isolation (18/18, exit 0).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `computeReverseFilterMap` + its 4 public types are ready for Phase 108's thin hook wrapper (live-store enumeration of `VizDescriptor[]` from dashboard widgets + `dashboardLayersStore`, per Pattern 1's confirmed-obtainable-today field sourcing).
- Phase 106 (Display-Mode Persistence) and this plan were parallel-safe; no blockers surfaced for either.
- Flag for the Phase 108 planner/executor: the pre-existing web vitest unhandled-rejection exit-1 noise (see Issues Encountered / deferred-items.md) will still be present when Phase 108 runs the full suite — it is NOT caused by anything in this plan and should not be mistaken for a Phase 108 regression.

---
*Phase: 105-reverse-mapping-pure-lib-tests*
*Completed: 2026-07-08*

## Self-Check: PASSED

- FOUND: packages/web/src/lib/computeReverseFilterMap.ts
- FOUND: packages/web/src/lib/computeReverseFilterMap.spec.ts
- FOUND: .planning/phases/105-reverse-mapping-pure-lib-tests/105-01-SUMMARY.md
- FOUND commit: ff98884 (feat(105-01): implement pure computeReverseFilterMap lib)
- FOUND commit: 58f8bbe (test(105-01): exhaustive computeReverseFilterMap unit-test matrix)
