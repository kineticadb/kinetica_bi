# Phase 1 Deploy Runbook — Encrypted Server-Side Session Store

**Phase:** 01-encrypted-server-side-session-store
**Audience:** Operator deploying this milestone increment to staging or production.
**Estimated downtime:** Zero. The deploy is rolling-restart compatible.

## TL;DR

1. Generate a fresh `SESSION_ENCRYPTION_KEY`: `openssl rand -hex 32`. Add to your secret manager / env source.
2. Deploy the new server binary.
3. Currently-logged-in users will be redirected to the login screen on their next API call. This is **expected**, not an incident. They re-login normally; new sessions persist as encrypted rows in `sessions`.
4. Watch for a single `[sessions] swept N expired rows` log line per hour after boot — this confirms the GC timer is alive.

## Pre-deploy

- [ ] **Generate the encryption key.** Run on your local machine:
  ```
  openssl rand -hex 32
  ```
  Output is 64 hex characters. Store as `SESSION_ENCRYPTION_KEY` in your secret manager (AWS Secrets Manager, Vault, kubectl secret, etc.). **Do NOT** reuse `AUTH_SECRET`.

- [ ] **Verify the env var is present in the target environment** before the new binary boots. The server fail-fasts if `SESSION_ENCRYPTION_KEY` is missing, not exactly 64 hex chars, or contains non-hex characters. The error message includes the fix:
  `SESSION_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). Generate with: openssl rand -hex 32`

- [ ] **Confirm `AUTH_SECRET` is unchanged.** This phase does NOT require an `AUTH_SECRET` rotation — the new JWT version field (`v: 1`) handles the migration without re-signing.

