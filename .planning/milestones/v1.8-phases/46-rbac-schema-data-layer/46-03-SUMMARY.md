---
phase: 46-rbac-schema-data-layer
plan: "03"
subsystem: server/rbac
tags: [rbac, permissions, sqlite, tdd, boot-warning, oidc]
dependency_graph:
  requires: [46-01, 46-02]
  provides: [getEffectivePermissions, getEffectiveRoles, getEffectiveRolesAndPermissions, rbac_bootstrap_admin_warning]
  affects: [packages/server/src/lib/rbacDb.ts, packages/server/src/index.ts]
tech_stack:
  added: []
  patterns:
    - injectable-default-db (conn = defaultDb parameter for test isolation)
    - tdd (red/green/refactor cycle — test first, then implementation)
    - constructable-class-mock (Issuer as class with static discover to fix 'Issuer is not a constructor')
    - history-gated seed (rbac_seed_history — analyst fallback reads live DB, not code constants)
key_files:
  created:
    - packages/server/src/lib/rbacDb.ts
    - packages/server/tests/lib.rbacDb.spec.ts
    - packages/server/tests/boot.rbacAdminWarning.spec.ts
  modified:
    - packages/server/src/index.ts
    - packages/server/.env.example
    - README.md
decisions:
  - "[46-03 rbacDb]: analyst fallback reads live DB role_permissions for analyst role (NOT DEFAULT_ROLE_MAPPINGS constant) — operator-edited analyst mappings take effect immediately for unassigned users"
  - "[46-03 rbacDb]: getAppAdminUsername reads process.env at call time (not module-level) — allows test mutation of process.env between cases"
  - "[46-03 boot mock]: Issuer mock made a real class with static discover — fixes 'Issuer is not a constructor' (oidc.ts: new Issuer(meta)) that breaks all pre-existing shared OIDC mock tests"
  - "[46-03 boot spec]: Standalone boot.rbacAdminWarning.spec.ts uses self-contained constructable mock — does NOT depend on ~106 pre-existing-red shared OIDC mock tests"
  - "[46-03 README]: APP_ADMIN_USERNAME row added to README.md v1.8 RBAC table — README env vars table exists so skip note in plan is not applicable"
metrics:
  duration: "5 minutes"
  completed: "2026-06-05T14:58:00Z"
  tasks: 2
  files: 6
---

# Phase 46 Plan 03: rbacDb Permission-Resolution Data Layer + OIDC Boot Warning Summary

**One-liner:** Synchronous SQLite permission-resolution layer with admin short-circuit, live-DB analyst fallback, and OIDC bootstrap-admin boot warning proven by standalone spec.

## Tasks Completed

| # | Name | Commit | Key Files |
|---|------|--------|-----------|
| 1 (TDD RED) | Failing tests for rbacDb | ace72b6 | packages/server/tests/lib.rbacDb.spec.ts |
| 1 (TDD GREEN) | rbacDb.ts implementation | 57674be | packages/server/src/lib/rbacDb.ts |
| 2 | OIDC boot warning + boot spec + .env docs | b6800d7 | packages/server/src/index.ts, tests/boot.rbacAdminWarning.spec.ts, .env.example, README.md |

## What Was Built

### packages/server/src/lib/rbacDb.ts

Per-request synchronous SQLite permission-resolution data layer (SCHEMA-V18-02):

- `getAppAdminUsername()` — reads `process.env.APP_ADMIN_USERNAME || "admin"` at call time (not module-level) for test isolation.
- `isBootstrapAdmin(username)` — case-insensitive trimmed comparison against configured admin username.
- `getEffectivePermissions(username, conn?)` — bootstrap short-circuit BEFORE any DB read → admin gets `new Set(ALL_PERMISSIONS)`. For other users: JOIN query on `user_roles + role_permissions`; zero-rows → analyst fallback reads LIVE DB analyst mappings (not code constant); else union of assigned role permissions.
- `getEffectiveRoles(username, conn?)` — admin → `["admin"]`, zero-rows → `["analyst"]`, else role names.
- `getEffectiveRolesAndPermissions(username, conn?)` — `{ roles, permissions }` shape for Phase 48 /me.

Key design: injectable `conn` parameter defaults to the db singleton so tests pass `createDb(":memory:")`.

### packages/server/src/index.ts

Added `import { getAppAdminUsername } from "./lib/rbacDb"` (after `import "./env"` — env import remains first). Added `rbac_bootstrap_admin_warning` structured `console.warn` immediately after the `oidc_boot` log, inside the `if (authMode === "oidc")` block. Non-fatal — boot continues. Warning fires when `appAdminUsername.toLowerCase() === "admin"` in OIDC mode.

### packages/server/tests/boot.rbacAdminWarning.spec.ts

Standalone SCHEMA-V18-03 / ROADMAP success-criterion-4 proof spec. Self-contained openid-client mock using a real class with static `discover` (fixes the pre-existing "Issuer is not a constructor" issue without touching other specs). Tests:
1. oidc + default APP_ADMIN_USERNAME → warning emitted (SC4 proof)
2. oidc + uppercase "ADMIN" → warning still emitted
3. oidc + APP_ADMIN_USERNAME="alice@corp.com" → no warning
4. password mode → no warning

## Verification

- `npm run test:server -- lib.rbacDb`: 16/16 passing (admin short-circuit incl. empty-DB + uppercase + APP_ADMIN_USERNAME override, analyst fallback, single role, multi-role union, custom role, case-insensitive lookup, getEffectiveRoles, getEffectiveRolesAndPermissions)
- `npm run test:server -- boot.rbacAdminWarning`: 4/4 passing (standalone, no shared-mock dependency)
- `npx tsc -p packages/server/tsconfig.json --noEmit`: clean
- Full server vitest: 634 passing / 106 pre-existing red (baseline unchanged — the 106 failures are TD-V16-TEST-ISOLATION unrelated to this plan)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed 'Issuer is not a constructor' in boot.rbacAdminWarning spec**
- **Found during:** Task 2 — first test run
- **Issue:** The plan instructs to copy the boot.hardening.spec.ts mock scaffold verbatim. However, the shared mock scaffold provides `Issuer` as a plain object `{ discover: vi.fn() }`, which is not constructable. `oidc.ts:82` calls `new Issuer(meta)` (a post-v1.1 addition), so the verbatim mock fails with "Issuer is not a constructor".
- **Fix:** Made `Issuer` a real class with a static `discover` property and a constructor that returns the mock issuer object. This makes the mock compatible with both `Issuer.discover()` (discovery) and `new Issuer(meta)` (client construction in oidc.ts).
- **Files modified:** `packages/server/tests/boot.rbacAdminWarning.spec.ts`
- **Commit:** b6800d7
- **Note:** The pre-existing 106 red tests (TD-V16-TEST-ISOLATION) share this same broken mock — they are NOT touched here per scope boundary rules. The fix is localized to the new spec only.

### README.md updated (plan said to skip if no env vars table)

The plan said to skip README if no env vars table exists. The root README.md at `/README.md` has a complete "Environment Variables" section with tables. An `APP_ADMIN_USERNAME` row was added to the new v1.8 RBAC table there.

## Self-Check: PASSED

All created files exist on disk. All 3 task commits verified in git history.
