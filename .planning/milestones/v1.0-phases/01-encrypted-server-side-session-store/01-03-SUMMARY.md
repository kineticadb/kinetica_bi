---
phase: 01-encrypted-server-side-session-store
plan: "03"
subsystem: auth
tags: [jwt, session-store, express, vitest, supertest, aes-256-gcm]

requires:
  - "01-02: sessionStore.ts exports createSession/getSession/touchSession/deleteSession/startSessionSweep + SessionRow type"
provides:
  - "kinetica_bi/server/src/auth.ts: widened SessionPayload { sub, sid, v: 1 }; decodeAndVerifyJwt; loadSessionForRequest; rewired requireAuth (9-step dispatch); issueSessionCookie(res, username, sid)"
  - "kinetica_bi/server/src/index.ts: createApp() exported; login writes sessions row; logout deletes sessions row (best-effort); /me uses loadSessionForRequest (row-existence check)"
  - "kinetica_bi/server/tests/helpers/app.ts: real buildTestApp() for supertest integration"
  - "56 passing tests across 8 spec files, 0 todos remaining"
affects:
  - "01-04-PLAN.md (Wave 3): must call startSessionSweep() in bootstrap, update .env.example with SESSION_ENCRYPTION_KEY, ship deploy runbook note"

tech-stack:
  added: []
  patterns:
    - "Cookie-as-opaque-pointer: JWT payload { sub, sid, v: 1 } — no credentials in cookie"
    - "9-step requireAuth dispatch: JWT failures (steps 1-5) no clearCookie; row-absent/expired/corrupt (steps 6/7/9, handled by getSession) clearCookie; kineticaUrl mismatch (step 8) deleteSession+clearCookie; success touchSession+req.user"
    - "Best-effort logout: decodeAndVerifyJwt returns null gracefully on garbage cookie; deleteSession swallowed; clearSessionCookie always called"
    - "Migration trap fix: /me uses loadSessionForRequest (row must exist); previously only checked JWT signature"
    - "createApp() factory pattern: all routes/middleware inside exported function; production bootstrap calls createApp() then app.listen(); supertest drives unlistened app"

key-files:
  created: []
  modified:
    - "kinetica_bi/server/src/auth.ts"
    - "kinetica_bi/server/src/index.ts"
    - "kinetica_bi/server/tests/helpers/app.ts"
    - "kinetica_bi/server/tests/auth.cookie.spec.ts"
    - "kinetica_bi/server/tests/auth.requireAuth.spec.ts"
    - "kinetica_bi/server/tests/auth.routes.spec.ts"

key-decisions:
  - "Steps 7 (expired) and 9 (decrypt failure) handled inside getSession (returns null AND deletes row) — requireAuth only checks session===null, not individual step codes. Observable behavior matches 9-step table exactly."
  - "No readSession alias exported — index.ts /me already targeted for loadSessionForRequest replacement in Task 2 (Option 2 from plan)"
  - "kineticaUrl moved from module-level const to process.env.KINETICA_URL read-per-request inside createApp — ensures test URL overrides propagate correctly without module reload"

requirements-completed: [SESS-01, SESS-02, SESS-03]

duration: 6min
completed: 2026-04-28
---

# Phase 01 Plan 03: Wave 2 Auth Wiring Summary

**auth.ts rewritten with widened SessionPayload { sub, sid, v: 1 }, 9-step requireAuth dispatch, decodeAndVerifyJwt + loadSessionForRequest exports; index.ts wired to sessionStore with createApp() factory; full 56-test suite green with zero todos**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-04-28T11:28:08Z
- **Completed:** 2026-04-28T11:34:53Z
- **Tasks:** 2
- **Files modified:** 6 (3 source, 3 test)

## Accomplishments

