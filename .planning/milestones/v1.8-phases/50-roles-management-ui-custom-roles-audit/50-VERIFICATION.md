---
phase: 50-roles-management-ui-custom-roles-audit
verified: 2026-06-06T08:30:00Z
status: passed
score: 11/11 must-haves verified
re_verification: false
---

# Phase 50: Roles Management UI + Custom Roles + Audit — Verification Report

**Phase Goal:** User admins manage role→permission mappings via a matrix editor (built-ins editable with warning, custom roles creatable/deletable), escalation guards prevent privilege escalation, and all role changes emit structured audit entries.
**Verified:** 2026-06-06T08:30:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A user_admin (non-admin) caller is rejected with 403 when assigning the admin role, editing the admin role's mappings, or granting a permission they do not hold | VERIFIED | index.ts lines 2068-2234: 3 guards with verbatim messages; routes.management.spec.ts 65/65 green |
| 2 | A bootstrap admin and an explicit admin-role holder pass all three escalation guards | VERIFIED | getEffectiveRoles short-circuits to ["admin"] for bootstrap; explicit holder tested in spec (commit 9944973) |
| 3 | A custom role with active holders cannot be deleted (409); a holder-free custom role deletes; built-in roles still cannot be deleted | VERIFIED | index.ts line 2266: SELECT COUNT(*) holders check → 409; guard present; spec-covered |
| 4 | Creating a custom role with an invalid slug, a reserved built-in name, or a case-insensitive duplicate is rejected; a valid lowercase-slug name succeeds | VERIFIED | index.ts lines 2172-2178 + case-insensitive dup check; 7 slug/reservation tests in spec |
| 5 | Every role assign, revoke, mapping-save, role-create, and role-delete writes one rbac_audit row AND emits one OBS-01 JSON log line carrying actor, action, target, before/after | VERIFIED | emitRbacAudit called 5× in index.ts (grep count = 5); db.rbacAudit.spec.ts 9/9 green; routes.management.spec.ts audit describe blocks all green |
| 6 | The Roles page shows a left role list (built-ins badged, custom roles with a delete control, [+ New role] at bottom) and a right detail pane with 16 permission checkboxes grouped into Dashboards/Design/Users/Roles/Audit | VERIFIED | RolesPage.tsx 470 lines; NOUN_TO_GROUP + GROUP_ORDER constants at module scope; spec Test 1 asserts 16 checkboxes + 5 group headers |
| 7 | Toggling checkboxes stages a draft; [Save] sends ONE PUT /api/roles/:id/permissions with the full set; built-in saves first show a confirm | VERIFIED | isDirty state + window.confirm in RolesPage.tsx; updateRolePermissions called on Save; spec Test 2+3 assert single call + confirm path |
| 8 | Switching roles or attempting to navigate away with unsaved changes shows a discard-changes confirm | VERIFIED | handleSelectRole and handleNewRole both check isDirty + window.confirm("Discard unsaved changes?") |
| 9 | [+ New role] inline-creates a lowercase-slug-named role with all 16 unchecked; an invalid/duplicate/reserved name surfaces the verbatim server error | VERIFIED | validateNewName regex + BUILTIN_ROLE_NAMES check in RolesPage.tsx; spec Tests 7+8+9 cover bad-slug blocked, reserved-name blocked, valid-slug calls createRole |
| 10 | For a user_admin viewer, the admin role is shown locked and unheld permissions render disabled with tooltip; admin role hidden from non-admin editors' assign surfaces in UsersPage | VERIFIED | viewerIsAdmin predicate in RolesPage.tsx line 95; "Only admins can modify the admin role." + "You can only grant permissions you hold." strings present; editorIsAdmin + assignableRoles in UsersPage.tsx lines 49-50; UsersPage.spec.tsx Tests 6+7 |
| 11 | Selecting the Roles nav item renders RolesPage; after an OIDC redirect that stored page 'roles', the app restores to Roles page | VERIFIED | App.tsx: Page union includes "roles", render branch `{page === "roles" && <RolesPage />}`, ReturnTo guard includes parsed.page === "roles"; App.spec.tsx 3 tests green |

