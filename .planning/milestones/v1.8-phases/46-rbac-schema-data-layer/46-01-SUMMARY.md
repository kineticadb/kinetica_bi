---
phase: 46-rbac-schema-data-layer
plan: 01
subsystem: auth
tags: [rbac, permissions, typescript, vitest]

# Dependency graph
requires: []
provides:
  - Canonical 15-permission PERMISSIONS const with noun:verb strings
  - ALL_PERMISSIONS flat array for admin bootstrap short-circuit
  - BUILTIN_ROLES tuple (admin/user_admin/designer/analyst, stable order)
  - Permission and BuiltinRole TypeScript types
  - DEFAULT_ROLE_MAPPINGS with locked per-role default sets (admin 15 / designer 8 / user_admin 6 / analyst 1)
affects:
  - 46-02 (rbacSeed.ts imports BUILTIN_ROLES + DEFAULT_ROLE_MAPPINGS)
  - 46-03 (rbacDb.ts imports ALL_PERMISSIONS for admin bootstrap)
  - 47-server-middleware (requirePermission imports PERMISSIONS constants)
  - 48-frontend-store (useAuthStore.hasPermission imports PERMISSIONS)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Pure-constants lib module (no imports, named exports only, no default export, mirrors viewNaming.ts style)
    - Independent spec lock (hardcode expected strings in test, never derive from source — catches typos)
    - TDD RED-GREEN for each task

key-files:
  created:
    - packages/server/src/lib/permissions.ts
    - packages/server/tests/lib.permissions.spec.ts
  modified: []

key-decisions:
  - "PERMISSIONS uses SCREAMING_SNAKE_CASE keys with noun:verb string values; as const for full type inference"
  - "ALL_PERMISSIONS = Object.values(PERMISSIONS) — downstream admin short-circuit uses new Set(ALL_PERMISSIONS)"
  - "DEFAULT_ROLE_MAPPINGS references PERMISSIONS.* keys (not raw strings) so catalog renames are caught at compile time"
  - "roles:delete_custom maps to admin only by default; user_admin is explicitly denied this"
  - "user_admin has exactly 6 permissions: 5 management + dashboards:view; no write-dashboard or design permissions"
  - "analyst has exactly 1 permission: dashboards:view; all filter/drill-down interaction is ungated by design"

patterns-established:
  - "Permission catalog module: zero runtime side effects, no imports, no default export"
  - "Spec independence: hardcode expected permission strings in test file, never import from source under test"

requirements-completed: [SCHEMA-V18-01]

# Metrics
duration: 2min
completed: 2026-06-05
---

# Phase 46 Plan 01: RBAC Permission Catalog Summary

**Code-defined 15-permission RBAC catalog with locked built-in role mappings (admin 15 / designer 8 / user_admin 6 / analyst 1) as the single source-of-truth TypeScript module**

## Performance

- **Duration:** 2 min
- **Started:** 2026-06-05T14:25:08Z
- **Completed:** 2026-06-05T14:27:25Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created `packages/server/src/lib/permissions.ts` as a pure-constants module exporting the canonical 15-permission catalog, ALL_PERMISSIONS array, BUILTIN_ROLES tuple, Permission + BuiltinRole types, and DEFAULT_ROLE_MAPPINGS
- Spec independently hardcodes all 15 expected strings (catches source typos), four default permission sets, and the delete_custom-admin-only invariant — 14 tests, all passing
- TypeScript clean: all PERMISSIONS.* references in DEFAULT_ROLE_MAPPINGS typecheck against the Permission union

## Task Commits

Each task was committed atomically:

1. **Task 1+2: Define PERMISSIONS catalog + ALL_PERMISSIONS + BUILTIN_ROLES + DEFAULT_ROLE_MAPPINGS** - `9597eab` (feat)

_Note: Both tasks modify the same two files; combined into a single atomic commit since implementation was complete before the first commit was made._

## Files Created/Modified
- `packages/server/src/lib/permissions.ts` - Canonical RBAC permission catalog: PERMISSIONS (15 entries), ALL_PERMISSIONS, BUILTIN_ROLES, Permission type, BuiltinRole type, DEFAULT_ROLE_MAPPINGS
- `packages/server/tests/lib.permissions.spec.ts` - Independent spec locking all 15 strings, role order, and four default role mappings (14 tests)

## Decisions Made
- Referenced `PERMISSIONS.*` keys in DEFAULT_ROLE_MAPPINGS (not raw strings) so TypeScript catches any catalog rename at compile time
- `ALL_PERMISSIONS` is `Object.values(PERMISSIONS)` — simplest derivation, guaranteed no omissions
- Module follows `lib/viewNaming.ts` style: file-level JSDoc comment, named exports only, no default export, no runtime side effects

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None - `grep -c '": "'` acceptance criterion referenced JSON key format but PERMISSIONS uses unquoted TypeScript object keys; verified 15 entries via `grep -c '"[a-z_]*:[a-z_]*"'` instead. All 14 tests pass, tsc clean.

## Next Phase Readiness
- Plan 46-02 (rbacSeed.ts) can import `BUILTIN_ROLES`, `DEFAULT_ROLE_MAPPINGS`
- Plan 46-03 (rbacDb.ts) can import `ALL_PERMISSIONS` for the bootstrap admin short-circuit
- Phase 47 (requirePermission) and Phase 48 (useAuthStore.hasPermission) can import `PERMISSIONS` constants to prevent string drift

## Self-Check: PASSED

- `packages/server/src/lib/permissions.ts`: FOUND
- `packages/server/tests/lib.permissions.spec.ts`: FOUND
- Commit `9597eab`: FOUND
- 14/14 tests pass
- tsc: CLEAN (0 errors)

---
*Phase: 46-rbac-schema-data-layer*
*Completed: 2026-06-05*
