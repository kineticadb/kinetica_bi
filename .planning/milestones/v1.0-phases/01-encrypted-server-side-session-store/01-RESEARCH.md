# Phase 1: Encrypted server-side session store - Research

**Researched:** 2026-04-27
**Domain:** Server-side encrypted SQLite session store + AES-256-GCM credential encryption + JWT-pointer cookie wiring on an Express 4 + better-sqlite3 + Node 24.14.1 server
**Confidence:** HIGH

## Summary

This is a tightly-scoped, well-anchored phase. The milestone-level research (`SUMMARY.md`, `STACK.md`, `ARCHITECTURE.md`, `PITFALLS.md`) and the user-locked CONTEXT.md have already settled every architectural decision: AES-256-GCM via `node:crypto`, separate `SESSION_ENCRYPTION_KEY` env var, BLOB columns, JWT version field `v: 1`, 1h `setInterval` GC, `kinetica_url` mismatch defense, `last_used_at` stamp. Phase 1 research is not exploratory — it is **prescriptive verification**: confirm the Node 24 crypto API surface, confirm better-sqlite3 BLOB binding, resolve the two open questions (Kinetica token-exchange spike + Validation Architecture), and lay out runnable code sketches so the planner can mechanically map tasks.

The token-exchange spike (the only remaining could-flip-the-design item) is **resolved as NO** — multiple Kinetica 7.1 / 7.2 documentation sources confirm HTTP Basic Auth on every request is the only client-facing authentication mechanism; there is no `/login`, `/token`, or `/auth` endpoint that exchanges credentials for a short-lived token. The password-encryption design proceeds exactly as locked in CONTEXT.md.

**Primary recommendation:** Build a single new `sessionStore.ts` module owning the `sessions` table CRUD, AES-256-GCM helpers, and the GC sweep. Modify `auth.ts` to widen `SessionPayload`, add a shared `loadSessionForRequest(req)` helper used by both `requireAuth` and `/api/auth/me`, and let `index.ts` only know about login/logout/me wiring + `setInterval` boot. Use `crypto.randomBytes(32).toString("hex")` for `sid` (matches the existing `AUTH_SECRET` aesthetic and gives 256 bits of entropy at trivial cost). Run the GC sweep timer with `.unref()` so it doesn't block test-runner shutdown.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Encryption — algorithm and parameters:**
- AES-256-GCM via Node's built-in `node:crypto` (no new npm dependency).
- Fresh 12-byte IV per row, 16-byte auth tag stored alongside ciphertext.
- Plaintext input is the user's Kinetica password (UTF-8 bytes); username is stored unencrypted in a separate column for query/auditability.

**Encryption-key sourcing:**
- New env var: `SESSION_ENCRYPTION_KEY`.
- Format: 64-char hex string (32 raw bytes after decoding). Generate with `openssl rand -hex 32`.
- Boot-time validation: fail-fast at server startup if the var is missing, not exactly 64 hex chars, or contains non-hex characters. Mirrors the existing `getSecret()` pattern in `auth.ts:14-20`. No silent fallback to HKDF-from-`AUTH_SECRET`.
- Independent rotation from `AUTH_SECRET`.
- **Single key only in v1.0.** No previous-key fallback / overlap window. Rotation = set new value, restart server, all session rows become undecryptable, all users re-login on next request.

**`sessions` table schema (added to `db.ts` boot DDL):**
```sql
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  ciphertext BLOB NOT NULL,
  iv BLOB NOT NULL,
  auth_tag BLOB NOT NULL,
  kinetica_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions (username);
```
- BLOB columns over base64 TEXT.
- `kinetica_url` stamped at login from `KINETICA_URL`; `requireAuth` compares to current env var.
- `last_used_at` stamped on every `requireAuth` pass.
- `expires_at` set as `datetime('now', '+8 hours')` (UTC). 8h fixed, no extension.
- All timestamps UTC strings; comparisons use `datetime('now')`.

**JWT payload migration:**
- New shape: `{ sub: string, sid: string, v: 1, iat, exp }`.
- `requireAuth` rejects any decoded payload where `v !== 1` (or `sid` missing/empty) by returning 401 with `code: "REAUTH_REQUIRED"`.
- `code: "REAUTH_REQUIRED"` is introduced one phase early (officially Phase 3 / UX-03). Phase 1 only emits it for version-mismatch / row-missing cases.

**Session lifecycle:**
- **Login:** validate creds against Kinetica → generate `sid` → encrypt password → INSERT row → `issueSessionCookie` with `{ sub, sid, v: 1 }`.
- **`requireAuth`:** read JWT → verify signature → check `v === 1` → SELECT row → check not expired → check `kinetica_url === process.env.KINETICA_URL` → decrypt ciphertext → attach `req.user = { sub, creds: { username, password } }` → UPDATE `last_used_at`. Any failure → 401 + `{ error, code: "REAUTH_REQUIRED" }`.
- **Logout:** read sid from JWT (best-effort), `DELETE FROM sessions WHERE sid = ?`, clear cookie. Single device only.
- **`/api/auth/me`:** moved behind row-existence check (currently bypasses `requireAuth` at `index.ts:94-98`).
- **Passive expiry-on-access:** any `requireAuth` lookup that finds an expired row also DELETEs it inline before returning 401.

**Session GC (scheduled sweep):**
- `setInterval` in-process, every 1 hour. Started once at server boot.
- `DELETE FROM sessions WHERE expires_at <= datetime('now')`.
- Logs one line per sweep with rows deleted.
- Sweep complements passive expiry.
- No external scheduler, no separate process.

**Deployment / migration:**
- Brief deploy-runbook note: "On deploy, all currently logged-in users will be redirected to login on their next API call."
- No `AUTH_SECRET` rotation required.
- `SESSION_ENCRYPTION_KEY` must be present in production env or server refuses to start.
- `.env.example` updated.

### Claude's Discretion

- Exact module layout (e.g., new `sessionStore.ts` vs adding to `auth.ts` vs adding to `db.ts`).
- `sid` generation primitive (`crypto.randomBytes(32).toString("hex")` vs `crypto.randomUUID()`).
- Whether to expose `lastUsedAt` / `createdAt` on the `req.user` object (probably not — keep `req.user` minimal: `{ sub, creds }`).
- Boot-time error message wording when `SESSION_ENCRYPTION_KEY` is missing.
- Sweep log format (single human-readable line is fine).

### Deferred Ideas (OUT OF SCOPE)

