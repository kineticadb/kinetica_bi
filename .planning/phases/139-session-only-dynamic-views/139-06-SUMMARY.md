---
phase: 139-session-only-dynamic-views
plan: 06
subsystem: server
tags: [ai, dynamic-views, logout, boot-sweep, drill-down]
requires: [139-03, 139-05]
provides:
  - logout drops AI session views server-side before deleteSession
  - boot sweep of registered AI views before app.listen
  - negative dynamicViewId (AI view) branch in POST /api/filter/materialize; _dvn<abs> filter-view names
affects: [139-11, 139-13]
key-files:
  created:
    - packages/server/tests/routes.aiDv.lifecycle.spec.ts
    - packages/server/tests/routes.filter-materialize.aiDv.spec.ts
  modified:
    - packages/server/src/index.ts
    - packages/server/src/lib/viewNaming.ts
    - packages/server/tests/lib.viewNaming.spec.ts
    - packages/server/tests/bootstrap.spec.ts
key-decisions:
  - "AI-view drill branch shares the existing probe/column-guard/CREATE tail with the saved-dv path (dvViewName + dvLabel locals); saved-dv behaviour unchanged"
  - "Name is rebuilt from the caller's own user+sid+aiNonce+aiGen and resolved via registry, so another session's row can never be used"
duration: ~25min
completed: 2026-10-20
---

# Phase 139 Plan 06: Logout/boot cleanup and AI-view drill filtering Summary

Logout now awaits a bounded `dropViewsForSid` before `deleteSession`, the boot IIFE awaits `sweepAiViewsOnBoot` before `app.listen`, and `POST /api/filter/materialize` accepts a negative `dynamicViewId` (+ `aiNonce`/`aiGen`) resolved through the registry, with filter views named `_dvn<abs>`.

## Commits
- d3bb0c3: logout drop + boot sweep (Task 1)
- a7e0441: D-23 negative-id filter materialize + viewNaming (Task 2)

## RED-first evidence
- Task 1: against unchanged index.ts, `routes.aiDv.lifecycle.spec.ts` + AIDV-boot ran RED: LIFE-DV-1 (`expected [] to have a length of 2 but got 0` - no DROP issued), LIFE-DV-2 and LIFE-DV-4 (rows not deleted: `expected [..] to have a length of +0 but got 1`), AIDV-boot (`expected false to be true`). LIFE-DV-3 and LIFE-DV-5 passed pre-change (they assert unchanged/bounded contracts, not discriminating by themselves; LIFE-DV-1 is the real ordering proof).
- Task 2: 6 failed before implementation: DRILLDV-N1, N2, DRILLDV-1, 3, 4, 6. DRILLDV-2 and DRILLDV-5 (both 404) passed pre-change because a negative id has no saved-dv row; they are regression guards that now exercise the registry branch (DRILLDV-5 proves another sid's row is not used), not red-first proofs.
- Green after: 60/60 across lib.viewNaming, routes.filter-materialize.aiDv, routes.filter-materialize-dv, routes.column-guard.filter-materialize, routes.aiDv.lifecycle.

## Verification
- Ordering in index.ts logout handler: dropViewsForSid at line 461 < deleteSession(decoded.sid) at line 462 (LIFE-DV-1 proves the session row still exists when each DROP runs).
- `npx tsc --noEmit` clean.
- Greps: `await dropViewsForSid(decoded.sid` = 1, `await sweepAiViewsOnBoot(` = 1.

## Deviations from Plan
None in behaviour. Not run, per orchestrator override: `node scripts/test-gate.mjs` / full suite (139-14 owns full gates).

## Pre-existing failures (not caused by this plan)
- bootstrap.spec.ts: 5 oidc tests fail (`Issuer is not a constructor`); confirmed identical on HEAD's bootstrap.spec.ts before my edit.
- auth.routes.spec.ts: 5 failures (4x `Issuer is not a constructor` in oidc-mode /me tests, 1 deep-equal on /me authMode password); logout tests all pass. The deep-equal one was not re-verified on a clean tree; it is a /me payload assertion unrelated to logout.

## Notes for downstream
- 139-11 (web): drill requests for an AI view send `dynamicViewId: <negative tempId>`, `aiNonce`, `aiGen`; response viewName contains `_dvn<abs>`. DELETE needs only `dynamicViewId=-N` (or `viewName=`).

## Self-Check: PASSED
Files exist (both new specs, summary); commits d3bb0c3 and a7e0441 in git log.
