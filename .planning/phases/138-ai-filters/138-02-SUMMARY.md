---
phase: 138-ai-filters
plan: 02
subsystem: server-ai
tags: [ai, filters, gateway, tools]
requires: [138-01]
provides: [apply_filter/clear_filter tools, gateway filter validation, shadow filterCols, AI_FILTER_RULES]
affects: [138-03, 138-08]
key-files:
  created:
    - packages/server/tests/lib.aiGateway.filter.spec.ts
    - packages/server/tests/lib.aiFilter.e2e.spec.ts
  modified:
    - packages/server/src/lib/ai/shadow.ts
    - packages/server/src/lib/ai/gateway.ts
    - packages/server/src/lib/ai/tools/mutate.ts
    - packages/server/src/lib/ai/runAnswer.ts
    - packages/server/src/lib/ai/context.ts
    - packages/server/tests/lib.aiTools.spec.ts
    - packages/server/tests/lib.aiToolsRegistry.spec.ts
    - packages/server/tests/lib.aiContext.spec.ts
requirements-completed: [AIACT-V20-09 (server part only; phase-level completion owned by 138-08)]
completed: 2026-10-15
---

# Phase 138 Plan 02: Server-side AI filters Summary

Two flat tools (`apply_filter`, `clear_filter`) validated at the one gateway: source resolution (with a `choose_option` question when a column is on several sources), reference checks, live-schema column and type coercion that stamps typed values, the 25-per-source cap (refuse whole, replace allowed), a per-answer `filterCols` shadow, and three prompt rules.

## Commits
- cce8188: shadow filterCols + gateway validation + GWF-1..12 (Task 1)
- 13d4743: flat tools, `dynamicViewInfo` wiring in runAnswer, TOOLF-1..3, REG-1 = 17 tools (Task 2)
- ec37b7a: TL-7 tool-name list updated for the two new tools (follow-up, see deviations)
- 6dcc5b1: `AI_FILTER_RULES` + CTXF-1 + E2EF-1..6 (Task 3)

## Red-first evidence
- lib.aiGateway.filter.spec.ts: 12/12 failed before the gateway change, then 50/50 across filter + gateway + shadow specs.
- Task 2 and Task 3 specs were written alongside already-landed lower layers, so no separate red run was captured for TOOLF, CTXF-1 or E2EF; the E2EF proofs pass only because the Task 1/2 code exists.

## Verification
- server `npx tsc --noEmit` clean.
- `node scripts/test-gate.mjs`: GATE PASSED. 9 failing files: 8 on the known list (auth.oidc, auth.routes, boot.hardening, boot.wipe, bootstrap, db.smoke, oidc.module, routes.wms) and `lib.exportRunner.memory.spec.ts`, which passes alone (TD-V16-TEST-ISOLATION). No pass count asserted.
- No real provider or Kinetica call was made (ScriptedProvider, stub LiveSchemaPort, `forbidProviderNetwork()`); `packages/server/.env` was not read.
- Tool args, including user-stated filter values, land in `ai_audit.tools_json` by design (AIGOV-V20-02). Labels, tool results and failure reasons are value-free (GWF-11, E2EF-6).

## Deviations from Plan
**1. [Rule 3 - Blocking] TL-7 name list.** `lib.aiTools.spec.ts` TL-7 asserted the exact MUTATE_TOOLS name list. Adding the two tools broke it, so I updated it. My first Task 2 commit went in without that fix (a macOS `sed -i` flag error); ec37b7a corrects it.

**2. Non-discriminating criteria.** None found; plan-time pre-check greps all read 0 before the work.

**3. Registry-level `anyOf`.** Not an issue: both tools use flat optional fields; REG-2 stays green.

## Notes for downstream
- Gateway-resolved `source` and typed `filters[].value/dataType` are what the client fold (138-03) receives.
- `dynamicViewInfo` is scoped to the dashboard: a dv on another dashboard reads as nonexistent.
- AI temp (negative) dynamic views are refused as sources until Phase 139.

## Self-Check: PASSED
All 10 plan files present; commits cce8188, 13d4743, ec37b7a, 6dcc5b1 verified in git log.
