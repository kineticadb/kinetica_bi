# Domain Pitfalls: v1.1 OIDC SSO — Adding to Existing Password Auth

**Domain:** Adding OIDC SSO to a BI app with a mature v1.0 password auth system
**Researched:** 2026-04-28
**Confidence:** HIGH — grounded in codebase analysis of `auth.ts` / `sessionStore.ts` + established OIDC security corpus

---

> **Scope note:** These pitfalls are specific to *adding* OIDC to an existing system that already ships AES-256-GCM encrypted session rows, per-user Kinetica credential passthrough, and a typed-error/401-REAUTH dispatch chain. Generic OIDC tutorials are not the target here. Every pitfall is anchored to something in this codebase.

---

## Critical Pitfalls

### Pitfall C-01: ID Token Decoded But Not Signature-Verified — Using a JWT Library's "Decode" Path Instead of "Verify"

**What goes wrong:**
The server receives an `id_token` (a JWT) from the IdP token endpoint. A developer reaches for a JWT library and calls `jwt.decode(idToken)` to extract claims. This succeeds and returns the payload, but it performs NO cryptographic verification. A tampered or forged token (with any username claim) passes silently. The `jsonwebtoken` package already in the dependency list has both `jwt.decode()` (no verification) and `jwt.verify()` (verifies signature). Using the wrong one is a single-word mistake that passes all smoke tests.

**Why it happens:**
`jwt.decode()` is faster to reach for, doesn't require a key, and produces the same payload shape as `jwt.verify()`. The distinction is invisible in test environments where tokens come from a real IdP — the decode always "works."

**Root cause:** The difference between decode and verify is a one-word API choice. `auth.ts` already calls `jwt.verify()` for the session cookie — the same discipline must be applied to the id_token, but against the IdP's JWKS, not `AUTH_SECRET`.

**Prevention:**
- Never call `jwt.decode()` on the id_token. Call `jwt.verify(idToken, getKey, { algorithms: ['RS256'] })` with a JWKS key provider.
- Write a test that passes a token with a tampered payload and asserts the callback returns 401.
- JWKS key provider: use `jwks-rsa` (or equivalent) with `cache: true` to fetch public keys from `{issuer}/.well-known/jwks.json`.

**Phase:** OIDC callback handler implementation (Phase that adds `/api/auth/oidc/callback`).

**Looks Done But Isn't:** YES — login works end-to-end in smoke tests because the real IdP sends a validly-signed token. A forged token is never tested in normal flows.

---

### Pitfall C-02: State Parameter Not Verified — Authorization Code CSRF / Mix-Up Attack

**What goes wrong:**
The OIDC flow starts at `/api/auth/oidc/start`. The server generates a `state` value, redirects to the IdP with `?state=<value>`, and the IdP echoes that state back to `/api/auth/oidc/callback?code=...&state=<value>`. If the callback handler does not verify that the returned state matches what was sent, an attacker can craft a link that redirects a victim's browser to the callback with an attacker-controlled `code`, binding the victim's session to the attacker's identity (login CSRF). The mix-up attack variant allows a malicious IdP to inject its code into a callback meant for a legitimate IdP.

**Why it happens:**
State verification feels ceremonial in a single-IdP setup. It's easy to skip and all normal flows still work.

**Root cause:** The `state` value must be generated server-side, stored transiently (in a short-lived cookie or server-side map keyed by the pre-auth session), and verified byte-for-byte when the callback arrives. Any mismatch must return 400 and abort.

**Prevention:**
- Generate `state` as `randomBytes(32).toString('hex')`.
- Store it in a short-lived `kbi_oauth_state` cookie (httpOnly, sameSite: lax, maxAge: 10 minutes).
- In the callback: compare `req.query.state` against the cookie value using `crypto.timingSafeEqual`. Clear the cookie regardless.
- Write a test that POSTs to the callback with a mismatched state and asserts 400.

**Phase:** OIDC start + callback routes.

**Looks Done But Isn't:** YES — normal flows never mismatch. This only fails under attack or when someone refreshes an old callback URL.

---

### Pitfall C-03: Nonce Not Used — ID Token Replay Attack

**What goes wrong:**
If no `nonce` is sent in the authorization request, and not validated in the id_token claims, a captured id_token can be replayed. An attacker who intercepts a token (via log leakage, IdP misconfiguration, or network sniffer on non-TLS) can replay it to create a new session under the victim's identity.

**Why it happens:**
Nonce is optional in many OIDC introductions. Some IdP UIs don't show nonce as a required field. It's skipped in quickstarts.

**Prevention:**
- Generate `nonce` as `randomBytes(32).toString('hex')` in `/api/auth/oidc/start`.
- Send it in the authorization URL and store it alongside `state` (same short-lived cookie, or a separate one).
- In the callback: verify `idToken.nonce === storedNonce` before accepting the token.
- The nonce should be one-time-use: delete it after first successful verification.

**Phase:** OIDC start + callback routes (same phase as C-02).

**Looks Done But Isn't:** YES — replay attacks don't surface in smoke tests.

---

### Pitfall C-04: Audience (`aud`) Claim Not Validated — Token Accepted From Another Client

**What goes wrong:**
The id_token's `aud` claim must equal this application's `CLIENT_ID`. If the aud claim is not validated, a token issued to a different client application at the same IdP can be accepted by this server. This matters in multi-application IdP deployments (common when organizations add the BI app alongside an existing SSO portal).

**Why it happens:**
The JWT payload looks valid (right issuer, right user), so developers assume it's fine. The `aud` check is a one-liner that's easy to omit.

**Prevention:**
Pass `audience: process.env.AUTH_OIDC_CLIENT_ID` to `jwt.verify()` options. The library enforces it automatically. Write a test with a token whose `aud` is a different client ID and assert 401.

**Phase:** OIDC callback handler.

**Looks Done But Isn't:** YES — in single-app IdP setups, every token you receive has the right aud anyway. This only fails when you get a token meant for another app.

---

### Pitfall C-05: Issuer (`iss`) Claim Not Validated — Token From Rogue IdP Accepted

