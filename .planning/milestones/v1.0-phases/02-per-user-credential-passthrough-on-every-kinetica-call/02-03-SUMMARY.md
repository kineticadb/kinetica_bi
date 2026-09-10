---
phase: 02-per-user-credential-passthrough-on-every-kinetica-call
plan: "03"
subsystem: api
tags: [kinetica, routes, per-user-credentials, tdd, integration-tests, discovery, sql-proxy]

# Dependency graph
requires:
  - "02-02: kineticaSql helper with per-user creds, typed errors, audit log"
  - "02-02: req.requestId plumbed via requireAuth"
provides:
  - "kinetica_bi/server/src/index.ts: POST /api/sql routed through kineticaSql(req, sql, { op: 'SQL' })"
  - "kinetica_bi/server/src/index.ts: GET /api/kinetica/schemas routed through kineticaSql(req, sql, { op: 'DISCOVERY' })"
  - "kinetica_bi/server/src/index.ts: GET /api/kinetica/schemas/:schema/tables routed through kineticaSql(req, sql, { op: 'DISCOVERY' })"
  - "kinetica_bi/server/src/index.ts: GET /api/kinetica/schemas/:schema/tables/:table/columns routed through kineticaSql(req, sql, { op: 'DISCOVERY' })"
  - "kinetica_bi/server/tests/routes.sql.spec.ts: 10 integration tests for POST /api/sql"
  - "kinetica_bi/server/tests/routes.discovery.spec.ts: 17 integration tests for 3 discovery routes"
affects:
  - "02-04 and 02-05: materialize + WMS are the 2 remaining call sites to refactor"
  - "02-06: module-const deletion will clean up kineticaUser/kineticaPassword from requireConfig"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Route handler pattern: import kineticaSqlHelper from ./kinetica; call as kineticaSqlHelper(req as AuthedRequest, sql, { route, op })"
    - "Phase 2 boundary: catch typed errors → 502; Phase 3 narrows to 401-REAUTH/403/502"
    - "TDD: RED (failing tests prove old behavior) → GREEN (refactor makes tests pass) per task"

key-files:
  created:
    - "kinetica_bi/server/tests/routes.sql.spec.ts"
    - "kinetica_bi/server/tests/routes.discovery.spec.ts"
  modified:
    - "kinetica_bi/server/src/index.ts"

key-decisions:
  - "Import kineticaSql as kineticaSqlHelper alias to avoid naming collision with deleted inline kineticaSql"
  - "All 3 discovery route handlers rename _req to req (required by AuthedRequest signature)"
  - "Phase 2 boundary preserved: all typed helper errors → 502 in catch block; Phase 3 middleware narrows"
  - "Deleted console.error calls in discovery routes (helper owns logging per CONTEXT.md decisions)"

# Metrics
duration: 3min
completed: 2026-04-28
---

# Phase 02 Plan 03: Route Refactor — SQL Proxy + Discovery Routes Summary

**4 SQL-shaped Kinetica call sites refactored to use kineticaSql helper with per-user credentials; inline helper deleted; 27 new integration tests verify Authorization header uses req.user.creds not env vars**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-28T15:28:42Z
- **Completed:** 2026-04-28T15:31:55Z
- **Tasks:** 2 (TDD: POST /api/sql refactor + discovery routes refactor + inline helper deletion)
- **Files created:** 2, **modified:** 1

## Accomplishments

### Task 1: Refactor POST /api/sql + integration tests

- Added imports to `index.ts`: `kineticaSql as kineticaSqlHelper` from `./kinetica`, `KineticaAuthError`, `KineticaPermissionError`, `KineticaUpstreamError` from `./kineticaErrors`, `type AuthedRequest` from `./auth`
- Replaced inline `fetch(...Buffer.from(kineticaUser:kineticaPassword)...)` with `kineticaSqlHelper(req as AuthedRequest, sql, { route: "POST /api/sql", op: "SQL", extra: options })`
- Phase 2 boundary preserved: typed errors caught and returned as 502

`routes.sql.spec.ts`: 10 tests
- Happy path: per-user creds forwarded, parsed encoded shape returned
- Per-user auth header assertion: `alice:alice-secret-pw` NOT `KINETICA_USERNAME` env var
- 401/403/5xx from Kinetica → 502 to client
- Network throw → 502
- Options pass-through: `limit: 50` merged into request body
- No admin-cred fallback: exactly 1 fetch call per request
- Unauthenticated → 401 (Phase 1 behavior)
- Missing sql field → 400

### Task 2: Refactor 3 discovery routes; delete inline kineticaSql helper

