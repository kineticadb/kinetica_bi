---
phase: 49-users-management-ui
verified: 2026-06-05T00:00:00Z
status: passed
score: 15/15 must-haves verified
re_verification: false
---

# Phase 49: Users Management UI — Verification Report

**Phase Goal:** User admin can see all known users with their roles, assign/revoke roles (incl. bulk assign), the admin onboarding banner prompts assignment, and last-admin protection prevents lockout — all consistent with server authority.
**Verified:** 2026-06-05
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | GET /api/users returns each row with last_seen (string\|null) and is_bootstrap (boolean) alongside username + roles | VERIFIED | index.ts:2028-2054 — LEFT JOIN ku2 for last_seen, is_bootstrap flag on map, users.unshift bootstrap synthesis |
| 2 | Bootstrap admin always appears in GET /api/users with is_bootstrap:true, even with no rows in either table | VERIFIED | index.ts:2051-2053 — `users.unshift({ username: bootstrapUsername, roles: [], last_seen: null, is_bootstrap: true })` |
| 3 | Revoking admin from the last non-bootstrap admin returns HTTP 400 with verbatim last-admin message; user_roles row NOT deleted | VERIFIED | index.ts:2089-2094 — `remaining <= 1` guard returns 400 with exact locked string before DELETE |
| 4 | Revoking admin when a second non-bootstrap admin still holds it returns 200 and deletes the row | VERIFIED | index.ts:2095-2099 — guard passes when remaining > 1; falls through to DELETE |
| 5 | Bootstrap admin is never counted as an admin holder by the guard | VERIFIED | index.ts:2085 — `username != lower(?)` with bootstrapUsername excludes bootstrap from COUNT |
| 6 | user_admin-seeded UsersPage shows Edit roles per non-bootstrap row + bulk bar; users:view-only sees neither | VERIFIED | UsersPage.tsx:46 canAssign gate; spec test 1 and test 1b confirm presence/absence |
| 7 | Each explicitly-assigned role renders as a chip with ×; unassigned user renders muted "analyst (default)" chip with no × | VERIFIED | UsersPage.tsx:286-319 — three render branches; "analyst (default)" in role-chip--default with no role-chip__remove |
| 8 | Bootstrap row renders lock indicator + immutable admin chip with no × and no Edit roles button | VERIFIED | UsersPage.tsx:274 faLock, 286-293 immutable admin chip, 330 `!user.is_bootstrap` gates Edit roles |
| 9 | Clicking × fires revokeRole; 400 last-admin response surfaces verbatim server message as error toast, chip remains | VERIFIED | UsersPage.tsx:94-100 handleRevoke; spec test 4 asserts `showToast(verbatim, "error")`; inline popover error also set (popoverErrors state) |
| 10 | Bulk bar: selecting multiple rows + role fires one assignRole per user, toasts aggregate result | VERIFIED | UsersPage.tsx:144-175 Promise.allSettled + aggregate toast "N assigned[, M failed: ...]" |
| 11 | last_seen renders humanized ("5m ago", "3d ago"); null renders "never" | VERIFIED | UsersPage.tsx:26 imports humanizeRelativeTime; :324 used on user.last_seen; relativeTime.ts:11 function |
| 12 | "User Management" sidebar item routes to Users page (page === "users" renders UsersPage) | VERIFIED | App.tsx:20 Page union includes "users"; :253 `{page === "users" && <UsersPage />}` |
| 13 | OIDC ReturnTo restore of page:'users' routes to Users page instead of falling back to dashboards | VERIFIED | App.tsx:170 `parsed.page === "users"` added to ReturnTo guard |
| 14 | Banner shows to users:assign_roles with >=1 non-bootstrap unassigned user; clicking link navigates to Users page; bootstrap excluded from count | VERIFIED | App.tsx:205-219 useEffect gated on USERS_ASSIGN_ROLES; :211 `!u.is_bootstrap && u.roles.length === 0` filter; :242 `setPage("users")` |
| 15 | Banner dismisses (×); never appears to sessions without users:assign_roles; auto-hides at zero unassigned | VERIFIED | App.tsx:239 `unassignedCount > 0 && !bannerDismissed`; :245 setBannerDismissed(true); :206 early return if no USERS_ASSIGN_ROLES |

**Score:** 15/15 truths verified

---

## Required Artifacts

### Plan 49-01 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/server/src/index.ts` | Extended GET /api/users + SAFE-V18-01 guard | VERIFIED | is_bootstrap at :2048, ku2.last_seen at :2030, users.unshift at :2052, guard at :2078-2095, verbatim error at :2091, `username != lower` at :2085 |
| `packages/server/tests/routes.management.spec.ts` | last_seen/is_bootstrap + last-admin guard cases | VERIFIED | Tests at lines 104, 129, 154 (GET extensions); SAFE-V18-01 cases at ~264, ~322 |

