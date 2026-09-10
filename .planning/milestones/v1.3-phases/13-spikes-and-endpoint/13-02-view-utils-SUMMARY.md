---
phase: 13-spikes-and-endpoint
plan: 02
subsystem: api
tags: [typescript, vitest, sql, kinetica, materialized-views, oidc-sanitization]

requires:
  - phase: 13-spikes-and-endpoint (Plan 13-01)
    provides: S4 spike outcome (BOTH FORMS WORK — endpoint returns UNQUALIFIED view names; no schema parameter on builder)
provides:
  - kinetica_bi/server/src/lib/viewNaming.ts — sanitizeForViewName, buildFilterViewName, FilterViewNameArgs
  - kinetica_bi/server/src/lib/whereClause.ts — ActiveFilter type, escapeKineticaStringLiteral, buildServerWhereClause
  - 30 unit tests across two specs covering OIDC sanitization, view-name composition, SQL-safe escaping, equality predicates per dataType
affects: [13-03-endpoint, 14-client-store, 15-chart-from-swap]

tech-stack:
  added: []
  patterns:
    - "Pure-module split: pure utility logic isolated under server/src/lib/ with zero non-stdlib imports — unit-testable in isolation, independent of Express/db/auth"
    - "TDD RED→GREEN per task: failing spec committed first, then implementation; both halves visible in git history"
    - "Server-side type duplication: ActiveFilter type lives in server module separately from frontend type (filterStore.ts) — keeps server module frontend-import-free; field-shape parity is contractual"

key-files:
  created:
    - kinetica_bi/server/src/lib/viewNaming.ts
    - kinetica_bi/server/src/lib/whereClause.ts
    - kinetica_bi/server/tests/lib.viewNaming.spec.ts
    - kinetica_bi/server/tests/lib.whereClause.spec.ts
    - .planning/phases/13-spikes-and-endpoint/deferred-items.md
  modified: []

key-decisions:
  - "buildFilterViewName takes no schema parameter — S4 spike confirmed both qualified and unqualified WMS LAYERS work; bare unqualified is simpler (no schema lookup, no schema field on response)"
  - "Server-side ActiveFilter type duplicated rather than imported from frontend — keeps server module dependency-free of any client-side imports; field-shape parity locked by inline comment"
  - "Datetime values treated as plain quoted string literals in WHERE clauses (not TIMESTAMP 'YYYY-MM-DD' wrapped) — matches plan-locked behavior contract; v1.2 client TIMESTAMP wrapping was speculative and untested in production"
  - "Boolean values rendered as lowercase true/false (not TRUE/FALSE) — matches plan-locked behavior contract; if Kinetica requires uppercase, single-line fix in Phase 15"

patterns-established:
  - "Pure-module + spec pair under server/src/lib/ + server/tests/ for any net-new logic that does not touch Express, db, or kinetica.ts — repeatable for future utility extractions"
  - "S<N> outcome documented inline in implementation files via `// S4 outcome:` or `// SPIKE-V13-NN:` header comments — keeps spike-driven design choices visible at code-review time"

requirements-completed: [VIEW-V13-03, VIEW-V13-06]

duration: 14min
completed: 2026-05-06
---

# Phase 13 Plan 02: View-Utils Summary

**Two pure utility modules — `viewNaming.ts` (locked `_kbi_filt_u<userId>_d<dashId>_t<tableId>_s<sessionShort>` shape with OIDC userId sanitization) and `whereClause.ts` (server-side equality WHERE-clause builder with SQL-safe quote-doubling) — landed under `server/src/lib/` with zero non-stdlib imports and 30 passing unit tests, ready for Plan 13-03 endpoint composition.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-05-06T18:12:23Z
- **Completed:** 2026-05-06T18:26:58Z
- **Tasks:** 2 (both TDD)
- **Files created:** 4 (2 src, 2 spec)

## Accomplishments

- `sanitizeForViewName(username)` and `buildFilterViewName(args)` implement the locked view-name composition: alphanumeric+underscore-only, 32-char username truncation (V13-P-08 OIDC pitfall), 8-char sessionShort hex prefix, and the `_kbi_filt_u…_d…_t…_s…` shape. Bare unqualified output (S4 spike: both forms render PNG tiles, bare is simpler).
- `escapeKineticaStringLiteral(val)` and `buildServerWhereClause(filters)` implement equality-only WHERE composition with SQL-standard single-quote doubling. Per-dataType branches: string → escaped literal, number → `Number()`-coerced, null → `IS NULL`, boolean → lowercase `true`/`false`, datetime → escaped string literal.
- `ActiveFilter` type duplicated in server-side module to keep it frontend-import-free; field-shape parity with `kinetica_bi/src/store/filterStore.ts` documented inline.
- 30 unit tests pass: 14 viewNaming + 16 whereClause. Both modules ship with zero `^import` lines (pure stdlib-only).

## Task Commits

Each task followed TDD (RED → GREEN; refactor not needed):

1. **Task 1 (RED): Failing tests for viewNaming** — `f2c0549` (test)
2. **Task 1 (GREEN): Implement viewNaming.ts** — `1114de0` (feat)
3. **Task 2 (RED): Failing tests for whereClause** — `01aa30b` (test)
4. **Task 2 (GREEN): Implement whereClause.ts** — `0a245f8` (feat)

