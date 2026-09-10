---
phase: 04-schema-sessionstore-foundation
plan: "01"
subsystem: database
tags: [sqlite, better-sqlite3, schema-migration, sessions, oidc]

# Dependency graph
requires:
  - phase: 01-encrypted-session-store
    provides: createDb factory, sessions table DDL, PRAGMA-guarded ALTER pattern, in-memory test isolation
provides:
  - sessions table with credential_type TEXT NOT NULL DEFAULT 'password' column
  - sessions table with id_token_ciphertext, id_token_iv, id_token_auth_tag BLOB columns
  - PRAGMA-guarded idempotent ALTER TABLE migration block in createDb (v1.0 → v1.1)
  - column-existence smoke test and v1.0 migration regression test in db.smoke.spec.ts
affects:
  - 04-02-sessionstore-api (SessionRow must include credential_type + id_token fields)
  - 04-03-authed-request (AuthedRequest reads credential_type from session row)
  - all Phase 5+ plans (OIDC sessions require these columns to exist)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - PRAGMA table_info guard before idempotent ALTER TABLE ADD COLUMN (boot-time migration)
    - New schema columns appended AFTER existing columns in CREATE TABLE to match ALTER TABLE append semantics

key-files:
  created: []
  modified:
    - kinetica_bi/server/src/db.ts
    - kinetica_bi/server/tests/db.smoke.spec.ts

key-decisions:
  - "4 new columns placed AFTER expires_at in CREATE TABLE so fresh-install and v1.0-migrated DBs share identical PRAGMA column order"
  - "Separate ALTER per column (not combined) for idempotent control flow clarity — each column guarded independently"
  - "Migration test uses verbatim duplicate of migration logic (not extracting a migrateSessionsToV1_1 helper) — acceptable drift risk for targeted M-02 regression coverage; refactor deferred"

patterns-established:
  - "Boot-time migration: PRAGMA table_info check + idempotent ALTER TABLE ADD COLUMN inside createDb, runs after exec(SCHEMA_DDL)"
  - "Column append order: new v1.1 columns always at END of CREATE TABLE definition to match ALTER TABLE ADD COLUMN semantics"

requirements-completed: [MODE-02, MODE-03, MODE-06]

# Metrics
duration: 3min
completed: 2026-04-30
---

# Phase 4 Plan 01: Schema + SessionStore Foundation Summary

**Sessions table extended with credential_type DEFAULT 'password' + 3 encrypted id_token BLOB columns, with PRAGMA-guarded boot-time migration for v1.0 deployments and full regression test coverage**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-30T15:20:09Z
- **Completed:** 2026-04-30T15:22:28Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Extended SCHEMA_DDL CREATE TABLE sessions with 4 new v1.1 columns (credential_type, id_token_ciphertext, id_token_iv, id_token_auth_tag) appended after expires_at — matching the order ALTER TABLE ADD COLUMN produces on a v1.0 DB
- Added PRAGMA-guarded migration block in createDb: checks PRAGMA table_info(sessions) and issues idempotent ALTER TABLE ADD COLUMN statements for each missing column, running at boot before app.listen (resolves PITFALLS I-02 and M-02)
- Extended db.smoke.spec.ts: updated 9-column order assertion to 13, added credential_type/id_token_* column-existence smoke test, and added v1.0 → v1.1 migration test with pre-existing row preservation verification

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend SCHEMA_DDL + add PRAGMA-guarded ALTER TABLE migration block in db.ts** - `a613d6a` (feat)
2. **Task 2: Extend db.smoke.spec.ts with column-existence + v1.0 migration tests** - `dcd63df` (test)

**Plan metadata:** (docs commit follows)

_Note: TDD tasks — Task 1 was GREEN for new behavior (Task 2 updated assertion was the failing RED test); Task 2 brought all tests back to GREEN with 2 new tests added._

## Files Created/Modified
- `kinetica_bi/server/src/db.ts` - Extended SCHEMA_DDL + createDb migration block
- `kinetica_bi/server/tests/db.smoke.spec.ts` - Updated column-order assertion + 2 new v1.1 tests

## Decisions Made
- 4 new columns appended AFTER expires_at in CREATE TABLE to align with ALTER TABLE ADD COLUMN append semantics — ensures PRAGMA column order is identical between fresh installs and migrated v1.0 DBs
- Separate ALTER TABLE statement per column (not one combined block) for clean, individually-guarded idempotent control flow
- Migration block verbatim-duplicated in test rather than extracting a named export — acceptable for this phase; reduces scope of Task 1 to a single-file change

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Foundation complete: sessions table has credential_type and id_token_* columns in both fresh-install and migrated-DB cases
- Plan 04-02 (SessionStore API) can now extend SessionRow type and createSession/getSession to read/write the new columns
- Plan 04-03 (AuthedRequest) can extend AuthedRequest with credentialType field
- All existing v1.0 tests pass unchanged (213 passing, 1 skipped across 18 test files)

---
*Phase: 04-schema-sessionstore-foundation*
*Completed: 2026-04-30*
