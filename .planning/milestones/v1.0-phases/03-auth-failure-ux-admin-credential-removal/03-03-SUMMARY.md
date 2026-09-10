---
phase: 03-auth-failure-ux-admin-credential-removal
plan: 03
subsystem: frontend-auth
tags: [typescript, apifetch, zustand, error-classes, session-expired, body-peek]

# Dependency graph
requires:
  - phase: 03-auth-failure-ux-admin-credential-removal
    plan: 02
    provides: backend returns 401+code:REAUTH_REQUIRED, 403, 502 from errorMiddleware
provides:
  - body-peeking apiFetch that only fires UNAUTHORIZED_EVENT on code==="REAUTH_REQUIRED"
  - ReauthRequiredError, PermissionError, UpstreamError exported from client.ts
  - throwForStatus internal helper extracting {error} body and throwing typed class
  - useAuthStore.reason field ("session-expired" | null) for LoginPage banner (03-04)
  - markUnauthenticated(reason?) overload — App.tsx passes "session-expired" from event
affects:
  - 03-04 (LoginPage reads reason to render "Your session has ended" banner)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Body-peek pattern: response.clone().json() inspects 401 body without consuming original stream; parse failures fall back to no-dispatch"
    - "throwForStatus helper: try clone().json() for {error} body, fall back to response.text(), then throw typed class based on status code"
    - "fetchMe intentionally excluded from throwForStatus migration — treats 401 as null (not session expiry); documented with comment"
    - "AuthReason discriminated union: reason field set only via UNAUTHORIZED_EVENT path; all other paths (bootstrap, login, logout) set reason: null"

key-files:
  modified:
    - kinetica_bi/src/api/client.ts
    - kinetica_bi/src/App.tsx
  created:
    - kinetica_bi/src/store/auth.ts

key-decisions:
  - "login helper kept with generic Error throw (not throwForStatus) — login 401 means wrong credentials, not session expiry; no reason to throw ReauthRequiredError on a login attempt"
  - "fetchMe uses raw fetch (not apiFetch) and returns null on 401 — this is Phase 1 contract; migrating to throwForStatus would break bootstrap flow; explicitly excluded with comment"
  - "throwForStatus uses response.clone().json() to avoid consuming the stream, consistent with the apiFetch body-peek pattern"
  - "reason: null on all bootstrap paths — bootstrap-driven 401 is honest 'not logged in', not mid-session expiry; user should not see 'session expired' banner on first load"
  - "logout sets reason: null — user clicked the button; they know what happened; no banner needed"

requirements-completed: [UX-01, UX-03]

# Metrics
duration: 2min
completed: 2026-04-28
---

# Phase 03 Plan 03: Frontend Dispatch Refactor + Error Classes + Auth Store Reason Field Summary

**Body-peeking apiFetch dispatches UNAUTHORIZED_EVENT only on code==="REAUTH_REQUIRED"; three typed error classes (ReauthRequiredError, PermissionError, UpstreamError) replace generic throws; useAuthStore.reason tracks mid-session expiry for LoginPage banner**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-28T17:16:10Z
- **Completed:** 2026-04-28T17:18:04Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

### Task 1: client.ts changes

- Added three error classes: `ReauthRequiredError` (status 401), `PermissionError` (status 403), `UpstreamError` (status 502) — all extend Error with `name` property and `Object.setPrototypeOf` for correct `instanceof` behavior
- Replaced bare `apiFetch` 401 dispatch with body-peek: `response.clone().json()` inspects body for `code === "REAUTH_REQUIRED"` before dispatching; parse failures fall back to no-dispatch
- Added `throwForStatus` internal helper: reads `{ error }` from cloned JSON body, falls back to text, then throws the correct typed class for 401/403/502; generic Error for all other statuses
- Migrated all 26 helpers from `throw new Error(...)` pattern to `await throwForStatus(response, "message")` 
- `fetchMe` intentionally NOT migrated — uses raw `fetch` (not `apiFetch`) and returns `null` on 401 (Phase 1 contract for bootstrap)
- `login` intentionally kept with generic Error throw — login 401 means wrong credentials, not session expiry
- `materializeView` simplified: error path uses `throwForStatus`, success path calls `response.json()` directly (previously parsed json eagerly before checking `!response.ok`)

### Task 2: auth.ts + App.tsx changes

