# Architecture Patterns — v1.0 Per-User Kinetica Credential Passthrough

**Domain:** Auth/credential lifecycle inside an existing Express + React BI app
**Researched:** 2026-04-27
**Scope:** Subsequent milestone — adding per-user Kinetica credential passthrough on top of an already-shipped JWT session cookie. Touches `kinetica_bi/server/src/index.ts`, `kinetica_bi/server/src/auth.ts`, `kinetica_bi/server/src/db.ts` only on the server; React surface change is "show re-login dialog when mid-session" only.

---

## 1. Recommended Architecture

### High-Level Goal

Replace the single shared-admin pair `(KINETICA_USERNAME, KINETICA_PASSWORD)` with **the credentials the BI user signed in with**, on every downstream call to Kinetica's `/execute/sql` and `/wms` endpoints. The credentials must:

1. Be captured at login (already validated against Kinetica via `verifyKineticaCredentials`)
2. Persist for the life of the session (8 hours, matching JWT TTL)
3. Be available to every authenticated route handler that talks to Kinetica
4. Survive server restarts only as required (server-session approach: yes; JWE approach: yes via signed cookie)
5. Be invalidated cleanly when Kinetica returns 401/403 mid-session (forces re-login, preventing stale-credential thrash)

### Recommended Approach: Server-Side Session Row + AES-GCM Encryption

