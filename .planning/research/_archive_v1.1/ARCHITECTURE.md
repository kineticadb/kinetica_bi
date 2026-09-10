# Architecture Patterns: OIDC SSO Integration

**Domain:** Adding Generic OIDC as a parallel auth path to an existing Express + SQLite BI app
**Researched:** 2026-04-28
**Scope:** v1.1 — OIDC additions only. Does not re-describe v1.0 architecture.

---

## Recommended Architecture

The OIDC flow runs as a second auth path that terminates in the same session machinery as the password path. After the callback, both paths store an encrypted credential blob in the sessions table and issue the same `{ sub, sid, v: 1 }` JWT cookie. Downstream helpers (`kineticaSql` / `kineticaWms`) branch on a `credentialType` field that `requireAuth` attaches to `req.user`.

```
Browser                  Express                        Kinetica IdP
   |                        |                                |
   |  GET /api/auth/oidc/start                               |
   |----------------------->|                                |
   |  302 → IdP login page  |                                |
   |<-----------------------|                                |
   |                        |                                |
   |  POST /authorize (IdP) |                                |
   |----------------------------------------------->         |
   |  302 → /api/auth/oidc/callback?code=...                 |
   |<-------------------------------------------------------- |
   |                        |                                |
   |  GET /api/auth/oidc/callback?code=...                   |
   |----------------------->|                                |
   |                        | token exchange (POST /token)   |
   |                        |------------------------------->|
   |                        | { access_token, ... }         |
   |                        |<-------------------------------|
   |                        |                                |
   |                        | createSession(username, accessToken, kineticaUrl, "oidc")
   |                        | issueSessionCookie(...)        |
   |  200 { user }          |                                |
   |<-----------------------|                                |
   |                        |                                |
   |  GET /api/dashboards   |                                |
   |----------------------->|                                |
   |                        | requireAuth → decrypt blob     |
   |                        | req.user.creds = { username, token } + credentialType: "oidc"
   |                        |                                |
   |                        | kineticaSql → buildAuthHeader("oidc", creds)
   |                        | Authorization: Bearer <token>  |
   |                        |------------------------------->|
```

---

## Component Boundaries

### New Files

| File | Responsibility |
|------|---------------|
| `server/src/oidc.ts` | OIDC client module. Owns: OIDC discovery (issuer metadata fetch), authorization URL construction, code→token exchange, identity claim extraction (`preferred_username` + optional regex transform), `AUTH_OIDC_*` env var validation. Exports: `buildAuthorizationUrl(state, nonce)`, `exchangeCode(code, state, nonce) → { accessToken, username }`, `validateOidcEnv()`. No Express imports — pure HTTP + crypto logic. |

**Why `oidc.ts` not `auth/oidc.ts`:** The existing codebase is flat (`auth.ts`, `kinetica.ts`, `db.ts`). Introducing a subdirectory for one file adds navigation friction with no structural benefit. Keep `server/src/oidc.ts` at the same level.

### Modified Files

| File | Change Summary |
|------|---------------|
| `server/src/db.ts` | DDL delta: add `credential_type` column to sessions table. See precise SQL below. |
| `server/src/sessionStore.ts` | `createSession` gains `credentialType` param. `SessionRow` gains `credentialType` field. `encryptPassword`/`decryptPassword` remain unchanged — the same AES-256-GCM path encrypts both passwords and tokens (the secret is just a string in both cases). |
| `server/src/auth.ts` | `AuthedRequest.user` gains `credentialType: "password" \| "oidc"`. `requireAuth` attaches `credentialType` from the session row. `verifyKineticaCredentials` untouched (password-mode only). New export: `issueSessionCookie` is already generic — no change needed there. |
| `server/src/kinetica.ts` | `buildAuthHeader` branches on credential type. `kineticaSql` + `kineticaWms` read `req.user.credentialType` (or accept a unified creds shape). |
| `server/src/index.ts` | Mount two new OIDC routes (`/api/auth/oidc/start`, `/api/auth/oidc/callback`) before `app.use("/api", requireAuth)`. Add `GET /api/auth/config` unauthenticated route. Add AUTH_MODE-change detection at boot. |
| `frontend/src/api/client.ts` | Add `fetchAuthConfig()` helper. No changes to `apiFetch` or error dispatch — those are auth-mode agnostic. |
| `frontend/src/store/auth.ts` | Add `authMode: "password" \| "oidc" \| null` state field. Add `setAuthMode(mode)` action. `bootstrap()` calls `fetchAuthConfig()` before `fetchMe()`. |
| `frontend/src/components/LoginPage.tsx` | Branches on `authMode`: password mode renders the existing form; OIDC mode renders a single "Sign in with [IdP]" button that navigates to `/api/auth/oidc/start`. |

