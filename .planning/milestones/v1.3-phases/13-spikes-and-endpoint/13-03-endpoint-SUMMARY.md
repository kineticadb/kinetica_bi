---
phase: 13-spikes-and-endpoint
plan: 03
subsystem: api
tags: [express, supertest, kinetica, materialized-views, ddl, oidc, vitest]

requires:
  - phase: 13-spikes-and-endpoint (Plan 13-01)
    provides: S2.a PASS (per-user CREATE/DROP DDL works in password mode) + S4 BOTH WORK (unqualified bare view names suffice for WMS LAYERS)
  - phase: 13-spikes-and-endpoint (Plan 13-02)
    provides: lib/viewNaming.ts (buildFilterViewName) + lib/whereClause.ts (buildServerWhereClause, ActiveFilter type) — pure modules composed by these route handlers
provides:
  - POST /api/filter/materialize handler in createApp() — { dashboardId, tableId, filters[] } -> { viewName, expiresAt }; CREATE OR REPLACE MATERIALIZED VIEW … USING TABLE PROPERTIES (TTL = 5)
  - DELETE /api/filter/materialize handler in createApp() — ?dashboardId=N&tableId=M -> { dropped: true }; DROP TABLE IF EXISTS <viewName>
  - 23 supertest cases across 4 describe blocks (POST × password, POST × oidc, DELETE × password, DELETE × oidc)
  - Locked view-name regex for Phase 14 client validation: /^_kbi_filt_u\w+_d\d+_t\d+_s\w{8}$/
affects: [14-filter-view-store, 15-chart-filtering, 16-map-filtering, 17-verification]

tech-stack:
  added: []
  patterns:
    - "Stateless transient view route: no SQLite reads/writes, no try/catch in handler — typed Kinetica errors bubble through asyncHandler -> errorMiddleware. Distinct from /api/views/:id/materialize (persisted) which retains its try/catch for status persistence side effects."
    - "Session-derived view name: handler composes view name from (req.user.creds.username, req.user.sid, dashboardId, tableId) at request time — no lookup, no row, no extra round trip. Phase 14 client never sees session_id; trusts the server-returned viewName as opaque."
    - "OIDC supertest pattern: hoisted vi.mock('openid-client') with Issuer doubling as constructor + static-discover namespace mirrors auth.oidc.spec.ts; test-local resetOidcClientForTests() in beforeEach to clear singleton."

key-files:
  created:
    - kinetica_bi/server/tests/routes.filter-materialize.spec.ts
    - .planning/phases/13-spikes-and-endpoint/13-03-endpoint-SUMMARY.md
  modified:
    - kinetica_bi/server/src/index.ts

key-decisions:
  - "No try/catch in either handler — confirmed during Task 1; matches plan's stateless invariant. The existing /api/views/:id/materialize keeps try/catch ONLY because it must persist status='error' to SQLite on failure; transient views have no row to persist, so error handling reduces to errorMiddleware's typed-error translation."
  - "OIDC supertest seeds session row via createSession({ credentialType: 'oidc', secret: <fake_token>, idToken: <fake_jwt> }) AFTER buildTestApp() — same pattern as kinetica.creds.routes.spec.ts. AUTH_MODE=oidc env stub triggers the boot-time wipe of password rows (irrelevant here since we seed after boot) and exercises the createApp OIDC initOidcClient path with the hoisted openid-client mock."
  - "S4 'BOTH FORMS WORK' outcome -> handler does NOT pass schema to buildFilterViewName; viewName is bare _kbi_filt_..., not ki_home._kbi_filt_... Plan 14 client uses bare view name in subsequent SELECT FROM and WMS LAYERS calls; Kinetica resolves unqualified identifiers in the caller's session schema."

patterns-established:
  - "Phase 13 endpoint pattern (replicate for any future per-user transient DDL): requireConfig + asyncHandler, NO try/catch, request-scoped composition via lib/* pure helpers, kineticaSqlHelper(req, ddl, { route, op: 'MATERIALIZE' }). Errors translate via existing errorMiddleware."
  - "Test-only OIDC boot mock: vi.hoisted({ Issuer-as-constructor-with-static-discover, OPError, RPError }) + vi.mock('openid-client', ...); resetOidcClientForTests() in beforeEach. Avoids real network discovery while still exercising the createApp OIDC branch."

