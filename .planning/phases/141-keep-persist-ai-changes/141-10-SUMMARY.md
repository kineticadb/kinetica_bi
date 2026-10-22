---
phase: 141-keep-persist-ai-changes
plan: 10
subsystem: web-ai-chat
tags: [ai, keep, chat, history]
requires: [141-04]
provides: [read-only saved conversation rendering, saved turns as provider history]
affects: [AiChat, buildAskRequest, askRunner]
key-files:
  modified:
    - packages/web/src/components/charts/AiChat.tsx
    - packages/web/src/lib/aiSession/buildAskRequest.ts
    - packages/web/src/lib/aiSession/buildAskRequest.spec.ts
    - packages/web/src/lib/aiSession/askRunner.ts
  created:
    - packages/web/src/components/charts/AiChat.keep.spec.tsx
decisions:
  - "buildAskTurns takes saved items as a defaulted third arg; saved turns are placed before live turns and go through the same ok-status filter and recent-answer window."
requirements: [AISES-V20-05]
gaps: []
metrics:
  completed: 2026-10-21
---

# Phase 141 Plan 10: Kept conversation rendering and history Summary

After Keep, AiChat renders `savedTurns` read-only (bubbles and muted notes only). The next ask sends them to the AI as history ahead of live turns.

## Commits
- fa69446: saved turns as provider history (Task 1)
- aba0063: AiChat read-only rendering (Task 2)

## RED evidence
- Task 1: `buildAskRequest.spec.ts (21 tests | 4 failed)`. KHIST-1, 2, 3 and 5 failed. KHIST-4 passed by design, since it pins that the default is unchanged.
- Task 2: `AiChat.keep.spec.tsx Tests 5 failed (5)`. KCHAT-1..5 all failed.

## GREEN
- buildAskRequest and askRunner specs: 34 passed.
- AiChat.spec, AiChat.keep.spec and theme-guard: 201 passed.
- `tsc --noEmit` is clean.

## Class names added
All reused: `ai-chat-turn`, `ai-chat-bubble ai-chat-bubble--user`, `ai-chat-bubble ai-chat-bubble--ai`, `ai-chat-note muted`. No new CSS and no hex. Visual legibility is the 141-14 human check.

## Criteria notes
- `grep -c "savedTurns: s.savedTurns" askRunner.ts` is 1, and it was 0 before. The criterion discriminates.
- KCHAT-1 and KCHAT-2 assert the exact rendered class strings, so they discriminate class use.

## Deviations from Plan
None. Plan executed as written.

## Self-Check: PASSED