**What goes wrong:**
The `iss` claim must exactly match `AUTH_OIDC_ISSUER`. Without this check, a token signed by a different IdP (or by the attacker's own JWKS endpoint) can be accepted if the server fetches JWKS from the wrong location. Trailing slashes are a common cause: `https://idp.example.com` vs `https://idp.example.com/` will cause an iss mismatch even with a legitimate token, OR a server that normalizes both will accept tokens from either.

**Why it happens:**
Issuer mismatches surface as "token not accepted" errors during integration. Developers often "fix" this by relaxing the check rather than normalizing the URL consistently.

**Root cause:** The OIDC spec is explicit that `iss` must match exactly. Normalization must happen in the config validation layer (strip trailing slash at boot), not in the comparison.

**Prevention:**
- Strip trailing slash from `AUTH_OIDC_ISSUER` at boot time in config validation — before it's stored anywhere.
- Pass `issuer: normalizedIssuer` to `jwt.verify()`.
- Write a test with a token whose `iss` differs by a trailing slash and assert 401.
- Write a test with a token from a completely different issuer and assert 401.

**Phase:** Boot config validation + OIDC callback handler.

**Looks Done But Isn't:** MIXED — trailing slash mismatch surfaces immediately in integration. Rogue issuer acceptance only surfaces under attack.

---

### Pitfall C-06: JWKS Cache Serves a Stale Key After IdP Cert Rotation

**What goes wrong:**
The JWKS key provider caches public keys to avoid fetching `/.well-known/jwks.json` on every request. When the IdP rotates its signing certificates (routine operation, also emergency rotation after a breach), the cached key no longer matches new tokens. Every login attempt fails with "invalid signature" until the cache expires or is invalidated. In the worst case, the cache TTL is set to 24h and the app is unusable for a day.

**Why it happens:**
Default `jwks-rsa` cache TTL is often set to a large value for performance. IdP cert rotation timing is unpredictable from the app's perspective.

**Prevention:**
- Use `jwks-rsa` with `{ cache: true, cacheMaxAge: 600_000, jwksRequestsPerMinute: 5, rateLimit: true }` — 10 minute cache max.
- Enable `jwks-rsa`'s `cacheMaxEntries` to bound memory.
- On a signature verification failure, retry once with `cache: false` (key rotation race window). If the second attempt succeeds, log a warning "JWKS key rotated mid-flight."
- Document: "If logins break after an IdP cert rotation, restart the BI server to flush the JWKS cache."

**Phase:** OIDC callback handler + operational runbook.

**Looks Done But Isn't:** YES — smoke tests use a stable IdP cert. Rotation is an operational event.

---

### Pitfall C-07: `redirect_uri` Not Pinned — Open Redirect / Token Leakage

**What goes wrong:**
The `redirect_uri` sent to the IdP in the authorization request must be registered at the IdP AND must be validated server-side when the callback arrives. If the server constructs `redirect_uri` dynamically from `req.headers.host` (or worse, from a query parameter), an attacker can manipulate the host header to redirect the authorization code to an attacker-controlled server.

**Why it happens:**
Developers build `redirect_uri` from the request hostname to "automatically support dev and prod URLs." This is the open-redirect vector.

**Prevention:**
- Hardcode `redirect_uri` from the `AUTH_OIDC_REDIRECT_URI` env var — never derive it from the request.
- At boot, validate that `AUTH_OIDC_REDIRECT_URI` matches the registered redirect URI at the IdP.
- Dev and prod MUST have different `AUTH_OIDC_REDIRECT_URI` values (`http://localhost:5173/...` vs `https://bi.example.com/...`).
- Write a boot-time assertion that `AUTH_OIDC_REDIRECT_URI` is set and is an absolute HTTPS URL in production (`NODE_ENV === 'production'`).

**Phase:** OIDC config validation (boot) + start/callback routes.

**Looks Done But Isn't:** MIXED — dev/prod mismatch surfaces immediately. Open redirect requires an attacker to exercise it.

---

## Integration Pitfalls

### Pitfall I-01: `req.user.creds` Shape Collision — Password Field Populated With Access Token

**What goes wrong:**
The existing `requireAuth` middleware populates `req.user.creds` as `{ username: string; password: string }`. The `kineticaSql` and `kineticaWms` helpers consume `req.user.creds.password` to build the `Authorization: Basic` header. In OIDC mode, the session row will store an encrypted access token (not a password). If the helper is carelessly extended to check `creds.password` first and fall through to a token field, a type mismatch causes every Kinetica call to send `Authorization: Basic base64(username:undefined)` — which Kinetica rejects with 401. This produces a loop: OIDC login succeeds, session created, but every Kinetica API call fails, routing the user back to login indefinitely.

**Why it happens:**
The `AuthedRequest.user.creds` type has a `password` field. The natural OIDC extension adds a `token` field alongside it. If the helper checks `if (creds.password)` to decide which auth scheme to use, and the OIDC session has `password: ""` or `password: undefined`, Basic auth is sent with an empty credential.

**Root cause:** The `creds` discriminant is the credential *type*, not whether a field is truthy.

**Prevention:**
- Add a discriminated union to the session type: `{ type: 'password'; username: string; password: string } | { type: 'oidc'; username: string; token: string }`.
- `kineticaSql` / `kineticaWms` switch on `creds.type === 'oidc'` to build `Authorization: Bearer` vs `Authorization: Basic`.
- The TypeScript compiler will error if a branch doesn't handle both cases — this is the test.
- Never use `if (creds.password)` as the discriminant.

**Phase:** Helper layer update (the phase that modifies `kineticaSql` / `kineticaWms`).

**Looks Done But Isn't:** YES — OIDC login succeeds in smoke tests. The failure only shows when a Kinetica API call is made after login. This is caught if the smoke test exercises a real query, but not if it only calls `/api/auth/me`.

---

### Pitfall I-02: `requireAuth` Dispatch Order Breaks for OIDC Sessions — `creds.password` Populated With Stale Data

**What goes wrong:**
`requireAuth` in `auth.ts` (line 174) populates `req.user.creds` with `{ username: session.username, password: session.password }`. In OIDC mode, `session.password` is the decrypted *access token* (stored in the password column by the OIDC session creation path). This means `kineticaSql` receives `Authorization: Basic base64(username:accessToken)` — a valid-looking Base64 blob that Kinetica cannot interpret as a bearer token.

**Why it happens:**
The session schema reuses the existing `ciphertext/iv/auth_tag` columns to store the access token (since the encryption pattern is identical). But `requireAuth` unconditionally reads the decrypted value into `creds.password`. Without a `credential_type` discriminator in the session row, the helper has no way to tell what the encrypted blob contains.

**Root cause:** The sessions table schema has no `credential_type` column. Both auth modes produce the same row shape.

**Prevention:**
- Add `credential_type TEXT NOT NULL DEFAULT 'password'` to the sessions schema (migration required).
- `getSession()` returns this field in `SessionRow`.
- `requireAuth` builds `req.user.creds` using the discriminated union: if `session.credentialType === 'oidc'`, populate `{ type: 'oidc', token: session.password }`.
- SQLite migration: `ALTER TABLE sessions ADD COLUMN credential_type TEXT NOT NULL DEFAULT 'password'` — safe because all existing rows ARE password rows.
- Write a unit test: create an OIDC session row, call `requireAuth`, assert `req.user.creds.type === 'oidc'`.

**Phase:** Session schema + `requireAuth` update (early in OIDC implementation).

**Looks Done But Isn't:** YES — this is the #1 "login works, everything else fails" failure mode.

---

### Pitfall I-03: AUTH_MODE-Change Wipes Sessions at Boot But Frontend State Cache Survives

**What goes wrong:**
Boot-time detection of `AUTH_MODE` change wipes the sessions table (the v1.0 pattern, already in scope). The server restarts in OIDC mode. The frontend has a Zustand `authStore` that hydrated from a successful `/api/auth/me` during the previous password-mode session. After the server wipe, the old `kbi_session` cookie is still present in the browser. The frontend doesn't re-fetch `/api/auth/me` on boot (it trusts its in-memory Zustand state). The first API call returns 401 with `code: REAUTH_REQUIRED`, and the frontend correctly redirects to login — but now the login page shows a password form (old frontend cache), not an OIDC redirect button. If the frontend fetches `/api/auth/mode` to decide which login UI to render, it gets the new mode. If it doesn't, the user sees a broken password login that always fails.

**Why it happens:**
Zustand persists auth state in memory (not localStorage in this app), but the *login page rendering* may branch based on a stale config assumption. If `AUTH_MODE` is baked into the frontend at build time (via Vite's `VITE_AUTH_MODE`), changing it requires a rebuild+redeploy.

**Root cause:** The frontend must not bake `AUTH_MODE` as a compile-time constant. It must query `/api/auth/mode` (or equivalent) at runtime.

**Prevention:**
- Expose `GET /api/auth/mode` → `{ mode: 'password' | 'oidc' }` — no auth required.
- The `LoginPage` component fetches this endpoint on mount to decide which UI to show.
- Never pass `AUTH_MODE` as a `VITE_` env var that gets bundled into the frontend.
- Write a test: start server with `AUTH_MODE=oidc`, hit `/api/auth/mode`, assert `{ mode: 'oidc' }`.

**Phase:** Frontend login page + `/api/auth/mode` endpoint (early in OIDC implementation).

**Looks Done But Isn't:** YES — developer always tests in the mode the server is configured for. The flip scenario requires deliberately switching modes, which is only done during deployment.

---

### Pitfall I-04: Session Cookie Survives AUTH_MODE Change — Half-Authenticated State

**What goes wrong:**
The server wipes the sessions table on AUTH_MODE change. But the browser still holds the `kbi_session` JWT cookie from the previous mode. The next request sends this cookie to `requireAuth`. The JWT signature is valid (AUTH_SECRET didn't change), `v: 1` passes, but `getSession(sid)` returns null because the row was deleted. `requireAuth` clears the session cookie (line 162 of `auth.ts`: `clearSessionCookie(res)`). So far so good — EXCEPT: the frontend's first request is to `/api/auth/me`, which returns 401. If the frontend's bootstrap logic treats a `/api/auth/me` 401 as "silent logged out" (renders blank) rather than routing to login, the user sees a white screen.

**Why it happens:**
`apiFetch` dispatches `REAUTH_REQUIRED` on `code: "REAUTH_REQUIRED"`. But `/api/auth/me` may return a plain 401 without the `code` field (depends on whether it goes through `requireAuth` which sends `REAUTH_RESPONSE`). Since `requireAuth` DOES send `REAUTH_RESPONSE`, the dispatch should work — but this seam must be tested across the mode-flip scenario, not just the normal logout scenario.

**Prevention:**
- Test the full mode-flip cycle: seed a password session → restart server with AUTH_MODE=oidc → verify browser gets redirected to OIDC login page, not white screen.
- This is an E2E test, not a unit test. Flag as a manual UAT check if not automated.

**Phase:** Boot AUTH_MODE detection + frontend bootstrap (integration test phase).

**Looks Done But Isn't:** YES — the happy path (never flip modes) always passes.

---

### Pitfall I-05: Phase 1 Cookie `v: 1` Version Field Collides With Future Version Bump

**What goes wrong:**
`decodeAndVerifyJwt` in `auth.ts` (line 118) checks `decoded.v !== 1` and rejects cookies that don't match. This is the correct v1.0 migration guard (P4 comment in the code). When OIDC mode is added and the session payload schema changes (e.g., to carry `credentialType`), there is a temptation to bump `v` to `2` in the JWT cookie payload. If the check is updated to `decoded.v !== 2`, all v: 1 cookies (existing password-mode sessions after an in-place upgrade that did NOT flip modes) are silently rejected, logging everyone out.

**Why it happens:**
Version bumps during a mode that doesn't change AUTH_MODE are unexpected. Developers think "I only added OIDC, why did password sessions break?"

**Root cause:** The `v` field in the JWT cookie payload is a schema version, not a mode indicator. Adding OIDC mode shouldn't change the cookie schema if the session row lookup (by sid) handles the discriminant.

**Prevention:**
- Do NOT bump the JWT cookie `v` field for OIDC. The cookie payload remains `{ sub, sid, v: 1 }` regardless of mode.
- The `credential_type` discriminant lives in the *session row*, not in the cookie.
- If a future version of the cookie schema genuinely changes, bump `v` to `2` AND wipe sessions at the same time (same pattern as AUTH_MODE change detection).
- Document this invariant in `auth.ts` above `decodeAndVerifyJwt`.

**Phase:** Auth.ts extension (when OIDC session creation is implemented).

**Looks Done But Isn't:** NO — this causes an immediate regression if the version is bumped. It will show in unit tests.

---

### Pitfall I-06: Typed-Error Middleware Missing a Bearer-Token Error Category

**What goes wrong:**
The v1.0 typed-error taxonomy is `KineticaAuthError → 401-REAUTH` / `KineticaPermissionError → 403` / `KineticaUpstreamError → 502`. In OIDC mode, Kinetica receives `Authorization: Bearer <token>` and has its own OIDC trust configuration. If Kinetica's trust is misconfigured (wrong issuer, wrong audience on Kinetica's side), Kinetica returns a 401 that looks identical to a credential failure. The existing middleware maps Kinetica 401 → `KineticaAuthError` → `REAUTH_REQUIRED`. The user gets kicked to login, logs in again, gets a fresh token, calls Kinetica, gets 401 again — an infinite re-auth loop. The actual root cause (Kinetica OIDC trust misconfigured) is invisible to the user.

**Why it happens:**
The 401 from Kinetica is ambiguous between "your token expired" and "your token is valid but Kinetica doesn't trust this IdP." The existing error taxonomy has no way to distinguish these.

**Root cause:** Kinetica doesn't return a disambiguating error body in the OIDC-trust-failure case (it returns 401 either way). The BI app can't introspect whether the token itself is expired vs. Kinetica's trust config is broken.

**Prevention:**
- In the OIDC callback handler, locally validate the token's `exp` claim before creating the session. If the token is already expired when received (clock skew or slow redirect), reject at callback time, not at first Kinetica call.
- Add a startup check: after booting in OIDC mode, make a test Kinetica call with a sentinel. If it returns 401, log a structured warning: `"Kinetica returned 401 on OIDC test call — check Kinetica OIDC trust configuration (issuer, audience)."` This is a deploy-time check, not per-request.
- In the runbook: document that `REAUTH_REQUIRED` loops in OIDC mode indicate Kinetica OIDC trust misconfiguration, not user error.
- The audit log (OBS-01) should log `credential_type: 'oidc'` per Kinetica call so the pattern is visible in logs.

**Phase:** OIDC callback handler + operational runbook + typed-error documentation.

**Looks Done But Isn't:** YES — smoke test passes if Kinetica trust IS configured. The misconfigured trust scenario only surfaces in a new environment where the DBA forgot to configure Kinetica's IdP trust.

---

### Pitfall I-07: `requireAuth` Does Not Re-Validate Token Expiry — Kinetica Gets an Expired Bearer Token

**What goes wrong:**
In password mode, a session has an 8h TTL and `requireAuth` checks the session row's `expires_at` (via `getSession` which calls `isExpired`). In OIDC mode, the access token inside the session row has its own `exp` claim — typically 1h (IdP-configured). The session row may still be "valid" (within its 8h TTL), but the stored access token is expired. `requireAuth` passes the session row check, populates `req.user.creds.token`, and `kineticaSql` sends the expired bearer token to Kinetica. Kinetica returns 401. The typed-error middleware maps this to `REAUTH_REQUIRED`, and the frontend re-initiates the OIDC flow. This is the intended behavior — but only if the 401-REAUTH chain works correctly in OIDC mode. If the frontend's re-auth redirects to the IdP, obtains a fresh token, creates a new session, and THEN the old session row is still in the table (not cleaned up), two session rows exist for the same user — the old one with an expired token, the new one with a fresh one. GC sweep eventually cleans the old one. No correctness issue, but it's a session leak pattern.

**Why it happens:**
The 8h session row TTL and the token's `exp` TTL are independent clocks.

**Prevention:**
- In `getSession()` (or in `requireAuth`), for OIDC sessions: decode the token (without re-verifying signature — it was verified at callback time) and check `exp`. If expired, delete the session row and return null → triggers REAUTH_REQUIRED immediately, before the call reaches Kinetica.
- This avoids a round-trip 401 from Kinetica for the common token-expiry case.
- Alternatively: store the token's `exp` value as a separate column `token_expires_at` and check it in `isExpired()` logic alongside the session's own `expires_at`.
- Write a test: create an OIDC session with a token whose `exp` is in the past, call `getSession`, assert null.

**Phase:** `sessionStore.ts` update + `requireAuth` extension.

**Looks Done But Isn't:** MIXED — the 401-REAUTH loop still works (functionally correct). The session leak is a mild ops concern. The expired-token check is a performance/UX optimization that prevents an unnecessary Kinetica round-trip.

---

## Token-Specific Pitfalls

### Pitfall T-01: Storing the Access Token Unencrypted or With a Weaker Pattern Than Passwords

**What goes wrong:**
`sessionStore.ts` uses AES-256-GCM with a per-row fresh IV (`randomBytes(12)`) to encrypt passwords. The access token must receive the same treatment. A developer might store the access token as plaintext (it "looks public" — it's a JWT), as a simple hash, or by reusing the same IV across rows. Any of these weakens the at-rest protection that was the v1.0 security achievement.

**Why it happens:**
JWTs are base64-encoded and look like they contain no secret. Access tokens *are* secrets — possessing one is equivalent to being that user.

**Prevention:**
- Reuse `encryptPassword()` / `decryptPassword()` from `sessionStore.ts` verbatim for access tokens. The function is already well-tested and uses a fresh IV per call.
- The column names `ciphertext / iv / auth_tag` are mode-agnostic — no schema change needed for the encryption itself.
- Explicitly document in code comments: "access token encrypted identically to password; see encryptPassword()."
- Code review checklist: confirm no `INSERT INTO sessions` path stores plaintext in the ciphertext column.

**Phase:** OIDC session creation (the `createSession` call site for OIDC callbacks).

**Looks Done But Isn't:** YES — the encryption is invisible to functional tests. A token stored as plaintext produces identical runtime behavior.

---

### Pitfall T-02: Using the Access Token for Identity Claims Instead of the ID Token

**What goes wrong:**
The OIDC Authorization Code flow returns both an `access_token` and an `id_token` from the token endpoint. The `id_token` is signed by the IdP and contains the user identity claims (`sub`, `preferred_username`, `email`, etc.). The `access_token` is for *authorization* against the resource server (Kinetica in this case) — it may be an opaque string at some IdPs, and its claims are not guaranteed to follow the OIDC spec.

Extracting `username` from the `access_token` instead of the `id_token` fails when:
- The IdP issues opaque (non-JWT) access tokens (valid per spec).
- The access_token doesn't include the configured `AUTH_OIDC_USERNAME_CLAIM`.
- The access_token audience is the Kinetica resource server, not the BI app.

**Why it happens:**
Both tokens arrive together in the same response. Access tokens look like JWTs at most IdPs (Keycloak, Auth0, Okta all issue JWT access tokens by default). Developers `jwt.decode()` whichever one is handy.

**Prevention:**
- Always extract identity claims from the `id_token`, not the `access_token`.
- The `id_token` is what you verify with JWKS (C-01 through C-05 above).
- The `access_token` is what gets encrypted and stored as the session credential for Kinetica.
- Write a test with an IdP mock that returns an opaque access_token (a random string, not a JWT) alongside a valid id_token — assert that session creation succeeds and the username is extracted from the id_token.

**Phase:** OIDC callback handler.

**Looks Done But Isn't:** YES — with Keycloak/Auth0/Okta in dev, access tokens happen to be JWTs with user claims, so the wrong code path works. Fails when switching IdPs.

---

### Pitfall T-03: Configurable Username Claim Returns Empty String — Silent Username Collision

**What goes wrong:**
`AUTH_OIDC_USERNAME_CLAIM` defaults to `preferred_username`. If the IdP doesn't populate that claim (some IdPs omit it), the extracted username is `undefined`. If the fallback is `''` (empty string), `createSession('', token, url)` creates a session row with `username = ''`. Every OIDC user who gets an empty username maps to the same session namespace. If `AUTH_OIDC_USERNAME_REGEX` transform produces an empty string (e.g., the regex has no capture group match), same problem.

**Why it happens:**
The happy path always returns a non-empty username. The empty-string case is only exercised when the IdP is misconfigured or the wrong claim is configured.

**Prevention:**
- After extracting the username claim and applying the regex transform, validate: `if (!username || username.trim() === '') → return 400 and abort`.
- Log a structured error: `"OIDC username claim '${claimName}' is absent or empty in id_token. Configure AUTH_OIDC_USERNAME_CLAIM."`.
- Write a test with an id_token that has no `preferred_username` claim — assert 400 and a log message, not a session row with empty username.
- Write a test with a regex that produces no match — assert same.

**Phase:** OIDC callback handler (claim extraction + regex transform).

**Looks Done But Isn't:** YES — developer tests with an IdP that has `preferred_username` set. The missing-claim case only surfaces with a new IdP or misconfigured claim mapping.

---

### Pitfall T-04: Scopes Too Narrow — `preferred_username` Claim Not Returned

**What goes wrong:**
The default OIDC scope is `openid`. With only `openid`, the id_token contains `sub` (subject UUID) but typically not `preferred_username`, `email`, or `name`. If `AUTH_OIDC_USERNAME_CLAIM` is set to `preferred_username` and the authorization request only requests `openid` scope, the claim is absent (T-03 above fires).

**Why it happens:**
OIDC `openid` scope is the minimum required. Profile claims require `profile` scope. Many docs show `openid` as a complete example.

**Prevention:**
- Request `openid profile email` by default.
- Document in the runbook that if the configured claim is absent, add the required scope to `AUTH_OIDC_SCOPE`.
- Make the scope configurable via `AUTH_OIDC_SCOPE` env var with default `openid profile email`.

**Phase:** OIDC start route + config documentation.

**Looks Done But Isn't:** MIXED — `sub` is always present, so login works if `AUTH_OIDC_USERNAME_CLAIM=sub`. Breaks when claim is `preferred_username` and scope is too narrow.

---

### Pitfall T-05: Opaque Access Token Passed to Kinetica — Kinetica Rejects It

**What goes wrong:**
This project sends `Authorization: Bearer <access_token>` to Kinetica. Some IdPs (or IdP configurations) return opaque (non-JWT) access tokens. Kinetica's OIDC trust configuration expects a JWT with specific claims (`iss`, `aud`, `sub`). An opaque token fails Kinetica's token validation immediately, returning 401. The user logs in successfully (BI app creates a session), but every Kinetica call fails. The REAUTH loop fires indefinitely.

**Why it happens:**
The BI app cannot control whether the IdP issues JWT or opaque access tokens — that's IdP configuration. This is an operational dependency, not a code bug.

**Prevention:**
- In the OIDC callback handler: attempt to decode (not verify) the access_token as a JWT. If it's not a JWT (doesn't have three Base64-URL segments), log a warning: `"Access token does not appear to be a JWT. Kinetica requires a JWT bearer token. Verify IdP access_token format."` Do NOT abort the session creation — the token may still work.
- Document in the runbook: Kinetica requires a JWT access token. Opaque tokens will fail Kinetica's trust check.
- This is caught by the startup Kinetica test-call check described in I-06.

**Phase:** OIDC callback handler + operational runbook.

**Looks Done But Isn't:** YES — passes all BI app tests. Only fails at the Kinetica boundary.

---

### Pitfall T-06: Clock Skew Between BI Server and IdP Causes Token Expiry False-Positives

**What goes wrong:**
JWT `exp` validation is time-based. If the BI server's clock is ahead of the IdP's clock by 5-10 seconds, a freshly issued token with `exp = now + 3600` arrives and the BI server validates `exp <= serverNow` — and may reject it as "already expired." Alternatively, if the IdP's clock is ahead, a token with `exp = idpNow + 3600` appears to expire 10 seconds late from the server's perspective (minor). The first direction (server ahead) causes immediate login failure.

**Why it happens:**
Container deployments and VMs frequently have clock drift. NTP is assumed but not guaranteed.

**Prevention:**
- Use `clockTolerance: 30` (seconds) option in `jwt.verify()` when validating the id_token's `exp` claim. This is a standard OIDC recommendation.
- Add to the operational runbook: "Ensure BI server time is synchronized via NTP. Clock drift > 30s will cause token validation failures."
- Write a test: validate a token whose `exp` is 10 seconds in the past with `clockTolerance: 30` — assert accepted. Validate one 40 seconds in the past — assert rejected.

**Phase:** OIDC callback handler.

**Looks Done But Isn't:** NO — clock skew causes immediate, reproducible login failure. It IS caught in integration testing if the test environment has drift.

---

## Mode-Switch Pitfalls

### Pitfall M-01: AUTH_MODE Change Detected by Reading Dirty DB State

**What goes wrong:**
The boot-time AUTH_MODE change detection works by reading a stored `auth_mode` value from the SQLite database and comparing it to the current `AUTH_MODE` env var. If the database was written by a previous run with partially-applied state (e.g., the server crashed mid-migration, or the sessions table was updated but the `auth_mode` meta-row was not), the comparison produces a false "no change" result. Old sessions from the previous mode survive into the new mode.

**Why it happens:**
The `auth_mode` meta-row write and the `DELETE FROM sessions` are two separate SQLite operations. A crash between them leaves the DB in an inconsistent state.

**Prevention:**
- Wrap `[write auth_mode, DELETE FROM sessions]` in a single SQLite transaction: `db.transaction(() => { ... })()`.
- Use better-sqlite3's synchronous transaction API — it's already in this stack.
- Write a test: mock a crash between the two writes (i.e., test the transaction rollback), then restart, assert sessions are clean.

**Phase:** Boot initialization (the mode-detection module).

**Looks Done But Isn't:** NO — the non-transactional case is immediately visible if a test crashes mid-write. But it requires simulating a crash.

---

### Pitfall M-02: Half-Migrated Sessions — `credential_type` Column Added But Existing Rows Have NULL

**What goes wrong:**
When `credential_type TEXT NOT NULL DEFAULT 'password'` is added via `ALTER TABLE sessions ADD COLUMN ...`, SQLite sets the default on new rows but the existing rows get `DEFAULT 'password'` applied immediately. This is correct SQLite behavior for `NOT NULL DEFAULT`. However: if the migration is applied while the server is running (hot migration), in-flight requests may see `credential_type = NULL` on rows inserted during the micro-window between the ALTER and the server reload. Safer: apply schema migrations at boot before starting the HTTP server.

**Prevention:**
- All schema migrations run synchronously at boot before `app.listen()`. This is the existing pattern (sessions table is created in `db.ts` at module load).
- Add the `credential_type` column in the same migration block that creates the sessions table (i.e., it's present from day one of the OIDC branch, not a retroactive ALTER).
- If ALTER is needed on an existing deployment, it happens at boot before any request is served.

**Phase:** DB schema update (first thing in OIDC branch).

**Looks Done But Isn't:** NO — missing column causes an immediate SQL error on INSERT.

---

### Pitfall M-03: Frontend Login Page Fetches `/api/auth/mode` but Caches It for the Lifetime of the SPA

**What goes wrong:**
`LoginPage` fetches `/api/auth/mode` on mount to decide which login UI to render. If the user has the SPA open in a browser tab when the server is restarted with a different AUTH_MODE, the cached mode response in React state is stale. The user sees the wrong login form. This is a minor UX issue (refreshing the page fixes it), but it can be confusing in ops scenarios where a mode flip is being tested.

**Prevention:**
- `/api/auth/mode` response should include `Cache-Control: no-store` to prevent browser caching.
- The `LoginPage` should refetch on visibility change (`document.addEventListener('visibilitychange', ...)`) or simply on every mount (it's a cheap call).

**Phase:** Frontend `LoginPage` implementation.

**Looks Done But Isn't:** YES — only surfaces on a mode flip while the SPA is open.

---

### Pitfall M-04: OIDC Session Rows Survive a Flip Back to Password Mode Due to GC Race

**What goes wrong:**
The AUTH_MODE-change detection wipes all sessions. But if the GC sweep is mid-execution when the wipe happens, a race condition leaves some OIDC session rows. The next password-mode request that hits `requireAuth` with an OIDC session's sid finds the row, attempts to decrypt the access token, populates `creds.password` with the token value, and sends `Authorization: Basic base64(username:accessToken)` to Kinetica. Kinetica rejects it with 401. The user gets a REAUTH_REQUIRED and is prompted to log in with a password — correct outcome, but via a confusing failure path.

**Why it happens:**
The GC sweep is a `setInterval` that runs independently of the boot wipe.

**Prevention:**
- The boot wipe uses `db.prepare('DELETE FROM sessions').run()` (all rows). Run this in a SQLite transaction that also sets the auth_mode meta-row. The GC sweep is a read-only sweep of expired rows — it doesn't interfere with a full-table DELETE.
- The `credential_type` check in `requireAuth` (Pitfall I-02 prevention) means even a surviving OIDC row is correctly handled: the `kineticaSql` helper builds Bearer (not Basic), Kinetica rejects it, REAUTH fires. The user re-logs. This is acceptable behavior.
- The real risk is if `credential_type` is NOT implemented (I-02 unresolved) — then the OIDC row is treated as a password row and sends a confusingly wrong Basic header.

**Phase:** Boot initialization + dependency on I-02 being implemented first.

**Looks Done But Isn't:** YES — requires a specific timing race to observe.

---

## UX Pitfalls

### Pitfall U-01: Deep-Link / Post-Login Redirect Lost During the OIDC Dance

**What goes wrong:**
A user bookmarks `https://bi.example.com/dashboards/42`. They're not authenticated. The app redirects to `/api/auth/oidc/start`. The IdP dance completes. The callback at `/api/auth/oidc/callback` creates a session and redirects to... `/` (the default). The original deep-link is lost. The user lands on the home page and must navigate back to dashboard 42.

**Why it happens:**
The OIDC redirect dance has two hops: (1) BI app → IdP, (2) IdP → BI app callback. The original URL is the browser's URL before hop 1. Without explicit preservation, it's lost.

**Root cause:** `redirect_uri` is the callback URL (`/api/auth/oidc/callback`), not the original deep-link. The deep-link must be preserved separately.

**Prevention:**
- Before redirecting to IdP, save the current URL to the `state` parameter or to a short-lived `kbi_post_login_redirect` cookie.
- Option 1 (recommended): Include the original path in the `state` value: `state = base64(JSON.stringify({ nonce: randomHex, returnTo: req.query.returnTo || '/' }))`. In the callback, after creating the session, redirect to `state.returnTo` (validate it's a relative path — no open redirects).
- Option 2: Store `returnTo` in the same short-lived cookie as `state`.
- Write a test: hit a protected route unauthenticated → verify post-login redirect lands on the original path.

**Phase:** OIDC start route + callback handler.

**Looks Done But Isn't:** YES — smoke tests start from `/login`, not from a deep-linked URL.

---

### Pitfall U-02: IdP Unreachable at Login Time — Generic 500 vs. Actionable Error

**What goes wrong:**
`/api/auth/oidc/start` initiates the redirect to `{issuer}/authorize`. If the IdP is unreachable (DNS failure, network partition, IdP downtime), the browser either hangs or returns a connection error page — NOT a friendly BI app error. The user sees a browser-level "Unable to connect" message with no context about what failed or what to do.

**Why it happens:**
The redirect itself is a client-side browser navigation — the server never gets a chance to catch the error. The BI server only handles the callback, not the IdP's authorize endpoint.

**Prevention:**
- Before issuing the redirect, the server can perform a quick HEAD/GET to `{issuer}/.well-known/openid-configuration` (OIDC discovery endpoint). If it fails, return a 503 with `{ error: "Identity provider unreachable. Try again or contact your administrator.", code: "IDP_UNAVAILABLE" }` instead of redirecting.
- Cache the result of this check for 30 seconds to avoid blocking every login with an extra network call.
- The frontend handles `code: "IDP_UNAVAILABLE"` on the login page with a specific error message.
- Document in the runbook: if OIDC logins fail at the redirect step, check IdP connectivity from the BI server.

**Phase:** OIDC start route + frontend error handling.

**Looks Done But Isn't:** YES — IdP is always up in development and CI.

---

### Pitfall U-03: Double-Render Flicker on Bootstrap Before `/api/auth/me` Resolves

**What goes wrong:**
This is a Phase 1 carry-over that becomes more visible in OIDC mode. On app load, the frontend renders before `/api/auth/me` responds. In password mode, this is a brief flicker (the server is local). In OIDC mode, if the browser has an expired session cookie and the first request returns 401-REAUTH, the app renders the dashboard briefly before the REAUTH dispatch fires and redirects to login. In OIDC mode, the redirect to IdP is an external navigation — more disorienting than showing the local password form.

**Prevention:**
- The `App.tsx` bootstrap should render a loading state (spinner or blank) while `/api/auth/me` is in-flight — not the full authenticated UI.
- Once `/api/auth/me` resolves: authenticated → render app; 401 → render login (or redirect to IdP).
- This should already be the case in v1.0 (the auth store controls rendered state). Verify that the OIDC redirect case doesn't cause an extra render cycle. Explicitly test the scenario: start app with expired cookie in OIDC mode, assert no dashboard flash before IdP redirect.

**Phase:** Frontend `App.tsx` bootstrap (review, not rewrite).

**Looks Done But Isn't:** YES — the flash is brief and easy to miss in local testing.

---

### Pitfall U-04: Logout Button Navigates Away Before Session Destruction Completes

**What goes wrong:**
The logout handler calls `window.location.href = '/'` (or equivalent) to navigate away after logout. If this is called before `await fetch('/api/auth/logout')` resolves, the logout API call is cancelled by the browser navigation. The server-side session row is NOT deleted. The user is redirected to login but their session is still valid. Refreshing the app will re-authenticate them from the old session.

**Why it happens:**
`window.location.href = '/'` is synchronous and immediate. `fetch()` is async. If the navigation fires before the promise resolves, the fetch is aborted.

**Root cause:** The existing logout flow in `auth.ts` (`clearSessionCookie`) only clears the browser cookie. The session row deletion (`deleteSession(sid)`) happens server-side in the logout route. A cancelled fetch means the row survives.

**Prevention:**
- The logout handler must `await fetch('/api/auth/logout')` (or `.then(() => window.location.href = '/')`) before navigating.
- OR: use `navigator.sendBeacon('/api/auth/logout')` which is fire-and-forget but not cancelled on navigation.
- Write a test: call logout without awaiting, verify the session row is still present in DB (demonstrates the bug), then fix and verify row is deleted.
- In OIDC mode, this matters more because re-authentication goes to the IdP — a surviving session row means the user doesn't go to IdP, they silently re-authenticate from the old session (which may have an expired token, triggering I-07).

**Phase:** Frontend logout handler (wherever `window.location.href` is set after logout).

**Looks Done But Isn't:** YES — in testing, the fetch resolves fast (local server). In production under load, the navigation can fire first.

---

## Operational / Deploy Pitfalls

### Pitfall O-01: `AUTH_OIDC_ISSUER` Trailing Slash Mismatch

**What goes wrong:**
`AUTH_OIDC_ISSUER=https://idp.example.com` vs `https://idp.example.com/`. The OIDC spec says issuer must not end with a trailing slash. Many IdPs enforce this. But the `.well-known/openid-configuration` URL is constructed as `{issuer}/.well-known/openid-configuration`. If `issuer` ends with `/`, the URL becomes `https://idp.example.com//.well-known/...` which some servers accept (double slash normalized) and others reject (404).

Worse: the `iss` claim in issued tokens is the IdP's canonical issuer (no trailing slash). If the configured `AUTH_OIDC_ISSUER` has a trailing slash, the issuer validation (C-05) fails for every token — login is completely broken.

**Why it happens:**
Copy-paste from IdP admin console. Some UIs show the issuer with trailing slash. Developers copy it and set `AUTH_OIDC_ISSUER`.

**Prevention:**
- Boot-time config validation: `process.env.AUTH_OIDC_ISSUER = AUTH_OIDC_ISSUER.replace(/\/$/, '')`.
- Add to `requireConfig` (or equivalent boot validator): assert `AUTH_OIDC_ISSUER` does not end with `/`.
- Write a boot test: set `AUTH_OIDC_ISSUER=https://idp.example.com/`, assert the normalized value stored is `https://idp.example.com`.

**Phase:** Boot config validation.

**Looks Done But Isn't:** NO — this causes an immediate, reproducible login failure. Easy to catch in integration testing.

---

### Pitfall O-02: `AUTH_OIDC_CLIENT_SECRET` Rotation Breaks All Active Sessions

**What goes wrong:**
When the `AUTH_OIDC_CLIENT_SECRET` is rotated (at the IdP), the BI server must be restarted with the new secret. Until restarted: new login attempts fail at the token endpoint (401 from IdP). Existing sessions with valid access tokens continue to work (the session row holds the token; client_secret is only needed for the auth code exchange). After restart with the new secret: new logins work. BUT: if `AUTH_SECRET` is also rotated at the same time (different secret), existing session cookies become invalid (JWT sig fails) and all users are logged out.

**Why it happens:**
Operators conflate "rotate the OIDC client_secret" with "rotate all secrets." Rotating `AUTH_SECRET` simultaneously logs everyone out.

**Prevention:**
- Treat `AUTH_OIDC_CLIENT_SECRET` rotation and `AUTH_SECRET` rotation as independent operations with different blast radii.
- Document in the runbook: "Rotating AUTH_OIDC_CLIENT_SECRET requires BI server restart. Existing sessions remain valid. Rotating AUTH_SECRET logs all users out."
- `AUTH_OIDC_CLIENT_SECRET` rotation is safe between restarts because it's only used at login time.

**Phase:** Operational runbook.

**Looks Done But Isn't:** YES — this is a deploy scenario, not a code path.

---

### Pitfall O-03: `redirect_uri` Mismatch Between Dev and Prod — IdP Rejects Callback

**What goes wrong:**
The IdP maintains a registered allowlist of redirect URIs. If the BI server sends `redirect_uri=https://bi.example.com/api/auth/oidc/callback` but the registered URI at the IdP is `https://bi.example.com/api/auth/oidc/callback/` (trailing slash), the IdP returns an error to the browser (not to the server): `error=redirect_uri_mismatch`. The user sees an IdP error page. The BI app logs nothing.

**Why it happens:**
The URI must match exactly, character for character. Trailing slashes, HTTP vs HTTPS, port numbers (`:443` explicitly vs implied) — any difference causes rejection.

**Prevention:**
- Boot-time validation: assert `AUTH_OIDC_REDIRECT_URI` is set and log its value on startup so operators can compare it to the IdP registration.
- In the runbook: the registered redirect URI at the IdP MUST exactly match `AUTH_OIDC_REDIRECT_URI` in the BI server config. Document both values side-by-side in the deploy checklist.
- Maintain separate IdP client registrations for dev, staging, and prod — don't share a single registration across environments.

**Phase:** Boot config validation + operational runbook.

**Looks Done But Isn't:** NO — the mismatch causes an immediate redirect error. But it's diagnosed at the IdP's error page, not in BI server logs, making it confusing to troubleshoot.

---

### Pitfall O-04: Kinetica OIDC Trust Not Configured — Login Works, Data Access Fails

**What goes wrong:**
The BI app completes the OIDC dance, creates a session, stores the access token, and sends `Authorization: Bearer <token>` to Kinetica. Kinetica has its own OIDC trust configuration (which IdPs it trusts, which audience, which claims map to Kinetica users). If this is not configured, Kinetica returns 401 for every authenticated Kinetica call. The user is in a permanent REAUTH loop (see I-06).

This is classified as "documentation, not code" in PROJECT.md — but the BI app must handle the failure gracefully and surface a useful error message.

**Why it happens:**
Two separate OIDC configurations exist: (1) BI app's OIDC client config (handled in code), and (2) Kinetica server's OIDC trust config (handled by DBAs). These are easy to conflate. A DBA may not realize they need to configure Kinetica separately.

**Prevention:**
- The startup test-call to Kinetica (described in I-06) catches this.
- The REAUTH loop detection (I-06) distinguishes this from a regular token expiry.
- The deploy runbook must include a "Kinetica OIDC Trust Checklist" section with: IdP discovery URL, client_id/audience that Kinetica should accept, claim-to-username mapping for Kinetica.
- Log `"OIDC mode active. Kinetica must be configured to trust tokens from {AUTH_OIDC_ISSUER} with audience {AUTH_OIDC_CLIENT_ID}."` at startup in OIDC mode.

**Phase:** Operational runbook + startup logging.

**Looks Done But Isn't:** YES — this is the most common "smoke test passes, production fails" scenario for OIDC integrations.

---

## "Looks Done But Isn't" Master Checklist

These items pass standard smoke tests (login → dashboard renders → logout) but fail in real usage or production.

| # | Item | Failure Mode | Phase to Address |
|---|------|--------------|-----------------|
| LDB-01 | OIDC login succeeds | Every Kinetica call returns 401 (I-01, I-02) | Helper layer + session schema |
| LDB-02 | id_token decoded | Forged token with any username is accepted (C-01) | OIDC callback handler |
| LDB-03 | State parameter sent | CSRF via crafted callback link (C-02) | OIDC callback handler |
| LDB-04 | Session created on callback | Access token stored as `Authorization: Basic` header (I-01, I-02) | Helper layer |
| LDB-05 | Auth mode flip works | Frontend shows wrong login form, white screen (I-03, I-04) | Frontend bootstrap |
| LDB-06 | Logout navigates away | Session row survives, user re-auths from old session (U-04) | Frontend logout handler |
| LDB-07 | Deep-link before auth | Post-login redirect lands on `/` not original URL (U-01) | OIDC start/callback |
| LDB-08 | OIDC config valid | Trailing-slash issuer breaks token validation (O-01) | Boot config validation |
| LDB-09 | New environment works | Kinetica OIDC trust not configured → REAUTH loop (O-04, I-06) | Runbook + startup log |
| LDB-10 | IdP cert rotation | JWKS cache serves stale key, all logins fail (C-06) | Callback + ops runbook |
| LDB-11 | Username extracted | Empty string username causes session collision (T-03) | OIDC callback handler |
| LDB-12 | Access token stored | Token stored as plaintext (T-01) | Session creation |
| LDB-13 | Token type correct | Access token used for claims instead of id_token (T-02) | OIDC callback handler |

---

## Phase Mapping

| Pitfall | ID | Phase | Priority |
|---------|----|-------|----------|
| Auth code CSRF (state param) | C-02 | OIDC start + callback routes | CRITICAL |
| ID token signature not verified | C-01 | OIDC callback handler | CRITICAL |
| Nonce not used | C-03 | OIDC start + callback routes | CRITICAL |
| Audience claim not validated | C-04 | OIDC callback handler | CRITICAL |
| Issuer claim not validated | C-05 | OIDC callback handler + boot config | CRITICAL |
| `creds` shape collision — Bearer as Basic | I-01 | Helper layer (`kineticaSql` / `kineticaWms`) | CRITICAL |
| Sessions table missing `credential_type` | I-02 | DB schema + `requireAuth` | CRITICAL |
| Access token stored unencrypted | T-01 | OIDC session creation | CRITICAL |
| id_token vs access_token confusion | T-02 | OIDC callback handler | CRITICAL |
| Username claim returns empty | T-03 | OIDC callback handler | HIGH |
| JWKS cache stale after cert rotation | C-06 | OIDC callback + runbook | HIGH |
| `redirect_uri` not pinned | C-07 | Boot config + start route | HIGH |
| AUTH_MODE change not transactional | M-01 | Boot initialization | HIGH |
| typed-error: Kinetica OIDC trust loop | I-06 | Callback + startup check + runbook | HIGH |
| `requireAuth` sends expired bearer token | I-07 | `sessionStore.ts` + `requireAuth` | HIGH |
| Deep-link lost during OIDC dance | U-01 | OIDC start + callback routes | HIGH |
| AuthMode change: frontend cache stale | I-03 | Frontend `LoginPage` + `/api/auth/mode` | HIGH |
| Session cookie survives mode flip | I-04 | Boot detection + frontend bootstrap | HIGH |
| Logout not awaited before navigate | U-04 | Frontend logout handler | HIGH |
| Issuer trailing slash mismatch | O-01 | Boot config validation | HIGH |
| Kinetica OIDC trust not configured | O-04 | Runbook + startup logging | HIGH |
| Cookie `v` field bumped incorrectly | I-05 | `auth.ts` extension | MEDIUM |
| Clock skew on token expiry | T-06 | OIDC callback handler | MEDIUM |
| Scopes too narrow, claim absent | T-04 | OIDC start route + config | MEDIUM |
| Opaque access token sent to Kinetica | T-05 | Callback handler + runbook | MEDIUM |
| IdP unreachable at login | U-02 | OIDC start route + frontend | MEDIUM |
| Double-render flicker on bootstrap | U-03 | Frontend `App.tsx` bootstrap | MEDIUM |
| AUTH_OIDC_CLIENT_SECRET rotation | O-02 | Operational runbook | MEDIUM |
| redirect_uri dev vs prod mismatch | O-03 | Boot config + runbook | MEDIUM |
| Half-migrated sessions (credential_type NULL) | M-02 | DB schema migration | LOW |
| Frontend login page caches mode | M-03 | Frontend `LoginPage` | LOW |
| OIDC session rows survive mode flip race | M-04 | Boot init (dependency on I-02) | LOW |

---

## Phase-Carry-Over Notes

### Phase 1 Carry-Overs

- **Pitfall I-05 (v: 1 version field):** The existing `decodeAndVerifyJwt` check for `v !== 1` must NOT be changed when adding OIDC. The `credential_type` discriminant goes in the session row, not the cookie payload. The guard comment at line 118 of `auth.ts` must be preserved and extended.
- **Pitfall I-04 (session cookie migration):** The Phase 1 pattern (sessions wiped on AUTH_SECRET rotation) directly applies to AUTH_MODE change detection. Wrap it in the same SQLite transaction pattern (M-01).

### Phase 2 Carry-Overs

- **Typed-error taxonomy (I-06):** Bearer-token auth introduces a new failure category: "Kinetica OIDC trust misconfigured." The existing `KineticaAuthError → 401-REAUTH` mapping is correct behavior but the *cause* is different. The audit log (OBS-01) should log `credential_type` per call so the pattern is diagnosable from logs. Consider adding a structured log field `auth_scheme: 'bearer' | 'basic'` to the audit log line.
- **400 + `/access denied/i` → `KineticaPermissionError` (spike-driven taxonomy):** This heuristic was built for password mode. Verify it still works in OIDC mode — Kinetica's error messages for OIDC trust failures may differ from its messages for credential failures.

### Phase 3 Carry-Overs

- **401-REAUTH dispatch (I-07):** The existing chain (`kineticaSql throws KineticaAuthError → global middleware → 401-REAUTH → frontend apiFetch → OIDC redirect`) must be verified end-to-end in OIDC mode. The frontend's response to `REAUTH_REQUIRED` must redirect to `/api/auth/oidc/start` (not show a password form) when `AUTH_MODE=oidc`. The `/api/auth/mode` endpoint (I-03) is the mechanism.
- **`apiFetch` dispatch on `code: "REAUTH_REQUIRED"`:** This is mode-agnostic and correct. But the *action* taken on REAUTH differs: password mode → show login form; OIDC mode → `window.location.href = '/api/auth/oidc/start'` (external redirect). The dispatch needs a mode-aware handler, not just a static route.

---

## Sources

- Codebase analysis: `kinetica_bi/server/src/auth.ts` — `requireAuth` 9-step dispatch, `decodeAndVerifyJwt` v: 1 guard, `creds` shape
- Codebase analysis: `kinetica_bi/server/src/sessionStore.ts` — AES-256-GCM encryption pattern, session row shape, `SessionRow` type
- Project context: `.planning/PROJECT.md` — locked v1.1 decisions (AUTH_MODE, no refresh tokens, local-only logout, credential_type claim mapping)
- Milestone context: `.planning/MILESTONES.md` — v1.0 pitfalls already addressed (P1-P6 in sessionStore.ts comments), known gaps TD-01 through TD-05
- OIDC specification: RFC 6749 (OAuth 2.0), OpenID Connect Core 1.0 — state, nonce, aud, iss, exp validation requirements
- OIDC security: RFC 9700 (OAuth 2.0 Security Best Current Practice) — mix-up attack, CSRF, redirect_uri pinning (HIGH confidence)
- JWKS: RFC 7517 (JSON Web Key Sets), `jwks-rsa` library docs — key caching, rotation handling (HIGH confidence)
- Kinetica OIDC: Kinetica documentation for bearer token authentication — OIDC trust config is a separate DBA concern (MEDIUM confidence; verify against current Kinetica version docs)