### Files Left Alone

| File | Reason |
|------|--------|
| `server/src/kineticaErrors.ts` | Typed errors (`KineticaAuthError`, etc.) are credential-type agnostic. No change. |
| `server/src/db.ts` mapper functions | Existing CRUD for dashboards/widgets/tables untouched. |
| `frontend/src/App.tsx` | Auth gate logic (checking `status === "authenticated"`) is credential-type agnostic. |
| `frontend/src/components/Topbar.tsx` | Logout calls `/api/auth/logout` regardless of mode — already works. |

---

## Sessions Table Delta

### Precise DDL Change

Add one column to the `sessions` table:

```sql
ALTER TABLE sessions ADD COLUMN credential_type TEXT NOT NULL DEFAULT 'password';
```

This is the minimal change. `DEFAULT 'password'` ensures all v1.0 rows remain valid without migration data backfill.

**Why not a polymorphic blob approach:** The existing blob columns (`ciphertext`, `iv`, `auth_tag`) already work for any string payload. Adding a discriminator column is the correct relational approach — it enables `WHERE credential_type = 'oidc'` queries (e.g., for targeted wipe) without reinterpreting blob contents.

**Updated SCHEMA_DDL in `db.ts`:**

```sql
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  ciphertext BLOB NOT NULL,
  iv BLOB NOT NULL,
  auth_tag BLOB NOT NULL,
  kinetica_url TEXT NOT NULL,
  credential_type TEXT NOT NULL DEFAULT 'password',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions (username);
```

Note: `CREATE TABLE IF NOT EXISTS` in SCHEMA_DDL does NOT apply the `ALTER TABLE` to existing databases. A separate migration step is needed for existing deployments. The `createDb` function should run the `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (SQLite supports this since 3.37.0) as a separate idempotent statement after `exec(SCHEMA_DDL)`.

```typescript
// In createDb(), after instance.exec(SCHEMA_DDL):
instance.exec(`
  ALTER TABLE sessions ADD COLUMN credential_type TEXT NOT NULL DEFAULT 'password'
`);
// SQLite silently errors on duplicate column add — wrap in try/catch or use:
// SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name='credential_type'
```

The safest pattern is a guard query before the ALTER:

```typescript
const cols = instance.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
if (!cols.some(c => c.name === "credential_type")) {
  instance.exec("ALTER TABLE sessions ADD COLUMN credential_type TEXT NOT NULL DEFAULT 'password'");
}
```

---

## `requireAuth` Changes

### Recommendation: Minimal-change shape

`requireAuth` should NOT be aware of OIDC semantics — it should only read the `credential_type` column from the session row and attach it to `req.user`. The branching on what that means happens downstream in `buildAuthHeader`.

**Exact change to `AuthedRequest` in `auth.ts`:**

```typescript
export type AuthedRequest = Request & {
  requestId?: string;
  user?: {
    sub: string;
    sid: string;
    credentialType: "password" | "oidc";
    creds: {
      username: string;
      password: string;   // populated in password mode; empty string in oidc mode
      token: string;      // populated in oidc mode; empty string in password mode
    };
  };
};
```

**Alternative considered — union type:**
```typescript
creds:
  | { type: "password"; username: string; password: string }
  | { type: "oidc"; username: string; token: string }
