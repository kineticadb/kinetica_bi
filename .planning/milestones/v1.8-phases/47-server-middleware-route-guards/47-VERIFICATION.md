---
phase: 47-server-middleware-route-guards
verified: 2026-06-05T00:00:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
---

# Phase 47: Server Middleware Route Guards Verification Report

**Phase Goal:** Every mutating route is permission-gated server-side and the existing supertest suite continues passing at the pre-v1.8 baseline — server enforcement is the authority before any frontend work ships.
**Verified:** 2026-06-05
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | requirePermission(perm) returns RequestHandler[] denying non-holders with 403 PERMISSION_DENIED body including permission field, passing admins, and emitting OBS-01 denial log | VERIFIED | `packages/server/src/rbac.ts` (72 lines): exports requirePermission returning RequestHandler[]; body `{ error, code: "PERMISSION_DENIED", permission }`; console.log with `event: "permission_denied", outcome: "denied"`. routes.rbac.spec.ts (5 tests) covers admin pass, holder pass, non-holder 403, denial log spy, unauth 401. |
| 2 | All 22 config-mutation routes return 403 PERMISSION_DENIED for a non-holder session and 200/201 for an admin session | VERIFIED | `packages/server/src/index.ts`: `grep -c "\.\.\.requirePermission"` = 29 (22 mutation + 7 management, all spread). Confirmed DASHBOARDS_CREATE/EDIT/DELETE, WIDGETS_CONFIGURE, LAYERS_MANAGE, DYNAMIC_VIEWS_MANAGE, DATASETS_MANAGE on the exact 22 routes from the plan gate table. routes.guards.spec.ts (8 tests, 3 for 403-non-holder on POST /api/dashboards, PATCH /api/widgets/:id, POST /api/tables). |
| 3 | Analyst-passthrough routes are reachable with requireAuth only (no PERMISSION_DENIED) and an ANALYST-PASSTHROUGH BOUNDARY comment block exists in index.ts | VERIFIED | POST /api/filter/materialize (line 807), POST /api/sql (line 1993), POST /api/info/query (line 1662), POST /api/quantile (line 943) — all have requireConfig only, no requirePermission. ANALYST-PASSTHROUGH BOUNDARY comment present, tagged GUARD-V18-03, documents POST /api/sql prominently. routes.guards.spec.ts has 4 positive passthrough assertions: `res.body.code !== "PERMISSION_DENIED"` for POST /api/filter/materialize, POST /api/sql, POST /api/info/query, GET /api/wms. |
| 4 | known_users table exists; password login and OIDC callback each upsert (lower(username), first_seen, last_seen) | VERIFIED | `packages/server/src/db.ts`: `CREATE TABLE IF NOT EXISTS known_users`. `packages/server/src/index.ts`: 2 `INSERT INTO known_users` upserts (both `ON CONFLICT(username) DO UPDATE SET last_seen`, both `lower(?)`). db.rbacMigration.spec.ts asserts table existence on fresh and existing DB. |
| 5 | 7 management routes registered and gated; createAdminSession() helper; 21 specs migrated; datasets:manage added; SC4 regression gate passes (failing spec files subset of 14 known-flaky) | VERIFIED | All 7 management routes at lines 2018/2043/2055/2065/2085/2114/2138 with correct USERS_VIEW, USERS_ASSIGN_ROLES(x2), ROLES_VIEW, ROLES_CREATE_CUSTOM, ROLES_MANAGE_PERMISSIONS, ROLES_DELETE_CUSTOM gates. createAdminSession() in tests/helpers/db.ts uses APP_ADMIN_USERNAME "admin". 24 spec files use createAdminSession (21 migrated + 3 new Phase 47 specs). boot.wipe.spec.ts and sessionStore.crud.spec.ts NOT migrated. datasets:manage is 16th permission, in PERMISSIONS + designer mapping. SC4: orchestrator measured 677 passed / 106 failed with failing files = 13-file subset of 14 known-flaky — gate passes. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/server/src/lib/permissions.ts` | DATASETS_MANAGE permission + designer/admin mapping | VERIFIED | `grep -c "DATASETS_MANAGE"` = 2: catalog entry `DATASETS_MANAGE: "datasets:manage"` + `PERMISSIONS.DATASETS_MANAGE` in designer mapping. Admin auto-includes via `[...ALL_PERMISSIONS]`. |
| `packages/server/tests/helpers/db.ts` | createAdminSession() export | VERIFIED | `export const createAdminSession` at line 13; uses `process.env.APP_ADMIN_USERNAME \|\| "admin"`; JWT payload `{ sub: username, sid, v: 1 }`; no db param. |
| `packages/server/tests/db.rbacMigration.spec.ts` | datasets:manage seed-history upgrade-path | VERIFIED | Lines 599-672: 3 describe blocks — (a) fresh DB seeds designer+admin, (b) no double-seed count stays 1, (c) operator-removal survives (history gate). Also known_users table existence assertions at lines 74-96. |
| `packages/server/src/rbac.ts` | requirePermission factory returning RequestHandler[] | VERIFIED | 72 lines; exports `requirePermission`; returns `RequestHandler[]`; imports requireAuth (element 0) + getEffectivePermissions; 403 body with `code: "PERMISSION_DENIED", permission`; OBS-01 console.log. |
| `packages/server/tests/routes.rbac.spec.ts` | Factory unit + integration coverage | VERIFIED | 161 lines; contains PERMISSION_DENIED and permission_denied; denial log spy via `vi.spyOn(console, "log")`; 5 tests confirmed. |
| `packages/server/src/index.ts` | Guards on 22 mutation routes + passthrough comment + known_users upsert + 7 management routes | VERIFIED | `requirePermission` import at line 106; 29 total `...requirePermission` spreads; ANALYST-PASSTHROUGH BOUNDARY comment; dual known_users upserts; 7 management routes at lines 2018-2150. env.ts is still first import (line 3). |
| `packages/server/src/db.ts` | known_users table in SCHEMA_DDL | VERIFIED | `CREATE TABLE IF NOT EXISTS known_users` with username TEXT PRIMARY KEY, first_seen, last_seen. |
| `packages/server/tests/routes.guards.spec.ts` | 403-for-non-holder + analyst passthrough assertions | VERIFIED | 161 lines; contains PERMISSION_DENIED; analyst session seeded via user_roles (analyst role); 8 tests: 3 denial + 4 passthrough (not.toBe("PERMISSION_DENIED")) + 1 admin pass. |
| `packages/server/tests/routes.management.spec.ts` | Management-route gate + GET /api/users union | VERIFIED | Contains PERMISSION_DENIED, /api/users; GET /api/users UNION test seeds known_users-only user + user_roles-only user, verifies both appear; 25 tests. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `packages/server/tests/helpers/db.ts` | sessionStore.createSession + APP_ADMIN_USERNAME bootstrap | createAdminSession with username = APP_ADMIN_USERNAME \|\| 'admin' | WIRED | Line 15: `const username = process.env.APP_ADMIN_USERNAME \|\| "admin"`. createSession imported from ../../src/sessionStore. |
| 21+ migrated spec files | tests/helpers/db.ts createAdminSession | import { createAdminSession } from './helpers/db' | WIRED | 24 spec files import createAdminSession. boot.wipe.spec.ts and sessionStore.crud.spec.ts confirmed NOT using createAdminSession. |
| `packages/server/src/rbac.ts` | src/lib/rbacDb.getEffectivePermissions | getEffectivePermissions(username) per request | WIRED | Imports getEffectivePermissions from ./lib/rbacDb; calls `getEffectivePermissions(username)` (no conn arg — module-singleton) inside rbacCheck. |
| `packages/server/src/rbac.ts` | src/auth.requireAuth + Permission type | requireAuth (element 0) + Permission type import | WIRED | `import { requireAuth, type AuthedRequest } from "./auth"` and `import type { Permission } from "./lib/permissions"` confirmed. |
| `packages/server/src/index.ts` mutation routes | src/rbac.requirePermission + lib/permissions.PERMISSIONS | ...requirePermission(PERMISSIONS.X) spread into route args | WIRED | `grep -c "\.\.\.requirePermission"` = 29; import at line 106; PERMISSIONS imported from ./lib/permissions. |
| POST /api/auth/login + GET /api/auth/oidc/callback | known_users table | INSERT ... ON CONFLICT(username) DO UPDATE SET last_seen | WIRED | 2 `INSERT INTO known_users` upserts in index.ts; both `ON CONFLICT(username) DO UPDATE SET last_seen`; both `lower(?)`; both on success path after createSession. |
| GET /api/users handler | known_users UNION user_roles | SELECT username FROM known_users UNION SELECT DISTINCT username FROM user_roles | WIRED | Line 2026: `SELECT username FROM known_users` with UNION visible; routes.management.spec.ts line 74 tests both sources appear. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|---------|
| GUARD-V18-01 | Plan 02 | requirePermission(perm) factory: 403 PERMISSION_DENIED + permission field in body, OBS-01 denial log | SATISFIED | rbac.ts exports requirePermission; body includes `code: "PERMISSION_DENIED", permission`; OBS-01 log; 5-test spec green. |
| GUARD-V18-02 | Plan 03 | All config-mutation routes gated (dashboards/widgets/tables/views/dynamic-views/layers CRUD) | SATISFIED | 22 mutation routes confirmed gated with `...requirePermission(PERMISSIONS.X)` spread; routes.guards.spec.ts proves 403 for non-holders. |
| GUARD-V18-03 | Plan 03 | Analyst-passthrough routes gated by requireAuth ONLY; boundary documented in code | SATISFIED | ANALYST-PASSTHROUGH BOUNDARY comment in index.ts tagged GUARD-V18-03; POST /api/sql, /api/filter/materialize, /api/info/query, /api/wms confirmed passthrough-only; positive assertions in routes.guards.spec.ts. |
| GUARD-V18-04 | Plan 03 | 7 management routes gated on users:view / users:assign_roles / roles:view / roles:create_custom / roles:manage_permissions / roles:delete_custom | SATISFIED | All 7 routes registered at lines 2018-2150 with correct gates confirmed by grep. |
| GUARD-V18-05 | Plan 01 | Existing test suite migrated via createAdminSession(); zero new test failures vs pre-v1.8 baseline | SATISFIED | createAdminSession() in helpers/db.ts; 24 spec files use it (21 migrated + new Phase 47 specs); boot.wipe and sessionStore.crud untouched; SC4 gate: failing files = subset of 14 known-flaky (orchestrator measured). |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/server/src/index.ts` | 2011, 2012, 2054, 2137, 2145 | SAFE-V18-01/SAFE-V18-02 deferred — deferral comments explicitly placed | INFO | By design — plan explicitly deferred last-admin and escalation guards to Phases 49/50; deferral comments are present per plan requirement. No blocker. |

