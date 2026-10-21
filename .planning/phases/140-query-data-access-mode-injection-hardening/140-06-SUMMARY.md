---
phase: 140-query-data-access-mode-injection-hardening
plan: 06
subsystem: ai-query-port
tags: [ai, sql-guard, kinetica, audit, injection-hardening]
requires: [140-01, 140-02, 140-04, 140-05]
provides: [createQueryPort, QueryPort, QUERY_ERRORS, CELL_MAX_CHARS]
affects: [140-08, 140-09]
tech-stack:
  added: []
  patterns: [two-pass SQL guard, tagged job cancel, fixed-category errors, shared timeout/cancel scaffold]
key-files:
  created:
    - packages/server/src/lib/ai/queryRunner.ts
    - packages/server/tests/lib.aiQueryRunner.spec.ts
  modified: []
decisions:
  - "Profile cancel uses the in-flight statement's tag (-1 or -2), not the base tag, because each statement is tagged separately."
  - "Char-budget trimming includes the truncation note, so the final envelope is always <= maxChars."
metrics:
  tasks: 2
  files: 2
  completed: 2026-10-21
---

# Phase 140 Plan 06: Query Port Summary

`createQueryPort` turns model SQL or a profile request into a guarded, user-credentialed, row/char-capped, cancellable Kinetica call. It returns fixed-category errors only and audits every attempt.

## Commits
- d25ae10: feat(140-06): run() with two-pass guard, caps, timeout/cancel, fixed errors, audit
- 0d0a8e5: feat(140-06): profile() with dashboard-table and live-column vetting

## Red-first evidence
- Task 1 (stub port): `Tests 9 failed | 1 passed (10)`. QRN-1 to QRN-9 failed. QRN-10 passed vacuously because the stub never logs anything. It only becomes meaningful once run() exists, and it stayed green after implementation.
- Task 2 (profile stub): `Tests 7 failed | 10 passed (17)`. QRP-1 to QRP-7 all failed.

## Verification
- `lib.aiQueryRunner`, `aiSqlGuard`, `aiQueryScope` and `aiColumnProfileSql` specs: 4 files, 113 tests, all green.
- Server `tsc --noEmit` is clean.
- Greps: `console.` = 0; `e.message` = 1 (inside the 400 classifier only, never returned); `pass2Allowed` = 2; `maxRows + 1` = 1; `buildTopValuesSql(` = 1; `buildColumnProfileSql(` = 1; `assertIdentifier(` = 3.

## Deviations from Plan
**1. [Rule 1 - Bug] The truncation note pushed the envelope past maxChars (found in QRN-3).**
The note was added after the char-budget loop, so the envelope came out at 1002 characters with a 1000 limit. Fix: after adding the note, keep popping rows (and refreshing the note) until the JSON fits. Committed in d25ae10.

**2. Cancel tag for profile.** The plan said cancel is called with the "-1" tag, so the shared scaffold takes a `setCancelTag` callback and cancels the statement that was in flight.

## Criterion notes
- QRN-10 (console hygiene) cannot discriminate against the stub. It is a real proof only against the implementation. The `console.` grep = 0 is the structural backstop.
- The `e.message` grep (<= 1) is satisfied by the single use in classify().

## Self-Check: PASSED
queryRunner.ts and lib.aiQueryRunner.spec.ts exist. Commits d25ae10 and 0d0a8e5 exist.
