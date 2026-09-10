# Phase 4: Schema + SessionStore Foundation - Context

**Gathered:** 2026-04-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Extend the v1.0 sessions table + types so a session row can hold either a password or an OIDC access token (plus an optional encrypted id_token), without changing any password-mode behavior. Pure scaffolding — no OIDC routes, no helper branching, no boot-wipe logic. Every subsequent v1.1 phase depends on the `credential_type` column, the renamed `SessionRow` API, and the extended `AuthedRequest` shape compiling.

Covers requirements MODE-02, MODE-03, MODE-06.

</domain>

<decisions>
## Implementation Decisions

### `createSession` signature
- **Switch to options object**: `createSession({ username, secret, kineticaUrl, credentialType?, idToken? }): string`
  - Cleaner as the param list grows past 4; idToken slots in naturally.
  - Touches the one v1.0 callsite at `kinetica_bi/server/src/index.ts:102` and any test that constructs sessions.
- **`idToken` accepted as plaintext**: function encrypts it internally via the same `encryptSecret` path (symmetric with how `secret` is handled today). Callers never see the encrypted blob.
- **`idToken?: string` — truly optional**: omitted in password mode. The INSERT writes NULL into `id_token_ciphertext` / `id_token_iv` / `id_token_auth_tag` when absent.
- **`credentialType` defaults to `'password'`** inside the options object: existing index.ts callsite stays untouched semantically (it constructs `{ username, secret, kineticaUrl }` without credentialType and gets the v1.0 behavior for free).

### `SessionRow` shape
- **`secret: string`** — renamed from `password`; holds the password OR the access token, opaque to consumers. Required, non-empty.
- **`credentialType: 'password' | 'oidc'`** — string literal union, not loose `string`. Drives exhaustiveness in downstream switches (Phase 6 `buildAuthHeader`).
- **`idToken: string | null`** — eagerly decrypted on every `getSession` call when present; `null` when the row's `id_token_ciphertext` is NULL. Symmetric with how `secret` is handled.
- **id_token decrypt failure → drop row + return null**: mirrors v1.0's `secret`-decrypt failure path (`deleteStmt.run(sid)`, return null). No special case — a row whose id_token is corrupt is unrecoverable.
- **Eager decrypt on every call** (not lazy): the extra AES op per request in OIDC mode is negligible vs network cost. Phase 1 already pays this cost for `secret`.

### Rename strategy: `encryptPassword`/`decryptPassword` → `encryptSecret`/`decryptSecret`
- **In-place rename**, no aliases. Update all references (1 internal callsite in `sessionStore.ts` + the relevant test files).
- **`SessionRow.password` → `secret`** ripples to `kinetica_bi/server/src/auth.ts:179` (step-10 assignment) and any test that reads `SessionRow.password`. Grep `SessionRow.password` and `\.password` on session objects before locking.
- **Test imports + assertions updated** to new names — this is a mechanical rename, not a behavior change.
- **Server-only**: confirmed via grep — `encryptPassword`/`decryptPassword`/`SessionRow` are not imported outside `kinetica_bi/server/src/`. No frontend impact.
- **Phase 4 Success Criterion 4 ("All existing tests pass without modification") interpretation**: read as "password-mode behavior is unchanged" — identifier renames in test files are required by this rename and do not violate the spirit of SC4. Planner should call this out explicitly in the plan.

### Test scope (added in Phase 4)
- **OIDC round-trip test**: `createSession({ credentialType: 'oidc', secret: 'fake-token', idToken: 'fake-jwt' })` → `getSession(sid)` returns `SessionRow` with `credentialType: 'oidc'`, `secret: 'fake-token'`, `idToken: 'fake-jwt'`. Single test covers both the credential_type path and id_token encrypt/decrypt.
- **Column-existence smoke test** in `db.smoke.spec.ts` (or equivalent): `PRAGMA table_info(sessions)` returns rows for `credential_type`, `id_token_ciphertext`, `id_token_iv`, `id_token_auth_tag`. Locks the DDL contract.
- **Existing-DB migration test**: simulate a v1.0-shape sessions table (without credential_type/id_token columns), run `createDb`, assert (a) all four new columns now exist via PRAGMA and (b) the pre-existing v1.0 row is still selectable with `credential_type='password'` (DEFAULT applied). Targets PITFALLS M-02 directly.
- **No dedicated id_token absence/presence test** — the OIDC round-trip test exercises `idToken: 'fake-jwt'`, and the existing password-mode tests (creating sessions without idToken) already exercise the `null` path.
- **No separate `encryptSecret`/`decryptSecret` round-trip test** — the renamed helpers are identical to v1.0; existing crypto tests retargeted by the rename cover this.

