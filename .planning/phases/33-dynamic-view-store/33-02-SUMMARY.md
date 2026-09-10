---
phase: 33-dynamic-view-store
plan: 02
subsystem: api
tags: [express, kinetica, supertest, vitest, oidc, dynamic-views, lifecycle]

# Dependency graph
requires:
  - phase: 32-dynamic-view-foundation
    provides: "buildDynamicViewName, getDashboardDynamicView, kineticaSqlHelper, asyncHandler, requireConfig, dual-auth-mode supertest harness"
provides:
  - "POST /api/dynamic-view/:id/drop server endpoint — DROP-only lifecycle-cleanup primitive (SQLite row UNTOUCHED)"
  - "Extended KineticaOp union with DYNAMIC_DROP for finer-grained audit-log filtering"
  - "routes.dynamic-view-drop.spec.ts — 7 supertest cases covering both AUTH_MODE=password (5) + AUTH_MODE=oidc smoke (2)"
affects: [33-03-client-helpers-and-lifecycle, 34-management-modal, 35-renderer-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DROP-only lifecycle-cleanup primitive (POST verb, no row mutation) — mirrors filter-view DELETE /api/filter/materialize semantics for dynamic views which have a config-row equivalent"
    - "Audit-op granularity split: DYNAMIC_DROP for lifecycle vs DYNAMIC_MATERIALIZE for materialize-housekeeping (CREATE OR REPLACE + COUNT + DROP+row removal)"
    - "404-then-no-Kinetica-roundtrip pattern: validation gates fire BEFORE any Kinetica fetch (statements.length === 0 assertion)"

key-files:
  created:
    - "kinetica_bi/server/tests/routes.dynamic-view-drop.spec.ts"
  modified:
    - "kinetica_bi/server/src/index.ts"
    - "kinetica_bi/server/src/kinetica.ts"

key-decisions:
  - "Picked DYNAMIC_DROP audit-op tag (recommended by 33-CONTEXT.md line 119) over reusing DYNAMIC_MATERIALIZE — finer audit-log filtering distinguishes lifecycle cleanup from materialize-housekeeping. Required extending the KineticaOp union."
  - "Idempotency assertion validates BOTH calls return 200 + dropped: true (not just status) — locks the response-body contract for Plan 33-03's reset() loop"
  - "401 test uses plain agent.post() without makeSessionCookie — confirms requireAuth middleware fires BEFORE requireConfig (matches existing DELETE pattern in routes.dynamic-view.spec.ts:677-683)"
  - "OIDC smoke test asserts Bearer <token> on the Kinetica fetch headers — proves the credential-type branch in buildAuthHeader() works for this new route"

patterns-established:
  - "DROP-only primitive registration position: between materialize handler and DELETE handler in the same /api/dynamic-view region"
  - "Spec mirrors existing routes.dynamic-view.spec.ts preamble verbatim (hoisted openid-client mock, Kinetica response builders, fixture seeds, sqlStatements extractor) for harness consistency"

requirements-completed: [DV-V16-07]

# Metrics
duration: 4min
completed: 2026-05-14
---

# Phase 33 Plan 02: Server DROP Endpoint Summary

**POST /api/dynamic-view/:id/drop — DROP-only lifecycle-cleanup primitive that fires `DROP TABLE IF EXISTS <dynamicViewName>` and leaves the SQLite config row UNTOUCHED, consumed exclusively by Plan 33-03's reset() loop.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-14T17:18:00Z
- **Completed:** 2026-05-14T17:22:03Z
- **Tasks:** 2
- **Files modified:** 3 (2 source + 1 new spec)

## Accomplishments
- New Express route `POST /api/dynamic-view/:id/drop` registered between materialize and DELETE handlers in `kinetica_bi/server/src/index.ts:1230-1259`
- `KineticaOp` union extended in `kinetica_bi/server/src/kinetica.ts:33-44` with `"DYNAMIC_DROP"` member for audit-log granularity
- Full supertest coverage (`routes.dynamic-view-drop.spec.ts`) — 7 cases mirroring the dual-auth-mode harness from `routes.dynamic-view.spec.ts`
- Row-untouched contract proven by spec — calling drop leaves `getDashboardDynamicView(id)` defined, distinguishing this primitive from destructive DELETE
- Idempotency proven by spec — two consecutive drops both return 200 + emit two DROP statements

## Task Commits

Each task was committed atomically:

1. **Task 1: Register POST /api/dynamic-view/:id/drop in index.ts + extend KineticaOp** — `48f1bad` (feat)
2. **Task 2: Supertest spec routes.dynamic-view-drop.spec.ts (7 tests, dual auth mode)** — `7645cd1` (test)

## Files Created/Modified

- `kinetica_bi/server/src/kinetica.ts` — Extended `KineticaOp` union with `"DYNAMIC_DROP"` (line 44)
- `kinetica_bi/server/src/index.ts` — Registered new route at lines 1230-1259 (between materialize at 1115 and DELETE at 1261)
- `kinetica_bi/server/tests/routes.dynamic-view-drop.spec.ts` — New file, 347 lines, 7 supertest cases covering happy path, 404, 400, 401, idempotency, OIDC happy path, OIDC 404

## Endpoint Contract (locked)

**Request:** `POST /api/dynamic-view/:id/drop` (empty body)

**Responses:**
- `200 { dropped: true }` — happy path (regardless of whether view physically exists on Kinetica; DROP IF EXISTS silent on missing)
- `400 { error: "id path param must be numeric." }` — non-numeric :id
- `404 { error: "Dynamic view not found." }` — :id valid but no SQLite row
- `401` — no session cookie (requireAuth middleware fires before any handler logic)
- 4xx/5xx from Kinetica upstream propagates through global `errorMiddleware`

**Side-effects:** Fires exactly one `DROP TABLE IF EXISTS _kbi_dv_u<sanitizedUserId>_d<dashboardId>_<dynamicViewId>` via `kineticaSqlHelper` with `op: "DYNAMIC_DROP"`. SQLite row is NEVER touched.

## KineticaOp Extension

`kinetica_bi/server/src/kinetica.ts` line 44:

```typescript
export type KineticaOp =
  | "SQL"
  | "DISCOVERY"
  | "MATERIALIZE"
  | "WMS"
  | "INFO_QUERY"
  | "DYNAMIC_PREVIEW"
  | "DYNAMIC_MATERIALIZE"
  | "DYNAMIC_DROP";  // NEW — Phase 33 Plan 02 (DV-V16-07)
```

## Test Counts

- `routes.dynamic-view-drop.spec.ts` (new): **7 passing** (5 password block + 2 oidc smoke)
- `routes.dynamic-view.spec.ts` (existing, regression check): **24 passing** (unchanged)
- `routes.filter-materialize.spec.ts` (existing, regression check): **24 passing** (unchanged)
- Combined dynamic-view-relevant: **55 passing** across 3 spec files

## Decisions Made

- **Picked DYNAMIC_DROP audit-op tag** (recommended by 33-CONTEXT.md line 119) over reusing DYNAMIC_MATERIALIZE. Required extending `KineticaOp` union but pays back in audit-log filtering precision — lifecycle DROPs are operationally distinct from materialize-housekeeping DROPs.
- **Idempotency assertion validates response body shape on BOTH calls** (`expect(res1.body).toEqual({ dropped: true })` AND `expect(res2.body).toEqual({ dropped: true })`) — locks the contract for Plan 33-03's reset() loop which fires `.catch(()=>{})` but still benefits from a known-stable success-path response shape.
- **401-no-session test omits requireConfig setup** — confirms `requireAuth` middleware fires before any route handler logic. Mirrors the established pattern from existing DELETE handler's 401 test (`routes.dynamic-view.spec.ts:677-683`).
- **OIDC smoke covers Bearer header verification** — proves the `credentialType === "oidc"` branch in `buildAuthHeader` (kinetica.ts:59-65) works for this route, not just for the materialize/DELETE/preview routes already covered.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

- **Pre-existing test failures in unrelated specs** (`auth.oidc.spec.ts`, `auth.routes.spec.ts`, `routes.wms.spec.ts`, etc. — 12 failing files, 104 failing tests across the full server suite). Verified by `git stash`-ing the Plan 33-02 changes and re-running: those failures reproduce on the unchanged master tree. They are NOT caused by this plan's changes. Out of scope per the SCOPE BOUNDARY rule (only auto-fix issues directly caused by current task's changes); logged here for visibility. The three specs most directly related to this plan (`routes.dynamic-view-drop.spec.ts`, `routes.dynamic-view.spec.ts`, `routes.filter-materialize.spec.ts`) all pass green.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**Plan 33-03 (client helpers + lifecycle):**
- New client helper `dropDynamicView(id: number, signal?: AbortSignal): Promise<{ dropped: true }>` should `POST` to `/api/dynamic-view/${id}/drop` with an empty body.
- The reset() DROP loop in `App.tsx` UNAUTHORIZED handler + `DashboardsPage.tsx` DashboardOpen cleanup is the ONLY authorized caller (fire-and-forget; `.catch(()=>{})`).
- Phase 34 management modal MUST NOT call this endpoint — it uses the destructive `DELETE /api/dynamic-view/:id` (`deleteDynamicView` helper) for the operator's "Delete this saved config" action.

**Audit-log consumers** can now filter on `op: "DYNAMIC_DROP"` to distinguish lifecycle cleanup from materialize-housekeeping (`op: "DYNAMIC_MATERIALIZE"`) DROPs.

## Self-Check: PASSED

Verified the following exist:
- FOUND: `kinetica_bi/server/src/index.ts` (modified — new POST route at lines 1230-1259)
- FOUND: `kinetica_bi/server/src/kinetica.ts` (modified — KineticaOp union extended)
- FOUND: `kinetica_bi/server/tests/routes.dynamic-view-drop.spec.ts` (created — 347 lines, 7 tests)
- FOUND commit: `48f1bad` (feat(33-02): add POST /api/dynamic-view/:id/drop lifecycle primitive)
- FOUND commit: `7645cd1` (test(33-02): supertest coverage for POST /api/dynamic-view/:id/drop (7 tests))

---
*Phase: 33-dynamic-view-store*
*Completed: 2026-05-14*
