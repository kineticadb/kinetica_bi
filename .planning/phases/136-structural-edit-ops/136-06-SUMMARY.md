---
phase: 136-structural-edit-ops
plan: 06
subsystem: server-ai-loop
tags: [ai, agent-loop, W2, cap, clarification, sse]
requires: [136-04, 136-05]
provides:
  - AI_MAX_NEW_WIDGETS (1-30, default 6) -> config.maxNewWidgets
  - per-bad-reference repair counting (W2 fixed), quiet repair, refusal after two attempts
  - new-widget cap with stage "cap"; confirm_remove clarifications; SSE result {skipped, clarifications}
affects: [136-09, 137]
key-files:
  modified: [packages/server/src/lib/aiConfig.ts, .env.example, tests/setup.ts, tests/lib.aiNoNetwork.spec.ts, tests/lib.aiConfig.spec.ts, src/lib/ai/agentLoop.ts, src/lib/ai/runAnswer.ts, tests/lib.aiAgentLoop.spec.ts, tests/routes.aiAsk.sse.spec.ts]
metrics:
  tasks: 2
  completed: 2026-10-13
---

# Phase 136 Plan 06: Agent loop repair counting, cap, clarifications Summary

The loop counts repair attempts per bad reference (refKey, else tool:stage:slot) instead of per tool name, always runs the gateway, caps add_widget per answer, collects deduplicated confirm_remove clarifications, and surfaces `skipped` + `clarifications` on the SSE result event.

## Commits
- d62f740 feat(136-06): AI_MAX_NEW_WIDGETS setting (D-09)
- f6e0011 fix(136-06): per-reference repair counting (W2), new-widget cap, clarifications on the result event

## Evidence
- W2 red first: with the HEAD agentLoop swapped back in and the new spec in place, 9 failed / 22 (LOOP-5, W2-1..4, CAP6-1/2, APR-1/2), including `W2-1 two rejections of a tool never block a later valid call`. Restored new loop: all green.
- Mutation 1: re-added a by-tool-name pre-block (>= 2 rejected for tool.name) -> LOOP-5, W2-1, W2-3, W2-4 fail. Reverted.
- Mutation 2: cap condition replaced by `false` -> CAP6-1 and CAP6-2 fail. Reverted (file identical to saved copy).
- Positive control in W2-1: `rejected` has 2 entries (both rejections happened) before the valid call succeeds.
- Gates: tsc clean; loop/sse/audit specs 39/39 (routes.aiAsk.audit.spec.ts unedited); config specs 23/23; `node scripts/test-gate.mjs` PASSED (off-list lib.exportRunner.memory passes alone = TD-V16-TEST-ISOLATION).
- Greps after: MAX_REJECTIONS_PER_TOOL 0, "too many invalid attempts" 0, `skipped: result.skipped` 1, `clarifications: result.clarifications` 1.

## Deviations
- Task 1 was not run red-first: tests and implementation were written together and run once (green). Behaviour is trivially covered by AICFG6-1/2 and NET-1 (fails without the setup.ts blank, as NAMES asserts blanked env).
- `opSlot(op)` is duplicated in agentLoop.ts (gateway's `slotOf` is not exported; gateway.ts is outside this plan's files).
- W2-3: `rejected` (audit) has 3 entries for 3 identical attempts, since the gateway runs on every call (W2-4); only `skipped` is deduped by slot. Plan text said "ops []", consistent.
- LOOP-5 part 2 expects `describe` 3 calls (was 2).
- SSE6-1: added `clarifications` toEqual([]) in SSE-R2; existing skipped-stage assertions (SSE-R2, SSE-R3) unchanged and still green.

## Non-discriminating criteria
- Pre-check greps in the plan read as stated; the `W2-|CAP6-|APR-` count reads 0 before. No toothless ones found; the real checks are the red run and the two mutations.
- Not automatically verifiable: wording quality of the tool messages to the model (live check, 136-12).

## Notes for 136-09
- SSE result is `{answerId, text, ops, skipped: {label, stage, reasons}[], clarifications: {kind, question, options}[]}`; `skipped` stage values include "cap" and "clarification". Failed answers emit no result.
- Shape failures without slot key as `<tool>:shape:?` so distinct malformed calls to one tool merge into one skipped entry and share an attempt counter.
- `AgentLoopInput.maxNewWidgets` is required; any other construction of the loop input must pass it.

## Self-Check: PASSED