- `auth.ts` fully rewritten (per RESEARCH Example 4): SessionPayload widens from `{ sub }` to `{ sub, sid, v: 1 }`; `decodeAndVerifyJwt` and `loadSessionForRequest` exported; `requireAuth` rewired to 9-step dispatch table; `verifyKineticaCredentials` preserved byte-for-byte
- `index.ts` refactored: `createApp()` exported; login calls `createSession()` then `issueSessionCookie(res, username, sid)`; logout calls `decodeAndVerifyJwt` best-effort + `deleteSession` + `clearSessionCookie`; `/me` calls `loadSessionForRequest` (row-existence check, closes migration trap)
- `tests/helpers/app.ts` — real `buildTestApp()` backed by supertest driving `createApp()`
- All 3 auth spec files converted from `it.todo` to real assertions (21 cookie+dispatch + 7 routes = 28 new assertions)
- Full suite: 56 passed, 0 failed, 0 todo; `npm run build` clean

## Task Commits

1. **Task 1: Rewrite auth.ts + cookie/requireAuth specs** — `aecdffb` (feat)
2. **Task 2: Wire index.ts + buildTestApp + routes spec** — `8148b5f` (feat)

## auth.ts Surface Diff (old vs new)

| Export | Before | After |
|--------|--------|-------|
| `SessionPayload` | `{ sub: string }` | `{ sub: string; sid: string; v: 1 }` |
| `AuthedRequest` | `Request & { user?: SessionPayload }` | `Request & { user?: { sub, sid, creds: { username, password } } }` |
| `issueSessionCookie` | `(res, username)` — no sid | `(res, username, sid)` — 3 params |
| `readSession` | exported, returns `SessionPayload \| null` | **REMOVED** — replaced by `decodeAndVerifyJwt` |
| `decodeAndVerifyJwt` | — (new) | validates sig + v===1 + sid + sub; returns `SessionPayload \| null` |
| `loadSessionForRequest` | — (new) | JWT decode + getSession + kineticaUrl check; returns `{ jwt, session } \| null` |
| `requireAuth` | reads `readSession`, no DB lookup, 401 with bare `{ error }` | 9-step dispatch; 401 + `{ error, code: "REAUTH_REQUIRED" }` on all failures |
| `clearSessionCookie` | unchanged | unchanged |
| `verifyKineticaCredentials` | unchanged | unchanged (byte-for-byte identical) |

## index.ts Surface Diff (old vs new)

| Item | Before | After |
|------|--------|-------|
| App construction | Module-level `const app = express()` | `export const createApp = () => { ... return app; }` |
| bootstrap | `app.listen(port, ...)` at module top | `const app = createApp(); app.listen(port, ...)` at module bottom |
| `import` from auth | `readSession, clearSessionCookie, issueSessionCookie, requireAuth, verifyKineticaCredentials` | `clearSessionCookie, decodeAndVerifyJwt, issueSessionCookie, loadSessionForRequest, requireAuth, verifyKineticaCredentials` |
| `import` from sessionStore | (none) | `createSession, deleteSession` |
| login | `issueSessionCookie(res, username)` — no DB | `createSession(username, password, kineticaUrl)` → `issueSessionCookie(res, username, sid)` |
| logout | `clearSessionCookie(res)` — no DB | `decodeAndVerifyJwt(req)` best-effort → `deleteSession(sid)` (swallowed) → `clearSessionCookie(res)` |
| /me | `readSession(req)` — JWT-only | `loadSessionForRequest(req)` — row existence required |

## buildTestApp Helper Signature

```ts
// kinetica_bi/server/tests/helpers/app.ts
import request from "supertest";
import { createApp } from "../../src/index";

export const buildTestApp = () => {
  const app = createApp();
  return request(app);
};
```

## The 9-Step requireAuth Dispatch — Observable Behavior Confirmation