- [ ] **Confirm `KINETICA_URL` is correct.** New sessions stamp the live `KINETICA_URL` value and `requireAuth` checks it on every request. If you change `KINETICA_URL` post-deploy, all live sessions are invalidated (they 401 cleanly with `code: REAUTH_REQUIRED` and the rows are GC'd). This is a feature, not a bug.

## Deploy

1. Roll out the new server binary normally (your existing process — Helm, systemd, docker compose, etc.).
2. The boot sequence:
   - Read `SESSION_ENCRYPTION_KEY` (fail-fast on bad value — server refuses to start; check the error in stderr).
   - Apply the `sessions` DDL idempotently to `kinetica.db` (no manual migration).
   - Bind to port and start accepting traffic.
   - Schedule the 1-hour sweep timer (`setInterval`, `.unref()`'d).

## Post-deploy expectations

### Expected behavior on first request from a pre-deploy user

- User has an old cookie shape `{ sub, iat, exp }` (no `sid`, no `v: 1`).
- First API call:
  - `requireAuth` calls `decodeAndVerifyJwt` → JWT decodes (signature OK), but `decoded.v !== 1`.
  - Response: HTTP 401 + body `{ error: "Authentication required.", code: "REAUTH_REQUIRED" }`.
- Frontend's existing `UNAUTHORIZED_EVENT` handler dispatches → user lands on the login screen.
- User logs in → Kinetica creds verified → encrypted row written to `sessions` → new cookie issued with `{ sub, sid, v: 1 }`.

**No data is lost. No operator action is needed.** This is the documented migration path.

This is Pitfall 13 (old-cookie / new-code migration trap): old cookies silently passing `requireAuth` after a deploy is the failure mode — the `v: 1` check is the guard. The 401 on first use post-deploy is intentional and correct.

### Expected behavior on first request from a post-deploy login

- Cookie payload (decode with `cut -d. -f2 | base64 -d` from the network tab):
  ```json
  { "sub": "alice", "sid": "<64 hex chars>", "v": 1, "iat": ..., "exp": ... }
  ```
- `sessions` row visible:
  ```
  sqlite3 /path/to/kinetica.db "SELECT sid, username, length(ciphertext), length(iv), length(auth_tag), kinetica_url, expires_at FROM sessions"
  ```
  - `length(ciphertext)` matches encrypted password size (>= password length, AES-GCM doesn't pad).
  - `length(iv)` = 12.
  - `length(auth_tag)` = 16.
  - `kinetica_url` matches the env var at login time.
  - `expires_at` is ~8 hours after `created_at`.

### Expected log output

Every hour after boot:
```
[sessions] swept N expired rows
```
where `N` is the count of rows whose `expires_at <= datetime('now')` at sweep time. `N = 0` is normal early on. The line itself is the heartbeat — its presence proves the GC timer is alive.

On rare transient SQLite errors (lock contention, etc.):
```
[sessions] sweep failed <error>
```
The next tick (1 hour later) will retry. The timer is wrapped in try/catch and does NOT clearInterval on error.

## Rollback plan

If you need to roll back the binary to the pre-Phase-1 version:

1. Roll back the binary (your existing process).
2. The old binary issues `{ sub }`-shape cookies again. Currently-logged-in users with `{ sub, sid, v: 1 }` cookies will see those cookies decode cleanly (`sub` field still present), so the old binary keeps them logged in.
3. The `sessions` table will sit unused but harmless. The DDL is idempotent; you can ignore it.
4. If you re-deploy the new binary later, all users in the gap will re-login per the migration path.

## Key rotation

To rotate `SESSION_ENCRYPTION_KEY`:

1. Generate a new key: `openssl rand -hex 32`.
2. Update the secret manager.
3. Restart the server.
4. **All current sessions become undecryptable.** On their next request:
   - `getSession` calls `decryptPassword` → throws.
   - The catch block deletes the unrecoverable row.
   - `requireAuth` returns 401 + REAUTH_REQUIRED.
   - User re-logs in.
5. **No previous-key fallback** is supported in v1.0 (intentional — see CONTEXT.md decisions).

## What is NOT in this phase (for operator awareness)

- **Phase 2** rewires the 5 Kinetica call sites (SQL proxy, schemas, tables, columns, materialize, WMS) to use `req.user.creds` instead of the admin env vars. After Phase 1, those routes still call Kinetica with the shared `KINETICA_USERNAME` / `KINETICA_PASSWORD` env vars. **Don't unset those env vars yet.**
- **Phase 3** removes the admin env vars entirely and adds 401-vs-403 dispatch in the global error middleware. After Phase 3, you can `unset KINETICA_USERNAME KINETICA_PASSWORD` in the env source.

## Acceptance verification (post-deploy)

Per ROADMAP.md Phase 1 success criteria:

1. After login, querying the `sessions` table shows a row with non-null BLOB columns.
   ```
   sqlite3 /path/to/kinetica.db "SELECT count(*), length(ciphertext) > 0, length(iv) = 12, length(auth_tag) = 16 FROM sessions"
   ```
2. The cookie payload contains no plaintext password.
   ```
   echo "<jwt>" | cut -d. -f2 | base64 -d
   ```
3. POST /api/auth/logout removes the row immediately and replays return 401.
4. /api/auth/me returns 401 if the row is deleted out-of-band.
5. Expired rows are GC'd within 1 hour by the periodic sweep (look for `[sessions] swept` log lines with non-zero counts after the 8-hour TTL elapses on test users).

---

## Phase 3 Delta

**Phase:** 03-auth-failure-ux-admin-credential-removal
**Audience:** Operator deploying the Phase 3 binary to staging or production after Phase 1 + Phase 2 are live.
**Estimated downtime:** Zero. Rolling-restart compatible.

### What Phase 3 changes for operators

1. **The shared admin Kinetica credentials are no longer needed by the server.** `KINETICA_USERNAME` and `KINETICA_PASSWORD` env vars can be removed from your secret manager / Helm values / Terraform module / CI secret store. The server boots fine without them and serves authenticated routes using the per-user credentials carried in the encrypted session.
2. **Auth-failure responses now distinguish session-expired (401 + REAUTH_REQUIRED) from permission-denied (403) from upstream-failure (502).** The frontend dispatches on the `code` field — users with revoked Kinetica credentials get cleanly logged out; users hitting per-table permission denials see an inline grayed-out widget without losing their session.
3. **The session store DDL is unchanged from Phase 1.** No data migration. The `sessions` table from Phase 1 is unchanged.
4. **`AUTH_SECRET` does NOT need rotation.** Phase 1's `v: 1` JWT version field is the migration handle and continues to work.

### Pre-deploy

- [ ] **Inventory the env-var deletion.** `KINETICA_USERNAME` and `KINETICA_PASSWORD` may still be present in:
  - Helm `values.yaml` / chart templates referencing them
  - Terraform modules feeding them into Kubernetes secrets / SSM Parameter Store / Vault
  - CI workflows exporting them at build time (GitHub Actions secrets, GitLab CI variables)
  - Docker compose files / `.env.production`
  Removing these is **safe** with the new server binary. Leave them in place if you prefer a more cautious rollout (the new server simply ignores them).

- [ ] **Confirm `KINETICA_URL` is still set.** `requireConfig` is narrowed to check only `KINETICA_URL`. Boot will fail with `Missing KINETICA_URL environment variable.` if absent.

- [ ] **Confirm `AUTH_SECRET` and `SESSION_ENCRYPTION_KEY` are still set** from Phase 1's runbook. Phase 3 does not change either contract.

### Post-deploy expectations

Identical to Phase 1's post-deploy section above. In summary:
  - Pre-Phase-1 cookies (no `sid`, no `v: 1`) → 401 + REAUTH_REQUIRED + cleared cookie → user re-logs in. **Same as before.**
  - Post-Phase-1 cookies → continue to work. Sessions encrypted with the same `SESSION_ENCRYPTION_KEY`; no decryption changes in Phase 3.
  - Hourly `[sessions] swept N expired rows` log line continues. **No new log lines from Phase 3 middleware itself** — the audit log from Phase 2 was already in place; Phase 3 only changes the HTTP response shape.

### New post-deploy verification (Phase 3 specific)

1. **Restricted-user permission denial surfaces as inline 403, not logout.**
   - Log in as a Kinetica user with `SELECT` on schema A but not on schema B.
   - Open a dashboard widget that queries schema B.
   - Expected: toast `"You don't have permission to view this data."` appears once. Widget renders the grayed-out `widget-permission-denied` placeholder. User stays logged in.

2. **Mid-session auth failure dumps cleanly to login + banner.**
   - Log in.
   - Externally rotate the user's Kinetica password (admin action on the Kinetica side).
   - Trigger any authenticated UI action.
   - Expected: HTTP 401 with body `{ error: ..., code: "REAUTH_REQUIRED" }` returned for the API call (visible in DevTools network tab). Frontend redirects to LoginPage with the banner `"Your session has ended. Please sign in again."`. The `kbi_session` cookie is cleared.

3. **Server boots and serves with admin env vars unset.**
   ```
   unset KINETICA_USERNAME KINETICA_PASSWORD
   npm run start
   ```
   Expected: server binds to PORT, accepts auth and authenticated requests. Hit `GET /api/health`, log in, hit `GET /api/dashboards`. All return 2xx with no `Missing KINETICA_USERNAME...` 500s.

### Rollback past Phase 3

Rolling back the binary to a Phase 2 build:
1. The Phase 2 binary's `requireConfig` checks for `KINETICA_URL`, `KINETICA_USERNAME`, `KINETICA_PASSWORD`. **Re-add the env vars to the deployment config before rolling back**, or the Phase 2 server returns 500 on every Kinetica-backed route.
2. Live sessions continue to work — the cookie shape (`{ sub, sid, v: 1 }`) and session row encryption are unchanged from Phase 1.
3. The auth-failure UX reverts to Phase 2's behavior (every Kinetica failure → 502, no 403 distinction, no toast, no banner). Frontend code in the rolled-back build is also Phase 2 — no contract drift.

Rolling back past Phase 1 (atypical):
1. Re-add the env vars (as above).
2. The `sessions` table sits unused; the old binary doesn't touch it. Harmless.
3. Live `{ sub, sid, v: 1 }`-shape cookies decode cleanly under the old binary because `sub` is still present. Users stay logged in.

### What is NOT in Phase 3 (for operator awareness)

- **No new env vars.** The Phase 3 binary reads exactly the same set as Phase 2 minus `KINETICA_USERNAME`/`KINETICA_PASSWORD`.
- **No DB schema changes.** Phase 1's `sessions` table is the only persistent state; Phase 3 doesn't touch it.
- **No frontend toast library dependency added.** The toast component is hand-rolled (`kinetica_bi/src/components/Toast.tsx` + `kinetica_bi/src/store/toast.ts`). No new npm package.
- **No retry button on permission-denied widgets.** Out of milestone scope (deferred to v2).

### Acceptance verification (Phase 3-specific)

Per ROADMAP.md Phase 3 success criteria:

1. `git grep -nE 'KINETICA_USERNAME|KINETICA_PASSWORD' -- ':!.planning/'` on the deployed source tree returns zero matches.
2. Cookie inspect on a fresh login: still `{ sub, sid, v: 1 }`. Phase 1's contract preserved.
3. Network tab on a 401-REAUTH response: status 401, body has `code: "REAUTH_REQUIRED"`, Set-Cookie clears `kbi_session`.
4. Network tab on a 403 permission denial: status 403, body has `error` only, NO `code` field.
5. Server starts cleanly with admin env vars unset (Check 3 above).

---

## Phase 8 Delta — OIDC Mode + AUTH_MODE-Change Wipe

**Phase:** 08-boot-wipe-hardening-runbook
**Audience:** Operator deploying the v1.1 OIDC SSO milestone to staging or production after Phases 4–7 are live.
**Estimated downtime:** Zero. Rolling-restart compatible. (AUTH_MODE flip wipes contradicting-type sessions atomically at boot.)

### TL;DR

v1.1 adds OIDC SSO as an alternative to v1.0's password authentication. A single deployment is configured for one mode or the other via the `AUTH_MODE` env var. Operators set `AUTH_MODE=oidc` plus the `AUTH_OIDC_*` env vars on the BI app side; **DBAs configure the Kinetica server's OIDC trust separately** (see "Kinetica server side: OIDC trust configuration" below). Both sides MUST be configured for SSO logins to actually work end-to-end.

### BI app side: required env vars

Set these in your secret manager / Helm values / Terraform module / Docker compose env source. Required when `AUTH_MODE=oidc`; ignored when `AUTH_MODE=password`.

- `AUTH_MODE` — `password` (default) or `oidc`. Gates which auth routes are mounted. Inactive routes return 400/405 (intentional; see PITFALLS T-3).
- `AUTH_OIDC_ISSUER_URL` — IdP issuer URL, e.g. `https://idp.example.com/realms/kinetica`. Used for OpenID discovery (`<issuer>/.well-known/openid-configuration`). MUST match the issuer Kinetica is configured to trust, **byte-for-byte including trailing slashes** (PITFALLS O-01).
- `AUTH_OIDC_CLIENT_ID` — OIDC client ID registered at the IdP. Used as the `aud` claim during ID-token verification.
- `AUTH_OIDC_CLIENT_SECRET` — OIDC client secret (confidential client). See "Rotation safety" below.
- `AUTH_OIDC_REDIRECT_URI` — Full callback URL, e.g. `https://bi.example.com/api/auth/oidc/callback`. MUST exactly match the redirect URI registered at the IdP (PITFALLS O-03 — dev/prod mismatch is the #2 OIDC failure mode).
- `AUTH_OIDC_USERNAME_CLAIM` — Optional. Defaults to `preferred_username`. The ID-token claim whose value becomes the BI app's `username` (and is sent to Kinetica).
- `AUTH_OIDC_USERNAME_REGEX` — Optional. Regex with one capture group to transform the claim value (e.g., strip `@example.com` from a UPN). Empty result is a hard error (PITFALLS T-3).

`KINETICA_URL`, `AUTH_SECRET`, and `SESSION_ENCRYPTION_KEY` are unchanged from v1.0.

### Kinetica server side: OIDC trust configuration

**This is a DBA task on the Kinetica server, separate from the BI app's `AUTH_OIDC_*` env vars.** The BI app forwards the IdP-issued access token to Kinetica via `Authorization: Bearer <token>`; Kinetica is responsible for validating that token's signature and claims independently. If Kinetica is not configured to trust the IdP, every dashboard call from a logged-in OIDC user will fail at the Kinetica layer (#1 documented v1.1 failure mode — PITFALLS O-04, I-06).

The Kinetica admin must configure the following on the Kinetica server:

- **Trusted issuer URL:** must equal `AUTH_OIDC_ISSUER_URL` exactly (including trailing slash if present — PITFALLS O-01). The Kinetica server validates the `iss` claim of incoming tokens against this value.
- **Expected audience:** must equal `AUTH_OIDC_CLIENT_ID` exactly. The Kinetica server validates the `aud` claim against this value.
- **JWKS URL:** typically `<issuer>/.well-known/openid-configuration` → `jwks_uri` field. The Kinetica server fetches public keys from here to verify the token signature. The Kinetica host must have network reachability to this URL (firewall/proxy considerations).
- **Claim-to-Kinetica-username mapping:** the Kinetica username for each user MUST match the value the BI app's `extractUsername()` produces (configured by `AUTH_OIDC_USERNAME_CLAIM` and optional `AUTH_OIDC_USERNAME_REGEX` on the BI app side). Mismatch → token validates but Kinetica returns "user not found" / permission errors.

Cross-reference your specific IdP's vendor documentation (Keycloak / Okta / Auth0 / Azure AD / etc.) to find the issuer URL, registered audience, and JWKS endpoint. The four bullets above are the universal OIDC-spec contract — vendor docs translate them to vendor-specific UI fields.

### AUTH_MODE-change behavior (Phase 8 wipe)

Flipping `AUTH_MODE` between deploys (e.g., rolling out OIDC mode to a deployment previously running in password mode) atomically wipes any sessions whose `credential_type` contradicts the new mode. The wipe runs at boot, BEFORE `app.listen()`, inside a single SQLite transaction.

When the wipe deletes one or more rows, a structured log line is emitted:

```
{"ts":"2026-...","level":"info","event":"auth_mode_change_wipe","from":"password","to":"oidc","deleted":N}
```

Grep for it across log streams with: `jq 'select(.event == "auth_mode_change_wipe")'`. The wipe is silent on no-op (steady-state restarts produce no log line). Self-healing — after the wipe runs once, contradicting count is 0 and subsequent boots are no-ops.

The JWT cookie's `v: 1` field is **unchanged** by AUTH_MODE flips (PITFALLS I-05) — the credential discriminant lives in the session row, not the cookie payload. Users with valid sessions in the new mode are unaffected; users with sessions in the old mode get 401-REAUTH on their next request and re-authenticate via whichever mode is now active.

### Boot hardening (Phase 8 fail-fast)

Startup failures (missing `AUTH_OIDC_*` env vars in OIDC mode, unreachable IdP at `Issuer.discover()`, transactional wipe failure, etc.) emit a structured JSON line and exit non-zero:

```
{"ts":"2026-...","level":"error","event":"boot_failed","message":"AUTH_OIDC_ISSUER_URL is required when AUTH_MODE=oidc","stack":"..."}
```

The server does **not** start serving requests when this fires. Operators can grep with: `jq 'select(.event == "boot_failed")'`. The `message` field names the actionable problem; the `stack` field is for deep-library throws (e.g., openid-client surfacing a network error).

### AUTH_OIDC_CLIENT_SECRET rotation safety

Rotating the OIDC client secret requires a server restart with the new secret in `AUTH_OIDC_CLIENT_SECRET`. **The IdP must accept both the old and new secrets during the rotation window** (most IdPs support this via a "secret expiration" or "secondary secret" feature). If the IdP cuts over before the BI app restart, in-flight code-exchange callbacks will fail with `invalid_client` until the BI app picks up the new secret. PITFALLS O-02.

### Troubleshooting (PITFALLS O-04 / I-06)

> If users can log in but every dashboard call fails with re-auth loop, check Kinetica's OIDC trust configuration first.

This is the #1 documented v1.1 deployment failure mode. The OIDC login flow itself succeeds (BI app validates the ID token), the session row is created, the cookie is issued, the user lands on the dashboard — but every Kinetica call returns 401, which the BI app surfaces as `code: REAUTH_REQUIRED`, which redirects the user to `/api/auth/oidc/start`, which loops. Diagnostics:

1. **Check Kinetica's audit logs** for the actual token-rejection reason (signature invalid? `iss` mismatch? `aud` mismatch? unknown user?).
2. **Verify `iss` and `aud` match exactly** between the BI app's env vars and Kinetica's trust config — including trailing slashes (PITFALLS O-01).
3. **Verify the JWKS URL is reachable from the Kinetica server** — not just from the BI app or from your laptop. Firewall / proxy / DNS can differ.

If all three check out, decode a live access token (DevTools → Network → look at any failing dashboard request's `Authorization: Bearer <token>` header → paste the JWT into jwt.io) and compare its `iss`, `aud`, `exp` claims against what Kinetica expects.

### Acceptance verification (Phase 8 / OIDC-mode-specific)

Per ROADMAP.md Phase 8 success criteria:

1. `curl -s http://<bi-host>/api/auth/config` returns `{"authMode":"oidc"}` with `Cache-Control: no-store` header (PITFALLS I-03 — runtime auth-mode discovery, no stale-cache flips).
2. On startup, `journalctl -u kinetica-bi | jq 'select(.event == "oidc_boot")'` (or your log-stream equivalent) shows one line per restart with `issuer` and `audience` matching the configured env vars.
3. Browser end-to-end: complete OIDC login, then load a dashboard. Dashboard fetch returns 200 (not 401-REAUTH loop). If 401-REAUTH loop appears, see Troubleshooting above.
4. On `AUTH_MODE` flip + restart: `jq 'select(.event == "auth_mode_change_wipe")'` shows the deleted count. Verify directly: `sqlite3 /path/to/kinetica.db "SELECT COUNT(*) FROM sessions WHERE credential_type = '<contradicting>'"` returns 0.
5. On boot with `AUTH_OIDC_ISSUER_URL` deliberately unset (`AUTH_MODE=oidc`): `jq 'select(.event == "boot_failed")'` shows a `message` field referencing `AUTH_OIDC_ISSUER_URL`; `echo $?` (or your supervisor's exit-code reporting) shows non-zero.

### What is NOT in Phase 8 (for operator awareness)

- **No new database schema changes.** Phase 4 already added the `credential_type` column; Phase 8 only reads it for the wipe.
- **No JWT cookie format change.** The `v: 1` field is unchanged across the v1.0 → v1.1 transition (PITFALLS I-05). Existing v1.0 cookies survive an AUTH_MODE flip in the same way they survive any other restart.
- **No worked vendor examples.** This runbook stays generic. Cross-reference your specific IdP's docs to map the four trust-config fields above (issuer, audience, JWKS, claim mapping) to vendor-specific UI.
- **No RP-initiated logout to the IdP.** `POST /api/auth/logout` only destroys the BI session row + clears the cookie; the user remains logged in at the IdP for any other relying parties (UX-07). Deferred to v2 (OIDC-V2-02).
