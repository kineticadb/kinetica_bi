---
phase: 08-boot-wipe-hardening-runbook
plan: 01
subsystem: auth

tags:
  - boot
  - sessions
  - sqlite
  - transaction
  - structured-logging
  - auth-mode

# Dependency graph
requires:
  - phase: 04-schema-sessionstore-foundation
    provides: credential_type column on sessions table (DEFAULT 'password'); SessionRow.credentialType union; createSession options-object accepting credentialType
  - phase: 05-oidc-module-routes
    provides: createApp() async signature with authMode const at top; bootstrap async IIFE wrapping app.listen + startSessionSweep
  - phase: 06-requireauth-helper-credential-branch
    provides: structured oidc_boot log convention (ts/level/event/message JSON one-liner) reused for auth_mode_change_wipe
provides:
  - boot-time AUTH_MODE-change session wipe inside createApp() (MODE-05)
  - structured auth_mode_change_wipe log event (silent on no-op)
  - data-derived contradicting-credential-type detection (no metadata table, no migration)
  - test pattern for tests that seed sessions: seed AFTER buildTestApp() so the wipe does not drop the seed
affects:
  - 08-02-PLAN (boot hardening — wraps the same bootstrap IIFE that the wipe runs inside)
  - 08-03-PLAN (runbook — operator-facing description of the wipe + the auth_mode_change_wipe event for jq filtering)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Inline named-function wipe inside createApp(): wipeSessionsOnModeChange = (): void => { db.transaction(() => { ... })() }; wipeSessionsOnModeChange();"
    - "Data-derived self-healing migration: COUNT contradicting rows; if zero, silent no-op; if non-zero, DELETE inside same transaction. No persisted last-mode metadata."
    - "Silent-on-no-op structured logging: emit auth_mode_change_wipe only when deleted > 0; reduces steady-state boot-log noise"
    - "Seed-after-buildTestApp() test pattern: any spec that seeds sessions whose credential_type contradicts the test's AUTH_MODE must seed after createApp() runs"

key-files:
  created:
    - kinetica_bi/server/tests/boot.wipe.spec.ts
  modified:
    - kinetica_bi/server/src/index.ts
    - kinetica_bi/server/tests/kinetica.creds.routes.spec.ts

key-decisions:
  - "Wipe lives inline in createApp() (not extracted to a helper module) per ARCHITECTURE.md AP-1/AP-2 — NOT in db.ts, NOT in sessionStore.ts"
  - "Wipe runs unconditionally in BOTH modes (no `if (authMode === 'oidc')` gate) — symmetric for password->oidc upgrade AND oidc->password rollback; COUNT is essentially free"
  - "DELETE target is the contradicting credential_type only (never full-table) — MODE-05's 'entire sessions table' wording resolves to 'all rows of the contradicting type'"
  - "COUNT + DELETE wrapped in single db.transaction(() => {...})() (PITFALL M-01) — atomic against any future writer; locks contract for any later meta-row addition"
  - "Silent on no-op: log only when deleted > 0 — answers 'did the wipe run?' via event presence/absence; reduces steady-state boot-log noise"
  - "Fail-fast on transaction throw: let it bubble to bootstrap IIFE catch; serving requests with stale-mode sessions is worse than not serving at all"
  - "Adjusted kinetica.creds.routes.spec.ts to seed OIDC sessions AFTER buildTestApp() — Rule 1 inline fix; the new boot wipe (running in default password mode) was correctly deleting the test's seed before the request"

patterns-established:
  - "Boot-time data-derived contradiction check pattern (vs persisted last-mode meta-row) — generalisable to any future 'detect and self-heal at boot' need"
  - "Structured boot event with optional emission (silent-on-zero) — paired with grep convention `jq 'select(.event == \"<name>\")'`"
  - "Test seed-after-build ordering for boot-mutating createApp() — documented inline so future test authors copy the comment, not the bug"

requirements-completed:
  - MODE-05

# Metrics
duration: 12min
completed: 2026-05-01
---

# Phase 8 Plan 1: AUTH_MODE-Change Session Wipe Summary

**Boot-time wipeSessionsOnModeChange() in createApp() deletes only contradicting-credential_type rows inside a single db.transaction() and emits a structured auth_mode_change_wipe JSON log when deleted > 0, runs unconditionally in both AUTH_MODE branches.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-05-01T21:16:00Z (approx — execution start)
- **Completed:** 2026-05-01T21:28:26Z
- **Tasks:** 2
- **Files modified:** 3 (1 created, 2 edited)

## Accomplishments

- Closed MODE-05: AUTH_MODE flip wipes contradicting-type sessions atomically before app.listen() is called.
- Eliminated PITFALL M-04 ("OIDC session row survives mode flip race") via a single transactional COUNT + DELETE inside createApp().
- Added three boot-wipe regression tests (oidc-clears-password, password-clears-oidc, steady-state-no-op) — all green.
- Adjusted three OIDC seed-then-call tests in kinetica.creds.routes.spec.ts to seed AFTER buildTestApp(), aligning the test pattern with the new boot contract; locks the seed-after-build pattern in code so future authors don't reintroduce the bug.

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement wipeSessionsOnModeChange inline in createApp()** — `0d02875` (feat)
2. **Task 2: Add tests/boot.wipe.spec.ts with three cases** — `d49e3d3` (test)

**Plan metadata commit:** _pending — added in final commit step._

## Files Created/Modified

