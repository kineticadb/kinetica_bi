# Feature Research — Per-User Kinetica Credential Passthrough

**Domain:** Server-side credential passthrough for an internal BI tool (Express + React) that proxies a downstream HTTP-Basic API (Kinetica `/execute/sql`, `/wms`).
**Researched:** 2026-04-27
**Confidence:** MEDIUM
**Research note:** WebSearch and Brave Search were both unavailable in this session, so most findings are derived from (a) the existing codebase, (b) widely-established patterns in BI tools like Tableau/Looker/Metabase/Superset for "credential passthrough" / "user-attribute-based DB connections", and (c) standard Express.js + JWT + cookie session conventions. Findings tied to the existing code are HIGH confidence; ecosystem-pattern claims are MEDIUM. Items marked LOW should be validated with primary sources before treating as authoritative.

---

## Scope Anchor

This milestone (v1.0) replaces the shared `KINETICA_USERNAME` / `KINETICA_PASSWORD` admin credentials with per-user passthrough. Concretely:

- Login already validates against Kinetica via `verifyKineticaCredentials` in `server/src/auth.ts` and issues an httpOnly `kbi_session` JWT cookie. The password is **not** currently kept anywhere after login returns.
- Every downstream `fetch` to Kinetica (`/api/sql`, `/api/views/:id/materialize`, `/api/kinetica/schemas...`, `/api/wms`) currently builds `Authorization: Basic` from env creds. Those four call sites in `server/src/index.ts` are the surface area to change.
- Frontend already has 401 → re-login event handling (`UNAUTHORIZED_EVENT` in `src/api/client.ts`, `markUnauthenticated` in `src/store/auth.ts`).

Feature analysis below is scoped to the *delta* needed for that work — not to the broader BI app.

---

## Feature Landscape

### Table Stakes (Users / Operators Expect These)

Features the team will assume exist once "per-user creds" is announced. Missing these = the milestone feels half-finished or unsafe.

