---
phase: 56-access-management-ui-list-open-ux
plan: "02"
subsystem: web/access-management-ui
tags: [rbac, permissions, access-control, dashboard-grants, entry-point, no-access, empty-state, frontend]
dependency_graph:
  requires:
    - DashboardAccessModal component (56-01)
    - DASHBOARDS_MANAGE_ACCESS permission constant (56-01)
    - Grant CRUD client fns listDashboardGrants/addDashboardGrant/removeDashboardGrant (56-01)
    - seedAnalystStore/seedDesignerStore/seedAdminStore in test/seedAuthStore.ts (56-01)
  provides:
    - Manage-access button in DashboardsPage list rows (canManageAccess-gated, hide-don't-disable)
    - DashboardAccessModal mounted from list row state (accessModalDashboard)
    - Friendly empty state: "No dashboards have been shared with you yet."
    - Inline no-access panel on 404 open (short-circuits broken render)
    - 11 new vitest specs: GRANTUI-V110-03 / LISTUX-V110-01 / LISTUX-V110-02 / LISTUX-V110-03
  affects:
    - packages/web/src/components/DashboardsPage.tsx
    - packages/web/src/components/DashboardsPage.spec.tsx
tech_stack:
  added: []
  patterns:
    - canManageAccess gating mirrors canEdit/canDelete exactly (hide-don't-disable, v1.8 pattern)
    - noAccess early-return in DashboardOpen before main render (short-circuit on 404)
    - DashboardAccessModal mock captures props via globalThis.__lastDAMProps (mirrors DynamicViewsModal mock pattern)
    - 404 detection: kind:"other" + message === "Dashboard not found." (Phase 55-02 contract)
key_files:
  created: []
  modified:
    - packages/web/src/components/DashboardsPage.tsx
    - packages/web/src/components/DashboardsPage.spec.tsx
decisions:
  - key: manage-access-button-placement
    value: "Button added after Delete in .ds-actions cell — consistent with canEdit/canDelete ordering. gated with canManageAccess (hide-don't-disable). accessModalDashboard state is at DashboardsPage scope, not DashboardList sub-component, matching existing pattern for the modal mount."
  - key: no-access-early-return-placement
    value: "noAccess detector added just before `const layouts = ...` (line ~754), AFTER all hooks fire (React hook rules). Early-return uses ChartCard+dashboard-list wrapper for visual consistency, not a bare div or generic error class. onBack wires to the same callback used by the toolbar Back button."
  - key: mock-dashboard-access-modal-in-spec
    value: "DashboardAccessModal is mocked in DashboardsPage.spec.tsx (same pattern as DynamicViewsModal mock) so tests assert prop passing without pulling in the full modal tree or the grant CRUD network calls. Grant fns listDashboardGrants/addDashboardGrant/removeDashboardGrant mocked as vi.fn() resolving to []."
metrics:
  duration: "~4 minutes"
  completed: "2026-06-09"
  tasks: 2
  files: 2
---

# Phase 56 Plan 02: DashboardsPage Wiring Summary

**One-liner:** Manage-access button (canManageAccess-gated, absent from DOM for analyst) opening DashboardAccessModal, friendly empty state, and inline no-access panel on 404 open — all with 11 new vitest specs (hide-don't-disable true-negative, no-access render, empty state, non-regression multi-row).

## What Was Built

### Task 1: Manage-access entry point + modal mount + friendly empty state

**`packages/web/src/components/DashboardsPage.tsx`** — DashboardsPage component changes:

- `import DashboardAccessModal from "./DashboardAccessModal"` added with other component imports.
- `canManageAccess = hasPermission(PERMISSIONS.DASHBOARDS_MANAGE_ACCESS)` added immediately after `canEdit`/`canDelete` — identical gating pattern (GRANTUI-V110-03).
- `accessModalDashboard: DashboardDto | null` state added; initialized to null.
- In `.ds-actions` cell: `{canManageAccess && (<button className="ghost-sm" onClick={() => setAccessModalDashboard(dash)}>Manage access</button>)}` — button is ABSENT from DOM without the permission (no `disabled` attribute; no DOM node at all).
- Empty state updated: `"No dashboards yet."` → `"No dashboards have been shared with you yet."` (LISTUX-V110-01).
- `DashboardAccessModal` mounted once in the list-view return, conditioned on `accessModalDashboard`: `{accessModalDashboard && (<DashboardAccessModal dashboardId={...} dashboardName={...} onClose={() => setAccessModalDashboard(null)} />)}`.
- No `dashboards.filter` added — server already filters; `listDashboards()` data flow unchanged (LISTUX-V110-03).

### Task 2: Inline no-access panel on 404 open + specs

**`packages/web/src/components/DashboardsPage.tsx`** — DashboardOpen component changes:

```typescript
const noAccess = [tablesQuery.error, widgetsQuery.error, viewsQuery.error].some(
  (e) => e && e.kind === "other" && e.message === "Dashboard not found."
);
if (noAccess) {
  return (
    <div className="dashboard-list">
      <ChartCard
        title="No access"
        actions={<button className="ghost-sm" onClick={onBack}>Back to dashboards</button>}
      >
        <div className="muted" style={{ padding: "40px 0", textAlign: "center" }}>
          You don't have access to this dashboard.
        </div>
      </ChartCard>
    </div>
  );
}
```

Early return placed before `const layouts = ...` (after all hooks), fully short-circuiting the broken/empty grid render on access-revoked or stale opens.

**`packages/web/src/components/DashboardsPage.spec.tsx`** — 11 new specs added in 4 describe blocks:

**"Manage access entry point (GRANTUI-V110-03)"** (4 tests):
1. Designer sees "Manage access" button in DOM.
2. Analyst does NOT have the button (null from queryByRole — true-negative hide-don't-disable assertion).
3. Clicking button mounts modal with correct `dashboardId` / `dashboardName` props (via `__lastDAMProps` capture).
4. Closing modal (onClose) removes it from DOM.

**"Empty list (LISTUX-V110-01)"** (2 tests):
1. Friendly empty state "No dashboards have been shared with you yet." present.
2. Old "No dashboards yet." text absent.

**"No-access state (LISTUX-V110-02)"** (3 tests):
1. `listWidgets` rejects with `Error("Dashboard not found.")` → panel with "don't have access" text appears.
2. Normal toolbar buttons (Visualizations, Back) absent from DOM.
3. Clicking "Back to dashboards" returns to list; Open button reappears.

**"Admin/designer see all rows (LISTUX-V110-03)"** (2 tests):
1. Admin with two-dashboard mock sees both rows + two Open buttons.
2. Designer same — guards against accidental client-side filtering regression.

Infrastructure additions to spec:
- `Mock` type added to vitest imports.
- `seedAdminStore` added to seedAuthStore import.
- `listDashboardGrants`, `addDashboardGrant`, `removeDashboardGrant` mocked as `vi.fn()` in the `vi.mock("../api/client")` block so DashboardAccessModal can mount without network errors.
- `vi.mock("./DashboardAccessModal")` added (mirrors DynamicViewsModal mock pattern) to capture props and test modal mounting without rendering the full grant CRUD tree.

## Deviations from Plan

None — plan executed exactly as written.

## Test Gate Results

### Targeted spec (green)

```
cd packages/web && npx vitest run src/components/DashboardsPage.spec.tsx
Test Files  1 passed (1)
Tests  38 passed (38)
```

(27 existing + 11 new)

### Full frontend vitest suite (100% green)

```
cd packages/web && npx vitest run
Test Files  82 passed (82)
Tests  1725 passed (1725)
```

Baseline before this plan: 1714 (after 56-01). +11 new tests = 1725.

### TypeScript gate (clean)

```
npx tsc --noEmit -p packages/web
(no output — CLEAN, exit code 0)
```

### Server unchanged

```
git diff --name-only packages/server
(empty — no server changes)
```

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | 8322490 | feat(56-02): add Manage-access button (canManageAccess-gated) + modal mount + friendly empty state |
| Task 2 | 34bd1e5 | feat(56-02): inline no-access panel on 404 open + entry-point/empty-state/no-access specs |

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| packages/web/src/components/DashboardsPage.tsx | FOUND |
| packages/web/src/components/DashboardsPage.spec.tsx | FOUND |
| Commit 8322490 | FOUND |
| Commit 34bd1e5 | FOUND |
