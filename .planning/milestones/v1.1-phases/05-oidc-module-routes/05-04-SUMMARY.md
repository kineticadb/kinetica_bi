---
phase: 05-oidc-module-routes
plan: "04"
subsystem: testing
tags: [oidc, vitest, supertest, route-tests, fail-fast-tests, vi-mock-openid-client, parametrized-tests]

# Dependency graph
requires:
  - phase: 05-oidc-module-routes
    plan: "03"
    provides: async createApp() with /api/auth/config + /api/auth/oidc/start + /api/auth/oidc/callback + login gate; async buildTestApp() helper
  - phase: 05-oidc-module-routes
    plan: "02"
    provides: oidc.ts module exports (validateOidcEnv, initOidcClient, buildAuthorizationUrl, exchangeCode, extractUsername, mapOidcError, resetOidcClientForTests)

provides:
  - tests/auth.oidc.spec.ts — 5 describe blocks, 31 route-level tests covering Phase 5 SC1-SC5
  - tests/bootstrap.spec.ts — extended with 3 fail-fast tests covering Phase 5 SC6 (preserves existing structural regex test)
  - Locked literal-string assertions for friendly error codes (oidc_denied, oidc_invalid, oidc_token_invalid, oidc_no_username) — Phase 7 frontend depends on this contract
  - Parametrized "every callback exit clears oidc_state cookie" coverage (10 oidc-mode + 1 password-mode cases) — guards CONTEXT.md "every callback exit" decision against regression
  - Direct sessions table inspection on success path: credential_type='oidc' AND id_token_ciphertext NOT NULL (Phase 5 SC5 verification)

affects:
  - 06-* (helper Bearer/Basic branch tests inherit the vi.mock("openid-client") + buildTestApp pattern)
  - 07-* (frontend banner-rendering tests assert the literal friendly codes locked here)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - vi.hoisted() for mock fixtures shared between vi.mock factory and test code
    - mockReset() + re-establish default in beforeEach (prevents queued-Once leak across tests; mockClear is insufficient)
    - it.each() parametrized test for branch-coverage guarantees on cross-cutting invariants (cookie clearing, status code shape)
    - assertOidcStateCleared helper accepts both 'oidc_state=;' and Expires=1970-epoch clearing forms (Express version portable)
    - vi.stubEnv("AUTH_MODE", ...) BEFORE buildTestApp() — createApp() reads AUTH_MODE synchronously at top
    - resetOidcClientForTests() in beforeEach prevents singleton bleed across tests (Plan 05-02 pitfall)

key-files:
  created:
    - kinetica_bi/server/tests/auth.oidc.spec.ts
  modified:
    - kinetica_bi/server/tests/bootstrap.spec.ts

key-decisions:
  - "mockReset() in beforeEach (not mockClear) to clear queued mockRejectedValueOnce/mockResolvedValueOnce — discovered as a flaky-test root cause: mockClear preserves queued onces, leading to non-deterministic state when Onces from prior tests carried over"
  - "After mockReset(), restore issuer.Client.mockImplementation and Issuer.discover.mockResolvedValue defaults — mockReset wipes ALL implementations including those from vi.hoisted, so the harness must rebuild them per test"
  - "Parametrized 'every exit clears oidc_state cookie' covers all 10 oidc-mode exit branches — replaces the previous 2-branch spot-check; password-mode 400 exit is documented as 11th case but excluded from cookie-clearing assertion (no cookie can exist in password mode since /oidc/start returns 400)"
  - "assertOidcStateCleared accepts both 'oidc_state=;' and Expires=Thu, 01 Jan 1970 forms — Express clearCookie emits varies across versions and supertest env"
  - "Bootstrap structural regex test PRESERVED VERBATIM — Phase 3 EADDRINUSE regression lock; new fail-fast tests added in a separate describe block (no interference)"

patterns-established:
  - "Route-level OIDC test pattern: vi.hoisted mock → vi.mock('openid-client') → import buildTestApp + db + resetOidcClientForTests → describe blocks per route surface → beforeEach with stubEnv + resetOidcClient + mockReset"
  - "TokenSet fixture factory makeTokenSet(claimsOverride) for parametrized claim variations (e.g., empty preferred_username for SC T-03)"
  - "Direct DB row inspection for SC5: SELECT credential_type, length(id_token_ciphertext) FROM sessions verifies BOTH columns populated end-to-end via createSession"
  - "Phase 5 SC6 fail-fast: createApp() rejects via async expect(promise).rejects.toThrow(...) — covers env-missing, discover-rejection, invalid-mode in 3 separate tests"

requirements-completed: [OIDC-02, OIDC-03, OIDC-04, OIDC-05, OIDC-06, OIDC-07, OIDC-08, MODE-01]

# Metrics
duration: 6min
completed: 2026-05-01
---

# Phase 5 Plan 04: Route-level OIDC test suite + bootstrap fail-fast tests Summary

