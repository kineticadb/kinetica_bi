---
phase: 25-spatial-predicate-spike
plan: 01
subsystem: api
tags: [kinetica, spatial, sql, spike, STXY_WITHIN, ST_INTERSECTS, ST_GEOMFROMTEXT]

# Dependency graph
requires:
  - phase: 18-spatial-spike-and-endpoint
    provides: "wkbSpike.ts runner pattern (production-parity /execute/sql payload, dotenv loading, basicAuth, classify helpers)"
provides:
  - "Locked latlon predicate: STXY_WITHIN(lon_col, lat_col, ST_GEOMFROMTEXT(?)) = 1"
  - "Locked WKT predicate: ST_INTERSECTS(geom_col, ST_GEOMFROMTEXT(?)) = 1"
  - "25-SPIKE-NOTES.md decision record with verbatim probe results and Phase 26 hand-off checklist"
  - "spatialPredicateSpike.ts one-shot re-run script preserved at commit f72615f"
affects:
  - phase-26-spatial-where-clause
  - phase-28-spatial-config
  - phase-30-spatial-filter-bar

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Operator-driven spike: Claude writes runner → operator runs → Claude records decision (mirrors Phase 18 pattern)"
    - "Strong PASS criterion: HTTP 200 AND status:OK AND COUNT(*) > 0 (catches silent wrong-arg-order no-ops)"
    - "Multi-candidate-per-mode-per-run: both STXY_WITHIN and STXY_CONTAINS probed in single session"

key-files:
  created:
    - kinetica_bi/server/src/spatialPredicateSpike.ts
    - .planning/phases/25-spatial-predicate-spike/25-SPIKE-NOTES.md
  modified:
    - kinetica_bi/server/package.json

key-decisions:
  - "LATLON predicate locked to STXY_WITHIN (not STXY_CONTAINS): (lon, lat) appears first matching column-pair order; canonical Kinetica reference; Phase 18 confirmed STXY_WITHIN family works"
  - "WKT predicate locked to ST_INTERSECTS (not ST_WITHIN): ST_WITHIN returned 0 rows (correct semantics — no US state fits inside a 1-degree NYC box) but wrong for v1.5 user intent (features touching drawn shape); ST_INTERSECTS returns 3 (NY, NJ, CT)"
  - "ST_WITHIN 0-row result is a semantic mismatch, not a Kinetica bug — documented in SPIKE-NOTES.md Section 4.2"
  - "Server version not captured during operator run — follow-up to record via SHOW SYSTEM PROPERTIES before Phase 26 ships"
  - "SPIKE-V15-01 gate: PASS — Phase 26 buildSpatialOrBlock authorized"

patterns-established:
  - "Decision record format: run metadata + 12-probe results table + decisions + risks/limitations + downstream hand-off checklist"

requirements-completed:
  - SPIKE-V15-01
  - SPIKE-V15-02

# Metrics
duration: operator-run (Task 1 ~30min, Task 2 operator-driven, Task 3 ~15min)
completed: 2026-05-11
---

# Phase 25: Spatial Predicate Spike Summary

**12-probe live Kinetica validation locks STXY_WITHIN (latlon) and ST_INTERSECTS (WKT) as Phase 26 buildSpatialOrBlock predicates — SPIKE-V15-01 PASS, Phase 26 authorized**

## Performance

- **Duration:** Task 1 ~30 min (runner authoring), Task 2 operator-driven (no code), Task 3 ~15 min (decision record)
- **Started:** 2026-05-11
- **Completed:** 2026-05-11
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- Wrote production-parity 12-probe spike runner (`spatialPredicateSpike.ts`, 473 lines) covering STXY_WITHIN, STXY_CONTAINS, ST_WITHIN, ST_INTERSECTS each against bbox + 64-vertex circle + 150-vertex lasso
- Operator ran spike live against deployed Kinetica (http://172.31.0.22:8082/gpudb-0); all 12 probes returned HTTP 200 + status:OK + sane row counts
- Recorded decision record with locked SQL templates, analysis of ST_WITHIN semantic mismatch, risks, and Phase 26 hand-off checklist

## Task Commits

Each task was committed atomically:

1. **Task 1: Write spatial predicate spike runner + npm-script wire-up** - `f72615f` (feat)
2. **Task 2: Operator runs spike against deployed Kinetica** - no commit (operator action, output captured in Task 3)
3. **Task 3: Write 25-SPIKE-NOTES.md decision record** - `c01794e` (docs)

## Files Created/Modified
- `kinetica_bi/server/src/spatialPredicateSpike.ts` - 473-line one-shot CLI spike runner; 12-probe matrix with shape generators and strengthen classify(); mirrors wkbSpike.ts production-parity payload
- `kinetica_bi/server/package.json` - Added `spatial-predicate-spike` npm script
- `.planning/phases/25-spatial-predicate-spike/25-SPIKE-NOTES.md` - Decision record: run metadata, 12-probe results table, locked predicates + exact SQL templates for Phase 26, risks, hand-off checklist

## Decisions Made

**LATLON: STXY_WITHIN locked.** Both STXY_WITHIN and STXY_CONTAINS returned identical counts (490758 / 490753 / 490752 by shape type) — they are commutative point-in-polygon predicates with reversed argument order. STXY_WITHIN selected because (lon, lat) columns appear first (natural for WHERE clause binding), canonical Kinetica reference uses this form, and Phase 18 confirmed the STXY_WITHIN family.

**WKT: ST_INTERSECTS locked.** ST_WITHIN returned 0 rows for all three shapes — this is the semantically correct answer to "is the entire US state polygon fully contained within a 1° NYC-area shape?" (no US state is that small), but the wrong semantic for v1.5 map-shape filtering where users want "features whose geometry touches the drawn shape." ST_INTERSECTS returned 3 (NY, NJ, CT — all adjacent to NYC). Decision was anticipated in 25-RESEARCH.md.

**Exact SQL templates for Phase 26 (copy verbatim):**
```sql
-- LATLON mode:
STXY_WITHIN(<lon_col>, <lat_col>, ST_GEOMFROMTEXT(?)) = 1

-- WKT mode:
ST_INTERSECTS(<geom_col>, ST_GEOMFROMTEXT(?)) = 1
```

## Deviations from Plan

None — plan executed exactly as written. Task 2 was operator-driven; the 0-row ST_WITHIN result was anticipated by the research phase and required no plan adjustment. The script's recommendation banner correctly output `STXY_WITHIN` / `ST_INTERSECTS` / `PASS`.

## Issues Encountered

None. All 12 probes returned HTTP 200 + status:OK in a single operator session. No network blips, no re-runs.

## User Setup Required

None — no external service configuration required beyond what the operator already had set in `.env`.

## Next Phase Readiness

Phase 26 (`buildSpatialOrBlock`) is authorized to proceed. The implementer should:
1. Copy the two SQL templates verbatim from Section 3.3 of 25-SPIKE-NOTES.md
2. Respect the V15-P-07 outer-paren lock for multi-shape OR chains
3. Apply WKB gate (HTTP 501 for WKB mode targets)
4. Capture Kinetica server version via `SHOW SYSTEM PROPERTIES` before Phase 26 ships

**Open item:** Kinetica server version was not captured during the operator run. Recommend follow-up before Phase 26 close.

---
*Phase: 25-spatial-predicate-spike*
*Completed: 2026-05-11*
