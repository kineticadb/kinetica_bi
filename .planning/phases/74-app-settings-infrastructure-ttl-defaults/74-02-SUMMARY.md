---
phase: 74-app-settings-infrastructure-ttl-defaults
plan: 02
subsystem: web/auth
tags: [ttl, keepalive, auth-store, bootstrap, client-plumbing]

# Dependency graph
requires:
  - "74-01: GET /api/me returns ttlKeepaliveLeadMinutes (server side)"
provides:
  - "MeResponse.ttlKeepaliveLeadMinutes type (required numeric field)"
  - "fetchMe parses ttlKeepaliveLeadMinutes with defensive default 1 for older servers"
  - "useAuthStore.ttlKeepaliveLeadMinutes: number (initial=1, set on bootstrap)"
affects:
  - "78-view-ttl-keepalive-touch (reads ttlKeepaliveLeadMinutes from auth store)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "authMode precedent mirrored: MeResponse type + fetchMe parse + AuthState field + bootstrap set"
    - "Defensive coalesce pattern: typeof json.field === 'number' ? json.field : default (mirrors roles ?? [])"

key-files:
  created: []
  modified:
    - "packages/web/src/api/client.ts"
    - "packages/web/src/store/auth.ts"
    - "packages/web/src/store/auth.spec.ts"

key-decisions:
  - "ttlKeepaliveLeadMinutes NOT reset in markUnauthenticated/logout — it is deploy-config not session-scoped; default 1 covers never-bootstrapped case"
  - "Defensive coalesce to 1 in fetchMe: older server builds omitting the field yield 1 (not undefined), consistent with roles/permissions coalescing already in fetchMe"
  - "seedAuthStore.ts unchanged: all seed helpers use partial setState (not full literals), so the new field falls through to store defaults correctly"

patterns-established:
  - "MeResponse type + fetchMe + AuthState + bootstrap set — the authMode precedent applied verbatim for any new /api/me field"

requirements-completed: [SETTINGS-V115-03]

# Metrics
duration: ~3min
completed: 2026-06-19
---

# Phase 74 Plan 02: Web Auth Store — ttlKeepaliveLeadMinutes Plumbing Summary

**MeResponse typed + fetchMe parses ttlKeepaliveLeadMinutes with defensive default 1; auth store exposes it on bootstrap for Phase 78's keep-alive hook**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-06-19T04:50:22Z
- **Completed:** 2026-06-19T04:52:50Z
- **Tasks:** 2 (TDD: 2 commits — RED test + GREEN implementation)
- **Files modified:** 3

## Accomplishments

- Extended `MeResponse` type with required `ttlKeepaliveLeadMinutes: number` field following the `authMode` precedent
- Updated `fetchMe` to parse `ttlKeepaliveLeadMinutes` from `/api/me` JSON, coalescing to `1` when absent (older server build defensive fallback — mirrors `roles ?? []` / `permissions ?? []` already in the function)
- Added `ttlKeepaliveLeadMinutes: number` to `AuthState` type with initial value `1`; wired into bootstrap's `set()` call on authenticated path
- Added 2 new assertions in `auth.spec.ts`: initial state defaults to 1 (pre-bootstrap) and bootstrap sets the configured value (3 → store carries 3)
- Web `tsc` clean; frontend vitest 100% (2453/2453 — up from 2437 pre-plan)

## Task Commits

1. **RED: failing tests for ttlKeepaliveLeadMinutes** — `4364a36` (test)
2. **GREEN: implement plumbing in client.ts + auth.ts** — `fd1ac18` (feat)

## Files Created/Modified

- `packages/web/src/api/client.ts` — Extended MeResponse type + fetchMe parser (ttlKeepaliveLeadMinutes field + defensive coalesce)
- `packages/web/src/store/auth.ts` — Added ttlKeepaliveLeadMinutes to AuthState type, initial state (=1), bootstrap set call
- `packages/web/src/store/auth.spec.ts` — Added 2 tests: initial state default=1, bootstrap sets configured value

## Decisions Made

- **Not reset on logout/markUnauthenticated**: `ttlKeepaliveLeadMinutes` is deploy-config (set by the server operator), not session-scoped (unlike `user`, `status`). Leaving it at the last-known value is harmless; the default `1` covers the never-bootstrapped case. This matches the `authMode` field which is also not reset on logout.
- **seedAuthStore.ts unchanged**: All helper functions use `useAuthStore.setState(partial)` — Zustand merges partials, so the new field falls through to the store's initial value (`1`). No literal state objects were updated.
- **Defensive coalesce in fetchMe**: `typeof json.ttlKeepaliveLeadMinutes === "number" ? json.ttlKeepaliveLeadMinutes : 1` ensures an older server build that omits the field yields `1` (not `undefined`). Consistent with the `roles ?? []` pattern already in `fetchMe`.

## Deviations from Plan

None — plan executed exactly as written. The TDD sequence folded Task 2's test additions into the RED phase commit of Task 1 (per normal TDD flow); the spec file was committed independently before the implementation landed.

## Self-Check

- `packages/web/src/api/client.ts` exists and contains `ttlKeepaliveLeadMinutes: number` — VERIFIED
- `packages/web/src/store/auth.ts` exists and contains `ttlKeepaliveLeadMinutes` — VERIFIED
- `packages/web/src/store/auth.spec.ts` exists and contains `ttlKeepaliveLeadMinutes` — VERIFIED
- `npx tsc --noEmit` — CLEAN (no output)
- `npx vitest run` from `packages/web` — 2453/2453 PASSED (105 test files)
- Commits: `4364a36` (test RED) + `fd1ac18` (feat GREEN) — both present in log

## Self-Check: PASSED

## Next Phase Readiness

- Phase 78 (View TTL Keep-Alive Touch) can now call `useAuthStore.getState().ttlKeepaliveLeadMinutes` to read the lead-time before scheduling keep-alive touches
- No blockers for Phase 75 (Column Display Config Foundation) — completely independent

---
*Phase: 74-app-settings-infrastructure-ttl-defaults*
*Completed: 2026-06-19*
