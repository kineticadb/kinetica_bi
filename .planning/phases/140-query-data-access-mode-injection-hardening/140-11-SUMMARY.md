---
phase: 140-query-data-access-mode-injection-hardening
plan: 11
subsystem: ai
tags: [ai, egress, canary, query-mode, tests]
requires: ["140-09"]
provides:
  - "EGX-Q1..Q6 canary no-egress cases for query tools in schema and query mode"
affects: [routes.aiEgress.spec]
key-files:
  modified: [packages/server/tests/routes.aiEgress.spec.ts]
requirements-completed: [AIGOV-V20-03, AISAFE-V20-05]
gaps: []
duration: n/a
completed: 2026-10-21
---

# Phase 140 Plan 11: Query-mode canary egress matrix Summary

EGX-Q1..Q6 added through the real POST /api/ai/ask route. Schema mode leaks nothing and the query tools are unreachable; in query mode the canary row value reaches the provider only inside the run_query/get_column_profile tool messages, and every error path returns a fixed message. No leak found, so `gaps: []`.

## Tasks

Both tasks landed in one commit, edc9c7c (the helpers are shared), additions only.

- EGX-Q1: schema mode, run_query/get_column_profile give "Unknown tool ...", never offered in `tools`, kinetica saw only `LIMIT 0` probes, no canary in any request.
- EGX-Q2: canary-carrying invalid args give the unknown-tool text only; tool-role contents and SSE steps are canary-free.
- EGX-Q3/Q4 (one run): canary present in the run_query and get_column_profile tool messages (control); absent from system text, get_dashboard/list_tables/describe_table messages, all SSE events, and the ai_audit `answer_text/tools_json/changes_json/queries_json`.
- EGX-Q5: 403, 500, 400-with-Kinetica-text map to the three fixed messages; upstream bodies carried the canary (control).
- EGX-Q6: timeout gives "query timed out" with an alter/jobs cancel recorded; `; DROP TABLE` with a canary literal gives `Refused: badChars`, and nothing was sent upstream.

Additive helpers: `queryKineticaMock()`, `bootQuery()`, `toolMsg`/`toolMsgsOf`, `auditRowQ`, plus two new import lines (`db`, `GUARD_REASONS`) as separate lines so no existing line changed.

## Control evidence (EGX-Q1 discriminates)

Temporarily running EGX-Q1 with `AI_DATA_ACCESS: "query"` made it FAIL: the run_query tool message became `{"kind":"query_result",... "rows":[["CANARY_ROW_VALUE_9f3","v"]] ...}` instead of "Unknown tool run_query.", i.e. a user statement did reach Kinetica. Reverted (file restored from a copy, not committed).

## Verification

- `npx vitest run tests/routes.aiEgress.spec.ts --maxWorkers=4`: 14/14 (9 original + 5 new tests; Q3/Q4 share one test).
- server `tsc --noEmit` clean.
- `git diff` of the file: 0 removed lines (`grep -c "^-[^-]"` = 0); `AI_DATA_ACCESS: "query"` count 1 (was 0); `it.fails|GAP-140-` count 0.

## Deviations

- Q3 and Q4 are a single test (same run) rather than two; both behaviours are asserted. EGX-Q-number grep (`EGX-Q[3-6]`) still matches.
- One commit for both tasks.
- The plan's pre-check greps all read 0 before work (EGX-Q, EGX-Q[3-6], `AI_DATA_ACCESS: "query"`).

## Self-Check: PASSED
- Spec file exists, commit edc9c7c exists; STATE/ROADMAP/REQUIREMENTS untouched.