- `kinetica_bi/server/src/index.ts` — added `db` to existing `./db` named import; inserted `wipeSessionsOnModeChange` named function + immediate invocation between authMode validation (line 85) and OIDC boot block (line 88)
- `kinetica_bi/server/tests/boot.wipe.spec.ts` — new spec with three cases mirroring the bootstrap.spec.ts vi.hoisted+vi.mock("openid-client") + findEvent + stubOidcEnv pattern
- `kinetica_bi/server/tests/kinetica.creds.routes.spec.ts` — Tests 1, 3, 5, 6 reordered: `seedOidcSession()` now runs AFTER `await buildTestApp()` (was running before, which the new wipe correctly deleted in default password mode)

## Decisions Made

All decisions match Phase 8 CONTEXT.md verbatim:

- **Inline named-function form** (`wipeSessionsOnModeChange = (): void => { ... }; wipeSessionsOnModeChange();`) chosen over inline lambda — readability + matches ARCHITECTURE.md snippet exactly.
- **Wipe target = contradicting credential_type only** — `DELETE FROM sessions WHERE credential_type = ?` with the contradicting type, never `DELETE FROM sessions` (full-table).
- **`db.transaction(() => { ... })()` wrapper around COUNT + DELETE** — even though we're not persisting a meta-row, the wrapper enforces atomicity against any concurrent writer and locks the contract for any later meta-row addition (PITFALL M-01).
- **Silent on no-op** — early `return` after `if (contradictingCount === 0)`; no log when nothing was deleted.
- **Unconditional in both modes** — no `if (authMode === "oidc")` gate; `contradictingType = authMode === "oidc" ? "password" : "oidc"` handles symmetry.
- **Fail-fast on throw** — wipe IIFE intentionally does not catch; bootstrap IIFE's catch (Plan 02 will install the structured `boot_failed` shape) handles it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] kinetica.creds.routes.spec.ts seed-then-build ordering broken by new boot wipe**

- **Found during:** Task 1 (post-implementation full-suite run)
- **Issue:** Tests 1, 3, 5, 6 in `kinetica.creds.routes.spec.ts` seeded an OIDC session row via `seedOidcSession()`, then called `buildTestApp()` which now invokes `createApp()` → my new wipe → and because `AUTH_MODE` was unstubbed (default `password`), the wipe correctly identified the seeded `credential_type='oidc'` row as contradicting and deleted it before the test's request ran. Result: 401 instead of 200; missing audit lines; missing log lines.
- **Fix:** Reordered each affected test so `seedOidcSession()` runs AFTER `await buildTestApp()`. Added an inline comment in Test 1 explaining the rationale (and a back-reference comment in Tests 3, 5, 6) so future authors don't reintroduce the pattern. The test logic is unchanged; only the seed timing moved.
- **Files modified:** `kinetica_bi/server/tests/kinetica.creds.routes.spec.ts`
- **Verification:** `npx vitest run tests/kinetica.creds.routes.spec.ts` — 6/6 pass; full suite `npx vitest run` — 335/335 pass (1 skipped is pre-existing intentional skip in bootstrap.spec.ts).
- **Committed in:** `0d02875` (Task 1 commit, alongside the production code that necessitated the test alignment)

---

**Total deviations:** 1 auto-fixed (1 bug — test pattern alignment with new boot contract).
**Impact on plan:** The fix is a test-pattern correction, not scope creep. The production behavior — wipe contradicting OIDC sessions when booting in password mode — is exactly what MODE-05 requires; the tests were written before this wipe existed. No production code outside `index.ts` was touched.

## Issues Encountered

- One pre-existing dirty-tree state had to be navigated during a `git stash` step (the working tree had untracked DEPLOY-RUNBOOK.md edits and node_modules churn from prior sessions, which conflicted with `git stash pop`). Resolved by checking out the conflicting tracked files (DEPLOY-RUNBOOK.md, db state files) and re-running `git stash pop`. None of the conflicting files were Plan 08-01 territory; they remain in the working tree as pre-existing modifications for downstream plans (08-03 will own DEPLOY-RUNBOOK.md).

## User Setup Required

None — Plan 08-01 is pure server-side logic with no new env vars, no schema change, no external service dependency.

## Next Phase Readiness

- Plan 08-02 (boot hardening) can now wrap the bootstrap IIFE catch with a structured `boot_failed` log; the wipe's fail-fast contract (let exceptions bubble) is already in place.
- Plan 08-03 (DEPLOY-RUNBOOK delta) can document the `auth_mode_change_wipe` event with confidence — the shape, the silent-no-op contract, and the symmetric behavior across both modes are all verified by the new spec file.
- No blockers.

## Self-Check: PASSED

- `kinetica_bi/server/src/index.ts` exists and contains `wipeSessionsOnModeChange` (declaration + invocation), `auth_mode_change_wipe`, `DELETE FROM sessions WHERE credential_type`, `db.transaction(` — verified via grep.
- `kinetica_bi/server/tests/boot.wipe.spec.ts` exists and 3/3 tests pass — verified via `npx vitest run tests/boot.wipe.spec.ts`.
- Commit `0d02875` (feat: wipe + test alignment) and `d49e3d3` (test: boot.wipe.spec.ts) both exist in `git log` — verified via `git rev-parse --short HEAD~1` / `HEAD`.
- Full server test suite: 23 files / 335 passing / 1 skipped / 0 failing — verified via `npx vitest run`.
- TypeScript: `npx tsc --noEmit` exits 0.

---
*Phase: 08-boot-wipe-hardening-runbook*
*Completed: 2026-05-01*
