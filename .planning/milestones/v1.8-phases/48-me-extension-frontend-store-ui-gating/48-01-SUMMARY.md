---
phase: 48-me-extension-frontend-store-ui-gating
plan: 01
subsystem: auth
tags: [rbac, permissions, zustand, typescript, vitest]

# Dependency graph
requires:
  - phase: 47-server-middleware-route-guards
    provides: getEffectiveRolesAndPermissions in rbacDb.ts, PERMISSIONS catalog, requirePermission factory
  - phase: 46-rbac-schema-data-layer
    provides: SQLite user_roles/role_permissions schema, rbacSeed.ts boot seeding

provides:
  - packages/web/src/lib/permissions.ts: 16-entry PERMISSIONS const + Permission type (client mirror)
  - packages/web/src/lib/permissions.spec.ts: byte-parity spec with independently hardcoded strings
  - /api/auth/me: now returns { user: { username, roles, permissions }, authMode }
  - useAuthStore.hasPermission(perm): reads current state via get(), never stale closure
  - useAuthStore.setPermissions(roles, permissions): in-place update, no-op when user is null
  - packages/web/src/test/seedAuthStore.ts: seedDesignerStore/seedAnalystStore/seedAdminStore helpers
  - AuthUser type widened with roles: string[] + permissions: string[]
  - fetchMe: defensive coalesce for roles/permissions (safe against un-upgraded server)

affects:
  - 48-02 (NavBar/Sidebar gating — consumes hasPermission + PERMISSIONS)
  - 48-03 (DashboardsPage gating — consumes seedDesignerStore/seedAnalystStore)
  - 48-04 (Widget/layer panels gating — consumes seedDesignerStore/seedAnalystStore)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Frontend permissions mirror: pure module with zero imports, values VERBATIM from server catalog, parity enforced by spec that independently hardcodes all strings (never derives from source under test)"
    - "hasPermission reads get().user at call time — no closed-over array — prevents stale-closure Zustand bugs"
    - "setPermissions uses functional updater: (s) => (s.user ? update : s) for safe no-op when user is null"
    - "seedAuthStore helpers must be called INSIDE beforeEach after the Zustand reset shim wipes state"

key-files:
  created:
    - packages/web/src/lib/permissions.ts
    - packages/web/src/lib/permissions.spec.ts
    - packages/web/src/test/seedAuthStore.ts
  modified:
    - packages/server/src/index.ts
    - packages/web/src/api/client.ts
    - packages/web/src/store/auth.ts
    - packages/web/src/store/auth.spec.ts
    - packages/web/src/hooks/useDynamicViewMaterializeChain.spec.ts
    - packages/web/src/App.spec.tsx

key-decisions:
  - "48-01 permissions mirror: zero imports, pure module, values copied VERBATIM from server catalog — byte-parity enforced by spec"
  - "48-01 hasPermission: uses get().user?.permissions (current state read), never a closed-over variable — Pitfall 3 avoidance"
  - "48-01 fetchMe coalesce: roles ?? [] and permissions ?? [] guards prevent crash on un-upgraded server responses"
  - "48-01 AuthUser widening: existing test fixtures updated to { username, roles: [], permissions: [] } to satisfy TypeScript strict assignment"

requirements-completed: [GATE-V18-01]

# Metrics
duration: 6min
completed: 2026-06-05
---

# Phase 48 Plan 01: /me Extension + Frontend Store + Permissions Mirror Summary

**RBAC foundation: /me returns roles+permissions, client PERMISSIONS mirror byte-parity verified, useAuthStore.hasPermission + setPermissions wired via get() for stale-closure safety**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-06-05T22:01:22Z
- **Completed:** 2026-06-05T22:07:00Z
- **Tasks:** 4
- **Files modified:** 8

## Accomplishments

