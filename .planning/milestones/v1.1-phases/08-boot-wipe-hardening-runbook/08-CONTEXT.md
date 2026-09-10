# Phase 8: Boot Wipe + Hardening + Runbook - Context

**Gathered:** 2026-05-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Three tightly-related deliverables that close out the v1.1 OIDC SSO Support milestone:

1. **Boot-time AUTH_MODE-change wipe** — when an operator flips `AUTH_MODE` between deployments, sessions matching the *contradicting* `credential_type` are deleted in a single SQLite transaction inside `createApp()` before `app.listen()` is called.
2. **Boot hardening** — the existing fail-fast paths (Phase 5 `validateOidcEnv()` throw, Phase 5 `Issuer.discover()` rejection) are wrapped at the bootstrap IIFE so a missing/invalid OIDC env var produces a structured `event: 'boot_failed'` JSON log and a non-zero exit, never a stack trace into a half-started server.
3. **Kinetica OIDC trust runbook** — a Phase 8 Delta section appended to the existing v1.0 `DEPLOY-RUNBOOK.md` documenting the DBA-side Kinetica trust configuration prereqs (issuer URL, audience, JWKS, claim-to-username mapping) and the PITFALLS O-04 / I-06 troubleshooting flag.

**Carrying forward from prior phases (already shipped, do not re-implement):**
- `credential_type` column exists with values `'password' | 'oidc'` (Phase 4).
- `validateOidcEnv()` throws on missing `AUTH_OIDC_*` vars; `initOidcClient()` throws on `Issuer.discover()` failure (Phase 5).
- The structured `oidc_boot` log line (`Kinetica must be configured to trust tokens from <issuer> with audience <client_id>`) ships at `index.ts:97-107` (Phase 6) — Phase 8 SC5 is **verify-only**.
- The Kinetica `/version` unauthenticated reachability probe with `kinetica_unreachable` warn-on-failure ships at `index.ts:114-147` (Phase 6).
- The bootstrap IIFE at `index.ts:700-715` already has `try/catch` + `console.error("[boot] startup failed", err)` + `process.exit(1)`. Phase 8's hardening delta upgrades the log to structured JSON only.

Covers requirements MODE-05 and OPS-01.

</domain>

<decisions>
## Implementation Decisions

### Wipe trigger model

- **Derive contradiction from data, not from a persisted last-mode row.** No new metadata table, no new DDL, no migration. The check is: `SELECT COUNT(*) FROM sessions WHERE credential_type = ?` with the contradicting type as the parameter; if count > 0, run the wipe. Matches ARCHITECTURE.md §"Boot-Time AUTH_MODE-Change Detection" verbatim. Self-healing: after the wipe runs once, contradicting count is 0 and subsequent boots are no-ops.
- **Wipe target is the contradicting type only**, not the full sessions table. `DELETE FROM sessions WHERE credential_type = ?` with `contradictingType = authMode === 'oidc' ? 'password' : 'oidc'`. ARCHITECTURE.md is explicit: "Do NOT wipe all sessions — only the contradicting type." MODE-05's "entire sessions table" wording is interpreted as "all rows of the contradicting type" — `AUTH_MODE` is mutually exclusive, so contradicting-type rows ARE every session that doesn't match the new mode.
- **Run in BOTH modes** (no `if (authMode === 'oidc')` gate). Symmetric: handles both `password → oidc` upgrade AND `oidc → password` rollback. The `COUNT` is essentially free.
- **Failure mode: fail-fast.** If the wipe transaction throws (disk full, locked DB, etc.), let it bubble through `createApp()` to the bootstrap IIFE catch, which emits the structured `boot_failed` log and `process.exit(1)`. Serving requests with stale-mode sessions in the table is worse than not serving at all — a residual cookie cache could resurrect a contradicting-type session on the first request and corrupt audit logs.

### Wipe placement and shape

