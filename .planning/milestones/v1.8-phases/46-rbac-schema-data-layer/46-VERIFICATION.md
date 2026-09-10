---
phase: 46-rbac-schema-data-layer
verified: 2026-06-05T11:03:00Z
status: passed
score: 12/12 must-haves verified
gaps: []
human_verification: []
---

# Phase 46: RBAC Schema + Data Layer — Verification Report

**Phase Goal:** The SQLite role registry and all data-access primitives exist and are idempotently seeded — every downstream phase can read and write roles, permissions, and user assignments without performing any DB migrations of their own.
**Verified:** 2026-06-05T11:03:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | A code-defined PERMISSIONS catalog of exactly 15 noun:verb strings exists and is importable | VERIFIED | `permissions.ts` exports 15-entry `PERMISSIONS` const (confirmed by grep: 15 matches); spec independently locks all 15 strings; 14/14 spec tests pass |
| 2  | DEFAULT_ROLE_MAPPINGS exposes the locked per-role permission sets (admin 15 / designer 8 / user_admin 6 / analyst 1) | VERIFIED | `DEFAULT_ROLE_MAPPINGS` in `permissions.ts`; spec locks each set order-insensitively; full test suite 14/14 green |
| 3  | BUILTIN_ROLES lists the four built-in role names in stable order | VERIFIED | `BUILTIN_ROLES = ["admin","user_admin","designer","analyst"] as const` at line 45; spec asserts exact order |
| 4  | A server restart against an existing v1.7 database creates roles/role_permissions/user_roles tables idempotently without error | VERIFIED | `CREATE TABLE IF NOT EXISTS` for all three tables in `db.ts` SCHEMA_DDL; `db.rbacMigration.spec.ts` case "hand-built v1.7 DB gets RBAC tables added without losing existing data" passes (18/18 tests green) |
| 5  | After boot the four built-in roles + 15-permission default mappings (30 rows total) are present | VERIFIED | `db.rbacMigration.spec.ts` "seeds exactly 4 built-in roles", "seeds 30 role_permissions rows total", per-role counts (15/8/6/1) all pass |
| 6  | A second restart inserts no duplicate rows (idempotency) | VERIFIED | `db.rbacMigration.spec.ts` "two consecutive createDb calls on same file produce no duplicate rows" passes; history-gated seed via `rbac_seed_history` table (approved deviation from 46-CONTEXT.md §Seed) |
| 7  | Operator edits to a built-in role's mappings survive restart (seed never overwrites) | VERIFIED | `db.rbacMigration.spec.ts` "operator-removed default permission stays removed after second seedRbac run" passes; `rbacSeed.ts` contains zero DELETE/UPDATE statements (confirmed by grep) |
| 8  | `getEffectivePermissions("admin")` returns all 15 permissions regardless of DB state (bootstrap short-circuit before any DB lookup) | VERIFIED | `rbacDb.ts` lines 67-69: `isBootstrapAdmin` check fires before any prepared statement; `lib.rbacDb.spec.ts` "admin short-circuit on EMPTY db" passes; 16/16 tests green |
| 9  | A username with zero user_roles rows resolves to the analyst role's current live DB permission set (analyst fallback, no lockout) | VERIFIED | `rbacDb.ts` lines 87-96: live DB query on analyst role mappings (not the code constant); spec test "analyst fallback: zero user_roles rows" passes |
| 10 | Username matching is case-insensitive (bootstrap comparison and user_roles lookup) | VERIFIED | `isBootstrapAdmin` uses `.toLowerCase()`; `getEffectivePermissions` lowercases before query; spec tests "ADMIN uppercase", "whitespace + mixed case", "BOB lookup" all pass |
| 11 | A user with multiple roles resolves to the union of all their roles' permissions | VERIFIED | `rbacDb.ts` `SELECT DISTINCT rp.permission` JOIN across all assigned roles; spec test "designer + user_admin union" passes |
| 12 | When AUTH_MODE=oidc and APP_ADMIN_USERNAME is unset/default, the boot log contains a structured rbac_bootstrap_admin_warning | VERIFIED | `index.ts` lines 193-214: warning inside the `authMode === "oidc"` block immediately after `oidc_boot`; `boot.rbacAdminWarning.spec.ts` 4/4 tests pass (oidc+default warns, oidc+custom suppressed, password mode silent, uppercase "ADMIN" warns) |