| Step | Check | Our Implementation | Observable (test) |
|------|-------|--------------------|-------------------|
| 1 | cookie present | `decodeAndVerifyJwt` returns null if no cookie | 401 + REAUTH, no clearCookie |
| 2 | JWT sig verifies | `jwt.verify` throws → `decodeAndVerifyJwt` returns null | 401 + REAUTH, no clearCookie |
| 3 | `decoded.v === 1` | checked in `decodeAndVerifyJwt` before sid/sub | 401 + REAUTH, no clearCookie |
| 4 | `decoded.sid` non-empty | checked in `decodeAndVerifyJwt` | 401 + REAUTH, no clearCookie |
| 5 | `decoded.sub` non-empty | checked in `decodeAndVerifyJwt` | 401 + REAUTH, no clearCookie |
| 6 | row exists | `getSession(decoded.sid)` returns null (no row) | 401 + REAUTH + clearCookie |
| 7 | row not expired | `getSession` passive expiry: deletes + returns null | 401 + REAUTH + clearCookie + row gone |
| 8 | kineticaUrl matches | explicit check in `requireAuth` after getSession | 401 + REAUTH + deleteSession + clearCookie + row gone |
| 9 | decrypt succeeds | `getSession` decrypt failure: deletes + returns null | 401 + REAUTH + clearCookie + row gone |
| 10 | success | `req.user` populated + `touchSession(sid)` + `next()` | 200 pass-through + req.user.creds populated + last_used_at bumped |

Note: Steps 7 and 9 are handled **inside `getSession`** (passive expiry-on-access + decrypt failure). Both paths return null AND delete the row. `requireAuth` catches these via the `session === null` branch (same as step 6). The `clearSessionCookie` call covers steps 6+7+9 together.

## Test Pass Count Delta

| Spec File | Before (Plan 02) | After (Plan 03) | Delta |
|-----------|-----------------|-----------------|-------|
| db.smoke.spec.ts | 5 passed | 5 passed | 0 |
| sessionStore.crypto.spec.ts | 6 passed | 6 passed | 0 |
| sessionStore.crud.spec.ts | 9 passed | 9 passed | 0 |
| sessionStore.sweep.spec.ts | 3 passed | 3 passed | 0 |
| sessionStore.boot.spec.ts | 5 passed | 5 passed | 0 |
| auth.cookie.spec.ts | 0 passed, 8 todo | 11 passed | +11 |
| auth.requireAuth.spec.ts | 0 passed, 10 todo | 10 passed | +10 |
| auth.routes.spec.ts | 0 passed, 6 todo | 7 passed | +7 |
| **Total** | **28 passed, 24 todo** | **56 passed, 0 todo** | **+28 passing, -24 todo** |

## Notes for Wave 3 (Plan 04)

Three items remain for Plan 04:

1. **`startSessionSweep()` boot call** — `index.ts` bootstrap must call `startSessionSweep()` after `app.listen()`. Currently not called — the sweep timer never starts in production. Plan 04 owns this.

2. **`.env.example` update** — `SESSION_ENCRYPTION_KEY=<run: openssl rand -hex 32>` must be appended. Plan 04 owns this.

3. **Deploy runbook note** — "On deploy, all currently logged-in users will be redirected to login on their next API call." Must be documented in a DEPLOY.md or README note. Plan 04 owns this.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed `readSession` comment reference that caused grep acceptance check to fail**
- **Found during:** Task 2 acceptance criteria verification
- **Issue:** A comment in the `/me` route handler said "Was: readSession(req)-only signature check" — caused `grep -c "readSession" kinetica_bi/server/src/index.ts` to return 1 (should be 0)
- **Fix:** Rewrote comment to not contain the string "readSession"
- **Files modified:** `kinetica_bi/server/src/index.ts`
- **Verification:** `grep -c "readSession" kinetica_bi/server/src/index.ts` now returns 0

**2. [Rule 3 - Blocking] Used static imports instead of dynamic require() in auth.cookie.spec.ts**
- **Found during:** Task 1 test execution
- **Issue:** Test "opaque sid" used `require("../src/sessionStore")` inside test body — vitest (ESM) threw "Cannot find module" at runtime
- **Fix:** Moved `createSession`/`deleteSession`/`db` imports to module top as static imports
- **Files modified:** `kinetica_bi/server/tests/auth.cookie.spec.ts`
- **Verification:** All 11 cookie tests pass

---

**Total deviations:** 2 auto-fixed (1 Rule 1 bug, 1 Rule 3 blocking)
**Impact on plan:** Both fixes trivial; no scope changes.

## Self-Check: PASSED
