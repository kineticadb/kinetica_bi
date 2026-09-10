---
phase: 48-me-extension-frontend-store-ui-gating
plan: "04"
subsystem: ui
tags: [react, zustand, permissions, rbac, sidebar, topbar]

# Dependency graph
requires:
  - phase: 48-01
    provides: useAuthStore extended with hasPermission selector + PERMISSIONS mirror + seedAuthStore helpers
provides:
  - Sidebar permission-gated nav items (User Management on users:view, Roles on roles:view)
  - Topbar identity from useAuthStore (real username, role chips, derived initials)
  - Deletion of vestigial useUserStore (store/user.ts removed, zero consumers remain)
affects: [49-users-management-ui, 50-roles-management-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Permission-gated nav items: filter nav array via hasPermission before render; ungated items always pass"
    - "Topbar identity: useAuthStore((s) => s.user) replaces hardcoded store; initials derived at render time"

key-files:
  created: []
  modified:
    - packages/web/src/components/Sidebar.tsx
    - packages/web/src/components/Sidebar.spec.tsx
    - packages/web/src/components/Topbar.tsx
  deleted:
    - packages/web/src/store/user.ts

key-decisions:
  - "48-04 Sidebar gating: filter(item => !item.permission || hasPermission(item.permission)) over static nav array; ungated items always pass; gated hidden when user null or permission absent"
  - "48-04 Topbar identity: user.username.slice(0,2).toUpperCase() for initials (fallback '?'); user.roles.map for chips; user-identity block conditionally rendered only when user non-null"
  - "48-04 useUserStore deletion: git rm after single consumer (Topbar) migrated; zero references remain in src/"

patterns-established:
  - "Sidebar gating pattern: optional permission field on NavItem; filter before map; no prop drilling"

requirements-completed: [GATE-V18-05]

# Metrics
duration: 2min
completed: 2026-06-05
---

# Phase 48 Plan 04: Sidebar + Topbar Identity Summary

**Permission-gated Sidebar nav items (users:view / roles:view) + real useAuthStore identity in Topbar; vestigial useUserStore deleted**

## Performance

- **Duration:** 2 min
- **Started:** 2026-06-05T22:13:24Z
- **Completed:** 2026-06-05T22:15:42Z
- **Tasks:** 2
- **Files modified:** 3 (+ 1 deleted)

## Accomplishments
- Sidebar filters nav items via `hasPermission` — analyst sees 3 base items; admin sees all 5 including User Management + Roles
- Topbar replaced hardcoded "Data Engineer/Admin" identity with real `useAuthStore` user: username, role chips (`user_admin` → "user admin"), derived initials
- Deleted `store/user.ts` entirely via git rm; zero `useUserStore` references remain in `packages/web/src/`
- Sidebar.spec extended with GATE-V18-05 block (3 new tests: analyst-hidden, admin-visible, unauthenticated-hidden); all 16 tests green

## Task Commits

1. **Task 1: Gate Sidebar nav items on users:view / roles:view + extend spec** - `6b43979` (feat)
2. **Task 2: Replace Topbar identity with useAuthStore; delete useUserStore** - `2a6f310` (feat)

**Plan metadata:** (final docs commit)

## Files Created/Modified
- `packages/web/src/components/Sidebar.tsx` - Added faUsers + faUserShield icons; widened NavItem with optional `permission` field; added User Management + Roles nav items; compute `visibleNav` via `hasPermission` filter
- `packages/web/src/components/Sidebar.spec.tsx` - Added Phase 48 GATE-V18-05 describe block with 3 tests; reset `useAuthStore` to null in `beforeEach`
- `packages/web/src/components/Topbar.tsx` - Replaced `useUserStore` with `useAuthStore`; derived initials; added `user-identity` block with username + role chips
- `packages/web/src/store/user.ts` - DELETED (vestigial hardcoded store)

## Decisions Made
- `visibleNav = nav.filter(item => !item.permission || hasPermission(item.permission))` — clean declarative filter; ungated items always visible regardless of auth state
- Role chip render: `r.replace("_", " ")` converts `user_admin` to "user admin" for readable display
- Avatar initials fallback to `"?"` when `user` is null (unauthenticated Topbar render)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- `npm run test -- --run <pattern>` double-passes the `--run` flag (it's already in the npm script). Used `npx vitest run <pattern>` directly.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- GATE-V18-05 complete; Sidebar now shows User Management and Roles routes to users with appropriate permissions
- Phase 49 (Users Management UI) can implement the `/users` route and render correctly since the nav item now gates access
- Phase 50 (Roles Management UI) can implement the `/roles` route with the nav item already gated

## Self-Check: PASSED

- Sidebar.tsx: FOUND
- Sidebar.spec.tsx: FOUND
- Topbar.tsx: FOUND
- store/user.ts: FOUND deleted (correct)
- 48-04-SUMMARY.md: FOUND
- Commit 6b43979 (Task 1): FOUND
- Commit 2a6f310 (Task 2): FOUND

---
*Phase: 48-me-extension-frontend-store-ui-gating*
*Completed: 2026-06-05*
