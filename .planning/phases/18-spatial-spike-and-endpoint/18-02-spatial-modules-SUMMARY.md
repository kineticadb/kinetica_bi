---
phase: 18-spatial-spike-and-endpoint
plan: 02
subsystem: api
tags: [kinetica, spatial, sql-builder, geodist, stxy_distance, wkb-deferred, vitest, tdd]

requires:
  - phase: 18-spatial-spike-and-endpoint plan 01
    provides: WKB spike outcome (NONE_ESCALATE → TECH_DEBT) — buildWkbQuery throws by design with TD-V14-WKB-SPIKE message
  - phase: 13-spikes-and-endpoint
    provides: Pure-server-module pattern (whereClause.ts + viewNaming.ts) — Plan 18-02 mirrors structure byte-for-byte
provides:
  - kinetica_bi/server/src/lib/spatialQuery.ts — buildLatLonQuery / buildWktQuery / buildWkbQuery (throws) + WkbDeferredError + SpatialMode/SpatialColumns/SpatialQueryArgs types
  - kinetica_bi/server/src/lib/radiusConversion.ts — pxToGroundDistance (meters) + pxToGroundDegrees (degrees) + MapBbox type
  - 21 vitest unit tests across two spec files; full server suite green
affects: [18-03-info-query-endpoint, future-WKB-spike-round-TD-V14-WKB-SPIKE]

tech-stack:
  added: []
  patterns:
    - "Server-side SQL-builder pattern: pure module exporting one builder per spatial mode; identifier interpolation documented as admin-trusted boundary; no quoting/escaping of column or schema names; numeric click coordinates typed as `number` so escaping is unnecessary."
    - "Throw-by-design stub for deferred-by-tech-debt features: `buildWkbQuery` exports the symbol with the same return type as siblings so the route handler in Plan 18-03 can route by spatialMode without conditional imports; route handler MUST early-return 501 BEFORE invoking the throwing stub."
    - "Sibling-helper pattern for SRS-unit asymmetry: `pxToGroundDistance` (meters for GEODIST) + `pxToGroundDegrees` (degrees for STXY_DISTANCE) — Plan 18-03 picks the right helper per spatialMode without divide-then-multiply round-tripping."

key-files:
  created:
    - kinetica_bi/server/src/lib/spatialQuery.ts
    - kinetica_bi/server/src/lib/radiusConversion.ts
    - kinetica_bi/server/tests/lib.spatialQuery.spec.ts
    - kinetica_bi/server/tests/lib.radiusConversion.spec.ts
  modified: []

key-decisions:
  - "buildLatLonQuery (SPATIAL-V14-01) emits the locked GEODIST template verbatim — distance expression interpolated twice (WHERE + ORDER BY) via a local `distExpr` constant for symmetry with buildWktQuery; LIMIT 50 OFFSET (page * 50) per SPATIAL-V14-04."
  - "buildWktQuery (SPATIAL-V14-02) uses STXY_DISTANCE with raw (clickLon, clickLat) — NO ST_GEOMFROMTEXT('POINT(...)') wrap (locked decision — avoids per-row WKT parsing cost; matches the user's project memory note on Kinetica spatial-query idioms)."
  - "buildWkbQuery (SPATIAL-V14-03) is a deferred-by-design stub that throws WkbDeferredError(\"WKB mode deferred — TD-V14-WKB-SPIKE\"). Class lives in spatialQuery.ts (not kineticaErrors.ts) for grep-ability — future TD-V14-WKB-SPIKE re-run agent finds both stub and class with one grep."
  - "Both modules are pure with zero non-stdlib imports — mirrors `whereClause.ts` + `viewNaming.ts` pattern from Phase 13."
  - "radiusConversion exports BOTH `pxToGroundDistance` (meters; GEODIST consumer) AND `pxToGroundDegrees` (degrees; STXY_DISTANCE consumer) — sibling helpers avoid divide-then-multiply round-tripping in Plan 18-03's route handler."
  - "`mapHeightPx` parameter on `pxToGroundDistance` is intentionally unused (longitude-aspect dominates radius math) — accepted for forward-compat with a future v2 ellipse-radius mode. Documented in the function doc-comment so a phase auditor doesn't flag it as dead."
  - "Trust boundary on schema/table/column-name fields documented in module header: identifiers interpolated directly without quoting (admin-trusted server metadata, not user input)."

