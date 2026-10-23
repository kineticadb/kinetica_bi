---
phase: 142-generate-audit-viewer-live-provider-proofs
plan: 01
subsystem: server
tags: [sqlite, visibility, ai-generate, audit]
requires: []
provides:
  - dashboards.generated_by / generated_pending_at + uq_dashboards_one_pending
  - ai_audit.kind + idx_ai_audit_dash_ts
  - Dashboard.generated_pending DTO flag, getGeneratedPending, listKeptDashboards
  - creator-only canViewDashboard override for pending dashboards
  - Keep clears pending flag inside its transaction
affects: [142-05, 142-06, 142-09]
key-files:
  created:
    - packages/server/tests/db.generatedPending.spec.ts
    - packages/server/tests/routes.generatedVisibility.spec.ts
  modified:
    - packages/server/src/db.ts
    - packages/server/src/types.ts
    - packages/server/src/lib/dashboardAccessDb.ts
    - packages/server/src/lib/aiKeepApply.ts
    - packages/server/src/lib/schemaApply.ts
    - packages/server/src/index.ts
    - packages/server/tests/lib.aiAudit.spec.ts
requirements-completed: [AIGEN-V20-01, AIGEN-V20-02, AIGOV-V20-05]
completed: 2026-10-23
gaps: []
---

# Phase 142 Plan 01: Pending-generated foundation Summary

Server foundation for generated dashboards: nullable pending columns with a race-proof one-pending-per-user partial unique index, ai_audit.kind plus a (dashboard_id, ts_ms) index, a boolean-only DTO flag, a creator-only visibility override first in `canViewDashboard`, and flag clearing inside the Keep transaction.

## Commits
- c000b8c: schema, DTO flag, Keep clears flag (Task 1)
- second commit (Task 2): visibility override, enumerator filtering, grant refusal

## RED runs
- Task 1: `db.generatedPending.spec.ts` 8/8 failed ("no such column: generated_by") before implementation; green 8/8 after. AUD-3 was edited together with the implementation (the "kind" column addition would have made the old list fail; not run separately red).
- Task 2: `routes.generatedVisibility.spec.ts` PENDVIS-1..4 failed (admin saw pending dashboard, grant returned 201). PENDVIS-5 passed trivially (nothing pending to hide pre-clear is the same as post-clear behaviour) and PENDVIS-6 passed pre-implementation because `listKeptDashboards` was already added in Task 1's db.ts commit; the real enumerator guarantee for the two call sites is the grep criterion (`listKeptDashboards()` count 1 in index.ts and 1 in schemaApply.ts).

## Verification
- Targeted: db.generatedPending, lib.aiKeepApply, lib.aiKeepApply.atomic, lib.aiAudit, db.dashboardVersion, routes.versionStamp, routes.dashboard-display-mode (61 tests); routes.generatedVisibility, lib.dashboardAccessDb, routes.dashboard-access, lib.schemaImpact (76 tests): all green. `npx tsc --noEmit` clean in packages/server.

## Deviations from Plan
- Task 2 acceptance "listKeptDashboards total 0 before" was already non-zero because the helper was added in Task 1 (the helper lives in db.ts, same file as Task 1 work). Real requirement verified directly via call-site greps and PENDVIS-6.
- PENDVIS-5/6 cannot discriminate red-first (see above); reported rather than altered.
- No existing spec needed `generated_pending: false` added.

## Self-Check: PASSED