- **DELETED** the local `kineticaSql` helper (index.ts lines 333-365) — no remaining callers
- Renamed `_req` → `req` in all 3 discovery route handlers (required for AuthedRequest cast)
- Replaced all 3 routes with `kineticaSqlHelper(req as AuthedRequest, sql, { route, op: "DISCOVERY" })`
- Preserved SQL single-quote escaping: `schema.replace(/'/g, "''")` and `table.replace(/'/g, "''")`
- Preserved client-facing shapes: `{ data: [...] }` for schemas/tables, `{ data: { col: type } }` for columns
- Deleted stale `console.error("Kinetica X error", error)` calls (helper owns logging)

`routes.discovery.spec.ts`: 17 tests
- GET /api/kinetica/schemas: happy path + per-user auth header + 403→502 + 401→502 + op:DISCOVERY audit log + restricted-user evidence + unauthenticated→401
- GET /api/kinetica/schemas/:schema/tables: happy path + per-user auth header + SQL-escape + 403→502 + network→502
- GET /api/kinetica/schemas/:schema/tables/:table/columns: happy path + per-user auth header + SQL-escape (schema+table) + 403→502 + op:DISCOVERY audit log

## Task Commits

1. **Task 1: POST /api/sql refactor + routes.sql.spec.ts** — `a7fc3e1`
2. **Task 2: Discovery routes refactor + helper deletion + routes.discovery.spec.ts** — `e1a7653`

## Test Count Delta vs Plan 02 Baseline

| Baseline (Plan 02) | New (this plan) | Total |
|--------------------|----------------|-------|
| 157 | +27 (10 SQL + 17 discovery) | **184** |

Phase 1's 56-test green baseline: preserved.

## Acceptance Criteria Verification

- [x] POST /api/sql calls `kineticaSqlHelper(req, ...)` — `grep -c "kineticaSqlHelper(req" kinetica_bi/server/src/index.ts` → 4
- [x] Inline kineticaSql helper DELETED — `grep -c "const kineticaSql = async" kinetica_bi/server/src/index.ts` → 0
- [x] 3 discovery routes use op: "DISCOVERY" — `grep -c 'op: "DISCOVERY"' kinetica_bi/server/src/index.ts` → 3
- [x] No Buffer.from in discovery routes for auth — grep returns 0 in refactored section
- [x] kineticaUser/kineticaPassword refs: 5 (line 51-52 declarations + line 69 requireConfig + line 275 materialize + line 419 WMS) — only 3 sites remain to migrate (Plans 04-05-06)
- [x] All 184 tests pass: `npx vitest run` → 14/14 files, 184/184 tests
- [x] `npm run build` exits 0

## Remaining kineticaUser/kineticaPassword References in index.ts

| Line | Site | Plan to migrate |
|------|------|----------------|
| 51-52 | Module const declarations | Plan 06 (deletion) |
| 69 | requireConfig guard | Plan 06 (narrowing) |
| 275 | POST /api/views/:id/materialize | Plan 05 |
| 419 | GET /api/wms | Plan 04 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Naming collision] Import alias kineticaSqlHelper**
- **Found during:** Task 1
- **Issue:** Importing `kineticaSql` from `./kinetica` would shadow the local `kineticaSql` helper. Since Task 1 added the import BEFORE Task 2 deleted the local helper (per plan's ordering), a temporary naming conflict existed.
- **Fix:** Imported as `kineticaSqlHelper` alias. All 4 call sites use `kineticaSqlHelper(req, ...)`. Both spec files verify the per-user behavior end-to-end regardless of the alias name.
- **Files modified:** `kinetica_bi/server/src/index.ts`
- **Impact:** Zero — alias is internal to index.ts, not exported.

---

**Total deviations:** 1 auto-fixed (naming alias to avoid import collision)
**Impact on plan:** Functionally identical outcome; all acceptance criteria met.

## Self-Check: PASSED

- [x] `routes.sql.spec.ts` exists and passes 10 tests
- [x] `routes.discovery.spec.ts` exists and passes 17 tests
- [x] `index.ts` inline helper deleted: `grep -c "const kineticaSql = async" src/index.ts` → 0
- [x] `index.ts` has 3 DISCOVERY ops: `grep -c 'op: "DISCOVERY"' src/index.ts` → 3
- [x] `index.ts` has 4 kineticaSqlHelper calls: `grep -c "kineticaSqlHelper(req" src/index.ts` → 4
- [x] Full suite: `npx vitest run` → 184/184 passed (0 failures, 14 files)
- [x] Build: `npm run build` → exits 0
- [x] Task 1 commit: `a7fc3e1`
- [x] Task 2 commit: `e1a7653`

---
*Phase: 02-per-user-credential-passthrough-on-every-kinetica-call*
*Completed: 2026-04-28*