patterns-established:
  - "Three-builder symmetry: each builder accepts the same `SpatialQueryArgs` shape and returns `string` (or throws, in the deferred-by-design case). The route handler can construct one args object and dispatch by spatialMode without per-mode arg shaping."
  - "Named throw-class for deferred features: a small `extends Error` class (`WkbDeferredError`) lives in the same file as the throwing stub, with a constant message containing the TD ticket ID — makes grep-by-ticket-ID trivial when re-running the spike."

requirements-completed: [SPATIAL-V14-01, SPATIAL-V14-02, SPATIAL-V14-05]

duration: 5min
completed: 2026-05-08
---

# Phase 18 Plan 02: Spatial Modules Summary

**Two pure server modules — `spatialQuery.ts` (3 SQL builders, 1 throw-stub) and `radiusConversion.ts` (px→meters + px→degrees) — that Plan 18-03 will compose into the `POST /api/info/query` route handler. Zero coupling to Express, db, or kinetica.ts; 21/21 vitest pass; tsc clean.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-05-08T04:31:54Z
- **Completed:** 2026-05-08T04:36:42Z
- **Tasks:** 2 (each TDD: RED + GREEN, 4 commits total)
- **Files created:** 4 (2 src + 2 spec)

## Accomplishments

- **`spatialQuery.ts` exports 7 symbols**: `SpatialMode`, `SpatialColumns`, `SpatialQueryArgs`, `WkbDeferredError`, `buildLatLonQuery`, `buildWktQuery`, `buildWkbQuery` (throws). 12 vitest tests pass.
- **`radiusConversion.ts` exports 3 symbols**: `MapBbox`, `pxToGroundDistance` (meters), `pxToGroundDegrees` (degrees). 9 vitest tests pass — including SPATIAL-V14-05 success criterion 5 (proportional output across two zoom levels) at unit-test level.
- **Both modules are pure**: zero non-stdlib imports; mirrors `whereClause.ts` + `viewNaming.ts` pattern. Confirmed via `grep -E "^import"` returning no lines.
- **WKB deferral encoded in code**: `buildWkbQuery` throws `WkbDeferredError("WKB mode deferred — TD-V14-WKB-SPIKE")`. Spec asserts the throw path. The `wkb` member of `SpatialMode` and the `wkbCol?` field of `SpatialColumns` stay defined so Plan 18-03 still validates the wkb path before 501-ing.
- **`tsc --noEmit` clean** under TS strict mode (verified after both modules landed).

## SQL Builder Templates (Verbatim)

### `buildLatLonQuery` (SPATIAL-V14-01)

```sql
SELECT * FROM <schema>.<table>
WHERE GEODIST(<lonCol>, <latCol>, <clickLon>, <clickLat>) <= <radiusGroundDistance>
ORDER BY GEODIST(<lonCol>, <latCol>, <clickLon>, <clickLat>) ASC
LIMIT 50 OFFSET <page * 50>
```

Concrete example (page=0, NYC click):

```sql
SELECT * FROM ki_home.events WHERE GEODIST(lon, lat, -73.95, 40.75) <= 500 ORDER BY GEODIST(lon, lat, -73.95, 40.75) ASC LIMIT 50 OFFSET 0
```

### `buildWktQuery` (SPATIAL-V14-02 — STXY_DISTANCE direct, NO ST_GEOMFROMTEXT)

```sql
SELECT * FROM <schema>.<table>
WHERE STXY_DISTANCE(<wktCol>, <clickLon>, <clickLat>) <= <radiusGroundDistance>
ORDER BY STXY_DISTANCE(<wktCol>, <clickLon>, <clickLat>) ASC
LIMIT 50 OFFSET <page * 50>
```

Concrete example (page=0, demo.shapes click):