requirements-completed: [VIEW-V13-01, VIEW-V13-02, VIEW-V13-04, VIEW-V13-05, VIEW-V13-07]

duration: 16min
completed: 2026-05-06
---

# Phase 13 Plan 03: Filter Materialize Endpoint Summary

**Two stateless route handlers (`POST` + `DELETE /api/filter/materialize`) wired into `createApp()` body — composed from Plan 13-02 pure helpers (`buildFilterViewName`, `buildServerWhereClause`) and the existing `kineticaSql` per-user-creds helper — with 23 supertest cases covering happy paths, error paths, DDL-string assertions, view-name regex, single-quote escape, audit-log op tagging, and both `AUTH_MODE=password` + `AUTH_MODE=oidc` session contexts. Phase 13 endpoint contract `{ viewName, expiresAt }` (POST) and `{ dropped: true }` (DELETE) is now the locked source-of-truth for Phase 14 client wiring.**

## Performance

- **Duration:** ~16 min
- **Started:** 2026-05-06T18:32:21Z
- **Completed:** 2026-05-06T18:48:00Z (approx)
- **Tasks:** 2
- **Files created:** 1 (test spec)
- **Files modified:** 1 (server/src/index.ts — +80 lines: 2 imports + 2 handlers)

## Accomplishments

- **POST /api/filter/materialize** wired into `createApp()` after the existing `/api/views/:id/materialize` block (lines ~677-715 in `index.ts`):
  - Validates `dashboardId`/`tableId` are numbers (400 otherwise) and `filters[]` is non-empty (400 with "use DELETE to clear" message)
  - Resolves `getTable(tableId)` for the source table reference (404 if missing)
  - Composes `viewName` via `buildFilterViewName({ username, sessionId, dashboardId, tableId })` (no schema arg; S4 outcome)
  - Composes `whereClause` via `buildServerWhereClause(filters)` (handles single-quote escape, datatype-aware predicates)
  - Issues `CREATE OR REPLACE MATERIALIZED VIEW <viewName> AS (SELECT * FROM <schema>.<table> WHERE <whereClause>) USING TABLE PROPERTIES (TTL = 5)` via `kineticaSqlHelper(req, ddl, { route, op: "MATERIALIZE" })`
  - Returns `{ viewName, expiresAt }` where `expiresAt = Date.now() + 5 * 60 * 1000`
- **DELETE /api/filter/materialize** wired alongside (lines ~717-739):
  - Reads `dashboardId`/`tableId` from query params (`Number(...)` + `Number.isFinite` validation; 400 otherwise)
  - Composes the same session-derived `viewName` as POST (no SQLite lookup needed; deterministic from `(username, sid, dashboardId, tableId)`)
  - Issues `DROP TABLE IF EXISTS <viewName>` via `kineticaSqlHelper` with `op: "MATERIALIZE"`
  - Returns `{ dropped: true }`
- **Both handlers contain NO try/catch.** Typed errors (`KineticaAuthError` -> 401 + REAUTH; `KineticaPermissionError` -> 403 with no `code` field; `KineticaUpstreamError` -> 502) bubble through `asyncHandler` to the existing `errorMiddleware`.
- **23 supertest cases** in `routes.filter-materialize.spec.ts` (4 describe blocks):
  - POST × password (13 cases): happy path, DDL string assertion, single-quote escape, view-name regex, op-MATERIALIZE audit, empty/missing/non-existent input -> 400/404, Kinetica 403 -> 403 (no `code`), Kinetica 401 -> 401 + REAUTH, no cookie -> 401, expiresAt window assertion
  - POST × oidc (2 cases): username-with-dots sanitization (`john.doe@kinetica.com -> ujohn_doe_kinetica_com`), Bearer auth header (not Basic)
  - DELETE × password (7 cases): happy path, DDL string assertion (`/^DROP TABLE IF EXISTS _kbi_filt_u\w+_d1_t1_s\w{8}$/`), op-MATERIALIZE audit, missing/non-numeric query params -> 400, no cookie -> 401
  - DELETE × oidc (1 case): Bearer auth header round-trip
