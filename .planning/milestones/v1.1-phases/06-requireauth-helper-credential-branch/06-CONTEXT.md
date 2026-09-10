# Phase 6: requireAuth + Helper Credential Branch - Context

**Gathered:** 2026-05-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the `kinetica.ts` helper layer credential-type-aware so OIDC sessions send `Authorization: Bearer <access_token>` and password sessions continue to send `Authorization: Basic <b64(user:pass)>` — without changing the helper's public API beyond accepting `req` instead of `req.user!.creds`. Prevent expired bearer tokens from ever reaching Kinetica via a proactive `exp` check inside `getSession`. Stamp `auth_mode` on every per-call audit log line. Add a structured boot-time announcement (and unauthenticated reachability probe) so operators have a fighting chance to diagnose Kinetica OIDC trust misconfig (PITFALL I-06).

Backend-only. No frontend changes (Phase 7), no boot wipe (Phase 8), no session schema changes (Phase 4 already shipped them).

Covers requirements MODE-04, UX-04, UX-05, UX-07, OBS-02.

</domain>

<decisions>
## Implementation Decisions

### `buildAuthHeader` Bearer/Basic branch
- **Single function owns the branch.** Move `buildAuthHeader` from `kinetica.ts:47-48` to a credential-type-aware form per ARCHITECTURE.md §"`kinetica.ts` Changes":
  ```typescript
  const buildAuthHeader = (req: AuthedRequest): string => {
    const { credentialType, creds } = req.user!;
    if (credentialType === "oidc") return `Bearer ${creds.token}`;
    return `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString("base64")}`;
  };
  ```
- **Callsite change is mechanical:** `Authorization: buildAuthHeader(req.user!.creds)` → `Authorization: buildAuthHeader(req)` in both `kineticaSql` (line 148) and `kineticaWms` (line 254). Two line edits.
- **`if (creds.password)` is forbidden** as the discriminant (PITFALL I-01). Branch on `credentialType === 'oidc'` only.
- **No callsite outside `kinetica.ts`** changes — `verifyKineticaCredentials` (auth.ts:50-95) keeps its inline `Basic` header because that path is password-mode-only by definition (no session yet, no creds.token). Out of scope to refactor.

### Token expiry detection (PITFALL I-07, SC3)
- **Check lives inside `getSession`** (sessionStore.ts:160), as a third step after `decryptSecret` and `idToken` decrypt. Reuses the existing decrypt-failure-drops-row pattern symmetrically: if access token is JWT and `exp` is past (with skew), `deleteStmt.run(sid)` + return null. The `requireAuth` step-6 null branch (auth.ts:169-175) handles the response identically — no new dispatch.
- **Check `access_token.exp` only.** The id_token is stored for D-2 future-claim-surfacing, not as the credential. Single source of truth = the token actually sent to Kinetica.
- **Decode-only, no signature reverify.** Base64url-decode the middle JWT segment + `JSON.parse`. Per PITFALL I-07: "decode the token (without re-verifying signature — it was verified at callback time)." Cheap; AES-256-GCM auth tag protects integrity at rest.
- **Clock-skew tolerance: 30 seconds.** Matches Phase 5's openid-client `clockTolerance: 30` (PITFALL T-06). Same window across callback verify and request-time exp re-check — no asymmetric tolerance.
- **Order inside `getSession`:** existing isExpired (row TTL) → secret decrypt → id_token decrypt → NEW: access_token exp check (OIDC only). All four use `deleteStmt.run(sid) + return null` on failure.
- **Schema unchanged.** No new `token_expires_at` column — Phase 4 owns DDL, decode-only is cheap enough to do per request.

### Opaque access token handling (PITFALL T-05, Phase 5 STATE.md Q2)
- **Try-decode helper, single failure mode:** split on `.`, base64url-decode middle, `JSON.parse`, read `exp` (number). Any failure (≠3 segments, malformed b64, malformed JSON, missing/non-numeric exp) → return null/sentinel meaning "opaque or unparseable."
- **Opaque → skip the proactive exp check.** Token is forwarded; if Kinetica rejects with 401, the existing reactive REAUTH chain (TS-13) fires. SC3's wording — "when the stored access token's `exp` claim is in the past" — is satisfied vacuously when there is no `exp` claim. App still works for opaque-token IdPs.
- **One-time warning at session creation in `/oidc/callback`** (Phase 5 code, edited as part of Phase 6 because the missing-exp path first matters here). Structured log: `console.warn(JSON.stringify({ ts, event: "oidc_opaque_access_token", message: "access_token is opaque (not a JWT) — proactive expiry detection disabled for this session; verify Kinetica trust accepts opaque tokens", username }))`. One per login, not per request.
- **No `token_format` audit field.** `auth_mode: "oidc"` plus the boot/login warnings carry enough signal; runbook (Phase 8) explains the failure mode.

