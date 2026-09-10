# Phase 5: OIDC Module + Routes - Context

**Gathered:** 2026-04-30
**Status:** Ready for planning

<domain>
## Phase Boundary

In `AUTH_MODE=oidc`, a user can complete the full OIDC Authorization Code flow end-to-end against any OIDC-compliant IdP — testable entirely via curl, no frontend changes. New `src/oidc.ts` module owns discovery + URL building + code exchange + claim extraction. Three new routes (`GET /api/auth/oidc/start`, `GET /api/auth/oidc/callback`, `GET /api/auth/config`) plus AUTH_MODE-gated 400 response on `POST /api/auth/login`.

After this phase, the backend creates valid sessions with `credential_type='oidc'` (Phase 4 columns + idToken populated), but no helper Bearer/Basic branching yet (Phase 6) and no frontend awareness (Phase 7). This phase is curl-complete, browser-incomplete by design.

Covers requirements OIDC-02, OIDC-03, OIDC-04, OIDC-05, OIDC-06, OIDC-07, OIDC-08, MODE-01.

</domain>

<decisions>
## Implementation Decisions

### State + nonce storage during the IdP redirect dance
- **httpOnly cookie carrying plain JSON `{state, nonce}`** as the storage mechanism. Cookie name: `oidc_state`. Attributes: `httpOnly: true`, `sameSite: "lax"`, `path: "/"`, `maxAge: 10 * 60 * 1000` (10 minutes), `secure: process.env.NODE_ENV === "production"` (mirrors `kbi_session` cookie pattern in `auth.ts:97`). Survives server restart; portable across processes; matches ARCHITECTURE.md §"New Routes" exactly.
- **Plain JSON, not signed.** `JSON.stringify({state, nonce})` then `res.cookie('oidc_state', json, {...})`. Tamper risk is mitigated by the state-equality check in callback (`crypto.timingSafeEqual`) — the attacker can't forge a valid state without knowing the value, and httpOnly blocks JS access. No JWT signing needed.
- **Single-use nonce.** Per PITFALLS C-03 prevention: cookie is cleared via `res.clearCookie('oidc_state', { path: "/" })` after callback verification, regardless of success or failure. Prevents nonce replay within the 10-min cookie window.
- **Generator: `node:crypto.randomBytes(32).toString('base64url')`** for both state and nonce. Same pattern as `sessionStore.ts:52` SID generation. Zero new API surface; explicit; STACK.md confirms `openid-client` generators use the same entropy source.
- **Cookie cleared unconditionally on callback** (success path AND every error path). Use `res.clearCookie('oidc_state', { path: "/" })` immediately after parsing it, before any other logic.

### Callback error UX
- **All errors redirect to `/login?error=<code>`** (HTTP 302). Curl-testable via `Location` header; frontend (Phase 7) reads `?error` from URL and renders banner. Phase 5 SC2 explicitly requires "redirect to the login page with a non-leaking user-visible error message — never a 500 or blank response."
- **Friendly error code vocabulary (LOCKED in this phase, rendered in Phase 7):**
  - `oidc_denied` — User-side denial. Maps from IdP's `?error=access_denied`. Frontend shows: *"Sign-in was denied by your identity provider. Contact your admin if this persists."*
  - `oidc_invalid` — Protocol-level failure. Maps from: state mismatch, missing `code` param, code-exchange HTTP failure, IdP `?error=invalid_request`/`server_error`/other unknown error codes. Frontend shows: *"Sign-in failed. Please try again."*
  - `oidc_token_invalid` — ID token verification failure. Maps from: signature fail, `aud` mismatch, `iss` mismatch, `nonce` mismatch, `exp` past. Frontend shows: *"Sign-in could not be verified. Please try again or contact your admin."*
  - `oidc_no_username` — Claim extraction failure. Maps from: configured `AUTH_OIDC_USERNAME_CLAIM` absent in id_token claims, or `AUTH_OIDC_USERNAME_REGEX` produces empty string. Frontend shows: *"Your identity provider response is missing required user info. Contact your admin."*
