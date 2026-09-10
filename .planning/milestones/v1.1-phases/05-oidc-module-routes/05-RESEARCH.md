# Phase 5: OIDC Module + Routes - Research

**Researched:** 2026-04-30
**Domain:** openid-client v5 Authorization Code flow, Express route integration, OIDC state/nonce security
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- State + nonce stored in a single `oidc_state` httpOnly cookie carrying plain JSON `{state, nonce}`. Cookie name: `oidc_state`. Attributes: `httpOnly: true`, `sameSite: "lax"`, `path: "/"`, `maxAge: 10 * 60 * 1000`, `secure: process.env.NODE_ENV === "production"`.
- Cookie cleared unconditionally on callback (success path AND every error path) via `res.clearCookie('oidc_state', { path: "/" })`.
- State generator: `node:crypto.randomBytes(32).toString('base64url')` for both state and nonce.
- All callback errors redirect to `/login?error=<code>` (HTTP 302). Never 500 or blank.
- Friendly error codes (locked vocabulary): `oidc_denied`, `oidc_invalid`, `oidc_token_invalid`, `oidc_no_username`.
- Raw IdP error codes NOT passed through to user. Logged server-side.
- `GET /api/auth/config` response shape: bare `{ authMode: 'password' | 'oidc' }`. Headers: `Cache-Control: no-store`.
- `GET /api/auth/config` is unauthenticated, mounted BEFORE `app.use("/api", requireAuth)`.
- `authMode` const read once at `createApp()` from `process.env.AUTH_MODE`, stored locally. Never read per-route.
- Test mock: `vi.mock("openid-client", () => ({ ... }))` at module boundary.
- Inactive route response: 400 with JSON `{error}`.
- Boot-time: `validateOidcEnv()` throws on missing env vars. Live `Issuer.discover()` failure tested via mock rejected promise.
- `openid-client@^5` is the library. Confidential client with secret. No PKCE.
- Authorization Code flow only. No implicit, no hybrid.
- Discovery at `${AUTH_OIDC_ISSUER_URL}/.well-known/openid-configuration`, cached in module-level `let _metadata`.
- Boot-time fetch; fail-fast; not lazy.
- `redirect_uri` from `AUTH_OIDC_REDIRECT_URI` env var ONLY — never from request headers.
- ID token verified via JWKS. Audience = `AUTH_OIDC_CLIENT_ID`. Issuer = normalized `AUTH_OIDC_ISSUER_URL` (trailing slash stripped at boot). `exp` checked. `nonce` claim checked.
- Clock tolerance: 30s.
- Username from verified id_token claims using `AUTH_OIDC_USERNAME_CLAIM` (default `preferred_username`). Optional `AUTH_OIDC_USERNAME_REGEX` transform.
- Empty username result → `oidc_no_username` error redirect.
- Access token claims NEVER used for username — only id_token.
- Session: `createSession({ username, secret: accessToken, kineticaUrl, credentialType: 'oidc', idToken })`.
- JWT cookie `v: 1` NOT bumped.
- `issueSessionCookie(res, username, sid)` reused unchanged.
- `asyncHandler` pattern for async `/oidc/callback`.
- Loud-failure on OIDC misconfig at boot.
- AUTH_MODE values: `"password"` (default) or `"oidc"`. Anything else → boot fails.

### Claude's Discretion

- Exact internal layout of `src/oidc.ts` (module-level state vs class — recommend module-level).
- Whether to use `client.callback()` or manual steps (recommend `client.callback()`).
- Whether `validateOidcEnv()` returns a frozen config object or just throws on missing values (returns config recommended).
- File organization for new tests (`auth.oidc.spec.ts` vs split).
- Internal helper names within `oidc.ts`.
- Whether to add `request_id`-style log correlation for OIDC errors (recommend yes).
- Trailing-slash normalization implementation detail.
- Inactive-route 400 message wording.

### Deferred Ideas (OUT OF SCOPE)

- `buildAuthHeader` Bearer/Basic branch in `kinetica.ts` — Phase 6.
- Token expiry early-detection in `getSession` — Phase 6.
- `auth_mode` field in audit log — Phase 6.
- Frontend `LoginPage` SSO button + `?error` banner rendering — Phase 7.
- `fetchAuthConfig` helper + `authMode` in Zustand store — Phase 7.
- Return-to-page after re-auth — Phase 7.
- `/api/auth/me` response includes `authMode` — Phase 7.
- Boot-time AUTH_MODE-change session wipe — Phase 8.
- DEPLOY-RUNBOOK.md OIDC trust section — Phase 8.
- Refresh-token storage — explicitly rejected (FEATURES AF-2).
- PKCE — explicitly rejected (FEATURES AF-1).
- RP-initiated logout — explicitly rejected (FEATURES AF-4).
- Live unreachable-URL integration test for discovery — rejected (CI flakiness).
- Fake IdP HTTP server in tests — rejected.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| OIDC-02 | `GET /api/auth/oidc/start` builds IdP authorization URL from discovered `authorization_endpoint`, generates cryptographically random `state`, persists in short-lived httpOnly cookie, 302-redirects to IdP | `client.authorizationUrl()` returns a `string` directly; `randomBytes(32).toString('base64url')` for state/nonce; cookie pattern documented below |
| OIDC-03 | OIDC discovery doc fetched at startup from `${AUTH_OIDC_ISSUER_URL}/.well-known/openid-configuration`, cached in process memory, fail-fast on failure | `Issuer.discover(issuerUrl)` returns `Promise<Issuer>`; module-level singleton; `createApp()` must become async |
| OIDC-04 | Returned `state` on callback must match persisted value; mismatch → reject | `client.callback()` `checks.state` enforces this internally; also use `crypto.timingSafeEqual` at route level before calling library |
| OIDC-05 | `GET /api/auth/oidc/callback` exchanges authorization `code` for tokens at `token_endpoint` using client credentials | `client.callback(redirectUri, params, checks)` handles full exchange; `params` from `req.query`; checks includes state/nonce |
| OIDC-06 | `id_token` JWT signature verified against JWKS (from `jwks_uri`); audience = `AUTH_OIDC_CLIENT_ID`; issuer = `AUTH_OIDC_ISSUER_URL`; `exp` checked | `client.callback()` verifies signature, aud, iss, exp automatically when Client constructed from discovered Issuer; JWKS fetched automatically from `jwks_uri` |
| OIDC-07 | Username extracted from verified ID token claims using `AUTH_OIDC_USERNAME_CLAIM` (default `preferred_username`); optional regex transform; empty → user-visible error | `tokenSet.claims()` returns parsed ID token payload; claim extraction + regex is manual post-`callback()` |
| OIDC-08 | Callback errors redirect to LoginPage with short non-leaking error message; never 500 or blank | Error mapping table: `OPError` (IdP errors) → friendly codes; `RPError` (validation failures) → friendly codes; all exits redirect |
| MODE-01 | `AUTH_MODE` env var gates which auth routes are active; in OIDC mode `POST /api/auth/login` returns 400 | `authMode` const read once in `createApp()`; guard at top of login handler; OIDC routes mounted regardless (return 400 in password mode) |
</phase_requirements>

