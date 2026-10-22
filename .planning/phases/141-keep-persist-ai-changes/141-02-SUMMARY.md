---
phase: 141-keep-persist-ai-changes
plan: 02
subsystem: server-db
tags: [sqlite, triggers, optimistic-concurrency]
requires: []
provides: [dashboards.version, getDashboardVersion]
affects: [141-05, 141-06]
key-files:
  modified: [packages/server/src/db.ts]
  created: [packages/server/tests/db.dashboardVersion.spec.ts]
requirements-completed: []
gaps: []
metrics:
  completed: 2026-10-21
---

# Phase 141 Plan 02: Dashboard version counter Summary

`dashboards.version` is bumped by 12 SQLite `kbi_ver_*` triggers (insert/update/delete on widgets, dashboard_layers, dashboard_dynamic_views, dashboard_tables) plus `updateDashboard`, read via `getDashboardVersion(id)`. The DTO is unchanged.

## RED (before implementation, stub returning undefined)
`Test Files 1 failed (1) / Tests 8 failed | 2 passed (10)`. The 2 that passed trivially did not depend on the version value. After implementing: 10/10 passed.

## Ripple sweep
42 files: `grep -rlE "FROM dashboards|table_info\(dashboards\)|sqlite_master" tests` plus `tests/db.*.spec.ts`, `lib.dashboardImport*`, `lib.dashboardExport*`, run with `--maxWorkers=4`.
- First run: 9 failures, mostly TTL assertions (routes.filter-materialize and others), caused by the dev .env leak. Rerun with `DEFAULT_VIEW_TTL_MINUTES=5`: 3 failures left.
- `db.smoke.spec.ts` (2 tests): known-failing, untouched.
- `layers.spec.ts` (1 test): passes in isolation (23/23), so it is cross-mode contamination (TD-V16-TEST-ISOLATION).
- No spec needed editing. `npx tsc --noEmit` is clean.

## Deviations
None. Note: DVER-5's duplicate-add (INSERT OR IGNORE) leaves the version unchanged, as the plan expected.
