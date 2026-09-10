---
phase: 56-access-management-ui-list-open-ux
verified: 2026-06-09T17:10:00Z
overall_status: passed
score: 6/6 requirements verified
re_verification: false
---

# Phase 56: Access-Management UI & List/Open UX — Verification Report

**Phase Goal:** A manage_access user can view and edit a dashboard's grants from the UI, and the list/open experience reflects per-dashboard access for every persona.
**Verified:** 2026-06-09
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Test Gate Results

### TypeScript gate
`npx tsc --noEmit -p packages/web` — clean (no output, exit code 0).

### Full frontend vitest suite
`cd packages/web && npx vitest run` — **82 test files passed, 1725 tests passed**.

The full suite emits one unhandled-rejection error from `WidgetRenderer.spec.tsx` (a timer artifact in the "no_filter over-threshold" test). This error is **pre-existing**: confirmed present at commit `705b7b1` (the last Phase 55 commit, before any Phase 56 code). All 1725 tests pass regardless. This is not a Phase 56 regression.

### Targeted spec files
`cd packages/web && npx vitest run src/api/client.dashboard-access.spec.ts src/components/DashboardAccessModal.spec.tsx` — **2 files, 14 tests passed**.

`cd packages/web && npx vitest run src/components/DashboardsPage.spec.tsx` — **1 file, 38 tests passed** (27 pre-existing + 11 new Phase 56 specs).

### Server untouched
`git show --name-only 009f8dc bbdd007 8322490 34bd1e5 | grep packages/server` — empty. Zero server changes across all four Phase 56 commits.

---

