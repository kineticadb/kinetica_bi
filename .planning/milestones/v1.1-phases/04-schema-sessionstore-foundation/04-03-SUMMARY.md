---
phase: 04-schema-sessionstore-foundation
plan: "03"
subsystem: auth
tags: [auth, typescript, express, sessions, oidc, requireAuth]

# Dependency graph
requires:
  - phase: 04-schema-sessionstore-foundation
    plan: "02"
    provides: SessionRow with secret/credentialType/idToken, options-object createSession signature
provides:
  - AuthedRequest type with credentialType at top level + creds.password + creds.token (always-string)
  - requireAuth step-10 reads session.secret + session.credentialType to populate req.user
  - index.ts:102 createSession callsite migrated to options-object form
  - Full server package compiles with zero TypeScript errors against new SessionRow API
  - All 18 test files pass (215 passing, 1 skipped)
affects:
  - Phase 5 OIDC routes (createSession with credentialType: 'oidc' + idToken compiles immediately)
  - Phase 6 buildAuthHeader (branches on req.user.credentialType to select Basic vs Bearer)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Flat AuthedRequest.user shape with credentialType at top level (not inside creds)
    - Dual creds.password/creds.token always-string fields (mutually empty strings, never undefined)
    - Ternary on session.credentialType to populate creds fields in requireAuth step-10

key-files:
  created: []
  modified:
    - kinetica_bi/server/src/auth.ts
    - kinetica_bi/server/src/index.ts
    - kinetica_bi/server/tests/auth.requireAuth.spec.ts
    - kinetica_bi/server/tests/auth.cookie.spec.ts
    - kinetica_bi/server/tests/routes.sql.spec.ts
    - kinetica_bi/server/tests/routes.wms.spec.ts
    - kinetica_bi/server/tests/routes.materialize.spec.ts
    - kinetica_bi/server/tests/routes.discovery.spec.ts
    - kinetica_bi/server/tests/errorMiddleware.spec.ts

key-decisions:
  - "AuthedRequest.user is flat shape (credentialType at top level, not inside creds) per ARCHITECTURE.md recommendation — avoids null-guard noise in Phase 6 buildAuthHeader"
  - "creds.password and creds.token are always-string, never undefined — empty string in inactive mode (not discriminated union)"
  - "JWT cookie v: 1 field unchanged (PITFALLS I-05) — credentialType discriminant lives in session row, not JWT payload"
  - "In Phase 4 runtime, all sessions are credentialType='password' — OIDC branch in step-10 ternary is exercised only at type level"

patterns-established:
  - "requireAuth step-10 ternary: creds.password = credentialType === 'password' ? secret : ''; creds.token = credentialType === 'oidc' ? secret : ''"
  - "Consumer test helpers (makeSessionCookie) use options-object createSession form throughout all test specs"

requirements-completed: [MODE-02, MODE-03, MODE-06]

# Metrics
duration: 3min
completed: 2026-04-30
---

# Phase 4 Plan 03: AuthedRequest Extension Summary

**AuthedRequest extended with flat credentialType + dual creds.password/creds.token (always-string), requireAuth step-10 migrated to session.secret + session.credentialType, closing the type loop across the entire server package with zero TypeScript errors and all 215 tests passing**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-30T15:29:28Z
- **Completed:** 2026-04-30T15:32:45Z
- **Tasks:** 3 (+ 1 deviation fix)
- **Files modified:** 9

## Accomplishments

