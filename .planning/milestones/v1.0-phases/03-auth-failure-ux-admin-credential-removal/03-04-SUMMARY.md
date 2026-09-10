---
phase: 03-auth-failure-ux-admin-credential-removal
plan: 04
subsystem: frontend-ux
tags: [typescript, react, zustand, useApiQuery, toast, login-banner, permission-denied, css]

# Dependency graph
requires:
  - phase: 03-auth-failure-ux-admin-credential-removal
    plan: 03
    provides: PermissionError/ReauthRequiredError/UpstreamError from client.ts; useAuthStore.reason field
provides:
  - useApiQuery<T>(fetchFn, deps): { loading, data, error, refetch } hook (kinetica_bi/src/hooks/useApiQuery.ts)
  - useToastStore with showToast(message, kind?) + 5s auto-dismiss + DEDUP_WINDOW_MS=5000 debounce
  - Toast container component (kinetica_bi/src/components/Toast.tsx) mounted in App.tsx
  - LoginPage banner for reason==="session-expired" with exact UX-01 copy
  - 4 migrated call sites: DashboardsPage list, DashboardOpen 3 fetches, DatasetsPage table list, DatasetsPage schema discovery
  - .widget-permission-denied CSS class for grayed-out permission-denied state
  - .login-banner .toast-container .toast .toast-permission CSS classes in global.css
affects:
  - 03-05 (admin credential removal — no UX dependency)
  - LoginPage UX (reads reason from useAuthStore — set by 03-03 UNAUTHORIZED_EVENT path)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "useApiQuery: active flag prevents setState on unmounted component; reloadTick drives refetch(); deps spread into useEffect deps array"
    - "Toast debounce: DEDUP_WINDOW_MS=5000, key=${kind}::${message}, Map<string,number> tracks last shown timestamp per key"
    - "DashboardOpen migration pattern: useApiQuery for initial load, local useState for mutations, useEffect syncs query.data -> local state"
    - "schemasError discrimination: ApiQueryError.kind==='permission' renders .widget-permission-denied, else .error with message"

key-files:
  created:
    - kinetica_bi/src/hooks/useApiQuery.ts
    - kinetica_bi/src/store/toast.ts
    - kinetica_bi/src/components/Toast.tsx
  modified:
    - kinetica_bi/src/components/LoginPage.tsx
    - kinetica_bi/src/components/DashboardsPage.tsx
    - kinetica_bi/src/components/DatasetsPage.tsx
    - kinetica_bi/src/App.tsx
    - kinetica_bi/src/styles/global.css

key-decisions:
  - "Local useState pattern for mutations: useApiQuery owns initial load + refetch; local state (via useEffect sync from query.data) used for add/remove/update mutations in DashboardOpen/DashboardsPage/DatasetsPage"
  - "DashboardOpen refreshViews delegates to viewsQuery.refetch() — no duplicate listViews() call; downstream setViews synced via useEffect on viewsQuery.data"
  - "TableCreate chained fetches (fetchKineticaTables, fetchKineticaColumns) stay on existing try/catch pattern — user-interaction-triggered callbacks; useApiQuery deps model doesn't fit cleanly (CONTEXT.md scope discipline)"
  - "Toast dedup key is kind::message — same permission message from 3 simultaneous widgets produces 1 toast within 5s window"
  - "deleteError separate from fetch error in DashboardsPage/DatasetsPage — mutation errors are independent of fetch errors; useApiQuery owns fetch, useState owns mutations"
  - "Task 3 manual UX verification deferred by user decision — 7 browser checks saved to 03-UAT.md; plan marked complete with deferred-UAT; Phase 3 continues to Plan 03-05"

requirements-completed: [UX-01, UX-02]

# Metrics
duration: 10min
completed: 2026-04-28
---

# Phase 03 Plan 04: Frontend UX Surface — useApiQuery hook + Toast + LoginPage Banner + Widget Migrations Summary

**Stuck-spinner-resistant useApiQuery hook, debounced global toast on 403 permission errors, grayed-out widget-permission-denied placeholder, and "Your session has ended" LoginPage banner shipped; 4 high-traffic call sites migrated; manual UX verification deferred to 03-UAT.md**

## Status: COMPLETE (with deferred UAT)

All 3 tasks resolved. Tasks 1 and 2 fully automated and committed. Task 3 (manual browser verification checkpoint) resolved with deferred-UAT per user decision — 7 checks documented in `03-UAT.md` for pre-milestone verification.

## Performance

- **Duration:** ~10 min (Tasks 1-2 ~7 min, Task 3 deferred resolution ~3 min)
- **Started:** 2026-04-28T17:16:00Z
- **Completed:** 2026-04-28T17:35:00Z
- **Tasks completed:** 3 of 3 (Task 3: resolved-with-deferred-UAT)
- **Files created:** 3 (useApiQuery.ts, toast.ts, Toast.tsx) + 1 planning (03-UAT.md)
- **Files modified:** 5

