---
phase: 02-per-user-credential-passthrough-on-every-kinetica-call
verified: 2026-04-28T11:50:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
---

# Phase 2: Per-User Credential Passthrough Verification Report

**Phase Goal:** Every downstream Kinetica request authenticates as the BI user who initiated it; Kinetica's per-user permissions become the only authorization boundary the app respects.
**Verified:** 2026-04-28T11:50:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A user with restricted Kinetica permissions sees only the schemas, tables, and columns that user is granted | VERIFIED (proxy) | `routes.discovery.spec.ts` test "restricted-user: returns only what Kinetica returns" asserts exactly one fetch call, no admin-cred fallback; per-user auth header assertions decode to `alice:${SESSION_PASSWORD}` NOT `KINETICA_USERNAME` env var across all 3 discovery routes |
| 2 | A user without SELECT on table X who calls POST /api/sql gets back the Kinetica permission error — no admin elevation | VERIFIED (proxy) | `routes.sql.spec.ts` "per-user Authorization header does NOT use KINETICA_USERNAME env var" temporarily sets env to "admin-env-user" and confirms session creds are forwarded; "no admin-cred fallback: fetch called exactly once even on error" confirms no retry; 403 from Kinetica yields exactly 1 fetch call |
| 3 | `git grep -n "kineticaUser\|kineticaPassword\|Buffer.from(\`\${" kinetica_bi/server/src/index.ts` returns zero matches | VERIFIED | Confirmed: grep returned zero matches for `kineticaUser` and `kineticaPassword`; the only `Buffer.from` in index.ts is at line 401 for `response.arrayBuffer()` (binary tile passthrough), not credential construction |
| 4 | Every Kinetica call emits one server log line with username, route/operation, outcome — no credentials, no full SQL bodies | VERIFIED | `kinetica.audit.spec.ts` (22 tests): field set exactly `{ts, request_id, username, route, op, outcome, status, duration_ms}` — no extras possible (explicit key enumeration); SQL body sentinel strings absent; password sentinel absent; base64 credential string absent; WMS query string absent; all 6 outcome paths (`success`, `auth-fail`, `permission-denied`, `upstream-error`) tested; per-route op tags (`DISCOVERY`, `MATERIALIZE`, `WMS`, `SQL`) verified in `routes.*.spec.ts` |
| 5 | View materialization, schema/table/column discovery, and the WMS proxy continue to work for an admin-equivalent user | VERIFIED | Happy-path tests in `routes.materialize.spec.ts` (200 + status='created'), `routes.discovery.spec.ts` (all 3 routes return correct shapes), `routes.wms.spec.ts` (binary passthrough + Content-Type forwarded) all pass |

