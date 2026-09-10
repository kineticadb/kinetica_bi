# Technology Stack — v1.1 OIDC SSO Support

**Project:** Kinetica BI — OIDC milestone additions only
**Researched:** 2026-04-28
**Confidence:** HIGH (based on codebase inspection + library knowledge from training data; external fetch tools not available in this session — see confidence notes per item)

---

## Scope

This file covers **only what is new or changed for v1.1 OIDC SSO**. The existing v1.0 stack (Express 4, TypeScript, better-sqlite3, jsonwebtoken, vitest, etc.) is not re-evaluated. See `.planning/research/_archive_pre-v1.0/STACK.md` for the baseline.

---

## The One Library to Add: `openid-client` v5

**Recommendation: `openid-client@^5` (panva) — the only new production dependency needed.**

### Why openid-client

`openid-client` is the de-facto standard OIDC Relying Party library for Node.js. It is used by the majority of production Node OIDC implementations and is the basis of `node-oidc-provider`'s client-side counterpart. Panva (Filip Skokan) is a long-standing OIDC Working Group contributor whose libraries are cited in the OIDC spec examples.

What it gives us directly:

| Capability | Built-in | Notes |
|------------|----------|-------|
| `.well-known/openid-configuration` discovery | YES | `Issuer.discover(url)` — one call at boot, result cached for the process lifetime |
| PKCE (code_verifier / code_challenge) | YES | `generators.codeVerifier()` + `generators.codeChallenge()` in the `openid-client` generators module |
| State + nonce generation | YES | `generators.state()` + `generators.nonce()` — or use `crypto.randomBytes` directly (same outcome) |
| Authorization URL construction | YES | `client.authorizationUrl({ scope, redirect_uri, state, nonce, code_challenge, code_challenge_method })` |
| Authorization Code callback + token exchange | YES | `client.callback(redirectUri, params, checks)` — handles PKCE verification, nonce check, token response |
| ID token signature verification via JWKS | YES | Fetches `jwks_uri` from discovery document; caches keys; verifies RS256/ES256/PS256 automatically |
| JWKS key caching + rotation | YES | Built-in key cache with TTL; re-fetches on unknown `kid`; no separate `jwks-rsa` needed |
| Access token extraction from token set | YES | `tokenSet.access_token` |
| TypeScript types | YES | `@types/openid-client` is bundled (types are first-party since v4) |
| Express integration | Manual | Library is framework-agnostic; we wire routes manually — this is correct for our architecture |

### Version to install

`openid-client@^5.x` — v5 is the current stable major on npm as of early 2026 (MEDIUM confidence — last confirmed from training data; panva maintains a very stable release cadence and v5 has been the stable major since 2023).

Note: panva has been developing `openid-client` v6 as a complete rewrite using Web Crypto and platform-neutral primitives. As of training data cut-off (mid-2025), v6 was in active development / not yet stable. **Use v5, not v6**, until v6 reaches stable status and Express 4 adapter patterns are documented. v5 works on Node 18+ with no breaking changes.

```bash
cd kinetica_bi/server
npm install openid-client@^5
```

There are no `@types/openid-client` to add separately — types are bundled with the package in v5.

---

## jsonwebtoken v9 — Keep, No Change

`jsonwebtoken@^9.0.3` is already installed and should stay unchanged.

**It is used for:** signing and verifying our own opaque session cookies (`{ sub, sid, v: 1 }`) with a symmetric `AUTH_SECRET`. This is correct for its purpose.

**It is NOT used for:** OIDC ID token verification. `jsonwebtoken` cannot do runtime JWKS URI fetching — it requires the signing key to be provided by the caller at verify time. OIDC ID tokens are signed by the IdP with RS256/ES256 using a rotating key set published at `jwks_uri`. `openid-client` handles this via its internal `jose`-based JWKS fetcher, which does key rotation transparently.

