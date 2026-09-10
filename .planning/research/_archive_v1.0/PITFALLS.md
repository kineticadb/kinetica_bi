# Pitfalls Research

**Domain:** Adding per-user credential passthrough to an existing Express + React BI proxy
**Researched:** 2026-04-27
**Confidence:** HIGH (most pitfalls verified against the actual codebase at `kinetica_bi/server/src/auth.ts`, `kinetica_bi/server/src/index.ts`, `kinetica_bi/src/api/client.ts`, `kinetica_bi/src/App.tsx`)

This file is scoped to the v1.0 milestone: persisting the BI user's Kinetica credentials between requests, replaying them on every downstream gpudb call (SQL proxy, schema/table/column discovery, view materialize, WMS proxy), removing the shared admin env credentials, and surfacing mid-session Kinetica auth failures as a clean re-login.

Every pitfall references concrete files/lines or named env vars from the actual repo. Phase numbers refer to the upcoming milestone roadmap (Phase 1 = credential storage primitive, Phase 2 = login/session wiring, Phase 3 = downstream call refactor, Phase 4 = mid-session auth failure UX, Phase 5 = remove admin env, Phase 6 = ops hardening).

---

## Critical Pitfalls

### Pitfall 1: Plaintext password in JWT payload signed with HS256

**What goes wrong:**
The path of least resistance is to extend `SessionPayload` in `server/src/auth.ts:7-9` from `{ sub: username }` to `{ sub: username, password: <plaintext> }` and reuse `jwt.sign` with `AUTH_SECRET`. JWT HS256 is **signed, not encrypted** — the payload is base64url-encoded plaintext. Anyone who acquires the cookie value can paste it into jwt.io and read the password.

**Why it happens:**
- `httpOnly: true` on the cookie (auth.ts:73) gives a false sense of security. httpOnly only blocks `document.cookie` JS reads; it does not protect against:
  - Cookie exfil via server-side log files (e.g., reverse-proxy access logs that include `Cookie:` header)
  - Malicious browser extensions (which run with full network access on the page)
  - Backup snapshots of the SQLite/session store
  - Any future logging middleware (e.g., morgan with custom format) that prints headers
  - A developer accidentally `console.log(req.headers.cookie)` while debugging
- HS256 is the default for `jsonwebtoken` and the existing code already uses it — easy to extend without thinking.

