---
phase: 135-server-gateway-agent-loop-providers-governance-core
plan: 11
subsystem: ai-governance
tags: [egress, canary, key-sentinel, positive-control, import-guard]
requires: [135-02, 135-10]
provides: [routes.aiEgress.spec, routes.aiSecrets.spec, lib.aiProdImports.spec]
key-files:
  created:
    - packages/server/tests/routes.aiEgress.spec.ts
    - packages/server/tests/routes.aiSecrets.spec.ts
    - packages/server/tests/lib.aiProdImports.spec.ts
requirements: [AIGOV-V20-02, AIPRV-V20-05]
completed: 2026-10-12
---

# Phase 135 Plan 11: Egress canary + key sentinel proofs

Test-only plan. No production code changed; no production leak found.

## Commits
- 91f8618 test(135-11): schema-mode canary egress matrix with positive controls
- 1ac1768 test(135-11): key-sentinel matrix and production-import guard with positive controls

## What is proven
- **EGX-1..6** (real route, schema mode, RecordingProvider over ScriptedProvider): Kinetica mock returns the canary inside the trips probe rows, in the 403 body and in the 500 body. Valid args for all 10 tool calls, invalid args containing the canary (checked on tool-role messages and system text only), unknown table/column/tool, provider errors (bad_request, rate_limited beyond budget, auth), mid-answer session end, snapshot-borne canary (filter `value` and widget `binding.customWhere` both 400 AI_BAD_REQUEST with zero provider requests).
- **EGX-P1..P3**: canary is in the upstream body and detector's raw/url/base64 branches fire; recording contains `fare_amount`/`vendor_id`; query mode admits `part.rows(CANARY)` while schema mode throws EgressViolation.
- **KEY-1..10** (real OpenAI-compatible adapter, no factory override, fetch stub for provider.test): ok text, tool+text, 401, 429 beyond budget, 500, client abort, step cap, gateway rejection, pre-stream refusals (403/400/404/429 cap), disabled 503. Surfaces each case collected: raw SSE bytes, GET /api/ai/config, GET /api/auth/me, `SELECT * FROM ai_audit`, captured console (KEY-9 adds each refusal body + headers). BODYSENTINEL is checked absent from SSE, audit and console for the error cases.
- **KEY-P1..P3**: Authorization header equals `Bearer KEY_SENTINEL` (and body does not contain it); console capture + detector fire on a deliberate leak; BODYSENTINEL really is in the error fixtures.
- **IMP-1 / IMP-P**: walker over all `src/**/*.ts` (excluding spikes) finds no importer of `providers/scripted`; control flags static, dynamic `.js`, re-export forms and passes a clean file.

## Mutation proofs (all reverted via git checkout, files clean)
- liveSchema describe: appended probe `column_1` row values to column names -> EGX-1, 2, 3, 4, 5 FAILED (5 failed / 4 passed); reverted 9/9 green.
- `console.log(\`[ai] key=${config.apiKey}\`)` in createProviderFromConfig -> KEY-1..9 FAILED (9 failed / 4 passed); reverted green.
- `import { ScriptedProvider }` added to aiRoutes.ts -> IMP-1 FAILED with `['aiRoutes.ts']`; reverted green.

## Verification
server tsc clean; 3 new specs 24/24 green together; `node scripts/test-gate.mjs` PASSED (8 known-failing; one non-listed file, lib.exportRunner.memory, passes alone = TD-V16 contamination).

## Deviations
1. Test-side only: EGX cases need >10 tool calls in one answer, so boot sets `AI_MAX_TOOL_STEPS=20` (first run hit the default step cap, outcome "capped").
2. EGX-P1's url-form control uses a needle with URL-special characters (`a b&c`) because the canary itself contains none, so its url and raw forms coincide.
3. KEY abort scenario's hanging fetch must reject on signal abort; otherwise the module-global in-flight entry leaks into later cases (AI_BUSY 409).
4. EGX-4 loops three provider-error variants within one test (each with fresh app/env) rather than three tests.

## Non-discriminating / notes
- Plan EGX-2 says the canary is absent from "every system text" and tool-role messages; assistant tool-call args are excluded by design and a control asserts they DO contain it.
- Plan EGX-6 wording "snapshot filter value -> 400": enforced by the strict zod contract (unrecognized key), so it is a contract refusal, not a gateway scrub.
- The IMP guard is lexical (regex over specifiers); it does not follow computed import paths.
- No STATE/ROADMAP/REQUIREMENTS edits; no real provider call; packages/server/.env not read.

## Self-Check: PASSED