- **Raw IdP error_codes are NOT passed through** to the user (PITFALLS AF-10). They are logged server-side via the existing audit/log pattern with the friendly code attached for correlation: `console.error('[oidc] callback failed', { friendlyCode, rawError, rawDescription })`.
- **No 500 / no blank response** ever. Every callback exit goes through one of: success redirect to `/`, error redirect to `/login?error=<code>`. Phase 5 SC2 requires this.
- **`oidc_state` cookie cleared on every callback exit** (success + all error branches), per state-storage decision above.

### `GET /api/auth/config` route
- **Response shape: bare `{ authMode: 'password' | 'oidc' }`**. Minimum sufficient for Phase 7 LoginPage branching. Matches Phase 5 SC4. No `version`, `oidc.issuerLabel`, or other fields — additive compatibility preserved for future.
- **Headers:** `Cache-Control: no-store` set explicitly via `res.setHeader('Cache-Control', 'no-store')` (PITFALLS I-03 — prevents stale browser cache from showing wrong login form after operator AUTH_MODE flip). Add **NOW in Phase 5** when the route is defined; Phase 7 just consumes the contract.
- **Authentication: unauthenticated.** Mounted BEFORE `app.use("/api", requireAuth)` in `index.ts`, alongside `/api/auth/login` and the new `/api/auth/oidc/*` routes.
- **Method: GET only.** No body; trivial JSON response.
- **Source of `authMode`:** Read once at `createApp()` from `process.env.AUTH_MODE`, normalized to `"password" | "oidc"`, stored in a local `const authMode` (per ARCHITECTURE.md anti-pattern: "per-route `process.env.AUTH_MODE` reads"). All three new routes + the inactive-route 400 branch read this same const.

### Test strategy
- **Mock `openid-client` at the module boundary** via `vi.mock("openid-client", () => ({ ... }))`. Stub `Issuer.discover`, `client.authorizationUrl`, `client.callback` (or whatever subset Phase 5 actually uses). Fast, deterministic, in-memory. Tests assert the wiring (state cookie set on /start, callback validates state, session row created with `credential_type='oidc'` + `idToken` populated, errors redirect to correct `/login?error=<code>`).
- **Routes that get automated tests in Phase 5:**
  1. `GET /api/auth/config` — returns `{authMode}`, sets `Cache-Control: no-store`, unauthenticated, exercised in both `AUTH_MODE=password` and `AUTH_MODE=oidc` modes.
  2. `GET /api/auth/oidc/start` — returns 302 with `Location` pointing to mocked `authorization_endpoint`, sets `oidc_state` cookie with parseable `{state, nonce}` JSON, returns 400 `{error}` if `AUTH_MODE !== 'oidc'`.
  3. `GET /api/auth/oidc/callback` — covering: state-mismatch → redirect `/login?error=oidc_invalid`; `?error=access_denied` query → redirect `/login?error=oidc_denied`; signature-fail (mock throws) → redirect `/login?error=oidc_token_invalid`; missing username claim → redirect `/login?error=oidc_no_username`; success path → `createSession({ credentialType: 'oidc', secret: <accessToken>, idToken: <id_token>, kineticaUrl })` called with correct args, `kbi_session` cookie issued, redirect to `/`.
  4. `POST /api/auth/login` in `AUTH_MODE=oidc` — returns 400 with JSON `{ error: 'Password login is disabled. Use OIDC.' }`.
