---
phase: 01-encrypted-server-side-session-store
plan: "01"
subsystem: testing
tags: [vitest, better-sqlite3, typescript, supertest]

requires: []
provides:
  - "vitest test runner wired to kinetica_bi/server with npm test script"
  - "createDb(path) factory in db.ts allowing in-memory test isolation"
  - "exported db singleton for sessionStore.ts use in Wave 1"
  - "9 spec files scaffolding all SESS-01..05 test names as it.todo placeholders"
  - "tests/setup.ts with env primers and fetch mock helpers"
  - "tests/helpers/db.ts buildInMemoryDb() using createDb(':memory:')"
affects:
  - "01-02-PLAN.md (Wave 1 — sessionStore.ts implementation fills in it.todo)"
  - "01-03-PLAN.md (Wave 2 — auth route refactor fills in route todos)"
  - "01-04-PLAN.md (Wave 3 — integration + /me todo)"

tech-stack:
  added: ["vitest@4.1.5", "@vitest/coverage-v8@4.1.5", "supertest@7.2.2", "@types/supertest@7.2.0", "@types/better-sqlite3@7.6.13"]
  patterns:
    - "createDb(path) factory pattern: tests call createDb(':memory:') for isolation; production singleton calls createDb(process.env.DB_PATH)"
    - "vitest isolate:true per spec file resets module singleton state between files"
    - "setupFiles pattern: tests/setup.ts primes env vars and exposes fetch mock helpers"

key-files:
  created:
    - "kinetica_bi/server/vitest.config.ts"
    - "kinetica_bi/server/tests/setup.ts"
    - "kinetica_bi/server/tests/helpers/db.ts"
    - "kinetica_bi/server/tests/helpers/app.ts"
    - "kinetica_bi/server/tests/db.smoke.spec.ts"
    - "kinetica_bi/server/tests/sessionStore.crypto.spec.ts"
    - "kinetica_bi/server/tests/sessionStore.crud.spec.ts"
    - "kinetica_bi/server/tests/sessionStore.sweep.spec.ts"
    - "kinetica_bi/server/tests/sessionStore.boot.spec.ts"
    - "kinetica_bi/server/tests/auth.cookie.spec.ts"
    - "kinetica_bi/server/tests/auth.routes.spec.ts"
    - "kinetica_bi/server/tests/auth.requireAuth.spec.ts"
  modified:
    - "kinetica_bi/server/src/db.ts"
    - "kinetica_bi/server/package.json"

key-decisions:
  - "Option 1 (createDb factory) chosen over Option 2 (vi.resetModules env swap): cleaner test setup, db singleton becomes importable for sessionStore"
  - "setup.ts created in Task 2 (not Task 3) to unblock vitest's setupFiles resolution — Rule 3 auto-fix"
  - "@types/better-sqlite3 installed to fix pre-existing TS7016 build error blocking npm run build acceptance criterion"
  - "db.ts exports db as named export (was previously module-private) enabling sessionStore.ts to import the singleton in Wave 1"

patterns-established:
  - "Test isolation via createDb(':memory:') — each test file gets its own in-memory SQLite instance"
  - "it.todo placeholder pattern — Wave 0 enumerates all test names, Waves 1/2 replace with real assertions"
  - "Smoke spec (db.smoke.spec.ts) verifies post-refactor export shape so vitest confirms correctness, not fragile tsx --eval probes"

requirements-completed: [SESS-01, SESS-02, SESS-03, SESS-04, SESS-05]

duration: 5min
completed: 2026-04-28
---

# Phase 01 Plan 01: Wave 0 Test Infrastructure Summary

**vitest test runner installed in kinetica_bi/server; db.ts refactored to export createDb(':memory:') factory; 9 spec files scaffold all SESS-01..05 test names as it.todo placeholders with 4 real smoke assertions passing**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-28T11:09:55Z
- **Completed:** 2026-04-28T11:14:51Z
- **Tasks:** 3
- **Files modified:** 14 (1 modified source, 13 new test/config files)

## Accomplishments
- vitest 4.1.5 installed with supertest; `npm test -- --run` exits 0; vitest.config.ts wired to `tests/**/*.spec.ts` with setupFiles
- `db.ts` refactored to export `createDb(dbPath)` factory and named `db` singleton; all 25 CRUD exports preserved; `npm run build` clean
- 9 spec files created: 8 todo-only (45 total `it.todo` placeholders across SESS-01..05, boot, cookie, routes, requireAuth) + 1 real smoke spec (4/4 assertions pass)

## Task Commits

Each task was committed atomically:

