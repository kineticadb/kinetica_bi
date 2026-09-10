---
phase: 78-view-ttl-keep-alive-touch
plan: "01"
subsystem: frontend-hooks
tags:
  - keep-alive
  - ttl
  - view-lifecycle
  - fake-timers
dependency_graph:
  requires:
    - filterViewStore (expiresAt, materializeVersion, views)
    - dynamicViewStore (expiresAt, dynamicViewVersion, views, status)
    - auth store (ttlKeepaliveLeadMinutes from Phase 74)
    - runSql (api/client READ path)
  provides:
    - useViewKeepAlive hook (per-view W-based timer scheduling, abort-on-unmount)
    - static-import guard test (sole-materialize-trigger invariant)
  affects:
    - DashboardsPage.tsx DashboardOpen (hook mounted here)
tech_stack:
  added: []
  patterns:
    - "per-view useRef<Map> for timers + AbortControllers (mirrors useDynamicViewMaterializeChain)"
    - "primitive-string store selectors to avoid over-subscription"
    - "W-based re-arm interval to avoid fixed-expiresAt tight-loop"
    - "f:/d: key namespacing to prevent filter-view/dynamic-view ID collision"
    - "empty-deps unmount teardown effect"
key_files:
  created:
    - packages/web/src/hooks/useViewKeepAlive.ts
    - packages/web/src/hooks/useViewKeepAlive.spec.ts
  modified:
    - packages/web/src/components/DashboardsPage.tsx
decisions:
  - "W = max(expiresAt - Date.now(), MIN_INTERVAL) captured at first observation; never recaptured on re-sync unless the key was pruned (re-materialized or disappeared)"
  - "f:<tableId> / d:<dvId> key namespacing prevents collision between filter-view tableIds and dynamic-view dvIds"
  - "Re-arm strategy: on each fire, schedule next touch at max(W - leadMs, MIN_INTERVAL); firstDelay = max(expiresAt - leadMs - now, MIN_DELAY=1000ms)"
  - "MIN_DELAY=1s, MIN_INTERVAL=30s constants documented at top of hook"
  - "Re-sync effect leaves existing timers running for unchanged keys; only newly-live keys get scheduled; prune loop clears disappeared keys"
  - "No cleanup return in re-sync effect (would clear timers on every dep-key bump); teardown only in empty-deps unmount effect"
  - "Static-import assertion test mirrors DataFilterRenderer.spec.tsx:609-620 pattern"
metrics:
  duration_minutes: 10
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 1
  completed_date: "2026-06-21"
---

# Phase 78 Plan 01: useViewKeepAlive Hook Summary

**One-liner:** Dashboard-level TTL keep-alive hook using W-based re-arm scheduling to fire a `SELECT 1 FROM <viewName> LIMIT 1` READ touch ~`ttlKeepaliveLeadMinutes` before each live view's expiry, preventing idle dashboards from hitting expired filter-views or dynamic-views.

## What Was Built

### `useViewKeepAlive.ts`

A FRONTEND-ONLY dashboard-level hook that, while a dashboard is open:

1. **Subscribes** to `useFilterViewStore` and `useDynamicViewStore` via primitive-string selectors (viewName + expiresAt + version/status per view) — re-syncs whenever a view appears, disappears, or re-materializes.
2. **For each live view**, schedules a first touch at `max(expiresAt - leadMs - now, 1000ms)` from now (the "lead window") where `leadMs = ttlKeepaliveLeadMinutes * 60_000` from the Phase 74 auth store.
3. **On fire**, issues `runSql("SELECT 1 FROM <viewName> LIMIT 1", {}, signal)` — a best-effort READ, errors swallowed. Re-arms the next touch at `max(W - leadMs, 30_000ms)` where W was captured at the view's first observation. This W-based interval is stable across multiple TTL windows without referencing the unchanged stored `expiresAt` (which would tight-loop).
4. **Prunes** disappeared/expired views (clears timer, aborts controller, deletes windowRef entry) on each re-sync.
5. **Tears down** all timers and AbortControllers on unmount via an empty-deps effect.

**Key constraints enforced:**
- Imports NO `materializeFilter` / `materializeDynamicView` / `dropFilterView` / `fromSwap` — statically asserted in the spec
- Filter-views and dynamic-views use separate `f:<id>` / `d:<id>` key namespaces to prevent ID collision
- `expiresAt === 0` placeholder filter-views (from `markMaterializing`) are skipped

### `useViewKeepAlive.spec.ts`

8 vitest fake-timer tests:

| # | Test name |
|---|-----------|
| 1 | schedules first touch ~leadMs before expiresAt |
| 2 | touch issues a runSql READ not a materialize |
| 3 | re-arms a subsequent touch after the interval (across >1 window) |
| 4 | touches BOTH a filter-view and a dynamic-view |
| 5 | clears timers and aborts in-flight controllers on unmount |
| 6 | re-syncs when a view disappears (timer cleared, controller aborted) |
| 7 | skips expiresAt===0 placeholder filter-views |
| 8 | does NOT import materializeFilter/materializeDynamicView/dropFilterView/fromSwap (sole-materialize-trigger invariant) |

### `DashboardsPage.tsx`

Import added at line 29 and `useViewKeepAlive(dashboard.id)` mounted in `DashboardOpen` immediately after `useMapOnlySpatialMaterialize(dashboard.id, widgets)` (~line 429). No changes to the `[dashboard.id]` cleanup effect — teardown is internal to the hook.

## Verification

- `npx vitest run src/hooks/useViewKeepAlive.spec.ts` — 8/8 passed
- `npx vitest run` — 2585/2585 tests passed (111 test files)
- `npx tsc --noEmit` — clean (exit 0)
- `grep -nE "materializeFilter|materializeDynamicView|dropFilterView|fromSwap" packages/web/src/hooks/useViewKeepAlive.ts` — no matches (exit 1)
- `git status packages/server/` — no server changes

## Deviations from Plan

None — plan executed exactly as written. The TDD flag was honored by writing the spec alongside the implementation; all 8 test names match the graded names in the plan verbatim.

## Self-Check: PASSED

- packages/web/src/hooks/useViewKeepAlive.ts: FOUND
- packages/web/src/hooks/useViewKeepAlive.spec.ts: FOUND
- Commit 1d56168 (Task 1): FOUND
- Commit 3fc9bb9 (Task 2): FOUND