### Audit log `auth_mode` field (OBS-02 / D-4)
- **Top-level field, name `auth_mode`, values `"password" | "oidc"`.** Matches SC5 verbatim. No nested `context` object.
- **No `auth_scheme: "basic" | "bearer"`** — derivable 1:1 from `auth_mode`; redundancy is noise.
- **Source: `req.user.credentialType`** (already attached by `requireAuth` step-10, auth.ts:191). Threaded into `baseAudit` alongside `username`/`route`/`op` in both `kineticaSql` (line 135) and `kineticaWms` (line 243).
- **Add to `emitAudit`'s explicit-key enumeration** (kinetica.ts:62-71). Phase 02-02 decision: "explicit key enumeration (not spread) to guarantee no extra fields leak." Append `auth_mode: fields.auth_mode` to the `JSON.stringify` object.
- **Required, not optional.** `kineticaSql`/`kineticaWms` only run after `requireAuth`, so `req.user.credentialType` is guaranteed present. Type signature: non-optional in the audit-line internal type. SC5 reads "every Kinetica-call audit log line includes" — unconditional.

### Kinetica trust boot signal (PITFALL I-06)
- **Two parts, both in `createApp()` immediately after `validateOidcEnv()` + `initOidcClient()` succeed:**

  1. **Structured contract log** (pre-empted from Phase 8 SC5):
     ```
     console.log(JSON.stringify({
       ts, level: "info", event: "oidc_boot",
       message: "Kinetica must be configured to trust tokens from <issuer> with audience <client_id>",
       issuer, audience: clientId
     }))
     ```

  2. **Unauthenticated reachability probe**: `GET ${KINETICA_URL}/version` (no Authorization header). Confirms DNS/TLS/connectivity at boot. NOT an OIDC-trust test (no token to send) — but catches the most common boot-time misconfigs (wrong KINETICA_URL, expired cert, firewall) early.

- **Probe failure → structured warning, continue boot.** Don't fail-fast on Kinetica unreachability. Same posture as v1.0 ("don't crash if downstream is briefly unavailable"). Log: `console.warn(JSON.stringify({ event: "kinetica_unreachable", url: KINETICA_URL, status, message }))`. Operators see it; restart-during-Kinetica-maintenance still brings the BI app up.
- **OIDC mode only.** Gated inside `if (authMode === "oidc")`. Password mode worked in v1.0 without a boot probe — adding one now would be scope creep.
- **No boot-time session sweep on URL mismatch.** `requireAuth` (auth.ts:142-147 + 177-182) already detects operator-changed-`KINETICA_URL` per request. Phase 8 owns AUTH_MODE-change wipe via MODE-05; URL-change wipe is out of scope.
- **Probe URL is `/version`** (the Kinetica version endpoint, well-established public path). If that's not reachable on a deployment, fall back to `/show/system/properties` is a planning-time spike. Path can be configurable via `KINETICA_HEALTHCHECK_PATH` if needed — Claude's discretion.

### Logout (UX-07 / TS-15) — verify only, no code change
- **`POST /api/auth/logout` (index.ts:153-161) is already correct.** Destroys session row via `deleteSession(decoded.sid)` + clears `kbi_session` cookie. Identical for both modes — `credential_type` doesn't matter to logout.
- **No `end_session_endpoint` call.** Locked decision (UX-07): user remains logged in at IdP for SSO continuity.
- **Phase 6 adds tests** asserting both modes destroy the session row + clear the cookie identically. SC4 verification.
- **`U-04` (logout-not-awaited)** is flagged for Phase 7 (frontend `await fetch('/api/auth/logout')`). Backend behavior is fine.