1. **Task 1: Install vitest+supertest dev deps and add npm test script** - `d674958` (chore)
2. **Task 2: Refactor db.ts to export createDb factory + smoke spec** - `7db6960` (feat)
3. **Task 3: Add test helpers and 8 spec files with it.todo placeholders** - `7a44599` (feat)

## Files Created/Modified

- `kinetica_bi/server/vitest.config.ts` — vitest config (node env, tests/**/*.spec.ts glob, isolate:true, setupFiles)
- `kinetica_bi/server/src/db.ts` — refactored: `export const createDb(dbPath)` factory + `export const db` singleton (was private)
- `kinetica_bi/server/package.json` — added `"test": "vitest"` script + 5 new devDependencies
- `kinetica_bi/server/tests/setup.ts` — env primers (SESSION_ENCRYPTION_KEY, KINETICA_URL, AUTH_SECRET) + mockKineticaLoginOK/Unauthorized helpers
- `kinetica_bi/server/tests/db.smoke.spec.ts` — 4 real assertions: createDb is function, db is singleton, :memory: creates 5 tables, listDashboards export survives
- `kinetica_bi/server/tests/helpers/db.ts` — `buildInMemoryDb()` using `createDb(":memory:")`
- `kinetica_bi/server/tests/helpers/app.ts` — placeholder; Wave 2 fills in createApp()
- `kinetica_bi/server/tests/sessionStore.crypto.spec.ts` — 6 SESS-01 AES-256-GCM todos
- `kinetica_bi/server/tests/sessionStore.crud.spec.ts` — 7 SESS-01/04/05 CRUD todos
- `kinetica_bi/server/tests/sessionStore.sweep.spec.ts` — 3 SESS-05 sweep timer todos
- `kinetica_bi/server/tests/sessionStore.boot.spec.ts` — 5 SESSION_ENCRYPTION_KEY boot validation todos
- `kinetica_bi/server/tests/auth.cookie.spec.ts` — 8 SESS-01/02 JWT cookie shape todos
- `kinetica_bi/server/tests/auth.routes.spec.ts` — 6 SESS-03 logout + /me route todos
- `kinetica_bi/server/tests/auth.requireAuth.spec.ts` — 10 requireAuth failure-mode dispatch todos

## it.todo Test Names (Wave 1/2 will fill in)

**sessionStore.crypto.spec.ts (SESS-01):**
- encryptPassword/decryptPassword round-trip recovers the original password
- tamper: flipping any byte of ciphertext causes decryptPassword to throw
- tamper: flipping any byte of authTag causes decryptPassword to throw
- tamper: flipping any byte of iv causes decryptPassword to throw
- encryptPassword generates a fresh 12-byte IV for every call (no IV reuse)
- encryptPassword's ciphertext bytes do not contain the plaintext substring

**sessionStore.crud.spec.ts (SESS-01, SESS-04, SESS-05):**
- createSession INSERTs a row with non-empty BLOB columns (ciphertext, iv, auth_tag)
- getSession returns the decrypted password and stamped username/kineticaUrl
- 8h TTL: createSession stamps expires_at within ±60s of datetime('now', '+8 hours')
- no sliding: requireAuth-style touch updates last_used_at but NOT expires_at
- sweep: sweepExpiredSessions deletes rows with expires_at <= datetime('now') and returns the row count
- sweep: sweepExpiredSessions does NOT delete rows whose expires_at is in the future
- passive expiry: getSession on an expired row returns null AND deletes the row

**sessionStore.sweep.spec.ts (SESS-05):**
- startSessionSweep schedules a 1-hour interval and returns a Timer with .unref()
- on tick, the timer calls sweepExpiredSessions and logs the deleted count
- resilient: if sweepExpiredSessions throws, the timer survives and runs again on next tick

**sessionStore.boot.spec.ts:**
- getSessionEncryptionKey throws if SESSION_ENCRYPTION_KEY is unset
- getSessionEncryptionKey throws if SESSION_ENCRYPTION_KEY is not exactly 64 hex chars
- getSessionEncryptionKey throws if SESSION_ENCRYPTION_KEY contains non-hex characters
- getSessionEncryptionKey returns a Buffer of length 32 on a valid key
- error message includes the hint: openssl rand -hex 32

**auth.cookie.spec.ts (SESS-01, SESS-02):**
- issueSessionCookie writes a JWT whose decoded payload is { sub, sid, v: 1, iat, exp }
- no password in JWT: the decoded JWT payload does not contain the plaintext password substring
- no password in JWT: the decoded JWT payload has no key named 'password'
- opaque sid: sid in JWT matches /^[0-9a-f]{64}$/ (256-bit hex)
- opaque sid: sid is not derived from the username (different usernames produce statistically distinct sids)
- readSession rejects an old-shape cookie (no v field) — returns null
- readSession rejects a v !== 1 cookie — returns null
- readSession rejects a cookie missing sid — returns null