### Plan 49-02 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/web/src/components/UsersPage.tsx` | Users table with chips, popover, bulk bar, last-seen | VERIFIED | 377 lines (min_lines 120 met); all required features present |
| `packages/web/src/lib/relativeTime.ts` | humanizeRelativeTime(isoString\|null) helper | VERIFIED | Line 11: `export function humanizeRelativeTime` |
| `packages/web/src/api/client.ts` | listUsers/assignRole/revokeRole/listRoles + UserRow type | VERIFIED | Lines 1188-1249: UserRow type with is_bootstrap, all four functions |
| `packages/web/src/test/seedAuthStore.ts` | seedUserAdminStore() helper | VERIFIED | Line 79: `export function seedUserAdminStore`, line 87: USERS_ASSIGN_ROLES |
| `packages/web/src/lib/relativeTime.spec.ts` | 4 unit tests for humanizeRelativeTime | VERIFIED | 4 tests confirmed by grep count |
| `packages/web/src/components/UsersPage.spec.tsx` | 5 spec cases covering gating/chips/bootstrap/toast/last-seen | VERIFIED | All 5 cases present; seedUserAdminStore and verbatim string asserted |

### Plan 49-03 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/web/src/App.tsx` | Page union "users", render branch, OIDC ReturnTo case, banner state+fetch+JSX | VERIFIED | Line 20: union; :253: render; :170: ReturnTo; :239-247: banner JSX with "onboarding-banner" |
| `packages/web/src/App.spec.tsx` | 4 banner tests (gating, routing, dismiss, bootstrap exclusion) | VERIFIED | describe block "App — onboarding banner (USERS-V18-04)" with 4 `it` cases at :538-607 |
| `packages/web/src/styles/global.css` | .role-chip, .onboarding-banner CSS | VERIFIED | .role-chip at :3933; .onboarding-banner at :4080 |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| DELETE /api/users/:username/roles/:roleName | user_roles COUNT excluding bootstrap | `username != lower(?)` in COUNT query | WIRED | index.ts:2085 exact pattern present |
| UsersPage chip × | DELETE /api/users/:username/roles/:roleName via revokeRole | `revokeRole(username, roleName)` | WIRED | UsersPage.tsx:23 import, :94 call in handleRevoke, :311 onClick |
| UsersPage Edit-roles popover checkbox | POST/DELETE /api/users/:username/roles via assignRole/revokeRole | checkbox toggle handler | WIRED | UsersPage.tsx:103 assignRole, :114 revokeRole in handlePopoverToggle |
| UsersPage assign/revoke controls | useAuthStore.hasPermission(PERMISSIONS.USERS_ASSIGN_ROLES) | hide-don't-disable gate | WIRED | UsersPage.tsx:46 `canAssign = hasPermission(PERMISSIONS.USERS_ASSIGN_ROLES)` gating all controls |
| Sidebar "users" key onSelect | page === "users" render branch → UsersPage | setPage(key as Page) | WIRED | App.tsx:20 union, :233 onSelect cast, :253 render branch |
| onboarding banner fetch effect | GET /api/users (count roles.length===0) | listUsers gated on USERS_ASSIGN_ROLES | WIRED | App.tsx:206-211 effect with permission gate and is_bootstrap filter |
| banner link | Users page | setPage("users") | WIRED | App.tsx:242 onClick={() => setPage("users")} |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| USERS-V18-01 | 49-01 (server), 49-02 (UI) | Users page lists known usernames with assigned roles as chips | SATISFIED | GET /api/users extended with last_seen+is_bootstrap; UsersPage renders chips + last-seen column |
| USERS-V18-02 | 49-02 | User admin can assign and revoke roles per user; multiple roles simultaneously | SATISFIED | Edit-roles popover with per-role checkbox toggle (assign/revoke); chip × revokes individual roles |
| USERS-V18-03 | 49-02 | Bulk role assignment | SATISFIED | Bulk bar with Promise.allSettled + aggregate toast; UsersPage.tsx:144-175 |
| USERS-V18-04 | 49-03 | Admin onboarding banner with link to User Management | SATISFIED | App.tsx banner gated on USERS_ASSIGN_ROLES, excludes bootstrap, dismissable, links to Users page |
| SAFE-V18-01 | 49-01 | Last-admin protection: API rejects revocation leaving zero non-bootstrap admins | SATISFIED | index.ts:2078-2095 guard with bootstrap exclusion; verbatim 400 string confirmed |

