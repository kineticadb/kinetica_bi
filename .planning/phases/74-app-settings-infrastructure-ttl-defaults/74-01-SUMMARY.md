---
phase: 74-app-settings-infrastructure-ttl-defaults
plan: 01
subsystem: api
tags: [env-var, ttl, materialize, boot-config, server]

# Dependency graph
requires: []
provides:
  - "DEFAULT_VIEW_TTL_MINUTES boot const (default 5) read once in createApp() with fallback+warn on invalid"
  - "TTL_KEEPALIVE_LEAD_MINUTES boot const (default 1) read once in createApp() with fallback+warn on invalid"
  - "All three materialize sites (filter-on-dv, filter-materialize, dynamic-view/materialize) use configured TTL for both DDL arg and expiresAt/expires_at arithmetic"
  - "GET /api/me returns ttlKeepaliveLeadMinutes top-level field (Phase 78 consumer)"
  - "readPositiveIntEnv() helper: falls back to default + console.warn for missing/non-numeric/zero/negative; never throws"
  - "Server tests proving env-driven TTL override (TTL=10) and default-5 behavior for all three sites"
affects:
  - "78-view-ttl-keepalive-touch (consumes ttlKeepaliveLeadMinutes from /api/me)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "readPositiveIntEnv helper pattern: fallback-not-fail-fast for non-critical tuning knobs (contrast AUTH_MODE throw)"
    - "AP-5 boot-once env capture: env vars read once at createApp() top, never per-route"

key-files:
  created: []
  modified:
    - "packages/server/src/index.ts"
    - "packages/server/tests/auth.routes.spec.ts"
    - "packages/server/tests/routes.filter-materialize.spec.ts"
    - "packages/server/tests/routes.filter-materialize-dv.spec.ts"
    - "packages/server/tests/routes.dynamic-view.spec.ts"

key-decisions:
  - "Fallback-not-fail-fast: invalid DEFAULT_VIEW_TTL_MINUTES / TTL_KEEPALIVE_LEAD_MINUTES logs a boot warning and falls back to default; the app always starts (contrast AUTH_MODE which throws)"
  - "readPositiveIntEnv rejects non-integer, zero, negative, and non-numeric values — only positive integers accepted"
  - "ttlKeepaliveLeadMinutes exposed on GET /api/me (not GET /api/auth/config) — config is auth-mode-only; me is the authenticated-user extension point"
  - "routes.materialize.spec.ts was NOT modified — it tests /api/views/:id/materialize which uses raw DDL (no TTL arg); env-override test for site 3 was added to routes.dynamic-view.spec.ts instead (the correct file for POST /api/dynamic-view/materialize)"
  - "Zero app_settings table, CRUD endpoint, new permission, or settings UI introduced — phase pivoted to env-var config"

patterns-established:
  - "readPositiveIntEnv(name, default) pattern for non-critical tuning knobs: boot-once, fallback+warn, never throw"

requirements-completed: [SETTINGS-V115-01, SETTINGS-V115-02, SETTINGS-V115-03]

# Metrics
duration: 6min
completed: 2026-06-19
---

# Phase 74 Plan 01: App-Settings Infrastructure — TTL Defaults Summary

**Two env-driven boot consts (DEFAULT_VIEW_TTL_MINUTES=5, TTL_KEEPALIVE_LEAD_MINUTES=1) wired into all three materialize sites and exposed on GET /api/me, with fallback+warn for invalid values (never fail-fast)**

## Performance

- **Duration:** 6 min
- **Started:** 2026-06-19T04:40:59Z
- **Completed:** 2026-06-19T04:47:03Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added `readPositiveIntEnv()` helper and two boot consts in `createApp()` following the AUTH_MODE precedent (AP-5: read once, before any route is mounted); invalid/missing/zero/negative values fall back to default + `console.warn`, app always starts
- Replaced all three hardcoded `ttl: 5` / `Date.now() + 5 * 60 * 1000` literals in `index.ts` with `DEFAULT_VIEW_TTL_MINUTES`; zero hardcoded `ttl: 5` literals remain
- Exposed `ttlKeepaliveLeadMinutes: TTL_KEEPALIVE_LEAD_MINUTES` on `GET /api/me` top-level (Phase 78 keep-alive will consume this)
- Updated and extended server tests: auth.routes.spec.ts toEqual assertions updated for new field; TTL=10 override tests added for all three materialize sites; new keepalive-lead test added

## Task Commits

1. **Task 1: Capture DEFAULT_VIEW_TTL_MINUTES + TTL_KEEPALIVE_LEAD_MINUTES as boot consts** - `7a1c176` (feat)
2. **Task 2: Update server tests for env-driven TTL + /api/me field** - `49817ad` (test)

## Files Created/Modified

