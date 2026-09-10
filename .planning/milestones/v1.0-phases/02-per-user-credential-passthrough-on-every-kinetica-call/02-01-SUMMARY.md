---
phase: 02-per-user-credential-passthrough-on-every-kinetica-call
plan: "01"
subsystem: api
tags: [kinetica, permissions, spike, ddl, materialized-view, error-taxonomy]

# Dependency graph
requires: []
provides:
  - "SPIKE.md: materialize DDL permission behaviour for a least-privileged Kinetica user"
  - "User decision: loud-failure acceptable — Phase 2 proceeds as planned"
  - "Error-taxonomy refinement: Kinetica returns HTTP 400 (not 403) on DDL access denied"
affects:
  - "02-02 (kineticaHelper module): must detect 400+/access denied/i body and throw KineticaPermissionError"
  - "02-05 (materialize refactor): 400+Access-denied case surfaces sanitized permission-denied message despite KineticaUpstreamError class"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Spike-before-refactor: blocking discovery task locks design before code lands (mirrors Phase 1 token-exchange spike)"

key-files:
  created:
    - ".planning/phases/02-per-user-credential-passthrough-on-every-kinetica-call/SPIKE.md"
  modified: []

key-decisions:
  - "Kinetica returns HTTP 400 (not 403) for DDL permission denial — body: {status:ERROR, message:'Access denied; ok'}"
  - "Error-taxonomy refinement: Plan 02-02 helper must throw KineticaPermissionError when status==400 AND body.message matches /access denied|permission/i"
  - "Loud-failure acceptable — Phase 2 proceeds with per-user materialize as planned; no Phase 2.1 needed"
  - "Plan 02-05 note: 400+Access-denied materialize case must surface sanitized permission-denied message even though class is KineticaUpstreamError"

patterns-established:
  - "Spike result captured in SPIKE.md with Setup / Test / Result / Recommendation / References sections — reusable pattern for future DDL-permission investigations"

requirements-completed: [CRED-04]

# Metrics
duration: 10min
completed: 2026-04-28
---

# Phase 02 Plan 01: Materialize Permission Spike Summary

**HTTP 400 (not 403) returned by Kinetica on DDL access denial; loud-failure acceptable and Phase 2 proceeds with per-user materialize as planned**

## Performance

- **Duration:** ~10 min (Task 1 spike execution + checkpoint:decision resolution)
- **Started:** 2026-04-28T14:35:00Z (approx)
- **Completed:** 2026-04-28T15:17:42Z
- **Tasks:** 2 (Task 1: spike execution + SPIKE.md; Task 2: checkpoint:decision — user reviewed and decided)
- **Files modified:** 1 (SPIKE.md created)

## Accomplishments

- Created a least-privileged Kinetica test user (`bi_spike_test_user`) with SELECT-only grants, executed the exact DDL the BI app issues (`CREATE OR REPLACE MATERIALIZED VIEW`), and captured the full HTTP response
- Confirmed Kinetica returns **HTTP 400** with `{"status":"ERROR","message":"Access denied; ok"}` — not HTTP 403 — requiring an error-taxonomy refinement in Plan 02-02
- Obtained explicit user decision: `proceed` — Phase 2 continues with per-user materialize and loud `KineticaPermissionError` failure; no Phase 2.1 insertion required

## Task Commits

Each task was committed atomically:

1. **Task 1: Run the materialize spike and write SPIKE.md** - `2f81b7d` (docs)
2. **Task 2: checkpoint:decision — user decision recorded** - (this plan's metadata commit)

## Files Created/Modified

- `.planning/phases/02-per-user-credential-passthrough-on-every-kinetica-call/SPIKE.md` — Full spike result: Setup (test user grants), Test (exact curl), Result (HTTP 400 + verbatim body), Recommendation (loud-failure acceptable), References

## Decisions Made

### User decision (checkpoint:decision outcome)

The user reviewed SPIKE.md and typed `proceed`. Phase 2 continues with per-user materialize and loud failure; no `/gsd:insert-phase 2.1` invoked.

### Error-taxonomy refinement (surfaced by spike, informs Plan 02-02)

The original 02-CONTEXT.md error taxonomy classifies errors by HTTP status code: 401 → `KineticaAuthError`, 403 → `KineticaPermissionError`, everything else → `KineticaUpstreamError`. The spike revealed Kinetica sends **HTTP 400** (not 403) when a SELECT-only user attempts DDL. Under the original taxonomy this falls into `KineticaUpstreamError`.

**Refinement (orchestrator-confirmed, 02-02 frontmatter already updated):** The helper in Plan 02-02 must add a secondary body-inspection rule:

> If `status === 400` AND `body.message` matches `/access denied|permission/i`, throw `KineticaPermissionError` (not `KineticaUpstreamError`).

This preserves the typed-error semantics Phase 3 depends on for UX-02 (inline permission-denied widget error) while correctly handling Kinetica's non-standard 400 response.

**Plan 02-05 implication:** The materialize refactor must ensure the 400+"Access denied; ok" case produces a sanitized user-facing message conveying "permission denied for this operation" — not a generic upstream error string.

## Deviations from Plan

None — plan executed exactly as written. The 400 vs. expected 403 finding is a spike result, not a deviation from the spike process.

The error-taxonomy refinement is additive context directed by the orchestrator (Plan 02-02 frontmatter already updated externally); it is recorded here for traceability but required no code changes in this plan.

---

**Total deviations:** 0 auto-fixed
**Impact on plan:** Plan executed exactly as written.

## Issues Encountered

None — SPIKE.md produced cleanly, test user created and deleted, spike view dropped. No lingering test artifacts in the Kinetica instance.

## User Setup Required

None — no external service configuration required beyond what is already in the dev `.env`.

## Next Phase Readiness

**Unblocked:** Plan 02-02 (`kineticaHelper` module) can now land with the correct error-taxonomy implementation including the 400+access-denied detection rule.

**Key inputs for Plan 02-02 implementors:**
- Permission denial HTTP status: **400** (not 403)
- Body signal: `body.status === "ERROR"` AND `body.message` matches `/access denied|permission/i`
- Throw: `KineticaPermissionError` for this case
- Log: raw upstream body to `console.error` only; never include in thrown error message

**Key inputs for Plan 02-05 implementors:**
- Materialize DDL failure for restricted users returns HTTP 400 — helper classifies as `KineticaPermissionError` (after 02-02 refinement)
- Client-facing sanitized message for this case should convey "You do not have permission to create materialized views" (exact wording is Plan 02-05's call)

**Concern cleared:** Pitfall 16 (materialize DDL perms) is resolved. The failure is clean, parseable, and deterministic. No Phase 2.1 needed.

## Self-Check: PASSED

- [x] SPIKE.md exists at `.planning/phases/02-per-user-credential-passthrough-on-every-kinetica-call/SPIKE.md`
- [x] Task 1 commit `2f81b7d` present in `git log`
- [x] All 5 required SPIKE.md sections present (Setup, Test, Result, Recommendation, References)
- [x] Recommendation phrase is canonical: "loud-failure acceptable — proceed with Phase 2 per-user materialize as planned"
- [x] No production code modified (`git diff --name-only kinetica_bi/server/src/` returns empty)
- [x] User decision recorded: `proceed`
- [x] Error-taxonomy refinement documented for Plans 02-02 and 02-05

---
*Phase: 02-per-user-credential-passthrough-on-every-kinetica-call*
*Completed: 2026-04-28*