```
This is more type-correct but requires touching every callsite of `req.user.creds`. The flat shape with `credentialType` at the top level is cheaper to adopt without breaking existing code. The `password` and `token` fields are mutually empty strings, not undefined, to avoid null-guard noise in callers.

**Exact change to `requireAuth` step 10:**

```typescript
// Step 10: success.
req.user = {
  sub: session.username,
  sid: session.sid,
  credentialType: session.credentialType as "password" | "oidc",
  creds: {
    username: session.username,
    password: session.credentialType === "password" ? session.secret : "",
    token:    session.credentialType === "oidc"     ? session.secret : "",
  },
};
```

(`session.secret` is the new unified name for the decrypted blob content — see sessionStore changes below.)

---

## `sessionStore.ts` Changes

`encryptPassword` and `decryptPassword` are misleadingly named but functionally correct for tokens too — AES-256-GCM doesn't care what the plaintext is. Rename them or add aliases:

```typescript
// Rename to be credential-type agnostic:
export const encryptSecret = encryptPassword;   // or rename in place
export const decryptSecret = decryptPassword;
```

**`SessionRow` delta:**

```typescript
export type SessionRow = {
  sid: string;
  username: string;
  secret: string;            // renamed from `password`; holds password OR access token
  credentialType: "password" | "oidc";
  kineticaUrl: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
};
```

**`createSession` signature delta:**

```typescript
export const createSession = (
  username: string,
  secret: string,               // was `password`; now accepts token too
  kineticaUrl: string,
  credentialType: "password" | "oidc" = "password"
): string => { ... }
```

The INSERT statement gains one more bound param for `credential_type`:

```sql
INSERT INTO sessions
  (sid, username, ciphertext, iv, auth_tag, kinetica_url, credential_type, expires_at)
VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'))
```

**Rename impact:** `password` → `secret` in `SessionRow` means `auth.ts` must update its field read at step 10 (`session.password` → `session.secret`). That is the only external callsite — `requireAuth` in `auth.ts` is the sole consumer of `SessionRow.password`.

---

## `kinetica.ts` Changes

### `buildAuthHeader` — the branch

This is a single function change. The credential type is read from `req.user`:

```typescript
const buildAuthHeader = (req: AuthedRequest): string => {
  const { credentialType, creds } = req.user!;
  if (credentialType === "oidc") {
    return `Bearer ${creds.token}`;
  }
  return `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString("base64")}`;
};
```

**Architecture note:** The branch is in `buildAuthHeader` only. `kineticaSql` and `kineticaWms` call `buildAuthHeader(req)` (passing the full request) rather than `buildAuthHeader(req.user!.creds)` (passing just creds). This is a one-line change at each callsite:

- Before: `Authorization: buildAuthHeader(req.user!.creds)`
- After: `Authorization: buildAuthHeader(req)`

The audit log (`emitAudit`) is unchanged — it logs `username` regardless of credential type. The `KineticaAuthError` / `KineticaPermissionError` error taxonomy is also unchanged — a rejected bearer token surfaces the same `KineticaAuthError` that the existing 401-REAUTH flow already handles.

---

## AUTH_MODE Switch

### Where it is checked

`AUTH_MODE` is checked in two places:

1. **Boot validation** — in `index.ts` `createApp()`, or better in a dedicated `validateEnv()` call at the top of `createApp()`. This is where `requireConfig` already validates `KINETICA_URL`. Extend it:

```typescript
const authMode = (process.env.AUTH_MODE || "password") as "password" | "oidc";
if (authMode !== "password" && authMode !== "oidc") {
  throw new Error("AUTH_MODE must be 'password' or 'oidc'");
}
if (authMode === "oidc") {
  validateOidcEnv(); // exported from oidc.ts — throws if OIDC env vars are missing
}
```

2. **Route mounting** — `AUTH_MODE` controls which auth routes are live. Both route groups should still be mounted (to avoid silent 404s confusing operators), but the non-active path returns a clear 400:

```typescript
app.post("/api/auth/login", async (req, res) => {
  if (authMode !== "password") {
    return res.status(400).json({ error: "Password login is disabled. Use OIDC." });
  }
  // ... existing login logic
});

