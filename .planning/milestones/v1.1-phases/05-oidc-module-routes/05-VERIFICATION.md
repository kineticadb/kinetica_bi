---
phase: 05-oidc-module-routes
verified: 2026-05-01T14:30:36Z
status: passed
score: 6/6 success-criteria verified
re_verification: null
---

# Phase 5: OIDC Module + Routes Verification Report

**Phase Goal:** In `AUTH_MODE=oidc`, a user can complete the full OIDC Authorization Code flow end-to-end; the backend creates a valid session row with `credential_type='oidc'`; the entire flow is testable via curl without any frontend changes.

**Verified:** 2026-05-01T14:30:36Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Phase 5 Success Criteria)

| #   | Truth (SC from ROADMAP)                                                                                                                                                                                                                                  | Status     | Evidence                                                                                                                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `GET /api/auth/oidc/start` (oidc mode) → 302 + Location to IdP `authorization_endpoint` + `oidc_state` httpOnly cookie set                                                                                                                                | ✓ VERIFIED | `src/index.ts:185-200` mounts the route, `randomBytes(32).toString("base64url")` for state+nonce, `oidc_state` cookie set with `httpOnly: true, sameSite: "lax", path: "/", maxAge: 600_000`, `res.redirect(buildAuthorizationUrl(state, nonce))`. Asserted by `tests/auth.oidc.spec.ts` `oidc/start` describe block (4 cases passing). |
| 2   | `GET /api/auth/oidc/callback?error=access_denied` → redirect to `/login?error=oidc_denied` (non-leaking, never 500/blank)                                                                                                                                  | ✓ VERIFIED | `src/index.ts:228-235` maps `idpError === "access_denied"` to `oidc_denied`, all other IdP errors to `oidc_invalid`. `tests/auth.oidc.spec.ts` covers 9 callback error branches (access_denied, server_error, missing code, missing state, missing cookie, state mismatch, OPError, RPError, no-username) — all redirect, none 500/blank. |
| 3   | `POST /api/auth/login` (oidc mode) → 400 (or 405) — password login disabled                                                                                                                                                                                | ✓ VERIFIED | `src/index.ts:127-130`: gate at top of handler returns `400 {error: "Password login is disabled. Use OIDC."}` BEFORE any kinetica call. `tests/auth.oidc.spec.ts` "POST /api/auth/login (oidc mode gate)" asserts 400 + locked message + `fetch` mock untouched.                                                                  |
| 4   | `GET /api/auth/config` → `{"authMode":"oidc"}` or `{"authMode":"password"}`, no auth required                                                                                                                                                              | ✓ VERIFIED | `src/index.ts:178-181` mounts route BEFORE `app.use("/api", requireAuth)` (line 315), sets `Cache-Control: no-store`, returns `{ authMode }` from boot-captured const. `tests/auth.oidc.spec.ts` "GET /api/auth/config" describe block asserts both mode values, header, and unauthenticated reachability.            |
| 5   | After successful OIDC callback: sessions row with `credential_type='oidc'`, encrypted access token in `ciphertext`, `id_token_ciphertext` populated                                                                                                       | ✓ VERIFIED | `src/index.ts:303-309` calls `createSession({ username, secret: accessToken, kineticaUrl, credentialType: "oidc", idToken })`. `tests/auth.oidc.spec.ts` success-path test inspects sessions table directly: `expect(rows[0].credential_type).toBe("oidc")`, `expect(rows[0].ct_len).toBeGreaterThan(0)`, `expect(rows[0].id_ct_len).toBeGreaterThan(0)`. |
| 6   | Server boot with `AUTH_MODE=oidc` + unreachable/misconfigured `AUTH_OIDC_ISSUER_URL` → process exits non-zero with clear error log                                                                                                                          | ✓ VERIFIED | `src/index.ts:88-100` awaits `validateOidcEnv()` + `initOidcClient()` at boot; both throw on failure. Bootstrap IIFE at `src/index.ts:642-657` catches error and calls `process.exit(1)` with `console.error("[boot] startup failed", err)`. `tests/bootstrap.spec.ts` SC6 tests assert `createApp()` rejects on missing env, `Issuer.discover` rejection, and bad `AUTH_MODE`.    |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact                                              | Expected                                                                                              | Status     | Details                                                                                                                                                                                                                                          |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kinetica_bi/server/src/oidc.ts`                       | Full OIDC module: `OidcConfig`, `OidcFriendlyCode`, `validateOidcEnv`, `initOidcClient`, `buildAuthorizationUrl`, `exchangeCode`, `extractUsername`, `mapOidcError`, `resetOidcClientForTests` | ✓ VERIFIED | All 9 exports present (lines 27, 37, 44, 74, 89, 106, 128, 151, 172). PITFALLS guards verified by grep: `tokenSet.claims()` (T-02 line 142), `"openid profile"` (T-04 line 109), `client[custom.clock_tolerance] = 30` (T-06 line 83), `redirect_uri: config.redirectUri` (C-07 line 110), trailing-slash strip (C-05 line 54). |
| `kinetica_bi/server/src/index.ts`                      | Async `createApp` + `authMode` const + OIDC boot init + 3 new routes + login gate + async bootstrap IIFE | ✓ VERIFIED | `createApp = async (): Promise<express.Express>` (line 61); `authMode` captured once (line 82); OIDC routes mounted before `requireAuth` (lines 178-312, 315); login gate at handler line 1 (lines 127-130); async IIFE bootstrap (lines 638-658). AP-2 (sessionStore does not import oidc): clean. AP-5 (no per-route `process.env.AUTH_MODE` reads): clean (awk scan returns 0). |
| `kinetica_bi/server/tests/oidc.module.spec.ts`         | `validateOidcEnv` + module-level mocked openid-client unit tests                                       | ✓ VERIFIED | 4 describe blocks (validateOidcEnv, extractUsername, mapOidcError, init+build+exchange). 344 lines.                                                                                                                                              |
| `kinetica_bi/server/tests/auth.oidc.spec.ts`           | Route-level OIDC behavior coverage (4 surfaces, parametrized "every exit clears" test)                 | ✓ VERIFIED | 5 describe blocks: config (4 tests), start (4 tests), callback oidc (10 tests), parametrized every-exit-clears (10 oidc + 1 password mode), oidc routes inactive in password mode, login gate. 490 lines. `it.each` parametrized cookie-clearing test present.    |
| `kinetica_bi/server/tests/bootstrap.spec.ts`           | Existing structural regex test PRESERVED + 3 new SC6 fail-fast tests                                   | ✓ VERIFIED | Existing regex test ("wraps both app.listen() AND startSessionSweep()") preserved; new tests assert `AUTH_OIDC_ISSUER_URL is required`, `ENOTFOUND`, `AUTH_MODE must be 'password' or 'oidc'`. 128 lines.                                          |
| `kinetica_bi/server/tests/helpers/app.ts`              | Async `buildTestApp` returning `Promise<supertest.SuperTest>`                                         | ✓ VERIFIED | `export const buildTestApp = async () => { const app = await createApp(); return request(app); }`. Zero un-awaited callsites (grep across 7 spec files returns 0).                                                                                |
| `kinetica_bi/server/package.json`                       | `openid-client@^5` dependency                                                                         | ✓ VERIFIED | `"openid-client": "^5.7.1"` in dependencies (line 21). Resolved version: 5.7.1 (verified by reading `node_modules/openid-client/package.json`).                                                                                                  |
| `kinetica_bi/server/.env.example`                      | All 6 `AUTH_OIDC_*` vars + `AUTH_MODE` documented                                                       | ✓ VERIFIED | `AUTH_MODE=password`, `AUTH_OIDC_ISSUER_URL`, `AUTH_OIDC_CLIENT_ID`, `AUTH_OIDC_CLIENT_SECRET`, `AUTH_OIDC_REDIRECT_URI`, `AUTH_OIDC_USERNAME_CLAIM=preferred_username`, `AUTH_OIDC_USERNAME_REGEX` all present with comments.                            |

### Key Link Verification

| From                                  | To                                                                          | Via                                                                  | Status   | Details                                                                                                                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/index.ts /oidc/start` handler    | `src/oidc.ts buildAuthorizationUrl`                                         | `import { buildAuthorizationUrl } from './oidc'` + call site          | ✓ WIRED  | Import on line 52, call on line 198.                                                                                                                                                  |
| `src/index.ts /oidc/callback` handler | `src/oidc.ts exchangeCode + extractUsername + mapOidcError`                 | `asyncHandler -> exchangeCode -> extractUsername (or mapOidcError on throw)` | ✓ WIRED  | All 3 functions imported (lines 53-55), called inside `asyncHandler(async (req, res) => {...})` callback (lines 260, 288, 262). Error path maps to friendly codes; success path extracts username. |
| Callback success branch                | `createSession + issueSessionCookie`                                        | `createSession({...credentialType: "oidc"...}); issueSessionCookie`   | ✓ WIRED  | `src/index.ts:303-310` calls `createSession({ username, secret: accessToken, kineticaUrl, credentialType: "oidc", idToken })` then `issueSessionCookie(res, username, sid)` then `res.redirect("/")`.    |
| Callback every exit path               | `res.clearCookie('oidc_state')`                                            | Cleared at top of handler immediately after parsing the cookie value  | ✓ WIRED  | `src/index.ts:213` clears the cookie BEFORE any branch logic. `tests/auth.oidc.spec.ts` `it.each` parametrized test verifies clearing on all 10 oidc-mode exit branches (success + 9 errors).      |
| `oidc.ts initOidcClient`              | `openid-client (Issuer.discover, new issuer.Client, custom.clock_tolerance)` | `import { Issuer, custom, errors } from "openid-client"`              | ✓ WIRED  | Import on line 23, `Issuer.discover()` on line 75, `new issuer.Client({...})` on line 76, `client[custom.clock_tolerance] = 30` on line 83.                                            |
| `oidc.ts exchangeCode`                | `tokenSet.claims()`                                                         | ID token claims extraction (NEVER `access_token` — PITFALLS T-02)    | ✓ WIRED  | Line 142: `claims: tokenSet.claims() as Record<string, unknown>`. Negative check: `access_token.claims` does not appear anywhere in `oidc.ts`.                                            |