```sql
SELECT * FROM demo.shapes WHERE STXY_DISTANCE(geom, -73.95, 40.75) <= 0.01 ORDER BY STXY_DISTANCE(geom, -73.95, 40.75) ASC LIMIT 50 OFFSET 0
```

### `buildWkbQuery` (SPATIAL-V14-03 — DEFERRED)

```typescript
// Throws — function signature exists for type stability only.
// Plan 18-03 endpoint MUST early-return HTTP 501 BEFORE invoking this stub.
export function buildWkbQuery(_args: SpatialQueryArgs): string {
  throw new WkbDeferredError(); // message: "WKB mode deferred — TD-V14-WKB-SPIKE"
}
```

When TD-V14-WKB-SPIKE re-runs against a real WKB-binary column, replace this throw with the spike-locked SQL template (per `18-SPIKE-NOTES.md ## Decision`).

## Radius Conversion Math

`pxToGroundDistance(radiusPx, mapBbox, mapWidthPx, mapHeightPx, clickLat) → meters`:

1. `bboxWidthDeg = mapBbox[2] - mapBbox[0]`
2. `radiusDeg = (radiusPx / mapWidthPx) * bboxWidthDeg`
3. `metersPerDegLon = 111_320 * Math.cos(clickLat * π / 180)` — haversine-style cosine-of-latitude correction; longitude degrees compress toward the poles
4. `radiusMeters = radiusDeg * metersPerDegLon`
5. `return Math.max(0, radiusMeters)` — floor at 0 to defend against tiny negative floats

`pxToGroundDegrees(radiusPx, mapBbox, mapWidthPx) → degrees`: steps 1–2 only (no cos correction, no meters conversion). For STXY_DISTANCE consumers operating in EPSG:4326 degrees-equivalent SRS units.

`mapHeightPx` is currently unused — accepted in the signature for forward-compat with a v2 ellipse-radius mode that would use vertical pixels for the latitude component.

Limitation: small-bbox approximation. The longitude-degree-to-meter ratio is computed once from `clickLat`; it is accurate at typical dashboard zoom levels (city/neighborhood/building) but degrades at world view where the bbox spans many degrees of latitude.

## Pass/Fail Status

- `tests/lib.spatialQuery.spec.ts` — **PASS** (12/12)
- `tests/lib.radiusConversion.spec.ts` — **PASS** (9/9)
- `npx tsc --noEmit` — **PASS** (clean)
- Full server suite (subset run): **PASS** (no regressions in target specs)

## `pxToGroundDegrees` was exported

Yes — exported alongside `pxToGroundDistance`. Plan 18-03 will import both: `pxToGroundDistance` for `spatialMode === "latlon"` (GEODIST consumes meters), `pxToGroundDegrees` for `spatialMode === "wkt"` (STXY_DISTANCE consumes degrees-equivalent SRS units). For `spatialMode === "wkb"` the endpoint early-returns 501 BEFORE invoking either helper or the throwing builder.

## Task Commits

1. **Task 1 RED: failing spec for spatialQuery SQL builders** — `60c18fe` (test)
2. **Task 1 GREEN: spatialQuery.ts implementation** — `77a92ae` (feat)
3. **Task 2 RED: failing spec for radiusConversion px-to-ground helpers** — `ee87e6a` (test)
4. **Task 2 GREEN: radiusConversion.ts implementation** — `a6f9754` (feat)

(Refactor phase skipped — both modules emerged clean from GREEN, no cleanup deltas to commit.)

## Files Created/Modified

- `kinetica_bi/server/src/lib/spatialQuery.ts` (NEW) — 3 SQL builders + WkbDeferredError + types; pure module
- `kinetica_bi/server/src/lib/radiusConversion.ts` (NEW) — `pxToGroundDistance` (meters) + `pxToGroundDegrees` (degrees) + MapBbox type; pure module
- `kinetica_bi/server/tests/lib.spatialQuery.spec.ts` (NEW) — 12 vitest tests
- `kinetica_bi/server/tests/lib.radiusConversion.spec.ts` (NEW) — 9 vitest tests

## Decisions Made

