---
phase: 32-dynamic-view-foundation
plan: 01
subsystem: server
tags: [db-schema, sqlite, dynamic-views, sql-helpers, refactor, materialize, kinetica]
requires:
  - phase-32-CONTEXT-D1-token-regex
  - phase-32-CONTEXT-D3-columns-persistence
  - phase-32-CONTEXT-D5-materialize-race-recovery
  - phase-32-CONTEXT-D7-naming
provides:
  - dashboard_dynamic_views-sqlite-table
  - DashboardDynamicView-type
  - listDashboardDynamicViews
  - getDashboardDynamicView
  - createDashboardDynamicView
  - updateDashboardDynamicView
  - deleteDashboardDynamicView
  - substituteViewToken
  - MissingViewTokenError
  - buildDynamicViewName
  - createOrReplaceMaterialized
affects:
  - POST /api/filter/materialize (now uses shared retry helper; contract preserved)
tech-stack:
  added:
    - kinetica_bi/server/src/lib/dynamicViewSql.ts (pure module)
    - kinetica_bi/server/src/lib/dynamicViewName.ts (pure module)
    - kinetica_bi/server/src/lib/materializedView.ts
  patterns:
    - CREATE TABLE IF NOT EXISTS idempotent migration (mirrors Phase 19 v1.4)
    - mapXxx / listXxx / createXxx / updateXxx / deleteXxx CRUD shape
    - "\"key\" in attrs" discriminant for partial-update JSON-text fields
    - vi.hoisted + vi.mock for kineticaSql in helper-only unit tests
key-files:
  created:
    - kinetica_bi/server/src/lib/dynamicViewSql.ts
    - kinetica_bi/server/src/lib/dynamicViewName.ts
    - kinetica_bi/server/src/lib/materializedView.ts
    - kinetica_bi/server/tests/db.dynamicViewsMigration.spec.ts
    - kinetica_bi/server/tests/lib.dynamicViewSql.spec.ts
    - kinetica_bi/server/tests/lib.dynamicViewName.spec.ts
    - kinetica_bi/server/tests/lib.materializedView.spec.ts
  modified:
    - kinetica_bi/server/src/db.ts (CREATE TABLE block + index + 5 CRUD helpers + 1 mapper + 1 import line)
    - kinetica_bi/server/src/types.ts (DashboardDynamicView type)
    - kinetica_bi/server/src/index.ts (import + replaced 37-line inline try/catch with 8-line helper call)
