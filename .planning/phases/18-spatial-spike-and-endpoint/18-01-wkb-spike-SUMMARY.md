---
phase: 18-spatial-spike-and-endpoint
plan: 01
subsystem: spatial-query
tags: [kinetica, wkb, spatial, spike, tech-debt]

requires:
  - phase: 17-verification
    provides: v1.3 milestone closed; per-user kineticaSql helper proven for DDL ops
provides:
  - WKB spike runner script (kinetica_bi/server/src/wkbSpike.ts) — runnable via `npm run wkb-spike` against a deployed Kinetica
  - 18-SPIKE-NOTES.md — verbatim probe output + locked Decision (NONE_ESCALATE → TECH_DEBT)
  - TD-V14-WKB-SPIKE registered in PROJECT.md and STATE.md
  - SPATIAL-V14-03 deferred from Phase 18 scope (Plans 18-02 / 18-03 ship partial scope)
affects: [18-02-spatial-modules, 18-03-info-query-endpoint, future-WKB-spike-round]

tech-stack:
  added: []
  patterns:
    - "Spike runner pattern (kinetica_bi/server/src/wkbSpike.ts) mirrors wmsSpike.ts byte-for-byte; reusable for future re-runs"
    - "Spike outcome → tech debt: when a P1 gate cannot be productively resolved, defer the requirement to a tracked TD entry rather than block the phase"

key-files:
  created:
    - .planning/phases/18-spatial-spike-and-endpoint/18-SPIKE-NOTES.md
    - .planning/phases/18-spatial-spike-and-endpoint/18-01-wkb-spike-SUMMARY.md
  modified:
    - kinetica_bi/server/src/wkbSpike.ts (commits 15714e3 + d458408)
    - kinetica_bi/server/package.json (commit 15714e3)
    - .planning/PROJECT.md (TD-V14-WKB-SPIKE entry — commit 2)
    - .planning/STATE.md (Decisions + Blockers entry — commit 2)
    - .planning/REQUIREMENTS.md (SPATIAL-V14-03 row → Deferred — commit 3)
    - .planning/ROADMAP.md (Phase 18 description annotation — commit 3)
    - .planning/phases/18-spatial-spike-and-endpoint/18-02-spatial-modules-PLAN.md (commit 4)
    - .planning/phases/18-spatial-spike-and-endpoint/18-03-info-query-endpoint-PLAN.md (commit 4)

key-decisions:
  - "Spike outcome: NONE_ESCALATE → resolved to TECH_DEBT (TD-V14-WKB-SPIKE) — operator has no WKB-binary column reachable; cannot exercise WKB code path productively"
  - "SPATIAL-V14-03 deferred from Phase 18 scope; ships in a future milestone when WKB column access becomes available"
  - "Plan 18-02 buildWkbQuery throws NotImplementedError(\"WKB mode deferred — TD-V14-WKB-SPIKE\") — function signature stays exported for type stability"
  - "Plan 18-03 endpoint returns HTTP 501 for spatialMode='wkb' with body { error: 'WKB mode deferred', td: 'TD-V14-WKB-SPIKE' } — buildWkbQuery is NOT invoked (it would throw)"
  - "Phase 18 ships partial scope: SPATIAL-V14-01 (lat/lon GEODIST) + SPATIAL-V14-02 (WKT STXY_DISTANCE); SPATIAL-V14-03 deferred"
  - "Runner bug fix (commit d458408) preserved for future re-run; runner is fully production-payload-parity with kinetica.ts:154-170"

patterns-established:
  - "BLOCKED_TECH_DEBT spike close-out: When a P1 spike cannot be productively resolved, defer the requirement as TD rather than block the phase. Document the runner-fix-vs-data-shape distinction so the future re-run agent has a clear starting point."
  - "Throw-by-design stub: buildWkbQuery exports the function signature but throws NotImplementedError, allowing downstream code to route by mode without conditional imports."

requirements-completed: [SPATIAL-V14-03]
# Note: SPATIAL-V14-03 is "completed" in the sense that Plan 18-01's job (resolve the spike one way or another) is done.
# The implementation work is deferred to TD-V14-WKB-SPIKE. The plan's `requirements:` frontmatter listed SPATIAL-V14-03;
# marking complete here triggers REQUIREMENTS.md to update its status to Deferred (per commit 3 below).