### Test strategy
- **Unit test `buildAuthHeader`** with both `req.user.credentialType` values; assert `Bearer <token>` vs `Basic <b64>` exactly. Lock the discriminant.
- **Unit test `getSession`'s new exp branch:** create OIDC session with stub access token whose `exp` is past → assert `getSession` returns null AND the row is deleted. With `exp` future → assert decoded `SessionRow`. With opaque token (non-JWT string) → assert `SessionRow` returned (no proactive drop), forwarded to Kinetica.
- **Route-level supertest** via `tests/auth.kinetica-call.spec.ts` (or extend existing): seed an OIDC session row + valid JWT cookie + mock Kinetica; assert outgoing `Authorization` header is `Bearer <token>` (capture mock fetch first arg). Same test for password session asserts `Basic <b64>`. Verifies SC1 + SC2 end-to-end.
- **Audit log capture test**: spy `console.log`, run an OIDC and a password Kinetica call, parse the JSON line, assert `auth_mode` field present + correct value. Verifies SC5.
- **Logout symmetry test**: run logout in both modes, assert session row deleted + cookie cleared identically. Verifies SC4.
- **Boot probe test**: stub fetch to KINETICA_URL/version, run `createApp()` in OIDC mode, assert one info log (oidc_boot) + one fetch attempt; rejected promise → assert one warn log (kinetica_unreachable) + boot still resolves.
- **Test files (Claude's discretion):** likely a new `tests/kinetica.creds.spec.ts` (helper-level) and extending `tests/sessionStore.crud.spec.ts` (getSession exp branch). Final shape is the planner/executor's call.

### Carrying forward from prior phases (already locked, do not re-decide)
- **`AuthedRequest` flat shape** (Phase 4): `req.user.credentialType` at top + `creds.password`/`creds.token` always-strings (empty in inactive mode). No discriminated union — the inline guard in `buildAuthHeader` is the only consumer that branches.
- **JWT cookie `v: 1` unchanged** (PITFALL I-05). The credential discriminant lives in the session row, not the cookie payload.
- **Existing 401-REAUTH chain reused unchanged for token expiry** (TS-13): `KineticaAuthError` → `errorMiddleware` → `401 { code: "REAUTH_REQUIRED" }` → `UNAUTHORIZED_EVENT` → frontend redirects to `/api/auth/oidc/start` (Phase 7). Phase 6 produces the local `null` from getSession → REAUTH path; the chain handles the rest.
- **No PKCE, no refresh-token storage, no RP-initiated logout** (FEATURES AF-1, AF-2, AF-4).
- **OIDC sessions exist** (Phase 5) with `credential_type='oidc'`, `secret = access_token`, `idToken` populated. Phase 6 reads from this contract.
- **`encryptSecret`/`decryptSecret`** (Phase 4 rename) used implicitly by `getSession` — Phase 6 doesn't call AES helpers directly.
- **Audit-line invariants (Phase 02-02):** explicit-key enumeration in `JSON.stringify` (no spread); no SQL body, no Authorization header, no token text in any log line. The new `auth_mode` field follows: bare enum, not the token itself.
- **`req.requestId` populated by `requireAuth`** for downstream audit correlation — Phase 6 doesn't change this.
- **Tests in `kinetica_bi/server/tests/`**, in-memory SQLite per spec, supertest for routes, `vi.stubEnv` for env mutations.

### Claude's Discretion
- Internal naming of the JWT-decode helper (e.g., `decodeJwtExp`, `tryReadAccessTokenExp`, etc.) — co-locate near `getSession` or in a small new util.
- Exact boot-probe timeout (suggest 5s; planner picks).
- Whether the boot probe URL is hardcoded `/version` or env-configurable via `KINETICA_HEALTHCHECK_PATH` — recommend hardcoded with TODO comment; planner decides.
- Whether the opaque-token warning lives in `oidc.ts` (where the callback already imports console-emit patterns) or in `index.ts` (where the route handler is) — Claude's call.
- Test file organization: split `tests/kinetica.creds.spec.ts` from existing `tests/kinetica.helpers.spec.ts`, or extend the existing file. Cohesion over file count.
- Whether to type the `emitAudit` parameter `auth_mode` as a string-literal union (`"password" | "oidc"`) or pull from the existing `AuthedRequest['user']['credentialType']` — planner's call.
- Whether the boot-probe warning includes the response body snippet or just status — recommend status only (avoid leaking Kinetica internals into BI logs).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Helper credential branch
- `.planning/research/ARCHITECTURE.md` §"`kinetica.ts` Changes" (line 239+) — exact `buildAuthHeader(req)` signature, Bearer/Basic branch, callsite change pattern (`buildAuthHeader(req.user!.creds)` → `buildAuthHeader(req)`)
- `.planning/research/ARCHITECTURE.md` §"`requireAuth` Changes" (line 143+) — flat `AuthedRequest` shape + step-10 `credentialType` assignment rationale (already shipped Phase 4; Phase 6 consumes it)
- `.planning/research/FEATURES.md` TS-11 (Bearer header in helpers — In scope, this phase) — defines the integration point between auth mode and data access

### Token expiry detection
- `.planning/research/PITFALLS.md` I-07 (`requireAuth` sends expired bearer token — HIGH; Phase 6 owns the proactive check) — recommends `getSession` decode-only check, alternatives (token_expires_at column), test pattern
- `.planning/research/PITFALLS.md` T-06 (clock skew — `clockTolerance: 30` matches Phase 5 callback verify; Phase 6 reuses the same window)
- `.planning/research/FEATURES.md` TS-13 (token expiry → REAUTH chain — In scope as a verify-only) — confirms the existing 401-REAUTH dispatch is reused unchanged after the proactive null

### Opaque access token handling
- `.planning/research/PITFALLS.md` T-05 (opaque access token warning — log warning, don't abort)
- `.planning/STATE.md` v1.1 Open Question Q2 — RESOLVED in 05-RESEARCH.md: "detect and warn (not abort); Kinetica token format is deploy-time operator concern" (Phase 6 implements the warning site)

### Audit log field
- `.planning/research/FEATURES.md` D-4 (auth_mode in audit log — Recommend including; one extra JSON field)
- `.planning/research/PITFALLS.md` p738 (typed-error taxonomy notes — references `auth_scheme` as alternative; Phase 6 chose bare `auth_mode` for simplicity)
- Existing audit invariants: Phase 02-02 STATE.md decisions ("explicit key enumeration in JSON.stringify (not spread) to guarantee no extra fields leak into audit record")

### Kinetica trust boot signal
- `.planning/research/PITFALLS.md` I-06 (typed-error: Kinetica OIDC trust loop — HIGH; Phase 6 + Phase 8 share ownership) — recommends startup test-call + structured warning + runbook
- `.planning/research/PITFALLS.md` O-04 (Kinetica OIDC trust not configured — the #1 "smoke test passes, prod fails" scenario) — Phase 8 owns runbook; Phase 6 ships the boot log + probe
- `.planning/ROADMAP.md` Phase 8 SC5 — boot log line wording pre-empted into Phase 6 ("OIDC mode active. Kinetica must be configured to trust tokens from <issuer> with audience <client_id>")

### Logout (verify only)
- `.planning/research/FEATURES.md` TS-15 (local logout — In scope as verify-only; no code change)
- `.planning/research/PITFALLS.md` U-04 (logout not awaited — flagged for Phase 7 frontend; backend OK)

### Phase 4 + 5 contracts (consumed by Phase 6)
- `.planning/phases/04-schema-sessionstore-foundation/04-CONTEXT.md` — locked `SessionRow` shape (`secret`, `credentialType`, `idToken`), `createSession` options-object signature, `AuthedRequest` flat shape rationale
- `.planning/phases/05-oidc-module-routes/05-CONTEXT.md` — locked OIDC session creation flow, `oidc_state` cookie clearing on every callback exit, friendly error code vocabulary; Phase 6 edits `/oidc/callback` only to add the opaque-token warning

### Existing code (read before editing)
- `kinetica_bi/server/src/kinetica.ts` — `buildAuthHeader` (line 47), `kineticaSql` (line 127, callsite line 148), `kineticaWms` (line 235, callsite line 254), `emitAudit` (line 52)
- `kinetica_bi/server/src/auth.ts` — `requireAuth` step-10 (line 188-197) already populating `credentialType` + dual creds; `loadSessionForRequest` (line 135), `verifyKineticaCredentials` (line 50, password-only — out of scope)
- `kinetica_bi/server/src/sessionStore.ts` — `getSession` (line 160), existing decrypt-failure-drops-row pattern (line 174-176, 193-196), `isExpired` (line 155), prepared statements (line 87-109)
- `kinetica_bi/server/src/index.ts` — `createApp()` body, `app.post("/api/auth/logout")` (line 153-161, verify only), `/api/auth/oidc/callback` (Phase 5 — Phase 6 adds opaque-token warning here), `validateOidcEnv()` + `initOidcClient()` calls (Phase 5 — Phase 6 adds boot probe + log right after)
- `kinetica_bi/server/src/oidc.ts` — `extractUsername`, `exchangeCode` (Phase 5) — touch point if opaque-token warning is co-located here

### Test files (existing patterns to follow / extend)
- `kinetica_bi/server/tests/auth.requireAuth.spec.ts` — supertest pattern for `requireAuth` step coverage
- `kinetica_bi/server/tests/sessionStore.crud.spec.ts` — `getSession` test patterns; extend with proactive-exp-check tests
- `kinetica_bi/server/tests/auth.oidc.spec.ts` (Phase 5) — OIDC route-level supertest pattern; extend with helper-Bearer-header capture
- `kinetica_bi/server/tests/auth.routes.spec.ts` — logout test patterns; extend with mode-symmetry assertion
- `kinetica_bi/server/tests/bootstrap.spec.ts` — boot validation test pattern; extend with boot-probe success/failure cases

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`buildAuthHeader`** (`kinetica.ts:47-48`) — current Basic-only impl; replace body with the credential-type branch from ARCHITECTURE.md. Two callsites (lines 148, 254) update to pass `req` instead of `req.user!.creds`.
- **`emitAudit`** (`kinetica.ts:52-73`) — explicit-key JSON.stringify pattern (Phase 02-02 decision). Add `auth_mode: fields.auth_mode` to the enumerated keys + thread through `baseAudit` in both `kineticaSql` (line 135) and `kineticaWms` (line 243).
- **`getSession`** (`sessionStore.ts:160-210`) — existing decrypt-failure-drops-row pattern (try → catch → `deleteStmt.run(sid) + return null`). The new `access_token.exp` branch follows the same pattern; appended after `idToken` decrypt.
- **`requireAuth` step-10** (`auth.ts:188-197`) — Phase 4 already attaches `credentialType` + `creds.password`/`creds.token`. No changes needed. Phase 6 just consumes.
- **`POST /api/auth/logout`** (`index.ts:153-161`) — already mode-agnostic; verify-only in Phase 6 (add tests, no code change).
- **`/api/auth/oidc/callback`** (`index.ts`, Phase 5) — already creates the session via `createSession({ credentialType: "oidc", secret: accessToken, idToken })`. Phase 6 adds one-time opaque-token warning around the access-token-handling step.
- **`validateOidcEnv()` + `initOidcClient()`** (Phase 5, called in `createApp()`) — Phase 6 adds the boot log + reachability probe immediately after these succeed.
- **Existing supertest + `vi.stubEnv` patterns** — all test scaffolding already in place from Phase 5.

### Established Patterns
- **`if (credentialType === "oidc") { ... }` discriminant** — TypeScript exhaustiveness on the string-literal union; never `if (creds.password)` (PITFALL I-01).
- **Drops-row-on-failure inside `getSession`** — symmetric across `secret` decrypt, `idToken` decrypt, and now `access_token.exp` check. Single `deleteStmt.run(sid) + return null` shape.
- **Decode-only JWT inspection** — base64url-decode middle segment + `JSON.parse`. No `jsonwebtoken.verify`; signature was verified once at callback.
- **Structured JSON log lines** — `console.log(JSON.stringify({ ts, event, ... }))` for info; `console.warn` for warnings. Same pattern as `emitAudit`.
- **Boot fail-fast vs warn-and-continue** — `validateOidcEnv` fails fast (env missing → process exits); reachability probe warns (network blip → continue). Different severity, different handling.
- **`creds.password`/`creds.token` are mutually empty strings** in the inactive mode — `buildAuthHeader` reads only the active one.
- **Pre-auth routes mounted before `app.use("/api", requireAuth)`** — `/auth/login`, `/oidc/start`, `/oidc/callback`, `/auth/config`. Phase 6 adds nothing new here.

### Integration Points
- **`kinetica_bi/server/src/kinetica.ts`** — replace `buildAuthHeader` body with branch; update its two callsites (line 148, 254) to pass `req`; thread `auth_mode` into `baseAudit` (line 135, 243); add `auth_mode` key to `emitAudit`'s JSON.stringify enumeration.
- **`kinetica_bi/server/src/sessionStore.ts`** — append OIDC `access_token.exp` proactive check inside `getSession` after the `idToken` decrypt block; introduce one small helper for try-decode-JWT-exp; uses existing `deleteStmt.run(sid) + return null` pattern.
- **`kinetica_bi/server/src/index.ts`** — in `createApp()` after `validateOidcEnv()`/`initOidcClient()`: emit oidc_boot info log; fire async unauthenticated `fetch(KINETICA_URL/version)`; on failure, emit `kinetica_unreachable` warn log and continue. Both gated `if (authMode === "oidc")`. Also: in `/oidc/callback`, after token exchange, run try-decode on the access token; if decode fails, emit one-time `oidc_opaque_access_token` warn log.
- **`kinetica_bi/server/src/oidc.ts`** — optional touch point: the opaque-token warn helper might live here (cohesion with `exchangeCode`/`extractUsername`); planner's call.
- **No DB schema changes.** No DDL, no migration, no `token_expires_at` column. Phase 4 owns DDL.
- **No frontend changes.** Phase 6 is backend-only; Phase 7 wires up the frontend reaction to the same REAUTH chain.

</code_context>

<specifics>
## Specific Ideas

- **One function, one branch.** The mental model is "`buildAuthHeader` chooses the auth scheme; nothing else needs to know." Helpers and routes are agnostic past `req.user.credentialType`.
- **`getSession` becomes the single point that returns null for any unrecoverable session state** — expired row TTL, decrypt failure (secret), decrypt failure (idToken), access-token expiry. Four ways to drop, one return path. `requireAuth`'s step-6 null branch already handles all four identically.
- **The opaque-token warning is a deploy-time signal, not per-request noise.** Fires once at session creation; operators see it the first time a user with an opaque-token IdP logs in. Subsequent requests are silent.
- **The boot probe is "did anyone forget to plug it in" — not "is OIDC trust configured correctly."** OIDC trust correctness only surfaces under real auth — runbook (Phase 8) covers that. Phase 6's probe catches the boring failures.
- **`auth_mode` log filtering example:** `jq 'select(.auth_mode == "oidc" and .outcome == "auth-fail")'` is the operator's first-line debug query for "is the new mode misbehaving?" The field exists for that.
- **Cookie payload doesn't change.** Existing JWTs from password-mode sessions remain valid through the deploy that ships Phase 6. PITFALL I-05 protected.

</specifics>

<deferred>
## Deferred Ideas

- **Frontend wiring for the REAUTH redirect to OIDC** — Phase 7 (UX-05, OIDC-01). Phase 6 produces the 401 REAUTH; Phase 7 makes the frontend route to `/api/auth/oidc/start` instead of showing a password form.
- **`/api/auth/me` returning `authMode`** — Phase 7 (UX-08, D-3).
- **Frontend "logout-not-awaited" fix (PITFALL U-04)** — Phase 7. Backend `POST /api/auth/logout` already correct.
- **Boot-time AUTH_MODE-change session wipe** — Phase 8 (MODE-05). Phase 6's URL-mismatch detection stays per-request via `requireAuth`.
- **DEPLOY-RUNBOOK Kinetica OIDC trust section** — Phase 8 (OPS-01). Phase 6 ships the boot log + probe; Phase 8 explains what they mean and what to do when they fire.
- **`token_expires_at` separate column** — rejected (PITFALL I-07 alternative). Decode-only check is cheap; schema is Phase 4 territory.
- **Refresh-token storage / silent refresh** — explicitly out of scope (FEATURES AF-2, OIDC-V2-01). Phase 6 sticks to the re-auth flow.
- **RP-initiated logout to IdP `end_session_endpoint`** — explicitly out of scope (FEATURES AF-4, OIDC-V2-02).
- **`auth_scheme: "basic" | "bearer"` in audit log** — rejected (redundant with `auth_mode`).
- **`token_format: "jwt" | "opaque"` in audit log** — rejected (per-call data that's actually per-session).
- **Boot probe to actually test OIDC trust with a sentinel token** — rejected (no token to send at boot; self-signed wouldn't be accepted).
- **Boot probe in password mode** — rejected (scope creep into v1.0-stable behavior; v1.0 didn't need it).
- **Refactor `verifyKineticaCredentials` (auth.ts:50) to use `buildAuthHeader`** — rejected (password-only path, no `req.user` available, refactor adds noise).
- **In-memory REAUTH-loop heuristic detection** — rejected (per-process brittle; better as observability tooling).
- **AES-GCM auth-tag bypass defense via per-request signature reverify** — rejected (implausible threat model; PITFALL I-07 explicitly recommends decode-only).
- **`KINETICA_HEALTHCHECK_PATH` env var** — Claude's discretion; default hardcoded `/version`.

</deferred>

---

*Phase: 06-requireauth-helper-credential-branch*
*Context gathered: 2026-05-01*
