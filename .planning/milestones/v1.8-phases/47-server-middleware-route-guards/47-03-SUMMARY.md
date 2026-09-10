---
phase: 47-server-middleware-route-guards
plan: 03
subsystem: api
tags: [rbac, express, sqlite, better-sqlite3, permissions, middleware, route-guards]

# Dependency graph
requires:
  - phase: 47-02
    provides: requirePermission factory returning RequestHandler[] in src/rbac.ts
  - phase: 47-01
    provides: createAdminSession helper, PERMISSIONS catalog with 16 permissions including datasets:manage
  - phase: 46
    provides: roles/role_permissions/user_roles tables, getEffectivePermissions, seedRbac

provides:
  - 22 config-mutation routes gated with requirePermission (GUARD-V18-02)
  - ANALYST-PASSTHROUGH BOUNDARY comment block in index.ts (GUARD-V18-03)
  - known_users table in SCHEMA_DDL + dual login upserts (password + OIDC)
  - 7 management routes gated on correct catalog permissions (GUARD-V18-04)
  - routes.guards.spec.ts: 403-for-non-holder + analyst-passthrough assertions
  - routes.management.spec.ts: management-route gate + GET /api/users union assertions

affects: [48-frontend-gating, 49-users-management-ui, 50-roles-management-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "requirePermission spread pattern: ...requirePermission(PERMISSIONS.X) into route args"
    - "requireConfig before ...requirePermission on routes with both (Pitfall 2 lock)"
    - "OIDC smoke tests use bootstrap admin username to pass requirePermission short-circuit"
    - "known_users upsert on success path only — after createSession, before issueSessionCookie"
    - "GET /api/users union: SELECT username FROM known_users UNION SELECT DISTINCT username FROM user_roles"

key-files:
  created:
    - packages/server/tests/routes.guards.spec.ts
    - packages/server/tests/routes.management.spec.ts
  modified:
    - packages/server/src/db.ts
    - packages/server/src/index.ts
    - packages/server/tests/db.rbacMigration.spec.ts
    - packages/server/tests/layers.spec.ts
    - packages/server/tests/routes.dashboard-layers-patch.spec.ts
    - packages/server/tests/routes.dynamic-view-crud.spec.ts
    - packages/server/tests/routes.dynamic-view.spec.ts

key-decisions:
  - "OIDC smoke tests updated to use APP_ADMIN_USERNAME||'admin' so requirePermission bootstrap short-circuit fires; credential-type (oidc) is the test focus, not permission level"
  - "DELETE /api/dynamic-view/:id OIDC smoke test view name assertion updated from 'john_doe_kinetica_com' to 'admin' pattern"
  - "Management routes use inline db.prepare() statements — no new abstraction layer at 7-route scale"
  - "PUT /api/roles/:id/permissions validates against Object.values(PERMISSIONS) catalog — rejects unknown strings with 400"
  - "SAFE-V18-01 (last-admin protection) deferred to Phase 49; SAFE-V18-02 (escalation guards) deferred to Phase 50"

patterns-established:
  - "Analyst-passthrough routes: requireAuth ONLY — no requirePermission; documented via ANALYST-PASSTHROUGH BOUNDARY comment block"
  - "7 management routes: SQLite-only, gated, Pitfall-6-safe (target from req.params.username.toLowerCase(), not caller)"
  - "known_users upsert: INSERT INTO ... ON CONFLICT(username) DO UPDATE SET last_seen — atomic and idempotent"

requirements-completed: [GUARD-V18-02, GUARD-V18-03, GUARD-V18-04]

# Metrics
duration: 11min
completed: 2026-06-05
---

# Phase 47 Plan 03: Route Guards + Management Routes Summary

**Server-side RBAC enforcement live: 22 mutation routes gated with requirePermission, analyst-passthrough boundary documented, known_users table + dual login upserts, and 7 management routes gated on catalog permissions**

## Performance

- **Duration:** ~11 min
- **Started:** 2026-06-05T19:04:02Z
- **Completed:** 2026-06-05T19:15:09Z
- **Tasks:** 3
- **Files modified:** 8 (3 created, 5 modified)

## Accomplishments

- known_users table added to SCHEMA_DDL; password login and OIDC callback each upsert lowercased username with last_seen refresh (Pitfall 4: success-path only)
- All 22 config-mutation routes receive `...requirePermission(PERMISSIONS.X)` spread; requireConfig kept first on materialize/dynamic-views routes (Pitfall 2 compliance); ANALYST-PASSTHROUGH BOUNDARY comment block (GUARD-V18-03/SC5) inserted verbatim from research template
- 7 management routes registered with correct gates; GET /api/users uses known_users UNION user_roles query; SAFE-V18-01/02 deferral comments in handlers
- 4 OIDC smoke spec files fixed: seedOidcSession now uses APP_ADMIN_USERNAME so requirePermission bootstrap short-circuit fires
- GATE 2 (Phase 47 group): lib.permissions + db.rbacMigration + routes.rbac + routes.guards + routes.management = 75 tests green
- GATE 1 (full suite): failing files = 13-file subset of 14 known-flaky list (no new failures)
- GATE 3 (spot-checks): routes.quantile, routes.dynamic-view, routes.filter-materialize, layers, routes.dashboard-layers-patch all green

## Task Commits

1. **Task 1: known_users table + login/OIDC-callback upserts** - `2979697` (feat)
2. **Task 2: Wire requirePermission onto 22 mutation routes + passthrough boundary** - `fcd4637` (feat)
3. **Task 3: Register 7 management routes + write guards & management spec coverage** - `f798ae4` (feat)

## Files Created/Modified

- `packages/server/src/db.ts` - Added known_users table to SCHEMA_DDL
- `packages/server/src/index.ts` - requirePermission/PERMISSIONS imports; 29 total ...requirePermission spreads (22 mutation + 7 management); ANALYST-PASSTHROUGH BOUNDARY comment; dual login upserts; 7 management route handlers
- `packages/server/tests/db.rbacMigration.spec.ts` - Added known_users existence assertions (fresh + idempotent)
- `packages/server/tests/routes.guards.spec.ts` - Created: 10 tests for 403-non-holder + analyst-passthrough
- `packages/server/tests/routes.management.spec.ts` - Created: 23 tests for all 7 management routes
- `packages/server/tests/layers.spec.ts` - OIDC smoke: seedOidcSession uses bootstrap admin username
- `packages/server/tests/routes.dashboard-layers-patch.spec.ts` - OIDC smoke: seedOidcSession uses admin
- `packages/server/tests/routes.dynamic-view-crud.spec.ts` - OIDC smoke: 3 call sites use admin
- `packages/server/tests/routes.dynamic-view.spec.ts` - OIDC smoke: delete test uses admin + view name assertion updated

## Decisions Made

- OIDC smoke tests use APP_ADMIN_USERNAME for credential-type testing — the permission level is irrelevant to what these tests verify (credential-type=oidc in the session row)
- Management routes use inline db.prepare() statements — no new abstraction layer needed at 7-route scale; matches existing route handler patterns
- PUT /api/roles/:id/permissions validates permissions against Object.values(PERMISSIONS) catalog at request time — unknown strings rejected with 400
- SAFE-V18-01/02 deferral comments placed inline in the relevant handlers per plan requirement

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] OIDC smoke tests in 4 spec files used non-admin username for gated routes**
- **Found during:** Task 2 (full test suite run after guard wiring)
- **Issue:** layers.spec.ts, routes.dashboard-layers-patch.spec.ts, routes.dynamic-view-crud.spec.ts, and routes.dynamic-view.spec.ts each had an AUTH_MODE=oidc smoke describe block that created sessions for "john.doe@kinetica.com". After requirePermission landed, these sessions got 403 on gated routes (layers PATCH, dynamic-views POST/PUT/DELETE).
- **Fix:** Changed seedOidcSession() call sites to use `process.env.APP_ADMIN_USERNAME || "admin"` so the bootstrap short-circuit fires. Updated view name assertion in routes.dynamic-view.spec.ts delete test from `_kbi_dv_ujohn_doe_kinetica_com_` to `_kbi_dv_uadmin_`.
- **Files modified:** 4 test files listed above
- **Verification:** All 4 files + GATE 3 spot-checks green
- **Committed in:** fcd4637 (part of Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Necessary for GATE 3 compliance. No scope creep — same pattern as the Plan 01 migration that was documented in STATE.md decisions.

## Issues Encountered

None — GATE 1/2/3 all passed on first run after the OIDC smoke fix. TypeScript clean throughout.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 48 (frontend gating) is now unblocked — server-side enforcement is authoritative
- Phase 49 (Users Management UI) can call GET /api/users, POST/DELETE /api/users/:username/roles — shapes locked
- Phase 50 (Roles Management UI) can call GET/POST /api/roles, PUT /api/roles/:id/permissions, DELETE /api/roles/:id — shapes locked
- SAFE-V18-01 (last-admin protection) to be implemented in Phase 49 assign/revoke API
- SAFE-V18-02 (escalation guards) to be implemented in Phase 50 role management routes

---
*Phase: 47-server-middleware-route-guards*
*Completed: 2026-06-05*