### Requirements Coverage

| Requirement | Source Plan(s)        | Description                                                                          | Status      | Evidence                                                                                                                                                                                                                                            |
| ----------- | --------------------- | ------------------------------------------------------------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OIDC-02     | 05-03, 05-04          | `/api/auth/oidc/start` builds IdP URL from discovered endpoint, generates state, persists in httpOnly cookie, 302-redirects | ✓ SATISFIED | Implemented `src/index.ts:185-200`. Asserted by `tests/auth.oidc.spec.ts` (start describe block).                                                                                                                                                  |
| OIDC-03     | 05-01, 05-02, 05-03, 05-04 | OIDC discovery at server startup, cached, fail-fast on failure                          | ✓ SATISFIED | `validateOidcEnv` at `src/oidc.ts:44`, `initOidcClient` at `src/oidc.ts:74` calls `Issuer.discover` and caches in `_client` singleton. Boot fail-fast wired in `src/index.ts:88-100`. Bootstrap test asserts process exits non-zero on rejection.  |
| OIDC-04     | 05-03, 05-04          | Returned `state` must match persisted; mismatch → reject                                | ✓ SATISFIED | `src/index.ts:249-254` does `Buffer.from(...)` length check + `timingSafeEqual` (PITFALLS C-02). `tests/auth.oidc.spec.ts` "state mismatch" test asserts redirect + `client.callback` NOT called.                                                  |
| OIDC-05     | 05-02, 05-03, 05-04   | Callback exchanges code for tokens at `token_endpoint` using client_id/secret/redirect_uri | ✓ SATISFIED | `exchangeCode` (`src/oidc.ts:128`) calls `client.callback(config.redirectUri, { code, state }, { state, nonce })`. Wired into route at `src/index.ts:260`. Asserted by `tests/oidc.module.spec.ts` and `tests/auth.oidc.spec.ts`.                  |
| OIDC-06     | 05-02, 05-03, 05-04   | id_token signature verified via JWKS; aud/iss/exp checked; failure → reject              | ✓ SATISFIED | `client.callback()` performs all checks (delegated to openid-client@5.7.1). Comments at `src/oidc.ts:117-123` document the 5 checks. `clockTolerance=30` set via custom symbol (PITFALLS T-06). RPError → `oidc_token_invalid` mapping verified.    |
| OIDC-07     | 05-02, 05-03, 05-04   | Username extracted from id_token via `AUTH_OIDC_USERNAME_CLAIM` (default `preferred_username`); empty → user-visible error | ✓ SATISFIED | `extractUsername` at `src/oidc.ts:151-163` reads from claims (NEVER access_token), applies optional regex with capture-group-1 fallback to full match, returns null on absent/empty. Route maps null → `oidc_no_username`. 9 unit tests + 1 route test. |
| OIDC-08     | 05-03, 05-04          | All callback errors → login redirect with non-leaking message; never 500/blank/stack-trace | ✓ SATISFIED | All 9 error branches return `res.redirect("/login?error=<friendlyCode>")`. Friendly code vocabulary (`oidc_denied`, `oidc_invalid`, `oidc_token_invalid`, `oidc_no_username`) locked + asserted as literal strings in tests.              |
| MODE-01     | 05-01, 05-03, 05-04   | `AUTH_MODE` gates which auth routes are mounted; oidc mode → `/login` returns 400      | ✓ SATISFIED | `authMode` const captured once at `src/index.ts:82`; login gate at lines 127-130; OIDC routes return 400 in password mode (lines 186-188, 206-208). Test at `tests/auth.oidc.spec.ts` asserts `Password login is disabled. Use OIDC.` literal.   |

