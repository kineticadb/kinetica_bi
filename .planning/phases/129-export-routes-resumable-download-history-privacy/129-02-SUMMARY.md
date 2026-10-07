---
phase: 129-export-routes-resumable-download-history-privacy
plan: 02
subsystem: server/exports
tags: [exports, routes, privacy, rbac]
requires: [129-01]
provides: [registerExportRoutes, /api/exports start/list/status/cancel/delete]
affects: [129-03, 129-04]
key-files:
  created:
    - packages/server/src/exportRoutes.ts
    - packages/server/tests/routes.exports.spec.ts
  modified:
    - packages/server/src/index.ts
metrics:
  tasks: 2
  completed: 2026-10-07
---

# Phase 129 Plan 02: Export routes Summary

Five requireAuth-only routes over the Phase 128 runner: start is gated by canViewDashboard on the widget's dashboard, every :id route by ownership through one function (`loadOwnedJob`), with a single 404 body for unknown, malformed and not-yours ids.

## Routes
| Route | Success | Errors |
|---|---|---|
| POST /api/exports | 202 `{data: dto}` | 400 invalid_export_request / ExportSpecError code; 403 CSV disabled (O-3); 404 widget not found or not viewable (identical); 500 no KINETICA_URL |
| GET /api/exports | 200 own jobs, newest first | - |
| GET /api/exports/:id | 200 | 404 Export not found. |
| POST /api/exports/:id/cancel | 202 | 404; 409 `{status}` when terminal |
| DELETE /api/exports/:id | 204 (cancels first if active, O-2) | 404 (also on second delete) |

Download route is not here (Plan 129-03). No concurrency cap (O-6).

## Commits
- 9c7ec6e: exportRoutes.ts + index.ts wiring and passthrough comment
- Task 2 commit: routes.exports.spec.ts (14 EXPRT129- tests)

## Discrimination probes (all reverted; exportRoutes.ts diff clean)
- P1 skip owner check -> EXPRT129-noleak-ids red
- P2 split 404/403 -> EXPRT129-noleak-start (and csv-disabled) red
- P3 drop canViewDashboard -> EXPRT129-noleak-start (and csv-disabled) red
- P4 drop enableCsvDownload check -> EXPRT129-csv-disabled red
- P5 drop filters array check -> EXPRT129-validate red
- P6 permission gate analyst lacks -> EXPRT129-analyst-grant-only red (plus 7 others); proves EXPRT-V126-17 test can fail
- P7 DELETE skips cancelExport -> did NOT fire initially (the unwinding run cleans up after the row is deleted). Strengthened delete-running to assert the stub never served batch 3; P7 then red.

## Deviations
- [Rule 1] The no-kinetica-url test needs a session stamped with kineticaUrl "" (auth rejects sessions whose URL differs from env, giving 401 not 500). Test-only fix.
- Two spread expressions in exportRoutes.ts use ternaries instead of `&&` to satisfy tsc (unknown spread).

## Verification
tsc clean; routes.exports 14/14; dashboard-export and exportJobAccess specs green; `npm run test:gate` PASSED (layers.spec.ts failed in full run, passes alone: contamination). Spec not in KNOWN_FAILING. Shared docs untouched; no requirement marked complete.

## Self-Check: PASSED
