---
phase: 49-users-management-ui
plan: "01"
subsystem: server-api
tags: [rbac, management-api, last-seen, bootstrap, safe-v18-01, tdd]
dependency_graph:
  requires: [47-03-management-routes, 46-03-rbac-db]
  provides: [extended-get-users-response, safe-v18-01-guard]
  affects: [49-02-users-page, 49-03-role-revoke-ui]
tech_stack:
  added: []
  patterns: [tdd-red-green, left-join-subquery-alias, bootstrap-short-circuit]
key_files:
  created: []
  modified:
    - packages/server/src/index.ts
    - packages/server/tests/routes.management.spec.ts
decisions:
  - "LEFT JOIN known_users ku2 (alias) used to add last_seen without disrupting the UNION de-dup subquery grouping"
  - "bootstrapUsername read at request time via process.env (not module-scope) — consistent with rbacDb.getAppAdminUsername and 46-03 decision"
  - "users.unshift() synthesizes bootstrap row only when absent from both tables (never-logged-in fresh deployment)"
  - "Guard COUNT excludes bootstrap via 'username != lower(?)' — works whether or not bootstrap has an explicit user_roles row"
  - "Verbatim error string locked: 'Cannot revoke: this is the last admin. At least one non-bootstrap user must hold the admin role.' — single source of truth for 49-02/49-03"
metrics:
  duration: "3 min"
  completed: "2026-06-05"
  tasks_completed: 2
  files_modified: 2
---

# Phase 49 Plan 01: Server Foundation — Extended Users API + SAFE-V18-01 Summary

**One-liner:** Extended GET /api/users with last_seen (LEFT JOIN known_users) and is_bootstrap flag plus bootstrap-row synthesis, and landed SAFE-V18-01 last-admin guard (COUNT non-bootstrap holders, exclude bootstrap) in the DELETE role handler.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 (TDD RED) | Failing tests for last_seen + is_bootstrap + bootstrap synthesis | b81c5a2 | routes.management.spec.ts |
| 1 (TDD GREEN) | Extend GET /api/users with last_seen + is_bootstrap + bootstrap synthesis | 8be999d | index.ts |
| 2 (TDD RED) | Failing tests for SAFE-V18-01 last-admin guard | b2b292c | routes.management.spec.ts |
| 2 (TDD GREEN) | SAFE-V18-01 guard in DELETE role handler | 59d2856 | index.ts |

## What Was Built

### Task 1: Extended GET /api/users

The existing Phase 47 handler used a UNION subquery over `known_users` + `user_roles` to list distinct usernames. This plan added:

1. **`last_seen`** — A second LEFT JOIN on `known_users` using a separate alias (`ku2`) to avoid conflating the UNION source with the last_seen value source. Users in `user_roles` only (never logged in) get `last_seen: null`.

2. **`is_bootstrap`** — Boolean flag set to `true` when `row.username === bootstrapUsername`. The bootstrap username is resolved at request time via `(process.env.APP_ADMIN_USERNAME || "admin").toLowerCase()`.

3. **Bootstrap row synthesis** — After the SQL query, if no row matches the bootstrap username, `users.unshift(...)` injects `{ username: bootstrap, roles: [], last_seen: null, is_bootstrap: true }`. This handles fresh deployments where the bootstrap admin has never logged in and has no explicit user_roles row.

### Task 2: SAFE-V18-01 Last-Admin Guard

Inserted before the `DELETE FROM user_roles` statement in the DELETE handler:

- Only engages when `roleName === "admin"` AND the target currently holds admin (via `SELECT 1 ... WHERE username = lower(?) AND role_id = ?`).
- Counts non-bootstrap admin holders: `COUNT(*) WHERE role_id = adminRoleId AND username != lower(bootstrapUsername)`.
- If `remaining <= 1`, returns HTTP 400 with the verbatim locked error string.
- Bootstrap admin is excluded from the count regardless of whether it has an explicit `user_roles` row.
- Non-admin role revokes, targets without admin, and cases where two+ non-bootstrap admins exist all pass through to the existing DELETE.

## Verification

- `npm run test:server -- routes.management.spec` — 33/33 pass (25 pre-existing + 3 new GET cases + 5 new SAFE-V18-01 cases)
- `npm run build:server` — clean TypeScript compilation, no type errors
- All acceptance criteria grep checks passed

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

Files confirmed present:
- `packages/server/src/index.ts` — FOUND
- `packages/server/tests/routes.management.spec.ts` — FOUND

Commits confirmed:
- b81c5a2 (TDD RED Task 1) — FOUND
- 8be999d (TDD GREEN Task 1) — FOUND
- b2b292c (TDD RED Task 2) — FOUND
- 59d2856 (TDD GREEN Task 2) — FOUND
