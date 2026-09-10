---
phase: 47-server-middleware-route-guards
plan: 02
subsystem: api
tags: [express, rbac, middleware, permissions, better-sqlite3, supertest, vitest]

# Dependency graph
requires:
  - phase: 47-01
    provides: createAdminSession() helper + datasets:manage 16th permission + test migration
  - phase: 46-rbac-schema-data-layer
    provides: getEffectivePermissions + Permission type + PERMISSIONS catalog + rbacDb

provides:
  - requirePermission(permission) factory in packages/server/src/rbac.ts
  - RequestHandler[] return type forces ...spread usage at call sites
  - 5-test deterministic spec (routes.rbac.spec.ts) proving denial/pass/log behavior

affects:
  - 47-03 (wires requirePermission across 22 mutation routes in index.ts)
  - phase 48 (hasPermission frontend gate imports same PERMISSIONS catalog)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - requirePermission returns RequestHandler[] — callers must ...spread (Plan 03 relies on this)
    - OBS-01 denial log shape: { ts, level:"warn", event:"permission_denied", username, route, method, permission, outcome:"denied" }
    - 403 body: { error, code:"PERMISSION_DENIED", permission } — mirrors REAUTH_REQUIRED pattern from auth.ts
    - throwaway Express test app for factory isolation (avoids createApp() OIDC surface)

key-files:
  created:
    - packages/server/src/rbac.ts
    - packages/server/tests/routes.rbac.spec.ts
  modified: []

key-decisions:
  - "requirePermission returns RequestHandler[] (not a single handler) — forces ...spread at call sites; TypeScript will error if caller omits the spread"
  - "requireAuth is element 0 in the array — req.user is always populated when rbacCheck runs; calling requireAuth twice is safe (idempotent, calls next())"
  - "getEffectivePermissions called with no conn arg (module-singleton db) — matches production; no injectable DB in middleware"
  - "Test app does NOT call createApp() — mounts express + requireAuth + gated throwaway route directly; avoids OIDC discovery and full route surface noise"
  - "Denial log emitted via console.log(JSON.stringify({...})) — same OBS-01 pattern as boot/audit logs; no new logger infrastructure"

patterns-established:
  - "Throwaway Express test app for middleware factory isolation: express() + cookieParser() + app.use('/api', requireAuth) + gated route; no createApp() needed"
  - "rbacCheck reads req.user!.creds.username (set by requireAuth element 0); never reads JWT payload directly"

requirements-completed: [GUARD-V18-01]

# Metrics
duration: 3min
completed: 2026-06-05
---

# Phase 47 Plan 02: requirePermission Factory Summary

**requirePermission(permission) factory returning RequestHandler[] with 403 PERMISSION_DENIED denial, OBS-01 structured denial log, and 5-test deterministic spec proving admin pass / holder pass / denial / denial-log / unauth-401**

## Performance

- **Duration:** 3 min
- **Started:** 2026-06-05T18:59:44Z
- **Completed:** 2026-06-05T19:02:02Z
- **Tasks:** 2 (TDD: RED commit + GREEN commit)
- **Files modified:** 2

## Accomplishments

- Created `packages/server/src/rbac.ts` exporting `requirePermission(permission): RequestHandler[]` — the single enforcement primitive Plan 03 spreads onto 22 mutation routes
- Created `packages/server/tests/routes.rbac.spec.ts` with 5 deterministic tests (admin pass, holder pass, non-holder 403, OBS-01 denial log, unauth 401)
- All 5 tests green; tsc clean; GATE 1 passes (13 failing files all within 14 known-flaky list, routes.rbac.spec.ts not among them); GATE 2 passes (0 failures on targeted `npm run test:server -- routes.rbac`)

## Task Commits

1. **Task 1 RED: routes.rbac.spec.ts with 5 tests** - `ca58584` (test)
2. **Task 2 GREEN: rbac.ts requirePermission factory** - `c8ef50a` (feat)

## Files Created/Modified

- `packages/server/src/rbac.ts` - requirePermission factory: [requireAuth, rbacCheck], 403 PERMISSION_DENIED body, OBS-01 denial log
- `packages/server/tests/routes.rbac.spec.ts` - 5-test spec: admin pass, holder pass, non-holder 403, denial log, unauth 401

## Decisions Made

- **RequestHandler[] return type** (not RequestHandler): forces callers to ...spread, which TypeScript enforces. Plan 03 relies on `...requirePermission(perm)` syntax.
- **requireAuth as element 0**: idempotent — even when global `app.use("/api", requireAuth)` is mounted, calling it again in the array just calls next() without re-checking.
- **Throwaway Express test app**: avoided createApp() to keep the spec isolated from OIDC discovery. Mounted `express() + cookieParser() + app.use("/api", requireAuth)` directly.
- **Denial log via console.log(JSON.stringify)**: mirrors existing OBS-01 boot-log pattern. No new logger or audit table infrastructure introduced.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `requirePermission` is the tested single enforcement primitive; Plan 47-03 can spread it onto all mutation routes in index.ts
- Factory's RequestHandler[] return type and the `...spread` call pattern are established and locked in by tests
- Regression gate baseline confirmed: 13 known-flaky files fail (all within the 14-file allowed set), routes.rbac.spec.ts is deterministically green

---
*Phase: 47-server-middleware-route-guards*
*Completed: 2026-06-05*
