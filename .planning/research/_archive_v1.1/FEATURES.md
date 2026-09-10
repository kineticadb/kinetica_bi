# Feature Landscape — OIDC SSO Support (v1.1)

**Domain:** Adding Generic OIDC SSO as an alternative authentication method to an existing internal BI app that already ships password auth (v1.0).
**Researched:** 2026-04-28
**Overall confidence:** HIGH (codebase is directly readable; OIDC/OAuth 2.0 protocol patterns are well-established; external search unavailable this session — see confidence notes per section)

---

## Scope Anchor

This file covers only the **delta** for v1.1. The following already exist and are out of scope:

| What already exists (v1.0) | Implication for v1.1 |
|----------------------------|----------------------|
| Encrypted server-side session store (AES-256-GCM, `sessions` table, 8h TTL, GC sweep) | Session infrastructure reused as-is; v1.1 stores an access token in the same row instead of a password |
| `requireAuth` middleware (9-step JWT cookie + session row dispatch) | Reused as-is; `req.user.creds` shape extends to carry `{ token }` in OIDC mode |
| 401-REAUTH → frontend `UNAUTHORIZED_EVENT` → `markUnauthenticated("session-expired")` → `LoginPage` | Re-auth on token expiry flows through this path unchanged |
| `LoginPage` with username/password form + session-expired banner | Adapted: OIDC mode shows a "Sign in with SSO" button instead of the credential form |
| `POST /api/auth/logout` destroys session row + clears cookie | Reused; local-only logout stays local-only |
| Per-call audit log (`kineticaSql` / `kineticaWms`) | Username from claims is the logged principal; no other audit change needed |
| `kineticaSql` / `kineticaWms` helpers build `Authorization: Basic` from `req.user.creds` | These helpers branch: OIDC mode sends `Authorization: Bearer <access_token>` |

**Locked v1.1 decisions (not re-researched, treated as constraints):**

- Generic OIDC via issuer URL + OIDC discovery (`/.well-known/openid-configuration`)
- Server-side Authorization Code flow with client secret (confidential client, NOT PKCE)
- `AUTH_MODE=password|oidc` — single mode per deployment, mutually exclusive
- Re-auth on token expiry — no refresh-token storage
- Local-only logout
- Configurable claim-to-username mapping (`AUTH_OIDC_USERNAME_CLAIM`, optional `AUTH_OIDC_USERNAME_REGEX`)
- Kinetica server OIDC trust configuration is documentation, not code

---

## Category Map

Features are organized into five categories that reflect the OIDC flow lifecycle:

1. **Login Surface** — how the user initiates SSO
2. **Authorization Code Flow** — the server-side OAuth exchange
3. **Session Establishment** — what gets stored after successful auth
4. **Token Expiry / Re-auth** — what happens when the token expires
5. **Logout** — session teardown

Error UX is addressed inline under each category (it is a cross-cutting concern, not a separate feature).

---

## Table Stakes

Features users and operators expect. Missing any of these = the milestone feels incomplete or broken.

### Category 1: Login Surface

| # | Feature | What It Is | Complexity | Depends On (v1.0 existing) | v1.1 Scope |
|---|---------|------------|------------|----------------------------|-----------|
| TS-1 | **"Sign in with SSO" button on LoginPage** | In OIDC mode, `LoginPage` replaces the username/password form with a single button (or renders just the SSO button alongside nothing — no credential form). Clicking it calls `GET /api/auth/oidc/start`. | Low | `LoginPage.tsx`, `useAuthStore` | **In scope** |
| TS-2 | **`GET /api/auth/oidc/start` initiates the Authorization Code flow** | Server generates a `state` nonce (stored in a short-lived httpOnly cookie or the session), builds the authorization URL from the IdP's discovered `authorization_endpoint`, and issues a 302 redirect. This is the entry point for the entire OIDC flow. | Medium | Session store (state nonce must survive the browser redirect round-trip) | **In scope** |
| TS-3 | **`AUTH_MODE` gates which login UI and routes are active** | When `AUTH_MODE=oidc`, the `/api/auth/login` (password) endpoint returns 405 or 404; the `/api/auth/oidc/start` and `/api/auth/oidc/callback` routes are mounted. When `AUTH_MODE=password`, the OIDC routes are not mounted. Neither mode exposes the other's surface. | Low | `index.ts` route setup | **In scope** |