app.get("/api/auth/oidc/start", (req, res) => {
  if (authMode !== "oidc") {
    return res.status(400).json({ error: "OIDC is not enabled." });
  }
  // ... OIDC redirect
});
```

3. **`GET /api/auth/config`** — unauthenticated route, returns mode to frontend:

```typescript
app.get("/api/auth/config", (_req, res) => {
  res.json({ authMode });
});
```

This route must be mounted BEFORE `app.use("/api", requireAuth)`.

**Anti-pattern: per-route `process.env.AUTH_MODE` reads.** Read `AUTH_MODE` once at `createApp()` into a local `authMode` const. Repeated `process.env.AUTH_MODE` reads in every handler are fragile (env mutation in tests, case sensitivity bugs).

---

## Boot-Time AUTH_MODE-Change Detection

### Where it lives

This is initialization logic, not session-store logic and not OIDC logic. It belongs in `index.ts` inside `createApp()`, executed before the server starts listening. It mirrors the existing `KINETICA_URL` change defense in `requireAuth`, but at the table level.

```typescript
// In createApp(), after authMode is resolved:
const wipeSessionsOnModeChange = (): void => {
  // Read the last known mode from a metadata row, or derive from existing session types.
  // Simple approach: check if any sessions exist with a credential_type that contradicts
  // the current AUTH_MODE. If so, wipe all sessions (operator changed the mode).
  const contradictingType = authMode === "password" ? "oidc" : "password";
  const contradicting = db.prepare(
    "SELECT COUNT(*) AS n FROM sessions WHERE credential_type = ?"
  ).get(contradictingType) as { n: number };
  if (contradicting.n > 0) {
    console.log(`[boot] AUTH_MODE changed to '${authMode}'; wiping ${contradicting.n} sessions with credential_type='${contradictingType}'`);
    db.prepare("DELETE FROM sessions WHERE credential_type = ?").run(contradictingType);
    // Do NOT wipe all sessions — only the contradicting type. This handles a hypothetical
    // dual-mode transition gracefully, and is safer than DELETE FROM sessions (all).
    // Since AUTH_MODE is mutually exclusive, contradicting_type sessions are always dead.
  }
};
wipeSessionsOnModeChange();
```

**Anti-pattern: putting this in `db.ts`.** `db.ts` owns schema DDL and CRUD. It has no business knowing about `AUTH_MODE`. The boot-time wipe is an application-layer concern that reads env vars — it goes in `index.ts`.

**Anti-pattern: putting this in `sessionStore.ts`.** `sessionStore.ts` is a pure session CRUD module. It should not import or read `process.env.AUTH_MODE`. If the wipe logic grows complex, extract to a `src/authConfig.ts` module that imports from both `db.ts` and reads env vars — but for the current scope, inline in `createApp()` is fine.

---

## New Routes

### `GET /api/auth/oidc/start`

```typescript
app.get("/api/auth/oidc/start", (req, res) => {
  if (authMode !== "oidc") return res.status(400).json({ error: "OIDC not enabled." });
  const state  = randomBytes(16).toString("hex");
  const nonce  = randomBytes(16).toString("hex");
  // Store state + nonce in a short-lived httpOnly cookie for CSRF protection
  res.cookie("oidc_state", JSON.stringify({ state, nonce }), {
    httpOnly: true, sameSite: "lax", maxAge: 10 * 60 * 1000, path: "/"
  });
  const url = buildAuthorizationUrl(state, nonce); // from oidc.ts
  return res.redirect(url);
});
```

**Mount position:** Before `app.use("/api", requireAuth)`. This route is unauthenticated by design (the user is not yet authenticated when they start OIDC).

### `GET /api/auth/oidc/callback`

```typescript
app.get("/api/auth/oidc/callback", asyncHandler(async (req, res) => {
  if (authMode !== "oidc") return res.status(400).json({ error: "OIDC not enabled." });

  const { code, state: returnedState } = req.query as { code?: string; state?: string };
  const stored = parseCookieJson(req.cookies?.oidc_state); // { state, nonce }
  if (!code || !returnedState || !stored || returnedState !== stored.state) {
    return res.status(400).json({ error: "Invalid OIDC callback." });
  }

  res.clearCookie("oidc_state", { path: "/" });

  const { accessToken, username } = await exchangeCode(code, stored.state, stored.nonce); // from oidc.ts
  const kineticaUrl = process.env.KINETICA_URL!;
  const sid = createSession(username, accessToken, kineticaUrl, "oidc");
  issueSessionCookie(res, username, sid);

  // Redirect to app root — frontend picks up the new session via bootstrap()
  return res.redirect("/");
}));
```

**Mount position:** Before `app.use("/api", requireAuth)`.

### `GET /api/auth/config`

```typescript
app.get("/api/auth/config", (_req, res) => {
  res.json({ authMode });
});
```

**Mount position:** Before `app.use("/api", requireAuth)`.

---

## `oidc.ts` Module Layout

```typescript
// server/src/oidc.ts