Do not try to use `jsonwebtoken.verify()` on OIDC ID tokens unless you manually fetch and cache JWKS yourself — that complexity is exactly what `openid-client` eliminates.

---

## JWKS Caching — Covered by openid-client; No Separate Library

`jwks-rsa` is not needed. `openid-client` v5 uses `jose` internally for all JWK and JWT operations and handles the JWKS URI cache itself:

- Keys fetched from `jwks_uri` on first use, cached in-process
- Unknown `kid` in a received ID token triggers a JWKS re-fetch (handles key rotation)
- Cache is per-`Client` instance — use a module-level singleton (see Architecture below)

`jwks-rsa` is the right choice only if building a custom Express JWT middleware that is NOT using `openid-client` for token exchange. Since we are using `openid-client`'s `client.callback()` for the full flow, `jwks-rsa` is redundant.

---

## PKCE — Covered by openid-client; No Separate Library

`openid-client` v5 exports a `generators` module:

```typescript
import { generators } from "openid-client";

const codeVerifier = generators.codeVerifier();          // 43-128 char URL-safe string
const codeChallenge = generators.codeChallenge(codeVerifier); // SHA-256 → base64url
```

Both calls are synchronous and use Node's built-in `crypto` module under the hood. No separate PKCE library is needed.

---

## State and Nonce Generation — crypto.randomBytes (no new dep)

```typescript
import { randomBytes } from "node:crypto";

const state = randomBytes(32).toString("base64url");
const nonce = randomBytes(32).toString("base64url");
```

`openid-client` also provides `generators.state()` and `generators.nonce()`, which call the same underlying entropy source. Either approach is fine. Using `crypto.randomBytes` directly is explicit and has zero dependency surface beyond Node's built-in crypto module, which the codebase already uses (`sessionStore.ts` uses `randomBytes` for SID generation).

Store `state`, `nonce`, and `codeVerifier` server-side (keyed by `state`) for the duration of the redirect dance, then discard them after the callback is consumed. A simple in-memory `Map<string, OidcFlowState>` with a 10-minute TTL is sufficient — no persistent storage needed since these are short-lived. Do not use the session store for this; the session does not exist until the callback succeeds.

---

## New Environment Variables (No Library Impact)

The following env vars are consumed in `src/oidc.ts` via `process.env`. No library is needed to parse them — they are plain strings read at boot.

```bash
# Required when AUTH_MODE=oidc
AUTH_MODE=oidc                          # or "password" (existing)
AUTH_OIDC_ISSUER=https://idp.example.com
AUTH_OIDC_CLIENT_ID=kinetica-bi
AUTH_OIDC_CLIENT_SECRET=<secret>
AUTH_OIDC_REDIRECT_URI=https://bi.example.com/api/auth/oidc/callback

# Optional — identity claim mapping
AUTH_OIDC_USERNAME_CLAIM=preferred_username   # default
AUTH_OIDC_USERNAME_REGEX=                     # optional regex transform, e.g. "^([^@]+)@.*$" → "$1"
```

Add all of these to `.env.example` with comments. `dotenv@^16` (already installed) reads them at startup.

---

## Changes to Existing Modules (Not New Libraries)

### kinetica.ts — `buildAuthHeader` must branch on credential type

Currently:

```typescript
// src/kinetica.ts (v1.0)
const buildAuthHeader = (creds: { username: string; password: string }): string =>
  `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString("base64")}`;
```

For v1.1, the session row can hold either a password (password mode) or an access token (OIDC mode). The helper must emit `Authorization: Bearer <token>` when in OIDC mode:

```typescript
// Proposed discriminated union (src/auth.ts — credential type)
export type PasswordCreds = { type: "password"; username: string; password: string };
export type OidcCreds    = { type: "oidc";     username: string; accessToken: string };
export type SessionCreds = PasswordCreds | OidcCreds;
```

```typescript
// src/kinetica.ts — new buildAuthHeader signature
const buildAuthHeader = (creds: SessionCreds): string =>
  creds.type === "oidc"
    ? `Bearer ${creds.accessToken}`
    : `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString("base64")}`;
```