---

## Summary

Phase 5 introduces `src/oidc.ts` (the OIDC module) and three new routes into the existing Express app. The library is `openid-client@^5` (v5.7.1 current as of 2026-04-30), which provides a class-based API (`Issuer.discover` → `new issuer.Client` → `client.callback`) that handles discovery, JWKS fetching, token exchange, and ID token verification in one call. The Phase 4 `createSession` contract is fully ready: the options-object signature with `credentialType: 'oidc'` and `idToken` fields was shipped in Plan 04-02.

The single most important resolved finding: **stay on openid-client@^5 (v5.7.1) for this phase.** npm's `latest` tag now points to v6.8.4 (a complete ESM-only rewrite with entirely different API). v6 is stable but uses a function-based API (`client.discovery()`, `client.authorizationCodeGrant()`) that is incompatible with the v5 patterns planned in CONTEXT.md. CONTEXT.md locks `openid-client@^5`; this decision is validated and correct.

**Primary recommendation:** Use `client.callback(redirectUri, req.query, { state: storedState, nonce: storedNonce })` as the single integration point for token exchange + ID token verification. Set `client[custom.clock_tolerance] = 30` after client construction. The planner should route all route-level error handling through a single `try/catch` block that maps `OPError`, `RPError`, and generic `Error` to the four locked friendly codes.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `openid-client` | `^5` (v5.7.1 current) | OIDC RP: discovery, auth URL, code exchange, ID token verification, JWKS | The canonical Node.js OIDC library by panva (OIDC Working Group contributor); handles all security-critical steps in one `client.callback()` call |

### Supporting (already installed — no new deps)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `cookie-parser` | `^1.4.7` | Parse `oidc_state` cookie on callback | Already in `createApp()` — `req.cookies.oidc_state` is available |
| `node:crypto` | built-in | `randomBytes(32).toString('base64url')` for state/nonce generation | Zero new dep; same as `sessionStore.ts:55` SID generation |

**Installation (the ONLY new package):**
```bash
cd kinetica_bi/server
npm install openid-client@^5
```

**Version verified:** `npm show openid-client` → `latest: 6.8.4`, but `npm show openid-client@^5 version` → `5.7.1`. Install with explicit `@^5` range. Types are first-party (no `@types/openid-client` needed).

---

## Library Surface

### `Issuer.discover(issuerUrl)`

```typescript
// Source: openid-client v5 README + Context7 query
import { Issuer } from "openid-client";

const issuer = await Issuer.discover("https://idp.example.com");
// Returns: Issuer instance with populated metadata:
//   issuer.metadata.authorization_endpoint: string
//   issuer.metadata.token_endpoint: string
//   issuer.metadata.jwks_uri: string
//   issuer.metadata.issuer: string  ← canonical issuer string to compare against
```

- Fetches `${issuerUrl}/.well-known/openid-configuration`.
- Caches nothing by itself — cache is the caller's responsibility (module-level `let _client`).
- JWKS is NOT fetched during discovery. It is fetched automatically by `client.callback()` on first use (from `issuer.metadata.jwks_uri`), then cached per-`Client` instance. This means the `Client` singleton must live for the process lifetime to benefit from JWKS caching.

### `new issuer.Client(metadata)`

```typescript
// Source: openid-client v5 README
import { custom } from "openid-client";

const client = new issuer.Client({
  client_id: config.clientId,               // AUTH_OIDC_CLIENT_ID
  client_secret: config.clientSecret,       // AUTH_OIDC_CLIENT_SECRET
  redirect_uris: [config.redirectUri],       // AUTH_OIDC_REDIRECT_URI
  response_types: ["code"],                  // Authorization Code only
  id_token_signed_response_alg: "RS256",    // default; most IdPs use RS256
});

// CRITICAL: set clock tolerance AFTER construction via custom symbol
client[custom.clock_tolerance] = 30;        // 30-second tolerance (PITFALLS T-06)
// NOT a constructor option — must be applied as a property assignment post-construction
```

**Key config notes:**
- `id_token_signed_response_alg` defaults to `"RS256"`. Most IdPs (Keycloak, Auth0, Okta, Entra) use RS256. Setting it explicitly is defensive. If an IdP uses ES256, this must be changed or omitted (fallback auto-detection).
- `token_endpoint_auth_method` defaults to `'client_secret_basic'` which is correct for confidential clients.
- `clockTolerance` is NOT a constructor option. It is set via `client[custom.clock_tolerance] = 30` (the `custom` symbol imported from `openid-client`).

### `client.authorizationUrl(params)`

```typescript
// Source: openid-client v5 README
const url: string = client.authorizationUrl({
  scope: "openid profile",       // request profile to get preferred_username
  redirect_uri: config.redirectUri,
  state: state,                  // base64url-encoded random 32 bytes
  nonce: nonce,                  // base64url-encoded random 32 bytes
});
// Return type is string (not URL object)
```

- Returns a `string` — directly passable to `res.redirect(url)`.
- `scope` should be `"openid profile"` at minimum to ensure `preferred_username` is returned (PITFALLS T-04). The locked env var `AUTH_OIDC_USERNAME_CLAIM` defaults to `preferred_username` which requires `profile` scope.

### `client.callback(redirectUri, params, checks)`

```typescript
// Source: openid-client v5 README + API docs
const tokenSet = await client.callback(
  config.redirectUri,        // string: must exactly match registered redirect_uri
  req.query,                 // Object: the full query string from the callback URL
                             // (includes code, state, error, error_description, etc.)
  {
    state: storedState,      // string: expected state value from oidc_state cookie
    nonce: storedNonce,      // string: expected nonce value from oidc_state cookie
    // No code_verifier — no PKCE (locked decision AF-1)
  }
);
```

**What it does internally (all automatic):**
1. Checks `params.error` — if present, throws `OPError`
2. Validates `params.state === checks.state` — mismatch throws `RPError`
3. POST to `token_endpoint` with `code`, `client_id`, `client_secret`, `redirect_uri`, `grant_type=authorization_code`
4. Fetches JWKS from `issuer.metadata.jwks_uri` (cached per Client instance)
5. Verifies `id_token` signature (RS256/ES256/PS256 — whichever `kid` indicates)
6. Validates `aud === client_id`, `iss === issuer.metadata.issuer`, `exp > now - clockTolerance`, `nonce === checks.nonce`
7. Returns `TokenSet`

**`params` argument note:** `req.query` from Express is typed as `ParsedQs` but openid-client accepts any object with string values. Cast as needed: `client.callback(uri, req.query as Record<string, string>, checks)`.

