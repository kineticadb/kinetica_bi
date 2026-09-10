---
phase: 48-me-extension-frontend-store-ui-gating
plan: "02"
subsystem: frontend-api-store
tags: [rbac, permissions, self-healing, toast, window-events]
dependency_graph:
  requires: ["48-01"]
  provides: ["PERMISSION_DENIED_EVENT dispatch in apiFetch", "App.tsx PERMISSION_DENIED listener + /me re-sync"]
  affects: ["packages/web/src/api/client.ts", "packages/web/src/App.tsx"]
tech_stack:
  added: []
  patterns: ["window-event indirection (mirrors REAUTH_REQUIRED/UNAUTHORIZED_EVENT pattern)", "module-level debounce timer for event collapse", "raw-fetch fetchMe to avoid 403 re-trigger loop"]
key_files:
  created: []
  modified:
    - packages/web/src/api/client.ts
    - packages/web/src/App.tsx
    - packages/web/src/App.spec.tsx
decisions:
  - "[48-02 PERMISSION_DENIED toast]: useToastStore imported directly in client.ts (no cycle — toast.ts has zero client.ts imports); \"permission\" kind already existed in ToastKind"
  - "[48-02 debounce]: module-level permissionDeniedRefetchTimer collapses N parallel 403s to a single 200ms-debounced PERMISSION_DENIED_EVENT dispatch; mirrors the need for stampede prevention on role-change races"
  - "[48-02 empty dep array]: PERMISSION_DENIED_EVENT handler uses getState() imperatively so empty [] dep array is safe; no stale closure risk"
  - "[48-02 raw fetchMe]: fetchMe uses raw fetch (not apiFetch), ensuring the re-sync handler cannot itself trigger another 403 handler loop (Pitfall 7)"
  - "[48-02 listener placement]: re-sync lives in App.tsx (NOT client.ts) to avoid client↔auth circular import; identical to REAUTH_REQUIRED architecture"
metrics:
  duration: "2min"
  completed: "2026-06-05"
  tasks: 2
  files: 3
---

# Phase 48 Plan 02: PERMISSION_DENIED Self-Healing Summary

**One-liner:** Debounced PERMISSION_DENIED_EVENT on 403/PERMISSION_DENIED triggers toast + App.tsx /me re-sync that calls setPermissions so stale-gated surfaces re-render without polling.

## What Was Built

**Task 1 — apiFetch 403 branch (client.ts):**
- Exported `PERMISSION_DENIED_EVENT = "kbi:permission-denied"` constant alongside `UNAUTHORIZED_EVENT`
- Imported `useToastStore` directly (no import cycle — verified)
- Added module-level `permissionDeniedRefetchTimer` for N-parallel-403 collapse
- On 403 + `code: "PERMISSION_DENIED"`: fires `showToast("You no longer have permission: <perm>", "permission")` then schedules a 200ms debounced `CustomEvent(PERMISSION_DENIED_EVENT)` dispatch
- Caller 403 error path (`throwForStatus` → `PermissionError`) is completely unchanged

**Task 2 — App.tsx listener + test:**
- Extended client import line to include `PERMISSION_DENIED_EVENT` + `fetchMe`
- Added `useEffect` sibling (empty dep array) that listens for `PERMISSION_DENIED_EVENT`, calls raw `fetchMe()`, and on success calls `useAuthStore.getState().setPermissions(me.user.roles, me.user.permissions)`; removes listener on unmount
- App.spec.tsx updated: `PERMISSION_DENIED_EVENT` exposed in mock; `fetchMe` mock updated; 2 new tests added ("re-fetches /me and updates permissions" + "swallows fetchMe errors silently")

## Test Results

- `client.spec.ts`: 49/49 passed (all pre-existing 403 PermissionError tests still pass)
- `App.spec.tsx`: 23/23 passed (18 pre-existing + 5 new for PERMISSION_DENIED_EVENT suite)
- Full frontend suite: 1503/1504 (1 known-red DashboardsPage button-order unchanged — TD-V17-DASHPAGE-SPEC)

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- `packages/web/src/api/client.ts` — FOUND (modified: PERMISSION_DENIED_EVENT, useToastStore import, 403 branch)
- `packages/web/src/App.tsx` — FOUND (modified: PERMISSION_DENIED_EVENT listener useEffect)
- `packages/web/src/App.spec.tsx` — FOUND (modified: mock + 2 new tests)
- Commit `77bb52f` (Task 1) — FOUND
- Commit `2f638dc` (Task 2) — FOUND
- No import cycle: `grep -q 'import.*useAuthStore' packages/web/src/api/client.ts` returns false — CONFIRMED
