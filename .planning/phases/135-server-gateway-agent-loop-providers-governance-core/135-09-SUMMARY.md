---
phase: 135-server-gateway-agent-loop-providers-governance-core
plan: 09
subsystem: ai-governance
tags: [agent-loop, atomic-apply, d-14, scripted-provider]
requires: [135-02, 135-03, 135-04, 135-06, 135-07]
provides: [runAgentLoop, AI_USER_MESSAGES, ScriptedProvider, RecordingProvider]
key-files:
  created:
    - packages/server/src/lib/ai/agentLoop.ts
    - packages/server/src/lib/ai/providers/scripted.ts
    - packages/server/tests/lib.aiAgentLoop.spec.ts
    - packages/server/tests/lib.aiScripted.spec.ts
requirements-completed: [AISAFE-V20-02, AIGOV-V20-06, AIGOV-V20-04]
completed: 2026-10-12
---

# Phase 135 Plan 09: Agent loop Summary

`runAgentLoop` runs provider call -> tool execution steps, sending mutate tools through `checkAiOp` and buffering approved ops; the buffer is read in exactly one place (`ops = outcome === "ok" ? bufferedOps : []`), so any non-ok outcome returns zero ops (D-14). Includes step cap with exact D-15 message, 429 waits via `withProviderRetry`, injected now/sleep, deadline + cancel + session re-checks, fixed user strings, and TEST-ONLY Scripted/Recording providers.

## Commits
- f7849c0 test(135-09): scripted and recording AI providers for specs
- feat(135-09) agent loop commit (see git log; hash follows f7849c0)

## Verification
- server tsc clean; `tests/lib.ai*` 19 files / 143 tests green (loop spec 14, scripted spec 6); `node scripts/test-gate.mjs` PASSED (8 known-failing files, none new).
- grep: `checkAiOp(` = 1, `buildOutboundRequest(` = 1, `useFakeTimers` in loop spec = 0.

## Mutation proofs (each reverted; file diffed identical; 14/14 green after)
1. `ops = bufferedOps` regardless of outcome -> LOOP-2, LOOP-7, LOOP-9 fail.
2. Rejected calls not counted as steps (`steps--` in rejection branch) -> LOOP-4b and LOOP-5 fail. NOTE: LOOP-4 (read-tool cap) does NOT fail under this mutation; the plan's "LOOP-4/LOOP-5" expectation only holds via the added LOOP-4b (rejected-only calls vs cap) which I wrote for this.
3. Remove the final pre-success `checkSession()` -> LOOP-9 (second case) fails.

## Deviations / notes
- RED first for Task 1 (module missing). Task 2: implementation written before the spec was run (no separate red run); mutation proofs are the discriminating evidence.
- Added LOOP-4b (not in plan) to make the "rejected calls count as steps" mutation discriminating.
- Design choices: a stream with no `done` and no error => provider_error/protocol; `overloaded` give-up maps to outcome `rate_limited` detail `overloaded`; unexecuted calls after the cap and repair-limit blocks are recorded in `tools` (result error/rejected) but not in `rejected` (gateway-only); unknown tool = shape rejection in `tools` only; read-tool throws other than SessionEndedError become a fixed "The tool failed." tool message (result error), never err.message.
- LOOP-6 "unexecuted call still gets an isError tool message": the message goes into the internal conversation which is not observable after the capped return, so the spec asserts the audit entry (`tools[1].result === "error"`) instead.
- Applied/text are also blanked on non-ok outcomes (not just ops).
- No real provider/network/.env used.

## Self-Check: PASSED
