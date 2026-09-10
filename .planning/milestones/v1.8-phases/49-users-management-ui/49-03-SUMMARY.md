---
phase: 49-users-management-ui
plan: "03"
subsystem: ui
tags: [react, app-shell, banner, routing, permissions, rbac]

# Dependency graph
requires:
  - phase: 49-02
    provides: UsersPage component (named export UsersPage), listUsers client function, UserRow type
  - phase: 49-01
    provides: GET /api/users with is_bootstrap + last_seen fields; SAFE-V18-01 guard
  - phase: 48
    provides: useAuthStore.hasPermission, PERMISSIONS constants mirror, seedUserAdminStore/seedAnalystStore
provides:
  - App.tsx wired with Page union extended to 4 members (added "users")
  - UsersPage reachable via Sidebar "User Management" nav item
  - OIDC ReturnTo restore preserves Users page across re-auth round-trips
  - Onboarding banner for users:assign_roles holders when non-bootstrap unassigned users exist
  - Banner session-dismissable; auto-hides at zero unassigned; links to Users page
  - App.spec.tsx extended with 4 banner tests (gating, dismiss, routing, bootstrap exclusion)
affects: [phase-50, phase-51]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Banner lazy fetch: separate useEffect gated on status===authenticated AND hasPermission(...); never inside bootstrap chain (Pitfall 6)"
    - "Named import { UsersPage } not default import (UsersPage.tsx exports named, not default)"
    - "OIDC ReturnTo guard: extend the parsed.page === union check whenever Page union grows"

key-files:
  created: []
  modified:
    - packages/web/src/App.tsx
    - packages/web/src/App.spec.tsx
    - packages/web/src/styles/global.css

key-decisions:
  - "UsersPage uses named export { UsersPage } not default export — import must use braces (auto-fixed Rule 1 during Task 1)"
  - "Banner fetch is a standalone useEffect with AbortController; swallows non-Abort errors silently (banner is non-critical)"
  - "bannerDismissed is React state only (no sessionStorage) — banner reappears on reload, matching CONTEXT.md session-dismissable spec"
  - "unassignedCount guard: > 0 ensures banner never shows when all non-bootstrap users are assigned"

patterns-established:
  - "App.tsx Page union + OIDC ReturnTo conditional must both be updated together when adding a new page"
  - "App-shell info bars use .onboarding-banner + role=status, dismissable via React state"

requirements-completed: [USERS-V18-04]

# Metrics
duration: 4min
completed: 2026-06-06
---

# Phase 49 Plan 03: App.tsx Integration + Onboarding Banner Summary

**Users page wired into app shell via Page union extension, OIDC ReturnTo restore, and session-dismissable admin onboarding banner that fetches lazily post-auth and excludes the bootstrap admin from the unassigned count**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-06-06T00:59:02Z
- **Completed:** 2026-06-06T01:03:10Z
- **Tasks:** 3 (Task 3 TDD)
- **Files modified:** 3

## Accomplishments
- App.tsx extended with `"users"` Page union member, `{ UsersPage }` render branch, and OIDC ReturnTo restore conditional (3 touches as planned)
- Onboarding banner added to app shell: lazy fetch post-auth, gated on `users:assign_roles`, excludes bootstrap rows, session-dismissable, auto-hides at zero, links to Users page
- App.spec.tsx extended with 4 passing banner tests covering gating, routing, dismiss, and bootstrap exclusion edge case

## Task Commits

Each task was committed atomically:

1. **Task 1: Three App.tsx touches — Page union, render branch, OIDC ReturnTo restore** - `fa692a9` (feat)
2. **Task 2: Onboarding banner — state, lazy fetch effect, JSX, CSS** - `0c79801` (feat)
3. **Task 3: App.spec.tsx — banner gating + dismiss + routing** - `ed2683e` (test)

_Note: Task 3 is TDD; implementation already green from Task 2, so RED/GREEN collapsed into single test commit._

## Files Created/Modified
- `packages/web/src/App.tsx` - Page union extended, UsersPage import + render branch, OIDC ReturnTo case, banner state + fetch effect + JSX
- `packages/web/src/App.spec.tsx` - listUsers mock added to vi.mock block, UsersPage stub added, 4 new banner describe/it blocks
- `packages/web/src/styles/global.css` - .onboarding-banner, .banner-link, .banner-dismiss CSS appended

## Decisions Made
- **Named import fix:** UsersPage.tsx exports `export function UsersPage` (named), not a default. App.tsx must use `{ UsersPage }` import. Build immediately caught this as a Rollup bundling error (auto-fixed Rule 1).
- **Banner fetch AbortError handling:** Only AbortError is caught and returned silently; all other errors are also swallowed since the banner is non-critical (failed fetch → banner simply never shows).
- **bannerDismissed as React state only:** Per 49-RESEARCH.md Open Question 3 resolution — React useState is session-only and matches "session-dismissable" requirement without sessionStorage complexity.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed default vs named import for UsersPage**
- **Found during:** Task 1 build verification
- **Issue:** Plan specified `import UsersPage from "./components/UsersPage"` (default import), but UsersPage.tsx uses named export `export function UsersPage` (not default)
- **Fix:** Changed to `import { UsersPage } from "./components/UsersPage"`
- **Files modified:** packages/web/src/App.tsx
- **Verification:** `npm run build` passes clean after fix
- **Committed in:** fa692a9 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Necessary fix; the plan's import style was inconsistent with how 49-02 exported the component. No scope creep.

## Issues Encountered
- None beyond the auto-fixed import style mismatch above.

## Next Phase Readiness
- Phase 49 complete: all 4 requirements satisfied (USERS-V18-01..04, SAFE-V18-01)
- Users page is reachable, role assignment/revocation works, banner shows to admins
- Phase 50 (Roles Management UI + Custom Roles + Audit) is unblocked

---
*Phase: 49-users-management-ui*
*Completed: 2026-06-06*