- Client `PERMISSIONS` module mirrors all 16 server permission strings; byte-parity spec independently hardcodes each string to catch drift
- Server `/api/auth/me` extended to return `{ user: { username, roles, permissions }, authMode }` via `getEffectiveRolesAndPermissions`
- `useAuthStore` carries `hasPermission(perm)` (reads `get().user` for no stale closure) and `setPermissions(roles, permissions)` (safe no-op when user is null)
- `seedDesignerStore`, `seedAnalystStore`, `seedAdminStore` helpers created for Plans 03 + 04 spec migrations
- Frontend baseline maintained: 1501/1502 passing (1 known-red DashboardsPage unchanged)

## Task Commits

1. **Task 1: Create client permissions mirror module + byte-parity spec** - `cf84c97` (feat)
2. **Task 2: Extend server /me handler with roles + permissions** - `eceabe6` (feat)
3. **Task 3: Widen AuthUser/MeResponse + extend useAuthStore** - `a24e0ae` (feat)
4. **Task 4: Create seedAuthStore test helper** - `81eaa4f` (feat)
5. **Auto-fix: Update test fixtures for widened AuthUser** - `88edbea` (fix)

## Files Created/Modified

- `packages/web/src/lib/permissions.ts` - 16-entry PERMISSIONS const + Permission type; pure module, zero imports
- `packages/web/src/lib/permissions.spec.ts` - Byte-parity spec; all 16 strings independently hardcoded
- `packages/server/src/index.ts` - /me handler extended with getEffectiveRolesAndPermissions call
- `packages/web/src/api/client.ts` - AuthUser widened with roles+permissions; fetchMe defensively coalesces
- `packages/web/src/store/auth.ts` - Added hasPermission + setPermissions to AuthState; create((set, get) => ...)
- `packages/web/src/store/auth.spec.ts` - New describe("hasPermission selector + setPermissions") block (6 tests)
- `packages/web/src/test/seedAuthStore.ts` - seedDesignerStore / seedAnalystStore / seedAdminStore helpers
- `packages/web/src/hooks/useDynamicViewMaterializeChain.spec.ts` - AuthUser fixture updated
- `packages/web/src/App.spec.tsx` - AuthUser fixtures updated (2 occurrences)

## Decisions Made

- `hasPermission` uses `new Set(get().user?.permissions ?? []).has(perm)` — reads current state at call time, preventing the stale-closure Zustand pitfall documented in research
- `setPermissions` functional updater returns `s` (identity) when `user is null` — no reset chain entry needed; permissions vanish naturally when `markUnauthenticated` sets user=null
- `fetchMe` defensively coalesces `roles ?? []` and `permissions ?? []` so an un-upgraded server can't crash the consumer
- Client PERMISSIONS mirror uses zero imports (pure module) with values VERBATIM from server catalog; parity enforced by spec, not shared import, to keep client and server codebases independent

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated AuthUser test fixtures missing roles+permissions fields**
- **Found during:** TypeScript compilation check after Task 3
- **Issue:** `useDynamicViewMaterializeChain.spec.ts` and `App.spec.tsx` had `{ username: string }` objects assigned where widened `AuthUser` now requires `roles` and `permissions`. TypeScript TS2739 error.
- **Fix:** Added `roles: [], permissions: []` to the 3 affected fixture objects
- **Files modified:** `packages/web/src/hooks/useDynamicViewMaterializeChain.spec.ts`, `packages/web/src/App.spec.tsx`
- **Verification:** `npx tsc --noEmit` shows no AuthUser errors; full test suite passes
- **Committed in:** `88edbea`

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Necessary correctness fix for TypeScript strict-assignment. No scope creep.

## Issues Encountered

- `npm run test -- --run src/lib/permissions.spec.ts` failed because the test script already includes `--run`; using `npx vitest run <pattern>` directly instead.

## Next Phase Readiness

- GATE-V18-01 satisfied: `/me` returns roles+permissions; `hasPermission` works; 16-string mirror byte-parity verified
- Plans 02, 03, 04 can now consume `PERMISSIONS.*`, `hasPermission`, `setPermissions`, and the `seedAuthStore` helpers
- No blockers

---
*Phase: 48-me-extension-frontend-store-ui-gating*
*Completed: 2026-06-05*
