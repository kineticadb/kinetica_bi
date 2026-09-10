---
phase: 07-frontend-auth-mode-awareness
plan: 03
subsystem: auth
tags: [zustand, vitest, vite, typescript, oidc, react]

# Dependency graph
requires:
  - phase: 07-frontend-auth-mode-awareness
    provides: "Server /api/auth/me carries authMode (Plan 07-01); frontend test rig: vitest + jsdom + RTL + zustand mock (Plan 07-02)"
provides:
  - "API_BASE exported from kinetica_bi/src/api/client.ts (LoginPage Plan 04 will import for SSO link href)"
  - "AuthMode + AuthConfig + MeResponse types exported from client.ts"
  - "fetchAuthConfig() raw-fetch helper hitting GET /api/auth/config"
  - "fetchMe() return shape expanded to {user, authMode}; raw-fetch + 401-as-null contract preserved"
  - "Zustand AuthState.authMode field (AuthMode | null, default null)"
  - "bootstrap() calls fetchAuthConfig() FIRST then fetchMe(); /me wins on success; /config failure is silent"
  - "8-test auth.spec.ts locking the bootstrap contract"
affects: [07-04 LoginPage SSO branch, 07-05 App.tsx UNAUTHORIZED handler authMode gate, 08-boot-wipe-hardening-runbook]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sequential awaits in bootstrap() with paired try/catch — failure isolation per step (config failure ≠ me failure)"
    - "Latest-write-wins authMode: /config sets pre-auth; /me overrides on auth success"
    - "Module-mock pattern via vi.mock('../api/client') with typed cast: as unknown as ReturnType<typeof vi.fn>"
    - "Test depends on zustand __mocks__ for inter-test store reset (no manual beforeEach reset needed)"

key-files:
  created:
    - "kinetica_bi/src/store/auth.spec.ts (8 tests, 109 lines)"
  modified:
    - "kinetica_bi/src/api/client.ts (+19/-3: API_BASE export, AuthMode/AuthConfig/MeResponse types, fetchAuthConfig, fetchMe return widened)"
    - "kinetica_bi/src/store/auth.ts (+21/-5: AuthMode import, authMode field + initial null, bootstrap rewrite)"

key-decisions:
  - "AuthModeOrNull alias kept inside auth.ts (not exported) — only exposed shape is AuthState.authMode; AuthMode itself comes from client.ts"
  - "bootstrap() uses two independent try/catch blocks (one per await) so /config failure does not short-circuit /me; preserves prior 'reason: null on bootstrap 401' semantic"
  - "fetchMe() returns {user, authMode} (object) NOT discriminated union — matches server contract from Plan 07-01 verbatim"
  - "fetchAuthConfig() throws on !ok rather than returning null sentinel — caller (bootstrap) wraps in try/catch, keeping the helper's contract simple"
  - "login/logout/markUnauthenticated unchanged: authMode is sticky deployment metadata, not session-scoped"

patterns-established:
  - "Co-located zustand store specs at src/store/<name>.spec.ts mocking '../api/client'"
  - "TDD RED→GREEN per task: spec committed (RED), implementation committed (GREEN), no separate REFACTOR commit when code is already clean"

requirements-completed: [UX-08]

# Metrics
duration: 3min
completed: 2026-05-01
---

# Phase 07 Plan 03: Frontend authMode Plumbing Summary

**Zustand auth store now reads server-side authMode via /api/auth/config + /me, enabling LoginPage (Plan 04) and App.tsx UNAUTHORIZED handler (Plan 05) to branch on deployment auth mode.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-05-01T18:37:55Z
- **Completed:** 2026-05-01T18:40:35Z
- **Tasks:** 2 (TDD: Task 1 grep-verified, Task 2 spec-driven)
- **Files modified:** 2 modified, 1 created

## Accomplishments