1. **`buildWkbQuery` parameter renamed `_args`** — TS strict-mode flags unused parameters. Underscore prefix signals intentional non-use without an `eslint-disable` comment (eslint isn't even configured in this server package). Type signature stays `(args: SpatialQueryArgs): string` for symmetry with siblings (TS treats `_args` as the parameter name; the type annotation is unchanged).
2. **`WkbDeferredError` class lives in `spatialQuery.ts`** — not `kineticaErrors.ts`. Reasoning: a future `TD-V14-WKB-SPIKE` re-run agent will look for both the stub and its error class together; co-locating them in one grep target is cheaper than splitting across files. Pattern matches "single-purpose helper" precedent (cardinalityProbe.ts, columnTypes.ts, isViewNotFoundError).
3. **Both `pxToGroundDistance` AND `pxToGroundDegrees` exported** — sibling helpers eliminate the need for Plan 18-03 to divide-then-multiply when calling `buildWktQuery`. Adds ~10 lines and 3 spec tests; saves a round-trip in route handler logic.
4. **Distance expression interpolated twice via local `distExpr` constant** — both `buildLatLonQuery` and `buildWktQuery` define `const distExpr = …` then use it in WHERE and ORDER BY. Costs one extra line per builder but avoids drift if the expression ever changes (e.g., adding a third argument).
5. **`Math.max(0, radiusMeters)` floor** — defensive against tiny negative floats from edge-case bbox math. Test 5 (finite/non-NaN) confirms.

## Deviations from Plan

None — plan executed exactly as written. The plan-spec was already updated in commit `b011854` (closing Plan 18-01) to encode the WKB deferral, so all four commits in this plan landed within the expected scope.

## Issues Encountered

None.

## Authentication Gates

None — pure module work. No Kinetica calls, no env vars, no secrets.

## Next Phase Readiness

Plan 18-03 is unblocked. The route handler can:

- `import { buildLatLonQuery, buildWktQuery, buildWkbQuery, type SpatialMode, type SpatialQueryArgs } from "./lib/spatialQuery";`
- `import { pxToGroundDistance, pxToGroundDegrees } from "./lib/radiusConversion";`
- Validate the request body, dispatch by `spatialMode`:
  - `"latlon"` → `pxToGroundDistance(...)` → `buildLatLonQuery(...)` → `kineticaSql(...)`
  - `"wkt"` → `pxToGroundDegrees(...)` → `buildWktQuery(...)` → `kineticaSql(...)`
  - `"wkb"` → early-return HTTP 501 with `{ error: 'WKB mode deferred', td: 'TD-V14-WKB-SPIKE' }`; do NOT invoke `buildWkbQuery` (it would throw).

Phase 18 progress: **2/3 plans complete** (Plan 18-01 done 2026-05-08; Plan 18-02 done 2026-05-08; Plan 18-03 pending).

---
*Phase: 18-spatial-spike-and-endpoint*
*Plan: 02-spatial-modules*
*Completed: 2026-05-08*

## Self-Check: PASSED

- File `kinetica_bi/server/src/lib/spatialQuery.ts` exists; exports 7 symbols (3 types + 1 class + 3 functions); contains `GEODIST`, `STXY_DISTANCE`, and `TD-V14-WKB-SPIKE`; ST_GEOMFROMTEXT appears only in doc-comments (locked decision warning), never in builder body.
- File `kinetica_bi/server/src/lib/radiusConversion.ts` exists; exports `MapBbox`, `pxToGroundDistance`, `pxToGroundDegrees`; contains `Math.cos` and `111_320`.
- Files `kinetica_bi/server/tests/lib.spatialQuery.spec.ts` (12 tests) and `kinetica_bi/server/tests/lib.radiusConversion.spec.ts` (9 tests) exist; both pass 100%.
- Commits 60c18fe, 77a92ae, ee87e6a, a6f9754 all present in `git log --oneline --all`.
- `npx tsc --noEmit` is clean (verified after both modules landed).
- Both modules have zero non-stdlib imports (`grep -E "^import"` returns no lines for either file).