- Added `type AuthReason = "session-expired" | null` to auth store
- Extended `AuthState` with `reason: AuthReason` field
- `markUnauthenticated` updated to accept optional `reason?: AuthReason` (defaults to `null`)
- All bootstrap paths set `reason: null` — bootstrap-driven 401 is honest "not logged in", NOT mid-session expiry
- Login success and failure both set `reason: null`
- Logout `finally` block sets `reason: null` — explicit user action, no banner needed
- App.tsx UNAUTHORIZED_EVENT handler updated: `markUnauthenticated("session-expired")` (was `markUnauthenticated()`)

## Helper Migration Status

| Helper | Migrated to throwForStatus? | Notes |
|--------|----------------------------|-------|
| `login` | No | Generic Error — login 401 = wrong credentials |
| `logout` | N/A | No error branch |
| `fetchMe` | No | Returns null on 401 (bootstrap contract) |
| `runSql` | Yes | |
| `apiHealth` | N/A | No error branch |
| `createDashboard` | Yes | |
| `updateDashboard` | Yes | |
| `deleteDashboard` | Yes | |
| `listDashboardTables` | Yes | |
| `addDashboardTable` | Yes | |
| `removeDashboardTable` | Yes | |
| `listDashboards` | Yes | |
| `listTables` | Yes | |
| `getTableById` | Yes | |
| `createTableEntry` | Yes | |
| `fetchKineticaSchemas` | Yes | |
| `fetchKineticaTables` | Yes | |
| `fetchKineticaColumns` | Yes | |
| `listWidgets` | Yes | |
| `createWidget` | Yes | |
| `updateWidget` | Yes | |
| `deleteWidget` | Yes | |
| `deleteTableEntry` | Yes | |
| `listViews` | Yes | |
| `createView` | Yes | |
| `updateViewFilter` | Yes | |
| `deleteView` | Yes | |
| `materializeView` | Yes | Simplified (no eager json parse on error path) |
| `updateTable` | Yes | |

**Total migrated: 26 helpers. Intentionally excluded: 3 (login, fetchMe, apiHealth/logout have no error branches).**

## reason='session-expired' Invariant

The `reason` field in `useAuthStore` is ONLY set to `"session-expired"` when:
- `UNAUTHORIZED_EVENT` fires in App.tsx, triggering `markUnauthenticated("session-expired")`

The `reason` field is cleared to `null` when:
- `bootstrap()` succeeds → authenticated path sets `reason: null`
- `bootstrap()` gets `null` from `fetchMe()` → unauthenticated path sets `reason: null`
- `bootstrap()` catches any error → catch path sets `reason: null`
- `login()` succeeds → `reason: null`
- `login()` fails → `reason: null`
- `logout()` completes (success or error) → finally sets `reason: null`

This ensures `reason === "session-expired"` persists across the `status` transition to `unauthenticated` until the user sees LoginPage (Plan 03-04 reads it to render the banner), but is cleared on any subsequent authentication action.

## Body-Peek Defensive Fallback

The `apiFetch` body-peek is defensive against parse failures:

```typescript
try {
  const peek = await response.clone().json();
  if (peek && typeof peek === "object" && (peek as { code?: string }).code === "REAUTH_REQUIRED") {
    shouldDispatch = true;
  }
} catch {
  // body wasn't JSON or already consumed — do not dispatch
}
```

- **Parse failure** (non-JSON body, empty body, consumed stream): `shouldDispatch` stays `false` → no UNAUTHORIZED_EVENT → user is NOT logged out
- **JSON parsed but no `code` field**: `shouldDispatch` stays `false` → no logout
- **JSON parsed with `code === "REAUTH_REQUIRED"`**: `shouldDispatch = true` → logout
- **Original response stream**: untouched (`.clone()` is used for the peek)

## Task Commits

1. **Task 1: Add error classes + body-peeking apiFetch + typed throws in helpers** - `2d75e7d` (feat)
2. **Task 2: Extend useAuthStore with reason field; App.tsx signals on UNAUTHORIZED_EVENT** - `af69ff5` (feat)

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- kinetica_bi/src/api/client.ts: FOUND
- kinetica_bi/src/store/auth.ts: FOUND
- kinetica_bi/src/App.tsx: FOUND
- Commit 2d75e7d (Task 1): FOUND
- Commit af69ff5 (Task 2): FOUND