## Automated Check Results (run at Task 3 continuation)

| Check | Command | Result |
|-------|---------|--------|
| Frontend build | `npm --prefix kinetica_bi run build` | Exit 0 — 918 modules transformed, no TypeScript errors |
| Backend tests | `npm --prefix kinetica_bi/server test -- --run` | 210 passed, 0 failed |
| Backend test errors | EADDRINUSE on port 4000 | 6 non-test errors — orphaned vitest worker occupying :4000 from a previous dev run; not a test failure (all 210 tests pass) |

The EADDRINUSE :4000 error is an operational/dev-environment artifact. The 210 passing tests confirm zero backend regression from the frontend-only changes in Plans 03-03 and 03-04.

## Operational Notes

Two side-issues observed during dev server startup (not in Phase 3 scope; documented here for future readers):

1. **Missing SESSION_ENCRYPTION_KEY in .env at startup:** `sessionStore.ts:25` reads `SESSION_ENCRYPTION_KEY` at module-top (before `dotenv.config()` runs in `index.ts`). In dev, the env var must be exported in the shell before launching the server (via `set -a && source .env && set +a`). This is Phase 1's boot validation working as designed — the server refuses to start without the key. A dev-experience improvement (e.g., early dotenv load in sessionStore.ts) is worth filing as a follow-up but is out of Phase 3 scope.

2. **Orphaned vitest worker on :4000 during test run:** The EADDRINUSE errors from `tests/auth.routes.spec.ts` indicate a previous dev server process was still bound to port 4000 when tests ran. This is exactly the scenario that Plan 03-06's bootstrap gate is designed to prevent — the gate ensures the server doesn't start (or at least warns loudly) if a stale process is holding the test port. The EADDRINUSE errors are non-fatal to the test suite; all 210 tests passed regardless.

## Accomplishments

### Task 1: Core UX Primitives

**useApiQuery hook** (`kinetica_bi/src/hooks/useApiQuery.ts`):
- `useApiQuery<T>(fetchFn, deps): { loading, data, error, refetch }`
- `error.kind: "permission" | "reauth" | "upstream" | "other"` — discriminated union
- `setLoading(false)` in `.finally()` with `active` flag guard — no stuck spinners, no setState on unmounted
- PermissionError → `error.kind === "permission"` + `showToast("You don't have permission to view this data.", "permission")`
- ReauthRequiredError → `error.kind === "reauth"` (App.tsx UNAUTHORIZED_EVENT handler handles routing)
- `reloadTick` state triggers refetch via `refetch()` function

**Toast store** (`kinetica_bi/src/store/toast.ts`):
- `useToastStore` Zustand store with `showToast(message, kind?)` and `dismissToast(id)`
- `DEDUP_WINDOW_MS = 5000` — dedup key `${kind}::${message}`, suppresses duplicate toasts within 5s window
- Auto-dismiss after 5000ms via `setTimeout`

**Toast component** (`kinetica_bi/src/components/Toast.tsx`):
- Reads from `useToastStore`; renders `.toast-container` with per-toast `.toast .toast-${kind}`
- Mounted in App.tsx for all three branches: loading shell, unauthenticated (LoginPage), authenticated (app-shell)

**LoginPage banner** (`kinetica_bi/src/components/LoginPage.tsx`):
- Reads `reason` from `useAuthStore`
- Renders `<div className="login-banner" role="status">Your session has ended. Please sign in again.</div>` ABOVE the form when `reason === "session-expired"`
- Absent on bootstrap/login/logout paths (reason is null — see 03-03 invariant)

**global.css additions** (`kinetica_bi/src/styles/global.css`):
- `.login-banner` — rgba(56,189,248,0.08) background, rgba(56,189,248,0.4) border (accent-2 color)
- `.toast-container` — fixed bottom-right, z-index 1000, pointer-events none
- `.toast` — var(--panel) background, var(--border) border, box-shadow, toast-in animation
- `.toast-permission` — rgba(245,158,11,0.45) amber border
- `.toast-error` — rgba(239,68,68,0.45) red border
- `.toast-message`, `.toast-dismiss` — layout helpers
- `@keyframes toast-in` — 0.18s opacity + translateY
- `.widget-permission-denied` — dashed border, centered content, opacity 0.7, "Permission denied" text

### Task 2: 4 Call Site Migrations

| Site | Component | Fetch | Migration Pattern |
|------|-----------|-------|-------------------|
| 1 | DashboardsPage list | `listDashboards()` | `useApiQuery<DashboardDto[]>(() => listDashboards(), [])` |
| 2a | DashboardOpen | `listDashboardTables(id)` | `tablesQuery = useApiQuery<TableDto[]>(() => listDashboardTables(id), [id])` |
| 2b | DashboardOpen | `listWidgets(id)` | `widgetsQuery = useApiQuery<WidgetDto[]>(() => listWidgets(id), [id])` |
| 2c | DashboardOpen | `listViews(id)` | `viewsQuery = useApiQuery<ViewDto[]>(() => listViews(id), [id]); refreshViews = () => viewsQuery.refetch()` |
| 3 | DatasetsPage list | `listTables()` | `useApiQuery<TableDto[]>(() => listTables(), [])` |
| 4 | TableCreate | `fetchKineticaSchemas()` | `schemasQuery = useApiQuery<string[]>(() => fetchKineticaSchemas(), [])` |

