---
phase: 139-session-only-dynamic-views
plan: 03
subsystem: server
tags: [ai, dynamic-views, sqlite, cleanup, env-config]
requires: []
provides:
  - AI_DV_* env limits (dvMaxRecords, dvMaxJoins, dvMaxPerSession, dvPreflightTimeoutMs) on AiConfig
  - lib/aiDvName.ts (build/parse/own-check/job tag)
  - ai_session_views registry + dropViewsForSid + sweepAiViewsOnBoot
affects: [139-05, 139-06, 139-07]
tech-stack:
  added: []
  patterns: [injectable sql/principalFor/conn deps, bounded never-throw cleanup]
key-files:
  created:
    - packages/server/src/lib/aiDvName.ts
    - packages/server/src/lib/aiSessionViews.ts
    - packages/server/tests/lib.aiDvName.spec.ts
    - packages/server/tests/lib.aiSessionViews.spec.ts
  modified:
    - packages/server/src/lib/aiConfig.ts
    - packages/server/tests/lib.aiConfig.spec.ts
    - packages/server/.env.example
    - packages/server/tests/setup.ts
    - packages/server/src/db.ts
key-decisions:
  - "dropViewsForSid counts ttlOnly (session gone / 401) and timed-out drops as failed in its 2-field return; sweep keeps the 3-way split"
  - "Registry rows are always deleted after a drop attempt (even on failure/timeout); the Kinetica TTL is the backstop"
duration: ~15min
completed: 2026-10-20
---

# Phase 139 Plan 03: AI view limits, names, and session registry Summary

Env-configurable AI_DV_* limits, server-built prefix-validated tab-safe AI view names, and a SQLite registry with bounded never-throwing logout-drop and boot-sweep primitives (wired in 139-06).

## Commits
- 708c38f: AI_DV_* env limits (Task 1)
- 8e9a82e: aiDvName (Task 2)
- 5a209fd: registry + cleanup primitives (Task 3)

## TTL-only gaps (recorded, not hidden; D-16)
Views that cannot be dropped by logout/boot fall back to the Kinetica TTL (DEFAULT_VIEW_TTL_MINUTES, 5 min) and the sweep logs the count:
- expired or deleted session (principalForSession throws SessionEndedError, including KINETICA_URL change)
- expired OIDC token (kineticaSql throws KineticaAuthError / 401)
- crash before the registry row was written (view never registered)

## Deviations from Plan
None in behavior. No AiConfig literals needed updating (the `maxNewWidgets:` literals found are AgentLoopInput, not AiConfig).

## Gate results / issues
- `tsc --noEmit` clean. New specs green: CFGDV-1..4, DVNAME-1..8, REGV-1..10; boot.aiConfig and spike.s1 specs green.
- `node scripts/test-gate.mjs`: FAILED on `tests/lib.aiGateway.spec.ts` GW-2 (`expected 'ok' to be 'allow_list'`), failing in isolation. Not caused by this plan (no gateway/shared files touched); it coincides with 139-01's uncommitted/just-committed packages/shared aiOp/aiCatalog changes. Left for 139-01/139-14. layers.spec.ts failed only under load (passes alone); db.smoke.spec.ts is a known-failing snapshot-drift file (its 2 failures are cb_config/track_config/filter_scope column drift, unrelated to ai_session_views).
- Acceptance greps: all pre-checks were 0 before work; post-counts satisfied. No non-discriminating criteria found. The registry table has no secret/spec column.

## Self-Check: PASSED
Files exist (aiDvName.ts, aiSessionViews.ts, both specs); commits 708c38f, 8e9a82e, 5a209fd found in git log.
