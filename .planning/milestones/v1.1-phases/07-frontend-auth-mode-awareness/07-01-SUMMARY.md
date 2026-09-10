---
phase: 07-frontend-auth-mode-awareness
plan: 01
subsystem: auth
tags: [express, vitest, openid-client, oidc, supertest, jwt]

# Dependency graph
requires:
  - phase: 05-oidc-module-routes
    provides: closure-const authMode at createApp() top + /api/auth/config bare {authMode} shape
  - phase: 04-schema-sessionstore-foundation
    provides: createSession options-object form (credentialType, idToken)
  - phase: 06-requireauth-helper-credential-branch
    provides: seedOidcSession test helper pattern for OIDC-mode session forging
provides:
  - "/api/auth/me success-path now returns top-level authMode field ('password' | 'oidc')"
  - "Server-side test contract for /me.authMode in both modes (password authenticated, OIDC authenticated, password 401, OIDC 401)"
  - "auth.routes.spec.ts now mocks openid-client at the top — unblocks any future OIDC-mode route tests in this file"
affects: [frontend-bootstrap, fetchMe-return-type, AuthState.authMode, LoginPage-render-branching]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Closure-const single source of truth for authMode (ARCHITECTURE.md AP-5) — both /api/auth/config and /api/auth/me close over the same boot-captured const"
    - "vi.hoisted + vi.mock('openid-client') pattern propagated from auth.oidc.spec.ts to auth.routes.spec.ts so any spec needing OIDC-mode createApp() can run without an IdP"

key-files:
  created: []
  modified:
    - "kinetica_bi/server/src/index.ts (one-line + 2-line comment to /me handler)"
    - "kinetica_bi/server/tests/auth.routes.spec.ts (top-of-file openid-client mock + stubOidcEnv + resetOidcClientForTests in beforeEach + afterEach unstub + 4 new tests)"

key-decisions:
  - "Reused auth.oidc.spec.ts's vi.hoisted/vi.mock pattern verbatim in auth.routes.spec.ts — no extraction to shared helper file (cohesion within spec; mock fixtures stay close to where mocks are exercised)"
  - "Kept the in-file makeJwt + seedOidcSession helpers (they predate Phase 7) rather than extracting — Task 2 reuses them for the new OIDC authenticated test"
  - "Comment line `// NEVER re-read process.env here` is the ONLY mention of process.env inside the /me handler scope — it's documentation, not a read; awk-based AC for `process.env.AUTH_MODE` returns 0 as required"

patterns-established:
  - "Pattern: every spec file that exercises createApp() in OIDC mode must vi.mock('openid-client') at the TOP (above all other imports) AND call resetOidcClientForTests() in beforeEach to flush the module-singleton _client between specs"
  - "Pattern: for paired password+oidc mode tests in the same file, afterEach(() => vi.unstubAllEnvs()) is mandatory — without it, password-mode tests run AFTER oidc-mode tests will see AUTH_MODE='oidc' bleeding from the prior stubEnv"

requirements-completed: [UX-08]

# Metrics
duration: 4min
completed: 2026-05-01
---

# Phase 7 Plan 1: /api/auth/me authMode Field Summary

**`GET /api/auth/me` now returns `{ user, authMode: "password" | "oidc" }` from the createApp() closure-const, with 4 new tests locking the contract in both modes.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-05-01T18:28:54Z
- **Completed:** 2026-05-01T18:33:04Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- `/api/auth/me` success-path JSON now includes a top-level `authMode` field sourced from the boot-captured closure-const (ARCHITECTURE.md AP-5 single source of truth — same const that backs `/api/auth/config`, `POST /login` gate, `GET /oidc/start` gate, and `GET /oidc/callback` gate).
- 401 unauthenticated path on `/api/auth/me` is verbatim unchanged: `{ error: "Not authenticated.", code: "REAUTH_REQUIRED" }` with no `authMode` field — backward-compatible for v1.0 callers and locked by the two new "no session" tests in both modes.
- `tests/auth.routes.spec.ts` now mocks `openid-client` at file scope, mirroring `auth.oidc.spec.ts`'s vi.hoisted+vi.mock pattern. This unblocks any future OIDC-mode route tests we want to add to this spec without IdP discovery network calls.
- 4 new tests (`describe("GET /api/auth/me — authMode field (UX-08)")`) cover password authenticated, OIDC authenticated, password 401, and OIDC 401. All 15 tests in the file pass (11 existing + 4 new).

## Task Commits

1. **Task 1: Add authMode field to /api/auth/me handler** — `dcbf596` (feat) [pre-existing commit; see Issues Encountered]
2. **Task 2: Add server-side tests for /me.authMode in both modes** — `6059e00` (test)

_Note: Both Task 1 and Task 2 are TDD-flagged. Task 1's `<verify>` block uses tsc + grep (structural verification — no test required at the per-task level); Task 2's 4 tests act as the comprehensive RED-GREEN coverage for the handler change. The plan deliberately decoupled the one-line handler change (Task 1) from the multi-test contract lock (Task 2) — the tests would fail without Task 1's change, which is the implicit RED guarantee._

