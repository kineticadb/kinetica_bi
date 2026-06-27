---
phase: 90-combination-orchestrator
plan: "01"
subsystem: api
tags: [materialize, cache-key, combination, v1.18, frontend-only, tdd]
dependency_graph:
  requires:
    - phase: 88-foundation-pure-logic-types
      provides: comboShortHash (packages/web/src/lib/stableComboHash.ts)
    - phase: 89-store-server-foundation
      provides: server accepts combinationKey in POST /api/filter/materialize body
  provides:
    - MaterializeFilterArgs.combinationKey optional field (packages/web/src/api/client.ts)
    - inFlightMaterialize cache-key branches on combinationKey when present
  affects:
    - 90-03 (useCombinationOrchestrator uses combinationKey field to prevent in-flight collapse)
    - 91 (WidgetRenderer read-path uses filterCombinationStore, orchestrator passes combinationKey)
tech-stack:
  added: []
  patterns:
    - combinationKey precedence: combinationKey branch takes priority over t/dv branches in cache key ternary
    - vi.resetModules() isolation: module-level Map state reset via dynamic import in each beforeEach
key-files:
  created: []
  modified:
    - packages/web/src/api/client.ts
    - packages/web/src/api/client.spec.ts
key-decisions:
  - "combinationKey branch takes precedence (first in ternary) over dynamicViewId and tableId branches — orchestrator calls always win the correct bucket"
  - "Empty-string combinationKey treated same as absent (guard: !== undefined && !== '') — defensive, prevents accidental empty-key collision"
  - "JSON.stringify(args) already carries combinationKey to server body automatically — no hand-built body needed"
  - "Test isolation via vi.resetModules() + dynamic import to get a fresh inFlightMaterialize Map per test"
patterns-established:
  - "Cache key precedence: combinationKey > dynamicViewId > tableId — new callers with more specific keys always get their own bucket"
requirements-completed: [COMBO-V118-01]
duration: 5min
completed: "2026-06-27"
---

# Phase 90 Plan 01: Combination-Orchestrator Client Cache-Key Fix Summary

**combinationKey optional arg added to MaterializeFilterArgs + inFlightMaterialize keyed on dashboardId:c${comboShortHash(combinationKey)} when present, preventing in-flight collapse of distinct combinations for the same tableId**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-06-27T23:18:00Z
- **Completed:** 2026-06-27T23:21:22Z
- **Tasks:** 1 (TDD: test + impl in one commit)
- **Files modified:** 2

## Accomplishments

- Added `import { comboShortHash } from "../lib/stableComboHash"` to `client.ts`
- Extended `MaterializeFilterArgs` with `combinationKey?: string` and a Phase 90 doc comment explaining the purpose
- Branched `inFlightMaterialize` cache key: `combinationKey` takes precedence — `${dashboardId}:c${comboShortHash(combinationKey)}` when present; existing `dv` / `t` branches unchanged
- Added 5-test `describe("materializeFilter combinationKey cache-key (Phase 90 COMBO-V118-01)", ...)` block in `client.spec.ts` covering all behavior scenarios

## Task Commits

1. **Task 1: Add combinationKey to MaterializeFilterArgs + branch the in-flight cache key** - `9944520` (feat)

## Files Created/Modified

- `packages/web/src/api/client.ts` — Added `comboShortHash` import; added `combinationKey?: string` to `MaterializeFilterArgs`; branched `inFlightMaterialize` cache key (combinationKey branch first)
- `packages/web/src/api/client.spec.ts` — Added 5-test describe block for Phase 90 combinationKey cache-key behaviors with `vi.resetModules()` isolation

## Decisions Made

1. **combinationKey branch takes precedence** — the ternary checks `combinationKey !== undefined && combinationKey !== ""` FIRST, before `dynamicViewId` and `tableId`. This ensures orchestrator calls with a combinationKey always get their own isolated in-flight bucket regardless of which path (table vs dv) they also carry.

2. **Empty string guard** — `combinationKey !== ""` added defensively. A caller passing an empty string should fall back to the legacy t/dv path rather than creating a `c${comboShortHash("")}` bucket that could accidentally collapse calls.

3. **JSON.stringify(args) auto-carries combinationKey** — no change to the POST body construction is needed; the field flows through automatically as documented in the existing comment. This is by design: the server already accepts and uses `combinationKey` (Phase 89-02).

4. **Test isolation via vi.resetModules() + dynamic import** — `inFlightMaterialize` is a module-level `Map`. Tests that check in-flight dedup behavior must start with an empty Map. The `beforeEach` pattern `vi.resetModules()` + `const mod = await import("./client")` gives each test a fresh module instance.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

Minor: The initial test spec used `vi.spyOn` within the describe block but the module-level `inFlightMaterialize` Map shared state across tests caused cascading failures. Fixed by adopting the `vi.resetModules()` + dynamic import isolation pattern in `beforeEach` — this is the correct approach for module-level state isolation and is already used elsewhere in the vitest ecosystem.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `MaterializeFilterArgs.combinationKey` is now available for Plan 90-03 (`useCombinationOrchestrator`) to pass `combinationKey: hash` when calling `materializeFilter`
- Two distinct combinations for the same tableId will fire two distinct in-flight promises (no view-name collision)
- Backward-compatible: existing callers without combinationKey see byte-identical behavior to v1.17
- Plan 90-02 (if any) and Plan 90-03 can import `MaterializeFilterArgs` with confidence that the cache-key fix is in place

---
*Phase: 90-combination-orchestrator*
*Completed: 2026-06-27*
