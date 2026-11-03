---
phase: 140-query-data-access-mode-injection-hardening
plan: 04
subsystem: server/ai
tags: [query-scope, column-profile, pure-modules]
requires: []
provides: [buildQueryScope, savedViewAlias, aiViewAlias, buildColumnProfileSql, parseColumnProfileResponse, parseTopValuesWithCounts, isProfileMinMaxType, isProfileTopValuesType, PROFILE_TOP_N]
key-files:
  created:
    - packages/server/src/lib/ai/queryScope.ts
    - packages/server/tests/lib.aiQueryScope.spec.ts
    - packages/server/src/lib/ai/columnProfileSql.ts
    - packages/server/tests/lib.aiColumnProfileSql.spec.ts
requirements-completed: [AIGOV-V20-03]
---
# Phase 140 Plan 04: Query scope + column profile SQL Summary

Pure per-answer query scope (table allow-list, dv_/aidv_ alias map, pass1/pass2 allow-lists, collision refusal) and exact-string get_column_profile SQL builders/parsers.

## Commits
- c100602 feat(140-04): buildQueryScope
- ea88431 feat(140-04): column profile SQL builders and parsers

## RED evidence
- Task 1 (stub): `tests/lib.aiQueryScope.spec.ts` 5 failed | 2 passed (QSC-1..5 red; QSC-6 and QSC-7 passed against the stub: QSC-6 asserts absence, which an empty stub satisfies, and QSC-7 helpers were already real in the stub).
- Task 2 (stub): `tests/lib.aiColumnProfileSql.spec.ts` 5 failed | 1 passed (CPS-1..5 red; CPS-6 constant was already defined in the stub).
- GREEN: 7/7 and 14/14 (incl. lib.topValuesSql.spec.ts); server `tsc --noEmit` clean.

## Deviations
None. Note: QSC-6 is a weak discriminator on its own (absence assertion); the collision logic is additionally covered because QSC-1 requires present keys, so an over-dropping implementation fails QSC-1. queryScope.ts has 0 db/fetch/console references.

## Self-Check: PASSED
