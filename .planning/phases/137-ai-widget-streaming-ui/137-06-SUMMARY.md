---
phase: 137-ai-widget-streaming-ui
plan: 06
subsystem: server-ai
tags: [ai, sse, trailer, follow-ups]
requires: [137-01, 137-02, 137-04]
provides: [parseReplyTrailer, toChoiceClarification, AI_TRAILER_RULE, result.followUps, result.applied]
key-files:
  created: [packages/server/src/lib/ai/replyTrailer.ts, packages/server/tests/lib.aiReplyTrailer.spec.ts]
  modified: [packages/server/src/lib/ai/context.ts, packages/server/src/lib/ai/runAnswer.ts, packages/server/tests/lib.aiContext.spec.ts, packages/server/tests/routes.aiAsk.sse.spec.ts]
requirements: [AIWID-V20-03, AIWID-V20-05]
---
# Phase 137 Plan 06: Reply trailer Summary

D-20 server half: the prompt asks for "Follow-ups:" and "Choices:" trailers; a total parser strips them, and the SSE result carries stripped text, followUps (max 3 x 120), applied, and a choose_option clarification for 2+ choices, validated by the strict shared AskResultEventSchema.

## Tasks
1. parseReplyTrailer / toChoiceClarification, TRL-1..8 (8 pass).
2. AI_TRAILER_RULE appended to AI_SYSTEM_RULES; runAnswer ok-branch parses the trailer, sends followUps/applied, audit answerText is the stripped text. SSE7-1..3, CTX7-1 added.

## Verification
- Server tsc clean; 5 AI specs pass (45 tests); test-gate PASSED (only known failures plus contamination-only lib.exportRunner.memory and routes.discovery, both pass alone).
- Grep pre-checks read 0 before work (parseReplyTrailer, followUps in runAnswer, "Follow-ups:" in context, SSE7- in sse spec).
- No other spec asserted the old exact result key set; none needed updating.

## Deviations
None. Specs and implementation for Task 1 were written together (tests green on first run) rather than a separate red commit.

## Open item
Live model adherence to the trailer format is only checkable in Phase 142 UAT; the web falls back to local templates when the trailer is missing.

## Commits
See git log: feat(137-06) x2.

## Self-Check: PASSED