**Plan metadata:** committed separately by orchestrator (final docs commit).

## Files Created/Modified

- `kinetica_bi/server/src/lib/viewNaming.ts` — Pure module: `sanitizeForViewName`, `buildFilterViewName`, `FilterViewNameArgs` type. Zero imports. Documents S4 spike outcome inline.
- `kinetica_bi/server/src/lib/whereClause.ts` — Pure module: `ActiveFilter` type, `escapeKineticaStringLiteral`, `buildServerWhereClause`. Zero imports. Documents trust boundary on `column` interpolation inline.
- `kinetica_bi/server/tests/lib.viewNaming.spec.ts` — 14 vitest cases: alphanumeric passthrough, OIDC dot+at sanitization, auth0|pipe sanitization, punctuation→underscore, 50→32 truncation, empty input, deterministic composition, 8-char sessionShort, 200-char ceiling, no-schema-prefix.
- `kinetica_bi/server/tests/lib.whereClause.spec.ts` — 16 vitest cases: O'Brien quote-doubling, injection-shaped input, multi-quote, `1=1` empty fallback, per-dataType (string/number/string-coerced number/null/boolean/datetime) branches, 2- and 3-filter ` AND ` joining.
- `.planning/phases/13-spikes-and-endpoint/deferred-items.md` — Documents pre-existing test-suite failures unrelated to Plan 13-02 (see "Issues Encountered" below).

## Decisions Made

- **No `schema` parameter on `buildFilterViewName`** — S4 spike from 13-SPIKE-NOTES.md confirmed both `LAYERS=ki_home._kbi_filt_…` (qualified) and `LAYERS=_kbi_filt_…` (unqualified) render WMS PNG tiles successfully. Choosing bare unqualified means no `SHOW SCHEMAS` lookup, no `schema` field on AuthedRequest, no `schema` field on POST /api/filter/materialize response. Plan 13-03 endpoint response shape locks to `{ viewName, expiresAt }` only.
- **Server-side ActiveFilter type duplicated** rather than imported from `kinetica_bi/src/store/filterStore.ts` — server module stays frontend-import-free. Inline doc-comment locks field-shape parity. Future change to client type requires deliberate cross-module update (caught in Phase 15 verification).
- **Boolean lowercase + datetime as raw quoted ISO** per plan's behavior contract (not v1.2's `TRUE/FALSE` + `TIMESTAMP 'YYYY-MM-DD'`) — plan-locked spec wins over v1.2 reference; if Kinetica requires uppercase booleans or `TIMESTAMP` wrapping, single-line fix at integration time. v1.2 datetime path was untested in production (no Phase 9 path generated datetime clicks).

## Deviations from Plan

None — plan executed exactly as written. Both tasks RED→GREEN with no refactor needed; no auto-fixes triggered; no architectural decisions surfaced.

## Issues Encountered

**Pre-existing full-suite test failures (out-of-scope):** `cd kinetica_bi/server && npm test` reports 104 failing tests across 12 spec files. Reproduced on commit `97e893e` (BEFORE Plan 13-02 began) — confirmed pre-existing and unrelated to the new pure modules (which have zero imports from any failing file). Documented in `.planning/phases/13-spikes-and-endpoint/deferred-items.md` for separate triage. Plan 13-02's own test surface — `lib.viewNaming.spec.ts` + `lib.whereClause.spec.ts` — is 30/30 PASS, and `npx tsc --noEmit` is clean.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

Plan 13-03 (endpoint) is unblocked:

- `import { buildFilterViewName } from "./lib/viewNaming"` — composes view name from `(req.user.username, req.user.sid, dashboardId, tableId)`
- `import { buildServerWhereClause, type ActiveFilter } from "./lib/whereClause"` — composes WHERE body from POST request body's `filters[]`
- Both modules unit-tested, deterministic, side-effect-free — Plan 13-03 supertest can mock `kineticaSql` and assert on the composed DDL string without retesting these helpers' internals
- No circular-import or type-resolution risk — both modules are pure stdlib

The pre-existing test-suite regressions (deferred) do not block Plan 13-03; new endpoint specs (`tests/routes.filterMaterialize.spec.ts` per Plan 13-03) will be additive in the same way.

## Self-Check: PASSED

All claimed files exist on disk; all 4 task-commit hashes resolve in `git log`.

- Files verified: `kinetica_bi/server/src/lib/viewNaming.ts`, `kinetica_bi/server/src/lib/whereClause.ts`, `kinetica_bi/server/tests/lib.viewNaming.spec.ts`, `kinetica_bi/server/tests/lib.whereClause.spec.ts`, `.planning/phases/13-spikes-and-endpoint/13-02-view-utils-SUMMARY.md`, `.planning/phases/13-spikes-and-endpoint/deferred-items.md`
- Commits verified: `f2c0549`, `1114de0`, `01aa30b`, `0a245f8`

---
*Phase: 13-spikes-and-endpoint*
*Completed: 2026-05-06*
