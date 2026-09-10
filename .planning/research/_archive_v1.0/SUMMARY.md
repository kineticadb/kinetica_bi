# Project Research Summary

**Project:** Kinetica BI — v1.0 Authentication & Per-User Access
**Domain:** Per-user credential passthrough on an existing Express 4 + JWT-cookie BI proxy to a Kinetica HTTP-Basic API
**Researched:** 2026-04-27
**Confidence:** HIGH (codebase-anchored on every architectural decision; medium on the two open questions called out below)

## Executive Summary

This is **not a greenfield product** — it is a focused security/correctness milestone on top of an already-shipped Express + React BI app. The auth bootstrap (login, JWT cookie, `requireAuth`, 401 → re-login) is in place. What v1.0 must add is one capability: carry the BI user's Kinetica password between requests so the server can replay `Authorization: Basic …` per user on every downstream call (SQL proxy, schema/table/column discovery, view materialize, WMS proxy), and then delete the shared `KINETICA_USERNAME` / `KINETICA_PASSWORD` admin fallback. All four researchers converge on the same shape: **server-side encrypted SQLite session row keyed by an opaque `sid`, with the JWT cookie payload becoming `{ sub, sid }`** and AES-256-GCM provided by Node's built-in `node:crypto` (no new npm dependencies).

The recommended approach is conservative for a reason. Stack and Architecture both reject (HIGH confidence) the "embed the password in a JWS payload" shortcut — JWS is signed, not encrypted, and httpOnly is access-control sugar, not confidentiality. JWE via `jose` is a defensible alternative but trades a real new dependency and a re-key of the cookie surface for benefits this single-process SQLite app does not need. Server-side row matches the existing persistence pattern in `db.ts`, gives clean revocation on logout / mid-session 401, and isolates the password from the cookie.

The dominant risks are not cryptographic — they are refactor-completeness and UX. Pitfalls 7, 9, 10, and 14 cluster around the same failure mode: **silently still using admin creds, or treating Kinetica's 401/403 as the BI server's 401**. The milestone trinity (TS-1 + TS-8 + TS-4 from FEATURES) ships together or it ships broken: per-user passthrough on every call, env-cred fallback removed, mid-session re-login UX wired. Anything less and either the milestone goal is silently undone (admin still in use somewhere) or users see raw 401 storms when their Kinetica creds rotate.

## Key Findings

### Recommended Stack

Almost no dependency change. The existing pins (`express ^4.19.2`, `jsonwebtoken ^9.0.3`, `cookie-parser ^1.4.7`, `better-sqlite3 ^12.8.0`) all stay. The new capability is supplied entirely by Node's stdlib `node:crypto` (AES-256-GCM, HKDF). The implementation footprint is roughly 60 lines of new server code and one new SQLite table.

**Core technologies (unchanged, all current):**
- `jsonwebtoken ^9.0.3` — wraps the now-pointer cookie payload `{ sub, sid }` (HIGH, latest 2026-04-16)
- `better-sqlite3 ^12.8.0` — gains a new `sessions(sid, username, ciphertext, iv, auth_tag, expires_at, created_at)` table
- `node:crypto` (Node 24.14.1 verified) — AES-256-GCM encrypt/decrypt; HKDF derives the data key

**Explicitly NOT adopted:** `iron-session`, `@hapi/iron`, `express-session`, `connect-better-sqlite3` / `better-sqlite3-session-store` (both unmaintained since 2022), `connect-sqlite3` (introduces a second SQLite driver), `jose` purely to switch to JWE, and — categorically — putting credentials into the JWS payload.

### Expected Features — the Milestone Trinity

The features researcher identifies a **table-stakes trinity** (TS-1, TS-2, TS-8) that defines milestone-critical scope:

