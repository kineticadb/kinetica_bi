---
phase: 11-map-chart
plan: 01
subsystem: api
tags: [kinetica, wms, cache-control, spike, openlayers]

requires:
  - phase: 09-filter-foundation
    provides: filterVersion, useFilterStore — cache-buster approach for WMS tile invalidation
  - phase: kinetica-wms-proxy
    provides: /api/wms route in kinetica_bi/server/src/index.ts

provides:
  - "Cache-Control: no-store on every /api/wms response (PITFALL M-08 lock)"
  - "11-SPIKE-NOTES.md: locked Kinetica WMS param names for downstream wmsUrlBuilder.ts"
  - "wmsSpike.ts: reusable spike runner for re-probing after Kinetica upgrades"

affects: [11-02-wms-url-builder, 11-03-capabilities-endpoint, 11-04-map-chart-renderer, 11-05-map-config-panel]

tech-stack:
  added: []
  patterns:
    - "WMS route header-before-call: res.setHeader(Cache-Control) as first statement so error paths still emit it"
    - "Spike script pattern: standalone tsx script with dotenv.config() reading server .env; not part of Express app"
    - "vi.stubEnv(AUTH_MODE, password) in tests that use password-mode sessions against an oidc-mode .env"

key-files:
  created:
    - kinetica_bi/server/src/wmsSpike.ts
    - kinetica_bi/server/tests/routes.wms.cache-control.spec.ts
    - .planning/phases/11-map-chart/11-SPIKE-NOTES.md
  modified:
    - kinetica_bi/server/src/index.ts
    - kinetica_bi/server/package.json
    - .gitignore

key-decisions:
  - "X_ATTR/Y_ATTR are the correct Kinetica WMS spatial column params (X_COLUMN_NAME/Y_COLUMN_NAME rejected with XML error)"
  - "GEO_ATTR is the correct param for WKT/WKB geometry columns (confirmed by error message content)"
  - "classbreak and contour STYLES are supported by deployed Kinetica but NOT listed in GetCapabilities XML — do not gate UI on capabilities XML"
  - "All 8 colormaps (viridis, plasma, inferno, magma, cividis, turbo, jet, hot) confirmed HTTP 200"
  - "POINTOPACITY: use separate POINTOPACITY param (both approaches work; separate is cleaner for independent color+opacity controls)"
  - "EPSG:3857 confirmed accepted; lock OL View to EPSG:3857 (PITFALL M-03)"
  - "QUERY filter param: accepted without error but tile output identical with/without filter in all probe cases — mark as PARTIALLY VERIFIED; validate in Plan 11-03/11-04"
  - "ST_Envelope spelling: ST_XMin/ST_XMax/ST_YMin/ST_YMax provisionally correct (encoding error vs function-not-found error); validate in Plan 11-05 against real geometry column"
  - "Test spec in tests/ dir (not src/): vitest config includes only tests/**/*.spec.ts; index.spec.ts path from plan adjusted accordingly"
  - "vi.stubEnv(AUTH_MODE, password) required in WMS tests: server .env has AUTH_MODE=oidc which causes boot-time session wipe when createApp() is called"

requirements-completed: [MAP-01, FILT-04]

duration: 13min
completed: 2026-05-05
---

# Phase 11 Plan 01: WMS Spike and Cache-Control Summary

**Kinetica WMS param names locked via GetCapabilities spike (X_ATTR/Y_ATTR/GEO_ATTR confirmed), Cache-Control: no-store added to /api/wms, QUERY filter partially verified**

## Performance

- **Duration:** ~13 min
- **Started:** 2026-05-05T13:30:16Z
- **Completed:** 2026-05-05T13:43:41Z
- **Tasks:** 3
- **Files modified:** 6 (index.ts, package.json, .gitignore) + 3 created (wmsSpike.ts, routes.wms.cache-control.spec.ts, 11-SPIKE-NOTES.md)

