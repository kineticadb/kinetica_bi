---
phase: 05-oidc-module-routes
plan: "03"
subsystem: auth
tags: [oidc, express-routes, async-createApp, buildTestApp, typescript, vitest]

# Dependency graph
requires:
  - phase: 05-oidc-module-routes
    plan: "02"
    provides: initOidcClient, buildAuthorizationUrl, exchangeCode, extractUsername, mapOidcError exports from oidc.ts

provides:
  - async createApp() returning Promise<express.Express> with AUTH_MODE const captured once at boot
  - GET /api/auth/config unauthenticated route returning {authMode} with Cache-Control: no-store
  - GET /api/auth/oidc/start setting oidc_state httpOnly cookie and 302-redirecting to IdP in oidc mode (400 in password mode)
  - GET /api/auth/oidc/callback clearing oidc_state unconditionally, mapping all errors to friendly codes, creating session with credentialType='oidc' on success
  - POST /api/auth/login returning 400 before any kinetica work when AUTH_MODE=oidc (MODE-01)
  - Async bootstrap IIFE satisfying bootstrap.spec.ts regex test
  - Async buildTestApp() helper + all 7 existing spec files awaiting the call

affects:
  - 05-04 (route tests for new OIDC routes can now be written against async-aware infrastructure)
  - 06-* (requireAuth + Phase 6 use same createApp async pattern)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - authMode const captured once at createApp() top — NEVER per-route (ARCHITECTURE AP-5)
    - oidcConfig closure captures OidcConfig for callback handler at boot (avoids re-read)
    - Cookie cleared unconditionally via res.clearCookie before any callback logic
    - timingSafeEqual with length pre-check before calling (prevents throws on length mismatch)
    - try/catch around exchangeCode only — IdP error and state mismatch handled before exchange call
    - Async IIFE bootstrap pattern — process.exit(1) on createApp() rejection (fail-fast)
    - async buildTestApp() returns Promise<SuperTest> — callers await

key-files:
  created: []
  modified:
    - kinetica_bi/server/src/index.ts
    - kinetica_bi/server/tests/helpers/app.ts
    - kinetica_bi/server/tests/auth.routes.spec.ts
    - kinetica_bi/server/tests/errorMiddleware.spec.ts
    - kinetica_bi/server/tests/routes.discovery.spec.ts
    - kinetica_bi/server/tests/routes.materialize.spec.ts
    - kinetica_bi/server/tests/routes.sql.spec.ts
    - kinetica_bi/server/tests/routes.wms.spec.ts

key-decisions:
  - "createApp() made async returning Promise<express.Express> — required for await initOidcClient() boot-time fail-fast (Phase 5 SC6)"
  - "AUTH_MODE read once at createApp() top as const authMode — all three new routes and login gate close over this const; ARCHITECTURE AP-5 confirmed via awk route-body scan"
  - "oidcConfig captured as closure variable from validateOidcEnv() return — callback handler uses it for extractUsername without re-reading env or module singleton"
  - "Bootstrap gate converted to async IIFE containing app.listen + startSessionSweep() — satisfies existing bootstrap.spec.ts regex test unchanged"
  - "process.env.AUTH_MODE appears exactly twice in src/index.ts code: (1) canonical const authMode capture, (2) error-message interpolation in invalid-AUTH_MODE throw — both at boot before any route is mounted"
  - "All 7 test spec files updated atomically with async cascade; auth.cookie.spec.ts and auth.requireAuth.spec.ts have no buildTestApp() calls and require no changes"

patterns-established:
  - "Friendly code mapping: idpError=access_denied before exchange → oidc_denied; state mismatch → oidc_invalid; exchangeCode OPError → mapOidcError(); success → session with credentialType='oidc'"
  - "oidc_state cookie cleared before any redirect/response so every callback exit (success + all 4 error paths) leaves no lingering cookie"
  - "KINETICA_URL null-guarded in callback success path — redirects to oidc_invalid if missing"

requirements-completed: [OIDC-02, OIDC-03, OIDC-04, OIDC-05, OIDC-06, OIDC-07, OIDC-08, MODE-01]

# Metrics
duration: 11min
completed: 2026-05-01
---

# Phase 5 Plan 03: OIDC Module + Routes — Express Wiring Summary

**Async createApp() with OIDC boot init + 3 new routes (config, start, callback) + login mode gate; async buildTestApp() cascade updating all 7 existing spec files; tsc clean; 251 tests pass**

## Performance

- **Duration:** ~11 min
- **Started:** 2026-05-01T14:01:22Z
- **Completed:** 2026-05-01T14:12:00Z
- **Tasks:** 2
- **Files modified:** 9 (1 src + 1 test helper + 7 spec files)

## Accomplishments

