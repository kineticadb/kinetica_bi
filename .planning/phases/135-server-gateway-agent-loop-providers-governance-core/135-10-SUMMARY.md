---
phase: 135-server-gateway-agent-loop-providers-governance-core
plan: 10
subsystem: ai-http
tags: [sse, routes, ai-use, audit, caps, provider-factory]
requires: [135-01, 135-03, 135-04, 135-05, 135-08, 135-09]
provides: [registerAiRoutes, runAnswer, createProviderFromConfig, createSseWriter, aiRouteKit]
key-files:
  created:
    - packages/server/src/aiRoutes.ts
    - packages/server/src/lib/ai/runAnswer.ts
    - packages/server/src/lib/ai/sseWriter.ts
    - packages/server/src/lib/ai/providers/index.ts
    - packages/server/tests/helpers/aiRouteKit.ts
    - packages/server/tests/lib.aiProviderFactory.spec.ts
    - packages/server/tests/routes.aiAsk.preflight.spec.ts
    - packages/server/tests/routes.aiAsk.sse.spec.ts
    - packages/server/tests/routes.aiAsk.audit.spec.ts
  modified:
    - packages/server/src/index.ts
requirements: [AIGOV-V20-01, AISAFE-V20-02, AISAFE-V20-03, AIGOV-V20-04, AIGOV-V20-06]
completed: 2026-10-12
---

# Phase 135 Plan 10: AI HTTP surface Summary

POST /api/ai/ask (SSE over POST, S2 pattern) and GET /api/ai/config, wired permission -> config -> size -> zod -> dashboard viewable -> in-flight -> cap/audit admit -> stream -> agent loop -> single `result` -> exactly-once audit finalize.

## Commits
- 4d7eb23 feat(135-10): provider factory, SSE writer and answer orchestrator
- 2a7196c feat(135-10): AI routes with ai:use refusal, caps and pre-stream checks
- 3dc4255 test(135-10): SSE streaming, gateway end-to-end and audit-row route specs

## Verification
- server tsc clean. PF (5), PRE (9), SSE-R (9), AUD-R (8) all green; `tests/routes.aiAsk tests/lib.ai` 173+ green.
- `node scripts/test-gate.mjs` PASSED (final run). Earlier runs flagged `lib.exportRunner.memory`, `layers.spec`, `routes.aiAsk.sse`, `routes.column-guard.filter-materialize`, `routes.management` as non-listed; every one passed alone or in the rerun (TD-V16-TEST-ISOLATION). A full `vitest run` showed zero aiAsk failures. The one AI-spec flake seen under load (SSE) is why `pollUntil` default is 3 s, not 1 s.
- `registerAiRoutes(app);` once in index.ts (line 1285), before `app.use(errorMiddleware)` (3315). `requirePermission(PERMISSIONS.AI_USE)` once in aiRoutes.ts. `grep -c scripted` on providers/index.ts + runAnswer.ts = 0. `useFakeTimers` in the three route specs = 0.
- Mutation proof: sending `result` regardless of outcome in runAnswer failed SSE-R2, SSE-R4, SSE-R5, SSE-R7 (4 failed / 5 passed); reverted via git checkout of the file, 9/9 green.
- RED: PF spec red (module missing); PRE specs red (9/9 failed, route absent) before aiRoutes.ts. SSE/AUD specs were written against already-existing behaviour (route + loop were in place), so they were not red; SSE-R2 was observed failing first for a real reason (see deviations) and the mutation proof is the discriminating evidence.

## Deviations
1. **[Plan vs reality] SSE-R2 script.** Two plan assumptions did not hold: (a) `type:"scatter"` is rejected at the SHAPE stage (the tool arg enum) so it can never produce an `allow_list` entry through add_widget; (b) the loop blocks a mutate tool after 2 rejections (MAX_REJECTIONS_PER_TOOL), and that block is recorded in `tools` only, not in `rejected`/`skipped`. Reworked: (b) is a `patch` of widget 7 with permanently blocked key `tableId` (allow_list), and the valid add_widget is issued before the second add_widget rejection. Stage order is still shape, allow_list, live_schema, reference. Worth knowing for 137: a valid op can be dropped if the model fails an op kind twice first.
2. **PRE-3** "reaches a later status" is asserted as a 400 AI_BAD_REQUEST (a stage after the permission 403) rather than a streamed answer.
3. **PRE-7** freezes `Date.now` with `vi.spyOn` (not fake timers) because the exact `720`/"12 minutes" values flaked under parallel load; restored right after the request.
4. providers/index.ts initially contained the word "scripted" in a comment (caught by the criterion grep); reworded in the Task 2 commit.
5. AUD `provider` column holds `config.provider` (e.g. `openai-compatible`), not the factory object's id, since admit happens before the provider is built; json mode therefore records `openai-compatible`.

## Non-discriminating / notes
- Plan PRE-8 "provider.test absent" is discriminating only because the config baseUrl is exactly that host (positive control on KEY_SENTINEL in process.env).
- In-flight map is keyed by lowercased username and audit rows store the lowercased username.
- Errors after headers are always SSE `error` events then `done`; route-level catch covers stream-setup failure; finalize runs in `finally` exactly once (falls back to cancelled/client_abort or provider_error/internal).
- nginx stream-location changes remain 137's.
- No STATE/ROADMAP/REQUIREMENTS edits; no real provider or .env read (network guard + injected providers).

## Self-Check: PASSED
Files exist; commits 4d7eb23 and 2a7196c exist.