**Score:** 11/11 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/server/src/lib/rbacAudit.ts` | emitRbacAudit helper writing both OBS-01 log line and rbac_audit row | VERIFIED | 55 lines; exports RbacAuditAction, RbacAuditEntry, emitRbacAudit; level=info OBS-01 shape |
| `packages/server/src/db.ts` | rbac_audit table in SCHEMA_DDL | VERIFIED | Lines 197-207: CREATE TABLE IF NOT EXISTS rbac_audit + 2 indexes |
| `packages/server/src/index.ts` | 3 escalation guards + held-role delete block + slug validation + audit emission in 5 handlers | VERIFIED | getEffectiveRoles imported; BUILTIN_ROLES imported; 5× emitRbacAudit(db; 0 "deferred to Phase 50" comments remaining |
| `packages/web/src/components/RolesPage.tsx` | Two-pane Roles management page | VERIFIED | 470 lines (well above 200 minimum); named export RolesPage; all UX mirrors present |
| `packages/web/src/api/client.ts` | createRole, deleteRole, updateRolePermissions wrappers; RoleDto extended with holders_count | VERIFIED | holders_count: number at line 1186; all 3 wrappers at lines 1244-1286 |
| `packages/web/src/components/RolesPage.css` | Two-pane flex layout | VERIFIED | File exists |
| `packages/web/src/components/RolesPage.spec.tsx` | 12-test spec covering all ROLES-V18-01..04 and SAFE-V18-02 UX mirror behaviors | VERIFIED | 415 lines; 12/12 passing |
| `packages/server/tests/db.rbacAudit.spec.ts` | rbac_audit table + emitRbacAudit helper spec | VERIFIED | 258 lines; 9/9 passing |
| `packages/server/tests/routes.management.spec.ts` | createUserAdminSession + escalation guard tests + audit assertions | VERIFIED | 65/65 passing including all SAFE-V18-02 + AUDIT-V18-01 describe blocks |
| `packages/web/src/App.tsx` | "roles" Page union + render branch + OIDC ReturnTo case | VERIFIED | Page union, render branch, and ReturnTo guard all present |
| `packages/web/src/components/UsersPage.tsx` | editorIsAdmin + assignableRoles admin-role filter | VERIFIED | Lines 49-50: editorIsAdmin predicate and assignableRoles derivation; used in bulk dropdown and popover |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `packages/server/src/index.ts` | `getEffectiveRoles` | import from ./lib/rbacDb + callerRoles.includes('admin') gate | VERIFIED | Line 105 import; lines 2069, 2225 usage |
| `packages/server/src/index.ts` | `emitRbacAudit` | called in all 5 mutation handlers | VERIFIED | grep count = 5; lines 2082, 2131, 2199, 2247, 2277 |
| `packages/web/src/components/RolesPage.tsx` | PUT /api/roles/:id/permissions | updateRolePermissions on Save | VERIFIED | import at line 18; called in handleSave |
| `packages/web/src/components/RolesPage.tsx` | useAuthStore.user.roles | viewerIsAdmin = roles.includes('admin') gates lock + unheld-disable UX | VERIFIED | Line 95-96: `(s.user?.roles ?? []).includes("admin")` |
| `packages/web/src/App.tsx` | `packages/web/src/components/RolesPage.tsx` | page === 'roles' && <RolesPage /> | VERIFIED | Line 9: import; line 256: render branch |
| `packages/web/src/components/UsersPage.tsx` | useAuthStore.user.roles | filter admin role from popover + bulk dropdown for non-admin editors | VERIFIED | Line 49: editorIsAdmin; lines 234, 353: assignableRoles used in both render paths |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| ROLES-V18-01 | 50-02, 50-03 | Roles page shows built-in + custom roles with a role × permission matrix view | SATISFIED | RolesPage.tsx 470-line two-pane component; wired in App.tsx; ReturnTo restore; spec 12/12 |
| ROLES-V18-02 | 50-02 | Role→permission mappings editable for ALL roles including built-ins (with warning) | SATISFIED | window.confirm for built-in Save in RolesPage.tsx; single PUT semantics; spec Test 3 |
| ROLES-V18-03 | 50-01, 50-02 | User admin can create custom roles composing any subset of the permission catalog | SATISFIED | POST /api/roles slug validation in index.ts; createRole wrapper; inline create in RolesPage; client-side slug guard |
| ROLES-V18-04 | 50-01, 50-02 | Custom roles deletable only when no users hold them; built-in roles cannot be deleted | SATISFIED | holders COUNT check → 409 in index.ts; delete disabled when holders_count>0 in RolesPage; spec-covered |
| SAFE-V18-02 | 50-01, 50-02, 50-03 | Privilege-escalation guards: non-admin cannot assign admin role, edit admin role mappings, or grant unheld permissions | SATISFIED | All 3 guards in index.ts; UX mirrors in RolesPage.tsx + UsersPage.tsx; 65/65 server spec + 8/8 UsersPage spec |
| AUDIT-V18-01 | 50-01 | Role mutations emit structured audit-log entries (OBS-01 JSON + rbac_audit row) including actor, target, before/after | SATISFIED | emitRbacAudit 5× in index.ts; rbac_audit table in db.ts; 9/9 db spec + audit describe blocks in management spec |

No orphaned requirements — all 6 IDs claimed by plans and verified in codebase.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/web/src/App.tsx` | 253 | "Section coming soon." for Settings page | Info | Pre-existing; not related to Phase 50 scope |
| `packages/server/src/index.ts` | 871 | "WKB mode deferred" error response | Info | Pre-existing TD-V14-WKB-SPIKE; not phase 50 scope |
| `packages/web/src/components/RolesPage.tsx` | 206 | `return null` | Info | Valid: validateNewName returns null on success (no error) — correct pattern |
| `packages/web/src/components/RolesPage.tsx` | 350 | `placeholder="role_name"` | Info | Valid HTML input placeholder attribute, not a stub pattern |