- **All 23 tests pass; `npx tsc --noEmit` clean.**

## Task Commits

1. **Task 1: Wire POST + DELETE routes** — `852d89e` (feat)
2. **Task 2: Add supertest coverage** — `0cc8771` (test)

**Plan metadata:** committed by orchestrator (final docs commit).

_Note: TDD ordering was implementation-first then spec-second — the plan explicitly orders Task 1 (routes) before Task 2 (spec). The spec proves the routes work; both halves are visible in git history._

## Files Created/Modified

- **Modified `kinetica_bi/server/src/index.ts`** — Added 2 import lines and 2 route handlers inside `createApp()`. Total +80 lines. No other changes; the existing `POST /api/views/:id/materialize` (persisted-view CRUD) is untouched.
- **Created `kinetica_bi/server/tests/routes.filter-materialize.spec.ts`** — 23 vitest cases. Uses hoisted `vi.mock("openid-client")` so AUTH_MODE=oidc boot succeeds without network. Reuses `seedFixture` (createDashboard + createTable) and forges JWT cookies via `jwt.sign(...)`. OIDC sessions are seeded directly via `createSession({ credentialType: "oidc", secret: <fake_token>, idToken: <fake_jwt> })`.
- **Created `.planning/phases/13-spikes-and-endpoint/13-03-endpoint-SUMMARY.md`** — This file.

### Locked contract for downstream phases

- **View-name regex:** `/^_kbi_filt_u\w+_d\d+_t\d+_s\w{8}$/` — Phase 14 client validates server-returned `viewName` against this.
- **POST response shape:** `{ viewName: string, expiresAt: number }` — `expiresAt` is epoch ms; client uses it to schedule rematerialize before TTL.
- **DELETE response shape:** `{ dropped: true }` — client treats fire-and-forget; no error if view didn't exist (Kinetica `DROP TABLE IF EXISTS` is idempotent — confirmed in S2.c spike).
- **Schema qualification:** UNQUALIFIED bare view names returned. S4 confirmed both forms work; bare is simpler. Phase 14/15/16 use bare `viewName` in `SELECT FROM` / `LAYERS=` without prefix.
- **Auth gating:** Both routes mount under the `/api` `requireAuth` namespace (line 420 of `index.ts`). No session cookie -> 401 from `requireAuth` before handler runs.
- **Op tag:** Both handlers use `op: "MATERIALIZE"` — same tag as the existing `/api/views/:id/materialize` (single op tag covers create AND drop). Audit-log filtering by `"op":"MATERIALIZE"` captures all transient + persisted DDL.

## Decisions Made

- **No `try/catch` in either handler** — Plan-mandated and verified via grep on the handler ranges (0 occurrences). The existing persisted-view materialize handler retains try/catch ONLY because it must call `updateViewStatus("error", message)` as a side effect on every failure path. Transient views have no SQLite row to persist, so the typed-error -> errorMiddleware path covers everything.
- **Plan-spec mode for Task 2 OIDC tests:** The plan's `<action>` for Task 2 sketched two alternative OIDC strategies (bullet 2: "If `buildTestApp()` does HTTP discovery against the issuer, the OIDC tests may need additional fetch stubbing for the `.well-known/openid-configuration` endpoint" + "If discovery is too noisy to stub, the OIDC tests can use `validateOidcEnv` mocking via `vi.mock('../src/oidc', ...)`"). I chose a **third path: hoisted `vi.mock("openid-client")` matching the established `auth.oidc.spec.ts` pattern**. The hoisted Issuer mock is BOTH a constructor (for `new Issuer(meta)` at `oidc.ts:82`) AND a static `discover(...)` namespace. This is the project's idiomatic way to boot `createApp` in oidc mode without network — and was discovered by running the spec, getting `TypeError: Issuer is not a constructor`, and adapting the mock fixture (single iteration; counts as Rule 3 self-recovery, not a deviation).
- **OIDC test sessions seeded after `buildTestApp()`** — same defensive pattern as `kinetica.creds.routes.spec.ts:Test 1`. Boot-time wipe deletes contradicting-mode rows; seeding after boot guarantees the session row survives even if AUTH_MODE flips in a future test run.
- **No service-account fallback** — confirmed STATE.md decision. S2.a password-mode PASS unblocks per-user creds path verbatim. OIDC DDL probe (S2.b) remains deferred to Phase 15 LIFE-V13-02 or Phase 17 verification, with the deferred-items.md note carried forward.

