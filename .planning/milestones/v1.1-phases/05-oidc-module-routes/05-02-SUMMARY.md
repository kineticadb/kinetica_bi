---
phase: 05-oidc-module-routes
plan: "02"
subsystem: auth
tags: [oidc, openid-client, typescript, vitest, tdd]

# Dependency graph
requires:
  - phase: 05-oidc-module-routes
    plan: "01"
    provides: OidcConfig type + validateOidcEnv() skeleton + openid-client@5.7.1 installed

provides:
  - initOidcClient(config): Issuer.discover + new issuer.Client singleton + clockTolerance=30
  - buildAuthorizationUrl(state, nonce): returns IdP URL with scope="openid profile", pinned redirect_uri
  - exchangeCode(code, state, nonce): client.callback wrapper returning {accessToken, idToken, claims}
  - extractUsername(claims, config): id_token claim extraction with optional regex transform
  - mapOidcError(err): OPError/RPError → OidcFriendlyCode mapping
  - resetOidcClientForTests(): test-only singleton reset
  - OidcFriendlyCode type: oidc_denied | oidc_invalid | oidc_token_invalid | oidc_no_username
  - 36-test suite for oidc.module.spec.ts covering all exports

affects:
  - 05-03 (route handlers consume initOidcClient, buildAuthorizationUrl, exchangeCode, extractUsername, mapOidcError)
  - 05-04 (route tests reference full oidc module)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Module-level singleton pattern (_client, _config) with requireClient() guard helper
    - Test-only reset function (resetOidcClientForTests) prevents cross-test state leak (RESEARCH Pitfall 3)
    - vi.hoisted() for mock fixtures accessible outside vi.mock factory
    - Regular function (not arrow function) in vi.fn().mockImplementation for constructor compatibility

key-files:
  created: []
  modified:
    - kinetica_bi/server/src/oidc.ts
    - kinetica_bi/server/tests/oidc.module.spec.ts

key-decisions:
  - "clock_tolerance=30 set via client[custom.clock_tolerance] AFTER construction — NOT a constructor option (RESEARCH Pitfall 1 / PITFALLS T-06)"
  - "resetOidcClientForTests() exported to prevent cross-test _client singleton bleed (RESEARCH Pitfall 3)"
  - "Username extracted from tokenSet.claims() (id_token payload) — NEVER from access_token (PITFALLS T-02)"
  - "requireClient() private helper centralizes not-initialized guard, keeping buildAuthorizationUrl and exchangeCode throw-consistent"
  - "vi.mock issuer.Client uses regular function not arrow function — arrow functions cannot be used as constructors with new"

patterns-established:
  - "requireClient() guard pattern: check _client && _config, throw '[oidc] OIDC client not initialized — initOidcClient must run at boot'"
  - "extractUsername returns raw.trim() when no regex, else regex match with group 1 preference over group 0, returns null on absent/empty/non-string"
  - "mapOidcError: instanceof errors.OPError first (check .error==='access_denied'), then instanceof errors.RPError, fallback to oidc_invalid"

requirements-completed: [OIDC-03, OIDC-05, OIDC-06, OIDC-07]

# Metrics
duration: 4min
completed: 2026-05-01
---

# Phase 5 Plan 02: OIDC Module + Routes — Core Module Summary

**Full oidc.ts module built on openid-client v5: Issuer.discover singleton, authorizationUrl builder with scope="openid profile", client.callback code exchange returning id_token claims, regex username extraction, and OPError/RPError friendly-code mapping — all covered by 36-test suite with vi.hoisted() mock**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-05-01T13:50:49Z
- **Completed:** 2026-05-01T13:54:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added OidcFriendlyCode type (oidc_denied | oidc_invalid | oidc_token_invalid | oidc_no_username) — locked vocabulary for Phase 7 frontend error banners
- Implemented 6 new exports in src/oidc.ts: initOidcClient, buildAuthorizationUrl, exchangeCode, extractUsername, mapOidcError, resetOidcClientForTests
- Wrote 26 new failing tests (RED phase) then made all 36 tests pass (GREEN phase) — full TDD cycle
- clock_tolerance=30 set via custom symbol post-construction (PITFALLS T-06 guard)
- redirect_uri pinned to config.redirectUri in buildAuthorizationUrl (PITFALLS C-07 guard)
- tokenSet.claims() used for username extraction, never access_token (PITFALLS T-02 guard)
- scope="openid profile" minimum to ensure preferred_username is present (PITFALLS T-04 guard)
- Full vitest suite: 251 passed, 1 skipped, 0 failed; tsc --noEmit clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Add openid-client mock + write failing tests (RED)** - `7876e1a` (test)
2. **Task 2: Implement all new oidc.ts exports + fix mock (GREEN)** - `a47f496` (feat)