duration: 23min
completed: 2026-05-08
---

# Phase 18 Plan 01: WKB Spike Summary

**WKB spatial-proximity spike closed with `BLOCKED_TECH_DEBT` outcome — SPATIAL-V14-03 deferred to TD-V14-WKB-SPIKE; Phase 18 ships partial scope (lat/lon + WKT only).**

## Performance

- **Duration:** ~23 min (close-out work; runner build + first failed run already committed pre-this-plan)
- **Started:** 2026-05-07T23:35:00Z (Task 1 runner build)
- **Completed:** 2026-05-08T04:30:00Z (close-out + spec-adjustment commits)
- **Tasks:** 3 (Task 1: runner build → committed 15714e3; Task 2: operator probe run → output captured pre-fix and post-fix waived; Task 3: 18-SPIKE-NOTES.md authoring → this commit)
- **Files modified across all 4 close-out commits:** ~7 (PROJECT, STATE, REQUIREMENTS, ROADMAP, 18-02-PLAN, 18-03-PLAN, plus 2 new files: 18-SPIKE-NOTES.md, this SUMMARY.md)

## Accomplishments

- **All three probes documented verbatim** with HTTP status, body JSON, and FAIL classification including pre-fix vs post-fix root-cause analysis (runner-bug for A/B, fixture-column-type-mismatch for C)
- **Decision locked: `NONE_ESCALATE → resolved to TECH_DEBT (TD-V14-WKB-SPIKE)`** — Phase 18 unblocked to ship partial scope rather than stalling indefinitely on an unreachable WKB column
- **Runner preservation:** Commit `d458408` brings the spike runner to full production-payload parity (matches `kinetica.ts:154-170`); future re-run is one `npm run wkb-spike` away once WKB column access exists
- **Spec adjustments propagated to Plans 18-02 and 18-03** — Wave 2 executor will produce `buildWkbQuery` that throws and an endpoint that returns 501 for wkb mode, both referencing TD-V14-WKB-SPIKE

## Task Commits

Per-task commits (pre-this-close-out):

1. **Task 1: WKB spike runner script + npm script wiring** — `15714e3` (feat)
2. **Task 1.5: Runner payload-contract bug fix (deviation Rule 1)** — `d458408` (fix)
3. **Audit: STATE.md decision recording the runner bug + re-run plan** — `0f8237d` (docs)

This plan's close-out commits:

4. **Plan 18-01 deliverables: 18-SPIKE-NOTES.md + this SUMMARY.md** — commit 1 of close-out (docs)
5. **TD-V14-WKB-SPIKE registration: PROJECT.md + STATE.md** — commit 2 of close-out (docs)
6. **SPATIAL-V14-03 deferred: REQUIREMENTS.md + ROADMAP.md** — commit 3 of close-out (docs)
7. **Plan 18-02/18-03 spec adjustments for WKB deferral** — commit 4 of close-out (docs)

## Files Created/Modified

- `.planning/phases/18-spatial-spike-and-endpoint/18-SPIKE-NOTES.md` — Verbatim probe output (Probes A/B/C all FAIL); Decision = NONE_ESCALATE → TECH_DEBT
- `.planning/phases/18-spatial-spike-and-endpoint/18-01-wkb-spike-SUMMARY.md` — This file
- `.planning/PROJECT.md` — TD-V14-WKB-SPIKE entry added (commit 2)
- `.planning/STATE.md` — Decisions section appended; SPATIAL-V14-03 blocker resolved → TECH_DEBT (commit 2)
- `.planning/REQUIREMENTS.md` — SPATIAL-V14-03 row: `Pending` → `Deferred (TD-V14-WKB-SPIKE)`; bullet annotated (commit 3)
- `.planning/ROADMAP.md` — Phase 18 description: SPATIAL-V14-03 listed as Deferred → TD-V14-WKB-SPIKE (commit 3)
- `.planning/phases/18-spatial-spike-and-endpoint/18-02-spatial-modules-PLAN.md` — buildWkbQuery throws NotImplementedError; Test 4 asserts the throw path (commit 4)
- `.planning/phases/18-spatial-spike-and-endpoint/18-03-info-query-endpoint-PLAN.md` — wkb-mode early-return 501; supertest asserts 501 body shape (commit 4)
- `kinetica_bi/server/src/wkbSpike.ts` — Created in `15714e3`, fixed in `d458408`; reusable for future re-run
- `kinetica_bi/server/package.json` — `wkb-spike` script registered

