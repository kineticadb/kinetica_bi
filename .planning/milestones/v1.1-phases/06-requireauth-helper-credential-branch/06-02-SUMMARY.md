---
phase: 06-requireauth-helper-credential-branch
plan: "02"
subsystem: auth
tags: [jwt, session, oidc, expiry, decode, sqlite]

# Dependency graph
requires:
  - phase: 04-schema-sessionstore-foundation
    provides: getSession, createSession, deleteStmt pattern, SessionRow type with credentialType
  - phase: 05-oidc-module-routes
    provides: OIDC sessions with credential_type='oidc', secret=access_token, clockTolerance=30

provides:
  - tryDecodeAccessTokenExp: exported decode-only JWT exp helper (consumed by Plan 06-03 for opaque-token warning)
  - getSession 4th drop-row trigger: proactive access-token exp check for OIDC sessions
  - ACCESS_TOKEN_CLOCK_SKEW_SECONDS = 30 constant (symmetric with Phase 5 clockTolerance: 30)

affects: [06-03, auth, sessionStore]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "decode-only JWT inspection: Buffer.from(parts[1], 'base64url').toString('utf8') + JSON.parse; no jsonwebtoken.verify (PITFALL I-07)"
    - "single failure mode: any parse problem (segments, base64, JSON, non-numeric exp) returns null"
    - "symmetric drop-row-on-failure inside getSession: isExpired + secret decrypt + id_token decrypt + access_token exp (4 triggers total)"
    - "clock-skew tolerance: exp + SKEW < nowSeconds (NOT >=) preserves the 30s window symmetrically"

key-files:
  created: []
  modified:
    - kinetica_bi/server/src/sessionStore.ts
    - kinetica_bi/server/tests/sessionStore.crud.spec.ts

key-decisions:
  - "tryDecodeAccessTokenExp colocated above getSession in sessionStore.ts (not a separate util file) for cohesion"
  - "ACCESS_TOKEN_CLOCK_SKEW_SECONDS = 30 declared as module-level const immediately after the helper (documents the symmetric match)"
  - "Proactive exp check placed as 4th step in getSession (after id_token decrypt, before return) per CONTEXT.md order"
  - "Opaque tokens (null from tryDecodeAccessTokenExp) skip the check silently — reactive 401-REAUTH chain handles them"
  - "auth.ts unchanged — requireAuth step-6 null path absorbs the new null cause identically (no new dispatch)"

patterns-established:
  - "decode-only JWT inspection (PITFALL I-07): no jsonwebtoken; base64url Buffer decode only"
  - "drop-row-on-failure symmetry: all 4 getSession failure modes use deleteStmt.run(sid) + return null"

requirements-completed: [UX-04, UX-05]

# Metrics
duration: 3min
completed: 2026-05-01
---

# Phase 06 Plan 02: Access-Token Expiry Check in getSession Summary

**Decode-only tryDecodeAccessTokenExp helper + proactive exp drop in getSession: expired OIDC access tokens never forwarded to Kinetica (SC3, PITFALL I-07)**

## Performance

- **Duration:** 3 min
- **Started:** 2026-05-01T16:15:30Z
- **Completed:** 2026-05-01T16:18:39Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Exported `tryDecodeAccessTokenExp(token: string): number | null` helper — decode-only JWT exp extraction via base64url middle-segment; returns null for all parse failures (opaque/malformed tokens)
- Extended `getSession` with 4th drop-row trigger (OIDC-only): if decoded exp + 30s skew < now, `deleteStmt.run(sid) + return null` — expired tokens never reach `requireAuth`
- Added `ACCESS_TOKEN_CLOCK_SKEW_SECONDS = 30` constant matching Phase 5's `clockTolerance: 30`
- 15 new tests: 8 `tryDecodeAccessTokenExp` unit tests + 7 `getSession` integration tests (past-exp drop, future-exp pass, skew tolerance, opaque-token pass, password-mode untouched)
- Full server test suite green: 306 pass, 1 skipped, 21 test files