No blockers. No phase-50-introduced stubs or incomplete implementations found.

---

## Human Verification Required

### 1. Two-pane visual layout

**Test:** Log in as an admin, navigate to the Roles page via sidebar.
**Expected:** Left pane shows built-in roles with [built-in] badges, custom roles with trash icons (disabled when holders_count > 0), and [+ New role] at the bottom. Right pane shows 16 permission checkboxes in 5 labeled groups.
**Why human:** CSS layout and visual badge rendering cannot be verified programmatically.

### 2. Dirty-guard UX on navigation away

**Test:** Select a role, toggle a checkbox, then click a different role.
**Expected:** Browser confirm dialog "Discard unsaved changes?" appears. Canceling keeps current role selected with draft intact.
**Why human:** window.confirm dialog appearance in a real browser cannot be verified by vitest.

### 3. Built-in role Save confirm UX

**Test:** Select a built-in role (e.g., analyst), toggle a checkbox, click Save.
**Expected:** Browser confirm "Changes affect all users with the analyst role — save?" appears before the PUT is sent.
**Why human:** window.confirm UX in real browser; vitest mocks it.

### 4. OBS-01 log line emission in server logs

**Test:** Perform a successful role assignment (assign designer role to a test user) and inspect server stdout.
**Expected:** A JSON line with `{"ts":"...","level":"info","event":"rbac_audit","actor":"...","action":"role_assigned","target":"...","before_json":"...","after_json":"..."}` appears in the log.
**Why human:** OBS-01 console.log output in a running server cannot be verified by unit tests in the same way as a live deployment.

---

## Test Suite Gates

| Suite | Result | Baseline |
|-------|--------|----------|
| `npm run test -- --run RolesPage` | 12/12 passed | New tests |
| `npm run test -- --run App.spec` | 30/30 passed | 27 pre-existing + 3 new |
| `npm run test -- --run UsersPage` | 8/8 passed | 6 pre-existing + 2 new |
| `npm run test:server -- routes.management.spec.ts` | 65/65 passed | Includes 27 new phase-50 tests |
| `npm run test:server -- db.rbacAudit.spec.ts` | 9/9 passed | All new |
| Full frontend (`npm run test`) | 1544/1545 (1 fail) | 1 known-red: DashboardsPage TD-V17-DASHPAGE-SPEC — pre-existing |
| Full server (`npm run test:server`) | 723/833 passed (109 fail) | 13 known-flaky files: auth.oidc.spec.ts, auth.routes.spec.ts, boot.hardening.spec.ts, boot.wipe.spec.ts, bootstrap.spec.ts, db.smoke.spec.ts, errorMiddleware.spec.ts, kinetica.creds.routes.spec.ts, oidc.module.spec.ts, routes.discovery.spec.ts, routes.materialize.spec.ts, routes.sql.spec.ts, routes.wms.spec.ts — all pre-existing TD-V16-TEST-ISOLATION |

No regressions introduced by Phase 50.

---

## TypeScript Hygiene

The `req as AuthedRequest` cast (commit 633c5e9) is correctly applied at all 5 new handler sites (lines 2068, 2122, 2200, 2224, 2275 of index.ts). The pre-existing tsc errors in `DataFilterConfigPanel.spec.tsx` and `App.spec.tsx` are pre-existing technical debt not introduced by this phase.

---

## Summary

Phase 50 goal is fully achieved. All three plans delivered:

- **50-01 (Server):** rbac_audit table, emitRbacAudit helper, 3 SAFE-V18-02 escalation guards, ROLES-V18-04 held-role delete block, ROLES-V18-03 slug/reservation/dup validation, audit threaded through all 5 mutation handlers. createUserAdminSession test helper enables non-bootstrap denial path coverage. 65 spec tests green.

- **50-02 (UI):** RolesPage two-pane component (470 lines), 16-checkbox permission matrix in NOUN_TO_GROUP 5 groups, draft/Save with built-in confirm, dirty guard on role switch, inline create with client-side slug validation, delete with holders_count UX, SAFE-V18-02 UX mirrors (admin lock + unheld-disable). 12 spec tests green. GET /api/roles extended with holders_count; 3 client wrappers added.

- **50-03 (Wiring):** RolesPage wired into App shell (Page union, render branch, OIDC ReturnTo). UsersPage admin-role filter for non-admin editors (editorIsAdmin + assignableRoles). App.spec 30/30, UsersPage.spec 8/8.

All 6 requirement IDs (ROLES-V18-01, ROLES-V18-02, ROLES-V18-03, ROLES-V18-04, SAFE-V18-02, AUDIT-V18-01) are satisfied and accounted for. Frontend gate: 1544/1545 (1 known pre-existing red). Server gate: 13 known-flaky files, no new failures.

---

_Verified: 2026-06-06T08:30:00Z_
_Verifier: Claude (gsd-verifier)_