export type OidcConfig = {
  issuer: string;        // AUTH_OIDC_ISSUER
  clientId: string;      // AUTH_OIDC_CLIENT_ID
  clientSecret: string;  // AUTH_OIDC_CLIENT_SECRET
  redirectUri: string;   // AUTH_OIDC_REDIRECT_URI
  usernameClaim: string; // AUTH_OIDC_USERNAME_CLAIM (default: "preferred_username")
  usernameRegex?: string;// AUTH_OIDC_USERNAME_REGEX (optional transform)
};

export const validateOidcEnv = (): OidcConfig => { ... };
// Throws if required vars missing. Called at boot in createApp().

type OidcMetadata = {
  authorization_endpoint: string;
  token_endpoint: string;
  // (only fields we actually use)
};

let _metadata: OidcMetadata | null = null;
export const getOidcMetadata = async (issuer: string): Promise<OidcMetadata> => {
  // Fetch {issuer}/.well-known/openid-configuration once; cache in module scope.
  // Do NOT cache across test boundaries (tests can override env).
};

export const buildAuthorizationUrl = (state: string, nonce: string): Promise<string> => {
  // Fetches metadata if not cached, returns authorization URL with:
  // client_id, redirect_uri, response_type=code, scope=openid, state, nonce
};

export const exchangeCode = async (
  code: string,
  state: string,    // for logging only — state validation done in the route
  nonce: string
): Promise<{ accessToken: string; username: string }> => {
  // POST to token_endpoint with grant_type=authorization_code
  // Validate nonce in id_token claims
  // Extract username from access_token or id_token per AUTH_OIDC_USERNAME_CLAIM
  // Apply AUTH_OIDC_USERNAME_REGEX transform if set
};
```

**`getOidcMetadata` caching note:** Cache with a module-level variable (`let _metadata`). Do not use a file-level const (it runs at import time, before env vars are set). Invalidate the cache if `AUTH_OIDC_ISSUER` changes — simplest approach: store the issuer alongside the cached metadata and refetch if it doesn't match.

**Anti-pattern: putting OIDC client config in `db.ts`.** `db.ts` owns persistence schema. OIDC config is stateless env-var config — it belongs in `oidc.ts`.

**Anti-pattern: importing `oidc.ts` from `sessionStore.ts`.** `sessionStore.ts` should remain OIDC-agnostic. The route handler in `index.ts` is responsible for calling `oidc.ts` to get the token and then calling `sessionStore.createSession` with the result.

---

## Frontend Changes

### AUTH_MODE Discovery: Runtime via `GET /api/auth/config`

The frontend learns `AUTH_MODE` at runtime, not build time. Rationale: the same frontend build must support both modes (the mode is an ops decision, not a build decision).

**Why `/api/auth/config` over a build-time env var:**
- `VITE_AUTH_MODE` bakes the mode into the JS bundle; changing mode requires a rebuild + redeploy of the frontend. A runtime endpoint allows ops to change the server env var and restart without touching the frontend.
- The endpoint is cheap (returns a 20-byte JSON object) and called once at bootstrap.

### `frontend/src/api/client.ts` — new helper

```typescript
export type AuthConfig = { authMode: "password" | "oidc" };

