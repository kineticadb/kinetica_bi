---
phase: 81-brand-config-server-foundation
plan: 01
subsystem: database
tags: [sqlite, better-sqlite3, rbac, permissions, brand-config]

# Dependency graph
requires: []
provides:
  - brand_config singleton SQLite table (id=1 CHECK, config_json TEXT blob, logo_data/mime/updated_at, updated_at, updated_by) in SCHEMA_DDL
  - INSERT OR IGNORE brand_config seed after seedRbac in createDb() — idempotent on restart
  - BRANDING_MANAGE: "branding:manage" 18th permission constant in server permissions.ts
  - byte-parity BRANDING_MANAGE: "branding:manage" mirror in web permissions.ts
  - lib.permissions.spec.ts locked at 18 with branding:manage assertion
affects: [81-02, 81-03, 82]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "brand_config singleton table follows column_display_config (v1.15) JSON-blob pattern: config_json TEXT blob + CHECK(id=1) + INSERT OR IGNORE seed"
    - "New permission follows dashboards:manage_access (v1.10) 3-file pattern: server permissions.ts -> web permissions.ts (byte-parity); rbacSeed.ts unchanged (auto via DEFAULT_ROLE_MAPPINGS)"

key-files:
  created: []
  modified:
    - packages/server/src/db.ts
    - packages/server/src/lib/permissions.ts
    - packages/web/src/lib/permissions.ts
    - packages/server/tests/lib.permissions.spec.ts

key-decisions:
  - "brand_config is a NEW v1.16 table — CREATE TABLE IF NOT EXISTS is sufficient; no ALTER/PRAGMA migration block needed"
  - "BRANDING_MANAGE granted to admin only (via [...ALL_PERMISSIONS] auto-inclusion); designer/user_admin/analyst explicit lists untouched — branding is operator/admin-level only"
  - "branding:manage string is byte-identical in server + web permissions.ts (BYTE-PARITY enforced)"

patterns-established:
  - "Singleton table pattern: CHECK(id=1) + INSERT OR IGNORE (id) VALUES (1) seed in createDb() after seedRbac"
  - "18th permission pattern: append to PERMISSIONS const only; ALL_PERMISSIONS + DEFAULT_ROLE_MAPPINGS.admin include it automatically"

requirements-completed: [BRANDFND-01, BRANDFND-02]

# Metrics
duration: 2min
completed: 2026-06-24
---

# Phase 81 Plan 01: Brand Config Server Foundation Summary

**brand_config singleton SQLite table + seed + branding:manage 18th RBAC permission wired across server and web, spec locked at 18 tests green**

## Performance

- **Duration:** 2 min
- **Started:** 2026-06-24T16:32:09Z
- **Completed:** 2026-06-24T16:35:05Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- `brand_config` singleton table landed in `SCHEMA_DDL` following the `column_display_config` (v1.15) JSON-blob pattern: `id CHECK(id=1)`, `config_json TEXT DEFAULT '{}'`, logo columns, timestamps
- `INSERT OR IGNORE INTO brand_config (id) VALUES (1)` seed in `createDb()` after `seedRbac` — idempotent, in-memory createDb confirms id=1 row with config_json='{}'
- `BRANDING_MANAGE: "branding:manage"` added as 18th entry to both server and web `permissions.ts` (byte-parity); `ALL_PERMISSIONS` and `DEFAULT_ROLE_MAPPINGS.admin` include it automatically; designer/user_admin/analyst unchanged
- `lib.permissions.spec.ts` updated to lock catalog at 18, all 18 tests green; server and web tsc clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Add brand_config DDL to SCHEMA_DDL + seed in createDb()** - `8e41cea` (feat)
2. **Task 2: Add BRANDING_MANAGE 18th permission to server + web permissions.ts** - `2d2012a` (feat)
3. **Task 3: Bump lib.permissions.spec.ts catalog lock from 17 to 18** - `8a6c4f2` (test)

## Files Created/Modified
- `packages/server/src/db.ts` - Added brand_config DDL block after column_display_config; added INSERT OR IGNORE seed after seedRbac
- `packages/server/src/lib/permissions.ts` - BRANDING_MANAGE 18th entry; comment updated 17->18; admin comment updated
- `packages/web/src/lib/permissions.ts` - byte-parity BRANDING_MANAGE 18th entry
- `packages/server/tests/lib.permissions.spec.ts` - catalog count lock 17->18; EXPECTED_PERMISSION_STRINGS + EXPECTED_ADMIN_PERMS extended; new branding:manage assertion; designer/user_admin/analyst locks unchanged

## Decisions Made
- `brand_config` is a brand-new v1.16 table — `CREATE TABLE IF NOT EXISTS` is sufficient; no PRAGMA-guarded ALTER block added (follows RESEARCH.md Pitfall 4)
- `BRANDING_MANAGE` granted to admin only via `[...ALL_PERMISSIONS]` auto-inclusion; explicit designer/user_admin/analyst lists not modified per locked architectural decision
- `rbacSeed.ts` left entirely unchanged — it iterates `DEFAULT_ROLE_MAPPINGS` automatically

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `brand_config` table + seed are in place; `BRANDING_MANAGE` constant is importable from both server and web
- Plan 81-02 can now add the 4 API routes (`GET /api/branding`, `PUT /api/branding`, `POST /api/branding/logo`, `GET /api/branding/logo`) gated by `requirePermission(PERMISSIONS.BRANDING_MANAGE)`
- Plan 81-03 can implement the PostCSS CSS sanitizer and wire it into `PUT /api/branding`

---
*Phase: 81-brand-config-server-foundation*
*Completed: 2026-06-24*
