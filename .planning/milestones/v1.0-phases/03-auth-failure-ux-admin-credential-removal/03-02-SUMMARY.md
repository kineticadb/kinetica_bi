---
phase: 03-auth-failure-ux-admin-credential-removal
plan: 02
subsystem: auth
tags: [express, typescript, error-middleware, vitest, supertest, async-handler]

# Dependency graph
requires:
  - phase: 03-auth-failure-ux-admin-credential-removal
    plan: 01
    provides: errorMiddleware exported from index.ts, mounted pre-404 in createApp()
provides:
  - asyncHandler file-local helper in createApp() for zero-dep async error forwarding
  - 5 Kinetica-touching routes stripped of per-route try/catch (POST /api/sql, GET /api/kinetica/schemas, GET /api/kinetica/schemas/:schema/tables, GET /api/kinetica/schemas/:schema/tables/:table/columns, GET /api/wms)
  - POST /api/views/:id/materialize keeps try/catch; forwards via next(err) after updateViewStatus side effect
  - Tests 1-4 in errorMiddleware.spec.ts live (was it.todo); all 5 tests pass
  - Full suite: 210 passing, 0 failed, 0 todo
affects:
  - 03-03 (frontend body-peek can rely on backend 401+REAUTH_REQUIRED/403/502 from middleware)
  - 03-05 (requireConfig narrowing — asyncHandler signature documented here)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "asyncHandler file-local helper: wraps async route fn in Promise.resolve(...).catch(next) — Express 4 does not auto-forward async throws to error middleware"
    - "Routes throw, middleware translates: all Kinetica-touching routes (except materialize) are plain async functions with no try/catch; errors bubble via asyncHandler to errorMiddleware"
    - "Materialize exception pattern: try { await helper; updateViewStatus('created'); } catch (err) { updateViewStatus(id, 'error', err.message); return next(err); } — side effect before forward"
    - "FetchResponse alias in errorMiddleware.spec.ts: saves globalThis.Response before Express Response type import shadows it in module scope"

key-files:
  modified:
    - kinetica_bi/server/src/index.ts
    - kinetica_bi/server/tests/errorMiddleware.spec.ts
    - kinetica_bi/server/tests/routes.sql.spec.ts
    - kinetica_bi/server/tests/routes.discovery.spec.ts
    - kinetica_bi/server/tests/routes.wms.spec.ts
    - kinetica_bi/server/tests/routes.materialize.spec.ts
  created:
    - .gitignore

key-decisions:
  - "asyncHandler Option A chosen (file-local helper) over Option B (express-async-errors package) — zero new deps, easy to grep/audit per CONTEXT.md interface note"
  - "FetchResponse alias added to errorMiddleware.spec.ts — Express `Response` type import shadowed the global Fetch API `Response` constructor; `const FetchResponse = globalThis.Response` resolves the shadowing without changing other test files"
  - "materialize catch: discriminates typed vs non-typed errors for updateViewStatus message quality; non-typed errors get generic 'Failed to materialize view' message; both paths call next(err) for middleware to translate"
  - ".gitignore created at repo root — no root .gitignore existed; dist/ and node_modules/ were untracked build artifacts"

patterns-established:
  - "asyncHandler signature: <T extends Request = Request>(fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>) => (req, res, next): void — Plan 03-05 requireConfig narrowing must preserve this helper"
  - "materialize next(err) pattern is intentional and must not be refactored into errorMiddleware — the middleware has no knowledge of which view to update"

requirements-completed: [UX-01, UX-02, UX-03]

# Metrics
duration: 6min
completed: 2026-04-28
---

# Phase 03 Plan 02: Route Try/Catch Strip + Middleware Activation Summary

**asyncHandler file-local helper wraps 5 Kinetica routes to bubble typed errors to errorMiddleware; materialize keeps try/catch for updateViewStatus side effect then next(err); Tests 1-4 activated; 210 passing**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-04-28T17:07:07Z
- **Completed:** 2026-04-28T17:13:38Z
- **Tasks:** 2 (TDD: RED then GREEN)
- **Files modified:** 7 (6 test/source + 1 new .gitignore)

## Accomplishments

- Added `asyncHandler` file-local helper at top of `createApp()` body, after `requireConfig` declaration
- Stripped try/catch from all 5 non-materialize Kinetica routes (sql, 3 discovery, wms); each now wrapped with `asyncHandler(...)`
- Updated materialize route: kept try/catch for `updateViewStatus(id, "error", ...)` side effect; replaced `return res.status(502).json(...)` with `return next(err)` in both the typed and defensive catch branches
- Converted 4 `it.todo` placeholders in `errorMiddleware.spec.ts` to live tests (Tests 1-4)
- Updated all negative-path tests across 4 route spec files: 401→401+REAUTH_REQUIRED, 403→403 (no code field), 5xx/network→502 (no code field)
- All materialize persistence assertions (`expect(persisted?.status).toBe("error")`) preserved and passing
- Full suite: 210 passing, 0 failed, 0 todo (up from 206 + 4 todo in Phase 2 baseline)
- TypeScript build clean