## Task Commits

Each task was committed atomically:

1. **Task 1: Add tryDecodeAccessTokenExp helper + getSession proactive exp branch** - `cec4fbe` (feat)
2. **Task 2: Add tests for getSession proactive exp + tryDecodeAccessTokenExp** - `1f9d7fa` (test)

_Note: TDD tasks — tests written first (RED verified), then implementation (GREEN verified)._

## Files Created/Modified
- `kinetica_bi/server/src/sessionStore.ts` — Added `tryDecodeAccessTokenExp` export, `ACCESS_TOKEN_CLOCK_SKEW_SECONDS = 30`, and proactive exp check inside `getSession` (4th drop-row trigger, OIDC-only)
- `kinetica_bi/server/tests/sessionStore.crud.spec.ts` — Added `makeJwt` helper, `describe("tryDecodeAccessTokenExp")` (8 tests), `describe("getSession proactive access-token exp check (PITFALL I-07)")` (7 tests)

## API Contract: tryDecodeAccessTokenExp

```typescript
export const tryDecodeAccessTokenExp = (token: string): number | null;
```

- Returns the numeric `exp` claim (seconds since epoch) when the token is a standard 3-segment JWT with a numeric `exp` in the payload
- Returns `null` on ANY failure: ≠3 segments, malformed base64url, malformed JSON, missing `exp`, non-numeric `exp`
- Caller treats `null` as "opaque or unparseable — skip proactive check, defer to reactive 401"
- NOT signature-verified (PITFALL I-07: signature verified once at OIDC callback; AES-256-GCM protects integrity at rest)
- Consumed by Plan 06-03 for the one-time opaque-token warning at `/oidc/callback`

## getSession Drop-Row Order (now 4 triggers)

1. **isExpired (row TTL)**: `expires_at <= datetime('now')` → `deleteStmt.run(sid) + return null`
2. **secret decrypt failure**: AES-GCM auth-tag mismatch → `deleteStmt.run(sid) + return null`
3. **id_token decrypt failure**: AES-GCM auth-tag mismatch → `deleteStmt.run(sid) + return null`
4. **access_token exp (NEW)**: OIDC-only; `exp + 30 < nowSeconds` → `deleteStmt.run(sid) + return null`; opaque tokens (null exp) pass through silently

## auth.ts Unchanged

`requireAuth`'s step-6 null path already handles all four failure modes identically: `getSession` returns null → `clearCookie` → `401 { code: "REAUTH_REQUIRED" }`. No new dispatch. Plan 06-02 MUST NOT change auth.ts (verified: `git diff kinetica_bi/server/src/auth.ts` is empty).

## Plan 06-03 Handoff

`tryDecodeAccessTokenExp` is now exported from `sessionStore.ts`. Plan 06-03 (opaque-token warning at `/oidc/callback`) can import it to detect opaque access tokens at session creation time and emit a one-time structured warning log.

## Decisions Made
- `tryDecodeAccessTokenExp` colocated above `getSession` in `sessionStore.ts` (not a separate util file) — cohesion over file count
- `ACCESS_TOKEN_CLOCK_SKEW_SECONDS = 30` placed immediately after the helper body to document the symmetric match with Phase 5 `clockTolerance: 30` (PITFALL T-06)
- Proactive exp check as step 4 inside `getSession` (after id_token decrypt, before return) — follows CONTEXT.md specified order
- `auth.ts` deliberately unchanged — requireAuth step-6 null path absorbs the new failure mode without modification

## Deviations from Plan

None — plan executed exactly as written. TDD RED/GREEN cycle confirmed for both tasks.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness
- `tryDecodeAccessTokenExp` exported and tested; ready for Plan 06-03 opaque-token warning import
- `getSession` now returns null for expired OIDC tokens; SC3 (expired token never forwarded) satisfied
- Full test suite green; all Phase 6 contracts intact

---
*Phase: 06-requireauth-helper-credential-branch*
*Completed: 2026-05-01*
