---
phase: 06-requireauth-helper-credential-branch
verified: 2026-05-01T17:00:00Z
status: passed
score: 5/5 must-haves verified
---

# Phase 6: requireAuth + Helper Credential Branch — Verification Report

**Phase Goal:** Every Kinetica API call made from an OIDC session sends `Authorization: Bearer <token>`; every call from a password session continues to send `Authorization: Basic <b64>`; the existing 401-REAUTH chain fires correctly when the bearer token expires; the audit log records `auth_mode` per call.

**Verified:** 2026-05-01T17:00:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | `git grep 'Authorization.*Basic' kinetica.ts` returns exactly one site — inside `buildAuthHeader`, behind `credentialType === 'password'` — and a `Bearer` branch exists beside it | VERIFIED | Line 54 (`return \`Basic ${...}\``) is the only Basic site; line 51-52 is the `credentialType === "oidc"` Bearer branch. Zero `if (creds.password)` discriminants. |
| SC2 | OIDC session cookie reaches Kinetica with `Authorization: Bearer <token>`; password session sends `Authorization: Basic <b64>` — verified via server-side audit log + captured fetch headers | VERIFIED | `tests/kinetica.creds.routes.spec.ts` Tests 1+2: exact `Authorization` header captured via `fetchMock.mock.calls[0][1].headers.Authorization`; Test 1 asserts `toBe("Bearer ${accessToken}")`; Test 2 asserts `toBe("Basic ${b64}")`. |
| SC3 | When stored access token `exp` is in the past, `getSession` returns null → 401 `REAUTH_REQUIRED`; expired token never forwarded to Kinetica | VERIFIED | `sessionStore.ts:237-246` proactive exp check (4th drop-row trigger); `kinetica.creds.routes.spec.ts` Test 5: past-exp OIDC session returns 401 `REAUTH_REQUIRED`, `kineticaCalls.length === 0`, row deleted from DB. |
| SC4 | `POST /api/auth/logout` destroys session row and clears `kbi_session` cookie identically in both modes; no `end_session_endpoint` call | VERIFIED | `index.ts:201-209` logout handler is mode-agnostic; `auth.routes.spec.ts` 4 tests: row deleted, cookie cleared, response shapes identical, zero outbound fetch calls. |
| SC5 | Every Kinetica-call audit log line includes `"auth_mode":"oidc"` or `"auth_mode":"password"` as a top-level JSON field | VERIFIED | `kinetica.ts:67,79`: `auth_mode` in `emitAudit` type + explicit-key `JSON.stringify`; `kinetica.ts:149,258`: threaded from `req.user!.credentialType` in both `kineticaSql` and `kineticaWms` `baseAudit`; `kinetica.audit.spec.ts` EXPECTED_KEYS test (9 keys including `auth_mode`); `kinetica.creds.routes.spec.ts` Tests 3+4 parse actual audit lines. |

**Score:** 5/5 success criteria verified

---

### Required Artifacts

