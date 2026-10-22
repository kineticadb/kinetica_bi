---
phase: 141-keep-persist-ai-changes
plan: 01
subsystem: shared
tags: [zod, contract, keep, version-headers]
requires: []
provides:
  - AiKeepRequestSchema and related types, limits, error codes, exact D-02/D-08/D-12 messages
  - Dashboard version header constants and format/parse helpers
affects: [141-07, 141-08, 141-09, 141-11, 141-12, 141-13]
tech-stack:
  added: []
  patterns: [strict zod schemas, superRefine for id uniqueness]
key-files:
  created: [packages/shared/src/aiKeep.ts, packages/shared/src/aiKeep.spec.ts]
  modified: [packages/shared/src/index.ts]
key-decisions:
  - "Rights are computed on the server only; shared exports no requiredRights function"
requirements-completed: []
gaps: []
metrics:
  duration: ~6min
  completed: 2026-10-21
---

# Phase 141 Plan 01: Keep contract Summary

Single strict, size-capped Keep request/response contract (folded dv/layer/widget change set plus baselineVersion) with the exact refusal texts and a shared version-header format/parser, exported from `@kinetica-bi/shared`.

## Commits
- 6abce8a: feat(141-01): shared Keep request schema, limits, error codes, exact messages
- 76ad075: feat(141-01): dashboard version header constants and tolerant parsers

## RED evidence
- Task 1 (against stub): `Test Files 1 failed (1) / Tests 7 failed (7)` (KC-1..KC-7 all red; e.g. KC-7 `expected '' to be 'You can't save these changes: saving dynamic views ...'`).
- Task 2 (against stub helpers): `Tests 3 failed | 8 passed (11)`; KH-1, KH-2, KH-4 red. KH-3 (garbage returns null) passed against the null-returning stub, so it is vacuous in RED; its discriminating power comes from KH-1/KH-2 proving the real parser accepts valid input in the same implementation, and I verified it green against the regex implementation.

## Verification
- Shared: tsc clean; vitest 10 files / 203 tests pass (aiOp.spec still 12 kinds). Server and web `tsc --noEmit` clean.
- Greps: `export const AiKeepRequestSchema`=1, `export * from "./aiKeep"`=1, `X-Kbi-Dashboard-Version`=2, parse functions=2.

## Deviations from Plan
None - plan executed as written.

## Self-Check: PASSED
