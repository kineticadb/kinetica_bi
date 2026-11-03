---
phase: 137-ai-widget-streaming-ui
plan: 04
subsystem: ai-widget-web-transport
tags: [sse, zod, shared-contract, request-builder]
requires: []
provides:
  - AskResultEventSchema / AskStreamEvent / choose_option / AI_FOLLOWUP_MAX (shared)
  - streamAsk, parseSseStream, AskHttpError, AI_CONNECTION_LOST (web)
  - askAi, getAiConfig (client.ts), useAiConfigured
  - buildAskSnapshot, buildAskTurns, buildAskRequest
  - TurnChat type on Turn/TurnInput
affects: [137-06 server result event, 137-05, 137-07 runner]
key-files:
  created:
    - packages/web/src/lib/aiSession/askStream.ts
    - packages/web/src/lib/aiSession/askStream.spec.ts
    - packages/web/src/lib/aiSession/aiAvailability.ts
    - packages/web/src/lib/aiSession/buildAskRequest.ts
    - packages/web/src/lib/aiSession/buildAskRequest.spec.ts
  modified:
    - packages/shared/src/aiAsk.ts
    - packages/shared/src/aiAsk.spec.ts
    - packages/web/src/api/client.ts
    - packages/web/src/lib/aiSession/types.ts
metrics:
  tasks: 3
  completed: 2026-10-14
---

# Phase 137 Plan 04: Web transport + shared result contract Summary

Shared result-event contract (followUps, applied, choose_option) plus a fetch-based SSE-over-POST reader with typed pre-stream errors and a pure, 60 KB-capped ask request builder.

## Commits
- f2e9ac8: shared contract + TurnChat
- d0327ac: askAi/getAiConfig, streamAsk, AskHttpError, useAiConfigured
- 6dc4829: buildAskRequest

## Decisions
- Request builder drops the oldest turn until body < 60000 bytes; last 8 kept turns carry answers truncated to 1500 chars, older carry "".
- Layers attach to the first map whose layersOfMap includes them; layers on no map are omitted.
- streamAsk ignores unknown event names and unparsable data; the runner (plan 07) must use AI_CONNECTION_LOST when no result/error arrives.

## Deviations from Plan
None. Plan executed as written.

## Verification
- shared: vitest 147 passed, tsc clean. server tsc clean. web tsc clean.
- web full vitest: 225 files passed, 1 skipped; new specs ASKS-1..6, BAR-1..7, ASKC-1..3 green. theme-guard not run separately (no CSS/TSX touched); it is part of the full run.
- Pre-checks confirmed 0 before work for the grep criteria; EventSource count in aiSession = 0.
- Server test-gate not run (server source untouched; only shared type-level additions, tsc clean).

## Self-Check: PASSED
All created files exist; commits f2e9ac8, d0327ac, 6dc4829 present.
