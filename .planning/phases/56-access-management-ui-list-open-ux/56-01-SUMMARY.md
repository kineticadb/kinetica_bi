---
phase: 56-access-management-ui-list-open-ux
plan: "01"
subsystem: web/access-management-ui
tags: [rbac, permissions, access-control, dashboard-grants, modal, frontend]
dependency_graph:
  requires:
    - DASHBOARDS_MANAGE_ACCESS permission on server (55-01)
    - Grant CRUD routes GET/POST/DELETE /api/dashboards/:id/access (55-02)
  provides:
    - DASHBOARDS_MANAGE_ACCESS permission constant in web catalog (byte-parity with server)
    - DashboardGrantDto type + listDashboardGrants / addDashboardGrant / removeDashboardGrant
    - DashboardAccessModal component (list/add/remove user + role grants)
    - 14 vitest specs covering all grant CRUD contracts + modal UX
  affects:
    - packages/web/src/lib/permissions.ts (17th entry added)
    - packages/web/src/test/seedAuthStore.ts (designer seed updated)
    - packages/web/src/api/client.ts (DashboardGrantDto type + 3 fns)
    - packages/web/src/lib/permissionGroups.ts (description for manage_access added)
    - packages/web/src/lib/permissions.spec.ts (16→17 parity counts)
    - packages/web/src/components/RolesPage.spec.tsx (16→17 checkbox count)
tech_stack:
  added: []
  patterns:
    - Grant CRUD client fns mirror dashboard-layers CRUD style (apiFetch + throwForStatus + JSON body)
    - DELETE sends JSON body {grantee_type, grantee} — 55-02 delete-body decision enforced
    - Modal chrome mirrors VisualizationPickerModal / TablePickerModal (modal-overlay + stopPropagation)
    - Free-text user input with optional datalist for pre-provisioning support
    - Role dropdown populated from listRoles() — no hardcoded role list
key_files:
  created:
    - packages/web/src/api/client.dashboard-access.spec.ts
    - packages/web/src/components/DashboardAccessModal.tsx
    - packages/web/src/components/DashboardAccessModal.spec.tsx
  modified:
    - packages/web/src/lib/permissions.ts
    - packages/web/src/test/seedAuthStore.ts
    - packages/web/src/api/client.ts
    - packages/web/src/lib/permissionGroups.ts
    - packages/web/src/lib/permissions.spec.ts
    - packages/web/src/components/RolesPage.spec.tsx
decisions:
  - key: delete-body-contract-enforced
    value: "removeDashboardGrant fires DELETE with Content-Type: application/json and JSON body {grantee_type, grantee} — symmetric with addDashboardGrant POST; mirrors 55-02 delete-body decision. This is the load-bearing contract tested explicitly in client.dashboard-access.spec.ts."
  - key: pre-provisioning-via-free-text
    value: "User input is a free-text <input> with a <datalist> for autocomplete suggestions from listUsers(). The datalist is optional — the user can type any username. No gating on known users; server stores grantee lowercased. Pre-provisioning test 4 proves an unknown username still fires addDashboardGrant."
  - key: grants-refresh-from-return-value
    value: "After add or remove, setGrants() receives the updated list returned by the mutation fns (not a separate re-fetch). On mount, listDashboardGrants() is called once. This avoids a double-network round trip on each mutation."
  - key: parity-specs-updated
    value: "permissions.spec.ts and RolesPage.spec.tsx both hardcode permission counts as literals. Adding the 17th permission broke both specs (Rule 1 auto-fix). Updated both to 17 and added the DASHBOARDS_MANAGE_ACCESS string assertion to permissions.spec.ts."
metrics:
  duration: "~7 minutes"
  completed: "2026-06-09"
  tasks: 2
  files: 9
---

# Phase 56 Plan 01: DashboardAccessModal Foundation Summary

**One-liner:** Frontend grant CRUD client layer (DashboardGrantDto + 3 fns, DELETE-with-body contract) and DashboardAccessModal component (split user/role sections, free-text pre-provisioning, role dropdown) with 14 passing vitest specs and clean web tsc.

## What Was Built

### Task 1: DASHBOARDS_MANAGE_ACCESS permission + DashboardGrantDto + grant CRUD client fns

**`packages/web/src/lib/permissions.ts`** — 17th entry added immediately after DATASETS_MANAGE:
```typescript
DASHBOARDS_MANAGE_ACCESS: "dashboards:manage_access",
```
Byte-parity with `packages/server/src/lib/permissions.ts` line 23.