**How to avoid:**
- Do NOT put the password (or anything derived from it that's reversible) in the JWT payload.
- Two acceptable architectures:
  1. **Server-side session store (recommended for this app):** JWT carries only `sub` + opaque `session_id`. Credentials live in a SQLite `sessions` table, AES-256-GCM-encrypted at rest with a key separate from `AUTH_SECRET`.
  2. **Encrypted JWE (JSON Web Encryption):** Use `jose`'s `EncryptJWT` with `dir`+`A256GCM` or `A256KW`+`A256GCM`. Note: still leaks IV/ciphertext length and increases cookie size; SQLite-backed session is simpler and matches the existing SQLite persistence pattern in `server/src/db.ts`.
- If the SQLite session store wins (it should), make the cookie value an opaque random ID (32+ bytes from `crypto.randomBytes`) — there is no reason for the cookie itself to be a JWT once you have a server-side store.

**Warning signs:**
- The string "password" appears as a key in `SessionPayload`.
- A teammate says "JWT is signed, that's enough."
- Any code path encodes the password into something stored in `res.cookie`.
- `jwt.decode(cookie)` (no verify) in dev tools reveals readable creds.

**Phase to address:**
Phase 1 (credential storage primitive) — must be the first decision; everything downstream depends on it.

---

### Pitfall 2: Encryption key derived from or equal to `AUTH_SECRET`

**What goes wrong:**
After deciding to encrypt credentials, the natural shortcut is `const key = crypto.createHash("sha256").update(process.env.AUTH_SECRET).digest()` (or worse, `Buffer.from(AUTH_SECRET)` truncated/padded). This conflates two distinct keys:
1. The HMAC key used to sign JWTs (low-entropy tolerant; only protects integrity)
2. The encryption key used to wrap credentials (high-entropy required; compromise = plaintext recovery)

If `AUTH_SECRET` ever leaks via stack trace, error message, env dump, CI log, or developer commit, both auth and credential confidentiality fail simultaneously. The 16-character minimum enforced at `auth.ts:16` is fine for HMAC but inadequate (~100 bits worst case if ASCII-printable, much less if a person picked it) as a key derivation seed for AEAD.

**Why it happens:**
- One env var feels simpler than two.
- Reuse of an existing secret avoids rotating ops runbooks.
- Developers conflate "signed" and "encrypted."

**How to avoid:**
- Introduce a **separate** env var, e.g., `SESSION_ENCRYPTION_KEY`, validated as exactly 32 bytes (base64-decoded) at startup; refuse to boot if missing or wrong length. Mirror the existing `getSecret()` pattern in `auth.ts:13-19`.
- If you must derive from a passphrase, use `crypto.scryptSync(passphrase, salt, 32)` with a static-but-app-unique salt and document that rotating the passphrase invalidates all sessions.
- Use AES-256-GCM (or `crypto.createCipheriv("aes-256-gcm")`); never CBC. GCM is authenticated, so it doubles as integrity protection (no separate HMAC needed).
- Generate a fresh random IV per record; store IV + ciphertext + auth tag together (e.g., `base64(iv) || ":" || base64(ciphertext) || ":" || base64(tag)`). Never reuse an IV with the same key.

**Warning signs:**
- Any code references `AUTH_SECRET` inside crypto-key derivation.
- Single env var named "secret" doing double duty.
- `createCipheriv("aes-256-cbc", ...)` with a separate `createHmac(...)` (you've reinvented EtM badly — use GCM).
- IV is a constant, derived from username, or omitted.

**Phase to address:**
Phase 1 (credential storage primitive) — pick AEAD + key separation up front.

---

### Pitfall 3: Padding-oracle / unauthenticated CBC

**What goes wrong:**
Using `aes-256-cbc` without an HMAC over the ciphertext is exploitable via padding oracle attacks if the server distinguishes "decryption failed" from "decrypted but invalid format" through different error messages or response timings. Even AES-CBC + HMAC-SHA256 (Encrypt-then-MAC) is easy to misimplement (HMAC the IV + ciphertext, constant-time comparison, MAC before decrypt, etc.).

**Why it happens:**
- AES-CBC examples are abundant in old tutorials.
- Node's `crypto` module makes CBC and GCM equally accessible — developers pick the first one they see.
- "I'll add HMAC later" turns into never.

**How to avoid:**
- Use `aes-256-gcm` exclusively. Authenticated by design. No separate MAC.
- If wrapping a JWT, use `dir`+`A256GCM` from `jose` (a maintained, audited library).
- Never bolt your own MAC onto your own CBC scheme.

**Warning signs:**
- `createCipheriv("aes-256-cbc", ...)` anywhere.
- Any try/catch around decryption that swallows the error and falls through.
- Different status codes for "session corrupted" vs. "session expired."

**Phase to address:**
Phase 1 (credential storage primitive).

---

### Pitfall 4: Storing creds in localStorage / sessionStorage / Zustand persist

**What goes wrong:**
In a panic to "have the password handy on the frontend so the next API call can include it," a developer stores the password (or a derived token) in `localStorage` or `useAuthStore` with `persist` middleware. Both are accessible to any JS running on the page — XSS payloads, dev-tool extensions, NPM supply-chain attackers (the project uses Recharts, react-grid-layout, Zustand — any one's transitive deps can host malicious scripts).

The frontend already does **not** need the password in memory after login — `apiFetch` in `src/api/client.ts:5-11` uses `credentials: "include"` and the cookie carries the auth. Resist the urge.

**Why it happens:**
- "I need to retry on 401 by re-authenticating silently" — wrong: that's exactly what should NOT happen; user should see the login screen.
- "I need to display the username on the page" — username is fine in memory; password isn't, anywhere on the frontend.
- "Replay attack across tabs" — handled by the cookie automatically.

**How to avoid:**
- Frontend NEVER touches the password after the login form submit. The login form should clear its local state immediately after `login()` resolves.
- Inspect `src/store/auth.ts` (referenced from `App.tsx:8`) for any persisted password fields; whitelist only `{ username, status }` in any persist middleware.
- Add a unit test asserting `localStorage`/`sessionStorage` contains no `password` substring after login.

**Warning signs:**
- `useAuthStore` schema includes `password`.
- Login form retains password in component state past unmount.
- "Remember me" checkbox feature creep.

**Phase to address:**
Phase 2 (login/session wiring) — review the frontend touch points.

---

### Pitfall 5: Cookie/JWT TTL mismatch with Kinetica password rotation

**What goes wrong:**
Today the cookie TTL is 8 hours (`auth.ts:6` = `60 * 60 * 8`). If a Kinetica admin rotates a user's password, the BI session cookie remains valid for up to 8 hours. The cached creds in the session store now silently fail every downstream call. The user sees "SQL request failed: 401 ..." on every widget but the session UI still says "logged in."

Worse: if the mid-session 401 handling (Pitfall 12 below) is buggy, the user sees stuck spinners or generic errors with no recovery path.

**Why it happens:**
- Kinetica's password rotation is out-of-band; the BI app has no signal.
- 8h was a reasonable JWT-only choice but gains new failure modes when creds are tied to it.
- Re-validating on every request feels expensive.

**How to avoid:**
- Keep the cookie TTL but verify cached creds proactively on a cadence (e.g., a lightweight `SELECT 1` on each request, or every Nth request, or every 5 minutes per session). Cheap on Kinetica, kills stale-cred mystery failures.
- Detect 401/403 from Kinetica anywhere in the call chain → kill the session row, clear the cookie, return 401 to the frontend with a distinct error code (e.g., `{ error: "kinetica_auth_expired" }`).
- Document expected behavior on password rotation in `PROJECT.md`: "If Kinetica password is rotated, BI users will be force-logged-out within N minutes."
- Consider lowering TTL to 1–2 hours for v1.0; sliding renewal on activity.

**Warning signs:**
- Production tickets like "dashboard widgets all 401 but I can't log out."
- Server logs showing repeated 401s from Kinetica with the same `sub`.
- No code path that handles "creds were valid, now they aren't."

**Phase to address:**
Phase 4 (mid-session auth failure UX) and Phase 6 (ops hardening for proactive validation cadence).

---

### Pitfall 6: Not invalidating server-side sessions on logout

**What goes wrong:**
`POST /api/auth/logout` (index.ts:89-92) calls `clearSessionCookie(res)` which only deletes the browser's cookie. Once a SQLite-backed session store exists (Pitfall 1's recommendation), this leaves an orphan row containing encrypted credentials forever. An attacker who later acquires the session_id (from a backup, a leaked log, anything) replays it.

**Why it happens:**
- The current logout was implemented when JWT was self-contained (no server state to clean up).
- Easy to forget to update the logout handler when introducing a session table.

**How to avoid:**
- Add `deleteSession(session_id)` and call it inside `/api/auth/logout` BEFORE `clearSessionCookie`.
- Treat the cookie as a pointer, the row as the truth: the cookie alone proves nothing without a matching, non-revoked, non-expired row.
- Emit an audit log entry on logout (low cost, useful for the "who logged out when" timeline).

**Warning signs:**
- Sessions table grows monotonically.
- "Logged out" cookies still authenticate if replayed.

**Phase to address:**
Phase 2 (login/session wiring) — pair with login implementation.

---

### Pitfall 7: Forgetting one Kinetica call site during the refactor — admin creds silently still in use

**What goes wrong:**
The shared-admin-creds Authorization header appears at **four** call sites in `server/src/index.ts`:
- Line 249 — view materialize endpoint (`POST /api/views/:id/materialize`)
- Line 319 — `kineticaSql` helper (used by all three discovery endpoints: `/api/kinetica/schemas`, `/api/kinetica/schemas/:schema/tables`, `/api/kinetica/schemas/:schema/tables/:table/columns`)
- Line 401 — WMS proxy (`GET /api/wms`)
- Line 433 — SQL proxy (`POST /api/sql`)

Plus auth.ts:35 in `verifyKineticaCredentials` (this one is intentional — it tests the supplied creds during login, not admin creds).

If the refactor only updates 3 of 4, one route silently runs as admin forever. The bug is invisible in dev (developer's user usually has admin-equivalent perms) and only manifests when a low-privilege user can suddenly see/do something Kinetica should have refused.

**Why it happens:**
- Grep for `KINETICA_PASSWORD` is not enough — `kineticaUser` and `kineticaPassword` are captured in module-level closures at index.ts:45-46.
- `kineticaSql` is a helper used by 3 discovery routes; refactoring it is one change but it's easy to miss the inline calls in the materialize/WMS/SQL handlers.
- No type-system enforcement that downstream calls take a credentials argument.

**How to avoid:**
- Centralize all Kinetica HTTP calls into a single `kineticaCall(req, { method, path, body })` function that **takes the request** (and pulls user creds from `req.user.session.creds`). Make the function require credentials by type — never optional.
- Delete the module-level `kineticaUser` / `kineticaPassword` constants at index.ts:45-46. Their absence will produce TypeScript errors at every old call site, surfacing missed refactors at compile time.
- Verify with `git grep -n "KINETICA_USERNAME\\|KINETICA_PASSWORD\\|kineticaUser\\|kineticaPassword"` returns zero matches outside of the deletion commit and (if kept) `verifyKineticaCredentials`.
- Add an integration test per route asserting that the Authorization header sent to Kinetica (mocked) matches the logged-in user's creds, not a hardcoded admin.

**Warning signs:**
- Any `Buffer.from(\`${kineticaUser}:${kineticaPassword}\`)` remains in the codebase post-refactor.
- TypeScript compiles after deleting the env-var constants without errors (means nothing references them — suspicious if you haven't touched the call site).
- A user with restricted Kinetica perms can still query restricted tables.

**Phase to address:**
Phase 3 (downstream call refactor) — this is the entire point of that phase. Phase 5 (remove admin env) verifies via deletion + compile-error-driven discovery.

---

### Pitfall 8: Logging credentials accidentally

**What goes wrong:**
Multiple ways credentials leak into logs:
- `console.error("Kinetica schemas error", error)` (index.ts:355, 369, 387, 415, 450) — `error` may be a `fetch` error whose message includes the URL, headers, or full request init object. If the credential ends up in a thrown error from a retry layer, it lands in stdout.
- Any future morgan/pino middleware with `req.headers` or `req.body` in the format string.
- `body: JSON.stringify({ ... })` printed during debugging.
- The Authorization header is on the **outbound** Kinetica request, so inbound logging middleware won't catch it — but outbound logging (e.g., a debug node-fetch interceptor) will.
- `console.log(req.user)` once `req.user` carries decrypted credentials in memory.

**Why it happens:**
- Default `console.error(error)` dumps everything.
- Logging middleware is added later by ops without auth-context awareness.
- Decrypted creds on `req.user` make it tempting to dump.

**How to avoid:**
- Never put decrypted creds on `req.user`. Put them in a `WeakMap<Request, Credentials>` or a per-request closure that is not enumerable on `req`. If `req.user` is logged, only `{ sub }` should be visible.
- Wrap the outbound Authorization header construction in a single function, never log its inputs.
- Add a redaction layer: pino with `redact: ["req.headers.authorization", "req.headers.cookie"]`. Even if console.error stays, swap to a logger that knows about secrets.
- Define a `safeError(error)` helper that strips known sensitive keys and stringifies the rest. Use it everywhere instead of raw `String(error)`.
- Lint rule (or CI grep) forbidding `console.log(req` and `console.error(req`.

**Warning signs:**
- Stack traces in logs containing `Authorization: Basic ...`.
- `error.config.headers` printed by an HTTP library.
- Any log line containing "Basic " followed by base64.

**Phase to address:**
Phase 6 (ops hardening) — but the redaction discipline must be in place before Phase 3 lands so the new credential-touching code is born safe.

---

### Pitfall 9: Returning Kinetica's raw 401 body to the client

**What goes wrong:**
`/api/sql` at index.ts:447-448 currently does:
```ts
const payload = await response.json();
return res.status(response.ok ? 200 : response.status).json(payload);
```
After the refactor, when Kinetica returns 401 (user's password rotated, perms revoked), the BI server will dutifully forward Kinetica's response body to the browser. That body may contain:
- The user's username (low risk but unnecessary echo).
- Internal Kinetica error codes / stack traces (info disclosure).
- HTML if Kinetica is fronted by a reverse proxy returning a default error page.
- Implementation hints that help attackers fingerprint Kinetica.

The frontend in `src/api/client.ts:7-10` only triggers the unauthorized event on `response.status === 401`. If the Kinetica error wraps as 200 with `body.status === "ERROR"` (which kineticaSql at index.ts:336 already shows is a real shape), the unauthorized event never fires and the user is left with a generic JS error.

**Why it happens:**
- The proxy was written to be "transparent" pre-auth — pass everything through.
- Kinetica's mixing of HTTP-level and body-level error signaling is unusual; easy to handle one and miss the other.

**How to avoid:**
- Centralize response handling: every Kinetica response goes through a `classifyKineticaResponse(res, body)` returning one of `{ ok, kinetica_auth_failed, kinetica_forbidden, kinetica_error, transport_error }`.
- Map results to BI status codes:
  - `kinetica_auth_failed` → 401 with `{ error: "kinetica_auth_expired", code: "REAUTH_REQUIRED" }` (NEW code, distinct from the BI session 401).
  - `kinetica_forbidden` → 403 with `{ error: "kinetica_forbidden", message: "<sanitized>" }`.
  - `kinetica_error` → 502 with sanitized message; do NOT echo Kinetica's body.
- Sanitize messages: regex-strip credential-looking substrings, strip stack traces, cap length at e.g. 500 chars.
- Match the body-level error case (`body.status === "ERROR"` plus `/auth|credential|permission|denied/i` heuristic, mirroring `verifyKineticaCredentials` at auth.ts:58).

**Warning signs:**
- Browser DevTools Network tab shows a 401 response body containing "javax.servlet" or "kinetica" or any backend stack.
- Two different shapes of "auth failed" reach the frontend and only one triggers re-login.

**Phase to address:**
Phase 4 (mid-session auth failure UX) — must align frontend and backend on a single error shape.

---

### Pitfall 10: Conflating 401 (your session is dead) with 403 (Kinetica says no)

**What goes wrong:**
The frontend dispatches `UNAUTHORIZED_EVENT` on every `response.status === 401` (`src/api/client.ts:7-9`). After the refactor, **two distinct conditions** can produce a 401:
1. **BI session is invalid** (cookie expired, server restart wiping in-memory state, manual logout in another tab) → action: re-authenticate.
2. **Kinetica says these creds are no longer valid** (password rotated, account locked, MFA token expired) → action: re-authenticate.

These should both trigger re-login — that part is fine. But Kinetica also returns **403** (or 401 with a different message) for "you're authenticated but not authorized to access this table." That should NOT trigger re-login — it's a permissions error and should stay on the dashboard with a meaningful message ("You don't have access to schema X. Ask an admin to grant SELECT.").

If the codebase reuses the `UNAUTHORIZED_EVENT` for both 401 and 403, the user is logged out every time they hit a permission boundary. Conversely, if 403 is silently swallowed, users see broken widgets with no explanation.

**Why it happens:**
- Existing handler (`api/client.ts:7-10`) was written when only the BI server returned 401, so conflation didn't matter.
- Kinetica's 401 vs 403 distinction is real but easy to ignore in the proxy layer.

**How to avoid:**
- Three-way dispatch on the frontend:
  - `401 + code: "REAUTH_REQUIRED"` → fire `UNAUTHORIZED_EVENT` → `markUnauthenticated()`.
  - `403` → return error to the calling component, which renders "Permission denied: ..." inline (no redirect).
  - Other errors → existing thrown-error pattern.
- Backend MUST set the `code` field on every 401 so the frontend can distinguish "session dead" from "I'm a 401 from somewhere else."
- Add a unit test for the dispatcher: feed in a 403 response, assert no `UNAUTHORIZED_EVENT`.
- Update `App.tsx:24-28` listener — currently it does an unconditional `markUnauthenticated()`. After this change, only react to the specific event payload.

**Warning signs:**
- Users report being logged out when clicking a chart on a restricted table.
- `markUnauthenticated()` fires multiple times per page load.
- No 403 handling appears anywhere in the frontend.

**Phase to address:**
Phase 4 (mid-session auth failure UX) — joint frontend + backend change.

---

### Pitfall 11: AUTH_SECRET (or session encryption key) rotation invalidating all sessions but leaving server-side rows that never expire

**What goes wrong:**
When `AUTH_SECRET` changes (planned rotation, ops migration, key compromise response), `jwt.verify` in `auth.ts:89` will reject all old cookies. Users re-login. So far so good. But the SQLite session rows (introduced for Pitfall 1) are still there — keyed by random session_id, encrypted with the old `SESSION_ENCRYPTION_KEY`. They cannot be decrypted (good), but they also can never be cleaned up because no live cookie points at them. The table grows forever.

Worse, if the encryption key rotation strategy is "decrypt with old, re-encrypt with new on next request," sessions whose users never log back in stay encrypted with the old key. If the old key is later destroyed, those rows become permanent garbage.

**Why it happens:**
- Cleanup is "later."
- Cookie-driven cleanup misses orphans.

**How to avoid:**
- Every session row has an `expires_at` column. Background job (or on-each-write opportunistic cleanup) deletes rows where `expires_at < NOW()`.
- On `AUTH_SECRET` rotation, run a one-time `DELETE FROM sessions` (acceptable — users re-login anyway).
- On `SESSION_ENCRYPTION_KEY` rotation: same. Don't try to dual-decrypt; cheap to log everyone out compared to managing key versions.
- Document rotation procedure in a runbook.

**Warning signs:**
- SQLite file growing without dashboard count growing.
- `sessions` table has rows older than `cookie_TTL`.
- No cron / startup hook touches the sessions table.

**Phase to address:**
Phase 6 (ops hardening).

---

### Pitfall 12: Race conditions on concurrent requests after session expiry

**What goes wrong:**
A dashboard with N widgets fires N parallel `runSql` calls. The session has just expired (or Kinetica creds just got rejected). All N requests fail concurrently with 401. The frontend's `apiFetch` (api/client.ts:5-11) dispatches `UNAUTHORIZED_EVENT` N times. `markUnauthenticated()` is called N times. Depending on Zustand store implementation, this may be idempotent — but the rendering is not:
- Widget components mid-fetch try to update state on an unmounted login screen.
- Some widgets show "401 unauthorized" raw error text before the login screen swaps in.
- Network tab shows N failed requests with no clear "first failure" — debugging is a mess.

The current `App.tsx` also has a stale-closure risk in the `useEffect` at lines 24-28: if the `markUnauthenticated` reference changes between renders, the listener cleanup may not match the addition.

**Why it happens:**
- React fan-out of widget data fetching has no shared "auth gate."
- Zustand subscriptions aren't atomic across components.
- 401 was a rare event before; will be common after passthrough.

**How to avoid:**
- Backend: in the credential validation middleware, use a single-flight pattern per session_id — first request to detect cred failure marks the session dead in SQLite; concurrent requests reuse that decision and short-circuit to 401 without re-hitting Kinetica.
- Frontend: debounce/dedupe `UNAUTHORIZED_EVENT` (only the first one in a 500ms window triggers the redirect).
- Frontend: a global "auth-state mutex" — once `status === "unauthenticated"`, all in-flight `apiFetch` calls are aborted (use `AbortController` plumbed through the store).
- Suppress per-widget error toasts when the global auth state is mid-transition.

**Warning signs:**
- Test scenario: open a 12-widget dashboard, kill the BI session manually in dev tools, click refresh — count the error toasts.
- Multiple "unauthenticated" log lines in quick succession.
- React warns about state updates on unmounted components.

**Phase to address:**
Phase 4 (mid-session auth failure UX).

---

## High-Severity Pitfalls

### Pitfall 13: Migration mid-deploy — old cookies meet new code

**What goes wrong:**
The current `SessionPayload` is `{ sub: username }` (auth.ts:7-9). After the milestone, the new backend either expects:
- (a) creds embedded in the JWT (if you went JWE — DON'T, see Pitfall 1), or
- (b) a `session_id` field in the JWT, with creds in SQLite.

During a rolling deploy, users with old cookies hit the new code. The new `requireAuth`-equivalent middleware reads `decoded.session_id`, finds it `undefined`, and either:
- Crashes with `TypeError: Cannot read property of undefined` (worst — 500 errors break the dashboard),
- Returns a generic 401 (acceptable but users don't know why they got logged out),
- Silently treats undefined as a missing session and falls through to admin creds (CRITICAL — see Pitfall 7 for what fallback paths look like).

**Why it happens:**
- JWT is forward-compatible by accident: missing fields are just `undefined`. No version field forces a clean break.
- "It works on the deployed servers" doesn't mean "it works for users mid-deploy."

**How to avoid:**
- Add a `v: 1` (or `v: 2` for the new shape) field to `SessionPayload`. The new middleware: if `v !== 2`, return 401 immediately with `code: "REAUTH_REQUIRED"`. Old cookies cleanly trigger re-login.
- Bonus: rotate `AUTH_SECRET` as part of the deploy. All old cookies fail signature verification → automatic clean break. Communicate to the team: expect to re-login once after the v1.0 deploy.
- Ensure Phase 4's frontend handler is shipped BEFORE the backend cuts over — if the frontend doesn't know how to handle the new 401 code, you get the user stuck on an error.

**Warning signs:**
- 500s spike during deploy window.
- Code path `if (!decoded.session_id)` returns `next()` rather than 401.

**Phase to address:**
Phase 5 (remove admin env / deploy migration plan). The version-bump must be in Phase 2.

---

### Pitfall 14: `requireConfig` middleware lingers after env vars are deleted

**What goes wrong:**
`requireConfig` at `index.ts:58-65` checks `kineticaUrl`, `kineticaUser`, `kineticaPassword` and returns 500 if any are missing. After Phase 5 deletes `KINETICA_USERNAME` / `KINETICA_PASSWORD` from the env (the explicit milestone goal), if `requireConfig` is left as-is, every endpoint guarded by it (materialize at line 232, schemas at 347, tables at 360, columns at 374, WMS at 393, SQL at 421) returns:

```
{ "error": "Missing KINETICA_URL, KINETICA_USERNAME, or KINETICA_PASSWORD environment variables." }
```

The dashboard breaks for every user immediately on deploy. The error message is misleading because it suggests an env-config bug, sending ops on a wild goose chase.

**Why it happens:**
- `requireConfig` was scaffolding for the pre-passthrough world. Easy to leave behind because deleting it changes 6 route signatures.
- The check passes in dev where the env vars are still set (developer's own config), so CI doesn't catch it.

**How to avoid:**
- In Phase 5, replace `requireConfig` with `requireKineticaUrl` (only checks `KINETICA_URL`, since that's still needed). Or fold the URL check into the centralized Kinetica-call helper from Pitfall 7 and remove the middleware entirely.
- Add an integration test that runs the server WITHOUT `KINETICA_USERNAME` / `KINETICA_PASSWORD` set and asserts every route still returns 200/expected status when the user is authenticated.
- CI step: `unset KINETICA_USERNAME KINETICA_PASSWORD && npm run test:integration`.

**Warning signs:**
- After deleting env vars locally, every Kinetica route returns the "Missing ..." error.
- `git grep -n requireConfig` returns hits in `index.ts` after Phase 5.

**Phase to address:**
Phase 5 (remove admin env). This is the headline risk of Phase 5.

---

### Pitfall 15: Unattended jobs / scripts depending on admin creds

**What goes wrong:**
The repo currently has only the Express server consuming `KINETICA_USERNAME` / `KINETICA_PASSWORD`. But teams routinely add cron-style scripts ("nightly view refresh," "schema-cache warmup," "health probe with a real query") that import the env directly. If any such script exists OR is added between now and the milestone landing, deleting the env vars in Phase 5 silently breaks it.

The materialize endpoint (index.ts:232) is particularly suspicious — view materialization is conceptually a "system" operation that some teams trigger from cron. If a team script POSTs to `/api/views/:id/materialize` with a service account, that account now needs to be a real Kinetica user with sufficient perms — not the deleted shared admin.

**Why it happens:**
- Side scripts live outside the main code path; not surfaced in code review.
- "Service account" is a concept that often emerges late in operationalization.

**How to avoid:**
- Phase 5 includes a discovery step: `git grep -rn "KINETICA_USERNAME\\|KINETICA_PASSWORD"` across the **entire** repo and any sibling repos / Helm charts / Terraform / docker-compose.yml / CI workflows. Document every hit.
- For each hit: either (a) migrate to user-auth flow, (b) explicitly authorize a service-account user in Kinetica with a separate env var like `KINETICA_SERVICE_USER` / `KINETICA_SERVICE_PASSWORD` and limited scope (e.g., only materialize allowed), or (c) confirm the script is dead and delete it.
- Document the service-account decision in PROJECT.md key decisions table.

**Warning signs:**
- Materialize fails for users with restricted DDL perms (a real concern — `CREATE OR REPLACE MATERIALIZED VIEW` requires DDL rights that BI users may not have).
- Cron jobs start failing post-deploy.

**Phase to address:**
Phase 5 (remove admin env) discovery step. This may force a Phase 5b for a service-account pattern if materialize requires elevated perms.

---

### Pitfall 16: Materialized view DDL requires perms the typical BI user lacks

**What goes wrong:**
Even if you correctly route the materialize call (index.ts:242: `CREATE OR REPLACE MATERIALIZED VIEW ${view.view_name} AS SELECT * FROM ${sourceTable}${whereClause}`) through the user's creds, the user may have SELECT but not CREATE rights. The shared admin previously masked this. Post-refactor, every analyst hitting "Materialize" gets a 403, the view rows stay in `pending`/`error` state, and the dashboard becomes useless.

This is the most likely concrete user-visible regression of the entire milestone.

**Why it happens:**
- The original architecture leveraged admin perms to make the BI app feel frictionless.
- The team may not realize how Kinetica's perm model splits SELECT vs DDL.

**How to avoid:**
- Test materialize with a least-privileged Kinetica user BEFORE Phase 5 lands, ideally in Phase 3.
- If it fails, options:
  1. **Service account for materialize only** (see Pitfall 15) — explicit, documented, separate creds with narrow scope.
  2. **Admin grants per-user CREATE rights** in Kinetica — the cleanest "passthrough" answer; matches the milestone intent.
  3. **Replace materialized views with regular views** (no DDL, just session-scoped) — possibly redesigns the views model.
- Decide before Phase 5; document in PROJECT.md.

**Warning signs:**
- 403s from `/execute/sql` on materialize for non-admin users.
- View rows stuck in `error` state with "permission denied" messages.

**Phase to address:**
Phase 3 (downstream call refactor) for detection; resolution may push to Phase 5 or a new sub-phase.

---

### Pitfall 17: Login response leaks Kinetica error detail

**What goes wrong:**
`verifyKineticaCredentials` at auth.ts:21-66 returns `{ ok: false, status: ..., message: ... }` where `message` includes the raw Kinetica error string (auth.ts:57) or `\`Kinetica returned ${response.status}\`` or `\`Failed to reach Kinetica: ${String(error)}\``. The login route at index.ts:78-79 forwards this directly: `res.status(result.status).json({ error: result.message })`.

After the refactor, Kinetica error messages may include schema/user/host hints useful for fingerprinting an internal Kinetica deployment. They may also include misleading details (e.g., "user 'foo' is locked") that help attackers enumerate valid usernames.

**Why it happens:**
- Existing code prioritizes debuggability; never had to handle adversarial users.
- The milestone is internal-team-use, so paranoia feels excessive — but this code path is the one place credentials are tested adversarially.

**How to avoid:**
- Login response: distill to two outcomes — `{ error: "Invalid credentials" }` (401) or `{ error: "Authentication service unavailable" }` (502). NEVER include Kinetica's raw message in the 401 response.
- Server logs: keep the detailed message for operators; redact creds.
- Treat "user locked" same as "wrong password" externally — internally distinguish for ops dashboards.

**Warning signs:**
- Login form displays Kinetica internal error text.
- DevTools shows different error messages for "wrong username" vs "wrong password" (username enumeration).

**Phase to address:**
Phase 2 (login/session wiring).

---

## Medium-Severity Pitfalls

### Pitfall 18: SQLite session table grows unbounded

**What goes wrong:**
Without a cleanup strategy, every login creates a row that lives forever (or until manual intervention). At ~100 users × 1 login/day × 365 days = 36,500 rows/year. Not catastrophic but wasteful — and crucially, those rows contain encrypted credentials. If the encryption key is later compromised, the blast radius is "every user who has ever logged in," not "every currently-active user."

**Why it happens:**
- "I'll add cleanup later."
- SQLite is forgiving — table sizes don't impact performance until much larger scales.

**How to avoid:**
- On every login, run `DELETE FROM sessions WHERE expires_at < ?` with current timestamp. Cheap, opportunistic.
- On logout, `DELETE FROM sessions WHERE id = ?`.
- Optional cron / startup job: same cleanup on boot.
- Keep `expires_at` indexed.

**Warning signs:**
- Sessions table much larger than active user count.
- Backup files growing despite no new dashboards.

**Phase to address:**
Phase 6 (ops hardening).

---

### Pitfall 19: Daylight saving / timezone bugs in `expires_at`

**What goes wrong:**
SQLite's `CURRENT_TIMESTAMP` is UTC. If session creation uses `Date.now() + TTL_MS` and the server clock is local time, comparisons drift by hours twice a year. If `expires_at` is stored as a string in some places and integer in others, comparisons silently fail or do string-comparison ("2026-04-27" < "2026-04-28" works; "11/27/2026" < "12/01/2026" doesn't).

**Why it happens:**
- JS `Date` is famously inconsistent.
- SQLite stores timestamps as TEXT/INTEGER/REAL — no native datetime type, no enforcement.
- Mixing `new Date()`, `Date.now()`, `CURRENT_TIMESTAMP`, and ISO strings is irresistible.

**How to avoid:**
- Pick ONE format: ISO 8601 UTC strings (`new Date().toISOString()`). Document in `db.ts`.
- Always compare using the same source: e.g., `WHERE expires_at > ?` with `?` being `new Date().toISOString()`.
- Server runs in UTC (`TZ=UTC`) per dotenv / docker config.
- Type the column: `expires_at TEXT NOT NULL` with a CHECK constraint requiring a valid ISO format if SQLite version supports it.
- Unit-test session expiry math.

**Warning signs:**
- "My session expired 1 hour earlier than it should" tickets in spring/fall.
- Test passing only at certain times of day.

**Phase to address:**
Phase 1 (credential storage primitive) — set the convention before any session row is written.

---

### Pitfall 20: Concurrent login from same user creates competing session rows

**What goes wrong:**
User logs in on laptop, then on desktop — two session rows, two cookies, both valid. If creds were rotated between logins, the laptop session has stale creds, the desktop has fresh. Confusing but tolerable.

Trickier: user logs in, then uses the login form again (e.g., browser autofill triggers it). Without a uniqueness constraint, two rows for the same user with the same creds at slightly different times. Logout from one tab kills only one row — the other tab still works. User is confused.

**Why it happens:**
- No uniqueness constraint on `(user_id, ...)`.
- Login is treated as create-only.

**How to avoid:**
- Two sessions per user is fine and intentional (multi-device); don't constrain.
- DO ensure logout deletes only the current session_id, not all of the user's sessions.
- Document multi-device behavior. If the team wants "logout everywhere," add a separate endpoint.
- If the user submits the login form while already authenticated, the server should detect it and either reject or delete-then-recreate (don't leave the old one orphaned).

**Warning signs:**
- "I logged out but I'm still logged in on my other tab" (this is correct behavior for sessions; misleading only if not documented).
- Sessions table has 5 rows for one user from one IP in 30 seconds.

**Phase to address:**
Phase 2 (login/session wiring).

---

### Pitfall 21: CORS + cookie + cross-origin pitfall

**What goes wrong:**
Existing CORS (index.ts:48-54) sets `credentials: true` and a wildcard origin if `CORS_ORIGIN` is unset. The cookie has `sameSite: "lax"` (auth.ts:74). In dev with `localhost:5173` (Vite) → `localhost:4000` (Express), this works. In production, if the frontend and backend are deployed to different subdomains (or the same domain with different ports), `sameSite: "lax"` may block the cookie on POST requests from cross-origin contexts. Login appears to succeed (200 + Set-Cookie) but the next request has no cookie.

**Why it happens:**
- `lax` is the right default for most apps but interacts with cross-site fetch quirks.
- Browser cookie behavior is hard to test without a real cross-origin deploy.

**How to avoid:**
- Document the deployment topology in PROJECT.md context. If frontend + backend are same-site, `lax` is fine. If cross-site, switch to `sameSite: "none"` + `secure: true` (HTTPS required).
- Test with `secure: true` enabled in dev (use a self-signed cert) at least once before production.
- CSRF protection: `lax` provides some; `none` provides none — add a CSRF token header for state-changing endpoints if `none`.

**Warning signs:**
- Login returns 200 but the next page load shows the login screen again (cookie didn't persist).
- DevTools shows `Set-Cookie` rejected with a CORS warning.

**Phase to address:**
Phase 6 (ops hardening) — primarily a deploy-time concern.

---

### Pitfall 22: 401 spam in observability tools

**What goes wrong:**
Once mid-session 401s become the normal "your Kinetica session expired" path (vs. the rare event it is today), monitoring/alerting can't distinguish legitimate user re-auth from actual auth bugs. The 401 rate becomes baseline noise; real bugs hide in it.

**Why it happens:**
- Auth-related 401s and bug-related 401s share the same status code.
- "Just alert on 401 rate > X" is a tempting but bad rule.

**How to avoid:**
- Distinguish in logs: `auth_outcome=expired_kinetica` vs. `auth_outcome=expired_session` vs. `auth_outcome=invalid_token` vs. `auth_outcome=missing_cookie`. Use structured logging.
- Alert on unusual outcomes (e.g., `invalid_token` spike = signing key mismatch / attack), not on 401 rate generically.

**Warning signs:**
- Alerting fatigue.
- "We've always had a high 401 rate, ignore it" becoming team folklore.

**Phase to address:**
Phase 6 (ops hardening).

---

### Pitfall 23: Login form retains password in component state / browser autofill

**What goes wrong:**
React form state holds the password as long as the LoginPage is mounted. After successful login, if `LoginPage` doesn't unmount immediately (e.g., loading state, transition animation), the password sits in a JS variable. A misbehaving extension or a React DevTools dump can read it.

**Why it happens:**
- `useState` is the obvious approach; nobody clears it on success.
- Browser autofill keeps the value populated even if the field is reset programmatically.

**How to avoid:**
- On successful login, reset password state to `""` BEFORE calling `setStatus("authenticated")`.
- Use `<input type="password" autoComplete="current-password">` (correct; not `new-password`).
- Don't log password value anywhere, even in dev.
- Login form unmounts as soon as `status === "authenticated"` (App.tsx:34-36 already does this, good).

**Warning signs:**
- React DevTools profile shows `password: "real-password"` in component state after login.
- Console.log on the login form stays in code post-merge.

**Phase to address:**
Phase 2 (login/session wiring).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Stuff creds in JWT payload as plaintext | One-line change to `SessionPayload`; no SQLite session table | Catastrophic if any cookie ever leaks; impossible to revoke a single session; password lives in browser cookie jar (backups, sync) | **Never** |
| Single `AUTH_SECRET` env var doing both signing and encryption | One env var to manage | Compromise = total breach; rotation invalidates everything; can't rotate signing without rotating encryption | **Never** for credential storage |
| `aes-256-cbc` because "I'll add HMAC later" | Looks like AES, feels secure | Padding oracle; nobody adds the HMAC | **Never** — use GCM |
| Leave `requireConfig` middleware referencing deleted env vars | "I'll clean up later" | Every Kinetica route returns 500 in prod | **Never** — must be in Phase 5 |
| Forward Kinetica's raw 401 body to the client | "Transparent proxy" feels cleaner | Info disclosure; frontend can't reliably distinguish auth failure from other errors | **Never** post-v1.0 |
| Skip per-route credential plumbing, just keep using the env-var fallback "for now" | Refactor stays smaller | The entire point of v1.0 silently undone | **Never** — Phase 3 must remove the constants |
| Reuse `UNAUTHORIZED_EVENT` for both 401 and 403 | One event, one handler | Users logged out on every permission-boundary click | Acceptable only if 403 doesn't happen in practice (verify with audit before Phase 4 ships) |
| Delay session cleanup ("table is small") | One less feature to implement | Encrypted cred rows accumulate forever; key compromise = historical breach | Acceptable for the first 90 days post-launch IF a manual cleanup runbook exists |
| Single global `kineticaUser`/`kineticaPassword` constants captured in module scope | Matches existing code style | Forgetting one call site silently uses admin (Pitfall 7) | **Never** for v1.0 |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Kinetica `/execute/sql` | Treating HTTP 200 as success — but body has `status: "ERROR"` (see kineticaSql at index.ts:336) | Check both `response.ok` AND `body.status !== "ERROR"`; classify into auth/forbidden/error |
| Kinetica `/wms` (WMS proxy) | Tile rendering returns binary; copying `Authorization` works but error-path streams partial JPEG / blank tile | On 401/403 from WMS, do NOT pass through binary; return JSON error with re-auth hint |
| Kinetica auth response codes | Some endpoints return 401 for bad creds, others 403, others 200 with body error | Single `classifyKineticaResponse` helper handles all three branches |
| HTTP basic auth header | Re-encoding `username:password` in 4 places (index.ts:249, 319, 401, 433) | One helper: `buildAuthHeader(creds)` — single audit point for credential touching |
| Browser cookie + Vite dev proxy | Vite default proxy may strip cookies depending on `secure` flag and origin handling | Explicitly configure Vite `server.proxy` with `changeOrigin: false` and `cookieDomainRewrite` if needed |
| SQLite from Express | Synchronous `better-sqlite3` calls in the request hot path are fast for small tables but block the event loop | Acceptable here (sessions ops are tiny); document the assumption |
| `cookie-parser` with `cookieParser()` (no secret) | Cookies are not signed at the cookie-parser layer; relying on JWT signature is correct but means `req.cookies` is unsigned | Don't trust `req.cookies` values structurally — always re-verify via `jwt.verify` (auth.ts:88-90 does this correctly) |
| Frontend `fetch` with `credentials: "include"` | Forgetting the option means the cookie isn't sent (api/client.ts:6 has it; new code paths must too) | All new fetch helpers must include credentials |
| `dotenv.config()` at server boot | Picks up everything from `.env` — including potentially deleted entries that someone adds back locally | After Phase 5, `.env.example` must NOT list `KINETICA_USERNAME`/`KINETICA_PASSWORD` |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| `SELECT 1` cred validation on every request | Latency added to every API call; 2x Kinetica load | Validate on first request after N minutes of inactivity, not every request; cache "last validated at" in session | At >10 req/s/user (dashboard with many widgets) |
| Decrypting credentials on every request | CPU cost of AES-GCM × every API call | Cache decrypted creds in a `WeakMap<Request, Credentials>` per request; never per-process | Negligible at <100 concurrent users; non-issue at this scale |
| Sessions table scan for cleanup | Full-table scan on every login | Index on `expires_at`; use `LIMIT 100` per cleanup pass | At 100k+ rows |
| 401 → re-login storm | All N widgets retry simultaneously after re-auth | Stagger / dedupe widget refetch on auth state change | At 10+ widgets per dashboard |
| Logging every Kinetica request body | Disk fills up; logs slow to scroll | Log only on error; never log Authorization; never log SQL parameters that may be PII | At >100 req/s |
| WMS tile passthrough adds Kinetica RTT to every map pan | Visible lag on map dashboards | Cache WMS tiles by URL+user (be careful: per-user perms mean cache key includes username) | At <5 RPS; map dashboards already feel slow |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Plaintext password in JWT (HS256) | Cookie theft = password leak (Pitfall 1) | Server-side encrypted session store; opaque cookie ID |
| Encryption key = signing secret | Single point of failure (Pitfall 2) | Two distinct env vars |
| AES-CBC without HMAC | Padding oracle (Pitfall 3) | AES-256-GCM |
| Frontend persists password (localStorage / Zustand) | XSS = password leak (Pitfall 4) | Password never leaves the login form's local state |
| Logging Authorization header | Credential leak via log files (Pitfall 8) | pino redact list; never pass `req` to console |
| Forwarding Kinetica error bodies | Info disclosure (Pitfall 9) | Sanitize all upstream errors |
| Username enumeration via login error messages (Pitfall 17) | Account-targeted attacks | Single generic "invalid credentials" message |
| No revocation on logout (Pitfall 6) | Stolen cookie still works post-logout | Delete server-side row on logout |
| Cookie missing `secure` in prod | Cookie sniffable on plain HTTP | `secure: process.env.NODE_ENV === "production"` (auth.ts:75 — already correct, verify in prod build) |
| `sameSite` mismatch with deploy topology (Pitfall 21) | Cookie not sent / CSRF | Match `sameSite` to actual cross-site or same-site deployment |
| No CSRF protection if `sameSite: none` | State-changing endpoints exploitable from any origin | Custom header check or CSRF token if `sameSite: none` |
| Storing cred ciphertext + IV in same column without auth tag | Tampered IV = decryption to attacker-chosen plaintext (with non-AEAD modes) | GCM with auth tag stored alongside |
| Reusing IVs | Catastrophic AES-GCM key recovery | `crypto.randomBytes(12)` per record |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Mid-session 401 → blank screen | User loses dashboard context; thinks app crashed | Toast: "Your Kinetica session expired. Please sign in again." + return-after-login redirect |
| 403 (no permission) treated as 401 (re-login) | User logs in repeatedly with no progress; very confusing | Inline error on the widget: "You don't have access to schema X." |
| All widgets show "401 unauthorized" before redirect | Visual chaos; users see scary error text | Suppress per-widget error rendering when global auth state is "transitioning" |
| Login form clears username on failure | User has to retype both fields | Clear only password |
| No "remember me" — required to log in every 8h | Friction for daily users | Document the choice; don't add unless explicitly approved (cred lifetime is the constraint) |
| Logout doesn't visually confirm | User unsure if they actually logged out | Brief toast + redirect to login |
| Password field shows "credentials saved" autofill icon after successful login | False sense that the BI app stores the password (it does — encrypted server-side, not browser) | Document behavior; do not block browser autofill |
| Failed login shows backend error verbatim ("Failed to reach Kinetica: ...") | User confused about whether it's their typo or the system | Friendly "Sign-in failed. Please verify your credentials and try again." for 401; "Service unavailable, retry shortly." for 502 |
| Materialize button still visible to users without DDL perms | Click → 403 → frustration (Pitfall 16) | Surface perm errors clearly; consider hiding/disabling materialize for non-admins (requires perm probe) |

---

## "Looks Done But Isn't" Checklist

- [ ] **Cred storage:** Verify cookie value cannot be base64-decoded into anything resembling a password (`echo "$(get cookie)" | cut -d. -f2 | base64 -d`).
- [ ] **Session encryption:** Verify the SQLite `sessions` table column for credentials does NOT round-trip through `JSON.parse` to readable JSON; should be base64 ciphertext.
- [ ] **All Kinetica call sites refactored:** `git grep -n "kineticaUser\\|kineticaPassword\\|KINETICA_USERNAME\\|KINETICA_PASSWORD"` returns zero matches outside of allowlisted locations (login validation + service account if introduced).
- [ ] **Admin env vars actually deleted:** `unset KINETICA_USERNAME KINETICA_PASSWORD && start the server && exercise every endpoint` — all green.
- [ ] **`requireConfig` updated:** Middleware no longer references `kineticaUser`/`kineticaPassword`; all routes still 200.
- [ ] **Logout invalidates server-side state:** Logout, then attempt to replay the (already-cleared) cookie via `curl --cookie "kbi_session=<old value>"` → 401.
- [ ] **Mid-session 401 detected and handled:** Manually invalidate the session row in SQLite while user has the dashboard open; refresh a widget → frontend redirects to login with a clear message.
- [ ] **403 distinguished from 401:** Manually craft a Kinetica response that returns 403 (or revoke a perm in Kinetica); verify frontend shows inline permission error, NOT the login screen.
- [ ] **No credentials in logs:** Turn on log capture, exercise login + 5 endpoints + logout, grep for any plaintext password or `Basic [a-zA-Z0-9+/=]+` → zero hits.
- [ ] **Session cleanup runs:** After 8h+ of inactivity, sessions table has no rows for that user.
- [ ] **Concurrent dashboard load survives session expiry:** With 12 widgets, kill the session → exactly ONE redirect, no error toasts piling up.
- [ ] **Migration safe:** Old cookie issued before deploy hits new server → 401 with `code: REAUTH_REQUIRED`, NOT a 500.
- [ ] **Materialize works for non-admin user:** Test materialize with the least-privileged Kinetica user — the milestone is incomplete if this returns 403 with no documented workaround.
- [ ] **Login form clears password:** After successful login, React DevTools shows password state is empty.
- [ ] **CORS + cookie verified in production-like env:** Deploy to staging with realistic origin separation; login + subsequent request both succeed.
- [ ] **`.env.example` updated:** No mentions of `KINETICA_USERNAME`/`KINETICA_PASSWORD`; new vars documented (`SESSION_ENCRYPTION_KEY`, etc.).
- [ ] **Service account decision documented:** PROJECT.md key decisions table notes whether materialize uses user creds or a service account, with rationale.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Plaintext password in JWT (Pitfall 1) shipped to prod | HIGH | Force-rotate every Kinetica user's password; rotate `AUTH_SECRET`; ship encrypted-store fix; communicate breach scope to team |
| AUTH_SECRET = encryption key (Pitfall 2) shipped | HIGH | Rotate both keys (treat them as one for rotation); separate them in code; force re-login |
| One Kinetica call site missed (Pitfall 7) | MEDIUM | `git grep` audit; ship hotfix; audit Kinetica access logs for admin-cred usage post-deploy to detect any abuse |
| Credential leak in logs (Pitfall 8) | MEDIUM-HIGH | Rotate exposed users' Kinetica passwords; purge log retention beyond rotation point; add redaction; review log retention policy |
| Mid-session 401 spam (Pitfall 12) | LOW | Add frontend dedup; ship in a follow-up; users tolerate one redirect per session |
| `requireConfig` left referencing dead env vars (Pitfall 14) | LOW (if caught fast) | Hotfix removing the env var refs; restart |
| Materialize broken for non-admin users (Pitfall 16) | MEDIUM | Introduce service account or grant per-user perms in Kinetica; depending on team size, a few hours of ops work |
| Sessions table grows unbounded (Pitfall 18) | LOW | One-shot `DELETE FROM sessions WHERE expires_at < ?`; add cleanup on next deploy |
| 403 treated as 401 (Pitfall 10) | LOW | Frontend hotfix to check error code; UX fix |
| Old cookies crash new deploy (Pitfall 13) | MEDIUM (if 500s in prod) | Rotate AUTH_SECRET to force re-login; redeploy with version-aware middleware |
| Service-account discovery missed (Pitfall 15) | LOW-MEDIUM | Re-introduce limited-scope service account; document |

---

## Pitfall-to-Phase Mapping

Phases follow the suggested milestone roadmap structure (Phase 1 = credential storage primitive; Phase 2 = login/session wiring; Phase 3 = downstream call refactor; Phase 4 = mid-session auth failure UX; Phase 5 = remove admin env; Phase 6 = ops hardening). Adjust phase numbers when the actual roadmap is set.

| Pitfall | Severity | Prevention Phase | Verification |
|---------|----------|------------------|--------------|
| 1. Plaintext password in JWT | CRITICAL | Phase 1 | Decode any cookie; payload must NOT contain password |
| 2. Encryption key = AUTH_SECRET | CRITICAL | Phase 1 | Two distinct env vars validated at boot |
| 3. AES-CBC without HMAC | CRITICAL | Phase 1 | Code review: no `aes-256-cbc` strings anywhere |
| 4. Frontend persists creds | CRITICAL | Phase 2 | localStorage/sessionStorage scan after login |
| 5. TTL > Kinetica password rotation window | CRITICAL | Phase 4 + Phase 6 | Rotate a test user's Kinetica password; verify session dies cleanly |
| 6. No server-side session invalidation on logout | CRITICAL | Phase 2 | Logout, replay old cookie → 401 |
| 7. Forgotten Kinetica call site | CRITICAL | Phase 3 | `git grep` for module-level creds returns zero; integration tests assert per-route auth |
| 8. Logging credentials | CRITICAL | Phase 6 (discipline starts Phase 1) | Log capture grep for `Basic [base64]` → zero hits |
| 9. Returning Kinetica raw 401 body | CRITICAL | Phase 4 | Mock 401 from Kinetica; assert sanitized response |
| 10. 401 vs 403 conflation | CRITICAL | Phase 4 | Trigger 403; verify no logout |
| 11. Key rotation leaves orphan rows | CRITICAL | Phase 6 | Rotation runbook documented; test cleanup |
| 12. Concurrent 401 race | CRITICAL | Phase 4 | 12-widget dashboard + session kill; exactly one redirect |
| 13. Migration mid-deploy | HIGH | Phase 2 (version field) + Phase 5 (deploy plan) | Old cookie + new server → 401 with REAUTH_REQUIRED, not 500 |
| 14. `requireConfig` lingers | HIGH | Phase 5 | Run server without admin env vars; all routes work |
| 15. Side scripts use admin creds | HIGH | Phase 5 (discovery) | `git grep` audit + docs |
| 16. Materialize needs DDL perms | HIGH | Phase 3 (detection) → Phase 5 (resolution) | Test materialize with least-privileged user |
| 17. Login response leaks Kinetica detail | HIGH | Phase 2 | Login error response is generic |
| 18. Sessions table unbounded | MEDIUM | Phase 6 | Cleanup runs on login; expires_at indexed |
| 19. DST / timezone bugs in expires_at | MEDIUM | Phase 1 | Convention documented; UTC-only comparisons |
| 20. Multiple session rows per user | MEDIUM | Phase 2 | Documented behavior; logout only kills current session |
| 21. CORS + cookie cross-origin issues | MEDIUM | Phase 6 | Test in production-like topology |
| 22. 401 spam in observability | MEDIUM | Phase 6 | Structured `auth_outcome` log field |
| 23. Login form retains password state | MEDIUM | Phase 2 | DevTools check after login |

---

## Sources

- **Codebase (HIGH confidence — directly inspected):**
  - `kinetica_bi/server/src/auth.ts` — current JWT-only session implementation; `SessionPayload`, `getSecret`, cookie config
  - `kinetica_bi/server/src/index.ts` — four downstream Kinetica call sites (lines 249, 319, 401, 433); `requireConfig` middleware (58-65); login/logout routes (72-92)
  - `kinetica_bi/src/api/client.ts` — `apiFetch` 401 handler (5-11); `UNAUTHORIZED_EVENT` dispatch
  - `kinetica_bi/src/App.tsx` — `markUnauthenticated` listener wiring (24-28); status-based render gate (30-36)
  - `.planning/codebase/CONCERNS.md` — pre-existing security/tech-debt analysis (basic auth in plain HTTP, no input validation, JSON injection risks)
  - `.planning/PROJECT.md` — milestone goals and constraints
- **OWASP guidance (HIGH confidence):**
  - JWT best practices: avoid storing sensitive data in JWT payload; HS256 signs but does not encrypt
  - Session management cheat sheet: invalidate server-side state on logout; bind sessions to a server-side store for revocability
  - Cryptographic storage cheat sheet: use AEAD (GCM); never use CBC without integrity protection; separate keys for separate purposes
- **Node.js `crypto` documentation (HIGH confidence):** AES-256-GCM API, IV size, auth tag handling, `randomBytes`
- **`jsonwebtoken` library docs (HIGH confidence via Context7-verifiable):** HS256 default; JWT payload is base64url-encoded, not encrypted
- **`jose` library docs (MEDIUM confidence — recommended for JWE if chosen):** `EncryptJWT`, `dir` + `A256GCM`
- **Kinetica REST API behavior (MEDIUM confidence — inferred from existing code):** `/execute/sql` returns 200 with `body.status === "ERROR"` for some failure modes (auth.ts:55-59 already handles this); 401 vs 403 distinction depends on Kinetica version and configuration
- **Browser cookie behavior (HIGH confidence):** httpOnly does not protect against extensions or server-side log access; `sameSite: lax` blocks cross-site POST; `secure` requires HTTPS

---
*Pitfalls research for: Kinetica BI v1.0 — Authentication & Per-User Access*
*Researched: 2026-04-27*