### Category 2: Authorization Code Flow (Server-Side)

| # | Feature | What It Is | Complexity | Depends On (v1.0 existing) | v1.1 Scope |
|---|---------|------------|------------|----------------------------|-----------|
| TS-4 | **OIDC discovery via `/.well-known/openid-configuration`** | On server startup (or first use), fetch the IdP's discovery document from `AUTH_OIDC_ISSUER_URL + /.well-known/openid-configuration` to resolve `authorization_endpoint`, `token_endpoint`, and `jwks_uri`. Cache it in process memory. | Low-Medium | Startup config validation | **In scope** |
| TS-5 | **`state` parameter generated, stored, and validated** | Server generates a cryptographically random `state` value before redirecting to the IdP. On callback, the returned `state` must match exactly. Mismatches → reject (CSRF defense). The `state` value must survive the browser round-trip: store it in a short-lived, httpOnly, `SameSite=Lax` cookie (e.g., `kbi_oidc_state`), separate from the session cookie. | Medium | `node:crypto` (`randomBytes`), cookie-parser (already installed) | **In scope** |
| TS-6 | **`GET /api/auth/oidc/callback` exchanges the code for tokens** | After IdP redirects back with `?code=...&state=...`, the server verifies `state`, then POSTs to the IdP's `token_endpoint` with `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, and `client_secret`. Returns `access_token` (and usually `id_token`). | Medium | `AUTH_OIDC_CLIENT_ID`, `AUTH_OIDC_CLIENT_SECRET`, `AUTH_OIDC_REDIRECT_URI` env vars | **In scope** |
| TS-7 | **ID token signature verification** | The `id_token` is a JWT. Its signature must be verified using the IdP's public keys fetched from `jwks_uri`. This proves the token genuinely came from the IdP and was not forged. Audience (`aud`) must match `client_id`; issuer (`iss`) must match `AUTH_OIDC_ISSUER_URL`; expiry (`exp`) checked. | Medium-High | A JWT/JWKS library (`jose` is the standard choice — already evaluated in v1.0 STACK.md as the right fit for JWE/JWS beyond `jsonwebtoken`'s scope) | **In scope** |
| TS-8 | **Claim-to-username mapping** | Extract the username from the verified ID token claims using `AUTH_OIDC_USERNAME_CLAIM` (default `preferred_username`). Apply optional regex transform via `AUTH_OIDC_USERNAME_REGEX` if configured. The resulting username is what gets stored in the session row and used for audit logs. | Low | None new — plain string extraction + optional regex | **In scope** |

### Category 3: Session Establishment

