# Phase 1: Encrypted server-side session store - Context

**Gathered:** 2026-04-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Persist the BI user's Kinetica password between requests in an encrypted SQLite session row keyed by an opaque `sid`. After login, `requireAuth` decrypts the row and attaches `req.user.creds` so downstream code can use it. The JWT cookie carries only `{ sub, sid, v: 1 }` — no credential material. Logout destroys the row. Expired rows are GC'd. Nothing user-visible changes in this phase: `/api/sql`, `/api/wms`, `/api/views/:id/materialize`, and the schema/table/column discovery routes still authenticate to Kinetica with the shared admin env creds. Refactoring those call sites is Phase 2.

</domain>

<decisions>
## Implementation Decisions

### Encryption — algorithm and parameters

- AES-256-GCM via Node's built-in `node:crypto` (no new npm dependency).
- Fresh 12-byte IV per row, 16-byte auth tag stored alongside ciphertext.
- Plaintext input is the user's Kinetica password (UTF-8 bytes); username is stored unencrypted in a separate column for query/auditability.

### Encryption-key sourcing

- New env var: `SESSION_ENCRYPTION_KEY`.
- Format: 64-char hex string (32 raw bytes after decoding). Generate with `openssl rand -hex 32` — matches the existing `AUTH_SECRET` pattern documented in `.env.example`.
- Boot-time validation: fail-fast at server startup if the var is missing, not exactly 64 hex chars, or contains non-hex characters. Mirrors the existing `getSecret()` pattern in `auth.ts:14-20`. No silent fallback to HKDF-from-`AUTH_SECRET`.
- Independent rotation from `AUTH_SECRET` — separation of concerns (signing key vs. encryption key).
- Single key only in v1.0. No previous-key fallback / overlap window. Rotation = set new value, restart server, all session rows become undecryptable, all users re-login on next request. Documented in deploy runbook.

### `sessions` table schema (added to `db.ts` boot DDL)

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

