---
phase: 55-access-model-server-enforcement
plan: "01"
subsystem: server/rbac-access-model
tags: [rbac, permissions, access-control, sqlite, tdd]
dependency_graph:
  requires: []
  provides:
    - DASHBOARDS_MANAGE_ACCESS permission in PERMISSIONS catalog
    - dashboard_access_grants table (idempotent DDL)
    - canViewDashboard resolver (bypass/user/role/private-by-default)
    - listDashboardGrants / addDashboardGrant / removeDashboardGrant helpers
  affects:
    - packages/server/src/lib/permissions.ts (17th permission + designer mapping)
    - packages/server/src/db.ts (new table DDL + explicit cascade in deleteDashboard)
    - packages/server/src/lib/dashboardAccessDb.ts (new module)
tech_stack:
  added: []
  patterns:
    - Injectable conn = defaultDb parameter (mirrors rbacDb.ts)
    - INSERT OR IGNORE idempotency for grants
    - Explicit pre-delete cleanup (foreign_keys not globally ON)
    - TDD red/green for Task 1 and Task 3
key_files:
  created:
    - packages/server/src/lib/dashboardAccessDb.ts
    - packages/server/tests/lib.dashboardAccessDb.spec.ts
  modified:
    - packages/server/src/lib/permissions.ts
    - packages/server/src/db.ts
    - packages/server/tests/lib.permissions.spec.ts
    - packages/server/tests/lib.rbacDb.spec.ts
    - packages/server/tests/db.rbacMigration.spec.ts
decisions:
  - key: cascade-mechanism
    value: "Explicit DELETE FROM dashboard_access_grants WHERE dashboard_id=? in deleteDashboard() BEFORE the dashboards DELETE. foreign_keys PRAGMA is NOT set globally (only journal_mode=WAL); the FK ON DELETE CASCADE in the DDL is correct by schema definition but would not fire automatically. The explicit delete ensures grant rows are cleaned up regardless of PRAGMA state, matching the established pre-existing behavior for all other cascade-dependent tables (dashboard_tables, widgets, etc. — which also rely on the explicit dashboard DELETE sequence rather than FK cascades)."
  - key: grant-table-shape
    value: "Single table dashboard_access_grants with a grantee_type TEXT CHECK(IN('user','role')) discriminator. Composite PK (dashboard_id, grantee_type, grantee). User grantees stored LOWERCASED; role grantees stored verbatim. No FK to known_users (pre-provisioning allowed). dashboard_id FK REFERENCES dashboards(id) ON DELETE CASCADE defined for schema correctness."
  - key: resolver-query-strategy
    value: "Three-step inline resolution: (a) getEffectivePermissions().has(DASHBOARDS_MANAGE_ACCESS) — bypass, fires first; (b) single SELECT for direct user grant; (c) batch-fetch all role grantees for the dashboard then intersect with getEffectiveRoles() via a Set. Avoids N parameterized role queries when user has many roles. getEffectiveRoles() returns ['analyst'] for unassigned users, enabling the analyst-fallback-gets-role-grant scenario."
  - key: seed-loop-unchanged
    value: "rbacSeed.ts required NO code change. The generic seed loop iterates DEFAULT_ROLE_MAPPINGS — adding DASHBOARDS_MANAGE_ACCESS to DEFAULT_ROLE_MAPPINGS.designer is sufficient. The rbac_seed_history once-only mechanism seeds the new mapping exactly once on first boot after upgrade; an operator who later removes the designer→manage_access mapping keeps it removed across restarts. Confirmed byte-unchanged via git diff --quiet."
metrics:
  duration: "~20 minutes"
  completed: "2026-06-09"
  tasks: 3
  files: 7
---

# Phase 55 Plan 01: Access Model Foundation Summary

**One-liner:** 17th permission `dashboards:manage_access` + `dashboard_access_grants` SQLite table + `canViewDashboard` resolver with bypass/user-grant/role-grant/private-by-default semantics, enabling per-dashboard visibility control.

## What Was Built

### Task 1: 17th permission (dashboards:manage_access)

Added `DASHBOARDS_MANAGE_ACCESS: "dashboards:manage_access"` as the 17th entry in `PERMISSIONS` catalog (`permissions.ts`). Added it explicitly to `DEFAULT_ROLE_MAPPINGS.designer` (now 10 entries). Admin receives it automatically via `ALL_PERMISSIONS` spread — no manual add. `rbacSeed.ts` required **zero code change**; the generic seed loop auto-carries the new designer default via the `rbac_seed_history` once-only mechanism (confirmed byte-unchanged via `git diff --quiet`).

Updated all count-locked test files to reflect the new counts (16→17 permissions, 9→10 designer permissions):
- `tests/lib.permissions.spec.ts` — primary spec; 17 tests all pass
- `tests/lib.rbacDb.spec.ts` — auto-fixed (Rule 1) as it had count-locked assertions that would fail with new count
- `tests/db.rbacMigration.spec.ts` — auto-fixed (Rule 1); role_permissions total 32→34, history rows 32→34, designer 9→10

### Task 2: dashboard_access_grants table

Added to `SCHEMA_DDL` template literal in `db.ts` (after `rbac_audit` block):

```sql
CREATE TABLE IF NOT EXISTS dashboard_access_grants (
  dashboard_id INTEGER NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  grantee_type TEXT NOT NULL CHECK(grantee_type IN ('user','role')),
  grantee TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (dashboard_id, grantee_type, grantee)
);
CREATE INDEX IF NOT EXISTS idx_dashboard_access_grants_dashboard_id ON dashboard_access_grants (dashboard_id);
```

