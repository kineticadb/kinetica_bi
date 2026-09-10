---
phase: 01-encrypted-server-side-session-store
plan: "02"
subsystem: session-store
tags: [aes-256-gcm, better-sqlite3, sessionStore, vitest, encryption]

requires:
  - "01-01: vitest infrastructure, createDb factory, db singleton export, 4 spec files with it.todo"
provides:
  - "kinetica_bi/server/src/sessionStore.ts: AES-256-GCM helpers + sessions CRUD + sweep + boot validation"
  - "sessions DDL appended to db.ts createDb factory (sessions table + 2 indices)"
  - "28 real passing tests across 5 spec files (crypto/crud/sweep/boot/db.smoke)"
  - "All 11 named function exports + 2 type exports required by Plan 03"
affects:
  - "01-03-PLAN.md (Wave 2): auth.ts must import touchSession, createSession, getSession, deleteSession, startSessionSweep from sessionStore.ts"
  - "01-04-PLAN.md (Wave 3): integration tests will call createSession/getSession end-to-end"

tech-stack:
  added: []
  patterns:
    - "AES-256-GCM per-row encryption: fresh 12-byte IV per encrypt call (randomBytes(12)), auth tag checked before final() on decrypt"
    - "Fail-fast boot validation: getSessionEncryptionKey() called at module load; throws if SESSION_ENCRYPTION_KEY missing/wrong-length/non-hex"
    - "Passive expiry-on-access: getSession deletes the row inline if expires_at <= datetime('now') before returning null"
    - "Prepared-statement singletons: all SQL compiled once at module load via db.prepare(); no re-compilation per call"
    - "GC sweep resilience: setInterval callback wrapped in try/catch; errors logged but interval never cleared (Pitfall P6)"
    - "DB_PATH=:memory: in tests/setup.ts so each isolate:true spec file gets its own in-memory SQLite preventing cross-file contamination"

key-files:
  created:
    - "kinetica_bi/server/src/sessionStore.ts"
  modified:
    - "kinetica_bi/server/src/db.ts"
    - "kinetica_bi/server/tests/db.smoke.spec.ts"
    - "kinetica_bi/server/tests/sessionStore.crypto.spec.ts"
    - "kinetica_bi/server/tests/sessionStore.crud.spec.ts"
    - "kinetica_bi/server/tests/sessionStore.sweep.spec.ts"
    - "kinetica_bi/server/tests/sessionStore.boot.spec.ts"
    - "kinetica_bi/server/tests/setup.ts"

key-decisions:
  - "DB_PATH=:memory: added to tests/setup.ts to prevent cross-file SQLite contamination (vitest isolate:true creates independent module graphs per spec file, each with its own in-memory DB)"
  - "Sweep resilience test uses DROP TABLE to force sweepStmt.run() to throw, then recreates table before second tick — avoids need to intercept module-internal call"
  - "sessionStore.ts uses module-level prepared statements (compiled at import time) — fail-fast behavior catches invalid DB state at server startup"

requirements-completed: [SESS-01, SESS-04, SESS-05]

duration: 7min
completed: 2026-04-28
---

# Phase 01 Plan 02: Wave 1 sessionStore Core Summary

**AES-256-GCM sessionStore.ts implemented with boot validation, sessions CRUD, and GC sweep; sessions DDL added to db.ts; all 4 sessionStore spec files converted from it.todo to 23 passing real assertions**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-04-28T11:17:52Z
- **Completed:** 2026-04-28T11:25:01Z
- **Tasks:** 2
- **Files modified:** 8 (1 new source, 1 modified source, 6 modified test files)

## Accomplishments

- `kinetica_bi/server/src/sessionStore.ts` created (177 lines) — all 11 named function exports + 2 type exports present; all public API required by Plan 03 wiring is in place
- Sessions DDL appended to `db.ts` `SCHEMA_DDL` template literal: `sessions` table (9 columns) + `idx_sessions_expires_at` + `idx_sessions_username` (both `IF NOT EXISTS`, idempotent)
- `tests/db.smoke.spec.ts` extended with Wave 1 assertion: sessions table, both indices, and 9-column schema order verified via `PRAGMA table_info`
- All 4 sessionStore spec files converted from `it.todo` to real assertions (23 tests total, 0 failures)
- Full test suite: 28 passed, 24 todo (Wave 2 auth specs — intentional), 0 failures; `npm run build` clean

## Task Commits

1. **Task 1: Sessions DDL + db.smoke.spec.ts extension** - `4268eae` (feat)
2. **Task 2: sessionStore.ts + 4 spec files with real assertions** - `fc49285` (feat)

## sessionStore.ts Exports