After tracing both options through the stack (see §2), **the server-side session row in `better-sqlite3` is recommended.** The JWT payload becomes a thin pointer `{ sid: <uuid> }`; the actual encrypted credentials live in a new `sessions` table. Rationale below; full tradeoff matrix in §2.

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Client (Browser)                            │
│                                                                      │
│   Cookie: kbi_session = JWT{ sid: <uuid>, exp }      [httpOnly]     │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ every /api/* request
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Express Server (server/src/)                      │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ requireAuth (auth.ts) — ENHANCED                              │   │
│  │   1. readSession(req) → { sid }                              │   │
│  │   2. sessionStore.get(sid) → { ciphertext, iv, expires_at }  │   │
│  │   3. decrypt(ciphertext, iv, SESSION_ENC_KEY)                │   │
│  │      → { username, password }                                │   │
│  │   4. req.user = { sub, creds: { username, password } }       │   │
│  └────────────┬─────────────────────────────────────────────────┘   │
│               │ req.user.creds                                       │
│               ▼                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ kineticaCall(req, sqlOrPath, options) — NEW HELPER            │   │
│  │   - Builds Basic auth header from req.user.creds             │   │
│  │   - Posts to ${KINETICA_URL}/execute/sql or /wms             │   │
│  │   - On 401/403 → throw KineticaAuthError                     │   │
│  │   - On other failure → throw KineticaUpstreamError           │   │
│  └────────────┬─────────────────────────────────────────────────┘   │
│               │                                                      │
│               ▼                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ Route handlers (index.ts):                                    │   │
│  │   /api/sql, /api/wms, /api/kinetica/schemas[/...],           │   │
│  │   /api/views/:id/materialize                                  │   │
│  │                                                               │   │
│  │ Top-level error middleware catches KineticaAuthError →       │   │
│  │   destroy session row, clearSessionCookie, 401 to client     │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ sessions table (better-sqlite3) — NEW                         │   │
│  │   sid TEXT PRIMARY KEY                                        │   │
│  │   username TEXT NOT NULL                                      │   │
│  │   ciphertext BLOB NOT NULL  (AES-256-GCM of password)        │   │
│  │   iv BLOB NOT NULL                                            │   │
│  │   auth_tag BLOB NOT NULL                                      │   │
│  │   expires_at TEXT NOT NULL                                    │   │
│  │   created_at TEXT NOT NULL DEFAULT (datetime('now'))         │   │
│  └──────────────────────────────────────────────────────────────┘   │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ HTTP Basic (per-user creds)
                                ▼
                       ┌─────────────────┐
                       │  Kinetica gpudb │
                       └─────────────────┘
```

### Component Boundaries

| Component | Responsibility | Communicates With | Status |
|-----------|---------------|-------------------|--------|
| `auth.ts` (modified) | JWT issue/read; `requireAuth` now hydrates `req.user.creds` from session store | `sessionStore` (new), `req.cookies` | **Modified** |
| `sessionStore.ts` (new) | CRUD over `sessions` table; AES-GCM encrypt/decrypt; TTL-based GC | `db.ts`, `crypto` (Node built-in) | **New** |
| `kineticaCall.ts` (new) | Single helper for every Kinetica HTTP call; builds Basic header from `req.user.creds`; classifies errors | `req.user.creds`, Kinetica HTTP | **New** |
| `KineticaAuthError`, `KineticaUpstreamError` (new) | Typed errors for the route layer to discriminate | — | **New** |
| `index.ts` (modified) | Replace 4 inline Basic-auth fetches + `kineticaSql` helper with `kineticaCall(req, …)`; remove `requireConfig`'s creds checks; add error middleware | `kineticaCall`, `auth.ts`, error middleware | **Modified** |
| `db.ts` (modified) | Add `CREATE TABLE sessions` to the boot DDL block | better-sqlite3 | **Modified** |
| `src/store/auth.ts` (frontend, optional touch) | Already handles 401 → `markUnauthenticated` via global event. May want a friendlier message for "Kinetica rejected your session" vs "you logged out." | `apiFetch` | **Possibly modified** |
| `src/api/client.ts` (frontend, no change for v1.0) | `UNAUTHORIZED_EVENT` already fires on every 401; backend just needs to make sure auth-failure mid-session **does** return 401 (not 502). | — | **Unchanged** |

### Data Flow

**Login (modified flow):**

1. `POST /api/auth/login` receives `{ username, password }`
2. `verifyKineticaCredentials(username, password)` runs as today (unchanged) — proves Kinetica accepts these creds
3. **NEW:** generate `sid = crypto.randomUUID()`
4. **NEW:** `sessionStore.create(sid, username, password, expiresAt)` → encrypts password with AES-256-GCM under `SESSION_ENC_KEY`, persists row
5. **MODIFIED:** `issueSessionCookie(res, sid)` — JWT payload becomes `{ sid }` instead of `{ sub: username }` (or `{ sub, sid }` if we want belt-and-suspenders; see §2)
6. Response unchanged: `{ user: { username } }`

**Authenticated request (new flow):**

1. Client sends any `/api/*` request with `kbi_session` cookie
2. Express → `requireAuth`:
   - `readSession(req)` decodes JWT → `{ sid }`
   - `sessionStore.get(sid)` → row or `null`
   - If `null` or expired → 401 (clears cookie)
   - Decrypt password using `iv` + `SESSION_ENC_KEY`
   - Attach `req.user = { sub: row.username, creds: { username: row.username, password: <decrypted> } }`
3. Route handler calls `kineticaCall(req, sql, options)` instead of inline `fetch(... Buffer.from(`${kineticaUser}:${kineticaPassword}`)...)`
4. `kineticaCall` builds `Authorization: Basic ${base64(req.user.creds.username + ":" + req.user.creds.password)}`, posts to Kinetica
5. Kinetica response classified:
   - 2xx with `body.status !== "ERROR"` → return parsed body
   - 401/403, OR `body.status === "ERROR"` with auth-looking message → throw `KineticaAuthError`
   - Anything else → throw `KineticaUpstreamError`
6. Route handler either lets the error bubble to the global error middleware OR catches and re-classifies (for `/materialize` which already persists `error` status to `dashboard_table_views`)
7. Global error middleware (NEW):
   - `KineticaAuthError` → `sessionStore.destroy(sid)` + `clearSessionCookie` + `res.status(401).json({ error: "Kinetica rejected your session. Please sign in again." })`
   - `KineticaUpstreamError` → `res.status(502).json({ error, detail })`
8. Frontend `apiFetch` sees 401 → fires `UNAUTHORIZED_EVENT` → `App.tsx` `markUnauthenticated()` → user lands on `LoginPage`. **Already wired today.**

**Logout (modified flow):**

1. `POST /api/auth/logout` reads JWT → `{ sid }`
2. **NEW:** `sessionStore.destroy(sid)` to remove the row immediately (don't wait for TTL GC)
3. `clearSessionCookie(res)` (unchanged)
4. 204

**Bootstrap (`GET /api/auth/me`) — MODIFIED:**

Today this just verifies the JWT signature. With server-session it must additionally confirm the `sid` row still exists and isn't expired (otherwise the user could have a "valid" JWT pointing at a deleted/expired session, and we'd happily call requireAuth's enhanced path which would 401 anyway — better to fail fast and consistently). Replace the body of `/api/auth/me` with `requireAuth`-style logic OR mount `requireAuth` on it and use `req.user.sub`.

---

## 2. Credential-Storage Approach: JWE vs Server-Session (chosen)

### Option A — JWE (encrypted JWT, password lives inside the cookie)

Replace `jwt.sign(...)` with a JWE library (`jose`), payload becomes `{ sub, password }`, encrypted under `SESSION_ENC_KEY` (AES-256-GCM) and signed under `AUTH_SECRET`. Cookie is still httpOnly + same-site=lax + secure-in-prod.

**Pros:**
- **Stateless server.** No new table, no GC, no DB read on every request. Survives server restart without storage.
- **Smallest diff** — `auth.ts` swaps `jsonwebtoken` for `jose`, `requireAuth` keeps roughly the same shape (`req.user` gets `{ sub, password }` directly off the decoded payload).
- **No session GC story** — TTL is enforced by `exp` claim, same as today.
- **No race on logout** — there's no shared row to clean up; clearing the cookie is sufficient.

**Cons:**
- **The password lives in the cookie.** Even though the cookie is httpOnly + encrypted, an attacker who exfiltrates `SESSION_ENC_KEY` (compromised server, leaked env var, log line) can decrypt every active session's password. A server-side row at least makes the attack require both the key *and* the SQLite file.
- **No server-side revocation.** If a user logs out on Tab A, Tab B's still-cached cookie remains decryptable until expiry. (In practice this is fine because logout clears the cookie in the browser — but you can't kick a user from the server side without rotating keys.)
- **Cookie size grows** — JWE adds ~150 bytes, password adds however long the password is. For typical Kinetica passwords (<32 chars) this is fine; total cookie stays well under 4 KB.
- **Library churn.** Adds `jose` (or moves off `jsonwebtoken`). Minor but real.

**Where encrypt/decrypt happens:**
- Encrypt: in `issueSessionCookie(res, username, password)` at login
- Decrypt: in `readSession(req)` on every authenticated request
- Result: `req.user = { sub, password }` flows out of `requireAuth`

**Signed-only is NOT acceptable** for this option: HS256 signing proves integrity, not confidentiality. The cookie payload is base64url-encoded plaintext, readable by anyone who has the cookie value (which is anyone who has the SQLite-equivalent: server filesystem access via heap dump, log capture, etc.). For passwords specifically, signed-only fails.

### Option B — Server-side session row in better-sqlite3 (RECOMMENDED)

JWT becomes `{ sid: <uuid> }`. New `sessions` table holds `(sid, username, ciphertext, iv, auth_tag, expires_at)`. Password encrypted with AES-256-GCM under `SESSION_ENC_KEY` (separate from `AUTH_SECRET`, both required to be 32+ bytes).

**Pros:**
- **Defense in depth.** Compromise of the cookie alone (e.g., XSS exfil — though httpOnly blocks this — or network capture if someone misconfigures `secure`) gives only an opaque `sid`, not the password. To recover the password you also need the SQLite file *and* `SESSION_ENC_KEY`.
- **Server-side revocation works** — destroy the row, every cookie pointing at it is dead. Useful for explicit logout, mid-session Kinetica-401 handling, and future "log out all sessions" admin action.
- **Aligns with the codebase pattern.** `db.ts` already centralizes SQLite tables; adding `sessions` follows the existing `CREATE TABLE IF NOT EXISTS …` block in the boot DDL. Other tables already use `expires_at`-style timestamps.
- **JWT semantics stay simple.** No JWE dependency, no key-management ceremony for crypto-on-the-cookie. `jsonwebtoken` HS256 is enough because the cookie carries no secret, just a pointer.
- **Easy to extend.** Sessions table can grow columns (last_used_at, user_agent, ip) without changing the cookie.

**Cons:**
- **Adds a DB read per request.** better-sqlite3 is sync and fast (~microseconds for an indexed point lookup); acceptable for this app's scale.
- **Adds a session-GC concern.** Need a `DELETE FROM sessions WHERE expires_at < datetime('now')` sweep on startup and periodically (e.g., once per hour via `setInterval`, OR opportunistically inside `sessionStore.get()` if expired).
- **Encryption-key management.** Need a new env var `SESSION_ENC_KEY` (32 bytes, base64) separate from `AUTH_SECRET`. Document in `.env.example`. Same key-rotation problem as JWE, just localized.
- **One more table to remember during migrations.** Currently the codebase has no migration tool — DDL is "CREATE TABLE IF NOT EXISTS" in `db.ts`. Adding the table fits that pattern.
- **More files modified** than Option A.

### Recommendation: Option B (server-session) — confidence: MEDIUM-HIGH

**Decision rationale:**

1. **Threat model.** The whole milestone exists because we don't trust shared admin creds — we want Kinetica's per-user permissions to be the source of truth. In that mindset, putting every user's password inside their own browser cookie (even encrypted) is philosophically inconsistent. Server-side rows + per-row encryption with the file separated from the key is the more conservative posture for credentials we don't want to leak.

2. **Operational fit.** This codebase already has better-sqlite3 wired up, already does WAL, already does CREATE-IF-NOT-EXISTS in `db.ts`, and already runs as a long-lived single process. The "ops cost" of a sessions table is essentially zero — no new dependencies, no new infrastructure.

3. **Mid-session 401 recovery is cleaner.** When Kinetica returns 401 (password rotated externally, account locked), we want to invalidate the session immediately and force re-login. With a server-side row, that's a single `DELETE FROM sessions WHERE sid = ?`. With JWE, the cookie remains valid until the next request and we'd be relying purely on the client clearing it.

4. **No real downside for this app's scale.** A team-internal BI tool with maybe a few dozen concurrent users will not feel a sub-millisecond SQLite point-lookup per request. The `better-sqlite3` driver is synchronous and fits the existing handler style.

**Where this could flip:** if the team later moves to multi-process / multi-instance deployment, the SQLite-bound session store becomes a synchronization headache (requires shared storage). At that point switching to JWE (truly stateless) or a dedicated session store (Redis) is appropriate. v1.0 is single-process; recommend Option B.

**Open decision for CONTEXT.md:** confirm with the team that team-internal scale and "credentials never in the cookie" is the right call. If anyone strongly prefers stateless, JWE is a defensible alternative — neither is wrong, and the rest of this doc (kineticaCall helper, refactor sites, build order) is identical for both.

### Tradeoff Summary

| Concern | JWE (cookie) | Server-session (recommended) |
|---------|--------------|------------------------------|
| Password storage location | Browser cookie (encrypted) | SQLite (encrypted) |
| Server statelessness | Yes | No (1 row/session) |
| Per-request DB read | No | Yes (point lookup, sync) |
| Server-side revocation | No | Yes |
| Survives restart | Yes (cookie alone) | Yes (DB-backed) |
| New env var | `SESSION_ENC_KEY` | `SESSION_ENC_KEY` |
| New library | `jose` (or `node-jose`) | None (Node built-in `crypto`) |
| Cookie size | ~300–500 B | ~250 B (current size) |
| GC needed | No | Yes (cheap periodic DELETE) |
| Diff size | Smaller | Slightly larger |

---

## 3. The New `kineticaCall` Abstraction

This is the keystone of the refactor. Today, four code paths in `server/src/index.ts` each independently build `Authorization: Basic ${base64(\`${kineticaUser}:${kineticaPassword}\`)}` from env. After v1.0, all four call this helper.

### Signature

```typescript
// server/src/kineticaCall.ts (NEW FILE)
import type { AuthedRequest } from "./auth";

export class KineticaAuthError extends Error {
  readonly status = 401;
  constructor(message: string) { super(message); this.name = "KineticaAuthError"; }
}

export class KineticaUpstreamError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) { super(message); this.status = status; this.name = "KineticaUpstreamError"; }
}

type SqlOptions = {
  limit?: number;
  offset?: number;
  extra?: Record<string, unknown>; // forwarded to Kinetica's options field
};

// SQL path — wraps /execute/sql, returns parsed body.
// (Most callers want body.data_str → JSON-decoded payload, so we expose the raw body
//  and let callers decode like the existing kineticaSql helper does.)
export const kineticaSqlAsUser = async (
  req: AuthedRequest,
  statement: string,
  options: SqlOptions = {}
): Promise<KineticaSqlResponse> => { /* ... */ };