## asyncHandler Helper Signature (for Plan 03-05 reference)

```typescript
const asyncHandler =
  <T extends Request = Request>(
    fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>
  ) =>
  (req: T, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
```

**Location:** Inside `createApp()`, immediately after the `requireConfig` declaration.

**Plan 03-05 note:** When narrowing `requireConfig` to check only `KINETICA_URL`, the `asyncHandler` helper definition must remain immediately after it. Do not accidentally remove it as part of the narrowing edit.

## Materialize next(err) Pattern (do not refactor into middleware)

```typescript
app.post("/api/views/:id/materialize", requireConfig, asyncHandler(async (req, res, next) => {
  // ... setup code ...
  try {
    await kineticaSqlHelper(req as AuthedRequest, ddl, { ... });
    const updated = updateViewStatus(id, "created");
    return res.json({ view: updated, ddl });
  } catch (err) {
    // PRESERVE: persist view status="error" before forwarding to middleware.
    if (err instanceof KineticaAuthError || err instanceof KineticaPermissionError || err instanceof KineticaUpstreamError) {
      updateViewStatus(id, "error", err.message);
    } else {
      updateViewStatus(id, "error", "Failed to materialize view");
    }
    return next(err);
  }
}));
```

**Why this must stay in the route:** The middleware receives `(err, req, res, next)` but has no knowledge of which view ID to update. The side effect (`updateViewStatus`) requires `id` from route params, which is in scope only in the route handler. Do not attempt to pass view context through the error object to the middleware.

## FetchResponse Alias (errorMiddleware.spec.ts)

```typescript
// Near top of errorMiddleware.spec.ts, after the Express import that shadows Response:
const FetchResponse = globalThis.Response;
```

The file imports `Response` from `"express"` (Express's response interface type), which shadows the global Fetch API `Response` constructor in the module scope. Tests 1-4 use `new FetchResponse(...)` to construct mock HTTP responses. Other spec files don't import `Response` from express directly, so they use `new Response(...)` without issue.

## Test Count Delta

| State | Tests |
|-------|-------|
| Phase 2 baseline | 205 passing |
| Phase 2 baseline + Plan 03-01 Test 5 | 206 passing + 4 todo |
| Phase 2 baseline + Plan 03-01 Test 5 + Plan 03-02 Tests 1-4 | 210 passing, 0 todo |

Net delta from Phase 2 baseline: +5 tests (Test 5 from 03-01, Tests 1-4 from 03-02).

## Task Commits

Each task was committed atomically:

1. **Task 1: Update route specs for Phase 3 middleware contract (RED)** - `c9c8285` (test)
2. **Task 2: Strip route try/catches; activate errorMiddleware Tests 1-4 (GREEN)** - `8665ae6` (feat)

_Note: TDD tasks have two commits (test RED → feat GREEN)_

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Express `Response` type shadows Fetch API `Response` constructor in errorMiddleware.spec.ts**

- **Found during:** Task 2 GREEN verification
- **Issue:** `errorMiddleware.spec.ts` imports `{ Response }` from `"express"` (the Express response interface type). This shadows the global `Response` (Fetch API constructor) in the module scope. Tests 1-4 needed `new Response(...)` to construct mock HTTP responses — this threw `TypeError: Response is not a constructor`.
- **Fix:** Added `const FetchResponse = globalThis.Response;` immediately after the imports (before the shadowing takes effect at runtime) and updated Tests 1-4 to use `new FetchResponse(...)`.
- **Files modified:** `kinetica_bi/server/tests/errorMiddleware.spec.ts`
- **Commit:** `8665ae6`

**2. [Rule 2 - Missing] No root .gitignore existed**

- **Found during:** Task 2 post-commit check
- **Issue:** `git status` showed `kinetica_bi/server/dist/` as untracked after the TypeScript build. No `.gitignore` at the repo root or in `kinetica_bi/server/`.
- **Fix:** Created `.gitignore` at repo root excluding `node_modules/`, `dist/`, `*.db-shm`, `*.db-wal`, `.env`, `.vite/`.
- **Files created:** `.gitignore`
- **Commit:** `8665ae6`

## Self-Check: PASSED

- kinetica_bi/server/src/index.ts: FOUND
- kinetica_bi/server/tests/errorMiddleware.spec.ts: FOUND
- .planning/phases/03-auth-failure-ux-admin-credential-removal/03-02-SUMMARY.md: FOUND
- Commit c9c8285 (test RED): FOUND
- Commit 8665ae6 (feat GREEN): FOUND