| Artifact | Provides | Status | Evidence |
|----------|----------|--------|----------|
| `kinetica_bi/server/src/kinetica.ts` | Credential-type-aware `buildAuthHeader`; `auth_mode` in `emitAudit` | VERIFIED | Lines 49-55: `buildAuthHeader(req: AuthedRequest)` with `credentialType === "oidc"` branch; lines 59-82: `emitAudit` with explicit 9-key JSON.stringify including `auth_mode`; lines 144-150 and 253-259: `baseAudit` threaded in both helpers. |
| `kinetica_bi/server/src/sessionStore.ts` | `tryDecodeAccessTokenExp` export + `getSession` proactive exp branch + 30s clock-skew constant | VERIFIED | Lines 168-187: `tryDecodeAccessTokenExp` exported, decode-only; line 191: `ACCESS_TOKEN_CLOCK_SKEW_SECONDS = 30`; lines 237-246: OIDC-gated exp check as 4th drop-row trigger using `deleteStmt.run(sid) + return null`. |
| `kinetica_bi/server/src/index.ts` | `oidc_boot` log + `/version` probe + `oidc_opaque_access_token` warn; logout handler (verify-only) | VERIFIED | Lines 95-147: structured `oidc_boot` JSON log + async IIFE fire-and-forget `/version` probe with `kinetica_unreachable` on failure, gated `if (authMode === "oidc")`; lines 343-357: `oidc_opaque_access_token` warn using `tryDecodeAccessTokenExp` as discriminant, before `createSession`; lines 201-209: mode-agnostic logout (no `end_session_endpoint`). |
| `kinetica_bi/server/tests/kinetica.creds.spec.ts` | Unit tests locking Bearer/Basic discriminant + PITFALL I-01 negative tests | VERIFIED | 6 `it()` blocks; `"should-NEVER-appear"` assertions (lines 95, 126); Bearer/Basic exact-match assertions. |
| `kinetica_bi/server/tests/kinetica.audit.spec.ts` | Audit field-set tests with 9-key EXPECTED_KEYS including `auth_mode` | VERIFIED | `auth_mode` appears 3+ times; EXPECTED_KEYS test updated to 9 keys; separate `describe("audit log — auth_mode field")` block. |
| `kinetica_bi/server/tests/sessionStore.crud.spec.ts` | `tryDecodeAccessTokenExp` unit tests (8 behaviors) + `getSession` proactive exp tests (7 behaviors) | VERIFIED | 26 `it()` blocks total; `describe("tryDecodeAccessTokenExp")` with null-sentinel cases; `describe("getSession proactive access-token exp check (PITFALL I-07)")` with past-exp drop + opaque-token pass + password-mode untouched. |
| `kinetica_bi/server/tests/bootstrap.spec.ts` | Boot-probe tests: `oidc_boot` log fires, `/version` probe URL, `kinetica_unreachable` on rejection/non-2xx, password-mode gates | VERIFIED | 10 `it()` blocks; `event === "oidc_boot"` assertions (positive + negative); `/version` URL filter; `kinetica_unreachable` for reject + 503; password-mode no-probe guard. |
| `kinetica_bi/server/tests/auth.oidc.spec.ts` | Opaque-token warning fire/no-fire tests | VERIFIED | Tests 8+9 in `describe("GET /api/auth/oidc/callback: opaque-token warning")`; `oidc_opaque_access_token` positive + negative; `username` field asserted; access token literal not in log. |
| `kinetica_bi/server/tests/kinetica.creds.routes.spec.ts` | Route-level SC2/SC3/SC5 end-to-end integration | VERIFIED | 8 `it()` blocks; exact Bearer/Basic header capture; `auth_mode` in parsed audit lines; past-exp REAUTH with fetch-not-called assertion + row-deleted assertion; audit privacy invariants. |
| `kinetica_bi/server/tests/auth.routes.spec.ts` | Logout symmetry SC4 tests | VERIFIED | 4 new `it()` blocks in `describe("logout symmetry — OIDC mode")`; row deleted, cookie cleared, response shapes identical, no `end_session_endpoint` fetch, idempotency. |

---

### Key Link Verification

| From | To | Via | Status | Evidence |
|------|----|-----|--------|----------|
| `kineticaSql` callsite (line 158) | `buildAuthHeader(req)` | Single `AuthedRequest` arg | VERIFIED | `kinetica.ts:158`: `Authorization: buildAuthHeader(req)` — no `req.user!.creds` arg present. |
| `kineticaWms` callsite (line 265) | `buildAuthHeader(req)` | Single `AuthedRequest` arg | VERIFIED | `kinetica.ts:265`: `Authorization: buildAuthHeader(req)` — no `req.user!.creds` arg present. |
| `emitAudit` JSON.stringify | `auth_mode` field | Explicit-key enumeration (no spread) | VERIFIED | `kinetica.ts:79`: `auth_mode: fields.auth_mode` in explicit object literal inside `JSON.stringify`; no `...fields` spread in the `JSON.stringify` call body. |
| `getSession` step 4 | `deleteStmt.run(sid) + return null` | Symmetric drop-row pattern | VERIFIED | `sessionStore.ts:242`: `deleteStmt.run(sid)` + `return null` in the OIDC proactive exp branch — 5 total `deleteStmt.run(sid)` occurrences (TTL expiry, secret decrypt fail, id_token decrypt fail, exp check, explicit `deleteSession`). |
| `/oidc/callback` | `tryDecodeAccessTokenExp(accessToken) === null` → `oidc_opaque_access_token` warn | Import from sessionStore | VERIFIED | `index.ts:21`: `import { ..., tryDecodeAccessTokenExp } from "./sessionStore"`; `index.ts:347`: call site before `createSession`. |
| `createApp()` OIDC branch | `oidc_boot` log + async IIFE `/version` probe | `if (authMode === "oidc")` gate | VERIFIED | `index.ts:88-148`: both signals inside the OIDC gate; probe is `void (async () => { ... })()` (fire-and-forget, no await on createApp path). |