## Deviations from Plan

None requiring auto-fix beyond a single iteration on the OIDC mock fixture (TypeError on `new Issuer(meta)` → adapted the hoisted mock to make `Issuer` both a constructor and a namespace). This is the only divergence from the plan's verbatim sketch and is documented as a key decision above. No Rule 1/2/3/4 invocations.

## Issues Encountered

- **OIDC mock initial form was incomplete** — first run produced 3 OIDC test failures (`TypeError: Issuer is not a constructor` at `oidc.ts:82` inside `initOidcClient`). The fix was to make the hoisted `Issuer` a constructor function with a `.discover` static method, mirroring the real `openid-client` API. Single iteration, ~30s; tests went 20/23 → 23/23.
- **Pre-existing 104 test failures (out-of-scope)** — confirmed in `deferred-items.md` from Plan 13-02. NOT investigated, NOT fixed. The new spec is a NET ADD: `routes.filter-materialize.spec.ts` is 23/23 PASS in isolation (`npx vitest run routes.filter-materialize.spec.ts`); `npx tsc --noEmit` is clean.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

Plan 14-01 (first plan of Phase 14: `filter-view-store`) is unblocked. The exact request/response shape Phase 14 needs is locked by this plan's tests:

```typescript
// POST /api/filter/materialize
type PostRequest = { dashboardId: number; tableId: number; filters: ActiveFilter[] };
type PostResponse = { viewName: string; expiresAt: number };

// DELETE /api/filter/materialize?dashboardId=N&tableId=M
type DeleteResponse = { dropped: true };

// View-name validation regex (server -> client trust check)
const VIEW_NAME_RX = /^_kbi_filt_u\w+_d\d+_t\d+_s\w{8}$/;
```

Phase 14 will build `useFilterViewStore` (Zustand) keyed on `(dashboardId, tableId)` -> `{ viewName, expiresAt }`, plus the API helpers (`materializeFilterView`, `dropFilterView`) that POST/DELETE to these routes. Phase 15 then swaps chart `FROM` clauses to use the stored `viewName`. Phase 16 swaps WMS `LAYERS=` to use the stored `viewName`.

### Phase 13 readiness for milestone audit

Per the plan's `<output>` checklist:

- **Plan 13-01 (Spikes):** SPIKE-V13-01 ✅, SPIKE-V13-02 ✅ (password PASS; OIDC deferred), SPIKE-V13-03 ✅, SPIKE-V13-04 ✅
- **Plan 13-02 (Pure utils):** VIEW-V13-03 ✅, VIEW-V13-06 ✅
- **Plan 13-03 (Endpoint — this plan):** VIEW-V13-01 ✅, VIEW-V13-02 ✅, VIEW-V13-04 ✅, VIEW-V13-05 ✅, VIEW-V13-07 ✅

All 11 Phase 13 requirements `[x]` after this plan completes (with SPIKE-V13-02 OIDC re-probe still deferred to Phase 15/17).

## Self-Check: PASSED

- File `kinetica_bi/server/src/index.ts` modified — confirmed via `git log -p`.
- File `kinetica_bi/server/tests/routes.filter-materialize.spec.ts` created — confirmed exists.
- File `.planning/phases/13-spikes-and-endpoint/13-03-endpoint-SUMMARY.md` created — this file.
- Commit `852d89e` (Task 1) — confirmed in `git log`.
- Commit `0cc8771` (Task 2) — confirmed in `git log`.
- 23/23 vitest cases pass on `routes.filter-materialize.spec.ts`.
- `npx tsc --noEmit` exits 0.

---
*Phase: 13-spikes-and-endpoint*
*Completed: 2026-05-06*