**Score:** 12/12 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/server/src/lib/permissions.ts` | Canonical PERMISSIONS catalog, BUILTIN_ROLES, DEFAULT_ROLE_MAPPINGS, ALL_PERMISSIONS | VERIFIED | 103 lines; exports all required symbols; `as const` assertion present; zero side effects |
| `packages/server/src/lib/rbacSeed.ts` | `seedRbac(db)` — history-gated idempotent INSERT OR IGNORE | VERIFIED | 83 lines; exports `seedRbac`; uses `rbac_seed_history` history-gate; no DELETE/UPDATE; does not touch `user_roles` |
| `packages/server/src/db.ts` | roles/role_permissions/user_roles/rbac_seed_history tables in SCHEMA_DDL + seedRbac() call inside createDb | VERIFIED | All 4 tables present as `CREATE TABLE IF NOT EXISTS`; `seedRbac(instance)` wired at end of createDb before `return instance`; `import { seedRbac }` at line 5 |
| `packages/server/src/lib/rbacDb.ts` | getEffectivePermissions, getEffectiveRoles, getEffectiveRolesAndPermissions, isBootstrapAdmin, getAppAdminUsername | VERIFIED | 151 lines; all 5 exports present; admin short-circuit precedes all prepared statements |
| `packages/server/src/index.ts` | Structured OIDC bootstrap-admin boot warning inside authMode==='oidc' block | VERIFIED | Warning at lines 193-214, inside the existing `if (authMode === "oidc")` block; env import remains at line 3 (first); getAppAdminUsername imported at line 104 |
| `packages/server/.env.example` | APP_ADMIN_USERNAME documentation | VERIFIED | `APP_ADMIN_USERNAME=admin` present with comment referencing `rbac_bootstrap_admin_warning` |
| `packages/server/tests/lib.permissions.spec.ts` | Locks catalog size (15), exact strings, and per-role default mappings | VERIFIED | 14/14 tests pass; spec hardcodes expected strings independently (not derived from source) |
| `packages/server/tests/db.rbacMigration.spec.ts` | Idempotent migration proof on fresh DB and v1.7-schema DB | VERIFIED | 18/18 tests pass; covers fresh boot, seed counts, 2-restart idempotency, operator-edit survival, v1.7 upgrade, FK cascade, seed-history contract |
| `packages/server/tests/lib.rbacDb.spec.ts` | Admin short-circuit, analyst fallback, single/multi-role union, custom role, case-insensitivity | VERIFIED | 16/16 tests pass; all resolution paths covered |
| `packages/server/tests/boot.rbacAdminWarning.spec.ts` | Standalone createApp() boot test for SCHEMA-V18-03 / ROADMAP SC4 | VERIFIED | 4/4 tests pass; self-contained openid-client mock (does not depend on pre-existing broken shared mocks); Tests 1/1b/2/3 cover all SC4 cases |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `packages/server/src/lib/rbacSeed.ts` | `packages/server/src/lib/permissions.ts` | `import { BUILTIN_ROLES, DEFAULT_ROLE_MAPPINGS } from "./permissions"` | WIRED | Line 30 of rbacSeed.ts |
| `packages/server/src/lib/rbacDb.ts` | `packages/server/src/lib/permissions.ts` | `import { ALL_PERMISSIONS } from "./permissions"` | WIRED | Line 26 of rbacDb.ts |
| `packages/server/src/db.ts createDb` | `packages/server/src/lib/rbacSeed.ts seedRbac` | `seedRbac(instance)` call before return | WIRED | Line 262 of db.ts; import at line 5 |
| `packages/server/src/index.ts (authMode oidc block)` | APP_ADMIN_USERNAME env resolution via getAppAdminUsername | `rbac_bootstrap_admin_warning` emission when oidc + default | WIRED | Lines 198-214 of index.ts; inside `if (authMode === "oidc")` block |
| `packages/server/tests/boot.rbacAdminWarning.spec.ts` | `packages/server/src/index.ts createApp() oidc warning` | createApp() with stubbed oidc env + console.warn spy asserting `rbac_bootstrap_admin_warning` | WIRED | Self-contained vi.mock for openid-client; 4/4 tests pass |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SCHEMA-V18-01 | 46-01-PLAN, 46-02-PLAN | SQLite role registry (roles/role_permissions/user_roles) created idempotently + seeded; 15-item code-defined permission catalog | SATISFIED | All 4 tables in SCHEMA_DDL; permissions.ts has 15-entry catalog; seedRbac history-gated; 18/18 migration tests pass |
| SCHEMA-V18-02 | 46-03-PLAN | `getEffectivePermissions(username)` resolves union of roles; zero user_roles rows falls back to analyst | SATISFIED | rbacDb.ts exports all three resolution helpers; 16/16 rbacDb tests pass covering all paths |
| SCHEMA-V18-03 | 46-03-PLAN | Bootstrap admin short-circuit (APP_ADMIN_USERNAME) + structured boot warning when AUTH_MODE=oidc + default | SATISFIED | isBootstrapAdmin + getAppAdminUsername in rbacDb.ts; rbac_bootstrap_admin_warning in index.ts oidc block; 4/4 boot warning tests pass |

No orphaned requirements for Phase 46 — REQUIREMENTS.md maps exactly SCHEMA-V18-01, SCHEMA-V18-02, SCHEMA-V18-03 to Phase 46, all three claimed across the three plans and all satisfied.

---

### ROADMAP Success Criteria Cross-Reference

| SC | Criterion | Status | Evidence |
|----|-----------|--------|---------|
| SC1 | Server restart against v1.7 DB: tables created idempotently, 4 built-in roles + 15 permissions present, no duplicate rows on second restart | VERIFIED | db.rbacMigration.spec.ts 18/18; history-gated seed prevents duplicate re-insertion |
| SC2 | `getEffectivePermissions("admin")` returns all 15 regardless of DB state | VERIFIED | lib.rbacDb.spec.ts "admin short-circuit on EMPTY db" passes; isBootstrapAdmin fires before any DB read |
| SC3 | Zero user_roles rows → analyst fallback, no lockout | VERIFIED | lib.rbacDb.spec.ts "analyst fallback" passes; live DB query (not code constant) |
| SC4 | AUTH_MODE=oidc + APP_ADMIN_USERNAME default → structured boot warning | VERIFIED | boot.rbacAdminWarning.spec.ts 4/4 passes (proven by standalone createApp() invocation) |
| SC5 | db.rbacMigration.spec.ts confirms idempotent migration on fresh DB and v1.7-schema DB | VERIFIED | 18/18 tests pass including fresh boot case and v1.7-upgrade case |

---

### Anti-Patterns Found

None detected.

Scanned `permissions.ts`, `rbacSeed.ts`, `rbacDb.ts`, `index.ts` (warning block), all four spec files. No TODO/FIXME/PLACEHOLDER comments found. No empty implementations (return null/return {}/return []). No console.log-only stubs. No unimplemented handlers.

The seed uses `INSERT OR IGNORE only — never DELETE/UPDATE` which is the intended design (documented in comments), not a stub.

---

### Human Verification Required

None. All phase-46 deliverables are data-layer / server-code with no visual, real-time, or external-service components. All behaviors are mechanically provable via SQLite queries and synchronous function calls, and all are covered by the automated test suite.

---

### Approved Mid-Phase Deviation

**Seed-history mechanism (46-CONTEXT.md):** The original plan called for pure INSERT OR IGNORE in `seedRbac`. During execution (commit `6f9e26f`) this was refined to use a `rbac_seed_history` table that tracks which (role_name, permission) defaults have ever been seeded. This STRENGTHENS SC1 — it prevents operator-removed default mappings from being resurrected on restart while still ensuring new catalog additions auto-land exactly once. The `rbac_seed_history` table is in SCHEMA_DDL and the 18-test migration spec includes a dedicated "seed-history contract" describe block. This deviation is recorded in `46-CONTEXT.md` and does not violate any requirement or success criterion.

---

### Test Results Summary

| Spec | Result | Tests |
|------|--------|-------|
| `lib.permissions.spec.ts` | PASSED | 14/14 |
| `db.rbacMigration.spec.ts` | PASSED | 18/18 |
| `lib.rbacDb.spec.ts` | PASSED | 16/16 |
| `boot.rbacAdminWarning.spec.ts` | PASSED | 4/4 |
| `npx tsc --noEmit` | CLEAN | — |
| Full server suite | 634 passed / 106 failed | Matches pre-v1.8 baseline (TD-V16-TEST-ISOLATION); no regressions |

---

_Verified: 2026-06-05T11:03:00Z_
_Verifier: Claude (gsd-verifier)_