All 8 phase requirement IDs are SATISFIED. No orphaned requirements: REQUIREMENTS.md traceability table maps exactly OIDC-02..08 + MODE-01 to Phase 5, all of which appear in plan frontmatter.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |

None found. Anti-pattern scans clean:
- No `TODO|FIXME|XXX|HACK|PLACEHOLDER` in any of `src/oidc.ts`, `src/index.ts`, `tests/auth.oidc.spec.ts`, `tests/oidc.module.spec.ts`, `tests/bootstrap.spec.ts`.
- No empty stub returns (`return null`/`return {}`/`return []`) at end-of-line in OIDC implementation.
- ARCHITECTURE AP-2 clean: `sessionStore.ts` does NOT import `oidc.ts` (verified by grep).
- ARCHITECTURE AP-5 clean: no `process.env.AUTH_MODE` reads inside any route handler body (verified by awk-based scan over `app.<method>(...)` ... `});` blocks). The 3 occurrences in `index.ts` are: a comment (line 76), the canonical boot-time read (line 82), and the error-message interpolation in the same boot-time block (line 84).

### Test Suite Result

```
> kinetica-bi-server@0.1.0 test
> vitest

 RUN  v4.1.5 /Users/rydelpereira/Documents/projects/codex_kinetica_bi/kinetica_bi/server

 Test Files  20 passed (20)
      Tests  285 passed | 1 skipped (286)
   Duration  1.69s
```

