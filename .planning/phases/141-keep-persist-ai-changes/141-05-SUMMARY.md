---
phase: 141-keep-persist-ai-changes
plan: 05
subsystem: server-routes
tags: [express, cors, optimistic-concurrency, version-stamp]
requires: [141-01, 141-02]
provides: [stampWrite, stampRead, X-Kbi-Dashboard-Version headers, WRITE_ROUTE_CLASSIFICATION]
affects: [141-06, 141-12]
key-files:
  created: [packages/server/src/lib/dashboardVersion.ts, packages/server/tests/routes.versionStamp.spec.ts]
  modified: [packages/server/src/index.ts]
requirements-completed: []
gaps: []
metrics:
  completed: 2026-10-21
---

# Phase 141 Plan 05: Version stamps on dashboard writes and list reads Summary

`stampWrite` reads `getDashboardVersion` before and after a synchronous db call and sets `X-Kbi-Dashboard-Version: <id>:<before>:<after>`. `stampRead` sets `X-Kbi-Dashboard-Version-Read` on the four list GETs (widgets, layers, tables, dynamic-views). cors `exposedHeaders` lists exactly those two headers. Response bodies and status codes are unchanged.

## Commits
- 717acc8 feat: lib/dashboardVersion.ts, 13 stamped write routes, 4 stamped list GETs, cors exposure, VSTAMP-1..7
- 7e293f8 test: VSTAMP-8..10 route classification (58 non-GET routes: 13 stamped, 45 exempt with a reason)

## RED (before implementation, stubbed stampWrite/stampRead, no exposedHeaders)
Task 1: `Tests 6 failed | 1 passed (7)`. The one pass was VSTAMP-5 (404 has no header), which holds trivially.
Task 2: `Tests 2 failed | 8 passed (10)` with the map empty. VSTAMP-8 listed 58 unclassified routes and VSTAMP-9 failed. VSTAMP-10 passes vacuously on an empty map.
After implementation: 10/10 pass. `npx tsc --noEmit` is clean.

## Discriminating check (Task 2)
Removed the `stampWrite` from `DELETE /api/widgets/:id` only. VSTAMP-3 and VSTAMP-10 both failed (`Tests 2 failed | 8 passed`). Restored, not committed.

## Route specs run (Task 1 step 4)
`routes.versionStamp`, `routes.guards`, `routes.dashboard-access`, `routes.dashboard-display-mode`, `routes.dashboard-export`, `routes.dashboard-import.refs`, `routes.dashboard-import`, `routes.dashboard-layers-patch`, `routes.dynamic-view-crud`, `routes.dynamic-view-drop`, `routes.dynamic-view`: 198 passed, 3 failed. All 3 were TTL assertions in `routes.dynamic-view.spec.ts` (dev .env leak, TTL 3 vs 5). With `DEFAULT_VIEW_TTL_MINUTES=5` that file passes 39/39.

## Decisions / notes
- Classified the legacy `/api/dashboards/:id/views` and `/api/views/:id` writes as exempt. They write a "dashboard-table view", which is not one of the four lists the Keep load uses, and the plan 02 triggers do not cover that table. This is a judgement call: if Keep should treat them as dashboard state, they would need a trigger and a stamp.
- The `POST /api/dashboards/:dashboardId/dynamic-views` handler re-binds `source_table_id`, `name`, `template_sql` and `max_records` as consts before the `stampWrite` closure, because TS drops body narrowing inside the closure.
- 141-12 must add the Keep route to `WRITE_ROUTE_CLASSIFICATION` (VSTAMP-8 will fail until it does).
- Visual or browser verification: not applicable (server only). VSTAMP-7 checks the cors header from a request with an `Origin` header, which is not a browser preflight.

## Deviations from Plan
None. The plan executed as written.