| # | Feature | What It Is | Complexity | Depends On (v1.0 existing) | v1.1 Scope |
|---|---------|------------|------------|----------------------------|-----------|
| TS-9 | **Access token stored encrypted in the session row (replacing password)** | After successful token exchange and ID token verification, the server creates a session row that stores the `access_token` (AES-256-GCM encrypted) instead of a password. The session row shape extends or adapts: `credential_type: "oidc"` distinguishes it from a password-mode row. | Medium | `sessionStore.ts` `createSession` function, `encryptPassword` / `decryptPassword` helpers (repurposed for token), `sessions` table schema | **In scope** |
| TS-10 | **Session TTL tied to BI app policy (8h), not IdP token TTL** | The BI session expires after 8h regardless of when the IdP's access token expires. If the token expires before the BI session (typical: IdP tokens are 1h), the next Kinetica call fails with `KineticaAuthError` → triggers the existing 401-REAUTH flow. This is the correct behavior per the locked decision (no refresh token storage). | Low | Existing `sessions` table `expires_at` column — no change needed | **In scope** (no code change; documenting the intended behavior) |
| TS-11 | **`req.user.creds` carries `{ token }` in OIDC mode; `kineticaSql` / `kineticaWms` send `Authorization: Bearer`** | The helpers that build Kinetica API calls branch on `req.user.creds` shape: if a `token` field is present, emit `Authorization: Bearer <token>`; if `password` is present, emit `Authorization: Basic`. This is the key integration point between auth mode and data access. | Medium | `kinetica.ts` `buildAuthHeader`, `AuthedRequest` type in `auth.ts` | **In scope** |
| TS-12 | **`AUTH_MODE` change at boot wipes the sessions table** | If the operator switches `AUTH_MODE` between deployments, old sessions (which contain a credential of the wrong type) must be invalidated. On startup, detect `AUTH_MODE` change (compare against a persisted value in SQLite) and truncate the `sessions` table, mirroring the v1.0 pattern for `AUTH_SECRET` rotation. | Low-Medium | `sessionStore.ts` startup logic (similar to the existing `kineticaUrl` mismatch detection in `requireAuth`) | **In scope** |

### Category 4: Token Expiry / Re-auth

| # | Feature | What It Is | Complexity | Depends On (v1.0 existing) | v1.1 Scope |
|---|---------|------------|------------|----------------------------|-----------|
| TS-13 | **Expired IdP access token → `KineticaAuthError` → 401-REAUTH → frontend re-redirects to IdP** | When the stored access token has expired, Kinetica returns 401. The existing `KineticaAuthError` → `errorMiddleware` → `401 { code: "REAUTH_REQUIRED" }` → `UNAUTHORIZED_EVENT` → `markUnauthenticated("session-expired")` → `LoginPage` chain fires identically. In OIDC mode, `LoginPage` renders the "Sign in with SSO" button, so clicking it re-starts the `GET /api/auth/oidc/start` flow. No new re-auth code needed — the existing chain handles it. | Low (wiring check, not new code) | Entire v1.0 Phase 3 error chain — reused exactly | **In scope** (verify the chain works; no new feature) |
| TS-14 | **Re-auth lands the user back at the same page (not a blank dashboard)** | After the OIDC callback completes and a new session is established, the user should return to where they were. The simplest approach: store the current `window.location.pathname` in `sessionStorage` before redirecting to `/api/auth/oidc/start`, then `App.tsx` reads and restores it after successful authentication. | Low | `App.tsx` bootstrap logic, `useAuthStore` | **In scope** |

### Category 5: Logout

| # | Feature | What It Is | Complexity | Depends On (v1.0 existing) | v1.1 Scope |
|---|---------|------------|------------|----------------------------|-----------|
| TS-15 | **Local logout destroys BI session and clears cookie (identical to v1.0)** | `POST /api/auth/logout` deletes the session row and clears `kbi_session`. The user is logged out of the BI app but remains logged in at the IdP. This is the locked decision for v1.1. | None (no change from v1.0) | `POST /api/auth/logout` in `index.ts` — already correct | **In scope** (no code change; existing behavior is correct) |

### Error UX (Cross-Cutting Table Stakes)

