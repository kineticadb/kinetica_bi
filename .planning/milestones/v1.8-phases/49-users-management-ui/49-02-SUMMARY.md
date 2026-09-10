---
phase: 49-users-management-ui
plan: "02"
subsystem: frontend-users-page
tags: [react, rbac, ui, users-management, chips, popover, bulk-assign]
dependency_graph:
  requires: [49-01]
  provides: [UsersPage component, listUsers/listRoles/assignRole/revokeRole API wrappers, humanizeRelativeTime helper, seedUserAdminStore test helper]
  affects: [packages/web/src/api/client.ts, packages/web/src/styles/global.css]
tech_stack:
  added: []
  patterns: [RTL + vi.mock pattern for async component testing, DataFilterRenderer click-outside popover pattern, Promise.allSettled bulk aggregate]
key_files:
  created:
    - packages/web/src/components/UsersPage.tsx
    - packages/web/src/lib/relativeTime.ts
    - packages/web/src/lib/relativeTime.spec.ts
    - packages/web/src/components/UsersPage.spec.tsx
  modified:
    - packages/web/src/api/client.ts
    - packages/web/src/test/seedAuthStore.ts
    - packages/web/src/styles/global.css
decisions:
  - "hide-don't-disable: all assign/revoke controls absent from DOM when user lacks users:assign_roles"
  - "Single popoverRef keyed by openPopoverUser string (null = closed); one popover open at a time"
  - "revokeRole/assignRole return parsed error body — caller surfaces verbatim message as toast + inline popover error"
  - "Promise.allSettled for bulk assign — no short-circuit; aggregate toast counts fulfilled vs failed"
  - "lock icon verified in tests via .users-lock-icon CSS class selector (FontAwesome SVG aria-hidden)"
metrics:
  duration: "6 minutes"
  completed: "2026-06-06"
  tasks: 3
  files: 7
---

# Phase 49 Plan 02: Users Management UI — Component Summary

UsersPage React component with role chips (×-to-revoke), Edit-roles checkbox popover (assign/revoke), bulk row-select bar with aggregate toast, and humanized last-seen column; fully gated on `users:assign_roles`.

## What Was Built

### Task 1: Client API wrappers + helpers (commit 480e731)

Added to `packages/web/src/api/client.ts`:
- `UserRow` and `RoleDto` exported types
- `listUsers(signal?)` — GET /api/users, returns `UserRow[]`
- `listRoles(signal?)` — GET /api/roles, returns `RoleDto[]`
- `assignRole(username, roleName)` — POST /api/users/:u/roles, returns `{ ok, error? }` (parsed body on non-ok so verbatim server message is preserved)
- `revokeRole(username, roleName)` — DELETE /api/users/:u/roles/:r, same return contract

Created `packages/web/src/lib/relativeTime.ts` — hand-rolled `humanizeRelativeTime(isoString|null)` helper with null→"never"; s/m/h/d ago buckets.

Created `packages/web/src/lib/relativeTime.spec.ts` — 4 unit tests (all passing).

Added `seedUserAdminStore()` to `packages/web/src/test/seedAuthStore.ts` with PERMISSIONS.* constants (USERS_VIEW + USERS_ASSIGN_ROLES + ROLES_VIEW + ROLES_MANAGE_PERMISSIONS + ROLES_CREATE_CUSTOM + DASHBOARDS_VIEW).

### Task 2: UsersPage.tsx + CSS (commit ca9dbe9)

Created `packages/web/src/components/UsersPage.tsx` (>300 lines):
- Fetches users + roles on mount with `useEffect` + `AbortController` (cleanup on unmount)
- `refetch()` helper re-runs `listUsers` after every successful assign/revoke (Pitfall 7)
- Click-outside popover: exact `useRef + document.addEventListener("mousedown")` DataFilterRenderer pattern keyed on `openPopoverUser: string | null`
- **Roles cell** — three branches: bootstrap → immutable admin chip (no ×); empty roles → muted "analyst (default)" chip; explicit roles → chips with × calling `handleRevoke`
- **Bulk bar** — rendered only when `canAssign && selected.size > 0`; `Promise.allSettled` for N individual POSTs; aggregate toast: "N assigned[, M failed: user — error]"
- **handleRevoke** — `revokeRole(...)` → `!r.ok` → `showToast(r.error!, "error")` (surfaces verbatim SAFE-V18-01 400); also sets inline popover error on that row's checkbox
- All assign/revoke controls hidden (not disabled) when `canAssign` is false

Added CSS to `packages/web/src/styles/global.css`:
- `.users-page`, `.users-table`, `.users-th/td/*` — table layout
- `.role-chip` (accent-green pill), `.role-chip--default` (muted outlined), `.role-chip__remove` (× button)
- `.users-bulk-bar`, `.users-popover`, `.popover-error`

### Task 3: UsersPage.spec.tsx (commit a4a5ce8)

5 test cases covering all must-have behaviors:
1. **USERS-V18-01 gating** — user_admin sees Edit roles + bulk bar; view-only sees neither
2. **Chips** — explicit roles render as chips with ×; unassigned renders "analyst (default)" with no ×
3. **Bootstrap lock** — lock icon present, no × on admin chip, no Edit roles button
4. **Last-admin verbatim toast** — `revokeRole` returning `{ ok: false, error: "Cannot revoke..." }` → `showToast(verbatim, "error")`
5. **Last-seen** — `null` → "never"; recent ISO → matches `/\d+m ago/`

## Verification

- `npm run test -- --run relativeTime` → 4/4 passed
- `npm run test -- --run UsersPage` → 6/6 passed
- `npm run build` → clean (no type errors, vite build succeeded)
- Full frontend suite: 1523 passed / 1 known-red (TD-V17-DASHPAGE-SPEC — pre-existing, unchanged)

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

Files created/modified:
- packages/web/src/components/UsersPage.tsx — FOUND
- packages/web/src/lib/relativeTime.ts — FOUND
- packages/web/src/lib/relativeTime.spec.ts — FOUND
- packages/web/src/components/UsersPage.spec.tsx — FOUND
- packages/web/src/api/client.ts (modified) — FOUND
- packages/web/src/test/seedAuthStore.ts (modified) — FOUND
- packages/web/src/styles/global.css (modified) — FOUND

Commits: 480e731, ca9dbe9, a4a5ce8 — all present in git log.

## Self-Check: PASSED