## Decisions Made

1. **Spike outcome: NONE_ESCALATE → TECH_DEBT** — Operator has no WKB-binary column reachable; first run was tainted by runner bug (now fixed in `d458408`); fixture column was WKT (text), not WKB-binary. Cannot productively resolve the spike. Defer as TD rather than block Phase 18 indefinitely.
2. **SPATIAL-V14-03 deferred from Phase 18 scope** — REQUIREMENTS.md status updated to `Deferred (TD-V14-WKB-SPIKE)`. Phase 18 ships partial scope.
3. **Plan 18-02 `buildWkbQuery` throws NotImplementedError** — Export the signature for type stability so Plan 18-03 can route by `spatialMode` without conditional imports. Spec asserts the throw path; no SQL template assertion.
4. **Plan 18-03 endpoint returns 501 for `spatialMode='wkb'`** — Early-return BEFORE invoking `buildWkbQuery` (which would throw). Body: `{ error: 'WKB mode deferred', td: 'TD-V14-WKB-SPIKE' }`. The `wkb` member of `SpatialMode` union and `wkbCol?` field of `SpatialColumns` stay defined — request validation still accepts them.
5. **Runner preservation** — Commit `d458408` makes the runner production-payload-parity. Future re-run path: identify a WKB-binary column, set env vars (`WKB_PROBE_SCHEMA`/`TABLE`/`COLUMN`/`LON`/`LAT`), run `npm run wkb-spike`, update 18-SPIKE-NOTES.md, and replace the throws/501s in 18-02/18-03.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Runner missing `encoding: "json"` in `/execute/sql` payload (committed pre-this-close-out as `d458408`)**
- **Found during:** Task 2 (operator probe run, first attempt)
- **Issue:** All three probes failed with verbatim Kinetica error `Value: '' not a valid parameter. Valid values are: binary, json, geojson, arrow (U/PUh:355)` because `runSql()` sent only `{ statement, limit: 1 }`, missing `encoding`, `offset`, `request_schema_str`, `data`, `options` that production `kinetica.ts:154-170` always sends.
- **Fix:** Brought spike runner's `/execute/sql` payload to production parity. Commit `d458408`.
- **Files modified:** `kinetica_bi/server/src/wkbSpike.ts`
- **Verification:** Diff against production `kinetica.ts:154-170` payload contract confirms parity.
- **Committed in:** `d458408`

**2. [Rule 4 - Architectural] Spike outcome cannot be productively resolved → defer SPATIAL-V14-03 as TD**
- **Found during:** Task 2 follow-up (after runner fix)
- **Issue:** Operator's only WKB-shaped fixture (`ki_home.v18_wkb_fixture.geom`) was declared `WKT` (text), which Kinetica surfaced as generic `GEO`. Probe C's `STX(<GEO>)` signature mismatch confirmed this. Operator has no WKB-binary column reachable. Re-running the fixed runner against the same fixture would not exercise the WKB code path.
- **User decision (2026-05-08):** Defer SPATIAL-V14-03 as TD-V14-WKB-SPIKE rather than block Phase 18. Phase 18 ships partial scope. Plans 18-02 / 18-03 specs adjusted accordingly.
- **Files modified:** PROJECT.md, STATE.md, REQUIREMENTS.md, ROADMAP.md, 18-02-PLAN.md, 18-03-PLAN.md (commits 2-4 of close-out)
- **Verification:** TD-V14-WKB-SPIKE entry exists in PROJECT.md; SPATIAL-V14-03 row in REQUIREMENTS.md says Deferred; Plans 18-02/18-03 spec asserts adjusted to throw path / 501 path.
- **Committed in:** Close-out commits 2, 3, and 4.

---