### `TokenSet`

```typescript
// Source: openid-client v5 API docs
tokenSet.access_token   // string — the OAuth 2.0 access token
tokenSet.id_token       // string — the signed+encoded ID token JWT
tokenSet.expires_in     // number — seconds until access token expires
tokenSet.expires_at     // number — Unix timestamp (seconds since epoch)
tokenSet.token_type     // string — usually "Bearer"

tokenSet.claims()       // Returns parsed ID token payload as a plain object
                        // Contains: sub, iss, aud, exp, iat, nonce, preferred_username, email, ...
                        // DOES NOT re-verify signature — use only after client.callback() has verified
```

### Error Classes

```typescript
import { errors } from "openid-client";
// or: import { OPError, RPError } from "openid-client";

// OPError: thrown when the authorization server (IdP) returns an error response
// Properties: .error (string), .error_description (string|undefined), .response (IncomingMessage|undefined)
// Examples: error='access_denied', error='invalid_request', error='server_error'

// RPError: thrown when CLIENT-SIDE validation fails
// Properties: .message (string), .checks (object), .jwt (string), .params (object)
// Examples: state mismatch, nonce mismatch, iss mismatch, aud mismatch, exp past, signature invalid

// Both extend Error — catch with instanceof checks
```

---

## Module Implementation

### `src/oidc.ts` — Complete Map

```typescript
// server/src/oidc.ts — module-level singleton pattern
import { Issuer, Client, custom, errors } from "openid-client";
import { randomBytes } from "node:crypto";

// ---- Config type ----
export type OidcConfig = {
  issuer: string;           // AUTH_OIDC_ISSUER_URL, trailing slash stripped
  clientId: string;         // AUTH_OIDC_CLIENT_ID
  clientSecret: string;     // AUTH_OIDC_CLIENT_SECRET
  redirectUri: string;      // AUTH_OIDC_REDIRECT_URI
  usernameClaim: string;    // AUTH_OIDC_USERNAME_CLAIM, default 'preferred_username'
  usernameRegex?: string;   // AUTH_OIDC_USERNAME_REGEX, optional
};

// ---- validateOidcEnv ----
// Called at boot in createApp() when AUTH_MODE=oidc.
// Throws with clear message if any required var is missing.
// Strips trailing slash from issuer (PITFALLS O-01, C-05).
// Returns config object (recommended: reused by getOidcClient).
export const validateOidcEnv = (): OidcConfig => {
  const issuerRaw = process.env.AUTH_OIDC_ISSUER_URL;
  const clientId = process.env.AUTH_OIDC_CLIENT_ID;
  const clientSecret = process.env.AUTH_OIDC_CLIENT_SECRET;
  const redirectUri = process.env.AUTH_OIDC_REDIRECT_URI;
  if (!issuerRaw) throw new Error("AUTH_OIDC_ISSUER_URL is required when AUTH_MODE=oidc");
  if (!clientId) throw new Error("AUTH_OIDC_CLIENT_ID is required when AUTH_MODE=oidc");
  if (!clientSecret) throw new Error("AUTH_OIDC_CLIENT_SECRET is required when AUTH_MODE=oidc");
  if (!redirectUri) throw new Error("AUTH_OIDC_REDIRECT_URI is required when AUTH_MODE=oidc");
  return {
    issuer: issuerRaw.replace(/\/$/, ""),  // strip trailing slash (PITFALLS O-01)
    clientId,
    clientSecret,
    redirectUri,
    usernameClaim: process.env.AUTH_OIDC_USERNAME_CLAIM || "preferred_username",
    usernameRegex: process.env.AUTH_OIDC_USERNAME_REGEX || undefined,
  };
};

// ---- Module-level singleton ----
// Initialized at boot in createApp(); never re-fetched per request (ARCHITECTURE AP-5).
let _client: Client | null = null;
let _config: OidcConfig | null = null;

export const initOidcClient = async (config: OidcConfig): Promise<void> => {
  const issuer = await Issuer.discover(config.issuer);
  const client = new issuer.Client({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uris: [config.redirectUri],
    response_types: ["code"],
    id_token_signed_response_alg: "RS256",
  });
  client[custom.clock_tolerance] = 30;   // PITFALLS T-06
  _client = client;
  _config = config;
};

export const getOidcClient = (): Client => {
  if (!_client) throw new Error("[oidc] OIDC client not initialized");
  return _client;
};

export const getOidcConfig = (): OidcConfig => {
  if (!_config) throw new Error("[oidc] OIDC config not initialized");
  return _config;
};

// ---- buildAuthorizationUrl ----
export const buildAuthorizationUrl = (state: string, nonce: string): string => {
  const client = getOidcClient();
  const config = getOidcConfig();
  return client.authorizationUrl({
    scope: "openid profile",
    redirect_uri: config.redirectUri,   // pinned to env var (PITFALLS C-07)
    state,
    nonce,
  });
};

// ---- exchangeCode ----
// Calls client.callback() which handles: token exchange, JWKS fetch, ID token verification,
// state/nonce check, aud/iss/exp validation.
// Returns { accessToken, idToken, claims }.
// Throws OPError (IdP error response) or RPError (validation failure).
export const exchangeCode = async (
  code: string,
  expectedState: string,
  expectedNonce: string
): Promise<{ accessToken: string; idToken: string; claims: Record<string, unknown> }> => {
  const client = getOidcClient();
  const config = getOidcConfig();
  const tokenSet = await client.callback(
    config.redirectUri,
    { code, state: expectedState },    // params: only code+state needed here
    { state: expectedState, nonce: expectedNonce }
  );
  return {
    accessToken: tokenSet.access_token!,
    idToken: tokenSet.id_token!,
    claims: tokenSet.claims() as Record<string, unknown>,
  };
};

// ---- extractUsername ----
export const extractUsername = (
  claims: Record<string, unknown>,
  config: OidcConfig
): string | null => {
  const raw = claims[config.usernameClaim];
  if (typeof raw !== "string" || !raw.trim()) return null;
  if (!config.usernameRegex) return raw;
  const match = raw.match(new RegExp(config.usernameRegex));
  const extracted = match?.[1] ?? match?.[0] ?? "";
  return extracted.trim() || null;
};
```

**Key design decisions:**
- `initOidcClient()` is called once from `createApp()` (not exported as lazy getter). Boot-time fail-fast behavior requires the await to happen before `app.listen`.
- `_client` singleton lives for the process lifetime — JWKS cache is per-Client instance; killing it destroys the key cache.
- `exchangeCode` passes `{ code, state: expectedState }` as the `params` argument to `client.callback()`. The state goes in both `params` (echoed from query string) and `checks.state` (expected value). The library compares them internally.

---

## Route Implementation

### `createApp()` changes — async upgrade