**Must have (the trinity):**
- **TS-1** — User's Kinetica creds replayed on every downstream call (headline behavior)
- **TS-8** — Shared `KINETICA_USERNAME` / `KINETICA_PASSWORD` removed from env, code, and `requireConfig` (the "no fallback" guarantee)
- **TS-2** — Server-side persistence of the password between requests (keystone enabler)

Plus supporting must-haves: TS-4 (mid-session 401 → clean re-login), TS-6 (403 distinct from 401), TS-5 (username prefilled on re-login from in-memory Zustand state), TS-7 (logout invalidates server-side row). TS-3 (login-time `SELECT 1`) and TS-9 (don't extend 8h TTL) are already present.

**Should have (cheap differentiator):** D-1 — per-Kinetica-call audit log line.

**Defer:** D-2, D-6, D-7, D-3, D-4 (and D-5 is an explicit anti-feature for v1.0).

**Anti-features:** AF-1 through AF-8, particularly AF-1 (creds in `localStorage` / Zustand persist), AF-3 (admin fallback when user creds fail — defeats the milestone), and AF-4 (cross-user response cache — leaks data).

### Architecture Approach

A thin keystone abstraction plus a narrow refactor. Login validates as today, then writes a `sessions` row encrypted with AES-256-GCM. `requireAuth` decrypts on each request and attaches `req.user.creds`. Every Kinetica HTTP call is funneled through a new `kineticaCall(req, …)` helper that builds the Basic header, posts to Kinetica, and classifies responses into `KineticaAuthError` vs. `KineticaUpstreamError`. A global Express error middleware reacts to `KineticaAuthError` by destroying the session row, clearing the cookie, and returning a 401 with a code the frontend can distinguish.

**Major components:**
1. **`sessionStore.ts` (new)** — CRUD over `sessions` table; AES-256-GCM encrypt/decrypt; TTL-based GC.
2. **`kineticaCall.ts` (new)** — `kineticaSqlAsUser` for `/execute/sql`, `kineticaFetchAsUser` for `/wms`; classifies auth failures.
3. **`auth.ts` (modified)** — `SessionPayload` becomes `{ sub, sid }`; `requireAuth` hydrates `req.user.creds`.
4. **`index.ts` (modified)** — replaces the **5 distinct Kinetica call sites** (lines 249, 319, 401, 433 plus the local `kineticaSql` helper) with `kineticaCall(req, …)`; deletes `kineticaUser` / `kineticaPassword` consts; narrows or removes `requireConfig`; mounts the global error middleware. Migrates `/api/auth/me` onto the same lookup as `requireAuth` so it cannot 200 against a deleted session row.
5. **`db.ts` (modified)** — adds the `sessions` table to the boot DDL.

### "Watch Out For" — Combined Top-Severity Callouts

1. **Plaintext password in any JWS payload** (Pitfall 1, Stack hard reject) — JWS is signed, not encrypted; httpOnly does not protect against log exfil, browser extensions, or backup snapshots.
2. **Forgetting one Kinetica call site during the refactor** (Pitfall 7) — there are **5** call sites (`index.ts` lines 249, 319, 401, 433 plus the `kineticaSql` helper). Missing one leaves admin creds silently in use, undoing the milestone invisibly. Mitigation: delete the `kineticaUser` / `kineticaPassword` module-level consts so missed sites become TypeScript compile errors.
3. **`/api/auth/me` migration trap** (Architecture §1, Anti-Pattern callout) — `/api/auth/me` today does its own `readSession` directly, bypassing `requireAuth`. After the session table exists, `/me` must also confirm the row is alive — otherwise stale-cookie users get `200 { user }` from `/me` followed by `401` from every real call.
4. **`requireConfig` lingers after env vars are deleted** (Pitfall 14) — must narrow to `requireKineticaUrl` (or fold into boot-time validation) when `KINETICA_USERNAME` / `KINETICA_PASSWORD` are removed, otherwise every guarded route returns the misleading "Missing KINETICA_USERNAME, ..." 500.
5. **Conflating Kinetica 401 and 403** (Pitfalls 9 + 10) — frontend currently treats every 401 as "go to login." Post-refactor, two distinct conditions can produce 401, and Kinetica also returns 403 for "you're authenticated but not authorized to read table X." Tag 401 with `code: "REAUTH_REQUIRED"`; 403 stays 403; frontend three-way dispatch.

## Cross-Researcher Agreement & Open Questions

### Where the four researchers AGREE (HIGH confidence)

- **Storage shape:** server-side encrypted SQLite session row keyed by an opaque `sid`; JWT payload `{ sub, sid }`. Stack, Architecture, Pitfalls converge.
- **Cipher:** AES-256-GCM; fresh 12-byte IV per row; 16-byte auth tag stored alongside.
- **No JWS-embedded credentials:** unanimous hard reject.
- **5 call sites to refactor in `index.ts`** (lines 249, 319 helper, 401, 433): Architecture and Pitfalls enumerate identically.
- **Single-helper abstraction (`kineticaCall`):** type-system enforced (the helper REQUIRES `req`) so "forgot a call site" is a compile error.
- **Delete `kineticaUser` / `kineticaPassword` module-level consts** — TypeScript surfaces every missed call site at compile time.
- **`/api/auth/me` must move onto the session-row lookup** (Architecture explicit; Pitfall 13 covers the same family).
- **8h TTL stays:** Features TS-9 + Pitfall 5 + Stack all agree.
- **Logout must destroy the server-side session row.**

### Where the researchers DISAGREE (planner must resolve)

- **Encryption-key sourcing.** Pitfalls 2 recommends a **separate `SESSION_ENCRYPTION_KEY` env var** validated as exactly 32 bytes at boot. Stack proposes **deriving the encryption key from `AUTH_SECRET` via HKDF**. Both are defensible: Pitfalls' separation is the more conservative posture (independent rotation); Stack's HKDF is operationally simpler. **Recommendation:** treat as a Phase 1 design decision; default to Pitfalls' two-env-var approach unless ops explicitly prefers single-secret simplicity. Document in PROJECT.md key decisions either way.
- **Phase decomposition granularity.** Pitfalls proposes a **6-phase decomposition** (storage primitive; login/session wiring; downstream call refactor; mid-session UX; remove admin env; ops hardening) with each pitfall mapped to a phase. Architecture proposes a **3-phase decomposition** (persist creds; refactor call sites; mid-session UX + env cleanup). **Recommendation: follow Architecture's 3-phase shippable-increments structure as the roadmap shape, and use Pitfalls' 6-phase decomposition as a guard-task checklist within each phase.** The two are not competing — Architecture's are "what gets deployed," Pitfalls' are "what gets verified."

### Open question the planner must resolve

- **D-3: does Kinetica expose a token-exchange endpoint?** Features research could not verify (LOW confidence; WebSearch was denied). **If Kinetica DOES expose a short-lived token endpoint, the storage decision changes materially** — token replay is meaningfully worse than password replay (lateral movement, no out-of-band rotation). **Recommendation:** schedule a 30-minute spike at the start of Phase 1 to query current Kinetica REST API docs (the new MCP context7 server is now available for this). If the endpoint exists, Phase 1 design adapts (encrypt token + refresh material instead of password). Document the result in PROJECT.md.

## Implications for Roadmap

Based on combined research, the recommended phase structure follows Architecture's 3-phase shippable-increment shape with Pitfalls' guard-tasks embedded as verification within each phase.

### Phase 1: Persist user creds in encrypted server-session

**Rationale:** TS-2 is the keystone — every other table-stakes feature depends on the server having access to the user's password between login and subsequent requests. Kicking it off with the 30-minute Kinetica-token-endpoint spike resolves the open question before the design hardens.

**Delivers:** New `sessions` table; `sessionStore.ts` with AES-256-GCM encrypt/decrypt and TTL-based GC; `auth.ts` enhanced so `requireAuth` decrypts and attaches `req.user.creds`; login writes a session row; logout destroys it; `/api/auth/me` migrated onto the same lookup. Env contract gains `SESSION_ENCRYPTION_KEY` (or HKDF derivation — see decision above) documented in `.env.example`. App still uses admin env creds for downstream calls; nothing user-visible changes yet.

**Addresses (FEATURES):** TS-2, TS-7, TS-9.

**Avoids (PITFALLS):** Pitfalls 1, 2, 3, 6, 13 (`/api/auth/me` trap), 19 (timezone), 23 (login form retains password).

**Verification gate:** cookie value cannot be base64-decoded into anything resembling a password; logout-then-replay returns 401; the `sessions` table holds ciphertext.

### Phase 2: Refactor every Kinetica call site to use req.user.creds

**Rationale:** Once Phase 1 is in, the per-user creds are available on `req`. Phase 2 is the headline behavior. After this phase the milestone is functionally complete (per-user permissions enforced) even though the env-var fallback and mid-session UX cleanup haven't landed.

**Delivers:** New `kineticaCall.ts` with `kineticaSqlAsUser`, `kineticaFetchAsUser`, `KineticaAuthError`, `KineticaUpstreamError`. `index.ts` updated at all 5 call sites. Local `kineticaSql` helper deleted. Audit log line per call (D-1) wired in.

**Addresses (FEATURES):** TS-1, TS-3 (no regression), D-1.

**Avoids (PITFALLS):** Pitfall 7 (forgotten call site), 8 (logging credentials), 16 (materialize requires DDL — detection here), 17 (login response leaks Kinetica detail).

**Verification gate:** `git grep -n "Buffer.from\|kineticaUser\|kineticaPassword" server/src/index.ts` returns zero matches outside the helper; integration tests assert outbound Authorization matches the logged-in user's creds.

### Phase 3: Mid-session auth-failure UX + admin env cleanup

**Rationale:** Phase 2 leaves two threads dangling: the env-var fallback and mid-session UX. Combining them keeps the deploy story tight (one cutover, not three).

**Delivers:** Global Express error middleware classifying `KineticaAuthError` (→ destroy session + 401 + `code: "REAUTH_REQUIRED"`) vs. `KineticaUpstreamError` (→ 502 sanitized). Frontend `apiFetch` three-way dispatch (REAUTH_REQUIRED vs. plain 401 vs. 403 inline). `KINETICA_USERNAME` / `KINETICA_PASSWORD` deleted everywhere. `requireConfig` narrowed to `requireKineticaUrl` or replaced. Username prefilled on re-login form. Side-script discovery + service-account decision if materialize requires DDL perms (Pitfall 16).

**Addresses (FEATURES):** TS-4, TS-5, TS-6, TS-8.

**Avoids (PITFALLS):** Pitfalls 5, 9, 10, 11, 12, 14, 15, 18, 21, 22.

**Verification gate:** PITFALLS.md "Looks Done But Isn't" checklist; `unset KINETICA_USERNAME KINETICA_PASSWORD && start the server && exercise every endpoint` all green; rotate a test user's Kinetica password and confirm clean re-login; craft a 403 from Kinetica and confirm inline permission error (not redirect).

### Phase Ordering Rationale

- **Phase 1 first** because TS-2 is the keystone and the only phase introducing crypto primitives (isolating those decisions makes them reviewable).
- **Phase 2 second** because the call-site refactor is mechanical once `req.user.creds` exists; ending Phase 2 with the milestone functionally complete provides a fallback if Phase 3 slips.
- **Phase 3 last** because cleanup + UX share verification surface (the same error-middleware code path).

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1 — flagged for a 30-minute Kinetica-token-endpoint spike** at kickoff. (Now feasible: context7 MCP server is available for library/API docs lookup, which was unavailable during the original FEATURES research.)
- **Phase 1 — encryption-key sourcing decision** (separate env var vs. HKDF) — Stack and Pitfalls disagree; planner picks before code lands.

Phases with standard patterns (skip research-phase):
- **Phase 2** — well-documented Express handler refactor; the hard work is in Phase 1.
- **Phase 3** — well-documented Express 4 error-middleware pattern; standard frontend dispatch; standard env-var deletion.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All package versions verified live via `npm view` 2026-04-27; `node:crypto` AES-256-GCM verified on Node 24.14.1. |
| Features | MEDIUM | Existing-codebase items (TS-1, TS-3–TS-9) HIGH; differentiator/pattern claims MEDIUM; D-3 Kinetica token endpoint LOW (flagged). |
| Architecture | HIGH | Every line/route/file directly inspected. JWE-vs-server-session judgment is MEDIUM-HIGH; rest is mechanical. |
| Pitfalls | HIGH | All 23 pitfalls cite concrete files/lines or named env vars from the actual repo. |

**Overall confidence:** HIGH for the recommended architecture; MEDIUM on two specific decisions (encryption-key sourcing, Kinetica token-endpoint availability) explicitly flagged for the planner.

### Gaps to Address

- **Kinetica token-exchange endpoint availability** — 30-minute spike in Phase 1; document outcome in PROJECT.md.
- **Encryption-key sourcing** — Phase 1 design decision; default to separate `SESSION_ENCRYPTION_KEY` env var.
- **Materialize DDL permission semantics** (Pitfall 16) — test in Phase 2 with a least-privileged Kinetica user; if it fails, decide between (a) per-user GRANT in Kinetica, (b) service-account pattern for materialize only, or (c) replacing materialized views with regular views.
- **Side-script audit** (Pitfall 15) — `git grep -rn "KINETICA_USERNAME\|KINETICA_PASSWORD"` across the entire repo plus Helm/Terraform/CI in Phase 3.
- **Deploy migration safety** (Pitfall 13) — add a `v: 1` field to `SessionPayload` and 401 on mismatch, OR rotate `AUTH_SECRET` as part of the deploy. Document in Phase 3 deploy runbook.

## Sources

### Primary (HIGH confidence)
- Existing repo files: `kinetica_bi/server/src/auth.ts`, `index.ts` (462 lines, call sites at 249/319/401/433), `db.ts`; `kinetica_bi/src/api/client.ts` (5–11), `store/auth.ts`, `components/LoginPage.tsx`, `App.tsx` (24–28, 30–36); `.planning/PROJECT.md`, `STATE.md`, `codebase/CONCERNS.md`.
- npm registry queried 2026-04-27 via `npm view`: `jose@6.2.3`, `iron-session@8.0.4`, `@hapi/iron@7.0.1`, `express-session@1.19.0`, `connect-better-sqlite3@0.1.8` (last 2022), `better-sqlite3-session-store@0.1.0` (last 2022), `connect-sqlite3@0.9.16`, `jsonwebtoken@9.0.3`, `express@5.2.1`, `better-sqlite3@12.9.0`.
- Node 24.14.1 runtime verification of `node:crypto` AES-256-GCM and HKDF.
- Express 4 error-middleware signature `(err, req, res, next)`.
- JWS / JWE / RFC 7515 spec.

### Secondary (MEDIUM confidence)
- Pattern knowledge from BI tooling (Tableau, Looker, Metabase, Superset).
- OWASP Session Management and Cryptographic Storage Cheat Sheets.
- Standard Express + JWT + httpOnly cookie patterns.

### Tertiary (LOW confidence — flagged for validation)
- Kinetica token-exchange endpoint availability — Phase 1 spike (now feasible via context7 MCP).
- Kinetica's exact 401 vs. 403 semantics across all endpoints — verified via Phase 2 integration testing.

---
*Research completed: 2026-04-27*
*Ready for roadmap: yes*