### Carrying forward from v1.0 (already locked, do not re-decide)
- AES-256-GCM with `SESSION_ENCRYPTION_KEY`, fresh 12-byte IV per encrypted blob (PITFALLS P1, P2 from Phase 1).
- ALTER TABLE guard pattern: `PRAGMA table_info(sessions)` check before idempotent `ALTER TABLE ADD COLUMN` exec, run inside `createDb` after `exec(SCHEMA_DDL)` — Phase 1 `createDb` factory pattern.
- Tests live in `kinetica_bi/server/tests/`, not adjacent to source. In-memory SQLite per spec file (`isolate: true`); each test file gets a fresh DB.
- `kbi_session` JWT cookie `v: 1` field is **NOT bumped** in this phase — the credential discriminant lives in the session row, not the JWT payload (PITFALLS I-05; locked by MODE-05 + ARCHITECTURE.md).
- `requireAuth` step-10 pattern: read from session, attach to `req.user`. The `AuthedRequest` shape change is a flat structure (per ARCHITECTURE.md recommendation), not a discriminated union — `creds.password` and `creds.token` are mutually empty strings (not undefined) to avoid null-guard noise in callers.

### Claude's Discretion
- Exact ordering of the schema migration steps inside `createDb` (e.g., one combined ALTER block vs separate ALTERs per column) — pick the cleanest pattern; the PRAGMA guard makes both idempotent.
- Test file organization: extending an existing `sessionStore.crud.spec.ts` vs adding `sessionStore.oidc.spec.ts` — Claude's call based on what reads cleanest.
- Whether the existing-DB migration test lives in `db.smoke.spec.ts`, a new `db.migration.spec.ts`, or `sessionStore.boot.spec.ts` — pick by cohesion.
- Internal naming of the `createSession` options-object type (e.g., `CreateSessionInput` vs inline) — Claude's call.
- The exact JSDoc / inline comment placement on the renamed helpers — keep comments minimal per project conventions.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Sessions table delta + DDL
- `.planning/research/ARCHITECTURE.md` §"Sessions Table Delta" — exact ALTER TABLE statement, `DEFAULT 'password'` rationale, idempotent guard pattern using PRAGMA table_info, updated SCHEMA_DDL block
- `.planning/research/ARCHITECTURE.md` §"`sessionStore.ts` Changes" — `encryptSecret`/`decryptSecret` rename rationale, `SessionRow` field renaming, INSERT param order, `createSession` signature delta

### AuthedRequest extension
- `.planning/research/ARCHITECTURE.md` §"`requireAuth` Changes" — `AuthedRequest` flat shape with `credentialType` at top + dual `password`/`token` empty-string fields; step-10 assignment pattern
- `.planning/research/STACK.md` §"Changes to Existing Modules — `kinetica.ts`" — `SessionCreds` discriminated union (reference only — actual implementation is Phase 6)