decisions:
  - dashboard_dynamic_views columns_json stored as TEXT JSON-encoded; null when never previewed
  - max_records DEFAULT 100000 (Claude's discretion — operator can override per row; matches CONTEXT.md Endpoints sample size)
  - updateDashboardDynamicView uses "key" in attrs discriminant (mirrors mapDashboardLayer info_* handling) so columns_json:null clears the field but key-omission preserves
  - substituteViewToken resets VIEW_TOKEN_RE.lastIndex BEFORE .test() to defend against /g state leak across calls
  - S7 plan-time test expectation corrected: backslash adjacent to brace (`\{view\}`) breaks the regex match (plan claimed it would still match) — locked actual behaviour + S7b added for surrounding-context match
  - N3 truncation test: cannot use indexOf("_d") because "_kbi_dv_u" prefix already contains "_d"; switched to suffix-length slice
  - createOrReplaceMaterialized op typed as KineticaOp (imported from kinetica.ts) instead of bare string — preserves audit-log type safety
metrics:
  duration: 9
  tasks_completed: 3
  files_modified: 3
  files_created: 7
  tests_added: 27
  tests_total_green: 51
  completed: 2026-05-14
---

# Phase 32 Plan 01: dashboard_dynamic_views Table + Helpers + Materialize Retry Extraction Summary

Foundational server primitives for v1.6 Dynamic Views — SQLite schema, three pure helpers, and a shared CREATE OR REPLACE retry helper extracted from POST /api/filter/materialize so Phase 32 Plan 03 can land a second consumer (POST /api/dynamic-view/materialize) without duplicating the TM/SMc:1078 race-recovery pattern.

## Tasks

| Task | Name                                                              | Commit  | Files                                                                                                                                                       |
| ---- | ----------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | dashboard_dynamic_views table + types + CRUD helpers + migration spec | 372810d | kinetica_bi/server/src/db.ts, kinetica_bi/server/src/types.ts, kinetica_bi/server/tests/db.dynamicViewsMigration.spec.ts                                    |
| 2    | substituteViewToken + buildDynamicViewName pure helpers (TDD)     | 5b468b3 | kinetica_bi/server/src/lib/dynamicViewSql.ts, kinetica_bi/server/src/lib/dynamicViewName.ts, kinetica_bi/server/tests/lib.dynamicViewSql.spec.ts, kinetica_bi/server/tests/lib.dynamicViewName.spec.ts |
| 3    | createOrReplaceMaterialized helper + refactor POST /api/filter/materialize (TDD) | bf2c2e2 | kinetica_bi/server/src/lib/materializedView.ts, kinetica_bi/server/src/index.ts, kinetica_bi/server/tests/lib.materializedView.spec.ts                     |

## What landed

- **SQLite table `dashboard_dynamic_views`** — 9 columns (id, dashboard_id FK→dashboards, source_table_id FK→tables, name, template_sql, max_records DEFAULT 100000, columns_json, created_at, updated_at) + per-dashboard index. ON DELETE CASCADE from both parent FKs.
- **DashboardDynamicView TS type** in types.ts — JSON-decoded `columns_json: {name,type}[] | null`.
- **5 CRUD helpers** in db.ts: list / get / create / update / delete. Same JSON-on-write / JSON-on-read shape as `dashboard_layers`. `update` uses `"key" in attrs` discriminant for `columns_json` so `null` clears while key-omission preserves.
- **`substituteViewToken`** (pure module) — regex `/\{\s*view\s*\}/gi`, throws `MissingViewTokenError` (instanceof Error) on absence, replaces ALL occurrences. lastIndex reset BEFORE .test() defends against /g state leak.
- **`buildDynamicViewName`** (pure module) — composes `_kbi_dv_u<sanitizedUserId>_d<dashboardId>_<dynamicViewId>` reusing `sanitizeForViewName` from viewNaming.ts (single source of truth for the sanitization rule).
- **`createOrReplaceMaterialized`** (shared helper) — emits `CREATE OR REPLACE MATERIALIZED VIEW <view> AS (<sqlBody>) USING TABLE PROPERTIES (TTL = <ttl>)`. On `TM/SMc:1078` OR `Could not find the table` error: retries with `DROP TABLE IF EXISTS <view>` then plain `CREATE MATERIALIZED VIEW`. Non-matching errors propagate. `route` + `op` flow into the kineticaSql audit on every call.
- **POST /api/filter/materialize refactored** — 37-line inline try/catch replaced with an 8-line `await createOrReplaceMaterialized({...})`. Contract preserved (24 existing supertest cases still green).

## Test coverage delta

| Spec file                                            | Tests | Status  |
| ---------------------------------------------------- | ----- | ------- |
| tests/db.dynamicViewsMigration.spec.ts (NEW)         | 5     | passing |
| tests/lib.dynamicViewSql.spec.ts (NEW)               | 10    | passing |
| tests/lib.dynamicViewName.spec.ts (NEW)              | 6     | passing |
| tests/lib.materializedView.spec.ts (NEW)             | 6     | passing |
| tests/routes.filter-materialize.spec.ts (preserved)  | 24    | passing |
| **Plan-scoped total**                                | **51**| **green** |

Note: a full `vitest run` from the server directory reports a number of pre-existing failures in unrelated test files (`auth.oidc.spec.ts`, `auth.routes.spec.ts`, `bootstrap.spec.ts`, `boot.wipe.spec.ts`, `routes.wms.spec.ts`, etc.). These failures are present on the baseline commit (HEAD~3) and are NOT caused by this plan. Verified by stashing all this plan's working changes and re-running `tests/auth.oidc.spec.ts` — 27 still failed on the bare baseline. These belong to a separate stabilization effort and are out of scope per the deviation-rules SCOPE BOUNDARY clause.

`npx tsc --noEmit` from `kinetica_bi/server/` exits 0 — no new type errors.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] SQL comment containing backticks broke the template literal**
- **Found during:** Task 1 first vitest run (parse error on db.ts:100)
- **Issue:** The plan-supplied SQL comment block used backticks around identifiers (`` `columns_json` ``, `` `name` ``, `` `buildDynamicViewName()` ``) inside the `SCHEMA_DDL` template literal. Backticks inside a template literal terminate the literal, producing a TypeScript parse error at boot.
- **Fix:** Removed the surrounding backticks from the 4 comment lines (kept the column names as bare identifiers — SQLite doesn't care, the comment is for humans).
- **Files modified:** kinetica_bi/server/src/db.ts
- **Commit:** 372810d

**2. [Rule 1 — Bug] Plan S7 test premise was incorrect**
- **Found during:** Task 2 first GREEN run
- **Issue:** The plan claimed `substituteViewToken('SELECT * FROM \{view\}', 'foo')` would still match the regex and produce `'SELECT * FROM \foo\'`. It does not: the regex `/\{\s*view\s*\}/` requires `{`, then `\s*`, then `view`, then `\s*`, then `}` — a literal backslash between `view` and `}` is non-whitespace and breaks the match.
- **Fix:** Reframed Test S7 to assert `MissingViewTokenError` is thrown (which is the actual behaviour and is also the safer semantic — the operator would have been silently no-op'd otherwise). Added S7b to cover the original plan intent (surrounding non-whitespace context that is NOT immediately adjacent to braces still matches: `(SELECT * FROM {view})` → `(SELECT * FROM foo)`).
- **Files modified:** kinetica_bi/server/tests/lib.dynamicViewSql.spec.ts
- **Commit:** 5b468b3
- **Notes:** This is a test-spec correction; the helper module itself is exactly as planned.

**3. [Rule 1 — Bug] Plan N3 test used an ambiguous separator-finding scheme**
- **Found during:** Task 2 first GREEN run
- **Issue:** The N3 truncation test sliced `out.indexOf("_d")` to locate the boundary between the userId segment and the `_d<dashboardId>_<dynamicViewId>` suffix. But the prefix `_kbi_dv_u` itself contains `_d` (positions 4-5), so `indexOf` returned 4 and the userSegment slice was empty.
- **Fix:** Switched to suffix-length slice (the suffix for `d=1, id=1` is exactly `_d1_1`, 5 chars) so the userId segment is `out.slice(9, out.length - 5)`.
- **Files modified:** kinetica_bi/server/tests/lib.dynamicViewName.spec.ts
- **Commit:** 5b468b3

### Out-of-scope discoveries

None deferred. The pre-existing test failures in `auth.oidc.spec.ts` / `auth.routes.spec.ts` / `bootstrap.spec.ts` / `routes.wms.spec.ts` are noted above but explicitly out of scope per SCOPE BOUNDARY rule — they exist on the baseline commit independent of this plan.

## Hand-off pointers for Plans 02 + 03

**For Plan 02 (CRUD endpoints):**
- Import `listDashboardDynamicViews`, `getDashboardDynamicView`, `createDashboardDynamicView`, `updateDashboardDynamicView`, `deleteDashboardDynamicView` from `./db`.
- Import `substituteViewToken` + `MissingViewTokenError` from `./lib/dynamicViewSql` for validating the create / update payloads (`POST` and `PUT` should both return 400 when the helper throws).
- `DashboardDynamicView.columns_json` is `{ name: string; type: string }[] | null` — null means "never previewed yet"; Plan 02 update endpoint must clear it when `template_sql` changes (CONTEXT.md § D3). The helper `updateDashboardDynamicView` accepts an explicit `columns_json: null` to clear; pass that branch when `attrs.template_sql !== existing.template_sql`.
- `name` is currently unconstrained (no UNIQUE index per dashboard yet). Plan 02 must add the application-level uniqueness check (or a partial UNIQUE index) per CONTEXT.md "name is unique per dashboard". A future migration can lift this — leaving it to Plan 02 keeps Plan 01 deletion-safe.

**For Plan 03 (preview / materialize / delete):**
- Import `buildDynamicViewName({ userId, dashboardId, dynamicViewId })` from `./lib/dynamicViewName` to compute the Kinetica view name.
- Import `createOrReplaceMaterialized` from `./lib/materializedView`. Pass `route: "POST /api/dynamic-view/materialize"`, `op: "MATERIALIZE"`, `ttl: 5` (CONTEXT.md § D6), and `sqlBody` should be the `substituteViewToken`-resolved template (NOT a wrapping `SELECT * FROM (...)` — the helper already wraps in parens).
- For DELETE: use `await kineticaSql(req, \`DROP TABLE IF EXISTS ${dynamicViewName}\`, ...)` directly, then `deleteDashboardDynamicView(id)`. No retry helper needed for plain DROP.

## Self-Check: PASSED
- `kinetica_bi/server/src/lib/dynamicViewSql.ts` — FOUND
- `kinetica_bi/server/src/lib/dynamicViewName.ts` — FOUND
- `kinetica_bi/server/src/lib/materializedView.ts` — FOUND
- `kinetica_bi/server/tests/db.dynamicViewsMigration.spec.ts` — FOUND
- `kinetica_bi/server/tests/lib.dynamicViewSql.spec.ts` — FOUND
- `kinetica_bi/server/tests/lib.dynamicViewName.spec.ts` — FOUND
- `kinetica_bi/server/tests/lib.materializedView.spec.ts` — FOUND
- commit 372810d — FOUND
- commit 5b468b3 — FOUND
- commit bf2c2e2 — FOUND
