---
phase: 63-client-dv-drill-down
plan: 02
subsystem: api
tags: [api-client, dynamic-view, materialize, filter, fetch, vitest]

# Dependency graph
requires:
  - phase: 62-server-materialize-from-dv-view
    provides: "POST/DELETE /api/filter/materialize accept dynamicViewId (build FROM dv view)"
  - phase: 63-client-dv-drill-down (plan 01)
    provides: "dvFilters / dvViews parallel store slices (kind-scoped keying precedent)"
provides:
  - "MaterializeFilterArgs gains optional dynamicViewId (and tableId now optional)"
  - "materializeFilter sends dynamicViewId in the POST body + kind-scoped in-flight cache key"
  - "DropFilterViewArgs gains optional dynamicViewId; dropFilterView issues the ?dynamicViewId= DELETE"
  - "dv vs table calls on the same numeric id never collapse in the in-flight dedup cache"
affects: [63-03-dv-bound-widget, dv-drill-down, materialize-trigger]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Kind-scoped in-flight cache key (dv<id> vs t<id>) so a dv-filter call never collapses into a table call sharing the numeric id"
    - "Conditional DELETE query string (?dynamicViewId= vs ?tableId=) keeping the table path byte-unchanged"

key-files:
  created: []
  modified:
    - packages/web/src/api/client.ts
    - packages/web/src/api/client.spec.ts

key-decisions:
  - "Cache key prefix t/dv is load-bearing: a dv id and a table id are both numbers, so the kind prefix keeps them in separate dedup buckets (mirrors the parallel dv store slices)"
  - "dynamicViewId flows through the POST body for free via JSON.stringify(args) once on the type — no manual body assembly change"
  - "tableId made optional on both arg types so a dv call need not carry a tableId; exactly one of tableId/dynamicViewId is set in practice"

patterns-established:
  - "Kind-scoped dedup keying: ${dashboardId}:dv${dynamicViewId} | ${dashboardId}:t${tableId}"

requirements-completed: [DVDRILL-V112-03]

# Metrics
duration: 3 min
completed: 2026-06-15
---

# Phase 63 Plan 02: Client Materialize/Drop dynamicViewId Wiring Summary

**`materializeFilter`/`dropFilterView` now carry an optional `dynamicViewId` (POST body + `?dynamicViewId=` DELETE) with a kind-scoped in-flight cache key (`dv<id>` vs `t<id>`) so a dv-filter call never collapses into a table call sharing the same numeric id.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-06-15T22:18:26Z
- **Completed:** 2026-06-15T22:21:37Z
- **Tasks:** 2 (both TDD, 4 commits)
- **Files modified:** 2

## Accomplishments
- `MaterializeFilterArgs`: `tableId` now optional + new `dynamicViewId?: number`; the dv id flows through the POST body automatically via the existing `JSON.stringify(args)`.
- `materializeFilter` cache key is kind-scoped — `${dashboardId}:dv${dynamicViewId}` for the dv path, `${dashboardId}:t${tableId}` for the table path — so a dv call `{dashboardId:5, dynamicViewId:7}` and a table call `{dashboardId:5, tableId:7}` fire two distinct HTTP requests (no collapse), while dedup within a kind is preserved.
- `DropFilterViewArgs` mirrors the same shape; `dropFilterView` issues the dv-variant DELETE `?dashboardId=&dynamicViewId=` and uses the same kind-scoped dedup key.
- Table-backed materialize/drop paths remain byte-unchanged on the wire; back-compat specs all green.

## Task Commits

Each task executed RED → GREEN (no REFACTOR needed — minimal, clean):

1. **Task 1 RED: failing materializeFilter dv tests** - `ddecc3a` (test)
2. **Task 1 GREEN: materializeFilter dynamicViewId + kind-scoped cache key** - `4519c32` (feat)
3. **Task 2 RED: failing dropFilterView dv tests** - `ee447d1` (test)
4. **Task 2 GREEN: dropFilterView dv-variant DELETE + kind-scoped cache key** - `9cab45b` (feat)

## Files Created/Modified
- `packages/web/src/api/client.ts` - `MaterializeFilterArgs`/`DropFilterViewArgs` extended with optional `dynamicViewId` (tableId now optional); kind-scoped cache keys in `materializeFilter`/`dropFilterView`; conditional DELETE query string.
- `packages/web/src/api/client.spec.ts` - 6 new specs: dv POST body, dv-vs-table no-collapse (materialize), identical-dv dedup, dv DELETE query string, table DELETE byte-unchanged, dv-vs-table no-collapse (drop).

## Decisions Made
- Used the `t`/`dv` cache-key prefix (load-bearing) rather than relying on `tableId: undefined` vs a number — explicit kind separation matches the parallel dv store slices from 63-01 and is robust if call shapes change.
- Left `body: JSON.stringify(args)` untouched — `dynamicViewId` serializes automatically once on the type.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. Both RED phases failed as expected (Task 1 at the TypeScript type level since vitest runs untyped via esbuild; Task 2 at runtime via the `tableId=undefined` URL), then went GREEN on implementation.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Client materialize/drop API surface ready for **63-03** to consume `materializeFilter({…, dynamicViewId})` + `dropFilterView({…, dynamicViewId})` from the dv-bound widget's Effect 1 (filtered-dv read-path FROM-swap).
- DVDRILL-V112-03 (client side) complete; server side shipped in Phase 62.

---
*Phase: 63-client-dv-drill-down*
*Completed: 2026-06-15*

## Self-Check: PASSED
- All modified files present on disk (client.ts, client.spec.ts) + SUMMARY.md created.
- All 4 task commits present in git history (ddecc3a, 4519c32, ee447d1, 9cab45b).
- client.spec.ts 57/57 green; web tsc exit 0; zero packages/server diff.