### Pitfalls in scope for Phase 4
- `.planning/research/PITFALLS.md` I-02 (missing `credential_type` column — the #1 "login works, everything else fails" failure mode; resolved by this phase's DDL change)
- `.planning/research/PITFALLS.md` I-05 (do NOT bump JWT cookie `v` field — credential discriminant lives in the session row)
- `.planning/research/PITFALLS.md` M-02 (half-migrated sessions — schema migration must run at boot before `app.listen`; targeted by the existing-DB migration test)

### Existing code (read before editing)
- `kinetica_bi/server/src/db.ts` — current SCHEMA_DDL, `createDb` factory, ensureDir helper
- `kinetica_bi/server/src/sessionStore.ts` — current `encryptPassword`/`decryptPassword`, `SessionRow` type, `createSession`, `getSession`, prepared statements, decrypt-failure-on-read pattern
- `kinetica_bi/server/src/auth.ts` — current `AuthedRequest` type, `requireAuth` step-10 (`session.password` read), `loadSessionForRequest`
- `kinetica_bi/server/src/index.ts:102` — only v1.0 callsite of `createSession`
- `kinetica_bi/server/tests/sessionStore.crud.spec.ts`, `sessionStore.crypto.spec.ts`, `sessionStore.boot.spec.ts`, `db.smoke.spec.ts`, `auth.requireAuth.spec.ts` — existing tests that will be touched by the rename and/or extended with new assertions

### v1.0 prior context (decisions that shape this phase)
- `.planning/STATE.md` §"Decisions" — Phase 01 entries: createDb factory pattern, sessions DDL idempotency, in-memory SQLite test isolation, decrypt-failure-on-read drops row, JWT `v: 1` cookie field

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`encryptPassword`/`decryptPassword`** (`sessionStore.ts:30-49`) — AES-256-GCM helpers; rename to `encryptSecret`/`decryptSecret` and reuse verbatim for both passwords and tokens (id_token included).
- **`createDb` factory + ALTER guard pattern** (`db.ts:77-83`) — already runs `instance.exec(SCHEMA_DDL)`; extending it with a PRAGMA guard + ALTER for `credential_type` and the three `id_token_*` columns is mechanically straightforward.
- **`getSession` decrypt-failure-on-read pattern** (`sessionStore.ts:117-134`) — the try/catch around `decryptPassword` that calls `deleteStmt.run(sid)` and returns null is the exact pattern to extend for id_token decrypt failure.
- **`SessionRow`/`RawSessionRow` type pair** (`sessionStore.ts:55-75`) — clean separation between DB row shape and decrypted public shape; extend both with `credential_type` (raw) → `credentialType` (public) and `id_token_*` (raw) → `idToken: string | null` (public).
- **`AuthedRequest` step-10 assignment** (`auth.ts:174-184`) — single point of mutation; extend with `credentialType` and dual `password`/`token` fields per ARCHITECTURE.md flat shape.

### Established Patterns
- **Idempotent schema setup at boot**: `CREATE TABLE IF NOT EXISTS` + PRAGMA-guarded `ALTER TABLE ADD COLUMN` runs every `createDb` call. Phase 1 set this up; Phase 4 extends it.
- **In-memory SQLite per test file** (`tests/setup.ts`): `DB_PATH=:memory:` default, `isolate: true` in vitest config, fresh DB per spec. New tests follow the same pattern.
- **Prepared statements at module top** (`sessionStore.ts:78-98`): all DML uses `db.prepare(...)` once at module load. The new INSERT (with `credential_type` and 3 `id_token_*` columns) should follow this pattern.
- **Field naming convention**: snake_case at DB layer, camelCase in TS public types (`kinetica_url` → `kineticaUrl`, `auth_tag` → `authTag`). New columns follow: `credential_type` → `credentialType`, `id_token_ciphertext` → consumed into `idToken: string | null`.
- **No null-guard noise**: empty strings preferred over `undefined`/`null` for "absent value of a known type" — see ARCHITECTURE.md flat-shape rationale for `creds.password`/`creds.token`.

### Integration Points
- **DDL**: `kinetica_bi/server/src/db.ts` `SCHEMA_DDL` const + `createDb` factory body — adds `credential_type` to CREATE TABLE block + PRAGMA-guarded ALTERs for both `credential_type` and the three `id_token_*` columns (covers fresh-install AND v1.0-existing-DB cases).
- **SessionStore API**: `kinetica_bi/server/src/sessionStore.ts` — rename `encryptPassword`/`decryptPassword`, extend `SessionRow`/`RawSessionRow`, change `createSession` to options object, extend `getSession` to decrypt id_token.
- **AuthedRequest**: `kinetica_bi/server/src/auth.ts` — extend `AuthedRequest.user` type with `credentialType` + dual `creds.password`/`creds.token`. Update step-10 assignment to read `session.secret` and populate the new fields per `session.credentialType`. (Note: in Phase 4, `credentialType` is always `'password'` at runtime since no OIDC sessions exist yet — the type extension is for downstream phases to compile against.)
- **Single createSession callsite**: `kinetica_bi/server/src/index.ts:102` — `createSession(username, password, kineticaUrl)` becomes `createSession({ username, secret: password, kineticaUrl })`.
- **Test files touched by rename**: `kinetica_bi/server/tests/sessionStore.crud.spec.ts`, `sessionStore.crypto.spec.ts`, `auth.requireAuth.spec.ts` — anywhere `encryptPassword`, `decryptPassword`, or `SessionRow.password` is referenced. Pure mechanical rename, no behavior assertions change.

</code_context>

<specifics>
## Specific Ideas

- **"Plaintext in, encrypted at rest"**: `createSession` accepts plaintext `secret` and plaintext `idToken`; encryption happens inside the function. `getSession` returns plaintext on both fields. Callers never touch the AES path directly — same contract as v1.0.
- **id_token absence pattern**: a v1.0 password row has `id_token_ciphertext IS NULL`. `getSession` detects this (single `IS NULL` check on the raw row) and returns `idToken: null` — no decrypt attempt, no error.
- **Test naming**: prefer extending `sessionStore.crud.spec.ts` with the OIDC round-trip case rather than a new file, unless the assertion count materially grows. Cohesion over file count.

</specifics>

<deferred>
## Deferred Ideas

- **`buildAuthHeader` Bearer/Basic branch** — Phase 6 (MODE-04). Phase 4 only ensures the type system is ready.
- **Boot-time AUTH_MODE-change session wipe** — Phase 8 (MODE-05). Phase 4 only ensures the `credential_type` column exists so the wipe query has something to filter on.
- **`AUTH_MODE` env var validation + route gating** — Phase 5 (MODE-01) for routes; Phase 8 for boot validation. Phase 4 does not read `AUTH_MODE` at all.
- **Discriminated-union `creds` shape** — explicitly rejected for now (ARCHITECTURE.md recommends flat). Could be revisited post-v1.1 if call-site verbosity grows.
- **`getRawIdToken(sid)` lazy-decrypt API** — rejected (eager decrypt chosen). Could be added if a future phase needs the encrypted blob without decrypting.
- **Surfacing user claims (email, display name) from id_token to frontend** — D-2 differentiator (MODE-06 storage is in-scope; *use* of the stored id_token is post-v1.1 polish).

</deferred>

---

*Phase: 04-schema-sessionstore-foundation*
*Context gathered: 2026-04-30*