---

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|---------------|-------------|--------|----------|
| MODE-04 | 06-01, 06-04 | `kineticaSql`/`kineticaWms` branch on `credentialType`: Bearer in OIDC, Basic in password | SATISFIED | `buildAuthHeader` in `kinetica.ts:49-55`; unit tests in `kinetica.creds.spec.ts`; route tests in `kinetica.creds.routes.spec.ts` Tests 1+2. |
| UX-04 | 06-02 | BI session TTL stays 8 hours regardless of IdP token expiry; proactive exp check drives REAUTH flow | SATISFIED | `sessionStore.ts:237-246`: OIDC-only proactive exp check returns null for expired tokens; `requireAuth` step-6 null path (auth.ts, unmodified) emits `REAUTH_REQUIRED`; 30s clock-skew symmetric with Phase 5 `clockTolerance: 30`. |
| UX-05 | 06-02, 06-03 | Expired access token → 401 `REAUTH_REQUIRED` + operator-facing boot/callback logs for I-06/T-05 diagnosability | SATISFIED | `getSession` null path → existing REAUTH chain; `oidc_boot` log + `/version` probe + `oidc_opaque_access_token` warn in `index.ts`. |
| UX-07 | 06-04 | Local logout destroys session row + clears cookie; user stays logged in at IdP (no `end_session_endpoint`) | SATISFIED | `index.ts:201-209`: `deleteSession(decoded.sid)` + `clearSessionCookie(res)` + 204, no outbound fetch; `auth.routes.spec.ts` Test 3 asserts `fetchMock.not.toHaveBeenCalled()` during logout. |
| OBS-02 | 06-01, 06-04 | Per-Kinetica-call audit log line includes `auth_mode: "password" \| "oidc"` top-level field | SATISFIED | `kinetica.ts:67,79`: required field in `emitAudit` type + explicit JSON key; `kinetica.audit.spec.ts` EXPECTED_KEYS 9-key test; `kinetica.creds.routes.spec.ts` Tests 3+4 parse actual audit lines. |

---

### Pitfall Lock Verification

| Pitfall | Requirement | Status | Evidence |
|---------|-------------|--------|----------|
| I-01 (no `if (creds.password)` discriminant) | Branch ONLY on `credentialType === "oidc"` | LOCKED | `grep -nE 'if \(creds\.(password\|token)\)' kinetica.ts` → 0 matches; `buildAuthHeader` uses `credentialType === "oidc"` exclusively; `kinetica.creds.spec.ts` Tests 3+4 (`"should-NEVER-appear"`) lock both directions. |
| I-07 (decode-only, no signature reverify) | `tryDecodeAccessTokenExp` must not use jsonwebtoken.verify | LOCKED | `grep -n 'jwt.verify\|jsonwebtoken' sessionStore.ts` → 0 matches; decode uses `Buffer.from(parts[1], "base64url")` + `JSON.parse` only. |
| T-05 (opaque-token warn, not abort) | Opaque token detected → warn + continue, session created | LOCKED | `index.ts:347-357`: warn is emitted but does NOT return early; `createSession` is called on the next line; `auth.oidc.spec.ts` Test 8 asserts session creation succeeds with opaque token. |
| T-06 (clock-skew 30s symmetric) | `ACCESS_TOKEN_CLOCK_SKEW_SECONDS = 30` matches Phase 5 `clockTolerance: 30` | LOCKED | `sessionStore.ts:191`; skew uses `exp + ACCESS_TOKEN_CLOCK_SKEW_SECONDS < nowSeconds` (within skew = pass; outside = drop); `sessionStore.crud.spec.ts` Tests L (exp − 10s returns row) and M (exp − 31s returns null) directly test the boundary. |
| Auth.ts unchanged (Phase 6 boundary) | `requireAuth` step-6 null path reused unchanged | CONFIRMED | Last commit to `auth.ts` is `f1f611d` (Phase 4); no Phase 6 commits modify `src/auth.ts`. |

---

### Anti-Patterns Found

No blockers detected.

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `kinetica.ts:190,199,215,227-231` | — | `emitAudit({ ...baseAudit, ... })` spread at callsites | Info | Spread is at the **call-site argument** level, not inside `JSON.stringify`. The `emitAudit` body uses explicit key enumeration — Phase 02-02 discipline intact. TypeScript enforces the exact field set. |

---

### Test Suite Summary

| Command | Result |
|---------|--------|
| `npx tsc --noEmit` (from `kinetica_bi/server/`) | Exit 0 — zero TypeScript errors |
| `npx vitest run` (full suite) | 328 passed, 1 skipped (pre-existing), 0 failed — 22 test files |
| `npx vitest run` (Phase 6 spec files only) | 127 passed, 1 skipped — 7 test files |

---

### Human Verification Required

None. All Phase 6 success criteria are verifiable programmatically through the test suite and static code analysis. The one UX surface (the REAUTH redirect to `/api/auth/oidc/start`) is Phase 7 work and is not claimed by Phase 6.

---

## Gaps Summary

No gaps. All 5 success criteria verified, all 5 requirement IDs covered, all 4 pitfall locks confirmed, TypeScript clean, full test suite green (328/329 passing, 1 pre-existing skip).

---

*Verified: 2026-05-01T17:00:00Z*
*Verifier: Claude (gsd-verifier)*
