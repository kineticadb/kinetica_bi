---
phase: 50-roles-management-ui-custom-roles-audit
plan: 03
subsystem: ui
tags: [react, rbac, roles, navigation, oidc, permissions]

# Dependency graph
requires:
  - phase: 50-02
    provides: RolesPage component (named export) with full two-pane role management UI
  - phase: 49
    provides: UsersPage component with role chips, popover, and bulk-assign affordances

provides:
  - RolesPage wired into App shell via page === "roles" render branch
  - "roles" added to Page union type in App.tsx
  - OIDC ReturnTo restore guard extended to accept "roles" page
  - SAFE-V18-02 UI mirror: admin role hidden from assign surfaces for non-admin editors

affects: [51-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "editorIsAdmin predicate from useAuthStore user.roles (not permissions) for role-level gating"
    - "assignableRoles derived from roles filtered by editorIsAdmin — used in both popover + bulk dropdown"
    - "Bulk default-selection reads useAuthStore.getState() synchronously inside fetchData to pick first assignable role"

key-files:
  created: []
  modified:
    - packages/web/src/App.tsx
    - packages/web/src/App.spec.tsx
    - packages/web/src/components/UsersPage.tsx
    - packages/web/src/components/UsersPage.spec.tsx

key-decisions:
  - "[50-03 RolesPage import]: named export { RolesPage } — import uses braces, consistent with UsersPage pattern"
  - "[50-03 editorIsAdmin]: reads user.roles (not user.permissions) — matches server guard 1 which checks role membership, not permission set"
  - "[50-03 assignableRoles]: derived at render time; chip display of already-assigned roles left untouched (filter applies only to NEW assignment surfaces)"
  - "[50-03 bulk default init]: useAuthStore.getState() read synchronously inside fetchData (not stale closure) to pick correct first assignable role for non-admin editors"
  - "[50-03 App.spec RolesPage mock]: vi.mock at module level alongside UsersPage mock — both stubs render data-testid for routing tests"

patterns-established:
  - "ReturnTo restore test pattern: mount with status=unknown, assert loading, transition to authenticated, rerender, findByTestId"

requirements-completed: [ROLES-V18-01, SAFE-V18-02]

# Metrics
duration: 8min
completed: 2026-06-06
---

# Phase 50 Plan 03: App Shell Wiring + SAFE-V18-02 UsersPage Filter Summary

**RolesPage wired into App shell (Page union, render branch, OIDC ReturnTo) and admin-role hidden from non-admin editor assign surfaces in UsersPage**

## Performance

- **Duration:** 8 min
- **Started:** 2026-06-06T12:20:00Z
- **Completed:** 2026-06-06T12:22:49Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- App.tsx: imported RolesPage, extended Page union to include "roles", added ReturnTo restore guard case, added render branch `{page === "roles" && <RolesPage />}`
- UsersPage.tsx: added `editorIsAdmin` predicate from `user.roles`, derived `assignableRoles`, applied filter to popover checkbox map and bulk dropdown; bulk default-selection initialises to first assignable role (skips admin for non-admin editors)
- App.spec: 30 tests passing (3 new ROLES-V18-01 tests — ReturnTo restore + single-use key clear + render branch verification)
- UsersPage.spec: 8 tests passing (2 new SAFE-V18-02 tests — user_admin cannot see admin option, admin can)
- Full frontend: 1544 passing, 1 known-red (DashboardsPage TD-V17-DASHPAGE-SPEC unchanged); tsc clean

## Task Commits

Each task was committed atomically:

1. **Task 1: App.tsx Page union + render branch + OIDC ReturnTo + App.spec** - `89563ab` (feat)
2. **Task 2: UsersPage admin-role filter for non-admin editors + spec** - `986760b` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `packages/web/src/App.tsx` - RolesPage import, "roles" in Page union, ReturnTo guard extension, render branch
- `packages/web/src/App.spec.tsx` - RolesPage module stub, ROLES-V18-01 describe block (3 tests)
- `packages/web/src/components/UsersPage.tsx` - editorIsAdmin predicate, assignableRoles derivation, popover + bulk dropdown filter, bulk default-init fix
- `packages/web/src/components/UsersPage.spec.tsx` - seedAdminStore import, Tests 6+7 (SAFE-V18-02 coverage)

## Decisions Made

- `editorIsAdmin` reads `user.roles` (not `user.permissions`) — role membership is the correct predicate because the server guard checks role level ("cannot assign admin") not permission level. A user_admin has `users:assign_roles` permission but does NOT have admin role, so filtering on roles correctly excludes admin from their assign surfaces.
- `assignableRoles` computed on render (not memoized) — the list is short (4 built-ins + N custom) and the filter is O(n), so no memoization overhead is justified.
- Chip display of already-assigned admin role is preserved — if a user somehow has admin assigned, the chip remains visible (revoke is still allowed); only NEW assignment via popover/bulk is blocked for non-admin editors.
- Bulk default-selection init uses `useAuthStore.getState()` synchronously inside `fetchData` to avoid stale closure issues with the `editorIsAdmin` variable which is computed at render time, not inside the async callback.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None — all changes matched expected interface and test setup from Phase 49 precedents. Both test suites green on first run.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 50 complete: all 3 plans done (50-01 server guards + audit, 50-02 RolesPage component, 50-03 App shell wiring + UsersPage filter)
- ROLES-V18-01 end-to-end satisfied: Roles nav renders RolesPage, OIDC ReturnTo restores it
- SAFE-V18-02 fully closed: server blocks escalation (50-01), UI hides admin option from non-admin editors (50-03)
- AUDIT-V18-01 complete: audit log built in 50-01
- Phase 51 (Verification + Live UAT) is unblocked

---
*Phase: 50-roles-management-ui-custom-roles-audit*
*Completed: 2026-06-06*