**Score:** 5/5 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/kineticaErrors.ts` | Typed error classes: KineticaAuthError, KineticaPermissionError, KineticaUpstreamError | VERIFIED | 52 lines, 3 exported classes; each uses `Object.setPrototypeOf` for instanceof preservation; `status` fixed per class (401/403/502); `upstreamStatus` carries actual Kinetica HTTP status |
| `src/kinetica.ts` | Per-request helpers `kineticaSql`, `kineticaWms` with per-user creds, typed errors, audit log | VERIFIED | 301 lines; exports `kineticaSql` and `kineticaWms`; builds `Authorization: Basic` from `req.user.creds` only (no env var reads for auth); `emitAudit` with 8-key JSON; `classifyHttpError` covers 401/403/400+access-denied/other; zero KINETICA_USERNAME/PASSWORD references |
| `src/index.ts` | All 5 Kinetica call sites use helpers; `kineticaUser`/`kineticaPassword` module consts deleted | VERIFIED | 5 `kineticaSqlHelper(req,...)` calls (SQL proxy, 3 discovery, materialize) + 1 `kineticaWms(req,...)` call (WMS); module consts deleted at Plan 06; `requireConfig` inlined to `process.env` reads; zero banned identifiers in file |
| `src/auth.ts` | `req.requestId` populated via `randomUUID()` in `requireAuth` | VERIFIED | Line 182: `req.requestId = randomUUID()` set in requireAuth success path after `req.user`; `AuthedRequest` type extended with `requestId?: string` |
| `tests/kinetica.errors.spec.ts` | 31 tests covering typed error contracts | VERIFIED | File exists; 31 tests; all pass |
| `tests/kinetica.sql.spec.ts` | 32 tests covering kineticaSql helper | VERIFIED | File exists; 32 tests; all pass |
| `tests/kinetica.wms.spec.ts` | 15 tests covering kineticaWms helper | VERIFIED | File exists; 15 tests; all pass |
| `tests/kinetica.audit.spec.ts` | 22 tests covering audit log shape, outcome mapping, no-leakage | VERIFIED | File exists; 22 tests; all pass |
| `tests/routes.sql.spec.ts` | 10 integration tests for POST /api/sql | VERIFIED | Per-user auth assertion decodes session creds; env-var overwrite test confirms session wins; 401/403/5xx/network all yield single-fetch 502 |
| `tests/routes.discovery.spec.ts` | 17 integration tests for 3 discovery routes | VERIFIED | Per-user auth assertions on all 3 routes; restricted-user evidence test (single fetch, returns only what Kinetica returns); SQL-escape tests; op:DISCOVERY audit assertions |
| `tests/routes.wms.spec.ts` | 8 integration tests for GET /api/wms | VERIFIED | Binary passthrough, per-user auth, 401/403/5xx/network → 502, op:WMS no-bbox-leakage |
| `tests/routes.materialize.spec.ts` | 13 integration tests for POST /api/views/:id/materialize | VERIFIED | Happy path 200, per-user auth, DDL shape, 403/400+access-denied/401/5xx/network → 502 + status='error', op:MATERIALIZE, no-double-persist, 404 cases |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `index.ts` import | `kinetica.ts` | `import { kineticaSql as kineticaSqlHelper, kineticaWms }` | WIRED | Line 14 of index.ts; both exports imported and used at 5+1 call sites |
| `index.ts` import | `kineticaErrors.ts` | `import { KineticaAuthError, KineticaPermissionError, KineticaUpstreamError }` | WIRED | Line 15-19 of index.ts; used in catch blocks of all 5 route handlers |
| `kinetica.ts` | `req.user.creds` | `buildAuthHeader(req.user!.creds)` | WIRED | kinetica.ts line 48; called at kineticaSql line 148 and kineticaWms line 254; never reads KINETICA_USERNAME/PASSWORD |
| `requireAuth` | `req.requestId` | `req.requestId = randomUUID()` | WIRED | auth.ts line 182; kinetica.ts reads `req.requestId ?? randomUUID()` as fallback |
| `kinetica.ts` emitAudit | `console.log` audit channel | JSON.stringify 8-key record | WIRED | Emitted on every code path (success and all failure types); verified by kinetica.audit.spec.ts 22 tests |
| Materialize handler | `updateViewStatus` | Called on all paths (success, typed error, unexpected error) | WIRED | index.ts lines 270 (created), 281-285 (error paths); routes.materialize.spec.ts "no double-persist on success" confirms null error_message on success |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| CRED-01 | 02-02, 02-06 | Every Kinetica/gpudb call routes through a single helper using the authenticated user's credentials | SATISFIED | `kinetica.ts` is the single helper; all 5 call sites imported and wired; module-const deletion (Plan 06) mechanically enforced via TypeScript |
| CRED-02 | 02-03 | POST /api/sql uses the user's Kinetica credentials | SATISFIED | `routes.sql.spec.ts` per-user auth header assertions; env-var overwrite test confirms session creds win |
| CRED-03 | 02-03 | Schema/table/column discovery uses the user's Kinetica credentials | SATISFIED | `routes.discovery.spec.ts` per-user auth assertions on all 3 discovery routes |
| CRED-04 | 02-01, 02-05 | View materialization uses the user's Kinetica credentials | SATISFIED | SPIKE.md confirmed loud-failure acceptable; `routes.materialize.spec.ts` per-user auth test decodes `alice:${SESSION_PASSWORD}` NOT admin creds |
| CRED-05 | 02-04 | WMS proxy uses the user's Kinetica credentials | SATISFIED | `routes.wms.spec.ts` "Per-user auth NOT from env var" test; kineticaWms builds auth from `req.user.creds` |
| CRED-06 | 02-03 | A user with restricted Kinetica permissions sees only what they are granted | SATISFIED | `routes.discovery.spec.ts` "restricted-user" test verifies single fetch call, no fallback, returns only Kinetica-provided data; SQL-escape tests prevent injection that could bypass permission filters |
| OBS-01 | 02-02 | Every Kinetica call emits a server log line with username, route/operation, outcome — no credentials, no SQL bodies | SATISFIED | `kinetica.audit.spec.ts` 22 tests verify exact 8-field set, all 6 outcome paths, no SQL body leak, no password leak, no Authorization header leak, no WMS query string leak |

All 7 requirement IDs from phase plan frontmatter are accounted for. No orphaned requirements found.

---

### Anti-Patterns Found

No blockers or warnings found.

| File | Pattern | Severity | Notes |
|------|---------|----------|-------|
| `src/index.ts:451` | `app.listen` at module top-level (outside `createApp`) | Info / Quality | Production bootstrap executes at module import time; triggers 5 non-fatal `EADDRINUSE` errors when `tests/helpers/app.ts` imports from `index.ts` during test runs. All 205 test assertions pass. This is a latent Phase 1 issue (introduced in plan 01-04) exposed by Phase 2's larger test count. Does not affect correctness; deferred to a follow-up cleanup task. |

---

### Human Verification Required

The following two success criteria have test-level proxy coverage but cannot be fully verified without a live Kinetica instance with restricted user grants:

**1. Restricted user sees only granted schemas/tables (SC#1)**

**Test:** Log in as a Kinetica user that has `table_read` on exactly one schema. Navigate to the schema/table discovery UI.
**Expected:** Only the single granted schema appears; admin-only schemas are absent from the list.
**Why human:** Requires a live Kinetica instance with a restricted-grants user. The automated proxy (routes.discovery.spec.ts "restricted-user" test) verifies mechanical correctness — the app forwards per-user creds and returns exactly what Kinetica provides with no admin fallback. The Kinetica-side permission enforcement itself is out of scope for automated tests.

**2. Permission error surfaced correctly for unauthorized table query (SC#2)**

**Test:** Log in as a Kinetica user without SELECT on table X. Submit `SELECT * FROM X` via the SQL query interface (POST /api/sql).
**Expected:** The response reflects a Kinetica permission error (502 with helper-sanitized message in Phase 2; will be 403 in Phase 3 after middleware lands).
**Why human:** Requires a live Kinetica instance. Automated proxy (`routes.sql.spec.ts` 403-from-Kinetica test) verifies the app returns 502 on Kinetica 403 with exactly one fetch call and no admin fallback.

---

### Quality Notes

**EADDRINUSE non-fatal errors during test runs:**

Running `npx vitest run` reports `205 passed (205)` alongside `5 errors`. All 5 errors are `EADDRINUSE: address already in use :::4000` originating at `src/index.ts:451` (`app.listen` at module top-level). These occur because `tests/helpers/app.ts` imports from `index.ts`, which triggers the production bootstrap (`app.listen`) as a module-level side effect in each test worker context. Test assertions all pass; no test depends on the port binding. This is a latent Phase 1 issue (plan 01-04 moved `app.listen` outside `createApp`) surfaced by Phase 2's additional spec files. Recommend wrapping the production `app.listen` call in a `if (require.main === module)` guard or equivalent in a dedicated phase or cleanup task.

---

### Gaps Summary

None. All 5 success criteria are verified or have acceptable human-verification proxies. All 7 requirement IDs (CRED-01 through CRED-06 + OBS-01) are satisfied. The test suite is 205/205.

---

_Verified: 2026-04-28T11:50:00Z_
_Verifier: Claude (gsd-verifier)_