- Converted createApp() from sync to `async (): Promise<express.Express>` — enables await initOidcClient() at boot
- AUTH_MODE const captured once at createApp() top; ARCHITECTURE AP-5 verified by awk route-body scan (no per-route reads)
- validateOidcEnv() + initOidcClient() called at boot in oidc mode; createApp() rejects on failure (Phase 5 SC6 fail-fast)
- Boot log emits issuer URL + redirect_uri + Kinetica trust advisory (PITFALLS O-03 operator verification)
- GET /api/auth/config returns {authMode} with Cache-Control: no-store, mounted before requireAuth (unauthenticated)
- GET /api/auth/oidc/start generates cryptographically random state+nonce via randomBytes(32).toString('base64url'), sets oidc_state httpOnly cookie, 302-redirects to buildAuthorizationUrl(); returns 400 in password mode
- GET /api/auth/oidc/callback uses asyncHandler, clears oidc_state cookie unconditionally on every exit, maps all error branches to friendly codes (oidc_denied / oidc_invalid / oidc_token_invalid / oidc_no_username), creates session with credentialType='oidc' + idToken on success
- timingSafeEqual with length pre-check (PITFALLS C-02 + RESEARCH Pitfall 6: prevents throw on length mismatch)
- POST /api/auth/login returns 400 at handler line 1 in oidc mode (MODE-01) — Kinetica never called
- Bootstrap gate converted to async IIFE containing app.listen + startSessionSweep() — bootstrap.spec.ts regex still passes
- buildTestApp() made async; all 7 spec files updated with awaited calls (0 un-awaited callsites remain)
- Full vitest suite: 251 passed, 1 skipped, 0 failed; tsc --noEmit clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Make createApp async, wire OIDC boot init + 3 new routes + login gate, fix bootstrap gate** — `04f0559` (feat)
2. **Task 2: Make buildTestApp async; update every existing buildTestApp callsite to await** — `feddf49` (feat)

## Files Created/Modified

- `kinetica_bi/server/src/index.ts` — async createApp() with authMode const, OIDC boot block, 3 new routes before requireAuth, login gate, async IIFE bootstrap; imports from node:crypto + ./oidc
- `kinetica_bi/server/tests/helpers/app.ts` — buildTestApp now async, awaits createApp()
- `kinetica_bi/server/tests/auth.routes.spec.ts` — 7 callsites: `const agent = await buildTestApp()`
- `kinetica_bi/server/tests/errorMiddleware.spec.ts` — 4 callsites: `const app = await buildTestApp()`
- `kinetica_bi/server/tests/routes.discovery.spec.ts` — 12 callsites: `const app = await buildTestApp()`
- `kinetica_bi/server/tests/routes.materialize.spec.ts` — 13 callsites: chained patterns converted to `const agent = await buildTestApp()` + separate await chain
- `kinetica_bi/server/tests/routes.sql.spec.ts` — 9 callsites: `const app = await buildTestApp()`
- `kinetica_bi/server/tests/routes.wms.spec.ts` — 7 callsites including chained patterns converted to `const agent = await buildTestApp()`

## Decisions Made

**createApp() async upgrade approach:** Made createApp() return `Promise<express.Express>` rather than using a fire-and-forget discovery pattern. This keeps the fail-fast behavior locked by Phase 5 SC6 — if discovery fails, the Promise rejects, the async IIFE catches it, and process.exit(1) is called before app.listen is ever reached.

**authMode closure pattern:** authMode const is captured at createApp() top. All three new routes and the login gate close over this const. The oidcConfig variable is also captured as a closure for the callback handler (used for extractUsername without touching module singletons from inside the route). This preserves ARCHITECTURE AP-5.

**process.env.AUTH_MODE count is 3 in raw grep, 2 in code:** The third occurrence is in a comment explaining why there are two. Both code occurrences are at boot inside createApp() before any route is mounted: (1) `const authMode = (process.env.AUTH_MODE || "password")` and (2) the error-message interpolation `got: ${process.env.AUTH_MODE}`. The AP-5 route-body awk scan confirms no route handlers read it directly.

**buildTestApp callsite count:** auth.cookie.spec.ts and auth.requireAuth.spec.ts have no buildTestApp() calls at all — they test auth primitives directly with shims. Only 7 spec files needed updating.

## Friendly Code → Handler Branch Mapping (for Plan 05-04 test author reference)

| Trigger | Code Path | Friendly Code |
|---------|-----------|---------------|
| IdP `?error=access_denied` in query | Pre-exchange idpError check | `oidc_denied` |
| IdP `?error=<other>` in query | Pre-exchange idpError check | `oidc_invalid` |
| Missing code / state / cookie | Pre-exchange null check | `oidc_invalid` |
| State mismatch (timing-safe) | Pre-exchange timingSafeEqual | `oidc_invalid` |
| exchangeCode OPError(access_denied) | mapOidcError() | `oidc_denied` |
| exchangeCode OPError(other) | mapOidcError() | `oidc_invalid` |
| exchangeCode RPError (sig/nonce/aud/iss/exp) | mapOidcError() | `oidc_token_invalid` |
| exchangeCode generic Error (network) | mapOidcError() | `oidc_invalid` |
| extractUsername returns null | Post-exchange username check | `oidc_no_username` |
| KINETICA_URL missing at callback | Defensive guard | `oidc_invalid` |
| Success | Session created + redirect to / | — (302 /) |

oidcConfig imported via oidc.ts: `from "./oidc"`. sessionStore.ts does NOT import oidc.ts (ARCHITECTURE AP-2 preserved).

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required for this plan.

## Next Phase Readiness

- Plan 05-04 can now write route-level tests for GET /api/auth/config, GET /api/auth/oidc/start, GET /api/auth/oidc/callback, POST /api/auth/login (oidc mode) against the async-aware infrastructure
- The friendly code → handler branch mapping table above is the reference for 05-04 test assertions
- All PITFALLS guards (C-02 timingSafeEqual + length check, C-07 redirect_uri pinned, T-02 id_token claims only, T-05 opaque token warning, T-03 empty username) are implemented in the callback handler
- No blockers

---

## Self-Check

Verifying claims before state updates.

*Phase: 05-oidc-module-routes*
*Completed: 2026-05-01*