- Extended `AuthedRequest.user` type in auth.ts: added `credentialType: "password" | "oidc"` at the top level, added `token: string` alongside `password: string` in creds (all always-string, never undefined per ARCHITECTURE.md flat-shape decision)
- Updated requireAuth step-10 to read `session.secret` (not the removed `session.password`) and `session.credentialType`, populating req.user via ternary on credential type — JWT v: 1 cookie invariant preserved (PITFALLS I-05)
- Migrated `index.ts:102` from `createSession(username, password, kineticaUrl)` positional form to `createSession({ username, secret: password, kineticaUrl })` options-object form
- Updated `auth.requireAuth.spec.ts`: all 6 positional createSession calls converted to options-object form; Step 10 success assertions strengthened with `credentialType === "password"` and `creds.token === ""` assertions; 11 tests pass
- Zero TypeScript errors: `npx tsc --noEmit` exits clean across the full server package
- Full test suite: 18 test files, 215 passing, 1 skipped

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend AuthedRequest type + update requireAuth step-10 in auth.ts** — `f1f611d` (feat)
2. **Task 2: Migrate index.ts createSession callsite to options-object form** — `ee775ee` (feat)
3. **Task 3: Update auth.requireAuth.spec.ts** — `ce9f489` (test)
4. **Deviation fix: Convert remaining positional createSession calls in all test files** — `45009f2` (fix)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `kinetica_bi/server/src/auth.ts` — Extended AuthedRequest type + updated requireAuth step-10
- `kinetica_bi/server/src/index.ts` — Migrated createSession callsite to options-object form
- `kinetica_bi/server/tests/auth.requireAuth.spec.ts` — Options-object calls + new shape assertions
- `kinetica_bi/server/tests/auth.cookie.spec.ts` — Options-object createSession call
- `kinetica_bi/server/tests/routes.sql.spec.ts` — Options-object createSession in makeSessionCookie
- `kinetica_bi/server/tests/routes.wms.spec.ts` — Options-object createSession in makeSessionCookie
- `kinetica_bi/server/tests/routes.materialize.spec.ts` — Options-object createSession in makeSessionCookie
- `kinetica_bi/server/tests/routes.discovery.spec.ts` — Options-object createSession in makeSessionCookie
- `kinetica_bi/server/tests/errorMiddleware.spec.ts` — Options-object createSession in makeSessionCookie

## Decisions Made

- Flat AuthedRequest.user shape (credentialType at top level, not inside creds) per ARCHITECTURE.md — avoids null-guard noise in Phase 6 buildAuthHeader which branches on req.user.credentialType
- Both creds.password and creds.token are always-string (mutually empty strings, never undefined) — symmetric with the no-null-guard-noise principle
- JWT cookie v: 1 field left unchanged throughout (PITFALLS I-05): credentialType lives in the session row, never in the JWT payload. Step 3 test in auth.requireAuth.spec.ts confirms this invariant.
- In Phase 4 runtime, all sessions are credentialType='password' — the OIDC branch in step-10's ternary is exercised only at the TypeScript type level; runtime tests for the OIDC branch belong in Phase 5/6

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Converted positional createSession calls in 6 additional test files**
- **Found during:** Cross-cutting verification (after Task 3 commit)
- **Issue:** Plan 04-02 changed createSession to an options-object signature. auth.requireAuth.spec.ts was updated in Task 3, but 6 other test files (auth.cookie, routes.sql, routes.wms, routes.materialize, routes.discovery, errorMiddleware) still used the positional 3-argument form — causing 49 test failures at runtime
- **Fix:** Updated makeSessionCookie helpers in all 6 files to use `createSession({ username, secret: SESSION_PASSWORD, kineticaUrl: KINETICA_URL })` options-object form
- **Files modified:** auth.cookie.spec.ts, routes.sql.spec.ts, routes.wms.spec.ts, routes.materialize.spec.ts, routes.discovery.spec.ts, errorMiddleware.spec.ts
- **Verification:** Full vitest run: 18 test files, 215 passing, 1 skipped
- **Committed in:** `45009f2` (separate fix commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 — blocking issue)
**Impact on plan:** Blocking issue in 6 test files — all required the same mechanical rename of createSession helper calls. No behavior changes, no scope creep.

## Issues Encountered

None — the test file fixes were expected consequences of the options-object signature change in Plan 04-02 (the Plan 04-02 SUMMARY noted that tsc errors in auth.ts and index.ts were expected and intentional; the test file fixes are the downstream mechanical completion of that rename).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**Phase 4 is complete.** The session schema can hold both password and OIDC credentials without ambiguity; all downstream code compiles against the new types.

- **Phase 5 (OIDC routes)**: Can now call `createSession({ ..., credentialType: 'oidc', idToken })` with the fully typed API. `AuthedRequest.user.credentialType` will be `'oidc'` for OIDC sessions — Phase 5 routes can read it.
- **Phase 6 (buildAuthHeader)**: Can branch cleanly on `req.user.credentialType === 'password' ? req.user.creds.password : req.user.creds.token` — no null-guard noise.
- **v1.0 behavior preserved**: Login flow is byte-identical from the user's perspective. requireAuth populates the same data (just under updated field names). auth.routes.spec.ts passes unchanged.

---
*Phase: 04-schema-sessionstore-foundation*
*Completed: 2026-04-30*