All 285 tests pass; 1 intentionally skipped (the runtime bootstrap-IIFE test, documented as fragile in `tests/bootstrap.spec.ts`). The structural regex test that locks the Phase 3 EADDRINUSE regression still passes.

### Human Verification Required

None blocking phase completion. Recommended (but optional) live smoke testing:

1. **End-to-end against a real IdP (Keycloak or Okta dev tier)** — Test
   - Start server with valid `AUTH_OIDC_*` env vars, perform full Authorization Code flow via browser, confirm session row created with `credential_type='oidc'` and `id_token_ciphertext` populated.
   - Why human: Requires a real running IdP; mocked unit/route tests already cover the wire-level behavior, but live integration confirms `openid-client@5.7.1` actually negotiates the discovery + JWKS + token exchange against a real provider. Phase 6/7/8 will exercise this naturally.
   - Note: This was explicitly out-of-scope for Phase 5 testing per CONTEXT.md ("NO live unreachable-URL integration test (CI flakiness risk)"). Mock-based tests are the locked Phase 5 contract.

### Gaps Summary

No gaps. Phase 5 goal achieved end-to-end:

- All 6 ROADMAP success criteria verified by automated tests.
- All 8 requirement IDs (OIDC-02..08, MODE-01) satisfied with implementation evidence.
- All 4 plans (05-01..05-04) shipped with SUMMARY files; ROADMAP marks Phase 5 complete.
- All 9 OIDC module exports present and wired.
- All 3 new routes mounted in correct order (before `requireAuth`).
- `createApp()` async cascade complete (`buildTestApp` async; zero un-awaited callsites across 7 spec files).
- Bootstrap regex test still satisfied; new SC6 fail-fast tests added.
- Friendly error code vocabulary (`oidc_denied`, `oidc_invalid`, `oidc_token_invalid`, `oidc_no_username`) locked as literal strings — Phase 7 frontend can rely on them.
- Critical PITFALLS guards verified: C-01 (signature via `client.callback`), C-02 (`timingSafeEqual` state check), C-03 (single-use cookie cleared every exit), C-04/C-05 (delegated to openid-client), C-07 (redirect_uri pinned to env), T-02 (claims from id_token only), T-03 (empty username → `oidc_no_username`), T-04 (`scope: "openid profile"`), T-05 (opaque-token warning log), T-06 (`clockTolerance=30` via custom symbol), O-01 (trailing-slash strip).
- ARCHITECTURE anti-patterns AP-2 (sessionStore independent of oidc) and AP-5 (no per-route env reads) preserved.

Phase 5 is curl-complete and browser-incomplete by design (frontend SSO button is Phase 7; Bearer/Basic helper branch is Phase 6). Ready to proceed.

---

_Verified: 2026-05-01T14:30:36Z_
_Verifier: Claude (gsd-verifier)_