export const fetchAuthConfig = async (): Promise<AuthConfig> => {
  const response = await fetch(`${API_BASE}/api/auth/config`, { credentials: "include" });
  if (!response.ok) throw new Error("Failed to load auth config");
  return response.json() as Promise<AuthConfig>;
};
```

Note: uses raw `fetch`, not `apiFetch` — this endpoint is unauthenticated and should not trigger `UNAUTHORIZED_EVENT` dispatch if it fails.

### `frontend/src/store/auth.ts` — new field and action

```typescript
type AuthState = {
  // existing fields...
  authMode: "password" | "oidc" | null;
  setAuthMode: (mode: "password" | "oidc") => void;
  // bootstrap() updated to call fetchAuthConfig first
};
```

`bootstrap()` change:
```typescript
bootstrap: async () => {
  try {
    const config = await fetchAuthConfig();
    set({ authMode: config.authMode });
  } catch {
    // authMode stays null — LoginPage falls back to password form
  }
  // ... existing fetchMe() logic
}
```

### `frontend/src/components/LoginPage.tsx` — auth mode branch

```typescript
const authMode = useAuthStore((s) => s.authMode);

// OIDC mode: single button that navigates to the OIDC start route
if (authMode === "oidc") {
  return (
    <div className="login-shell">
      <div className="login-card">
        {reason === "session-expired" && (
          <div className="login-banner" role="status">
            Your session has ended. Please sign in again.
          </div>
        )}
        <div className="login-brand">Kinetica BI</div>
        <h1 className="login-title">Sign in</h1>
        <a href={`${API_BASE}/api/auth/oidc/start`} className="login-submit">
          Sign in with SSO
        </a>
      </div>
    </div>
  );
}

// Password mode (authMode === "password" or null — null is the fallback during loading):
// ... existing form JSX unchanged
```

**`authMode === null` (loading state):** While `bootstrap()` is in flight, `authMode` is null. `App.tsx` already gates on `status !== "unknown"` before rendering `LoginPage` — so `LoginPage` never renders with `authMode === null` under normal operation. If it does (e.g., `fetchAuthConfig` throws), falling back to the password form is safe and visible to the user.

---

## Data Flow: End-to-End OIDC Session

```
1. Frontend bootstrap():
   GET /api/auth/config → { authMode: "oidc" }
   → authStore.authMode = "oidc"
   GET /api/auth/me → 401 (no session)
   → authStore.status = "unauthenticated"

2. LoginPage renders OIDC button.

3. User clicks "Sign in with SSO":
   GET /api/auth/oidc/start
   → server generates state/nonce, sets oidc_state cookie, redirects to IdP

4. IdP authenticates user, redirects back:
   GET /api/auth/oidc/callback?code=abc&state=xyz
   → server validates state, exchanges code for access_token
   → createSession(username, accessToken, kineticaUrl, "oidc") → sid
   → issueSessionCookie(res, username, sid)
   → redirect("/")

5. Frontend reloads at "/", bootstrap() runs again:
   GET /api/auth/config → { authMode: "oidc" }
   GET /api/auth/me → 200 { user: { username } }
   → authStore.status = "authenticated"

6. User navigates dashboard, kineticaSql called:
   requireAuth reads session → credentialType: "oidc", token: "<access_token>"
   buildAuthHeader(req) → "Bearer <access_token>"
   POST /execute/sql with Authorization: Bearer <access_token>

7. Token expires:
   Kinetica returns 401 → KineticaAuthError → global middleware → 401 REAUTH_REQUIRED
   apiFetch sees code: "REAUTH_REQUIRED" → dispatches UNAUTHORIZED_EVENT
   authStore.markUnauthenticated("session-expired")
   LoginPage renders with session-expired banner + OIDC button
   User clicks → step 3 again (no refresh-token storage)
