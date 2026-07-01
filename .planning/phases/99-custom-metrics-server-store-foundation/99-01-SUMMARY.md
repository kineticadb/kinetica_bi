---
phase: 99-custom-metrics-server-store-foundation
plan: "01"
subsystem: server
tags: [custom-metrics, sqlite, rbac, crud, supertests]
dependency_graph:
  requires: []
  provides:
    - custom_metrics SQLite table (DDL + UNIQUE constraint + index)
    - CustomMetricRow server type
    - listCustomMetrics / getCustomMetric / createCustomMetric / updateCustomMetric / deleteCustomMetric
    - GET /api/tables/:tableId/custom-metrics (requireAuth ungated)
    - POST /api/tables/:tableId/custom-metrics (datasets:manage)
    - PUT /api/tables/:tableId/custom-metrics/:id (datasets:manage, existence-check semantics)
    - DELETE /api/tables/:tableId/custom-metrics/:id (datasets:manage)
  affects:
    - packages/server/src/db.ts
    - packages/server/src/types.ts
    - packages/server/src/index.ts
tech_stack:
  added: []
  patterns:
    - column_display_config precedent (v1.15) for DDL/CRUD/map shape
    - existence-check semantics in updateCustomMetric (NOT result.changes) for no-op-save -> 200
    - id-keyed POST create / PUT:id / DELETE:id (deliberate divergence from composite-key upsert)
    - SQLITE_CONSTRAINT startsWith catch -> 409 in route layer (db layer does NOT swallow)
key_files:
  created:
    - packages/server/tests/routes.custom-metrics.spec.ts
  modified:
    - packages/server/src/db.ts
    - packages/server/src/types.ts
    - packages/server/src/index.ts
decisions:
  - id-keyed (AUTOINCREMENT PK) chosen over composite-key upsert so Phase 100 widget references survive label/expression edits
  - No new RBAC permission — writes reuse PERMISSIONS.DATASETS_MANAGE (18-entry catalog preserved)
  - Existence-check semantics in updateCustomMetric: getCustomMetric(id) before UPDATE, return fresh row — a no-op save (same values, SQLite changes:0) correctly returns 200 not 404
  - Route layer catches SQLITE_CONSTRAINT -> 409; db layer lets constraint violations propagate
  - format_spec stored as JSON-as-TEXT (NULL = no format), decoded on read with null-guard (row.format_spec ? JSON.parse(...) : null)
metrics:
  duration: "343s (~6 min)"
  completed_date: "2026-07-01T00:23:37Z"
  tasks_completed: 3
  files_modified: 4
---

# Phase 99 Plan 01: Custom Metrics Server + Store Foundation Summary

**One-liner:** SQLite `custom_metrics` table with id-keyed CRUD (GET ungated, writes `datasets:manage`), 23-test dual-auth-mode supertest suite, and permission-catalog byte-parity assertion.

## Route Shape (for 99-02 client API to mirror)

| Verb | Path | Auth | Success | Errors |
|------|------|------|---------|--------|
| GET | `/api/tables/:tableId/custom-metrics` | requireAuth | 200 `{ data: CustomMetricRow[] }` | 401 no cookie |
| POST | `/api/tables/:tableId/custom-metrics` | datasets:manage | 201 `CustomMetricRow` | 400 empty label/expr, 409 duplicate label, 403 analyst |
| PUT | `/api/tables/:tableId/custom-metrics/:id` | datasets:manage | 200 `CustomMetricRow` | 400 empty, 404 missing id, 409 rename-to-existing, 403 analyst |
| DELETE | `/api/tables/:tableId/custom-metrics/:id` | datasets:manage | 204 | 404 missing id, 403 analyst |

**Key invariant — no-op save:** PUT with the same label + expression for an existing id returns 200 (not 404). `updateCustomMetric` gates the 404 on row existence (`getCustomMetric(id)` check), NOT on `result.changes` — because SQLite reports `changes:0` for an identical update.

## CustomMetricRow Fields

```typescript
{
  id: number;           // opaque autoincrement PK — stable across label/expression edits
  table_id: number;     // foreign reference to tables.id (not FK-enforced)
  label: string;        // unique per table_id (UNIQUE constraint -> 409 on duplicate)
  expression: string;   // raw SQL aggregate — emitted directly into SELECT (Phase 100 responsibility)
  format_spec: unknown | null;  // opaque JSON (FormatSpec on web side); null = no format
  created_at: string;   // ISO datetime string (SQLite datetime('now'))
  updated_at: string;   // updated on every PUT
}
```

## DDL Summary

```sql
CREATE TABLE IF NOT EXISTS custom_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  expression TEXT NOT NULL,
  format_spec TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(table_id, label)
);
CREATE INDEX IF NOT EXISTS idx_custom_metrics_table_id ON custom_metrics (table_id);
```

## Set-Based Gate Result

- New spec `routes.custom-metrics.spec.ts`: **23/23 tests pass** in isolation.
- Full suite failing files (pre-existing TD-V16-TEST-ISOLATION cross-mode contamination): auth.oidc.spec.ts, auth.routes.spec.ts, boot.hardening.spec.ts, boot.wipe.spec.ts, bootstrap.spec.ts, db.smoke.spec.ts, kinetica.creds.routes.spec.ts, oidc.module.spec.ts, routes.dynamic-view.spec.ts, routes.filter-materialize-dv.spec.ts, routes.filter-materialize.spec.ts, routes.wms.spec.ts — all pre-existing, none introduced by this plan.
- `routes.custom-metrics.spec.ts` is NOT in the failing set.
- Server `tsc --noEmit`: clean.
- Permission catalog: 18 entries, unchanged, no custom-metrics-specific permission string.

## Task Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 — DDL + CRUD + type | bb6a1b1 | custom_metrics DDL + CRUD/map DB functions + CustomMetricRow type |
| 2 — Routes | cf9809a | CRUD routes (GET ungated; POST/PUT/DELETE datasets:manage) |
| 3 — Supertests | 42a1d6e | Dual-auth-mode supertests + permission-catalog parity assertion |

## Deviations from Plan

None — plan executed exactly as written. The backtick-in-template-string issue in the SCHEMA_DDL SQL comment (which would have caused tsc errors) was caught and fixed during Task 1 before commit — within the auto-fix scope of that task.

## Self-Check: PASSED

- packages/server/src/db.ts: FOUND (modified)
- packages/server/src/types.ts: FOUND (modified)
- packages/server/src/index.ts: FOUND (modified)
- packages/server/tests/routes.custom-metrics.spec.ts: FOUND (created)
- Commit bb6a1b1: FOUND
- Commit cf9809a: FOUND
- Commit 42a1d6e: FOUND
