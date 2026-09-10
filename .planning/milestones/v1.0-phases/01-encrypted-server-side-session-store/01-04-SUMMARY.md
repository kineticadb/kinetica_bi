---
phase: 01-encrypted-server-side-session-store
plan: "04"
subsystem: bootstrap
tags: [session-sweep, env-example, deploy-runbook, index-ts]

requires:
  - "01-03: createApp() factory, index.ts bootstrap, sessionStore.ts with startSessionSweep export"
provides:
  - "kinetica_bi/server/src/index.ts: startSessionSweep() wired after app.listen at module top level"
  - "kinetica_bi/server/.env.example: SESSION_ENCRYPTION_KEY documented with openssl generation hint"
  - ".planning/phases/01-encrypted-server-side-session-store/DEPLOY-RUNBOOK.md: operator deploy guide covering cookie-version migration, rollback, key rotation, acceptance verification"
affects:
  - "Phase 1 milestone now ship-ready: all 5 ROADMAP.md success criteria achievable"
  - "Phase 2 plans: must NOT unset KINETICA_USERNAME/KINETICA_PASSWORD until Phase 3 (documented in runbook)"

tech-stack:
  added: []
  patterns:
    - "Sweep wired outside createApp: module-top-level startSessionSweep() call after app.listen(); avoids spawning duplicate timers per supertest test invocation"
    - "Deploy documentation pattern: runbook covers old-cookie/new-code migration (Pitfall 13), rollback, key rotation, and ROADMAP success criteria verification"

key-files:
  created:
    - ".planning/phases/01-encrypted-server-side-session-store/DEPLOY-RUNBOOK.md"
  modified:
    - "kinetica_bi/server/src/index.ts"
    - "kinetica_bi/server/.env.example"

key-decisions:
  - "startSessionSweep() placed at module top level after app.listen, not inside createApp — prevents duplicate 1h timers in every supertest test invocation"
  - "DEPLOY-RUNBOOK.md explicitly names Pitfall 13 (old-cookie/new-code migration trap) and clarifies the expected 401 on first post-deploy request is intentional"

requirements-completed: [SESS-05]

duration: 2min
completed: 2026-04-28
---

# Phase 01 Plan 04: Wave 3 Bootstrap & Runbook Summary

**startSessionSweep() wired into production bootstrap after app.listen; SESSION_ENCRYPTION_KEY documented in .env.example; Phase 1 DEPLOY-RUNBOOK.md written covering cookie-version migration trap (Pitfall 13), rollback, and key rotation**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-28T11:37:43Z
- **Completed:** 2026-04-28T11:40:19Z
- **Tasks:** 2
- **Files modified:** 3 (1 source modified, 1 env example modified, 1 new docs file)

## Accomplishments

- `index.ts` bootstrap: added `startSessionSweep` to the sessionStore import line; called `startSessionSweep()` at module top level after `app.listen()` with an explanatory comment; 56/56 tests still green, build clean
- `.env.example`: appended 4-line `SESSION_ENCRYPTION_KEY` block with AES-256-GCM description, independence note, and `openssl rand -hex 32` generation hint; all 7 original vars retained
- `DEPLOY-RUNBOOK.md` created (125 lines): TL;DR, pre-deploy checklist, deploy steps, post-deploy expectations, Pitfall 13 callout, rollback plan, key rotation, phase boundary note (don't unset admin env vars until Phase 3), acceptance verification block mirroring ROADMAP.md Phase 1 success criteria

## Task Commits

1. **Task 1: Wire startSessionSweep into bootstrap and document SESSION_ENCRYPTION_KEY** - `1cd993b` (feat)
2. **Task 2: Write Phase 1 deploy runbook** - `eb0e266` (docs)

## index.ts Bootstrap Addition

```ts
// Import line (was: import { createSession, deleteSession } from "./sessionStore"):
import { createSession, deleteSession, startSessionSweep } from "./sessionStore";

// After app.listen at module bottom (new):
// Kick off the GC sweep AFTER listen so any startup error in sessionStore
// surfaces before we accept traffic. The .unref() inside startSessionSweep
// keeps test processes able to exit cleanly. Returns a Timer handle we don't
// need to track — clearInterval is never called in production.
startSessionSweep();
```

## .env.example Addition

```
# 32 bytes (64 hex chars) used to encrypt session passwords at rest with AES-256-GCM.
# Independent from AUTH_SECRET. Rotation forces all currently-logged-in users to re-login.
# Generate with: openssl rand -hex 32
SESSION_ENCRYPTION_KEY=replace-me-with-64-hex-chars-from-openssl-rand-hex-32
```

## DEPLOY-RUNBOOK.md Table of Contents

| Section | Purpose |
|---------|---------|
| TL;DR | 4-step quick reference for the operator |
| Pre-deploy | Checklist: generate SESSION_ENCRYPTION_KEY, verify env, confirm AUTH_SECRET unchanged, confirm KINETICA_URL |
| Deploy | Boot sequence description (fail-fast, DDL, listen, sweep timer) |
| Post-deploy expectations | Old-cookie 401 behavior (Pitfall 13), new-cookie shape, expected log output |
| Rollback plan | Rolling back binary; sessions table is harmless; re-deploy path |
| Key rotation | Steps, undecryptable-row behavior, no previous-key fallback in v1.0 |
| What is NOT in this phase | Phase 2 / Phase 3 boundary — don't unset KINETICA_USERNAME/KINETICA_PASSWORD yet |
| Acceptance verification | ROADMAP.md Phase 1 success criteria translated to sqlite3/curl verification commands |

**Key Pitfall 13 note in runbook:** "This is Pitfall 13 (old-cookie / new-code migration trap): old cookies silently passing `requireAuth` after a deploy is the failure mode — the `v: 1` check is the guard. The 401 on first use post-deploy is intentional and correct."

## Milestone Note

**Phase 1 ships.** All 5 ROADMAP.md Phase 1 success criteria are now achievable:
1. sessions row with encrypted BLOBs visible after login (via runbook sqlite3 query)
2. Cookie payload contains only `{ sub, sid, v: 1 }` — no plaintext password (via runbook base64 decode)
3. Logout removes sessions row + replay 401 (covered by auth.routes.spec.ts tests in Plan 03)
4. /me returns 401 when row deleted out-of-band (covered by Plan 03 "me after delete" test)
5. Expired rows GC'd within 1 hour (sweep tested in Plan 02 + wired into production bootstrap in this plan)

**Phase 2 next** — refactor 5 Kinetica call sites to use `req.user.creds` instead of the shared admin env vars.

## Test Pass Count

| Spec File | Before (Plan 03) | After (Plan 04) | Delta |
|-----------|-----------------|-----------------|-------|
| All 8 spec files | 56 passed | 56 passed | 0 (sweep wired outside createApp — no extra timers in tests) |

## Deviations from Plan

None — plan executed exactly as written. Both tasks completed without deviations.

## Self-Check: PASSED
