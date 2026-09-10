---
phase: 36-verification
plan: 02
subsystem: verification
tags: [test-execution, vitest, tsc, supertest, dynamic-views, phase-32]
dependency_graph:
  requires: []
  provides: [36-02-TEST-RESULTS.md, gate_status]
  affects: [36-03-verification-doc]
tech_stack:
  added: []
  patterns: [vitest-run, tsc-noEmit, AUTH_MODE-env-override]
key_files:
  created:
    - .planning/phases/36-verification/36-02-TEST-RESULTS.md
  modified: []
key_decisions:
  - "gate_status: red — server vitest exits non-zero in both auth modes due to cross-mode test failures (oidc tests in password mode, password tests in oidc mode) plus 1 test timeout; Phase 32 dynamic-view specs are all green (86/86 tests passing)"
  - "Phase 32 specs verified individually per-spec to confirm 7/7 files pass with exact counts"
metrics:
  duration: 19min
  completed_date: "2026-05-18"
  tasks: 2
  files: 1
requirements:
  - VERIFY-V16-01
---

# Phase 36 Plan 02: Test Suite Run Summary

Five test gates executed against v1.6 codebase at HEAD f071ef6. Results written to `36-02-TEST-RESULTS.md` with gate_status finalized as **red** due to pre-existing cross-mode server test failures.

## Results Overview

| # | Command | Exit | Counter | Status |
|---|---------|------|---------|--------|
| 1 | Frontend vitest | 0 | 1016 passed (47 files) | GREEN |
| 2 | Frontend tsc --noEmit | 0 | (clean) | GREEN |
| 3 | Server vitest AUTH_MODE=password | 1 | 566 passed / 46 failed | RED |
| 4 | Server vitest AUTH_MODE=oidc | 1 | 507 passed / 105 failed | RED |
| 5 | Server tsc --noEmit | 0 | (clean) | GREEN |

**Overall gate_status: red**

## Phase 32 Dynamic-View Spec Results (AUTH_MODE=password)

All 7 Phase 32/33 dynamic-view specs passed with zero failures:

| Spec | Passed | Failed |
|------|--------|--------|
| tests/routes.dynamic-view.spec.ts | 25 | 0 |
| tests/routes.dynamic-view-crud.spec.ts | 27 | 0 |
| tests/routes.dynamic-view-drop.spec.ts | 7 | 0 |
| tests/db.dynamicViewsMigration.spec.ts | 5 | 0 |
| tests/lib.dynamicViewSql.spec.ts | 10 | 0 |
| tests/lib.dynamicViewName.spec.ts | 6 | 0 |
| tests/lib.materializedView.spec.ts | 6 | 0 |
| **Total** | **86** | **0** |

## Red Gate Analysis

The server test suite is structured with cross-mode tests that only pass under their target AUTH_MODE:
- **oidc-mode tests fail under AUTH_MODE=password** (27 failures in auth.oidc.spec.ts alone)
- **password-mode tests fail under AUTH_MODE=oidc** (auth.routes.spec.ts, routes.materialize.spec.ts, etc.)
- **1 test timeout** in routes.info-query.spec.ts (latlon SQL shape test, 5000ms limit)

These are pre-existing cross-mode isolation failures, not regressions introduced by Phase 32. The Phase 32 dynamic-view specs themselves are clean. Per plan spec, 36-03 MUST mark Phase 36 success criterion 2 as FAIL and the milestone cannot close until these gaps are addressed.

## Deviations from Plan

None — plan executed exactly as written. The plan explicitly anticipated that failures should be captured verbatim without source modification.

## Artifacts

- `.planning/phases/36-verification/36-02-TEST-RESULTS.md` — Full command-by-command report

## Self-Check

- [x] TEST-RESULTS.md exists with all 5 command sections
- [x] gate_status finalized as `red`
- [x] 7 Phase 32 spec entries with numeric passed counts
- [x] 5 exit_code fields present
- [x] Gate Summary table present
- [x] No production source files modified