- **Lives in `index.ts` `createApp()`**, not in `db.ts` and not in `sessionStore.ts` (ARCHITECTURE.md AP-1 / AP-2 anti-patterns are explicit).
- **Placement: immediately after the `authMode` validation block** (currently `index.ts:82-85`) and BEFORE `validateOidcEnv()` / `initOidcClient()` (currently `index.ts:88-93`). Reason: a hostile leftover state (contradicting OIDC sessions sitting in a now-password-mode DB) should be cleared before the OIDC client init attempts run, even though the wipe is pure SQL and doesn't touch OIDC. Order matches ARCHITECTURE.md.
- **Explicit `db.transaction(() => { ... })()` wrapper** around the COUNT + DELETE pair. PITFALL M-01 is CRITICAL ("wrap wipe + meta-row update in `db.transaction()`"). Even though we're not persisting a meta-row, the wrapper makes the read-then-delete pair atomic against any future writer and locks the contract for the next time someone considers adding a meta-row.
- **Inline in `createApp()`, not extracted to a helper module** for v1.1. ARCHITECTURE.md notes: "If the wipe logic grows complex, extract to a `src/authConfig.ts` module that imports from both `db.ts` and reads env vars — but for the current scope, inline in `createApp()` is fine." Phase 8 stays inline.

### Wipe logging

- **Structured JSON one-liner**, matching the Phase 6 logging convention (`oidc_boot`, `kinetica_unreachable`):
  ```
  console.log(JSON.stringify({
    ts, level: 'info', event: 'auth_mode_change_wipe',
    from: contradictingType, to: authMode, deleted: result.changes
  }))
  ```
  Operators can grep with `jq 'select(.event == "auth_mode_change_wipe")'`. No plain-string log line.
- **Silent on no-op.** Log only when `deleted > 0` (or equivalently, when contradicting count > 0). Reduces boot-log noise on every steady-state restart. The "did the wipe run?" question is answered by the `auth_mode_change_wipe` event's presence/absence.

### Boot hardening delta

- **Wrap the existing bootstrap IIFE catch (currently `index.ts:711-714`).** It already calls `console.error + process.exit(1)`; the Phase 8 change replaces the unstructured `console.error("[boot] startup failed", err)` line with a structured JSON one-liner:
  ```
  console.error(JSON.stringify({
    ts, level: 'error', event: 'boot_failed',
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined
  }))
  ```
  Then `process.exit(1)` (unchanged). Operators can grep `jq 'select(.event == "boot_failed")'` to find startup failures across log streams.
- **Both `message` and `stack` as separate fields** in the JSON. Operators see the actionable message at a glance ("AUTH_OIDC_ISSUER_URL is required when AUTH_MODE=oidc") and can drill into the stack when the failure is a deep library throw (e.g., `openid-client` surfacing a network error from `Issuer.discover()`).
- **No refactor to `bootstrap()` named function** — wrap in place at `index.ts:700-715`. Keeps the diff small and the bootstrap regex test (`tests/bootstrap.spec.ts`) unaffected.
- **Do NOT fail-fast on missing `KINETICA_URL` at boot.** Keep the current runtime-only `requireConfig` middleware behavior. v1.0 didn't gate boot on `KINETICA_URL`; the Phase 6 `kinetica_unreachable` probe already logs a warning if it's missing or unreachable. Phase 8 stays scoped to AUTH_OIDC_* hardening.
- **No tightening of `validateOidcEnv()` error messages in this phase.** They already name the missing variable in Phase 5 (`AUTH_OIDC_X is required`). If a future operator complaint identifies an unclear message, fix it then.

### Test strategy

