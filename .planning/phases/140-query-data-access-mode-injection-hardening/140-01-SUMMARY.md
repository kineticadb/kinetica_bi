---
phase: 140-query-data-access-mode-injection-hardening
plan: 01
subsystem: server/ai
tags: [sql-guard, libpg-query, injection-hardening]
requires: []
provides:
  - "lib/ai/sqlGuard.ts: guardQuery, substituteViewAliases, GUARD_REASONS, GUARD_MAX_SQL_CHARS, SYSTEM_SCHEMAS, functionNotAllowed, tableNotInScope"
affects: [140-06]
tech-stack:
  added: ["libpg-query@18.1.5 (runtime dependency of @kinetica-bi/server)"]
  patterns: ["raw-char refusal before parse (parser-differential defence)", "AST walk with CTE scoping", "byte-offset alias substitution"]
key-files:
  created:
    - packages/server/src/lib/ai/sqlGuard.ts
    - packages/server/tests/lib.aiSqlGuard.spec.ts
    - packages/server/tests/lib.aiSqlParser.smoke.spec.ts
  modified:
    - packages/server/package.json
    - package-lock.json
key-decisions:
  - "ki_home is not in SYSTEM_SCHEMAS (normal user schema in Kinetica)"
  - "Any unexpected exception inside guardQuery returns the fixed unparseable reason (fail closed, no message forwarded)"
requirements-completed: [AIGOV-V20-03]
duration: ~15min
completed: 2026-10-21
---

# Phase 140 Plan 01: SQL guard Summary

App-side guard for model-written SQL over the real PostgreSQL parser (libpg-query WASM), plus byte-offset view-alias substitution for the two-pass guard in 140-06.

## Commits
- chore(140-01): libpg-query dependency + smoke spec
- feat(140-01): guardQuery
- feat(140-01): substituteViewAliases

## RED evidence (run before implementing)
- Task 1: smoke spec failed on import of `libpg-query` (module not found), 0 tests ran. After install: 2/2 green.
- Task 2: against the stub, 76 of 76 cases failed (all refusals, and all accepts via the table-list assertion).
- Task 3: against the stub, 6 of 7 failed (S1, S2, S3, S5, S6, S7). S4 passed trivially under the stub because the expected output equals the input; it is still a valid regression guard for the real implementation (CTE not replaced), but it did not discriminate in the red run.

## Verification
- `npx vitest run tests/lib.aiSqlGuard.spec.ts tests/lib.aiSqlParser.smoke.spec.ts`: 85/85 pass. `npx tsc --noEmit` clean.
- Plain node load proof: `node --input-type=module -e "...parse('SELECT 1')..."` in packages/server printed `1`.
- `npm ls libpg-query --omit=dev --workspace @kinetica-bi/server`: `@kinetica-bi/server@1.23.0 -> libpg-query@18.1.5`.
- Invariants: `console.|fetch(` count in sqlGuard.ts = 0; `ki_home` appears once (comment only).
- Node-20 Docker image check remains the operator UAT item in 140-13.

## Dialect gaps confirmed
QUALIFY, PIVOT, TOP, `LIMIT a, b`, `TABLE(...)` and backticks are all refused as `unparseable` / `badChars` (R09, R28a-e). COERCE_SQL_SYNTAX functions (EXTRACT/TRIM/SUBSTRING/AT TIME ZONE) are allowed (A10); user-qualified functions are refused (R19b). Kinetica functions APPROX_MEDIAN, APPROX_PERCENTILE, ST_X, STXY_DISTANCE parse as ordinary function calls (A12, A17).

## Deviations from Plan
None. Every corpus query produced the verdict the plan specified; no expectation was changed. Minor note: one spec string (SQG-R06) uses a literal backslash, and the acceptance criterion `grep -c "SQG-A"` counts lines (20 with A13a/b, A15a/b split), which meets the >=18 bound; SQG-R lines = 53.

## Self-Check: PASSED
Files exist: sqlGuard.ts, lib.aiSqlGuard.spec.ts, lib.aiSqlParser.smoke.spec.ts. Three task commits present in git log.