**auth.routes.spec.ts (SESS-03):**
- logout deletes row: POST /api/auth/logout removes the sessions row matching the cookie sid
- logout deletes row: replaying the old cookie after logout returns 401 + REAUTH_REQUIRED
- logout best-effort: malformed cookie still gets cleared and returns 204 (no crash)
- logout best-effort: missing cookie still returns 204 (no crash)
- me after delete: GET /api/auth/me returns 401 after sqlite3 DELETE FROM sessions out-of-band
- login writes a sessions row with username and kinetica_url stamped from env

**auth.requireAuth.spec.ts:**
- Step 1: missing cookie → 401 + REAUTH_REQUIRED
- Step 2: invalid JWT signature → 401 + REAUTH_REQUIRED
- Step 3: missing v field (old cookie shape) → 401 + REAUTH_REQUIRED
- Step 4: empty/missing sid → 401 + REAUTH_REQUIRED
- Step 5: empty/missing sub → 401 + REAUTH_REQUIRED
- Step 6: row missing in sessions table → 401 + REAUTH_REQUIRED + clears cookie
- Step 7: row expired → 401 + REAUTH_REQUIRED + deletes row + clears cookie
- Step 8: kinetica_url mismatch with current env → 401 + REAUTH_REQUIRED + deletes row + clears cookie
- Step 9: AES-GCM decrypt failure (key rotated / row corrupted) → 401 + REAUTH_REQUIRED + deletes row + clears cookie
- Step 10 (success): all checks pass → req.user populated with { sub, sid, creds: { username, password } } and last_used_at touched

## Decisions Made

- **createDb factory (Option 1)** over vi.resetModules env swap (Option 2): chosen per RESEARCH recommendation; enables clean per-test isolation and makes db importable for sessionStore.ts in Wave 1
- **db exported as named export**: required for `sessionStore.ts` to `import { db } from "./db"` in Plan 02 — locked per RESEARCH §"Specific Decisions"
- **sessions DDL deferred to Plan 02**: Wave 0 adds only the factory; sessions table lands in Wave 1 Task 1 which extends db.smoke.spec.ts

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Created tests/setup.ts during Task 2 (not Task 3)**
- **Found during:** Task 2 verification (`npm test -- --run tests/db.smoke.spec.ts`)
- **Issue:** vitest.config.ts references `setupFiles: ["./tests/setup.ts"]`; file did not exist; vitest failed with "Cannot find module" before running any test
- **Fix:** Created tests/setup.ts with full content specified in Task 3 plan (env primers + fetch mock helpers) during Task 2 execution
- **Files modified:** kinetica_bi/server/tests/setup.ts
- **Verification:** `npm test -- --run tests/db.smoke.spec.ts` passed 4/4 after creation
- **Committed in:** 7db6960 (Task 2 commit)

**2. [Rule 2 - Missing Critical] Installed @types/better-sqlite3**
- **Found during:** Task 2 verification (`npm run build`)
- **Issue:** Pre-existing TS7016 error: `better-sqlite3` had no declaration file; `npm run build` exited 2 on the original codebase (verified by git stash test)
- **Fix:** `npm install --save-dev @types/better-sqlite3`
- **Files modified:** kinetica_bi/server/package.json, package-lock.json, node_modules/@types/better-sqlite3/
- **Verification:** `npm run build` exits 0 after install
- **Committed in:** 7db6960 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 Rule 3 blocking, 1 Rule 2 missing critical)
**Impact on plan:** Both fixes necessary to meet acceptance criteria. No scope creep — setup.ts content matches Task 3 spec exactly; @types/better-sqlite3 restores build health that was already broken pre-plan.

## Issues Encountered

- Task 3's setup.ts creation was pre-empted by Task 2 (see Deviations). Task 3 proceeded normally for the 9 remaining files.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Wave 0 complete: vitest infrastructure, createDb factory, 9 spec files (45 todos + 4 passing) in place
- Plan 02 (Wave 1) can immediately implement `sessionStore.ts` and replace the it.todo placeholders in sessionStore.*.spec.ts
- Plan 02 Task 1 should extend `tests/db.smoke.spec.ts` with sessions DDL assertions as noted in the smoke spec comment
- No blockers for Wave 1

---
*Phase: 01-encrypted-server-side-session-store*
*Completed: 2026-04-28*
