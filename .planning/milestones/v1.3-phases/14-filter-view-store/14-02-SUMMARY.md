---
phase: 14-filter-view-store
plan: 02
subsystem: api
tags: [typescript, fetch, vitest, tdd, filter, materialize, abort-signal]

# Dependency graph
requires:
  - phase: 13-spikes-and-endpoint
    provides: POST/DELETE /api/filter/materialize endpoint contract locked in STATE.md
  - phase: 09-filter-foundation
    provides: ActiveFilter type in filterStore.ts
provides:
  - materializeFilter helper exported from client.ts (POST /api/filter/materialize)
  - dropFilterView helper exported from client.ts (DELETE /api/filter/materialize)
  - MaterializeFilterArgs, MaterializeFilterResponse, DropFilterViewArgs, DropFilterViewResponse types
  - client.spec.ts — first unit-test file for client.ts with 8 passing tests
affects:
  - phase 15 (AggregatedWidgetRenderer FROM-swap caller will import materializeFilter + dropFilterView)
  - phase 15 lifecycle hooks (LIFE-V13-03/LIFE-V13-04) — error handling via PermissionError/UpstreamError instanceof

# Tech tracking
tech-stack:
  added: []
  patterns:
    - apiFetch+throwForStatus pattern extended to new endpoint pair (POST+DELETE)
    - AbortSignal threaded as optional last param (consistent with runSql)
    - type-only import of ActiveFilter from filterStore (no client-side type duplication)
    - vi.spyOn(globalThis, "fetch") for jsdom-compat fetch mocking in vitest

key-files:
  created:
    - kinetica_bi/src/api/client.spec.ts
  modified:
    - kinetica_bi/src/api/client.ts

key-decisions:
  - "materializeFilter and dropFilterView ship DORMANT in Phase 14 — Phase 15 wires first production caller (AggregatedWidgetRenderer)"
  - "ActiveFilter imported as type-only from filterStore.ts — no re-declaration in client.ts"
  - "DELETE returns 200 with { dropped: true } NOT 204 — no status !== 204 short-circuit unlike deleteDashboard"
  - "vi.spyOn(globalThis, 'fetch') used (not global) for jsdom 29 compat per RESEARCH.md Pitfall 7"

patterns-established:
  - "Pattern: apiFetch+throwForStatus for typed-error mapping on new endpoints"
  - "Pattern: AbortSignal as optional last param on all network helpers"

requirements-completed:
  - VSTORE-V13-04

# Metrics
duration: 2min
completed: 2026-05-06
---

# Phase 14 Plan 02: Filter Client Helpers Summary

**materializeFilter + dropFilterView helpers added to client.ts with locked Phase 13 signatures, ActiveFilter type-only import, and 8-test vitest spec covering POST/DELETE shapes, typed-error mapping, and AbortSignal propagation**

## Performance

- **Duration:** 2 min
- **Started:** 2026-05-06T19:55:03Z
- **Completed:** 2026-05-06T19:57:22Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added `materializeFilter(args, signal?)` to client.ts — POSTs JSON to `/api/filter/materialize`, threads AbortSignal, returns `{ viewName, expiresAt }`
- Added `dropFilterView(args, signal?)` to client.ts — DELETEs `/api/filter/materialize?dashboardId=N&tableId=M`, threads AbortSignal, returns `{ dropped: true }`
- Created `client.spec.ts` as the first unit-test file for client.ts — 8 tests covering POST shape (URL/method/body/credentials/signal), DELETE shape (URL+query-string/method/no-body/signal), 403→PermissionError, 502→UpstreamError, and AbortError propagation
- All 4 exported types (`MaterializeFilterArgs`, `MaterializeFilterResponse`, `DropFilterViewArgs`, `DropFilterViewResponse`) added and TypeScript-clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Add materializeFilter + dropFilterView helpers to client.ts** - `b6a1f48` (feat)
2. **Task 2: Write client.spec.ts covering both helpers** - `eacaa01` (test)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified
- `kinetica_bi/src/api/client.ts` - Added ActiveFilter type-only import + 4 types + 2 helper functions (~81 lines added)
- `kinetica_bi/src/api/client.spec.ts` - NEW file: 8-test vitest spec for materializeFilter and dropFilterView (169 lines)

## Decisions Made
- Helpers ship dormant — no production caller in Phase 14 per CONTEXT.md scope lock. Phase 15 AggregatedWidgetRenderer is the designated first caller.
- DELETE response is 200 with `{ dropped: true }` per Phase 13 contract — NOT 204, so the `response.status !== 204` short-circuit from `deleteDashboard` is deliberately absent.
- `vi.spyOn(globalThis, "fetch")` used rather than `global.fetch` for jsdom 29 compatibility (RESEARCH.md Pitfall 7).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 15 can import `materializeFilter` and `dropFilterView` from `kinetica_bi/src/api/client.ts` immediately — signatures are locked
- Phase 15's `AggregatedWidgetRenderer` wires `materializeAbortRef` (separate AbortController from chart-query) and the 300ms debounce + post-200 `setView` flow
- Phase 15's catch path uses `instanceof PermissionError` / `instanceof UpstreamError` / `err.name === "AbortError"` — all three are tested and verified

---
*Phase: 14-filter-view-store*
*Completed: 2026-05-06*

## Self-Check: PASSED

- FOUND: kinetica_bi/src/api/client.ts
- FOUND: kinetica_bi/src/api/client.spec.ts
- FOUND: .planning/phases/14-filter-view-store/14-02-SUMMARY.md
- FOUND: commit b6a1f48 (feat: client.ts helpers)
- FOUND: commit eacaa01 (test: client.spec.ts)
