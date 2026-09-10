---
phase: 03-auth-failure-ux-admin-credential-removal
plan: 01
subsystem: auth
tags: [express, typescript, error-middleware, vitest, supertest]

# Dependency graph
requires:
  - phase: 02-per-user-credential-passthrough-on-every-kinetica-call
    provides: KineticaAuthError, KineticaPermissionError, KineticaUpstreamError typed error classes in kineticaErrors.ts
  - phase: 01-encrypted-server-side-session-store
    provides: clearSessionCookie helper in auth.ts; requireAuth; issueSessionCookie
provides:
  - Exported errorMiddleware function with 4-arg Express signature (err, req, res, next)
  - Middleware mounted in createApp() just before the 404 handler
  - tests/errorMiddleware.spec.ts with 4 it.todo placeholders (activated in Plan 03-02) and 1 live Test 5 (non-typed Error → 500)
affects:
  - 03-02 (strips route try/catches, activates Tests 1-4)
  - 03-03 (frontend body-peek relies on 401 + code:REAUTH_REQUIRED shape this middleware emits)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Routes throw, middleware translates: typed errors bubble from kinetica.ts helper through route handlers (no try/catch) to errorMiddleware"
    - "TDD staging: RED commit (spec scaffold with it.todo placeholders) before GREEN commit (implementation)"
    - "Exported middleware for standalone test mounting: errorMiddleware exported from index.ts enables Test 5 to construct a minimal inline Express app"

key-files:
  created:
    - kinetica_bi/server/tests/errorMiddleware.spec.ts
  modified:
    - kinetica_bi/server/src/index.ts

key-decisions:
  - "errorMiddleware mounted ONCE just before the 404 handler at bottom of createApp() — pre-404 placement is the CONTEXT.md locked decision"
  - "Tests 1-4 kept as it.todo: route try/catches (Phase 2 boundary) still intercept typed errors; Plan 03-02 strips them and activates the tests"
  - "errorMiddleware exported from index.ts (not a separate module) to keep the surface small; Test 5 imports it directly for standalone mounting"
  - "middleware does NOT call deleteSession on 401-REAUTH — orphaned sessions GC'd by Phase 1 sweep within 1 hour (CONTEXT.md §401-REAUTH cookie clearing)"

patterns-established:
  - "4-arg Express error handler: (err: unknown, _req: Request, res: Response, _next: NextFunction): void"
  - "instanceof switch: KineticaAuthError → clearCookie + 401; KineticaPermissionError → 403; KineticaUpstreamError → 502; else → console.error + 500"
  - "code field only on 401: body { error, code: REAUTH_REQUIRED } for auth errors; plain { error } for 403/502/500"

requirements-completed: [UX-01, UX-02, UX-03]

# Metrics
duration: 1min
completed: 2026-04-28
---

# Phase 03 Plan 01: Error Middleware Scaffold Summary

**Express 4-arg errorMiddleware exported from index.ts, mounted pre-404, translating KineticaAuthError→401+REAUTH_REQUIRED+clearCookie, KineticaPermissionError→403, KineticaUpstreamError→502, generic Error→500**

## Performance

- **Duration:** ~1 min
- **Started:** 2026-04-28T17:02:55Z
- **Completed:** 2026-04-28T17:04:17Z
- **Tasks:** 2 (TDD: RED then GREEN)
- **Files modified:** 2

## Accomplishments

- Exported `errorMiddleware` from `kinetica_bi/server/src/index.ts` with all four translation branches
- Mounted middleware at line 445, immediately above the 404 handler (CONTEXT.md locked decision)
- Created `tests/errorMiddleware.spec.ts` with 4 `it.todo` placeholders (Plan 03-02 activates these after stripping route try/catches) and 1 live Test 5 verifying non-typed Error → 500 + console.error
- Full suite: 206 passing tests (205 Phase 1+2 baseline + Test 5), 4 todo, 0 failed
- TypeScript build clean

## Exact middleware function body (for Plan 03-02 reference)

```typescript
export const errorMiddleware = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  if (err instanceof KineticaAuthError) {
    clearSessionCookie(res);
    res.status(401).json({ error: err.message, code: "REAUTH_REQUIRED" });
    return;
  }
  if (err instanceof KineticaPermissionError) {
    res.status(403).json({ error: err.message });
    return;
  }
  if (err instanceof KineticaUpstreamError) {
    res.status(502).json({ error: err.message });
    return;
  }
  // Defensive: non-typed error — should not happen once routes are stripped (Plan 03-02).
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
};
```

## Task Commits

Each task was committed atomically:

1. **Task 1: Add errorMiddleware spec scaffold (RED)** - `0411fa4` (test)
2. **Task 2: Mount global error-handling middleware in createApp() (GREEN)** - `a805823` (feat)

**Plan metadata:** (docs commit follows)

_Note: TDD tasks have two commits (test RED → feat GREEN)_

## Files Created/Modified

- `kinetica_bi/server/tests/errorMiddleware.spec.ts` — Integration spec with 4 it.todo (typed error tests, activated in Plan 03-02) + 1 live test (non-typed Error → 500)
- `kinetica_bi/server/src/index.ts` — Exported `errorMiddleware` function + `app.use(errorMiddleware)` mount at line 445 (just before 404 handler)

## Decisions Made

1. **Tests 1-4 as it.todo:** Routes still have Phase 2 try/catches that intercept typed errors before they reach the middleware. Keeping these as todo preserves zero-failure state for Plan 03-01 while documenting the expected behavior. Plan 03-02 strips the try/catches and converts the todos to live tests.
2. **Middleware exported from index.ts:** Avoids a separate `src/errorMiddleware.ts` module. The surface is small (one function) and keeping it in index.ts follows the "inline in index.ts is fine for now" guidance from CONTEXT.md §"Claude's Discretion".
3. **No production routes modified:** This plan is purely additive. The Phase 2 try/catches remain intact, ensuring no client-facing behavior changes before Plan 03-02 intentionally strips them.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None — no unexpected issues. The EADDRINUSE errors in the test output (5 total) are pre-existing Phase 2 carryover noise, unaffected by this plan.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Plan 03-02 can now strip route try/catches one by one; as each route's catch block is removed, typed errors will bubble to `errorMiddleware` and the corresponding it.todo in `errorMiddleware.spec.ts` can be converted to a live `it(...)`.
- The middleware function body is documented above for Plan 03-02 reference.
- `kinetica_bi/server/src/index.ts` line 445 is the mount point; line 447 is the 404 handler — the middleware position is stable regardless of route additions.

---
*Phase: 03-auth-failure-ux-admin-credential-removal*
*Completed: 2026-04-28*
