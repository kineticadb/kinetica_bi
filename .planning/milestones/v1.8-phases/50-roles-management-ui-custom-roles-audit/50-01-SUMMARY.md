---
phase: 50-roles-management-ui-custom-roles-audit
plan: 01
subsystem: api
tags: [rbac, audit, sqlite, express, better-sqlite3, vitest, tdd]

# Dependency graph
requires:
  - phase: 49-users-management-ui
    provides: "SAFE-V18-01 last-admin guard, GET/POST/DELETE /api/users/:username/roles handlers"
  - phase: 47-server-middleware-route-guards
    provides: "requirePermission factory, PERMISSIONS catalog, management route stubs with deferral comments"
  - phase: 46-rbac-schema-data-layer
    provides: "getEffectiveRoles, getEffectivePermissions, BUILTIN_ROLES, roles/role_permissions/user_roles tables"
provides:
  - "rbac_audit table in SCHEMA_DDL with actor/action/target/before_json/after_json + two indexes"
  - "emitRbacAudit helper (lib/rbacAudit.ts) — writes OBS-01 log line + DB row on every mutation"
  - "SAFE-V18-02 Guard 1: user_admin blocked from assigning admin role (403)"
  - "SAFE-V18-02 Guard 2: user_admin blocked from modifying admin role permission set (403)"
  - "SAFE-V18-02 Guard 3: user_admin blocked from granting permissions they don't hold (403)"
  - "ROLES-V18-04: custom role deletion blocked when holders exist (409)"
  - "ROLES-V18-03: POST /api/roles slug validation + built-in name reservation + case-insensitive dup check"
  - "Audit emission threaded through all 5 mutation handlers (assign/revoke/mappings/create/delete)"
  - "createUserAdminSession test helper (seeds explicit user_roles row for non-bootstrap guard path testing)"
affects:
  - 50-02-roles-management-ui
  - 50-03-users-page-retrofit
  - 51-verification-live-uat

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "TDD: test file created with failing tests first, then implementation; 3 RED/GREEN/refactor cycles"
    - "Audit-on-success-only: emitRbacAudit called ONLY after successful mutation, never on 4xx guard rejections"
    - "before_json captured BEFORE mutation fires (critical: after mutation is too late for delete/replace ops)"
    - "getEffectiveRoles(actor).includes('admin') for escalation guard — resolves both bootstrap and explicit DB admin"
    - "createUserAdminSession: session created AFTER buildTestApp() to avoid auth_mode_change_wipe session deletion"

key-files:
  created:
    - packages/server/src/lib/rbacAudit.ts
    - packages/server/tests/db.rbacAudit.spec.ts
  modified:
    - packages/server/src/db.ts
    - packages/server/src/index.ts
    - packages/server/tests/routes.management.spec.ts

key-decisions:
  - "before_json for role_assigned/revoked uses raw assigned-role-name list (not analyst-fallback) — reflects actual DB rows, not synthetic fallback"
  - "createUserAdminSession creates session AFTER buildTestApp() call to avoid auth_mode_change_wipe deleting password sessions in oidc test env"
  - "Guard 3 catalog check (400) fires BEFORE escalation check (403) — unknown permission string is always 400 regardless of caller's admin status"
  - "DELETE /api/roles/:id extended roleRow SELECT to include name column (needed for audit target and role_deleted before_json lookup)"
  - "emitRbacAudit uses level=info (not warn) — audit rows are expected events, not anomalies"

patterns-established:
  - "Audit-on-success-only: all 5 handlers call emitRbacAudit after the mutation, never in guard/validation rejection paths"
  - "before_json captured BEFORE any state change — DELETE/replace ops must read before_json first"

requirements-completed: [SAFE-V18-02, AUDIT-V18-01, ROLES-V18-03, ROLES-V18-04]

# Metrics
duration: 10min
completed: 2026-06-06
---

# Phase 50 Plan 01: RBAC Audit + Escalation Guards + Slug Validation Summary

**rbac_audit table + emitRbacAudit helper threaded through 5 mutation handlers, 3 SAFE-V18-02 escalation guards, held-role delete block (409), and POST /api/roles lowercase-slug validation — all covered by TDD spec**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-06-06T11:52:45Z
- **Completed:** 2026-06-06T12:02:25Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- rbac_audit table (id/ts/actor/action/target/before_json/after_json) added to SCHEMA_DDL with idx_rbac_audit_ts and idx_rbac_audit_actor indexes; round-trips correctly on fresh createDb()
- emitRbacAudit helper writes OBS-01 JSON log line (level=info, event=rbac_audit) AND DB row atomically; all 5 mutation handlers wired
- Three SAFE-V18-02 escalation guards + ROLES-V18-04 held-role block + ROLES-V18-03 slug validation implemented and spec-covered; createUserAdminSession test helper added for non-bootstrap denial paths