- **Wipe tests live in a new `tests/boot.wipe.spec.ts`** (or extend `tests/bootstrap.spec.ts` if cohesion fits — planner's call). Three cases:
  1. `AUTH_MODE=oidc` boot with a pre-seeded `credential_type='password'` session row → assert row deleted, structured `auth_mode_change_wipe` log emitted with `from: 'password'`, `to: 'oidc'`, `deleted: 1`.
  2. `AUTH_MODE=password` boot with a pre-seeded `credential_type='oidc'` session row → symmetric assertion (`from: 'oidc'`, `to: 'password'`, `deleted: 1`).
  3. `AUTH_MODE=oidc` boot with only `credential_type='oidc'` rows (steady state) → assert no log emitted, sessions table unchanged.
- **Hardening tests in `tests/boot.hardening.spec.ts`** (or extend `tests/bootstrap.spec.ts`). Stub `process.exit` with `vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)`, stub `console.error`, run the bootstrap IIFE body in `AUTH_MODE=oidc` with `AUTH_OIDC_ISSUER_URL` unstubbed. Assert: `boot_failed` JSON log with `message` containing `AUTH_OIDC_ISSUER_URL`, `process.exit(1)` called once. Same pattern as Phase 5/6 boot tests.
- **No child-process / shell-level exit-code test.** The unit-level assertion (`process.exit(1)` called) is sufficient; spawning real processes is brittle in CI.
- **Runbook tests are content-grep based** (no behavior). Acceptance criteria use `grep` to assert specific phrases are present in the runbook file: `"Kinetica OIDC Trust Configuration"`, `"this is a DBA task on the Kinetica server"`, the PITFALLS O-04/I-06 verbatim line.

### Runbook

- **Single canonical runbook, extended.** Append a `v1.1 / Phase 8 Delta` section to the existing `.planning/milestones/v1.0-phases/01-encrypted-server-side-session-store/DEPLOY-RUNBOOK.md`. Existing precedent: that file already has a `## Phase 3 Delta` section appended after the Phase 1 base. SC3 explicitly permits extending the Phase 1 runbook. One file, chronological history per milestone delta. NOT a new file at `kinetica_bi/server/`.
- **Section structure:**
  1. **TL;DR** — one paragraph summary: "v1.1 adds OIDC mode. Operators set `AUTH_MODE=oidc` + `AUTH_OIDC_*` env vars on the BI app side; DBAs configure the Kinetica server's IdP trust separately."
  2. **BI app side: required env vars** — `AUTH_MODE`, `AUTH_OIDC_ISSUER_URL`, `AUTH_OIDC_CLIENT_ID`, `AUTH_OIDC_CLIENT_SECRET`, `AUTH_OIDC_REDIRECT_URI`, `AUTH_OIDC_USERNAME_CLAIM` (default `preferred_username`), `AUTH_OIDC_USERNAME_REGEX` (optional). Reference only — no IdP-specific examples.
  3. **Kinetica server side: OIDC trust configuration** — issuer URL (must equal `AUTH_OIDC_ISSUER_URL`), expected audience (must equal `AUTH_OIDC_CLIENT_ID`), JWKS URL (`<issuer>/.well-known/openid-configuration` → `jwks_uri`), claim-to-username mapping (Kinetica usernames must match the value Phase 5's `extractUsername()` produces). **Explicit callout:** "This is a DBA task on the Kinetica server, separate from the BI app's `AUTH_OIDC_*` env vars."
  4. **AUTH_MODE-change behavior** — flipping `AUTH_MODE` between deploys atomically wipes sessions of the contradicting type at boot; operators see `event: 'auth_mode_change_wipe'` in logs. JWT cookie `v: 1` field is unchanged.
  5. **Troubleshooting (PITFALLS O-04 / I-06):** the verbatim line — *"If users can log in but every dashboard call fails with re-auth loop, check Kinetica's OIDC trust configuration first."* — and a brief "what to look at": Kinetica audit logs for token rejection reason; verify `iss` and `aud` match exactly; verify JWKS reachable from Kinetica.
  6. **Acceptance verification (Phase 8 / OIDC-mode-specific)** — numbered checklist mirroring the existing v1.0 runbook's "Acceptance verification" sections:
     - `curl -s http://<bi-host>/api/auth/config` returns `{"authMode":"oidc"}` with `Cache-Control: no-store`.
     - On startup, `jq 'select(.event == "oidc_boot")'` shows the issuer + audience.
     - Browser end-to-end: complete OIDC login, then a dashboard fetch returns 200 (not 401-REAUTH loop).
     - On `AUTH_MODE` flip + restart: `jq 'select(.event == "auth_mode_change_wipe")'` shows the deleted count; sessions table query confirms zero contradicting-type rows remain.
     - On boot with `AUTH_OIDC_ISSUER_URL` unset: `jq 'select(.event == "boot_failed")'` shows the missing-var message; `echo $?` returns non-zero.
- **Generic-only depth.** No worked Keycloak / Okta / Auth0 examples. SC3 + SC4 are satisfied by reference content; vendor-specific configs would tie the runbook to assumptions about which IdP we deploy against. Operators on a specific IdP cross-reference their vendor docs to the env vars listed.
- **Mention `AUTH_OIDC_CLIENT_SECRET` rotation safety** (PITFALLS O-02) briefly in the env-var section: "Rotation requires a server restart; the IdP must accept both old and new secrets during the rotation window."

### Carrying forward from prior phases (already locked, do not re-decide)

- **Wipe location:** `index.ts` inside `createApp()` (ARCHITECTURE.md AP-1, AP-2). Not `db.ts`, not `sessionStore.ts`.
- **Wipe target:** `DELETE FROM sessions WHERE credential_type = ?` with the contradicting type. Not full-table wipe (ARCHITECTURE.md, MODE-05).
- **JWT cookie `v: 1` field unchanged** (PITFALL I-05). The credential discriminant lives in the session row, not the cookie payload.
- **`credential_type` column exists** (Phase 4 MODE-02) — Phase 8 reads it but does not modify the schema.
- **`validateOidcEnv()` throws on missing OIDC env vars** (Phase 5) — Phase 8 wraps the throw at the IIFE level for structured logging, does not re-implement the validation.
- **`Issuer.discover()` rejects on unreachable endpoint** (Phase 5 OIDC-03) — Phase 8 wraps the rejection at the IIFE level, does not re-implement discovery.
- **Structured `oidc_boot` log line** (Phase 6) — Phase 8 SC5 is verify-only; the line at `index.ts:97-107` already includes the verbatim "Kinetica must be configured to trust tokens from <issuer> with audience <client_id>" wording.
- **Kinetica `/version` reachability probe** (Phase 6) — informational warn-only; Phase 8 references it in the runbook troubleshooting section but does not re-implement.
- **Tests in `kinetica_bi/server/tests/`**, in-memory SQLite per spec, supertest where useful, `vi.stubEnv` for env mutations.

### Claude's Discretion

- Exact test file organization — extend `tests/bootstrap.spec.ts` vs new `tests/boot.wipe.spec.ts` + `tests/boot.hardening.spec.ts` files. Cohesion over file count.
- Internal helper naming for the wipe (e.g., inline lambda vs `wipeSessionsOnModeChange()` named function inside `createApp()`). ARCHITECTURE.md uses the named-function form; planner picks based on readability.
- Exact phrasing of the `boot_failed` and `auth_mode_change_wipe` log messages (the structure is locked; the prose nuance is flexible).
- Exact section headings and ordering inside the runbook v1.1 Delta — must contain the SC3/SC4 required content but the title style ("## v1.1 Delta — OIDC Mode" vs "## Phase 8 Delta") is the planner's call. Match the existing "Phase 3 Delta" style for consistency.
- Whether the `auth_mode_change_wipe` log line includes the wipe SQL latency (`elapsed_ms`) for diagnostics — recommend yes if cheap, planner's call.
- Whether to include a tiny `console.warn` if the boot is in OIDC mode AND the sessions table is currently empty AND no contradicting rows existed (i.e., a brand-new install or a fresh DB) — probably overengineering, recommend skipping.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Boot-time wipe
- `.planning/research/ARCHITECTURE.md` §"Boot-Time AUTH_MODE-Change Detection" (line 314+) — exact `wipeSessionsOnModeChange` snippet, `DELETE WHERE credential_type = ?` pattern, contradicting-type-only rationale, AP-1 (db.ts placement) and AP-2 (sessionStore.ts placement) anti-patterns
- `.planning/research/PITFALLS.md` M-01 (AUTH_MODE change not transactional — CRITICAL: wrap wipe in `db.transaction()`)
- `.planning/research/PITFALLS.md` M-02 (half-migrated sessions — relevant context for why the wipe matters at boot)
- `.planning/research/PITFALLS.md` M-04 (OIDC session rows survive mode flip race — resolved by transactional wipe before app.listen)
- `.planning/research/FEATURES.md` TS-12 (AUTH_MODE change wipes sessions — feature definition)

### Boot hardening
- `.planning/research/ARCHITECTURE.md` §"AUTH_MODE Switch — Boot validation" — `validateOidcEnv()` call at `createApp()`, `authMode` const pattern (already shipped Phase 5)
- `.planning/research/PITFALLS.md` I-05 (do NOT bump JWT cookie `v` field — credential discriminant lives in session row, not cookie payload)

### Runbook + Kinetica trust
- `.planning/research/PITFALLS.md` O-04 (Kinetica OIDC trust not configured — the #1 "smoke test passes, production fails" scenario; verbatim troubleshooting line goes in runbook)
- `.planning/research/PITFALLS.md` I-06 (typed-error: REAUTH loop from Kinetica trust misconfig — runbook documents the symptom and the diagnostic step)
- `.planning/research/PITFALLS.md` O-02 (`AUTH_OIDC_CLIENT_SECRET` rotation safety — runbook env-var section mentions briefly)
- `.planning/research/FEATURES.md` TS-3 (AUTH_MODE route gating — already shipped Phase 5; runbook documents the inactive-mode 400 response for operator awareness)

### Existing artifacts (read before editing or extending)
- `kinetica_bi/server/src/index.ts` — current `createApp()` body, `authMode` resolution at line 82-85, OIDC boot block at line 87-148, bootstrap IIFE at line 700-715 (existing try/catch/process.exit(1) — Phase 8 upgrades the log line)
- `kinetica_bi/server/src/oidc.ts` — `validateOidcEnv()` and `initOidcClient()` (Phase 5; Phase 8 wraps their throws at IIFE level, does not modify)
- `kinetica_bi/server/src/db.ts` — `createDb` factory + `db.transaction()` availability (better-sqlite3 API)
- `kinetica_bi/server/src/sessionStore.ts` — `credential_type` column reads (Phase 4 contract); Phase 8 does not import from this module
- `.planning/milestones/v1.0-phases/01-encrypted-server-side-session-store/DEPLOY-RUNBOOK.md` — existing v1.0 runbook (209 lines; Phase 1 base + Phase 3 Delta sections); Phase 8 appends a "v1.1 / Phase 8 Delta" section in the same file
- `kinetica_bi/server/tests/bootstrap.spec.ts` — existing bootstrap regex test (verifies the IIFE gate body contains `app.listen` and `startSessionSweep()`); Phase 8 boot tests can extend this file or sit alongside it

### Prior CONTEXT.md decisions that shape this phase
- `.planning/phases/04-schema-sessionstore-foundation/04-CONTEXT.md` §"Carrying forward from v1.0" — JWT `v: 1` cookie unchanged, decrypt-failure-on-read drops row pattern
- `.planning/phases/05-oidc-module-routes/05-CONTEXT.md` §"`GET /api/auth/config` route" — `Cache-Control: no-store` header (Phase 8 runbook acceptance check verifies this); §"Test strategy" — `validateOidcEnv()` boot-throw pattern
- `.planning/phases/06-requireauth-helper-credential-branch/06-CONTEXT.md` §"Kinetica trust boot signal" — `oidc_boot` structured log line + Kinetica `/version` reachability probe (both already shipped; Phase 8 SC5 is verify-only)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`db.transaction()` API** (better-sqlite3) — wraps a synchronous function in an immediate-mode transaction. Single call site for the wipe; no new infrastructure needed.
- **Phase 6 structured logging convention** (`index.ts:97-147`) — `console.log(JSON.stringify({ ts, level, event, ... }))` pattern with grep-able `event` field. Phase 8 reuses this verbatim for `auth_mode_change_wipe` and `boot_failed`.
- **Existing bootstrap IIFE try/catch** (`index.ts:700-715`) — already calls `console.error + process.exit(1)` on startup failure. Phase 8 only changes the log shape, not the control flow.
- **`vi.spyOn(process, 'exit').mockImplementation(...)`** pattern — used elsewhere in tests to assert exit calls without crashing the test runner.
- **Existing v1.0 DEPLOY-RUNBOOK.md "Phase 3 Delta" section pattern** — the template Phase 8's v1.1 Delta section copies (TL;DR, deploy notes, post-deploy expectations, acceptance verification).

### Established Patterns
- **Read `process.env.AUTH_MODE` once at `createApp()` top** (ARCHITECTURE AP-5) — Phase 8's wipe code uses the existing `authMode` const (line 82), never re-reads `process.env`.
- **Boot-time work runs inside `createApp()`, before `app.listen()`** — the existing `oidc_boot` log, the Kinetica probe, and validateOidcEnv() all follow this. Phase 8's wipe slots in immediately after the authMode validation block.
- **Structured JSON one-liner logs at boot** (Phase 6 convention) — every operator-relevant event has a unique `event:` value for `jq` filtering.
- **Prepared statements at module top** (sessionStore.ts) — but Phase 8's wipe is inline in `createApp()`, not a prepared statement at module top, because it runs once at boot and the SQL is parameterized at call time.
- **Append-only deploy-runbook deltas** — the v1.0 runbook already has Phase 3 Delta appended; Phase 8 follows the same pattern (append v1.1 Delta, do not rewrite earlier sections).

### Integration Points
- **Wipe insertion site:** `kinetica_bi/server/src/index.ts` — between line 85 (end of authMode validation) and line 87 (start of `if (authMode === "oidc")` block). The wipe runs unconditionally (both modes), so it sits OUTSIDE the OIDC-mode-only block.
- **Hardening insertion site:** `kinetica_bi/server/src/index.ts:711-714` — replace the `console.error("[boot] startup failed", err)` line with the structured JSON `boot_failed` event log. Keep the `process.exit(1)` line as-is.
- **Runbook insertion site:** end of `.planning/milestones/v1.0-phases/01-encrypted-server-side-session-store/DEPLOY-RUNBOOK.md` — append a new top-level section heading (`## Phase 8 Delta — OIDC Mode + AUTH_MODE-Change Wipe` or similar) below the existing Phase 3 Delta block.
- **Test files:** `kinetica_bi/server/tests/boot.wipe.spec.ts` (new) and `kinetica_bi/server/tests/boot.hardening.spec.ts` (new), or extensions of `tests/bootstrap.spec.ts` (cohesion-driven; planner's call).

</code_context>

<specifics>
## Specific Ideas

- **"Self-healing wipe":** the data-derived check means rerunning boot in steady state is a no-op (contradicting count = 0). No metadata to keep in sync, no migration, no edge case for "what if the meta row is corrupt."
- **"One canonical runbook":** the v1.0 file already has `Phase 3 Delta`; v1.1 follows the same pattern. The runbook's chronological structure mirrors the milestone history, which is more navigable than splitting across files.
- **"Verify, don't reimplement":** SC5 (`oidc_boot` log line) and large parts of SC2 (`validateOidcEnv` throw, `Issuer.discover` rejection) are already shipped in Phases 5 and 6. Phase 8 adds tests + the runbook content; the boot logging contract is already in place.
- **Acceptance verification structure** mirrors the existing v1.0 runbook's numbered post-deploy checks — operators can copy-paste and adapt the v1.0 muscle memory.

</specifics>

<deferred>
## Deferred Ideas

- **Persist last-known AUTH_MODE in an `app_meta` row** — explicitly rejected for v1.1 (data-derived approach is sufficient and avoids new DDL). Could be reconsidered if a future need arises (e.g., an admin UI showing "last mode change date").
- **Worked Keycloak / Okta / Auth0 examples in the runbook** — out of scope; the runbook is generic. Vendor-specific configs are added when we have a confirmed deployment IdP.
- **Multi-IdP runbook reference table** — overkill for v1.1; revisit if the deployment surface grows beyond a single IdP per environment.
- **`KINETICA_HEALTHCHECK_PATH` env var** for configuring the boot probe path — Phase 6 left this as a `// TODO` in `index.ts`; remains deferred to v2.
- **Promote the runbook out of `.planning/milestones/...` and next to the server code** (`kinetica_bi/server/DEPLOY-RUNBOOK.md`) — possible v2 reorganization; not blocking v1.1.
- **Extract wipe + hardening into a `src/authConfig.ts` module** — ARCHITECTURE.md notes this is appropriate "if the wipe logic grows complex." Phase 8 stays inline; revisit if v2 adds more boot-time auth config concerns.
- **Brand-new install diagnostic log** ("OIDC mode boot, sessions table empty, no contradicting rows") — recommended skip; the existing `oidc_boot` log already announces the mode at startup.

</deferred>

---

*Phase: 08-boot-wipe-hardening-runbook*
*Context gathered: 2026-05-01*