**`packages/web/src/test/seedAuthStore.ts`** — `PERMISSIONS.DASHBOARDS_MANAGE_ACCESS` added to `seedDesignerStore()` permissions array. `seedAdminStore` picks it up automatically via `Object.values(PERMISSIONS)`. `seedAnalystStore` intentionally excluded (analyst must NOT have it — drives the hide-don't-disable test in Plan 56-02).

**`packages/web/src/api/client.ts`** — `DashboardGrantDto` type added (mirrors server dashboardAccessDb row):
```typescript
export type DashboardGrantDto = {
  grantee_type: "user" | "role";
  grantee: string;
  created_at: string;
};
```

Three grant CRUD fns added, mirroring the dashboard-layers CRUD style:
- `listDashboardGrants(dashboardId)` — GET `/api/dashboards/:id/access` → `json.grants`
- `addDashboardGrant(dashboardId, input)` — POST with JSON body → `json.grants`
- `removeDashboardGrant(dashboardId, input)` — DELETE WITH JSON body → `json.grants`

The DELETE fn sends `Content-Type: application/json` + body `{grantee_type, grantee}` — symmetric with POST, enforcing the 55-02 delete-body decision.

**`packages/web/src/api/client.dashboard-access.spec.ts`** — 7 tests:
- GET path + `json.grants` return
- POST body/method/Content-Type assertions
- DELETE body present (load-bearing DELETE-body contract assertion)
- DELETE return value
- Error path (non-ok response throws)

### Task 2: DashboardAccessModal component + spec

**`packages/web/src/components/DashboardAccessModal.tsx`** (282 lines) — Props: `{ dashboardId, dashboardName, onClose }`.

Structure:
- `modal-overlay` → `modal-content` (stopPropagation) — mirrors VisualizationPickerModal/TablePickerModal chrome exactly.
- `modal-header` with `Share: {dashboardName}` title and Close button.
- `modal-body`:
  - Informational line: "Admins and designers always have access to every dashboard."
  - Loading/error state display.
  - **People** section: user grants with `Remove user {grantee}` aria-labeled × buttons.
  - **Roles** section: role grants with `Remove role {grantee}` aria-labeled × buttons.
  - **Add access** section: User/Role type toggle → free-text input (with datalist from listUsers) or role `<select>` (from listRoles); disabled Add button when input empty.

**`packages/web/src/components/DashboardAccessModal.spec.tsx`** — 7 tests:
1. Mount → "ann" under People, "analyst" under Roles (split sections).
2. Info line matches `/admins and designers/i`.
3. Add user "jdoe" → `addDashboardGrant(7, {grantee_type:"user", grantee:"jdoe"})`.
4. Pre-provisioning "neverloggedin" (not in listUsers()) → Add still fires.
5. Toggle to Role, select "analyst" → `addDashboardGrant(7, {grantee_type:"role", grantee:"analyst"})`.
6. Click × for "ann" → `removeDashboardGrant(7, {grantee_type:"user", grantee:"ann"})` → ann gone.
7. Close button routes through onClose.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated permissions.spec.ts parity spec for 17th permission**
- **Found during:** Full vitest suite run after Task 2 (adding new modal + its spec revealed the existing parity spec counted 16)
- **Issue:** `permissions.spec.ts` hardcodes `16` in two assertions ("has exactly 16 permission keys" and "has no duplicate permission string values"). Adding the 17th permission broke both. The spec also needed the new DASHBOARDS_MANAGE_ACCESS string added as a hardcoded literal (the spec's purpose is independent string verification).
- **Fix:** Updated count assertions to 17; added `expect(PERMISSIONS.DASHBOARDS_MANAGE_ACCESS).toBe("dashboards:manage_access")` literal.
- **Files modified:** `packages/web/src/lib/permissions.spec.ts`
- **Commit:** bbdd007

**2. [Rule 1 - Bug] Updated RolesPage.spec.tsx checkbox count for 17th permission**
- **Found during:** Full vitest suite run after Task 2
- **Issue:** `RolesPage.spec.tsx` test "renders 16 permission checkboxes in 5 group sections" failed because the RolesPage matrix renders ALL permissions from the catalog — now 17.
- **Fix:** Updated checkbox count assertion to 17 in `waitFor(() => expect(screen.getAllByRole("checkbox").length).toBe(17))`. Also added `dashboards:manage_access` description to `permissionGroups.ts` (NOUN_TO_GROUP maps "dashboards" → "Dashboards" group automatically; description was missing).
- **Files modified:** `packages/web/src/components/RolesPage.spec.tsx`, `packages/web/src/lib/permissionGroups.ts`
- **Commit:** bbdd007

**3. [Rule 1 - Bug] Added `unknown` intermediate cast to mockedClient in DashboardAccessModal.spec.tsx**
- **Found during:** TSC gate
- **Issue:** `clientModule as { ... }` fails TSC because `typeof clientModule` and the target type don't sufficiently overlap. The correct pattern (from DynamicViewsModal.spec.tsx) is `clientModule as unknown as { ... }`.
- **Fix:** Added the `unknown` intermediate cast.
- **Files modified:** `packages/web/src/components/DashboardAccessModal.spec.tsx`
- **Commit:** bbdd007

## Test Gate Results

### Targeted specs (both green)

```
cd packages/web && npx vitest run src/api/client.dashboard-access.spec.ts src/components/DashboardAccessModal.spec.tsx
Test Files  2 passed (2)
Tests  14 passed (14)
```

### Full frontend vitest suite (100% green)

```
cd packages/web && npx vitest run
Test Files  82 passed (82)
Tests  1714 passed (1714)
```

Baseline before this plan: 1700+ tests across 80 files (82 files = +2 new spec files; 1714 = +14 new tests).

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
| Task 1 | 009f8dc | feat(56-01): add DASHBOARDS_MANAGE_ACCESS permission + DashboardGrantDto + grant CRUD client fns |
| Task 2 | bbdd007 | feat(56-01): add DashboardAccessModal component + spec; update parity specs for 17th permission |

## Self-Check: PASSED

All created files confirmed present. Both task commits verified in git log.

| Check | Result |
|-------|--------|
| packages/web/src/lib/permissions.ts | FOUND |
| packages/web/src/test/seedAuthStore.ts | FOUND |
| packages/web/src/api/client.ts | FOUND |
| packages/web/src/api/client.dashboard-access.spec.ts | FOUND |
| packages/web/src/components/DashboardAccessModal.tsx | FOUND |
| packages/web/src/components/DashboardAccessModal.spec.tsx | FOUND |
| Commit 009f8dc | FOUND |
| Commit bbdd007 | FOUND |