| # | Feature | What It Is | Complexity | Depends On (v1.0 existing) | v1.1 Scope |
|---|---------|------------|------------|----------------------------|-----------|
| TS-16 | **Callback error → user-visible message (not a blank page or stack trace)** | If the callback receives `?error=access_denied` (IdP rejected), `?error=...` (other IdP error), a `state` mismatch, a failed code exchange, or an invalid ID token, the server must not crash or return a raw 500. It redirects to `LoginPage` (or a dedicated error route) with a brief message. | Low-Medium | `LoginPage.tsx` error rendering (`message` state), existing `login-error` CSS class | **In scope** |
| TS-17 | **IdP discovery failure at boot → server refuses to start with clear message** | If `AUTH_OIDC_ISSUER_URL` is misconfigured or the IdP's discovery endpoint is unreachable at startup, the server should log a clear error and exit (fail-fast), not start in a broken state where all OIDC flows silently error. | Low | Startup config validation in `index.ts` (analogous to `requireConfig` middleware) | **In scope** |
| TS-18 | **Missing required claim → callback error, not a silent empty username** | If the configured `AUTH_OIDC_USERNAME_CLAIM` is absent from the ID token (e.g., IdP doesn't include `preferred_username`), this must surface as an explicit error during callback handling, not a silent empty string stored as the username. | Low | Claim extraction logic in callback handler | **In scope** |

---

## Differentiators

Features that would be valued but are not required for the milestone to work correctly.

| # | Feature | Value Proposition | Complexity | Depends On | Recommendation |
|---|---------|-------------------|------------|------------|----------------|
| D-1 | **`nonce` parameter in the authorization request** | The `nonce` claim in the returned ID token provides replay protection beyond what `state` gives. It proves the ID token was issued in response to *this specific flow initiation*, not replayed from an older token. Strictly speaking, the Authorization Code flow (server-side with a confidential client) does not require `nonce` — `state` is the CSRF defense, and the code is one-time-use. But adding `nonce` is cheap and many IdPs include it. | Low | `node:crypto` randomBytes, ID token claim check in callback | **Recommend including** — trivially cheap, improves the ID token binding. |
| D-2 | **Store `id_token` in the session row alongside `access_token`** | The `id_token` contains user claims. If the BI app later needs to surface richer user info (display name, email, role) without a UserInfo endpoint call, having the `id_token` available in the session row makes that easy. | Low | Session row schema (one extra BLOB column) | **Recommend including** — adds ~50 bytes per row, low cost, unlocks future claims surfacing. |
| D-3 | **`/api/auth/me` returns `AUTH_MODE` to the frontend** | Lets the frontend conditionally render the logout button label, re-auth UX, and login page variant based on auth mode without hard-coding it. One extra field in the existing `/api/auth/me` response. | Low | `/api/auth/me` route in `index.ts` | **Recommend including** — negligible cost, makes frontend mode-branching clean. |
| D-4 | **Audit log includes `auth_mode` field per Kinetica call** | Distinguishes password-mode vs OIDC-mode sessions in the audit log. Useful if the same deployment ever transitions between modes. | Low | `kinetica.ts` audit line (add one field) | **Recommend including** — one extra JSON field in an existing log line. |
| D-5 | **Configurable session TTL via `AUTH_SESSION_TTL_HOURS` env var** | The 8h TTL is currently a constant in `auth.ts`. Making it configurable lets operators tune it for environments where the IdP issues very short-lived tokens (e.g., 15-min tokens → more frequent forced re-auths → operators may want a shorter BI session TTL to match). | Low | `auth.ts` `TOKEN_TTL_SECONDS` constant | **Defer** — the 8h constant is fine for v1.1; this is a polish item. |

---

## Anti-Features

Features that look natural to add during an OIDC milestone but should be explicitly rejected.

| # | Anti-Feature | Why It Looks Attractive | Why It's Wrong for This Milestone | What To Do Instead |
|---|--------------|-------------------------|-----------------------------------|--------------------|
| AF-1 | **PKCE (Proof Key for Code Exchange)** | PKCE is the modern recommended practice for public clients (SPAs, mobile apps) where no client secret can be safely stored. Many guides default to "Authorization Code + PKCE" without distinguishing client types. | This is a **confidential client** — the client secret lives on the server and never touches the browser. For confidential clients, the client secret is already a stronger defense than PKCE. Adding PKCE to a confidential client is not wrong, but it adds implementation complexity (code_verifier / code_challenge generation and storage) for zero security gain in this architecture. The locked decision is server-side flow with client secret. | Keep the locked decision: Authorization Code + client secret, no PKCE. |
| AF-2 | **Refresh token storage** | Refresh tokens prevent users from being bounced to the IdP when the access token expires (typically ~1h). Smooth UX for short-lived IdP tokens. | Storing refresh tokens ~doubles the session-store security surface. A compromised refresh token allows an attacker to mint fresh access tokens indefinitely until the user explicitly revokes. The re-auth UX (click SSO button again) is a minor hiccup for an internal team tool. The locked decision explicitly rejects this. | Use the existing 401-REAUTH flow. If the team later decides the re-auth friction is unacceptable, revisit in v1.2 with a deliberate security review. |
| AF-3 | **Dual-auth mode (password AND OIDC available simultaneously)** | Smooth migration — users on password auth while new users use OIDC; avoids a hard cutover. | Doubles the login surface area and forces `LoginPage` to show both a credential form and an SSO button, which is confusing. Creates two code paths for `requireAuth`, `kineticaSql`, `kineticaWms`, and logout that must be tested in combination. Also forces the session store to handle mixed credential types across concurrent users. The locked decision is mutually exclusive `AUTH_MODE`. | Deploy in one mode. If migration is needed, plan a session cutover: set `AUTH_MODE=oidc`, deploy, let the old sessions expire (8h), done. |
| AF-4 | **RP-initiated logout (sending the user to the IdP's logout endpoint)** | Ensures the user is also signed out at the IdP, not just at the BI app. Prevents the user from being auto-logged back in immediately (if the IdP has a session). The "proper" SSO logout. | Adds dependency on the IdP's `end_session_endpoint` (not all IdPs support it; not in the OIDC Core spec — it's the Session Management draft). Requires additional env vars (`AUTH_OIDC_POST_LOGOUT_REDIRECT_URI`). For an internal team tool, the practical impact is low — the user's IdP session is their problem, not the BI app's. The locked decision is local-only logout. | Implement local logout only. Document that the IdP session persists and the user should log out of the IdP separately if needed. |
| AF-5 | **Account linking (connecting an existing password user to SSO)** | Users who had password accounts want to "merge" their history into the OIDC identity. | `AUTH_MODE` is mutually exclusive — there is no scenario in this deployment model where a single user can have both credential types simultaneously. Account linking is only meaningful in dual-auth mode (AF-3), which is rejected. In practice: when the org switches to `AUTH_MODE=oidc`, the username extracted from the OIDC claim is what the user's Kinetica account needs to match. That is a Kinetica admin task, not a BI app feature. | Document in the deploy runbook: "Ensure the username claim matches the user's Kinetica account name." No code. |
| AF-6 | **IdP discovery in the UI ("Which IdP do you use?")** | Enterprise apps with multiple tenants present a dropdown or text field where the user enters their org's IdP domain. | This is a multi-tenant feature. The locked decision is single-IdP per deployment (`AUTH_OIDC_ISSUER_URL` is a server env var). No frontend-facing IdP selection surface is needed or appropriate. | Configure `AUTH_OIDC_ISSUER_URL` in the server environment. One deployment = one IdP. |
| AF-7 | **Storing the access token in the JWT session cookie (stateless OIDC)** | Eliminates the server-side session row for the token. Simpler state management. | Access tokens can be large (hundreds of bytes to several KB for JWT-formatted tokens with embedded claims). The `kbi_session` cookie is already sent on every request; growing it further risks exceeding browser cookie size limits (~4KB) and adds overhead to every HTTP request. The v1.0 encrypted session row architecture already solves this cleanly. | Store the access token encrypted in the session row, exactly as passwords are stored in v1.0. The cookie remains a small opaque `{ sub, sid, v: 1 }` pointer. |
| AF-8 | **Allowing the user to switch between password and SSO within an active session** | "I'm logged in with SSO but want to also try my Kinetica password" or vice versa. | This makes no sense with mutually exclusive `AUTH_MODE`. It is impossible by design: the password endpoint returns 405 in OIDC mode. The concept does not exist. | Not applicable. Raise a clear 405 from the inactive mode's routes so any client confusion surfaces immediately. |
| AF-9 | **Persisting "last used IdP" for auto-selection** | On the login page, remember which IdP the user chose last time for faster re-auth. | There is exactly one IdP per deployment. There is nothing to remember. | Not applicable. |
| AF-10 | **Surfacing raw OIDC error codes to the user** | Pass through `error` and `error_description` from the IdP callback directly to the browser. | Raw OIDC errors like `access_denied`, `invalid_request`, `server_error` are technical and unhelpful to end users. Some may leak internal configuration details. | Map them to friendly messages: "Sign-in was denied by your identity provider. Contact your admin." Log the raw error server-side for debugging. |

---

## Feature Dependencies

```
TS-3 (AUTH_MODE gate — routes mounted or not)
    ├── enables ──> TS-1 (SSO button vs credential form in LoginPage)
    ├── enables ──> TS-2 (GET /api/auth/oidc/start route exists)
    └── enables ──> TS-6 (GET /api/auth/oidc/callback route exists)

TS-4 (OIDC discovery at startup)
    └── enables ──> TS-2 (needs authorization_endpoint URL)
                   TS-6 (needs token_endpoint URL)
                   TS-7 (needs jwks_uri for key fetch)

TS-2 (start route, state generation)
    └── requires ──> TS-5 (state must be stored to survive round-trip)

TS-5 (state cookie)
    └── enables ──> TS-6 (callback validates state)

TS-6 (code exchange)
    └── requires ──> TS-7 (ID token must be verified before use)

TS-7 (ID token verification)
    └── enables ──> TS-8 (claims can be extracted only after verification)

TS-8 (claim-to-username mapping)
    └── enables ──> TS-9 (username is stored in the session row)
                   TS-18 (missing claim = error, not empty string)

TS-9 (access token in session row)
    ├── enables ──> TS-11 (req.user.creds carries token; kinetica helpers send Bearer)
    ├── enables ──> TS-13 (token expiry fires KineticaAuthError → REAUTH chain)
    └── requires ──> existing sessionStore.ts schema extension

TS-11 (Bearer header in kinetica helpers)
    └── requires ──> kinetica.ts buildAuthHeader branch (Basic vs Bearer)

TS-12 (AUTH_MODE change wipes sessions)
    └── requires ──> startup persistence of previous AUTH_MODE (one SQLite row or similar)

TS-13 (token expiry → REAUTH chain)
    └── requires ──> existing v1.0 errorMiddleware + UNAUTHORIZED_EVENT chain (already shipped)
                     TS-14 (post-re-auth return to previous page)

TS-14 (return-to-page after re-auth)
    └── requires ──> sessionStorage in App.tsx bootstrap (before oidc/start redirect)

TS-15 (local logout)
    └── requires ──> existing POST /api/auth/logout (already correct, no change)

TS-16 (callback error UX)
    └── requires ──> LoginPage error rendering (already exists via login-error class)

TS-17 (IdP discovery fail-fast)
    └── requires ──> startup validation (analogous to requireConfig)

TS-18 (missing claim = explicit error)
    └── requires ──> TS-8 completion (claim extraction code must include the check)

D-1 (nonce)
    └── requires ──> TS-2 (generated alongside state), TS-7 (checked in ID token)

D-2 (store id_token in session)
    └── requires ──> TS-9 (session row must have a second BLOB column)

D-3 (/api/auth/me returns AUTH_MODE)
    └── requires ──> /api/auth/me route (already exists in index.ts)

D-4 (auth_mode in audit log)
    └── requires ──> kinetica.ts emitAudit (already exists; add one field)
```

---

## MVP Definition

### Must ship in v1.1 (milestone is incomplete without these)

| Priority | Feature | Reason |
|----------|---------|--------|
| P0 | **TS-3** (AUTH_MODE gate) | Everything else keys off this; build it first |
| P0 | **TS-4** (OIDC discovery) | Required before any flow can start |
| P0 | **TS-2** (start route) | Entry point for the OIDC flow |
| P0 | **TS-5** (state cookie) | CSRF defense; mandatory |
| P0 | **TS-6** (callback / code exchange) | The core OAuth exchange |
| P0 | **TS-7** (ID token verification) | Security baseline; never skip |
| P0 | **TS-8** (claim-to-username mapping) | Required to establish identity |
| P0 | **TS-9** (access token in session row) | The credential handoff to downstream Kinetica calls |
| P0 | **TS-11** (Bearer header in kinetica helpers) | Kinetica actually receives the token |
| P0 | **TS-12** (AUTH_MODE change wipes sessions) | Prevents credential-type confusion on redeployment |
| P0 | **TS-13** (token expiry → REAUTH) | Already works; verify it fires correctly |
| P0 | **TS-15** (local logout) | Already works; verify it still works |
| P1 | **TS-1** (SSO button on LoginPage) | UX entry point; required for usability |
| P1 | **TS-14** (return-to-page after re-auth) | Prevents disorienting UX after token expiry |
| P1 | **TS-16** (callback error UX) | Required; raw 500s on callback failure are unacceptable |
| P1 | **TS-17** (IdP discovery fail-fast) | Prevents silently broken deployments |
| P1 | **TS-18** (missing claim = explicit error) | Prevents silent empty-username sessions |

### Include if cheap (P2 — recommend)

| Feature | Why Include |
|---------|-------------|
| **D-1** (nonce) | ~10 lines of code; tightens ID token binding |
| **D-2** (store id_token) | One extra BLOB column; unlocks future claims surfacing |
| **D-3** (/api/auth/me returns AUTH_MODE) | One JSON field; makes frontend mode-branching clean |
| **D-4** (auth_mode in audit log) | One JSON field in an existing log line |

### Defer to v1.2+

| Feature | Why Defer |
|---------|-----------|
| **D-5** (configurable TTL env var) | 8h constant is fine for v1.1 |
| **AF-2** (refresh tokens) | Explicitly locked out; revisit only if team feedback demands it |
| **AF-4** (RP-initiated logout) | Explicitly locked out; revisit only if the IdP session persistence causes problems |
| Multi-IdP support | Out of scope (noted in PROJECT.md) |
| Account linking | Impossible in single-`AUTH_MODE` deployment model |

---

## Complexity Summary

| Feature | Category | Complexity |
|---------|----------|------------|
| TS-1 (SSO button on LoginPage) | Login Surface | Low |
| TS-2 (GET /api/auth/oidc/start) | Authorization Code Flow | Medium |
| TS-3 (AUTH_MODE gate) | Login Surface | Low |
| TS-4 (OIDC discovery) | Authorization Code Flow | Low-Medium |
| TS-5 (state cookie) | Authorization Code Flow | Medium |
| TS-6 (callback / code exchange) | Authorization Code Flow | Medium |
| TS-7 (ID token verification) | Authorization Code Flow | Medium-High |
| TS-8 (claim-to-username mapping) | Authorization Code Flow | Low |
| TS-9 (access token in session row) | Session Establishment | Medium |
| TS-10 (session TTL policy) | Session Establishment | None (no code) |
| TS-11 (Bearer header in helpers) | Session Establishment | Medium |
| TS-12 (AUTH_MODE change wipes sessions) | Session Establishment | Low-Medium |
| TS-13 (token expiry → REAUTH) | Token Expiry / Re-auth | Low (verify existing chain) |
| TS-14 (return-to-page after re-auth) | Token Expiry / Re-auth | Low |
| TS-15 (local logout) | Logout | None (existing behavior) |
| TS-16 (callback error UX) | Error UX | Low-Medium |
| TS-17 (IdP discovery fail-fast) | Error UX | Low |
| TS-18 (missing claim = explicit error) | Error UX | Low |
| D-1 (nonce) | Differentiator | Low |
| D-2 (store id_token) | Differentiator | Low |
| D-3 (/api/auth/me returns AUTH_MODE) | Differentiator | Low |
| D-4 (auth_mode in audit log) | Differentiator | Low |

**Heaviest single item:** TS-7 (ID token verification) — requires a JWKS-aware JWT library (`jose`), key fetching, and claim validation. Everything else is medium or lower.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| OIDC Authorization Code flow protocol | HIGH | OIDC Core spec (RFC 6749 + OIDC Core 1.0) is stable, well-established, training data is reliable |
| State / CSRF defense requirement | HIGH | Mandatory per spec; universally implemented |
| ID token verification requirements (signature, iss, aud, exp) | HIGH | OIDC Core spec §3.1.3.7 |
| Session store reuse from v1.0 | HIGH | Codebase directly read; `sessionStore.ts` + `auth.ts` both confirmed |
| kineticaSql / kineticaWms helper branching approach | HIGH | Codebase directly read; `buildAuthHeader` is the single insertion point |
| Frontend re-auth chain reuse | HIGH | `client.ts`, `auth.ts` store, `LoginPage.tsx` all directly read |
| Anti-feature rationale (PKCE on confidential client, refresh token risk, dual-auth complexity) | HIGH | Standard OAuth 2.0 security guidance (BCP 212 / RFC 6819) |
| `jose` library for JWKS/ID token verification | MEDIUM-HIGH | `jose` is the standard OIDC-capable JWT library in the Node.js ecosystem; version verified as current in v1.0 STACK.md (`6.2.3`, published 2026-04-27); no web search available to re-verify this session |
| Specific IdP behavior (claim names, error codes, discovery document completeness) | MEDIUM | IdP-specific; will vary. The claim mapping + missing-claim-error features (TS-8, TS-18) are the mitigations |

---

## Open Questions for ARCHITECTURE.md / STACK.md

1. **Session row schema extension:** Does TS-9 add a `credential_type` column to the existing `sessions` table, or does OIDC mode use a separate table? Single table with nullable columns (one of `password` or `access_token` populated) is simplest; two tables is cleaner but adds schema complexity.

2. **`state` nonce storage:** Short-lived httpOnly cookie (`kbi_oidc_state`, 5-min TTL) vs. an in-memory map (single-process safe, simpler, lost on restart) vs. a `pending_auth` SQLite row. Cookie is the right choice for robustness (survives process restart, no memory leak on abandoned flows), but needs care about cookie size and the `redirect_uri` needing to be in scope.

3. **`jose` vs `jsonwebtoken` for ID token verification:** `jsonwebtoken` cannot fetch JWKS remotely; it requires the key to be passed directly. `jose` supports JWKS endpoint fetching natively (`createRemoteJWKSet`). This milestone almost certainly needs `jose`. Confirm in STACK.md.

4. **Redirect URI configuration:** `AUTH_OIDC_REDIRECT_URI` must exactly match what is registered with the IdP. Document whether this is the full URL (`https://bi.kinetica.com/api/auth/oidc/callback`) or just the path, and whether the server auto-assembles it from `HOST` + path or requires the full URL in env.

5. **Post-callback redirect target:** After `GET /api/auth/oidc/callback` completes on the server, it must redirect the browser to the frontend. The frontend URL may differ from the server URL in dev (e.g., `localhost:5173` vs `localhost:4000`). Needs a `FRONTEND_URL` env var or similar.

---

*Feature research for: OIDC SSO support (v1.1), Kinetica BI*
*Researched: 2026-04-28*
