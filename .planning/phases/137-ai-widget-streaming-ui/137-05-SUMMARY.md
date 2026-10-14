---
phase: 137-ai-widget-streaming-ui
plan: 05
subsystem: web/aiSession
tags: [ai-widget, pure-helpers, chart-registry]
requires: []
provides:
  - buildStarterQuestions / buildTemplateFollowUps (local, no network)
  - AI_CHAT_COPY, friendlyProgressLabel, formatElapsed, describeSkipped
  - computeChangeCounts / changedWidgetIds
  - AI_ASSISTANT_TYPE, AI_ASSISTANT_DEFAULT_SIZE, AI_SMALL_TILE, isSmallAiTile, AI_HIGHLIGHT_MS
  - "ai" chart type ("AI Assistant") registered, excluded from combination pipeline
affects: [137-07, 137-10, 137-11]
key-files:
  created:
    - packages/web/src/lib/aiSession/starterQuestions.ts
    - packages/web/src/lib/aiSession/chatText.ts
    - packages/web/src/lib/aiSession/changeCounts.ts
    - packages/web/src/components/charts/definitions/ai.ts
  modified:
    - packages/web/src/lib/aiSession/constants.ts
    - packages/web/src/components/charts/definitions/index.ts
    - packages/web/src/components/charts/registry.addable.spec.ts
    - packages/web/src/hooks/useCombinationOrchestrator.ts
    - packages/web/src/lib/useReverseFilterMap.ts
decisions:
  - Template follow-ups are drawn from the starter set (max 3) minus the asked question, per SQ-4 "the other starters".
  - changedWidgetIds also marks the target of change_widget_type (not listed in the plan, same semantics as set_widget_title).
metrics:
  tasks: 3
  completed: 2026-10-14
---

# Phase 137 Plan 05: Pure AI building blocks and "ai" chart type Summary

Local starter/follow-up templates, shared chat copy, change counts with layer-host-map resolution, size constants, and the "AI Assistant" chart type registered and kept out of both NON_TRIGGER sets' trigger path.

## Commits
- b486fb6: starter questions + chat text
- 57d30ca: change counts + constants
- 1e9b351: ai definition, registration, NON_TRIGGER sets

## Deviations from Plan
None of substance. Minor: change_widget_type is included in changedWidgetIds (see decisions).

## Verification
- New specs pass (SQ-1..4, CT-1..3, CC-1..4 incl. CC-3b, REG-AI-1/2); `src/hooks`, `useReverseFilterMap` (174 tests) and theme-guard (160) green.
- `npx tsc --noEmit` shows one error outside this plan: `src/lib/aiSession/askStream.ts(124,21): Cannot find name 'askAi'` (plan 137-04 in-flight file). Not touched.

## Self-Check: PASSED
Files exist, commits b486fb6 / 57d30ca / 1e9b351 present in git log.
