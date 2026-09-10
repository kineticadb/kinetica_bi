---
phase: 26-server-spatial-where
plan: 3
subsystem: api
tags: [kinetica, spatial, sql, where-clause, supertest, vitest, typescript, auth-modes]

# Dependency graph
requires:
  - phase: 26-server-spatial-where
    provides: spatialWhereClause.ts (Plan 01) + extended POST /api/filter/materialize (Plan 02)
provides:
  - routes.filter-materialize-spatial.spec.ts with 26 supertest tests across AUTH_MODE=password + oidc
  - V15-P-07 load-bearing 2-shape+1-col paren assertion at supertest level (defense-in-depth over Plan 01 unit test)
  - WHERE-V15-04 complete: all spatial endpoint scenarios covered
affects:
  - 29-draw-ux (first multi-shape UI will be locked out of silent paren-regression by this spec)
  - 30-materialize-trigger-wiring (Phase 30 body shape contract verified end-to-end here)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dual AUTH_MODE describe blocks: identical 13 it() cases × 2 = 26 tests; password uses makeSessionCookie, oidc uses seedOidcSession"
    - "Auth fixtures copied verbatim from routes.filter-materialize.spec.ts — spec is self-contained and runnable in isolation"
    - "WHERE-clause portion extracted (statement.slice(statement.indexOf('WHERE ') + 6)) to avoid counting 'CREATE OR REPLACE' in OR separator count assertions"
    - "getKineticaStatement helper: finds /execute/sql fetch call and extracts body.statement; returns undefined for 501 assertions"
    - "spatialFilters-without-spatialTarget test: includes colFilter to bypass step-2 empty-input check and reach step-3 pair-completeness check"

key-files:
  created:
    - kinetica_bi/server/tests/routes.filter-materialize-spatial.spec.ts
  modified: []

key-decisions:
  - "WHERE clause extracted for OR-count assertion: 'CREATE OR REPLACE' in the DDL preamble also contains ' OR ', so the naive statement.match(/ OR /g) count for 3 shapes was 3 (2 shape ORs + 1 DDL OR) not 2. Fix: slice statement from WHERE onwards before counting."
  - "spatialFilters-without-spatialTarget fixture uses filters: [colFilter]: sending filters: [] + spatialFilters: [SHAPE_1] + no spatialTarget triggers step 2 (empty-input 400) before step 3 (pair-completeness 400). Adding colFilter bypasses step 2 and lets step 3 fire the correct 'spatialTarget is required' message."
  - "Spec kept as sibling (not modification of v1.3 spec): routes.filter-materialize.spec.ts stays at 23/23 untouched. Auth fixtures duplicated verbatim for spec isolation."

patterns-established:
  - "WHERE-portion slicing pattern for OR-count: statement.slice(statement.indexOf('WHERE ') + 6) safely isolates predicate body from DDL keywords"
  - "Step ordering awareness in fixture design: validation step 2 (empty-input) fires before step 3 (pair-completeness) — fixtures must satisfy upstream steps to reach downstream assertions"

requirements-completed:
  - WHERE-V15-04

# Metrics
duration: 5min
completed: 2026-05-12
---

# Phase 26 Plan 3: Supertest Coverage Summary

**New supertest spec with 26 tests (13 × 2 AUTH_MODE) covering all Phase 26 spatial paths; V15-P-07 load-bearing 2-shape+1-col paren assertion locks out silent multi-shape regression at the supertest level**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-05-12T14:47:44Z
- **Completed:** 2026-05-12T14:52:15Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Created `routes.filter-materialize-spatial.spec.ts` with 26 tests (13 cases × 2 AUTH_MODE blocks)
- V15-P-07 load-bearing 2-shape+1-col assertion at lines 295 (password block) and 600 (oidc block) — exact paren substring:
  `(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))')) = 1 OR STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('POLYGON((2 2, 3 2, 3 3, 2 3, 2 2))')) = 1) AND (zone = 'East Village')`
- WKB 501 body verified via `toEqual({ error: "WKB mode deferred", td: "TD-V14-WKB-SPIKE" })`
- Zero `/execute/sql` fetch calls verified for WKB path (early-return proof)
- ST_INTERSECTS (not ST_WITHIN) verified for wkt mode
- All 5 validation paths covered: empty input, spatialFilters-without-spatialTarget, spatialTarget-without-spatialFilters, tableId mismatch, WKB 501
- Audit-log op tag "MATERIALIZE" verified for combined input
- `routes.filter-materialize.spec.ts` (23/23) untouched and still green
- `lib.spatialWhereClause.spec.ts` (17/17) untouched and still green

