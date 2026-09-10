---
phase: 06-requireauth-helper-credential-branch
plan: "04"
subsystem: auth
tags: [oidc, e2e, supertest, audit, logout, integration]

# Dependency graph
requires:
  - phase: 06-01
    provides: buildAuthHeader credential-type branch in kinetica.ts (verified end-to-end here)
  - phase: 06-02
    provides: getSession proactive exp check (verified end-to-end here via past-exp test)

provides:
  - End-to-end verification of SC2 (Bearer/Basic via captured fetch headers)
  - End-to-end verification of SC3 (past-exp OIDC token never reaches Kinetica)
  - End-to-end verification of SC4 (logout symmetry across modes; no end_session_endpoint)
  - End-to-end verification of SC5 (auth_mode field on every audit log line)

affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Direct OIDC session seeding via createSession + jwt.sign — bypasses the heavy /oidc/callback flow for route-level tests"
    - "fetchMock + supertest pattern for capturing outgoing Authorization header"
    - "console.log spy + JSON.parse + filter(op==='SQL') for parsing audit lines"
    - "Filter for /execute/sql in fetch-call assertions to ignore the Plan 06-03 /version boot probe"
    - "Negative privacy assertions on raw audit JSON line: never contains accessToken / password / Authorization / Bearer / Basic"

key-files:
  created:
    - kinetica_bi/server/tests/kinetica.creds.routes.spec.ts (6 tests)
  modified:
    - kinetica_bi/server/tests/auth.routes.spec.ts (+4 tests)

key-decisions:
  - "seedOidcSession + makeJwt helpers duplicated inline in both test files — Claude's Discretion outcome (CONTEXT.md allowed extracting to tests/helpers/oidcSession.ts but cohesion-per-file won)"
  - "Filter /version probe out of fetch-call assertions — Plan 06-03 added a boot probe that uses the global fetch; tests must not collide"
  - "Test 5 (past-exp REAUTH) asserts the row is gone from DB — proves the proactive exp check actually deleted it, not just returned null"
  - "Logout symmetry test compares Set-Cookie strings modulo Expires date string — Set-Cookie includes a real timestamp that differs across runs; Express's clearCookie pattern is otherwise byte-identical"
  - "ZERO production-code changes — verified via git diff showing 0 lines changed in any src/ file from this plan"

patterns-established:
  - "Audit log capture: spy console.log → map → filter(typeof string) → JSON.parse → find(op === 'SQL')"
  - "OIDC session seeding for tests: createSession({credentialType:'oidc', secret:jwt, idToken:jwt}) + jwt.sign for cookie"

requirements-completed: [MODE-04, UX-07, OBS-02]

# Metrics
duration: 8min
tests-added: 10
tests-passing: 328
tests-skipped: 1
tsc-clean: true

# Verification
verification:
  - npx vitest run tests/kinetica.creds.routes.spec.ts exits 0 with 6 tests passing
  - npx vitest run tests/auth.routes.spec.ts exits 0 with 11 tests passing (7 existing + 4 new)
  - npx vitest run (full suite) exits 0 with 328 passing + 1 pre-existing skip
  - git diff kinetica_bi/server/src/ shows 0 lines (test-only plan)
  - SC2 verified: Tests 1+2 of kinetica.creds.routes.spec.ts capture exact Bearer/Basic header
  - SC3 verified: Test 5 — past-exp OIDC token returns 401 REAUTH; /execute/sql never called; row deleted
  - SC4 verified: 4 logout tests in auth.routes.spec.ts — symmetric outcomes, no IdP fetch, idempotent
  - SC5 verified: Tests 3+4 — audit log line carries auth_mode='oidc' / auth_mode='password'

# Commits
commits:
  - 16d7609: test(06-04) — end-to-end Bearer-vs-Basic + audit auth_mode (Task 1: SC2/SC3/SC5)
  - 413dcaa: test(06-04) — logout symmetry OIDC mode (Task 2: SC4/UX-07)

---

## What this plan delivered

The integration test layer that closes Phase 6's loop. Plans 06-01 and 06-02 delivered the structural pieces (helper branch + proactive exp check + audit field) with unit-level verification; Plan 06-03 added the operator-facing observability. Plan 06-04 verifies all of it end-to-end through real route handlers.

### `tests/kinetica.creds.routes.spec.ts` (NEW, 6 tests)

Seeds OIDC sessions directly via `createSession({ credentialType: "oidc", ... })` + `jwt.sign` (bypassing `/oidc/callback` to keep tests fast and focused). Stubs the global `fetch` to capture what `kineticaSql` sends to Kinetica. Asserts the exact `Authorization` header for both modes:

- **Test 1** — OIDC cookie produces `Authorization: Bearer ${accessToken}` (exact-match)
- **Test 2** — Password cookie produces `Authorization: Basic ${b64("alice:hunter2")}` (exact-match)
- **Test 3** — Audit log JSON line for OIDC call carries `auth_mode: "oidc"` (parsed via console.log spy + JSON.parse + filter on `op === "SQL"`)
- **Test 4** — Same for password: `auth_mode: "password"`
- **Test 5** — Past-exp OIDC access token: response is `401 { code: "REAUTH_REQUIRED" }`; no `/execute/sql` call fires; the session row is deleted by `getSession`'s proactive check. End-to-end SC3.
- **Test 6** — Audit line never contains the access token literal, the password literal, or the `Authorization` header text. Locks the Phase 02-02 invariant ("explicit key enumeration in JSON.stringify (not spread) to guarantee no extra fields leak into audit record") at the route level.

### `tests/auth.routes.spec.ts` (extended, +4 tests)

Logout symmetry across modes (UX-07: local logout, never calls IdP `end_session_endpoint`):

- **Test 1** — OIDC logout: row deleted, cookie cleared
- **Test 2** — Logout response is byte-identical (modulo Expires date) in password vs OIDC modes
- **Test 3** — No outbound fetch fires from the logout handler (filter out the boot `/version` probe)
- **Test 4** — Logout idempotency: second logout with already-cleared cookie still returns 204

### Zero production-code changes

`git diff` on `kinetica_bi/server/src/` from this plan's commits returns 0 lines. The plan is purely the integration-test layer that proves the production code from 06-01/02/03 actually behaves correctly when wired together.

## Success Criteria Trace

| SC | Plan delivers | Verified by |
|----|--------------|-------------|
| SC2 | Bearer in OIDC; Basic in password (verified via audit log) | Tests 1+2 (header exact-match) + Tests 3+4 (audit field) |
| SC3 | Past-exp token → 401 REAUTH, never reaches Kinetica | Test 5 (route + DB row + fetch-not-called combo) |
| SC4 | Logout identical in both modes; no IdP call | 4 logout tests in auth.routes.spec.ts |
| SC5 | auth_mode in every Kinetica-call audit line | Tests 3+4 (parsed JSON line) |

## Status

PLAN COMPLETE — 10 new tests across 2 files; 2 atomic commits; 328 server tests passing (1 pre-existing skip); tsc clean. Test-only plan, zero src/ changes.