// Raw-fetch path — for /wms which is GET-with-querystring, not /execute/sql.
export const kineticaFetchAsUser = async (
  req: AuthedRequest,
  url: string,
  init?: RequestInit
): Promise<Response> => { /* ... */ };
```

### What it does

1. Reads `req.user.creds` (set by enhanced `requireAuth`). If missing → throw `KineticaAuthError("session missing credentials")` (defensive; should never happen post-`requireAuth`).
2. Builds `Authorization: Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString("base64")}`.
3. Calls Kinetica with that header.
4. **Auth-failure detection** (matches the logic already in `verifyKineticaCredentials`):
   - HTTP 401 or 403 → `throw new KineticaAuthError("Kinetica rejected credentials")`
   - HTTP 2xx but `body.status === "ERROR"` AND message matches `/auth|credential|login|password/i` → `throw new KineticaAuthError(body.message)`
   - HTTP 2xx but `body.status === "ERROR"` (other) → `throw new KineticaUpstreamError(body.message)`
   - Other non-2xx → `throw new KineticaUpstreamError(\`Kinetica returned ${response.status}\`, 502)`
5. Returns the decoded body (for the SQL path, returns `{ raw, encoded }` where `encoded` is the parsed `data_str.json_encoded_response` — same shape today's local `kineticaSql` helper produces, so the refactor of /api/kinetica/* routes is mechanical).

### Route-layer integration

Two patterns:

**Pattern 1 — let it bubble.** The route handler doesn't try-catch the auth-error case. A new global error middleware (mounted via `app.use((err, req, res, next) => …)` at the bottom of `index.ts`) inspects `err instanceof KineticaAuthError`:

```typescript
app.use((err, req: AuthedRequest, res, _next) => {
  if (err instanceof KineticaAuthError) {
    if (req.user?.sid) sessionStore.destroy(req.user.sid);
    clearSessionCookie(res);
    return res.status(401).json({ error: err.message });
  }
  if (err instanceof KineticaUpstreamError) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error("Unhandled error", err);
  return res.status(500).json({ error: "Internal server error" });
});
```

**Pattern 2 — selective catch.** `/api/views/:id/materialize` already catches errors and persists `status='error'` to `dashboard_table_views`. Keep that catch but add a re-throw for `KineticaAuthError`:

```typescript
} catch (error) {
  if (error instanceof KineticaAuthError) throw error; // let middleware destroy session
  const updated = updateViewStatus(id, "error", String(error));
  return res.status(502).json({ error: String(error), view: updated });
}
```

This preserves the persistence behavior for genuine SQL errors while still recovering cleanly from "your session got rotated."

### Why one helper, not 4 inline rewrites

- Single source of truth for the auth-error classification logic — changing the heuristic ("which Kinetica messages indicate credential failure") happens in one place.
- Easy to mock in tests (the codebase has none today, but adding any will benefit).
- Forces the discipline of "every Kinetica call has a `req` parameter," making it impossible to accidentally re-introduce env-based fallback.

---

## 4. Refactor Targets — Every Call Site of the Shared Admin Creds

Exhaustive list of every line in `kinetica_bi/server/src/index.ts` that hard-codes the env-based Basic header today. **All five must be replaced.**

| # | Route / Helper | File:Line | Today | After |
|---|----------------|-----------|-------|-------|
| 1 | `kineticaSql` (local helper) | `server/src/index.ts:314–345` | `Buffer.from(\`${kineticaUser}:${kineticaPassword}\`)` at line 319 | **Delete this helper.** Replace its only call sites (rows 2, 3, 4 below) with `kineticaSqlAsUser(req, …)`. |
| 2 | `GET /api/kinetica/schemas` | `server/src/index.ts:347–358` | calls local `kineticaSql(...)` | calls `kineticaSqlAsUser(req, "SELECT SCHEMA_NAME ...")`; signature changes to accept `(req, res)` |
| 3 | `GET /api/kinetica/schemas/:schema/tables` | `server/src/index.ts:360–372` | calls local `kineticaSql(...)` | calls `kineticaSqlAsUser(req, ...)` |
| 4 | `GET /api/kinetica/schemas/:schema/tables/:table/columns` | `server/src/index.ts:374–390` | calls local `kineticaSql(...)` | calls `kineticaSqlAsUser(req, ...)` |
| 5 | `POST /api/views/:id/materialize` | `server/src/index.ts:232–277` (`Buffer.from` at line 249) | inline `fetch(...)` with hard-coded Basic header | replace inline fetch with `kineticaSqlAsUser(req, ddl)`; preserve the `updateViewStatus('error'/'created')` side effects; re-throw `KineticaAuthError` to let middleware handle |
| 6 | `GET /api/wms` | `server/src/index.ts:393–418` (`Buffer.from` at line 401) | inline `fetch(...)` | replace with `kineticaFetchAsUser(req, wmsUrl, { headers: ... })`; the WMS body is binary (image bytes), so this path keeps streaming/buffering as today, just with a per-user header |
| 7 | `POST /api/sql` | `server/src/index.ts:421–453` (`Buffer.from` at line 433) | inline `fetch(...)` to `/execute/sql` | replace with `kineticaSqlAsUser(req, sql, options)`; this endpoint is more permissive than the other SQL paths (forwards arbitrary `options`), so the helper must accept the `extra: options` parameter and merge it into the request body |

**Total: 5 distinct call sites** (the local `kineticaSql` helper consolidates 3 of them, but at the network level there are 5 separate paths to the Kinetica server). All 5 will route through the new abstraction post-refactor.

**Verification step for QA:** after the refactor, `grep -n "Buffer.from" server/src/index.ts` and `grep -n "kineticaUser\|kineticaPassword" server/src/index.ts` should both return zero matches.

---

## 5. Fate of `KINETICA_USERNAME` / `KINETICA_PASSWORD` Env Vars

### Removed entirely

- Top of `server/src/index.ts` (lines 45–46) — delete the two `const` declarations.
- `.env.example` (or wherever the env contract is documented) — remove both keys, remove from any deployment docs.
- Search and remove any incidental usage outside the routes (none found in the read of `index.ts`; `auth.ts:verifyKineticaCredentials` already takes `username, password` parameters and does not consult env).

### What replaces `requireConfig`

Currently `requireConfig` (lines 58–65) checks **all three** env vars: `KINETICA_URL`, `KINETICA_USERNAME`, `KINETICA_PASSWORD`. After v1.0:

- `KINETICA_URL` is still required (it's the network endpoint, not a credential — every user calls the same Kinetica cluster).
- `KINETICA_USERNAME` and `KINETICA_PASSWORD` are gone.

Two options for the middleware:

**Option A — keep `requireConfig`, narrow it.** Rename to `requireKineticaUrl` (clearer intent). Only check `KINETICA_URL`:

```typescript
const requireKineticaUrl = (_req: Request, res: Response, next: NextFunction) => {
  if (!process.env.KINETICA_URL) {
    return res.status(500).json({ error: "KINETICA_URL is not configured." });
  }
  return next();
};
```

Mount it on the same routes it gates today: `/api/sql`, `/api/wms`, `/api/views/:id/materialize`, `/api/kinetica/schemas[/...]`.

**Option B — fail-fast at boot.** Check `KINETICA_URL`, `AUTH_SECRET`, and `SESSION_ENC_KEY` once at server startup; throw and exit if missing. Drop the per-request check entirely (it never changes during process lifetime).

**Recommendation: Option B.** Per-request middleware checking startup-only invariants is wasted work. The existing `getSecret()` in `auth.ts` already throws on demand if `AUTH_SECRET` is missing; do the same for `KINETICA_URL` and `SESSION_ENC_KEY` at the top of `index.ts` (or in a small `requireEnv()` helper called before `app.listen`). Then remove `requireConfig` from every route. This is a small simplification on top of the v1.0 work and an opportunity to clean up dead code.

If Option B feels out-of-scope, Option A is fine and is the smaller diff. Both achieve the same goal: env vars for credentials are gone, env vars for URL/keys remain (with a sane validator).

---

## 6. Build Order — Suggested Phasing with Dependencies

The work splits cleanly into three sequenced phases, each independently shippable (the app keeps working after each one). Arrows show hard dependencies.

```
Phase 1: Persist user creds in encrypted server-session
   │
   │  After Phase 1: login flow stores creds; req.user.creds available; nothing yet uses them.
   │  App still functions exactly as today (env creds still wired into Kinetica calls).
   │
   ▼
Phase 2: Refactor every Kinetica call site to use req.user.creds
   │
   │  After Phase 2: all 5 call sites go through kineticaCall(req, ...); env creds become dead code.
   │  Per-user permissions enforced. App functional with logged-in user's perms.
   │
   ▼
Phase 3: Mid-session auth-failure UX + env cleanup
      After Phase 3: KineticaAuthError invalidates session and 401s; KINETICA_USERNAME/PASSWORD
      env vars removed; requireConfig narrowed; .env.example updated; deployment docs updated.
```

### Phase 1 — Persist user creds in encrypted server-session

**Goal:** After login, server has enough to call Kinetica as the user. Doesn't yet *do* it.

**Files:**
- `server/src/sessionStore.ts` (NEW) — `create`, `get`, `destroy`, `gcExpired`; AES-256-GCM via `node:crypto`
- `server/src/db.ts` (MODIFIED) — add `CREATE TABLE IF NOT EXISTS sessions (...)` to the boot DDL
- `server/src/auth.ts` (MODIFIED) — `SessionPayload` becomes `{ sid: string }`; `issueSessionCookie(res, sid)`; `requireAuth` decrypts via `sessionStore.get(sid)` and attaches `req.user = { sub, sid, creds }`; `readSession` likewise enriches
- `server/src/index.ts` (MODIFIED) — `/api/auth/login` calls `sessionStore.create(...)` after `verifyKineticaCredentials` succeeds, then issues JWT with `{ sid }`; `/api/auth/logout` calls `sessionStore.destroy(req.user.sid)`; `/api/auth/me` switches to `requireAuth` (or replicates the lookup) so it 401s consistently when the row is gone
- New env var: `SESSION_ENC_KEY` (32 bytes, base64-encoded) — added to `.env.example`

**Dependencies:** none (pure additive on top of today's auth)

**Validates:** log in → log out works, browser cookie still issued, no Kinetica behavior change yet, sessions table populated/cleaned correctly. `req.user.creds` available to handlers but unused.

**Risks/gotchas:**
- Forgetting to add `requireAuth` to `/api/auth/me` (would orphan a code path that bypasses the new lookup)
- `SESSION_ENC_KEY` must be a separate var from `AUTH_SECRET` — reusing one for both signing and encryption is a known antipattern
- GC sweep — easiest to run on `app.listen` startup and via `setInterval(60 * 60 * 1000)`; keep it simple

### Phase 2 — Refactor call sites

**Goal:** Every Kinetica call uses `req.user.creds`. Env creds become unused (but not yet deleted).

**Files:**
- `server/src/kineticaCall.ts` (NEW) — `kineticaSqlAsUser`, `kineticaFetchAsUser`, `KineticaAuthError`, `KineticaUpstreamError`
- `server/src/index.ts` (MODIFIED) — replace each of the 5 call sites listed in §4; delete local `kineticaSql` helper; signatures of `/api/kinetica/...` route handlers now use `req` (already a Request, just typed as `AuthedRequest`)

**Dependencies:** Phase 1 (`req.user.creds` must exist)

**Validates:** as a Kinetica user with restricted perms, log in, browse schemas — should see only schemas that user has access to. As an admin user, see everything. Materialize a view — works. SQL proxy — works. WMS — works. The "shared admin everyone-sees-everything" behavior should be observably gone.

**Risks/gotchas:**
- The local `kineticaSql` helper has bespoke parsing of `body.data_str.json_encoded_response`. The new `kineticaSqlAsUser` must preserve that contract — easiest to copy that decode logic verbatim into the helper and have the helper return `{ rawBody, encoded }`.
- `/api/sql` forwards arbitrary `options` from the client; helper must merge `options.extra` into the Kinetica request body.
- WMS path is binary, not JSON — separate `kineticaFetchAsUser` returning the raw `Response` is cleaner than overloading the SQL helper.

### Phase 3 — Mid-session auth-failure UX + env cleanup

**Goal:** When Kinetica says 401 mid-session, the user lands cleanly back on the login screen. Shared admin env vars deleted. Done.

**Files:**
- `server/src/index.ts` (MODIFIED) — add global error middleware (Express 4 trailing 4-arg `(err, req, res, next)`) that handles `KineticaAuthError` and `KineticaUpstreamError`; remove `kineticaUser`/`kineticaPassword` consts; narrow or replace `requireConfig`
- `.env.example` / deployment docs (MODIFIED) — remove `KINETICA_USERNAME` and `KINETICA_PASSWORD`; document `SESSION_ENC_KEY`
- `src/store/auth.ts` (POSSIBLY MODIFIED) — frontend already handles 401 → unauth via `UNAUTHORIZED_EVENT`. If we want a custom message ("Your Kinetica password may have changed — please sign in again") vs a generic logout, add an optional reason field to the event payload, and have the LoginPage display it as a banner. Optional polish, not strictly required.

**Dependencies:** Phase 2 (`KineticaAuthError` is thrown by the helper)

**Validates:** rotate the user's Kinetica password externally → next /api/* call returns 401 → frontend lands on login → existing UX flow handles cleanly. Look for absence of `Buffer.from(\`${kineticaUser}:${kineticaPassword}\`)` in `git grep`.

**Risks/gotchas:**
- Express 4 error middleware MUST have 4 arguments to be recognized — `(err, req, res, next)`. Easy to typo and silently break.
- `clearSessionCookie` must use the same path/options as `issueSessionCookie` or the browser won't actually clear it — current `clearSessionCookie` uses `path: "/"` which matches; preserve that.
- Need to also `sessionStore.destroy(sid)` in the error middleware, not just clear the cookie — otherwise a stale row leaks until GC.

### Optional Phase 4 (not required for v1.0 acceptance)

- "Sign out everywhere" admin action that does `DELETE FROM sessions WHERE username = ?`
- Last-used / IP / user-agent columns on `sessions` for auditability
- Periodic GC of expired sessions visible in logs

These are obvious extensions of the server-session approach but unnecessary for the milestone goals. Mention only so they can be deferred explicitly rather than discovered as work later.

---

## 7. Patterns to Follow

### Pattern: Hydrate-then-handle in middleware

`requireAuth` does two jobs now: prove the session is valid AND hydrate the credentials into `req.user.creds`. Keep these in the same middleware — splitting them invites a code path that has `req.user.sub` but not `req.user.creds`, which would silently break Kinetica calls.

```typescript
export const requireAuth = (req: AuthedRequest, res: Response, next: NextFunction) => {
  const sid = readSidFromCookie(req);
  if (!sid) return res.status(401).json({ error: "Authentication required." });
  const session = sessionStore.get(sid);
  if (!session) {
    clearSessionCookie(res);
    return res.status(401).json({ error: "Session expired." });
  }
  req.user = { sub: session.username, sid, creds: { username: session.username, password: session.password } };
  return next();
};
```

### Pattern: Throw typed errors, handle centrally

Don't try-catch in every handler. Throw `KineticaAuthError` / `KineticaUpstreamError` from the helper, handle in one error middleware. Existing handlers that already need cleanup logic (the materialize endpoint persists `status='error'` to its DB row) still try-catch but re-throw the auth case so the middleware can do its job.

### Pattern: Single helper per upstream protocol

`kineticaSqlAsUser` for `/execute/sql` (JSON), `kineticaFetchAsUser` for `/wms` (binary). Don't over-generalize into one helper; the response shapes are too different.

---

## 8. Anti-Patterns to Avoid

### Anti-Pattern: Storing the password in JWT payload signed-only

Even with httpOnly + same-site=lax + secure, a signed-only JWT is base64-encoded plaintext. Anyone who reads the cookie value (server logs, browser devtools with the right extension privileges, MITM in dev where `secure` is false) gets the password. **Never put a credential in a signed-but-unencrypted JWT.**

### Anti-Pattern: Reusing AUTH_SECRET for encryption

`AUTH_SECRET` is the HMAC key for JWT signing. If we add encryption, use a separate `SESSION_ENC_KEY`. Reusing one key for two cryptographic purposes (sign + encrypt) is a classic pitfall.

### Anti-Pattern: Catching `KineticaAuthError` inside route handlers and returning 502

A 502 from a route handler tells the frontend "upstream failed, retry" — but frontend will retry, and the next call will also fail, and the user gets stuck. The whole point of the typed error is to escape to the middleware that knows how to invalidate the session. Don't swallow it locally.

### Anti-Pattern: Forgetting `/api/auth/me` in the migration

`/api/auth/me` today does its own `readSession` directly without invoking `requireAuth`. After Phase 1, this endpoint must also confirm the session row exists; otherwise a stale-cookie user gets `200 { user: ... }` from `/me` followed by `401` from any real call — confusing UX. Mount `requireAuth` on `/me` or duplicate the lookup.

### Anti-Pattern: Per-request startup-invariant middleware

`requireConfig` checks env vars on every request. Env vars don't change during process lifetime. This is a leftover that should be cleaned up in Phase 3 (validate at boot, fail fast).

### Anti-Pattern: Leaking the password via error.message

`Buffer.from(...).toString("base64")` could end up in an error stack if a fetch fails mid-stream. The new helper should never include the password in any `throw new Error(...)` message — only the username and HTTP status. Audit during code review.

---

## 9. Scalability Considerations

| Concern | Now (single team) | Larger team (50+) | Multi-instance |
|---------|-------------------|-------------------|----------------|
| Session lookups | 1 indexed point query / request — negligible | Same — better-sqlite3 sustains tens of thousands of reads/sec | Bottleneck: SQLite is per-process. Move to Redis or Postgres for shared session store. |
| Session GC | Hourly `setInterval` is fine | Same | Use Redis TTL (automatic) or shared scheduler |
| Encryption key rotation | Manual: rotate `SESSION_ENC_KEY`, all sessions invalidated, users re-login | Same | Add a `key_id` column to sessions table to support overlapping keys during rotation |
| Cookie size | ~250 B (pointer-only) | Same | Same |
| Mid-session 401 storm | Handled per-session — invalidate one row, user re-logs in | Same | Same |

For v1.0, none of the above scaling concerns apply. The architecture cleanly supports the recommended next-level migration (swap `sessionStore` impl from SQLite to Redis) without touching `auth.ts`, `kineticaCall.ts`, or any route handler.

---

## 10. Sources & Confidence

- **Existing codebase reads** — HIGH confidence on every line/route/file referenced. All call sites enumerated by direct reading of `kinetica_bi/server/src/index.ts` (462 lines), `kinetica_bi/server/src/auth.ts`, `kinetica_bi/server/src/db.ts`, `kinetica_bi/src/api/client.ts`, `kinetica_bi/src/store/auth.ts`, `kinetica_bi/src/App.tsx`.
- **JWT/JWE security tradeoffs** — MEDIUM-HIGH confidence; standard cryptographic engineering, not specific to this codebase. `jsonwebtoken` HS256 signs but does not encrypt; `jose` library provides JWE; AES-256-GCM is the standard authenticated-encryption choice in Node's `crypto`.
- **Express 4 error middleware signature `(err, req, res, next)`** — HIGH confidence (long-standing Express API).
- **better-sqlite3 sync-read performance characteristics** — HIGH confidence (well-documented; the project is already using it for everything else).
- **The Option A vs Option B recommendation** — MEDIUM confidence. Both are correct engineering. The recommendation leans on the project's existing patterns (everything else is in SQLite already) and the threat-model framing (this milestone is about not trusting shared credentials, so don't put credentials in cookies). A reasonable team could choose JWE; flag this for CONTEXT.md confirmation.

---

*Architecture analysis: 2026-04-27 — milestone v1.0 Per-User Kinetica Credential Passthrough*
