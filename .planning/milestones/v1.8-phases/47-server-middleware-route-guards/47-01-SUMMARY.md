---
phase: 47-server-middleware-route-guards
plan: "01"
subsystem: server-rbac
tags: [rbac, permissions, test-migration, datasets, seed-history]
dependency_graph:
  requires: [46-rbac-schema-data-layer]
  provides: [createAdminSession-helper, datasets-manage-permission, rbac-migration-spec-upgraded]
  affects: [all-21-route-auth-specs, lib-permissions, db-rbacMigration, lib-rbacDb]
tech_stack:
  added: []
  patterns: [bootstrap-short-circuit, seed-history-gate, createAdminSession-delegation]
key_files:
  created: []
  modified:
    - packages/server/src/lib/permissions.ts
    - packages/server/tests/helpers/db.ts
    - packages/server/tests/db.rbacMigration.spec.ts
    - packages/server/tests/lib.permissions.spec.ts
    - packages/server/tests/lib.rbacDb.spec.ts
    - packages/server/tests/auth.cookie.spec.ts
    - packages/server/tests/auth.requireAuth.spec.ts
    - packages/server/tests/auth.oidc.spec.ts
    - packages/server/tests/auth.routes.spec.ts
    - packages/server/tests/errorMiddleware.spec.ts
    - packages/server/tests/kinetica.creds.routes.spec.ts
    - packages/server/tests/layers.spec.ts
    - packages/server/tests/routes.dashboard-layers-patch.spec.ts
    - packages/server/tests/routes.discovery.spec.ts
    - packages/server/tests/routes.dynamic-view-crud.spec.ts
    - packages/server/tests/routes.dynamic-view-drop.spec.ts
    - packages/server/tests/routes.dynamic-view.spec.ts
    - packages/server/tests/routes.filter-materialize.spec.ts
    - packages/server/tests/routes.filter-materialize-spatial.spec.ts
    - packages/server/tests/routes.info-query.spec.ts
    - packages/server/tests/routes.materialize.spec.ts
    - packages/server/tests/routes.quantile.spec.ts
    - packages/server/tests/routes.sql.spec.ts
    - packages/server/tests/routes.wms.cache-control.spec.ts
    - packages/server/tests/routes.wms.capabilities.spec.ts
    - packages/server/tests/routes.wms.spec.ts
decisions:
  - "createAdminSession takes opts? only (no db param) — bootstrap short-circuit bypasses SQLite entirely"
  - "makeSessionCookie() body rewritten to delegate to createAdminSession(); seedOidcSession() kept with createSession for OIDC credential-type testing"
  - "lib.rbacDb.spec.ts hardcoded counts updated inline as Rule 1 auto-fix (broken behavior)"
  - "datasets:manage added to designer mapping making designer 9-permission role"
metrics:
  duration: "15min"
  completed: "2026-06-05"
  tasks: 3
  files: 26
---

# Phase 47 Plan 01: createAdminSession Helper + datasets:manage + Test Suite Migration Summary

Wave 1 baseline-preservation prerequisite for GUARD-V18-05: `createAdminSession()` helper added, 21 spec files migrated to use it, and `datasets:manage` added as the 16th permission with designer+admin mapping, with seed-history upgrade-path proven by migration spec.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add datasets:manage permission + extend migration spec | f02dda2 | permissions.ts, lib.permissions.spec.ts, db.rbacMigration.spec.ts |
| 2 | Add createAdminSession() helper to tests/helpers/db.ts | d5c8a51 | tests/helpers/db.ts |
| 3 | Migrate 21 spec files to createAdminSession() | a18cdfe | 22 spec files + lib.rbacDb.spec.ts |

## Verification

### GATE 1 (No New Failing Files)
Full `npm run test:server` run: all failing spec FILES are subset of the 14 known-flaky files. Zero new failing files vs baseline. PASS.

### GATE 2 (Targeted Group Green)
`npm run test:server -- lib.permissions db.rbacMigration lib.rbacDb boot.rbacAdminWarning` — 56 tests, 0 failures. PASS.

### GATE 3 (Deterministic-Green Migrated Specs)
All 5 spot-checked specs pass when run individually:
- routes.quantile: 17 passed
- routes.dynamic-view (crud+drop+main): 62 passed
- routes.filter-materialize: 53 passed
- layers: 23 passed
- routes.dashboard-layers-patch: 5 passed

### TypeScript
`cd packages/server && npx tsc --noEmit` — clean (no errors in src/).

### Acceptance Criteria
- `grep -c "DATASETS_MANAGE" packages/server/src/lib/permissions.ts` returns 2 ✓
- `grep -q "datasets:manage" packages/server/tests/lib.permissions.spec.ts` ✓
- `grep -q "datasets:manage" packages/server/tests/db.rbacMigration.spec.ts` ✓
- `grep -q "export const createAdminSession" packages/server/tests/helpers/db.ts` ✓
- `grep -rl "createAdminSession" packages/server/tests/*.spec.ts | wc -l` returns 21 ✓
- boot.wipe.spec.ts and sessionStore.crud.spec.ts NOT migrated (createSession count unchanged) ✓

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] lib.rbacDb.spec.ts had hardcoded permission counts broken by datasets:manage addition**
- **Found during:** Task 3 (full suite run after migration)
- **Issue:** lib.rbacDb.spec.ts independently hardcodes permission counts (15 for admin, 8 for designer, 13 for designer+user_admin union). Adding datasets:manage to the 16-item catalog broke these counts.
- **Fix:** Updated counts: 15→16 (admin short-circuit), 8→9 (designer), 13→14 (designer+user_admin union). Also added `datasets:manage` to the single-role designer expected array.
- **Files modified:** packages/server/tests/lib.rbacDb.spec.ts
- **Commit:** a18cdfe (included in Task 3 commit)

## Self-Check: PASSED
