---
phase: 02-per-user-credential-passthrough-on-every-kinetica-call
plan: "05"
subsystem: api
tags: [kinetica, materialize, per-user-credentials, tdd, integration-tests, loud-failure, audit-log]

# Dependency graph
requires:
  - "02-01: SPIKE.md — loud-failure acceptable decision; HTTP 400 is DDL-denial signal"
  - "02-02: kineticaSql helper with KineticaPermissionError for 400+access-denied, audit emitter"
  - "02-04: refactor pattern established (typed errors → 502, helper import alias)"
provides:
  - "kinetica_bi/server/src/index.ts: POST /api/views/:id/materialize refactored to kineticaSqlHelper(req, ddl, { route, op: 'MATERIALIZE' })"
  - "kinetica_bi/server/tests/routes.materialize.spec.ts: 13 integration tests — happy path, per-user auth, DDL shape, 403/400+access-denied/401/5xx/network → 502+status='error', audit op:MATERIALIZE, no-double-persist, 404 view-not-found/table-not-found, unauthenticated 401"
affects:
  - "02-06: module-const deletion; 3 remaining kineticaUser/kineticaPassword refs (2 declarations + requireConfig) are all in Plan 06 scope"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Materialize refactor pattern: kineticaSqlHelper(req as AuthedRequest, ddl, { route, op: 'MATERIALIZE', extra: { limit: 1 } }) — same catch pattern as SQL proxy"
    - "updateViewStatus side-effect preservation: called on every code path (success → 'created', typed error → 'error' with sanitized message, defensive catch → 'error' with generic message)"
    - "Loud-failure design (SPIKE.md decision): KineticaPermissionError from 400+access-denied maps to status='error' + 502; no admin escape hatch"
    - "Phase 2 boundary preserved: all typed helper errors → 502 until Phase 3 middleware narrows"
    - "FK-bypass test pattern: db.pragma('foreign_keys = OFF') temporarily to seed orphaned-view fixture without cascade deletion"

key-files:
  created:
    - "kinetica_bi/server/tests/routes.materialize.spec.ts"
  modified:
    - "kinetica_bi/server/src/index.ts"

key-decisions:
  - "extra: { limit: 1 } passed to kineticaSqlHelper to preserve the existing DDL request shape (original materialize had limit:1 in the Kinetica body)"
  - "Acceptance criteria 'exactly 2 kineticaUser/kineticaPassword refs' is actually 3 (same counting error as Plan 04) — 2 declarations + requireConfig; materialize is correctly removed"
  - "FK-bypass approach (pragma off/on) used for source-table-not-found test fixture — ON DELETE CASCADE would cascade-delete the view, preventing the test scenario"

patterns-established:
  - "All five primary Kinetica call sites now route through kineticaSql/kineticaWms helpers — no inline admin-credential fetch remains in any route handler"

requirements-completed: [CRED-04]

# Metrics
duration: 2min
completed: 2026-04-28
---

# Phase 02 Plan 05: POST /api/views/:id/materialize Refactor Summary

**Materialize route refactored to kineticaSql helper with per-user credentials, op:MATERIALIZE audit tagging, updateViewStatus side-effect preserved on all paths, and 13 integration tests; loud-failure design implemented per SPIKE.md decision**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-28T15:39:13Z
- **Completed:** 2026-04-28T15:41:13Z
- **Tasks:** 1 (TDD: RED test file + GREEN refactor in index.ts)
- **Files created:** 1, **modified:** 1

## Accomplishments

### Task 1: Refactor POST /api/views/:id/materialize to use kineticaSql + integration tests

**index.ts changes (lines 257-303):**

Replaced the inline fetch with admin Basic auth credentials with:
```typescript
await kineticaSqlHelper(req as AuthedRequest, ddl, {
  route: "POST /api/views/:id/materialize",
  op: "MATERIALIZE",
  extra: { limit: 1 },
});
const updated = updateViewStatus(id, "created");
return res.json({ view: updated, ddl });
```
Catch block handles:
- `KineticaAuthError | KineticaPermissionError | KineticaUpstreamError` → `updateViewStatus(id, "error", error.message)` + 502
- Unexpected non-typed error → `updateViewStatus(id, "error", "Failed to materialize view")` + 502

**routes.materialize.spec.ts (13 tests):**