| Export | Signature | Behavior |
|--------|-----------|----------|
| `getSessionEncryptionKey` | `() => Buffer` | Reads `SESSION_ENCRYPTION_KEY` env; throws if missing/wrong/non-hex; returns 32-byte Buffer |
| `encryptPassword` | `(password: string) => EncryptedBlob` | AES-256-GCM with fresh 12-byte IV; returns `{ ciphertext, iv, authTag }` |
| `decryptPassword` | `(blob: EncryptedBlob) => string` | AES-256-GCM decrypt; throws "unable to authenticate" on tag mismatch |
| `generateSid` | `() => string` | `randomBytes(32).toString("hex")` — 64 hex chars |
| `createSession` | `(username, password, kineticaUrl) => string` | Generates sid, encrypts password, INSERTs row with `expires_at = datetime('now', '+8 hours')`, returns sid |
| `getSession` | `(sid: string) => SessionRow \| null` | SELECT + expiry check + decrypt; deletes row on expiry or decrypt failure |
| **`touchSession`** | `(sid: string) => void` | UPDATE `last_used_at = datetime('now')` only — NEVER touches `expires_at` (Plan 03 consumer) |
| `deleteSession` | `(sid: string) => void` | DELETE WHERE sid |
| `deleteSessionsForUser` | `(username: string) => number` | DELETE WHERE username; returns rows deleted |
| `sweepExpiredSessions` | `() => number` | DELETE WHERE `expires_at <= datetime('now')`; returns rows deleted |
| `startSessionSweep` | `() => NodeJS.Timeout` | 1h `setInterval` with try/catch + `.unref()`; logs deleted count per tick |
| `type EncryptedBlob` | `{ ciphertext: Buffer; iv: Buffer; authTag: Buffer }` | In-memory crypto blob shape |
| `type SessionRow` | `{ sid, username, password, kineticaUrl, createdAt, lastUsedAt, expiresAt }` | Decrypted session shape |

## DDL Added to db.ts

Sessions table added inside `SCHEMA_DDL` template literal in `createDb()` factory:

```sql
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  ciphertext BLOB NOT NULL,
  iv BLOB NOT NULL,
  auth_tag BLOB NOT NULL,
  kinetica_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions (username);
```

## Test Pass Count Delta

| Spec File | Before (Plan 01) | After (Plan 02) | Delta |
|-----------|-----------------|-----------------|-------|
| db.smoke.spec.ts | 4 passed | 5 passed | +1 |
| sessionStore.crypto.spec.ts | 6 todo | 6 passed | +6 |
| sessionStore.crud.spec.ts | 7 todo | 9 passed | +9 (7 original + 2 extra) |
| sessionStore.sweep.spec.ts | 3 todo | 3 passed | +3 |
| sessionStore.boot.spec.ts | 5 todo | 5 passed | +5 |
| **Total** | **4 passed, 21 todo** | **28 passed, 24 todo** | **+24 passing** |

Note: crud spec has 9 real tests (7 from it.todo + 2 additional: `getSession on missing sid` and `decrypt failure deletes row` — both required by the plan's behavior spec).

## Notes for Wave 2 (Plan 03)

Wave 2 wires `auth.ts` and `index.ts` to call into this module. The 5 functions auth.ts and index.ts must integrate:

1. **`createSession(username, password, kineticaUrl)`** — call after Kinetica credential verification in login route; pass the returned sid to `issueSessionCookie`
2. **`getSession(sid)`** — call in `requireAuth` after JWT verify; replace current cookie payload shape with `{ sub, sid, v: 1 }`; attach `req.user = { sub, sid, creds: { username, password } }`
3. **`touchSession(sid)`** — call at end of successful `requireAuth` to stamp `last_used_at` (NOT `expires_at`)
4. **`deleteSession(sid)`** — call in logout route handler after reading sid from JWT
5. **`startSessionSweep()`** — call once after `app.listen()` in index.ts to start GC

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added DB_PATH=:memory: default to tests/setup.ts**
- **Found during:** Task 2 verification (`npm test -- --run` with all spec files)
- **Issue:** With `vitest isolate:true`, spec files run in parallel worker processes but share the on-disk SQLite file (`data/kinetica.db`). The sweep resilience test drops the sessions table from the file, causing the crud spec (running concurrently) to fail with "no such table: sessions"
- **Fix:** Added `process.env.DB_PATH = process.env.DB_PATH || ":memory:"` to `tests/setup.ts`. Since `setup.ts` is loaded before module imports, each spec file's isolated module graph creates `db = createDb(":memory:")` — giving each spec its own in-memory SQLite. Completely eliminates cross-file contamination.
- **Files modified:** `kinetica_bi/server/tests/setup.ts`
- **Committed in:** `fc49285` (Task 2 commit)

**2. [Rule 1 - Bug] Replaced hex-literal INSERT with createSession+UPDATE in sweep crud test**
- **Found during:** Task 2 verification (first run with all 4 specs together)
- **Issue:** `db.prepare("INSERT INTO sessions ... VALUES ('expired-sid-1', ..., x'ccddee112233', ...)").run()` on the spec's db connection wasn't visible to `sweepExpiredSessions()` via sessionStore's db connection. Root cause: two separate SQLite connections to the same file; WAL snapshot isolation at time of prepared statement compilation
- **Fix:** Used `createSession()` to insert via sessionStore's connection, then `db.prepare("UPDATE sessions SET expires_at=...").run()` to expire the row — both connections see each other's committed writes
- **Files modified:** `kinetica_bi/server/tests/sessionStore.crud.spec.ts`
- **Committed in:** `fc49285` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 Rule 2 missing critical, 1 Rule 1 bug)
**Impact on plan:** Both fixes necessary for reliable test execution. No scope changes.

## Issues Encountered

- None blocking; both issues detected and fixed within Task 2 execution.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Wave 1 complete: sessionStore.ts ships the data-plane keystone; all 11 exports present; 23/23 sessionStore spec tests passing
- Plan 03 (Wave 2) can immediately wire auth.ts to call `createSession`/`getSession`/`touchSession`/`deleteSession` and index.ts to call `startSessionSweep()`
- No blockers for Wave 2

---
*Phase: 01-encrypted-server-side-session-store*
*Completed: 2026-04-28*