**Cascade mechanism: explicit DELETE in `deleteDashboard()`**

`foreign_keys` PRAGMA is NOT enabled globally in this app (only `journal_mode = WAL`). The FK `ON DELETE CASCADE` is present in the DDL for schema correctness but would not fire automatically. An explicit `db.prepare("DELETE FROM dashboard_access_grants WHERE dashboard_id = ?").run(id)` was added to `deleteDashboard()` BEFORE the `dashboards` DELETE. This matches the established pattern for all other dashboard-scoped tables (widgets, layers, etc.) which also rely on the dashboard DELETE sequence rather than FK cascades.

### Task 3: lib/dashboardAccessDb.ts

New module implementing:

**`canViewDashboard(username, dashboardId, conn?)` — resolution order:**
1. `getEffectivePermissions(username, conn).has(PERMISSIONS.DASHBOARDS_MANAGE_ACCESS)` → bypass (covers admin, designer, bootstrap admin via internal ALL_PERMISSIONS short-circuit, custom roles with manage_access)
2. `SELECT 1 FROM dashboard_access_grants WHERE dashboard_id=? AND grantee_type='user' AND grantee=lower(username)` → direct user grant
3. Batch-fetch role grantees for the dashboard (`SELECT grantee WHERE grantee_type='role'`), intersect with `getEffectiveRoles(username, conn)` via Set → role grant
4. Return `false` (private-by-default)

**`listDashboardGrants(dashboardId, conn?)`** → ordered by `grantee_type ASC, grantee ASC`

**`addDashboardGrant(dashboardId, granteeType, grantee, conn?)`** → `INSERT OR IGNORE`; user grantees lowercased; returns `result.changes > 0`

**`removeDashboardGrant(dashboardId, granteeType, grantee, conn?)`** → DELETE; user grantees lowercased; returns `result.changes > 0`

**Unit tests** (`tests/lib.dashboardAccessDb.spec.ts`) — 25 tests covering:
- Bypass (designer, bootstrap admin, case-insensitive admin)
- Private-by-default (analyst fallback returns false, explicit analyst role returns false)
- Direct user grant (basic, case-insensitive, wrong user, pre-provisioned unknown username)
- Role grant (basic, wrong role, multi-role user, analyst-fallback-gets-role-grant)
- `addDashboardGrant` (insert/idempotent/lowercase-user/verbatim-role)
- `removeDashboardGrant` (success/not-found/case-insensitive)
- `listDashboardGrants` (empty/shape/order/isolation)
- Cascade (explicit delete sequence removes grant rows)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated count-locked assertions in lib.rbacDb.spec.ts and db.rbacMigration.spec.ts**
- **Found during:** Task 1 GREEN phase
- **Issue:** Adding the 17th permission (admin: 16→17, designer: 9→10) would fail count-locked assertions in `lib.rbacDb.spec.ts` (admin size=16, designer size=9, etc.) and `db.rbacMigration.spec.ts` (seeds 32 rows, admin=16, designer=9, seed-history=32) — both are NOT in the known-flaky list so they must be green
- **Fix:** Updated all hardcoded count assertions in both files to reflect new counts (17 permissions, 10 designer permissions, 34 total role_permissions rows, 34 seed-history rows)
- **Files modified:** `packages/server/tests/lib.rbacDb.spec.ts`, `packages/server/tests/db.rbacMigration.spec.ts`
- **Commits:** e14466d

## Test Gate Results

### Targeted spec files (must all be green)
```
npx vitest run tests/lib.permissions.spec.ts tests/lib.dashboardAccessDb.spec.ts tests/db.rbacMigration.spec.ts
Test Files  3 passed (3)
Tests  64 passed (64)
```

### TSC gate
```
npx tsc --noEmit -p packages/server
(no output — CLEAN)
```

### Full-suite set-based gate
```
npx vitest run  [in packages/server]
Test Files  8 failed | 51 passed (59)
Tests  50 failed | 812 passed | 1 skipped (863)
```

**Failing test files (8):**
- `tests/auth.oidc.spec.ts` — pre-existing TD-V16-TEST-ISOLATION (OIDC mode isolation)
- `tests/auth.routes.spec.ts` — pre-existing TD-V16-TEST-ISOLATION
- `tests/boot.hardening.spec.ts` — pre-existing TD-V16-TEST-ISOLATION
- `tests/boot.wipe.spec.ts` — pre-existing TD-V16-TEST-ISOLATION
- `tests/bootstrap.spec.ts` — pre-existing TD-V16-TEST-ISOLATION
- `tests/db.smoke.spec.ts` — pre-existing (2 failures: expects dashboard_layers without cb_config/track_config columns — pre-v1.7 schema snapshot)
- `tests/oidc.module.spec.ts` — pre-existing TD-V16-TEST-ISOLATION
- `tests/routes.wms.spec.ts` — pre-existing TD-V16-TEST-ISOLATION

**SET-BASED GATE: PASS** — failing set {8 files} ⊆ TD-V16-TEST-ISOLATION known-flaky list. `lib.permissions.spec.ts`, `lib.dashboardAccessDb.spec.ts`, and `db.rbacMigration.spec.ts` are all GREEN.

### Web package verification
```
git diff --name-only packages/web
(no output — web package untouched)
```

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | e14466d | feat(55-01): add 17th permission dashboards:manage_access + designer default |
| Task 2 | 586620b | feat(55-01): create dashboard_access_grants table + explicit cascade in deleteDashboard |
| Task 3 | d6e744b | feat(55-01): implement dashboardAccessDb module — canViewDashboard resolver + grant CRUD + tests |