- **Inactive-route response: 400 with JSON `{error}`** (not 405, not silent 404). Matches ARCHITECTURE.md pattern; Phase 5 SC3 explicitly permits "400 per ARCHITECTURE.md pattern". OIDC routes also return 400 in `AUTH_MODE=password` for symmetry.
- **Boot-time discovery — `validateOidcEnv()` throws on missing env vars** (unit-tested directly). Live `Issuer.discover()` failure path tested via mock returning a rejected promise; assert `createApp()` throws (or process exits) — satisfies Phase 5 SC6. NO live unreachable-URL integration test (CI flakiness risk).
- **Existing-test impact:** `auth.routes.spec.ts` may need a guard for the new `AUTH_MODE` setup — existing password-mode tests continue to pass with `AUTH_MODE=password` (default) or unset. New OIDC tests use `vi.stubEnv('AUTH_MODE', 'oidc')` per spec file.
- **Test file organization (Claude's discretion):** likely a new `tests/auth.oidc.spec.ts` (route-level) and `tests/oidc.module.spec.ts` (unit-level for `validateOidcEnv`, `extractUsername`, etc.). Final shape is the planner/executor's call.

### Carrying forward from prior phases (already locked, do not re-decide)
- **Library:** `openid-client@^5` (STACK.md). Confidential client with secret. **No PKCE** (FEATURES AF-1).
- **Authorization Code flow only.** No implicit, no hybrid, no PKCE.
- **OIDC discovery** at `${AUTH_OIDC_ISSUER_URL}/.well-known/openid-configuration` (OIDC-03), cached in process memory via module-level `let _metadata`. Boot-time fetch (fail-fast per TS-17 + Phase 5 SC6); not lazy. ARCHITECTURE.md §"`oidc.ts` Module Layout" pattern.
- **`redirect_uri`** read from `AUTH_OIDC_REDIRECT_URI` env var ONLY — never derived from request headers (PITFALLS C-07).
- **ID token verified** via JWKS (PITFALLS C-01). Audience must equal `AUTH_OIDC_CLIENT_ID` (C-04). Issuer must equal normalized `AUTH_OIDC_ISSUER_URL` with trailing slash stripped at boot (C-05). `exp` checked. `nonce` claim checked against the value stored in `oidc_state` cookie (C-03). Clock tolerance: 30s (PITFALLS T-06).
- **Username extraction** from verified id_token claims using `AUTH_OIDC_USERNAME_CLAIM` env (default `preferred_username`). Optional `AUTH_OIDC_USERNAME_REGEX` transform applied. Empty result → `oidc_no_username` error redirect, never silent empty username (PITFALLS T-03, OIDC-07).
- **Access token claims NEVER consulted** for username — only id_token (PITFALLS T-02).
- **Session creation:** `createSession({ username, secret: accessToken, kineticaUrl, credentialType: 'oidc', idToken })` — Phase 4 contract. The `id_token` IS persisted (Phase 4 columns + D-2 differentiator + MODE-06).
- **JWT cookie `v: 1`** NOT bumped (PITFALLS I-05).
- **`issueSessionCookie(res, username, sid)`** reused unchanged (auth.ts:86).
- **`asyncHandler` pattern** for the async `/oidc/callback` route (Phase 3).
- **Loud-failure on misconfig at boot** — `requireConfig` extended to also validate `AUTH_OIDC_*` when `AUTH_MODE=oidc` (Phase 5 SC6).
- **AUTH_MODE values:** `"password"` (default) or `"oidc"`. Anything else → boot fails. Read once at `createApp()`, never re-read per-route (ARCHITECTURE.md anti-pattern).
- **Tests in `kinetica_bi/server/tests/`**, in-memory SQLite per spec, supertest for routes, `vi.stubEnv` for env mutations.

### Claude's Discretion
- Exact internal layout of `src/oidc.ts` (singleton module-level state vs class — recommend module-level per ARCHITECTURE.md, but planner picks the cleanest fit).
- Whether to use `openid-client`'s `client.callback()` (which handles state + nonce + token exchange + id_token verification in one call) or assemble the steps manually. Recommend: use `client.callback()` — that's the library's whole point — but adapt the error catching to map exceptions to friendly codes.
- Whether `validateOidcEnv()` returns a frozen config object or just throws on missing values (returns config recommended for downstream re-use, but planner's call).
- File organization for new tests (`auth.oidc.spec.ts` vs split, fixture co-location).
- Internal helper names within `oidc.ts` (e.g., `getOidcMetadata` vs `loadDiscovery`, `exchangeCode` vs `handleCallback`).
- Whether to add a `request_id`-style log correlation for OIDC errors (server-side log when redirecting with friendly code) — recommend yes for debuggability, planner decides.
- Trailing-slash normalization implementation detail — happens in `validateOidcEnv()`; exact regex / string method is planner's call.
- Whether the inactive-route 400 message says "OIDC mode" / "password mode" / something more neutral — recommend short and neutral ("Password login is disabled.").

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 5 routes + module
- `.planning/research/STACK.md` §"The One Library to Add: `openid-client` v5" — install command, `Issuer.discover`, `client.callback`, JWKS caching, `generators` module reference; §"New Environment Variables" — full list of `AUTH_OIDC_*` vars
- `.planning/research/ARCHITECTURE.md` §"New Module: `src/oidc.ts`" — module layout, `OidcConfig`, `validateOidcEnv`, `getOidcMetadata`, `buildAuthorizationUrl`, `exchangeCode` signatures
- `.planning/research/ARCHITECTURE.md` §"New Routes" — exact code patterns for `/start`, `/callback`, `/api/auth/config`; §"AUTH_MODE Switch" — route-gating patterns; §"Anti-Patterns to Avoid" — all 6 (especially AP-1 OIDC config in db.ts, AP-2 sessionStore importing oidc.ts, AP-5 per-request metadata fetch)
- `.planning/research/FEATURES.md` TS-2 through TS-8, TS-17, TS-18, D-1 (nonce — INCLUDED), D-2 (store id_token — already locked by Phase 4 + MODE-06)

### Critical pitfalls (every one MUST be addressed)
- `.planning/research/PITFALLS.md` C-01 (decode vs verify — CRITICAL; use `client.callback()` not raw `jwt.decode()`)
- `.planning/research/PITFALLS.md` C-02 (state CSRF — CRITICAL; `oidc_state` cookie + `timingSafeEqual` check)
- `.planning/research/PITFALLS.md` C-03 (nonce replay — CRITICAL; single-use, cleared on callback)
- `.planning/research/PITFALLS.md` C-04 (aud claim — CRITICAL; must equal `AUTH_OIDC_CLIENT_ID`)
- `.planning/research/PITFALLS.md` C-05 (iss claim + trailing slash — CRITICAL; normalize at boot)
- `.planning/research/PITFALLS.md` C-06 (JWKS cache stale after rotation — handled by openid-client; ~10min cache TTL recommended)
- `.planning/research/PITFALLS.md` C-07 (redirect_uri pinning — CRITICAL; env var only, never request-derived)
- `.planning/research/PITFALLS.md` T-01 (encrypt access token — CRITICAL; reuses Phase 4 `encryptSecret` path via `createSession`)
- `.planning/research/PITFALLS.md` T-02 (id_token vs access_token for claims — CRITICAL; ONLY id_token claims for username)
- `.planning/research/PITFALLS.md` T-03 (empty username — HIGH; map to `oidc_no_username`)
- `.planning/research/PITFALLS.md` T-04 (scopes too narrow — request `openid profile`)
- `.planning/research/PITFALLS.md` T-05 (opaque access token warning — log warning if access_token is opaque, not JWT)
- `.planning/research/PITFALLS.md` T-06 (clock skew — `clockTolerance: 30` on token verification)
- `.planning/research/PITFALLS.md` O-01 (issuer trailing slash normalization at boot)
- `.planning/research/PITFALLS.md` O-03 (redirect_uri dev/prod mismatch — env-var driven)

### Phase 4 contract (consumed by Phase 5)
- `.planning/phases/04-schema-sessionstore-foundation/04-CONTEXT.md` — locked decisions on `createSession({ ..., credentialType, idToken })` options-object signature, `SessionRow` shape, `id_token` columns
- `.planning/phases/04-schema-sessionstore-foundation/04-02-SUMMARY.md` — `createSession` final signature reference
- `.planning/phases/04-schema-sessionstore-foundation/04-03-SUMMARY.md` — `AuthedRequest` flat shape (Phase 6 consumer; Phase 5 only needs to know that creating an OIDC session leaves the right `credential_type` value in the row)

### v1.1 open questions to resolve at planning kickoff (NOT user-decision questions)
- `.planning/STATE.md` §"v1.1 Open Questions" — `npm show openid-client version` to confirm v5 still stable, opaque vs JWT access token format with IdP owner, dev vs prod redirect URL registration, claim-to-username mapping confirmation. Planner addresses these as planning-time spikes, not user gray areas.

### Existing code (read before editing)
- `kinetica_bi/server/src/index.ts` — `createApp`, `requireConfig`, `asyncHandler` pattern, route mount order; pre-auth routes (login, logout, me); `app.use("/api", requireAuth)` boundary
- `kinetica_bi/server/src/auth.ts` — `issueSessionCookie` (line 86), `clearSessionCookie`, `decodeAndVerifyJwt` `v: 1` invariant (line 118), `AuthedRequest` type
- `kinetica_bi/server/src/sessionStore.ts` — `createSession` options-object signature (Phase 4), `encryptSecret`, `SessionRow.idToken: string | null`
- `kinetica_bi/server/package.json` — confirm `openid-client` not yet installed; tsx watch dev script reads from src/index.ts
- `kinetica_bi/server/tests/auth.routes.spec.ts` — supertest pattern for route tests, env-stubbing approach
- `kinetica_bi/server/tests/bootstrap.spec.ts` — boot-time validation test pattern (extend for `validateOidcEnv` failure path)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`createSession` (Phase 4 options-object)** — accepts `{ username, secret, kineticaUrl, credentialType: 'oidc', idToken }` directly. Phase 5 wires this from the callback handler.
- **`issueSessionCookie(res, username, sid)`** (`auth.ts:86`) — unchanged from v1.0; reused exactly for OIDC sessions.
- **`asyncHandler<T>(fn)`** (`index.ts:75`) — wraps async handlers to forward errors to error middleware. Use for the async `/oidc/callback` route.
- **`requireConfig` middleware** (`index.ts:64`) — boot-time env validation pattern. Extend with `AUTH_OIDC_*` validation when `AUTH_MODE === 'oidc'` (or do this once at `createApp()` in a parallel `validateOidcEnv()` call).
- **`randomBytes` from `node:crypto`** (already used in `sessionStore.ts:52`) — generate state + nonce.
- **`encryptSecret` / `decryptSecret`** (Phase 4 rename) — used implicitly by `createSession` for both access token + id_token. Phase 5 doesn't call these directly.
- **Existing supertest pattern** (`tests/auth.routes.spec.ts`) — request agent + cookie jar setup; copy this shape for OIDC route tests.
- **`vi.stubEnv` pattern** in tests for setting `AUTH_MODE` per spec file.

### Established Patterns
- **Pre-auth routes mounted before `app.use("/api", requireAuth)`** — `/api/auth/login`, `/logout`, `/me`. New: `/api/auth/oidc/start`, `/oidc/callback`, `/auth/config`.
- **Boot validation: loud-failure** — `requireConfig` returns 500 on missing `KINETICA_URL`. Extension pattern: `validateOidcEnv()` throws synchronously at `createApp()`, before `app.listen`.
- **In-process module-level cache** — used in `sessionStore.ts` (prepared statements at module top). New: `let _metadata: OidcMetadata | null = null` in `oidc.ts` for discovery cache.
- **Error response shape** — `{ error: string, code?: string }` JSON. The `code` field is consumed by `apiFetch` for `REAUTH_REQUIRED` dispatch (v1.0 Phase 3).
- **httpOnly cookie pattern** — `auth.ts:97` `kbi_session` cookie sets `httpOnly: true, sameSite: "lax", secure: NODE_ENV === "production", path: "/"`. New `oidc_state` cookie mirrors this exactly with shorter `maxAge`.
- **No-prefix internal modules** — `auth.ts`, `kinetica.ts`, `sessionStore.ts`, `db.ts`. New: `oidc.ts` (no `oidcClient.ts` or `auth/oidc.ts` subfolder).

### Integration Points
- **`src/oidc.ts`** (NEW) — exports `validateOidcEnv()`, `getOidcMetadata()`, `buildAuthorizationUrl(state, nonce)`, `exchangeCode(code, expectedState, expectedNonce)`, `extractUsername(claims)`. Module-level singleton state for discovery cache.
- **`src/index.ts`** — `createApp()` body extended:
  - Read `authMode` const from `process.env.AUTH_MODE` once at top of `createApp()`.
  - When `authMode === 'oidc'`: call `await validateOidcEnv()` and `await getOidcMetadata()` at boot (fail-fast per Phase 5 SC6). When password mode: skip OIDC config validation entirely.
  - Mount `GET /api/auth/config` BEFORE `app.use("/api", requireAuth)` regardless of mode.
  - Mount `GET /api/auth/oidc/start` and `GET /api/auth/oidc/callback` BEFORE `app.use("/api", requireAuth)` regardless of mode (returns 400 in password mode).
  - `POST /api/auth/login` handler gets a guard `if (authMode !== 'password') return res.status(400).json({ error: 'Password login is disabled. Use OIDC.' });` at the top.
- **`createApp()` signature may become async** if `validateOidcEnv()`/`getOidcMetadata()` are awaited at boot. Existing `index.ts` exports `createApp` synchronously. Either: make `createApp` return `Promise<Express>` (touches `bootstrap.spec.ts` and any other consumer), or do the OIDC discovery as a fire-and-forget that surfaces errors via a startup-state flag. Planner picks the cleanest route — recommend async `createApp()` since the change is localized and fail-fast at boot is the locked behavior.
- **`package.json`** — add `openid-client` to `dependencies`. Run `npm install openid-client@^5` from `kinetica_bi/server/`. Lockfile updated. No new devDependencies.
- **`.env.example`** — extend with the 6 new `AUTH_OIDC_*` env vars listed in STACK.md §"New Environment Variables". Document each.

</code_context>

<specifics>
## Specific Ideas

- **The cookie pattern locks `oidc_state` to one named cookie carrying both state and nonce as JSON.** No separate `oidc_nonce` cookie. One name, one read, one clear.
- **Friendly error codes are stable strings** in `/login?error=<code>` URLs. Phase 7 frontend banner-rendering tests will assert these literal codes. Don't rename them mid-stream.
- **Inactive-route 400 messages should be short and neutral** — "Password login is disabled." / "OIDC is not enabled." Don't include env-var names or stack hints in user-facing JSON.
- **The success redirect target for `/oidc/callback` is `/` (app root)** — frontend bootstrap (Phase 7) handles routing the user from there. Phase 5 doesn't implement return-to-page (UX-06, Phase 7's TS-14).
- **No new icons / images / button styles** — Phase 5 is backend-only. Any frontend asset is Phase 7.

</specifics>

<deferred>
## Deferred Ideas

- **`buildAuthHeader` Bearer/Basic branch in `kinetica.ts`** — Phase 6 (MODE-04, UX-04, UX-05).
- **Token expiry early-detection in `getSession`** — Phase 6 (UX-05; PITFALLS I-07).
- **`auth_mode` field in audit log** — Phase 6 (OBS-02).
- **Frontend `LoginPage` SSO button + `?error` banner rendering** — Phase 7 (OIDC-01, UX-06, UX-08). Phase 5 emits the codes; Phase 7 renders the messages locked above.
- **`fetchAuthConfig` helper + `authMode` in Zustand store** — Phase 7.
- **Return-to-page after re-auth (sessionStorage approach)** — Phase 7 (UX-06).
- **`/api/auth/me` response includes `authMode`** — Phase 7 (UX-08, D-3).
- **Boot-time AUTH_MODE-change session wipe** — Phase 8 (MODE-05).
- **DEPLOY-RUNBOOK.md OIDC trust section** — Phase 8 (OPS-01).
- **Refresh-token storage** — explicitly rejected for v1.1 (FEATURES AF-2; OIDC-V2-01).
- **PKCE** — explicitly rejected for v1.1 (FEATURES AF-1; OIDC-V2-04).
- **RP-initiated logout** — explicitly rejected for v1.1 (FEATURES AF-4; OIDC-V2-02).
- **`AUTH_OIDC_ISSUER_LABEL` env var for branded SSO button** — out of scope; bare `{authMode}` config response is sufficient. Could revisit if the team requests SSO button customization.
- **Live unreachable-URL integration test for discovery** — rejected (CI flakiness). Mock-rejected-promise covers the failure path.
- **Fake IdP HTTP server in tests** — rejected (3x more code, marginal coverage gain over openid-client mock).

</deferred>

---

*Phase: 05-oidc-module-routes*
*Context gathered: 2026-04-30*