```

---

## Scalability Considerations

| Concern | Current scale (team-internal) | Notes |
|---------|-------------------------------|-------|
| OIDC metadata caching | Module-level cache is fine | Single process; no cache invalidation needed beyond restart |
| Token storage | Same AES-256-GCM path as passwords | Access tokens are typically longer strings; no schema impact |
| State/nonce cookie | Short-lived (10 min) httpOnly cookie | No server-side state needed for PKCE-less auth code flow |
| Session wipe on mode change | Full DELETE WHERE credential_type = ? | O(n) but one-time at boot; SQLite handles it trivially |

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: OIDC config in `db.ts`
**What:** Putting `validateOidcEnv()` or `AUTH_OIDC_*` reads in `db.ts`
**Why bad:** `db.ts` is schema + CRUD. It has no role in network client configuration.
**Instead:** All OIDC config lives in `oidc.ts`. `db.ts` only gains the `credential_type` DDL column.

### Anti-Pattern 2: `sessionStore.ts` importing from `oidc.ts`
**What:** Making `createSession` call `oidc.ts` functions or read OIDC env vars
**Why bad:** `sessionStore.ts` should be a pure encrypt-and-store module. Importing `oidc.ts` creates a circular dependency risk and violates single responsibility.
**Instead:** The callback route handler in `index.ts` calls `oidc.ts` to get the token, then calls `sessionStore.createSession` with the result.

### Anti-Pattern 3: Dual `requireAuth` / auth-mode branching inside the middleware
**What:** `requireAuth` checking `AUTH_MODE` and running different code paths per mode
**Why bad:** `requireAuth` already works correctly for both modes — it just loads the session row and attaches `req.user`. The credential type is already in the row. There is nothing OIDC-specific to do in the middleware.
**Instead:** `requireAuth` reads `credential_type` from the session row and attaches it to `req.user`. All branching on what it means happens in `buildAuthHeader`.

### Anti-Pattern 4: Build-time `VITE_AUTH_MODE`
**What:** Baking `AUTH_MODE` into the frontend bundle at build time
**Why bad:** Ops teams configure auth mode at deploy time, not build time. Changing mode would require a rebuild + redeploy of both backend and frontend.
**Instead:** `GET /api/auth/config` at runtime.

### Anti-Pattern 5: Per-request metadata fetch in `oidc.ts`
**What:** Calling `{issuer}/.well-known/openid-configuration` on every token exchange
**Why bad:** ~100ms round trip on every login; unnecessary; OIDC metadata changes rarely.
**Instead:** Module-level cache (`let _metadata`). Invalidate only if issuer changes (caught at restart via env var validation).

### Anti-Pattern 6: Storing `state` in the database
**What:** Persisting the OIDC `state` and `nonce` in a sessions or state table for CSRF validation
**Why bad:** Unnecessarily ties a stateless OAuth2 parameter to the database. The callback arrives within seconds; a short-lived httpOnly cookie is the standard approach and requires zero schema additions.
**Instead:** `oidc_state` httpOnly cookie (10-minute maxAge) holding `{ state, nonce }` JSON. Clear it in the callback handler.

---

## Phase Decomposition and Build Order

Dependencies flow strictly downward. No phase requires something not yet built.

```
Phase 1: Schema + SessionStore foundation
  ↓
Phase 2: oidc.ts module + routes (backend-only, no frontend yet)
  ↓
Phase 3: requireAuth + kinetica.ts credential branch
  ↓
Phase 4: Frontend AUTH_MODE awareness + LoginPage OIDC branch
  ↓