- **"Sign out everywhere" button** — captured as `AUTH-V2-07`.
- **Sliding-window TTL / session refresh** — captured as `AUTH-V2-06`. The `last_used_at` column is the schema enabler.
- **IP / User-Agent binding** — explicitly considered and rejected for this milestone.
- **Previous-key fallback for `SESSION_ENCRYPTION_KEY` rotation** — explicitly rejected for v1.0.
- **Audit log of session creation/deletion** — defer; OBS-01 (per-Kinetica-call) lands in Phase 2.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| **SESS-01** | Server persists the BI user's Kinetica password between requests, encrypted at rest with AES-256-GCM | §"Standard Stack" `node:crypto` AES-256-GCM verified on Node 24.14.1; §"Code Examples" `encryptPassword` / `decryptPassword` round-trip; §"Common Pitfalls" P1 (auth tag must be set before final read) |
| **SESS-02** | Session cookie carries an opaque session id only — no plaintext credentials in the cookie payload | §"Code Examples" `issueSessionCookie` payload shape `{ sub, sid, v: 1 }`; §"Architecture Patterns" cookie-as-pointer; verification in §"Validation Architecture" tests `auth.cookie.spec.ts` |
| **SESS-03** | Logout destroys the server-side session row (not just the cookie) | §"Code Examples" `deleteSession(sid)`; §"Code Examples" `logout` route handler reads sid → `deleteSession` → `clearSessionCookie`; §"Validation Architecture" replay-after-logout test |
| **SESS-04** | Session TTL is 8 hours — no extension, no sliding window in this milestone | §"Code Examples" `createSession` uses `datetime('now', '+8 hours')`; §"Common Pitfalls" P5 (no UPDATE expires_at on touch) |
| **SESS-05** | Expired session rows are cleaned up (no unbounded growth of the sessions table) | §"Code Examples" `sweepExpiredSessions` + 1h `setInterval`; §"Code Examples" passive expiry-on-access; §"Common Pitfalls" P6 (try/catch the sweep so a transient error doesn't kill the timer) |
</phase_requirements>

## Token-Exchange Spike — FINDING

**Question:** Does Kinetica expose a token-exchange endpoint such that the BI server could store a short-lived token + refresh material instead of the raw password?

**FINDING: NO.** Kinetica REST API uses HTTP Basic Auth on every request. There is no `/login`, `/auth`, or `/token` endpoint that trades username/password for a bearer/JWT token.

**Evidence (HIGH confidence — multiple authoritative sources):**

1. **Kinetica 7.1 REST API endpoint catalog** ([docs.kinetica.com/7.1/api/rest/](https://docs.kinetica.com/7.1/api/rest/)) — comprehensive endpoint table lists data, admin, and query operations. **No `/login`, `/auth`, or `/token` endpoint appears.** Verified 2026-04-27 via WebFetch.

2. **Kinetica 7.2 Security Configuration** ([docs.kinetica.com/7.2/security/sec_configuration/](https://docs.kinetica.com/7.2/security/sec_configuration/)) — only authentication mechanisms documented: (a) Internal username/password, (b) External via Apache HTTPD proxy supporting LDAP / Active Directory / Kerberos, (c) HTTP Basic Auth (`AuthType Basic` in HTTPD configs). **No mention of JWT, bearer tokens, or OAuth token endpoints.** Verified 2026-04-27 via WebFetch.

3. **Cross-check: Kinetica JavaScript client** ([github.com/kineticadb/kinetica-api-javascript](https://github.com/kineticadb/kinetica-api-javascript)) — README references credentials but no token-exchange flow; client sets HTTP Basic auth header on each request.

4. **Existing repo behavior** — `kinetica_bi/server/src/auth.ts:21-66` already authenticates to Kinetica by setting `Authorization: Basic ${base64(user:pass)}` on every request. The four other call sites (`index.ts:249, 319, 401, 433`) do the same. There is no token in the existing flow.

**One ambiguity worth noting (does NOT change the design):** WebSearch surfaced a passing reference to Kinetica supporting an `oauth_token` parameter in some configurations. This refers to **server-side OAuth2 *integration* with an external IdP** (Apache HTTPD proxy front-ending Kinetica with an OAuth-aware module), **not a client-side token exchange flow**. The BI server is the client; for the BI server's purposes, every Kinetica call still requires either Basic auth or a pre-established proxy session — neither of which lets us store a short-lived token in lieu of the password.

**Implication for Phase 1 design:** Storage shape is **unchanged**. Encrypt the password (UTF-8 bytes) with AES-256-GCM as locked in CONTEXT.md. Document this finding in PROJECT.md key decisions per the CONTEXT.md gate.

**Decision to record in PROJECT.md:**
> 2026-04-27: Kinetica token-exchange endpoint spike resolved (NO endpoint exists). Storage encrypts the user's Kinetica password directly. Confirmed against Kinetica 7.1/7.2 REST API and Security Configuration docs. Re-evaluate only if Kinetica adds an OAuth/JWT issuer in a future release.

## Standard Stack

### Core (no change — already pinned)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `express` | ^4.19.2 (current 4.x latest 4.21.x) | HTTP server | Already wired with cookie-parser, cors, JSON body parser, requireAuth |
| `jsonwebtoken` | ^9.0.3 (latest 9.0.3, published 2026-04-16) | Sign/verify the session cookie | Already issuing `kbi_session`. Adding `sid` and `v` claims is a no-op for compat |
| `cookie-parser` | ^1.4.7 | Parse `Cookie` header into `req.cookies` | Already handles `kbi_session` |
| `better-sqlite3` | ^12.8.0 (latest 12.9.0, published 2026-04-12) | Local persistence | Already the persistence layer; new `sessions` table joins existing DDL block |
| `node:crypto` | bundled (Node 24.14.1) | AES-256-GCM encrypt/decrypt; `randomBytes`/`randomUUID` for sid | Built-in; AES-256-GCM round-trip and tamper-detection both verified live on the runtime |

### Supporting

**No new npm packages.** Phase 1 is dependency-zero.

### Alternatives Considered (already rejected at milestone level — listed only for traceability)

| Instead of | Could Use | Tradeoff (and why rejected) |
|------------|-----------|-----------------------------|
| `node:crypto` AES-256-GCM | `jose` JWE | Adds a top-level dep; would force two JWT libraries side-by-side. Node stdlib covers the use case. |
| Server-side SQLite session | `iron-session` / `@hapi/iron` / `express-session` + SQLite store | All replace (not augment) the existing JWT cookie pattern; the two `better-sqlite3`-compatible session stores are unmaintained pre-1.0 from 2022. |
| Separate `SESSION_ENCRYPTION_KEY` env var | HKDF derive from `AUTH_SECRET` | Single secret = single point of failure. CONTEXT.md locks separate var. |
| `crypto.randomBytes(32).toString("hex")` for sid | `crypto.randomUUID()` | Both give ≥128 bits entropy. UUID is 36 chars with dashes; hex is 64 chars. Recommendation in §"Specific Decisions" below. |

**Installation:** None required. Dependency check:
```bash
cd kinetica_bi/server && node --version  # → v24.14.1
node -e "require('crypto').createCipheriv('aes-256-gcm', Buffer.alloc(32), Buffer.alloc(12))" && echo "OK"
```

**Version verification (live `npm view` 2026-04-27):**
- `jsonwebtoken@9.0.3` published 2026-04-16T21:47:09.341Z — current
- `better-sqlite3@12.9.0` published 2026-04-12T18:23:42.645Z — current major (^12.8.0 picks up 12.9.x cleanly)
- `node:crypto` AES-256-GCM round-trip verified on Node 24.14.1 in this checkout

## Specific Decisions (Claude's Discretion)

### Module layout

**Decision:** New file `kinetica_bi/server/src/sessionStore.ts`.

**Rationale:**
- `auth.ts` stays focused on JWT issue/read + Kinetica creds verification. Pulling crypto/CRUD in there inflates a small file.
- `db.ts` is the persistence ledger for domain entities (dashboards, widgets, tables, views). Sessions are an auth concern, not a domain entity. Mixing them muddies separation.
- A dedicated module makes the encryption key validation, AES helpers, CRUD, and the GC sweep all live in one auditable surface — useful for code review (this is the most security-sensitive file in the milestone).
- DDL stays in `db.ts` (idempotent boot block) — that is the existing convention. `sessionStore.ts` calls `import { db } from "./db"` for prepared statements (requires exporting the `Database` instance from `db.ts`, which is currently module-private).

**Files affected in Phase 1:**
- `kinetica_bi/server/src/sessionStore.ts` — **NEW**. Exports: `createSession`, `getSession`, `deleteSession`, `sweepExpiredSessions`, `startSessionSweep`, `getSessionEncryptionKey` (internal), `encryptPassword`, `decryptPassword` (internal). Re-uses `db` from `db.ts`.
- `kinetica_bi/server/src/db.ts` — **MODIFIED**. Append `CREATE TABLE IF NOT EXISTS sessions ...` + indices to the existing `db.exec(...)` block at lines 18-66. Add `export { db };` so `sessionStore.ts` can prepare statements.
- `kinetica_bi/server/src/auth.ts` — **MODIFIED**. `SessionPayload` widens to `{ sub, sid, v: 1 }`. `issueSessionCookie` signature becomes `(res, username, sid)`. `readSession` rejects `v !== 1`. `requireAuth` adds the row-lookup + decrypt + kinetica_url match + last_used_at update. New exported `loadSessionForRequest(req)` helper used by both `requireAuth` and `/api/auth/me`.
- `kinetica_bi/server/src/index.ts` — **MODIFIED**. Login route writes session row + issues cookie with sid; logout reads sid + deletes row + clears cookie; `/api/auth/me` switches to use `loadSessionForRequest` (or `requireAuth`); `setInterval` GC kicked off after `app.listen`.
- `kinetica_bi/server/.env.example` — **MODIFIED**. Append `SESSION_ENCRYPTION_KEY` line + comment showing `openssl rand -hex 32`.

### `sid` generation

**Decision:** `crypto.randomBytes(32).toString("hex")` — 64 hex chars, 256 bits of entropy.

**Rationale:**
- Matches the aesthetic of `AUTH_SECRET` and `SESSION_ENCRYPTION_KEY` (both 64-char hex strings). Visually obvious in logs / `sqlite3` queries that "this is opaque random bytes."
- 256 bits is overkill for collision resistance; the marginal cost is 28 extra bytes per row.
- `crypto.randomUUID()` would also be fine (122 bits of entropy, RFC 4122 v4) — but the dashes and version-bits make UUIDs feel like "structured identifiers," and a sid is opaque-by-design.
- No production tradeoff; pure aesthetic + entropy-headroom call.

### `req.user` shape

**Decision:** `req.user = { sub: string, creds: { username, password }, sid: string }`.

- `sub` and `creds` are what downstream Phase 2 code needs.
- `sid` is included so the **logout** route handler and the global error middleware (Phase 3) can call `deleteSession(req.user.sid)` without re-reading the cookie.
- **Do NOT expose `lastUsedAt` / `createdAt`** on `req.user`. Per CONTEXT.md discretion — keep it minimal to avoid accidental logging/serialization of bookkeeping fields.

### Sweep timer lifecycle

**Decision:** `const handle = setInterval(sweepExpiredSessions, 60 * 60 * 1000); handle.unref();` and wrap the sweep body in `try/catch`.

**Rationale:**
- `unref()` lets test runners and short-lived processes exit cleanly without waiting for the timer. Verified: `setInterval(...).unref` is a function on Node 24.14.1; calling it does not start/stop ticks but removes the timer from the event-loop "keep alive" set.
- `try/catch` around the `DELETE` so a transient SQLite lock or any unforeseen error doesn't kill the timer permanently. Log on error; the next tick retries.
- One sweep per hour is correct per CONTEXT.md. Don't tune to a tighter cadence in v1.0.

### Logout best-effort

**Decision:** Logout reads the JWT but does **NOT** require it to be valid (signature, version, sid present). If sid extractable → `deleteSession(sid)`. Always `clearSessionCookie(res)`. Always 204.

**Rationale:**
- A user clicking "Log out" with a corrupt/expired/wrong-version cookie should still get the cookie cleared. Failing logout because the cookie is malformed is hostile UX.
- The deletion is idempotent — if the row doesn't exist (already swept, or sid bogus), `DELETE` is a no-op.

## Architecture Patterns

### Recommended File Structure (delta only)

```
kinetica_bi/server/src/
├── auth.ts            # MODIFIED: SessionPayload widens; requireAuth hydrates creds; loadSessionForRequest exported
├── db.ts              # MODIFIED: sessions DDL + indices added; `db` instance exported
├── sessionStore.ts    # NEW: AES-GCM helpers + CRUD + sweep
├── index.ts           # MODIFIED: login/logout/me wire-through; sweep boot
└── ...                # unchanged
```

### Pattern 1: AES-256-GCM Round-Trip via `node:crypto`

**What:** Encrypt with `createCipheriv("aes-256-gcm", key, iv)`, capture `getAuthTag()` AFTER `final()`, store ciphertext + iv + tag separately. Decrypt with `createDecipheriv("aes-256-gcm", key, iv)`, **call `setAuthTag(tag)` BEFORE the final read**, treat any throw from `final()` as auth failure.

**When to use:** Symmetric encrypt-with-integrity for data-at-rest where the same process holds both the key and the data. Don't use CBC. Don't bolt your own HMAC onto unauthenticated modes.

**Source:** Node.js Crypto docs (`createCipheriv`, GCM auth tag); verified live on Node 24.14.1 (this checkout).

```typescript
// Verified on Node 24.14.1 in this repo:
//   CT len 21, IV len 12, tag len 16, roundtrip: true
//   Bad-tag throws: "Unsupported state or unable to authenticate data"
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const KEY = Buffer.alloc(32); // your 32-byte key
const plaintext = Buffer.from("hunter2", "utf8");

const iv = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", KEY, iv);
const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
const tag = cipher.getAuthTag(); // MUST be after .final()

const dec = createDecipheriv("aes-256-gcm", KEY, iv);
dec.setAuthTag(tag); // MUST be before the final read
const pt = Buffer.concat([dec.update(ct), dec.final()]); // throws on bad tag/iv/key
```

### Pattern 2: BLOB binding with better-sqlite3

**What:** Pass `Buffer` directly to `.run(...)`; `.get(...)` returns `Buffer` for BLOB columns. No base64 wrapping needed.

**When to use:** Whenever you have raw bytes (ciphertext, iv, tag, hashes). Saves bytes on disk and avoids encode/decode round-trips. Don't store BLOB-shaped data as TEXT.

**Source:** better-sqlite3 docs ("better-sqlite3 supports binding Buffers as BLOBs"); verified in this checkout.

```typescript
// Verified live: round-trip Buffer through better-sqlite3 BLOB column
import Database from "better-sqlite3";
const db = new Database(":memory:");
db.exec("CREATE TABLE t (k TEXT PRIMARY KEY, b BLOB NOT NULL)");

const buf = Buffer.from([1, 2, 3, 4, 5]);
db.prepare("INSERT INTO t VALUES (?, ?)").run("a", buf);
const row = db.prepare("SELECT b FROM t WHERE k = ?").get("a") as { b: Buffer };
// Buffer.isBuffer(row.b) === true
// Buffer.compare(row.b, buf) === 0
```

**Caveat verified live:** `better-sqlite3` does NOT accept JS booleans as bind params (`SQLite3 can only bind numbers, strings, bigints, buffers, and null`). All Phase 1 columns are TEXT/BLOB so this is not a concern, but is worth knowing if anyone proposes a `is_active` boolean in v2.

### Pattern 3: Hydrate-then-handle in middleware

**What:** `requireAuth` does **two** jobs atomically — prove the session is valid AND hydrate `req.user.creds` from the decrypted row. Don't split into `requireAuth` (validate only) + `loadCreds` (separate middleware) — that creates a code path with `req.user.sub` but no `req.user.creds`, silently breaking Phase 2 Kinetica calls.

**When to use:** Every authenticated route (already mounted at `index.ts:101` `app.use("/api", requireAuth)`).

**Source:** ARCHITECTURE.md §7.

### Pattern 4: Shared lookup helper for `/api/auth/me`

**What:** Extract the row-lookup-and-validate logic into a reusable function `loadSessionForRequest(req)` returning `{ session: SessionRow, jwt: SessionPayload } | null`. `requireAuth` uses it to populate `req.user`. `/api/auth/me` uses it to confirm the row is alive (instead of just decoding the JWT).

**When to use:** Any handler that needs to know "is this user really authenticated?" — currently just `requireAuth` and `/me`, but Phase 3's error middleware will reuse it.

**Why over `app.use("/api/auth/me", requireAuth)`:** Simpler to express the migration without re-shuffling route mount order. The current `app.use("/api", requireAuth)` mounts at line 101, AFTER `/api/auth/login`, `/api/auth/logout`, and `/api/auth/me` are defined (lines 72-98). Putting `/me` under `requireAuth` is technically possible but requires mounting `requireAuth` only on `/me` (not on `/login` or `/logout`), and route mount ordering in Express is finicky. The shared-helper approach avoids the rewiring entirely.

```typescript
// auth.ts (sketch)
export const loadSessionForRequest = (req: Request): {
  jwt: SessionPayload;
  session: SessionRow;
} | null => {
  const jwt = decodeAndVerifyJwt(req); // returns null on bad sig / expired / v !== 1 / missing sid
  if (!jwt) return null;
  const session = sessionStore.getSession(jwt.sid);
  if (!session) return null;
  if (sessionExpired(session)) {
    sessionStore.deleteSession(jwt.sid); // passive expiry
    return null;
  }
  if (session.kineticaUrl !== process.env.KINETICA_URL) return null;
  return { jwt, session };
};
```

### Anti-Patterns to Avoid

- **Plaintext password in JWT** (PITFALLS.md P1) — JWS is signed, not encrypted. Anyone holding the cookie value can `cut -d. -f2 | base64 -d` it. Never. Locked decision: opaque sid pointer.
- **Reusing `AUTH_SECRET` for both signing and encryption** (PITFALLS.md P2) — locked: separate `SESSION_ENCRYPTION_KEY`.
- **AES-CBC + bolt-your-own HMAC** (PITFALLS.md P3) — use GCM (AEAD) exclusively.
- **Constant or username-derived IV** (PITFALLS.md P2 warning sign) — `crypto.randomBytes(12)` per row, always.
- **Decryption that swallows errors and falls through** (PITFALLS.md P3 warning sign) — try/catch around `decipher.final()`, treat any throw as auth failure → 401 + `code: "REAUTH_REQUIRED"`. Never log the underlying error message back to the client (info disclosure).
- **Forgetting to invalidate session-row on logout** (PITFALLS.md P6) — locked behavior: logout reads sid → `deleteSession`.
- **`/api/auth/me` migration trap** (PITFALLS.md P13, ARCHITECTURE.md §"Anti-Patterns") — `/me` must call `loadSessionForRequest` so a valid-cookie-pointing-at-deleted-row returns 401.
- **`UPDATE expires_at` on each touch** — would silently sliding-window the TTL. SESS-04 says no extension. Only `last_used_at` updates per touch.
- **Storing creds on `req.user` in a way that hits `console.log(req.user)`** (PITFALLS.md P8) — `req.user` is an object that might end up logged. Two mitigations: (1) keep `password` only on `req.user.creds.password` (one level deep makes accidental dumps less likely to print it), (2) Phase 2 will ban `console.log(req` via lint. Phase 1: discipline + code review.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Authenticated symmetric encryption | Custom AES-CBC + HMAC | `node:crypto` `aes-256-gcm` | AEAD avoids EtM/MtE pitfalls, padding oracles, MAC-comparison timing attacks |
| Session middleware framework | `express-session` + custom store | Direct `better-sqlite3` CRUD + JWT cookie | Existing JWT pattern works; both better-sqlite3 session stores on npm are unmaintained from 2022 (per STACK.md `npm view`) |
| Random ID generation | `Math.random()`/`Date.now()`/hash-of-username | `crypto.randomBytes(32).toString("hex")` | CSPRNG, not statistically-distinguishable, not predictable from the session creation context |
| Time comparison | JS `Date.now()` math vs SQLite `CURRENT_TIMESTAMP` | SQLite `datetime('now')` for both INSERT and comparison | Avoids timezone/DST drift (PITFALLS.md P19); same source of truth on both sides |
| JWT version negotiation | Trying multiple decode shapes | `if (decoded.v !== 1) → 401 REAUTH_REQUIRED` | Single explicit version field; verified live: `jwt.verify` returns `v: undefined` for old-shape tokens, `v !== 1` for new-shape with wrong version |

**Key insight:** The Phase 1 codepath touches three security-critical primitives — random IDs, AES, and time. All three have well-known pitfalls when hand-rolled (predictable IDs, padding oracles, timezone drift). The "don't hand-roll" answer for each is "use Node's stdlib + SQLite's stdlib." The interesting code is the wiring (validation, GC, error responses), not the primitives.

## Common Pitfalls

### Pitfall P1 (Phase 1 specific): Calling `setAuthTag` AFTER reading from the decipher

**What goes wrong:** `decipher.setAuthTag(tag)` MUST be called before any `decipher.update(...)` or `decipher.final()` call that consumes the auth-tag-protected portion. If called too late, GCM's authentication is bypassed (or the call throws, depending on Node version).

**Why it happens:** Node's encrypt-side flow is `update → final → getAuthTag()`, so muscle memory says "tag goes last." Decryption inverts that: `setAuthTag(tag) → update → final`.

**How to avoid:** Always set the tag immediately after `createDecipheriv(...)`. Don't pre-fetch tag from the database lazily inside the read loop; load it eagerly with the ciphertext.

**Verified live (Node 24.14.1):**
- Correct order: round-trip succeeds.
- Tampered tag (1 bit flipped): `final()` throws `Error: Unsupported state or unable to authenticate data`.
- That exact error message is the signal to return 401 + `code: "REAUTH_REQUIRED"`.

### Pitfall P2: IV reuse with the same key

**What goes wrong:** Catastrophic. Two ciphertexts encrypted under the same (key, iv) pair leak XOR of plaintexts. With AES-GCM specifically, IV reuse also enables key recovery (forbidden-attack on GHASH).

**How to avoid:** `randomBytes(12)` per row, every time. Never derive the IV from the username, the sid, the timestamp, or anything else.

**Code-review check:** `grep -n "randomBytes\|iv" sessionStore.ts` should show the IV generated fresh inside `encryptPassword(...)` for every call, not stored at module scope.

### Pitfall P3: Returning Kinetica error detail to the login response (PITFALLS.md P17)

**What goes wrong:** Phase 1 only touches login indirectly (still calls `verifyKineticaCredentials`), but the existing login route at `index.ts:78-79` does `res.status(result.status).json({ error: result.message })` — forwarding Kinetica's raw error. If Kinetica's message includes "user 'foo' is locked" vs "wrong password," it enables username enumeration.

**How to avoid in Phase 1:** Pre-existing pitfall, not introduced by this phase. Note in PROJECT.md as a known issue for Phase 3 cleanup. **Do NOT fix in Phase 1** — out of scope, would conflict with the locked phase boundary.

**Why mention here:** The `code: "REAUTH_REQUIRED"` field that Phase 1 introduces is a partial solution (gives the frontend a stable signal). Phase 3 will tighten the messages.

### Pitfall P4: Decoding a v=undefined cookie crashes the request

**What goes wrong:** Old cookies issued before the deploy (`{ sub }` shape) decode cleanly with the same `AUTH_SECRET`. If `requireAuth` does `if (decoded.v !== 1)` correctly → 401. But if the migration logic does `const sid = decoded.sid; getSession(sid)` first (without checking v), the SELECT runs with `sid = undefined`, returning no rows, and you 401 anyway — but with a confusing path. Worse: `if (!decoded.sid) return next()` (treating undefined sid as "skip") falls through to admin creds, undoing the milestone.

**How to avoid:** Check `v === 1` FIRST. If false → 401 + REAUTH_REQUIRED. Don't even read `sid` until `v` is verified.

**Verified live (Node 24.14.1):**
- `jwt.verify` with old-shape token (no `v`) returns `{ sub: 'alice', iat, exp }` — `decoded.v === undefined`.
- `decoded.v !== 1` is `true` → 401. Clean.

### Pitfall P5: Sliding the expires_at on every touch (SESS-04 violation)

**What goes wrong:** Tempting to "freshen" the session on activity. CONTEXT.md and SESS-04 are explicit: 8h fixed, no extension. `last_used_at` is updated for diagnostics; `expires_at` is NOT.

**How to avoid:** `requireAuth`'s touch is `UPDATE sessions SET last_used_at = datetime('now') WHERE sid = ?` — one column only. Code review: any UPDATE that touches `expires_at` post-creation is wrong in v1.0.

### Pitfall P6: Sweep timer dies on first error and never recovers

**What goes wrong:** `setInterval(sweepExpiredSessions, 1h)` — if `sweepExpiredSessions` throws (transient SQLite busy / lock / corruption), the next tick still fires (Node's setInterval is resilient to per-tick errors), BUT if the throw escapes to the unhandledException handler, the whole process can crash if no handler is registered.

**How to avoid:** Wrap the body:
```typescript
const sweepHandle = setInterval(() => {
  try {
    const deleted = sweepExpiredSessions();
    console.log(`[sessions] swept ${deleted} expired rows`);
  } catch (err) {
    console.error("[sessions] sweep failed", err);
    // next tick will retry; do NOT clearInterval
  }
}, 60 * 60 * 1000);
sweepHandle.unref();
```

**Why `.unref()`:** Verified on Node 24.14.1 — without it, the timer keeps the event loop alive, blocking `npm test` exit. With it, tests finish; in production, `app.listen` is the keep-alive, so the sweep still runs.

### Pitfall P7: GC sweep races with active passive expiry

**What goes wrong:** `requireAuth` finds an expired row → `deleteSession(sid)` (passive expiry). Concurrently, the 1h `setInterval` runs `DELETE FROM sessions WHERE expires_at <= datetime('now')`. Both target overlapping rows.

**How to avoid:** This is fine — `DELETE` is idempotent in SQLite. The concern is purely conceptual; better-sqlite3 is synchronous and the worst case is the sweep deletes a row the request just deleted (changes=0 vs changes=1; cosmetic only).

### Pitfall P8: Logout deletes ALL sessions for the user (multi-device break)

**What goes wrong:** `DELETE FROM sessions WHERE username = ?` instead of `WHERE sid = ?` would log out the user from all devices. CONTEXT.md says single-device only — "sign out everywhere" deferred to v2 (`AUTH-V2-07`).

**How to avoid:** Logout reads the sid from the JWT; deletes by sid. Never by username. Pitfall #20 in PITFALLS.md is the canonical reference.

## Code Examples

Verified patterns from official sources + live runtime checks (Node 24.14.1, better-sqlite3 12.9.0, jsonwebtoken 9.0.3).

### Example 1: `getSessionEncryptionKey()` — boot-time validation

```typescript
// kinetica_bi/server/src/sessionStore.ts
// Mirrors getSecret() pattern from auth.ts:13-19
const HEX_64 = /^[0-9a-fA-F]{64}$/;

export const getSessionEncryptionKey = (): Buffer => {
  const raw = process.env.SESSION_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "SESSION_ENCRYPTION_KEY must be set. Generate with: openssl rand -hex 32"
    );
  }
  if (!HEX_64.test(raw)) {
    throw new Error(
      "SESSION_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). " +
      "Generate with: openssl rand -hex 32"
    );
  }
  return Buffer.from(raw, "hex");
};

// Cache once at module load — fail-fast at boot, not per-request:
const SESSION_KEY = getSessionEncryptionKey();
```

### Example 2: `encryptPassword` / `decryptPassword`

```typescript
// kinetica_bi/server/src/sessionStore.ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type EncryptedBlob = { ciphertext: Buffer; iv: Buffer; authTag: Buffer };

export const encryptPassword = (password: string): EncryptedBlob => {
  const iv = randomBytes(12); // 96-bit GCM nonce — fresh per row
  const cipher = createCipheriv("aes-256-gcm", SESSION_KEY, iv);
  const ciphertext = Buffer.concat([
    cipher.update(password, "utf8"),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag(); // MUST be called after .final()
  return { ciphertext, iv, authTag };
};

export const decryptPassword = (blob: EncryptedBlob): string => {
  const decipher = createDecipheriv("aes-256-gcm", SESSION_KEY, blob.iv);
  decipher.setAuthTag(blob.authTag); // MUST be called before reading
  // .final() throws on tag mismatch (verified: "Unsupported state or unable to authenticate data")
  const plaintext = Buffer.concat([
    decipher.update(blob.ciphertext),
    decipher.final()
  ]);
  return plaintext.toString("utf8");
};
```

### Example 3: Session CRUD — `createSession`, `getSession`, `deleteSession`, `sweepExpiredSessions`

```typescript
// kinetica_bi/server/src/sessionStore.ts
import { randomBytes } from "node:crypto";
import { db } from "./db"; // requires `export { db }` added to db.ts

export type SessionRow = {
  sid: string;
  username: string;
  password: string;       // decrypted; never logged
  kineticaUrl: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
};

const insertStmt = db.prepare(
  `INSERT INTO sessions
   (sid, username, ciphertext, iv, auth_tag, kinetica_url, expires_at)
   VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'))`
);

const selectStmt = db.prepare(
  `SELECT sid, username, ciphertext, iv, auth_tag, kinetica_url,
          created_at, last_used_at, expires_at
   FROM sessions WHERE sid = ?`
);

const touchStmt = db.prepare(
  `UPDATE sessions SET last_used_at = datetime('now') WHERE sid = ?`
);

const deleteStmt = db.prepare(`DELETE FROM sessions WHERE sid = ?`);

const sweepStmt = db.prepare(
  `DELETE FROM sessions WHERE expires_at <= datetime('now')`
);

export const generateSid = (): string =>
  randomBytes(32).toString("hex"); // 256 bits entropy, 64 hex chars

export const createSession = (
  username: string,
  password: string,
  kineticaUrl: string
): string => {
  const sid = generateSid();
  const { ciphertext, iv, authTag } = encryptPassword(password);
  insertStmt.run(sid, username, ciphertext, iv, authTag, kineticaUrl);
  return sid;
};

type RawSessionRow = {
  sid: string;
  username: string;
  ciphertext: Buffer;     // verified: better-sqlite3 returns Buffer for BLOB
  iv: Buffer;
  auth_tag: Buffer;
  kinetica_url: string;
  created_at: string;
  last_used_at: string;
  expires_at: string;
};

export const getSession = (sid: string): SessionRow | null => {
  const row = selectStmt.get(sid) as RawSessionRow | undefined;
  if (!row) return null;
  // Passive expiry-on-access: deletes if past expires_at
  if (row.expires_at <= new Date().toISOString()
      || isExpiredSqlComparison(row.expires_at)) {
    deleteStmt.run(sid);
    return null;
  }
  let password: string;
  try {
    password = decryptPassword({
      ciphertext: row.ciphertext,
      iv: row.iv,
      authTag: row.auth_tag
    });
  } catch {
    // Tag mismatch / wrong key / corrupted row — treat as auth failure
    deleteStmt.run(sid); // remove the unrecoverable row
    return null;
  }
  return {
    sid: row.sid,
    username: row.username,
    password,
    kineticaUrl: row.kinetica_url,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
  };
};

// Use SQLite's own datetime('now') for comparison to avoid TZ drift (PITFALLS P19).
// One round-trip is fine; this is an indexed point-lookup.
const isExpiredStmt = db.prepare(
  `SELECT 1 AS expired FROM (SELECT 1) WHERE ? <= datetime('now')`
);
const isExpiredSqlComparison = (expiresAt: string): boolean =>
  Boolean((isExpiredStmt.get(expiresAt) as { expired?: number } | undefined)?.expired);

export const touchSession = (sid: string): void => {
  touchStmt.run(sid);
};

export const deleteSession = (sid: string): void => {
  deleteStmt.run(sid);
};

export const sweepExpiredSessions = (): number => {
  const result = sweepStmt.run();
  return result.changes;
};

export const startSessionSweep = (): NodeJS.Timeout => {
  // 1-hour cadence per CONTEXT.md
  const handle = setInterval(() => {
    try {
      const deleted = sweepExpiredSessions();
      console.log(`[sessions] swept ${deleted} expired rows`);
    } catch (err) {
      console.error("[sessions] sweep failed", err);
      // next tick retries; do NOT clearInterval
    }
  }, 60 * 60 * 1000);
  handle.unref(); // verified: lets test runners exit cleanly
  return handle;
};
```

**Note on `getSession` expiry check:** The example shows two equivalent paths (JS string compare vs SQLite `datetime('now')` round-trip). The SQLite path is preferred (PITFALLS.md P19) because it uses the same time source as the INSERT. Pick one in implementation; the planner will lock the choice.

### Example 4: `auth.ts` — widened `SessionPayload` + `loadSessionForRequest`

```typescript
// kinetica_bi/server/src/auth.ts (modified)
import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";
import {
  getSession,
  touchSession,
  deleteSession,
  type SessionRow
} from "./sessionStore";

const COOKIE_NAME = "kbi_session";
const TOKEN_TTL_SECONDS = 60 * 60 * 8; // 8 hours

export type SessionPayload = {
  sub: string; // username
  sid: string; // opaque session id
  v: 1;        // version field — Phase 1 introduces this
};

export type AuthedRequest = Request & {
  user?: { sub: string; sid: string; creds: { username: string; password: string } };
};

export const issueSessionCookie = (res: Response, username: string, sid: string) => {
  const payload: SessionPayload = { sub: username, sid, v: 1 };
  const token = jwt.sign(payload, getSecret(), { expiresIn: TOKEN_TTL_SECONDS });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: TOKEN_TTL_SECONDS * 1000,
    path: "/",
  });
};

export const decodeAndVerifyJwt = (req: Request): SessionPayload | null => {
  const token = (req as Request & { cookies?: Record<string, string> })
    .cookies?.[COOKIE_NAME];
  if (!token) return null;
  let decoded: jwt.JwtPayload | string;
  try {
    decoded = jwt.verify(token, getSecret());
  } catch {
    return null;
  }
  if (typeof decoded === "string") return null;
  // Strictly check shape — verified live: old { sub } cookies decode with v: undefined
  if (decoded.v !== 1) return null;
  if (typeof decoded.sid !== "string" || !decoded.sid) return null;
  if (typeof decoded.sub !== "string" || !decoded.sub) return null;
  return { sub: decoded.sub, sid: decoded.sid, v: 1 };
};

export const loadSessionForRequest = (
  req: Request
): { jwt: SessionPayload; session: SessionRow } | null => {
  const jwt = decodeAndVerifyJwt(req);
  if (!jwt) return null;
  const session = getSession(jwt.sid); // returns null if expired (passive expiry)
  if (!session) return null;
  if (session.kineticaUrl !== process.env.KINETICA_URL) {
    // Operator changed KINETICA_URL mid-session — sessions stamped to old URL are dead
    deleteSession(jwt.sid);
    return null;
  }
  return { jwt, session };
};

const REAUTH = { error: "Authentication required.", code: "REAUTH_REQUIRED" };

export const requireAuth = (req: AuthedRequest, res: Response, next: NextFunction) => {
  const loaded = loadSessionForRequest(req);
  if (!loaded) {
    clearSessionCookie(res);
    return res.status(401).json(REAUTH);
  }
  req.user = {
    sub: loaded.session.username,
    sid: loaded.session.sid,
    creds: {
      username: loaded.session.username,
      password: loaded.session.password,
    },
  };
  touchSession(loaded.session.sid); // last_used_at — NOT expires_at
  return next();
};
```

### Example 5: `requireAuth` failure-mode dispatch table

Numbered step list. Each step has its exact response.

| Step | Check | Failure Response (status, body, code) |
|------|-------|---------------------------------------|
| 1 | Cookie `kbi_session` present | **401** `{ error: "Authentication required.", code: "REAUTH_REQUIRED" }` |
| 2 | JWT verifies (signature OK, not expired by `exp` claim) | **401** `{ error: "Authentication required.", code: "REAUTH_REQUIRED" }` |
| 3 | `decoded.v === 1` | **401** `{ error: "Authentication required.", code: "REAUTH_REQUIRED" }` (this is the "old cookie meets new code" path — PITFALLS.md P13) |
| 4 | `decoded.sid` is non-empty string | **401** REAUTH (defensive: catches `{ sub, v: 1 }` without sid — should never happen, but) |
| 5 | `decoded.sub` is non-empty string | **401** REAUTH (defensive) |
| 6 | Row exists in `sessions` table | **401** REAUTH + `clearSessionCookie` (logout-then-replay, manual DELETE, or sweep race) |
| 7 | Row not expired (`expires_at > datetime('now')`) | **401** REAUTH + `deleteSession` (passive expiry) + `clearSessionCookie` |
| 8 | `row.kinetica_url === process.env.KINETICA_URL` | **401** REAUTH + `deleteSession` + `clearSessionCookie` (operator-changed-URL defense) |
| 9 | AES-GCM decrypt succeeds (auth tag valid) | **401** REAUTH + `deleteSession` + `clearSessionCookie` (key rotated, row corrupted, tampered) |
| 10 | All pass → set `req.user`, `touchSession`, `next()` | — (success path, no response) |

**Implementation note:** All failures emit the SAME response body (`{ error: "Authentication required.", code: "REAUTH_REQUIRED" }`) — by design, no info disclosure. The frontend's existing 401 handler in `kinetica_bi/src/api/client.ts:7-10` already dispatches `UNAUTHORIZED_EVENT` on every 401; the `code` field is forward-compat for Phase 3 three-way dispatch.

### Example 6: `index.ts` route wiring (login / logout / me)

```typescript
// kinetica_bi/server/src/index.ts (excerpt — replaces lines 67-98)
import { createSession, deleteSession } from "./sessionStore";
import {
  loadSessionForRequest,
  decodeAndVerifyJwt,
  issueSessionCookie,
  clearSessionCookie,
  verifyKineticaCredentials,
  requireAuth,
} from "./auth";

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
  if (!username || !password) {
    return res.status(400).json({ error: "username and password are required." });
  }
  const result = await verifyKineticaCredentials(username, password);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.message });
  }
  let sid: string;
  try {
    sid = createSession(username, password, process.env.KINETICA_URL!);
    issueSessionCookie(res, username, sid);
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
  return res.json({ user: { username } });
});

app.post("/api/auth/logout", (req, res) => {
  // Best-effort: extract sid even if cookie is malformed; idempotent delete
  const decoded = decodeAndVerifyJwt(req);
  if (decoded?.sid) {
    try { deleteSession(decoded.sid); } catch { /* swallow */ }
  }
  clearSessionCookie(res);
  return res.status(204).send();
});

app.get("/api/auth/me", (req, res) => {
  // MIGRATION: was readSession(req)-only; now requires session row to exist
  const loaded = loadSessionForRequest(req);
  if (!loaded) {
    clearSessionCookie(res);
    return res.status(401).json({ error: "Not authenticated.", code: "REAUTH_REQUIRED" });
  }
  return res.json({ user: { username: loaded.session.username } });
});
```

### Example 7: Boot wiring + `.env.example`

```typescript
// kinetica_bi/server/src/index.ts (excerpt — additions near app.listen)
import { startSessionSweep } from "./sessionStore";

app.listen(port, () => {
  console.log(`Kinetica BI backend running on http://localhost:${port}`);
});

// Kick off the GC sweep AFTER listen so any startup error in sessionStore
// surfaces before we accept traffic. The .unref() on the handle keeps test
// processes able to exit cleanly.
startSessionSweep();
```

```bash
# kinetica_bi/server/.env.example (additions)

# 32 bytes (64 hex chars) used to encrypt session passwords at rest.
# Independent from AUTH_SECRET. Rotation forces all users to re-login.
# Generate with: openssl rand -hex 32
SESSION_ENCRYPTION_KEY=replace-me-with-64-hex-chars-from-openssl-rand-hex-32
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `aes-256-cbc` + manual HMAC (Encrypt-then-MAC) | `aes-256-gcm` (AEAD, single primitive) | Node ≥ 12 stable; mainstream guidance OWASP 2018+ | One primitive replaces two; eliminates EtM ordering bugs and padding oracles |
| Self-rolled session middleware | Server-side encrypted row + JWT pointer | OWASP Session Management Cheat Sheet (2020+) | Server-side revocation + cookie carries no creds |
| 16-byte random IV for GCM | **12-byte** IV for GCM | NIST SP 800-38D recommendation | 12 bytes is the GCM-optimal nonce length (96 bits) — 16 bytes triggers an internal IV-derivation step that weakens the security bound |
| `Date.now() + TTL_MS` math in Node | SQLite `datetime('now', '+8 hours')` | TZ-bug literature 2010s+ | Same time source on INSERT and comparison; immune to host TZ drift |
| `sessionId = hash(username + timestamp)` | `crypto.randomBytes(32).toString("hex")` | Always (cryptographic best practice) | Unpredictable, collision-resistant, guess-resistant |
| JWT with embedded creds (signed-only) | JWT pointer + server-side encrypted row | OWASP JWT cheat sheet 2020+ / RFC 7515 awareness | Cookie carries no secret; signed JWS payloads are base64url plaintext |

**Deprecated/outdated for this stack:**
- `aes-256-cbc` — replaced by GCM throughout; no remaining reason in 2026.
- `crypto.createCipher(algorithm, password)` (the password-based variant) — deprecated in Node 10+; uses MD5 derivation. We use the explicit-IV variant `createCipheriv` exclusively.
- `Date.parse(...)` for SQLite datetime strings — works but is brittle; use `datetime('now')` on the SQL side and never round-trip through JS Date for comparisons.

## Open Questions

1. **Should the boot script do a smoke-test encrypt/decrypt at startup?**
   - What we know: `getSessionEncryptionKey()` validates length and hex; doesn't validate the key is functional.
   - What's unclear: A pathological case where the key is 64 valid hex chars but `createCipheriv` throws (extremely unlikely on modern Node — would only happen if FIPS mode is on and AES-256 is somehow disabled).
   - Recommendation: **Skip.** Over-engineering. The first login attempt will exercise the key; failure surfaces clearly. If ops asks for a `npm run check-env` script later, add it as a Phase 1 deliverable.

2. **Should `getSession` return a typed "expired" outcome vs. just `null`?**
   - What we know: `null` means "not authenticated, return 401." The caller doesn't currently care WHY.
   - What's unclear: Phase 3's audit logging may want to distinguish "expired" vs "missing" vs "tag mismatch" for ops dashboards.
   - Recommendation: Phase 1 returns `null`. If Phase 3 needs structured outcomes, introduce a discriminated union then. **Don't pre-build.**

3. **Does the sweep need to log even if it deleted 0 rows?**
   - What we know: One log line per hour with the count is small.
   - What's unclear: 24 lines/day of "swept 0 expired rows" might be considered noise.
   - Recommendation: Always log; it's also the "sweep is alive" heartbeat. Operators turning off "noisy" logs is a known anti-pattern. Keep.

## Validation Architecture

> Included because `workflow.nyquist_validation === true` in `.planning/config.json`.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | **None currently installed.** Existing repo (`kinetica_bi/server/package.json`) has no test runner. Wave 0 must add one. |
| Recommended framework | `vitest@latest` (fast, native ESM, native TS via tsx-style transform; works with `"type": "module"` in package.json without ts-jest config) |
| Config file | `vitest.config.ts` at `kinetica_bi/server/vitest.config.ts` (Wave 0 creates) |
| Quick run command (per task commit) | `cd kinetica_bi/server && npm test -- --run tests/sessionStore.spec.ts` (replace path per task) |
| Full suite command (per wave merge) | `cd kinetica_bi/server && npm test -- --run` |
| Phase gate | Full suite green + manual sqlite3-CLI verification (criterion 1, 3 from ROADMAP.md) |

**Why vitest, not jest:** Repo is `"type": "module"` ESM with `tsx`-driven dev. Vitest's ESM-first design avoids `ts-jest` ESM config friction. Adoption is one `npm install -D vitest` + 8-line `vitest.config.ts`.

**Wave 0 install command:**
```bash
cd kinetica_bi/server && npm install --save-dev vitest @types/node
```

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| **SESS-01** | Round-trip encrypt/decrypt password under AES-256-GCM | unit (property) | `cd kinetica_bi/server && npm test -- --run tests/sessionStore.crypto.spec.ts` | ❌ Wave 0 |
| **SESS-01** | Tamper any byte of ciphertext/iv/auth_tag → decrypt throws → callers treat as 401 | unit | `cd kinetica_bi/server && npm test -- --run tests/sessionStore.crypto.spec.ts -t "tamper"` | ❌ Wave 0 |
| **SESS-01** | Cookie payload is `{ sub, sid, v: 1 }` after login (decoded server-side); contains NO `password` substring | unit | `cd kinetica_bi/server && npm test -- --run tests/auth.cookie.spec.ts` | ❌ Wave 0 |
| **SESS-01** | sessions row written: BLOB columns are non-empty Buffers; ciphertext != plaintext bytes | integration (in-memory better-sqlite3) | `cd kinetica_bi/server && npm test -- --run tests/sessionStore.crud.spec.ts` | ❌ Wave 0 |
| **SESS-02** | Decoded JWT does NOT contain "password" key or any value matching the original password (string-search the decoded payload) | unit | `cd kinetica_bi/server && npm test -- --run tests/auth.cookie.spec.ts -t "no password in JWT"` | ❌ Wave 0 |
| **SESS-02** | sid in JWT is opaque (matches `/^[0-9a-f]{64}$/`), never derived from username | unit | `cd kinetica_bi/server && npm test -- --run tests/auth.cookie.spec.ts -t "opaque sid"` | ❌ Wave 0 |
| **SESS-03** | `POST /api/auth/logout` removes the row; replaying old cookie → 401 + `code: REAUTH_REQUIRED` | integration (supertest) | `cd kinetica_bi/server && npm test -- --run tests/auth.routes.spec.ts -t "logout deletes row"` | ❌ Wave 0 |
| **SESS-03** | Logout with malformed cookie still clears cookie + 204 (no crash) | integration | `cd kinetica_bi/server && npm test -- --run tests/auth.routes.spec.ts -t "logout best-effort"` | ❌ Wave 0 |
| **SESS-03** | `GET /api/auth/me` returns 401 after row deleted out-of-band (sqlite3 DELETE) | integration | `cd kinetica_bi/server && npm test -- --run tests/auth.routes.spec.ts -t "me after delete"` | ❌ Wave 0 |
| **SESS-04** | Row INSERTed with `expires_at = datetime('now', '+8 hours')` (within ±1 minute of expected) | integration | `cd kinetica_bi/server && npm test -- --run tests/sessionStore.crud.spec.ts -t "8h TTL"` | ❌ Wave 0 |
| **SESS-04** | `requireAuth` does NOT update `expires_at` on touch (only `last_used_at`) | integration | `cd kinetica_bi/server && npm test -- --run tests/sessionStore.crud.spec.ts -t "no sliding"` | ❌ Wave 0 |
| **SESS-05** | `sweepExpiredSessions()` deletes rows with `expires_at <= datetime('now')`; returns count | unit | `cd kinetica_bi/server && npm test -- --run tests/sessionStore.crud.spec.ts -t "sweep"` | ❌ Wave 0 |
| **SESS-05** | Passive expiry: `getSession` on an expired row returns null AND deletes the row | unit | `cd kinetica_bi/server && npm test -- --run tests/sessionStore.crud.spec.ts -t "passive expiry"` | ❌ Wave 0 |
| **SESS-05** | `setInterval` started by `startSessionSweep` calls `sweepExpiredSessions` on tick (use vi.useFakeTimers) | unit | `cd kinetica_bi/server && npm test -- --run tests/sessionStore.sweep.spec.ts` | ❌ Wave 0 |
| **SESS-05** | Sweep's try/catch keeps timer alive even if sweep throws | unit | `cd kinetica_bi/server && npm test -- --run tests/sessionStore.sweep.spec.ts -t "resilient"` | ❌ Wave 0 |
| **(architectural)** | `requireAuth` fails on missing `v`, wrong `v`, missing `sid`, deleted row, expired row, kinetica_url mismatch, decrypt failure — each → 401 + `REAUTH_REQUIRED` | integration (table-driven) | `cd kinetica_bi/server && npm test -- --run tests/auth.requireAuth.spec.ts` | ❌ Wave 0 |
| **(boot)** | Server fails to start with missing/invalid `SESSION_ENCRYPTION_KEY` | unit | `cd kinetica_bi/server && npm test -- --run tests/sessionStore.boot.spec.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** Quick run for the spec(s) the task touched, e.g., `npm test -- --run tests/sessionStore.crypto.spec.ts`.
- **Per wave merge:** Full suite — `cd kinetica_bi/server && npm test -- --run`.
- **Phase gate:** Full suite green AND manual SESS-01..05 acceptance per ROADMAP.md (sqlite3 query against `kinetica.db`, JWT base64-decode check) before `/gsd:verify-work`.

### Wave 0 Gaps

- [ ] `kinetica_bi/server/package.json` — add `vitest` to devDependencies; add `"test": "vitest"` script. Install command: `cd kinetica_bi/server && npm install --save-dev vitest @types/node supertest @types/supertest`.
- [ ] `kinetica_bi/server/vitest.config.ts` — vitest config (test glob `tests/**/*.spec.ts`; environment `node`; isolate per file).
- [ ] `kinetica_bi/server/tests/conftest.ts` (or `tests/setup.ts`) — shared fixtures: in-memory better-sqlite3 (`new Database(':memory:')`) with the same DDL block as `db.ts`; ephemeral `SESSION_ENCRYPTION_KEY` set in env before each suite.
- [ ] `kinetica_bi/server/tests/helpers/db.ts` — helper to spin up an isolated `Database` per test, run the boot DDL, and inject it into `sessionStore`/`db`. Requires `db.ts` to be refactored to support an injectable DB or expose a `setDatabaseForTesting` helper. (Alternative: the planner can choose to make `sessionStore.ts` accept a `Database` arg; cleaner but bigger refactor.)
- [ ] `kinetica_bi/server/tests/helpers/app.ts` — helper to construct a fresh `app` instance per test for supertest. Requires `index.ts` to be refactored so route registration is an exported function `createApp()` that takes the DB. (Alternative: a smaller refactor exporting just `app` and using a beforeEach hook.)
- [ ] `kinetica_bi/server/tests/sessionStore.crypto.spec.ts` — covers SESS-01 round-trip + tamper.
- [ ] `kinetica_bi/server/tests/sessionStore.crud.spec.ts` — covers SESS-04, SESS-05 CRUD + passive expiry + 8h TTL.
- [ ] `kinetica_bi/server/tests/sessionStore.sweep.spec.ts` — covers SESS-05 setInterval + resilience to thrown errors.
- [ ] `kinetica_bi/server/tests/sessionStore.boot.spec.ts` — covers SESSION_ENCRYPTION_KEY validation.
- [ ] `kinetica_bi/server/tests/auth.cookie.spec.ts` — covers SESS-02 cookie shape + opaque sid + no-password-in-payload.
- [ ] `kinetica_bi/server/tests/auth.routes.spec.ts` — supertest covering SESS-03 logout-replay + me-after-delete.
- [ ] `kinetica_bi/server/tests/auth.requireAuth.spec.ts` — table-driven failure-mode coverage for requireAuth (steps 1-9 in Example 5).

**Important note for the planner about the Wave 0 refactor scope:** The current `db.ts` instantiates a `Database` at module load (line 14) reading from `process.env.DB_PATH`. To make the integration tests injectable without monkey-patching `process.env` in every suite, the planner has two clean options:
1. Export a factory: `db.ts` becomes `createDb(path)` returning the DDL-applied `Database`; module top-level just calls it with `process.env.DB_PATH`. `sessionStore.ts` likewise becomes `createSessionStore(db)` returning `{ createSession, getSession, ... }`. The current `app` imports the singleton; tests construct a new one. Cleaner, slightly bigger Wave 0.
2. Keep the module-singleton pattern; tests set `process.env.DB_PATH = ":memory:"` before requiring `db.ts` in a fresh `vi.resetModules()` cycle. Smaller Wave 0; uglier test setup.

Recommendation: **option 1** — the refactor cost is small (~20 lines) and pays off again when Phase 2's `kineticaCall` helper wants to be unit-tested in isolation.

## Sources

### Primary (HIGH confidence)

- **Live runtime verification (Node 24.14.1, this checkout):**
  - AES-256-GCM `createCipheriv`/`createDecipheriv` round-trip; CT len 21 / IV len 12 / tag len 16 for 7-byte plaintext "hunter2"; bad-tag throws "Unsupported state or unable to authenticate data" with `name: "Error"`.
  - `crypto.randomBytes(32).toString("hex").length === 64`.
  - `crypto.randomUUID()` returns 36-char dashed string.
  - `setInterval(...).unref` is a function and unblocks process exit.
  - `jsonwebtoken@9.0.3`: `jwt.sign({ sub: 'alice', sid: 'abc', v: 1 }, ...)` and `jwt.verify(...)` round-trip; old-shape `{ sub: 'alice' }` decodes with `decoded.v === undefined` (so `decoded.v !== 1` is true → 401 path).
  - `better-sqlite3@12.9.0` (in this checkout): Buffer round-trips through BLOB column unchanged (`Buffer.compare === 0`); booleans rejected with clear error; `datetime('now')` comparison correctly identifies expired rows; `DELETE WHERE expires_at <= datetime('now')` returns `result.changes` count.

- **Existing repo files (read directly):**
  - `kinetica_bi/server/src/auth.ts` (whole file — current `SessionPayload`, `getSecret`, `verifyKineticaCredentials`, cookie config)
  - `kinetica_bi/server/src/db.ts` (whole file — DDL block at lines 18-66, journal_mode = WAL at line 16)
  - `kinetica_bi/server/src/index.ts` (whole file — login/logout/me at lines 67-98, requireAuth mount at line 101, 5 Kinetica call sites at 249/319/401/433)
  - `kinetica_bi/server/.env.example` (current vars)
  - `kinetica_bi/server/package.json` (Node version requirement, dep pins; `"type": "module"`)

- **Milestone-level research files:**
  - `.planning/research/SUMMARY.md` (HIGH — versions verified live 2026-04-27)
  - `.planning/research/STACK.md` (HIGH — npm view live 2026-04-27)
  - `.planning/research/ARCHITECTURE.md` (HIGH — every line/route directly inspected)
  - `.planning/research/PITFALLS.md` (HIGH — pitfalls 1, 2, 3, 5, 6, 13, 19, 23 directly relevant to Phase 1)

- **npm registry (live `npm view` 2026-04-27):**
  - `jsonwebtoken@9.0.3` published 2026-04-16T21:47:09.341Z — current
  - `better-sqlite3@12.9.0` published 2026-04-12T18:23:42.645Z — current major

### Secondary (MEDIUM confidence)

- Kinetica documentation pages (WebFetch 2026-04-27):
  - [Kinetica REST API endpoint catalog (7.1)](https://docs.kinetica.com/7.1/api/rest/) — verified no token endpoint
  - [Kinetica Security Configuration (7.2)](https://docs.kinetica.com/7.2/security/sec_configuration/) — verified Basic auth + LDAP/AD/Kerberos via HTTPD proxy as only auth mechanisms
  - [Kinetica Security Configuration (7.1)](https://docs.kinetica.com/7.1/security/shared/ex_auth_config/) — confirms HTTPD proxy pattern
  - [Kinetica JavaScript API GitHub](https://github.com/kineticadb/kinetica-api-javascript) — README references credentials; no token-exchange flow

- Node.js [`node:crypto` documentation](https://nodejs.org/api/crypto.html) — AES-256-GCM API surface; `createCipheriv`/`createDecipheriv` semantics; `setAuthTag` ordering rule.

- OWASP Cryptographic Storage Cheat Sheet — AEAD-only recommendation; key separation principle.

- NIST SP 800-38D — 12-byte (96-bit) GCM nonce optimal length; longer IVs trigger internal derivation that weakens the security bound.

### Tertiary (LOW confidence — flagged)

- General Kinetica `oauth_token` parameter mentions surfaced via WebSearch — interpretation: server-side IdP integration via HTTPD proxy, NOT a client token-exchange flow. **Not relevant to Phase 1 design.** Re-evaluate only if Kinetica adds an OAuth/JWT issuer in a future release.

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — every package version verified via live `npm view` 2026-04-27 and runtime check on Node 24.14.1; `node:crypto` AES-256-GCM round-trip + tamper detection verified live in this checkout.
- Architecture: **HIGH** — module layout follows existing conventions; every file/line referenced directly inspected; CONTEXT.md decisions are locked.
- Pitfalls: **HIGH** — drawn from milestone PITFALLS.md (which cites concrete repo lines); Phase-1-specific pitfalls (P1 setAuthTag ordering, P4 v-undefined behavior, P6 sweep resilience) verified live on Node 24.14.1.
- Token-exchange spike: **HIGH (NEGATIVE)** — three independent Kinetica documentation sources confirm no token endpoint; existing repo behavior consistent with HTTP Basic Auth being the only mechanism.
- Validation Architecture: **MEDIUM-HIGH** — vitest is the obvious choice for an ESM `"type": "module"` repo, but the Wave 0 testability refactor (db/sessionStore as factories) has design freedom. The planner may choose option 2 (env-var-based) instead; both are valid.

**Research date:** 2026-04-27
**Valid until:** 2026-05-27 (30 days — `node:crypto` and AES-GCM are stable; Kinetica's auth surface is unlikely to grow a token endpoint in 30 days)