No stub implementations, placeholder returns, or broken wiring detected. All artifacts are substantive and wired.

### Human Verification Required

None. All phase-47-specific behaviors are verifiable programmatically via:
- Static code analysis (grep for guards, imports, comment blocks)
- Test spec existence and assertion content
- Git commit history matching plan commit hashes
- SC4 regression gate measurement provided by orchestrator (677 passed / 106 failed, failing files = 13-file subset of 14 known-flaky)

### Gaps Summary

No gaps. All 5 success criteria are satisfied:

- SC1 (requirePermission factory): rbac.ts exists, substantive (72 lines), wired to rbacDb + auth. 5-test spec green.
- SC2 (analyst passthrough with positive assertions): routes.guards.spec.ts has 4 `not.toBe("PERMISSION_DENIED")` assertions for POST /api/filter/materialize, POST /api/sql, POST /api/info/query, GET /api/wms using a user_roles-seeded analyst session.
- SC3 (mutation route gating): 29 total `...requirePermission` spreads in index.ts (22 mutation + 7 management); requireConfig stays first on materialize/dynamic-view routes.
- SC4 (regression gate): set-based gate passes — failing files are a subset of 14 known-flaky files per orchestrator measurement; routes.guards, routes.management, routes.rbac all outside the failing set.
- SC5 (passthrough boundary comment): ANALYST-PASSTHROUGH BOUNDARY present in index.ts, tagged GUARD-V18-03, documents POST /api/sql + filter/materialize/preview/drop distinctions.

Locked decisions honored:
- datasets:manage gates POST/PATCH/DELETE /api/tables: confirmed at lines ~1851-1860 range.
- known_users upserted on both login paths: 2 INSERT INTO known_users confirmed.
- 403 body includes `permission` field: confirmed in rbac.ts.
- Denial OBS-01 logging: confirmed `event: "permission_denied", outcome: "denied"` in rbac.ts.
- POST /api/sql passthrough: confirmed requireConfig only at line 1993 (no requirePermission).
- POST /api/views/:id/materialize gated dashboards:edit: confirmed at line 715.
- SAFE-V18-01/02 NOT implemented (deferral comments instead): confirmed at lines 2011-2012, 2054, 2137, 2145.
- requireAuth unmodified: auth.ts has no permission logic added.
- env.ts still first import: line 3 of index.ts.

---

_Verified: 2026-06-05_
_Verifier: Claude (gsd-verifier)_