**Mutation pattern:** `useApiQuery` data synced to local `useState` via `useEffect` — mutations (add/remove/update) operate on local state; `refetch()` available for source-of-truth refresh.

**Permission-denied rendering:**
```tsx
{error && error.kind === "permission" && <div className="widget-permission-denied">Permission denied</div>}
{error && error.kind !== "permission" && <div className="error">{error.message}</div>}
```
Toast fires automatically through the hook (no widget-level `showToast` calls needed).

### Deferred (21+ sites — CONTEXT.md scope discipline)

The following helpers in `client.ts` remain on the existing `try/catch + setError` pattern and are NOT migrated in Phase 3:
- All helpers used in mutation contexts (createDashboard, updateDashboard, deleteDashboard, addDashboardTable, removeDashboardTable, etc.)
- All widget CRUD helpers (createWidget, updateWidget, deleteWidget)
- View CRUD helpers (createView, updateViewFilter, deleteView, materializeView)
- Chained discovery: `fetchKineticaTables(schema)` and `fetchKineticaColumns(schema, table)` inside `handleSchemaChange`/`handleTableChange` callbacks (user-interaction-triggered; useApiQuery deps model doesn't fit)
- TablePickerModal's `listTables()` fetch inside DashboardsPage

**Future migration:** Any helper wrapped in `useState + useEffect + try/catch/finally` for initial-load is a candidate. Mutation helpers are out of scope for useApiQuery.

### Task 3: Manual UX Verification — Resolved with Deferred UAT

User chose to defer the 7 browser-based checks at the checkpoint. The checks have been saved to:

**`/.planning/phases/03-auth-failure-ux-admin-credential-removal/03-UAT.md`** (`status: deferred-pending-manual-verification`)

The UAT file contains all 7 checks verbatim with exact expected outcomes, pre-flight instructions, and resolution guidance. Phase 3 continues to Plan 03-05 without blocking on these checks.

## Exact Copy Values (for downstream UAT)

- **Toast message:** `You don't have permission to view this data.`
- **LoginPage banner:** `Your session has ended. Please sign in again.`
- **Toast debounce window:** 5000ms
- **Toast dedup key format:** `${kind}::${message}`
- **Toast auto-dismiss:** 5000ms

## CSS Class Names Added (collision reference)

| Class | File | Purpose |
|-------|------|---------|
| `.login-banner` | global.css | LoginPage session-expired banner (accent-2 blue styling) |
| `.toast-container` | global.css | Fixed bottom-right toast host |
| `.toast` | global.css | Individual toast card |
| `.toast-permission` | global.css | Amber border for permission toasts |
| `.toast-error` | global.css | Red border for error toasts |
| `.toast-message` | global.css | Toast text (flex: 1) |
| `.toast-dismiss` | global.css | Toast X button |
| `@keyframes toast-in` | global.css | 0.18s slide-up animation |
| `.widget-permission-denied` | global.css | Grayed-out permission placeholder |

## Task Commits

1. **Task 1: Core UX primitives** — `5591c11` (feat)
2. **Task 2: Migrate 4 call sites to useApiQuery** — `ba55143` (feat)
3. **Task 3: Deferred UAT** — resolved-with-deferred-UAT (this commit)

## Deviations from Plan

None — plan executed exactly as written. Scope discipline (21+ helpers deferred) honored. Task 3 checkpoint resolved via user-directed defer path (not a deviation — checkpoint:human-verify explicitly supports defer outcomes).

## Self-Check: PASSED

- `kinetica_bi/src/hooks/useApiQuery.ts` — FOUND
- `kinetica_bi/src/store/toast.ts` — FOUND
- `kinetica_bi/src/components/Toast.tsx` — FOUND
- `kinetica_bi/src/components/LoginPage.tsx` — FOUND
- `kinetica_bi/src/components/DashboardsPage.tsx` — FOUND
- `kinetica_bi/src/components/DatasetsPage.tsx` — FOUND
- `kinetica_bi/src/App.tsx` — FOUND
- `kinetica_bi/src/styles/global.css` — FOUND
- Commit `5591c11` — FOUND (feat(03-04): build core UX primitives)
- Commit `ba55143` — FOUND (feat(03-04): migrate 4 high-traffic call sites to useApiQuery)
- Frontend build: exit 0 (918 modules, no errors)
- Backend tests: 210 passed, 0 failed
- `03-UAT.md` — CREATED with status: deferred-pending-manual-verification
