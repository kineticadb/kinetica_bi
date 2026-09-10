---
phase: 19-config-schema
plan: "01"
subsystem: server-db
tags: [schema-migration, sqlite, crud, typescript, config-v14]
dependency_graph:
  requires: []
  provides: [CONFIG-V14-01]
  affects: [Phase 21 popup, Phase 22 UI, Phase 23 Info Card]
tech_stack:
  added: []
  patterns: [PRAGMA-guarded-ALTER-migration, in-attrs-discriminant-for-null-clearing]
key_files:
  created: []
  modified:
    - kinetica_bi/server/src/db.ts
    - kinetica_bi/server/src/types.ts
    - kinetica_bi/server/src/index.ts
    - kinetica_bi/server/tests/db.smoke.spec.ts
decisions:
  - "updateDashboardLayer uses '\"key\" in attrs' discriminant (not ??) so callers can explicitly set info_columns/info_template back to null — ?? treats null as coalescing trigger and silently ignores it"
  - "info_* columns inserted before created_at/updated_at in CREATE TABLE so fresh-install column order matches migration column order"
  - "PATCH /api/dashboards/:id/layers/:layerId keeps pass-through pattern with no validation — Phase 22 validates"
metrics:
  duration: ~15min (resumed from crash after partial worktree changes)
  completed: "2026-05-08"
  tasks_completed: 2
  files_modified: 4
---

# Phase 19 Plan 01: Schema Migration Summary

**One-liner:** SQLite `dashboard_layers` extended with `info_enabled/info_columns/info_template` via PRAGMA-guarded idempotent ALTER migration; full CRUD pipeline wired end-to-end for CONFIG-V14-01.

## What Was Built

### 1. SCHEMA_DDL Extension (db.ts lines 80-97)

`dashboard_layers` CREATE TABLE now includes 3 new columns inline so fresh installs get them without any ALTER:

```sql
info_enabled INTEGER NOT NULL DEFAULT 1,   -- opt-in by default; existing rows gain 1
info_columns TEXT,                          -- nullable; JSON-array string; NULL = all columns
info_template TEXT,                         -- nullable; raw HTML; NULL = key-value table
```

Columns inserted before `created_at/updated_at` so the order matches what the PRAGMA-guarded ALTER produces on existing deployments.

### 2. PRAGMA-Guarded ALTER Block (db.ts lines 131-153)

Mirrors the v1.0→v1.1 sessions migration pattern at lines 106-130 verbatim:

```typescript
const layerCols = instance
  .prepare("PRAGMA table_info(dashboard_layers)")
  .all() as Array<{ name: string }>;
const layerColNames = new Set(layerCols.map((c) => c.name));
if (!layerColNames.has("info_enabled")) { instance.exec("ALTER TABLE..."); }
if (!layerColNames.has("info_columns"))  { instance.exec("ALTER TABLE..."); }
if (!layerColNames.has("info_template")) { instance.exec("ALTER TABLE..."); }
```

Runs at boot inside `createDb`, before `app.listen`. Idempotent on re-boot (guarded by `!has`). Pre-v1.4 layer rows gain `info_enabled=1` via DEFAULT, `info_columns=null`, `info_template=null`.

### 3. DashboardLayer TS Type Extension (types.ts lines 51-58)

```typescript
info_enabled: number;        // SQLite INTEGER NOT NULL DEFAULT 1; 0|1 semantics
info_columns: string | null; // raw JSON-array string; null = all columns
info_template: string | null; // raw HTML; null = default key-value table
```

Phase 22 UI will validate/type-narrow these. Phase 19 keeps raw SQLite shapes.

### 4. mapDashboardLayer Update (db.ts lines 179-193)

Three new fields surfaced from SQLite row into `DashboardLayer` DTO. `info_columns ?? null` and `info_template ?? null` normalize SQLite's `undefined` for missing column to `null` for TS consumers.

### 5. updateDashboardLayer Update (db.ts lines 452-474)

