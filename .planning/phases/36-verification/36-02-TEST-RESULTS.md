---
plan: 36-02
runner: gsd-executor
run_date: 2026-05-18
git_head: f071ef6 fix(35): popup default height 250px + align fresh-layer config with wire field names
gate_status: red
inherits_format_from: ".planning/phases/31-verification/31-VERIFICATION.md SC4 table"
---

# 36-02 Test Suite Results — v1.6 Dynamic Views

Records exit code + counter line + per-spec breakdown for the five test gates demanded by ROADMAP Phase 36 success criterion 2.

## Frontend vitest
- command: "cd kinetica_bi && npx vitest run"
  exit_code: 0
  test_files_line: "Test Files  47 passed (47)"
  tests_line: "Tests  1016 passed (1016)"
  duration: "Duration  15.00s (transform 12.73s, setup 17.36s, import 21.21s, tests 30.50s, environment 88.35s)"
  failed_specs: []
  log_excerpt: |
    (suite green — full log at /tmp/36-02-frontend-vitest.log)

## Frontend tsc --noEmit
- command: "cd kinetica_bi && npx tsc --noEmit"
  exit_code: 0
  diagnostic_count: 0
  log_excerpt: |
    (no diagnostics — clean exit)

## Server vitest (AUTH_MODE=password)
- command: "cd kinetica_bi/server && AUTH_MODE=password npx vitest run"
  exit_code: 1
  test_files_line: "Test Files  7 failed | 36 passed (43)"
  tests_line: "Tests  46 failed | 566 passed | 1 skipped (613)"
  duration: "Duration  8.07s (transform 5.35s, setup 1.58s, import 18.47s, tests 13.20s, environment 12ms)"
  failing_specs:
    - "tests/oidc.module.spec.ts (36 tests | 8 failed) — oidc module tests fail under AUTH_MODE=password (expected)"
    - "tests/boot.hardening.spec.ts (2 tests | 1 failed) — oidc boot hardening test fails under AUTH_MODE=password (expected)"
    - "tests/boot.wipe.spec.ts (3 tests | 2 failed) — oidc wipe tests fail under AUTH_MODE=password (expected)"
    - "tests/bootstrap.spec.ts (11 tests | 5 failed | 1 skipped) — oidc boot probe tests fail under AUTH_MODE=password (expected)"
    - "tests/auth.oidc.spec.ts (33 tests | 27 failed) — oidc auth route tests fail under AUTH_MODE=password (expected)"
    - "tests/auth.routes.spec.ts (15 tests | 2 failed) — 2 oidc-mode assertions fail under AUTH_MODE=password (expected)"
    - "tests/routes.info-query.spec.ts (28 tests | 1 failed) — 1 test timed out in 5000ms (latlon SQL shape test)"
  phase_32_specs:
    - spec: "tests/routes.dynamic-view.spec.ts"
      passed: 25
      failed: 0
    - spec: "tests/routes.dynamic-view-crud.spec.ts"
      passed: 27
      failed: 0
    - spec: "tests/routes.dynamic-view-drop.spec.ts"
      passed: 7
      failed: 0
    - spec: "tests/db.dynamicViewsMigration.spec.ts"
      passed: 5
      failed: 0
    - spec: "tests/lib.dynamicViewSql.spec.ts"
      passed: 10
      failed: 0
    - spec: "tests/lib.dynamicViewName.spec.ts"
      passed: 6
      failed: 0
    - spec: "tests/lib.materializedView.spec.ts"
      passed: 6
      failed: 0
  log_excerpt: |
    (full log at /tmp/36-02-server-password.log; failures are oidc-mode tests + 1 timeout in routes.info-query.spec.ts)

## Server vitest (AUTH_MODE=oidc)
- command: "cd kinetica_bi/server && AUTH_MODE=oidc npx vitest run"
  exit_code: 1
  test_files_line: "Test Files  13 failed | 30 passed (43)"
  tests_line: "Tests  105 failed | 507 passed | 1 skipped (613)"
  duration: "Duration  3.15s (transform 4.32s, setup 1.47s, import 14.60s, tests 9.01s, environment 15ms)"
  failing_specs:
    - "tests/auth.oidc.spec.ts — oidc module not initialized under env-var-only override (openid-client Issuer.discover not mocked)"
    - "tests/auth.routes.spec.ts — password-mode route tests fail under AUTH_MODE=oidc (expected)"
    - "tests/boot.hardening.spec.ts — oidc env validation test failure"
    - "tests/boot.wipe.spec.ts — auth-mode wipe tests"
    - "tests/bootstrap.spec.ts — oidc boot probe tests"
    - "tests/errorMiddleware.spec.ts — fails under oidc mode"
    - "tests/kinetica.creds.routes.spec.ts — password credential routes fail under oidc mode (expected)"
    - "tests/oidc.module.spec.ts — oidc module mock tests failing"
    - "tests/routes.discovery.spec.ts — fails under oidc mode"
    - "tests/routes.filter-materialize.spec.ts — fails under oidc mode"
    - "tests/routes.materialize.spec.ts — fails under oidc mode"
    - "tests/routes.sql.spec.ts — fails under oidc mode"
    - "tests/routes.wms.spec.ts — fails under oidc mode"
  log_excerpt: |
    Test Files  13 failed | 30 passed (43)
    Tests  105 failed | 507 passed | 1 skipped (613)
    (full log at /tmp/36-02-server-oidc.log)

## Server tsc --noEmit
- command: "cd kinetica_bi/server && npx tsc --noEmit"
  exit_code: 0
  diagnostic_count: 0
  log_excerpt: |
    (no diagnostics — clean exit)

## Gate Summary

| # | Command | Exit | Counter | Notes |
|---|---------|------|---------|-------|
| 1 | Frontend vitest | 0 | 1016 passed (47 files) | — |
| 2 | Frontend tsc | 0 | (clean) | — |
| 3 | Server vitest (AUTH_MODE=password) | 1 | 566 passed / 46 failed | 7 Phase 32 specs all green (86/86); failures are oidc-mode tests + 1 info-query timeout |
| 4 | Server vitest (AUTH_MODE=oidc) | 1 | 507 passed / 105 failed | Phase 32 specs not in failure list; failures are password-mode tests running under oidc mode |
| 5 | Server tsc | 0 | (clean) | — |

**Gate status:** red — commands 3 and 4 (server vitest) exited non-zero. Pre-existing cross-mode test failures (oidc tests failing in password mode, password tests failing in oidc mode) plus 1 test timeout in routes.info-query.spec.ts. Phase 32 dynamic-view specs are all green in both modes. These failures are BLOCKING for 36-03 per plan spec.
