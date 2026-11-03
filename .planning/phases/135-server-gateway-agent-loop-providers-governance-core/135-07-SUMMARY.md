---
phase: 135-server-gateway-agent-loop-providers-governance-core
plan: 07
subsystem: ai-tools
tags: [tool-registry, flat-schema, zod-v4, read-tools, mutate-tools]
requires: [135-02]
provides: [READ_TOOLS, MUTATE_TOOLS, buildToolRegistry, sanitizeToolSchema, QUERY_TOOL_NAMES]
key-files:
  created:
    - packages/server/src/lib/ai/tools/read.ts
    - packages/server/src/lib/ai/tools/mutate.ts
    - packages/server/src/lib/ai/tools/registry.ts
    - packages/server/tests/lib.aiTools.spec.ts
    - packages/server/tests/lib.aiToolsRegistry.spec.ts
requirements-completed: [AISAFE-V20-03, AIGOV-V20-02]
completed: 2026-10-12
---

# Phase 135 Plan 07: Tool registry Summary

Eight tools (get_dashboard, list_tables, describe_table; add_widget, patch, remove_widget/layer/dynamic_view) with flat zod/v4 provider schemas, user-credentialed table filtering via allow-listed serializers, and a schema-mode query-tool gate.

## Commits
- b1deeff feat(135-07): AI read and validate-only mutate tools
- 4227c5c feat(135-07): tool registry with flat provider schemas and schema-mode query gate

## Verification
- server tsc clean; `lib.aiTools.spec.ts` (7) + `lib.aiToolsRegistry.spec.ts` (4) green.
- Mutation proofs: DESC_MAX 200 to 300 failed TL-4; forcing the query-tool gate open failed REG-3. Both reverted.
- grep: no `JSON.stringify(t|table|res` in read.ts (0); no zod-to-json-schema in package.json (0).

## Deviations
- RED was observed for Task 1 (module missing); Task 2 was written together with its implementation, not run red separately. Tests and impl in one commit per task (no separate test commit).
- Task 1 tool registry file did not exist yet so Task 1 was verified standalone.

## Notes
- list_tables result attaches an extra `note` field when tables were not probed; dashboard-own tables are ordered first before the 50-cap is applied.
- describe_table "not available" is emitted as a `schema`-class part with isError:true.
- Non-discriminating criteria: the grep-based allow-list check is weak by itself (as the plan notes); TL-4 with positive control is the real check.

## Self-Check: PASSED
