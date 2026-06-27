---
phase: 90-combination-orchestrator
plan: "02"
subsystem: auth
tags: [env-var, kinetica-bi, combination-views, server, zustand]

# Dependency graph
requires:
  - phase: 89-store-server-foundation
    provides: filterCombinationStore with MAX_COMBINATION_VIEWS_PER_TABLE constant (10)
provides:
  - MAX_COMBINATION_VIEWS_PER_TABLE env var read once at boot via readPositiveIntEnv (fallback 10, warn on invalid)
  - maxCombinationViewsPerTable exposed on GET /api/auth/me in BOTH auth modes
  - MeResponse.maxCombinationViewsPerTable: number (coalesced to 10 for older server builds)
  - AuthState.maxCombinationViewsPerTable: number (initial 10, set from /api/me on bootstrap)
affects: [90-03, combination-orchestrator, filterCombinationStore ceiling enforcement]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "readPositiveIntEnv pattern: reuse existing helper at boot, close over const in route handler (ARCHITECTURE AP-5)"
    - "MeResponse coalescing: typeof json.field === 'number' ? json.field : default (defensive for older builds)"

key-files:
  created: []
  modified:
    - packages/server/src/index.ts
    - packages/server/tests/auth.routes.spec.ts
    - packages/web/src/api/client.ts
    - packages/web/src/store/auth.ts
    - packages/web/src/store/auth.spec.ts

key-decisions:
  - "MAX_COMBINATION_VIEWS_PER_TABLE env var name (matches filterCombinationStore constant name for 1:1 correspondence)"
  - "Auth store field: maxCombinationViewsPerTable (Plan 03 reads this from useAuthStore — no store-to-store import needed)"
  - "Coalesce default 10 in fetchMe (backward-compat: older server omitting the field never yields undefined)"

patterns-established:
  - "Env ceiling plumbing: readPositiveIntEnv at boot → /api/me payload → MeResponse type → fetchMe coalesce → auth store; mirrors TTL_KEEPALIVE_LEAD_MINUTES pattern exactly"

requirements-completed: [COMBO-V118-03]

# Metrics
duration: 7min
completed: 2026-06-27
---

# Phase 90 Plan 02: Combination-Orchestrator Env Ceiling Plumbing Summary

**`MAX_COMBINATION_VIEWS_PER_TABLE` env var read once at boot (default 10, fallback+warn) via shared `readPositiveIntEnv` helper, exposed on `/api/auth/me`, threaded through `MeResponse`/`fetchMe`/auth store for Plan 03 orchestrator to consume**

## Performance

- **Duration:** 7 min
- **Started:** 2026-06-27T23:23:45Z
- **Completed:** 2026-06-27T23:30:45Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Server reads `MAX_COMBINATION_VIEWS_PER_TABLE` once at boot via the existing `readPositiveIntEnv` helper (default 10, warn on invalid), following ARCHITECTURE AP-5 — never re-reads `process.env` per-route
- `GET /api/auth/me` exposes `maxCombinationViewsPerTable` in both password and OIDC auth modes, closing over the boot const
- Web `MeResponse` type extended + `fetchMe` coalesces to 10 for backward compatibility with older server builds
- `AuthState` gains `maxCombinationViewsPerTable` (initial 10, set from `/api/me` on bootstrap); Plan 03 reads it from `useAuthStore`

## Task Commits

Each task was committed atomically:

1. **Task 1: Server — read env at boot + expose on /api/auth/me + both-auth-mode supertest** - `74da87c` (feat)
2. **Task 2: Web — thread through MeResponse, fetchMe, and auth store** - `4db1d30` (feat)

## Files Created/Modified
- `packages/server/src/index.ts` - Boot-time `MAX_COMBINATION_VIEWS_PER_TABLE` const via `readPositiveIntEnv`; added to `/api/auth/me` res.json payload
- `packages/server/tests/auth.routes.spec.ts` - Updated both `toEqual` assertions to include `maxCombinationViewsPerTable: 10`; added password-mode + oidc-mode stubEnv tests
- `packages/web/src/api/client.ts` - `MeResponse` type extended; `fetchMe` coalescing read (default 10)
- `packages/web/src/store/auth.ts` - `AuthState.maxCombinationViewsPerTable: number`; initial 10; set on bootstrap
- `packages/web/src/store/auth.spec.ts` - Added initial-default test + bootstrap-sets-value test

## Decisions Made
- Auth store field name `maxCombinationViewsPerTable` (Plan 03 reads `useAuthStore(s => s.maxCombinationViewsPerTable)` — no import of filterCombinationStore constant needed in auth.ts)
- Coalesce to `10` (not `0` or `undefined`) in `fetchMe` — an older server build must fall back to the same default as the web-side constant

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Pre-existing `auth.routes.spec.ts` test failures in TD-V16-TEST-ISOLATION: 3 tests were already failing on baseline (`roles/permissions` user mismatch in `toEqual`, plus 2 OIDC `Issuer is not a constructor` isolation failures). My new OIDC-mode MAX_COMBINATION test also hits the same `Issuer is not a constructor` isolation issue — `auth.routes.spec.ts` remains in TD-V16-TEST-ISOLATION, set-gate unchanged. Password-mode tests for both TTL and MAX_COMBINATION pass green.

## User Setup Required
`MAX_COMBINATION_VIEWS_PER_TABLE` — positive integer env var (default 10 when unset). Deploy-time tuning knob for the per-table combination-view ceiling. No configuration required for today's behavior (default matches the existing web-side constant).

## Next Phase Readiness
- Plan 03 (`useCombinationOrchestrator`) can read `useAuthStore(s => s.maxCombinationViewsPerTable)` to get the ceiling value as a deploy-time env var rather than the hardcoded constant — COMBO-V118-03 fully satisfied
- `filterCombinationStore.MAX_COMBINATION_VIEWS_PER_TABLE` (= 10) remains the web-side fallback for before bootstrap completes

---
*Phase: 90-combination-orchestrator*
*Completed: 2026-06-27*