| # | Feature | Why Expected | Complexity | Depends On (existing) | Notes |
|---|---------|--------------|------------|-----------------------|-------|
| TS-1 | **User's Kinetica credentials replayed on every downstream call** | The whole point of the milestone. Kinetica enforces ACLs per principal; the BI app must not elevate. | M | Login flow (`verifyKineticaCredentials`), `requireAuth`, all four Kinetica fetch sites | Requires server-side credential storage (see TS-2). All four call sites — `/api/sql`, `/api/views/:id/materialize`, `/api/kinetica/schemas...`, `/api/wms` — must read per-user creds, not env. |
| TS-2 | **Server-side persistence of password between requests** | HTTP is stateless and login is the only request that has the cleartext password. Without persistence, every downstream call would have to re-prompt the user. | M | JWT cookie session (`kbi_session`), `AUTH_SECRET` | Two viable shapes: (a) **encrypt the password and stash it inside the JWT** (cookie grows ~200–400 bytes; symmetric AES-GCM with `AUTH_SECRET` or a sibling key), or (b) **server-side session store** keyed by session id (Redis / SQLite / in-memory map) with the JWT only carrying the session id. Option (a) is simpler for a single-process internal tool; option (b) scales to multi-process and supports server-side revocation. ARCHITECTURE.md will pick one. |
| TS-3 | **Login-time "test call" already validates creds, no extra ping needed** | Users expect the login button to mean "you're in and the system works." | XS | `verifyKineticaCredentials` (already runs `SELECT 1`) | Already shipped — `verifyKineticaCredentials` runs `SELECT 1` against `/execute/sql` with the user's Basic auth. This *is* the table-stakes credential test. Nothing new to build; just keep it. |
| TS-4 | **Mid-session 401 from Kinetica → clean re-login UX (not raw error)** | Password rotations, account disablement, and Kinetica-side session/token expiry happen. Users expect "please sign in again," not a stack trace or a broken chart. | M | Frontend `UNAUTHORIZED_EVENT` listener, Zustand `markUnauthenticated`, login page | Server detects Kinetica's 401/403 (or `status: ERROR` with auth-shaped message — the `/looksAuth/` heuristic in `verifyKineticaCredentials` is a precedent), clears the BI session cookie, and returns 401 to the client. Existing 401 handler routes back to login. |
| TS-5 | **Username remembered for re-login prefill** | After a mid-session boot, retyping the username every time is friction (and users are likely to mistype it, then think their password is wrong). | XS | `LoginPage.tsx` username input, `useAuthStore` user state | Two variants: (a) keep the last-known `user.username` in Zustand and hydrate the form's `username` `useState` from it on mount when status flips to `unauthenticated`; (b) read from `localStorage` (more durable across full reload). Variant (a) is enough and avoids any client-side persistence beyond what's already there. Must NOT prefill the password. |
| TS-6 | **Authorization (403) surfaced differently from authentication (401)** | If a user can log in but can't see a specific table, "please log in again" is wrong and confusing — they'd loop. They need to know "you don't have permission for this," not "your session expired." | S | `apiFetch` 401 handler (`UNAUTHORIZED_EVENT`) | Today, `apiFetch` only branches on 401. Need a parallel "forbidden" path: server returns 403 (passthrough of Kinetica's authz failure), client shows an inline error on the widget/page rather than redirecting to login. Critical to NOT bundle 403 into the re-login event. |
| TS-7 | **Logout actually invalidates downstream access** | Users / security expect logout to mean "the server can no longer act as me." | XS–S | `clearSessionCookie`, `/api/auth/logout` | If creds are stashed in the JWT, clearing the cookie is sufficient (no server state to wipe). If a server-side session store is used, `/api/auth/logout` must also delete the session row. Either way, logout should invalidate fast. |
| TS-8 | **Removing the env-cred fallback is observable** | Operators expect "we removed the admin creds" to actually be true. A silent fallback would defeat the milestone. | XS | Login flow, all four fetch sites, `requireConfig` middleware | Delete `KINETICA_USERNAME` / `KINETICA_PASSWORD` from `.env`, the `kineticaUser` / `kineticaPassword` constants in `server/src/index.ts`, and the `requireConfig` middleware's checks for those vars (keep the `KINETICA_URL` check). Startup still validates `KINETICA_URL` and `AUTH_SECRET`. This is a deletion, not an addition — but it's the milestone's headline behavior. |
| TS-9 | **Session cookie TTL ≤ Kinetica's tolerance for stale creds** | If the BI session lasts 8h but a Kinetica password rotation happens at hour 2, the user gets booted at hour 2 — fine. But if the BI session somehow outlives the cred validity without the user noticing, charts silently break. | XS | `TOKEN_TTL_SECONDS` in `auth.ts` (currently 8h) | Keep the existing 8h TTL; the mid-session 401 → re-login flow (TS-4) covers the edge case. No new feature, just don't *increase* the TTL during this milestone. |

**Table-stakes complexity total:** Mostly small wiring changes plus one M-sized decision (TS-2: where to keep the password). The bulk of the milestone's work is TS-1 + TS-2 + TS-4.

---

### Differentiators (Beyond Table Stakes)

Features that would set this milestone apart from a minimal pass — but for a single-team internal tool, most of these are over-investment. Listed for completeness so they can be explicitly deferred.

| # | Feature | Value Proposition | Complexity | Depends On | Recommendation |
|---|---------|-------------------|------------|------------|----------------|
| D-1 | **Audit log: which BI user ran which Kinetica statement** | Forensics ("who ran the query that hit prod at 3am?"), debugging permissions, compliance posture even before formal compliance is a requirement. Cheap insurance. | S | `requireAuth` (gives `req.user.sub`), one log helper called from each fetch site | **Recommend including** — even an append-only line per call (timestamp, username, route, statement-hash or first 200 chars of SQL, status) is high signal for low cost. Don't log passwords. Don't log full SQL bodies if they could contain user PII; hashes or truncation is fine. Confidence: MEDIUM (pattern is universal in BI tools; specific format is project choice). |
| D-2 | **Inline "session expired" banner instead of immediate redirect to login** | Less jarring than a hard redirect; the user sees their dashboard greyed out with "please sign in to refresh," types their password in a modal, and lands back on the same page. | M | Frontend 401 handler, login modal component (new) | **Defer.** The hard redirect to `LoginPage` already works (TS-4). Building a modal variant is a UX polish item, not a security or correctness item. Revisit when there's user feedback that the redirect is annoying. |
| D-3 | **Per-call credential refresh / token exchange (refresh-token style)** | If Kinetica supported short-lived tokens issued from a long-lived refresh credential, the BI server could hold only the refresh material and mint short-lived tokens per request. Better blast radius if the session cookie is ever stolen. | L | New Kinetica auth flow (token endpoint) | **Defer / N/A.** Kinetica's HTTP API uses Basic auth for `/execute/sql`; there is no documented token-exchange endpoint at the level this app uses. Adopt this only if/when Kinetica adds it. Confidence: LOW (unverified — no Context7 / docs access this session; if Kinetica ships a token endpoint, revisit). |
| D-4 | **Connection pooling per user against Kinetica** | If we kept warm HTTP/2 connections per user, repeat dashboard loads would shave latency. | M | A `fetch`-replacement layer (e.g., undici Pool) keyed on username | **Defer.** Premature for a team-internal tool with seconds-scale interactivity already. Revisit only if profiling shows connection setup is a bottleneck. |
| D-5 | **"Acting as" / impersonation for admin debugging** | When a user reports "this dashboard is broken for me," an admin could replay the query as that user. | L | A separate admin-creds path (which the milestone is explicitly killing), or Kinetica-side `SET ROLE`-equivalent | **Anti-feature for v1.0** — see AF-3 below. Resurrecting a privileged path defeats the milestone. If genuinely needed later, route via Kinetica's own `GRANT EMULATE USER` or equivalent and gate it as a separate signed-in admin session. |
| D-6 | **Show the user their effective Kinetica permissions in the UI** | "Why can't I see schema X?" answered without a support ticket. | M | A new `/api/kinetica/me/grants` endpoint that runs `SHOW SECURITY` or equivalent under the user's creds | **Defer to a future milestone.** Useful but not on the v1.0 critical path. Note: with passthrough working, the user could also be told "ask your Kinetica admin" without the BI app needing to display grants. |
| D-7 | **Health check that verifies the user's creds are still good** | The frontend could ping a "still authorized?" endpoint when the tab regains focus to pre-empt mid-session 401s. | S | New `/api/auth/check` that runs a cheap `SELECT 1` with stored creds | **Defer unless cheap.** TS-4 already handles the failure path; pre-emptive checking is polish. If included, throttle aggressively (once per N minutes, not per focus event) to avoid hammering Kinetica. |

**Differentiator recommendation summary:** Include D-1 (audit log) only. Defer everything else. The milestone is about correctness (kill the shared admin path), not feature breadth.

---

### Anti-Features (Explicitly NOT Doing)

These look attractive but defeat the milestone or create real risk.

| # | Anti-Feature | Why It Looks Attractive | Why It's Wrong | What To Do Instead |
|---|--------------|-------------------------|----------------|--------------------|
| AF-1 | **Storing credentials in `localStorage` / `sessionStorage` / IndexedDB** | "Easy way to remember the user's password between requests." | Any XSS in the React app reads it instantly. There's no `httpOnly` equivalent on the client side. Defeats the security baseline already established by the httpOnly JWT cookie. | Keep credentials **server-side only** — encrypted in the JWT (cookie is httpOnly) or in a server-side session store. The browser never sees the password after the login POST returns. |
| AF-2 | **Sending credentials back to the client in any response shape** | "Pre-fill the password for re-login" or "let the client retry with the password directly." | Same XSS concern as AF-1 plus exposes the password in browser memory and dev-tools network inspector. The login response in `/api/auth/login` already returns only `{ user: { username } }` — keep that contract. Same for `/api/auth/me`. | Username only on the client. Password lives on the server (encrypted) until the session ends or expires. For re-login, the user retypes their password. |
| AF-3 | **Admin env creds as a fallback when user creds fail** | "What if the user lost permission to a table they had yesterday — let the dashboard still load with admin creds." | Defeats the entire milestone. Kinetica's per-user ACL is the only authorization gate the app respects, and a fallback would silently elevate any user to admin scope on any failure. | Surface the failure (TS-6 for 403, TS-4 for 401). Let the user see "you no longer have access to X" and fix it on the Kinetica side (with their admin), not by re-elevating in the BI tier. |
| AF-4 | **Caching downstream Kinetica responses globally (cross-user)** | Performance — same SQL from two users could share a cache hit. | Cross-user cache hits leak data: User B sees rows User A could read, even though B doesn't have grant on the underlying table. With per-user passthrough, **cache keys must include the username (or be per-session)**, otherwise caching becomes a permissions-bypass vector. | Either skip cross-process caching this milestone (simplest), or scope any cache key to `(username, statement)`. The current code does no app-level caching — leave it that way for v1.0. |
| AF-5 | **Logging passwords (even in error paths)** | Debugging — "why didn't this Basic auth work?" | Passwords in logs are passwords in log aggregators, on disk, and in screenshots support tickets. | Log username + status code + Kinetica error message. Never log the `Authorization` header or the password. Audit log (D-1) follows the same rule. |
| AF-6 | **Putting the password in a non-httpOnly cookie or in a URL query param for the WMS proxy** | The WMS proxy is a GET; it'd "feel natural" to pass things in the URL. | URL query strings are logged by every reverse proxy and the browser history. The current `/api/wms` proxy already uses the Authorization header pattern — keep it. | Read the password from the server-side session in the WMS handler the same way as for SQL; do not include it in any URL. |
| AF-7 | **Long-lived "remember me" extending the session past 8h** | UX nicety — fewer logins. | Compounds the blast radius if the cookie is stolen, and increases the chance the BI session outlives the user's Kinetica account state (rotated password, disabled account). The mid-session 401 path catches it, but a longer TTL means more time before that catches it. | Keep the existing 8h TTL. Revisit only if user feedback demands it, with explicit security review. |
| AF-8 | **Making "test creds" a separate user-visible step on login** | "Show a checkmark that says 'connected to Kinetica.'" | Already implicit in login (TS-3 runs `SELECT 1`). A separate UI step is noise that adds nothing. | Keep login = single click; the existing `verifyKineticaCredentials` is the implicit test. |

---

## Feature Dependencies

```
TS-2 (server-side cred persistence)
    ├──enables──> TS-1 (per-user passthrough on every call)
    │                ├──enables──> TS-4 (mid-session 401 → re-login)
    │                ├──enables──> TS-6 (403 distinct from 401)
    │                └──enables──> TS-8 (drop env-cred fallback)
    │                                  └──enables──> AF-3 enforcement (no fallback)
    ├──enables──> D-1 (audit log; needs `req.user.sub` from session)
    └──conflicts──> AF-1 (localStorage), AF-2 (cred in response)

TS-1 (per-user passthrough)
    └──requires──> existing login flow + `requireAuth` (already shipped)

TS-4 (mid-session re-login)
    ├──requires──> existing UNAUTHORIZED_EVENT + Zustand markUnauthenticated (shipped)
    └──enhanced-by──> TS-5 (username prefill)

TS-6 (403 vs 401 distinction)
    └──requires──> apiFetch update so 403 does NOT dispatch UNAUTHORIZED_EVENT

TS-7 (logout invalidates)
    ├──if-JWT-only──> just clearSessionCookie (already works)
    └──if-server-store──> add session deletion on logout

TS-8 (env-cred drop) ──conflicts──> AF-3 (admin fallback) — by design
```

### Dependency Notes

- **TS-2 is the keystone.** Everything else in the milestone depends on the server having access to the user's password between the login request and subsequent dashboard requests. Pick the storage shape (encrypted-in-JWT vs session-store) early; it gates the rest.
- **TS-1 + TS-4 + TS-8 are the milestone trinity.** Doing TS-1 without TS-8 leaves the admin fallback in place (silent regression). Doing TS-1 + TS-8 without TS-4 means users see raw 401s mid-session (UX regression). All three together = milestone goal.
- **TS-6 is easy to forget but important.** The existing client treats every 401 as "go to login." If Kinetica returns 403 for an authz failure on a specific table, the user must NOT be redirected to login (they'd loop). Build the 403 path before the milestone ships.
- **D-1 (audit log) sits cleanly on top of TS-1.** Adding it costs little once `req.user.sub` is in scope at every fetch site (which is exactly what TS-1 establishes). Free leverage.

---

## MVP Definition

### Launch With (v1.0 milestone scope)

What MUST be in this milestone for it to ship. These map 1:1 to the milestone's three "Active" requirements in `PROJECT.md`.

- [ ] **TS-2** — Server-side credential persistence (encrypted in JWT or session store; pick one in ARCHITECTURE.md). *Keystone.*
- [ ] **TS-1** — All four Kinetica fetch sites use per-user creds: `/api/sql`, `/api/views/:id/materialize`, `/api/kinetica/schemas...`, `/api/wms`. *Headline behavior.*
- [ ] **TS-8** — `KINETICA_USERNAME` / `KINETICA_PASSWORD` removed from env, code, and `requireConfig`. *Headline behavior — the "no fallback" guarantee.*
- [ ] **TS-4** — Mid-session Kinetica 401 → BI session cleared, client redirected to login. *UX baseline.*
- [ ] **TS-6** — 403 from Kinetica surfaces as inline error, NOT as login redirect. *Prevents login loops.*
- [ ] **TS-5** — Username prefilled on the re-login form (in-memory from Zustand is enough). *Small, polishes TS-4.*
- [ ] **TS-7** — Logout still invalidates (verify if a server-side session store is chosen). *Existing behavior must not regress.*
- [ ] **D-1** — Audit log line per Kinetica call (timestamp, username, route, SQL hash or truncation, status). *Cheap, high value, sits on top of TS-1.*

### Add After Validation (v1.x — only if needed)

- [ ] **D-2** — Inline "session expired" modal instead of redirect. *Trigger: user feedback that the redirect is jarring.*
- [ ] **D-7** — Pre-emptive `/api/auth/check` ping on tab focus. *Trigger: users report seeing stale charts before the 401 fires.*
- [ ] Tests around mid-session 401 / 403 paths (should be in v1.0 if time allows; deferrable if scope tightens).

### Future Consideration (v2+)

- [ ] **D-6** — UI surface of effective Kinetica grants. *When users start asking "why can't I see X?" often.*
- [ ] **D-3** — Refresh-token / short-lived token if Kinetica adds a token endpoint. *Driven by Kinetica's own auth roadmap, not the BI app.*
- [ ] **D-4** — Per-user connection pooling. *Driven by performance profiling, not feature demand.*
- [ ] SSO / OIDC layered on top of Kinetica auth. *Already deferred in PROJECT.md "Out of Scope."*

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| TS-1 (per-user passthrough on all calls) | HIGH | MEDIUM | P1 |
| TS-2 (server-side cred persistence) | HIGH (enabler) | MEDIUM | P1 |
| TS-4 (mid-session re-login UX) | HIGH | MEDIUM | P1 |
| TS-5 (username prefill) | MEDIUM | LOW | P1 |
| TS-6 (403 vs 401 distinction) | HIGH (prevents loops) | LOW | P1 |
| TS-7 (logout invalidates) | HIGH | LOW (mostly already works) | P1 |
| TS-8 (drop env-cred fallback) | HIGH (the milestone's *purpose*) | LOW (deletion) | P1 |
| TS-3 (login-time test) | HIGH | LOW (already shipped) | P1 (already done) |
| TS-9 (don't extend TTL) | MEDIUM | NONE (don't change) | P1 (don't regress) |
| D-1 (audit log) | MEDIUM | LOW | P2 (recommend in v1.0) |
| D-2 (inline session-expired modal) | LOW–MEDIUM | MEDIUM | P3 |
| D-6 (effective grants UI) | MEDIUM | MEDIUM | P3 |
| D-7 (pre-emptive auth check) | LOW | LOW | P3 |
| D-3 / D-4 / D-5 | LOW (for v1.0) | HIGH | P3 / N/A |
| AF-1 through AF-8 | NEGATIVE | N/A | DO NOT BUILD |

**Priority key:**
- P1 — Must ship in v1.0. The milestone is incomplete or unsafe without it.
- P2 — Should ship in v1.0 if it lands cheaply (D-1 qualifies).
- P3 — Defer to a later milestone unless trivially cheap.

---

## Competitor / Comparable Pattern Analysis

How comparable BI/data-tooling products handle "per-user passthrough" — used to sanity-check that the recommended scope is in the normal range. Confidence: MEDIUM (pattern knowledge, not freshly verified this session).

| Behavior | Tableau (data source impersonation) | Looker (user attributes / DB creds) | Metabase / Superset | Our Approach (v1.0) |
|----------|--------------------------------------|--------------------------------------|---------------------|---------------------|
| Per-user creds for every downstream query | Yes (when "Run as the user signed into Tableau" is configured) | Yes (per-user DB creds via user attributes) | Optional ("embed with user attributes" / RLS) | **Yes — required (TS-1)** |
| Login-time validation of downstream creds | Yes (auth check on signing in) | Yes | Yes | **Yes — already shipped (TS-3)** |
| Mid-session re-auth on downstream failure | Yes — boots to login or shows re-auth prompt | Yes — typically a re-login banner | Yes — usually session-expired flow | **Yes (TS-4)** |
| Distinct UX for authn vs authz failure | Yes — "permission denied on table X" is inline | Yes | Yes | **Yes (TS-6)** |
| Audit log of who ran what | Yes (admin views) | Yes | Yes | **Yes — minimal (D-1)** |
| Admin "act as user" | Yes (Tableau "Run as different user") | Yes (sudo / become user) | Yes (limited) | **No — anti-feature (AF-3, D-5)** for v1.0 |
| Credentials cached client-side | No (server-side only) | No | No | **No (AF-1, AF-2)** |
| Shared admin fallback for failed user creds | No (would defeat passthrough) | No | No | **No (AF-3)** |

**Takeaway:** The recommended v1.0 scope is squarely in line with how mainstream BI tools handle this pattern. Nothing exotic; nothing missing.

---

## Open Questions for ARCHITECTURE.md / REQUIREMENTS.md

These are scope-affecting choices that FEATURES.md flags but doesn't decide.

1. **TS-2 storage shape:** encrypt-in-JWT vs server-side session store. Tradeoff: cookie size + client-trip cost vs server state + revocation simplicity. For a single-process Express app on internal use, encrypt-in-JWT is simpler; for any future multi-process deployment, server-side store wins.
2. **D-1 audit log destination:** stdout / file / SQLite table. Pick whichever the team will actually look at.
3. **TS-6 403 surfacing UI:** inline per-widget error vs page-level banner. Defer to UX call; functionally either works.
4. **Encryption key for stashed password (if encrypt-in-JWT chosen):** reuse `AUTH_SECRET` or introduce a sibling `CRED_ENCRYPTION_KEY`? Splitting them is cleaner (signing vs encrypting are different concerns) but adds an env var.

---

## Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| Existing-codebase-anchored items (TS-1, TS-3, TS-4, TS-5, TS-7, TS-8, TS-9) | HIGH | Read directly from `auth.ts`, `index.ts`, `client.ts`, `auth.ts` (store), `LoginPage.tsx`. |
| Anti-features (AF-1 through AF-8) | HIGH | Universal security baselines (no creds in localStorage, no creds in URLs, no shared admin fallback when the milestone *is* killing it). |
| TS-2 storage-shape recommendation | MEDIUM | Both shapes are well-established patterns; the choice is project-specific and called out as an open question. |
| Differentiators (D-1 through D-7) | MEDIUM | Pattern knowledge from BI tooling; not freshly verified against current product docs this session. |
| D-3 (Kinetica token endpoint availability) | LOW | Could not verify current Kinetica docs (no Context7 / WebSearch this session). Treated as deferred / N/A pending verification. |
| Competitor table | MEDIUM | Pattern-level claims about Tableau/Looker/Metabase/Superset behaviors; correct in shape, not necessarily reflecting their latest 2026 UI. |

---

## Sources

- Existing codebase (HIGH): `kinetica_bi/server/src/auth.ts`, `kinetica_bi/server/src/index.ts`, `kinetica_bi/src/api/client.ts`, `kinetica_bi/src/store/auth.ts`, `kinetica_bi/src/components/LoginPage.tsx`.
- Project intent (HIGH): `.planning/PROJECT.md`, `.planning/STATE.md`.
- Pattern knowledge (MEDIUM, training-data based; web search unavailable this session): standard Express + JWT + httpOnly cookie patterns; "credential passthrough" / "user attributes" / "RLS" patterns from Tableau, Looker, Metabase, Superset; OWASP guidance on credential storage and XSS exposure of client-side storage.
- Items flagged LOW (Kinetica token-exchange endpoint availability) should be verified with current Kinetica REST API docs before committing to D-3 in any future milestone.

---
*Feature research for: per-user Kinetica credential passthrough, v1.0 milestone*
*Researched: 2026-04-27*
