---
phase: 135-server-gateway-agent-loop-providers-governance-core
plan: 03
subsystem: server/ai-governance
tags: [audit, caps, sqlite, sweep]
requires: []
provides: [ai_audit table, admitAiAnswer, finalizeAiAnswer, cap messages, startAiAuditSweep]
affects: [135-09, 135-10, 135-11]
key-files:
  created: [packages/server/src/lib/aiAudit.ts, packages/server/tests/lib.aiAudit.spec.ts, packages/server/tests/lib.aiCaps.spec.ts]
  modified: [packages/server/src/db.ts, packages/server/src/index.ts, packages/server/tests/bootstrap.spec.ts]
requirements: [AIGOV-V20-04, AIGOV-V20-06]
completed: 2026-10-12
---

# Phase 135 Plan 03: AI audit + caps + retention sweep Summary

SQLite-derived per-user hourly / deployment daily caps with exact D-15 wording, one ai_audit row per answer (atomic check+insert, exactly-once finalize), and an always-on hourly retention sweep wired after startExportSweep().

## Commits
- c7d5398 feat(135-03): ai_audit table, cap counter and exact cap messages (Task 1; also carries the sweep functions and SWP specs)
- 7930efd feat(135-03): AI audit retention sweep wired after the export sweep (Task 2: index.ts + bootstrap.spec)

## Verification
- tsc clean. lib.aiCaps (9), lib.aiAudit (AUD 4 + SWP 5) green; bootstrap AIAUDIT-boot green (was red before the index.ts edit).
- Mutation proof: dropping `counted = 1` from the hour SELECT makes CAP-4 fail; reverted, green.

## Deviations
1. [Rule 1 - test bug] First CAP-4 draft (30 seeded rows, cap 30) did NOT fail under the planned mutation (non-discriminating). Redesigned with cap 5, 4 recent counted rows + 5 refusals, advance past the oldest; now fails under the mutation.
2. [Rule 3] My first comment edit in index.ts mentioned `startAiAuditSweep()`, making the "exactly one call" assertion count 2; reworded the comment.
3. Sweep functions and SWP specs were written in Task 1's commit (same file); Task 2 commit holds index.ts + bootstrap.spec only.

## Pre-existing failures (not caused by this plan)
- tests/db.smoke.spec.ts: 2 failures (dashboard_layers column list lacks cb_config/track_config/filter_scope).
- tests/bootstrap.spec.ts: 5 OIDC failures (`Issuer is not a constructor`, openid-client import).

## Notes for 135-02 / 135-12
- New env name to blank in tests/setup.ts and document in .env.example: `AI_AUDIT_RETENTION_DAYS` (read directly by readAiAuditRetentionDays, not via parseAiConfig). Cap env names (AI_MAX_ANSWERS_PER_USER_PER_HOUR / AI_MAX_ANSWERS_PER_DAY) are passed in as capPerHour/capPerDay by the route (135-10).
- Acceptance-criterion note: the plan's "grep -c 'You've used' = 1" holds; no non-discriminating greps otherwise beyond the CAP-4 test design above.
- Did not touch STATE/ROADMAP/REQUIREMENTS.

## Self-Check: PASSED