**vi.mock("openid-client") + supertest agent driving 31 route-level tests asserting all Phase 5 SC1-SC5 contracts, plus 3 bootstrap fail-fast tests for SC6; full vitest 285 passed; tsc clean**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-05-01T14:18:41Z
- **Completed:** 2026-05-01T14:24:15Z
- **Tasks:** 2
- **Files modified:** 2 (1 new + 1 extended)

## Accomplishments

- `tests/auth.oidc.spec.ts` created with 5 describe blocks (config, start, callback oidc, every-exit-clears-cookie parametrized, login gate) and 31 tests
- All 4 locked friendly error codes asserted as literal strings (`oidc_denied`, `oidc_invalid`, `oidc_token_invalid`, `oidc_no_username`) — Phase 7 frontend can rely on stable contract
- CONTEXT.md "every callback exit clears oidc_state cookie" verified by parametrized `it.each` test covering all 10 oidc-mode exit branches (replaces previous 2-branch spot-check); password-mode 400 documented as 11th case
- Phase 5 SC5 verified by direct sessions table inspection: `credential_type='oidc'` AND `id_token_ciphertext` NOT NULL on success path
- `tests/bootstrap.spec.ts` extended with 3 fail-fast tests covering Phase 5 SC6 (missing OIDC env → throws; Issuer.discover rejection → throws; invalid AUTH_MODE → throws)
- Existing bootstrap structural regex test preserved verbatim (Phase 3 EADDRINUSE regression lock)
- Discovered + fixed flaky-test root cause: `mockClear()` does NOT clear queued `mockRejectedValueOnce` calls — switched to `mockReset()` + restore defaults; 5 consecutive runs stable
- Full vitest run: 285 passed + 1 skipped + 0 failed; tsc --noEmit clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Create tests/auth.oidc.spec.ts with full route-level OIDC behavior coverage** — `f683b19` (test)
2. **Task 2: Extend tests/bootstrap.spec.ts with fail-fast tests for AUTH_MODE=oidc** — `62030a7` (test)

## Files Created/Modified

- `kinetica_bi/server/tests/auth.oidc.spec.ts` — NEW. 5 describe blocks, 31 tests. Hoisted mock fixtures for openid-client, vi.stubEnv per-test for AUTH_MODE, mockReset+default in beforeEach for stability.
- `kinetica_bi/server/tests/bootstrap.spec.ts` — EXTENDED. Added vi.mock("openid-client") with bootMocks, plus 3 fail-fast tests in a new describe block. Existing structural regex test preserved verbatim.

## Phase 5 Success Criteria → Test Mapping

| SC  | Description                                                  | Test Coverage |
|-----|--------------------------------------------------------------|---------------|
| SC1 | /oidc/start 302 + Location + oidc_state cookie               | `oidc mode: 302 redirect to mocked authorizationUrl + oidc_state cookie set`, `oidc mode: oidc_state cookie value parses to {state,nonce}`, `oidc mode: passes scope='openid profile' + state + nonce + redirect_uri to authorizationUrl` |
| SC2 | /oidc/callback every error path → friendly redirect (never 500/blank) | All 10 oidc-mode callback tests + parametrized "every exit clears oidc_state" (10 cases) — every exit returns 302 to /login?error=<friendlyCode> |
| SC3 | POST /api/auth/login in oidc mode → 400                     | `POST /api/auth/login (oidc mode gate) > returns 400 with locked message` (also asserts fetch never called) |
| SC4 | /api/auth/config returns {authMode} + Cache-Control: no-store + unauthenticated | `returns {authMode: 'password'} in password mode`, `returns {authMode: 'oidc'} in oidc mode`, `sets Cache-Control: no-store header`, `is reachable without authentication` |
| SC5 | Success path creates session with credential_type='oidc' + id_token populated | `success → 302 /, kbi_session cookie set, sessions row has credential_type='oidc' + id_token populated` (direct DB inspection) |
| SC6 | createApp() fails fast on bad OIDC env / discover rejection / invalid AUTH_MODE | `bootstrap.spec.ts > createApp boot fail-fast in AUTH_MODE=oidc > throws when AUTH_MODE=oidc and AUTH_OIDC_ISSUER_URL is missing`, `throws when Issuer.discover rejects`, `throws when AUTH_MODE is neither 'password' nor 'oidc'` |

## Friendly Error Code → Test Assertion (Phase 7 reference)

| Code                  | Triggers                                                            | Tests asserting literal string |
|-----------------------|---------------------------------------------------------------------|--------------------------------|
| `oidc_denied`         | IdP `?error=access_denied`                                          | `?error=access_denied → 302 /login?error=oidc_denied`, `[oidc-mode] 'access_denied' clears oidc_state cookie` |
| `oidc_invalid`        | IdP non-access_denied error, missing code/state/cookie, state mismatch, OPError, network error | 6 separate tests + 6 parametrized cases |
| `oidc_token_invalid`  | RPError from exchangeCode (sig/aud/iss/exp/nonce validation)        | `RPError from exchangeCode → /login?error=oidc_token_invalid`, `[oidc-mode] 'RPError from exchange' clears oidc_state cookie` |
| `oidc_no_username`    | extractUsername returns null (empty/missing claim)                  | `empty preferred_username claim → /login?error=oidc_no_username`, `[oidc-mode] 'no-username' clears oidc_state cookie` |

