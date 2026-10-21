---
phase: 140-query-data-access-mode-injection-hardening
plan: 02
subsystem: server-ai
tags: [ai, config, audit, sqlite]
requires: []
provides:
  - AiConfig.queryMaxRows/queryMaxChars/queryTimeoutMs/queryMaxPerAnswer
  - AiQueryAuditEntry, AiQueryOutcome, FinalizeInput.queries
  - ai_audit.queries_json column (fresh + migrated)
affects: [140-09]
key-files:
  modified:
    - packages/server/src/lib/aiConfig.ts
    - packages/server/.env.example
    - packages/server/tests/lib.aiConfig.spec.ts
    - packages/server/src/lib/aiAudit.ts
    - packages/server/src/db.ts
    - packages/server/tests/lib.aiAudit.spec.ts
requirements: [AIGOV-V20-03]
metrics:
  completed: 2026-10-21
---

# Phase 140 Plan 02: AI query limits and query audit Summary

Four AI_QUERY_* env limits (200 rows / 20000 chars / 30 s / 5 per answer) on AiConfig, plus per-answer query audit persisted to ai_audit.queries_json (SQL, rowCount, duration, outcome; no row values).

## Commits
- d938fb6 feat(140-02): AI_QUERY_* env limits on AiConfig
- 2d225be feat(140-02): per-query audit entries in ai_audit.queries_json

## RED evidence
- Task 1: `lib.aiConfig.spec.ts` 4 failed | 21 passed (CFGQ-1..4 failed before implementation). Now 25/25; boot.aiConfig green.
- Task 2: `lib.aiAudit.spec.ts` 4 failed | 9 passed (AUD-3, AUDQ-1, AUDQ-2, AUDQ-3 failed). Now 13/13.
- AUDQ-4 (no SQL in log line) passed pre-implementation: it is a negative assertion and cannot go red, since the log line never carried SQL. It is a regression guard only; its positive control (`"event":"ai_answer"`) confirms the line is emitted.

## Verification
- routes.aiAsk.audit.spec green; server `tsc --noEmit` clean.
- Env controlled: specs use explicit `parseAiConfig(env)` objects.

## Deviations from Plan
None to code. Acceptance greps all met as written.

## Deferred / out-of-scope
- `tests/db.smoke.spec.ts` has 2 failures (dashboard_layers column lists: CONFIG-V14-01, DV-V16-13). They concern dashboard_layers columns, not ai_audit; not touched by this plan (likely pre-existing or a sibling plan's column addition). Not fixed. Should be confirmed by 140-09.

## Self-Check: PASSED
