---
phase: 135-server-gateway-agent-loop-providers-governance-core
plan: 05
subsystem: ai-providers
tags: [claude, fetch, sse, json-action, fixtures]
requires: [135-02]
provides:
  - createClaudeProvider (fetch-based, NOT live-verified)
  - createJsonActionProvider / extractFirstJsonObject (AI_TOOL_MODE=json decorator)
affects: [135-06, 135-12]
key-files:
  created:
    - packages/server/src/lib/ai/providers/claude.ts
    - packages/server/src/lib/ai/providers/jsonAction.ts
    - packages/server/tests/lib.aiClaude.spec.ts
    - packages/server/tests/lib.aiJsonAction.spec.ts
    - packages/server/tests/fixtures/ai/claude/ (README, 5 SSE, 3 error JSON)
key-decisions:
  - "Usage is emitted once, just before done (cumulative output_tokens, last wins)"
  - "Provider body text is never read on HTTP errors; stream error events map by error.type only"
  - "429 retryAfterMs only when a positive retry-after header exists"
requirements-completed: [AIPRV-V20-04, AIPRV-V20-05]
completed: 2026-10-12
---

# Phase 135 Plan 05: Claude adapter + JSON action fallback

Plain-fetch Claude adapter (auto tool_choice, no `thinking`, verbatim thinking replay, tool_results first in one user message) tested on doc-derived fixtures, plus a decorator that lets the unchanged loop drive models without native tools.

## Commits
- 07a0bb0 feat(135-05): Claude adapter on fetch (doc fixtures, not live-verified)
- 55290f4 feat(135-05): JSON action-plan fallback provider for weak tool-calling models

## Verification
- server `tsc --noEmit` clean; `lib.aiClaude.spec.ts` (9) + `lib.aiJsonAction.spec.ts` (6) green = 15/15.
- Red observed for both specs (module missing) before implementation.
- Mutation proof (Claude): `tool_choice:{type:"any"}` -> CLD-7 failed (1 failed/8 passed); adding `thinking:{type:"disabled"}` -> CLD-7 failed; reverted, 9/9.
- Mutation proof (json): removing `tools: []` from the derive call -> JSA-1 failed (1/6); reverted, 6/6.
- grep: `deriveOutboundRequest(` in jsonAction.ts = 1; `eval(`/`new Function(` = 0; "NOT live-verified" present in claude.ts header and README ("not live-recorded").
- Server full set-based gate not run; only these files + tsc.

## Deviations
- Pre-check greps from the plan were not individually re-run before writing (the module files did not exist, and red-phase failure proved the specs discriminate).
- Fixtures were created with a shell script rather than the Write tool.
- text.sse.txt contains two `message_delta` events (5 then 15 output tokens) to give CLD-1 a real "cumulative, last wins" discriminator; this is synthetic, not a documented stream shape.

## Notes
- Claude adapter is NOT live-verified (no Anthropic key, AI-F11); the README mention in the project README/docs is plan 135-12's.
- `AI_TOOL_MODE` wiring (choosing the decorator) belongs to the gateway/boot plan; this plan only provides the decorator.

## Self-Check: PASSED