_Note: TDD tasks have separate RED commit (tests) + GREEN commit (implementation). Auto-fix (Rule 1 - Bug) for mock constructor issue folded into Task 2 commit._

## Files Created/Modified

- `kinetica_bi/server/src/oidc.ts` - Extended from Plan 05-01 skeleton: added OidcFriendlyCode type + 6 new exports (initOidcClient, buildAuthorizationUrl, exchangeCode, extractUsername, mapOidcError, resetOidcClientForTests) + private requireClient() helper + module-level _client/_config singleton
- `kinetica_bi/server/tests/oidc.module.spec.ts` - Extended from 10 validateOidcEnv tests: added vi.hoisted() mock + vi.mock("openid-client") factory + 3 new describe blocks (extractUsername 9 tests, mapOidcError 6 tests, initOidcClient+buildAuthorizationUrl+exchangeCode 10 tests) = 36 total

## Decisions Made

**clock_tolerance set post-construction via custom symbol:** `client[custom.clock_tolerance] = 30` AFTER `new issuer.Client({...})`. RESEARCH.md Pitfall 1 explicitly warns that `clockTolerance` is not a constructor option in openid-client v5 — it must be assigned as a property via the `custom` symbol import.

**resetOidcClientForTests exported to public API:** The module-level `_client`/`_config` singleton persists across test runs within a vitest worker. Without an explicit reset, tests that call `initOidcClient()` would leave the singleton set for subsequent tests expecting "not initialized" behavior. `resetOidcClientForTests()` is called in `beforeEach` in the test suite (RESEARCH.md Pitfall 3).

**Username from tokenSet.claims() only:** The `exchangeCode` return value passes `tokenSet.claims()` (parsed id_token payload) as the `claims` property. Route handlers in Plan 05-03 will call `extractUsername(claims, config)` — never touching access_token claims. This enforces PITFALLS T-02 at the module boundary.

**requireClient() private helper:** Centralizes the "not initialized" guard for both `buildAuthorizationUrl` and `exchangeCode`. Both throw `"[oidc] OIDC client not initialized — initOidcClient must run at boot"` consistently via one call site.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] vi.mock issuer.Client arrow function not usable as constructor**
- **Found during:** Task 2 (GREEN phase, first test run)
- **Issue:** The plan's mock used `vi.fn().mockImplementation(() => client)` — an arrow function. JavaScript arrow functions cannot be called with `new`. Vitest emitted a warning "The vi.fn() mock did not use 'function' or 'class'..." and `new issuer.Client({...})` in initOidcClient threw `TypeError: () => client is not a constructor`.
- **Fix:** Changed mock to `vi.fn().mockImplementation(function (_metadata: unknown) { return client; })` — a regular function that returns the mock client object when called with `new`.
- **Files modified:** kinetica_bi/server/tests/oidc.module.spec.ts
- **Verification:** All 8 failing tests (initOidcClient suite) now pass; no remaining vitest warnings.
- **Committed in:** `a47f496` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Auto-fix corrected a mock pattern error that blocked the entire initOidcClient test suite. No scope creep — the fix is in the test file only and matches the intended mock shape exactly.

## Issues Encountered

**vi.fn().mockImplementation with arrow function cannot be used as constructor:** The plan's provided mock code used an arrow function (`() => client`) for `issuer.Client`. Arrow functions have no `[[Construct]]` internal method in JavaScript and cannot be invoked with `new`. Switching to a regular function resolves this. The plan's `vi.mock("openid-client")` minimal shape in RESEARCH.md §"Code Examples" has the same issue — future plans that copy that shape should use `function` syntax for any mock that gets called with `new`.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Plan 05-03 can now import `initOidcClient`, `buildAuthorizationUrl`, `exchangeCode`, `extractUsername`, `mapOidcError` from `./oidc` for route handler implementation
- `OidcFriendlyCode` type is exported and ready for route-level error redirect logic
- `resetOidcClientForTests()` is available for auth.oidc.spec.ts test isolation
- All PITFALLS guards (C-01 through C-07, T-01 through T-06) are implemented and verified
- No blockers

---
*Phase: 05-oidc-module-routes*
*Completed: 2026-05-01*