```typescript
// server/src/index.ts

export const createApp = async (): Promise<Express> => {
  const app = express();
  // ...existing middleware setup...

  // Read authMode ONCE at createApp() top — never per-route (ARCHITECTURE anti-pattern)
  const authMode = (process.env.AUTH_MODE || "password") as "password" | "oidc";
  if (authMode !== "password" && authMode !== "oidc") {
    throw new Error("[boot] AUTH_MODE must be 'password' or 'oidc'");
  }

  // OIDC boot-time initialization (fail-fast per Phase 5 SC6)
  let oidcConfig: OidcConfig | null = null;
  if (authMode === "oidc") {
    oidcConfig = validateOidcEnv();                    // throws on missing vars
    await initOidcClient(oidcConfig);                  // throws on discovery failure
    console.log(`[boot] OIDC initialized. Issuer: ${oidcConfig.issuer}`);
    console.log(`[boot] Redirect URI: ${oidcConfig.redirectUri}`); // O-03 operator check
  }

  // ... existing routes ...

  // POST /api/auth/login — guard for OIDC mode (MODE-01)
  app.post("/api/auth/login", async (req, res) => {
    if (authMode !== "password") {
      return res.status(400).json({ error: "Password login is disabled. Use OIDC." });
    }
    // ... existing login logic ...
  });

  // GET /api/auth/config — unauthenticated, before requireAuth (CONTEXT.md decision)
  app.get("/api/auth/config", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");        // PITFALLS I-03
    res.json({ authMode });
  });

  // GET /api/auth/oidc/start
  app.get("/api/auth/oidc/start", (req, res) => {
    if (authMode !== "oidc") {
      return res.status(400).json({ error: "OIDC is not enabled." });
    }
    const state = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    res.cookie("oidc_state", JSON.stringify({ state, nonce }), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 10 * 60 * 1000,
      secure: process.env.NODE_ENV === "production",
    });
    const url = buildAuthorizationUrl(state, nonce);
    return res.redirect(url);
  });

  // GET /api/auth/oidc/callback
  app.get("/api/auth/oidc/callback", asyncHandler(async (req, res) => {
    if (authMode !== "oidc") {
      return res.status(400).json({ error: "OIDC is not enabled." });
    }

    // Parse stored state cookie — clear UNCONDITIONALLY (CONTEXT.md decision)
    const rawCookie = (req.cookies as Record<string, string | undefined>)?.oidc_state;
    res.clearCookie("oidc_state", { path: "/" });

    let stored: { state: string; nonce: string } | null = null;
    try {
      stored = rawCookie ? (JSON.parse(rawCookie) as { state: string; nonce: string }) : null;
    } catch {
      stored = null;
    }

    const { code, state: returnedState, error: idpError } = req.query as Record<string, string | undefined>;

    // Error from IdP before code exchange
    if (idpError) {
      console.error("[oidc] callback: IdP returned error", { idpError, desc: req.query.error_description });
      const code = idpError === "access_denied" ? "oidc_denied" : "oidc_invalid";
      return res.redirect(`/login?error=${code}`);
    }

    // State validation (PITFALLS C-02)
    if (!code || !returnedState || !stored) {
      console.error("[oidc] callback: missing code/state/cookie");
      return res.redirect("/login?error=oidc_invalid");
    }

    // Timing-safe state comparison (PITFALLS C-02)
    const a = Buffer.from(returnedState);
    const b = Buffer.from(stored.state);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      console.error("[oidc] callback: state mismatch");
      return res.redirect("/login?error=oidc_invalid");
    }

    // Token exchange + ID token verification
    try {
      const { accessToken, idToken, claims } = await exchangeCode(code, stored.state, stored.nonce);

      // Check for opaque access token warning (PITFALLS T-05)
      const parts = accessToken.split(".");
      if (parts.length !== 3) {
        console.warn("[oidc] access_token does not appear to be a JWT — Kinetica requires JWT bearer tokens");
      }

      // Username extraction (PITFALLS T-02: ONLY from id_token claims)
      const config = getOidcConfig();
      const username = extractUsername(claims, config);
      if (!username) {
        console.error("[oidc] callback: username claim absent or empty", { claim: config.usernameClaim });
        return res.redirect("/login?error=oidc_no_username");
      }

      const kineticaUrl = process.env.KINETICA_URL!;
      const sid = createSession({ username, secret: accessToken, kineticaUrl, credentialType: "oidc", idToken });
      issueSessionCookie(res, username, sid);
      return res.redirect("/");

    } catch (err) {
      const friendly = mapOidcError(err);
      console.error("[oidc] callback error", { friendlyCode: friendly.code, rawError: String(err) });
      return res.redirect(`/login?error=${friendly.code}`);
    }
  }));

  // All routes below require authentication
  app.use("/api", requireAuth);
  // ...rest of routes...
};
```

**Boot wiring (index.ts bottom):**
```typescript
if (process.env.NODE_ENV !== "test") {
  const app = await createApp();   // await — createApp is now async
  const port = process.env.PORT || 4000;
  app.listen(port, () => { console.log(`...`); });
  startSessionSweep();
}
```

**Test wiring (helpers/app.ts):**
```typescript
export const buildTestApp = async () => {
  const app = await createApp();
  return request(app);
};
```

---

## Error Mapping

Single `mapOidcError` helper in `oidc.ts` (or inline in callback handler):

```typescript
import { errors } from "openid-client";

type OidcFriendlyError = { code: "oidc_denied" | "oidc_invalid" | "oidc_token_invalid" | "oidc_no_username" };

const mapOidcError = (err: unknown): OidcFriendlyError => {
  if (err instanceof errors.OPError) {
    // IdP returned an error response (access_denied, server_error, invalid_request, etc.)
    if (err.error === "access_denied") return { code: "oidc_denied" };
    return { code: "oidc_invalid" };       // all other IdP-side errors
  }
  if (err instanceof errors.RPError) {
    // Client-side validation failure: state mismatch, nonce mismatch, iss/aud mismatch,
    // exp past, signature invalid
    return { code: "oidc_token_invalid" };
  }
  // Network errors, JSON parse errors, unexpected failures
  return { code: "oidc_invalid" };
};
```

| Error Source | Error Type | Friendly Code | Reason |
|---|---|---|---|
| IdP `?error=access_denied` | `OPError` (`.error === 'access_denied'`) | `oidc_denied` | User denied at IdP |
| IdP `?error=<other>` | `OPError` | `oidc_invalid` | Protocol-level failure |
| State mismatch (pre-library) | manual check | `oidc_invalid` | CSRF defense |
| Missing `code` param | manual check | `oidc_invalid` | Bad callback params |
| Nonce mismatch | `RPError` | `oidc_token_invalid` | ID token replay defense |
| `iss` mismatch | `RPError` | `oidc_token_invalid` | Rogue IdP defense |
| `aud` mismatch | `RPError` | `oidc_token_invalid` | Wrong client defense |
| `exp` expired | `RPError` | `oidc_token_invalid` | Expired token |
| JWKS signature fail | `RPError` | `oidc_token_invalid` | Forged/tampered token |
| Empty username claim | manual check (post-callback) | `oidc_no_username` | Claim config error |
| Network error to token endpoint | `Error` | `oidc_invalid` | Connectivity |