The `kineticaSql` and `kineticaWms` function signatures do NOT change — they still take `AuthedRequest`. The `req.user.creds` type changes from `{ username; password }` to `SessionCreds`. The helper boundary is preserved; routes are untouched.

### sessionStore.ts — `createSession` overload for OIDC

The encrypted column currently stores a password. In OIDC mode it stores an access token. The AES-256-GCM encryption mechanism is identical — the stored secret is just different in semantics.

Options:
1. **Rename `password` field to `secret` in `SessionRow`** and treat it as the encrypted payload regardless of mode — simplest, requires renaming in auth.ts too.
2. **Add an `auth_mode` column to the `sessions` table** — lets `getSession` reconstruct the right credential type from the row.

**Recommended: Option 2 (add `auth_mode` column).** It makes the type reconstruction in `getSession` explicit without relying on a runtime `AUTH_MODE` env var. The migration is a single `ALTER TABLE sessions ADD COLUMN auth_mode TEXT NOT NULL DEFAULT 'password'` (existing rows get 'password' via DEFAULT).

### auth.ts — `AuthedRequest.user.creds` type

Widen from `{ username: string; password: string }` to `SessionCreds` (discriminated union above).

`requireAuth` will call `getSession(decoded.sid)` which now returns a `SessionRow` including `auth_mode`. Use that to construct the right `SessionCreds` variant before attaching to `req.user`.

### Boot-time AUTH_MODE change detection — existing pattern

`PROJECT.md` specifies that changing `AUTH_MODE` wipes the sessions table (mirrors the existing `AUTH_SECRET` rotation pattern). This is a `src/oidc.ts` concern, not a library concern. At boot, read the persisted `auth_mode` from the first session row (or a dedicated config row) and compare to `AUTH_MODE` env var. If different, `DELETE FROM sessions`. No library needed.

---

## New Module: `src/oidc.ts`

Responsibilities:
1. At boot (called once from `createApp`): `Issuer.discover(AUTH_OIDC_ISSUER)` → build a `Client` singleton
2. Export `getOidcClient(): Client` — throws if `AUTH_MODE !== 'oidc'` or not yet initialized
3. Export `buildAuthorizationUrl(state, nonce, codeVerifier): string`
4. Export `handleCallback(params, expectedState, expectedNonce, codeVerifier): Promise<TokenSet>`
5. Export `extractUsername(claims: IdTokenClaims): string` — applies `AUTH_OIDC_USERNAME_CLAIM` + `AUTH_OIDC_USERNAME_REGEX`

New routes in `index.ts`:
```
GET  /api/auth/oidc/start      → generate state/nonce/PKCE, store in memory Map, redirect to IdP
GET  /api/auth/oidc/callback   → validate callback, exchange code, extract username, create session, set cookie, redirect to /
POST /api/auth/logout          → existing; already does local-only logout; no change needed
```

These routes are gated by `AUTH_MODE === 'oidc'` at the point they are registered. If `AUTH_MODE === 'password'`, these routes are simply not registered (or return 404) and the existing `/api/auth/login` remains.

---

## Summary: What to Install vs What to Change

### New npm dependency

| Package | Version | Location | Purpose |
|---------|---------|----------|---------|
| `openid-client` | `^5` | `kinetica_bi/server/dependencies` | Full OIDC Authorization Code + PKCE flow, ID token verification via JWKS, discovery |

**No other new packages.** All other capabilities come from Node built-ins (`node:crypto`) or the existing `openid-client` library.

### Packages NOT to add

| Package | Why Not |
|---------|---------|
| `jwks-rsa` | Redundant — `openid-client` includes JWKS fetching and caching internally |
| `passport` + `passport-openidconnect` | Requires `passport.initialize()` + session middleware; conflicts with our custom session store; adds 2 deps for zero benefit |
| `@panva/hkdf` / `jose` (direct) | Pulled in transitively by `openid-client`; do not depend on them directly |
| Any IdP-specific SDK (Auth0, Okta, etc.) | Locked decision: generic OIDC only |
| `pkce-challenge` or similar | `openid-client` generators module covers this |

