---
phase: 137-ai-widget-streaming-ui
plan: 07
subsystem: web/aiSession
tags: [ai-widget, runner, store, fold]
requires: ["137-04", "137-05"]
provides:
  - runAsk / cancelAsk / choiceQuestion / AskContext (askRunner)
  - store slices run, draft, epoch, highlight; chat on turns; markChoicePicked
  - fold guard refusing ops on the AI Assistant widget
  - derived.aiLayerHostWidgetIds + selectShowsAiEditedPill
  - bignumber default label "<Aggregation> of <column>"
  - optional `ai?: AskContext` on DashboardContext
affects: [137-08, 137-09, 137-10, 137-11]
key-files:
  created:
    - packages/web/src/lib/aiSession/askRunner.ts
    - packages/web/src/lib/aiSession/askRunner.spec.ts
    - packages/web/src/store/aiSessionStore.chat.spec.ts
  modified:
    - packages/web/src/store/aiSessionStore.ts
    - packages/web/src/lib/aiSession/foldSession.ts
    - packages/web/src/lib/aiSession/foldSession.spec.ts
    - packages/web/src/lib/aiSession/types.ts
    - packages/web/src/lib/aiSession/constants.ts
    - packages/web/src/components/DashboardContext.tsx
decisions:
  - epoch kept out of `initial`; reset() does epoch + 1 so a late result after Discard/dashboard switch is dropped.
  - Highlight host-map resolution uses the union of pre- and post-apply effective includedLayerIds and every layer seen before or after the answer.
  - 401 responses record nothing (session expiry is handled by apiFetch); 403 shows inline AI_CHAT_COPY.noAccess with no runner toast.
metrics:
  tasks: 3
  completed: 2026-10-14
---

# Phase 137 Plan 07: Ask runner, store slices, fold guard, layer-host pill set, KPI label Summary

One-at-a-time ask runner over the streaming transport with shared run/draft/epoch/highlight store state, an AI-widget guard in the fold, host-map pill tracking that does not double count, and real labels for AI-added big numbers.

## Commits
- 1c1e187: store slices + chat on turns + FOLD7-1 guard (Task 1)
- 74b2f9e: askRunner + DashboardContext `ai` accessor (Task 2)
- bcf714c: aiLayerHostWidgetIds, selectShowsAiEditedPill, big-number default label (Task 3)

## Evidence
- Pre-checks (before work): `epoch|highlight|draft` in aiSessionStore.ts = 0; `type === "ai"` in foldSession.ts = 0; `aiLayerHostWidgetIds|selectShowsAiEditedPill|HOST7-|KPI7-|RUN-9|runAsk|cancelAsk` anywhere in src = 0; `aggregationLabel` in foldSession.ts = 0.
- Red-first: STC-*/FOLD7-1 failed before Task 1 code; HOST7-1..4 and KPI7-1/3/4 (7 tests) failed before the Task 3 fold change (HOST7-1 and KPI7-1 among them), passed after.
- Mutation proofs: removing the `run.status === "running"` guard fails RUN-2; removing the epoch check fails RUN-7; merging host ids into aiEditedWidgetIds fails HOST7-1 and HOST7-5. All restored.
- Gates: web `tsc --noEmit` clean; `vitest run --maxWorkers=4` 227 files passed, 1 skipped, 4701 tests passed; theme-guard 160 passed. `useEffect` count in askRunner.ts = 0.
- RUN-9 (136-12 UAT finding 3) proves add, patch and remove of an AI-added layer all highlight host map 117.

## Deviations from Plan

**1. [Rule 1 - Spec adaptation] KPI7-4 cannot go through evaluateTurn**
- The shared op schema only allows change_widget_type to bar/line/pie (AI_CHART_SWAP_TYPES), so a bignumber target is skipped at evaluation. The fold branch is implemented defensively (`(op.type as string) === "bignumber"`) and KPI7-4 feeds applied entries directly to foldSession. The branch is unreachable for server-valid ops today; flagging in case the plan author expected the swap to be allowed.
- Files: foldSession.ts, foldSession.spec.ts. Commit: bcf714c.

**2. [Test note] RUN-5 403 assertion counts error-kind toasts only**, because the real apiFetch raises its own permission toast on 403; the runner itself adds no toast.

## Notes
- Aggregation in AI configs is lowercase ("sum"); the label helper uppercases before `aggregationLabel`.
- Whether the label reads well and the map pill appears in the live grid is a 137-12 operator check.

## Self-Check: PASSED
Created files exist (askRunner.ts, askRunner.spec.ts, aiSessionStore.chat.spec.ts); commits 1c1e187, 74b2f9e, bcf714c present in git log.