**IMPORTANT:** The manual state check at the route level (before calling `exchangeCode`) catches state mismatches without a library call. The library's internal state check in `client.callback()` is a second defense layer. This is intentional belt-and-suspenders.

---

## Test Strategy

### Mock Pattern

```typescript
// tests/auth.oidc.spec.ts (route-level tests)
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock at module boundary — before any imports that trigger oidc.ts initialization
vi.mock("openid-client", () => {
  const mockClient = {
    authorizationUrl: vi.fn().mockReturnValue("https://idp.example.com/authorize?..."),
    callback: vi.fn(),
    [Symbol.for("openid-client.custom.clock_tolerance")]: 30,
  };
  const mockIssuer = {
    Client: vi.fn().mockReturnValue(mockClient),
    metadata: { issuer: "https://idp.example.com" },
  };
  return {
    Issuer: { discover: vi.fn().mockResolvedValue(mockIssuer) },
    custom: { clock_tolerance: Symbol.for("openid-client.custom.clock_tolerance") },
    errors: {
      OPError: class OPError extends Error { constructor(public error: string, public error_description?: string) { super(error); } },
      RPError: class RPError extends Error { constructor(msg: string) { super(msg); } },
    },
  };
});
```

**Note on `custom.clock_tolerance` symbol:** The `custom` object uses a Symbol for `clock_tolerance`. In the mock, the symbol value can be a predictable key (e.g., `Symbol.for(...)`) or the test can simply not assert on clock tolerance — the assignment `client[custom.clock_tolerance] = 30` is a side effect that doesn't need assertion. The mock just needs `custom.clock_tolerance` to be any key without throwing.

### TokenSet Fixture

```typescript
const makeTokenSet = (overrides: Partial<{
  access_token: string;
  id_token: string;
  claims: Record<string, unknown>;
}> = {}) => ({
  access_token: overrides.access_token ?? "fake-access-token",
  id_token: overrides.id_token ?? "fake.id.token",
  token_type: "Bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  claims: vi.fn().mockReturnValue({
    sub: "user123",
    iss: "https://idp.example.com",
    aud: "kinetica-bi",
    preferred_username: overrides.claims?.preferred_username ?? "alice",
    ...(overrides.claims ?? {}),
  }),
});
```

### State/Nonce Cookie Fixture

```typescript
const makeOidcStateCookie = (state = "test-state-abc", nonce = "test-nonce-xyz") =>
  JSON.stringify({ state, nonce });
```

### Test Cases Required by CONTEXT.md

**`GET /api/auth/config` tests (both AUTH_MODE values):**
```typescript
it("returns {authMode: 'password'} in password mode", ...)  // mode not oidc
it("returns {authMode: 'oidc'} in oidc mode", ...)
it("sets Cache-Control: no-store header", ...)
it("is accessible without authentication", ...)
```

**`GET /api/auth/oidc/start` tests:**
```typescript
it("returns 302 to mocked authorization_endpoint", ...)
it("sets oidc_state cookie with parseable {state, nonce}", ...)
it("returns 400 if AUTH_MODE is not oidc", ...)
```

**`GET /api/auth/oidc/callback` tests:**
```typescript
it("state mismatch → redirects /login?error=oidc_invalid", ...)
it("?error=access_denied from IdP → redirects /login?error=oidc_denied", ...)
it("OPError from token exchange → redirects /login?error=oidc_invalid", ...)
it("RPError from id_token validation → redirects /login?error=oidc_token_invalid", ...)
it("missing username claim → redirects /login?error=oidc_no_username", ...)
it("success → createSession called with {credentialType: 'oidc', ...}, kbi_session cookie set, redirect to /", ...)
it("cookie cleared on every exit (success and error)", ...)
```

**`POST /api/auth/login` in OIDC mode:**
```typescript
it("returns 400 with {error: 'Password login is disabled. Use OIDC.'} when AUTH_MODE=oidc", ...)
```

**`validateOidcEnv` unit tests (`tests/oidc.module.spec.ts`):**
```typescript
it("throws if AUTH_OIDC_ISSUER_URL missing", ...)
it("throws if AUTH_OIDC_CLIENT_ID missing", ...)
it("throws if AUTH_OIDC_CLIENT_SECRET missing", ...)
it("throws if AUTH_OIDC_REDIRECT_URI missing", ...)
it("strips trailing slash from issuer URL", ...)
it("defaults usernameClaim to 'preferred_username'", ...)
```

**`extractUsername` unit tests:**
```typescript
it("returns claim value for preferred_username", ...)
it("returns null if claim absent", ...)
it("returns null if claim is empty string", ...)
it("applies AUTH_OIDC_USERNAME_REGEX capture group 1", ...)
it("returns null if regex matches but capture group is empty", ...)
```

### `vi.stubEnv` Usage

```typescript
// Each spec file that needs OIDC mode:
beforeEach(() => {
  vi.stubEnv("AUTH_MODE", "oidc");
  vi.stubEnv("AUTH_OIDC_ISSUER_URL", "https://idp.example.com");
  vi.stubEnv("AUTH_OIDC_CLIENT_ID", "kinetica-bi");
  vi.stubEnv("AUTH_OIDC_CLIENT_SECRET", "secret");
  vi.stubEnv("AUTH_OIDC_REDIRECT_URI", "https://bi.example.com/api/auth/oidc/callback");
});
afterEach(() => {
  vi.unstubAllEnvs();
});
```

### `buildTestApp` Impact

`createApp()` is now `async`. The test helper in `tests/helpers/app.ts` must be updated:

```typescript
// tests/helpers/app.ts — updated for async createApp
import request from "supertest";
import { createApp } from "../../src/index";

export const buildTestApp = async () => {
  const app = await createApp();
  return request(app);
};
```

**All existing tests** that call `buildTestApp()` will need to `await` the call (breaking change for existing spec files). The planner must include a task to update all existing callers.

---

## Boot Discovery

### `createApp()` Async Upgrade

The existing `createApp()` is synchronous and returns `Express`. Awaiting `initOidcClient()` at boot requires it to become `async Promise<Express>`.

**Impact surface (must be updated):**
- `kinetica_bi/server/src/index.ts` — top-level `const app = createApp()` → `const app = await createApp()`
- `kinetica_bi/server/tests/helpers/app.ts` — `buildTestApp()` becomes async
- Every spec file that calls `buildTestApp()` — must await (grep for `buildTestApp()` without `await`)
- `kinetica_bi/server/tests/bootstrap.spec.ts` — the structural regex test reads `src/index.ts` source; check it still passes with the async change