## Task Commits

1. **Task 1: Create routes.filter-materialize-spatial.spec.ts** — `7a324d3` (test)

## Files Created/Modified

- `kinetica_bi/server/tests/routes.filter-materialize-spatial.spec.ts` — 26-test sibling spec; auth fixtures verbatim from v1.3 reference spec

## Test Results

- `routes.filter-materialize-spatial.spec.ts`: **26/26 green** (new Phase 26 spec)
- `routes.filter-materialize.spec.ts`: **23/23 green** (v1.3 backward compat unchanged)
- `lib.spatialWhereClause.spec.ts`: **17/17 green** (Plan 01 unit spec unchanged)
- **Total Phase 26 tests: 66** (23 + 17 + 26)
- `npx tsc --noEmit`: **exit 0** (no TypeScript errors)

## V15-P-07 Load-Bearing Assertion Location

- **Password block:** line 295
- **OIDC block:** line 600
- Both assert the EXACT paren structure: `(s1 OR s2) AND (col)` — locks out the silent multi-shape AND-precedence regression BEFORE any multi-shape UI exists (Phase 29)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed OR-count assertion for 3-shape spatial-only test**
- **Found during:** Task 1, first test run
- **Issue:** DDL string is `CREATE OR REPLACE MATERIALIZED VIEW ... WHERE (pred1 OR pred2 OR pred3)`. The DDL preamble `CREATE OR REPLACE` contains ` OR `, so counting ` OR ` across the full statement for 3 shapes returned 3 (2 shape ORs + 1 DDL OR) instead of 2.
- **Fix:** Extract WHERE clause portion before counting: `const whereClause = statement.slice(statement.indexOf("WHERE ") + 6)` then count `(whereClause.match(/ OR /g) ?? []).length`.
- **Files modified:** `routes.filter-materialize-spatial.spec.ts` (both password and oidc describe blocks)
- **Commit:** inline before task commit `7a324d3`

**2. [Rule 1 - Bug] Fixed spatialFilters-without-spatialTarget fixture to bypass step-2 check**
- **Found during:** Task 1, first test run
- **Issue:** Test sent `filters: [], spatialFilters: [SHAPE_1]` with no `spatialTarget`. The endpoint's step 2 (empty-input check): `!hasFilters && (!hasSpatial || !spatialTarget)` = `true && (false || true)` = `true` — fires with "non-empty" message before step 3 (pair-completeness) can fire.
- **Fix:** Include `filters: [colFilter]` so `hasFilters=true`, bypassing step 2. Step 3 then correctly fires: `hasSpatial && !spatialTarget` → 400 "spatialTarget is required".
- **Files modified:** `routes.filter-materialize-spatial.spec.ts` (both password and oidc describe blocks)
- **Commit:** inline before task commit `7a324d3`

## Issues Encountered

Two test design issues discovered on first run, both auto-fixed:
1. OR-count interference from `CREATE OR REPLACE` in DDL preamble
2. Validation step ordering requiring column filter in pair-completeness test

Both were Rule 1 auto-fixes (test assertions reflecting actual endpoint behavior incorrectly). No endpoint code changes required.

## User Setup Required

None.

## Phase 26 Total Test Count

| Spec | Plan | Tests | Status |
|------|------|-------|--------|
| `routes.filter-materialize.spec.ts` | 13-03 | 23 | green |
| `lib.spatialWhereClause.spec.ts` | 26-01 | 17 | green |
| `routes.filter-materialize-spatial.spec.ts` | 26-03 | 26 | green |
| **Total** | | **66** | **all green** |

## Next Phase Readiness

- WHERE-V15-04 satisfied: all spatial endpoint scenarios covered at supertest level
- Phase 27 (frontend spatial filter store) has a stable server contract verified by 26 tests
- Phase 29 (draw UX) V15-P-07 paren regression is locked at two levels: Plan 01 unit tests + Plan 03 supertest
- Phase 30 (materialize trigger wiring) body shape `{ dashboardId, tableId, filters, spatialFilters?, spatialTarget? }` verified end-to-end

---
*Phase: 26-server-spatial-where*
*Completed: 2026-05-12*