## Files Created/Modified

- `kinetica_bi/server/src/index.ts` — `/api/auth/me` success path adds `authMode` (closure-captured) to JSON response; 2-line comment documents the AP-5 closure-const source.
- `kinetica_bi/server/tests/auth.routes.spec.ts` — Added vi.hoisted + vi.mock("openid-client") block at top, `stubOidcEnv` helper, `resetOidcClientForTests()` in beforeEach, `afterEach(() => vi.unstubAllEnvs())`, and the new `describe` block with 4 tests.

## Decisions Made

- **Closure-const re-use, not closure refactor.** Phase 5 already declared `const authMode` at `createApp()` top. Task 1 was a pure one-line addition that closes over the existing variable — no new declaration, no module-level extract. ARCHITECTURE.md AP-5 confirmed: same const backs all auth-mode-aware routes.
- **Mock pattern duplicated, not extracted.** The vi.hoisted/vi.mock("openid-client") block from auth.oidc.spec.ts was copied verbatim to auth.routes.spec.ts rather than extracted to `tests/helpers/oidc-mock.ts`. Two reasons: (1) hoisted mocks must precede imports in the same file (extraction risks ordering bugs); (2) only two spec files need it today — extracting would add coordination cost without payoff. If a third spec needs it, revisit.
- **`resetOidcClientForTests()` added to `beforeEach`, not just OIDC-mode tests.** It's a no-op when `_client` is null (which it is in password-mode setup), so adding it unconditionally in beforeEach is safer than gating per-describe — prevents cross-test bleed when test ordering changes.

## Deviations from Plan

None - plan executed exactly as written.

The plan's TDD framing for Task 1 (expecting a separate RED-GREEN-REFACTOR sequence) was reconciled with its `<verify>` block (tsc + grep, no test execution): Task 1 is a one-line code change verified structurally, while Task 2 is the comprehensive test coverage that acts as the GREEN gate for Task 1's change. The 4 tests in Task 2 would have failed without Task 1's edit — that's the implicit RED guarantee. No scope creep, no auto-fixes needed, no architectural decisions surfaced.

---

**Total deviations:** 0
**Impact on plan:** Plan executed cleanly. All acceptance criteria for both tasks pass on first verification.

## Issues Encountered

**1. Task 1 commit attribution: change pre-bundled in `dcbf596`.**
- **What happened:** When I attempted `git commit` for Task 1, git reported "no changes added to commit" because the `kinetica_bi/server/src/index.ts` modification I had just made was identical to a change already staged + committed in the prior commit `dcbf596` ("chore(07-02): install vitest test infra deps") — that commit was made by a prior planner agent and bundled the index.ts edit alongside vitest dependency installs.
- **Resolution:** Verified the change was already in `dcbf596` (via `git show dcbf596 -- kinetica_bi/server/src/index.ts` — exact same patch as my edit). Did NOT amend or rewrite history (Git Safety Protocol). Recorded `dcbf596` as Task 1's commit even though the message scope is wrong (it claims to be vitest infra). The correctness of the code change is verified independently by tsc + grep + the Task 2 tests.
- **Risk assessment:** Low. The commit message is cosmetically misleading but the code is correct and on-disk. Future readers will find the Phase 7 test (Task 2 commit `6059e00`) which depends on Task 1's change and locks the contract. ROADMAP/STATE will reflect the plan as completed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 07-01 unblocks:
- **Plan 07-02** (frontend `fetchAuthConfig` + `AuthConfig` type + `API_BASE` export): can now consume `/me`'s `authMode` as the authoritative post-auth source per ARCHITECTURE.md's "latest write wins" sequence (`fetchAuthConfig` sets → `fetchMe` overwrites).
- **Plan 07-03** (frontend `bootstrap()` update): can write `authStore.authMode` from both `/api/auth/config` and `/api/auth/me` responses with the contract locked on the server side.
- **Plan 07-04** (`LoginPage` OIDC branch): can rely on `authStore.authMode` reflecting the deployment's actual mode after first authenticated bootstrap.

Server-side contract for Phase 7 SC2 ("frontend has authoritative source of authMode in /me response") is satisfied. No blockers.

## Self-Check: PASSED

- [x] FOUND: kinetica_bi/server/src/index.ts (Task 1 change present, line 221: `return res.json({ user: { username: loaded.session.username }, authMode });`)
- [x] FOUND: kinetica_bi/server/tests/auth.routes.spec.ts (Task 2 changes present — vi.mock("openid-client"), stubOidcEnv helper, 4 new it() blocks, vi.unstubAllEnvs in afterEach)
- [x] FOUND: commit `6059e00` in `git log --oneline` (Task 2)
- [x] FOUND: commit `dcbf596` in `git log --oneline` (Task 1 change content; cosmetic attribution issue documented)
- [x] tsc --noEmit exits 0
- [x] vitest run tests/auth.routes.spec.ts: 15 tests pass (1 file)

---
*Phase: 07-frontend-auth-mode-awareness*
*Completed: 2026-05-01*