**Fail-fast pattern:**
```typescript
// If AUTH_MODE=oidc and discovery fails, throw before app.listen
if (authMode === "oidc") {
  const config = validateOidcEnv();     // throws on missing vars → process exits
  await initOidcClient(config);          // throws on network error → process exits
}
// app.listen is never reached if either throws
```

**Password-mode behavior:** When `AUTH_MODE=password` (or unset), `validateOidcEnv()` and `initOidcClient()` are never called. The OIDC `_client` singleton stays null, and OIDC routes return 400. Zero performance cost in password mode.

**Boot log to emit (PITFALLS O-03 operator verification):**
```
[boot] OIDC initialized. Issuer: https://idp.example.com
[boot] Redirect URI: https://bi.example.com/api/auth/oidc/callback
[boot] Kinetica must be configured to trust tokens from https://idp.example.com with audience kinetica-bi
```

---

## Resolved Open Questions

### Q1: `openid-client` v5 vs v6

**Answer: Stay on v5.7.1. Lock `openid-client@^5` in package.json.**

**Evidence (verified with `npm show openid-client`):**
- npm `latest` tag = **v6.8.4** (as of 2026-04-30)
- v5 latest = **5.7.1**
- v6 has 37 stable releases — it is NOT a pre-release

**v6 is a complete API rewrite.** Key incompatibilities for this project:
- No `Issuer.discover()` — replaced by `client.discovery()` function
- No `new issuer.Client()` constructor — replaced by `Configuration` object
- No `client.callback()` — replaced by `client.authorizationCodeGrant()`
- No `tokenSet.claims()` — replaced by different token inspection API
- ESM-only distribution (CJS requires Node.js 22+ feature flag)
- `clockTolerance` API is different

**The v5 API locked in CONTEXT.md (`Issuer.discover`, `client.callback`, `TokenSet.claims()`) does not exist in v6.** Migrating to v6 is equivalent to rewriting the entire `oidc.ts` module. For Phase 5, this is unnecessary complexity with zero security gain.

**Recommendation:** Use `openid-client@^5` (resolves to v5.7.1). v5 is in maintenance mode (security patches only), which is acceptable for a Phase 5 implementation. Migrate to v6 in a future milestone when the API patterns are well-documented for Express.

**Confidence: HIGH** — verified with live npm registry.

### Q2: Opaque vs JWT Access Token Format

**Answer: Phase 5 does not need to detect this at the protocol level. Emit a server-side warning if the access token is not a JWT, but do NOT abort session creation.**

**Reasoning:**
- The BI app's `oidc.ts` stores whatever `tokenSet.access_token` returns — string, opaque or JWT.
- Whether Kinetica accepts the token is a Kinetica-side OIDC trust configuration issue (PITFALLS O-04, T-05), not a BI app correctness issue at the time of session creation.
- Aborting with `oidc_invalid` when an opaque token is received would break deployments where the IdP legitimately issues opaque tokens (e.g., legacy OAuth2 server).
- The correct Phase 5 behavior: detect, warn, continue.

**Detection heuristic:**
```typescript
const parts = accessToken.split(".");
if (parts.length !== 3) {
  console.warn("[oidc] access_token does not appear to be a JWT (missing dot-separated segments). " +
    "Kinetica requires a JWT bearer token. Verify IdP access_token format.");
}
// Continue with session creation regardless
```

**Deploy-time observation, not Phase 5 code path.** The DEPLOY-RUNBOOK (Phase 8) documents that Kinetica requires a JWT access token. If the IdP issues opaque tokens, that is the operator's problem to resolve at the IdP configuration level.

**Confidence: HIGH** — derived from OIDC spec (access token format is IdP-defined) + PITFALLS.md T-05.

### Q3: Dev vs Prod Redirect URL

**Answer: `AUTH_OIDC_REDIRECT_URI` is the single source of truth. It must be set explicitly in every environment. Boot logs emit the configured value for operator verification.**

**Mechanism:**
- `validateOidcEnv()` throws if `AUTH_OIDC_REDIRECT_URI` is missing.
- `initOidcClient()` logs `[boot] Redirect URI: ${config.redirectUri}` so the operator can visually confirm it matches the IdP registration (PITFALLS O-03).
- No derivation from `req.headers.host` — ever (PITFALLS C-07).

**Dev configuration example (`.env`):**
```bash
AUTH_OIDC_REDIRECT_URI=http://localhost:4000/api/auth/oidc/callback
```

**Prod configuration example:**
```bash
AUTH_OIDC_REDIRECT_URI=https://bi.example.com/api/auth/oidc/callback
```

**The IdP must have a separate client registration per environment** (dev and prod). A single IdP client registration cannot serve both `http://localhost:4000/...` and `https://bi.example.com/...` because redirect URIs are an exact-match allowlist.

**No Phase 5 code change needed beyond the boot log.** The validation and redirect_uri pinning are already in `validateOidcEnv()` and `buildAuthorizationUrl()`. The Phase 8 DEPLOY-RUNBOOK documents the registration requirement.

**Confidence: HIGH** — derived from PITFALLS O-03, C-07 + OIDC spec (redirect_uri exact match required by RFC 6749 §3.1.2).

### Q4: Kinetica Claim-to-Username Mapping

**Answer: `preferred_username` is the correct default for most IdPs. `sub` should NOT be the default. `AUTH_OIDC_USERNAME_REGEX` is primarily useful for email-to-username extraction.**

**Rationale:**
- `preferred_username` is the OIDC Core 1.0 standard claim for a human-readable username. It matches the pattern Kinetica uses for account names (alphanumeric, not a UUID).
- `sub` is a stable unique identifier but is typically an opaque UUID (`"sub": "ab3f9c12-..."`). Kinetica account names are human-readable strings. A UUID `sub` would never match a Kinetica account name without a custom claim mapping at the IdP.
- `email` is sometimes used but requires the email address to exactly match a Kinetica account name — only works in deployments where Kinetica accounts are email addresses.

**Claim requires scope:** `preferred_username` is part of the `profile` scope (OIDC Core §5.4). The locked scope `"openid profile"` in `buildAuthorizationUrl()` ensures this claim is present in the ID token for compliant IdPs.

**`AUTH_OIDC_USERNAME_REGEX` guidance:**
- Primary use case: extract username from email — regex `^([^@]+)@.*$` with capture group 1 gives `alice` from `alice@example.com`.
- Secondary use case: strip domain prefix — regex `^domain\\\\(.+)$` gives `alice` from `domain\alice`.
- When set to empty string or unset: no transform applied; `preferred_username` value used as-is.