**Note on REQUIREMENTS.md checkbox state:** The `[ ]` checkbox next to SAFE-V18-01 in the requirements list appears to not have been ticked, while the phase tracker table correctly shows "Complete (49-01)". This is a documentation discrepancy only — the code implementation is fully present and verified. The checkbox state does not affect phase verification.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/web/src/App.tsx` | 251 | `<div className="muted">Section coming soon.</div>` for settings page | Info | Pre-existing placeholder (confirmed by git diff — the settings stub existed before Phase 49; Phase 49 added only the users branch alongside it). No impact on phase goal. |
| `packages/server/src/index.ts` | 226 | `// TODO: Could be made env-configurable...` (healthcheck path) | Info | Pre-existing comment unrelated to Phase 49 scope. No impact. |

No blockers or warnings. Both items are pre-existing and outside Phase 49 scope.

---

## Locked Decision Verification

These decisions were specified as locked in the orchestrator context — all verified:

| Decision | Verified | Evidence |
|----------|----------|---------|
| Table+chips+popover layout | Yes | UsersPage.tsx uses table rows + role-chip spans + popover div |
| analyst-default muted chip (no ×) | Yes | UsersPage.tsx:294-302: role-chip--default with no role-chip__remove |
| Bulk assign-only with aggregate toast | Yes | UsersPage.tsx:144-175: Promise.allSettled, aggregate toast string |
| App-shell banner gated users:assign_roles + bootstrap excluded from count + useState dismiss | Yes | App.tsx:206, :211, :60 |
| Bootstrap row visible/locked/synthesized | Yes | index.ts:2051-2053 synthesis; UsersPage.tsx:274,286-293 lock+chip |
| SAFE-V18-01 server-only authority with bootstrap-exclusion counting | Yes | index.ts:2085; NO client-side admin counting in UsersPage.tsx (grep confirmed absence) |
| Verbatim 400 surfaced inline popover + toast on chip revoke | Yes | UsersPage.tsx:94-120 — showToast + popoverErrors state for inline display |
| OIDC ReturnTo restore includes "users" | Yes | App.tsx:170 |
| seedUserAdminStore exists | Yes | seedAuthStore.ts:79 |

---

## Human Verification Required

### 1. Visual table layout

**Test:** Log in as a user_admin, navigate to User Management
**Expected:** Table shows USERNAME | ROLE CHIPS | LAST SEEN | ACTIONS columns; chips look like pills; bootstrap row shows lock icon; default chip is visually muted/outlined
**Why human:** CSS rendering, icon display, and visual hierarchy cannot be verified programmatically

### 2. Popover click-outside dismiss

**Test:** Open the Edit roles popover for a user, then click outside of it
**Expected:** Popover closes automatically without requiring an explicit close action
**Why human:** DOM mousedown event behavior and visual dismiss require manual interaction

### 3. Real-time bulk assign flow

**Test:** Select 2+ users via checkboxes, choose a role from the dropdown, click "Assign role to N selected"
**Expected:** Aggregate toast appears (e.g., "2 assigned") and role chips update on the selected rows after refetch
**Why human:** Multi-step interactive flow; async refetch visual update

### 4. OIDC ReturnTo round-trip for Users page

**Test:** Navigate to User Management, trigger OIDC re-auth (or simulate session expiry), complete re-auth
**Expected:** Returns to the Users page instead of falling back to Dashboards
**Why human:** Requires OIDC re-auth flow which is external-service dependent

---

## Commit Chain

All 10 commits from summaries verified present in git log:

| Commit | Plan | Description |
|--------|------|-------------|
| b81c5a2 | 49-01 TDD RED | Failing tests for last_seen + is_bootstrap |
| 8be999d | 49-01 TDD GREEN | Extend GET /api/users |
| b2b292c | 49-01 TDD RED | Failing tests for SAFE-V18-01 guard |
| 59d2856 | 49-01 TDD GREEN | SAFE-V18-01 guard in DELETE handler |
| 480e731 | 49-02 | Client API wrappers, UserRow/RoleDto, relativeTime, seedUserAdminStore |
| ca9dbe9 | 49-02 | UsersPage.tsx + CSS |
| a4a5ce8 | 49-02 | UsersPage.spec.tsx |
| fa692a9 | 49-03 | App.tsx Page union + render branch + OIDC ReturnTo |
| 0c79801 | 49-03 | Onboarding banner state + fetch + JSX + CSS |
| ed2683e | 49-03 | App.spec.tsx banner tests |

---

_Verified: 2026-06-05_
_Verifier: Claude (gsd-verifier)_
