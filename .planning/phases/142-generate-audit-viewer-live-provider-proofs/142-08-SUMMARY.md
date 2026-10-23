---
phase: 142-generate-audit-viewer-live-provider-proofs
plan: 08
subsystem: web
tags: [ai-audit, admin-ui, rbac-gate]
requires: ["142-03"]
provides: [listAiAudit, getAiAuditEntry, listAiAuditDashboards, AiActivityPage, ai-activity nav gate]
affects: [142-09, 142-10]
key-files:
  created:
    - packages/web/src/components/AiActivityPage.tsx
    - packages/web/src/components/AiActivityPage.css
    - packages/web/src/components/AiActivityPage.spec.tsx
    - packages/web/src/api/client.aiAudit.spec.ts
    - packages/web/src/App.aiActivity.spec.tsx
  modified:
    - packages/web/src/api/client.ts
    - packages/web/src/App.tsx
    - packages/web/src/components/Sidebar.tsx
    - packages/web/src/components/Sidebar.spec.tsx
    - packages/web/src/lib/permissionGroups.ts
    - packages/web/src/lib/permissionGroups.spec.ts
requirements: [AIGOV-V20-05]
completed: 2026-10-23
---

# Phase 142 Plan 08: AI activity page Summary

Admin "AI activity" page (filters, 50-per-page paging, defensive detail panel, plain-text rendering) over the audit read API, gated by audit:view in the sidebar, page restore and a live redirect.

## Tasks

1. Client functions plus page (commit 205c077). RED recorded: client spec 2/2 failed, page spec failed at import; green 11/11 and 2/2.
2. Nav gate and description (commit see git log, "feat(142-08): gate AI activity nav"). RED recorded: 5 of 5 new tests failed; green after implementation.

## Verification

Targeted run (Sidebar, App.aiActivity, App, permissionGroups, RolesPage, AiActivityPage, client.aiAudit, theme-guard): 8 files, 290 tests passed. tsc clean. No change to permissions.ts, PERMISSIONS, role mappings or group keys.

classNames in AiActivityPage.tsx (all existing or `ai-activity-*`): ai-activity-detail, ai-activity-filters, ai-activity-paging, ai-activity-sql, ai-activity-row, config-group, config-group-label, ds-actions, ds-field, ds-field-label, ds-select, error, ghost-sm, muted, users-error error, users-loading, users-page, users-page-header, users-page-title, users-table, users-table-wrap, users-td, users-th, users-tr.

## Deviations from Plan

**1. [Rule 1 - Bug] Gate did not react to a mid-session role change.** `hasPermission` is a stable function, so listing it in the effect deps and calling it in render never re-ran after the user's permissions changed (AUDNAV-4 timed out). App.tsx now subscribes to `canViewAudit = useAuthStore(s => s.hasPermission(AUDIT_VIEW))` and uses it in the gate effect deps and the render condition. Branding keeps its existing (same latent weakness) logic, untouched.

**2. Test setup.** App.aiActivity.spec.tsx stubs `./store/wmsCapabilities`: the real WMS probe hit a live localhost:4000 (401), fired UNAUTHORIZED and logged the user out mid-test. It uses the real Sidebar (App.spec stubs it) so the nav click is genuine.

## Non-discriminating criteria

- `grep -c "PERMISSIONS.AUDIT_VIEW" App.tsx >= 3` reads 2 after the canViewAudit refactor (restore clause + the single subscription). Real requirement (restore, redirect, render all gated) is proven by AUDNAV-2/3/4.
- AUDNAV-3's negative half (no restore without audit:view) also passes before the change; the positive half is the discriminating one.

## Not provable here

Light/dark legibility of the table and detail panel: routed to 142-10 UAT. STATE/ROADMAP/REQUIREMENTS untouched per operator constraint.

gaps: none

## Self-Check: PASSED