**IdP-specific notes (no code changes needed — documented for planner awareness):**
- Keycloak: `preferred_username` is populated by default in the `profile` scope.
- Okta: `preferred_username` is the email address; the regex transform `^([^@]+)@.*$` would be needed if Kinetica accounts are short usernames.
- Microsoft Entra ID: `preferred_username` is typically the UPN (email format); regex transform likely needed.
- Auth0: configurable via "Add Custom Claims" rule; `preferred_username` not always set by default.

**The deploy-time prerequisite** (REQUIREMENTS.md OPS-01, Phase 8): the DBA must ensure the Kinetica account name exactly matches the extracted username value. If the IdP uses UPNs and Kinetica uses short names, `AUTH_OIDC_USERNAME_REGEX` is the bridge.

**Confidence: HIGH** for `preferred_username` as default. **MEDIUM** for specific IdP behavior (verify with actual IdP owner at deploy time).

---

## Architecture Patterns

### Recommended Project Structure (delta for Phase 5)

```
kinetica_bi/server/src/
├── oidc.ts              # NEW — OIDC module (discovery, auth URL, code exchange, claim extraction)
├── index.ts             # MODIFIED — async createApp, 3 new routes, AUTH_MODE guard
└── [unchanged: auth.ts, sessionStore.ts, db.ts, kinetica.ts, kineticaErrors.ts]

kinetica_bi/server/tests/
├── auth.oidc.spec.ts    # NEW — route-level tests (config, start, callback, login guard)
├── oidc.module.spec.ts  # NEW — unit tests (validateOidcEnv, extractUsername)
├── helpers/app.ts       # MODIFIED — buildTestApp becomes async
└── [all existing specs MODIFIED — await buildTestApp()]
```

### Route Mount Order (CRITICAL)

```
createApp():
  app.use(cors)
  app.use(express.json)
  app.use(cookieParser)
  app.get("/api/health", ...)               ← unchanged
  app.post("/api/auth/login", ...)          ← MODIFIED: AUTH_MODE guard at top
  app.post("/api/auth/logout", ...)         ← unchanged
  app.get("/api/auth/me", ...)              ← unchanged
  app.get("/api/auth/config", ...)          ← NEW: unauthenticated
  app.get("/api/auth/oidc/start", ...)      ← NEW: unauthenticated
  app.get("/api/auth/oidc/callback", ...)   ← NEW: unauthenticated (uses asyncHandler)
  app.use("/api", requireAuth)              ← existing auth gate
  [all protected routes...]
  app.use(errorMiddleware)
  app.use(404 handler)
```

All three new routes are mounted BEFORE `app.use("/api", requireAuth)`. This is mandatory — the OIDC routes are how unauthenticated users become authenticated.

### Anti-Patterns to Avoid (from ARCHITECTURE.md)

- **AP-1:** No OIDC config in `db.ts` — all OIDC config lives in `oidc.ts`
- **AP-2:** No `oidc.ts` import in `sessionStore.ts` — route handler in `index.ts` calls oidc, then calls sessionStore
- **AP-5:** No per-request metadata fetch — module-level `_client` singleton serves all requests
- **New:** No `process.env.AUTH_MODE` read inside any route handler — use the `authMode` const captured at `createApp()` top

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ID token signature verification | Custom JWKS fetch + `jwt.verify()` | `client.callback()` | JWKS URL fetch, key caching, rotation, RS256/ES256 all handled; ~200 lines of correct crypto replaced by one call |
| Token endpoint POST | Manual `fetch()` to `token_endpoint` | `client.callback()` | Error handling, timeout, content-type, `client_secret_basic` auth header — all handled |
| Authorization URL construction | Manual URL string concatenation | `client.authorizationUrl()` | URL encoding, parameter order, `response_type=code` default — all handled |
| OIDC discovery document parsing | Manual `fetch(/.well-known/openid-configuration)` + JSON parse | `Issuer.discover()` | Validates required fields, handles redirects, provides typed metadata object |
| State/nonce validation | Manual string comparison | `client.callback()` `checks` parameter | Library enforces timing-safe comparison and throws typed error on mismatch |

---

## Common Pitfalls

### Pitfall 1: `clockTolerance` Is a Post-Construction Property
**What goes wrong:** Setting `clockTolerance: 30` in the Client constructor has no effect. The option is not a constructor field.
**Prevention:** `client[custom.clock_tolerance] = 30` AFTER `new issuer.Client({...})`. The `custom` symbol must be imported from `openid-client`.

### Pitfall 2: `createApp()` Sync Callers After Async Upgrade
**What goes wrong:** Existing test files call `buildTestApp()` without `await`. After `createApp()` becomes async, `buildTestApp()` returns a Promise, and the supertest agent is a Promise object, not the actual agent. Tests silently fail with type errors or `.post is not a function`.
**Prevention:** The planner must include one explicit task: "grep all test files for `buildTestApp()` calls and add `await`." The TypeScript compiler will surface these as errors once `buildTestApp` is typed as `async`.

### Pitfall 3: OIDC Module State Leaks Across Tests
**What goes wrong:** `_client` and `_config` are module-level singletons. If one test calls `initOidcClient()`, the singleton is set for all subsequent tests in the same vitest worker. Tests that expect `_client === null` fail.
**Prevention:** `oidc.ts` should export a `resetOidcClientForTests()` function (or expose `_client` as a `let` that tests can reset). Call it in `afterEach`. Alternatively, use `vi.resetModules()` around tests that need a clean state — but this is expensive in vitest.

### Pitfall 4: `client.callback()` `params` Argument Type
**What goes wrong:** `req.query` is typed as `ParsedQs` (from Express typings). `client.callback()` expects `Record<string, string>`. TypeScript error at compile time.
**Prevention:** Cast: `client.callback(uri, req.query as Record<string, string>, checks)`. This is safe because OIDC callback parameters are always flat strings.

### Pitfall 5: State Check Before `client.callback()` Is Essential
**What goes wrong:** Relying solely on `client.callback()` to catch state mismatch means the IdP error `?error=access_denied` (which has no `state` param) still reaches the token exchange code before the state check fires.
**Prevention:** Check `req.query.error` FIRST. Then validate `returnedState === stored.state` BEFORE calling `client.callback()`. The library's internal state check is a second defense layer, not the primary one.

### Pitfall 6: `timingSafeEqual` Requires Equal-Length Buffers
**What goes wrong:** `crypto.timingSafeEqual(a, b)` throws if `a.length !== b.length`. If the returned state is a different length than the stored state (truncated, URL-encoded, etc.), the `timingSafeEqual` call throws rather than returning false.
**Prevention:** Always check `a.length === b.length` before calling `timingSafeEqual`. If lengths differ, it's a mismatch — return the `oidc_invalid` redirect without calling `timingSafeEqual`.

---

## Code Examples

### Full `/start` Route