- `Pick<DashboardLayer, ...>` widened with `"info_enabled" | "info_columns" | "info_template"`
- `UPDATE` SQL extended with `info_enabled = ?, info_columns = ?, info_template = ?`
- **Key decision:** uses `"key" in attrs ? attrs.key : existing.key` instead of `attrs.key ?? existing.key` because `null ?? existing` returns `existing`, making it impossible to clear a field back to `null`. The `"in"` discriminant correctly distinguishes "key absent (use existing)" from "key present as null (clear to null)".

### 6. PATCH Route Widening (index.ts lines 572-581)

`DashboardLayer` imported; PATCH body typed as `Partial<Pick<DashboardLayer, "table_id" | "position" | "config" | "info_enabled" | "info_columns" | "info_template">>`. No new validation — pass-through pattern per Phase 22 scope lock.

### 7. db.smoke.spec.ts (tests/db.smoke.spec.ts)

4 new `it()` blocks appended inside existing `describe("db.ts module shape (Wave 0)")`:

- **Test A** "creates dashboard_layers table with v1.4 info popup columns" — fresh-install schema has 11 columns in locked order; info_enabled is INTEGER NOT NULL DEFAULT 1; info_columns/info_template are TEXT NULL.
- **Test B** "v1.3 → v1.4 migration: createDb adds... preserves pre-existing rows" — builds 8-col v1.3 DB, inserts row, applies migration block, asserts 11 cols + row preserved with info_enabled=1.
- **Test C** "v1.3 → v1.4 migration is idempotent" — runs ALTER block twice on already-migrated DB, asserts no throw and no duplicate columns.
- **Test D** "mapDashboardLayer projects info_enabled / info_columns / info_template" — round-trips via `updateDashboardLayer` (set→reset to null), proves `"key" in attrs` correctly clears fields.

**Result: 11/11 tests pass (7 pre-existing + 4 new).**

## Migration Safety Attestation

Pre-v1.4 layer rows survive the migration with `info_enabled=1`, `info_columns=null`, `info_template=null`. Migration is idempotent on re-boot (PRAGMA-guarded BEFORE-ALTER). Server boot does not fail on a real on-disk database with pre-existing v1.2/v1.3 layer rows.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] updateDashboardLayer ?? vs "in" discriminant for nullable fields**
- **Found during:** Test D of db.smoke.spec.ts execution
- **Issue:** Initial implementation used `attrs.info_columns ?? existing.info_columns`. Since `null ?? x` returns `x`, callers passing explicit `null` to clear a field had their value silently ignored — the old value was preserved instead.
- **Fix:** Replaced `??` with `"info_columns" in attrs ? attrs.info_columns : existing.info_columns` for all three info_* fields. This correctly distinguishes `undefined` (key absent — keep existing) from `null` (key present — clear to null).
- **Files modified:** `kinetica_bi/server/src/db.ts` (lines 468-471)
- **Commit:** 0aa3bd4

## Commits

| Hash | Message |
|------|---------|
| 8bbdb6d | test(19-01): add v1.3→v1.4 dashboard_layers migration spec |
| 0aa3bd4 | feat(19-01): PRAGMA-guarded migration + CRUD wiring + PATCH route for info_* columns |

## tsc Status

`cd kinetica_bi/server && npx tsc --noEmit` — CLEAN (exit 0, no output).

## Self-Check: PASSED

- [x] kinetica_bi/server/src/db.ts — exists, modified
- [x] kinetica_bi/server/src/types.ts — exists, modified
- [x] kinetica_bi/server/src/index.ts — exists, modified
- [x] kinetica_bi/server/tests/db.smoke.spec.ts — exists, modified
- [x] Commits 8bbdb6d and 0aa3bd4 — verified in git log
- [x] 11/11 tests passing — verified via vitest run
- [x] tsc --noEmit clean — verified
- [x] .db-shm and .db-wal NOT committed — confirmed (not staged)
