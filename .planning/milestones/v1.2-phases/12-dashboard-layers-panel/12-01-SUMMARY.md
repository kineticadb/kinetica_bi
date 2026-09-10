---
phase: 12-dashboard-layers-panel
plan: "01"
subsystem: database
tags: [sqlite, express, better-sqlite3, supertest, vitest, layers]

# Dependency graph
requires:
  - phase: 11-map-chart
    provides: WMS rendering pattern, wmsUrlBuilder, spatialMode types
  - phase: 09-filter-foundation
    provides: useFilterStore contract (table-keyed), filterVersion primitive dep
provides:
  - dashboard_layers SQLite table with soft FK on table_id, CHECK(layer_type='KineticaWms'), ON DELETE CASCADE on dashboard_id
  - 6 db.ts exports: listDashboardLayers, getDashboardLayer, createDashboardLayer, updateDashboardLayer, deleteDashboardLayer, reorderDashboardLayers
  - 5 Express routes under /api/dashboards/:id/layers[/:layerId] + /api/dashboards/:id/layers/reorder
  - DashboardLayer and LayerType TypeScript types in types.ts
  - 13-test supertest spec covering CRUD, reorder, cascade, soft-FK semantics
affects: [12-02, 12-03, 12-04, 12-05, 12-06, frontend-store, MapChartRenderer]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - mapDashboardLayer helper follows mapWidget pattern (JSON.parse config column)
    - reorderDashboardLayers uses db.transaction() for atomic position normalisation 0..N-1
    - reorder route registered BEFORE :layerId parameterised route (Express route precedence lock)
    - supertest specs use vi.stubEnv("AUTH_MODE", "password") + jwt session cookie (Phase 11 lock)

key-files:
  created:
    - kinetica_bi/server/tests/layers.spec.ts
  modified:
    - kinetica_bi/server/src/types.ts
    - kinetica_bi/server/src/db.ts
    - kinetica_bi/server/src/index.ts

key-decisions:
  - "table_id is a soft FK (no REFERENCES tables(id)) — layers survive table deletion; frontend renders error badge; ON DELETE CASCADE is only on dashboard_id"
  - "reorderDashboardLayers throws on count mismatch or unknown id; caller sends full ordered list; eliminates position gaps from prior deletes"
  - "Reorder route registered before :layerId route to prevent Express treating 'reorder' as a layerId literal"
  - "Test file named layers.spec.ts (not .test.ts) to match vitest include: tests/**/*.spec.ts pattern"
  - "All test requests carry session cookie (vi.stubEnv AUTH_MODE=password + jwt.sign) per Phase 11 lock"

patterns-established:
  - "Layer soft FK: table_id has no REFERENCES constraint; layers survive table deletion with stale table_id"
  - "Express route ordering: literal routes (reorder) always registered before parameterised routes (:layerId)"

requirements-completed:
  - LAYER-01-backend-schema
  - LAYER-02-backend-crud

# Metrics
duration: 6min
completed: "2026-05-06"
---

# Phase 12 Plan 01: Dashboard Layers Backend Summary

**SQLite `dashboard_layers` table + Express CRUD/reorder routes + 13-test supertest spec with soft FK, ON DELETE CASCADE, and route-precedence locking**

## Performance

- **Duration:** 6 min
- **Started:** 2026-05-06T00:18:32Z
- **Completed:** 2026-05-06T00:24:40Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- New `dashboard_layers` SQLite table with CHECK constraint (`layer_type = 'KineticaWms'`), `dashboard_id` ON DELETE CASCADE, and soft FK on `table_id` (layers survive table deletion)
- 6 CRUD functions exported from db.ts: list, get, create, update, delete, reorder — with `reorderDashboardLayers` using a single `db.transaction()` to normalise positions 0..N-1
- 5 Express routes mounted with route-precedence lock (reorder before :layerId); full input validation on POST (table_id required, layer_type enum guard)
- 13 supertest tests all passing: happy-path CRUD, validation errors, reorder + edge cases, route-precedence proof, dashboard delete cascade, soft-FK no-cascade on table delete

