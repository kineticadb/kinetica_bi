---
phase: 140-query-data-access-mode-injection-hardening
plan: 09
subsystem: ai
tags: [ai, query-mode, sse, audit, run_query]
requires: ["140-02", "140-03", "140-05", "140-06", "140-08"]
provides:
  - "Query mode wired into runAnswer (scope, port as the user, QUERY_TOOLS, system rules)"
  - "SSE result.queries and ai_audit.queries_json (normal, catch and hard-deadline paths)"
affects: [aiRoutes, runAnswer]
key-files:
  created: [packages/server/tests/routes.aiQuery.spec.ts]
  modified: [packages/server/src/lib/ai/runAnswer.ts, packages/server/src/aiRoutes.ts, packages/server/tests/helpers/aiRouteKit.ts]
requirements-completed: [AIGOV-V20-03]
duration: n/a
completed: 2026-10-21
---

# Phase 140 Plan 09: Query-mode wiring Summary

Query mode works end to end through the real POST /api/ai/ask route: per-answer scope built from server data, query port running as the signed-in user, QUERY_TOOLS gated by the registry, and the query list surfaced on the SSE result and in the audit row (including the hard-deadline finalize).

## Tasks

1. Task 1 (commit 27009f3): runAnswer wiring, `queryLog` holder for the deadline finalize, routes.aiQuery.spec.ts RQ-1..RQ-9.
2. Task 2: verification only (full gate below).

## RED (before touching runAnswer.ts)

`npx vitest run tests/routes.aiQuery.spec.ts`: 8 failed, 1 passed (RQ-3 schema-mode is a regression guard and correctly passes before and after).
- RQ-1/4/5/6: `expected [] to have a length of 1 but got +0` (no statement reached Kinetica)
- RQ-2: `expected 'Unknown tool run_query.' to be 'Refused: only a single SELECT ...'`
- RQ-7: `Cannot read properties of undefined (reading 'limit')`
- RQ-8 (user cancel): `expected false to be true` (no statement ever recorded / no alter/jobs)
- RQ-9 (deadline audit): `Target cannot be null or undefined` (queries_json was NULL)

GREEN: 9/9 pass; AI route set (aiAsk.*, aiEgress, aiDv*) 87/87 pass, schema-mode specs unchanged.

## Deviations

- [Rule 3 - Blocking] Added the four `AI_QUERY_*` keys to `AI_ENV_KEYS` in tests/helpers/aiRouteKit.ts so `enableAiEnv` restores them (otherwise they leak across spec files). One-line test-helper change, not in the plan's files list.
- Note: the plan names the port module `queryPort`; the actual file is `lib/ai/queryRunner.ts` (from 140-06). Imports adjusted accordingly.
- Observation (not a code issue): running the 9 AI route files with default parallelism produced load-only flakes (W1-2, PRE-3, AIDV-2, RQ-2 timeout); every file passes alone and all 9 pass together with `--maxWorkers=2`.
- No grep criteria needed rewriting; the post-conditions (`createQueryPort(`, `buildQueryScope(`, `extraTools: [...QUERY_TOOLS]`, `queryPort.entries()` x2+, `queryLog`) were 0 before and are present now.

## Verification (Task 2)

- server `tsc --noEmit`: clean; web `tsc --noEmit`: clean; shared `tsc` clean and vitest 192/192.
- `node scripts/test-gate.mjs`: GATE PASSED (exit 0). 2515/2570 tests; 10 failing files, all allowed:
  - Known (8): auth.oidc, auth.routes (/me authMode, .env present), boot.hardening, boot.wipe, bootstrap (AUTH_OIDC_ISSUER_URL, .env present), db.smoke, oidc.module, routes.wms.
  - Contamination-only (2), each PASSES alone per the gate's isolation re-run: lib.exportRunner.memory, routes.dashboard-export.
  - No TTL assertion failures; no 139/140 file failing.

## Self-Check: PASSED
- 140-09 spec file and commit 27009f3 exist; STATE/ROADMAP/REQUIREMENTS untouched.