## Accomplishments
- Cache-Control: no-store added as first statement in /api/wms handler (PITFALL M-08 lock; header set before kineticaWms call so error paths also emit it)
- Two supertest assertions verify M-08 on both success and upstream-error paths
- WMS GetCapabilities spike ran against deployed Kinetica (http://172.31.0.22:8082/gpudb-0) and produced 42507-char capabilities XML
- X_ATTR/Y_ATTR confirmed as correct spatial column params; X_COLUMN_NAME/Y_COLUMN_NAME definitively rejected
- GEO_ATTR confirmed as correct geometry column param (WKT/WKB mode)
- All 8 colormaps confirmed HTTP 200; classbreak/contour confirmed HTTP 200 despite not appearing in GetCapabilities XML
- EPSG:3857 confirmed accepted; lock OL View to EPSG:3857
- POINTOPACITY: separate param confirmed; both separate POINTOPACITY and 8-digit RRGGBBAA work

## Task Commits

1. **Task 1: Cache-Control: no-store to /api/wms + spec** - `e3afc0f` (feat)
2. **Task 2: WMS GetCapabilities spike runner + execution** - `a8fac7e` (feat)
3. **Task 3: Write 11-SPIKE-NOTES.md** - `b2002fd` (feat)

## Files Created/Modified
- `kinetica_bi/server/src/index.ts` - Added Cache-Control: no-store header + PITFALL M-08 comment in /api/wms handler
- `kinetica_bi/server/tests/routes.wms.cache-control.spec.ts` - Two supertest assertions for M-08 on success and error paths
- `kinetica_bi/server/src/wmsSpike.ts` - Standalone tsx spike script (GetCapabilities, ST_Envelope, SRS, POINTOPACITY probes)
- `kinetica_bi/server/package.json` - Added "wms-spike" npm script
- `.gitignore` - Added wmsCapabilities.xml to gitignore
- `.planning/phases/11-map-chart/11-SPIKE-NOTES.md` - Full param-name lookup table for downstream wmsUrlBuilder.ts

## Decisions Made
- `vi.stubEnv("AUTH_MODE", "password")` required in new WMS tests: the server .env has `AUTH_MODE=oidc` which triggers boot-time session wipe in `createApp()`, purging password-mode sessions created by tests before `buildTestApp()` is called. The existing `routes.wms.spec.ts` tests also fail for this reason (pre-existing issue, out of scope).
- Test file placed in `tests/` directory (not `src/`): vitest config uses `include: ["tests/**/*.spec.ts"]` — the plan's reference to `src/index.spec.ts` was adjusted to `tests/routes.wms.cache-control.spec.ts`.
- QUERY filter param: all probe variants (QUERY, CQL_FILTER, WHERE, EXPRESSION, FILTER, etc.) returned byte-identical tiles. Documented in 11-SPIKE-NOTES.md Caveats. Downstream wmsUrlBuilder.ts should use QUERY (matches Kinetica API documentation); validate actual filter effect in Plan 11-03/11-04 integration testing.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test file path adjusted from src/index.spec.ts to tests/routes.wms.cache-control.spec.ts**
- **Found during:** Task 1
- **Issue:** Vitest config uses `include: ["tests/**/*.spec.ts"]` — files in `src/` are not picked up. Plan specified `src/index.spec.ts` but the project test convention places specs in `tests/`.
- **Fix:** Created spec in `tests/routes.wms.cache-control.spec.ts` with the exact test names from plan acceptance criteria.
- **Files modified:** kinetica_bi/server/tests/routes.wms.cache-control.spec.ts (created)
- **Verification:** `npm test -- routes.wms.cache-control` exits 0, 2 tests pass.
- **Committed in:** e3afc0f (Task 1 commit)

**2. [Rule 2 - Missing Critical] Added vi.stubEnv("AUTH_MODE", "password") to prevent boot-time session wipe**
- **Found during:** Task 1 (first test run)
- **Issue:** Server .env has `AUTH_MODE=oidc`. When `buildTestApp()` calls `createApp()`, the boot hardening wipes all password-mode sessions, invalidating the test session created before app boot.
- **Fix:** Added `vi.stubEnv("AUTH_MODE", "password")` in `beforeEach` and `vi.unstubAllEnvs()` in `afterEach` — matches the pattern used in `boot.wipe.spec.ts` and `boot.hardening.spec.ts`.
- **Files modified:** kinetica_bi/server/tests/routes.wms.cache-control.spec.ts
- **Verification:** Both tests pass after fix.
- **Committed in:** e3afc0f (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 bug fix, 1 missing critical)
**Impact on plan:** Both fixes required for test correctness. No scope creep. Plan spec list (STYLES, params, SRS, colormaps, ST_Envelope, POINTOPACITY) fully covered in SPIKE-NOTES.md.

## Issues Encountered
- ST_Envelope probe against synthetic `ST_GeomFromText('POINT(1 2)')` failed with "unknown encoding" error — not a function-not-found error. Provisionally interpreted as a serialization issue when returning raw geometry types; ST_XMin(ST_Envelope(geom_col)) returning a float should work. Validate in Plan 11-05.
- QUERY filter param effect unverifiable with demo.nyctaxi (all lat/lon numeric columns, dense data — PNG tile bytes identical with/without filter). Documented in SPIKE-NOTES.md Caveats; validate in Plan 11-03/11-04 with geometry-typed table.
- classbreak/contour absent from GetCapabilities per-layer Style elements — direct GetMap probes return HTTP 200. Document says don't gate UI on capabilities.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- 11-SPIKE-NOTES.md is the single source of truth for WMS param names for all downstream Wave 2 plans
- Wave 2 plans (11-02 wmsUrlBuilder, 11-03 capabilities endpoint, 11-04 MapChartRenderer) can proceed with HIGH confidence on X_ATTR/Y_ATTR/GEO_ATTR param names and STYLES values
- Cache-Control: no-store ships on /api/wms (M-08 lock complete)
- QUERY filter param: use in wmsUrlBuilder; validate end-to-end in 11-04
- ST_Envelope SQL: use ST_XMin/ST_XMax/ST_YMin/ST_YMax spelling; validate in 11-05 bbox helper

---
*Phase: 11-map-chart*
*Completed: 2026-05-05*