### Existing deps unchanged

| Package | Stays As-Is | Notes |
|---------|-------------|-------|
| `jsonwebtoken@^9.0.3` | YES | Our session cookies only; not involved in OIDC token verification |
| `better-sqlite3@^12.8.0` | YES | Schema migration to add `auth_mode` column is DDL only |
| `cookie-parser@^1.4.7` | YES | Unchanged |
| `express@^4.19.2` | YES | Unchanged |
| `dotenv@^16.4.5` | YES | Reads new OIDC env vars automatically |

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| OIDC client | `openid-client@^5` | `passport-openidconnect` | Requires `passport` + `express-session`; conflicts with our custom AES-256-GCM session store; Passport's session interface is not compatible |
| OIDC client | `openid-client@^5` | Hand-rolled with `jose` | `jose` is what `openid-client` uses internally; building the discovery, PKCE, token exchange, and JWKS validation layer from `jose` primitives requires 200–300 lines of code that `openid-client` already provides correctly. Only justified if `openid-client` lacks a specific feature — it doesn't for this scope. |
| OIDC client | `openid-client@^5` | `openid-client@^6` (panva rewrite) | v6 is a Web Crypto API rewrite; not yet stable as of mid-2025 training data. Express 4 integration patterns are not yet established for v6. Use v5 now; evaluate v6 for a future maintenance milestone. |
| JWKS cache | `openid-client` built-in | `jwks-rsa` | `jwks-rsa` is a fine library but redundant when `openid-client` is already handling JWKS. Adding it would be a second JWKS mechanism for the same purpose. |
| State/nonce | `crypto.randomBytes` (Node built-in) | `uuid` library | `uuid` adds a dependency for something `randomBytes` does natively. Codebase already uses `randomBytes` for SID generation (`sessionStore.ts:52`). |

---

## Confidence Assessment

| Claim | Confidence | Basis |
|-------|------------|-------|
| `openid-client` v5 is the right choice for Node OIDC | HIGH | Training data + ecosystem consensus; panva is the reference OIDC library author for JS |
| `openid-client` v5 includes PKCE generators, JWKS, discovery | HIGH | Well-documented stable API in training data; v5 API stable since 2023 |
| `openid-client` v5 types are first-party (no `@types/` needed) | HIGH | Bundled since v4; confirmed by pkg structure knowledge |
| `openid-client` v5 current as of early 2026 (not superseded by v6) | MEDIUM | Training data shows v6 in development as of mid-2025; v5 still stable; cannot confirm npm registry state without live fetch |
| `jsonwebtoken` cannot do JWKS-backed asymmetric verification | HIGH | By design — `jsonwebtoken.verify()` requires the caller to supply the key, not a JWKS URI |
| Auth mode branching in `buildAuthHeader` is the right integration point | HIGH | Direct code inspection of `kinetica.ts` — the function is isolated, one-line change |
| `ALTER TABLE sessions ADD COLUMN auth_mode` is safe migration | HIGH | SQLite `ALTER TABLE ADD COLUMN` with DEFAULT is non-destructive; existing rows get 'password' |

---

## Sources

- Codebase direct inspection: `kinetica_bi/server/src/kinetica.ts`, `auth.ts`, `sessionStore.ts`, `index.ts`, `package.json`
- Training data: openid-client v5 API surface, OIDC Authorization Code + PKCE flow specification, jwks-rsa vs openid-client comparison
- Project decisions: `.planning/PROJECT.md` (locked v1.1 decisions), `.planning/MILESTONES.md` (v1.0 seams)

---

*Stack research for: Kinetica BI v1.1 — OIDC SSO additions*
*Researched: 2026-04-28*