| Test | What it verifies |
|------|----------------|
| Happy path | 200, status='created' persisted, body has view+ddl |
| Per-user auth header | Auth decodes to `alice:${SESSION_PASSWORD}`, NOT admin creds |
| DDL statement shape | `statement` field = `CREATE OR REPLACE MATERIALIZED VIEW <name> AS SELECT * FROM ki_home.events` |
| 403 → 502 + status='error' | KineticaPermissionError → 502, persisted error_message, no credential leak |
| 400+access-denied → 502 + status='error' | KineticaPermissionError (from classifyHttpError) → 502, persisted |
| 401 → 502 + status='error' | KineticaAuthError → 502, persisted |
| 5xx → 502 + status='error' | KineticaUpstreamError → 502, persisted |
| Network throw → 502 + status='error' | fetch rejection → 502, persisted |
| No double-persist on success | Row has status='created', error_message is null/undefined |
| Audit op:MATERIALIZE | console.log line contains `"op":"MATERIALIZE"`; no `"op":"SQL"` on same call |
| 404 view not found | No fetch called, 404 returned |
| 404 table not found | No fetch called, 404 returned (FK-bypass fixture) |
| Unauthenticated → 401 | Phase 1 requireAuth behavior preserved |

## Task Commits

1. **TDD RED: Failing integration tests for materialize** — `e2800e4`
2. **TDD GREEN: POST /api/views/:id/materialize refactor** — `ee8582f`

## Test Count Delta vs Plan 04 Baseline

| Baseline (Plan 04) | New (this plan) | Total |
|--------------------|----------------|-------|
| 192 | +13 (routes.materialize.spec.ts) | **205** |

Phase 1's 56-test green baseline: preserved.
All 16 spec files pass.

## Remaining kineticaUser/kineticaPassword References in index.ts

| Line | Site | Plan to migrate |
|------|------|----------------|
| 51 | `const kineticaUser = ...` declaration | Plan 06 (deletion) |
| 52 | `const kineticaPassword = ...` declaration | Plan 06 (deletion) |
| 69 | requireConfig guard | Plan 06 (narrowing) |

Total: **3 lines** (grep -c returns 3). Plan 05 acceptance criteria said "exactly 2" — same counting error as Plan 04 (declarations counted separately from requireConfig guard). Materialize handler is correctly refactored: 0 references remain in the handler.

**This is the last inline admin-credential fetch in any route handler.** Every Kinetica call now routes through `kineticaSql`/`kineticaWms` with per-user credentials.

**Plan 06** is the final cleanup plan: deletes `kineticaUser`/`kineticaPassword` declarations and updates `requireConfig`.

## SPIKE.md Alignment

The SPIKE.md Recommendation reads: "loud-failure acceptable — proceed with Phase 2 per-user materialize as planned"

This plan implements that decision exactly:
- No admin-credential escape hatch reintroduced
- `KineticaPermissionError` from `400+access-denied` (classifyHttpError) → `status='error'` + 502
- Sanitized error message from `error.message` (helper-controlled, no raw Kinetica body or credentials)

## Deviations from Plan

None — plan executed exactly as written.

The `extra: { limit: 1 }` field in the plan spec was preserved verbatim (original inline fetch had `limit: 1`). The FK-bypass test fixture technique is an implementation detail of the test, not a plan deviation.

---

**Total deviations:** 0 auto-fixed
**Impact on plan:** Plan executed exactly as written.

## Self-Check: PASSED

- [x] `routes.materialize.spec.ts` exists and all 13 tests pass
- [x] `index.ts` materialize handler calls `kineticaSqlHelper` with `op: "MATERIALIZE"`: present
- [x] No `Buffer.from` in materialize handler: `awk` returns 0
- [x] No `kineticaUser`/`kineticaPassword` in materialize handler: grep returns 0
- [x] `updateViewStatus(id, "created")` on success path: present
- [x] `updateViewStatus(id, "error", error.message)` on typed-error path: present
- [x] Full suite: `npx vitest run` → 205/205 passed (16 files, 0 failures)
- [x] Build: `npm run build` exits 0
- [x] Total remaining `kineticaUser`/`kineticaPassword` refs in index.ts: 3 (declarations + requireConfig, all Plan 06 scope)
- [x] RED commit: `e2800e4`
- [x] GREEN commit: `ee8582f`
- [x] SPIKE.md gate: "loud-failure acceptable" confirmed before code changes

---
*Phase: 02-per-user-credential-passthrough-on-every-kinetica-call*
*Completed: 2026-04-28*
