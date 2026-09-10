---
phase: 26-server-spatial-where
plan: 1
subsystem: api
tags: [kinetica, spatial, sql, where-clause, tdd, vitest, typescript]

# Dependency graph
requires:
  - phase: 25-spatial-predicate-spike
    provides: locked SQL predicate templates for STXY_WITHIN (latlon) and ST_INTERSECTS (wkt) modes
  - phase: 13-spikes-and-endpoint
    provides: whereClause.ts with escapeKineticaStringLiteral, buildServerWhereClause, ActiveFilter type
provides:
  - spatialWhereClause.ts pure module with buildSpatialOrBlock + composeWhereClause + SpatialFilter/SpatialTarget/SpatialMode types + SpatialFilterWkbDeferredError
  - lib.spatialWhereClause.spec.ts with 17 unit tests locking V15-P-07 paren invariant
affects:
  - 26-02-materialize-endpoint (imports composeWhereClause + types)
  - 26-03-supertest-coverage (integration coverage of composeWhereClause path)
  - 29-draw-ux (sends shape WKT to server SpatialFilter.wkt)
  - 30-materialize-trigger-wiring (client helper projects Shape -> SpatialFilter slice)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "V15-P-07 paren lock: buildSpatialOrBlock always wraps OR chain in outer parens — single-shape AND multi-shape"
    - "Pure module discipline: single import from ./whereClause, no Express/db/kinetica.ts deps"
    - "TDD with full-string .toBe assertions (not .toContain) for SQL output correctness"
    - "SpatialMode defined locally (not re-exported from spatialQuery.ts) for cross-lib-import-free discipline"
    - "Fail-loud mode/column coherence: plain Error thrown for incoherent target (route handler -> 400)"

key-files:
  created:
    - kinetica_bi/server/src/lib/spatialWhereClause.ts
    - kinetica_bi/server/tests/lib.spatialWhereClause.spec.ts
  modified: []

key-decisions:
  - "SpatialMode defined locally in spatialWhereClause.ts (not imported from spatialQuery.ts) — zero cross-lib import for a trivial union type; both modules coexist independently"
  - "buildSpatialOrBlock throws SpatialFilterWkbDeferredError for wkb mode regardless of shape count — static guarantee even though production route handler returns 501 before invoking builder"
  - "composeWhereClause accepts target: SpatialTarget | null (not target?: SpatialTarget) — explicit null-vs-missing distinction is cleaner with TypeScript strict mode"
  - "Kinetica server version not captured (follow-up action: run SHOW SYSTEM PROPERTIES against http://172.31.0.22:8082/gpudb-0 and record in PLAN frontmatter)"

patterns-established:
  - "V15-P-07: Outer parens are buildSpatialOrBlock's sole responsibility — composeWhereClause and route handler never re-wrap"
  - "composeWhereClause 4-case composition: (spatial AND col) / spatial-only / col-only / 1=1"
  - "Trust boundary mirrors whereClause.ts: column-name identifiers interpolated raw, WKT literals escaped"

requirements-completed:
  - WHERE-V15-01
  - WHERE-V15-02

# Metrics
duration: 3min
completed: 2026-05-12
---

# Phase 26 Plan 1: Spatial WHERE Builder Summary

**Pure server module `spatialWhereClause.ts` with STXY_WITHIN/ST_INTERSECTS OR-chain builder + 4-case composer, locked by 17 unit tests asserting V15-P-07 paren correctness**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-05-12T14:38:57Z
- **Completed:** 2026-05-12T14:41:37Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Created `spatialWhereClause.ts` pure module exporting `buildSpatialOrBlock`, `composeWhereClause`, `SpatialFilter`, `SpatialTarget`, `SpatialMode`, and `SpatialFilterWkbDeferredError`
- LATLON predicate locked from 25-SPIKE-NOTES §3.1: `STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT(?)) = 1`
- WKT predicate locked from 25-SPIKE-NOTES §3.2: `ST_INTERSECTS(geom, ST_GEOMFROMTEXT(?)) = 1` (NOT ST_WITHIN — correctly rejected)
- Created `lib.spatialWhereClause.spec.ts` with 17/17 passing tests; load-bearing V15-P-07 assertion uses `.toBe` (full string, not `.toContain`)
- No regression: `lib.whereClause.spec.ts` 16/16 still green; `tsc --noEmit` clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Create spatialWhereClause.ts pure module** - `8b3104f` (feat)
2. **Task 2: Unit tests for spatialWhereClause.ts** - `19170b9` (test)

_Note: Both tasks used TDD approach — implementation written with locked behavior spec, then tests verified against it._

## Files Created/Modified

- `kinetica_bi/server/src/lib/spatialWhereClause.ts` — Pure SQL builder: `buildSpatialOrBlock` (OR-chain with V15-P-07 outer parens) + `composeWhereClause` (4-case composition) + types + error class
- `kinetica_bi/server/tests/lib.spatialWhereClause.spec.ts` — 17 unit tests across 3 describe blocks; load-bearing V15-P-07 full-string assertions

## Decisions Made

- **SpatialMode local definition:** `SpatialMode` defined locally in `spatialWhereClause.ts` rather than re-exported from `spatialQuery.ts`. Rationale: zero cross-lib dependency for a trivial `"latlon" | "wkt" | "wkb"` union; both files coexist independently; `spatialQuery.ts` uses the same literal names. Future refactor (if needed) is trivial.

- **`target: SpatialTarget | null` vs `target?: SpatialTarget`:** Chose explicit `| null` for `composeWhereClause`'s third parameter. TypeScript strict mode makes the explicit `null` cleaner — callers must explicitly pass `null` rather than accidentally omitting the argument.

- **WKB throws regardless of shape count:** `buildSpatialOrBlock` throws `SpatialFilterWkbDeferredError` on `spatialMode === "wkb"` even when `shapes.length === 0`. This is intentional — the throw is a static guarantee that the WKB code path cannot silently produce SQL. The empty-shapes early-return is placed AFTER the WKB check.

- **Kinetica server version not captured (deferred action):** 25-SPIKE-NOTES §4.1 recommended capturing version via `SHOW SYSTEM PROPERTIES` before Phase 26 ships. This is a human-run follow-up. The predicates are valid regardless of version; version capture is for audit/re-validation purposes.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None — implementation and tests compiled and passed on first attempt. TypeScript type inference handled `target.lonCol` / `target.latCol` narrowing correctly within the conditional blocks.

## User Setup Required

None — no external service configuration required.

## Human Follow-up (not blocking)

- **Kinetica server version:** Run `SHOW SYSTEM PROPERTIES` against `http://172.31.0.22:8082/gpudb-0` and record the version in Phase 26's PLAN frontmatter (25-SPIKE-NOTES §4.1 follow-up for future re-validation if Kinetica is upgraded).

## Next Phase Readiness

- `spatialWhereClause.ts` is ready for Plan 02 (materialize endpoint) to import `composeWhereClause`, `SpatialFilter`, `SpatialTarget`, and `SpatialFilterWkbDeferredError`
- Plan 03 (supertest coverage) can import all types and use the locked predicate strings for assertion fixtures
- WHERE-V15-01 and WHERE-V15-02 requirements verified by 17/17 unit tests

---
*Phase: 26-server-spatial-where*
*Completed: 2026-05-12*
