---
phase: 75-column-display-config-foundation
plan: 01
subsystem: database
tags: [sqlite, better-sqlite3, express, supertest, vitest, crud, permissions, rbac]

# Dependency graph
requires:
  - phase: none (first plan in Phase 75)
    provides: N/A
provides:
  - column_display_config SQLite table with composite PK (table_id, column_name)
  - ColumnDisplayConfigRow type in packages/server/src/types.ts
  - CRUD helpers exported from db.ts: listColumnDisplayConfig, getColumnDisplayConfig, upsertColumnDisplayConfig, deleteColumnDisplayConfig
  - GET /api/tables/:tableId/column-display-config (requireAuth, ungated)
  - PUT /api/tables/:tableId/column-display-config/:columnName (datasets:manage)
  - DELETE /api/tables/:tableId/column-display-config/:columnName (datasets:manage)
  - Supertest spec with 10 passing tests
affects:
  - 75-02 (formatter lib — no dependency on server endpoints)
  - 75-03 (client store — fetches from the locked table-scoped URL shape)
  - 76 (editor UI — writes via PUT/DELETE endpoints)
  - 77 (render surfaces — reads via GET endpoint via client store)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - JSON-in-TEXT for format_spec (mirrors dashboard_dynamic_views.columns_json)
    - ON CONFLICT(table_id, column_name) DO UPDATE for per-column upsert idempotency
    - requirePermission(PERMISSIONS.DATASETS_MANAGE) spread middleware for write gating
    - requireAuth only (no requirePermission) for ungated read endpoints

key-files:
  created:
    - packages/server/tests/routes.column-display-config.spec.ts
  modified:
    - packages/server/src/db.ts
    - packages/server/src/types.ts
    - packages/server/src/index.ts

key-decisions:
  - "Endpoint URL shape locked as table-scoped: /api/tables/:tableId/column-display-config (not /api/column-display-config/:tableId)"
  - "ColumnDisplayConfigRow type lives in types.ts (matches DashboardDynamicView convention)"
  - "format_spec stored as opaque JSON-in-TEXT; server never validates or introspects its shape"
  - "GET read endpoint uses requireAuth (not requirePermission) — any authenticated viewer can read"
  - "CREATE TABLE IF NOT EXISTS — no ALTER migration needed (new table in v1.15)"

patterns-established:
  - "Upsert pattern: INSERT INTO ... ON CONFLICT(table_id, column_name) DO UPDATE SET updated_at = datetime('now')"
  - "Null-guard in mapper: row.format_spec ? JSON.parse(row.format_spec) : null"
  - "Test pattern: seedAnalystSession (no user_roles row) proves 403 for write, 200 for read"

requirements-completed: [COLCFG-V115-01]

# Metrics
duration: 7min
completed: 2026-06-19
---

# Phase 75 Plan 01: Column Display Config Foundation Summary

**SQLite column_display_config table + 4 CRUD helpers + 3 REST endpoints (read ungated, writes datasets:manage gated) + 10 passing supertest cases covering 403-gating, idempotency, and format_spec round-trip**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-06-19T18:09:00Z
- **Completed:** 2026-06-19T18:16:31Z
- **Tasks:** 2
- **Files modified:** 4 (db.ts, types.ts, index.ts, new spec file)

## Accomplishments
- Added `column_display_config` table to SCHEMA_DDL with composite PK `(table_id, column_name)`, `label TEXT`, `format_spec TEXT` (JSON-in-TEXT), `created_at/updated_at`, and an index on `table_id`
- Exported `ColumnDisplayConfigRow` type from `types.ts` with opaque `format_spec: unknown | null`
- Added 4 CRUD helpers to `db.ts`: `listColumnDisplayConfig`, `getColumnDisplayConfig`, `upsertColumnDisplayConfig` (ON CONFLICT … DO UPDATE), `deleteColumnDisplayConfig`
- Wired 3 endpoints into `index.ts` at the locked table-scoped URL shape: GET (requireAuth only), PUT + DELETE (datasets:manage)
- Created `routes.column-display-config.spec.ts` with 10 tests: read-auth modes, 401-no-cookie, 403-write-gating, upsert idempotency, delete-then-404, format_spec deep-equal round-trip — all green

## Task Commits

1. **Task 1: Add column_display_config table + CRUD helpers to db.ts** - `38b6009` (feat)
2. **Task 2: Add 3 CRUD endpoints to index.ts + supertest spec** - `156883f` (feat)

## Files Created/Modified
- `packages/server/src/db.ts` — DDL block added to SCHEMA_DDL; 4 CRUD helpers appended; ColumnDisplayConfigRow imported
- `packages/server/src/types.ts` — ColumnDisplayConfigRow type added
- `packages/server/src/index.ts` — 3 endpoints added after /api/tables block; helpers imported from db
- `packages/server/tests/routes.column-display-config.spec.ts` — New: 10 supertest cases

## Locked Endpoint URL Shape (for Phase 75 Plan 03 client store)
- `GET    /api/tables/:tableId/column-display-config`               — read all rows; requireAuth only
- `PUT    /api/tables/:tableId/column-display-config/:columnName`   — per-column upsert; datasets:manage
- `DELETE /api/tables/:tableId/column-display-config/:columnName`   — per-column delete; datasets:manage

## Exported Helpers from db.ts (for Plan 03 client store)
- `listColumnDisplayConfig(tableId: number): ColumnDisplayConfigRow[]`
- `getColumnDisplayConfig(tableId: number, columnName: string): ColumnDisplayConfigRow | undefined`
- `upsertColumnDisplayConfig(tableId, columnName, label, formatSpec): ColumnDisplayConfigRow`
- `deleteColumnDisplayConfig(tableId, columnName): boolean`

## ColumnDisplayConfigRow Type Location
`packages/server/src/types.ts` — mirrors the `DashboardDynamicView` convention (not co-located in db.ts).

## Decisions Made
- Table-scoped URL shape (`/api/tables/:tableId/...`) over top-level (`/api/column-display-config/:tableId`) — co-locates with existing `/api/tables` routes, matches Plan 03 client store contract
- `ColumnDisplayConfigRow` lives in `types.ts` (not db.ts) — consistent with all other row types in the project
- Server stores `format_spec` as opaque JSON-in-TEXT and never validates or introspects it — `FormatSpec` discriminated union is a web-side type only

## Deviations from Plan
None — plan executed exactly as written.

## Issues Encountered
None.

## Self-Check
- `packages/server/src/db.ts` — FOUND (modified with DDL + helpers)
- `packages/server/src/types.ts` — FOUND (ColumnDisplayConfigRow exported)
- `packages/server/src/index.ts` — FOUND (3 endpoints added)
- `packages/server/tests/routes.column-display-config.spec.ts` — FOUND (new spec)
- Commit `38b6009` — FOUND (Task 1)
- Commit `156883f` — FOUND (Task 2)
- `cd packages/server && npx tsc --noEmit` — CLEAN
- `npx vitest --run tests/routes.column-display-config.spec.ts` — 10/10 PASSED

## Self-Check: PASSED

## Next Phase Readiness
- Phase 75 Plan 02 (pure formatter lib — `columnFormatter.ts`) is independent of server endpoints; can proceed immediately
- Phase 75 Plan 03 (client store + helpers) requires: Plan 02 formatter lib + these server endpoints (both URLs and helper names documented above)
- Phase 76 (editor UI) and Phase 77 (render surfaces) both depend on Plan 01 + Plan 02 + Plan 03

---
*Phase: 75-column-display-config-foundation*
*Completed: 2026-06-19*