## Task Commits

1. **Task 1: Add DashboardLayer type + dashboard_layers DDL + CRUD functions** - `dd55e3e` (feat)
2. **Task 2: Express CRUD routes + reorder + supertest coverage** - `40fa271` (feat)

## Files Created/Modified
- `kinetica_bi/server/src/types.ts` - Added `LayerType` and `DashboardLayer` types
- `kinetica_bi/server/src/db.ts` - Added dashboard_layers DDL, mapDashboardLayer helper, 6 CRUD exports
- `kinetica_bi/server/src/index.ts` - Imported 6 new db functions; mounted 5 layer routes
- `kinetica_bi/server/tests/layers.spec.ts` - 13 supertest tests (created)

## Decisions Made
- **Soft FK on table_id**: No `REFERENCES tables(id)` constraint so layers survive table deletion — frontend renders a "Table removed — reconfigure" badge. Hard FK would auto-delete layers on table removal which is undesirable UX.
- **reorderDashboardLayers throws, not silently ignores**: Count mismatch and unknown id both throw (caught by route and returned as 400) rather than silently succeeding on partial input. This enforces the invariant that the caller always sends the full ordered list.
- **Test file extension fix**: Plan specified `layers.test.ts` but the vitest config uses `include: tests/**/*.spec.ts`. Renamed to `layers.spec.ts` — [Rule 3: auto-fix blocking issue].
- **Session cookie in tests**: All test requests carry a jwt session cookie because `app.use("/api", requireAuth)` protects all `/api` routes. Pattern mirrors `routes.wms.cache-control.spec.ts`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Test file renamed from .test.ts to .spec.ts**
- **Found during:** Task 2 (verifying supertest spec)
- **Issue:** Plan specified filename `layers.test.ts` but `vitest.config.ts` include pattern is `tests/**/*.spec.ts` — vitest reported "No test files found" for the .test.ts extension
- **Fix:** Renamed file to `layers.spec.ts` to match the include pattern
- **Files modified:** kinetica_bi/server/tests/layers.spec.ts (created with correct name)
- **Verification:** `npx vitest run tests/layers.spec.ts` found and ran all 13 tests
- **Committed in:** 40fa271 (Task 2 commit)

**2. [Rule 2 - Missing Critical] Added session cookie to all test requests**
- **Found during:** Task 2 (first test run — all 13 tests returned 401)
- **Issue:** Plan's test harness pattern didn't include auth setup, but `app.use("/api", requireAuth)` guards all `/api` routes; requests without a valid session cookie return 401
- **Fix:** Added `vi.stubEnv("AUTH_MODE", "password")` + `createSession()` + `jwt.sign()` in `beforeEach` and `.set("Cookie", cookie)` on all requests — mirrors `routes.wms.cache-control.spec.ts` pattern (Phase 11 lock)
- **Files modified:** kinetica_bi/server/tests/layers.spec.ts
- **Verification:** All 13 tests pass; session is stable across all test bodies
- **Committed in:** 40fa271 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing critical)
**Impact on plan:** Both auto-fixes necessary for the tests to run at all. No scope creep.

## Issues Encountered
- None beyond the two auto-fixed deviations above.

## Next Phase Readiness
- `dashboard_layers` table, all CRUD functions, and 5 Express routes are ready for Phase 12 Plan 02 (frontend API client + Zustand store)
- Route surface: `GET/POST /api/dashboards/:id/layers`, `PATCH /api/dashboards/:id/layers/reorder`, `PATCH/DELETE /api/dashboards/:id/layers/:layerId`
- Soft FK semantics documented in code and tests — frontend Plans 12-03/12-05 must check whether `layer.table_id` is still in `associatedTables` before rendering

---
*Phase: 12-dashboard-layers-panel*
*Completed: 2026-05-06*