## Task Commits

Each task was committed atomically (TDD: RED then GREEN commits):

1. **Task 1: rbac_audit table + emitRbacAudit helper + spec**
   - `f189b7b` test(50-01): add failing tests for rbac_audit table and emitRbacAudit helper
   - `3bf5250` feat(50-01): add rbac_audit table to SCHEMA_DDL and emitRbacAudit helper

2. **Task 2: createUserAdminSession + escalation guards + held-role delete block + slug validation**
   - `6d3cee4` test(50-01): add failing tests for escalation guards, held-role block, slug validation
   - `9944973` feat(50-01): escalation guards, held-role delete block, slug validation, createUserAdminSession

3. **Task 3: Thread emitRbacAudit through all 5 mutation handlers + audit assertions**
   - `8f369d6` test(50-01): add failing audit assertion tests for all 5 mutation handlers
   - `755d635` feat(50-01): thread emitRbacAudit through all 5 mutation handlers

## Files Created/Modified

- `packages/server/src/lib/rbacAudit.ts` — RbacAuditAction, RbacAuditEntry types; emitRbacAudit function writing OBS-01 log + DB row
- `packages/server/src/db.ts` — rbac_audit table + two indexes appended to SCHEMA_DDL
- `packages/server/src/index.ts` — imports extended (getEffectiveRoles, getEffectivePermissions, BUILTIN_ROLES, Permission, emitRbacAudit); 3 escalation guards; held-role delete block; slug/reservation/dup validation; 5x audit emission; deferral comments removed
- `packages/server/tests/db.rbacAudit.spec.ts` — 9 tests: table existence, column shape, round-trip, idempotency, emitRbacAudit row insertion, null support, dedup, log call count, log JSON shape
- `packages/server/tests/routes.management.spec.ts` — createUserAdminSession helper + 10 escalation guard tests + 7 held-role/slug tests + 10 audit assertion tests (5 success + 5 no-row-on-rejection)

## Decisions Made

- before_json for role_assigned/revoked uses raw assigned-role-name list query (not getEffectiveRoles with analyst-fallback) — reflects actual DB rows, making before/after audit state meaningful
- createUserAdminSession creates session AFTER buildTestApp() to avoid auth_mode_change_wipe deleting password-type sessions in the OIDC test environment
- Guard 3 catalog check (400) intentionally fires BEFORE the escalation check (403) — unknown permission string always 400, ordering confirmed by spec
- emitRbacAudit uses level=info (mirrors rbac.ts OBS-01 level=warn for denials but audit rows are success events)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Session creation ordering in explicit-admin test**
- **Found during:** Task 2 (createUserAdminSession + escalation guards)
- **Issue:** Test for "explicit admin-role holder assigns admin role" created session BEFORE buildTestApp(), causing auth_mode_change_wipe (fired during createApp() in oidc test env) to delete the password session → 401 instead of expected 200
- **Fix:** Moved createSession call to AFTER buildTestApp() in that specific test — wipe fires during createApp(), subsequent session creation survives
- **Files modified:** packages/server/tests/routes.management.spec.ts
- **Verification:** Test passes (200); all 54 management tests green
- **Committed in:** 9944973 (Task 2 feat commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug in test session ordering)
**Impact on plan:** Test-only fix; no production code affected. No scope creep.

## Issues Encountered

The OIDC test environment's `auth_mode_change_wipe` behavior (fires every `createApp()` call when password sessions exist) is a latent test isolation issue. The fix (create session after buildTestApp) is consistent with how `createAnalystSession` and `createUserAdminSession` work in the same spec file.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- All server-side RBAC mutation authority is implemented and spec-covered
- rbac_audit table is ready to be queried by the v1.9 audit viewer
- Phase 50-02 (Roles Management UI) can now mirror these server rules in the frontend
- Phase 50-03 (Users Page retrofit) can add escalation-aware UI for the assign/revoke flows
- Server vitest gate: 106 failing tests in 13 files — identical to pre-50 baseline (TD-V16-TEST-ISOLATION); no new failures introduced

---
*Phase: 50-roles-management-ui-custom-roles-audit*
*Completed: 2026-06-06*