```typescript
// Source: ARCHITECTURE.md §"New Routes" + CONTEXT.md decisions + library surface above
app.get("/api/auth/oidc/start", (req, res) => {
  if (authMode !== "oidc") {
    return res.status(400).json({ error: "OIDC is not enabled." });
  }
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  res.cookie("oidc_state", JSON.stringify({ state, nonce }), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60 * 1000,
    secure: process.env.NODE_ENV === "production",
  });
  const url = buildAuthorizationUrl(state, nonce);
  return res.redirect(url);
});
```

### `extractUsername` with Regex

```typescript
// Source: CONTEXT.md + PITFALLS T-03
export const extractUsername = (
  claims: Record<string, unknown>,
  config: OidcConfig
): string | null => {
  const raw = claims[config.usernameClaim];
  if (typeof raw !== "string" || !raw.trim()) return null;

  if (!config.usernameRegex) return raw.trim();

  const match = raw.match(new RegExp(config.usernameRegex));
  if (!match) return null;
  // Prefer capture group 1 (e.g., "^([^@]+)@"); fall back to full match
  const extracted = (match[1] ?? match[0] ?? "").trim();
  return extracted || null;
};
```

### `vi.mock("openid-client")` Minimal Shape

```typescript
// Source: CONTEXT.md test decision + openid-client v5 API surface above
vi.mock("openid-client", () => {
  const CLOCK_TOLERANCE = Symbol("mock.clock_tolerance");
  const mockTokenSet = {
    access_token: "mock-access-token",
    id_token: "mock.id.token",
    token_type: "Bearer",
    expires_in: 3600,
    claims: vi.fn().mockReturnValue({ sub: "u1", preferred_username: "alice" }),
  };
  const mockClient: Record<string | symbol, unknown> = {
    authorizationUrl: vi.fn().mockReturnValue("https://idp.example.com/authorize?mock=1"),
    callback: vi.fn().mockResolvedValue(mockTokenSet),
    [CLOCK_TOLERANCE]: undefined,  // will be set by initOidcClient
  };
  return {
    Issuer: {
      discover: vi.fn().mockResolvedValue({
        Client: vi.fn().mockReturnValue(mockClient),
        metadata: { issuer: "https://idp.example.com", jwks_uri: "https://idp.example.com/jwks" },
      }),
    },
    custom: { clock_tolerance: CLOCK_TOLERANCE },
    errors: {
      OPError: class OPError extends Error {
        error: string;
        error_description?: string;
        constructor(error: string, desc?: string) { super(error); this.error = error; this.error_description = desc; }
      },
      RPError: class RPError extends Error {
        constructor(msg: string) { super(msg); }
      },
    },
  };
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| `openid-client` v5 class-based API (`Issuer.discover`, `new issuer.Client`, `client.callback`) | v6 function-based API (`client.discovery()`, `client.authorizationCodeGrant()`) | v6.0.0 shipped 2024 | Use v5 — v6 is an ESM-only rewrite with incompatible API |
| `@types/openid-client` separate package | Types bundled in `openid-client` itself (since v4) | v4.0.0 | No `@types/` needed |
| `clockTolerance` as constructor option | `client[custom.clock_tolerance] = N` post-construction | v2.x | Must use symbol-based API |

**Deprecated:**
- `openid-client@^4` and earlier: uses different `CLOCK_TOLERANCE` property name
- `openid-client@^6` (for this phase): incompatible API; ESM-only; no `Issuer.discover()`

---

## Risks / Confidence

| Area | Level | Reason |
|------|-------|--------|
| openid-client v5.7.1 API surface | HIGH | Fetched from official GitHub docs + npm registry verification on 2026-04-30 |
| `client.callback()` handles state/nonce/JWKS/aud/iss automatically | HIGH | Confirmed in v5 README; this is the library's primary feature |
| `clockTolerance` via `client[custom.clock_tolerance]` | HIGH | Confirmed in v5 docs; PITFALLS T-06 requirement |
| `authorizationUrl()` returns `string` | HIGH | Explicitly documented in v5 API |
| `vi.mock("openid-client")` works with vitest | HIGH | Standard vitest pattern; `openid-client` is a Node.js module importable in vitest |
| `createApp()` async upgrade impact on existing tests | HIGH | All 6 existing spec files that call `buildTestApp()` will need `await` added |
| `custom.clock_tolerance` Symbol value in mocks | MEDIUM | The Symbol key created by openid-client is not exported as a predictable value; mock must intercept the import of `custom` and return the same Symbol it uses as `client[custom.clock_tolerance]` key — test for property assignment, not the exact symbol |
| Specific IdP claim behavior (`preferred_username` availability) | MEDIUM | IdP-specific; varies by provider and scope configuration; documented as deploy-time verification |
| v6 stability and Express 4 adapter documentation | LOW | v6 is ESM-only; Express 4 integration patterns not yet well-documented; relevant for future milestone only |

**One risk to flag for the planner:** The async `createApp()` upgrade touches every test file. The planner should treat "update all `buildTestApp()` callers to await" as an atomic task — either all tests are updated together or the codebase will not compile. TypeScript's strict mode will catch these, but only if `buildTestApp` is typed correctly.

---

## Open Questions

None remain. All four STATE.md open questions are resolved above.

---

## Sources

### Primary (HIGH confidence)
- `npm show openid-client` + `npm show openid-client versions --json` — live npm registry, 2026-04-30 — confirms v5.7.1 current, v6.8.4 latest, v6 is stable
- `github.com/panva/node-openid-client` v5.7.1 README — `Issuer.discover`, `new issuer.Client`, `client.authorizationUrl`, `client.callback` signatures, `TokenSet.claims()`, `OPError`/`RPError` classes
- `github.com/panva/node-openid-client` v5 docs — `custom.clock_tolerance` symbol API, full `ClientMetadata` shape
- Project files read directly: `src/index.ts`, `src/auth.ts`, `src/sessionStore.ts`, `kinetica_bi/server/package.json`, `tests/helpers/app.ts`, `tests/auth.routes.spec.ts`, `tests/setup.ts`
- Phase 4 SUMMARY (04-02-SUMMARY.md) — confirmed `createSession` options-object signature with `credentialType` and `idToken`

### Secondary (MEDIUM confidence)
- `github.com/panva/openid-client/discussions/702` — v6 breaking changes announcement, ESM-only requirement, no `Issuer.discover` in v6
- WebSearch: "openid-client v5 clockTolerance custom clock_tolerance" — confirmed `client[custom.clock_tolerance] = N` is the v5 pattern

### Tertiary (LOW confidence — flagged)
- OIDC Core 1.0 spec §5.4 (profile scope) — `preferred_username` claim is in profile scope; claim availability is IdP-dependent and must be verified at deploy time

---

## Metadata

**Research date:** 2026-04-30
**Valid until:** 2026-05-30 (v5 API is stable; v6 migration guidance may improve sooner)
