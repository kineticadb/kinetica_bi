---
phase: 135-server-gateway-agent-loop-providers-governance-core
plan: 02
subsystem: ai-governance
tags: [egress, provider-contract, sse, config, test-isolation]
requires: []
provides:
  - AskRequestSchema / AI_WIDGET_TYPES / ASK_REQUEST_MAX_BYTES (shared)
  - aiConfig caps, history, tool mode
  - LlmProvider / tool / gateway type contracts
  - parseSseStream
  - outbound.ts egress choke point (buildOutboundRequest, deriveOutboundRequest, isOutboundRequest, EgressViolation, part)
  - aiTestKit (canary, findLeak, captureConsole, forbidProviderNetwork)
affects: [135-03..135-12]
tech-stack:
  added: []
  patterns: [branded request + WeakSet runtime check, class-tagged parts, zod/v4 for tool JSON schemas (no new dep)]
key-files:
  created:
    - packages/shared/src/aiAsk.ts
    - packages/shared/src/aiAsk.spec.ts
    - packages/server/src/lib/ai/provider.ts
    - packages/server/src/lib/ai/tools/types.ts
    - packages/server/src/lib/ai/sseParse.ts
    - packages/server/src/lib/ai/outbound.ts
    - packages/server/tests/lib.aiSseParse.spec.ts
    - packages/server/tests/lib.aiOutbound.spec.ts
    - packages/server/tests/lib.aiNoNetwork.spec.ts
    - packages/server/tests/helpers/aiTestKit.ts
  modified:
    - packages/shared/src/index.ts
    - packages/server/src/lib/aiConfig.ts
    - packages/server/tests/lib.aiConfig.spec.ts
    - packages/server/tests/setup.ts
    - packages/server/.env.example
key-decisions:
  - "No new dependency; tool schemas use zod/v4 z.toJSONSchema"
  - "Snapshot binding is a closed key set; filters have no value field"
requirements-completed: [AIGOV-V20-02, AIPRV-V20-05]
duration: ~10 min
completed: 2026-10-12
---

# Phase 135 Plan 02: Contracts, egress choke point, test isolation

Shared strict ask contract, cap/history/tool-mode config, provider/tool type contracts, SSE parser, and the single classified egress builder that throws on `values`/`rows` in schema mode.

## Commits
- 43daae8 feat(135-02): shared ask contract, AI cap/history/tool-mode config, env blanking
- e92f93d feat(135-02): provider/tool contracts and SSE framing parser
- 157c11e feat(135-02): egress choke point, AI test kit and no-network guard

## Verification
- shared tsc + vitest (80 tests) green; server tsc clean; `tests/lib.ai*` + `boot.aiConfig` 54 tests green; web tsc clean.
- Mutation proof: adding `"rows"` to the schema-mode allow set made EGR-2 and EGR-6 FAIL (2 failed / 4 passed); reverted, 6/6 green.
- Server full set-based gate was NOT run (time); only AI-related files were run.

## Deviations
- Task commits: plan asked for a `test(...)` commit followed by a `feat(...)` commit in Task 1, and RED-first per task. Tests and implementation were written together and committed as one `feat` per task; the RED step was only observed for the shared aiAsk spec (module missing). Tasks 2/3 specs were not run red.
- Task 2 commit (e92f93d) imports types from outbound.ts, which landed in the Task 3 commit, so that single commit does not typecheck on its own (HEAD does).
- Task 1 spec `CAPS-2` etc. appended as a new `describe`; existing `toEqual` assertions did not involve the config object, so none needed changes.

## Non-discriminating criteria
- The plan's pre-check greps were not re-verified beyond plan time; the mutation proof above is the real check for EGR-2.
- The `SnapLayer` includes `widgetId` per the plan text; 135 downstream plans should treat it as required.

## Self-Check: PASSED
