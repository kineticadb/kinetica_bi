---
phase: 71-shape-params-latlon-hide
plan: 02
subsystem: ui
tags: [wms, wmsUrlBuilder, spatialMode, latlon, classbreak, shape-params, kinetica-map]

# Dependency graph
requires:
  - phase: 71-shape-params-latlon-hide (Plan 01)
    provides: SHAPE* form-field hiding in KineticaWmsLayerForm + CbConfigForm per-break panel for latlon
provides:
  - "wmsUrlBuilder gate: SHAPE* (SHAPEFILLCOLORS/SHAPELINECOLORS/SHAPELINEWIDTHS) emission suppressed when config.spatialMode === \"latlon\" in BOTH the raster branch and the per-break classbreak branch"
  - "Leak prevention for stale saved shape values on latlon point layers — gate-only (values untouched, restored on wkt/wkb switch)"
  - "Raster + classbreak latlon leak-prevention regression tests + wkt no-regression assertions"
affects: [73-verification, map-wms-read-path, wmsUrlBuilder]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "spatialMode !== \"latlon\" emission gate mirrors the v1.9 Phase 53 spatialMode !== \"track\" POINT*/SHAPE* suppression precedent"

key-files:
  created: []
  modified:
    - packages/web/src/lib/wmsUrlBuilder.ts
    - packages/web/src/lib/wmsUrlBuilder.spec.ts

key-decisions:
  - "Gate emission only — never delete saved config/break shape values, so switching the layer back to wkt/wkb restores SHAPE* params"
  - "Migrated the 6 pre-existing raster SHAPE* normalization tests to spatialMode: \"wkt\" rather than deleting them — they now double as wkt no-regression coverage"

patterns-established:
  - "Emission-suppression by spatial mode: wrap SHAPE* param writes in an outer `if (config.spatialMode !== \"latlon\")` while keeping POINT*/CB_ATTR/CB_VALS unconditional"

requirements-completed: [SHAPE-V114-03]

# Metrics
duration: 6min
completed: 2026-06-18
---

# Phase 71 Plan 02: SHAPE* WMS Emission Suppressed for Lat/Lon Points Summary

**`wmsUrlBuilder` now omits SHAPEFILLCOLORS/SHAPELINECOLORS/SHAPELINEWIDTHS whenever `spatialMode === "latlon"` (raster AND classbreak), preventing stale saved shape values from leaking onto point layers — gate-only, so wkt/wkb emission is fully preserved.**

## Performance

- **Duration:** ~6 min
- **Completed:** 2026-06-18
- **Tasks:** 1 (TDD)
- **Files modified:** 2

## Accomplishments
- Wrapped the three raster SHAPE* `if` blocks (lines ~343-355) in an outer `config.spatialMode !== "latlon"` gate; POINTCOLORS/POINTOPACITY/POINTSIZES/POINTSHAPES/ANTIALIASING remain unconditional.
- Wrapped the three per-break classbreak SHAPE* `cb.breaks.some(...)` blocks (lines ~415-426) in the same gate; CB_ATTR/CB_VALS/POINTCOLORS/POINTSIZES/POINTSHAPES remain unconditional.
- Migrated the 6 pre-existing raster SHAPE* normalization tests to `spatialMode: "wkt"` (assertions unchanged) so they keep proving AARRGGBB normalization and now serve as wkt no-regression coverage.
- Added 5 new regression tests: raster latlon leak prevention, raster latlon POINT*/ANTIALIASING preserved, raster wkt no-regression, classbreak latlon leak prevention (CB_* preserved), classbreak wkt no-regression.

## Task Commits

1. **Task 1: Gate raster + classbreak SHAPE* emission on spatialMode !== "latlon" + leak-prevention regression tests** - `849c21a` (feat)

_Note: implemented as a single feat commit (gate + test migration + new tests together) rather than separate test/feat commits — the migration tests only define the failing state once the gate exists, so the unit is atomic._

## Files Created/Modified
- `packages/web/src/lib/wmsUrlBuilder.ts` - Two new `config.spatialMode !== "latlon"` gates around SHAPE* emission (raster branch + per-break classbreak branch); POINT*/CB_* left unconditional; saved values not deleted.
- `packages/web/src/lib/wmsUrlBuilder.spec.ts` - Migrated 6 raster SHAPE* tests to `spatialMode: "wkt"`; added a new `SHAPE-V114-03 SHAPE* suppressed for latlon` describe block (5 tests).

## Decisions Made
- Gate-only suppression (no value deletion) — matches the locked SHAPE-V114-03 decision and the v1.9 Phase 53 track precedent; switching back to wkt/wkb restores emission from the still-present config/break values.
- Kept (migrated) the 6 raster SHAPE* tests as wkt no-regression coverage rather than deleting, per plan action step 3.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. The pre-existing latlon-mode Lane C classbreak tests (line ~622) did not regress because they only assert CB_ATTR/CB_VALS/POINTCOLORS (and one explicitly asserts SHAPE* undefined when no break sets them) — none asserted SHAPE* emission under latlon.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- SHAPE-V114-03 complete: full phase 71 SHAPE*-hiding requirement set (01 UI + 02 emission) is now in place.
- Ready for Phase 73 verification (BOTH-stack + live UAT).
- Verification gates green: wmsUrlBuilder.spec.ts 103/103; full frontend vitest 2393/2393 (104 files); web + server tsc exit 0; no packages/server diff (FRONTEND-ONLY honored).

## Self-Check: PASSED

- FOUND: packages/web/src/lib/wmsUrlBuilder.ts
- FOUND: packages/web/src/lib/wmsUrlBuilder.spec.ts
- FOUND: .planning/phases/71-shape-params-latlon-hide/71-02-SUMMARY.md
- FOUND commit: 849c21a

---
*Phase: 71-shape-params-latlon-hide*
*Completed: 2026-06-18*