- `API_BASE` is now `export const` (line 1 of client.ts) — Plan 04 LoginPage can import it to build the SSO link.
- `fetchAuthConfig()` helper added; raw-fetch contract (no apiFetch, no UNAUTHORIZED_EVENT side effects) preserved per CONTEXT.md lock.
- `fetchMe()` return widened to `MeResponse | null` carrying `authMode`; 401-as-null path untouched (still no session-expired semantics on bootstrap).
- `useAuthStore.authMode` field added (default `null`); `bootstrap()` now writes from BOTH endpoints — /config first, /me second, /me wins on success.
- 8-test spec lock: initial-null, both authMode variants from /config, latest-write-wins from /me, fetchAuthConfig silent failure (PITFALL I-03), no-throw guarantee, sequential call order, fetchMe rejection preserves prior /config write.
- Full kinetica_bi/ test suite green (13 passing — 8 new + 5 sanity from Plan 02). `tsc --noEmit` clean.

## Task Commits

Each task was committed atomically:

1. **Task 1: Update client.ts — export API_BASE, add fetchAuthConfig, expand fetchMe return** — `afb3336` (feat)
2. **Task 2 RED: Add failing spec for bootstrap authMode contract** — `f00a91c` (test)
3. **Task 2 GREEN: Add authMode to auth store; bootstrap fetches config then me** — `ff965a3` (feat)

**Plan metadata commit:** added below as final commit (docs).

_Note: Task 1 had no separate spec — its behaviors are compile-time (export presence, type signatures) verified by grep + tsc. Task 1's runtime behaviors (fetchAuthConfig 200/!ok, fetchMe shape) are exercised indirectly via Task 2's mock-driven spec, matching the plan's TDD intent._

## Files Created/Modified

- `kinetica_bi/src/api/client.ts` — exports `API_BASE`; new types `AuthMode`, `AuthConfig`, `MeResponse`; new helper `fetchAuthConfig()`; expanded `fetchMe()` return shape.
- `kinetica_bi/src/store/auth.ts` — `authMode: AuthMode | null` field; `bootstrap()` now sequential `fetchAuthConfig() → fetchMe()` with paired try/catch; login/logout/markUnauthenticated unchanged.
- `kinetica_bi/src/store/auth.spec.ts` (NEW) — 8 vitest tests across 5 describe blocks; module-mocks `../api/client`.

## Decisions Made

- **Two-block try/catch in bootstrap (not single)** — Failure isolation: /config network failure must not cancel /me. Mirrors the plan's locked semantics.
- **AuthModeOrNull alias kept in auth.ts** — Internal alias only; consumers import `AuthMode` from client.ts.
- **No REFACTOR pass after GREEN** — Implementation matches plan verbatim; no cleanup opportunity that would justify a third commit.
- **Task 1 has no dedicated spec file** — Its assertions are structural (export presence) and exercised indirectly by Task 2's mocks; matches plan's grep-based verification.

## Deviations from Plan

None — plan executed exactly as written.

The plan's anticipated contract-handoff signal (single tsc error pointing to store/auth.ts:26 after Task 1) appeared on schedule and was resolved by Task 2 as designed. No Rule 1/2/3/4 deviations triggered.

## Issues Encountered

None.

## Next Phase Readiness

- **Plan 07-04 ready:** Can `import { API_BASE } from "../api/client"` for the SSO link, and read `authMode` from `useAuthStore` for the early-return password-vs-OIDC branch.
- **Plan 07-05 ready:** App.tsx UNAUTHORIZED handler can gate `sessionStorage.setItem("kbi_returnTo", ...)` behind `if (useAuthStore.getState().authMode === "oidc")`.
- **No blockers** for the rest of Phase 07.

## Self-Check: PASSED

- FOUND: kinetica_bi/src/api/client.ts
- FOUND: kinetica_bi/src/store/auth.ts
- FOUND: kinetica_bi/src/store/auth.spec.ts
- FOUND: .planning/phases/07-frontend-auth-mode-awareness/07-03-SUMMARY.md
- FOUND commit afb3336 (Task 1)
- FOUND commit f00a91c (Task 2 RED)
- FOUND commit ff965a3 (Task 2 GREEN)

---
*Phase: 07-frontend-auth-mode-awareness*
*Completed: 2026-05-01*