## Observable Truths — Verification

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | manage_access user can view a dashboard's user + role grants in split sections | VERIFIED | `DashboardAccessModal.tsx` renders People + Roles sections from `listDashboardGrants`; test 1 in modal spec confirms |
| 2 | User grants can be added (free-text, pre-provisioning) and removed | VERIFIED | `handleAdd`/`handleRemove` in modal call `addDashboardGrant`/`removeDashboardGrant`; spec tests 3, 4, 6 confirm |
| 3 | Role grants can be added (dropdown from listRoles) and removed | VERIFIED | Modal renders `<select>` from `listRoles()` when toggled; spec test 5 confirms |
| 4 | Manage access button absent from DOM for analyst (hide-don't-disable) | VERIFIED | `{canManageAccess && ...}` gate in DashboardsPage.tsx; DashboardsPage.spec test "analyst does NOT have a Manage access button" passes with `queryByRole(...) → null` |
| 5 | Friendly empty state for zero-dashboards | VERIFIED | Line 169 of DashboardsPage.tsx: "No dashboards have been shared with you yet."; LISTUX-V110-01 spec passes |
| 6 | 404 on open renders inline no-access panel + Back action (not broken render) | VERIFIED | `noAccess` early-return at line 762 of DashboardsPage.tsx with "You don't have access to this dashboard." + Back button; LISTUX-V110-02 spec (3 tests) passes |

---

## Required Artifacts

| Artifact | Status | Evidence |
|----------|--------|----------|
| `packages/web/src/lib/permissions.ts` | VERIFIED | Line 27: `DASHBOARDS_MANAGE_ACCESS: "dashboards:manage_access"` — 17th entry, byte-parity with server |
| `packages/web/src/test/seedAuthStore.ts` | VERIFIED | Line 36: `PERMISSIONS.DASHBOARDS_MANAGE_ACCESS` in designer seed; analyst seed (`permissions: [PERMISSIONS.DASHBOARDS_VIEW]`) does NOT include it |
| `packages/web/src/api/client.ts` | VERIFIED | `DashboardGrantDto` type at line 520; `listDashboardGrants` at 597, `addDashboardGrant` at 604, `removeDashboardGrant` at 618; DELETE sends JSON body with `Content-Type: application/json` at lines 622-626 |
| `packages/web/src/api/client.dashboard-access.spec.ts` | VERIFIED | 7 tests; all pass; covers GET/POST/DELETE contracts including DELETE-body assertion |
| `packages/web/src/components/DashboardAccessModal.tsx` | VERIFIED | 282 lines; `modal-overlay` + `stopPropagation`; info line "Admins and designers always have access"; People + Roles sections; free-text user input + datalist; role dropdown; no hardcoded hex colors |
| `packages/web/src/components/DashboardAccessModal.spec.tsx` | VERIFIED | 7 tests covering list/add-user/pre-provisioning/add-role/remove/close |
| `packages/web/src/components/DashboardsPage.tsx` | VERIFIED | Import at line 37; `canManageAccess` at line 83; `accessModalDashboard` state at line 85; gated button at lines 200-204; modal mount at lines 211-215; friendly empty state at line 169; `noAccess` detector at lines 758-759; early-return panel at lines 762-775; no `dashboards.filter` added |
| `packages/web/src/components/DashboardsPage.spec.tsx` | VERIFIED | 38 tests (27 pre-existing + 11 new); all pass; covers GRANTUI-V110-03 (4 tests), LISTUX-V110-01 (2), LISTUX-V110-02 (3), LISTUX-V110-03 (2) |
| `packages/web/src/lib/permissions.spec.ts` | VERIFIED | Updated to 17 permission count; includes `DASHBOARDS_MANAGE_ACCESS` string assertion |
| `packages/web/src/components/RolesPage.spec.tsx` | VERIFIED | Updated to 17 checkbox count |
| `packages/web/src/lib/permissionGroups.ts` | VERIFIED | Line 15: description for `dashboards:manage_access` added |

---

## Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `DashboardAccessModal.tsx` | `listDashboardGrants / addDashboardGrant / removeDashboardGrant` | Direct import from `../api/client`; called in `useEffect` (list) and `handleAdd`/`handleRemove` | WIRED |
| `DashboardsPage.tsx` list row `.ds-actions` | `DashboardAccessModal` | `canManageAccess`-gated button sets `accessModalDashboard` state; `{accessModalDashboard && <DashboardAccessModal ...>}` mounts the modal | WIRED |
| `DashboardsPage.tsx` DashboardOpen | inline no-access panel | `noAccess = [...queries].some(e => e.kind === "other" && e.message === "Dashboard not found.")` → early `if (noAccess) return` before main render | WIRED |
| `removeDashboardGrant` | DELETE `/api/dashboards/:id/access` | `method: "DELETE"`, `headers: {"Content-Type": "application/json"}`, `body: JSON.stringify(input)` — 55-02 delete-body contract | WIRED |

---

## Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| GRANTUI-V110-01 | manage_access user can open panel listing current user + role grants | SATISFIED | `DashboardAccessModal.tsx` split-section list; modal spec test 1 |
| GRANTUI-V110-02 | Add/remove grants persisted via grant API, list reflects returned grants | SATISFIED | `handleAdd`/`handleRemove` use `addDashboardGrant`/`removeDashboardGrant`; `setGrants(updated)` from return value; spec tests 3-6 |
| GRANTUI-V110-03 | Entry point hidden when user lacks manage_access (hide-don't-disable) | SATISFIED | `{canManageAccess && <button>Manage access</button>}`; analyst spec returns `null` from `queryByRole` |
| LISTUX-V110-01 | List shows only permitted dashboards (no client filter added) | SATISFIED | No `dashboards.filter` in DashboardsPage.tsx; server already filters; empty state spec confirms friendly message |
| LISTUX-V110-02 | Direct nav to non-permitted dashboard shows clear no-access state | SATISFIED | `noAccess` early-return renders "You don't have access" panel + "Back to dashboards" button; 3 LISTUX-V110-02 specs pass |
| LISTUX-V110-03 | Admin/designer see all dashboards (no regression) | SATISFIED | `listDashboards` data flow unchanged; LISTUX-V110-03 specs (admin + designer 2-dashboard render) pass |

---

## Anti-Pattern Scan

No blocker or warning anti-patterns found in Phase 56 files:

- No hardcoded hex colors in `DashboardAccessModal.tsx` (grep clean)
- No `return null` / `return {}` stub implementations
- No `TODO`/`FIXME` placeholder comments in production code
- No `dashboards.filter` client-side access filtering in `DashboardsPage.tsx`
- No `disabled` attribute on Manage access button (absent from DOM entirely for non-holders — correct hide-don't-disable)

---

## Locked Decision Compliance

| Decision | Required | Actual |
|----------|----------|--------|
| DELETE sends JSON body | `removeDashboardGrant` must send `method: "DELETE"` + `Content-Type: application/json` + `body: JSON.stringify(input)` | Confirmed at client.ts lines 622-626; client.dashboard-access.spec.ts test 3 asserts body present |
| Free-text user input (pre-provisioning) | User input must be free text, not restricted to known users | `<input type="text">` with optional `<datalist>`; modal spec test 4 proves unknown username fires addDashboardGrant |
| Role dropdown from listRoles() | Role selector must be populated from listRoles() | `<select>` populated from `roles` state loaded via `listRoles()` on mount |
| Info line: admins/designers always have access | Modal must mention bypass users | Line 138-140 of DashboardAccessModal.tsx; spec test 2 asserts `/admins and designers/i` |
| 404 panel not generic error | "Dashboard not found." must render no-access panel, not `<div className="error">` | `if (noAccess)` early return renders `ChartCard` with "You don't have access to this dashboard." — distinct from the generic error block below it |
| No client-side list filtering | `dashboards.filter` must NOT be added | Grep confirmed empty for `dashboards.filter` in DashboardsPage.tsx |

---

## Summary

Phase 56 goal is fully achieved. All six requirements (GRANTUI-V110-01..03, LISTUX-V110-01..03) are satisfied by real, substantive, and wired code. The 14 new Phase 56 specs and the extended DashboardsPage.spec.tsx suite (38 total, 11 new) pass. TypeScript is clean. The server package is untouched. The one pre-existing `WidgetRenderer.spec.tsx` unhandled-rejection error in the full suite predates Phase 56 and does not affect test pass counts.

---

*Verified: 2026-06-09*
*Verifier: Claude (gsd-verifier)*