Phase 5: Boot-time AUTH_MODE-change wipe + hardening
```

### Phase 1 — Schema + SessionStore Foundation

**Ships:** DDL migration (`credential_type` column), `sessionStore.ts` renamed/extended API, updated `auth.ts` `AuthedRequest` type.

**Why first:** Every subsequent phase depends on the `credential_type` column existing and `createSession` accepting it. The type changes to `AuthedRequest` and `SessionRow` must land before the OIDC module or helper changes can compile.

**Shippable increment:** Tests pass with `credential_type = 'password'` default. Zero behavior change in password mode.

**Files changed:** `db.ts` (DDL + migration guard), `sessionStore.ts` (rename `password`→`secret`, add `credentialType` param + field), `auth.ts` (`AuthedRequest` type + step-10 field reads).

### Phase 2 — OIDC Module + Routes (Backend)

**Ships:** `oidc.ts` (new), two new routes in `index.ts` (`/start`, `/callback`), `/api/auth/config` route.

**Why second:** Needs Phase 1's `createSession(username, secret, url, "oidc")` signature. The frontend is NOT touched yet — this phase is backend-only and testable with curl.

**Shippable increment:** In `AUTH_MODE=oidc`, the OIDC login flow completes end-to-end (session created, cookie issued). The frontend still shows the password form but the backend is functional.

**Files changed:** `oidc.ts` (new), `index.ts` (new routes, `authMode` const, `validateOidcEnv()` call at boot).

### Phase 3 — requireAuth + Helper Credential Branch

**Ships:** `buildAuthHeader` branch in `kinetica.ts`, updated callsites, `req.user.credentialType` attachment in `requireAuth`.

**Why third:** Needs Phase 1's `AuthedRequest` type changes and Phase 2's OIDC session creation to work end-to-end. This phase makes existing dashboard routes work with OIDC sessions — `Bearer` tokens flow to Kinetica.

**Shippable increment:** A curl session with an OIDC-created session cookie can successfully hit `/api/dashboards` and the Kinetica helpers use `Authorization: Bearer <token>`.

**Files changed:** `kinetica.ts` (`buildAuthHeader` signature, two callsites), `auth.ts` (step-10 `credentialType` assignment, `req.user.creds` field naming).

### Phase 4 — Frontend AUTH_MODE Awareness

**Ships:** `fetchAuthConfig()` in `client.ts`, `authMode` state in `auth.ts` store, `LoginPage.tsx` OIDC branch.

**Why fourth:** Needs Phase 2's `/api/auth/config` route and Phase 3's end-to-end session flow. This phase wires the user-visible login UX.

**Shippable increment:** In `AUTH_MODE=oidc`, the browser shows the "Sign in with SSO" button. In `AUTH_MODE=password`, the browser shows the existing form. Both modes work end-to-end.

**Files changed:** `client.ts` (new `fetchAuthConfig`), `store/auth.ts` (`authMode` field + `setAuthMode`), `LoginPage.tsx` (mode branch).

### Phase 5 — Boot-Time Wipe + Hardening

**Ships:** AUTH_MODE-change session wipe in `index.ts`, password-login disabled message when `AUTH_MODE=oidc`, `validateOidcEnv()` called at boot.

**Why last:** Defensive hardening. The system works correctly without it; this phase prevents confused states after an operator changes `AUTH_MODE` on an existing deployment.

**Shippable increment:** Changing `AUTH_MODE=password` → `AUTH_MODE=oidc` (or vice versa) and restarting the server wipes contradicting sessions. The server refuses to start if OIDC env vars are missing in `AUTH_MODE=oidc`.

**Files changed:** `index.ts` (boot wipe logic, `validateOidcEnv` call tightening, `AUTH_MODE=oidc` disables `/api/auth/login`).

---

## Sources

- Existing codebase read directly: `auth.ts`, `sessionStore.ts`, `kinetica.ts`, `db.ts`, `index.ts`, `client.ts`, `store/auth.ts`, `LoginPage.tsx`
- OpenID Connect Core 1.0 specification (OIDC Foundation) — authorization code flow, state/nonce parameters, `.well-known/openid-configuration` discovery
- OAuth 2.0 RFC 6749 — authorization code grant, token endpoint exchange
- Express 4 routing documentation — middleware mount order, `app.use` vs `app.get` precedence
- SQLite `ALTER TABLE ... ADD COLUMN` — supported since SQLite 3.1.3 (DEFAULT constraint); `IF NOT EXISTS` guard via `PRAGMA table_info` is the idiomatic SQLite migration pattern
