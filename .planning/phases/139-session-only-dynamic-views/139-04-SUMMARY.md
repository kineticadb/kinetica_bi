---
phase: 139-session-only-dynamic-views
plan: 04
subsystem: server
tags: [ai, dynamic-views, sql-compiler, pure-module]
requires: [139-01]
provides:
  - validateAiDvSpec, compileAiDvSpec, AiDvCompileError, AI_DV_BUCKET_UNITS (lib/aiDvCompile.ts)
affects: [139-05, 139-07]
key-files:
  created:
    - packages/server/src/lib/aiDvCompile.ts
    - packages/server/tests/lib.aiDvCompile.spec.ts
key-decisions:
  - "Numeric aggregates require a registered numeric type; unknown type counts as not numeric"
  - "joinRefs override only the session FROM of joins; the persisted template joins raw schema.table (D-21)"
requirements-completed: []
duration: ~12min
completed: 2026-10-20
---

# Phase 139 Plan 04: compileAiDvSpec Summary

Pure server compiler turning a structured AiDvSpec into a Keep-compatible `{view}` template with double-quoted, alias-qualified (t0..tN) identifiers, APPROX_MEDIAN/APPROX_PERCENTILE, DATE_TRUNC from a closed unit map, and filter values escaped by buildServerWhereClause.

## Commits
- 9952bc4: validateAiDvSpec (Task 1)
- 9446fa7: compileAiDvSpec (Task 2)

## Verification
- Red-first: spec run with module missing (no tests), then Task 2 tests run with `compileAiDvSpec is not a function` (10 failing) before implementation.
- `tsc --noEmit` clean; lib.aiDvCompile.spec (CMP-1..20) + lib.dynamicViewSql.spec: 30/30 pass.
- Acceptance greps: pre-checks 0 before; after APPROX_* = 3, COUNT_DISTINCT( = 0, CMP- = 20. CMP-11/12 assert full exact SQL.

## Deviations from Plan
- CMP-17's "no unquoted identifier" check was written as a negative regex (no bare quoted identifier outside `tN."col"` refs / `AS "alias"` / ORDER BY output names) instead of splitting the SELECT list, because DATE_TRUNC contains a comma. First version of the test was wrong, fixed in the test only.
- Non-discriminating note: CMP-6's "value never appears" is checked on JSON of the whole validation, which discriminates (value would appear if echoed).

## Self-Check: PASSED
aiDvCompile.ts and spec exist; commits 9952bc4 and 9446fa7 found in git log.