- `sid` is an opaque random ≥ 128-bit identifier (planner picks the exact mechanism — `crypto.randomBytes(32).toString("hex")` is acceptable). Never derived from username; collision-resistant against guessing.
- BLOB columns over base64 TEXT (smaller rows, zero-copy with better-sqlite3's Buffer binding).
- `kinetica_url` is stamped at login from the live `KINETICA_URL` env var. `requireAuth` compares the stored value to the current env value; mismatch returns 401 with `code: "REAUTH_REQUIRED"`. Defends against the operator-changed-KINETICA_URL-mid-session scenario.
- `last_used_at` stamped on every `requireAuth` pass with `UPDATE sessions SET last_used_at = datetime('now') WHERE sid = ?`. Useful for diagnostics and unblocks v2 sliding-window TTL without a future schema migration.
- `expires_at` set at login as `datetime('now', '+8 hours')` (UTC). TTL is fixed at 8h per SESS-04 — no extension.
- All timestamps stored as UTC strings; comparisons use `datetime('now')` consistently to avoid the timezone pitfall flagged in PITFALLS.md (Pitfall 19).

### JWT payload migration

- New shape: `{ sub: string, sid: string, v: 1, iat, exp }`.
- `requireAuth` rejects any decoded payload where `v !== 1` (or where `sid` is missing/empty) by returning 401 with `code: "REAUTH_REQUIRED"`. Same dispatch path as expired-row case.
- Old cookies issued before this milestone (`{ sub }` only) will fail this check on first use post-deploy and the user re-logs in. No `AUTH_SECRET` rotation required.
- The `code: "REAUTH_REQUIRED"` field is introduced one phase early (it's officially a Phase 3 / UX-03 deliverable). Phase 1 only emits it for the version-mismatch / row-missing cases. Phase 3 will expand its usage to mid-session Kinetica-auth-failure cases. Frontend behavior is unchanged in Phase 1 — the existing 401 → `UNAUTHORIZED_EVENT` → `markUnauthenticated` flow handles the response code-agnostically.

### Session lifecycle

- **Login (`POST /api/auth/login`)**: validate creds against Kinetica (existing flow), generate `sid`, encrypt password, INSERT row, `issueSessionCookie` with `{ sub, sid, v: 1 }`.
- **`requireAuth` middleware**: read JWT from cookie → verify signature → check `v === 1` → SELECT session row → check not expired (`expires_at > datetime('now')`) → check `kinetica_url === process.env.KINETICA_URL` → decrypt ciphertext → attach `req.user = { sub, creds: { username, password } }` → UPDATE `last_used_at`. Any failure returns 401 + `{ error, code: "REAUTH_REQUIRED" }`.
- **Logout (`POST /api/auth/logout`)**: read sid from JWT (best-effort — don't fail if absent), `DELETE FROM sessions WHERE sid = ?`, clear cookie. Single device only. "Sign out everywhere" deferred to v2 (`AUTH-V2-07`).
- **`/api/auth/me`**: must be moved behind the same row-existence check — currently bypasses `requireAuth` (`index.ts:84-88`). After this phase, `/me` returns 401 if the row is missing/expired even if the cookie signature is valid. Closes the migration trap flagged in PITFALLS.md (Pitfall 13) and ARCHITECTURE.md §"Anti-Patterns."
- **Passive expiry-on-access**: any `requireAuth` lookup that finds an expired row also DELETEs it inline before returning 401. Cheap, deterministic.

### Session GC (scheduled sweep)

- `setInterval` in-process, every 1 hour. Started once at server boot.
- Statement: `DELETE FROM sessions WHERE expires_at <= datetime('now')`.
- Logs one line per sweep with rows deleted.
- Sweep is a belt-and-suspenders complement to passive expiry — together they satisfy SESS-05 ("never grows past active count") even for users who never come back to trigger passive cleanup.
- No external scheduler, no separate process.

### Deployment / migration

- Brief deploy-runbook note included in phase deliverables: "On deploy, all currently logged-in users will be redirected to the login screen on their next API call. This is expected — old session cookies do not carry the new `sid` field. No data is lost."
- No `AUTH_SECRET` rotation required (the version field handles it).
- `SESSION_ENCRYPTION_KEY` must be present in production env before deploy, or the server refuses to start.
- `.env.example` updated to document the new var and its generation command.

### Claude's Discretion

- Exact module layout (e.g., new `sessionStore.ts` vs adding to `auth.ts` vs adding to `db.ts`). Architecture research suggested `sessionStore.ts`; planner can choose.
- `sid` generation primitive (`crypto.randomBytes(32).toString("hex")` vs `crypto.randomUUID()` — either is fine for 128+ bits of entropy).
- Whether to expose `lastUsedAt` / `createdAt` on the `req.user` object (probably not — keep `req.user` minimal: `{ sub, creds }`).
- Which boot-time error message to print when `SESSION_ENCRYPTION_KEY` is missing (just be clear about the fix: "Generate with `openssl rand -hex 32`").
- Sweep log format (single human-readable line is fine; structured logging is out of scope).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone-level research
- `.planning/research/SUMMARY.md` §"Implications for Roadmap" → Phase 1; §"Key Findings" → Recommended Stack, Architecture Approach
- `.planning/research/STACK.md` §"Recommendation Summary"; §"Recommended sessions table shape"
- `.planning/research/ARCHITECTURE.md` §1 "Recommended Architecture"; §2 "Credential-Storage Approach: JWE vs Server-Session"; §6 Phase 1 description; §"Anti-Patterns" (`/api/auth/me` migration trap)
- `.planning/research/PITFALLS.md` Pitfalls 1, 2, 3, 4, 6, 13, 19, 23

### Project-level
- `.planning/PROJECT.md` (Current Milestone, Constraints, Key Decisions)
- `.planning/REQUIREMENTS.md` SESS-01..05 (this phase's requirements)
- `.planning/STATE.md` (Pre-Phase-1 Open Questions section)
- `.planning/ROADMAP.md` Phase 1 success criteria

### Existing code (anchors for the refactor)
- `kinetica_bi/server/src/auth.ts` (whole file — `SessionPayload`, `getSecret`, `verifyKineticaCredentials`, `issueSessionCookie`, `clearSessionCookie`, `readSession`, `requireAuth`)
- `kinetica_bi/server/src/db.ts` (whole file — DDL block at lines 18-66 is where the `sessions` table is added)
- `kinetica_bi/server/src/index.ts` lines 67-92 (login/logout/me routes — login and logout get session-store wiring; `/me` migrates to row-existence check)
- `kinetica_bi/server/.env.example` (gets new `SESSION_ENCRYPTION_KEY` line)
- `kinetica_bi/src/api/client.ts` lines 5-11 (`UNAUTHORIZED_EVENT`; no change in this phase, but planner should confirm the existing 401 dispatch handles version-mismatch responses)
- `kinetica_bi/src/store/auth.ts` (no change in this phase)

### External / spec
- Node.js `node:crypto` — `createCipheriv`, `createDecipheriv`, `randomBytes` for AES-256-GCM (Node 24.14.1 verified in STACK.md).
- RFC 7515 (JWS) — for the version-field migration (referenced in SUMMARY.md to justify why JWS-with-creds is rejected; here only the version-field handling matters).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`getSecret()` pattern in `auth.ts:14-20`**: throws if env var missing or under threshold. Reuse this exact shape for `getSessionEncryptionKey()` (validate 64 hex chars, decode to 32 raw bytes, throw clear error).
- **`better-sqlite3` boot DDL block in `db.ts:18-66`**: idempotent `CREATE TABLE IF NOT EXISTS`, executed once at module load. The `sessions` table joins this block.
- **`db.prepare(...).run(...)` and `.get(...)` patterns throughout `db.ts`**: synchronous statements with named parameters. Sessions store follows this style (no async/Promise wrapping).
- **`UNAUTHORIZED_EVENT` plumbing in `client.ts:5-11` and `App.tsx:24-28`**: already dispatches on any 401, regardless of body shape. Phase 1's new 401 responses with `code: "REAUTH_REQUIRED"` slot in transparently — no frontend change required this phase.

### Established Patterns
- **Synchronous SQLite with WAL** (`db.ts:14-16`). No connection pool, no async. Sessions store stays synchronous to match.
- **No logging library** — `console.log`/`console.error` only. Sweep emits a single `console.log("[sessions] swept N expired rows")` line per tick.
- **Generic error responses** (e.g., `auth.ts:95-103` `requireAuth`): `{ error: "Authentication required." }` — vague by design. New responses follow: `{ error: "Authentication required.", code: "REAUTH_REQUIRED" }` — code field added, no Kinetica-internal detail leaked.
- **Cookie config in `auth.ts:73-80`**: `httpOnly: true`, `sameSite: "lax"`, `secure: process.env.NODE_ENV === "production"`. New cookies (with the larger `{ sub, sid, v: 1 }` payload) keep these flags identical.

### Integration Points
- **`auth.ts:1-103`** — `SessionPayload` type widens to `{ sub, sid, v: 1 }`; `issueSessionCookie` takes `(res, username, sid)` and writes the v field; `readSession` rejects `v !== 1`; `requireAuth` adds the row lookup + decrypt + last_used_at update + kinetica_url match check.
- **`db.ts:18-66`** — append the `sessions` DDL inside the existing `db.exec(...)` block.
- **`db.ts` (new section)** — add `createSession`, `getSession`, `deleteSession`, `deleteSessionsForUser`, `sweepExpiredSessions` matching existing CRUD style. (Or factor into a sibling `sessionStore.ts` — Claude's discretion.)
- **`index.ts:67-92`** — login route writes the session row; logout reads sid from cookie and deletes; `/me` adopts the same lookup as `requireAuth`.
- **`index.ts` (new at startup)** — kick off the 1h sweep `setInterval` after `app.listen()`.
- **`.env.example`** — append `SESSION_ENCRYPTION_KEY=<64-char hex>` with a comment showing the openssl command.

</code_context>

<specifics>
## Specific Ideas

- **Match the existing `AUTH_SECRET` developer experience.** Same hex format, same generation command (`openssl rand -hex 32`), same fail-fast boot pattern. Cognitive load = zero.
- **Move `/api/auth/me` behind the same row-existence check as `requireAuth`.** It's a small change but it's the difference between "logged in" being a real fact and being a guess based on cookie signature alone. Architecture and Pitfalls both flagged this as the migration trap.
- **The 30-min Kinetica token-exchange spike at Phase 1 kickoff** (flagged in STATE.md and ROADMAP.md) MUST run BEFORE locking the password-encryption design. If Kinetica exposes a short-lived token endpoint, the encrypted payload becomes the token (and possibly a refresh token), not the password. Use `mcp__plugin_context7_context7__resolve-library-id` + `query-docs` to check Kinetica's REST auth surface. Document outcome in PROJECT.md key decisions before any code lands. If no token endpoint exists (most likely outcome based on Kinetica's design), proceed with password encryption as planned.
- **`KINETICA_URL` mismatch defense.** This is operationally cheap (one TEXT column, one string compare per requireAuth) and stops a real ops mistake (operator changes KINETICA_URL while users have live sessions, downstream calls now go to a different cluster with the wrong creds). Worth the extra column.

</specifics>

<deferred>
## Deferred Ideas

- **"Sign out everywhere" button** — captured as `AUTH-V2-07` in REQUIREMENTS.md.
- **Sliding-window TTL / session refresh** — captured as `AUTH-V2-06`. The `last_used_at` column we're adding now is the schema enabler; v2 just needs to extend `expires_at` on each touch.
- **IP / User-Agent binding** — explicitly considered and rejected for this milestone (causes spurious logouts for VPN/mobile users; cookie flags are the right primary defense). Not captured as a v2 requirement; revisit only if a session-theft incident motivates it.
- **Previous-key fallback for SESSION_ENCRYPTION_KEY rotation** — explicitly rejected for v1.0 (not worth the complexity at this team's scale). If the team's risk posture changes, would become a small future phase.
- **Audit log of session creation/deletion** — the milestone has OBS-01 (per-Kinetica-call audit log) in Phase 2. A separate session-lifecycle audit stream is not currently captured anywhere; defer until there's a concrete need.

</deferred>

---

*Phase: 01-encrypted-server-side-session-store*
*Context gathered: 2026-04-27*
