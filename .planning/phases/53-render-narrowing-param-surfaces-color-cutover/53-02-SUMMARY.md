---
phase: 53-render-narrowing-param-surfaces-color-cutover
plan: "02"
subsystem: testing
tags: [vitest, wms, track, emission, regression-lock, spec]

# Dependency graph
requires:
  - phase: 52-track-spatial-mode-foundation
    provides: "TrackConfig type with xCol/yCol fields; spatialMode:'track' spatial branch in wmsUrlBuilder"
  - phase: 37-cb-raster-spike
    provides: "Phase 37 spike Decision Record — DOTRACKS+TRACK_* emission shapes (byte contract)"
provides:
  - "RENDER-V19-04 regression lock: Track+Raster and Track+cb_raster emission shapes byte-locked under spatialMode=track"
  - "CUTOVER-V19-01 amended lock: stale old-shape track_config (enabled:true, no xCol/yCol) coalesces and renders without error"
  - "Fingerprint coverage proven by spec: track_config color edit changes emission value, which changes JSON.stringify({p,c,t}) fingerprint"
  - "In-code documentation of EMISSION-GATE DECISION (gate stays on tc.enabled)"
affects:
  - 53-03
  - any-future-track-emission-changes

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Spec-only plan: zero production code edits; all changes are *.spec.ts regression locks"
    - "Byte-lock pattern: exact WMS param value assertions (TRACKHEADCOLORS=FFFF0000 not just toBeDefined)"
    - "Fingerprint proxy pattern: assert emission value changes as unit-level proof that MapChartRenderer fingerprint changes"
    - "Gate-decision documentation: decide-in-planning directives documented as verbatim comment blocks inside describe() headers"

key-files:
  created: []
  modified:
    - packages/web/src/lib/wmsUrlBuilder.spec.ts
    - packages/web/src/lib/trackConfig.spec.ts

key-decisions:
  - "EMISSION-GATE kept on tc.enabled (not spatialMode==='track'): both legacy latlon+enabled and new track+enabled paths pass; switching gate would break existing locked specs"
  - "Fingerprint coverage verified via unit-level emission proxy (not MapChartRenderer integration test): a changed TRACKHEADCOLORS value in params changes JSON.stringify({p,c,t})"
  - "CUTOVER-V19-01 amended: no overlay/migration added; clean deletion (Phase 52) + no-throw locks satisfy the truth"

patterns-established:
  - "Stale-config no-throw pattern: assert !throw + return non-null params for any coalesced config shape, even incomplete ones"

requirements-completed: [RENDER-V19-04, CUTOVER-V19-01]

# Metrics
duration: 2min
completed: 2026-06-07
---

# Phase 53 Plan 02: Track Emission Regression Locks Summary

**Vitest regression locks for Track-spatial-mode WMS emission (RENDER-V19-04 byte contract) and stale old-shape track_config no-throw tolerance (CUTOVER-V19-01 amended), with EMISSION-GATE DECISION documented in-spec**

## Performance

- **Duration:** 2 min
- **Started:** 2026-06-07T14:24:06Z
- **Completed:** 2026-06-07T14:26:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Byte-locked Track+Raster (DOTRACKS + single-value TRACK_*) and Track+cb_raster (N comma-separated TRACK_* matching breaks.length) emission shapes under spatialMode="track" — the NEW Phase 52 flow
- Documented the EMISSION-GATE DECISION verbatim in-spec: gate stays on `tc.enabled` (not spatialMode); both legacy latlon+enabled and new track+enabled pass; shapes byte-preserved per Phase 37 spike contract
- Proved fingerprint coverage: track_config headColor change propagates to emission value, changing `JSON.stringify({p:wmsParams, c, t})` fingerprint, triggering tile refetch
- Locked stale old-shape track_config (enabled:true, no xCol/yCol) tolerance in both `coalesceTrackConfig` and `buildWmsParams` — no throw in latlon or track mode

## Task Commits

Each task was committed atomically:

1. **Task 1: Lock NEW track-spatial-mode emission shapes (raster + cb_raster)** - `997a6d7` (test)
2. **Task 2: Cutover lock — stale old-shape track_config renders without error** - `259ce64` (test)

## Files Created/Modified
- `packages/web/src/lib/wmsUrlBuilder.spec.ts` - Added two describe blocks: RENDER-V19-04 new-flow lock (5 specs) + CUTOVER-V19-01 stale tolerance (2 specs); total +142+49 lines
- `packages/web/src/lib/trackConfig.spec.ts` - Added describe "coalesceTrackConfig — stale old-shape config (CUTOVER-V19-01)" with 2 specs

## Decisions Made
- EMISSION-GATE DECISION (locked in-plan, documented in-spec): the `tc.enabled && (raster||classbreak)` gate is KEPT unchanged; a spatialMode==="track"-only gate would break the existing latlon+enabled specs (would weaken the locked contract, which CONTEXT forbids)
- Fingerprint proof is unit-level (emission value delta), not a MapChartRenderer integration test — sufficient because the fingerprint formula `JSON.stringify({p:wmsParams,c,t})` is already locked and trivially correct once emission changes
- CUTOVER-V19-01 amended: no migration or overlay logic added; Phase 52 clean deletion + these no-throw locks fully satisfy the amended truth

## Deviations from Plan

None - plan executed exactly as written. All 5 wmsUrlBuilder RENDER-V19-04 specs and 2 CUTOVER-V19-01 wmsUrlBuilder specs implemented as specified. All 2 trackConfig CUTOVER-V19-01 specs implemented as specified. Zero production code modified.

## Issues Encountered

None. All specs green on first run. TypeScript type check clean.

## Verification Results

- `npx vitest run src/lib/wmsUrlBuilder.spec.ts src/lib/trackConfig.spec.ts` — 104 passed (2 test files)
- `npx tsc --noEmit` — clean (no output)
- `git diff --name-only packages/web/src/lib/` — only *.spec.ts files listed (NOT wmsUrlBuilder.ts, NOT trackConfig.ts)
- `grep -n 'spatialMode: "track"' wmsUrlBuilder.spec.ts` — shows both Phase 52 block (~892) and new RENDER-V19-04 block (~973, ~1137)
- `grep -n "EMISSION-GATE" wmsUrlBuilder.spec.ts` — returns gate-decision comment at line 952

## Next Phase Readiness
- RENDER-V19-04 requirement fulfilled: emission shapes byte-locked, fingerprint coverage proven, gate decision documented
- CUTOVER-V19-01 requirement fulfilled (amended form): no-throw tolerance locked for both latlon and track modes
- Phase 53 Plan 03 (or subsequent plans) unblocked

## Self-Check: PASSED

Files verified:
- FOUND: packages/web/src/lib/wmsUrlBuilder.spec.ts
- FOUND: packages/web/src/lib/trackConfig.spec.ts

Commits verified:
- FOUND: 997a6d7 (Task 1)
- FOUND: 259ce64 (Task 2)

---
*Phase: 53-render-narrowing-param-surfaces-color-cutover*
*Completed: 2026-06-07*