## Decisions Made

**mockReset() vs mockClear() in beforeEach:** Discovered during stability testing that `mockClear()` only resets call records, NOT queued `mockRejectedValueOnce`/`mockResolvedValueOnce`. When the non-parametrized callback describe block ran tests with queued onces before the parametrized describe block, leftover state caused intermittent timeouts on the parametrized OPError/RPError cases. Switched to `mockReset()` + restore default `mockResolvedValue(tokenSet)` + restore `issuer.Client.mockImplementation` and `Issuer.discover.mockResolvedValue` per test. 5 consecutive full runs stable after the fix.

**Parametrized "every exit clears" coverage:** CONTEXT.md locks "cookie cleared on every callback exit — success + all errors". The non-parametrized describe block covers each branch's 302/400 outcome but only 2 explicitly assert Set-Cookie clearing. The new `it.each` test exercises all 10 oidc-mode exit branches with a single assertion (`assertOidcStateCleared`) — a regression in any of the 9 less-trafficked branches (e.g., a wrapped early-return) would now fail. Password-mode 400 is documented as 11th case but excluded from the cookie-clearing assertion: in password mode, /oidc/start returns 400 and never sets oidc_state, so /oidc/callback in password mode has no cookie to clear (the 400 short-circuit occurs before clearCookie).

**assertOidcStateCleared portability:** The helper accepts BOTH `oidc_state=;` and `oidc_state=...; Expires=Thu, 01 Jan 1970 ...` forms because Express `res.clearCookie('oidc_state', { path: '/' })` emits the latter; some Express variants emit the former. Both are valid clearing signals for browsers.

**Bootstrap regex test preservation:** The Phase 3 EADDRINUSE regression test (regex matches `if (process.env.NODE_ENV !== "test") { ... app.listen ... startSessionSweep() ... }`) is the only reliable structural check for the gate. New SC6 fail-fast tests live in a separate describe block (`createApp boot fail-fast in AUTH_MODE=oidc`) — preserved verbatim. The bootstrap mock and the file imports do not affect the existing test (it reads src/index.ts as a string and runs the regex; mocks don't enter the picture).

## Deviations from Plan

None — plan executed exactly as written. The mockReset() switch was a stability fix discovered during verification; the plan's `mockClear() + mockResolvedValue()` pattern was adjusted to use `mockReset()` instead, which is a strict superset (mockReset includes mockClear's behavior). All plan acceptance criteria pass.

## Issues Encountered

**Flaky tests on initial run** — On the very first verification run, the parametrized OPError and RPError cases timed out at 5s. Diagnosed as `mockClear()` not clearing queued `mockRejectedValueOnce` from prior non-parametrized tests; fixed by using `mockReset()` + re-establishing default `mockResolvedValue(tokenSet)` and restoring `issuer.Client.mockImplementation` and `Issuer.discover.mockResolvedValue` per test. 5 consecutive full runs stable after the fix; same fix verified across full suite (285 passed) over 3 additional runs.

## User Setup Required

None — no external service configuration required for this plan. Tests run in-memory with vi.mock("openid-client").

## Next Phase Readiness

- Phase 5 is now fully verification-gated. Every SC1-SC6 has automated test coverage.
- The locked friendly error codes (`oidc_denied`, `oidc_invalid`, `oidc_token_invalid`, `oidc_no_username`) are asserted as literal strings — Phase 7 frontend banner-rendering tests can rely on the stable contract.
- The `vi.mock("openid-client")` + `buildTestApp` + `resetOidcClientForTests` pattern is reusable for Phase 6 helper Bearer/Basic branch tests.
- No blockers. Phase 5 ready for completion.

---

## Self-Check: PASSED

- Files exist: `kinetica_bi/server/tests/auth.oidc.spec.ts`, `kinetica_bi/server/tests/bootstrap.spec.ts`, `.planning/phases/05-oidc-module-routes/05-04-SUMMARY.md`
- Commits exist: `f683b19` (Task 1), `62030a7` (Task 2)
- All 14 acceptance-criteria grep checks for `auth.oidc.spec.ts` pass (vi.mock, all 4 route paths, all 4 friendly error codes, locked password-login message, credential_type + id_token_ciphertext SC5 markers, it.each parametrized test, "every exit clears oidc_state" describe label, assertOidcStateCleared helper)
- All 5 acceptance-criteria grep checks for `bootstrap.spec.ts` pass (existing structural test preserved verbatim, 3 new fail-fast assertions, openid-client mock present)
- Full vitest run: 285 passed + 1 skipped + 0 failed (was 251 + 1 before; +34 = +31 auth.oidc + +3 bootstrap fail-fast)
- tsc --noEmit: clean
- 5 consecutive runs of auth.oidc.spec.ts in isolation: all 31 tests stable; 3 consecutive full-suite runs all 285 pass