- `packages/server/src/index.ts` - Added readPositiveIntEnv helper, two boot consts, wired all three materialize sites, added ttlKeepaliveLeadMinutes to /api/me
- `packages/server/tests/auth.routes.spec.ts` - Updated toEqual assertions for /api/me + added TTL_KEEPALIVE_LEAD_MINUTES=3 test
- `packages/server/tests/routes.filter-materialize.spec.ts` - Added DEFAULT_VIEW_TTL_MINUTES=10 override test (site 2)
- `packages/server/tests/routes.filter-materialize-dv.spec.ts` - Added DEFAULT_VIEW_TTL_MINUTES=10 override test (site 1 / filter-on-dv)
- `packages/server/tests/routes.dynamic-view.spec.ts` - Added DEFAULT_VIEW_TTL_MINUTES=10 override test (site 3 / dynamic-view/materialize)

## Decisions Made

- **Fallback-not-fail-fast pattern**: TTL is a non-critical tuning knob — a deploy typo must not take the app down. `readPositiveIntEnv` logs a boot warning and falls back to the default. This contrasts with `AUTH_MODE` which throws (auth mode is critical, TTL is not).
- **routes.materialize.spec.ts not modified**: The plan listed it for site 3, but `routes.materialize.spec.ts` tests `/api/views/:id/materialize` (static view materialize using raw DDL, no TTL arg). The actual site 3 (`POST /api/dynamic-view/materialize`) is tested in `routes.dynamic-view.spec.ts` — that file received the TTL override test instead.
- **Scope guard maintained**: Zero `app_settings` table, CRUD endpoint, new permission, or settings UI introduced. Phase pivoted to env-var config.

## Deviations from Plan

### Minor deviation: Wrong file for site 3 test

- **Found during:** Task 2 (reading the test files)
- **Issue:** Plan specifies adding the env-override test to `routes.materialize.spec.ts` and calls it "site 3, dynamic-view materialize". But `routes.materialize.spec.ts` covers `/api/views/:id/materialize` (static view DDL, no TTL arg) — not the dynamic-view materialize. The actual tests for site 3 are in `routes.dynamic-view.spec.ts`.
- **Fix:** Added the TTL=10 override test to `routes.dynamic-view.spec.ts` (the correct file). Did not modify `routes.materialize.spec.ts` (adding a TTL test there would test non-existent behavior).
- **Classification:** Rule 1 (bug in plan — testing wrong endpoint would give false confidence)

---

**Total deviations:** 1 auto-corrected (plan named wrong file for site 3 test)
**Impact on plan:** Improved — test coverage is now accurate to the actual implementation.

## Issues Encountered

- Pre-existing test failures in `auth.routes.spec.ts`: 3 tests in the "GET /api/auth/me" describe were already failing before this plan (confirmed by baseline check):
  1. `returns authMode='password'` — user object includes `roles`/`permissions` from Phase 48, but toEqual expects `{ username: "alice" }` only (pre-existing TD-V16-TEST-ISOLATION)
  2. `returns authMode='oidc'` — OIDC constructor TypeError (pre-existing TD-V11-04)
  3. `returns 401...oidc mode` — OIDC constructor TypeError (pre-existing TD-V11-04)
  My new `TTL_KEEPALIVE_LEAD_MINUTES=3` test passes. These failures are in the known TD-V16-TEST-ISOLATION set.

## Self-Check

All four targeted spec files (excluding the pre-existing failures in `auth.routes.spec.ts`) pass. New tests verified green:
- `TTL_KEEPALIVE_LEAD_MINUTES=3` on /api/me — PASS
- `DEFAULT_VIEW_TTL_MINUTES=10` on filter-materialize (site 2) — PASS
- `DEFAULT_VIEW_TTL_MINUTES=10` on filter-materialize-dv (site 1) — PASS
- `DEFAULT_VIEW_TTL_MINUTES=10` on dynamic-view/materialize (site 3) — PASS
- `npx tsc --noEmit` — CLEAN (no errors)
- Zero `ttl: 5` literals in index.ts — VERIFIED
- `ttl: DEFAULT_VIEW_TTL_MINUTES` appears exactly 3 times — VERIFIED
- `ttlKeepaliveLeadMinutes: TTL_KEEPALIVE_LEAD_MINUTES` on /api/me — VERIFIED

## Next Phase Readiness

- Phase 78 (View TTL Keep-Alive Touch) can now read `ttlKeepaliveLeadMinutes` from `GET /api/me` to determine lead-time before materializing
- All three materialize sites produce `expiresAt`/`expires_at` based on the configured TTL (enabling Phase 78 to schedule its keep-alive relative to the actual expiry)
- No blockers for Phase 75 (Column Display Config Foundation) — completely independent

---
*Phase: 74-app-settings-infrastructure-ttl-defaults*
*Completed: 2026-06-19*