**Total deviations:** 2 (1 auto-fixed bug, 1 user-decided architectural deferral via Rule 4 protocol)
**Impact on plan:** Plan 18-01's verifiable artifacts (18-SPIKE-NOTES.md with locked Decision) ship as planned; Decision lands `NONE_ESCALATE` rather than `PROBE_A/B/C`. Phase 18 partial-scope ships; SPATIAL-V14-03 carried to a future milestone. No scope creep — the deferral is explicit and tracked.

## Issues Encountered

- **Operator has no WKB-binary column reachable** — Operator's response on 2026-05-08: "i dont have a wkb table". This is the proximate cause of the deferral. Resolution: defer to TD-V14-WKB-SPIKE; re-run when access becomes available.
- **Fixture column type was WKT (text), not WKB-binary** — Operator's `ki_home.v18_wkb_fixture` was created with `geom WKT` (text-type), which Kinetica surfaces as generic `GEO`. Even with the runner fix, this fixture would not exercise the WKB code path Plans 18-02/18-03 must implement. Resolution: documented in Caveat (a) and Caveat (b) of 18-SPIKE-NOTES.md.

## Authentication Gates

None — operator's BI-user `admin` had sufficient access to the Kinetica deployment for the spike attempt; the failures were due to runner bug + fixture column type, not auth.

## Next Phase Readiness

- **Wave 2 (Plan 18-02 spatial-modules) is unblocked** — buildLatLonQuery + buildWktQuery + pxToGroundDistance can all be built fully; buildWkbQuery is a deferred-by-design stub that throws.
- **Wave 3 (Plan 18-03 info-query-endpoint) is unblocked** — endpoint routes by spatialMode; wkb mode early-returns 501 with TD-V14-WKB-SPIKE body.
- **Phase 18 closes with partial scope** — SPATIAL-V14-01 + SPATIAL-V14-02 covered; SPATIAL-V14-03 = Deferred (TD-V14-WKB-SPIKE).
- **Future re-run path:** When operator gains WKB-binary column access, run `cd kinetica_bi/server && npm run wkb-spike` (env vars per 18-SPIKE-NOTES.md ## Caveats); update 18-SPIKE-NOTES.md ## Decision; replace the NotImplementedError in `spatialQuery.ts` with the spike-locked SQL template; replace the 501 early-return in the endpoint with a proper wkb-mode handler.

---
*Phase: 18-spatial-spike-and-endpoint*
*Plan: 01-wkb-spike*
*Completed: 2026-05-08*

## Self-Check: PASSED

- File `18-SPIKE-NOTES.md` exists; Decision regex matches `**Chosen WKB SQL pattern:** NONE_ESCALATE → resolved to TECH_DEBT (TD-V14-WKB-SPIKE)`.
- File `18-01-wkb-spike-SUMMARY.md` exists.
- Commits 6cb4a1c, c5fd4d5, 054e188, b011854 all present in `git log` (this plan's 4 close-out commits, in addition to pre-this-close-out commits 15714e3 / d458408 / 0f8237d for runner build + bug fix).
- PROJECT.md contains `TD-V14-WKB-SPIKE` entry under "v1.4 carried tech debt".
- STATE.md Decisions section appended with the WKB-deferral decision; Blockers/Concerns marks SPATIAL-V14-03 RESOLVED → TECH_DEBT and registers TD-V14-WKB-SPIKE.
- REQUIREMENTS.md SPATIAL-V14-03 row: `Deferred (TD-V14-WKB-SPIKE)` (not Pending); requirement bullet annotated with deferral rationale.
- ROADMAP.md Phase 18 description annotated; progress row 1/3 (In Progress); Plan 18-01 marked complete in the plan listing.
- 18-02-spatial-modules-PLAN.md: buildWkbQuery throws WkbDeferredError; Test 4 asserts the throw path; truths + acceptance_criteria + success_criteria all updated.
- 18-03-info-query-endpoint-PLAN.md: endpoint early-returns 501 for spatialMode='wkb' BEFORE invoking any builder; Test 3 asserts the 501 body + zero kineticaSql calls; buildWkbQuery is intentionally NOT imported.
- No `phase complete` CLI invocation made — Plans 18-02 and 18-03 still pending; Wave 2 next.
